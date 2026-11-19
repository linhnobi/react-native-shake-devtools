import { setExtraSecretKeys } from '../capture/redact';
import {
  APP_CONTEXT_MAX_CHARS,
  APP_CONTEXT_SUMMARY_LINES,
  APP_CONTEXT_TIMEOUT_MS,
  serializeAppContext,
  snapshotAppContext,
  type AppContextSnapshot,
  type AppContextState,
} from './app-context';
import { buildBugReport, type BugReport, type ReportDraft } from './bug-report';
import { jiraCloudConnector } from './connectors/jira';
import { toAdf } from './connectors/jira/adf';
import { larkConnector } from './connectors/lark';
import { LARK_APP_CARD_MAX_BYTES, toLarkCard } from './connectors/lark/card';
import { slackConnector } from './connectors/slack';
import { toSlackBlocks } from './connectors/slack/blocks';
import type { SendContext } from './connectors/types';
import { makeUploadPart } from './connectors/upload';
import { webhookConnector } from './connectors/webhook';
import { shareReport } from './share-report';

/** Chuỗi JWT ba phần — mẫu giá trị mà `redact.ts` che dù không có tên khoá. */
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXBhcnQ';

const snap = (value: unknown): AppContextSnapshot => {
  const s = serializeAppContext(value);
  if (s === null) throw new Error('expected a snapshot');
  return s;
};

const parsed = (value: unknown): Record<string, unknown> => JSON.parse(snap(value).json);

afterEach(() => {
  setExtraSecretKeys([]);
});

