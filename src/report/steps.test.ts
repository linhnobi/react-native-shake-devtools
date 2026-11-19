import type { ConsoleEntry, LogEntry, MarkerEntry, NetworkEntry } from '../capture/log-entry';
import type { RecordedAction } from '../capture/recorded-action';
import { devtoolsStrings } from '../i18n/translate';
import {
  MAX_FORM_STEPS,
  buildSteps,
  renderStep,
  reportWindow,
  summarizeErrorEntry,
  type ReportStep,
} from './steps';

const vi = devtoolsStrings.vi;
const en = devtoolsStrings.en;

let nextId = 1;
const screen = (at: number, label: string): MarkerEntry => ({
  id: nextId++,
  kind: 'marker',
  at,
  type: 'screen',
  label,
});
const mark = (at: number, label: string): MarkerEntry => ({
  id: nextId++,
  kind: 'marker',
  at,
  type: 'user',
  label,
});
const net = (at: number, over: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id: nextId++,
  kind: 'network',
  at,
  method: 'GET',
  url: '/api/x',
  ...over,
});
const con = (at: number, over: Partial<ConsoleEntry> = {}): ConsoleEntry => ({
  id: nextId++,
  kind: 'console',
  at,
  level: 'info',
  text: 'x',
  ...over,
});
const act = (at: number, kind: RecordedAction['kind'], label?: string): RecordedAction => ({
  at,
  kind,
  label,
  source: label ? 'text' : 'none',
});

describe('reportWindow', () => {
  it('mốc ⚑ cuối là mới nhất ⇒ source mark kèm số của mốc', () => {
    const entries: LogEntry[] = [mark(200, '1'), screen(250, 'Home'), mark(400, '2')];
    expect(reportWindow({ entries, lastSentAt: 300, sessionStartedAt: 100 })).toEqual({
      from: 400,
      source: 'mark',
      markLabel: '2',
    });
  });

  it('lần gửi trước mới hơn mọi mốc ⇒ source sent, không có markLabel', () => {
    const w = reportWindow({ entries: [mark(200, '1')], lastSentAt: 300, sessionStartedAt: 100 });
    expect(w).toEqual({ from: 300, source: 'sent' });
    expect('markLabel' in w).toBe(false);
  });

  it('không mốc, không lần gửi ⇒ lúc mở app', () => {
    expect(reportWindow({ entries: [screen(150, 'Home')], sessionStartedAt: 100 })).toEqual({
      from: 100,
      source: 'session',
    });
  });

  it('mốc và lần gửi cũ hơn lúc mở app (phiên mới) ⇒ lấy lúc mở app', () => {
    expect(
      reportWindow({ entries: [mark(50, '1')], lastSentAt: 20, sessionStartedAt: 100 }).source,
    ).toBe('session');
  });

  it('bằng nhau thì ưu tiên mốc cụ thể hơn: mark rồi sent rồi session', () => {
    expect(
      reportWindow({ entries: [mark(100, '3')], lastSentAt: 100, sessionStartedAt: 100 }),
    ).toMatchObject({ source: 'mark', markLabel: '3' });
    expect(reportWindow({ entries: [], lastSentAt: 100, sessionStartedAt: 100 }).source).toBe(
      'sent',
    );
  });
});

