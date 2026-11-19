/**
 * Các tình huống sinh nhật ký để thử panel trên máy thật. Mỗi hàm tạo một loại dòng mà màn nhật
 * ký phân biệt: console theo mức, HTTP 2xx/4xx/5xx, request chậm, lỗi vận chuyển, promise reject và
 * lỗi không ai bắt.
 *
 * Endpoint là dịch vụ công khai, chạy HTTPS (bản release Android chặn HTTP thường):
 * - `jsonplaceholder.typicode.com`: JSON giả, trả nhanh.
 * - `httpbin.org`: trả status tuỳ ý (`/status/500`) và trả chậm có chủ đích (`/delay/4`).
 */

import { runUncaptured } from 'react-native-shake-devtools/capture';

const JSON_API = 'https://jsonplaceholder.typicode.com';
const HTTPBIN = 'https://httpbin.org';

/**
 * Bắn request và nuốt lỗi. Nhật ký đã ghi lỗi vận chuyển. Để promise reject trôi ra ngoài thì
 * thêm một dòng lỗi `Uncaught (in promise…)` lẫn vào thứ đang muốn thử.
 */
const fire = (url: string, init?: RequestInit): void => {
  fetch(url, init).catch(() => undefined);
};

export const consoleLevels = (): void => {
  console.log('[example] hello from console.log', {
    user: 'demo',
    items: [1, 2, 3],
  });
  console.info('[example] console.info line');
  console.warn('[example] console.warn: cache miss, falling back to network');
  console.error(
    '[example] console.error: handled error',
    new Error('Boom (handled)'),
  );
};

/** Đủ nhiều dòng để thử cuộn, tìm (`burst 42`), tạm dừng và dải "↑ N dòng mới". */
export const consoleBurst = (count = 60): void => {
  for (let i = 1; i <= count; i += 1) {
    console.log(`[example] burst ${i}/${count}`, { i, even: i % 2 === 0 });
  }
};

export const get200 = (): void => fire(`${JSON_API}/todos/1`);

export const get404 = (): void => fire(`${JSON_API}/posts/0`);

export const server500 = (): void => fire(`${HTTPBIN}/status/500`);

/** Chạm ngưỡng "Chậm ≥3s" của chip lọc. */
export const slowRequest = (): void => fire(`${HTTPBIN}/delay/4`);

/** Tên miền `.invalid` không bao giờ phân giải được ⇒ lỗi vận chuyển, không có status. */
export const networkError = (): void =>
  fire('https://unreachable.invalid/ping');

/**
 * Header `Authorization` và khoá `password` trong thân phải hiện `<redacted>` ở màn chi tiết và
 * file xuất. Riêng "Chép cURL" giữ bản thô, có chủ đích (để chạy lại được request).
 */
