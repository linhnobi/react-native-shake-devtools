import { base64, hmacSha256, utf8Bytes } from '../encoding';

/**
 * **Chức năng:** chữ ký của bot nhóm Lark/Feishu khi bật "Xác thực chữ ký" (spec 5.4.1): HMAC-SHA256
 * với **khoá** là `` `${timestamp}\n${secret}` `` (UTF-8) ký trên **thông điệp rỗng**, kết quả base64.
 * Server chỉ nhận khi `timestamp` lệch giờ hiện tại tối đa 1 giờ (sai ⇒ mã 19021).
 *
 * **Input:** `secret` — khoá ký của bot · `timestampSec` — epoch **giây** (cũng là `timestamp` gửi kèm
 * trong thân). **Output:** chuỗi base64 (44 ký tự).
 *
 * @example
 * ```ts
 * larkSign('demo', 1599360473); // gửi kèm { timestamp: '1599360473', sign }
 * ```
 *
 * **Unit test:** `sign.test.ts` — 4 case: khớp `crypto.createHmac` của Node (2 bộ ASCII) · định dạng
 * base64 44 ký tự · secret tiếng Việt có dấu + emoji (UTF-8) · timestamp khác ⇒ chữ ký khác.
 */
export const larkSign = (secret: string, timestampSec: number): string =>
  base64(hmacSha256(utf8Bytes(`${timestampSec}\n${secret}`), new Uint8Array(0)));
