import { fullBodies } from './full-body-store';
import { logBuffer } from './log-buffer';
import { NETWORK_ABORTED, type BodySkip, type NetworkEntry } from './log-entry';
import {
  DEFAULT_BODY_LIMIT,
  INTERNAL_REQUEST_HEADER,
  MAX_BODY_READ_BYTES,
  isTextual,
  isUncaptured,
  requestSkip,
  responseFields,
  runUncaptured,
  setHeader,
} from './network-tap';
import { truncate } from './redact';

/**
 * Dấu Expo đóng lên **mọi** global nó tự cài bằng `installGlobal`
 * (`expo/src/winter/installGlobal.ts`): `Object.defineProperty(value, Symbol.for('expo.builtin'),
 * { value: true })`, ngay lần đầu getter lười của global đó chạy. Từ SDK 56, `fetch` là một trong số
 * đó (`expo/src/winter/runtime.native.ts` gọi `install('fetch', …)` với hàm `fetch` của
 * `winter/fetch/fetch.ts`), trừ khi app đặt `EXPO_PUBLIC_USE_RN_FETCH=1`. Sentry RN dò đúng dấu này (`isExpoFetchEnabled`,
 * getsentry/sentry-react-native#6226).
 */
const EXPO_BUILTIN = Symbol.for('expo.builtin');

/** Nhãn lỗi tầng vận chuyển — cùng bộ với `network-tap`. */
type Failure = 'network' | 'timeout' | typeof NETWORK_ABORTED;

/**
 * Status mà theo spec fetch **không bao giờ** có thân ("null body status"). Không clone, không đọc —
 * thân rỗng là thật, không phải "không bắt được".
 */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

const INTERNAL_HEADER = INTERNAL_REQUEST_HEADER.toLowerCase();

type FetchFn = (...args: unknown[]) => unknown;

interface SignalLike {
  readonly aborted?: unknown;
  readonly reason?: unknown;
}

/** Phần của `Response` mà tap chạm tới — `FetchResponse` của Expo và bản giả trong test cùng thoả. */
interface ResponseLike {
  readonly status?: unknown;
  readonly headers?: { get?: (name: string) => unknown };
  readonly body?: unknown;
  clone?: () => ResponseLike;
}

interface ReaderLike {
  read: () => Promise<{ done?: boolean; value?: unknown }>;
  cancel: (reason?: unknown) => unknown;
}

/** Request đã đọc ra từ `(input, init)` — chỉ đọc, không đổi gì của app. */
interface RequestInfo {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly signal: SignalLike | undefined;
  /** Mang header {@link INTERNAL_REQUEST_HEADER} ⇒ request của chính tool, không ghi. */
  readonly internal: boolean;
}

/** Dòng đã ghi cho một lần gọi `fetch`. */
interface Pending {
  readonly id: number;
  readonly startedAt: number;
  readonly signal: SignalLike | undefined;
}

/** Kế hoạch cho thân response: không có thân · lý do không ghi · bản clone chờ đọc. */
type BodyPlan =
  | { readonly text: undefined }
  | { readonly skipped: BodySkip }
  | { readonly clone: ResponseLike };

/** Kết quả đọc bản clone: chữ (có thể rỗng) · lý do không ghi · luồng hỏng giữa chừng. */
type BodyRead =
  | { readonly text: string | undefined }
  | { readonly skipped: BodySkip }
  | { readonly failed: unknown };

const NO_BODY = { text: undefined } as const;
const UNREADABLE = { skipped: 'unreadable' } as const;

const NOOP = () => undefined;

let installed = false;
let uninstall: () => void = NOOP;

/**
 * `fetch` này là `expo/fetch` (native, **không** qua XHR) chứ không phải polyfill whatwg của RN?
 *
 * Chỉ nhận khi có dấu `expo.builtin` **và** không có cờ `polyfill` của whatwg-fetch (`fetch.polyfill =
 * true` — đúng hàm mà tap XHR đã bắt). Hàm lạ không mang dấu nào (app/SDK bọc `fetch` trước khi gọi
 * `startCapture`) ⇒ **không** bọc: không biết bên dưới có phải XHR không, mà bọc nhầm là ghi hai dòng.
 */
