import type { BugReport } from '../../bug-report';
import { ConnectorError, type SendContext } from '../types';
import { makeUploadPart } from '../upload';
import { slackConnector } from './index';

const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/SECRETWEBHOOKKEY';
const TOKEN = 'xoxb-111-222-SECRETBOTTOKEN';
const CHANNEL = 'C0123ABCD';

const report = (over: Partial<BugReport> = {}): BugReport => ({
  id: 'rpt-1',
  createdAt: 1_700_000_000_000,
  title: 'Crash khi thanh toán',
  steps: [{ id: 'a', kind: 'tap', at: 1, label: 'Pay' }],
  actual: 'POST /orders → 500',
  expected: 'Thanh toán thành công',
  deviceInfo: [['App', '1.2.3']],
  files: [
    { name: 'screenshot.jpg', mimeType: 'image/jpeg', uri: 'file:///cache/s.jpg' },
    { name: 'errors.txt', mimeType: 'text/plain', content: 'boom ✓' },
  ],
  ...over,
});

type Call = { url: string; init: RequestInit };
type Responder = (call: Call) => Response | Promise<Response>;

const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers });

const makeCtx = (respond: Responder) => {
  const calls: Call[] = [];
  const order: string[] = [];
  const fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    order.push(url);
    return respond({ url, init });
  });
  const checkpoint = jest.fn((_state: Readonly<Record<string, unknown>>) => {
    order.push('checkpoint');
  });
  const ctx: SendContext = {
    fetch,
    locale: 'en',
    timeoutMs: 1000,
    checkpoint,
    /* Phần upload thật, app KHÔNG cấp `writeTempFile` (R43): Slack dựng Blob từ phần chuỗi. */
    uploadPart: jest.fn(makeUploadPart({ reportId: 'rpt-1' })),
  };
  return { ctx, calls, order, fetch, checkpoint };
};

const API = 'https://slack.com/api/';
const api = (calls: Call[]) => calls.filter((c) => c.url.startsWith(API));
const method = (call: Call) => call.url.replace(API, '');
const header = (call: Call, name: string) =>
  new Headers(call.init.headers as Record<string, string>).get(name);
const formOf = (call: Call) =>
  Object.fromEntries(
    String(call.init.body)
      .split('&')
      .map((p) => p.split('=').map(decodeURIComponent) as [string, string]),
  );

/** Slack giả cho mức bot: trả lời theo method; file `file://` đọc được trừ khi nằm trong `missing`. */
const slackBot = (
  opts: { missing?: string[]; overrides?: Record<string, () => Response> } = {},
): Responder => {
  let n = 0;
  return ({ url }) => {
    if (url.startsWith('file://')) {
      if (opts.missing?.includes(url)) throw new TypeError('Network request failed');
      return new Response(new Blob(['IMAGEBYTES']), { status: 200 });
    }
    if (url.startsWith('https://files.slack.com/upload/')) return new Response('OK - 10');
    const m = url.replace(API, '');
    const override = opts.overrides?.[m];
    if (override) return override();
    switch (m) {
      case 'files.getUploadURLExternal': {
        const id = n++;
        return json({
          ok: true,
          upload_url: `https://files.slack.com/upload/v1/${id}`,
          file_id: `F${id}`,
        });
      }
      case 'files.completeUploadExternal':
        return json({
          ok: true,
          files: [
            {
              id: 'F0',
              title: 'screenshot.jpg',
              permalink: 'https://acme.slack.com/files/U1/F0/s.jpg',
            },
          ],
        });
      case 'chat.postMessage':
        return json({ ok: true, channel: CHANNEL, ts: '1700000000.000100' });
      default:
        return json({ ok: false, error: 'unknown_method' });
    }
  };
};

const bot = { mode: 'bot', channelId: CHANNEL } as const;
const botSecrets = { botToken: TOKEN };
const hook = { mode: 'webhook' } as const;
const hookSecrets = { webhookUrl: WEBHOOK };

const failure = async (p: Promise<unknown>): Promise<ConnectorError> => {
  try {
    await p;
  } catch (error) {
    return error as ConnectorError;
  }
  throw new Error('expected rejection');
};

