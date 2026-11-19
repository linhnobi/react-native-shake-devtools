import type { NetworkEntry } from './log-entry';

/**
 * Bọc một chuỗi thành **một tham số shell an toàn** theo lối POSIX.
 *
 * Dùng nháy đơn vì bên trong nháy đơn shell không diễn giải gì cả — `$`, `` ` ``, `\`, `!`
 * đều là ký tự thường. Ký tự duy nhất phải xử là chính nháy đơn, và mẹo chuẩn là đóng chuỗi,
 * chèn một nháy đơn đã escape, rồi mở lại: `'` → `'\''`.
 *
 * ⚠️ Đây là quy ước của **bash/zsh** (macOS · Linux · Git Bash). PowerShell escape nháy đơn
 * bằng cách nhân đôi (`''`), nên lệnh sinh ra ở đây dán vào PowerShell có thể hỏng nếu dữ
 * liệu chứa nháy đơn. Ca đó hiếm với JSON, và người dùng thật của nút này là dev/BE — họ có
 * bash. Không sinh hai biến thể: hai biến thể nghĩa là một biến thể không bao giờ được thử.
 */
const shellQuote = (value: string): string =>
  `'${value.split("'").join(`'\\''`)}'`;

/**
 * Header **không** đưa vào curl.
 *
 * `content-length` và `host` do curl tự tính — khai lại là mâu thuẫn với thân thật (nhất là
 * khi thân đã bị cắt) và một số server trả 400. Số còn lại là header do engine HTTP tự thêm,
 * khai lại không sai nhưng làm lệnh dài ra vô ích.
 */
const SKIP_HEADERS = new Set([
  'content-length',
  'host',
  'connection',
  'accept-encoding',
]);

/**
 * **Chức năng:** đổi một request đã bắt thành lệnh `curl` **dán vào terminal chạy được ngay**.
 *
 * ## Vì sao header ở đây KHÔNG che
 *
 * Vì che thì `Authorization: <redacted>` và mọi endpoint cần đăng nhập trả 401 — lệnh sinh ra
 * trông giống thật nhưng vô dụng, dạng tệ nhất của một công cụ gỡ lỗi. Đây là đường xuất
 * **ở lại với người đang gỡ** (clipboard → terminal của chính họ), khác với nút Chia sẻ.
 * Bảng chính sách đầy đủ ở đầu [`redact.ts`](./redact.ts).
 *
 * ## 🔴 401 khi dán sang Postman, trong khi app trả 200
 *
 * Ca này **không** phải lỗi của lệnh. `Authorization` ở đây là JWT mang claim `exp`
 * nên nó hết hạn, còn app thì tự
 * refresh single-flight mỗi lần gặp 401 — nên app "luôn chạy" còn lệnh chép ra thì già đi.
 * Chép lại một request **mới** rồi chạy ngay.
 *
 * Muốn phân biệt "token hết hạn" với "header không được bắt": mở hàng đó trong màn nhật ký,
 * nó liệt kê header (giá trị đã che). Không thấy dòng `Authorization` nghĩa là tầng thu có
 * vấn đề, không phải hạn token.
 *
 * ## Thân bị cắt thì sao
 *
 * Thân vượt hạn mức bị cắt lúc ghi (hậu tố `…+N` nằm ngay trong chuỗi), nên JSON không còn
 * đóng ngoặc và server trả lỗi parse. Dấu hiệu nhìn thấy được ở ngay trong thân lệnh; cố ý
 * **không** thêm dòng chú thích để giữ lệnh import được vào Postman — xem ghi chú trong thân hàm.
 *
 * **Input:** `entry` — một mục `network`.
 * **Output:** chuỗi nhiều dòng nối bằng `\` — `-X <METHOD>`, URL, mỗi header một `-H`, và
 * `--data-raw` khi có thân. Request chưa xong vẫn dựng được lệnh đầy đủ (chỉ thiếu response,
 * mà response không phải đầu vào của curl).
 *
 * @example
 * ```ts
 * toCurl({ id: 1, kind: 'network', at: 0, method: 'POST', url: 'https://a/b',
 *          requestHeaders: { Authorization: 'Bearer x' }, requestBody: '{"a":1}' });
 * // curl -X POST 'https://a/b' \
 * //   -H 'Authorization: Bearer x' \
 * //   --data-raw '{"a":1}'
 *
 * // Ca biên: GET không thân ⇒ KHÔNG có dòng `--data-raw` (curl với --data-raw rỗng sẽ
 * // âm thầm đổi method thành POST).
 * ```
 *
 * **Unit test:** `to-curl.test.ts` › `toCurl` — 8 case: GET không thân không sinh
 * `--data-raw` · POST có thân sinh `--data-raw` · header giữ **nguyên** giá trị `Authorization`
 * (khoá quyết định "không che") · bỏ `content-length`/`host` · nháy đơn trong thân được escape
 * `'\''` · **không** sinh dòng nào bắt đầu bằng `#` (khoá tính import-được vào Postman) ·
 * không có header ⇒ chỉ 1 dòng · request chưa xong vẫn dựng đủ lệnh.
 */
export const toCurl = (entry: NetworkEntry): string => {
  /*
    🔴 KHÔNG chèn dòng chú thích `#` vào đây, dù bash bỏ qua chúng.

    Người dùng thật của nút này dán vào **Postman** ("Import → Raw text"), và trình phân tích
    cURL của Postman không có bảo đảm nào về việc chấp nhận dòng comment. Một lệnh curl "có
    thêm ghi chú hữu ích" mà Postman từ chối import thì tệ hơn hẳn một lệnh trần.

    Thông tin bối cảnh (giờ bắt, status app nhận được, thân có bị cắt không) đã nằm **trên
    màn nhật ký** ở chính hàng đó — đúng chỗ nó cần ở, và không đi vào thứ phải chạy được.
  */
  const parts: string[] = [`curl -X ${entry.method} ${shellQuote(entry.url)}`];

  for (const [name, value] of Object.entries(entry.requestHeaders ?? {})) {
    if (SKIP_HEADERS.has(name.toLowerCase())) continue;
    parts.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  }

  if (entry.requestBody) {
    parts.push(`  --data-raw ${shellQuote(entry.requestBody)}`);
  }

  return parts.join(' \\\n');
};
