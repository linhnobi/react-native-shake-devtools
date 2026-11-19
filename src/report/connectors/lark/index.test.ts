import type { BugReport } from '../../bug-report';
import { utf8Bytes } from '../encoding';
import { ConnectorError, type SendContext } from '../types';
import { makeUploadPart } from '../upload';
import { larkConnector } from './index';
import { larkSign } from './sign';

/** FormData giả ghi lại từng phần — giống FormData của RN, nhận cả `{ uri, name, type }`. */
class RecordingFormData {
  readonly parts: Array<{ name: string; value: unknown; fileName?: string }> = [];
  append(name: string, value: unknown, fileName?: string): void {
    this.parts.push({ name, value, fileName });
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

const DOMAINS = { lark: 'https://open.larksuite.com', feishu: 'https://open.feishu.cn' } as const;
const HOOK_TOKEN = 'abcd1234-ef56-7890-abcd-1234567890ab';
const hookOf = (domain: keyof typeof DOMAINS) =>
  `${DOMAINS[domain]}/open-apis/bot/v2/hook/${HOOK_TOKEN}`;
const SIGN_SECRET = 'sign-secret-xyz';
const APP_SECRET = 'app-secret-0123456789';
const TOKEN = 't-token-abcdef123456';

const WEBHOOK_VALUES = { domain: 'lark', mode: 'webhook' } as const;
const WEBHOOK_SECRETS = { webhookUrl: hookOf('lark') };
const APP_VALUES = { domain: 'lark', mode: 'app', appId: 'cli_a1b2c3', chatId: 'oc_abc123' } as const;
const APP_SECRETS = { appSecret: APP_SECRET };

const report = (over: Partial<BugReport> = {}): BugReport => ({
  id: 'rpt-1',
  createdAt: 1_700_000_000_000,
  title: 'Crash khi thanh toán',
  steps: [{ id: 'a', kind: 'tap', at: 1, label: 'Thanh toán' }],
  actual: 'POST /orders → 500',
  expected: 'Thanh toán thành công',
  deviceInfo: [['App', '1.2.3']],
  files: [
    { name: 'screenshot.jpg', mimeType: 'image/jpeg', uri: 'file:///cache/s.jpg' },
    { name: 'errors.txt', mimeType: 'text/plain', content: 'boom' },
    { name: 'timeline.json', mimeType: 'application/json', content: '[]' },
  ],
  ...over,
});

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), {
    status,
  });
const ok = (data: unknown = {}) => reply(200, { code: 0, msg: 'success', data });

type Route = (init?: RequestInit) => Response | Promise<Response>;

