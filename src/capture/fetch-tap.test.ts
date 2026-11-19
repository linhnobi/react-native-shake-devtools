import { ReadableStream } from 'stream/web';
import { formatEntry } from './format-log';
import { fullBodies } from './full-body-store';
import { tapFetch } from './fetch-tap';
import { logBuffer } from './log-buffer';
import type { NetworkEntry } from './log-entry';
import { isErrorEntry, isSlowEntry } from './log-query';
import { MAX_BODY_READ_BYTES, runUncaptured, tapNetwork } from './network-tap';
import { REDACTED, redactHeaders } from './redact';
import { makeConnectorContext } from '../report/connectors/http';

/*
  `expo/fetch` giả, dựng theo mã nguồn Expo (packages/expo/src/winter/…):
  - hàm `fetch` mang dấu `Symbol.for('expo.builtin')` (do `installGlobal` đóng), trả Promise, KHÔNG
    chạm XHR; `signal` huỷ ⇒ reject `Error('fetch failed: …')` (FetchError của Expo, không phải AbortError).
  - Response có `body` là ReadableStream; `clone()` = `tee()` luồng, nhánh của bản clone bọc lại để
    biết bị huỷ (như `wrapWithConsumption`); `clone()` ném khi thân đã dùng.
*/

const EXPO_BUILTIN = Symbol.for('expo.builtin');
const g = globalThis as unknown as Record<string, unknown>;
const encoder = new TextEncoder();

type AnyFetch = (...args: unknown[]) => Promise<FakeResponse>;

/** Gọi `fetch` **toàn cục** như app — hàm của tap nếu đã bọc. */
const appFetch = (...args: unknown[]): Promise<FakeResponse> => (g.fetch as AnyFetch)(...args);

/** Lưu/khôi phục các global mà từng case thay. */
const swapGlobals = (values: Record<string, unknown>) => {
  const saved = Object.keys(values).map((key) => [key, key in g, g[key]] as const);
  Object.assign(g, values);
  return () =>
    saved.forEach(([key, had, value]) => {
      if (had) g[key] = value;
      else delete g[key];
    });
};

const onlyEntry = (): NetworkEntry => {
  const entries = logBuffer.snapshot();
  expect(entries).toHaveLength(1);
  return entries[0] as NetworkEntry;
};

/** Chờ các lượt đọc luồng (mỗi mẩu vài microtask) xong hẳn. */
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

type Chunk = string | Uint8Array;
const bytes = (chunk: Chunk) => (typeof chunk === 'string' ? encoder.encode(chunk) : chunk);

/** Luồng phát sẵn mọi mẩu rồi đóng. */
const streamOf = (...chunks: Chunk[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(bytes(chunk)));
      controller.close();
    },
  });

/** Luồng điều khiển tay: đẩy mẩu, đóng, làm hỏng — như native đẩy `didReceiveResponseData`. */
const controlledStream = () => {
  let ctrl!: { enqueue: (c: Uint8Array) => void; close: () => void; error: (e: unknown) => void };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
    },
  });
  return {
    stream,
    push: (chunk: Chunk) => ctrl.enqueue(bytes(chunk)),
    close: () => ctrl.close(),
    error: (e: unknown) => ctrl.error(e),
  };
};

/** Mọi bản clone đã tạo, kèm cờ "nhánh của bản clone đã bị huỷ". */
const clones: Array<{ cancelled: boolean }> = [];

class FakeResponse {
  readonly headers: Headers;
  bodyUsed = false;

  constructor(
    readonly status: number,
    private readonly rawHeaders: Record<string, string>,
    private stream: ReadableStream<Uint8Array> | null,
  ) {
    this.headers = new Headers(rawHeaders);
  }

  get body() {
    return this.stream;
  }

  clone(): FakeResponse {
    if (this.bodyUsed || this.stream?.locked) {
      throw new TypeError("Failed to execute 'clone' on 'Response': Response body is already used.");
    }
    const record = { cancelled: false };
    clones.push(record);
    if (!this.stream) return new FakeResponse(this.status, this.rawHeaders, null);
    const [own, sibling] = this.stream.tee();
    this.stream = own;
    const reader = sibling.getReader();
    const tracked = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel(reason) {
        record.cancelled = true;
        return reader.cancel(reason);
      },
    });
    return new FakeResponse(this.status, this.rawHeaders, tracked);
  }

  async text(): Promise<string> {
    if (this.bodyUsed) throw new TypeError('Body is unusable');
    this.bodyUsed = true;
    if (!this.stream) return '';
    const reader = this.stream.getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    return Buffer.concat(parts).toString('utf8');
  }
}

