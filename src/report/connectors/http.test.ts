import { logBuffer } from '../../capture/log-buffer';
import { tapNetwork } from '../../capture/network-tap';
import { errorFromStatus, makeConnectorContext, requestJson } from './http';
import { ConnectorError } from './types';

const g = globalThis as unknown as { fetch: unknown; XMLHttpRequest: unknown };

/** `fetch` giả: tạo một XHR (giả) rồi `open`/`send` như whatwg-fetch làm, đồng bộ trong executor. */
class FakeXhr {
  status = 0;
  addEventListener(): void {}
  removeEventListener(): void {}
  open(..._args: unknown[]): void {}
  send(..._args: unknown[]): void {}
  setRequestHeader(..._args: unknown[]): void {}
}

const response = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

describe('ConnectorError', () => {
  it('chạy được với `instanceof Error`/`instanceof ConnectorError`, mang `name` và các trường', () => {
    const error = new ConnectorError('validation', 'bad', { field: 'f1', retryAfterMs: 5, status: 400 });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error.name).toBe('ConnectorError');
    expect(error.message).toBe('bad');
    expect(error).toMatchObject({ kind: 'validation', field: 'f1', retryAfterMs: 5, status: 400 });
    expect(Object.prototype.toString.call(error)).toBe('[object Error]');
  });
});

describe('errorFromStatus', () => {
  it('401 ⇒ auth, 403 ⇒ permission, 500 ⇒ unknown (kèm status)', () => {
    expect(errorFromStatus(401, 'nope')).toMatchObject({ kind: 'auth', status: 401 });
    expect(errorFromStatus(403, 'nope')).toMatchObject({ kind: 'permission', status: 403 });
    expect(errorFromStatus(500, 'oops')).toMatchObject({ kind: 'unknown', status: 500 });
    expect(errorFromStatus(401, '')).toBeInstanceOf(ConnectorError);
  });

  it('400 có `errors` kiểu Jira ⇒ validation kèm tên trường', () => {
    const body = JSON.stringify({ errorMessages: [], errors: { customfield_1: 'Field is required' } });
    const error = errorFromStatus(400, body);

    expect(error).toMatchObject({ kind: 'validation', field: 'customfield_1', status: 400 });
    expect(error.message).toContain('customfield_1');
    expect(error.message).toContain('Field is required');
  });

  it('400 không có `errors` (hoặc thân không phải JSON) ⇒ validation không có `field`', () => {
    expect(errorFromStatus(400, '<html>bad</html>')).toMatchObject({ kind: 'validation' });
    expect(errorFromStatus(400, '<html>bad</html>').field).toBeUndefined();
    expect(errorFromStatus(400, '{"errors":{}}').field).toBeUndefined();
    expect(errorFromStatus(400, '{"errors":"text"}').field).toBeUndefined();
  });

  it('429 kèm `Retry-After: 7` ⇒ rate-limit, retryAfterMs 7000', () => {
    expect(errorFromStatus(429, 'slow down', { retryAfter: '7' })).toMatchObject({
      kind: 'rate-limit',
      retryAfterMs: 7000,
      status: 429,
    });
  });

  it('429: `Retry-After` dạng ngày HTTP ⇒ quy ra ms từ bây giờ; giá trị hỏng hoặc vắng ⇒ không có', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('Wed, 21 Oct 2015 07:28:00 GMT'));
    try {
      expect(
        errorFromStatus(429, '', { retryAfter: 'Wed, 21 Oct 2015 07:28:10 GMT' }).retryAfterMs,
      ).toBe(10_000);
      expect(
        errorFromStatus(429, '', { retryAfter: 'Wed, 21 Oct 2015 07:00:00 GMT' }).retryAfterMs,
      ).toBe(0);
    } finally {
      now.mockRestore();
    }
    expect(errorFromStatus(429, '', { retryAfter: 'soon' }).retryAfterMs).toBeUndefined();
    expect(errorFromStatus(429, '', { retryAfter: null }).retryAfterMs).toBeUndefined();
    expect(errorFromStatus(429, '').retryAfterMs).toBeUndefined();
    expect(errorFromStatus(429, '', { retryAfter: '' }).retryAfterMs).toBeUndefined();
    expect(errorFromStatus(429, '', { retryAfter: '-3' }).retryAfterMs).toBeUndefined();
  });

  it('`message` không bao giờ chứa bí mật: token lặp lại trong thân bị thay bằng `<redacted>`', () => {
    const token = 'ATATT3xFfGF0-very-secret-token';
    const body = JSON.stringify({ errorMessages: [`Bad token ${token}`], echo: token });
    const error = errorFromStatus(401, body, { secrets: [token] });

    expect(error.message).not.toContain(token);
    expect(error.message).toContain('<redacted>');
    expect(JSON.stringify(error)).not.toContain(token);
  });

  it('bí mật cũng bị xoá khỏi `field`, dạng JSON-escape, và mọi bí mật dài ≥ 4 đều bị xoá', () => {
    const quoted = 'p"ss\\word';
    const other = 'abcd1234';
    const body = JSON.stringify({ errors: { [other]: `echo ${quoted}` } });
    const error = errorFromStatus(400, body, { secrets: [quoted, other] });

    expect(error.field).not.toContain(other);
    expect(error.message).not.toContain(other);
    // Thân là JSON nên bí mật có dấu `"` hay `\` nằm trong đó ở dạng đã escape.
    expect(error.message).not.toContain(JSON.stringify(quoted).slice(1, -1));
    expect(error.message).not.toContain(quoted);
  });

  it('bí mật ngắn hơn 4 ký tự không bị xoá (tránh phá cả thông điệp)', () => {
    expect(errorFromStatus(500, 'abc is down', { secrets: ['abc', ''] }).message).toContain('abc is down');
  });

  it('đoạn trích thân trong `message` tối đa 300 ký tự', () => {
    const error = errorFromStatus(500, 'x'.repeat(5000));

    expect(error.message.length).toBeLessThan(400);
    expect(error.message).toContain('x'.repeat(300));
    expect(error.message).not.toContain('x'.repeat(301));
  });

  it('bí mật nằm vắt qua mốc cắt 300 ký tự vẫn không lộ nửa đầu', () => {
    const secret = 'SECRET-TOKEN-VALUE';
    const body = `${'x'.repeat(295)}${secret}`;
    const error = errorFromStatus(500, body, { secrets: [secret] });

    expect(error.message).not.toContain('SECRET');
    expect(error.message).not.toContain('TOKEN');
  });
});

