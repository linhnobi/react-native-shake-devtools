import type { BugReport } from '../bug-report';
import { makeConnectorContext } from './http';
import { ConnectorError, type SendContext } from './types';
import { makeUploadPart } from './upload';
import { webhookConnector } from './webhook';

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

const report = (over: Partial<BugReport> = {}): BugReport => ({
  id: 'rpt-1',
  createdAt: 1_700_000_000_000,
  title: 'Crash khi thanh toán',
  steps: [
    { id: 'a', kind: 'tap', at: 1, label: 'Pay' },
    { id: 'b', kind: 'text', at: 2, text: 'Mở app lạ' },
  ],
  actual: 'POST /orders → 500',
  expected: 'Thanh toán thành công',
  deviceInfo: [['App', '1.2.3']],
  files: [
    { name: 'screenshot.jpg', mimeType: 'image/jpeg', uri: 'file:///cache/s.jpg' },
    { name: 'errors.txt', mimeType: 'text/plain', content: 'boom' },
  ],
  ...over,
});

const URL_OK = 'https://hooks.acme.test/bug';

const reply = (status: number, body: string) =>
  new Response(status === 204 ? null : body, { status });

const makeCtx = (
  respond: () => Response,
  locale: 'vi' | 'en' = 'vi',
): { ctx: SendContext; fetch: jest.Mock } => {
  const fetch = jest.fn().mockImplementation(async () => respond());
  const ctx: SendContext = {
    fetch,
    locale,
    timeoutMs: 1000,
    checkpoint: jest.fn(),
    /* Phần upload thật, app KHÔNG cấp `writeTempFile` (R43): file chữ là phần chuỗi trong bộ nhớ. */
    uploadPart: jest.fn(makeUploadPart({ reportId: 'rpt-1' })),
  };
  return { ctx, fetch };
};

const sentForm = (fetch: jest.Mock): RecordingFormData => fetch.mock.calls[0][1].body;
const reportPart = (form: RecordingFormData) =>
  JSON.parse(form.parts.find((p) => p.name === 'report')?.value as string);

describe('webhookConnector — khai báo', () => {
  it('id, ô nhập, bí mật và khả năng', () => {
    expect(webhookConnector.id).toBe('webhook');
    expect(webhookConnector.secretFieldIds).toEqual(['headerValue']);
    expect(webhookConnector.capabilities({})).toEqual({ image: true, files: true });

    const fields = webhookConnector.fields('en');
    expect(fields.map((f) => [f.id, f.kind, f.required === true])).toEqual([
      ['url', 'url', true],
      ['headerName', 'text', false],
      ['headerValue', 'secret', false],
    ]);
  });

  it('nhãn và ô theo ngôn ngữ', () => {
    expect(webhookConnector.label('vi')).toBe('Webhook');
    expect(webhookConnector.fields('vi')[0].label).toBe('URL nhận báo bug');
    expect(webhookConnector.fields('en')[0].label).toBe('Bug report URL');
  });
});