const isNativeFetch = (fn: unknown): fn is FetchFn =>
  typeof fn === 'function' &&
  (fn as unknown as Record<symbol, unknown>)[EXPO_BUILTIN] === true &&
  (fn as { polyfill?: unknown }).polyfill !== true;

/**
 * **Chức năng:** bắt request đi qua `fetch` **native** của Expo (`expo/fetch` — `fetch` toàn cục mặc
 * định trên Android/iOS từ Expo SDK 56) vào vòng đệm nhật ký, với **đúng** ngữ nghĩa `NetworkEntry`
 * của `tapNetwork`. `fetch` của RN (polyfill whatwg trên XHR) thì **không** đụng — `tapNetwork` đã bắt.
 *
 * ## Dò: chỉ bọc khi chắc chắn không phải XHR
 *
 * Đọc `globalThis.fetch` **một lần**, lúc gọi hàm này. Có dấu `Symbol.for('expo.builtin')` (Expo đóng
 * lên global nó cài, xem {@link EXPO_BUILTIN}) và không có cờ `polyfill` của whatwg-fetch ⇒ bọc. Còn
 * lại ⇒ không làm gì, trả hàm gỡ rỗng. Hệ quả, ghi rõ để khỏi bất ngờ:
 * - `import { fetch } from 'expo/fetch'` gọi thẳng thì **không** bắt được — đó là binding của module,
 *   không đi qua global.
 * - SDK khác (Sentry…) bọc `fetch` **trước** `startCapture` ⇒ hàm bọc không mang dấu ⇒ không bọc. Gọi
 *   `startCapture` sớm hơn (entry file) thì SDK bọc ra ngoài hàm của tap, cả hai cùng thấy request.
 * - Hàm bọc của tap **mang lại** dấu `expo.builtin`: SDK dò dấu này sau đó (Sentry bật fetch tracing
 *   theo nó) vẫn thấy đúng là `fetch` không qua XHR.
 * - Lớp chặn ghi trùng thứ hai: hàm gốc chạy trong `runUncaptured`, nên nếu bên dưới vẫn mở XHR **đồng
 *   bộ** thì tap XHR bỏ qua XHR đó (dòng đã do tap này ghi).
 *
 * ## Ngữ nghĩa — giống tap XHR
 *
 * - Ghi dòng "đang bay" **ngay lúc gọi**: method (viết hoa), URL **app gọi** (redirect không đổi),
 *   header **thô** (che là việc của chỗ xuất, xem `redact.ts`), thân request chuỗi/`URLSearchParams`
 *   cắt theo `bodyLimit` (bản đầy đủ vào kho riêng); FormData ⇒ `formData`, Blob/ArrayBuffer ⇒
 *   `binary`, kiểu khác (ReadableStream…) ⇒ `unreadable` — không đọc vào thân của app.
 * - Response tới (promise của app resolve) ⇒ điền `status` + `durationMs` (tới lúc có header) ngay.
 *   Thân tap đọc xong ⇒ `durationMs` thành thời gian **tới hết thân**, cùng nghĩa với tap XHR (chốt
 *   ở `loadend`): nhánh `tee` của tap đọc ngay nên lúc nó xong là lúc nguồn xong. ⚠️ Thân tap **không**
 *   đọc (nhị phân, `tooLarge`, `text/event-stream`, HEAD/204/304) ⇒ `durationMs` **giữ thời gian tới
 *   header** (tải 6 s một ảnh vẫn ghi vài chục ms, chip "Chậm" không thấy), và luồng hỏng giữa thân
 *   **không** được thấy (dòng giữ status). Thân chỉ đọc khi
 *   `content-type` là chữ, `content-length` (nếu có) ≤ {@link MAX_BODY_READ_BYTES}, không phải
 *   `text/event-stream`: đọc **bản clone** (`response.clone()` — Expo `tee` luồng), từng mẩu, dừng và
 *   huỷ nhánh của mình khi vượt 1 MB (`tooLarge`). Không bao giờ đọc response gốc ⇒ `res.text()` của app
 *   vẫn ra đủ; không `await` gì trên đường của app ⇒ không chặn. Cái giá: response đã clone thì
 *   `res.text()` của app đọc qua nhánh `tee` (JS) thay vì một lần đọc native. Ảnh/nhị phân ⇒ `binary`,
 *   **không** clone (đường đọc của app giữ nguyên). HEAD, 204/205/304, `content-length: 0` ⇒ không có
 *   thân.
 * - Promise của app reject ⇒ lỗi tầng vận chuyển: `signal` đã huỷ ⇒ `abort` (lý do `TimeoutError`
 *   của `AbortSignal.timeout` ⇒ `timeout`), thông điệp có "timed out"/"timeout" ⇒ `timeout`, còn lại
 *   ⇒ `network`. Luồng thân hỏng giữa lúc tap đọc ⇒ dòng đổi sang lỗi đó (như tap XHR: "200" kèm thân
 *   cụt là nói dối).
 * - Bỏ qua hẳn (không dòng nào): gọi trong `runUncaptured`, hoặc mang header `X-Shake-Devtools` (mọi
 *   cách viết hoa) — connector báo bug dựa vào cả hai.
 * - Màn đang mở được vòng đệm đóng dấu (`screen`), như mọi dòng.
 *
 * App luôn nhận **đúng** Response/lỗi của hàm gốc; tap hỏng (đọc header ném, buffer ném) thì nuốt.
 *
 * **Input:** `bodyLimit` — số ký tự giữ lại cho mỗi thân.
 * **Output:** hàm **gỡ**: `globalThis.fetch` còn là hàm của tap ⇒ trả lại hàm gốc; đã bị bọc chồng
 * (không gỡ khỏi chuỗi được) ⇒ hàm của tap thành trong suốt, không ghi nữa. Request đang bay vẫn được
 * chốt. Gọi lần hai khi chưa gỡ ⇒ no-op (trả hàm gỡ của lần một).
 *
 * @example
 * ```ts
 * const stop = tapFetch(4000);  // app Expo SDK 56+: bọc; app RN thường: không làm gì
 * await fetch('https://x/y');   // một dòng 'network' vào nhật ký
 * stop();                       // globalThis.fetch là hàm gốc của Expo trở lại
 * ```
 *
 * **Unit test:** `fetch-tap.test.ts` — 53 case, trên `expo/fetch` giả dựng theo mã nguồn Expo (hàm
 * mang dấu, Response có `clone()` = `tee()`):
 * - dò (6): dấu Expo ⇒ bọc và hàm bọc mang lại dấu · giữ `name`/`length` của hàm gốc · whatwg-fetch
 *   thật (`polyfill`) · hàm trơn · dấu kèm `polyfill` ⇒ không bọc, global giữ nguyên · gọi hai lần ⇒
 *   một lớp.
 * - ghi (7): dòng ghi ngay lúc gọi (header thô, chưa status) rồi 200 + thời lượng + thân · 404 · 500 ·
 *   `Request` của whatwg-fetch làm input (URL/method/header/thân `_bodyInit`) · header dạng mảng ·
 *   đóng dấu màn · thô trong buffer, đường xuất (`redactHeaders`, `formatEntry`) che.
 * - lỗi (6): lỗi mạng · huỷ bằng `AbortController` (không tính là lỗi) · huỷ qua `Request.signal` ·
 *   `AbortSignal.timeout` ⇒ `timeout` · native "timed out" ⇒ `timeout` · hàm gốc ném đồng bộ.
 * - thân request (7): cắt + kho đầy đủ · `URLSearchParams` ghi chữ · FormData · ArrayBuffer ·
 *   Uint8Array · Blob · ReadableStream ⇒ lý do, hàm gốc nhận nguyên object.
 * - thân response (16): `res.text()` của app ra đủ khi đọc sau · ngay (trước khi tap đọc xong) · ảnh ⇒
 *   `binary` không clone · `content-length` > 1 MB ⇒ `tooLarge` không clone · luồng không
 *   `content-length` vượt 1 MB ⇒ `tooLarge`, nhánh tap bị huỷ, app vẫn đọc đủ · cắt theo `bodyLimit` +
 *   kho đầy đủ · thân 0 byte · 204 · HEAD · `content-length: 0` (không clone) · `text/event-stream` ⇒
 *   `unreadable` không clone · `clone` ném · `clone` vắng ⇒ `unreadable` · status vào lúc có header,
 *   `durationMs` thành thời gian tới hết thân khi đọc xong (≥ 3 s ⇒ "chậm") · thân không đọc (ảnh) giữ
 *   thời gian tới header · luồng hỏng giữa thân ⇒ `network`.
 * - loại trừ (6): header `X-Shake-Devtools` dạng object · `Headers` · mảng (mọi cách viết hoa) ·
 *   `runUncaptured` · `makeConnectorContext` thật của connector · `fetch` ngay sau `runUncaptured` vẫn ghi.
 * - không ghi trùng (1): hàm mang dấu mà bên dưới mở XHR đồng bộ ⇒ đúng một dòng với `tapNetwork` bật.
 * - gỡ (3): trả hàm gốc, không ghi nữa · bị bọc chồng ⇒ giữ hàm của SDK, hàm của tap trong suốt ·
 *   request đang bay lúc gỡ vẫn chốt.
 * - listener của buffer ném ⇒ app vẫn nhận đúng Response (1).
 */