describe('makeConnectorContext', () => {
  let originalFetch: unknown;
  let originalXhr: unknown;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    originalFetch = g.fetch;
    originalXhr = g.XMLHttpRequest;
    fetchMock = jest.fn();
    g.fetch = fetchMock;
  });

  afterEach(() => {
    g.fetch = originalFetch;
    g.XMLHttpRequest = originalXhr;
    jest.useRealTimers();
  });

  /** `fetch` treo mãi, chỉ reject khi `signal` bị huỷ — như whatwg-fetch/native. */
  const hangUntilAborted = () =>
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const abort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          if (init.signal?.aborted) abort();
          else init.signal?.addEventListener('abort', abort);
        }),
    );

  it('mang `locale` và `timeoutMs` (mặc định 30 000)', () => {
    expect(makeConnectorContext('vi')).toMatchObject({ locale: 'vi', timeoutMs: 30_000 });
    expect(makeConnectorContext('en', 5000)).toMatchObject({ locale: 'en', timeoutMs: 5000 });
  });

  it('request treo quá `timeoutMs` ⇒ ConnectorError uncertain, và request được huỷ', async () => {
    jest.useFakeTimers();
    hangUntilAborted();
    const ctx = makeConnectorContext('en', 1000);

    const pending = ctx.fetch('https://x.test/issue');
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'uncertain' });
    await jest.advanceTimersByTimeAsync(1000);

    await assertion;
    await expect(pending).rejects.toBeInstanceOf(ConnectorError);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('timeout vẫn là uncertain khi `fetch` phớt lờ `signal` và không bao giờ trả', async () => {
    jest.useFakeTimers();
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const ctx = makeConnectorContext('en', 1000);

    const pending = ctx.fetch('https://x.test/issue');
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'uncertain' });
    await jest.advanceTimersByTimeAsync(1000);

    await assertion;
  });

  it('fetch reject `TypeError("Network request failed")` khi chưa có phản hồi ⇒ ConnectorError network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    await expect(makeConnectorContext('en').fetch('https://x.test')).rejects.toMatchObject({
      kind: 'network',
    });
    await expect(makeConnectorContext('en').fetch('https://x.test')).rejects.toBeInstanceOf(
      ConnectorError,
    );
  });

  it('fetch ném đồng bộ ⇒ cũng thành ConnectorError network, không rò timer', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(() => {
      throw new TypeError('bad url');
    });

    await expect(makeConnectorContext('en').fetch('nope')).rejects.toMatchObject({ kind: 'network' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('phản hồi HTTP (kể cả 500) được trả về, không ném; timer được dọn', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(response(500, 'oops'));

    const res = await makeConnectorContext('en').fetch('https://x.test');

    expect(res.status).toBe(500);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('truyền `init` (method, headers, body) xuống `fetch` cùng `signal` của context', async () => {
    fetchMock.mockResolvedValue(response(200, '{}'));

    await makeConnectorContext('en').fetch('https://x.test/a', {
      method: 'POST',
      headers: { 'X-A': '1' },
      body: 'b',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://x.test/a');
    expect(init).toMatchObject({ method: 'POST', body: 'b' });
    const headers = new Headers(init.headers);
    expect(headers.get('x-a')).toBe('1');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('luôn gắn header đánh dấu `X-Shake-Devtools: internal`, với headers dạng object, mảng, Headers hoặc vắng', async () => {
    fetchMock.mockResolvedValue(response(200, '{}'));
    const ctx = makeConnectorContext('en');

    await ctx.fetch('https://x.test/1');
    await ctx.fetch('https://x.test/2', { headers: { Authorization: 'Basic abc' } });
    await ctx.fetch('https://x.test/3', { headers: [['Authorization', 'Basic abc']] });
    await ctx.fetch('https://x.test/4', { headers: new Headers({ Authorization: 'Basic abc' }) });

    fetchMock.mock.calls.forEach(([, init], i) => {
      const headers = new Headers((init as RequestInit).headers);
      expect(headers.get('x-shake-devtools')).toBe('internal');
      if (i > 0) expect(headers.get('authorization')).toBe('Basic abc');
    });
  });

  /* Lớp phòng thủ thứ hai (R16): app/SDK giám sát bọc `fetch` toàn cục rồi `await` mới gọi `fetch`
     thật ⇒ `open` chạy sau khi `runUncaptured` đã xong. Header đánh dấu vẫn chặn được dòng nhật ký. */
  it('`fetch` toàn cục bị bọc và `await` trước khi mở XHR: request của tool vẫn không vào nhật ký, token không lọt đâu cả', async () => {
    g.XMLHttpRequest = FakeXhr;
    const stop = tapNetwork();
    logBuffer.clear();
    const token = 'ATATT3-super-secret-token';
    try {
      fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
        await Promise.resolve(); // ra khỏi phạm vi đồng bộ của `runUncaptured`
        const xhr = new FakeXhr();
        xhr.open('POST', url);
        new Headers(init.headers).forEach((value, name) => xhr.setRequestHeader(name, value));
        xhr.send(init.body);
        return response(200, '{}');
      });

      await makeConnectorContext('en').fetch('https://acme.atlassian.net/rest/api/3/issue', {
        method: 'POST',
        headers: { Authorization: `Basic ${token}` },
        body: JSON.stringify({ token }),
      });

      expect(logBuffer.snapshot()).toHaveLength(0);
      expect(JSON.stringify(logBuffer.snapshot())).not.toContain(token);
    } finally {
      stop();
      logBuffer.clear();
    }
  });

  it('`init.signal` của người gọi vẫn dùng được: huỷ ⇒ huỷ request và ném lỗi huỷ gốc (không bọc)', async () => {
    hangUntilAborted();
    const controller = new AbortController();
    const pending = makeConnectorContext('en').fetch('https://x.test', { signal: controller.signal });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(pending).rejects.not.toBeInstanceOf(ConnectorError);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('`init.signal` đã huỷ từ trước ⇒ `fetch` nhận signal đã huỷ và lỗi huỷ gốc được ném', async () => {
    hangUntilAborted();
    const controller = new AbortController();
    controller.abort();

    await expect(
      makeConnectorContext('en').fetch('https://x.test', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('request của chính tool không vào nhật ký, còn request của app ngay sau đó thì có (spec 5.5)', async () => {
    g.XMLHttpRequest = FakeXhr;
    const stop = tapNetwork();
    logBuffer.clear();
    try {
      fetchMock.mockImplementation(() => {
        const xhr = new FakeXhr();
        xhr.open('POST', 'https://acme.atlassian.net/rest/api/3/issue');
        xhr.send();
        return Promise.resolve(response(200, '{}'));
      });

      await makeConnectorContext('en').fetch('https://acme.atlassian.net/rest/api/3/issue');
      expect(logBuffer.snapshot()).toHaveLength(0);

      const xhr = new FakeXhr();
      xhr.open('GET', 'https://app.test/user');
      xhr.send();
      expect(logBuffer.snapshot()).toHaveLength(1);
    } finally {
      stop();
      logBuffer.clear();
    }
  });
});

describe('requestJson', () => {
  const ctxWith = (res: Response | Error) => {
    const fetch = jest.fn(() => (res instanceof Error ? Promise.reject(res) : Promise.resolve(res)));
    return { fetch, ctx: { fetch, locale: 'en', timeoutMs: 1000 } as const };
  };

  it('2xx ⇒ { status, json } đã parse', async () => {
    const { ctx, fetch } = ctxWith(response(201, '{"key":"BUG-1"}'));

    await expect(requestJson<{ key: string }>(ctx, 'https://x.test', { method: 'POST' })).resolves.toEqual({
      status: 201,
      json: { key: 'BUG-1' },
    });
    expect(fetch).toHaveBeenCalledWith('https://x.test', { method: 'POST' });
  });

  it('2xx thân rỗng ⇒ json undefined', async () => {
    const { ctx } = ctxWith(response(200, ''));

    await expect(requestJson(ctx, 'https://x.test', {})).resolves.toEqual({ status: 200, json: undefined });
  });

  it('2xx nhưng thân không phải JSON ⇒ ConnectorError unknown', async () => {
    const { ctx } = ctxWith(response(200, '<html>'));

    await expect(requestJson(ctx, 'https://x.test', {})).rejects.toMatchObject({
      kind: 'unknown',
      status: 200,
    });
  });

  it('non-2xx ⇒ errorFromStatus với Retry-After và bí mật được cắt khỏi thông điệp', async () => {
    const { ctx } = ctxWith(response(429, 'token=SECRET-123 slow', { 'Retry-After': '7' }));

    const error = await requestJson(ctx, 'https://x.test', {}, { secrets: ['SECRET-123'] }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).toMatchObject({ kind: 'rate-limit', retryAfterMs: 7000, status: 429 });
    expect((error as Error).message).not.toContain('SECRET-123');
  });

  it('lỗi mạng của `ctx.fetch` được ném nguyên', async () => {
    const { ctx } = ctxWith(new ConnectorError('network', 'down'));

    await expect(requestJson(ctx, 'https://x.test', {})).rejects.toMatchObject({ kind: 'network' });
  });

  describe('đọc thân bị chặn thời gian (F1)', () => {
    /** Response đã có header nhưng thân không bao giờ về. */
    const hangingBody = (status = 200) =>
      ({
        status,
        headers: new Headers(),
        text: () => new Promise<string>(() => undefined),
      }) as unknown as Response;

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('thân treo mãi ⇒ ConnectorError uncertain sau `timeoutMs`, timer về 0', async () => {
      const { ctx } = ctxWith(hangingBody());

      const pending = requestJson(ctx, 'https://x.test', {});
      const assertion = expect(pending).rejects.toMatchObject({ kind: 'uncertain', status: 200 });
      await jest.advanceTimersByTimeAsync(1000);

      await assertion;
      expect(jest.getTimerCount()).toBe(0);
    });

    it('thân non-2xx treo mãi cũng ⇒ uncertain (không treo `send`)', async () => {
      const { ctx } = ctxWith(hangingBody(500));

      const pending = requestJson(ctx, 'https://x.test', {});
      const assertion = expect(pending).rejects.toMatchObject({ kind: 'uncertain', status: 500 });
      await jest.advanceTimersByTimeAsync(1000);

      await assertion;
      expect(jest.getTimerCount()).toBe(0);
    });

    it('thân về kịp ⇒ không rò timer', async () => {
      const { ctx } = ctxWith(response(200, '{"a":1}'));

      await expect(requestJson(ctx, 'https://x.test', {})).resolves.toMatchObject({ json: { a: 1 } });
      expect(jest.getTimerCount()).toBe(0);
    });

    it('`init.signal` của người gọi huỷ lúc đang đọc thân ⇒ ném lỗi huỷ, timer về 0', async () => {
      const { ctx } = ctxWith(hangingBody());
      const controller = new AbortController();

      const pending = requestJson(ctx, 'https://x.test', { signal: controller.signal });
      const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await Promise.resolve();
      controller.abort();

      await assertion;
      await expect(pending).rejects.not.toBeInstanceOf(ConnectorError);
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
