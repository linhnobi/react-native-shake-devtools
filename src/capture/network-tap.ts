import { logBuffer } from './log-buffer';
import { fullBodies } from './full-body-store';
import { NETWORK_ABORTED, type BodySkip, type NetworkEntry } from './log-entry';
import { truncate } from './redact';

/** Số ký tự tối đa giữ lại cho mỗi thân request/response. */
export const DEFAULT_BODY_LIMIT = 4000;

/**
 * Trần **đọc** thân response không phải chuỗi (Blob của `fetch`, ArrayBuffer, JSON đã parse): to
 * hơn ⇒ không đọc, dòng ghi `responseBodySkipped: 'tooLarge'`.
 *
 * Đọc rồi mới cắt (`bodyLimit` cho vòng đệm, `FULL_BODY_LIMIT` cho kho đầy đủ — cùng luật với thân
 * chuỗi), nên trần này chỉ chặn một việc: kéo một thân vài chục MB từ native sang JS chỉ để giữ 4 KB.
 * 1 MB byte ≥ 256 nghìn ký tự của kho đầy đủ kể cả khi toàn chữ có dấu.
 */
export const MAX_BODY_READ_BYTES = 1_000_000;

/**
 * Nhãn lỗi tầng vận chuyển ghi vào `NetworkEntry.error`. Là **dữ liệu** trung lập ngôn ngữ (cùng
 * lý do với `REDACTED`): nó đi theo dòng nhật ký ra ticket/chat.
 */
type Failure = 'network' | 'timeout' | typeof NETWORK_ABORTED;

/**
 * Sự kiện kết cục của XHR → nhãn lỗi (`null` = xong bình thường). Cả RN (`setReadyState(DONE)`)
 * lẫn spec đều bắn đúng **một** trong bốn sự kiện này, **trước** `loadend`.
 *
 * Phải nghe chúng chứ không đoán theo `status === 0`: RN giữ nguyên `status` đã nhận khi request
 * hỏng **sau** lúc có header (timeout giữa lúc tải thân, mạng rớt giữa chừng) — đoán theo status thì
 * dòng đó hiện `200` kèm thân là câu báo lỗi của native (`_response = error`).
 *
 * ⚠️ Cố ý KHÔNG nghe `readystatechange`/`progress`: `addEventListener` của RN thấy hai loại đó là
 * bật `incrementalEvents` — native bắn thêm một sự kiện qua cầu cho mỗi mẩu dữ liệu.
 */
const OUTCOME_EVENTS: ReadonlyArray<
  readonly ['load' | 'error' | 'timeout' | 'abort', Failure | null]
> = [
  ['load', null],
  ['error', 'network'],
  ['timeout', 'timeout'],
  ['abort', NETWORK_ABORTED],
];

/** Bản ghi cho **một lần `open`** của một instance XHR, cất ngoài `this` để không đụng thuộc tính của ai. */
interface Tracked {
  method: string;
  url: string;
  headers: Record<string, string>;
  /**
   * Chốt dòng nhật ký của lần `send` thuộc lần `open` này. Vắng ⇒ chưa `send`. Có rồi thì `send`
   * lần nữa không ghi thêm dòng (hàm gốc sẽ ném), và header đặt sau đó không được ghi (không đi
   * cùng request — native đã nhận bản sao lúc `send`).
   */
  settle?: (failure?: string) => void;
}

/** Phần của XHR mà tap chạm tới — đủ hẹp để XHR giả trong test và bản của RN cùng thoả. */
type Xhr = Pick<XMLHttpRequest, 'status' | 'addEventListener' | 'removeEventListener'>;

const NOOP = () => undefined;

let installed = false;
let uninstall: () => void = NOOP;

/**
 * Header đánh dấu request **của chính công cụ** (lớp phòng thủ thứ hai, ngoài `runUncaptured`).
 *
 * `runUncaptured` chỉ phủ phần **đồng bộ**: app hay SDK giám sát bọc `fetch` toàn cục rồi `await`
 * trước khi gọi `fetch` thật thì `open` rơi ra ngoài phạm vi, request mang token đi vào nhật ký. Tap
 * thấy header này (so tên **không phân biệt hoa thường**) trên một XHR **trước `send`** thì ngừng
 * theo dõi XHR đó — không dòng nào được ghi, kể cả header `Authorization` đã đặt trước đó.
 */