interface Call {
  input: unknown;
  init?: { headers?: unknown; signal?: AbortSignal };
  resolve: (response: FakeResponse) => void;
  reject: (error: unknown) => void;
}

/** `expo/fetch` giả, cài như Expo cài: mang dấu `expo.builtin`. */
const createNativeFetch = () => {
  const calls: Call[] = [];
  const fn = jest.fn(
    (input: unknown, init?: Call['init']) =>
      new Promise<FakeResponse>((resolve, reject) => {
        calls.push({ input, init, resolve, reject });
        const signal = init?.signal ?? (input as { signal?: AbortSignal } | null)?.signal;
        signal?.addEventListener('abort', () => reject(new Error('fetch failed: Canceled')));
      }),
  );
  Object.defineProperty(fn, EXPO_BUILTIN, { value: true });
  const last = () => calls[calls.length - 1];
  return {
    fn,
    calls,
    last,
    respond: (
      status: number,
      body: string | ReadableStream<Uint8Array> | null = null,
      headers: Record<string, string> = {},
    ) => {
      const stream = typeof body === 'string' ? streamOf(body) : body;
      const response = new FakeResponse(status, headers, stream);
      last().resolve(response);
      return response;
    },
    fail: (message: string) => {
      const error = new Error(`fetch failed: ${message}`);
      last().reject(error);
      return error;
    },
  };
};

type NativeFetch = ReturnType<typeof createNativeFetch>;

const JSON_TYPE = { 'content-type': 'application/json; charset=utf-8' };

