import type { BugReport } from '../../bug-report';
import { adfFromText, JIRA_SUMMARY_MAX, toAdf, toJiraSummary, type AdfNode } from './adf';

const report = (over: Partial<BugReport> = {}): BugReport => ({
  id: 'rpt-1',
  createdAt: 0,
  title: 'Crash khi thanh toán',
  subtitle: 'UAT · 1.2.3 (45)',
  steps: [
    { id: 'a', kind: 'screen', at: 1, label: 'Giỏ hàng' },
    { id: 'b', kind: 'tap', at: 2, label: 'Thanh toán', count: 2 },
    { id: 'c', kind: 'text', at: 3, text: 'Mở app lạ' },
  ],
  actual: 'POST /orders → 500',
  expected: 'Thanh toán thành công',
  deviceInfo: [
    ['App', '1.2.3'],
    ['Thiết bị', 'Pixel 8 · Android 14'],
  ],
  files: [],
  ...over,
});

const text = (t: string): AdfNode => ({ type: 'text', text: t });
const para = (t: string): AdfNode => ({ type: 'paragraph', content: [text(t)] });
const heading = (t: string): AdfNode => ({ type: 'heading', attrs: { level: 3 }, content: [text(t)] });
const item = (t: string): AdfNode => ({ type: 'listItem', content: [para(t)] });
const row = (k: string, v: string): AdfNode => ({
  type: 'tableRow',
  content: [
    { type: 'tableHeader', content: [para(k)] },
    { type: 'tableCell', content: [para(v)] },
  ],
});

/** Mọi nút trong cây ADF (kể cả gốc). */
const walk = (node: AdfNode): AdfNode[] => [node, ...(node.content ?? []).flatMap(walk)];