describe('webhookConnector.send', () => {
  it('POST multipart: không tự đặt Content-Type, phần `report` là JSON dựng theo ctx.locale', async () => {
    const { ctx, fetch } = makeCtx(() => reply(204, ''), 'en');

    await webhookConnector.send(report(), { url: URL_OK }, {}, ctx);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(URL_OK);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(RecordingFormData);
    expect(new Headers(init.headers).has('content-type')).toBe(false);
    expect(reportPart(init.body)).toEqual({
      id: 'rpt-1',
      createdAt: 1_700_000_000_000,
      title: 'Crash khi thanh toán',
      steps: ['Tap "Pay"', 'Mở app lạ'],
      actual: 'POST /orders → 500',
      expected: 'Thanh toán thành công',
      deviceInfo: [['App', '1.2.3']],
    });
  });

  it('bước dựng theo ngôn ngữ của ctx (vi)', async () => {
    const { ctx, fetch } = makeCtx(() => reply(204, ''), 'vi');

    await webhookConnector.send(report(), { url: URL_OK }, {}, ctx);

    expect(reportPart(sentForm(fetch)).steps[0]).toBe('Chạm "Pay"');
  });

  it('mỗi file là một phần riêng, tên phần là tên file', async () => {
    const { ctx, fetch } = makeCtx(() => reply(204, ''));

    await webhookConnector.send(report(), { url: URL_OK }, {}, ctx);

    const parts = sentForm(fetch).parts;
    expect(parts.map((p) => p.name)).toEqual(['report', 'screenshot.jpg', 'errors.txt']);
    expect(parts[1].value).toEqual({
      uri: 'file:///cache/s.jpg',
      name: 'screenshot.jpg',
      type: 'image/jpeg',
    });
    /* Không có `writeTempFile`: phần chuỗi `{ string, name, type }` — KHÔNG BAO GIỜ Blob (I1, R43). */
    expect(parts[2].value).toEqual({ string: 'boom', name: 'errors.txt', type: 'text/plain' });
    expect(parts.some((p) => p.value instanceof Blob)).toBe(false);
  });

  it('ngữ cảnh app ⇒ `appContext` trong JSON `report` (như `deviceInfo`) và phần file `context.json`', async () => {
    const { ctx, fetch } = makeCtx(() => reply(204, ''), 'en');
    const context = '{\n  "userId": "u-42"\n}';

    await webhookConnector.send(
      report({
        appContext: { lines: [['userId', 'u-42']], more: 0 },
        files: [{ name: 'context.json', mimeType: 'application/json', content: context }],
      }),
      { url: URL_OK },
      {},
      ctx,
    );

    const form = sentForm(fetch);
    expect(reportPart(form).appContext).toEqual({ lines: [['userId', 'u-42']], more: 0 });
    expect(form.parts.find((p) => p.name === 'context.json')?.value).toEqual({
      string: context,
      name: 'context.json',
      type: 'application/json',
    });
    await webhookConnector.send(report(), { url: URL_OK }, {}, ctx);
    expect('appContext' in reportPart(fetch.mock.calls[1][1].body)).toBe(false);
  });

  it('có `headerName` thì header mang `headerValue` (bí mật)', async () => {
    const { ctx, fetch } = makeCtx(() => reply(204, ''));

    await webhookConnector.send(
      report(),
      { url: URL_OK, headerName: 'X-Api-Key' },
      { headerValue: 'sekret-123' },
      ctx,
    );

    expect(new Headers(fetch.mock.calls[0][1].headers).get('x-api-key')).toBe('sekret-123');
  });

  it('không có `headerName` (hoặc thiếu giá trị) ⇒ không thêm header nào', async () => {
    const a = makeCtx(() => reply(204, ''));
    const b = makeCtx(() => reply(204, ''));

    await webhookConnector.send(report(), { url: URL_OK }, { headerValue: 'sekret-123' }, a.ctx);
    await webhookConnector.send(report(), { url: URL_OK, headerName: 'X-Api-Key' }, {}, b.ctx);

    expect([...new Headers(a.fetch.mock.calls[0][1].headers).keys()]).toEqual([]);
    expect([...new Headers(b.fetch.mock.calls[0][1].headers).keys()]).toEqual([]);
  });

  it('server trả {"url","key"} ⇒ SendResult có cả hai', async () => {
    const { ctx } = makeCtx(() =>
      reply(200, '{"url":"https://tracker.test/BUG-1","key":"BUG-1"}'),
    );

    await expect(webhookConnector.send(report(), { url: URL_OK }, {}, ctx)).resolves.toEqual({
      url: 'https://tracker.test/BUG-1',
      key: 'BUG-1',
    });
  });

  it('server trả 204 ⇒ {}', async () => {
    const { ctx } = makeCtx(() => reply(204, ''));

    await expect(webhookConnector.send(report(), { url: URL_OK }, {}, ctx)).resolves.toEqual({});
  });

  it('2xx nhưng thân không phải JSON ("OK") ⇒ vẫn thành công, {}', async () => {
    const { ctx } = makeCtx(() => reply(200, 'OK'));

    await expect(webhookConnector.send(report(), { url: URL_OK }, {}, ctx)).resolves.toEqual({});
  });

  it('JSON không phải đối tượng, hoặc `url` không phải http(s) ⇒ bỏ qua trường đó', async () => {
    const a = makeCtx(() => reply(200, '["x"]'));
    const b = makeCtx(() => reply(200, '{"url":"javascript:alert(1)","key":7}'));

    await expect(webhookConnector.send(report(), { url: URL_OK }, {}, a.ctx)).resolves.toEqual({});
    await expect(webhookConnector.send(report(), { url: URL_OK }, {}, b.ctx)).resolves.toEqual({});
  });

  it('server trả 500 ⇒ ConnectorError("unknown")', async () => {
    const { ctx } = makeCtx(() => reply(500, 'oops'));

    const error = await webhookConnector
      .send(report(), { url: URL_OK }, {}, ctx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).toMatchObject({ kind: 'unknown', status: 500 });
  });

  it('giá trị header không bao giờ lọt vào message lỗi', async () => {
    const { ctx } = makeCtx(() => reply(401, 'bad key sekret-123'));

    const error = await webhookConnector
      .send(report(), { url: URL_OK, headerName: 'X-Api-Key' }, { headerValue: 'sekret-123' }, ctx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).kind).toBe('auth');
    expect((error as ConnectorError).message).not.toContain('sekret-123');
  });

  it('file không dựng được phần upload ⇒ bỏ file đó, liệt kê ở `skippedFiles`', async () => {
    const { ctx, fetch } = makeCtx(() => reply(204, ''));
    (ctx.uploadPart as jest.Mock).mockImplementation(async (file) => {
      if (file.name === 'errors.txt') throw new ConnectorError('unknown', 'no content');
      return { uri: file.uri, name: file.name, type: file.mimeType };
    });

    await expect(webhookConnector.send(report(), { url: URL_OK }, {}, ctx)).resolves.toEqual({
      skippedFiles: ['errors.txt'],
    });
    expect(sentForm(fetch).parts.map((p) => p.name)).toEqual(['report', 'screenshot.jpg']);
  });

  it('URL hỏng ⇒ ném validation trước khi gọi mạng', async () => {
    const { ctx, fetch } = makeCtx(() => reply(204, ''));

    await expect(
      webhookConnector.send(report(), { url: 'not a url' }, {}, ctx),
    ).rejects.toMatchObject({ kind: 'validation', field: 'url' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('webhookConnector.test', () => {
  const ctx = (locale: 'vi' | 'en' = 'en') => makeConnectorContext(locale);

  it('https hợp lệ ⇒ {} và không gửi request nào', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('không được gọi mạng');
    });

    await expect(webhookConnector.test({ url: URL_OK }, {}, ctx())).resolves.toEqual({});
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('http cho phép với localhost và 10.0.2.2 (có cổng)', async () => {
    await expect(
      webhookConnector.test({ url: 'http://localhost:3000/x' }, {}, ctx()),
    ).resolves.toEqual({});
    await expect(
      webhookConnector.test({ url: 'http://10.0.2.2:8080/' }, {}, ctx()),
    ).resolves.toEqual({});
  });

  it('http với host khác ⇒ validation trên ô `url`', async () => {
    await expect(
      webhookConnector.test({ url: 'http://example.com/hook' }, {}, ctx()),
    ).rejects.toMatchObject({ kind: 'validation', field: 'url' });
  });

  it.each(['', 'not a url', 'ftp://example.com', 'https://', 'https:///path'])(
    'URL sai %p ⇒ validation trên ô `url`',
    async (url) => {
      await expect(webhookConnector.test({ url }, {}, ctx())).rejects.toMatchObject({
        kind: 'validation',
        field: 'url',
      });
    },
  );

  it('URL vắng ⇒ validation; message theo ngôn ngữ ctx', async () => {
    const vi = await webhookConnector.test({}, {}, ctx('vi')).catch((e: unknown) => e);
    const en = await webhookConnector.test({}, {}, ctx('en')).catch((e: unknown) => e);

    expect((vi as ConnectorError).message).toContain('URL không hợp lệ');
    expect((en as ConnectorError).message).toContain('Invalid URL');
  });

  it('tên header không hợp lệ ⇒ validation trên ô `headerName`', async () => {
    await expect(
      webhookConnector.test({ url: URL_OK, headerName: 'Bad Header' }, {}, ctx()),
    ).rejects.toMatchObject({ kind: 'validation', field: 'headerName' });
  });
});
