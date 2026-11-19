import { formatDateTime, formatEntry, formatLog, formatTime } from './format-log';
import type { ConsoleEntry, MarkerEntry, NetworkEntry } from './log-entry';
import { REDACTED } from './redact';

/*
  Mốc dựng bằng constructor LOCAL (`new Date(y, m, d, …)`): `formatTime`/`formatDateTime` đọc giờ
  máy, nên test không phụ thuộc múi giờ của CI. Các dòng khác ghép giờ bằng `formatTime(AT)` —
  phần giờ đã khoá ở describe riêng.
*/
const AT = new Date(2026, 8, 24, 14, 26, 40, 123).getTime();
const T = formatTime(AT);

const con = (over: Partial<ConsoleEntry> = {}): ConsoleEntry => ({
  id: 1,
  kind: 'console',
  at: AT,
  level: 'info',
  text: 'x',
  ...over,
});

const net = (over: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id: 2,
  kind: 'network',
  at: AT,
  method: 'GET',
  url: '/api/x',
  ...over,
});

const mark = (type: MarkerEntry['type'], label: string): MarkerEntry => ({
  id: 3,
  kind: 'marker',
  at: AT,
  type,
  label,
});

const localTime = (h: number, m: number, s: number, ms: number) =>
  new Date(2026, 8, 24, h, m, s, ms).getTime();

describe('formatTime', () => {
  it('định dạng đủ 12 ký tự', () => {
    const text = formatTime(AT);

    expect(text).toBe('14:26:40.123');
    expect(text).toHaveLength(12);
  });

  it('đệm 0 cho giờ/phút/giây một chữ số', () => {
    expect(formatTime(localTime(7, 5, 3, 250))).toBe('07:05:03.250');
    expect(formatTime(localTime(0, 0, 0, 250))).toBe('00:00:00.250');
  });

  it('đệm 3 chữ số cho mili-giây', () => {
    expect(formatTime(localTime(14, 26, 40, 5))).toBe('14:26:40.005');
    expect(formatTime(localTime(14, 26, 40, 45))).toBe('14:26:40.045');
    expect(formatTime(localTime(14, 26, 40, 0))).toBe('14:26:40.000');
  });
});

describe('formatLog', () => {
  it('dòng console có mức viết hoa', () => {
    const out = formatLog([con({ level: 'warn', text: 'ối' }), con({ id: 2, level: 'debug', text: 'd' })]);

    expect(out).toBe(`${T} WARN ối\n${T} DEBUG d`);
  });

  it('dòng network có method/url/status/thời lượng', () => {
    const out = formatLog([net({ method: 'POST', url: '/api/user', status: 201, durationMs: 87 })]);

    expect(out).toBe(`${T} POST /api/user → 201 87ms`);
  });

  it('request chưa xong hiện `pending`', () => {
    expect(formatLog([net()])).toBe(`${T} GET /api/x → pending`);
  });

  /* Khối này rời máy (nút Chia sẻ) — thân phải đi qua `redactBody` ở đây, bộ đệm giữ bản thô. */
  it('thân request/response xuống dòng thụt lề', () => {
    const out = formatLog([
      net({
        method: 'POST',
        url: '/api/login',
        status: 200,
        durationMs: 12,
        requestBody: '{"password":"123","id":7}',
        responseBody: '{"ok":true}',
      }),
      con({ id: 4, text: 'sau' }),
    ]);

    expect(out.split('\n')).toEqual([
      `${T} POST /api/login → 200 12ms`,
      `    > {"password":"${REDACTED}","id":7}`,
      '    < {"ok":true}',
      `${T} INFO sau`,
    ]);
  });

  it('mảng rỗng ⇒ chuỗi rỗng', () => {
    expect(formatLog([])).toBe('');
  });
});