export const INTERNAL_REQUEST_HEADER = 'X-Shake-Devtools';
/** Giá trị mà connector gắn cho {@link INTERNAL_REQUEST_HEADER}. Tap chỉ xét **tên** header. */
export const INTERNAL_REQUEST_HEADER_VALUE = 'internal';

/** `true` khi đang ở trong `runUncaptured`: mọi XHR `open` lúc này là của chính tool. */
let uncaptured = false;

/**
 * **Chức năng:** chạy `fn` đồng bộ trong một phạm vi mà `tapNetwork` **không ghi** bất kỳ XHR nào
 * được `open` — để request của chính công cụ (mang token của Jira/Slack/Lark) không bao giờ vào
 * nhật ký, `LogStore` hay bug report (spec 5.5).
 *
 * ## Cách hoạt động
 *
 * Quyết định bỏ qua được **chốt ở `open()`**: XHR mở trong phạm vi này không được tạo bản ghi
 * `tracked` (và bản ghi cũ nếu có thì bị chốt/xoá), nên `setRequestHeader`, `send`, listener kết
 * cục và đọc thân response của XHR đó đều bị bỏ qua hoàn toàn, kể cả khi `send` chạy sau khi `fn`
 * đã xong. `fetch` của RN là polyfill whatwg trên XHR và gọi `open`/`send` đồng
 * bộ ngay trong executor của Promise, nên `runUncaptured(() => fetch(...))` phủ đúng XHR mà `fetch`
 * tạo ra. ⚠️ Phạm vi chỉ kéo dài **đồng bộ**: `fn` trả Promise thì phần sau `await` đã nằm ngoài.
 * `fn` lồng nhau hoặc ném đều trả cờ về đúng giá trị cũ (`try/finally`).
 *
 * Không cài tap thì hàm vẫn chạy `fn` bình thường (cờ không có người đọc).
 *
 * **Input:** `fn` — hàm đồng bộ (thường là `() => fetch(url, init)`).
 * **Output:** giá trị `fn` trả về; lỗi `fn` ném được ném lại nguyên.
 *
 * @example
 * ```ts
 * const res = await runUncaptured(() => fetch('https://acme.atlassian.net/rest/api/3/issue', init));
 * // Không có dòng nào của request này trong logBuffer.
 * ```
 *
 * **Unit test:** `network-tap.test.ts` — 5 case: XHR mở trong phạm vi bị bỏ qua dù `send` chạy sau,
 * request vẫn đi (3 hàm gốc vẫn được gọi) · `open` lại ngoài phạm vi thì ghi trở lại · trả giá trị,
 * lồng nhau, `fn` ném đều khôi phục · (XHR thật của RN) `runUncaptured(() => fetch)` không ghi dòng
 * nào và không đọc thân · `fetch` ngay sau đó vẫn được ghi, kể cả khi `fn` đã ném.
 */
export const runUncaptured = <T>(fn: () => T): T => {
  const previous = uncaptured;
  uncaptured = true;
  try {
    return fn();
  } finally {
    uncaptured = previous;
  }
};

/** Đang ở trong `runUncaptured` không — để `fetch-tap` theo đúng cùng một phạm vi với tap XHR. */
export const isUncaptured = (): boolean => uncaptured;