export const postWithSecrets = (): void =>
  fire(`${JSON_API}/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer example-secret-token',
    },
    body: JSON.stringify({
      username: 'demo',
      password: 'not-a-real-password',
      title: 'redaction check',
    }),
  });

/**
 * Request **hỏng** (401) mang bí mật ở cả ba chỗ: query (`access_token`), header `Authorization` và
 * thân JSON viết liền có giá trị base64 kết thúc bằng `=` (lỗi R1 cũ: thân kiểu này từng bị đọc như
 * form và lọt token). Request lỗi mới vào "Copy for AI", `errors.txt` và bước của bản báo bug, nên
 * đây là request để kiểm ba chỗ đó: mọi giá trị dưới đây phải ra `<redacted>`.
 */
export const postSecretsUnauthorized = (): void =>
  fire(`${HTTPBIN}/status/401?access_token=fake-access-token-0002`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer fake-bearer-token-0002',
    },
    // base64 của "fake-refresh-token-1"
    body: '{"refreshToken":"ZmFrZS1yZWZyZXNoLXRva2VuLTE=","password":"not-a-real-password"}',
  });

/** Cả bộ request trên trong một lần bấm. */
export const sampleTraffic = (): void => {
  get200();
  get404();
  server500();
  postWithSecrets();
  networkError();
};

/**
 * Lỗi JS không ai bắt. Ném trong `setTimeout` để nó thoát khỏi cây React (không bị error
 * boundary hay handler của nút bấm nuốt).
 *
 * - Bản debug (JS từ Metro): RN hiện màn đỏ, app không chết.
 * - Bản release: app đóng. Lib kịp ghi phiên xuống kho, nên mở lại app sẽ thấy dải crash trong
 *   panel và hàng "Previous session".
 */
export const throwUncaught = (): void => {
  setTimeout(() => {
    throw new Error('Example uncaught error');
  }, 0);
};

/**
 * 35 dòng `console.error` khác nhau, tiếng Việt có dấu, mỗi dòng ~195 ký tự (~270 byte UTF-8). Form
 * giữ 30 bước cuối, nên bản báo có đủ 30 bước dài; tiêu đề và ô "Thực tế" lấy từ dòng cuối, cũng
 * tiếng Việt.
 */
export const manyVietnameseErrors = (count = 35): void => {
  for (let i = 1; i <= count; i += 1) {
    console.error(
      `[example] Lỗi ${i}/${count}: không đồng bộ được giỏ hàng của người dùng ở bước thanh toán; máy chủ trả mã lỗi khi cập nhật số lượng sản phẩm, đề nghị kiểm tra lại kết nối mạng và thử lại sau ít phút nữa.`,
    );
  }
};

const EXPECTED_PARAGRAPH =
  'Kết quả mong đợi: ứng dụng hiển thị đúng tổng tiền, giữ nguyên các sản phẩm đã chọn trong giỏ hàng, không tự đăng xuất người dùng và không hiện thông báo lỗi khi mạng chập chờn. ';

/**
 * Đoạn tiếng Việt ~18 300 ký tự, ~24 KB UTF-8: dán vào ô "Mong đợi" (hoặc một bước thêm tay) là thân
 * thẻ Lark vượt 20 KB (bot nhóm) và 14 KB (app) chắc chắn, kể cả khi chưa có bước nào. Đích phải nhận
 * bản đã cắt (có câu "đã cắt bớt"), không được từ chối.
 */
export const LONG_VIETNAMESE_TEXT = EXPECTED_PARAGRAPH.repeat(103).trimEnd();

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `HH:MM:SS` giờ máy, không cần `Intl`. */
export const clockTime = (date = new Date()): string =>
  [date.getHours(), date.getMinutes(), date.getSeconds()].map(pad2).join(':');

/** Chờ tối đa chừng này cho một lần dò mạng; Wi-Fi có sóng mà không ra Internet thì fetch treo lâu. */
const NETWORK_CHECK_TIMEOUT_MS = 8000;

/**
 * Dò xem máy có ra Internet không, để thử chế độ máy bay cho chắc: bật máy bay mà Wi-Fi vẫn bật lại
 * thì hàng đợi không bao giờ thấy "mất mạng". Chạy trong `runUncaptured` (fetch của RN mở XHR đồng bộ
 * trong executor của Promise), nên **không** thêm dòng nhật ký, không thành bước, không đổi tiêu đề
 * gợi ý của bản báo.
 *
 * Trả một dòng có giờ, vd `10:42:07 · online · HTTP 200 · 312 ms` hoặc
 * `10:43:30 · offline · Network request failed`.
 */
export const checkNetwork = async (): Promise<string> => {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_CHECK_TIMEOUT_MS);
  try {
    const res = await runUncaptured(() =>
      fetch(`${JSON_API}/todos/1?t=${started}`, { signal: controller.signal }),
    );
    return `${clockTime()} · online · HTTP ${res.status} · ${
      Date.now() - started
    } ms`;
  } catch (error) {
    const reason = controller.signal.aborted
      ? `no answer in ${NETWORK_CHECK_TIMEOUT_MS / 1000} s`
      : error instanceof Error
      ? error.message
      : String(error);
    return `${clockTime()} · offline · ${reason}`;
  } finally {
    clearTimeout(timer);
  }
};

/** Một "API" async hỏng. Stack của lỗi trỏ vào hàm này. */
const failingApi = async (): Promise<never> => {
  throw new Error('Example unhandled rejection');
};

/**
 * Promise reject không ai `catch`, kiểu `await api()` thiếu `try/catch`. App không chết.
 *
 * Khoảng 2 giây sau (Hermes chờ xem có ai `catch` muộn không), nhật ký có một dòng `UNCAUGHT`
 * `Uncaught (in promise, id: N): Error: Example unhandled rejection` kèm stack.
 */
export const rejectUnhandled = (): void => {
  failingApi();
};

/**
 * Như `rejectUnhandled`, nhưng 4 giây sau mới `catch` (sau lúc Hermes đã báo). Nhật ký có dòng
 * lỗi, rồi thêm dòng `WARN` `Promise rejection handled (id: N)` cùng `id`.
 */
export const rejectCatchLate = (): void => {
  const pending = failingApi();
  setTimeout(() => {
    pending.catch(() => undefined);
  }, 4000);
};
