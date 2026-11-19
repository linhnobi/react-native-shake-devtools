import type { BugReport } from '../../bug-report';
import { utf8Bytes } from '../encoding';
import { LARK_BODY_MAX_BYTES, LARK_CARD_MAX_BYTES, toLarkCard } from './card';

const report = (over: Partial<BugReport> = {}): BugReport => ({
  id: 'rpt-1',
  createdAt: 1_700_000_000_000,
  title: 'Crash khi thanh toán',
  steps: [
    { id: 'a', kind: 'screen', at: 1, label: 'Cart' },
    { id: 'b', kind: 'tap', at: 2, label: 'Pay' },
  ],
  actual: 'POST /orders → 500',
  expected: 'Thanh toán thành công',
  deviceInfo: [
    ['App', '1.2.3'],
    ['OS', 'Android 14'],
  ],
  files: [],
  ...over,
});

const bytes = (value: unknown) => utf8Bytes(JSON.stringify(value)).length;
const text = (card: object) => JSON.stringify(card);

type Card = {
  header: { title: { content: string } };
  elements: Array<{ tag: string; img_key?: string; text?: { tag: string; content: string } }>;
};

describe('toLarkCard', () => {
  it('có tiêu đề, các bước, thực tế, mong đợi và thông tin máy (en)', () => {
    const card = toLarkCard(report(), 'en', {}) as Card;
    const json = text(card);

    expect(card.header.title.content).toBe('Crash khi thanh toán');
    expect(json).toContain('Steps to reproduce');
    expect(json).toContain('1. Open screen Cart');
    expect(json).toContain('2. Tap \\"Pay\\"');
    expect(json).toContain('Actual result');
    expect(json).toContain('POST /orders → 500');
    expect(json).toContain('Expected result');
    expect(json).toContain('Environment');
    expect(json).toContain('OS: Android 14');
    expect(json).not.toContain('truncated');
  });

  it('vi: tiêu đề mục tiếng Việt; mong đợi trống thì không có mục Mong đợi', () => {
    const json = text(toLarkCard(report({ expected: undefined }), 'vi', {}));
    expect(json).toContain('Các bước');
    expect(json).toContain('Kết quả thực tế');
    expect(json).not.toContain('Kết quả mong đợi');
  });

  it('không có deviceInfo thì không có mục Môi trường', () => {
    const json = text(toLarkCard(report({ deviceInfo: undefined }), 'en', {}));
    expect(json).not.toContain('Environment');
  });

  it('có imageKey ⇒ có phần tử ảnh; không có ⇒ không', () => {
    const withImage = toLarkCard(report(), 'en', { imageKey: 'img_v2_abc' }) as Card;
    const img = withImage.elements.find((e) => e.tag === 'img');
    expect(img?.img_key).toBe('img_v2_abc');
    expect(withImage.elements[0].tag).toBe('img');

    const without = toLarkCard(report(), 'en', {}) as Card;
    expect(without.elements.some((e) => e.tag === 'img')).toBe(false);
  });

  it('attachmentsNote ⇒ thêm câu "không gửi được file" (mức webhook)', () => {
    expect(text(toLarkCard(report(), 'en', { attachmentsNote: true }))).toContain(
      'Attachments cannot be sent through this channel.',
    );
    expect(text(toLarkCard(report(), 'en', {}))).not.toContain('Attachments cannot');
  });

  it('subtitle (bản build) hiện ở dòng ghi chú cuối thẻ', () => {
    const card = toLarkCard(report({ subtitle: 'UAT · 1.0.2' }), 'en', {}) as Card;
    expect(card.elements[card.elements.length - 1].tag).toBe('note');
    expect(text(card)).toContain('UAT · 1.0.2');
  });

  it('bug 200 bước × 200 ký tự: thẻ ≤ ngân sách, có câu "đã cắt bớt" (Review Focus 1)', () => {
    const steps = Array.from({ length: 200 }, (_, i) => ({
      id: `s${i}`,
      kind: 'text' as const,
      at: i,
      text: `${i}-${'x'.repeat(199 - String(i).length)}`,
    }));
    const big = report({ steps, actual: 'e'.repeat(3000) });
    expect(steps.every((s) => s.text.length === 200)).toBe(true);

    const card = toLarkCard(big, 'en', {});
    expect(bytes(card)).toBeLessThanOrEqual(LARK_CARD_MAX_BYTES);
    expect(LARK_CARD_MAX_BYTES).toBeLessThan(LARK_BODY_MAX_BYTES);
    expect(text(card)).toContain('(Content was truncated.)');
    expect(text(card)).toContain('1. 0-xxx');
    expect(text(card)).toContain('Actual result');
    // Mục "Thực tế" vẫn còn dù mục Các bước quá dài.
    expect(text(card)).toContain('eeeeeeee');
  });

  it('thông điệp lỗi 5000 ký tự tiếng Việt có dấu và emoji vẫn vừa (Review Focus 1, 2)', () => {
    const actual = 'Lỗi thanh toán 💥 đơn hàng '.repeat(300).slice(0, 5000);
    const card = toLarkCard(
      report({ actual, title: 'T'.repeat(5000) }),
      'vi',
      { maxBytes: 4096 },
    ) as Card;
    expect(bytes(card)).toBeLessThanOrEqual(4096);
    expect(card.header.title.content.length).toBeLessThanOrEqual(120);
    expect(text(card)).toContain('(Nội dung đã bị cắt bớt.)');
  });

  it('cắt không làm vỡ cặp surrogate của emoji (JSON vẫn parse được, không có ký tự lẻ)', () => {
    const card = toLarkCard(report({ actual: '💥'.repeat(5000) }), 'en', { maxBytes: 3000 });
    const json = text(card);
    expect(bytes(card)).toBeLessThanOrEqual(3000);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).not.toMatch(/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i);
  });

  it('nội dung vừa ngân sách thì giữ nguyên, không cắt', () => {
    const json = text(toLarkCard(report(), 'en', { maxBytes: 20 * 1024 }));
    expect(json).not.toContain('truncated');
  });

  it('ngân sách cực nhỏ không treo và vẫn trả thẻ hợp lệ', () => {
    const card = toLarkCard(report(), 'en', { maxBytes: 10 }) as Card;
    expect(card.header.title.content).toBe('Crash khi thanh toán');
  });

  it('ngữ cảnh app ⇒ mục "App context" sau Môi trường (`khoá: giá trị`, dòng "…and N more")', () => {
    const card = toLarkCard(
      report({
        appContext: {
          lines: [
            ['userId', 'u-42'],
            ['flags', '{"newCheckout":true}'],
          ],
          more: 3,
        },
      }),
      'en',
      {},
    ) as Card;
    const contents = card.elements.map((e) => e.text?.content);

    const at = contents.indexOf('**App context**');
    expect(at).toBeGreaterThan(contents.indexOf('**Environment**'));
    expect(contents[at + 1]).toBe('userId: u-42\nflags: {"newCheckout":true}\n…and 3 more keys');
    expect(text(toLarkCard(report(), 'en', {}))).not.toContain('App context');
  });

  it('ngữ cảnh app dài + 200 bước: thẻ vẫn ≤ ngân sách 20 KB của bot nhóm, "Thực tế" vẫn còn', () => {
    const steps = Array.from({ length: 200 }, (_, i) => ({
      id: `s${i}`,
      kind: 'text' as const,
      at: i,
      text: 'x'.repeat(200),
    }));
    const lines = Array.from({ length: 10 }, (_, i): [string, string] => [`k${i}`, 'v'.repeat(100)]);
    const card = toLarkCard(report({ steps, actual: 'e'.repeat(2000), appContext: { lines, more: 0 } }), 'en', {});

    expect(bytes(card)).toBeLessThanOrEqual(LARK_CARD_MAX_BYTES);
    expect(text(card)).toContain('App context');
    expect(text(card)).toContain('k0: vvvv');
    expect(text(card)).toContain('eeeeeeee');
  });
});