describe('serializeAppContext', () => {
  it('object thường ⇒ JSON thụt lề 2, giữ thứ tự khoá và kiểu giá trị', () => {
    const s = snap({ userId: 'u-42', env: 'uat', build: 1024, beta: true, cart: { items: 2 } });

    expect(s.json).toBe(
      JSON.stringify({ userId: 'u-42', env: 'uat', build: 1024, beta: true, cart: { items: 2 } }, null, 2),
    );
  });

  it('tham chiếu vòng ⇒ "[Circular]"; cùng một object ở hai nhánh (không vòng) vẫn in đủ cả hai', () => {
    const user: Record<string, unknown> = { id: 1 };
    user.self = user;
    const shared = { theme: 'dark' };

    const out = parsed({ user, a: shared, b: shared });

    expect(out.user).toEqual({ id: 1, self: '[Circular]' });
    expect(out.a).toEqual({ theme: 'dark' });
    expect(out.b).toEqual({ theme: 'dark' });
  });

  it('hàm, symbol, BigInt, undefined, NaN/Infinity ⇒ dấu đọc được (JSON.stringify sẽ bỏ hoặc ném)', () => {
    function onPay() {
      return 1;
    }
    const out = parsed({
      named: onPay,
      anon: (() => () => 1)(),
      sym: Symbol('flag'),
      big: BigInt('9007199254740993'),
      missing: undefined,
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
      list: [undefined, Symbol.for('x')],
    });

    expect(out).toEqual({
      named: '[Function onPay]',
      anon: '[Function]',
      sym: '[Symbol(flag)]',
      big: '9007199254740993n',
      missing: '[undefined]',
      nan: 'NaN',
      inf: 'Infinity',
      list: ['[undefined]', '[Symbol(x)]'],
    });
  });

  it('Date, Error, RegExp, Map, Set, mảng nhị phân ⇒ dạng JSON đọc được', () => {
    const out = parsed({
      at: new Date(Date.UTC(2026, 10, 18, 9, 30)),
      bad: new Date(Number.NaN),
      lastError: new TypeError('Network request failed'),
      pattern: /^ord-\d+$/i,
      flags: new Map<unknown, unknown>([
        ['newCheckout', true],
        [42, 'answer'],
      ]),
      tags: new Set(['a', 'b']),
      bytes: new Uint8Array(1024),
    });

    expect(out).toEqual({
      at: '2026-11-18T09:30:00.000Z',
      bad: '[Invalid Date]',
      lastError: { name: 'TypeError', message: 'Network request failed' },
      pattern: '/^ord-\\d+$/i',
      flags: { newCheckout: true, '42': 'answer' },
      tags: ['a', 'b'],
      bytes: '[Uint8Array(1024)]',
    });
  });

  it('toJSON của app được dùng (như JSON.stringify); toJSON ném ⇒ "[Unreadable]"', () => {
    const out = parsed({
      money: { toJSON: () => '12.50 USD' },
      broken: {
        toJSON: () => {
          throw new Error('nope');
        },
      },
    });

    expect(out).toEqual({ money: '12.50 USD', broken: '[Unreadable]' });
  });

  it('getter ném, Proxy ném ⇒ "[Unreadable]" tại chỗ đó, phần còn lại vẫn có, không ném ra ngoài', () => {
    const withGetter = {
      ok: 1,
      get boom(): number {
        throw new Error('getter exploded');
      },
    };
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('no keys for you');
        },
      },
    );

    const out = parsed({ withGetter, hostile, after: 'still here' });

    expect(out).toEqual({
      withGetter: { ok: 1, boom: '[Unreadable]' },
      hostile: '[Unreadable]',
      after: 'still here',
    });
  });

  it('khoá `__proto__` của dữ liệu được giữ như một khoá thường, không đổi prototype', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true},"a":1}');

    const s = snap(input);

    expect(JSON.parse(s.json)).toEqual(input);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  describe('giới hạn — luôn có dấu cắt nhìn thấy được', () => {
    it('quá sâu ⇒ "[Object]" / "[Array(n)]" ở tầng cắt', () => {
      let deep: Record<string, unknown> = { leaf: true, list: [1, 2, 3] };
      for (let i = 0; i < 20; i += 1) deep = { next: deep };

      const text = snap({ root: deep }).json;

      expect(text).toContain('"[Object]"');
      expect(text).not.toContain('"leaf"');
    });

    it('mảng dài ⇒ giữ phần đầu + "…+N more"; Set như mảng', () => {
      const out = parsed({
        ids: Array.from({ length: 250 }, (_, i) => i),
        seen: new Set(Array.from({ length: 150 }, (_, i) => `s${i}`)),
      });

      const ids = out.ids as unknown[];
      expect(ids.length).toBe(101);
      expect(ids[0]).toBe(0);
      expect(ids[ids.length - 1]).toBe('…+150 more');
      expect((out.seen as unknown[])[100]).toBe('…+50 more');
    });

    it('object nhiều khoá ⇒ phần đầu + khoá "…" = "+N more"; Map như object', () => {
      const many = Object.fromEntries(Array.from({ length: 230 }, (_, i) => [`k${i}`, i]));
      const map = new Map(Array.from({ length: 210 }, (_, i) => [`m${i}`, i] as const));

      const out = parsed({ many, map });

      expect(Object.keys(out.many as object).length).toBe(201);
      expect((out.many as Record<string, unknown>)['…']).toBe('+30 more');
      expect((out.map as Record<string, unknown>)['…']).toBe('+10 more');
    });

    it('chuỗi dài ⇒ cắt kèm "…+N" (dấu của `truncate`)', () => {
      const out = parsed({ note: 'x'.repeat(5000) });

      expect(out.note).toBe(`${'x'.repeat(2000)}…+3000`);
    });

    it('chuỗi rất lớn (vd ảnh base64 trong state) ⇒ chỉ che phần quanh mốc cắt; token vắt qua mốc cắt vẫn bị che', () => {
      const huge = 'a'.repeat(3_000_000);
      /* JWT thô bắt đầu ở 1986 và kéo qua mốc 2000; sau khi che, dấu `<redacted>` vừa trong 2000. */
      const straddling = `${'x'.repeat(1985)} ${JWT} ${'t'.repeat(9000)}`;

      const out = parsed({ huge, straddling });

      expect(out.huge).toBe(`${'a'.repeat(2000)}…+${3_000_000 - 2000}`);
      expect(out.straddling).not.toContain(JWT.slice(0, 12));
      expect(String(out.straddling).startsWith(`${'x'.repeat(1985)} <redacted>`)).toBe(true);
    });

    it(`tổng dung lượng ≤ ${APP_CONTEXT_MAX_CHARS} ký tự, vẫn là JSON hợp lệ, có dấu cắt`, () => {
      const store = {
        entities: Object.fromEntries(
          Array.from({ length: 150 }, (_, i) => [
            `order${i}`,
            { id: i, note: 'n'.repeat(1500), lines: Array.from({ length: 30 }, (_, j) => ({ sku: j })) },
          ]),
        ),
        after: 'tail',
      };

      const s = snap(store);

      expect(s.json.length).toBeLessThanOrEqual(APP_CONTEXT_MAX_CHARS);
      expect(() => JSON.parse(s.json)).not.toThrow();
      expect(s.json).toMatch(/"…": "\+\d+ more"/);
    });

    it('một lát state lớn đứng trước không nuốt mất các khoá nhỏ cấp đầu đứng sau', () => {
      const store = Object.fromEntries(
        Array.from({ length: 200 }, (_, i) => [`order${i}`, { note: 'n'.repeat(1500) }]),
      );

      const out = parsed({ store, userId: 'u-42', sentryEventId: 'e-1' });

      expect(out.userId).toBe('u-42');
      expect(out.sentryEventId).toBe('e-1');
      expect((out.store as Record<string, unknown>)['…']).toMatch(/^\+\d+ more$/);
    });
  });

  describe('che bí mật — cùng chính sách với thân request', () => {
    it('khoá bí mật ở mọi tầng (camelCase, snake_case, số, mảng) ⇒ "<redacted>"; khoá thường giữ', () => {
      const out = parsed({
        session: { accessToken: 'at-live-123', refresh_token: 'rt-456', expiresIn: 3600 },
        apiKey: 'k-789',
        user: { id: 'u-42', pin: 1234, recoveryCodes: ['a', 'b'] },
        token_type: 'Bearer',
      });

      expect(out).toEqual({
        session: { accessToken: '<redacted>', refresh_token: '<redacted>', expiresIn: 3600 },
        apiKey: '<redacted>',
        user: { id: 'u-42', pin: '<redacted>', recoveryCodes: ['a', 'b'] },
        token_type: 'Bearer',
      });
    });

    it('mẫu giá trị (JWT, Bearer, token có tiền tố) bị che kể cả dưới khoá thường và đầu dòng mới', () => {
      const text = snap({
        header: `Bearer ${'A'.repeat(24)}`,
        note: `first line\n${JWT}`,
        slack: 'xoxb-1234567890-abcdefghij',
      }).json;

      expect(text).not.toContain('AAAAAAAAAAAAAAAA');
      expect(text).not.toContain(JWT);
      expect(text).not.toContain('xoxb-1234567890');
      expect(JSON.parse(text).header).toBe('Bearer <redacted>');
    });

    it('khoá app thêm qua `redactKeys` (setExtraSecretKeys) cũng bị che, cả trong Map', () => {
      setExtraSecretKeys(['customerRef']);

      const out = parsed({
        customer_ref: 'c-1',
        nested: new Map([['customerRef', 'c-2']]),
      });

      expect(out).toEqual({ customer_ref: '<redacted>', nested: { customerRef: '<redacted>' } });
    });

    it('tóm tắt lấy từ bản đã che: không dòng nào mang bí mật', () => {
      const s = snap({ auth: { refreshToken: 'rt-secret-1' }, password: 'hunter2', userId: 'u-42' });

      const all = s.lines.map(([k, v]) => `${k}: ${v}`).join('\n');
      expect(all).not.toContain('rt-secret-1');
      expect(all).not.toContain('hunter2');
      expect(all).toContain('userId: u-42');
    });
  });

  describe('tóm tắt cho thân ticket', () => {
    it('một dòng mỗi khoá cấp đầu: chuỗi in thẳng, giá trị khác là JSON gọn', () => {
      const s = snap({ userId: 'u-42', build: 1024, flags: { newCheckout: true }, roles: ['qa'] });

      expect(s.lines).toEqual([
        ['userId', 'u-42'],
        ['build', '1024'],
        ['flags', '{"newCheckout":true}'],
        ['roles', '["qa"]'],
      ]);
      expect(s.more).toBe(0);
    });

    it(`tối đa ${APP_CONTEXT_SUMMARY_LINES} dòng, phần còn lại đếm ở \`more\`; giá trị dài cắt "…", xuống dòng thành dấu cách`, () => {
      const wide = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`k${i}`, i]));
      const s = snap({ ...wide, k0: `line1\nline2 ${'y'.repeat(300)}` });

      expect(s.lines.length).toBe(APP_CONTEXT_SUMMARY_LINES);
      expect(s.more).toBe(4);
      const [, first] = s.lines[0];
      expect(first.startsWith('line1 line2 yyy')).toBe(true);
      expect(first.endsWith('…')).toBe(true);
      expect(first.length).toBeLessThanOrEqual(100);
    });
  });

  it.each([
    ['chuỗi', 'user-42'],
    ['số', 42],
    ['mảng', [1, 2]],
    ['null', null],
    ['undefined', undefined],
    ['hàm', () => ({})],
  ])('giá trị cấp đầu không phải object (%s) ⇒ null', (_name, value) => {
    expect(serializeAppContext(value)).toBeNull();
  });
});

