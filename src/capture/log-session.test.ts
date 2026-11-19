import type { ConsoleEntry, LogEntry, MarkerEntry, NetworkEntry } from './log-entry';
import {
  SESSION_FORMAT,
  parseSession,
  pickForPersist,
  pickPrevious,
  planPrune,
  redactEntry,
  serializeSession,
  utf8Bytes,
  type LogStoreFile,
  type StoredSession,
} from './log-session';
import type { RecordedAction } from './recorded-action';
import { REDACTED } from './redact';

const con = (id: number, level: ConsoleEntry['level'] = 'info', text = 'x'): ConsoleEntry => ({
  id,
  kind: 'console',
  at: id,
  level,
  text,
});

const net = (id: number, over: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id,
  kind: 'network',
  at: id,
  method: 'GET',
  url: '/api/x',
  ...over,
});

const session = (entries: LogEntry[], over: Partial<StoredSession> = {}): StoredSession => ({
  format: SESSION_FORMAT,
  name: 'session-1000.json',
  startedAt: 1000,
  savedAt: 2000,
  fatal: false,
  build: 'UAT · 1.0.2',
  totalInMemory: entries.length,
  entries,
  ...over,
});

const ids = (entries: readonly LogEntry[]) => entries.map((e) => e.id);

describe('pickForPersist', () => {
  /* Lỗi là thứ người ta mở phiên cũ ra để tìm — nằm ngoài 50 dòng cuối vẫn phải xuống đĩa. */
  it('lỗi cũ ngoài cửa sổ vẫn được lấy', () => {
    const entries = [con(1, 'error'), con(2), con(3), con(4)];

    expect(ids(pickForPersist(entries, 2))).toEqual([1, 3, 4]);
  });

  it('lỗi nằm trong cửa sổ không bị lấy hai lần', () => {
    const entries = [con(1), con(2, 'error'), net(3, { status: 500 })];

    expect(ids(pickForPersist(entries, 2))).toEqual([2, 3]);
  });

  it('ít dòng hơn cửa sổ thì lấy hết', () => {
    const entries = [con(1), con(2)];
    const out = pickForPersist(entries, 5);

    expect(ids(out)).toEqual([1, 2]);
    // Mảng MỚI — người gọi `.map(redactEntry)` lên nó, không được đụng ảnh chụp của buffer.
    expect(out).not.toBe(entries);
  });
});

describe('redactEntry', () => {
  it('header bí mật bị che', () => {
    const entry = net(1, {
      requestHeaders: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    });
    const out = redactEntry(entry) as NetworkEntry;

    expect(out.requestHeaders).toEqual({
      Authorization: REDACTED,
      'Content-Type': 'application/json',
    });
    // RAM giữ header thô cho `toCurl` — che bản ghi đĩa không được ghi đè lên dòng gốc.
    expect(entry.requestHeaders?.Authorization).toBe('Bearer x');
  });

  it('khoá `password` trong thân bị che', () => {
    const out = redactEntry(
      net(1, {
        requestBody: '{"username":"linh","password":"123"}',
        responseBody: '{"password":"456","id":7}',
      }),
    ) as NetworkEntry;

    expect(out.requestBody).toBe(`{"username":"linh","password":"${REDACTED}"}`);
    expect(out.responseBody).toBe(`{"password":"${REDACTED}","id":7}`);
  });

  /* JSON nén có `=` (token base64 có đệm) từng bị coi là thân form và xuống đĩa nguyên token. */
  it('JSON nén có token base64 đệm `=` bị che trước khi ghi đĩa', () => {
    const out = redactEntry(
      net(1, {
        requestBody: '{"refreshToken":"dGVzdA=="}',
        responseBody: '{"accessToken":"YWJjZA==","user":{"id":7}}',
      }),
    ) as NetworkEntry;

    expect(out.requestBody).toBe(`{"refreshToken":"${REDACTED}"}`);
    expect(out.responseBody).toBe(`{"accessToken":"${REDACTED}","user":{"id":7}}`);
  });

  it('URL và dòng console mang bí mật bị che trước khi ghi đĩa', () => {
    const out = redactEntry(net(1, { url: 'https://api.acme.vn/me?access_token=abc' })) as NetworkEntry;
    const line = redactEntry(con(2, 'info', 'login {"accessToken":"a1"}')) as ConsoleEntry;

    expect(out.url).toBe(`https://api.acme.vn/me?access_token=${REDACTED}`);
    expect(line.text).toBe(`login {"accessToken":"${REDACTED}"}`);
  });

  it('dòng console không có bí mật trả nguyên', () => {
    const line = con(1, 'error', 'Authorization: Bearer x');
    const marker: MarkerEntry = { id: 2, kind: 'marker', at: 2, type: 'user', label: '1' };

    expect(redactEntry(line)).toBe(line);
    // Mốc cũng không có header/thân ⇒ cùng tham chiếu.
    expect(redactEntry(marker)).toBe(marker);
  });
});

