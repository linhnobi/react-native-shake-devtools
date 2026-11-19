import type { DevToolsLocale } from '../../../i18n/types';
import type { BugReport } from '../../bug-report';
import { renderTicketSections } from '../ticket-text';

/** Giới hạn của Slack cho `text` của một khối section/context. */
const SECTION_TEXT_MAX = 3000;

/** Giới hạn của Slack cho `text` của khối `header`. */
const HEADER_TEXT_MAX = 150;

/** Escape ba ký tự Slack hiểu trong mrkdwn: chặn `<!channel>`, `<@U…>` và link do QA gõ vào. */
const escapeMrkdwn = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Đuôi là một thực thể escape dang dở (`&`, `&a`, `&am`, `&amp`, `&l`, `&lt`, `&g`, `&gt`). */
const PARTIAL_ENTITY = /&(?:a|am|amp|l|lt|g|gt)?$/;

/** Cắt `text` còn tối đa `max` ký tự mà không để lại nửa cặp surrogate hay nửa thực thể escape. */
const safeCut = (text: string, max: number): string => {
  let cut = text.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return cut.replace(PARTIAL_ENTITY, '');
};

/**
 * Văn bản đã escape vừa một khối: quá `SECTION_TEXT_MAX` thì cắt và nối `note` ở dòng cuối (tổng vẫn
 * ≤ giới hạn).
 */
const fit = (text: string, note: string): string => {
  if (text.length <= SECTION_TEXT_MAX) return text;
  return `${safeCut(text, SECTION_TEXT_MAX - note.length - 1)}\n${note}`;
};

const section = (text: string) => ({ type: 'section', text: { type: 'mrkdwn', text } });

/** Tiêu đề (không escape) vừa giới hạn của `header`; tiêu đề trống ⇒ mã báo bug. */
const headerTitle = (report: BugReport): string => {
  const title = report.title.trim() || report.id;
  return title.length > HEADER_TEXT_MAX ? `${safeCut(title, HEADER_TEXT_MAX - 1)}…` : title;
};

/**
 * **Chức năng:** chữ dự phòng `text` của tin (thông báo đẩy, client không vẽ được Block Kit): tiêu đề
 * đã cắt ≤ 150 ký tự và escape mrkdwn.
 *
 * **Input:** `report`. **Output:** chuỗi.
 *
 * **Unit test:** `blocks.test.ts` › `toSlackText` — 1 case.
 */
export const toSlackText = (report: BugReport): string => escapeMrkdwn(headerTitle(report));

/**
 * **Chức năng:** đổi bản báo bug thành các khối Block Kit của Slack (spec 5.4.1): `header` là tiêu đề
 * (≤ 150 ký tự, cắt thêm `…`); `section` các bước đánh số; `section` Thực tế; `section` Mong đợi (nếu
 * có); `context` thông tin máy (nếu có); `section` Ngữ cảnh app (nếu có — `khoá: giá trị`, dòng
 * "…và N khoá khác"). Chữ đi qua `escapeMrkdwn` để `<!channel>` hay link do QA
 * gõ không thành mention. Mỗi khối `text` ≤ 3000 ký tự (giới hạn của Slack): dài hơn thì cắt (không
 * cắt đôi emoji hay thực thể `&amp;`) và thêm `truncatedNote` ở dòng cuối. Tiêu đề mục và ghi chú
 * theo `locale` của kết nối.
 *
 * **Input:** `report` · `locale`. **Output:** mảng khối (`unknown[]` — cấu trúc JSON của Slack).
 *
 * @example
 * ```ts
 * toSlackBlocks(report, 'en')[0]; // { type: 'header', text: { type: 'plain_text', text: 'Crash…', emoji: false } }
 * ```
 *
 * **Unit test:** `blocks.test.ts` › `toSlackBlocks` — 12 case: thứ tự khối · bước đánh số · Thực tế/Mong đợi · context
 * thông tin máy · ngôn ngữ vi · bỏ khối trống · escape · cắt 3000 và header 150 · không cắt giữa
 * thực thể · không cắt giữa surrogate · nội dung ngắn không đổi · mục ngữ cảnh app (escape, cắt 3000).
 */
export const toSlackBlocks = (report: BugReport, locale: DevToolsLocale): unknown[] => {
  const t = renderTicketSections(report, locale);
  const note = t.headings.truncatedNote;

  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: headerTitle(report), emoji: false } },
  ];

  if (t.steps.length > 0) {
    const steps = t.steps.map((step, i) => `${i + 1}. ${escapeMrkdwn(step)}`).join('\n');
    blocks.push(section(fit(`*${t.headings.steps}*\n${steps}`, note)));
  }
  blocks.push(section(fit(`*${t.headings.actual}*\n${escapeMrkdwn(t.actual)}`, note)));
  if (t.expected !== undefined) {
    blocks.push(section(fit(`*${t.headings.expected}*\n${escapeMrkdwn(t.expected)}`, note)));
  }
  if (t.environment.length > 0) {
    const lines = t.environment.map(([k, v]) => `*${escapeMrkdwn(k)}:* ${escapeMrkdwn(v)}`);
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: fit(`*${t.headings.environment}*\n${lines.join('\n')}`, note) },
      ],
    });
  }
  if (t.context.length > 0 || t.contextMore !== undefined) {
    const lines = [
      ...t.context.map(([k, v]) => `*${escapeMrkdwn(k)}:* ${escapeMrkdwn(v)}`),
      ...(t.contextMore !== undefined ? [escapeMrkdwn(t.contextMore)] : []),
    ];
    blocks.push(section(fit(`*${t.headings.context}*\n${lines.join('\n')}`, note)));
  }
  return blocks;
};
