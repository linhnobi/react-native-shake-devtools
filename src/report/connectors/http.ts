import {
  INTERNAL_REQUEST_HEADER,
  INTERNAL_REQUEST_HEADER_VALUE,
  runUncaptured,
} from '../../capture/network-tap';
import { REDACTED } from '../../capture/redact';
import type { DevToolsLocale } from '../../i18n/types';
import { ConnectorError, type ConnectorContext } from './types';

/** Timeout mặc định cho **mỗi** request của connector (số do kế hoạch chốt). */
export const DEFAULT_CONNECTOR_TIMEOUT_MS = 30_000;

/** Đoạn trích thân response đưa vào `message` lỗi: tối đa chừng này ký tự. */
const BODY_EXCERPT_MAX = 300;

/** Bí mật ngắn hơn mức này không bị xoá — xoá chuỗi 1-3 ký tự là phá nát mọi thông điệp. */
const MIN_SECRET_LENGTH = 4;

/**
 * Xoá mọi bí mật khỏi `text`. Mỗi bí mật xoá cả dạng thô lẫn dạng JSON-escape (thân response của
 * Jira/Slack là JSON nên `"` hay `\` trong bí mật nằm đó ở dạng đã escape). Bí mật dài xoá trước để
 * bí mật là chuỗi con của bí mật khác không để lại đuôi.
 */
const scrub = (text: string, secrets: readonly string[]): string => {
  const needles = new Set<string>();
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) continue;
    needles.add(secret);
    needles.add(JSON.stringify(secret).slice(1, -1));
  }
  return [...needles]
    .sort((a, b) => b.length - a.length)
    .reduce((acc, needle) => acc.split(needle).join(REDACTED), text);
};

/** `Retry-After`: số giây nguyên hoặc ngày HTTP ⇒ ms; vắng/hỏng ⇒ `undefined`. */
const parseRetryAfter = (value: string | null | undefined): number | undefined => {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  if (!/[a-z]/i.test(text)) return undefined;
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
};

/** Tên trường đầu tiên trong `{"errors":{"<trường>":"…"}}` (kiểu Jira); không có ⇒ `undefined`. */
const failedField = (body: string): string | undefined => {
  try {
    const errors = (JSON.parse(body) as { errors?: unknown } | null)?.errors;
    if (typeof errors !== 'object' || errors === null || Array.isArray(errors)) return undefined;
    return Object.keys(errors)[0];
  } catch {
    return undefined;
  }
};

/**
 * **Chức năng:** đổi một phản hồi HTTP lỗi thành `ConnectorError` theo nhóm cố định (spec 5.4).
 *
 * | status | `kind` | ghi chú |
 * |---|---|---|
 * | 401 | `auth` | |
 * | 403 | `permission` | |
 * | 400, 422 | `validation` | `field` = khoá đầu tiên của `errors` trong thân JSON, nếu có |
 * | 429 | `rate-limit` | `retryAfterMs` từ `Retry-After` (giây hoặc ngày HTTP) |
 * | còn lại | `unknown` | |
 *
 * `message` = `HTTP <status>: <đoạn trích thân>`. Mọi bí mật dài ≥ 4 ký tự trong `opts.secrets` bị
 * thay bằng `<redacted>` ở `message` lẫn `field` — **trước** khi cắt đoạn trích 300 ký tự, để bí mật
 * nằm vắt qua mốc cắt không lộ nửa đầu. Server hay lặp lại token trong thông báo lỗi.
 *
 * **Input:** `status` · `body` (thân response dạng chuỗi) · `opts.retryAfter` (giá trị header) ·
 * `opts.secrets` (token, App Secret, giá trị header… của kết nối đang gọi).
 * **Output:** `ConnectorError` (không ném — người gọi `throw`).
 *
 * @example
 * ```ts
 * errorFromStatus(429, 'slow', { retryAfter: '7' }); // kind 'rate-limit', retryAfterMs 7000
 * errorFromStatus(401, `bad ${token}`, { secrets: [token] }).message; // 'HTTP 401: bad <redacted>'
 * ```
 *
 * **Unit test:** `http.test.ts` › `errorFromStatus` — 10 case: 401/403/500 · 400 kiểu Jira kèm
 * `field` · 400 không có `errors` · 429 `Retry-After: 7` · `Retry-After` ngày HTTP/hỏng/vắng ·
 * token bị cắt khỏi `message` · bí mật bị xoá khỏi `field` và ở dạng JSON-escape · bí mật < 4 ký tự
 * giữ nguyên · đoạn trích tối đa 300 · bí mật vắt qua mốc cắt.
 */
