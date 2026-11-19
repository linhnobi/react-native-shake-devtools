export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Một dòng `console.*` đã bắt được — hoặc một lỗi JS / promise reject không ai bắt (`uncaught`). */
export interface ConsoleEntry {
  readonly id: number;
  readonly kind: 'console';
  /** Mốc thời gian thật (`Date.now()`) — dùng để hiện giờ, không phải để đo khoảng. */
  readonly at: number;
  readonly level: LogLevel;
  readonly text: string;
  /**
   * Dòng này do **bộ bắt lỗi toàn cục** ghi (`ErrorUtils`, hoặc lời gọi fatal tới
   * `ExceptionsManager.handleException` của RN, vd lỗi render không boundary), hoặc do bộ theo
   * dõi **promise reject không ai `catch`** (`tapUnhandledRejections`, `text` mở đầu bằng
   * `Uncaught (in promise, id: N)`)
   * — không phải một lời gọi `console.*`. Luôn đi cùng `level: 'error'`; `text` có kèm stack.
   */
  readonly uncaught?: boolean;
  /** Lỗi làm **chết** app (RN gọi handler với `isFatal: true`). Chỉ có khi `uncaught`. */
  readonly fatal?: boolean;
  /** Màn đang mở lúc ghi — do vòng đệm đóng dấu, xem `LogBuffer.setScreen`. */
  readonly screen?: string;
}

/**
 * Một **mốc** trên dòng thời gian — không phải dữ liệu đã bắt, mà là bối cảnh để đọc dữ liệu.
 *
 * - `'screen'`: app vừa đổi màn (tự động, app nối từ `NavigationContainer`). `label` = tên route.
 * - `'user'`: người thử bấm **Đánh dấu** (vd "bắt đầu tái hiện"). `label` = số thứ tự `'1'`, `'2'`…
 *
 * `label` là **dữ liệu**, không phải câu: tên route và số thứ tự đọc y nhau ở mọi ngôn ngữ; câu
 * bao quanh ("→ Màn …", "⚑ Đánh dấu #…") do màn dịch lúc render.
 */
export interface MarkerEntry {
  readonly id: number;
  readonly kind: 'marker';
  readonly at: number;
  readonly type: 'screen' | 'user';
  readonly label: string;
}

/**
 * Một request HTTP đã bắt được.
 *
 * `status`/`durationMs`/`responseBody` vắng nghĩa là request **chưa xong** (đang bay) — hàng
 * vẫn hiện ngay lúc gửi chứ không đợi phản hồi, vì ca cần nhìn nhất lại là ca request treo.
 */
export interface NetworkEntry {
  readonly id: number;
  readonly kind: 'network';
  readonly at: number;
  readonly method: string;
  readonly url: string;
  readonly status?: number;
  readonly durationMs?: number;
  /**
   * Header **thô, chưa che** — kể cả `Authorization`.
   *
   * 🔴 Giữ thô là điều kiện để `toCurl` sinh ra lệnh chạy được. Mọi đường **hiển thị** và
   * **chia sẻ** phải tự gọi `redactHeaders` trước khi đưa ra ngoài; xem bảng chính sách ở
   * đầu `redact.ts`.
   */
  readonly requestHeaders?: Readonly<Record<string, string>>;
  /** Thân request thô, đã cắt theo hạn mức nhưng **chưa che**. Cùng luật với `requestHeaders`. */
  readonly requestBody?: string;
  /** Thân response thô, đã cắt theo hạn mức nhưng **chưa che**. */
  readonly responseBody?: string;
  /**
   * Thân request đã bị cắt ⇒ JSON không còn hợp lệ. Màn chi tiết và file xuất đọc cờ này để nói
   * ra; `toCurl` thì không (giữ lệnh import được vào Postman).
   */
  readonly requestTruncated?: boolean;
  readonly responseTruncated?: boolean;
  /**
   * Request **có** thân nhưng tầng thu không ghi lại — và vì sao. Vắng mà `requestBody` cũng vắng
   * ⇒ request thật sự không có thân. Màn chi tiết đọc trường này để không nói "Không có thân" sai.
   */
  readonly requestBodySkipped?: BodySkip;
  /** Như `requestBodySkipped`, cho thân response. */
  readonly responseBodySkipped?: BodySkip;
  /**
   * Lỗi tầng vận chuyển — khác với `status >= 400`. `network-tap` ghi `'network'` (mất mạng) ·
   * `'timeout'` · {@link NETWORK_ABORTED} (app huỷ — **không** tính là lỗi, xem `isErrorEntry`),
   * hoặc thông điệp lỗi khi `send` gốc ném đồng bộ.
   */
  readonly error?: string;
  /** Màn đang mở lúc gửi request — do vòng đệm đóng dấu, xem `LogBuffer.setScreen`. */
  readonly screen?: string;
}

/**
 * Vì sao một thân **có** mà không được ghi:
 * - `'binary'` — dữ liệu nhị phân (Blob/ArrayBuffer, hoặc response có `content-type` không phải chữ).
 * - `'formData'` — thân request là FormData: cố ý không đọc vào (chỗ tool cùng loại crash).
 * - `'tooLarge'` — response vượt trần đọc (`MAX_BODY_READ_BYTES` của `network-tap`).
 * - `'unreadable'` — đọc lỗi, hoặc kiểu thân lạ.
 */
export type BodySkip = 'binary' | 'formData' | 'tooLarge' | 'unreadable';

/**
 * Nhãn `NetworkEntry.error` của request bị **app huỷ** (`xhr.abort()`, `AbortController`). Là dữ
 * liệu trung lập ngôn ngữ; màn hiện chữ đã dịch ("Đã huỷ").
 */
export const NETWORK_ABORTED = 'abort';

export type LogEntry = ConsoleEntry | NetworkEntry | MarkerEntry;

/**
 * Bộ lọc của màn nhật ký. `'all'` là mặc định.
 *
 * Mốc (`MarkerEntry`) chỉ hiện ở `'all'` — lọc riêng console hay mạng là đang dò một loại dữ
 * liệu, chen mốc vào là nhiễu.
 */
export type LogFilter = 'all' | 'console' | 'network';

/**
 * Lọc theo **kết cục** — trục thứ hai, độc lập với `LogFilter` (loại dòng). Chọn một trong ba,
 * `'all'` là không lọc.
 *
 * - `'error'` / `'ok'` chia đôi đúng theo `isErrorEntry`. Request **chưa xong** rơi vào `'ok'`:
 *   nó chưa lỗi, và gộp nó vào `'error'` thì bộ đếm lỗi nhảy lên rồi tụt xuống theo từng request
 *   đang bay.
 * - `'slow'` theo `isSlowEntry` — **không** loại trừ lỗi: một request vừa 500 vừa 4 giây nằm ở
 *   cả `'error'` lẫn `'slow'`.
 *
 * Mốc không thuộc kết cục nào ⇒ bị ẩn ở mọi giá trị trừ `'all'`.
 */
export type LogStatusFilter = 'all' | 'error' | 'ok' | 'slow';
