import type { DevToolsLocale } from '../../i18n/types';
import type { BugReport, ReportFile } from '../bug-report';

/**
 * Hợp đồng của một **loại kết nối** (spec 5.4): code do dev viết, tự khai báo ô nhập, khả năng
 * (ảnh/file), cách thử kết nối và cách gửi. Kết nối cụ thể (dữ liệu QA nhập) là thứ khác — nó chỉ
 * trỏ tới một `ConnectorType.id` kèm giá trị các ô.
 */

/** Kiểu ô nhập của form kết nối. */
export type ConnectorFieldKind =
  | 'text'
  | 'textarea'
  | 'url'
  | 'secret'
  | 'number'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'toggle';

/** Một lựa chọn của ô `select`/`multiselect`. */
export interface ConnectorOption {
  readonly id: string;
  readonly label: string;
}

/** Một ô nhập do loại kết nối khai. */
export interface ConnectorField {
  readonly id: string;
  readonly label: string;
  readonly kind: ConnectorFieldKind;
  readonly required?: boolean;
  readonly help?: string;
  readonly placeholder?: string;
  readonly options?: readonly ConnectorOption[];
  /** Ô cha; đổi ô cha ⇒ gọi `loadOptions` cho ô này. */
  readonly dependsOn?: string;
  readonly visibleWhen?: { readonly field: string; readonly equals: string | boolean };
  /**
   * Có ⇒ đích **bắt buộc** trường này nhưng loại kết nối chưa hỗ trợ kiểu của nó (vd trường `user`
   * hay Sprint của Jira, spec 11.3). Giá trị là tên kiểu ở đích. UI không dựng ô nhập: hiện `help`
   * (câu "Trường X (kiểu Y) chưa hỗ trợ…") và khoá nút Lưu.
   */
  readonly unsupportedType?: string;
}

/** Giá trị các ô, theo `ConnectorField.id`. */
export type ConnectorValues = Readonly<
  Record<string, string | boolean | readonly string[] | undefined>
>;

/** Ngữ cảnh gọi mạng của connector: `fetch` đã bọc (không vào nhật ký, có timeout) + ngôn ngữ. */
export interface ConnectorContext {
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  readonly locale: DevToolsLocale;
  readonly timeoutMs: number;
}

/**
 * Một phần file của `FormData` trong RN: file trên đĩa (`uri`) hoặc chuỗi trong bộ nhớ (`string`).
 * `name` là tên file đích hiển thị, `type` là `content-type` của phần. Đưa thẳng vào
 * `form.append(field, part)` — **không bao giờ** là `Blob` (`FormData` của RN không gửi được phần Blob).
 */
export type UploadPart =
  | { readonly uri: string; readonly name: string; readonly type: string }
  | { readonly string: string; readonly name: string; readonly type: string };

/** Ngữ cảnh lúc gửi: thêm khả năng nhớ tiến độ giữa các lần gửi lại và biến file thành phần upload. */
export interface SendContext extends ConnectorContext {
  /** Tiến độ đã `checkpoint` ở lần gửi trước (gộp nông) — gửi lại thì bỏ qua phần đã xong. */
  readonly resume?: Readonly<Record<string, unknown>>;
  /**
   * Lưu tiến độ (gộp nông vào `resume`). Thêm **`committed: true`** đúng lúc **bước không đảo
   * ngược** vừa xong — ticket/tin đã nằm ở đích (Jira: tạo issue; Lark: gửi thẻ) — ruling R34. Từ
   * đó gửi lại cùng kết nối chỉ được làm nốt, không được gửi bản mới. Tiến độ đảo ngược được (file
   * đã upload nhưng chưa chia sẻ) thì **không** đặt cờ này; connector mà bước không đảo ngược chính
   * là lời gọi cuối (Slack, Webhook) không bao giờ đặt.
   */
  checkpoint(state: Readonly<Record<string, unknown>>): void;
  /**
   * File đính kèm ⇒ phần `FormData` (`{ uri | string, name, type }`, không bao giờ `Blob`). File chữ
   * được app ghi tạm dưới tên riêng của bản báo đang gửi (nếu app cấp `writeTempFile`).
   */
  uploadPart(file: ReportFile): Promise<UploadPart>;
}

/** Kết quả gửi: link/khoá của ticket, và các file không đính được (vd ảnh cache đã bị xoá). */
export interface SendResult {
  readonly url?: string;
  readonly key?: string;
  readonly skippedFiles?: readonly string[];
}

/** Kết quả **Thử kết nối**: tài khoản, lựa chọn cho các ô phụ thuộc, giá trị đã được suy ra. */
export interface ConnectorTestResult {
  readonly account?: string;
  readonly options?: Readonly<Record<string, readonly ConnectorOption[]>>;
  readonly resolved?: ConnectorValues;
}