export const tapFetch = (bodyLimit = DEFAULT_BODY_LIMIT): (() => void) => {
  if (installed) return uninstall;

  const g = globalThis as { fetch?: unknown };
  let original: unknown;
  try {
    /* Đọc global kích getter lười của Expo — chính nó đóng dấu `expo.builtin` lên hàm. */
    original = g.fetch;
  } catch {
    return NOOP;
  }
  if (!isNativeFetch(original)) return NOOP;
  const nativeFetch = original;

  let active = true;

  const tappedFetch = function tappedFetch(this: unknown, ...args: unknown[]): unknown {
    if (!active || isUncaptured()) return nativeFetch.apply(this, args);

    const request = tryReadRequest(args[0], args[1]);
    if (!request || request.internal) return nativeFetch.apply(this, args);

    const pending = begin(request, bodyLimit);
    let result: unknown;
    try {
      /* `runUncaptured`: hàm gốc lỡ mở XHR đồng bộ thì tap XHR bỏ qua — dòng này đã ghi rồi. */
      result = runUncaptured(() => nativeFetch.apply(this, args));
    } catch (error) {
      settleFailure(pending, error);
      throw error;
    }
    /* Trả promise **dẫn xuất** chứ không móc thêm handler lên promise gốc: móc lên gốc là "đã có
       người bắt", app quên `catch` sẽ mất cảnh báo promise reject không ai bắt. */
    return Promise.resolve(result).then(
      (response: unknown) => {
        settleResponse(pending, request, response, bodyLimit);
        return response;
      },
      (error: unknown) => {
        settleFailure(pending, error);
        throw error;
      },
    );
  };

  try {
    Object.defineProperty(tappedFetch, EXPO_BUILTIN, { value: true });
    copyNameAndLength(nativeFetch, tappedFetch);
    g.fetch = tappedFetch;
  } catch {
    return NOOP;
  }
  /* Global không ghi được (đã đóng băng…) ⇒ coi như không cài. */
  if (g.fetch !== tappedFetch) return NOOP;

  /* So với CHÍNH NÓ, không với cờ chung — cùng lý do với `tapNetwork`. */
  const stop = () => {
    if (uninstall !== stop) return;
    active = false;
    try {
      if (g.fetch === tappedFetch) g.fetch = nativeFetch;
    } catch {
      /* Nuốt — `active = false` đã làm hàm của tap trong suốt. */
    }
    installed = false;
    uninstall = NOOP;
  };
  uninstall = stop;
  installed = true;
  return stop;
};

