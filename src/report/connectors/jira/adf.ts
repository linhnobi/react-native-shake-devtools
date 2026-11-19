import type { DevToolsLocale } from '../../../i18n/types';
import type { BugReport } from '../../bug-report';
import { clipText } from '../../steps';
import { renderTicketSections } from '../ticket-text';

/**
 * Atlassian Document Format (ADF) — định dạng Jira Cloud bắt buộc cho `description`, `environment`
 * và trường textarea ở REST v3 (spec 5.4.1). Chỉ khai phần lib dùng: đoạn, tiêu đề, danh sách có thứ
 * tự, bảng, chữ, xuống dòng.
 */
export interface AdfNode {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly AdfNode[];
  readonly text?: string;
}

/** Gốc một tài liệu ADF. */
export interface AdfDoc {
  readonly version: 1;
  readonly type: 'doc';
  readonly content: readonly AdfNode[];
}

/** Giới hạn ký tự của `summary` ở Jira (đếm theo đơn vị UTF-16, như `String.length` của Java). */
export const JIRA_SUMMARY_MAX = 255;

/**
 * Một đoạn ADF từ chữ thường: mỗi dấu xuống dòng thành `hardBreak`. ADF cấm nút `text` rỗng nên
 * dòng trống chỉ để lại `hardBreak`; chuỗi rỗng ⇒ đoạn không có nút con (hợp lệ).
 */
const paragraph = (text: string): AdfNode => {
  const content: AdfNode[] = [];
  text.split(/\r\n|\r|\n/).forEach((line, i) => {
    if (i > 0) content.push({ type: 'hardBreak' });
    if (line !== '') content.push({ type: 'text', text: line });
  });
  return { type: 'paragraph', content };
};

const heading = (text: string): AdfNode => ({
  type: 'heading',
  attrs: { level: 3 },
  content: [{ type: 'text', text }],
});

const blank = (text: string | undefined): boolean => text === undefined || text.trim() === '';

/** Bảng hai cột: khoá ở ô tiêu đề hàng, giá trị ở ô thường. */
const table = (rows: ReadonlyArray<readonly [string, string]>): AdfNode => ({
  type: 'table',
  content: rows.map(([key, value]) => ({
    type: 'tableRow',
    content: [
      { type: 'tableHeader', content: [paragraph(key)] },
      { type: 'tableCell', content: [paragraph(value)] },
    ],
  })),
});

/**
 * **Chức năng:** tài liệu ADF gồm **một đoạn** chữ (xuống dòng ⇒ `hardBreak`) — giá trị cho trường
 * textarea của Jira.
 *
 * **Input:** `text`. **Output:** `AdfDoc`.
 *
 * @example
 * ```ts
 * adfFromText('a\nb'); // { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [a, hardBreak, b] }] }
 * adfFromText('');     // ca biên: một đoạn không có nút con
 * ```
 *
 * **Unit test:** `adf.test.ts` › `adfFromText` — 1 case: chuỗi rỗng; dạng nhiều dòng kiểm ở
 * `fields.test.ts` (textarea) và `toAdf`.
 */
export const adfFromText = (text: string): AdfDoc => ({
  version: 1,
  type: 'doc',
  content: [paragraph(text)],
});

/**
 * **Chức năng:** `summary` của issue Jira từ tiêu đề bản báo: xuống dòng (Jira từ chối summary có
 * ký tự xuống dòng) thành một dấu cách, bỏ khoảng trắng hai đầu, cắt còn tối đa
 * {@link JIRA_SUMMARY_MAX} ký tự kèm `…` mà không chẻ đôi emoji (Review Focus 1). Tiêu đề đầy đủ vẫn
 * nằm trong `description` (xem `toAdf`).
 *
 * **Input:** `title`. **Output:** chuỗi một dòng, dài ≤ 255.
 *
 * @example
 * ```ts
 * toJiraSummary('Lỗi\nPOST /orders → 500'); // 'Lỗi POST /orders → 500'
 * toJiraSummary('x'.repeat(5000)).length;    // ca biên: 255, kết thúc bằng '…'
 * ```
 *
 * **Unit test:** `adf.test.ts` › `toJiraSummary` — 3 case: 5000 ký tự · emoji ở mốc cắt và vừa 255 ·
 * xuống dòng thành dấu cách.
 */
export const toJiraSummary = (title: string): string =>
  clipText(title.replace(/\s*[\r\n]+\s*/g, ' ').trim(), JIRA_SUMMARY_MAX);

/**
 * **Chức năng:** dựng `description` (ADF) của issue Jira từ bản báo, theo `locale` của **kết nối**
 * (spec 11.2). Thứ tự:
 *
 * 1. **Đoạn mô tả** (nếu có): tiêu đề đầy đủ khi dài hơn giới hạn `summary` (để không mất chữ khi
 *    summary bị cắt), rồi `subtitle` (dòng bản build của app).
 * 2. Tiêu đề "Các bước" + **danh sách có thứ tự** — bước trống bị bỏ; không còn bước nào ⇒ bỏ mục.
 * 3. "Kết quả thực tế" + đoạn (bỏ mục nếu trống).
 * 4. "Kết quả mong đợi" + đoạn (chỉ khi QA điền).
 * 5. "Môi trường" + **bảng** hai cột (khoá ở ô tiêu đề hàng, giá trị ở ô thường) — khi có `deviceInfo`.
 * 6. "Ngữ cảnh app" + bảng hai cột như trên + đoạn "…và N khoá khác" — khi có `appContext` (đã che
 *    lúc chụp; bản đủ ở file đính kèm `context.json`).
 *
 * Chữ (có dấu, emoji) đi nguyên văn; xuống dòng thành `hardBreak`; không có nút `text` rỗng.
 *
 * **Input:** `report` · `locale`. **Output:** `AdfDoc`.
 *
 * @example
 * ```ts
 * toAdf(report, 'vi').content[1]; // { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Các bước' }] }
 * ```
 *
 * **Unit test:** `adf.test.ts` › `toAdf` — 7 case: cấu trúc đầy đủ (vi) · chữ có dấu/emoji giữ
 * nguyên · en · thiếu các mục tuỳ chọn · xuống dòng, bước trống, không `text` rỗng · tiêu đề quá dài
 * vào đoạn mô tả · mục ngữ cảnh app.
 */
export const toAdf = (report: BugReport, locale: DevToolsLocale): AdfDoc => {
  const s = renderTicketSections(report, locale);
  const content: AdfNode[] = [];

  const { title, subtitle } = report;
  if (title.length > JIRA_SUMMARY_MAX) content.push(paragraph(title));
  if (subtitle !== undefined && !blank(subtitle)) content.push(paragraph(subtitle));

  const steps = s.steps.filter((step) => !blank(step));
  if (steps.length > 0) {
    content.push(heading(s.headings.steps), {
      type: 'orderedList',
      content: steps.map((step) => ({ type: 'listItem', content: [paragraph(step)] })),
    });
  }

  if (!blank(s.actual)) content.push(heading(s.headings.actual), paragraph(s.actual));
  if (s.expected !== undefined) content.push(heading(s.headings.expected), paragraph(s.expected));

  if (s.environment.length > 0) {
    content.push(heading(s.headings.environment), table(s.environment));
  }

  if (s.context.length > 0 || s.contextMore !== undefined) {
    content.push(heading(s.headings.context));
    if (s.context.length > 0) content.push(table(s.context));
    if (s.contextMore !== undefined) content.push(paragraph(s.contextMore));
  }

  return { version: 1, type: 'doc', content };
};