/** Một loại kết nối. `V` là kiểu giá trị các ô (không bí mật); bí mật đi riêng qua `secrets`. */
export interface ConnectorType<V extends ConnectorValues = ConnectorValues> {
  readonly id: string;
  label(locale: DevToolsLocale): string;
  fields(locale: DevToolsLocale): readonly ConnectorField[];
  readonly secretFieldIds: readonly string[];
  capabilities(values: V): { readonly image: boolean; readonly files: boolean };
  /** `true` ⇒ màn kết nối hiện cảnh báo của spec 5.4.2. */
  longLivedSecret?(values: V): boolean;
  test(values: V, secrets: ConnectorValues, ctx: ConnectorContext): Promise<ConnectorTestResult>;
  loadOptions?(
    fieldId: string,
    values: V,
    secrets: ConnectorValues,
    ctx: ConnectorContext,
  ): Promise<readonly ConnectorOption[]>;
  loadExtraFields?(
    values: V,
    secrets: ConnectorValues,
    ctx: ConnectorContext,
  ): Promise<readonly ConnectorField[]>;
  send(
    report: BugReport,
    values: V,
    secrets: ConnectorValues,
    ctx: SendContext,
  ): Promise<SendResult>;
}

/**
 * **Chức năng:** khai một loại kết nối với kiểu `V` được suy ra đúng — trả lại nguyên `c`, chỉ để
 * TypeScript khớp `V` với các hàm bên trong.
 *
 * **Input:** `c` — loại kết nối. **Output:** chính `c`.
 *
 * @example
 * ```ts
 * export const webhook = defineConnector<WebhookValues>({ id: 'webhook', … });
 * ```
 *
 * **Unit test:** không có test riêng (hàm đồng nhất, được kiểm bởi `tsc` ở các loại kết nối dùng nó).
 */
export const defineConnector = <V extends ConnectorValues>(c: ConnectorType<V>): ConnectorType<V> =>
  c;

/**
 * Nhóm lỗi cố định (spec 5.4). Màn hình ánh xạ từng nhóm sang câu báo và hành động.
 *
 * - `network`: **không nhận được phản hồi nào** (mất mạng, không phân giải được tên miền, từ chối kết
 *   nối) ⇒ **rất có thể** request chưa tới server nên hàng đợi tự gửi lại (spec 5.4.3). ⚠️ Rủi ro còn
 *   lại: RN báo cả "kết nối bị ngắt giữa chừng lúc đang POST" bằng đúng `TypeError: Network request
 *   failed`, nên hiếm khi request đã tới server mà vẫn bị xếp là `network` và gửi lại tự động tạo
 *   một ticket trùng. Phân loại giữ nguyên; chỉ timeout **sau khi đã gửi** mới là `uncertain`.
 * - `uncertain`: request **đã đi** mà không thấy phản hồi — timeout do chính connector đặt ⇒ **không**
 *   tự gửi lại, hỏi QA kiểm tra ở đích trước.
 */
export type ConnectorErrorKind =
  | 'auth'
  | 'permission'
  | 'validation'
  | 'network'
  | 'uncertain'
  | 'rate-limit'
  | 'unknown';

/**
 * Lỗi của connector, mang nhóm lỗi để UI và hàng đợi quyết định (báo gì, có gửi lại không).
 *
 * **Chức năng:** `Error` có `kind` (+ `field` cho `validation`, `retryAfterMs` cho `rate-limit`,
 * `status` HTTP nếu có). `message` do connector soạn và **không bao giờ chứa bí mật**.
 *
 * `Object.setPrototypeOf(this, new.target.prototype)`: Babel của RN hạ lớp xuống ES5 ở một số cấu
 * hình, khi đó lớp con của `Error` mất prototype và `instanceof ConnectorError` sai — đặt tường
 * minh để luôn đúng.
 *
 * @example
 * ```ts
 * throw new ConnectorError('validation', 'Field is required', { field: 'customfield_1', status: 400 });
 * ```
 *
 * **Unit test:** `http.test.ts` › `ConnectorError` — 1 case: `instanceof`, `name`, các trường.
 */
export class ConnectorError extends Error {
  readonly kind: ConnectorErrorKind;
  readonly field?: string;
  readonly retryAfterMs?: number;
  readonly status?: number;

  constructor(
    kind: ConnectorErrorKind,
    message: string,
    opts?: { field?: string; retryAfterMs?: number; status?: number },
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ConnectorError';
    this.kind = kind;
    this.field = opts?.field;
    this.retryAfterMs = opts?.retryAfterMs;
    this.status = opts?.status;
  }
}