describe('slackConnector — khai báo', () => {
  it('id, bí mật và khả năng theo mức', () => {
    expect(slackConnector.id).toBe('slack');
    expect(slackConnector.secretFieldIds).toEqual(['webhookUrl', 'botToken']);
    expect(slackConnector.capabilities(hook)).toEqual({ image: false, files: false });
    expect(slackConnector.capabilities(bot)).toEqual({ image: true, files: true });
  });

  it('ô nhập và điều kiện hiện', () => {
    const fields = slackConnector.fields('en');
    expect(fields.map((f) => [f.id, f.kind, f.visibleWhen])).toEqual([
      ['mode', 'select', undefined],
      ['webhookUrl', 'secret', { field: 'mode', equals: 'webhook' }],
      ['botToken', 'secret', { field: 'mode', equals: 'bot' }],
      ['channelId', 'text', { field: 'mode', equals: 'bot' }],
    ]);
    expect(fields[0].options?.map((o) => o.id)).toEqual(['webhook', 'bot']);
  });

  it('longLivedSecret chỉ ở mức bot', () => {
    expect(slackConnector.longLivedSecret?.(bot)).toBe(true);
    expect(slackConnector.longLivedSecret?.(hook)).toBe(false);
  });

  it('chữ vi và en đều có', () => {
    expect(slackConnector.label('vi')).toBe('Slack');
    expect(slackConnector.fields('vi')[0].label).not.toBe(slackConnector.fields('en')[0].label);
  });
});