describe('serializeSession', () => {
  it('dưới trần giữ đủ dòng', () => {
    const s = session([con(1), con(2, 'error'), net(3, { status: 200 })]);
    const parsed = JSON.parse(serializeSession(s, 1_000_000)) as StoredSession;

    expect(ids(parsed.entries)).toEqual([1, 2, 3]);
  });

  /* Lỗi 2 cũ hơn dòng thường 3 mà vẫn sống sót: thứ tự bỏ theo LOẠI trước, tuổi sau. */
  it('vượt trần bỏ dòng thường trước lỗi', () => {
    const entries = [
      con(1, 'info', 'mở màn danh sách'),
      con(2, 'error', 'bùm'),
      con(3),
      net(4, { status: 500 }),
    ];
    const s = session(entries);
    // Trần = đúng số byte của file chỉ còn hai lỗi (đo bằng chính thước của hàm, có dấu tiếng Việt).
    const onlyErrors = utf8Bytes(JSON.stringify({ ...s, entries: [entries[1], entries[3]] }));
    const keptIds = (maxBytes: number) =>
      ids((JSON.parse(serializeSession(s, maxBytes)) as StoredSession).entries);

    expect(keptIds(onlyErrors)).toEqual([2, 4]);
    // Hụt thêm một byte: hết dòng thường thì mới tới lỗi CŨ NHẤT.
    expect(keptIds(onlyErrors - 1)).toEqual([4]);
  });

  it('kết quả đọc lại được bằng `parseSession`', () => {
    const s = session([con(1), net(2, { status: 404, responseBody: '{"errorCode":"USER_DUP"}' })]);

    expect(parseSession(serializeSession(s, 1_000_000))).toEqual(s);
  });
});

describe('parseSession', () => {
  it('đọc lại đúng thứ đã ghi', () => {
    const s = session([con(1, 'error', 'bùm')], { fatal: true });

    expect(parseSession(JSON.stringify(s))).toEqual(s);
  });

  it('JSON hỏng ⇒ null', () => {
    expect(parseSession('{không phải json')).toBeNull();
    // JSON hợp lệ nhưng không phải object phiên cũng không được ném.
    expect(parseSession('null')).toBeNull();
  });

  it('khuôn khác `SESSION_FORMAT` ⇒ null', () => {
    const text = JSON.stringify({ ...session([con(1)]), format: SESSION_FORMAT + 1 });

    expect(parseSession(text)).toBeNull();
  });

  /* File `format: 1` do bản cũ ghi vẫn nằm trong cache tới 72 giờ — không được thành "không đọc được". */
  it('file `format: 1` cũ đọc được, `actions` là `undefined`', () => {
    const old = JSON.stringify({ ...session([con(1, 'error', 'bùm')]), format: 1 });

    const parsed = parseSession(old);

    expect(parsed).not.toBeNull();
    expect(parsed?.format).toBe(1);
    expect(parsed?.actions).toBeUndefined();
    expect(ids(parsed?.entries ?? [])).toEqual([1]);
  });

  it('đọc lại `actions` đã ghi, bỏ phần tử không phải thao tác', () => {
    const action: RecordedAction = { at: 5, kind: 'tap', label: 'Đăng nhập', source: 'text' };
    const text = JSON.stringify({
      ...session([con(1)]),
      actions: [action, null, 'rác', { at: 'x', kind: 'tap' }],
    });

    expect(parseSession(text)?.actions).toEqual([action]);
    // `actions` không phải mảng ⇒ coi như không có, không ném.
    const notArray = JSON.stringify({ ...session([con(1)]), actions: 'rác' });
    expect(parseSession(notArray)?.actions).toBeUndefined();
  });

  /* Panel đếm lỗi của phiên trước và màn phiên trước vẽ `url`/`text` của từng dòng NGAY LÚC RENDER —
     một dòng hỏng mà lọt qua là sập cả app của khách (I6). */
  it('bỏ phần tử `entries` sai dáng (null, số, thiếu `kind`/`at`/`id`, `url`/`text`/`label` không phải chuỗi)', () => {
    const marker: LogEntry = { id: 9, kind: 'marker', at: 9, type: 'screen', label: 'Cart' };
    const text = JSON.stringify({
      ...session([con(1, 'error', 'bùm'), net(2), marker]),
      entries: [
        con(1, 'error', 'bùm'),
        null,
        42,
        'rác',
        { id: 3, kind: 'console', at: 3, level: 'error' },
        { id: 4, kind: 'network', at: 4, method: 'GET', url: 42, status: 500 },
        { id: 5, kind: 'network', at: 'x', method: 'GET', url: '/a' },
        { id: 6, kind: 'lạ', at: 6 },
        { kind: 'console', at: 7, level: 'error', text: 'thiếu id' },
        { id: 8, kind: 'marker', at: 8, type: 'screen', label: null },
        net(2),
        marker,
      ],
    });

    const parsed = parseSession(text);

    expect(ids(parsed?.entries ?? [])).toEqual([1, 2, 9]);
  });
});

