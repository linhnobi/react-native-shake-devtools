import type { LogEntry } from './log-entry';
import { redactBody, redactText, redactUrl } from './redact';

/**
 * **Chức năng:** đổi mốc thời gian thành giờ đọc được cho một dòng nhật ký.
 *
 * Có mili-giây và **không** có ngày: vòng đệm chỉ giữ vài phút gần nhất, nên ngày là thông
 * tin thừa, còn mili-giây là thứ phân biệt được hai request bắn liền nhau.
 *
 * Tự định dạng thay vì `toLocaleTimeString`: hàm kia đổi theo locale của máy (12h/24h, dấu
 * phân cách), mà khối text này được chép sang chỗ khác nên phải đọc y nhau ở mọi máy.
 *
 * **Input:** `at` — mili-giây kiểu `Date.now()`, **giờ máy**.
 * **Output:** `'HH:mm:ss.SSS'`, luôn đủ 12 ký tự.
 *
 * @example
 * ```ts
 * formatTime(new Date(2026, 8, 14, 14, 26, 40, 123).getTime());  // '14:26:40.123'
 * formatTime(new Date(2026, 8, 14, 7, 0, 0, 5).getTime());       // ca biên: '07:00:00.005'
 * ```
 *
 * **Unit test:** `format-log.test.ts` › `formatTime` — 3 case: định dạng đủ 12 ký tự · đệm 0
 * cho giờ/phút/giây một chữ số · đệm 3 chữ số cho mili-giây.
 */