/**
 * **Chức năng:** bắt mọi request HTTP của app (axios **và** `fetch` trần) vào vòng đệm nhật ký.
 *
 * ## 🔴 Vì sao TỰ BỌC `XMLHttpRequest` mà KHÔNG dùng `XHRInterceptor` của RN
 *
 * `XHRInterceptor` giữ **một chỗ duy nhất** cho mỗi callback (`let openCallback` trong
 * `react-native/src/private/devsupport/devmenu/elementinspector/XHRInterceptor.js`) — gọi
 * `setOpenCallback` lần hai là **ghi đè** lần một, không có hàng đợi, không có getter để nối
 * chuỗi. Mà nhiều app đã có một chủ: Reactotron gọi `.use(networking())` và được nạp mỗi khi
 * `__DEV__` — **kể cả bản nhúng sẵn JS bundle `--dev true`**, đúng bản giao tester mà công
 * cụ này sinh ra để phục vụ. Dùng chung cửa đó nghĩa là ai chạy sau thì
 * thắng, và bên thua **im lặng** không bắt được gì.
 *
 * Bọc thẳng `XMLHttpRequest.prototype` thì chồng được: bản vá gọi xuống hàm đang có sẵn
 * (chính là hàm mà `XHRInterceptor` đã bọc), nên cả hai cùng chạy.
 *
 * Bắt ở tầng XHR cũng là chỗ bắt được **cả hai** khách: adapter mặc định của axios dùng XHR,
 * còn `fetch` của RN là polyfill whatwg dựng trên XHR. ⚠️ `expo/fetch` (mặc định là `fetch` toàn
 * cục từ Expo SDK 56) thì **không** qua XHR — phần đó do `tapFetch` (`fetch-tap.ts`) lo, và
 * `startCapture` bật cả hai. Gọi riêng `tapNetwork` thì không có `fetch` native.
 *
 * ## Không được "nói dối": dòng nào đã ghi thì phải chốt, và chốt đúng
 *
 * - Ghi dòng **chỉ khi** hàm gốc sắp gửi thật (`readyState` là OPENED, chưa `send` lần nào cho lần
 *   `open` này); hàm gốc vẫn ném thì chốt dòng với lý do — không để dòng "đang bay" không bao giờ xong.
 * - `open`/`setRequestHeader` ghi **sau** khi hàm gốc chạy xong: `open` của RN ném khi xhr đang dở,
 *   ghi trước thì dòng mang URL của lần `open` hỏng trong khi request thật đi URL cũ.
 * - Mỗi lần `send` chốt **một lần** rồi gỡ listener: xhr dùng lại (`abort` rồi `open` lại) không
 *   làm listener cũ đè kết quả của request mới lên dòng cũ.
 * - Kết cục đọc từ sự kiện (`OUTCOME_EVENTS`), không đoán từ `status`.
 * - Thân có mà không ghi được (FormData, nhị phân, quá lớn, đọc hỏng) ⇒ ghi **lý do**
 *   (`requestBodySkipped`/`responseBodySkipped`) để màn không nói "Không có thân". Thân response của
 *   `fetch` (Blob) đọc bất đồng bộ bằng `FileReader` riêng — xem `readResponse`.
 *
 * **Input:** `bodyLimit` — số ký tự giữ lại cho mỗi thân.
 * **Output:** hàm **gỡ vá**. Gọi lần hai khi chưa gỡ ⇒ no-op (trả hàm gỡ của lần một). Request đang
 * bay lúc gỡ vẫn được chốt khi xong.
 *
 * @example
 * ```ts
 * const stop = tapNetwork(4000);
 * await fetch('https://x/y');   // một dòng 'network' vào nhật ký, có status + thời lượng
 * stop();
 * // Ca biên: request hết giờ ⇒ dòng vẫn có, `error: 'timeout'`, `status` bỏ trống.
 * ```
 *
 * **Unit test:** `network-tap.test.ts` — 65 case, ba nhóm (case của `runUncaptured` xem ở JSDoc của nó):
 * - `tapNetwork` (XHR giả tối giản) — 15 case: ghi dòng ngay lúc `send` (chưa có status) · điền
 *   `status`/`durationMs` khi xong · lỗi mạng điền `error` · header `Authorization` giữ **thô**
 *   trong buffer (che là việc của chỗ xuất — `redact.ts`) · thân vượt hạn mức bị cắt · `open`/`send`
 *   gốc vẫn được gọi · `stop()` khôi phục đúng ba hàm gốc · XHR kiểu spec cho `open` lại khi đang
 *   bay ⇒ dòng cũ chốt `abort`, dòng mới đúng URL mới · buffer ném lúc ghi/chốt không làm hỏng app ·
 *   `load` với status 0 (file cục bộ) không bị gọi là lỗi mạng · 3 case `runUncaptured` · header `X-Shake-Devtools` (mọi cách viết hoa) ⇒ không dòng nào, token không lọt buffer · header khác vẫn được ghi.
 * - `XMLHttpRequest` thật của RN 0.86 (native giả) — 43 case: 204 · 304 không thân · thân FormData
 *   của RN ghi `formData` · FormData kiểu spec (`entries()` trả iterator) không bị đọc · thân
 *   `ArrayBuffer` · `Uint8Array` · `Blob` ghi `binary` · `abort()` · `abort()` trước `send` rồi `send`
 *   ⇒ không có dòng ma · timeout trước khi có header · timeout giữa lúc tải thân · lỗi mạng · mạng rớt
 *   giữa thân · redirect giữ URL gốc · 12 tổ hợp `responseType` × `content-type` (blob + json · text ·
 *   +json đọc được; blob ảnh · không content-type ⇒ `binary`; blob trên trần ⇒ `tooLarge`; FileReader
 *   lỗi ⇒ `unreadable`; blob 0 byte ⇒ không có thân; json ⇒ stringify; json hỏng ⇒ `unreadable`;
 *   arraybuffer json ⇒ giải mã; arraybuffer octet-stream ⇒ `binary`) · thân Blob lớn bị cắt kèm cờ ·
 *   thân Blob vượt cả trần kho đầy đủ · thân response lớn bị cắt
 *   và giữ bản đầy đủ · header khác hoa thường ⇒ lần sau thay lần trước · header đặt sau `send` không
 *   vào dòng · nhiều request đồng thời xong ngược thứ tự · request gửi trước `startCapture` · `open`
 *   trước, `send` sau `startCapture` · `open` hai lần (RN ném) · `abort` rồi `open` lại trên cùng xhr ·
 *   `send` khi chưa `open` · `send` hai lần · listener của app (`addEventListener` lẫn `on*`) vẫn
 *   chạy · tap không bật `incrementalEvents` · callback của app ném · `stop()` khi request đang bay ·
 *   hàm gốc ném ⇒ dòng chốt kèm lý do.
 * - `fetch` (whatwg-fetch trên XHR thật của RN) — 7 case: POST FormData · huỷ bằng
 *   `AbortController` · thân JSON (Blob) được ghi và `res.text()` của app vẫn ra đủ · ảnh ⇒ `binary`,
 *   không đọc Blob · lỗi mạng · 2 case `runUncaptured`.
 */
