import type { BugReport } from '../bug-report';
import { renderTicketSections } from './ticket-text';

const report = (over: Partial<BugReport> = {}): BugReport => ({
  id: 'rpt-1',
  createdAt: 0,
  title: 'Crash khi thanh toán',
  steps: [
    { id: 'a', kind: 'screen', at: 1, label: 'Cart' },
    { id: 'b', kind: 'tap', at: 2, label: 'Pay', count: 2 },
    { id: 'c', kind: 'text', at: 3, text: 'Mở app lạ' },
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

describe('renderTicketSections', () => {
  it('vi: tiêu đề mục và câu bước bằng tiếng Việt', () => {
    const sections = renderTicketSections(report(), 'vi');

    expect(sections.headings).toEqual({
      steps: 'Các bước',
      actual: 'Kết quả thực tế',
      expected: 'Kết quả mong đợi',
      environment: 'Môi trường',
      context: 'Ngữ cảnh app',
      attachmentsNote: 'File đính kèm không gửi được qua kênh này.',
      truncatedNote: '(Nội dung đã bị cắt bớt.)',
    });
    expect(sections.steps[0]).toBe('Mở màn Cart');
    expect(sections.steps[1]).toBe('Chạm "Pay" ×2');
  });

  it('en: tiêu đề mục và câu bước bằng tiếng Anh', () => {
    const sections = renderTicketSections(report(), 'en');

    expect(sections.headings.steps).toBe('Steps to reproduce');
    expect(sections.headings.actual).toBe('Actual result');
    expect(sections.headings.expected).toBe('Expected result');
    expect(sections.headings.environment).toBe('Environment');
    expect(sections.steps[0]).toBe('Open screen Cart');
    expect(sections.steps[1]).toBe('Tap "Pay" ×2');
  });

  it('bước `text` giữ nguyên chữ ở cả hai ngôn ngữ', () => {
    expect(renderTicketSections(report(), 'vi').steps[2]).toBe('Mở app lạ');
    expect(renderTicketSections(report(), 'en').steps[2]).toBe('Mở app lạ');
  });

  it('trả `actual`, `expected` và `environment` đúng như báo cáo', () => {
    const sections = renderTicketSections(report(), 'en');

    expect(sections.actual).toBe('POST /orders → 500');
    expect(sections.expected).toBe('Thanh toán thành công');
    expect(sections.environment).toEqual([
      ['App', '1.2.3'],
      ['OS', 'Android 14'],
    ]);
  });

  it('nhãn thông tin máy theo ngôn ngữ của kết nối (spec 11.2); nhãn lạ giữ nguyên', () => {
    const r = report({
      deviceInfo: [
        ['App', '1.2.3'],
        ['Env', 'UAT'],
        ['Device', 'Pixel 8'],
        ['OS', 'Android 14'],
        ['User', 'qa•••com'],
        ['Session', '2026-11-06 10:00:00 +07:00'],
        ['Build', '58'],
      ],
    });

    expect(renderTicketSections(r, 'vi').environment).toEqual([
      ['Ứng dụng', '1.2.3'],
      ['Môi trường', 'UAT'],
      ['Thiết bị', 'Pixel 8'],
      ['Hệ điều hành', 'Android 14'],
      ['Người dùng', 'qa•••com'],
      ['Phiên', '2026-11-06 10:00:00 +07:00'],
      ['Build', '58'],
    ]);
    expect(renderTicketSections(r, 'en').environment.map(([k]) => k)).toEqual([
      'App',
      'Env',
      'Device',
      'OS',
      'User',
      'Session',
      'Build',
    ]);
  });

  it('thiếu hoặc trống `expected` ⇒ không có khoá `expected`; thiếu `deviceInfo` ⇒ environment rỗng', () => {
    const none = renderTicketSections(report({ expected: undefined, deviceInfo: undefined }), 'en');
    const blank = renderTicketSections(report({ expected: '   ' }), 'en');

    expect('expected' in none).toBe(false);
    expect(none.environment).toEqual([]);
    expect('expected' in blank).toBe(false);
  });

  it('ngữ cảnh app ⇒ mục "App context" (tiêu đề theo ngôn ngữ kết nối, dòng giữ nguyên) + dòng "còn N khoá"', () => {
    const r = report({
      appContext: {
        lines: [
          ['userId', 'u-42'],
          ['flags', '{"newCheckout":true}'],
        ],
        more: 3,
      },
    });

    const en = renderTicketSections(r, 'en');
    expect(en.headings.context).toBe('App context');
    expect(en.context).toEqual([
      ['userId', 'u-42'],
      ['flags', '{"newCheckout":true}'],
    ]);
    expect(en.contextMore).toBe('…and 3 more keys');
    expect(renderTicketSections(report({ appContext: { lines: [], more: 1 } }), 'en').contextMore).toBe(
      '…and 1 more key',
    );
    expect(renderTicketSections(r, 'vi').contextMore).toBe('…và 3 khoá khác');
  });

  it('không có ngữ cảnh, hoặc ngữ cảnh hỏng (file hàng đợi sửa tay/hỏng) ⇒ mục rỗng, không ném', () => {
    const none = renderTicketSections(report(), 'en');
    expect(none.context).toEqual([]);
    expect('contextMore' in none).toBe(false);

    const broken = renderTicketSections(
      report({
        appContext: {
          lines: [['ok', 'yes'], null, ['onlyKey'], [1, 2], 'x'] as unknown as Array<[string, string]>,
          more: -2,
        },
      }),
      'en',
    );
    expect(broken.context).toEqual([['ok', 'yes']]);
    expect('contextMore' in broken).toBe(false);
    expect(
      renderTicketSections(report({ appContext: 'junk' as unknown as BugReport['appContext'] }), 'en')
        .context,
    ).toEqual([]);
  });
});