export const formatTime = (at: number): string => {
  const d = new Date(at);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

/**
 * **Chức năng:** ngày giờ **đầy đủ** kèm lệch múi giờ, vd `2026-09-24 14:26:40 +07:00`.
 *
 * `formatTime` bỏ ngày vì vòng đệm chỉ giữ vài phút; nhưng thứ gì **rời máy** (file xuất, phiên
 * lưu trên đĩa, khối thông tin thiết bị) được đọc hôm sau, ở máy khác, múi giờ khác — thiếu ngày
 * và múi giờ là không đối chiếu nổi với log server.
 *
 * **Input:** `at` — mili-giây, giờ máy. **Output:** `'YYYY-MM-DD HH:mm:ss ±HH:MM'`.
 *
 * @example
 * ```ts
 * formatDateTime(new Date(2026, 8, 24, 14, 26, 40).getTime());  // '2026-09-24 14:26:40 +07:00' (máy ở VN)
 * formatDateTime(new Date(2026, 0, 2, 3, 4, 5).getTime());      // ca biên: đệm 0 ⇒ '2026-01-02 03:04:05 …'
 * ```
 *
 * **Unit test:** `format-log.test.ts` › `formatDateTime` — 2 case: đúng khuôn kèm múi giờ · đệm 0
 * cho tháng/ngày/giờ một chữ số.
 */
export const formatDateTime = (at: number): string => {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const abs = Math.abs(offset);
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ` +
    `${offset >= 0 ? '+' : '-'}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
};

/**
 * **Chức năng:** đổ toàn bộ nhật ký thành một khối text để chép ra ngoài (ticket, chat).
 *
 * Dạng text thô chứ không phải JSON/HAR: thứ này được **dán vào ô chat**, nơi JSON 200 dòng
 * là không đọc nổi. HAR là việc của lượt sau và của công cụ trên máy tính, không phải của
 * cái nút chép trên điện thoại.
 *
 * Cố ý **trung lập ngôn ngữ** — không nhãn tiếng Việt nào: khối này rời khỏi app và người
 * đọc nó (BE, hạ tầng) có thể không dùng app. Cùng lý do với `REDACTED`.
 *
 * **Input:** `entries` — ảnh chụp từ `logBuffer.snapshot()`.
 * **Output:** chuỗi nhiều dòng, mỗi mục một dòng, request có thân thì thêm dòng thụt.
 * Mảng rỗng ⇒ chuỗi rỗng (người gọi tự quyết định có chép hay không).
 *
 * @example
 * ```ts
 * formatLog([{ id: 1, kind: 'console', at: 0, level: 'warn', text: 'ối' }]);
 * // '07:00:00.000 WARN ối'
 * formatLog([]);   // ca biên: '' — không phải '\n'
 * ```
 *
 * **Unit test:** `format-log.test.ts` › `formatLog` — 5 case: dòng console có mức viết hoa ·
 * dòng network có method/url/status/thời lượng · request chưa xong hiện `pending` · thân
 * request/response xuống dòng thụt lề · mảng rỗng ⇒ chuỗi rỗng.
 */
export const formatLog = (entries: readonly LogEntry[]): string =>
  entries.map(formatEntry).join('\n');

/**
 * **Chức năng:** đổ **một** mục nhật ký thành text — đơn vị dùng chung của nút chép từng dòng
 * và của `formatLog`.
 *
 * Tách ra để hai đường xuất không thể lệch nhau: dòng QA chép lẻ phải trùng từng ký tự với
 * dòng tương ứng trong khối chia sẻ, nếu không thì đối chiếu hai ảnh chụp thành việc đoán.
 *
 * **Input:** `entry`.
 * **Output:** một dòng cho mốc và mục console một dòng; mục console nhiều dòng (stack) thì các
 * dòng sau thụt 4; mục mạng có thân thì thêm dòng thụt lề `>` (request) và `<` (response). Lỗi
 * không ai bắt in mức `FATAL`/`UNCAUGHT` thay cho `ERROR`. Không bao giờ trả chuỗi rỗng.
 *
 * @example
 * ```ts
 * formatEntry({ id: 1, kind: 'console', at: 0, level: 'warn', text: 'ối' });
 * // '07:00:00.000 WARN ối'
 * formatEntry({ id: 2, kind: 'network', at: 0, method: 'GET', url: '/x' });
 * // ca biên: chưa xong ⇒ '07:00:00.000 GET /x → pending'
 * formatEntry({ id: 3, kind: 'marker', at: 0, type: 'screen', label: 'UserList' });
 * // '07:00:00.000 → SCREEN UserList'
 * ```
 *
 * **Unit test:** `format-log.test.ts` › `formatEntry` — 8 case: console có mức viết hoa ·
 * mạng đủ status + thời lượng · chưa xong ra `pending` · lỗi mạng ra `network` · thân
 * request/response xuống dòng thụt lề · lỗi fatal in `FATAL` · mốc màn in `→ SCREEN` · mốc đánh
 * dấu in `⚑ MARK #n`.
 */
export const formatEntry = (entry: LogEntry): string => {
  if (entry.kind === 'marker') {
    /* Mốc cũng đi vào khối chia sẻ: không có nó, người nhận không biết dòng nào xảy ra ở màn
       nào. Ký hiệu trung lập ngôn ngữ như phần còn lại của khối. */
    return entry.type === 'screen'
      ? `${formatTime(entry.at)} → SCREEN ${entry.label}`
      : `${formatTime(entry.at)} ⚑ MARK #${entry.label}`;
  }
  if (entry.kind === 'console') {
    const level = entry.fatal ? 'FATAL' : entry.uncaught ? 'UNCAUGHT' : entry.level.toUpperCase();
    /* Dòng nhiều dòng (stack của lỗi không ai bắt, JSON in có xuống dòng): các dòng sau thụt 4
       như thân request, để người đọc khối chia sẻ thấy chúng thuộc về mục phía trên. */
    /* Khối này rời máy: chữ console cũng qua lớp che (JSON in ra, JWT, `Bearer …`). */
    const [first, ...rest] = redactText(entry.text).split('\n');
    const head = `${formatTime(entry.at)} ${level} ${first}`;
    return rest.length ? [head, ...rest.map((l) => `    ${l.trim()}`)].join('\n') : head;
  }
  const outcome =
    entry.error ??
    (entry.status === undefined ? 'pending' : String(entry.status));
  const took = entry.durationMs === undefined ? '' : ` ${entry.durationMs}ms`;
  const head = `${formatTime(entry.at)} ${entry.method} ${redactUrl(entry.url)} → ${outcome}${took}`;
  /* 🔴 Che ở ĐÂY, không ở chỗ ghi: khối này đi ra ngoài máy (nút Chia sẻ). Bộ đệm giữ URL và
     thân thô để `toCurl` dựng được lệnh chạy thật — bảng chính sách ở đầu `redact.ts`. */
  const req = redactBody(entry.requestBody);
  const res = redactBody(entry.responseBody);
  const body = [req ? `    > ${req}` : '', res ? `    < ${res}` : '']
    .filter(Boolean)
    .join('\n');
  return body ? `${head}\n${body}` : head;
};
