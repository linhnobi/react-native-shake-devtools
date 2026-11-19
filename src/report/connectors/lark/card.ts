import { devtoolsStrings, translate } from '../../../i18n/translate';
import type { DevToolsLocale } from '../../../i18n/types';
import type { BugReport } from '../../bug-report';
import { clipText } from '../../steps';
import { utf8Bytes } from '../encoding';
import { renderTicketSections } from '../ticket-text';

/** Thân tin của bot nhóm Lark tối đa 20 KB (spec 5.4.1). */
export const LARK_BODY_MAX_BYTES = 20 * 1024;

/**
 * Ngân sách của riêng **thẻ** khi gửi qua webhook: chừa 512 byte cho phần bao (`msg_type`,
 * `timestamp`, `sign` — thực tế chưa tới 200 byte) để cả thân luôn ≤ 20 KB.
 */
export const LARK_CARD_MAX_BYTES = LARK_BODY_MAX_BYTES - 512;

/**
 * Ngân sách của thẻ khi gửi bằng app (`im/v1/messages`): thẻ bị nhét vào `content` **dưới dạng chuỗi
 * JSON**, mỗi dấu `"` và `\n` nở gấp đôi khi escape, mà tin thẻ tối đa 30 KB ⇒ 14 KB là mức an toàn
 * kể cả khi nội dung toàn dấu nháy/xuống dòng.
 */
export const LARK_APP_CARD_MAX_BYTES = 14 * 1024;

/** Tiêu đề thẻ tối đa chừng này ký tự (bằng mức gợi ý tiêu đề của form). */
const TITLE_MAX_CHARS = 120;

/** Ghi chú bản build (subtitle) tối đa chừng này ký tự. */
const SUBTITLE_MAX_CHARS = 200;

/** Một phần tử của thẻ (schema 1.0, bot nhóm `interactive` và tin `interactive` của app). */
export type LarkCardElement =
  | { tag: 'div'; text: { tag: 'lark_md' | 'plain_text'; content: string } }
  | { tag: 'img'; img_key: string; alt: { tag: 'plain_text'; content: string } }
  | { tag: 'note'; elements: Array<{ tag: 'plain_text'; content: string }> };

/** Thẻ tin nhắn Lark/Feishu. */
export interface LarkCard {
  readonly config: { readonly wide_screen_mode: boolean };
  readonly header: {
    readonly title: { readonly tag: 'plain_text'; readonly content: string };
    readonly template: string;
  };
  readonly elements: LarkCardElement[];
}

/** Một mục chữ của thẻ: tiêu đề in đậm + thân (thân rỗng thì bỏ cả mục khỏi thẻ). */
interface Section {
  readonly heading: string;
  readonly body: string;
}

/** Số byte UTF-8 của `s` khi nằm trong chuỗi JSON (đã tính escape, bỏ hai dấu nháy bao). */
const jsonBytes = (s: string): number => utf8Bytes(JSON.stringify(s)).length - 2;

const bytesOf = (value: unknown): number => utf8Bytes(JSON.stringify(value)).length;

/** Lấy `n` đơn vị UTF-16 đầu, không chẻ đôi cặp surrogate. */
const head = (text: string, n: number): string => {
  let cut = text.slice(0, n);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
};

/** Cắt `text` (kèm `…`) sao cho `jsonBytes` ≤ `budget`; không đủ chỗ cho cả `…` ⇒ chuỗi rỗng. */
const clipToBytes = (text: string, budget: number): string => {
  if (jsonBytes(text) <= budget) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (jsonBytes(`${head(text, mid)}…`) <= budget) lo = mid;
    else hi = mid - 1;
  }
  const clipped = `${head(text, lo)}…`;
  return jsonBytes(clipped) <= budget ? clipped : '';
};

/** Chia `avail` byte cho các thân: thân ngắn lấy đủ, phần dư dồn cho thân dài (water-filling). */
const allocate = (sizes: readonly number[], avail: number): number[] => {
  const order = sizes.map((size, i) => ({ size, i })).sort((a, b) => a.size - b.size);
  const out = new Array<number>(sizes.length).fill(0);
  let remaining = Math.max(0, avail);
  order.forEach(({ size, i }, rank) => {
    const share = Math.floor(remaining / (order.length - rank));
    out[i] = Math.min(size, share);
    remaining -= out[i];
  });
  return out;
};

const note = (content: string): LarkCardElement => ({
  tag: 'note',
  elements: [{ tag: 'plain_text', content }],
});