export const tapNetwork = (bodyLimit = DEFAULT_BODY_LIMIT): (() => void) => {
  if (installed) return uninstall;

  const XHR = XMLHttpRequest.prototype as unknown as Record<string, unknown>;
  const originalOpen = XHR.open as (...a: unknown[]) => unknown;
  const originalSend = XHR.send as (...a: unknown[]) => unknown;
  const originalSetHeader = XHR.setRequestHeader as (
    ...a: unknown[]
  ) => unknown;

  /* WeakMap chứ không phải thuộc tính gắn lên `this`: không thêm khoá lạ vào object của
     người khác, và bản ghi tự biến mất cùng instance XHR. */
  const tracked = new WeakMap<object, Tracked>();

  XHR.open = function patchedOpen(this: object, ...args: unknown[]) {
    /* Hàm gốc chạy TRƯỚC: nó ném (RN: xhr chưa về UNSENT) thì không ghi gì, bản ghi của lần
       `open` đang có hiệu lực được giữ nguyên. */
    const result = originalOpen.apply(this, args);
    try {
      /* Theo spec, `open` lại một xhr đang bay là huỷ nó mà KHÔNG bắn `loadend` ⇒ chốt dòng cũ ở
         đây. Ở RN dòng này no-op: `open` chỉ qua được khi xhr đã về UNSENT (sau `abort`), lúc đó
         dòng cũ đã chốt. */
      tracked.get(this)?.settle?.(NETWORK_ABORTED);
      if (uncaptured) {
        /* Request của chính tool (`runUncaptured`): không có bản ghi ⇒ `setRequestHeader`, `send`,
           listener và đọc thân đều bỏ qua XHR này (chúng chỉ hoạt động khi `tracked.get` có bản ghi). */
        tracked.delete(this);
      } else {
        tracked.set(this, {
          method: String(args[0] ?? '').toUpperCase(),
          url: String(args[1] ?? ''),
          headers: {},
        });
      }
    } catch {
      /* Nuốt — xem ghi chú ở `console-tap`. */
    }
    return result;
  };

  XHR.setRequestHeader = function patchedSetHeader(
    this: object,
    ...args: unknown[]
  ) {
    const result = originalSetHeader.apply(this, args);
    try {
      const t = tracked.get(this);
      if (t && !t.settle) {
        const name = String(args[0] ?? '');
        if (name.toLowerCase() === INTERNAL_REQUEST_HEADER.toLowerCase()) {
          /* Request của chính tool: bỏ bản ghi (kèm mọi header đã gom) ⇒ `send` không ghi dòng. */
          tracked.delete(this);
        } else {
          setHeader(t.headers, name, String(args[1] ?? ''));
        }
      }
    } catch {
      /* Nuốt. */
    }
    return result;
  };

  XHR.send = function patchedSend(this: object, ...args: unknown[]) {
    let settle: Tracked['settle'];
    try {
      const t = tracked.get(this);
      if (t && !t.settle && isOpened(this)) {
        settle = begin(this as unknown as Xhr, t, args[0], bodyLimit);
      }
    } catch {
      /* Nuốt — công cụ gỡ lỗi hỏng không được làm hỏng app đang gỡ. */
    }
    try {
      return originalSend.apply(this, args);
    } catch (error) {
      /* Hàm gốc ném ⇒ request không rời máy và sẽ không có `loadend`: chốt ngay, kèm lý do. */
      settle?.(describeThrow(error));
      throw error;
    }
  };

  /* So với CHÍNH NÓ, không với cờ chung — xem ghi chú cùng chỗ ở `console-tap.ts`: hàm gỡ của
     một lần vá cũ không được gỡ lần vá mới. */
  const stop = () => {
    if (uninstall !== stop) return;
    XHR.open = originalOpen;
    XHR.send = originalSend;
    XHR.setRequestHeader = originalSetHeader;
    installed = false;
    uninstall = NOOP;
  };
  uninstall = stop;
  installed = true;
  return stop;
};