describe('buildSteps', () => {
  it('trộn thao tác, mốc màn và dòng lỗi theo thời gian, chỉ lấy at >= from', () => {
    const steps = buildSteps({
      from: 100,
      actions: [act(50, 'tap', 'Cũ'), act(120, 'tap', 'Thanh toán'), act(200, 'back')],
      entries: [
        screen(110, 'Cart'),
        net(150, { method: 'POST', url: '/orders', status: 500 }),
        screen(40, 'Cũ hơn'),
      ],
    });
    expect(steps.map((s) => [s.kind, s.label])).toEqual([
      ['screen', 'Cart'],
      ['tap', 'Thanh toán'],
      ['error', 'POST /orders → 500'],
      ['back', undefined],
    ]);
  });

  it('bằng giờ thì thao tác đứng trước mốc màn (chạm rồi mới đổi màn)', () => {
    const steps = buildSteps({
      from: 0,
      actions: [act(100, 'tap', 'Mua')],
      entries: [screen(100, 'Checkout')],
    });
    expect(steps.map((s) => s.kind)).toEqual(['tap', 'screen']);
  });

  it('ba tap liên tiếp cùng nhãn gộp thành một bước count 3', () => {
    const steps = buildSteps({
      from: 0,
      actions: [act(1, 'tap', 'Tăng'), act(2, 'tap', 'Tăng'), act(3, 'tap', 'Tăng')],
      entries: [],
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'tap', label: 'Tăng', count: 3, at: 1 });
  });

  it('bước đơn không có count; nhãn khác hoặc có bước chen giữa thì không gộp', () => {
    const steps = buildSteps({
      from: 0,
      actions: [act(1, 'tap', 'A'), act(2, 'tap', 'B'), act(3, 'tap', 'A'), act(5, 'tap', 'A')],
      entries: [screen(4, 'S')],
    });
    expect(steps.map((s) => [s.kind, s.label, s.count])).toEqual([
      ['tap', 'A', undefined],
      ['tap', 'B', undefined],
      ['tap', 'A', undefined],
      ['screen', 'S', undefined],
      ['tap', 'A', undefined],
    ]);
  });

  it('chạm và giữ lâu cùng nhãn là hai loại khác nhau, không gộp', () => {
    const steps = buildSteps({
      from: 0,
      actions: [act(1, 'tap', 'A'), act(2, 'long-press', 'A')],
      entries: [],
    });
    expect(steps.map((s) => s.kind)).toEqual(['tap', 'long-press']);
  });

  it('request thành công, warn và request bị huỷ không thành bước', () => {
    const steps = buildSteps({
      from: 0,
      actions: [],
      entries: [
        net(1, { status: 200 }),
        con(2, { level: 'warn', text: 'chậm' }),
        net(3, { error: 'abort' }),
        net(4, { method: 'GET', url: '/a', error: 'timeout' }),
      ],
    });
    expect(steps.map((s) => [s.kind, s.label])).toEqual([['error', 'GET /a → timeout']]);
  });

  it('promise reject (uncaught, "Uncaught (in promise") ⇒ bước error', () => {
    const steps = buildSteps({
      from: 0,
      actions: [],
      entries: [
        con(1, {
          level: 'error',
          uncaught: true,
          text: 'Uncaught (in promise, id: 4): TypeError: boom\n    at foo',
        }),
      ],
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'error',
      label: 'Unhandled rejection: TypeError: boom',
    });
  });

  it('45 bước ⇒ giữ 30 bước cuối; max tuỳ chỉnh được', () => {
    const actions = Array.from({ length: 45 }, (_, i) => act(i + 1, 'tap', `N${i}`));
    const steps = buildSteps({ from: 0, actions, entries: [] });
    expect(MAX_FORM_STEPS).toBe(30);
    expect(steps).toHaveLength(30);
    expect(steps[0].label).toBe('N15');
    expect(steps[29].label).toBe('N44');
    expect(buildSteps({ from: 0, actions, entries: [], max: 5 })).toHaveLength(5);
  });

  it('gộp xong mới cắt: 45 lần chạm cùng nhãn là một bước count 45', () => {
    const actions = Array.from({ length: 45 }, (_, i) => act(i + 1, 'tap', 'Tăng'));
    const steps = buildSteps({ from: 0, actions, entries: [] });
    expect(steps).toHaveLength(1);
    expect(steps[0].count).toBe(45);
  });

  it('nhãn không phải chuỗi (file phiên hỏng) hoặc chỉ khoảng trắng coi như vắng', () => {
    const bad = { at: 1, kind: 'tap', label: 42, source: 'none' } as unknown as RecordedAction;
    const blank = act(2, 'input', '   ');
    const steps = buildSteps({ from: 0, actions: [bad, blank], entries: [] });
    expect(steps.map((s) => s.label)).toEqual([undefined, undefined]);
  });

  it('mốc ⚑ của người dùng không thành bước', () => {
    expect(buildSteps({ from: 0, actions: [], entries: [mark(5, '1')] })).toEqual([]);
  });

  it('file phiên hỏng: phần tử null / không phải object bị bỏ, url không phải chuỗi không ném', () => {
    const entries = [
      null,
      7,
      'x',
      net(3, { url: 42 as unknown as string, status: 500 }),
    ] as unknown as LogEntry[];
    const steps = buildSteps({ from: 0, actions: [], entries });
    expect(steps.map((s) => [s.kind, s.label])).toEqual([['error', 'GET → 500']]);
  });

  it('kết quả tất định, id không trùng và ổn định khi có bước mới ở cuối', () => {
    const input = {
      from: 0,
      actions: [act(1, 'tap', 'A'), act(1, 'tap', 'B'), act(2, 'back')],
      entries: [screen(2, 'S')] as LogEntry[],
    };
    const a = buildSteps(input);
    expect(a).toEqual(buildSteps(input));
    expect(new Set(a.map((s) => s.id)).size).toBe(a.length);
    const more = buildSteps({ ...input, actions: [...input.actions, act(9, 'foreground')] });
    expect(more.slice(0, a.length).map((s) => s.id)).toEqual(a.map((s) => s.id));
  });
});

