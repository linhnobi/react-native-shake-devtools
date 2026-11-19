import type { ReportFile } from '../bug-report';
import { ConnectorError, type UploadPart } from './types';

/**
 * **Chức năng:** tên file tạm lib nhờ app ghi cho một file chữ của một bản báo:
 * `<reportId>-<tên>`. Riêng theo bản báo vì hàng đợi gửi lại **song song** (`retryDue`) và app
 * thường ghi mọi file tạm vào chung một thư mục: tên cố định (`errors.txt`) ⇒ bản B đè file của bản
 * A trước khi native kịp đọc, ticket của A mang log của B — có khi ở Jira/Slack của **khách khác**.
 * Ký tự ngoài `[A-Za-z0-9._-]` (dấu `/`, `\`, khoảng trắng — id/tên đọc lại từ file hàng đợi là dữ
 * liệu ngoài) thành `_`, nên tên không bao giờ thoát ra khỏi thư mục app chọn.
 *
 * **Input:** `reportId` · `name` (tên file đính kèm, vd `errors.txt`). **Output:** tên file an toàn.
 *
 * @example
 * ```ts
 * tempFileName('rpt-mhn3k2xs-4fz9qa', 'errors.txt');   // 'rpt-mhn3k2xs-4fz9qa-errors.txt'
 * tempFileName('rpt/../x', 'a b.txt');                 // ca biên: 'rpt_.._x-a_b.txt'
 * ```
 *
 * **Unit test:** `upload.test.ts` › `tempFileName` — 1 case (tên thường · ký tự lạ thành `_`).
 */
export const tempFileName = (reportId: string, name: string): string =>
  `${reportId}-${name}`.replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * **Chức năng:** dựng hàm `SendContext.uploadPart` cho **một** bản báo — đổi một `ReportFile` thành
 * phần `FormData` mà RN gửi được trên cả Android lẫn iOS. **Không bao giờ trả `Blob`**: `FormData`
 * của RN 0.86 coi phần Blob là phần lạ (Android từ chối cả request "Unrecognized FormData part.",
 * iOS gửi một trường rỗng không tên file).
 *
 * - File có `uri` (ảnh chụp, nằm sẵn ở cache) ⇒ `{ uri, name, type }` — dạng file của RN, native đọc
 *   thẳng từ đĩa, JS không cầm byte nào. `uri` thắng `content` nếu có cả hai.
 * - File chỉ có `content` (chữ: `errors.txt`, `timeline.json`):
 *   - app cấp `writeTempFile` ⇒ ghi ra file tạm tên `tempFileName(reportId, name)` rồi dùng `uri`
 *     nó trả về; tên phần upload (thứ đích hiển thị) vẫn là `name`;
 *   - không có ⇒ phần chuỗi trong bộ nhớ `{ string, name, type }` — `FormData.getParts()` của RN
 *     gắn `filename` + `content-type`; Android (`NetworkingModule.constructMultipartBody`) và iOS
 *     (`RCTNetworking processDataForHTTPQuery`) đều gửi phần `string` kèm header đó (đã đọc mã nguồn
 *     RN 0.86, chưa đo trên máy).
 * - Không có cả `uri` lẫn `content` ⇒ ném `ConnectorError('unknown')` nêu tên file; chỗ gọi quyết định
 *   bỏ file đó (`SendResult.skippedFiles`).
 *
 * **Input:** `deps.writeTempFile?` — `(name, content) => Promise<uri>`, do app cấp · `deps.reportId` —
 * `report.id` của bản đang gửi. **Output:** hàm `(file) => Promise<UploadPart>`.
 *
 * @example
 * ```ts
 * const uploadPart = makeUploadPart({ writeTempFile, reportId: report.id });
 * form.append('file', (await uploadPart(file)) as never);
 * makeUploadPart({ reportId })({ name: 'errors.txt', mimeType: 'text/plain', content: 'x' });
 * // ca biên: không có writeTempFile ⇒ { string: 'x', name: 'errors.txt', type: 'text/plain' }
 * ```
 *
 * **Unit test:** `upload.test.ts` › `makeUploadPart` — 6 case: `uri` ⇒ `{ uri, name, type }` ·
 * `content` + `writeTempFile` ⇒ ghi `<reportId>-<tên>`, tên phần giữ nguyên · `content` không có
 * `writeTempFile` ⇒ phần chuỗi (FormData thật của RN mang `filename` + `content-type`), không Blob ·
 * `uri` thắng `content` · `writeTempFile` ném ⇒ lỗi truyền ra · không có `uri` lẫn `content` ⇒ ném.
 */
export const makeUploadPart =
  (deps: {
    writeTempFile?: (name: string, content: string) => Promise<string>;
    reportId: string;
  }) =>
  async (file: ReportFile): Promise<UploadPart> => {
    if (file.uri !== undefined) {
      return { uri: file.uri, name: file.name, type: file.mimeType };
    }
    if (file.content !== undefined) {
      if (deps.writeTempFile) {
        const uri = await deps.writeTempFile(tempFileName(deps.reportId, file.name), file.content);
        return { uri, name: file.name, type: file.mimeType };
      }
      return { string: file.content, name: file.name, type: file.mimeType };
    }
    throw new ConnectorError('unknown', `File "${file.name}" has neither a uri nor content`);
  };
