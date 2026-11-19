import ReactNativeBlobUtil from 'react-native-blob-util';
import Share from 'react-native-share';
import type { DevToolsShareFile } from 'react-native-shake-devtools';

/**
 * Tên file an toàn để ghi vào `CacheDir`: ký tự ngoài `[A-Za-z0-9._-]` (dấu `/`, `\`, khoảng trắng…)
 * thành `_`, không bắt đầu bằng dấu chấm — `..` hay `a/../b` không bao giờ ghi ra ngoài thư mục cache.
 */
const safeFileName = (name: string): string =>
  name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') || 'file';

/**
 * Ghi chuỗi UTF-8 ra file trong thư mục cache của app, cho `bugReport.writeTempFile`.
 *
 * **Chức năng:** lib dùng khi cần upload file chữ (`errors.txt`, `timeline.json`) như file thật trên
 * đĩa, và khi chia sẻ file chữ. Thư mục cache không vào bản sao lưu và hệ điều hành được phép dọn
 * khi thiếu chỗ.
 *
 * **Input:** `name` — lib đặt. Đường gửi (`writeTempFile`) dùng tên **riêng cho từng bản báo**
 * (`<reportId>-errors.txt`) để các bản gửi lại song song không đè file của nhau; đường chia sẻ dùng
 * tên gốc (`errors.txt`, thứ người nhận thấy). Vẫn làm sạch lần nữa ở đây (không dấu phân cách đường
 * dẫn, không mở đầu bằng `.`). `content` — đã che.
 *
 * **Output:** `file://<cache>/<tên đã làm sạch>`. Ghi cùng `name` lần nữa thì đè file cũ (cùng bản
 * báo gửi lại).
 *
 * @example
 * const uri = await writeCacheFile('rpt-mhn3k2xs-4fz9qa-errors.txt', 'no errors');
 * await writeCacheFile('../../secret', 'x');   // ca biên: ghi `CacheDir/__.._secret`
 *
 * **Unit test:** không có; example kiểm tay trên máy thật.
 */
export const writeCacheFile = async (name: string, content: string): Promise<string> => {
  const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${safeFileName(name)}`;
  await ReactNativeBlobUtil.fs.writeFile(path, content, 'utf8');
  return `file://${path}`;
};

/**
 * Mở khay chia sẻ của hệ điều hành với nhiều file, cho `bugReport.shareFiles`.
 *
 * **Chức năng:** đường dự phòng khi không gửi được, hoặc sau khi gửi tới đích không nhận file. Ảnh
 * đã có `uri` (file trong cache của hàm chụp). File chữ chỉ có `content` (tên gốc như `errors.txt` —
 * tên người nhận thấy) nên ghi ra cache trước bằng {@link writeCacheFile}, rồi cả bó đi qua
 * `react-native-share`.
 *
 * **Input:** `files` (`DevToolsShareFile[]`), `message` (lời nhắn kèm theo).
 *
 * **Output:** `Promise<void>`. QA đóng khay mà không chọn gì **không** phải lỗi
 * (`failOnCancel: false`), nên hàm vẫn resolve.
 *
 * @example
 * await shareReportFiles([{ name: 'errors.txt', mimeType: 'text/plain', content: '…' }], 'Bug report');
 *
 * **Unit test:** không có; example kiểm tay trên máy thật.
 */
export const shareReportFiles = async (
  files: readonly DevToolsShareFile[],
  message: string,
): Promise<void> => {
  const urls = await Promise.all(
    files.map(file =>
      file.uri !== undefined ? file.uri : writeCacheFile(file.name, file.content ?? ''),
    ),
  );
  await Share.open({ urls, message, failOnCancel: false });
};
