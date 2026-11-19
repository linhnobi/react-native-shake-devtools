import { tapConsole } from './console-tap';
import { tapGlobalErrors } from './global-error-tap';
import {
  DEFAULT_CAPACITY,
  DEFAULT_ERROR_CAPACITY,
  logBuffer,
} from './log-buffer';
import {
  flushPersistedLogs,
  startPersistence,
  type PersistOptions,
} from './log-persist';
import { tapFetch } from './fetch-tap';
import { setExtraSecretKeys } from './redact';
import { DEFAULT_BODY_LIMIT, tapNetwork } from './network-tap';
import { tapUnhandledRejections } from './rejection-tap';

export interface CaptureOptions {
  /**
   * Có thu hay không — **bắt buộc, không mặc định**, cùng luật với `DevToolsConfig.enabled`: lib
   * không bao giờ tự quyết là mình được chạy, và không suy ra từ `__DEV__` (bản UAT hay bundle
   * với `--dev true`). Chỉ đúng giá trị `true` mới bật; `false`, thiếu khoá (gọi từ JS) hay giá
   * trị truthy khác (`'true'`, `1`) ⇒ không vá gì, không ghi đĩa, trả hàm tắt rỗng. Truyền cùng
   * giá trị với `DevToolsConfig.enabled`.
   */
  enabled: boolean;
  /** Số dòng giữ trong vòng đệm. Mặc định `300`. */
  capacity?: number;
  /** Số lỗi giữ thêm sau khi rời vòng chính. Mặc định `100`; `0` ⇒ tắt. */
  errorCapacity?: number;
  /** Số ký tự tối đa mỗi thân request/response. Mặc định `4000`. */
  bodyLimit?: number;
  /** Bắt `console.*`. Mặc định `true`. */
  console?: boolean;
  /**
   * Bắt HTTP. Mặc định `true`. Bật cả hai tap: `XMLHttpRequest` (axios, `fetch` của RN) và `fetch`
   * native của Expo (`expo/fetch` khi nó là `fetch` toàn cục — SDK 56+, xem `tapFetch`).
   */
  network?: boolean;
  /**
   * Bắt lỗi JS không ai bắt (`ErrorUtils`, và `ExceptionsManager.handleException` của RN cho lỗi
   * render không có error boundary ở RN 0.81+) — xem `tapGlobalErrors`. Mặc định `true`.
   */
  uncaught?: boolean;
  /**
   * Bắt promise reject không ai `catch` (bộ theo dõi của Hermes) — xem `tapUnhandledRejections`.
   * Mặc định `true`. Tắt khi app có SDK khác cũng đăng ký bộ theo dõi đó (vd Sentry): Hermes chỉ
   * giữ một bộ, ai đăng ký sau thì đè bên kia.
   */
  rejections?: boolean;
  /**
   * Lưu nhật ký xuống đĩa theo phiên để xem lại sau crash. **Vắng ⇒ không lưu** (chỉ RAM, như
   * trước). App phải tự cấp kho (`LogStore`) — lib không ghi đĩa được khi thiếu native module.
   * Hàng đợi gửi báo bug cũng lưu vào kho này, lấy **một lần** khi `DevToolsGate` mount: gọi
   * `startCapture({ persist })` **trước** khi gate mount, không thì hàng đợi chỉ ở RAM cả lần chạy.
   */
  persist?: PersistOptions;
  /**
   * Tên bí mật **riêng của app**, che thêm ngoài quy tắc mặc định (`src/capture/redact.ts`) ở mọi
   * đường xuất: khoá JSON trong thân, tham số form/query, header. Viết kiểu gì cũng được
   * (`customerRef`, `customer_ref`, `X-Tenant-Key`), so sau khi chuẩn hoá và khớp nguyên tên. Tắt thu
   * thì bỏ. Không ảnh hưởng "Chép cURL" (luôn thô, theo thiết kế).
   */
  redactKeys?: readonly string[];
}

let startedAt: number | undefined;

/**
 * Mốc gọi `startCapture` lần gần nhất (≈ lúc mở app) — dòng `Session` trong khối thông tin thiết
 * bị và đầu file xuất. `undefined` khi chưa bật thu.
 */
export const getCaptureStartedAt = (): number | undefined => startedAt;