describe('toAdf', () => {
  it('vi: đoạn mô tả, danh sách có thứ tự các bước, Thực tế, Mong đợi, bảng thông tin máy', () => {
    expect(toAdf(report(), 'vi')).toEqual({
      version: 1,
      type: 'doc',
      content: [
        para('UAT · 1.2.3 (45)'),
        heading('Các bước'),
        {
          type: 'orderedList',
          content: [item('Mở màn Giỏ hàng'), item('Chạm "Thanh toán" ×2'), item('Mở app lạ')],
        },
        heading('Kết quả thực tế'),
        para('POST /orders → 500'),
        heading('Kết quả mong đợi'),
        para('Thanh toán thành công'),
        heading('Môi trường'),
        {
          type: 'table',
          /* M1: nhãn thông tin máy theo ngôn ngữ của kết nối; nhãn lạ giữ nguyên. */
          content: [row('Ứng dụng', '1.2.3'), row('Thiết bị', 'Pixel 8 · Android 14')],
        },
      ],
    });
  });

  it('chữ tiếng Việt có dấu và emoji giữ nguyên trong JSON gửi đi', () => {
    const json = JSON.stringify(toAdf(report({ actual: 'Lỗi 🔥 ở bước Thanh toán' }), 'vi'));

    expect(json).toContain('Kết quả thực tế');
    expect(json).toContain('Lỗi 🔥 ở bước Thanh toán');
    expect(json).toContain('Thanh toán thành công');
    expect(json).not.toContain('\\u');
  });

  it('en: tiêu đề mục và câu bước theo ngôn ngữ; bước QA tự gõ không dịch', () => {
    const doc = toAdf(report(), 'en');
    const headings = doc.content
      .filter((n) => n.type === 'heading')
      .map((n) => n.content?.[0]?.text);

    expect(headings).toEqual(['Steps to reproduce', 'Actual result', 'Expected result', 'Environment']);
    expect(JSON.stringify(doc)).toContain('Open screen Giỏ hàng');
    expect(JSON.stringify(doc)).toContain('Mở app lạ');
  });

  it('thiếu subtitle, Mong đợi, thông tin máy, các bước ⇒ bỏ hẳn các mục đó', () => {
    const doc = toAdf(
      report({ subtitle: undefined, expected: undefined, deviceInfo: undefined, steps: [] }),
      'en',
    );

    expect(doc).toEqual({
      version: 1,
      type: 'doc',
      content: [heading('Actual result'), para('POST /orders → 500')],
    });
  });

  it('xuống dòng thành hardBreak; bước trống bị bỏ; không có nút text rỗng (ADF cấm)', () => {
    const doc = toAdf(
      report({
        actual: 'Dòng 1\n\nDòng 3\r\n',
        steps: [
          { id: 'x', kind: 'text', at: 1, text: '   ' },
          { id: 'y', kind: 'text', at: 2, text: 'Bước thật' },
        ],
      }),
      'vi',
    );

    expect(doc.content[2]).toEqual({ type: 'orderedList', content: [item('Bước thật')] });
    expect(doc.content[4]).toEqual({
      type: 'paragraph',
      content: [
        text('Dòng 1'),
        { type: 'hardBreak' },
        { type: 'hardBreak' },
        text('Dòng 3'),
        { type: 'hardBreak' },
      ],
    });
    const texts = walk({ type: 'root', content: doc.content }).filter((n) => n.type === 'text');
    expect(texts.every((n) => typeof n.text === 'string' && n.text.length > 0)).toBe(true);
  });

  it('tiêu đề dài hơn giới hạn summary ⇒ đoạn mô tả giữ nguyên tiêu đề đầy đủ', () => {
    const title = `TypeError: ${'x'.repeat(4990)}`;

    const doc = toAdf(report({ title, subtitle: undefined }), 'en');

    expect(doc.content[0]).toEqual(para(title));
    expect(toAdf(report({ subtitle: undefined }), 'en').content[0]).toEqual(heading('Steps to reproduce'));
  });

  it('ngữ cảnh app ⇒ mục "App context" cuối: bảng khoá–giá trị + đoạn "…and N more keys"', () => {
    const doc = toAdf(
      report({
        appContext: {
          lines: [
            ['userId', 'u-42'],
            ['session', '{"accessToken":"<redacted>"}'],
          ],
          more: 2,
        },
      }),
      'en',
    );

    expect(doc.content.slice(-3)).toEqual([
      heading('App context'),
      { type: 'table', content: [row('userId', 'u-42'), row('session', '{"accessToken":"<redacted>"}')] },
      para('…and 2 more keys'),
    ]);
    expect(toAdf(report(), 'en').content.some((n) => n.content?.[0]?.text === 'App context')).toBe(
      false,
    );
  });
});

describe('toJiraSummary', () => {
  it('thông điệp 5000 ký tự ⇒ cắt còn ≤ 255 ký tự, kết thúc bằng "…" (Review Focus 1)', () => {
    const summary = toJiraSummary(`TypeError: ${'x'.repeat(4990)}`);

    expect(JIRA_SUMMARY_MAX).toBe(255);
    expect(summary.length).toBe(255);
    expect(summary.endsWith('…')).toBe(true);
    expect(summary.startsWith('TypeError: xxx')).toBe(true);
  });

  it('không chẻ đôi emoji ở mốc cắt; vừa 255 ký tự thì giữ nguyên', () => {
    const atEdge = `${'a'.repeat(253)}🔥🔥`;
    const exact = 'b'.repeat(255);

    expect(toJiraSummary(atEdge)).toBe(`${'a'.repeat(253)}…`);
    expect(toJiraSummary(exact)).toBe(exact);
  });

  it('xuống dòng (Jira cấm trong summary) thành dấu cách, bỏ khoảng trắng hai đầu', () => {
    expect(toJiraSummary('  Lỗi thanh toán\r\n  POST /orders → 500 \n')).toBe(
      'Lỗi thanh toán POST /orders → 500',
    );
  });
});

describe('adfFromText', () => {
  it('chuỗi rỗng ⇒ một đoạn không có nút con', () => {
    expect(adfFromText('')).toEqual({ version: 1, type: 'doc', content: [{ type: 'paragraph', content: [] }] });
  });
});
