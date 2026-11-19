import type { BugReport } from '../../bug-report';
import { toSlackBlocks, toSlackText } from './blocks';

const report = (over: Partial<BugReport> = {}): BugReport => ({
  id: 'rpt-1',
  createdAt: 1_700_000_000_000,
  title: 'Crash khi thanh toán',
  steps: [
    { id: 'a', kind: 'tap', at: 1, label: 'Pay' },
    { id: 'b', kind: 'text', at: 2, text: 'Mở app lạ' },
  ],
  actual: 'POST /orders → 500',
  expected: 'Thanh toán thành công',
  deviceInfo: [
    ['App', '1.2.3'],
    ['OS', 'iOS 18'],
  ],
  files: [],
  ...over,
});

type Block = {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{ type: string; text: string }>;
};

const blocks = (r: BugReport, locale: 'vi' | 'en' = 'en') => toSlackBlocks(r, locale) as Block[];

describe('toSlackBlocks', () => {
  it('header là tiêu đề, theo sau là các section và khối context', () => {
    const out = blocks(report());
    expect(out.map((b) => b.type)).toEqual(['header', 'section', 'section', 'section', 'context']);
    expect(out[0].text).toEqual({ type: 'plain_text', text: 'Crash khi thanh toán', emoji: false });
  });

  it('section các bước đánh số, giữ chữ QA đã sửa', () => {
    const steps = blocks(report())[1].text?.text ?? '';
    expect(steps.startsWith('*Steps to reproduce*\n1. ')).toBe(true);
    expect(steps).toContain('\n2. Mở app lạ');
  });

  it('section Thực tế và Mong đợi', () => {
    const out = blocks(report());
    expect(out[2].text?.text).toBe('*Actual result*\nPOST /orders → 500');
    expect(out[3].text?.text).toBe('*Expected result*\nThanh toán thành công');
  });

  it('khối context chứa thông tin máy', () => {
    const ctx = blocks(report())[4];
    expect(ctx.elements?.[0].type).toBe('mrkdwn');
    expect(ctx.elements?.[0].text).toBe('*Environment*\n*App:* 1.2.3\n*OS:* iOS 18');
  });

  it('dùng ngôn ngữ vi cho tiêu đề mục', () => {
    const out = blocks(report(), 'vi');
    expect(out[2].text?.text.startsWith('*Kết quả thực tế*')).toBe(true);
  });

  it('bỏ Mong đợi khi trống, bỏ context khi không có thông tin máy, bỏ bước khi không có', () => {
    const out = blocks(report({ expected: '  ', deviceInfo: undefined, steps: [] }));
    expect(out.map((b) => b.type)).toEqual(['header', 'section']);
  });

  it('escape & < > để không bị Slack hiểu là mention hoặc link', () => {
    const out = blocks(report({ actual: 'a & b <!channel> <http://x|y>' }));
    expect(out[2].text?.text).toBe(
      '*Actual result*\na &amp; b &lt;!channel&gt; &lt;http://x|y&gt;',
    );
  });

  it('mỗi khối text dài hơn 3000 ký tự bị cắt và có ghi chú', () => {
    const out = blocks(report({ actual: 'x'.repeat(5000), title: 'T'.repeat(5000) }));
    for (const b of out) {
      expect((b.text?.text ?? b.elements?.[0].text ?? '').length).toBeLessThanOrEqual(3000);
    }
    expect(out[2].text?.text.endsWith('(Content was truncated.)')).toBe(true);
    // header của Slack tối đa 150 ký tự
    expect((out[0].text?.text ?? '').length).toBeLessThanOrEqual(150);
  });

  it('không cắt giữa một thực thể escape', () => {
    // "*Actual result*\n" (16 ký tự) + 2955 chữ x = 2971; mốc cắt là 3000 - 24 (ghi chú) - 1 = 2975,
    // rơi vào giữa "&amp;" đầu tiên (2971..2975)
    const out = blocks(report({ actual: `${'x'.repeat(2955)}${'&'.repeat(30)}` }));
    const text = out[2].text?.text ?? '';
    expect(text.length).toBeLessThanOrEqual(3000);
    expect(text.replace(/&amp;/g, '')).not.toMatch(/&/);
    expect(text.endsWith('(Content was truncated.)')).toBe(true);
  });

  it('không cắt đôi một cặp surrogate (emoji)', () => {
    const out = blocks(report({ actual: '😀'.repeat(2000) }));
    const text = out[2].text?.text ?? '';
    expect(text.length).toBeLessThanOrEqual(3000);
    expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('nội dung ngắn không bị đổi', () => {
    const out = blocks(report());
    expect(JSON.stringify(out)).not.toContain('truncated');
  });

  it('ngữ cảnh app ⇒ section "App context" cuối: mỗi khoá một dòng, escape, dòng "…and N more"; vừa 3000', () => {
    const out = blocks(
      report({
        appContext: {
          lines: [
            ['userId', 'u-42'],
            ['note', '<!channel> & co'],
          ],
          more: 1,
        },
      }),
    );
    const last = out[out.length - 1];
    expect(last.type).toBe('section');
    expect(last.text?.text).toBe(
      '*App context*\n*userId:* u-42\n*note:* &lt;!channel&gt; &amp; co\n…and 1 more key',
    );

    const long = blocks(
      report({
        appContext: {
          lines: Array.from({ length: 10 }, (_, i): [string, string] => [`k${i}`, 'v'.repeat(400)]),
          more: 0,
        },
      }),
    );
    const text = long[long.length - 1].text?.text ?? '';
    expect(text.length).toBeLessThanOrEqual(3000);
    expect(text.endsWith('(Content was truncated.)')).toBe(true);
    expect(blocks(report()).some((b) => b.text?.text.includes('App context'))).toBe(false);
  });
});

describe('toSlackText', () => {
  it('tiêu đề đã cắt 150 và escape', () => {
    expect(toSlackText(report({ title: 'A <b> & C' }))).toBe('A &lt;b&gt; &amp; C');
    expect(toSlackText(report({ title: 'T'.repeat(5000) })).length).toBe(150);
    expect(toSlackText(report({ title: '  ' }))).toBe('rpt-1');
  });
});