describe('formatEntry', () => {
  it('console có mức viết hoa', () => {
    expect(formatEntry(con({ level: 'error', text: 'boom' }))).toBe(`${T} ERROR boom`);
    expect(formatEntry(con({ level: 'info', text: 'ok' }))).toBe(`${T} INFO ok`);
  });

  it('mạng đủ status + thời lượng', () => {
    expect(formatEntry(net({ status: 500, durationMs: 1200 }))).toBe(`${T} GET /api/x → 500 1200ms`);
  });

  it('chưa xong ra `pending`', () => {
    expect(formatEntry(net())).toBe(`${T} GET /api/x → pending`);
  });

  it('lỗi mạng ra `network`', () => {
    expect(formatEntry(net({ error: 'network', durationMs: 30000 }))).toBe(
      `${T} GET /api/x → network 30000ms`,
    );
  });

  it('thân request/response xuống dòng thụt lề', () => {
    // Chỉ thân nào có mới được một dòng — không vẽ dòng `>`/`<` rỗng.
    expect(formatEntry(net({ status: 200, durationMs: 5, responseBody: '{"ok":true}' }))).toBe(
      `${T} GET /api/x → 200 5ms\n    < {"ok":true}`,
    );
    expect(formatEntry(net({ method: 'POST', requestBody: '{"a":1}' }))).toBe(
      `${T} POST /api/x → pending\n    > {"a":1}`,
    );
  });

  it('lỗi fatal in `FATAL`', () => {
    const uncaught = { level: 'error', text: 'TypeError: x', uncaught: true } as const;

    expect(formatEntry(con({ ...uncaught, fatal: true }))).toBe(`${T} FATAL TypeError: x`);
    // Không ai bắt nhưng không chết app ⇒ `UNCAUGHT`, vẫn khác một `console.error` thường.
    expect(formatEntry(con({ ...uncaught, fatal: false }))).toBe(`${T} UNCAUGHT TypeError: x`);
  });

  it('mốc màn in `→ SCREEN`', () => {
    expect(formatEntry(mark('screen', 'UserList'))).toBe(`${T} → SCREEN UserList`);
  });

  it('mốc đánh dấu in `⚑ MARK #n`', () => {
    expect(formatEntry(mark('user', '3'))).toBe(`${T} ⚑ MARK #3`);
  });
});

describe('formatDateTime', () => {
  it('đúng khuôn kèm múi giờ', () => {
    const at = new Date(2026, 8, 24, 14, 26, 40).getTime();
    const text = formatDateTime(at);

    expect(text).toMatch(/^2026-09-24 14:26:40 [+-]\d{2}:\d{2}$/);
    // Hậu tố là lệch múi giờ của CHÍNH máy chạy test (CI ở UTC ra `+00:00`, máy ở VN ra `+07:00`)
    // — khoá bằng quan hệ với `getTimezoneOffset` (ngược dấu), không ghim số.
    const [, sign, hh, mm] = /([+-])(\d{2}):(\d{2})$/.exec(text) ?? [];
    const minutes = (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm));
    expect(minutes + new Date(at).getTimezoneOffset()).toBe(0);
  });

  it('đệm 0 cho tháng/ngày/giờ một chữ số', () => {
    expect(formatDateTime(new Date(2026, 0, 2, 3, 4, 5).getTime())).toMatch(
      /^2026-01-02 03:04:05 [+-]\d{2}:\d{2}$/,
    );
  });
});

/* Khối Chia sẻ rời máy: URL và dòng console cũng phải qua lớp che, không chỉ thân request. */
describe('formatEntry — che URL và console', () => {
  it('che token trong query của dòng mạng', () => {
    const out = formatEntry(net({ url: 'https://api.acme.vn/me?access_token=abc', status: 200 }));

    expect(out).toBe(`${T} GET https://api.acme.vn/me?access_token=${REDACTED} → 200`);
  });

  it('che khoá bí mật trong JSON in ra console', () => {
    const out = formatEntry(con({ text: 'login {"accessToken":"a1"}' }));

    expect(out).toBe(`${T} INFO login {"accessToken":"${REDACTED}"}`);
  });
});