describe('tapFetch (expo/fetch giả)', () => {
  let restoreGlobals: () => void;
  let stop: (() => void) | undefined;
  let native: NativeFetch;
  let now: jest.SpyInstance;

  beforeEach(() => {
    native = createNativeFetch();
    restoreGlobals = swapGlobals({ fetch: native.fn });
    now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    clones.length = 0;
    logBuffer.clear();
    logBuffer.setScreen(undefined);
    fullBodies.clear();
  });

  afterEach(() => {
    // `installed` nằm ở module scope: sót bản vá là ca sau nhận lại hàm gỡ cũ và không vá gì.
    stop?.();
    stop = undefined;
    restoreGlobals();
    logBuffer.setScreen(undefined);
    jest.restoreAllMocks();
  });

  describe('dò', () => {
    it('dấu `expo.builtin` ⇒ bọc; hàm bọc mang lại dấu (SDK dò sau vẫn thấy fetch không qua XHR)', () => {
      stop = tapFetch();

      expect(g.fetch).not.toBe(native.fn);
      expect((g.fetch as unknown as Record<symbol, unknown>)[EXPO_BUILTIN]).toBe(true);
    });

    /* `async function fetch(input, init?)` của Expo: tên `fetch`, `length` 2. */
    it('hàm bọc giữ `name` và `length` của hàm gốc', () => {
      Object.defineProperty(native.fn, 'name', { value: 'fetch' });
      Object.defineProperty(native.fn, 'length', { value: 2 });

      stop = tapFetch();

      expect((g.fetch as AnyFetch).name).toBe('fetch');
      expect((g.fetch as AnyFetch).length).toBe(2);
    });

    /* `fetch` mặc định của RN: whatwg-fetch trên XHR — tap XHR đã bắt, bọc thêm là ghi hai dòng. */
    it('whatwg-fetch thật (cờ `polyfill`) ⇒ không bọc, global giữ nguyên', () => {
      let whatwg!: AnyFetch & { polyfill?: boolean };
      jest.isolateModules(() => {
        whatwg = jest.requireActual<{ fetch: typeof whatwg }>('whatwg-fetch').fetch;
      });
      g.fetch = whatwg;

      stop = tapFetch();

      expect(whatwg.polyfill).toBe(true);
      expect(g.fetch).toBe(whatwg);
    });

    it('hàm trơn không dấu (app/SDK đã bọc trước) ⇒ không bọc', () => {
      const wrapped = jest.fn();
      g.fetch = wrapped;

      stop = tapFetch();

      expect(g.fetch).toBe(wrapped);
    });

    it('có dấu Expo mà kèm cờ `polyfill` ⇒ không bọc', () => {
      (native.fn as unknown as { polyfill: boolean }).polyfill = true;

      stop = tapFetch();

      expect(g.fetch).toBe(native.fn);
    });

    it('gọi hai lần ⇒ một lớp, cùng hàm gỡ, một dòng mỗi request', async () => {
      stop = tapFetch();
      const wrapped = g.fetch;

      expect(tapFetch()).toBe(stop);
      expect(g.fetch).toBe(wrapped);

      const pending = appFetch('https://api.test/once');
      native.respond(200, '{}', JSON_TYPE);
      await pending;
      await flush();
      expect(onlyEntry()).toMatchObject({ url: 'https://api.test/once', status: 200 });
    });
  });

  describe('ghi', () => {
    it('ghi dòng ngay lúc gọi (header thô, chưa status) rồi chốt status + thời lượng + thân', async () => {
      stop = tapFetch();
      const init = {
        method: 'post',
        headers: { Authorization: 'Bearer eyJ.real.token', 'Content-Type': 'application/json' },
        body: '{"a":1}',
      };
      const pending = appFetch('https://api.test/user', init);

      // Hàm gốc nhận đúng đối số của app — tap chỉ ghi chép.
      expect(native.fn).toHaveBeenCalledWith('https://api.test/user', init);
      expect(onlyEntry()).toMatchObject({
        kind: 'network',
        method: 'POST',
        url: 'https://api.test/user',
        at: 1000,
        requestHeaders: { Authorization: 'Bearer eyJ.real.token', 'Content-Type': 'application/json' },
        requestBody: '{"a":1}',
        requestTruncated: false,
      });
      expect(onlyEntry().status).toBeUndefined();
      expect(onlyEntry().durationMs).toBeUndefined();

      now.mockReturnValue(1250);
      const sent = native.respond(200, '{"ok":true}', JSON_TYPE);
      await expect(pending).resolves.toBe(sent);
      await flush();

      expect(onlyEntry()).toMatchObject({
        status: 200,
        durationMs: 250,
        responseBody: '{"ok":true}',
        responseTruncated: false,
      });
      expect(onlyEntry().error).toBeUndefined();
      expect(onlyEntry().responseBodySkipped).toBeUndefined();
    });

    it.each([404, 500])('%i ⇒ status + thân, tính là lỗi', async (status) => {
      stop = tapFetch();
      const pending = appFetch('https://api.test/order');
      native.respond(status, '{"message":"nope"}', JSON_TYPE);
      await pending;
      await flush();

      expect(onlyEntry()).toMatchObject({ status, responseBody: '{"message":"nope"}' });
      expect(isErrorEntry(onlyEntry())).toBe(true);
    });

    /* Trên máy `Request` toàn cục là của whatwg-fetch (Expo chỉ thay `fetch`), nên `instanceof` nhận ra. */
    it('input là `Request` của whatwg-fetch ⇒ URL, method, header, thân (`_bodyInit`) lấy từ nó', async () => {
      let WhatwgRequest!: new (url: string, init?: object) => object;
      jest.isolateModules(() => {
        WhatwgRequest = jest.requireActual<{ Request: typeof WhatwgRequest }>('whatwg-fetch').Request;
      });
      const restoreRequest = swapGlobals({ Request: WhatwgRequest });
      try {
        stop = tapFetch();
        const request = new WhatwgRequest('https://api.test/item/7', {
          method: 'PUT',
          headers: { 'X-Trace': 'abc' },
          body: '{"name":"Ân"}',
        });
        const pending = appFetch(request);

        expect(native.last().input).toBe(request);
        expect(onlyEntry()).toMatchObject({
          method: 'PUT',
          url: 'https://api.test/item/7',
          requestHeaders: { 'x-trace': 'abc', 'content-type': 'text/plain;charset=UTF-8' },
          requestBody: '{"name":"Ân"}',
        });

        native.respond(204);
        await pending;
        expect(onlyEntry()).toMatchObject({ status: 204 });
      } finally {
        restoreRequest();
      }
    });

    it('header dạng mảng cặp ⇒ ghi; khác hoa thường thì lần sau thay lần trước', async () => {
      stop = tapFetch();
      void appFetch('https://api.test/x', {
        headers: [
          ['X-Env', 'uat'],
          ['x-env', 'prod'],
          ['Accept', 'application/json'],
        ],
      });

      expect(onlyEntry().requestHeaders).toEqual({ 'x-env': 'prod', Accept: 'application/json' });
    });

    it('đóng dấu màn đang mở', () => {
      stop = tapFetch();
      logBuffer.setScreen('Checkout');
      void appFetch('https://api.test/cart');

      expect(onlyEntry().screen).toBe('Checkout');
    });

    /* Bộ đệm giữ thô (để `toCurl` chạy được); mọi đường xuất tự che — bảng chính sách ở `redact.ts`. */
    it('header/thân thô trong buffer; đường xuất (`redactHeaders`, `formatEntry`) che', async () => {
      stop = tapFetch();
      const pending = appFetch('https://api.test/login', {
        method: 'POST',
        headers: { Authorization: 'Bearer eyJ.real.token' },
        body: '{"user":"an","password":"hunter2"}',
      });
      native.respond(200, '{"token":"tok-123"}', JSON_TYPE);
      await pending;
      await flush();
      const entry = onlyEntry();

      expect(entry.requestHeaders).toEqual({ Authorization: 'Bearer eyJ.real.token' });
      expect(entry.requestBody).toContain('hunter2');
      expect(redactHeaders({ ...entry.requestHeaders })).toEqual({ Authorization: REDACTED });
      const exported = formatEntry(entry);
      expect(exported).not.toContain('hunter2');
      expect(exported).not.toContain('tok-123');
      expect(exported).toContain(REDACTED);
    });
  });

  describe('lỗi tầng vận chuyển', () => {
    it('lỗi mạng ⇒ `network`, không status; app nhận đúng lỗi gốc', async () => {
      stop = tapFetch();
      const pending = appFetch('https://api.test/user');
      now.mockReturnValue(1400);
      const error = native.fail('The Internet connection appears to be offline.');

      await expect(pending).rejects.toBe(error);
      expect(onlyEntry()).toMatchObject({ error: 'network', durationMs: 400 });
      expect(onlyEntry().status).toBeUndefined();
      expect(isErrorEntry(onlyEntry())).toBe(true);
    });

    it('huỷ bằng `AbortController` ⇒ `abort`, KHÔNG tính là lỗi', async () => {
      stop = tapFetch();
      const controller = new AbortController();
      const pending = appFetch('https://api.test/slow', { signal: controller.signal });
      now.mockReturnValue(1050);
      controller.abort();

      await expect(pending).rejects.toThrow('fetch failed: Canceled');
      expect(onlyEntry()).toMatchObject({ error: 'abort', durationMs: 50 });
      expect(onlyEntry().status).toBeUndefined();
      expect(isErrorEntry(onlyEntry())).toBe(false);
    });

    it('huỷ qua `signal` của `Request` (nhận theo `Symbol.toStringTag`) ⇒ `abort`', async () => {
      stop = tapFetch();
      const controller = new AbortController();
      const request = {
        url: 'https://api.test/req',
        method: 'GET',
        signal: controller.signal,
        [Symbol.toStringTag]: 'Request',
      };
      const pending = appFetch(request);
      controller.abort();

      await expect(pending).rejects.toThrow();
      expect(onlyEntry()).toMatchObject({ url: 'https://api.test/req', error: 'abort' });
    });

    it('`AbortSignal.timeout` (lý do `TimeoutError`) ⇒ `timeout`, là lỗi', async () => {
      stop = tapFetch();
      const controller = new AbortController();
      const pending = appFetch('https://api.test/slow', { signal: controller.signal });
      // Như `AbortSignal.timeout(ms)` bắn: lý do là `DOMException` tên `TimeoutError`. (Kiểu
      // `AbortController` của RN không khai tham số `reason`.)
      (controller as unknown as { abort: (reason: unknown) => void }).abort(
        Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }),
      );

      await expect(pending).rejects.toThrow();
      expect(onlyEntry()).toMatchObject({ error: 'timeout' });
      expect(isErrorEntry(onlyEntry())).toBe(true);
    });

    it('native báo "The request timed out." ⇒ `timeout`', async () => {
      stop = tapFetch();
      const pending = appFetch('https://api.test/slow');
      native.fail('The request timed out.');

      await expect(pending).rejects.toThrow();
      expect(onlyEntry()).toMatchObject({ error: 'timeout' });
    });

    it('hàm gốc ném đồng bộ ⇒ lỗi tới app nguyên vẹn, dòng chốt `network` thay vì treo', () => {
      stop = tapFetch();
      const boom = new TypeError('Invalid URL');
      native.fn.mockImplementationOnce(() => {
        throw boom;
      });

      expect(() => appFetch('::bad')).toThrow(boom);
      expect(onlyEntry()).toMatchObject({ error: 'network', durationMs: 0 });
    });
  });

  describe('thân request', () => {
    it('chuỗi vượt hạn mức ⇒ cắt kèm cờ, bản đầy đủ vào kho riêng', () => {
      stop = tapFetch(10);
      const body = 'x'.repeat(25);
      void appFetch('https://api.test/u', { method: 'POST', body });

      expect(onlyEntry()).toMatchObject({ requestBody: `${'x'.repeat(10)}…+15`, requestTruncated: true });
      expect(fullBodies.get(onlyEntry().id, 'request')?.text).toBe(body);
    });

    it('`URLSearchParams` ⇒ ghi dạng chữ (như whatwg-fetch gửi)', () => {
      stop = tapFetch();
      void appFetch('https://api.test/form', {
        method: 'POST',
        body: new URLSearchParams({ q: 'áo', page: '2' }),
      });

      expect(onlyEntry().requestBody).toBe('q=%C3%A1o&page=2');
      expect(onlyEntry().requestBodySkipped).toBeUndefined();
    });

    it.each([
      ['FormData', () => new FormData(), 'formData'],
      ['ArrayBuffer', () => new ArrayBuffer(8), 'binary'],
      ['Uint8Array', () => new Uint8Array([1, 2, 3]), 'binary'],
      ['Blob', () => new Blob(['abc']), 'binary'],
      ['ReadableStream', () => streamOf('abc'), 'unreadable'],
    ])('thân %s ⇒ hàm gốc nhận nguyên object, dòng ghi lý do `%s`', (_name, make, reason) => {
      stop = tapFetch();
      const body = make();
      void appFetch('https://api.test/up', { method: 'POST', body });

      expect((native.last().init as { body?: unknown }).body).toBe(body);
      expect(onlyEntry().requestBody).toBeUndefined();
      expect(onlyEntry().requestBodySkipped).toBe(reason);
    });
  });

  describe('thân response', () => {
    it('`res.text()` của app ra đủ khi đọc SAU tap', async () => {
      stop = tapFetch();
      const json = '{"user":{"id":7,"name":"Ân"}}';
      const pending = appFetch('https://api.test/user');
      native.respond(200, json, JSON_TYPE);
      const res = await pending;
      await flush();

      expect(onlyEntry().responseBody).toBe(json);
      await expect(res.text()).resolves.toBe(json);
      expect(clones).toHaveLength(1);
    });

    it('`res.text()` của app ra đủ khi đọc NGAY (trước khi tap đọc xong)', async () => {
      stop = tapFetch();
      const json = '{"items":[1,2,3]}';
      const pending = appFetch('https://api.test/items');
      native.respond(200, json, JSON_TYPE);
      const res = await pending;

      await expect(res.text()).resolves.toBe(json);
      await flush();
      expect(onlyEntry().responseBody).toBe(json);
    });

    it('ảnh ⇒ `binary`, KHÔNG clone (đường đọc của app không đổi)', async () => {
      stop = tapFetch();
      const pending = appFetch('https://cdn.test/a.png');
      native.respond(200, '\u0089PNG', { 'content-type': 'image/png' });
      const res = await pending;
      await flush();

      expect(onlyEntry().responseBodySkipped).toBe('binary');
      expect(onlyEntry().responseBody).toBeUndefined();
      expect(clones).toHaveLength(0);
      await expect(res.text()).resolves.toBe('\u0089PNG');
    });

    it('`content-length` trên 1 MB ⇒ `tooLarge`, KHÔNG clone', async () => {
      stop = tapFetch();
      const pending = appFetch('https://api.test/dump');
      native.respond(200, '{}', { ...JSON_TYPE, 'content-length': String(MAX_BODY_READ_BYTES + 1) });
      await pending;
      await flush();

      expect(onlyEntry().responseBodySkipped).toBe('tooLarge');
      expect(clones).toHaveLength(0);
    });

    it('luồng không `content-length` vượt 1 MB ⇒ `tooLarge`, nhánh của tap bị huỷ, app vẫn đọc đủ', async () => {
      stop = tapFetch();
      const part = 'a'.repeat(400_000);
      const pending = appFetch('https://api.test/big');
      native.respond(200, streamOf(part, part, part), { 'content-type': 'text/plain' });
      const res = await pending;
      await flush();

      expect(onlyEntry().responseBodySkipped).toBe('tooLarge');
      expect(onlyEntry().responseBody).toBeUndefined();
      expect(clones).toEqual([{ cancelled: true }]);
      await expect(res.text()).resolves.toHaveLength(1_200_000);
    });

    it('thân dài hơn `bodyLimit` ⇒ cắt kèm cờ, bản đầy đủ vào kho riêng', async () => {
      stop = tapFetch(10);
      const body = 'y'.repeat(12);
      const pending = appFetch('https://api.test/y');
      native.respond(200, body, { 'content-type': 'text/plain' });
      await pending;
      await flush();

      expect(onlyEntry()).toMatchObject({ responseBody: `${'y'.repeat(10)}…+2`, responseTruncated: true });
      expect(fullBodies.get(onlyEntry().id, 'response')?.text).toBe(body);
    });

    it('thân 0 byte ⇒ không có thân, không lý do', async () => {
      stop = tapFetch();
      const pending = appFetch('https://api.test/empty');
      native.respond(200, streamOf(), JSON_TYPE);
      await pending;
      await flush();

      expect(onlyEntry().responseBody).toBeUndefined();
      expect(onlyEntry().responseBodySkipped).toBeUndefined();
    });

    it.each([
      ['204', 'GET', 204, {}],
      ['HEAD', 'HEAD', 200, JSON_TYPE],
      ['`content-length: 0`', 'GET', 200, { ...JSON_TYPE, 'content-length': '0' }],
    ])('%s ⇒ không có thân, không clone', async (_name, method, status, headers) => {
      stop = tapFetch();
      const pending = appFetch('https://api.test/none', { method });
      native.respond(status, streamOf(), headers);
      await pending;
      await flush();

      expect(onlyEntry()).toMatchObject({ status });
      expect(onlyEntry().responseBody).toBeUndefined();
      expect(onlyEntry().responseBodySkipped).toBeUndefined();
      expect(clones).toHaveLength(0);
    });

    /* Nhánh `tee` của tap sẽ giữ kết nối SSE sống cả khi app đã huỷ nhánh của nó. */
    it('`text/event-stream` ⇒ `unreadable`, KHÔNG clone', async () => {
      stop = tapFetch();
      const sse = controlledStream();
      const pending = appFetch('https://api.test/events');
      native.respond(200, sse.stream, { 'content-type': 'text/event-stream' });
      await pending;
      await flush();

      expect(onlyEntry().responseBodySkipped).toBe('unreadable');
      expect(clones).toHaveLength(0);
    });

    it.each([
      [
        '`clone` ném (thân đã bị đọc)',
        (res: FakeResponse) => {
          res.bodyUsed = true;
        },
      ],
      [
        'không có `clone`',
        (res: FakeResponse) => {
          Object.defineProperty(res, 'clone', { value: undefined });
        },
      ],
    ])('%s ⇒ `unreadable`, app vẫn nhận đúng Response', async (_name, spoil) => {
      stop = tapFetch();
      const pending = appFetch('https://api.test/x');
      const res = new FakeResponse(200, JSON_TYPE, streamOf('{}'));
      spoil(res);
      native.last().resolve(res);

      await expect(pending).resolves.toBe(res);
      expect(onlyEntry()).toMatchObject({ status: 200, responseBodySkipped: 'unreadable' });
    });

    /* Cùng nghĩa với tap XHR (chốt ở `loadend`, sau khi tải xong thân): tải 6 s mà ghi ~100 ms thì
       chip "Chậm ≥3s" bỏ sót. Nhánh `tee` của tap đọc ngay ⇒ lúc nó xong là lúc nguồn xong. */
    it('status vào NGAY khi có header; thân đọc xong thì `durationMs` thành thời gian tới hết thân', async () => {
      stop = tapFetch();
      const body = controlledStream();
      const pending = appFetch('https://api.test/slow-body');
      now.mockReturnValue(1100);
      native.respond(200, body.stream, JSON_TYPE);
      await pending;
      await flush();

      expect(onlyEntry()).toMatchObject({ status: 200, durationMs: 100 });
      expect(onlyEntry().responseBody).toBeUndefined();

      body.push('{"a":');
      body.push('1}');
      now.mockReturnValue(7000);
      body.close();
      await flush();
      expect(onlyEntry()).toMatchObject({ responseBody: '{"a":1}', durationMs: 6000 });
      expect(isSlowEntry(onlyEntry())).toBe(true);
    });

    /* Thân tap không đọc (nhị phân, quá lớn, SSE, HEAD/204): tap không thấy lúc luồng xong. */
    it('thân KHÔNG đọc (ảnh) ⇒ `durationMs` giữ thời gian tới header', async () => {
      stop = tapFetch();
      const body = controlledStream();
      const pending = appFetch('https://cdn.test/big.png');
      now.mockReturnValue(1080);
      native.respond(200, body.stream, { 'content-type': 'image/png' });
      const res = await pending;
      await flush();

      body.push('\u0089PNG');
      now.mockReturnValue(7000);
      body.close();
      await expect(res.text()).resolves.toBe('\u0089PNG');
      await flush();

      expect(onlyEntry()).toMatchObject({ status: 200, durationMs: 80, responseBodySkipped: 'binary' });
    });

    /* Như tap XHR: "200" kèm thân cụt là nói dối — dòng chuyển sang lỗi vận chuyển. */
    it('luồng hỏng giữa thân ⇒ dòng chốt `network`, không status; `res.text()` của app cũng hỏng', async () => {
      stop = tapFetch();
      const body = controlledStream();
      const pending = appFetch('https://api.test/drop');
      native.respond(200, body.stream, JSON_TYPE);
      const res = await pending;
      body.push('{"items":[1,');
      await flush();
      const appRead = res.text();
      body.error(new Error('The network connection was lost.'));

      await expect(appRead).rejects.toThrow('The network connection was lost.');
      await flush();
      expect(onlyEntry()).toMatchObject({ error: 'network' });
      expect(onlyEntry().status).toBeUndefined();
      expect(onlyEntry().responseBody).toBeUndefined();
    });
  });

  describe('request của chính tool', () => {
    it.each([
      ['object', { 'X-Shake-Devtools': 'internal', Authorization: 'Basic c2VjcmV0' }],
      ['`Headers`', new Headers({ 'x-shake-devtools': 'internal', Authorization: 'Basic c2VjcmV0' })],
      [
        'mảng cặp',
        [
          ['Authorization', 'Basic c2VjcmV0'],
          ['X-SHAKE-DEVTOOLS', 'internal'],
        ],
      ],
    ])('header `X-Shake-Devtools` (%s) ⇒ không dòng nào, request vẫn đi nguyên', async (_name, headers) => {
      stop = tapFetch();
      const init = { method: 'POST', headers, body: '{"token":"c2VjcmV0"}' };
      const pending = appFetch('https://acme.atlassian.test/issue', init);

      expect(native.fn).toHaveBeenCalledWith('https://acme.atlassian.test/issue', init);
      native.respond(201, '{"key":"DEMO-1"}', JSON_TYPE);
      await pending;
      await flush();

      expect(logBuffer.snapshot()).toHaveLength(0);
      expect(clones).toHaveLength(0);
    });

    it('`runUncaptured(() => fetch(…))` ⇒ không dòng nào, không đọc thân', async () => {
      stop = tapFetch();
      const pending = runUncaptured(() => appFetch('https://tool.test/issue', { method: 'POST' }));

      expect(native.fn).toHaveBeenCalledTimes(1);
      native.respond(200, '{"ok":true}', JSON_TYPE);
      const res = await pending;
      await flush();

      expect(logBuffer.snapshot()).toHaveLength(0);
      expect(clones).toHaveLength(0);
      await expect(res.text()).resolves.toBe('{"ok":true}');
    });

    /* Đúng đường connector báo bug đi: `ctx.fetch` gọi `fetch` toàn cục (giờ là hàm của tap). */
    it('`makeConnectorContext` thật ⇒ không dòng nào, token không lọt buffer', async () => {
      stop = tapFetch();
      const ctx = makeConnectorContext('en', 5_000);
      const pending = ctx.fetch('https://acme.atlassian.test/rest/api/3/myself', {
        headers: { Authorization: 'Basic c2VjcmV0LXRva2Vu' },
      });

      const sentHeaders = native.last().init?.headers as Headers;
      expect(sentHeaders.get('x-shake-devtools')).toBe('internal');
      native.respond(200, '{"accountId":"1"}', JSON_TYPE);
      await pending;
      await flush();

      expect(logBuffer.snapshot()).toHaveLength(0);
      expect(JSON.stringify(logBuffer.snapshot())).not.toContain('c2VjcmV0');
    });

    it('`fetch` ngay sau `runUncaptured` (kể cả khi `fn` ném) vẫn được ghi', () => {
      stop = tapFetch();
      expect(() =>
        runUncaptured(() => {
          throw new Error('boom');
        }),
      ).toThrow('boom');

      void appFetch('https://app.test/user');
      expect(onlyEntry()).toMatchObject({ url: 'https://app.test/user' });
    });
  });

  /* ------------------------------------------------------------------------------------------ */

  describe('không ghi trùng với tap XHR', () => {
    type Listener = () => void;
    class FakeXhr {
      status = 0;
      responseText = '';
      private readonly listeners = new Map<string, Listener[]>();
      addEventListener(type: string, listener: Listener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
      }
      removeEventListener(type: string, listener: Listener) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
      }
    }
    const proto = FakeXhr.prototype as unknown as Record<string, jest.Mock>;

    let restoreXhr: () => void;
    let stopXhr: (() => void) | undefined;

    beforeEach(() => {
      restoreXhr = swapGlobals({ XMLHttpRequest: FakeXhr });
      proto.open = jest.fn();
      proto.send = jest.fn();
      proto.setRequestHeader = jest.fn();
    });

    afterEach(() => {
      stopXhr?.();
      stopXhr = undefined;
      restoreXhr();
    });

    /* Lớp chặn thứ hai: hàm gốc chạy trong `runUncaptured`, nên XHR nó mở ĐỒNG BỘ bị tap XHR bỏ qua. */
    it('hàm mang dấu Expo mà bên dưới mở XHR đồng bộ ⇒ đúng MỘT dòng khi bật cả `tapNetwork`', () => {
      native.fn.mockImplementation((input: unknown) => {
        const xhr = new (g.XMLHttpRequest as new () => XMLHttpRequest)();
        xhr.open('GET', String(input));
        xhr.send();
        return new Promise<FakeResponse>(() => undefined);
      });
      const { send } = proto; // hàm "gốc" — `tapNetwork` sắp vá đè lên prototype
      stopXhr = tapNetwork();
      stop = tapFetch();

      void appFetch('https://api.test/once');

      expect(send).toHaveBeenCalledTimes(1);
      expect(onlyEntry()).toMatchObject({ url: 'https://api.test/once' });
    });
  });

  describe('gỡ', () => {
    it('trả lại hàm gốc; request sau đó không ghi', async () => {
      stop = tapFetch();
      expect(g.fetch).not.toBe(native.fn);

      stop();
      stop = undefined;

      expect(g.fetch).toBe(native.fn);
      const pending = appFetch('https://api.test/after');
      native.respond(200, '{}', JSON_TYPE);
      await pending;
      expect(logBuffer.snapshot()).toHaveLength(0);
    });

    it('SDK bọc chồng sau tap ⇒ gỡ giữ hàm của SDK, hàm của tap thành trong suốt', async () => {
      stop = tapFetch();
      const tapped = g.fetch as AnyFetch;
      const sdk = jest.fn((...args: unknown[]) => tapped(...args));
      g.fetch = sdk;

      stop();
      stop = undefined;

      expect(g.fetch).toBe(sdk);
      const pending = appFetch('https://api.test/sdk');
      expect(sdk).toHaveBeenCalledTimes(1);
      expect(native.fn).toHaveBeenCalledTimes(1);
      native.respond(200, '{}', JSON_TYPE);
      await pending;
      await flush();
      expect(logBuffer.snapshot()).toHaveLength(0);
    });

    it('request đang bay lúc gỡ vẫn được chốt', async () => {
      stop = tapFetch();
      const pending = appFetch('https://api.test/inflight');
      stop();
      stop = undefined;

      native.respond(200, '{"ok":1}', JSON_TYPE);
      await pending;
      await flush();
      expect(onlyEntry()).toMatchObject({ status: 200, responseBody: '{"ok":1}' });
    });
  });

  /* Công cụ gỡ lỗi hỏng không được làm hỏng app đang gỡ. */
  it('listener của buffer ném lúc ghi/chốt ⇒ app vẫn nhận đúng Response, dòng vẫn chốt', async () => {
    stop = tapFetch();
    const unsubscribe = logBuffer.subscribe(() => {
      throw new Error('listener của buffer hỏng');
    });
    try {
      const pending = appFetch('https://api.test/user');
      const sent = native.respond(200, '{"ok":true}', JSON_TYPE);

      await expect(pending).resolves.toBe(sent);
      await flush();
      expect(onlyEntry()).toMatchObject({ status: 200, responseBody: '{"ok":true}' });
    } finally {
      unsubscribe();
    }
  });
});
