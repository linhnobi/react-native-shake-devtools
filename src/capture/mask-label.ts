import { redactText } from './redact';

/** Dấu thay cho phần bị che. */
const MASK = '•••';

/** Số ký tự cuối được giữ lại để QA còn nhận ra đang nói tới giá trị nào. */
const KEEP_TAIL = 3;

/**
 * Email: `local@miền.đuôi`. Ký tự cuối của đuôi không được là dấu câu, để "mail qa@x.vn." không
 * nuốt dấu chấm kết câu.
 */
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@.,;:!?)\]]+/g;

/**
 * Chuỗi từ 6 chữ số trở lên, cho phép **một** dấu cách, dấu chấm hoặc gạch nối giữa hai chữ số
 * (`0912 345 678`, `1.250.000`, `0912-345-678`, `4111-1111-1111-1111`). Kết thúc luôn bằng chữ số
 * nên không nuốt dấu cách/chấm/gạch đứng sau. Ngày ISO (`2026-11-06`) cũng bị che — cố ý che dư.
 */
const LONG_DIGITS = /\d(?:[ .-]?\d){5,}/g;

const maskKeepingTail = (match: string): string => `${MASK}${match.slice(-KEEP_TAIL)}`;

/**
 * **Chức năng:** che dữ liệu cá nhân trong một nhãn người đọc (chữ hiển thị, `accessibilityLabel`,
 * placeholder…) trước khi nó vào timeline của bug report. Che hai loại: **email** và **chuỗi từ 6
 * chữ số trở lên** (số điện thoại, CCCD, số thẻ, OTP, tiền lớn — có thể xen dấu cách, dấu chấm hoặc
 * gạch nối).
 * Phần bị che thành `•••` + 3 ký tự cuối. Trước đó, bí mật (JSON có khoá bí mật, JWT, token có tiền
 * tố đã biết) thành `<redacted>` qua `redactText` — nhãn, tên màn và dòng đầu của lỗi đều đi qua đây.
 *
 * Cố ý che dư (vd `1.250.000` đồng cũng bị che): nhãn chỉ để QA nhận ra nút nào, che nhầm số tiền
 * rẻ hơn lộ một số điện thoại.
 *
 * **Input:** `text` — nhãn thô.
 *
 * **Output:** nhãn đã che; không có gì để che thì trả nguyên chuỗi.
 *
 * @example
 * ```ts
 * maskPersonalData('Nguyễn Văn A · 0912 345 678'); // 'Nguyễn Văn A · •••678'
 * maskPersonalData('Call +1-555-123-4567');        // 'Call +•••567'
 * maskPersonalData('qa.lan@khachhang.vn');         // '•••.vn'
 * maskPersonalData('Mã 12345');                    // 'Mã 12345'  (chỉ 5 chữ số)
 * maskPersonalData('Thanh toán');                  // 'Thanh toán'
 * ```
 *
 * **Unit test:** `mask-label.test.ts` — 11 case: JWT và token có tiền tố trong câu lỗi · số điện thoại có dấu cách · email · 5 chữ số giữ
 * nguyên · chữ thường giữ nguyên · số liền và số xen dấu chấm · số xen gạch nối (điện thoại, thẻ) ·
 * ranh giới 5/6 chữ số · nhiều thứ trong một nhãn · dấu câu sau email · chuỗi rỗng.
 */
export function maskPersonalData(text: string): string {
  /* Bí mật trước (JSON in trong câu lỗi, JWT, token có tiền tố — `redactText`): tiêu đề, "Thực tế"
     và bước của báo bug lấy dòng đầu của lỗi qua hàm này rồi gửi lên Jira/Slack. Che trước để JWT
     không bị lớp chữ số bên dưới che dở thành `•••xyz`. Sau đó email (phần số trong email đã bị
     nuốt cả cụm, không bị che hai lần), rồi chuỗi số dài. */
  return redactText(text).replace(EMAIL, maskKeepingTail).replace(LONG_DIGITS, maskKeepingTail);
}
