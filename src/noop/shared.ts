/**
 * Mảnh dùng chung của các entry noop (`react-native-shake-devtools/noop…`).
 *
 * 🔴 File trong `src/noop/` **không import giá trị** từ file nguồn nào khác của lib — chỉ `import
 * type` (Babel xoá sạch), `react`, `react-native`, và hai bảng chuỗi thuần dữ liệu `i18n/vi.ts` ·
 * `i18n/en.ts`. Đó là điều làm bundle prod không còn dòng code devtools nào; `noop-isolation.test.ts`
 * khoá điều này.
 */

/** Hàm không làm gì. Dùng làm hàm gỡ (`stop`), hàm huỷ đăng ký, callback rỗng. */
export const NOOP = (): void => undefined;

/** Mảng rỗng **đông cứng**, cùng một tham chiếu mọi lần — hook trả nó thì React không render lại. */
export const EMPTY: readonly never[] = Object.freeze([]);

/** Promise đã xong — cho mọi hàm bất đồng bộ của bản noop. */
export const RESOLVED: Promise<void> = Promise.resolve();
