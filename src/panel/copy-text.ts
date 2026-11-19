import { Clipboard } from 'react-native';

/**
 * Tham chiếu `Clipboard` lấy **một lần** rồi nhớ lại.
 *
 * 🔴 `Clipboard` trên root export của react-native là một **getter có `warnOnce`**: mỗi lần
 * chạm vào nó, RN in cảnh báo "Clipboard has been extracted from react-native core…".
 * `warnOnce` chỉ bắn một lần cho mỗi lượt chạy app, nhưng chạm ở module scope nghĩa là cảnh
 * báo đó rơi vào **đúng lúc app khởi động** thay vì lúc người dùng bấm chép — và vì
 * `tapConsole` đang bắt `console.warn`, nó sẽ thành dòng đầu tiên của mọi nhật ký.
 *
 * Nhớ lại bằng biến nên cảnh báo chỉ xảy ra ở lần chép **đầu tiên**.
 */
let clipboard: typeof Clipboard | null = null;

/**
 * **Chức năng:** đặt một khối text vào bộ nhớ tạm của máy.
 *
 * ## Vì sao dùng `Clipboard` của lõi RN dù nó đã deprecated
 *
 * `@react-native-clipboard/clipboard` là **native module** — thêm nó nghĩa là mọi người phải
 * build lại app, và đó là cái giá quá lớn cho một nút trong công cụ nội bộ. Bản trong lõi RN
 * 0.86 vẫn còn và vẫn chạy (`Libraries/Components/Clipboard/Clipboard`), chỉ kèm một cảnh báo.
 *
 * 📌 Ngày nào RN gỡ hẳn, sửa **đúng file này**: đó chính là lý do lời gọi được bọc ở đây thay
 * vì rải `Clipboard.setString` khắp component.
 *
 * **Input:** `text` — chuỗi bất kỳ; rỗng thì **không** chép (giữ nguyên thứ đang có trong bộ
 * nhớ tạm, thay vì xoá trắng nó).
 * **Output:** `boolean` — có chép được không. `false` khi text rỗng hoặc API vắng mặt;
 * **không bao giờ ném**, vì một nút gỡ lỗi hỏng không được làm chết màn đang mở.
 *
 * @example
 * ```ts
 * copyText('07:00:00.000 GET /x → 200 31ms');   // true
 * copyText('');                                  // ca biên: false, bộ nhớ tạm giữ nguyên
 * ```
 *
 * **Unit test:** `copy-text.test.ts` › `copyText` — 4 case: gọi `setString` đúng nội dung ·
 * chuỗi rỗng trả false và không gọi · `Clipboard` vắng trả false không ném · gọi hai lần chỉ
 * chạm getter `Clipboard` một lần (chốt cảnh báo deprecated).
 */
export const copyText = (text: string): boolean => {
  if (!text) return false;
  try {
    clipboard ??= Clipboard;
    if (typeof clipboard?.setString !== 'function') return false;
    clipboard.setString(text);
    return true;
  } catch {
    return false;
  }
};

/** `Clipboard` nhớ lại (chạm getter lần đầu), hoặc `null` khi getter ném/vắng. Không bao giờ ném. */
const clipboardOrNull = (): typeof Clipboard | null => {
  try {
    clipboard ??= Clipboard;
    return clipboard ?? null;
  } catch {
    return null;
  }
};

/**
 * **Chức năng:** máy này có đọc được bộ nhớ tạm không — nút **Dán** chỉ hiện khi `true` (ruling R9).
 * Dùng chung tham chiếu nhớ lại với `copyText` (cảnh báo deprecated chỉ một lần).
 *
 * **Input:** không. **Output:** `true` khi `Clipboard.getString` là hàm; vắng/ném ⇒ `false`, không ném.
 *
 * @example
 * ```ts
 * canReadText(); // true trên RN 0.86; false ngày RN gỡ Clipboard khỏi lõi
 * ```
 *
 * **Unit test:** `copy-text.test.ts` › `canReadText / readText` — trong 4 case: có `getString` ·
 * vắng theo 3 dạng · dùng chung tham chiếu với `copyText`.
 */
export const canReadText = (): boolean =>
  typeof clipboardOrNull()?.getString === 'function';

/**
 * **Chức năng:** đọc chữ đang có trong bộ nhớ tạm (nút **Dán** của ô bí mật). Trả **nguyên văn** —
 * người gọi tự cắt khoảng trắng. Không ghi nội dung đọc được vào đâu (nó thường là token).
 *
 * **Input:** không. **Output:** `Promise<string | null>` — `null` khi API vắng, `getString` ném hoặc
 * trả thứ không phải chuỗi; **không bao giờ reject**.
 *
 * @example
 * ```ts
 * const text = await readText(); // '  xoxb-123\n' — ca biên: Clipboard vắng ⇒ null
 * ```
 *
 * **Unit test:** `copy-text.test.ts` › `canReadText / readText` — 4 case: đọc nguyên văn · vắng theo
 * 3 dạng ⇒ null · `getString` ném / trả số ⇒ null · chép rồi đọc chỉ chạm getter một lần.
 */
export const readText = async (): Promise<string | null> => {
  const board = clipboardOrNull();
  if (typeof board?.getString !== 'function') return null;
  try {
    const text: unknown = await board.getString();
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
};
