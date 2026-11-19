import type { ConsoleEntry, LogEntry, NetworkEntry } from '../capture/log-entry';
import type { StoredSession } from '../capture/log-session';
import type { RecordedAction } from '../capture/recorded-action';
import { serializeAppContext, type AppContextState } from './app-context';
import { buildBugReport, newReportId, type ReportDraft } from './bug-report';

let nextId = 1;
const err = (at: number, text: string): ConsoleEntry => ({
  id: nextId++,
  kind: 'console',
  at,
  level: 'error',
  text,
});
const net = (at: number, over: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id: nextId++,
  kind: 'network',
  at,
  method: 'GET',
  url: '/api/x',
  status: 200,
  ...over,
});

const NO_CHIPS = {
  screenshot: false,
  errors: false,
  deviceInfo: false,
  previousSession: false,
  appContext: false,
};

const draft = (over: Partial<ReportDraft> = {}): ReportDraft => ({
  id: 'rpt-1-abcdef',
  createdAt: 1000,
  window: { from: 100, source: 'mark', markLabel: '1' },
  title: 'Crash khi thanh toán',
  steps: [{ id: '1:tap:0', kind: 'tap', at: 120, label: 'Pay' }],
  actual: 'App đứng',
  expected: 'Thanh toán xong',
  screenshot: { uri: 'file:///shot.jpg', mimeType: 'image/jpeg', width: 10, height: 20 },
  attach: {
    screenshot: true,
    errors: true,
    deviceInfo: true,
    previousSession: false,
    appContext: true,
  },
  ...over,
});

/** Ngữ cảnh app đã chụp (trạng thái `ready`) — đúng thứ bộ điều khiển đặt vào nháp. */
const readyContext = (value: object): AppContextState => {
  const snapshot = serializeAppContext(value);
  if (!snapshot) throw new Error('expected a snapshot');
  return { status: 'ready', ...snapshot };
};

const ctx = (over: Partial<Parameters<typeof buildBugReport>[1]> = {}) => ({
  entries: [] as LogEntry[],
  actions: [] as RecordedAction[],
  ...over,
});

const file = (r: ReturnType<typeof buildBugReport>, name: string) =>
  r.files.find((f) => f.name === name);