/**
 * Ghi dòng "đang bay" cho một lần `send` và móc listener để chốt nó.
 *
 * Listener móc **trước** khi ghi dòng: `logBuffer.push` lưu dòng rồi mới báo listener của buffer,
 * nên listener của buffer ném thì dòng đã nằm trong buffer — móc sau thì dòng đó không bao giờ chốt.
 *
 * Trả hàm chốt: gọi không tham số ⇒ đọc kết cục từ xhr; truyền nhãn ⇒ chốt là lỗi với nhãn đó.
 * Chỉ có tác dụng **một lần**.
 */
const begin = (
  xhr: Xhr,
  t: Tracked,
  body: unknown,
  bodyLimit: number,
): ((failure?: string) => void) => {
  const id = logBuffer.nextId();
  const startedAt = Date.now();
  /* `undefined` = chưa thấy sự kiện kết cục nào (XHR không bắn chúng) ⇒ đoán theo status như cũ. */
  let outcome: Failure | null | undefined;
  let done = false;

  const outcomeListeners = OUTCOME_EVENTS.map(
    ([type, failure]) => [type, () => (outcome = failure)] as const,
  );

  /*
    `loadend` chứ không phải `load`: nó bắn cho CẢ bốn kết cục — xong, lỗi, hết giờ, huỷ. Dùng
    `load` thì request hỏng mạng nằm lại trong nhật ký mãi mãi ở trạng thái "đang bay",
    mà đó chính là ca người ta mở nhật ký ra để xem.
  */
  const onLoadEnd = () => {
    if (outcome !== undefined) settle(outcome ?? undefined);
    else settle(xhr.status === 0 ? 'network' : undefined);
  };

  const settle = (failure?: string) => {
    if (done) return;
    done = true;
    try {
      xhr.removeEventListener('loadend', onLoadEnd);
      outcomeListeners.forEach(([type, fn]) => xhr.removeEventListener(type, fn));
    } catch {
      /* Nuốt — XHR không gỡ được listener thì `done` vẫn chặn lần chốt thứ hai. */
    }
    try {
      finish(xhr, id, startedAt, failure, bodyLimit);
    } catch {
      /* Nuốt — listener của buffer ném không được lan vào vòng phát sự kiện của XHR. */
    }
  };

  t.settle = settle;
  xhr.addEventListener('loadend', onLoadEnd);
  outcomeListeners.forEach(([type, fn]) => xhr.addEventListener(type, fn));

  try {
    /*
      Ghi **thô**: chỉ cắt cho vừa bộ nhớ, KHÔNG che. Che là việc của chỗ xuất — xem bảng
      chính sách ở đầu `redact.ts`. Ghi đã che ở đây thì `toCurl` không bao giờ dựng được
      một lệnh chạy được nữa, vì dữ liệu gốc đã mất.

      Thân không phải chuỗi (FormData, Blob, ArrayBuffer) ⇒ bỏ trống, KHÔNG đọc vào (đọc
      FormData là chỗ các tool khác crash), nhưng ghi LÝ DO để màn không nói "Không có thân".
    */
    const rawReq = typeof body === 'string' ? body : undefined;
    const req = truncate(rawReq, bodyLimit);
    /* Thân vượt hạn mức ⇒ giữ bản đầy đủ ở kho riêng (20 gần nhất + lỗi), xem `full-body-store`. */
    if (req.truncated && rawReq) fullBodies.put(id, 'request', rawReq);
    logBuffer.push({
      id,
      kind: 'network',
      at: startedAt,
      method: t.method,
      url: t.url,
      requestHeaders: { ...t.headers },
      requestBody: req.text,
      requestTruncated: req.truncated,
      requestBodySkipped: requestSkip(body),
    });
  } catch {
    /* Nuốt. */
  }
  return settle;
};