/**
 * **Chức năng:** bật thu nhật ký — vá `console.*`, `XMLHttpRequest`, `fetch` native của Expo (nếu
 * `fetch` toàn cục là nó), bộ bắt lỗi toàn cục, bộ theo dõi promise reject, đổ vào `logBuffer`; tuỳ
 * chọn lưu xuống đĩa theo phiên.
 *
 * ## Gọi ở đâu, và vì sao KHÔNG gọi trong `useEffect`
 *
 * Gọi **càng sớm càng tốt**, trước khi cây React render — lý tưởng là ngay cạnh
 * `bootstrap()` của app ở module scope của `App.tsx`. Effect chạy *sau* lần render đầu, mà mấy
 * request sớm nhất (khôi phục phiên, cấu hình) bắn đi ngay lúc đó: bật muộn nghĩa là mất
 * đúng những dòng hay cần nhất.
 *
 * 🔴 `enabled` **bắt buộc** — truyền đúng giá trị của `DevToolsConfig.enabled`. Hàm không tự hỏi
 * `APP_ENV`, vì lib không biết "prod" của app là gì; nhưng nó cũng không chạy khi app chưa nói
 * `enabled: true`. Trước đây tham số này không có, app quên `if (enabled)` thì bản prod vẫn vá
 * console/HTTP và, nếu có `persist`, ghi nhật ký của người dùng thật xuống đĩa.
 *
 * Lỗi **fatal** được nối sẵn với việc lưu: bắt được là ghi phiên xuống đĩa ngay (có trần thời
 * gian) rồi mới trả lỗi về RN — xem `tapGlobalErrors`.
 *
 * **Input:** `CaptureOptions` — `enabled` bắt buộc, các khoá khác tuỳ chọn.
 * **Output:** hàm **tắt thu**, gỡ mọi bản vá và dừng lưu (`enabled` khác `true` ⇒ hàm rỗng). Gọi
 * `startCapture` lần hai khi chưa tắt ⇒ các bản vá bên trong đều tự nhận ra và **không** chồng
 * thêm lớp.
 *
 * @example
 * ```ts
 * // App.tsx — module scope, cạnh bootstrap() của app
 * startCapture({ enabled: devToolsConfig.enabled, persist: { store: appLogStore } });
 *
 * // Ca biên: `enabled: false` (bản prod) ⇒ không vá gì, không ghi đĩa.
 * // Ca biên: gọi hai lần ⇒ vẫn chỉ một lớp vá, `console.log` không bị ghi hai dòng.
 * ```
 *
 * **Unit test:** `start-capture.test.ts` › `startCapture` — 4 case `enabled` (`false` không vá,
 * không ghi đĩa · `false` không đổi buffer · thiếu khoá / truthy khác `true` coi như tắt · kiểu
 * bắt buộc qua `@ts-expect-error`), `redactKeys` che thêm khi bật và bỏ khi tắt, và 8 case: vá cả
 * console lẫn network
 * (XHR + `fetch` native) theo mặc định · `console: false` chỉ vá network · `network: false` chỉ vá
 * console (không cả hai tap mạng) · `capacity`
 * được áp vào buffer · hàm trả về gỡ sạch mọi bản vá · `uncaught: false` không đụng `ErrorUtils` ·
 * `rejections: false` không đăng ký bộ theo dõi promise reject · có `persist` thì bật lưu và tắt
 * thu thì dừng lưu.
 */
export const startCapture = (options: CaptureOptions): (() => void) => {
  /* So đúng `true`: gọi từ JS mà thiếu khoá, hay truyền `'true'`, đều không được coi là bật. */
  if (options?.enabled !== true) return () => undefined;
  const {
    capacity = DEFAULT_CAPACITY,
    errorCapacity = DEFAULT_ERROR_CAPACITY,
    bodyLimit = DEFAULT_BODY_LIMIT,
    console: tapC = true,
    network: tapN = true,
    uncaught = true,
    rejections = true,
    persist,
    redactKeys = [],
  } = options;

  startedAt = Date.now();
  logBuffer.setCapacity(capacity);
  logBuffer.setErrorCapacity(errorCapacity);

  const stops: Array<() => void> = [];
  setExtraSecretKeys(redactKeys);
  stops.push(() => setExtraSecretKeys([]));
  if (tapC) stops.push(tapConsole());
  if (tapN) {
    stops.push(tapNetwork(bodyLimit));
    /* Chỉ bọc khi `fetch` toàn cục là `expo/fetch` (không qua XHR); `fetch` của RN thì no-op. */
    stops.push(tapFetch(bodyLimit));
  }
  if (uncaught) stops.push(tapGlobalErrors(() => flushPersistedLogs(true)));
  if (rejections) stops.push(tapUnhandledRejections());
  if (persist) stops.push(startPersistence(logBuffer, persist).stop);

  return () => stops.forEach((stop) => stop());
};