export const errorFromStatus = (
  status: number,
  body: string,
  opts?: { retryAfter?: string | null; secrets?: readonly string[] },
): ConnectorError => {
  const secrets = opts?.secrets ?? [];
  const clean = scrub(body, secrets).trim();
  const excerpt =
    clean.length > BODY_EXCERPT_MAX ? `${clean.slice(0, BODY_EXCERPT_MAX)}…` : clean;
  const message = `HTTP ${status}${excerpt ? `: ${excerpt}` : ''}`;

  if (status === 401) return new ConnectorError('auth', message, { status });
  if (status === 403) return new ConnectorError('permission', message, { status });
  if (status === 400 || status === 422) {
    const field = failedField(body);
    return new ConnectorError('validation', message, {
      status,
      field: field === undefined ? undefined : scrub(field, secrets),
    });
  }
  if (status === 429) {
    return new ConnectorError('rate-limit', message, {
      status,
      retryAfterMs: parseRetryAfter(opts?.retryAfter),
    });
  }
  return new ConnectorError('unknown', message, { status });
};

/**
 * **Chức năng:** dựng `ConnectorContext` — `fetch` của connector. Khác `fetch` trần ở ba điểm:
 *
 * 1. **Không vào nhật ký** (spec 5.5, request mang token), hai lớp độc lập: gọi qua `runUncaptured`,
 *    **và** luôn gắn header `X-Shake-Devtools: internal` để `network-tap` bỏ qua XHR đó dù `fetch`
 *    toàn cục bị app/SDK bọc và `await` trước khi mở XHR (khi đó `runUncaptured` không phủ tới).
 * 2. **Timeout** `timeoutMs` bằng `AbortController`. Hết giờ ⇒ `ConnectorError('uncertain')`: request
 *    **đã đi** mà không thấy phản hồi, không biết server đã xử lý chưa ⇒ không được tự gửi lại
 *    (spec 5.4.3). Timer cũng ngắt promise nếu `fetch` phớt lờ `signal`.
 * 3. **Lỗi không có phản hồi** (`TypeError: Network request failed`: mất mạng, DNS, từ chối kết nối)
 *    ⇒ `ConnectorError('network')` — **rất có thể** chưa tới server nên hàng đợi tự gửi lại. ⚠️ Rủi
 *    ro còn lại: RN báo cả "kết nối bị ngắt giữa chừng lúc đang POST" bằng đúng `TypeError` này, nên
 *    hiếm khi request đã tới server mà vẫn bị xếp là `network`, và gửi lại tự động có thể tạo một
 *    ticket trùng. Timeout **sau khi đã gửi** vẫn là `uncertain` (không tự gửi lại).
 *
 * Phản hồi HTTP **mọi status** đều được trả về, không ném; `requestJson` mới là nơi non-2xx thành
 * `errorFromStatus`. `init.signal` của người gọi vẫn dùng được: huỷ ⇒ huỷ request và ném lỗi huỷ gốc
 * (không bọc thành `ConnectorError`). Timer của hàm này chỉ bao tới lúc nhận **header** response;
 * đọc thân do `requestJson` chặn thời gian riêng.
 *
 * **Input:** `locale` · `timeoutMs` (mặc định 30 000).
 * **Output:** `ConnectorContext` `{ fetch, locale, timeoutMs }`.
 *
 * @example
 * ```ts
 * const ctx = makeConnectorContext('vi');
 * const res = await ctx.fetch('https://acme.atlassian.net/rest/api/3/myself', { headers });
 * ```
 *
 * **Unit test:** `http.test.ts` › `makeConnectorContext` — 12 case: `locale`/`timeoutMs` mặc định ·
 * treo quá hạn ⇒ `uncertain` và huỷ request · `fetch` phớt lờ `signal` vẫn `uncertain` · "Network
 * request failed" ⇒ `network` · ném đồng bộ ⇒ `network` không rò timer · HTTP 500 được trả về ·
 * `init` đi xuống kèm `signal` · `init.signal` của người gọi huỷ được (ném lỗi gốc) · `signal` đã
 * huỷ từ trước · request của tool không vào nhật ký còn request của app thì có · luôn gắn header
 * `X-Shake-Devtools` (headers dạng object/mảng/`Headers`/vắng) · `fetch` toàn cục bị bọc và `await`
 * trước khi mở XHR ⇒ vẫn không dòng nào, token không lọt buffer.
 */