/**
 * Hàm bọc mang `name`/`length` của hàm gốc (code dò kiểu `fetch.name === 'fetch'` không lệch). Từng
 * thuộc tính một, nuốt lỗi: thuộc tính không định nghĩa lại được thì giữ của hàm bọc.
 */
const copyNameAndLength = (from: FetchFn, to: FetchFn) => {
  for (const key of ['name', 'length'] as const) {
    try {
      Object.defineProperty(to, key, { value: from[key], configurable: true });
    } catch {
      /* Nuốt. */
    }
  }
};

/** `input` là `Request` (của whatwg-fetch hay của ai) — cùng luật với `isRequest` của `expo/fetch`. */
const isRequestLike = (input: unknown): input is Record<string, unknown> => {
  if (input === null || typeof input !== 'object') return false;
  const RequestCtor = (globalThis as { Request?: unknown }).Request;
  return (
    'body' in input ||
    (typeof RequestCtor === 'function' && input instanceof RequestCtor) ||
    (input as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag] === 'Request'
  );
};

/**
 * Thân của một `Request` — như `dangerouslyGetBodyFromRequest` của `expo/fetch`: `Request` của
 * whatwg-fetch giữ thân gốc ở `_bodyInit` (`body` của nó không phải luồng).
 */
const bodyOfRequest = (request: Record<string, unknown>): unknown =>
  '_bodyInit' in request
    ? request._noBody !== true
      ? request._bodyInit
      : undefined
    : request.body;

