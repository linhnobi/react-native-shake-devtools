import type { ConsoleEntry, LogEntry, MarkerEntry, NetworkEntry } from '../capture/log-entry';
import type { RecordedAction } from '../capture/recorded-action';
import { formatTimeline } from './timeline';

let nextId = 1;
const net = (at: number, over: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id: nextId++,
  kind: 'network',
  at,
  method: 'GET',
  url: 'https://api.example.com/orders?token=secret123',
  ...over,
});
const con = (at: number, over: Partial<ConsoleEntry> = {}): ConsoleEntry => ({
  id: nextId++,
  kind: 'console',
  at,
  level: 'error',
  text: 'TypeError: x is undefined\n  at foo (a.js:1)',
  ...over,
});
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
const act = (at: number, over: Partial<RecordedAction> = {}): RecordedAction => ({
  at,
  kind: 'tap',
  label: 'Pay',
  source: 'text',
  ...over,
});

const parse = (i: { actions?: RecordedAction[]; entries?: LogEntry[]; from?: number }) =>
  JSON.parse(
    formatTimeline({ actions: i.actions ?? [], entries: i.entries ?? [], from: i.from ?? 0 }),
  ) as Array<Record<string, unknown>>;

describe('formatTimeline', () => {
  it('request có method, path không query, status, durationMs', () => {
    const [item] = parse({ entries: [net(5, { method: 'POST', status: 201, durationMs: 120 })] });
    expect(item).toEqual({
      at: 5,
      type: 'request',
      method: 'POST',
      path: '/orders',
      status: 201,
      durationMs: 120,
    });
  });

  it('url không phải chuỗi (dữ liệu hỏng) ⇒ không ném, path rỗng', () => {
    const [item] = parse({ entries: [net(5, { url: 42 as unknown as string, status: 500 })] });
    expect(item).toEqual({ at: 5, type: 'request', method: 'GET', path: '', status: 500 });
  });

  it('request lỗi vận chuyển mang error, không có status', () => {
    const [item] = parse({ entries: [net(5, { error: 'timeout' })] });
    expect(item).toEqual({ at: 5, type: 'request', method: 'GET', path: '/orders', error: 'timeout' });
  });

  it('không có khoá thân/header và không lộ token, mật khẩu', () => {
    const entry = net(5, {
      status: 200,
      requestHeaders: { Authorization: 'Bearer abc' },
      requestBody: '{"password":"x"}',
      responseBody: '{"ok":true}',
      requestTruncated: true,
    });
    const out = formatTimeline({ actions: [], entries: [entry], from: 0 });
    expect(out).not.toContain('requestBody');
    expect(out).not.toContain('responseBody');
    expect(out).not.toContain('requestHeaders');
    expect(out).not.toContain('responseHeaders');
    expect(out).not.toContain('abc');
    expect(out).not.toContain('"x"');
    expect(out).not.toContain('secret123');
    expect(out).not.toContain('password');
  });

  it('trộn thao tác, màn, request, lỗi theo thời gian; bằng giờ thì thao tác trước', () => {
    const items = parse({
      actions: [act(10), act(30, { kind: 'back', label: undefined })],
      entries: [screen(10, 'Cart'), net(20, { status: 200 }), con(25)],
    });
    expect(items.map((i) => [i.at, i.type])).toEqual([
      [10, 'action'],
      [10, 'screen'],
      [20, 'request'],
      [25, 'error'],
      [30, 'action'],
    ]);
    expect(items[0]).toEqual({ at: 10, type: 'action', kind: 'tap', label: 'Pay' });
    expect(items[1]).toEqual({ at: 10, type: 'screen', label: 'Cart' });
    expect(items[4]).toEqual({ at: 30, type: 'action', kind: 'back' });
  });

  it('lỗi console chỉ mang dòng đầu, không stack', () => {
    const [item] = parse({ entries: [con(1)] });
    expect(item).toEqual({ at: 1, type: 'error', text: 'TypeError: x is undefined' });
  });

  it('bỏ mốc ⚑, console không phải lỗi, và mọi thứ trước from', () => {
    const items = parse({
      from: 10,
      actions: [act(9), act(10)],
      entries: [mark(11, '1'), con(12, { level: 'warn' }), net(9), net(10, { status: 200 })],
    });
    expect(items.map((i) => i.at)).toEqual([10, 10]);
  });

  it('che dữ liệu cá nhân trong nhãn thao tác và dòng lỗi', () => {
    const items = parse({
      actions: [act(1, { label: 'qa.lan@khachhang.vn' })],
      entries: [con(2, { text: 'Fail for 0912345678' })],
    });
    expect(JSON.stringify(items)).not.toContain('khachhang');
    expect(JSON.stringify(items)).not.toContain('0912345678');
  });

  it('rỗng ⇒ mảng JSON rỗng', () => {
    expect(formatTimeline({ actions: [], entries: [], from: 0 })).toBe('[]');
  });
});