export const makeConnectorContext = (
  locale: DevToolsLocale,
  timeoutMs: number = DEFAULT_CONNECTOR_TIMEOUT_MS,
): ConnectorContext => ({
  locale,
  timeoutMs,
  fetch: (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const controller = new AbortController();
      const outer = init?.signal ?? undefined;
      let settled = false;

      const onOuterAbort = () => controller.abort();
      const settle = (done: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        outer?.removeEventListener('abort', onOuterAbort);
        done();
      };

      const timer = setTimeout(
        () =>
          settle(() => {
            controller.abort();
            reject(
              new ConnectorError(
                'uncertain',
                `No response within ${timeoutMs} ms; the request may have reached the server`,
              ),
            );
          }),
        timeoutMs,
      );

      if (outer) {
        if (outer.aborted) controller.abort();
        else outer.addEventListener('abort', onOuterAbort);
      }

      const fail = (error: unknown) =>
        settle(() =>
          reject(
            outer?.aborted ? error : new ConnectorError('network', 'Network request failed'),
          ),
        );

      try {
        /* Lớp phòng thủ thứ hai (R16): tap bỏ qua mọi XHR mang header này, kể cả khi `fetch` toàn cục
           bị bọc và `await` làm `open` rơi ra ngoài phạm vi đồng bộ của `runUncaptured`. */
        const headers = new Headers(init?.headers);
        headers.set(INTERNAL_REQUEST_HEADER, INTERNAL_REQUEST_HEADER_VALUE);
        runUncaptured(() => fetch(url, { ...init, headers, signal: controller.signal })).then(
          (response) => settle(() => resolve(response)),
          fail,
        );
      } catch (error) {
        fail(error);
      }
    }),
});

/**
 * Đọc thân response **có chặn thời gian**: `response.text()` treo thì `send()` treo mãi và bản báo
 * kẹt ở "đang gửi". Quá `timeoutMs` ⇒ `ConnectorError('uncertain')` (đã nhận header, server đã xử
 * lý nhưng ta không biết kết quả ⇒ không tự gửi lại). `signal` của người gọi huỷ giữa lúc đọc ⇒ ném
 * lỗi huỷ (tên `AbortError`, không bọc). Timer luôn được dọn.
 */
const readBody = (response: Response, timeoutMs: number, signal?: AbortSignal): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const status = response.status;
    const aborted = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
    let settled = false;

    const settle = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      done();
    };
    const onAbort = () => settle(() => reject(aborted()));
    const timer = setTimeout(
      () =>
        settle(() =>
          reject(
            new ConnectorError(
              'uncertain',
              `The response body did not arrive within ${timeoutMs} ms`,
              { status },
            ),
          ),
        ),
      timeoutMs,
    );

    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);

    try {
      response.text().then(
        (text) => settle(() => resolve(text)),
        () =>
          settle(() =>
            reject(
              signal?.aborted
                ? aborted()
                : new ConnectorError('uncertain', 'Failed to read the response body', { status }),
            ),
          ),
      );
    } catch {
      settle(() =>
        reject(new ConnectorError('uncertain', 'Failed to read the response body', { status })),
      );
    }
  });

/**
 * **Chức năng:** gọi `ctx.fetch` rồi đọc JSON. 2xx ⇒ `{ status, json }`; non-2xx ⇒ ném
 * `errorFromStatus` (kèm `Retry-After`). Thân 2xx rỗng (204) ⇒ `json: undefined`; thân 2xx không
 * phải JSON ⇒ `ConnectorError('unknown')`. Đọc thân hỏng giữa chừng **hoặc treo quá `ctx.timeoutMs`**
 * ⇒ `ConnectorError('uncertain')` (đã nhận header tức server đã xử lý); `init.signal` huỷ lúc đang
 * đọc thân ⇒ lỗi huỷ. Lỗi của `ctx.fetch` (`network`, `uncertain`) được ném nguyên. Tổng thời gian
 * chờ tối đa của một lần gọi là 2 × `timeoutMs` (một cho header, một cho thân).
 *
 * **Input:** `ctx` · `url` · `init` · `opts.secrets` — bí mật của kết nối, được cắt khỏi `message`
 * lỗi (xem `errorFromStatus`).
 * **Output:** `{ status, json }`.
 *
 * @example
 * ```ts
 * const { json } = await requestJson<{ key: string }>(ctx, url, { method: 'POST', headers, body }, { secrets: [token] });
 * ```
 *
 * **Unit test:** `http.test.ts` › `requestJson` — 9 case: 2xx parse · thân rỗng · 2xx không phải JSON ·
 * non-2xx ⇒ `errorFromStatus` + cắt bí mật · lỗi mạng ném nguyên · (fake timer) thân treo ⇒ `uncertain` sau
 * `timeoutMs` · thân non-2xx treo ⇒ `uncertain` · thân về kịp không rò timer · huỷ lúc đọc thân ⇒ lỗi huỷ.
 */
export const requestJson = async <T>(
  ctx: ConnectorContext,
  url: string,
  init: RequestInit,
  opts?: { secrets?: readonly string[] },
): Promise<{ status: number; json: T }> => {
  const response = await ctx.fetch(url, init);
  const status = response.status;
  const text = await readBody(response, ctx.timeoutMs, init.signal ?? undefined);

  if (status < 200 || status >= 300) {
    throw errorFromStatus(status, text, {
      retryAfter: response.headers.get('retry-after'),
      secrets: opts?.secrets,
    });
  }
  if (!text.trim()) return { status, json: undefined as T };
  try {
    return { status, json: JSON.parse(text) as T };
  } catch {
    throw new ConnectorError('unknown', 'The response is not valid JSON', { status });
  }
};
