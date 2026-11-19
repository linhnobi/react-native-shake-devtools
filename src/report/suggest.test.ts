import type { ConsoleEntry, LogEntry, MarkerEntry, NetworkEntry } from '../capture/log-entry';
import { SESSION_FORMAT, type StoredSession } from '../capture/log-session';
import { devtoolsStrings } from '../i18n/translate';
import { suggestFromCrash, suggestReport } from './suggest';

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

describe('suggestReport', () => {
  it('lỗi HTTP gần nhất ở màn Checkout, bỏ query', () => {
    const entries: LogEntry[] = [
      screen(10, 'Cart'),
      net(20, { method: 'GET', url: '/old', status: 500, screen: 'Cart' }),
      screen(30, 'Checkout'),
      net(40, { method: 'POST', url: '/orders?token=x', status: 500, screen: 'Checkout' }),
      net(50, { status: 200 }),
    ];
    const s = suggestReport({ entries, from: 0, strings: en });
    expect(s.title).toBe('[Checkout] POST /orders → 500');
    expect(s.entryId).toBe(entries[3].id);
  });

  it('chỉ xét lỗi trong cửa sổ at >= from', () => {
    const entries: LogEntry[] = [
      screen(10, 'Cart'),
      net(20, { url: '/old', status: 500, screen: 'Cart' }),
    ];
    const s = suggestReport({ entries, from: 30, strings: en });
    expect(s.title).toBe('[Cart] ');
    expect(s.entryId).toBeUndefined();
    expect(s.actual).toBe('');
  });

  it('request bị huỷ không phải lỗi', () => {
    const entries: LogEntry[] = [screen(1, 'Home'), net(2, { error: 'abort', screen: 'Home' })];
    expect(suggestReport({ entries, from: 0, strings: en }).title).toBe('[Home] ');
  });

  it('promise reject ⇒ Unhandled rejection: <message>', () => {
    const entries: LogEntry[] = [
      screen(1, 'Checkout'),
      con(2, {
        level: 'error',
        uncaught: true,
        screen: 'Checkout',
        text: 'Uncaught (in promise, id: 1): TypeError: cannot read\n    at f',
      }),
    ];
    expect(suggestReport({ entries, from: 0, strings: vi }).title).toBe(
      '[Checkout] Unhandled rejection: TypeError: cannot read',
    );
  });

  it('dòng lỗi không có screen thì lấy màn từ mốc màn đứng trước nó', () => {
    const entries: LogEntry[] = [
      screen(1, 'A'),
      screen(5, 'B'),
      net(6, { status: 503 }),
      screen(9, 'C'),
    ];
    expect(suggestReport({ entries, from: 0, strings: en }).title).toBe('[B] GET /api/x → 503');
  });

  it('không lỗi ⇒ [<màn hiện tại>] , màn lấy từ mốc màn cuối kể cả trước cửa sổ', () => {
    const entries: LogEntry[] = [screen(1, 'A'), screen(2, 'Profile'), net(3, { status: 200 })];
    expect(suggestReport({ entries, from: 3, strings: en })).toEqual({
      title: '[Profile] ',
      actual: '',
    });
  });

  it('không có mốc màn nào ⇒ tiêu đề rỗng, và lỗi thì không có tiền tố [ ]', () => {
    expect(suggestReport({ entries: [], from: 0, strings: en })).toEqual({ title: '', actual: '' });
    const e: LogEntry[] = [net(1, { status: 500, url: '/z' })];
    expect(suggestReport({ entries: e, from: 0, strings: en }).title).toBe('GET /z → 500');
  });

  it('thông điệp 5000 ký tự ⇒ tiêu đề ≤ 120 ký tự', () => {
    const entries: LogEntry[] = [
      screen(1, 'Checkout'),
      con(2, { level: 'error', text: 'z'.repeat(5000), screen: 'Checkout' }),
    ];
    const s = suggestReport({ entries, from: 0, strings: en });
    expect(s.title.length).toBeLessThanOrEqual(120);
    expect(s.title.startsWith('[Checkout] zzz')).toBe(true);
    expect(s.title.endsWith('…')).toBe(true);
  });

  it('cắt tiêu đề không chẻ đôi cặp surrogate của emoji', () => {
    const entries: LogEntry[] = [con(2, { level: 'error', text: '😀'.repeat(200) })];
    const t = suggestReport({ entries, from: 0, strings: en }).title;
    expect(t.length).toBeLessThanOrEqual(120);
    expect(t).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('actual theo ngôn ngữ của strings', () => {
    const entries: LogEntry[] = [
      screen(1, 'Checkout'),
      net(2, { method: 'POST', url: '/orders', status: 500, screen: 'Checkout' }),
    ];
    expect(suggestReport({ entries, from: 0, strings: vi }).actual).toBe(
      'Gặp lỗi: POST /orders → 500',
    );
    expect(suggestReport({ entries, from: 0, strings: en }).actual).toBe(
      'Error: POST /orders → 500',
    );
  });

  it('lỗi fatal trong phiên hiện tại ⇒ [Crash] ...', () => {
    const entries: LogEntry[] = [
      screen(1, 'Home'),
      con(2, { level: 'error', uncaught: true, fatal: true, text: 'Error: died\n at x' }),
    ];
    expect(suggestReport({ entries, from: 0, strings: en }).title).toBe('[Crash] Error: died');
  });
});

describe('suggestFromCrash', () => {
  const session = (entries: LogEntry[]): StoredSession => ({
    format: SESSION_FORMAT,
    name: 'session-1.json',
    startedAt: 1,
    savedAt: 2,
    fatal: true,
    totalInMemory: entries.length,
    entries,
  });

  it("dòng fatal của phiên ⇒ [Crash] TypeError: Cannot read property 'id' of undefined", () => {
    const s = session([
      screen(1, 'Home'),
      net(2, { status: 500, url: '/a' }),
      con(3, {
        level: 'error',
        uncaught: true,
        fatal: true,
        text: "TypeError: Cannot read property 'id' of undefined\n    at render (a.js:1)",
      }),
    ]);
    const out = suggestFromCrash(s, vi);
    expect(out.title).toBe("[Crash] TypeError: Cannot read property 'id' of undefined");
    expect(out.actual).toBe("Ứng dụng bị crash: TypeError: Cannot read property 'id' of undefined");
    expect(out.entryId).toBe(s.entries[2].id);
    expect(suggestFromCrash(s, en).actual).toBe(
      "The app crashed: TypeError: Cannot read property 'id' of undefined",
    );
  });

  it('lấy dòng fatal cuối khi có nhiều dòng; thông điệp 5000 ký tự ⇒ tiêu đề ≤ 120', () => {
    const s = session([
      con(1, { level: 'error', uncaught: true, fatal: true, text: 'Error: first' }),
      con(2, { level: 'error', uncaught: true, fatal: true, text: 'Error: ' + 'q'.repeat(5000) }),
    ]);
    const out = suggestFromCrash(s, en);
    expect(out.title.length).toBeLessThanOrEqual(120);
    expect(out.title.startsWith('[Crash] Error: qqq')).toBe(true);
  });

  it('phiên không còn dòng fatal ⇒ lùi về lỗi cuối, hoặc [Crash] trống', () => {
    expect(suggestFromCrash(session([net(1, { status: 500, url: '/a' })]), en).title).toBe(
      '[Crash] GET /a → 500',
    );
    expect(suggestFromCrash(session([]), en)).toEqual({ title: '[Crash] ', actual: '' });
  });

  it('file phiên hỏng: phần tử null / không phải object bị bỏ, url số không ném', () => {
    const s = session([
      null,
      42,
      net(2, { status: 500, url: 7 as unknown as string }),
    ] as unknown as LogEntry[]);
    expect(suggestFromCrash(s, en).title).toBe('[Crash] GET → 500');
  });
});