describe('planPrune', () => {
  const now = 1_000_000_000;
  const ttlMs = 72 * 3_600_000;
  const policy = { now, ttlMs, maxSessions: 3, current: 'session-9.json' };

  it('file quá TTL bị xoá', () => {
    const files: LogStoreFile[] = [
      { name: 'session-1.json', modifiedAt: now - ttlMs - 1 },
      // Đúng mốc TTL vẫn giữ — luật là "cũ HƠN ttl".
      { name: 'session-2.json', modifiedAt: now - ttlMs },
    ];

    expect(planPrune(files, policy)).toEqual(['session-1.json']);
  });

  /* `maxSessions: 3` tính cả phiên đang chạy ⇒ chỉ giữ thêm 2 phiên khác. */
  it('vượt `maxSessions` thì xoá phiên cũ nhất', () => {
    const files: LogStoreFile[] = [
      { name: 'session-6.json', modifiedAt: now - 2000 },
      { name: 'session-5.json', modifiedAt: now - 3000 },
      { name: 'session-9.json', modifiedAt: now },
      { name: 'session-7.json', modifiedAt: now - 1000 },
    ];

    expect(planPrune(files, policy)).toEqual(['session-5.json']);
  });

  it('không bao giờ xoá phiên hiện tại', () => {
    const files: LogStoreFile[] = [
      // Vừa quá hạn vừa vượt số phiên — vẫn không được đụng.
      { name: 'session-9.json', modifiedAt: 0 },
      { name: 'session-3.json', modifiedAt: now - 1000 },
    ];

    expect(planPrune(files, { ...policy, maxSessions: 1 })).toEqual(['session-3.json']);
  });

  it('bỏ qua file không đúng khuôn', () => {
    const files: LogStoreFile[] = [
      { name: 'ghi-chu.txt', modifiedAt: 0 },
      { name: 'session-abc.json', modifiedAt: 0 },
      { name: 'session-1.json.bak', modifiedAt: 0 },
    ];

    expect(planPrune(files, { ...policy, maxSessions: 1 })).toEqual([]);
  });
});

describe('pickPrevious', () => {
  const now = 1_000_000_000;
  const ttlMs = 72 * 3_600_000;
  const policy = { now, ttlMs, current: 'session-9.json' };

  it('lấy phiên mới nhất khác phiên hiện tại', () => {
    const files: LogStoreFile[] = [
      { name: 'session-7.json', modifiedAt: now - 2000 },
      { name: 'session-9.json', modifiedAt: now },
      { name: 'session-8.json', modifiedAt: now - 1000 },
    ];

    expect(pickPrevious(files, policy)).toBe('session-8.json');
  });

  it('phiên quá hạn không được chọn', () => {
    const files: LogStoreFile[] = [
      { name: 'session-9.json', modifiedAt: now },
      { name: 'session-8.json', modifiedAt: now - ttlMs - 1 },
    ];

    expect(pickPrevious(files, policy)).toBeUndefined();
  });
});