describe('snapshotAppContext', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('hàm đồng bộ ⇒ kết quả có NGAY (không phải Promise) — nháp có ngữ cảnh từ lúc mở form', () => {
    const state = snapshotAppContext(() => ({ userId: 'u-42' }));

    expect(state).toMatchObject({ status: 'ready', lines: [['userId', 'u-42']] });
  });

  it('hàm ném đồng bộ ⇒ `failed` / `threw`, không ném ra ngoài', () => {
    const state = snapshotAppContext(() => {
      throw new Error('store not ready');
    });

    expect(state).toEqual({ status: 'failed', reason: 'threw' });
  });

  it('trả junk (không phải object) ⇒ `failed` / `invalid`', () => {
    expect(snapshotAppContext(() => 'user-42')).toEqual({ status: 'failed', reason: 'invalid' });
    expect(snapshotAppContext(() => [1, 2])).toEqual({ status: 'failed', reason: 'invalid' });
  });

  it('hàm async ⇒ Promise resolve thành `ready`', async () => {
    const state = snapshotAppContext(async () => ({ sentryEventId: 'abc123' }));

    expect(state).toBeInstanceOf(Promise);
    await expect(state).resolves.toMatchObject({ status: 'ready', lines: [['sentryEventId', 'abc123']] });
  });

  it('Promise reject ⇒ `failed` / `threw`', async () => {
    const state = snapshotAppContext(() => Promise.reject(new Error('offline')));

    await expect(state).resolves.toEqual({ status: 'failed', reason: 'threw' });
  });

  it(`treo ⇒ \`failed\` / \`timeout\` đúng ở mốc ${APP_CONTEXT_TIMEOUT_MS} ms; kết quả về muộn bị bỏ`, async () => {
    let resolveLate: (v: object) => void = () => undefined;
    const state = snapshotAppContext(
      () =>
        new Promise<object>((resolve) => {
          resolveLate = resolve;
        }),
    ) as Promise<unknown>;
    let settled: unknown;
    void state.then((s) => {
      settled = s;
    });

    await jest.advanceTimersByTimeAsync(APP_CONTEXT_TIMEOUT_MS - 1);
    expect(settled).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ status: 'failed', reason: 'timeout' });

    resolveLate({ late: true });
    await jest.advanceTimersByTimeAsync(0);
    expect(settled).toEqual({ status: 'failed', reason: 'timeout' });
  });

  it('`then` là getter ném ⇒ `failed` / `threw`', () => {
    const evil = {
      get then(): unknown {
        throw new Error('trap');
      },
    };

    expect(snapshotAppContext(() => evil)).toEqual({ status: 'failed', reason: 'threw' });
  });
});