describe('buildBugReport', () => {
  it('chip Ảnh bật ⇒ screenshot.jpg mang uri của ảnh', () => {
    const f = file(buildBugReport(draft(), ctx()), 'screenshot.jpg');
    expect(f).toEqual({ name: 'screenshot.jpg', mimeType: 'image/jpeg', uri: 'file:///shot.jpg' });
  });

  it('ảnh png ⇒ screenshot.png', () => {
    const r = buildBugReport(
      draft({ screenshot: { uri: 'file:///s.png', mimeType: 'image/png', width: 1, height: 1 } }),
      ctx(),
    );
    expect(file(r, 'screenshot.png')?.mimeType).toBe('image/png');
    expect(file(r, 'screenshot.jpg')).toBeUndefined();
  });

  it('chip Ảnh tắt, hoặc không có ảnh ⇒ không có file ảnh', () => {
    expect(buildBugReport(draft({ attach: NO_CHIPS }), ctx()).files).toEqual([]);
    for (const screenshot of ['none', 'blocked', 'failed'] as const) {
      const r = buildBugReport(draft({ screenshot }), ctx());
      expect(r.files.some((f) => f.name.startsWith('screenshot'))).toBe(false);
    }
  });

  it('chip Log lỗi bật ⇒ errors.txt và timeline.json; chỉ lỗi trong cửa sổ', () => {
    const r = buildBugReport(
      draft(),
      ctx({
        entries: [err(50, 'OLD failure'), err(150, 'NEW failure'), net(160)],
        actions: [{ at: 120, kind: 'tap', label: 'Pay', source: 'text' }],
      }),
    );
    const errors = file(r, 'errors.txt');
    expect(errors?.mimeType).toBe('text/plain');
    expect(errors?.content).toContain('NEW failure');
    expect(errors?.content).not.toContain('OLD failure');
    const timeline = file(r, 'timeline.json');
    expect(timeline?.mimeType).toBe('application/json');
    const items = JSON.parse(timeline?.content ?? '[]') as Array<{ at: number }>;
    expect(items.map((i) => i.at)).toEqual([120, 150, 160]);
  });

  it('chip Log lỗi tắt ⇒ không có errors.txt lẫn timeline.json', () => {
    const r = buildBugReport(
      draft({ attach: { ...NO_CHIPS, deviceInfo: true } }),
      ctx({ entries: [err(150, 'x')] }),
    );
    expect(file(r, 'errors.txt')).toBeUndefined();
    expect(file(r, 'timeline.json')).toBeUndefined();
  });

  it('errors.txt đã che header và thân', () => {
    const r = buildBugReport(
      draft(),
      ctx({
        entries: [
          net(150, {
            status: 500,
            requestHeaders: { Authorization: 'Bearer abc123' },
            requestBody: '{"password":"hunter2"}',
          }),
        ],
      }),
    );
    const content = file(r, 'errors.txt')?.content ?? '';
    expect(content).not.toContain('abc123');
    expect(content).not.toContain('hunter2');
  });

  /*
    Phiên crash đọc từ đĩa có thể do bản cũ ghi, khi JSON nén có `=` (token base64 có đệm) còn bị coi
    là thân form nên xuống đĩa nguyên token. `errors.txt` và `previous-session.txt` che lại lúc xuất.
  */
  it('nháp crash: token base64 có đệm trong phiên đĩa cũ (chưa che) vẫn bị che ở errors.txt và previous-session.txt', () => {
    const previous: StoredSession = {
      format: 2,
      name: 'session-1.json',
      startedAt: 1,
      savedAt: 2,
      fatal: true,
      totalInMemory: 1,
      entries: [
        net(3, {
          status: 401,
          url: '/api/token',
          requestBody: '{"refreshToken":"dGVzdA=="}',
          responseBody: '{"accessToken":"YWJjZA==","expiresIn":60}',
        }),
      ],
    };
    const r = buildBugReport(
      draft({
        crash: { sessionName: 'session-1.json' },
        attach: { ...NO_CHIPS, errors: true, previousSession: true },
      }),
      ctx({ previous }),
    );

    for (const name of ['errors.txt', 'previous-session.txt']) {
      const content = file(r, name)?.content ?? '';
      expect(content).toContain('/api/token');
      expect(content).toContain('"refreshToken": "<redacted>"');
      expect(content).not.toContain('dGVzdA');
      expect(content).not.toContain('YWJjZA');
    }
  });

  it('chip Thông tin máy bật + có sessionInfo ⇒ deviceInfo; tắt ⇒ undefined', () => {
    const base = ctx({ sessionInfo: { env: 'UAT', device: 'Pixel' } });
    expect(buildBugReport(draft(), base).deviceInfo).toEqual([
      ['Env', 'UAT'],
      ['Device', 'Pixel'],
    ]);
    const off = buildBugReport(draft({ attach: { ...NO_CHIPS, errors: true } }), base);
    expect(off.deviceInfo).toBeUndefined();
    expect(file(off, 'errors.txt')?.content).not.toContain('Pixel');
    expect(buildBugReport(draft(), ctx()).deviceInfo).toBeUndefined();
  });

  it('sessionStartedAt đi vào deviceInfo', () => {
    const r = buildBugReport(draft(), ctx({ sessionInfo: { env: 'UAT' }, sessionStartedAt: 5 }));
    expect(r.deviceInfo?.map(([k]) => k)).toEqual(['Env', 'Session']);
  });

  it('chip Phiên trước bật + có previous ⇒ previous-session.txt; thiếu previous hoặc chip tắt ⇒ không', () => {
    const previous: StoredSession = {
      format: 2,
      name: 'session-1.json',
      startedAt: 1,
      savedAt: 2,
      fatal: true,
      build: 'UAT · 1.0',
      totalInMemory: 1,
      entries: [err(1, 'FATAL boom')],
    };
    const attach = { ...NO_CHIPS, previousSession: true };
    const f = file(buildBugReport(draft({ attach }), ctx({ previous })), 'previous-session.txt');
    expect(f?.mimeType).toBe('text/plain');
    expect(f?.content).toContain('(previous session)');
    expect(f?.content).toContain('FATAL boom');
    expect(file(buildBugReport(draft({ attach }), ctx()), 'previous-session.txt')).toBeUndefined();
    expect(file(buildBugReport(draft(), ctx({ previous })), 'previous-session.txt')).toBeUndefined();
  });

  it('nháp crash ⇒ errors.txt và timeline.json lấy từ phiên crash (cùng nguồn với các bước), không từ phiên hiện tại', () => {
    const previous: StoredSession = {
      format: 2,
      name: 'session-1.json',
      startedAt: 1,
      savedAt: 2,
      fatal: true,
      totalInMemory: 2,
      entries: [net(3, { status: 500, url: '/api/cart' }), err(4, 'FATAL boom')],
      actions: [{ at: 2, kind: 'tap', label: 'Thanh toán', source: 'text' }],
    };
    const r = buildBugReport(
      draft({
        crash: { sessionName: 'session-1.json' },
        attach: { ...NO_CHIPS, errors: true, previousSession: true },
      }),
      ctx({
        /* Phiên hiện tại (sau khi mở lại app): lỗi và thao tác khác hẳn, cùng cửa sổ của nháp. */
        entries: [err(150, 'AFTER restart')],
        actions: [{ at: 120, kind: 'tap', label: 'Mở panel', source: 'text' }],
        sessionStartedAt: 100,
        sessionInfo: { env: 'UAT' },
        previous,
      }),
    );

    const errors = file(r, 'errors.txt')?.content ?? '';
    expect(errors).toContain('FATAL boom');
    expect(errors).toContain('/api/cart');
    expect(errors).not.toContain('AFTER restart');
    const items = JSON.parse(file(r, 'timeline.json')?.content ?? '[]') as Array<{
      at: number;
      label?: string;
    }>;
    expect(items.map((i) => i.at)).toEqual([2, 3, 4]);
    expect(items[0]?.label).toBe('Thanh toán');
    /* Phiên khác (tên lệch) ⇒ không phải phiên của nháp này ⇒ vẫn lấy phiên hiện tại. */
    const other = buildBugReport(
      draft({ crash: { sessionName: 'session-0.json' }, attach: { ...NO_CHIPS, errors: true } }),
      ctx({ entries: [err(150, 'AFTER restart')], previous }),
    );
    expect(file(other, 'errors.txt')?.content).toContain('AFTER restart');
  });

  it('chip Ngữ cảnh app bật + đã chụp ⇒ context.json (sau timeline.json) và `appContext` tóm tắt', () => {
    const appContext = readyContext({ userId: 'u-42', session: { accessToken: 'at-live-1' } });
    const r = buildBugReport(draft({ appContext }), ctx());

    expect(r.files.map((f) => f.name)).toEqual([
      'screenshot.jpg',
      'errors.txt',
      'timeline.json',
      'context.json',
    ]);
    const json = file(r, 'context.json');
    expect(json?.mimeType).toBe('application/json');
    expect(JSON.parse(json?.content ?? '{}')).toEqual({
      userId: 'u-42',
      session: { accessToken: '<redacted>' },
    });
    expect(r.appContext).toEqual({
      lines: [
        ['userId', 'u-42'],
        ['session', '{"accessToken":"<redacted>"}'],
      ],
      more: 0,
    });
  });

  it('chip Ngữ cảnh app tắt, chưa chụp xong, chụp hỏng, hoặc app không cấp ⇒ không file, không tóm tắt', () => {
    const appContext = readyContext({ userId: 'u-42' });
    const cases: ReportDraft[] = [
      draft({ appContext, attach: { ...NO_CHIPS, errors: true } }),
      draft({ appContext: { status: 'pending' } }),
      draft({ appContext: { status: 'failed', reason: 'timeout' } }),
      draft(),
    ];
    for (const d of cases) {
      const r = buildBugReport(d, ctx());
      expect(file(r, 'context.json')).toBeUndefined();
      expect(r.appContext).toBeUndefined();
    }
  });

  it('nháp crash ⇒ không bao giờ kèm ngữ cảnh app (ngữ cảnh lúc này không phải của phiên crash)', () => {
    const r = buildBugReport(
      draft({ crash: { sessionName: 'session-1.json' }, appContext: readyContext({ userId: 'u-42' }) }),
      ctx(),
    );

    expect(file(r, 'context.json')).toBeUndefined();
    expect(r.appContext).toBeUndefined();
  });

  it('expected rỗng ⇒ undefined; subtitle và nội dung chuyển nguyên', () => {
    const r = buildBugReport(draft({ expected: '   ' }), ctx({ subtitle: 'UAT · 1.0.2' }));
    expect(r.expected).toBeUndefined();
    expect(r.subtitle).toBe('UAT · 1.0.2');
    expect(r).toMatchObject({
      id: 'rpt-1-abcdef',
      createdAt: 1000,
      title: 'Crash khi thanh toán',
      actual: 'App đứng',
    });
    expect(r.steps).toHaveLength(1);
    expect(buildBugReport(draft({ expected: '' }), ctx()).expected).toBeUndefined();
  });
});

describe('newReportId', () => {
  it('khớp khuôn rpt-<base36>-<6 ký tự>', () => {
    expect(newReportId(1790000000000, () => 0.5)).toMatch(/^rpt-[0-9a-z]+-[0-9a-z]{6}$/);
  });

  it('tất định theo đầu vào, đệm 0 và chịu được random() sát 1', () => {
    expect(newReportId(36, () => 0)).toBe('rpt-10-000000');
    expect(newReportId(36, () => 0)).toBe(newReportId(36, () => 0));
    expect(newReportId(36, () => 0.9999999999)).toMatch(/^rpt-10-[0-9a-z]{6}$/);
  });
});