/** Ngữ cảnh gửi giả: fetch theo bảng `"<METHOD> <url>"`, request lạ ⇒ ném để test đỏ rõ ràng. */
const makeCtx = (
  routes: Record<string, Route>,
  opts: {
    locale?: 'vi' | 'en';
    resume?: Record<string, unknown>;
    uploadPart?: SendContext['uploadPart'];
  } = {},
) => {
  const fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const route = routes[key];
    if (!route) throw new Error(`Unexpected request: ${key}`);
    return route(init);
  });
  const checkpoint = jest.fn();
  /* Mặc định: phần upload thật, app KHÔNG cấp `writeTempFile` (R43) — file chữ là phần chuỗi. */
  const uploadPart = jest.fn(opts.uploadPart ?? makeUploadPart({ reportId: 'rpt-1' }));
  const ctx: SendContext = {
    fetch,
    locale: opts.locale ?? 'en',
    timeoutMs: 1000,
    ...(opts.resume !== undefined ? { resume: opts.resume } : {}),
    checkpoint,
    uploadPart,
  };
  const calls = () => fetch.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`);
  const initOf = (key: string) => {
    const i = calls().indexOf(key);
    return i < 0 ? undefined : (fetch.mock.calls[i][1] as RequestInit);
  };
  return { ctx, fetch, checkpoint, uploadPart, calls, initOf };
};

const bodyOf = (init: RequestInit | undefined) => JSON.parse(String(init?.body));
const partsOf = (init: RequestInit | undefined) =>
  (init?.body as unknown as RecordingFormData).parts;
const part = (init: RequestInit | undefined, name: string) =>
  partsOf(init).find((p) => p.name === name)?.value;

describe('larkConnector — khai báo', () => {
  it('id, bí mật, khả năng và cảnh báo bí mật sống lâu theo chế độ', () => {
    expect(larkConnector.id).toBe('lark');
    expect(larkConnector.secretFieldIds).toEqual(['webhookUrl', 'signSecret', 'appSecret']);
    expect(larkConnector.capabilities({ mode: 'webhook' })).toEqual({ image: false, files: false });
    expect(larkConnector.capabilities({ mode: 'app' })).toEqual({ image: true, files: true });
    expect(larkConnector.longLivedSecret?.({ mode: 'app' })).toBe(true);
    expect(larkConnector.longLivedSecret?.({ mode: 'webhook' })).toBe(false);
  });

  it('ô nhập: loại, bí mật và điều kiện hiện theo mode', () => {
    const fields = larkConnector.fields('en');
    expect(fields.map((f) => [f.id, f.kind])).toEqual([
      ['domain', 'select'],
      ['mode', 'select'],
      ['webhookUrl', 'secret'],
      ['signSecret', 'secret'],
      ['appId', 'text'],
      ['appSecret', 'secret'],
      ['chatId', 'text'],
    ]);
    const byId = (id: string) => fields.find((f) => f.id === id);
    expect(byId('domain')?.options?.map((o) => o.id)).toEqual(['lark', 'feishu']);
    expect(byId('mode')?.options?.map((o) => o.id)).toEqual(['webhook', 'app']);
    expect(byId('webhookUrl')?.visibleWhen).toEqual({ field: 'mode', equals: 'webhook' });
    expect(byId('signSecret')?.visibleWhen).toEqual({ field: 'mode', equals: 'webhook' });
    expect(byId('signSecret')?.required).toBeFalsy();
    for (const id of ['appId', 'appSecret', 'chatId']) {
      expect(byId(id)?.visibleWhen).toEqual({ field: 'mode', equals: 'app' });
    }
  });

  it('nhãn theo ngôn ngữ; ô App Secret mang cảnh báo spec 5.4.2', () => {
    expect(larkConnector.label('vi')).toBe('Lark / Feishu');
    expect(larkConnector.fields('vi')[0].label).toBe('Nền tảng');
    expect(larkConnector.fields('en')[0].label).toBe('Platform');
    const secretVi = larkConnector.fields('vi').find((f) => f.id === 'appSecret');
    const secretEn = larkConnector.fields('en').find((f) => f.id === 'appSecret');
    expect(secretVi?.help).toContain('im:resource');
    expect(secretEn?.help).toContain('im:resource');
  });
});

describe('larkConnector.send — webhook bot nhóm', () => {
  const WEBHOOK = (domain: keyof typeof DOMAINS = 'lark') => `POST ${hookOf(domain)}`;

  it.each(['lark', 'feishu'] as const)('%s: POST { msg_type: interactive, card } tới webhook', async (domain) => {
    const { ctx, calls, initOf } = makeCtx({ [WEBHOOK(domain)]: () => ok() });

    const result = await larkConnector.send(
      report(),
      { domain, mode: 'webhook' },
      { webhookUrl: hookOf(domain) },
      ctx,
    );

    expect(calls()).toEqual([WEBHOOK(domain)]);
    const init = initOf(WEBHOOK(domain));
    const body = bodyOf(init);
    expect(body.msg_type).toBe('interactive');
    expect(body.card.header.title.content).toBe('Crash khi thanh toán');
    expect(JSON.stringify(body.card)).toContain('Tap');
    expect(body.sign).toBeUndefined();
    expect(body.timestamp).toBeUndefined();
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json; charset=utf-8');
    expect(result).toEqual({});
  });

  it('thẻ theo ngôn ngữ kết nối và ghi chú "không gửi được file" khi bản báo có file', async () => {
    const { ctx, initOf } = makeCtx({ [WEBHOOK()]: () => ok() }, { locale: 'vi' });
    await larkConnector.send(report(), WEBHOOK_VALUES, WEBHOOK_SECRETS, ctx);
    const json = JSON.stringify(bodyOf(initOf(WEBHOOK())).card);
    expect(json).toContain('Các bước');
    expect(json).toContain('File đính kèm không gửi được qua kênh này.');
  });

  it('không có file thì không có ghi chú file', async () => {
    const { ctx, initOf } = makeCtx({ [WEBHOOK()]: () => ok() });
    await larkConnector.send(report({ files: [] }), WEBHOOK_VALUES, WEBHOOK_SECRETS, ctx);
    expect(JSON.stringify(bodyOf(initOf(WEBHOOK())).card)).not.toContain('Attachments cannot');
  });

  it('không gọi uploadPart (webhook không có ảnh/file)', async () => {
    const { ctx, uploadPart } = makeCtx({ [WEBHOOK()]: () => ok() });
    await larkConnector.send(report(), WEBHOOK_VALUES, WEBHOOK_SECRETS, ctx);
    expect(uploadPart).not.toHaveBeenCalled();
  });

  it('có signSecret ⇒ kèm timestamp (giây, chuỗi) và sign đúng', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_599_360_473_900);
    try {
      const { ctx, initOf } = makeCtx({ [WEBHOOK()]: () => ok() });
      await larkConnector.send(
        report(),
        WEBHOOK_VALUES,
        { ...WEBHOOK_SECRETS, signSecret: SIGN_SECRET },
        ctx,
      );
      const body = bodyOf(initOf(WEBHOOK()));
      expect(body.timestamp).toBe('1599360473');
      expect(body.sign).toBe(larkSign(SIGN_SECRET, 1599360473));
    } finally {
      now.mockRestore();
    }
  });

  it('thân tin ≤ 20 KB kể cả có chữ ký: bug 200 bước × 200 ký tự, tiêu đề 5000 ký tự (Review Focus 1)', async () => {
    const steps = Array.from({ length: 200 }, (_, i) => ({
      id: `s${i}`,
      kind: 'text' as const,
      at: i,
      text: `${i}-${'ớ'.repeat(199 - String(i).length)}`,
    }));
    const { ctx, initOf } = makeCtx({ [WEBHOOK()]: () => ok() }, { locale: 'vi' });
    await larkConnector.send(
      report({ steps, title: 'T'.repeat(5000), actual: 'l'.repeat(5000) }),
      WEBHOOK_VALUES,
      { ...WEBHOOK_SECRETS, signSecret: SIGN_SECRET },
      ctx,
    );

    const raw = String(initOf(WEBHOOK())?.body);
    expect(utf8Bytes(raw).length).toBeLessThanOrEqual(20 * 1024);
    expect(raw).toContain('(Nội dung đã bị cắt bớt.)');
    expect(JSON.parse(raw).sign).toBeDefined();
  });

  it('phản hồi kiểu cũ { StatusCode: 0 } vẫn là thành công', async () => {
    const { ctx } = makeCtx({ [WEBHOOK()]: () => reply(200, { StatusCode: 0, StatusMessage: 'success' }) });
    await expect(
      larkConnector.send(report(), WEBHOOK_VALUES, WEBHOOK_SECRETS, ctx),
    ).resolves.toEqual({});
  });

  it.each([
    [19021, 'auth'],
    [19022, 'permission'],
    [19024, 'permission'],
    [11232, 'rate-limit'],
    [9499, 'validation'],
    [99999, 'unknown'],
  ] as const)('HTTP 200 với code %i ⇒ %s', async (code, kind) => {
    const { ctx } = makeCtx({ [WEBHOOK()]: () => reply(200, { code, msg: 'x' }) });
    await expect(
      larkConnector.send(report(), WEBHOOK_VALUES, WEBHOOK_SECRETS, ctx),
    ).rejects.toMatchObject({ name: 'ConnectorError', kind });
  });

  it('19021: message dặn kiểm tra khoá ký và giờ máy, theo ngôn ngữ', async () => {
    const { ctx } = makeCtx({ [WEBHOOK()]: () => reply(200, { code: 19021, msg: 'sign match fail' }) }, { locale: 'vi' });
    await expect(
      larkConnector.send(report(), WEBHOOK_VALUES, WEBHOOK_SECRETS, ctx),
    ).rejects.toThrow('khoá ký');
  });

  it('HTTP 400 kèm { code } trong thân vẫn được ánh xạ theo code (không phải theo status)', async () => {
    const { ctx } = makeCtx({
      [WEBHOOK()]: () => reply(400, { code: 11232, msg: 'frequency limited' }),
    });
    await expect(
      larkConnector.send(report(), WEBHOOK_VALUES, WEBHOOK_SECRETS, ctx),
    ).rejects.toMatchObject({ kind: 'rate-limit', status: 400 });
  });

  it('code lạ + HTTP 429 ⇒ giữ rate-limit và retryAfterMs của HTTP (không thành unknown)', async () => {
    const { ctx } = makeCtx({
      [WEBHOOK()]: () =>
        new Response(JSON.stringify({ code: 77777, msg: `slow ${SIGN_SECRET}` }), {
          status: 429,
          headers: { 'Retry-After': '7' },
        }),
    });
    const error = await larkConnector
      .send(report(), WEBHOOK_VALUES, { ...WEBHOOK_SECRETS, signSecret: SIGN_SECRET }, ctx)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'rate-limit', retryAfterMs: 7000, status: 429 });
    expect((error as ConnectorError).message).not.toContain(SIGN_SECRET);
  });

  it.each([
    [401, 'auth'],
    [403, 'permission'],
    [400, 'validation'],
  ] as const)('code lạ + HTTP %i ⇒ giữ nhóm %s do HTTP phân loại', async (status, kind) => {
    const { ctx } = makeCtx({
      [WEBHOOK()]: () => reply(status, { code: 77777, msg: `denied ${HOOK_TOKEN}` }),
    });
    const error = await larkConnector
      .send(report(), WEBHOOK_VALUES, WEBHOOK_SECRETS, ctx)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind, status });
    expect((error as ConnectorError).message).not.toContain(HOOK_TOKEN);
  });

  it('HTTP 500 không có code ⇒ giữ nguyên lỗi của requestJson', async () => {
    const { ctx } = makeCtx({ [WEBHOOK()]: () => reply(500, 'oops') });
    await expect(
      larkConnector.send(report(), WEBHOOK_VALUES, WEBHOOK_SECRETS, ctx),
    ).rejects.toMatchObject({ kind: 'unknown', status: 500 });
  });

  it('2xx nhưng thân rỗng hoặc không có code ⇒ unknown (không coi là đã gửi)', async () => {
    const empty = makeCtx({ [WEBHOOK()]: () => reply(200) });
    await expect(
      larkConnector.send(report(), WEBHOOK_VALUES, WEBHOOK_SECRETS, empty.ctx),
    ).rejects.toMatchObject({ kind: 'unknown' });
    const noCode = makeCtx({ [WEBHOOK()]: () => reply(200, {}) });
    await expect(
      larkConnector.send(report(), WEBHOOK_VALUES, WEBHOOK_SECRETS, noCode.ctx),
    ).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('bí mật (URL, token trong URL, khoá ký) không lọt vào message lỗi', async () => {
    const { ctx } = makeCtx({
      [WEBHOOK()]: () =>
        reply(200, { code: 55555, msg: `bad ${hookOf('lark')} ${HOOK_TOKEN} ${SIGN_SECRET}` }),
    });
    const error = await larkConnector
      .send(report(), WEBHOOK_VALUES, { ...WEBHOOK_SECRETS, signSecret: SIGN_SECRET }, ctx)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorError);
    const message = (error as ConnectorError).message;
    expect(message).toContain('55555');
    for (const secret of [hookOf('lark'), HOOK_TOKEN, SIGN_SECRET]) {
      expect(message).not.toContain(secret);
    }
  });

  it.each([
    ['http thường', 'http://open.larksuite.com/open-apis/bot/v2/hook/abc'],
    ['host lạ', 'https://evil.example.com/open-apis/bot/v2/hook/abc'],
    ['host giả có đuôi', 'https://open.larksuite.com.evil.com/open-apis/bot/v2/hook/abc'],
    ['sai đường dẫn', 'https://open.larksuite.com/open-apis/im/v1/messages'],
    ['thừa đường dẫn', 'https://open.larksuite.com/open-apis/bot/v2/hook/abc/extra'],
    ['rỗng', ''],
    ['khác nền tảng đã chọn (Feishu)', 'https://open.feishu.cn/open-apis/bot/v2/hook/abc'],
  ])('webhook URL sai (%s) ⇒ validation trên webhookUrl, không gọi mạng', async (_name, url) => {
    const { ctx, fetch } = makeCtx({});
    const error = await larkConnector
      .send(report(), WEBHOOK_VALUES, { webhookUrl: url }, ctx)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'validation', field: 'webhookUrl' });
    expect((error as ConnectorError).message).not.toContain(url || '\u0000');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('thiếu nền tảng hoặc cách kết nối ⇒ validation trên đúng ô', async () => {
    const { ctx, fetch } = makeCtx({});
    await expect(
      larkConnector.send(report(), { mode: 'webhook' }, WEBHOOK_SECRETS, ctx),
    ).rejects.toMatchObject({ kind: 'validation', field: 'domain' });
    await expect(
      larkConnector.send(report(), { domain: 'lark' }, WEBHOOK_SECRETS, ctx),
    ).rejects.toMatchObject({ kind: 'validation', field: 'mode' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lỗi mạng của ctx.fetch được ném nguyên (hàng đợi tự gửi lại)', async () => {
    const { ctx } = makeCtx({
      [WEBHOOK()]: () => {
        throw new ConnectorError('network', 'Network request failed');
      },
    });
    await expect(
      larkConnector.send(report(), WEBHOOK_VALUES, WEBHOOK_SECRETS, ctx),
    ).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('larkConnector.test — webhook', () => {
  it('chỉ kiểm giá trị, không gọi mạng (không spam nhóm); URL sai ⇒ validation', async () => {
    const { ctx, fetch } = makeCtx({});
    await expect(
      larkConnector.test(WEBHOOK_VALUES, WEBHOOK_SECRETS, ctx),
    ).resolves.toEqual({});
    await expect(
      larkConnector.test(WEBHOOK_VALUES, { webhookUrl: 'https://x.com/a' }, ctx),
    ).rejects.toMatchObject({ kind: 'validation', field: 'webhookUrl' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe.each(['lark', 'feishu'] as const)('larkConnector — app (%s)', (domain) => {
  const BASE = DOMAINS[domain];
  const VALUES = { ...APP_VALUES, domain };
  const TOKEN_URL = `POST ${BASE}/open-apis/auth/v3/tenant_access_token/internal`;
  const IMAGE_URL = `POST ${BASE}/open-apis/im/v1/images`;
  const FILE_URL = `POST ${BASE}/open-apis/im/v1/files`;
  const MESSAGE_URL = `POST ${BASE}/open-apis/im/v1/messages?receive_id_type=chat_id`;
  const CHAT_URL = `GET ${BASE}/open-apis/im/v1/chats/oc_abc123`;

  const tokenRoute: Route = () => reply(200, { code: 0, msg: 'ok', tenant_access_token: TOKEN, expire: 7200 });
  /** Tên file đang upload (từ phần `file_name`) ⇒ khoá file trả về. */
  const fileUpload: Route = (init) => {
    const name = String(part(init, 'file_name'));
    return ok({ file_key: `fk_${name}` });
  };
  const fullRoutes = (): Record<string, Route> => ({
    [TOKEN_URL]: tokenRoute,
    [IMAGE_URL]: () => ok({ image_key: 'img_v2_k1' }),
    [FILE_URL]: fileUpload,
    [MESSAGE_URL]: () => ok({ message_id: 'om_1' }),
  });

  describe('send', () => {
    it('luồng đầy đủ: token → ảnh → file → thẻ (uuid = report.id) → từng file một tin (uuid -f<n>)', async () => {
      const { ctx, calls, initOf } = makeCtx(fullRoutes());
      const result = await larkConnector.send(report(), VALUES, APP_SECRETS, ctx);

      expect(calls()).toEqual([
        TOKEN_URL,
        IMAGE_URL,
        FILE_URL,
        FILE_URL,
        MESSAGE_URL,
        MESSAGE_URL,
        MESSAGE_URL,
      ]);

      // 1. token
      expect(bodyOf(initOf(TOKEN_URL))).toEqual({ app_id: 'cli_a1b2c3', app_secret: APP_SECRET });

      // 2. ảnh: image_type=message; file: file_type=stream + file_name; Bearer token, không tự đặt Content-Type
      const image = initOf(IMAGE_URL);
      expect(part(image, 'image_type')).toBe('message');
      expect(part(image, 'image')).toEqual({ uri: 'file:///cache/s.jpg', name: 'screenshot.jpg', type: 'image/jpeg' });
      expect((image?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      expect((image?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
      const fileInits = (ctx.fetch as unknown as jest.Mock).mock.calls
        .filter(([url]) => String(url).endsWith('/im/v1/files'))
        .map(([, init]) => init as RequestInit);
      expect(fileInits.map((i) => [part(i, 'file_type'), part(i, 'file_name')])).toEqual([
        ['stream', 'errors.txt'],
        ['stream', 'timeline.json'],
      ]);
      /* Không có `writeTempFile`: file chữ là phần chuỗi `{ string, name, type }`, không Blob (I1, R43). */
      expect(part(fileInits[0], 'file')).toEqual({
        string: expect.any(String),
        name: 'errors.txt',
        type: 'text/plain',
      });
      expect(
        [image, ...fileInits].flatMap((i) => partsOf(i)).some((p) => p.value instanceof Blob),
      ).toBe(false);

      // 3. thẻ + hai tin file
      const messages = (ctx.fetch as unknown as jest.Mock).mock.calls
        .filter(([url]) => String(url).includes('/im/v1/messages'))
        .map(([, init]) => bodyOf(init as RequestInit));
      expect(messages).toHaveLength(3);
      expect(messages[0]).toMatchObject({ receive_id: 'oc_abc123', msg_type: 'interactive', uuid: 'rpt-1' });
      const card = JSON.parse(messages[0].content);
      expect(card.elements[0]).toMatchObject({ tag: 'img', img_key: 'img_v2_k1' });
      expect(messages[1]).toMatchObject({
        receive_id: 'oc_abc123',
        msg_type: 'file',
        uuid: 'rpt-1-f2',
        content: JSON.stringify({ file_key: 'fk_errors.txt' }),
      });
      expect(messages[2]).toMatchObject({
        msg_type: 'file',
        uuid: 'rpt-1-f3',
        content: JSON.stringify({ file_key: 'fk_timeline.json' }),
      });
      /* M5: id tin nhắn (`om_…`) không có nghĩa với QA ⇒ không phải `key`; màn kết quả ghi "Đã gửi". */
      expect(result).toEqual({});
    });

    it('checkpoint tích luỹ: sau mỗi upload, sau thẻ (cardSent + committed), sau mỗi tin file', async () => {
      const { ctx, checkpoint, fetch } = makeCtx(fullRoutes());
      await larkConnector.send(report(), VALUES, APP_SECRETS, ctx);

      const states = checkpoint.mock.calls.map(([s]) => s);
      expect(states).toHaveLength(6);
      expect(states[0]).toMatchObject({ imageKey: 'img_v2_k1', fileKeys: {} });
      expect(states[1]).toMatchObject({ fileKeys: { 'errors.txt': 'fk_errors.txt' } });
      expect(states[2]).toMatchObject({
        fileKeys: { 'errors.txt': 'fk_errors.txt', 'timeline.json': 'fk_timeline.json' },
      });
      expect(states[2].cardSent).toBeUndefined();
      /* R34: upload là bước đảo ngược được — chưa `committed` cho tới khi thẻ đã gửi. */
      expect(states.slice(0, 3).map((s) => s.committed)).toEqual([undefined, undefined, undefined]);
      expect(states[3]).toMatchObject({ cardSent: true, committed: true, messageId: 'om_1' });
      expect(states[5]).toMatchObject({
        imageKey: 'img_v2_k1',
        cardSent: true,
        committed: true,
        filesSent: ['errors.txt', 'timeline.json'],
      });

      // Thứ tự: checkpoint đầu sau request ảnh, trước request file.
      const urls = fetch.mock.calls.map(([u]) => String(u));
      const imageAt = fetch.mock.invocationCallOrder[urls.findIndex((u) => u.endsWith('/images'))];
      const fileAt = fetch.mock.invocationCallOrder[urls.findIndex((u) => u.endsWith('/files'))];
      expect(checkpoint.mock.invocationCallOrder[0]).toBeGreaterThan(imageAt);
      expect(checkpoint.mock.invocationCallOrder[0]).toBeLessThan(fileAt);
    });

    it('resume đủ ảnh + file đã upload + thẻ đã gửi ⇒ không upload lại, không gửi lại thẻ', async () => {
      const { ctx, calls, initOf } = makeCtx(fullRoutes(), {
        resume: {
          imageKey: 'img_v2_k1',
          fileKeys: { 'errors.txt': 'fk_errors.txt', 'timeline.json': 'fk_timeline.json' },
          cardSent: true,
          messageId: 'om_1',
          filesSent: ['errors.txt'],
        },
      });
      const result = await larkConnector.send(report(), VALUES, APP_SECRETS, ctx);

      // Chỉ token + tin file còn thiếu (timeline.json).
      expect(calls()).toEqual([TOKEN_URL, MESSAGE_URL]);
      expect(bodyOf(initOf(MESSAGE_URL))).toMatchObject({ msg_type: 'file', uuid: 'rpt-1-f3' });
      expect(ctx.uploadPart).not.toHaveBeenCalled();
      expect(result).toEqual({});
    });

    it('resume mới có ảnh ⇒ chỉ upload file còn lại, rồi gửi thẻ với ảnh đã có', async () => {
      const { ctx, calls, initOf } = makeCtx(fullRoutes(), {
        resume: { imageKey: 'img_v2_old', fileKeys: {} },
      });
      await larkConnector.send(report(), VALUES, APP_SECRETS, ctx);

      expect(calls().filter((c) => c === IMAGE_URL)).toHaveLength(0);
      expect(calls().filter((c) => c === FILE_URL)).toHaveLength(2);
      const card = JSON.parse(bodyOf(initOf(MESSAGE_URL)).content);
      expect(card.elements[0].img_key).toBe('img_v2_old');
    });

    it('bản báo không có file ⇒ chỉ token + thẻ, không checkpoint nào ngoài cardSent', async () => {
      const { ctx, calls, checkpoint } = makeCtx(fullRoutes());
      await larkConnector.send(report({ files: [] }), VALUES, APP_SECRETS, ctx);
      expect(calls()).toEqual([TOKEN_URL, MESSAGE_URL]);
      expect(checkpoint).toHaveBeenCalledTimes(1);
      expect(checkpoint.mock.calls[0][0]).toMatchObject({ cardSent: true, committed: true });
    });

    it('thẻ gửi bằng app không có ghi chú "không gửi được file" và thân tin ≤ 30 KB dù nội dung dày dấu nháy', async () => {
      const steps = Array.from({ length: 200 }, (_, i) => ({
        id: `s${i}`,
        kind: 'text' as const,
        at: i,
        text: `"${i}"\n`.repeat(40),
      }));
      const { ctx, initOf } = makeCtx(fullRoutes());
      await larkConnector.send(report({ steps }), VALUES, APP_SECRETS, ctx);
      const raw = String(initOf(MESSAGE_URL)?.body);
      expect(utf8Bytes(raw).length).toBeLessThanOrEqual(30 * 1024);
      expect(raw).not.toContain('Attachments cannot');
      expect(raw).toContain('truncated');
    });

    it('lỗi mạng khi upload ảnh ⇒ ném (hàng đợi gửi lại), checkpoint đếm số lần hỏng, chưa gửi thẻ', async () => {
      const routes = fullRoutes();
      routes[IMAGE_URL] = () => {
        throw new ConnectorError('network', 'Network request failed');
      };
      const { ctx, calls, checkpoint } = makeCtx(routes);

      await expect(larkConnector.send(report(), VALUES, APP_SECRETS, ctx)).rejects.toMatchObject({
        kind: 'network',
      });
      expect(calls()).toEqual([TOKEN_URL, IMAGE_URL]);
      expect(checkpoint).toHaveBeenLastCalledWith(
        expect.objectContaining({ uploadFails: { 'screenshot.jpg': 1 } }),
      );
    });

    it('ảnh hỏng mạng lần thứ 3 (sau 2 lần ghi nhận) ⇒ bỏ ảnh vào skippedFiles, thẻ vẫn đi, không lặp vô hạn', async () => {
      const routes = fullRoutes();
      routes[IMAGE_URL] = () => {
        throw new ConnectorError('network', 'Network request failed');
      };
      const { ctx, calls, initOf } = makeCtx(routes, {
        resume: { fileKeys: {}, uploadFails: { 'screenshot.jpg': 2 } },
      });

      const result = await larkConnector.send(report(), VALUES, APP_SECRETS, ctx);

      expect(result.skippedFiles).toEqual(['screenshot.jpg']);
      expect(calls().filter((c) => c === MESSAGE_URL)).toHaveLength(3);
      const card = JSON.parse(bodyOf(initOf(MESSAGE_URL)).content);
      expect(card.elements.some((e: { tag: string }) => e.tag === 'img')).toBe(false);
    });

    it('lỗi mạng khi upload file ⇒ ném nhưng giữ khoá ảnh đã upload', async () => {
      const routes = fullRoutes();
      routes[FILE_URL] = () => {
        throw new ConnectorError('network', 'Network request failed');
      };
      const { ctx, checkpoint } = makeCtx(routes);

      await expect(larkConnector.send(report(), VALUES, APP_SECRETS, ctx)).rejects.toMatchObject({
        kind: 'network',
      });
      expect(checkpoint).toHaveBeenLastCalledWith(expect.objectContaining({ imageKey: 'img_v2_k1' }));
      // File chữ (không ở trên đĩa) hỏng mạng là mạng thật: không đếm vào `uploadFails`.
      expect(checkpoint.mock.calls[checkpoint.mock.calls.length - 1][0].uploadFails).toBeUndefined();
    });

    it('uploadPart ném hai lần liền (file cache đã bị xoá) ⇒ file vào skippedFiles, không ném, thẻ vẫn đi', async () => {
      const { ctx, uploadPart, calls } = makeCtx(fullRoutes(), {
        uploadPart: async (file) => {
          if (file.name === 'screenshot.jpg') throw new Error('ENOENT');
          return makeUploadPart({ reportId: 'rpt-1' })(file);
        },
      });
      const result = await larkConnector.send(report(), VALUES, APP_SECRETS, ctx);

      expect(result.skippedFiles).toEqual(['screenshot.jpg']);
      expect(uploadPart.mock.calls.filter(([f]) => f.name === 'screenshot.jpg')).toHaveLength(2);
      expect(calls()).not.toContain(IMAGE_URL);
      expect(calls().filter((c) => c === MESSAGE_URL)).toHaveLength(3);
    });

    it('uploadPart ném một lần rồi được ⇒ file vẫn được upload', async () => {
      let tries = 0;
      const { ctx, calls } = makeCtx(fullRoutes(), {
        uploadPart: async (file) => {
          if (file.name === 'screenshot.jpg' && tries++ === 0) throw new Error('flaky');
          return makeUploadPart({ reportId: 'rpt-1' })(file);
        },
      });
      const result = await larkConnector.send(report(), VALUES, APP_SECRETS, ctx);
      expect(result.skippedFiles).toBeUndefined();
      expect(calls()).toContain(IMAGE_URL);
    });

    it('Lark từ chối file (234010 file rỗng) ⇒ bỏ file đó vào skippedFiles, các file khác và thẻ vẫn đi', async () => {
      const routes = fullRoutes();
      routes[FILE_URL] = (init) =>
        part(init, 'file_name') === 'errors.txt'
          ? reply(400, { code: 234010, msg: 'File size is 0' })
          : fileUpload(init);
      const { ctx, calls } = makeCtx(routes);

      const result = await larkConnector.send(report(), VALUES, APP_SECRETS, ctx);

      expect(result.skippedFiles).toEqual(['errors.txt']);
      // thẻ + 1 tin file (timeline.json)
      expect(calls().filter((c) => c === MESSAGE_URL)).toHaveLength(2);
    });

    it('bot không ở trong nhóm (230002) khi gửi thẻ ⇒ permission, dặn thêm bot vào nhóm; checkpoint giữ upload', async () => {
      const routes = fullRoutes();
      routes[MESSAGE_URL] = () => reply(400, { code: 230002, msg: 'The bot can not be outside the group.' });
      const { ctx, checkpoint } = makeCtx(routes);

      const error = await larkConnector.send(report(), VALUES, APP_SECRETS, ctx).catch((e: unknown) => e);

      expect(error).toMatchObject({ kind: 'permission' });
      expect((error as ConnectorError).message).toContain('Add the bot to the group');
      expect(checkpoint).toHaveBeenCalledTimes(3);
      /* Thẻ chưa gửi ⇒ chưa có gì không đảo ngược: gửi lại bản sửa tới kết nối khác là an toàn (R34). */
      expect(checkpoint.mock.calls.map(([s]) => s.committed)).toEqual([undefined, undefined, undefined]);
    });

    it('thiếu quyền (99991672) ⇒ permission; thẻ thiếu quyền gửi (230027) ⇒ permission', async () => {
      for (const code of [99991672, 230027]) {
        const routes = fullRoutes();
        routes[MESSAGE_URL] = () => reply(400, { code, msg: 'denied' });
        const { ctx } = makeCtx(routes);
        await expect(
          larkConnector.send(report({ files: [] }), VALUES, APP_SECRETS, ctx),
        ).rejects.toMatchObject({ kind: 'permission' });
      }
    });

    it('giới hạn tần suất (230020) ⇒ rate-limit', async () => {
      const routes = fullRoutes();
      routes[MESSAGE_URL] = () => reply(400, { code: 230020, msg: 'freq' });
      const { ctx } = makeCtx(routes);
      await expect(
        larkConnector.send(report({ files: [] }), VALUES, APP_SECRETS, ctx),
      ).rejects.toMatchObject({ kind: 'rate-limit' });
    });

    it('token hết hạn giữa chừng (99991663) ⇒ auth', async () => {
      const routes = fullRoutes();
      routes[MESSAGE_URL] = () => reply(400, { code: 99991663, msg: 'Invalid access token' });
      const { ctx } = makeCtx(routes);
      await expect(
        larkConnector.send(report({ files: [] }), VALUES, APP_SECRETS, ctx),
      ).rejects.toMatchObject({ kind: 'auth' });
    });

    it('App Secret sai (10014 ở bước token) ⇒ auth, dừng ngay, không lộ bí mật', async () => {
      const routes = fullRoutes();
      routes[TOKEN_URL] = () => reply(200, { code: 10014, msg: `app secret invalid ${APP_SECRET}` });
      const { ctx, calls } = makeCtx(routes);

      const error = await larkConnector.send(report(), VALUES, APP_SECRETS, ctx).catch((e: unknown) => e);

      expect(error).toMatchObject({ kind: 'auth' });
      expect((error as ConnectorError).message).not.toContain(APP_SECRET);
      expect(calls()).toEqual([TOKEN_URL]);
    });

    it('token và App Secret không lọt vào message lỗi của lời gọi sau (code lạ kèm token)', async () => {
      const routes = fullRoutes();
      routes[MESSAGE_URL] = () =>
        reply(200, { code: 55555, msg: `weird ${TOKEN} and ${APP_SECRET}` });
      const { ctx } = makeCtx(routes);
      const error = await larkConnector
        .send(report({ files: [] }), VALUES, APP_SECRETS, ctx)
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ kind: 'unknown' });
      expect((error as ConnectorError).message).toContain('weird');
      expect((error as ConnectorError).message).not.toContain(TOKEN);
      expect((error as ConnectorError).message).not.toContain(APP_SECRET);
    });

    it('token response không có tenant_access_token ⇒ unknown', async () => {
      const routes = fullRoutes();
      routes[TOKEN_URL] = () => reply(200, { code: 0, msg: 'ok' });
      const { ctx } = makeCtx(routes);
      await expect(
        larkConnector.send(report(), VALUES, APP_SECRETS, ctx),
      ).rejects.toMatchObject({ kind: 'unknown' });
    });

    it.each([
      ['appId', { ...VALUES, appId: '' }, APP_SECRETS],
      ['appSecret', VALUES, {}],
      ['chatId', { ...VALUES, chatId: '' }, APP_SECRETS],
      ['chatId', { ...VALUES, chatId: 'abc/../x' }, APP_SECRETS],
    ] as const)('thiếu hoặc sai %s ⇒ validation trên đúng ô, không gọi mạng', async (field, values, secrets) => {
      const { ctx, fetch } = makeCtx(fullRoutes());
      await expect(larkConnector.send(report(), values, secrets, ctx)).rejects.toMatchObject({
        kind: 'validation',
        field,
      });
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('test', () => {
    it('lấy token rồi gọi im/v1/chats/<chatId>; trả tên nhóm làm account', async () => {
      const { ctx, calls, initOf } = makeCtx({
        [TOKEN_URL]: tokenRoute,
        [CHAT_URL]: () => ok({ name: 'Nhóm báo bug' }),
      });

      const result = await larkConnector.test(VALUES, APP_SECRETS, ctx);

      expect(calls()).toEqual([TOKEN_URL, CHAT_URL]);
      expect((initOf(CHAT_URL)?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      expect(result.account).toBe('Nhóm báo bug');
    });

    it('bot không ở trong nhóm (232011) ⇒ permission, dặn thêm bot vào nhóm', async () => {
      const { ctx } = makeCtx({
        [TOKEN_URL]: tokenRoute,
        [CHAT_URL]: () => reply(400, { code: 232011, msg: 'Operator can NOT be out of the chat.' }),
      });
      const error = await larkConnector.test(VALUES, APP_SECRETS, ctx).catch((e: unknown) => e);
      expect(error).toMatchObject({ kind: 'permission' });
      expect((error as ConnectorError).message).toContain('Add the bot to the group');
    });

    it('app không có quyền đọc thông tin nhóm (99991672) ⇒ bỏ qua bước kiểm nhóm, trả account kèm ghi chú (R6)', async () => {
      const { ctx } = makeCtx({
        [TOKEN_URL]: tokenRoute,
        [CHAT_URL]: () => reply(400, { code: 99991672, msg: 'Access denied' }),
      });
      const result = await larkConnector.test(VALUES, APP_SECRETS, ctx);
      expect(result.account).toContain('cli_a1b2c3');
      expect(result.account).toContain('group membership was not checked');
    });

    it('thông tin nhóm không có name ⇒ account là chatId', async () => {
      const { ctx } = makeCtx({ [TOKEN_URL]: tokenRoute, [CHAT_URL]: () => ok({}) });
      expect((await larkConnector.test(VALUES, APP_SECRETS, ctx)).account).toBe('oc_abc123');
    });

    it('App Secret sai ⇒ auth, không gọi bước kiểm nhóm', async () => {
      const { ctx, calls } = makeCtx({
        [TOKEN_URL]: () => reply(200, { code: 10014, msg: 'app secret invalid' }),
      });
      await expect(larkConnector.test(VALUES, APP_SECRETS, ctx)).rejects.toMatchObject({ kind: 'auth' });
      expect(calls()).toEqual([TOKEN_URL]);
    });

    it('thiếu chatId ⇒ validation, không gọi mạng', async () => {
      const { ctx, fetch } = makeCtx({});
      await expect(
        larkConnector.test({ ...VALUES, chatId: undefined }, APP_SECRETS, ctx),
      ).rejects.toMatchObject({ kind: 'validation', field: 'chatId' });
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