describe('khoá bí mật trong ngữ cảnh tới mọi kết nối đều đã che', () => {
  /** FormData giả ghi lại từng phần — như FormData của RN, nhận cả `{ uri | string, name, type }`. */
  class RecordingFormData {
    readonly parts: Array<{ name: string; value: unknown }> = [];
    append(name: string, value: unknown): void {
      this.parts.push({ name, value });
    }
  }
  const g = globalThis as unknown as { FormData: unknown };
  const realFormData = g.FormData;
  beforeAll(() => {
    g.FormData = RecordingFormData;
  });
  afterAll(() => {
    g.FormData = realFormData;
  });

  /** Giá trị thô của app — không chuỗi nào trong đây được rời máy. */
  const RAW = ['sk-ctx-apikey-0001', 'rt-ctx-0002', 'Z'.repeat(20), 'c-ref-0003'];
  const APP_CONTEXT = {
    userId: 'u-42',
    apiKey: RAW[0],
    session: { refreshToken: RAW[1] },
    header: `Bearer ${RAW[2]}`,
    customerRef: RAW[3],
  };

  const reportWithContext = (): BugReport => {
    setExtraSecretKeys(['customerRef']);
    const appContext = snapshotAppContext(() => APP_CONTEXT) as AppContextState;
    const draft: ReportDraft = {
      id: 'rpt-1',
      createdAt: 1_700_000_000_000,
      window: { from: 0, source: 'session' },
      title: 'Không thanh toán được',
      steps: [],
      actual: 'POST /orders → 500',
      expected: '',
      screenshot: 'none',
      attach: {
        screenshot: true,
        errors: false,
        deviceInfo: false,
        previousSession: false,
        appContext: true,
      },
      appContext,
    };
    return buildBugReport(draft, { entries: [], actions: [] });
  };

  /** Mọi thứ đã gửi ra: thân JSON/chữ và từng phần của FormData. */
  const sent: string[] = [];
  const outgoing = (body: unknown): string => {
    if (body instanceof RecordingFormData) {
      return body.parts
        .map((p) => (typeof p.value === 'string' ? p.value : JSON.stringify(p.value)))
        .join('\n');
    }
    return typeof body === 'string' ? body : JSON.stringify(body ?? null);
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  const ctxFor = (respond: (url: string, init?: RequestInit) => Response): SendContext => ({
    fetch: async (url: string, init?: RequestInit) => {
      sent.push(`${init?.method ?? 'GET'} ${url}\n${outgoing(init?.body)}`);
      return respond(url, init);
    },
    locale: 'en',
    timeoutMs: 1000,
    checkpoint: () => undefined,
    uploadPart: makeUploadPart({ reportId: 'rpt-1' }),
  });

  /** Không còn giá trị thô nào, và có dấu che (Slack mrkdwn escape nó thành `&lt;redacted&gt;`). */
  const expectMasked = (text: string) => {
    for (const raw of RAW) expect(text).not.toContain(raw);
    expect(text).toMatch(/<redacted>|&lt;redacted&gt;/);
  };

  beforeEach(() => {
    sent.length = 0;
  });

  it('bản báo: context.json và tóm tắt đã che; userId vẫn đọc được', () => {
    const report = reportWithContext();

    const file = report.files.find((f) => f.name === 'context.json');
    expectMasked(file?.content ?? '');
    expectMasked(JSON.stringify(report.appContext));
    expect(report.appContext?.lines).toContainEqual(['userId', 'u-42']);
  });

  it('Jira Cloud (gửi thật): mô tả ADF và file đính kèm', async () => {
    const report = reportWithContext();
    const SITE = 'https://acme.atlassian.net';
    const ctx = ctxFor((url, init) => {
      if (url.includes('/issue/createmeta/')) {
        return json(200, { startAt: 0, maxResults: 50, total: 0, fields: [] });
      }
      if (url.endsWith('/rest/api/3/issue')) return json(201, { id: '10100', key: 'DEMO-9' });
      if (url.endsWith('/attachments')) {
        const parts = (init?.body as unknown as RecordingFormData).parts;
        return json(
          200,
          parts.map((p, i) => ({ id: String(i), filename: (p.value as { name: string }).name })),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await jiraCloudConnector.send(
      report,
      { site: SITE, email: 'qa@acme.vn', project: '10000', issueType: '10001', baseUrl: SITE },
      { token: 'ATATT-not-a-real-token' },
      ctx,
    );

    const all = sent.join('\n');
    expect(all).toContain('App context');
    expect(all).toContain('context.json');
    expectMasked(all);
  });

  it('Webhook (gửi thật): JSON `report` và phần `context.json`', async () => {
    const ctx = ctxFor(() => new Response(null, { status: 204 }));

    await webhookConnector.send(reportWithContext(), { url: 'https://hooks.acme.test/bug' }, {}, ctx);

    const all = sent.join('\n');
    expect(all).toContain('"appContext"');
    expect(all).toContain('context.json');
    expectMasked(all);
  });

  it('Slack mức nhẹ và Lark mức nhẹ (gửi thật, chỉ chữ): mục App context có, đã che', async () => {
    await slackConnector.send(
      reportWithContext(),
      { mode: 'webhook' },
      { webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXXXXXX' },
      ctxFor(() => new Response('ok', { status: 200 })),
    );
    await larkConnector.send(
      reportWithContext(),
      { domain: 'lark', mode: 'webhook' },
      { webhookUrl: 'https://open.larksuite.com/open-apis/bot/v2/hook/abcd1234-ef56-7890' },
      ctxFor(() => json(200, { code: 0, msg: 'success', data: {} })),
    );

    expect(sent).toHaveLength(2);
    for (const request of sent) {
      expect(request).toContain('App context');
      expectMasked(request);
    }
  });

  it('Slack bot, Lark app (cùng bộ dựng chữ, cùng file đính kèm) và Chia sẻ', async () => {
    const report = reportWithContext();
    const shared: string[] = [];

    await shareReport(report, {
      locale: 'en',
      share: async (message) => {
        shared.push(message);
      },
    });

    const texts = [
      JSON.stringify(toSlackBlocks(report, 'en')),
      JSON.stringify(toLarkCard(report, 'en', { maxBytes: LARK_APP_CARD_MAX_BYTES })),
      JSON.stringify(toAdf(report, 'vi')),
      ...shared,
      ...report.files.map((f) => f.content ?? ''),
    ];
    for (const text of texts) {
      for (const raw of RAW) expect(text).not.toContain(raw);
    }
    expect(shared[0]).toContain('App context:');
  });
});