/**
 * Điền kết cục vào dòng `id`. `failure` có giá trị ⇒ lỗi tầng vận chuyển, không status/thân.
 *
 * Thân Blob (mọi `fetch` của RN) đọc **bất đồng bộ**: status + thời lượng vào ngay, thân vào sau
 * vài ms khi `FileReader` xong. Lần đọc này là một `FileReader` riêng trên cùng Blob — không tiêu
 * thụ, không chặn lần đọc của app.
 */
const finish = (
  xhr: Xhr,
  id: number,
  startedAt: number,
  failure: string | undefined,
  bodyLimit: number,
) => {
  const durationMs = Date.now() - startedAt;
  if (failure !== undefined) {
    logBuffer.patch(id, {
      status: undefined,
      durationMs,
      responseBody: undefined,
      responseTruncated: false,
      responseBodySkipped: undefined,
      error: failure,
    });
    return;
  }
  const status = xhr.status;
  const read = readResponse(xhr);
  const body: Partial<NetworkEntry> =
    'text' in read
      ? responseFields(id, read.text, bodyLimit)
      : { responseBody: undefined, responseTruncated: false };
  if (status >= 400) fullBodies.markError(id);
  logBuffer.patch(id, {
    status,
    durationMs,
    ...body,
    responseBodySkipped: 'skipped' in read ? read.skipped : undefined,
    error: undefined,
  });

  if ('blob' in read) {
    readBlobText(read.blob, (text) => {
      try {
        if (text === undefined) {
          logBuffer.patch(id, { responseBodySkipped: 'unreadable' });
          return;
        }
        const fields = responseFields(id, text, bodyLimit);
        /* Kho đầy đủ chỉ giữ request lỗi nếu đã có thân lúc đánh dấu — đánh dấu lại sau khi có. */
        if (status >= 400) fullBodies.markError(id);
        logBuffer.patch(id, fields);
      } catch {
        /* Nuốt. */
      }
    });
  }
};