describe('slackConnector.send — mức webhook', () => {
  it('POST JSON { text, blocks } tới webhook, 200 "ok" thì trả {}', async () => {
    const { ctx, calls } = makeCtx(() => new Response('ok'));
    const result = await slackConnector.send(report(), hook, hookSecrets, ctx);
    expect(result).toEqual({});
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(WEBHOOK);
    expect(calls[0].init.method).toBe('POST');
    expect(header(calls[0], 'content-type')).toContain('application/json');
    expect(header(calls[0], 'authorization')).toBeNull();
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.text).toBe('Crash khi thanh toán');
    expect(body.blocks[0].type).toBe('header');
  });

  it('có file đính kèm thì thêm ghi chú cuối tin và không đánh dấu skippedFiles', async () => {
    const { ctx, calls } = makeCtx(() => new Response('ok'));
    const result = await slackConnector.send(report(), hook, hookSecrets, ctx);
    const blocks = JSON.parse(String(calls[0].init.body)).blocks as Array<{
      type: string;
      elements?: Array<{ text: string }>;
    }>;
    const last = blocks[blocks.length - 1];
    expect(last.type).toBe('context');
    expect(last.elements?.[0].text).toBe('Attachments cannot be sent through this channel.');
    expect(result.skippedFiles).toBeUndefined();
  });

  it('không file thì không có ghi chú', async () => {
    const { ctx, calls } = makeCtx(() => new Response('ok'));
    await slackConnector.send(report({ files: [] }), hook, hookSecrets, ctx);
    expect(String(calls[0].init.body)).not.toContain('Attachments cannot');
  });

  it('404 hoặc no_service ⇒ auth', async () => {
    const a = makeCtx(() => new Response('no_service', { status: 404 }));
    expect(await failure(slackConnector.send(report(), hook, hookSecrets, a.ctx))).toMatchObject({
      kind: 'auth',
    });
    const b = makeCtx(() => new Response('', { status: 404 }));
    expect(await failure(slackConnector.send(report(), hook, hookSecrets, b.ctx))).toMatchObject({
      kind: 'auth',
    });
  });

  it('403 invalid_token ⇒ auth', async () => {
    const { ctx } = makeCtx(() => new Response('invalid_token', { status: 403 }));
    expect(await failure(slackConnector.send(report(), hook, hookSecrets, ctx))).toMatchObject({
      kind: 'auth',
    });
  });

  it('429 ⇒ rate-limit kèm Retry-After; 500 ⇒ unknown', async () => {
    const a = makeCtx(() => new Response('slow', { status: 429, headers: { 'retry-after': '3' } }));
    expect(await failure(slackConnector.send(report(), hook, hookSecrets, a.ctx))).toMatchObject({
      kind: 'rate-limit',
      retryAfterMs: 3000,
    });
    const b = makeCtx(() => new Response('boom', { status: 500 }));
    expect(await failure(slackConnector.send(report(), hook, hookSecrets, b.ctx))).toMatchObject({
      kind: 'unknown',
      status: 500,
    });
  });

  it('webhook URL không lọt vào message lỗi', async () => {
    const { ctx } = makeCtx(() => new Response(`bad ${WEBHOOK}`, { status: 500 }));
    const error = await failure(slackConnector.send(report(), hook, hookSecrets, ctx));
    expect(error.message).not.toContain('SECRETWEBHOOKKEY');
  });

  it('thiếu webhook URL ⇒ validation trước khi gọi mạng', async () => {
    const { ctx, fetch } = makeCtx(() => new Response('ok'));
    expect(await failure(slackConnector.send(report(), hook, {}, ctx))).toMatchObject({
      kind: 'validation',
      field: 'webhookUrl',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('slackConnector.send — mức bot', () => {
  it('upload từng file, rồi MỘT completeUploadExternal; mọi request Web API mang Bearer', async () => {
    const { ctx, calls, order, checkpoint } = makeCtx(slackBot());
    const result = await slackConnector.send(report(), bot, botSecrets, ctx);

    expect(api(calls).map(method)).toEqual([
      'files.getUploadURLExternal',
      'files.getUploadURLExternal',
      'files.completeUploadExternal',
    ]);
    for (const c of api(calls)) expect(header(c, 'authorization')).toBe(`Bearer ${TOKEN}`);

    // form-encoded filename + length (byte UTF-8: ảnh = 10 byte, "boom ✓" = 4 + 1 + 3 = 8 byte)
    expect(formOf(api(calls)[0])).toEqual({ filename: 'screenshot.jpg', length: '10' });
    expect(header(api(calls)[0], 'content-type')).toContain('application/x-www-form-urlencoded');
    expect(formOf(api(calls)[1])).toEqual({ filename: 'errors.txt', length: '8' });

    // POST byte tới upload_url của từng file
    const uploads = calls.filter((c) => c.url.startsWith('https://files.slack.com/upload/'));
    expect(uploads.map((u) => u.url)).toEqual([
      'https://files.slack.com/upload/v1/0',
      'https://files.slack.com/upload/v1/1',
    ]);
    for (const u of uploads) expect(u.init.method).toBe('POST');

    const complete = JSON.parse(String(api(calls)[2].init.body));
    expect(complete.files).toEqual([
      { id: 'F0', title: 'screenshot.jpg' },
      { id: 'F1', title: 'errors.txt' },
    ]);
    expect(complete.channel_id).toBe(CHANNEL);
    expect(complete.blocks[0].type).toBe('header');
    expect(header(api(calls)[2], 'content-type')).toContain('application/json');

    // checkpoint sau khi upload xong và TRƯỚC completeUploadExternal
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(checkpoint.mock.calls[0][0]).toMatchObject({ fileIds: ['F0', 'F1'] });
    /* R34: upload chưa chia sẻ là đảo ngược được; bước không đảo ngược là chính lời gọi cuối. */
    expect(checkpoint.mock.calls[0][0].committed).toBeUndefined();
    expect(order.indexOf('checkpoint')).toBeGreaterThan(
      order.lastIndexOf('https://files.slack.com/upload/v1/1'),
    );
    expect(order.indexOf('checkpoint')).toBeLessThan(
      order.indexOf(`${API}files.completeUploadExternal`),
    );

    expect(result).toEqual({ url: 'https://acme.slack.com/files/U1/F0/s.jpg' });
  });

  it('upload_url không nhận token của bot', async () => {
    const { ctx, calls } = makeCtx(slackBot());
    await slackConnector.send(report(), bot, botSecrets, ctx);
    for (const u of calls.filter((c) => c.url.startsWith('https://files.slack.com/'))) {
      expect(header(u, 'authorization')).toBeNull();
    }
  });

  it('không có link trong phản hồi thì bỏ url', async () => {
    const { ctx } = makeCtx(
      slackBot({ overrides: { 'files.completeUploadExternal': () => json({ ok: true }) } }),
    );
    expect(await slackConnector.send(report(), bot, botSecrets, ctx)).toEqual({});
  });

  it('link không phải http(s) bị bỏ', async () => {
    const { ctx } = makeCtx(
      slackBot({
        overrides: {
          'files.completeUploadExternal': () =>
            json({ ok: true, files: [{ id: 'F0', permalink: 'javascript:alert(1)' }] }),
        },
      }),
    );
    expect(await slackConnector.send(report(), bot, botSecrets, ctx)).toEqual({});
  });

  it('file không đọc được (đã bị xoá) ⇒ skippedFiles, các file còn lại vẫn lên', async () => {
    const { ctx, calls } = makeCtx(slackBot({ missing: ['file:///cache/s.jpg'] }));
    const result = await slackConnector.send(report(), bot, botSecrets, ctx);
    expect(result.skippedFiles).toEqual(['screenshot.jpg']);
    const completes = api(calls).filter((c) => method(c) === 'files.completeUploadExternal');
    expect(completes).toHaveLength(1);
    expect(JSON.parse(String(completes[0].init.body)).files).toEqual([
      { id: 'F0', title: 'errors.txt' },
    ]);
  });

  it('uploadPart ném (không có uri lẫn content) ⇒ skippedFiles', async () => {
    const { ctx } = makeCtx(slackBot());
    (ctx.uploadPart as jest.Mock).mockRejectedValueOnce(new Error('no data'));
    const result = await slackConnector.send(report(), bot, botSecrets, ctx);
    expect(result.skippedFiles).toEqual(['screenshot.jpg']);
  });

  it('không có file ⇒ chat.postMessage với blocks, không gọi API upload', async () => {
    const { ctx, calls } = makeCtx(slackBot());
    const result = await slackConnector.send(report({ files: [] }), bot, botSecrets, ctx);
    expect(api(calls).map(method)).toEqual(['chat.postMessage']);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.channel).toBe(CHANNEL);
    expect(body.text).toBe('Crash khi thanh toán');
    expect(body.blocks[0].type).toBe('header');
    expect(header(calls[0], 'authorization')).toBe(`Bearer ${TOKEN}`);
    expect(header(calls[0], 'content-type')).toContain('application/json');
    expect(result).toEqual({});
  });

  it('mọi file đều bỏ qua ⇒ chat.postMessage, skippedFiles liệt kê đủ', async () => {
    const { ctx, calls } = makeCtx(slackBot({ missing: ['file:///cache/s.jpg'] }));
    (ctx.uploadPart as jest.Mock).mockImplementation(async (file) => {
      if (file.uri) return { uri: file.uri, name: file.name, type: file.mimeType };
      throw new Error('gone');
    });
    const result = await slackConnector.send(report(), bot, botSecrets, ctx);
    expect(api(calls).map(method)).toEqual(['chat.postMessage']);
    expect(result.skippedFiles).toEqual(['screenshot.jpg', 'errors.txt']);
  });

  it('resume.fileIds ⇒ bỏ qua upload, chỉ gọi completeUploadExternal', async () => {
    const { ctx, calls, checkpoint } = makeCtx(slackBot());
    const resumed: SendContext = {
      ...ctx,
      resume: { fileIds: ['F7', 'F8'], fileTitles: ['screenshot.jpg', 'errors.txt'] },
    };
    await slackConnector.send(report(), bot, botSecrets, resumed);
    expect(calls.map((c) => c.url)).toEqual([`${API}files.completeUploadExternal`]);
    expect(JSON.parse(String(calls[0].init.body)).files).toEqual([
      { id: 'F7', title: 'screenshot.jpg' },
      { id: 'F8', title: 'errors.txt' },
    ]);
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it('resume hỏng ⇒ làm lại từ đầu', async () => {
    const { ctx, calls } = makeCtx(slackBot());
    await slackConnector.send(report(), bot, botSecrets, { ...ctx, resume: { fileIds: 'nope' } });
    expect(method(api(calls)[0])).toBe('files.getUploadURLExternal');
  });

  it('not_in_channel ⇒ permission, câu báo nhắc mời bot vào kênh', async () => {
    const { ctx } = makeCtx(
      slackBot({
        overrides: {
          'files.completeUploadExternal': () => json({ ok: false, error: 'not_in_channel' }),
        },
      }),
    );
    const error = await failure(slackConnector.send(report(), bot, botSecrets, ctx));
    expect(error.kind).toBe('permission');
    expect(error.message).toMatch(/invite the bot/i);
  });

  it.each([
    ['invalid_auth', 'auth'],
    ['token_revoked', 'auth'],
    ['account_inactive', 'auth'],
    ['not_authed', 'auth'],
    ['not_in_channel', 'permission'],
    ['channel_not_found', 'permission'],
    ['missing_scope', 'permission'],
    ['ratelimited', 'rate-limit'],
    ['fatal_error', 'unknown'],
    ['invalid_blocks', 'unknown'],
  ])('ok:false "%s" ⇒ %s (tại getUploadURLExternal)', async (code, kind) => {
    const { ctx, calls } = makeCtx(
      slackBot({
        overrides: { 'files.getUploadURLExternal': () => json({ ok: false, error: code }) },
      }),
    );
    expect(await failure(slackConnector.send(report(), bot, botSecrets, ctx))).toMatchObject({
      kind,
    });
    expect(api(calls).map(method)).toEqual(['files.getUploadURLExternal']);
  });

  it('missing_scope nêu quyền còn thiếu', async () => {
    const { ctx } = makeCtx(
      slackBot({
        overrides: {
          'chat.postMessage': () =>
            json({ ok: false, error: 'missing_scope', needed: 'chat:write' }),
        },
      }),
    );
    const error = await failure(slackConnector.send(report({ files: [] }), bot, botSecrets, ctx));
    expect(error.kind).toBe('permission');
    expect(error.message).toContain('chat:write');
  });

  it('HTTP 429 ⇒ rate-limit kèm retryAfterMs', async () => {
    const { ctx } = makeCtx(
      slackBot({
        overrides: {
          'files.getUploadURLExternal': () =>
            new Response('{}', { status: 429, headers: { 'retry-after': '9' } }),
        },
      }),
    );
    expect(await failure(slackConnector.send(report(), bot, botSecrets, ctx))).toMatchObject({
      kind: 'rate-limit',
      retryAfterMs: 9000,
    });
  });

  it('upload byte thất bại (HTTP 500) ⇒ lỗi, không gọi completeUploadExternal, không checkpoint', async () => {
    const base = slackBot();
    const { ctx, calls, checkpoint } = makeCtx((call) =>
      call.url.startsWith('https://files.slack.com/upload/')
        ? new Response('boom', { status: 500 })
        : base(call),
    );
    expect(await failure(slackConnector.send(report(), bot, botSecrets, ctx))).toMatchObject({
      kind: 'unknown',
    });
    expect(api(calls).map(method)).not.toContain('files.completeUploadExternal');
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it('getUploadURLExternal thiếu upload_url/file_id ⇒ unknown; upload_url không https bị từ chối', async () => {
    const a = makeCtx(
      slackBot({ overrides: { 'files.getUploadURLExternal': () => json({ ok: true }) } }),
    );
    expect(await failure(slackConnector.send(report(), bot, botSecrets, a.ctx))).toMatchObject({
      kind: 'unknown',
    });
    const b = makeCtx(
      slackBot({
        overrides: {
          'files.getUploadURLExternal': () =>
            json({ ok: true, upload_url: 'http://evil.test/x', file_id: 'F1' }),
        },
      }),
    );
    expect(await failure(slackConnector.send(report(), bot, botSecrets, b.ctx))).toMatchObject({
      kind: 'unknown',
    });
    expect(b.calls.some((c) => c.url.startsWith('http://evil'))).toBe(false);
  });

  it('token không lọt vào message lỗi', async () => {
    const { ctx } = makeCtx(
      slackBot({
        overrides: {
          'files.getUploadURLExternal': () => new Response(`bad ${TOKEN}`, { status: 500 }),
        },
      }),
    );
    const error = await failure(slackConnector.send(report(), bot, botSecrets, ctx));
    expect(error.message).not.toContain('SECRETBOTTOKEN');
  });

  it('thiếu token hoặc channelId ⇒ validation, không gọi mạng', async () => {
    const { ctx, fetch } = makeCtx(slackBot());
    expect(await failure(slackConnector.send(report(), bot, {}, ctx))).toMatchObject({
      kind: 'validation',
      field: 'botToken',
    });
    expect(
      await failure(slackConnector.send(report(), { mode: 'bot' }, botSecrets, ctx)),
    ).toMatchObject({ kind: 'validation', field: 'channelId' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('mode lạ hoặc thiếu ⇒ validation', async () => {
    const { ctx } = makeCtx(slackBot());
    expect(await failure(slackConnector.send(report(), {}, botSecrets, ctx))).toMatchObject({
      kind: 'validation',
      field: 'mode',
    });
  });
});

describe('slackConnector.test', () => {
  it('webhook: chỉ kiểm URL, không gọi mạng', async () => {
    const { ctx, fetch } = makeCtx(slackBot());
    expect(await slackConnector.test(hook, hookSecrets, ctx)).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['', 'http://hooks.slack.com/services/x', 'not a url'])(
    'webhook: URL sai %j ⇒ validation',
    async (url) => {
      const { ctx } = makeCtx(slackBot());
      expect(await failure(slackConnector.test(hook, { webhookUrl: url }, ctx))).toMatchObject({
        kind: 'validation',
        field: 'webhookUrl',
      });
    },
  );

  it('bot: auth.test ok ⇒ account là tên team; conversations.info is_member:true', async () => {
    const { ctx, calls } = makeCtx(({ url }) =>
      url.endsWith('auth.test')
        ? json({ ok: true, team: 'Acme', user: 'bugbot' })
        : json({ ok: true, channel: { id: CHANNEL, is_member: true } }),
    );
    const result = await slackConnector.test(bot, botSecrets, ctx);
    expect(result).toEqual({ account: 'Acme' });
    expect(calls.map(method)).toEqual(['auth.test', 'conversations.info']);
    expect(formOf(calls[1])).toEqual({ channel: CHANNEL });
    for (const c of calls) expect(header(c, 'authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('bot: is_member:false ⇒ permission, nhắc mời bot', async () => {
    const { ctx } = makeCtx(({ url }) =>
      url.endsWith('auth.test')
        ? json({ ok: true, team: 'Acme' })
        : json({ ok: true, channel: { id: CHANNEL, is_member: false } }),
    );
    const error = await failure(slackConnector.test(bot, botSecrets, ctx));
    expect(error.kind).toBe('permission');
    expect(error.message).toMatch(/invite the bot/i);
  });

  it('bot: conversations.info thiếu quyền đọc ⇒ bỏ qua, account kèm ghi chú', async () => {
    for (const code of ['missing_scope', 'channel_not_found']) {
      const { ctx } = makeCtx(({ url }) =>
        url.endsWith('auth.test')
          ? json({ ok: true, team: 'Acme' })
          : json({ ok: false, error: code }),
      );
      const result = await slackConnector.test(bot, botSecrets, ctx);
      expect(result.account).toContain('Acme');
      expect(result.account).not.toBe('Acme');
    }
  });

  it('bot: invalid_auth ở auth.test ⇒ auth và không gọi conversations.info', async () => {
    const { ctx, calls } = makeCtx(() => json({ ok: false, error: 'invalid_auth' }));
    expect(await failure(slackConnector.test(bot, botSecrets, ctx))).toMatchObject({
      kind: 'auth',
    });
    expect(calls).toHaveLength(1);
  });

  it('bot: lỗi khác ở conversations.info (vd ratelimited) được ném', async () => {
    const { ctx } = makeCtx(({ url }) =>
      url.endsWith('auth.test')
        ? json({ ok: true, team: 'Acme' })
        : json({ ok: false, error: 'ratelimited' }),
    );
    expect(await failure(slackConnector.test(bot, botSecrets, ctx))).toMatchObject({
      kind: 'rate-limit',
    });
  });

  it('bot: channelId sai dạng (tên kênh) ⇒ validation, không gọi mạng', async () => {
    const { ctx, fetch } = makeCtx(slackBot());
    expect(
      await failure(slackConnector.test({ mode: 'bot', channelId: '#general' }, botSecrets, ctx)),
    ).toMatchObject({ kind: 'validation', field: 'channelId' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('bot: thiếu token ⇒ validation', async () => {
    const { ctx } = makeCtx(slackBot());
    expect(await failure(slackConnector.test(bot, {}, ctx))).toMatchObject({
      kind: 'validation',
      field: 'botToken',
    });
  });
});