/** Duyệt `HeadersInit`: `Headers` (có `forEach`) · mảng cặp · object thường. */
const forEachHeader = (init: unknown, fn: (name: string, value: string) => void) => {
  if (init === null || typeof init !== 'object') return;
  if (Array.isArray(init)) {
    for (const pair of init) {
      if (Array.isArray(pair) && pair.length >= 2) fn(String(pair[0]), String(pair[1]));
    }
    return;
  }
  const each = (init as { forEach?: unknown }).forEach;
  if (typeof each === 'function') {
    (each as (cb: (value: unknown, name: unknown) => void) => void).call(init, (value, name) =>
      fn(String(name), String(value)),
    );
    return;
  }
  for (const name of Object.keys(init)) {
    fn(name, String((init as Record<string, unknown>)[name]));
  }
};

/** Đọc method/URL/header/thân/`signal` theo đúng thứ tự ưu tiên của `expo/fetch`: `init` trước `Request`. */
const readRequest = (input: unknown, init: unknown): RequestInfo => {
  const request = isRequestLike(input) ? input : undefined;
  const options = (typeof init === 'object' && init !== null ? init : {}) as Record<string, unknown>;

  const headers: Record<string, string> = {};
  let internal = false;
  forEachHeader(options.headers ?? request?.headers, (name, value) => {
    if (name.toLowerCase() === INTERNAL_HEADER) internal = true;
    setHeader(headers, name, value);
  });

  return {
    method: String(options.method ?? request?.method ?? 'GET').toUpperCase(),
    url: request ? String(request.url) : String(input),
    headers,
    body: options.body ?? (request ? bodyOfRequest(request) : undefined),
    signal: (options.signal ?? request?.signal ?? undefined) as SignalLike | undefined,
    internal,
  };
};

/** Input lạ làm việc đọc ném (getter của app…) ⇒ `undefined`: không ghi, request vẫn đi nguyên. */
const tryReadRequest = (input: unknown, init: unknown): RequestInfo | undefined => {
  try {
    return readRequest(input, init);
  } catch {
    return undefined;
  }
};

/** Thân request ghi được dạng chữ: chuỗi, hoặc `URLSearchParams` (whatwg-fetch cũng gửi `toString()` của nó). */
const requestText = (body: unknown): string | undefined => {
  if (typeof body === 'string') return body;
  const Params = (globalThis as { URLSearchParams?: unknown }).URLSearchParams;
  return typeof Params === 'function' && body instanceof Params ? String(body) : undefined;
};