/** Cắt thân response cho vòng đệm; vượt hạn mức ⇒ bản đầy đủ vào kho riêng. */
export const responseFields =(id: number, raw: string | undefined, bodyLimit: number) => {
  const res = truncate(raw, bodyLimit);
  if (res.truncated && raw) fullBodies.put(id, 'response', raw);
  return { responseBody: res.text, responseTruncated: res.truncated };
};

/**
 * Ghi header theo đúng luật `setRequestHeader` của RN: tên **không phân biệt hoa thường**, lần sau
 * **thay** lần trước (RN hạ chữ thường làm khoá). Giữ hai khoá `content-type` + `Content-Type` thì
 * màn chi tiết và lệnh curl có hai header trong khi request thật chỉ mang một. Tên hiện theo cách
 * viết của lần gọi cuối.
 */
export const setHeader = (headers: Record<string, string>, name: string, value: string) => {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) delete headers[key];
  }
  headers[name] = value;
};

/**
 * `send` của RN (và spec) chỉ gửi khi `readyState` là OPENED (1). XHR không có `readyState` (bản
 * giả tối giản) ⇒ coi như gửi được.
 */
const isOpened = (xhr: object): boolean => {
  const state = (xhr as { readyState?: unknown }).readyState;
  return typeof state !== 'number' || state === 1;
};

/** Lý do hàm `send` gốc ném, làm nhãn lỗi của dòng. */
const describeThrow = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message || 'send failed';
};

/**
 * Đọc thân phản hồi mà **không** ném.
 *
 * `responseText` là getter: với `responseType` khác `''`/`'text'` (`'json'`, `'blob'`,
 * `'arraybuffer'`) nó ném chứ không trả rỗng. App có tải file là đủ để dính — nên bọc `try`.
 */
const readResponseText = (xhr: object): string | undefined => {
  try {
    const text = (xhr as { responseText?: unknown }).responseText;
    return typeof text === 'string' ? text : undefined;
  } catch {
    return undefined;
  }
};

/** Phần của Blob mà tap đọc — Blob của RN và của spec đều có. */
interface BlobLike {
  readonly size: number;
  readonly type?: string;
}

interface FileReaderLike {
  result: unknown;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  readAsText: (blob: BlobLike) => void;
}

/** Kết quả đọc thân response: chuỗi (có thể rỗng) · lý do không ghi · Blob chờ đọc bất đồng bộ. */
type ResponseRead =
  | { readonly text: string | undefined }
  | { readonly skipped: BodySkip }
  | { readonly blob: BlobLike };

const UNREADABLE: ResponseRead = { skipped: 'unreadable' };

/**
 * Kiểu nội dung là **chữ** ⇒ đáng đọc: `text/*`, `…/json` · `…+json`, `…/xml` · `…+xml`, form
 * urlencoded, GraphQL, JavaScript, NDJSON. Còn lại (ảnh, PDF, octet-stream, vắng header) coi là nhị phân.
 */
const TEXTUAL_MIME =
  /^text\/|[/+](json|xml)$|^application\/(x-www-form-urlencoded|graphql|javascript|ecmascript|x-ndjson)$/;

export const isTextual = (contentType: string | undefined): boolean =>
  !!contentType && TEXTUAL_MIME.test(contentType.split(';')[0].trim().toLowerCase());