describe('summarizeErrorEntry', () => {
  it('HTTP, lỗi vận chuyển, lỗi JS, promise reject', () => {
    expect(summarizeErrorEntry(net(1, { method: 'POST', url: '/orders', status: 500 }))).toBe(
      'POST /orders → 500',
    );
    expect(summarizeErrorEntry(net(1, { url: '/a', error: 'timeout' }))).toBe('GET /a → timeout');
    expect(
      summarizeErrorEntry(
        con(1, { level: 'error', uncaught: true, text: 'TypeError: x\n    at a' }),
      ),
    ).toBe('TypeError: x');
    expect(
      summarizeErrorEntry(
        con(1, {
          level: 'error',
          uncaught: true,
          text: 'Uncaught (in promise, id: 2): Error: bad\n  at z',
        }),
      ),
    ).toBe('Unhandled rejection: Error: bad');
  });

  it('bỏ query string, fragment và host; che số dài trong path', () => {
    expect(summarizeErrorEntry(net(1, { url: '/orders?token=x#f', status: 500 }))).toBe(
      'GET /orders → 500',
    );
    expect(summarizeErrorEntry(net(1, { url: 'https://api.x.com/v1/o?a=1', status: 404 }))).toBe(
      'GET /v1/o → 404',
    );
    expect(summarizeErrorEntry(net(1, { url: 'https://api.x.com', status: 404 }))).toBe(
      'GET / → 404',
    );
    expect(summarizeErrorEntry(net(1, { url: '/users/0912345678', status: 404 }))).toBe(
      'GET /users/•••678 → 404',
    );
  });

  it('url không phải chuỗi (file phiên hỏng) ⇒ không ném, bỏ phần path', () => {
    const bad = (url: unknown) => net(1, { url: url as string, status: 500 });
    expect(summarizeErrorEntry(bad(42))).toBe('GET → 500');
    expect(summarizeErrorEntry(bad(null))).toBe('GET → 500');
    expect(summarizeErrorEntry(bad({ href: '/a' }))).toBe('GET → 500');
  });

  it('cắt thông điệp quá dài và che email', () => {
    const long = summarizeErrorEntry(con(1, { level: 'error', text: 'y'.repeat(5000) }));
    expect(long.length).toBeLessThanOrEqual(200);
    expect(summarizeErrorEntry(con(1, { level: 'error', text: 'no user a@b.com' }))).toBe(
      'no user •••com',
    );
  });
});

describe('renderStep', () => {
  const step = (over: Partial<ReportStep> & Pick<ReportStep, 'kind'>): ReportStep => ({
    id: 'x',
    at: 0,
    ...over,
  });

  it('tiếng Việt', () => {
    expect(renderStep(step({ kind: 'screen', label: 'Giỏ hàng' }), vi)).toBe('Mở màn Giỏ hàng');
    expect(renderStep(step({ kind: 'tap', label: 'Thanh toán' }), vi)).toBe('Chạm "Thanh toán"');
    expect(renderStep(step({ kind: 'tap', label: 'Tăng', count: 3 }), vi)).toBe('Chạm "Tăng" ×3');
    expect(renderStep(step({ kind: 'long-press', label: 'Ảnh' }), vi)).toBe('Giữ lâu "Ảnh"');
    expect(renderStep(step({ kind: 'input', label: 'Email' }), vi)).toBe('Nhập vào ô "Email"');
    expect(renderStep(step({ kind: 'back' }), vi)).toBe('Bấm Back');
    expect(renderStep(step({ kind: 'background' }), vi)).toBe('App xuống nền');
    expect(renderStep(step({ kind: 'foreground' }), vi)).toBe('App lên lại');
    expect(renderStep(step({ kind: 'error', label: 'POST /orders → 500' }), vi)).toBe(
      '⚠ POST /orders → 500',
    );
  });

  it('tiếng Anh', () => {
    expect(renderStep(step({ kind: 'screen', label: 'Cart' }), en)).toBe('Open screen Cart');
    expect(renderStep(step({ kind: 'tap', label: 'Pay' }), en)).toBe('Tap "Pay"');
    expect(renderStep(step({ kind: 'tap', label: 'Add', count: 3 }), en)).toBe('Tap "Add" ×3');
    expect(renderStep(step({ kind: 'long-press', label: 'Photo' }), en)).toBe(
      'Long-press "Photo"',
    );
    expect(renderStep(step({ kind: 'input', label: 'Email' }), en)).toBe(
      'Type in the "Email" field',
    );
    expect(renderStep(step({ kind: 'back' }), en)).toBe('Press Back');
    expect(renderStep(step({ kind: 'background' }), en)).toBe('App sent to background');
    expect(renderStep(step({ kind: 'foreground' }), en)).toBe('App back in foreground');
    expect(renderStep(step({ kind: 'error', label: 'GET /a → timeout' }), en)).toBe(
      '⚠ GET /a → timeout',
    );
  });

  it('thiếu nhãn dùng câu riêng, không in "undefined" hay {{', () => {
    for (const strings of [vi, en]) {
      for (const kind of ['tap', 'long-press', 'input'] as const) {
        const out = renderStep(step({ kind }), strings);
        expect(out).not.toMatch(/undefined|\{\{/);
        expect(out.length).toBeGreaterThan(0);
      }
    }
  });

  it('bước text trả đúng step.text, không dịch', () => {
    const s = step({ kind: 'text', text: 'Mở app {{x}} "lạ"' });
    expect(renderStep(s, vi)).toBe('Mở app {{x}} "lạ"');
    expect(renderStep(s, en)).toBe('Mở app {{x}} "lạ"');
    expect(renderStep(step({ kind: 'text' }), en)).toBe('');
  });
});