/** Ghi dòng "đang bay". Không bao giờ ném: buffer ném lúc ghi thì dòng (nếu đã vào) vẫn được chốt. */
const begin = (request: RequestInfo, bodyLimit: number): Pending => {
  const pending: Pending = {
    id: logBuffer.nextId(),
    startedAt: Date.now(),
    signal: request.signal,
  };
  try {
    const raw = requestText(request.body);
    const cut = truncate(raw, bodyLimit);
    if (cut.truncated && raw) fullBodies.put(pending.id, 'request', raw);
    logBuffer.push({
      id: pending.id,
      kind: 'network',
      at: pending.startedAt,
      method: request.method,
      url: request.url,
      requestHeaders: { ...request.headers },
      requestBody: cut.text,
      requestTruncated: cut.truncated,
      requestBodySkipped: raw === undefined ? requestSkip(request.body) : undefined,
    });
  } catch {
    /* Nuốt — xem ghi chú ở `console-tap`. */
  }
  return pending;
};

/** Lỗi của hàm gốc (hoặc của luồng thân) → nhãn. Xem JSDoc của `tapFetch`. */
const failureOf = (error: unknown, signal: SignalLike | undefined): Failure => {
  try {
    if (signal?.aborted === true) {
      const reason = signal.reason as { name?: unknown } | null | undefined;
      return reason?.name === 'TimeoutError' ? 'timeout' : NETWORK_ABORTED;
    }
    const name = (error as { name?: unknown } | null | undefined)?.name;
    if (name === 'AbortError') return NETWORK_ABORTED;
    if (name === 'TimeoutError') return 'timeout';
    const message = error instanceof Error ? error.message : String(error);
    return /timed? ?out/i.test(message) ? 'timeout' : 'network';
  } catch {
    return 'network';
  }
};

/** Chốt dòng là lỗi tầng vận chuyển: không status, không thân. */
const settleFailure = (pending: Pending, error: unknown) => {
  try {
    logBuffer.patch(pending.id, {
      status: undefined,
      durationMs: Date.now() - pending.startedAt,
      responseBody: undefined,
      responseTruncated: false,
      responseBodySkipped: undefined,
      error: failureOf(error, pending.signal),
    });
  } catch {
    /* Nuốt — lỗi của tap không được thay lỗi mà app nhận. */
  }
};