const responseHeader = (xhr: object, name: string): string | undefined => {
  try {
    const value = (xhr as { getResponseHeader?: (n: string) => unknown }).getResponseHeader?.(name);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Thân response theo `responseType`:
 * - `''`/`'text'` — `responseText`, như cũ.
 * - `'json'` — `JSON.stringify(xhr.response)`: parse được tức là chữ, không cần xét `content-type`.
 *   Parse hỏng (`null`) ⇒ `'unreadable'`; `content-length` vượt trần ⇒ `'tooLarge'`.
 * - `'blob'` (mọi `fetch` của RN) — chỉ đọc khi `content-type` là chữ và ≤ {@link MAX_BODY_READ_BYTES};
 *   đọc bất đồng bộ ở `finish`.
 * - `'arraybuffer'` — cùng luật với Blob, giải mã UTF-8 bằng `TextDecoder` (thiếu ⇒ `'unreadable'`).
 * - kiểu khác (`'document'`) ⇒ `'unreadable'`.
 *
 * Thân rỗng (204, Blob 0 byte) ⇒ `{ text: undefined }`: thật sự không có thân, không phải "không bắt được".
 */
const readResponse = (xhr: object): ResponseRead => {
  const type = (xhr as { responseType?: unknown }).responseType;
  if (type === undefined || type === '' || type === 'text') return { text: readResponseText(xhr) };
  try {
    const response = (xhr as { response?: unknown }).response;
    const contentType = responseHeader(xhr, 'content-type');

    if (type === 'json') {
      if (response === null || response === undefined) return UNREADABLE;
      if (Number(responseHeader(xhr, 'content-length')) > MAX_BODY_READ_BYTES) {
        return { skipped: 'tooLarge' };
      }
      const text = JSON.stringify(response);
      return typeof text === 'string' ? { text } : UNREADABLE;
    }

    if (type === 'blob') {
      if (typeof response !== 'object' || response === null) return UNREADABLE;
      const blob = response as BlobLike;
      if (typeof blob.size !== 'number') return UNREADABLE;
      if (blob.size === 0) return { text: undefined };
      if (!isTextual(contentType ?? blob.type)) return { skipped: 'binary' };
      if (blob.size > MAX_BODY_READ_BYTES) return { skipped: 'tooLarge' };
      return { blob };
    }

    if (type === 'arraybuffer') {
      if (Object.prototype.toString.call(response) !== '[object ArrayBuffer]') return UNREADABLE;
      const buffer = response as ArrayBuffer;
      if (buffer.byteLength === 0) return { text: undefined };
      if (!isTextual(contentType)) return { skipped: 'binary' };
      if (buffer.byteLength > MAX_BODY_READ_BYTES) return { skipped: 'tooLarge' };
      const Decoder = (globalThis as { TextDecoder?: new () => { decode: (b: Uint8Array) => string } })
        .TextDecoder;
      return typeof Decoder === 'function'
        ? { text: new Decoder().decode(new Uint8Array(buffer)) }
        : UNREADABLE;
    }
  } catch {
    /* Getter `response` ném (vd Blob hỏng) ⇒ rơi xuống dưới. */
  }
  return UNREADABLE;
};

/**
 * Đọc Blob thành chữ bằng `FileReader` **riêng** (global, như `fetch` của RN dùng). Gọi `done` đúng
 * một lần: chữ, hoặc `undefined` khi thiếu `FileReader` / đọc lỗi. Không giữ Blob sau khi xong.
 */
const readBlobText = (blob: BlobLike, done: (text: string | undefined) => void) => {
  let finished = false;
  const once = (text: string | undefined) => {
    if (finished) return;
    finished = true;
    done(text);
  };
  try {
    const Reader = (globalThis as unknown as { FileReader?: new () => FileReaderLike }).FileReader;
    if (typeof Reader !== 'function') {
      once(undefined);
      return;
    }
    const reader = new Reader();
    reader.onload = () => once(typeof reader.result === 'string' ? reader.result : undefined);
    reader.onerror = () => once(undefined);
    reader.readAsText(blob);
  } catch {
    once(undefined);
  }
};

/**
 * Lý do thân **request** không được ghi. Không đọc vào thân — chỉ xét kiểu bằng `instanceof`/
 * `typeof` (không chạm thuộc tính nào của FormData). Chuỗi hoặc không có thân ⇒ `undefined`.
 */
export const requestSkip = (body: unknown): BodySkip | undefined => {
  if (body === undefined || body === null || typeof body === 'string') return undefined;
  const g = globalThis as { FormData?: unknown; Blob?: unknown };
  if (typeof g.FormData === 'function' && body instanceof g.FormData) return 'formData';
  if (
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof g.Blob === 'function' && body instanceof g.Blob)
  ) {
    return 'binary';
  }
  return 'unreadable';
};