/**
 * **Chức năng:** dựng **thẻ** (`interactive`) Lark/Feishu cho một bản báo bug — dùng cho cả bot nhóm
 * (webhook) lẫn app. Thứ tự: ảnh (nếu có `imageKey`) · Các bước (đánh số) · Kết quả thực tế · Kết
 * quả mong đợi (nếu có) · Môi trường (`khoá: giá trị`) · Ngữ cảnh app (nếu có, `khoá: giá trị` + dòng
 * "…và N khoá khác") · ghi chú bản build (`subtitle`). Tiêu đề mục
 * theo `locale` của **kết nối** (spec 11.2). Thân mục là `plain_text` nên chữ của QA không bị hiểu
 * thành markdown.
 *
 * **Giới hạn kích thước (Review Focus 1):** thân bot nhóm tối đa 20 KB, bug 200 bước × 200 ký tự dễ
 * vượt. Tổng JSON của thẻ (đo bằng **byte UTF-8**, đã tính escape) phải ≤ `maxBytes`; vượt ⇒ thêm câu
 * "đã cắt bớt" (`truncatedNote`), rồi chia phần byte còn lại cho các mục theo kiểu water-filling
 * (mục ngắn giữ đủ, mục dài bị cắt đuôi thêm `…`, không chẻ cặp surrogate của emoji) — nhờ vậy mục
 * "Thực tế" không bị mục "Các bước" dài nuốt mất. Tiêu đề cắt ở 120 ký tự. `maxBytes` nhỏ tới mức
 * ngay cả khung (tiêu đề, tiêu đề mục, ghi chú) cũng không vừa ⇒ trả khung với các thân rỗng.
 *
 * **Input:** `report` · `locale` · `opts.imageKey` (`image_key` từ `im/v1/images`) · `opts.maxBytes`
 * (mặc định `LARK_CARD_MAX_BYTES`) · `opts.attachmentsNote` (thêm câu "file đính kèm không gửi được
 * qua kênh này" — dùng ở mức webhook khi bản báo có file).
 * **Output:** `LarkCard`.
 *
 * @example
 * ```ts
 * JSON.stringify({ msg_type: 'interactive', card: toLarkCard(report, 'vi', { attachmentsNote: true }) });
 * ```
 *
 * **Unit test:** `card.test.ts` — 13 case: mục đủ (en) · vi và thiếu mong đợi · thiếu deviceInfo ·
 * `imageKey` · `attachmentsNote` · subtitle · 200 bước × 200 ký tự (≤ ngân sách + câu cắt, "Thực tế"
 * còn) · lỗi 5000 ký tự tiếng Việt + emoji · không chẻ surrogate · vừa ngân sách thì không cắt ·
 * ngân sách cực nhỏ · mục ngữ cảnh app · ngữ cảnh dài + 200 bước vẫn ≤ ngân sách.
 */
export const toLarkCard = (
  report: BugReport,
  locale: DevToolsLocale,
  opts: { imageKey?: string; maxBytes?: number; attachmentsNote?: boolean },
): LarkCard => {
  const maxBytes = opts.maxBytes ?? LARK_CARD_MAX_BYTES;
  const sections = renderTicketSections(report, locale);
  const { headings } = sections;

  const bodies: Section[] = [
    {
      heading: headings.steps,
      body: sections.steps.map((step, i) => `${i + 1}. ${step}`).join('\n'),
    },
    { heading: headings.actual, body: sections.actual },
    ...(sections.expected !== undefined
      ? [{ heading: headings.expected, body: sections.expected }]
      : []),
    {
      heading: headings.environment,
      body: sections.environment.map(([key, value]) => `${key}: ${value}`).join('\n'),
    },
    {
      heading: headings.context,
      body: [
        ...sections.context.map(([key, value]) => `${key}: ${value}`),
        ...(sections.contextMore !== undefined ? [sections.contextMore] : []),
      ].join('\n'),
    },
  ].filter((s) => s.body.trim() !== '');

  const title = clipText(report.title, TITLE_MAX_CHARS);
  const alt = translate(devtoolsStrings[locale], 'connections.lark.imageAlt');
  const subtitle =
    report.subtitle?.trim() ? clipText(report.subtitle.trim(), SUBTITLE_MAX_CHARS) : undefined;

  const build = (texts: readonly string[], truncated: boolean): LarkCard => {
    const elements: LarkCardElement[] = [];
    if (opts.imageKey !== undefined) {
      elements.push({
        tag: 'img',
        img_key: opts.imageKey,
        alt: { tag: 'plain_text', content: alt },
      });
    }
    bodies.forEach((section, i) => {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${section.heading}**` } });
      if (texts[i] !== '') {
        elements.push({ tag: 'div', text: { tag: 'plain_text', content: texts[i] } });
      }
    });
    if (truncated) elements.push(note(headings.truncatedNote));
    if (opts.attachmentsNote === true) elements.push(note(headings.attachmentsNote));
    if (subtitle !== undefined) elements.push(note(subtitle));
    return {
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: title }, template: 'red' },
      elements,
    };
  };

  const full = build(
    bodies.map((s) => s.body),
    false,
  );
  if (bytesOf(full) <= maxBytes) return full;

  // Khung (tiêu đề, tiêu đề mục, ghi chú) tính với thân giả 1 ký tự để phần overhead của mỗi div thân
  // đã nằm trong `base`; phần còn lại chia cho các thân.
  const base = bytesOf(
    build(
      bodies.map(() => 'x'),
      true,
    ),
  );
  const sizes = bodies.map((s) => jsonBytes(s.body));
  let avail = maxBytes - base;
  for (;;) {
    const shares = allocate(sizes, avail);
    const card = build(
      bodies.map((s, i) => clipToBytes(s.body, shares[i])),
      true,
    );
    // Phòng hờ chênh lệch do escape: co dần phần ngân sách cho thân tới khi vừa.
    if (bytesOf(card) <= maxBytes || avail <= 0) return card;
    avail = Math.floor(avail * 0.9) - 1;
  }
};