const responseHeader = (response: ResponseLike, name: string): string | undefined => {
  try {
    const value = response.headers?.get?.(name);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
};

/** Quyết định có đọc thân không — và nếu có thì clone **ngay**, trước khi app chạm vào response. */
const planBody = (response: ResponseLike, method: string, status: number | undefined): BodyPlan => {
  if (method === 'HEAD' || (status !== undefined && NULL_BODY_STATUS.has(status))) return NO_BODY;
  const length = responseHeader(response, 'content-length')?.trim();
  if (length !== undefined && length !== '' && Number(length) === 0) return NO_BODY;

  const contentType = responseHeader(response, 'content-type');
  if (!isTextual(contentType)) return { skipped: 'binary' };
  /* Luồng không có hồi kết: nhánh `tee` của tap giữ kết nối sống cả khi app đã huỷ nhánh của nó. */
  if (/^text\/event-stream\b/i.test(contentType?.trim() ?? '')) return UNREADABLE;
  if (Number(length) > MAX_BODY_READ_BYTES) return { skipped: 'tooLarge' };

  if (typeof response.clone !== 'function') return UNREADABLE;
  try {
    return { clone: response.clone() };
  } catch {
    /* Thân đã bị đọc/khoá (SDK khác chạy trước) ⇒ không đọc được, app không bị ảnh hưởng. */
    return UNREADABLE;
  }
};

/** Chốt dòng khi có response: status + thời lượng ngay, thân (nếu đọc) vào sau. */
const settleResponse = (
  pending: Pending,
  request: RequestInfo,
  value: unknown,
  bodyLimit: number,
) => {
  try {
    const response = (typeof value === 'object' && value !== null ? value : {}) as ResponseLike;
    const status = typeof response.status === 'number' ? response.status : undefined;
    const plan = planBody(response, request.method, status);
    const isError = status !== undefined && status >= 400;
    try {
      if (isError) fullBodies.markError(pending.id);
      logBuffer.patch(pending.id, {
        status,
        durationMs: Date.now() - pending.startedAt,
        responseBody: undefined,
        responseTruncated: false,
        responseBodySkipped: 'skipped' in plan ? plan.skipped : undefined,
        error: undefined,
      });
    } catch {
      /* Listener của buffer ném sau khi dòng đã sửa — vẫn phải đọc thân (bản clone đã tạo). */
    }
    if ('clone' in plan) {
      readCapped(plan.clone, (read) => {
        try {
          if ('failed' in read) {
            settleFailure(pending, read.failed);
          } else if ('skipped' in read) {
            logBuffer.patch(pending.id, { responseBodySkipped: read.skipped });
          } else {
            const fields: Partial<NetworkEntry> = {
              ...responseFields(pending.id, read.text, bodyLimit),
              /* Thời gian tới HẾT thân — như `loadend` của tap XHR (xem JSDoc của `tapFetch`). */
              durationMs: Date.now() - pending.startedAt,
            };
            /* Kho đầy đủ chỉ giữ request lỗi nếu đã có thân lúc đánh dấu — đánh dấu lại sau khi có. */
            if (isError) fullBodies.markError(pending.id);
            logBuffer.patch(pending.id, fields);
          }
        } catch {
          /* Nuốt. */
        }
      });
    }
  } catch {
    /* Nuốt — app vẫn nhận nguyên Response. */
  }
};

/** Mẩu dữ liệu của luồng → byte. Kiểm bằng `isView`/tag, không `instanceof` (Uint8Array khác realm). */
const asBytes = (value: unknown): Uint8Array | undefined => {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
    return new Uint8Array(value as ArrayBuffer);
  }
  return undefined;
};

const decode = (chunks: readonly Uint8Array[], size: number): BodyRead => {
  if (size === 0) return NO_BODY;
  const Decoder = (globalThis as { TextDecoder?: new () => { decode: (b: Uint8Array) => string } })
    .TextDecoder;
  if (typeof Decoder !== 'function') return UNREADABLE;
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new Decoder().decode(all) };
};

const cancelQuietly = (reader: ReaderLike) => {
  try {
    void Promise.resolve(reader.cancel()).catch(NOOP);
  } catch {
    /* Nuốt. */
  }
};

/**
 * Đọc **bản clone** từng mẩu, tối đa {@link MAX_BODY_READ_BYTES} byte; vượt thì huỷ nhánh của tap
 * (nhánh của app không bị đụng — `tee` chỉ huỷ nguồn khi cả hai nhánh huỷ). Gọi `done` đúng một lần;
 * không bao giờ để lọt promise reject ra ngoài (lọt là thành "promise reject không ai bắt" của app).
 */
const readCapped = (response: ResponseLike, done: (read: BodyRead) => void) => {
  let finished = false;
  const once = (read: BodyRead) => {
    if (finished) return;
    finished = true;
    done(read);
  };

  try {
    const stream = response.body as { getReader?: () => ReaderLike } | null | undefined;
    if (stream === null) {
      once(NO_BODY);
      return;
    }
    if (typeof stream?.getReader !== 'function') {
      once(UNREADABLE);
      return;
    }
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    const step = (): void => {
      reader
        .read()
        .then(
          ({ done: end, value }) => {
            if (end) {
              once(decode(chunks, size));
              return;
            }
            const bytes = asBytes(value);
            if (!bytes) {
              cancelQuietly(reader);
              once(UNREADABLE);
              return;
            }
            size += bytes.byteLength;
            if (size > MAX_BODY_READ_BYTES) {
              cancelQuietly(reader);
              once({ skipped: 'tooLarge' });
              return;
            }
            chunks.push(bytes);
            step();
          },
          (error: unknown) => once({ failed: error }),
        )
        .then(undefined, () => once(UNREADABLE));
    };
    step();
  } catch {
    once(UNREADABLE);
  }
};
