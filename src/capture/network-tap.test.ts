import { FULL_BODY_LIMIT, fullBodies } from './full-body-store';
import { logBuffer } from './log-buffer';
import type { BodySkip, NetworkEntry } from './log-entry';
import { DEFAULT_BODY_LIMIT, MAX_BODY_READ_BYTES, runUncaptured, tapNetwork } from './network-tap';
import { REDACTED } from './redact';
import { startCapture } from './start-capture';
import type { RnNetworkingMockModule } from '../testing/rn-networking.mock';

/*
  Native giả ở RANH `RCTNetworking`: nhóm "XHR thật của RN" và nhóm `fetch` chạy trên chính lớp
  `XMLHttpRequest` của react-native 0.86, chỉ phần native bị thay. Nhóm XHR giả tối giản không đụng
  tới module này.
*/
jest.mock('react-native/Libraries/Network/RCTNetworking', () =>
  require('../testing/rn-networking.mock').createRnNetworkingMock(),
);

type XhrMethod = (...args: unknown[]) => unknown;
type Listener = () => void;

const g = globalThis as unknown as Record<string, unknown>;

/** Dòng duy nhất trong nhật ký — có nhiều hơn một là đã vá chồng hoặc ghi trùng. */
const onlyEntry = (): NetworkEntry => {
  const entries = logBuffer.snapshot();
  expect(entries).toHaveLength(1);
  return entries[0] as NetworkEntry;
};

const networkEntries = () => logBuffer.snapshot() as readonly NetworkEntry[];

/** Dòng đã chốt: có thời lượng, và có đúng một trong hai — status hoặc lỗi. */
const expectSettled = (entry: NetworkEntry) => {
  expect(entry.durationMs).toBeDefined();
  expect(entry.status === undefined).toBe(entry.error !== undefined);
};

/**
 * XHR giả tối thiểu — chỉ đủ những gì `tapNetwork` chạm tới, phát sự kiện **không** bọc `try`
 * (một XHR ngây thơ: listener ném là cả vòng phát dừng).
 *
 * `open`/`send`/`setRequestHeader` KHÔNG khai ở đây: `tapNetwork` vá trên **prototype**, nên
 * ba hàm "gốc" được gắn lên prototype ở `beforeEach` bằng `jest.fn()` để kiểm được lời gọi.
 */
class FakeXhr {
  status = 0;
  responseText = '';
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== listener),
    );
  }

  /** Kết thúc request rồi bắn `loadend` (không bắn sự kiện kết cục). `status 0` là lỗi tầng vận chuyển. */
  finish(status: number, responseText = ''): void {
    this.status = status;
    this.responseText = responseText;
    this.emit('loadend');
  }

  /** Như XHR theo spec: bắn sự kiện kết cục (`load`/`error`/…) rồi mới `loadend`. */
  finishWith(outcome: string, status: number, responseText = ''): void {
    this.status = status;
    this.responseText = responseText;
    this.emit(outcome);
    this.emit('loadend');
  }

  private emit(type: string): void {
    (this.listeners.get(type) ?? []).forEach((listener) => listener());
  }
}

type Fake = FakeXhr & { open: XhrMethod; send: XhrMethod; setRequestHeader: XhrMethod };

const proto = FakeXhr.prototype as unknown as Record<
  'open' | 'send' | 'setRequestHeader',
  jest.Mock
>;

const newFake = () => new FakeXhr() as Fake;

/** Lưu/khôi phục các global mà từng nhóm thay. */
const swapGlobals = (values: Record<string, unknown>) => {
  const saved = Object.keys(values).map((key) => [key, key in g, g[key]] as const);
  Object.assign(g, values);
  return () =>
    saved.forEach(([key, had, value]) => {
      if (had) g[key] = value;
      else delete g[key];
    });
};

describe('tapNetwork', () => {
  let restoreGlobals: () => void;
  let stop: (() => void) | undefined;
  let now: jest.SpyInstance;

  beforeEach(() => {
    restoreGlobals = swapGlobals({ XMLHttpRequest: FakeXhr });
    proto.open = jest.fn();
    proto.send = jest.fn();
    proto.setRequestHeader = jest.fn();
    now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    logBuffer.clear();
  });

  afterEach(() => {
    // `installed` nằm ở module scope: sót bản vá là ca sau nhận lại hàm gỡ cũ và không vá gì.
    stop?.();
    stop = undefined;
    restoreGlobals();
    jest.restoreAllMocks();
  });

  it('ghi dòng ngay lúc `send` (chưa có status)', () => {
    stop = tapNetwork();
    const xhr = newFake();
    xhr.open('get', 'https://api.test/user');

    expect(logBuffer.snapshot()).toHaveLength(0);

    xhr.send();
    const entry = onlyEntry();

    expect(entry).toMatchObject({
      kind: 'network',
      method: 'GET',
      url: 'https://api.test/user',
      at: 1000,
    });
    expect(entry.status).toBeUndefined();
    expect(entry.durationMs).toBeUndefined();
    expect(entry.error).toBeUndefined();
  });

  it('điền `status`/`durationMs` khi xong', () => {
    stop = tapNetwork();
    const xhr = newFake();
    xhr.open('GET', 'https://api.test/user');
    xhr.send();

    now.mockReturnValue(1250);
    xhr.finish(200, '{"ok":true}');

    expect(onlyEntry()).toMatchObject({
      status: 200,
      durationMs: 250,
      responseBody: '{"ok":true}',
      responseTruncated: false,
    });
    expect(onlyEntry().error).toBeUndefined();
  });

  /* `loadend` bắn cho cả ca hỏng mạng — dùng `load` thì dòng này nằm "đang bay" mãi. XHR này
     không bắn sự kiện kết cục ⇒ tap rơi về đoán theo `status 0`. */
  it('lỗi mạng điền `error`', () => {
    stop = tapNetwork();
    const xhr = newFake();
    xhr.open('GET', 'https://api.test/user');
    xhr.send();

    now.mockReturnValue(1400);
    xhr.finish(0);
    const entry = onlyEntry();

    expect(entry.error).toBe('network');
    expect(entry.status).toBeUndefined();
    expect(entry.responseBody).toBeUndefined();
    expect(entry.durationMs).toBe(400);
  });

  /* Bộ đệm giữ header THÔ để `toCurl` dựng được lệnh chạy được; che ở chỗ xuất
     (`formatLog` · `LogRow`). Xem bảng chính sách ở đầu `redact.ts`. */
  it('header `Authorization` giữ THÔ trong buffer — che là việc của chỗ xuất', () => {
    const { setRequestHeader } = proto;
    stop = tapNetwork();
    const xhr = newFake();
    xhr.open('POST', 'https://api.test/user');
    xhr.setRequestHeader('Authorization', 'Bearer eyJ.real.token');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send('{"a":1}');

    expect(onlyEntry().requestHeaders).toEqual({
      Authorization: 'Bearer eyJ.real.token',
      'Content-Type': 'application/json',
    });
    expect(JSON.stringify(onlyEntry())).not.toContain(REDACTED);
    // Hàm gốc vẫn nhận header — bản vá chỉ ghi chép, không nuốt.
    expect(setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer eyJ.real.token');
  });

  it('thân vượt hạn mức bị cắt', () => {
    stop = tapNetwork(10);
    const xhr = newFake();
    xhr.open('POST', 'https://api.test/user');
    xhr.send('x'.repeat(25));

    expect(onlyEntry()).toMatchObject({
      requestBody: `${'x'.repeat(10)}…+15`,
      requestTruncated: true,
    });

    xhr.finish(200, 'y'.repeat(12));

    expect(onlyEntry()).toMatchObject({
      responseBody: `${'y'.repeat(10)}…+2`,
      responseTruncated: true,
    });
  });

  /* Bọc chồng, không thay thế: hàm đang có sẵn (có thể là của `XHRInterceptor`) vẫn phải chạy. */
  it('`open`/`send` gốc vẫn được gọi', () => {
    const { open, send } = proto;
    stop = tapNetwork();
    const xhr = newFake();
    xhr.open('GET', 'https://api.test/user', true);
    xhr.send('body');

    expect(open).toHaveBeenCalledWith('GET', 'https://api.test/user', true);
    expect(open.mock.contexts[0]).toBe(xhr);
    expect(send).toHaveBeenCalledWith('body');
    expect(send.mock.contexts[0]).toBe(xhr);
  });

  it('`stop()` khôi phục đúng ba hàm gốc', () => {
    const { open, send, setRequestHeader } = proto;
    stop = tapNetwork();

    expect(proto.open).not.toBe(open);
    expect(proto.send).not.toBe(send);
    expect(proto.setRequestHeader).not.toBe(setRequestHeader);

    stop();

    expect(proto.open).toBe(open);
    expect(proto.send).toBe(send);
    expect(proto.setRequestHeader).toBe(setRequestHeader);

    const xhr = newFake();
    xhr.open('GET', 'https://api.test/user');
    xhr.send();
    expect(logBuffer.snapshot()).toHaveLength(0);
  });

  /*
    Spec (trình duyệt, polyfill kiểu spec) cho `open` lại một xhr đang bay: request cũ bị huỷ mà
    KHÔNG có `loadend`. Thiếu bước chốt ở `open` thì dòng cũ "đang bay" mãi; listener cũ còn móc thì
    kết quả của request mới đè lên dòng cũ.
  */
  it('XHR kiểu spec cho `open` lại khi đang bay ⇒ dòng cũ chốt `abort`, dòng mới đúng URL mới', () => {
    stop = tapNetwork();
    const xhr = newFake();
    xhr.open('GET', 'https://api.test/first');
    xhr.send();
    now.mockReturnValue(1100);
    xhr.open('POST', 'https://api.test/second');
    xhr.send('{}');
    now.mockReturnValue(1300);
    xhr.finish(201, 'created');

    const [first, second] = networkEntries();
    expect(networkEntries()).toHaveLength(2);
    expect(first).toMatchObject({ url: 'https://api.test/first', error: 'abort', durationMs: 100 });
    expect(first.status).toBeUndefined();
    expect(second).toMatchObject({
      method: 'POST',
      url: 'https://api.test/second',
      status: 201,
      responseBody: 'created',
      durationMs: 200,
    });
  });

  /* XHR ngây thơ không bọc `try` quanh listener: lỗi của tap mà lọt ra là listener của app sau nó
     không bao giờ chạy. */
  it('buffer ném lúc ghi/chốt không làm hỏng app', () => {
    const { send } = proto;
    stop = tapNetwork();
    const unsubscribe = logBuffer.subscribe(() => {
      throw new Error('listener của buffer hỏng');
    });
    try {
      const xhr = newFake();
      xhr.open('GET', 'https://api.test/user');
      expect(() => xhr.send()).not.toThrow();
      expect(send).toHaveBeenCalledTimes(1);

      const appLoadEnd = jest.fn();
      xhr.addEventListener('loadend', appLoadEnd);
      expect(() => xhr.finish(200, 'ok')).not.toThrow();

      expect(appLoadEnd).toHaveBeenCalledTimes(1);
      expect(onlyEntry()).toMatchObject({ status: 200, responseBody: 'ok' });
    } finally {
      unsubscribe();
    }
  });

  /* `file://` trả status 0 dù thành công (whatwg-fetch còn có nhánh riêng cho ca này). Có sự kiện
     `load` thì đó không phải lỗi mạng. */
  it('`load` với status 0 (file cục bộ) không bị gọi là lỗi mạng', () => {
    stop = tapNetwork();
    const xhr = newFake();
    xhr.open('GET', 'file:///data/config.json');
    xhr.send();
    xhr.finishWith('load', 0, '{"a":1}');

    expect(onlyEntry()).toMatchObject({ status: 0, responseBody: '{"a":1}' });
    expect(onlyEntry().error).toBeUndefined();
  });

  /* Quyết định bỏ qua chốt ở `open`: `send` có thể chạy sau khi `runUncaptured` đã xong (bất đồng bộ)
     mà XHR vẫn là của tool. */
  it('`runUncaptured`: XHR mở trong phạm vi bị bỏ qua dù `send` chạy sau đó, request vẫn đi', () => {
    const { open, send, setRequestHeader } = proto;
    stop = tapNetwork();
    const xhr = newFake();
    runUncaptured(() => xhr.open('POST', 'https://api.atlassian.test/issue'));
    xhr.setRequestHeader('Authorization', 'Basic c2VjcmV0');
    xhr.send('{"a":1}');
    xhr.finish(200, 'ok');

    expect(logBuffer.snapshot()).toHaveLength(0);
    expect(open).toHaveBeenCalledWith('POST', 'https://api.atlassian.test/issue');
    expect(setRequestHeader).toHaveBeenCalledWith('Authorization', 'Basic c2VjcmV0');
    expect(send).toHaveBeenCalledWith('{"a":1}');
  });

  it('`runUncaptured`: XHR bị bỏ qua mà `open` lại ngoài phạm vi thì được ghi trở lại', () => {
    stop = tapNetwork();
    const xhr = newFake();
    runUncaptured(() => xhr.open('GET', 'https://tool.test/x'));
    xhr.open('GET', 'https://app.test/y');
    xhr.send();

    expect(onlyEntry()).toMatchObject({ url: 'https://app.test/y' });
  });

  /* Lớp phòng thủ thứ hai (R16): app bọc `fetch` rồi `await` trước khi mở XHR ⇒ `open` rơi ra ngoài
     `runUncaptured`. Header đánh dấu đặt trước `send` thì XHR không bao giờ được ghi. */
  it('header `X-Shake-Devtools` (mọi cách viết hoa) đặt trước `send` ⇒ không dòng nào, token không lọt buffer', () => {
    const { send, setRequestHeader } = proto;
    stop = tapNetwork();
    ['X-Shake-Devtools', 'x-shake-devtools', 'X-SHAKE-DEVTOOLS'].forEach((name, i) => {
      const xhr = newFake();
      xhr.open('POST', `https://api.atlassian.test/issue/${i}`);
      xhr.setRequestHeader('Authorization', 'Basic c2VjcmV0LXRva2Vu');
      xhr.setRequestHeader(name, 'internal');
      xhr.setRequestHeader('Content-Type', 'application/json'); // đặt sau dấu hiệu vẫn không ghi
      xhr.send('{"token":"c2VjcmV0LXRva2Vu"}');
      xhr.finish(200, 'ok');
    });

    expect(logBuffer.snapshot()).toHaveLength(0);
    expect(JSON.stringify(logBuffer.snapshot())).not.toContain('c2VjcmV0');
    // Request vẫn đi, header vẫn tới hàm gốc (kể cả header đánh dấu).
    expect(send).toHaveBeenCalledTimes(3);
    expect(setRequestHeader).toHaveBeenCalledWith('X-Shake-Devtools', 'internal');
  });

  it('request của app với header khác vẫn được ghi', () => {
    stop = tapNetwork();
    const xhr = newFake();
    xhr.open('GET', 'https://app.test/user');
    xhr.setRequestHeader('X-Shake-Other', 'internal');
    xhr.send();

    expect(onlyEntry()).toMatchObject({
      url: 'https://app.test/user',
      requestHeaders: { 'X-Shake-Other': 'internal' },
    });
  });

  it('`runUncaptured`: trả giá trị của `fn`; lồng nhau và `fn` ném đều khôi phục trạng thái cũ', () => {
    stop = tapNetwork();
    const send = (url: string) => {
      const xhr = newFake();
      xhr.open('GET', url);
      xhr.send();
    };

    const value = runUncaptured(() => {
      runUncaptured(() => send('https://tool.test/inner'));
      send('https://tool.test/outer-after-inner'); // phạm vi ngoài vẫn đang chạy
      return 42;
    });
    expect(value).toBe(42);
    expect(logBuffer.snapshot()).toHaveLength(0);

    expect(() =>
      runUncaptured(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    send('https://app.test/after-throw');
    expect(onlyEntry()).toMatchObject({ url: 'https://app.test/after-throw' });
  });
});

/* ------------------------------------------------------------------------------------------------ */

const native = jest.requireMock<RnNetworkingMockModule>(
  'react-native/Libraries/Network/RCTNetworking',
).default;

type RnXhr = XMLHttpRequest & { responseURL?: string; timeout: number };

const RNXMLHttpRequest = jest.requireActual<{ default: new () => RnXhr }>(
  'react-native/Libraries/Network/XMLHttpRequest',
).default;
const RNFormData = jest.requireActual<{
  default: new () => { append: (name: string, value: unknown) => void };
}>('react-native/Libraries/Network/FormData').default;
const RNBlob = jest.requireActual<{ default: new (parts?: unknown[]) => Blob }>(
  'react-native/Libraries/Blob/Blob',
).default;

/** XHR thật của RN, đã `open`. */
const openRn = (method = 'GET', url = 'https://api.test/user'): RnXhr => {
  const xhr = new RNXMLHttpRequest();
  xhr.open(method, url);
  return xhr;
};

/** `requestId` mà native giả cấp cho lần `send` gần nhất. */
const lastId = () => native.last().requestId;

/** Nội dung của từng Blob "native", theo `blobId` — thứ `FileReader` giả đọc ra. */
const blobContents = new Map<string, string>();
/** Mọi Blob đã đưa vào `FileReader.readAsText` (của tap lẫn của app), cũ → mới. */
const blobReads: unknown[] = [];
let blobSeq = 0;

/**
 * `FileReader` giả: đọc **bất đồng bộ** (microtask) như bản native; Blob không có nội dung đăng ký ⇒
 * `onerror`. Đủ cho cả `readBlobText` của tap lẫn `res.text()` của whatwg-fetch.
 */
class FakeFileReader {
  result: unknown = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsText(blob: { data?: { blobId?: string } }): void {
    blobReads.push(blob);
    const text = blobContents.get(blob.data?.blobId ?? '');
    queueMicrotask(() => {
      if (text === undefined) {
        this.onerror?.();
        return;
      }
      this.result = text;
      this.onload?.();
    });
  }
}

/**
 * Dữ liệu native gửi cho XHR có `responseType: 'blob'` (tham chiếu Blob, không phải chữ), và đăng
 * ký nội dung để `FileReader` giả đọc được. `size` là số **byte** UTF-8, như native báo.
 */
const nativeBlob = (text: string, type = 'application/json', size?: number) => {
  blobSeq += 1;
  const blobId = `blob-${blobSeq}`;
  blobContents.set(blobId, text);
  return { blobId, offset: 0, size: size ?? new TextEncoder().encode(text).length, type };
};

/** Chờ các microtask/macrotask đang xếp hàng (đọc Blob, `setTimeout(0)` của whatwg-fetch). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Global như trên máy RN: XHR, FormData, Blob, FileReader đều của RN (FileReader thì giả native). */
const deviceGlobals = () =>
  swapGlobals({
    XMLHttpRequest: RNXMLHttpRequest,
    FormData: RNFormData,
    Blob: RNBlob,
    FileReader: FakeFileReader,
  });

describe('tapNetwork trên `XMLHttpRequest` thật của RN 0.86', () => {
  let restoreGlobals: () => void;
  let stop: (() => void) | undefined;
  let now: jest.SpyInstance;

  beforeEach(() => {
    restoreGlobals = deviceGlobals();
    blobReads.length = 0;
    native.reset();
    now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    logBuffer.clear();
    fullBodies.clear();
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    restoreGlobals();
    jest.restoreAllMocks();
  });

  it.each([204, 304])('%i không thân ⇒ chốt đúng status, không thân', (status) => {
    stop = tapNetwork();
    const xhr = openRn();
    xhr.send();
    now.mockReturnValue(1300);
    native.respond(lastId(), status);

    expect(xhr.readyState).toBe(4);
    expect(onlyEntry()).toMatchObject({ status, durationMs: 300, responseTruncated: false });
    expect(onlyEntry().responseBody).toBeUndefined();
    expect(onlyEntry().error).toBeUndefined();
  });

  it('thân FormData của RN: hàm gốc nhận nguyên object, dòng ghi `formData` thay cho thân và vẫn chốt', () => {
    stop = tapNetwork();
    const form = new RNFormData();
    form.append('name', 'An');
    form.append('avatar', { uri: 'file:///a.jpg', name: 'a.jpg', type: 'image/jpeg' });
    const xhr = openRn('POST', 'https://api.test/upload');
    xhr.send(form);

    expect(native.last().data).toBe(form);
    expect(onlyEntry().requestBody).toBeUndefined();
    expect(onlyEntry().requestTruncated).toBe(false);
    expect(onlyEntry().requestBodySkipped).toBe('formData');

    native.respond(lastId(), 201, '{"id":7}');
    expect(onlyEntry()).toMatchObject({ status: 201, responseBody: '{"id":7}' });
  });

  /* Rozenite #170: tool đọc FormData rồi crash vì `entries()` trả iterator chứ không phải mảng. */
  it('FormData kiểu spec (`entries()` trả iterator): tap không đọc vào', () => {
    stop = tapNetwork();
    const reads: PropertyKey[] = [];
    const form = new Proxy(
      { entries: () => new Map([['a', '1']]).entries() },
      {
        get: (target, key, receiver) => {
          reads.push(key);
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const xhr = openRn('POST', 'https://api.test/upload');
    xhr.send(form);
    native.respond(lastId(), 200, 'ok');

    expect(reads).toEqual([]);
    expect(native.last().data).toBe(form);
    expect(onlyEntry()).toMatchObject({ status: 200, responseBody: 'ok' });
    expect(onlyEntry().requestBody).toBeUndefined();
    expect(onlyEntry().requestBodySkipped).toBe('unreadable');
  });

  it.each([
    ['ArrayBuffer', () => new ArrayBuffer(8)],
    ['Uint8Array', () => new Uint8Array([1, 2, 3])],
    ['Blob', () => new RNBlob(['abc'])],
  ])('thân %s: hàm gốc nhận nguyên object, dòng ghi `binary` thay cho thân và vẫn chốt', (_name, make) => {
    stop = tapNetwork();
    const body = make();
    const xhr = openRn('PUT', 'https://api.test/file');
    xhr.send(body);

    expect(native.last().data).toBe(body);
    expect(onlyEntry().requestBody).toBeUndefined();
    expect(onlyEntry().requestBodySkipped).toBe('binary');

    native.respond(lastId(), 200);
    expect(onlyEntry()).toMatchObject({ status: 200 });
    expectSettled(onlyEntry());
  });

  it('`abort()` ⇒ dòng chốt `abort` (không phải `network`), native muộn không đổi được', () => {
    stop = tapNetwork();
    const xhr = openRn();
    const onabort = jest.fn();
    xhr.onabort = onabort;
    xhr.send();
    const id = lastId();

    now.mockReturnValue(1050);
    xhr.abort();

    expect(onabort).toHaveBeenCalledTimes(1);
    expect(native.abortRequest).toHaveBeenCalledWith(id);
    expect(onlyEntry()).toMatchObject({ error: 'abort', durationMs: 50 });
    expect(onlyEntry().status).toBeUndefined();

    native.respond(id, 200, 'muộn');
    expect(onlyEntry().status).toBeUndefined();
  });

  it('`abort()` trước `send` rồi `send` ⇒ RN ném, không có dòng ma "đang bay"', () => {
    stop = tapNetwork();
    const xhr = openRn();
    xhr.abort();

    expect(() => xhr.send()).toThrow('Request has not been opened');
    expect(logBuffer.snapshot()).toHaveLength(0);
  });

  it('timeout trước khi có header ⇒ `timeout`, `ontimeout` của app vẫn chạy', () => {
    stop = tapNetwork();
    const xhr = openRn();
    xhr.timeout = 5000;
    const ontimeout = jest.fn();
    xhr.ontimeout = ontimeout;
    xhr.send();

    expect(native.last().timeout).toBe(5000);

    now.mockReturnValue(6000);
    native.complete(lastId(), 'The request timed out.', true);

    expect(ontimeout).toHaveBeenCalledTimes(1);
    expect(onlyEntry()).toMatchObject({ error: 'timeout', durationMs: 5000 });
    expect(onlyEntry().status).toBeUndefined();
    expect(onlyEntry().responseBody).toBeUndefined();
  });

  /* RN giữ `status` 200 đã nhận và đặt `_response` = câu báo lỗi của native. Đoán theo status thì
     dòng này hiện "200" với thân "The request timed out." — tool nói dối. */
  it('timeout giữa lúc tải thân ⇒ `timeout`, KHÔNG hiện 200 kèm câu báo lỗi làm thân', () => {
    stop = tapNetwork();
    const xhr = openRn();
    xhr.timeout = 5000;
    xhr.send();
    const id = lastId();
    native.receiveHeaders(id, 200);
    native.receiveData(id, '{"items":[1,');
    native.complete(id, 'The request timed out.', true);

    expect(xhr.status).toBe(200);
    expect(onlyEntry()).toMatchObject({ error: 'timeout', responseTruncated: false });
    expect(onlyEntry().status).toBeUndefined();
    expect(onlyEntry().responseBody).toBeUndefined();
  });

  it('lỗi mạng ⇒ `network`, `onerror` của app vẫn chạy', () => {
    stop = tapNetwork();
    const xhr = openRn();
    const onerror = jest.fn();
    xhr.onerror = onerror;
    xhr.send();
    now.mockReturnValue(1400);
    native.complete(lastId(), 'The Internet connection appears to be offline.');

    expect(onerror).toHaveBeenCalledTimes(1);
    expect(onlyEntry()).toMatchObject({ error: 'network', durationMs: 400 });
    expect(onlyEntry().status).toBeUndefined();
    expect(onlyEntry().responseBody).toBeUndefined();
  });

  it('mạng rớt giữa lúc tải thân ⇒ `network`, không status, không thân', () => {
    stop = tapNetwork();
    const xhr = openRn();
    xhr.send();
    const id = lastId();
    native.receiveHeaders(id, 200);
    native.receiveData(id, '{"items":[1,');
    native.complete(id, 'The network connection was lost.');

    expect(onlyEntry()).toMatchObject({ error: 'network' });
    expect(onlyEntry().status).toBeUndefined();
    expect(onlyEntry().responseBody).toBeUndefined();
  });

  /* Dòng giữ URL app đã gọi (cũng là URL `toCurl` cần — curl -L tự theo redirect). */
  it('redirect (`responseURL` khác URL gốc) ⇒ dòng giữ URL gốc, status của đích', () => {
    stop = tapNetwork();
    const xhr = openRn('GET', 'https://api.test/old');
    xhr.send();
    native.respond(lastId(), 200, 'ok', { responseURL: 'https://cdn.test/new' });

    expect(xhr.responseURL).toBe('https://cdn.test/new');
    expect(onlyEntry()).toMatchObject({
      url: 'https://api.test/old',
      status: 200,
      responseBody: 'ok',
    });
  });

  /*
    `responseText` ném với ba kiểu này ⇒ tap đọc qua `xhr.response`. Chữ thì ghi; nhị phân / quá
    lớn / đọc hỏng thì ghi LÝ DO (`responseBodySkipped`) — màn không bao giờ nói "Không có thân" sai.
    Mọi ca: status + thời lượng vào NGAY lúc `loadend`, không đợi đọc thân.
  */
  interface BodyCase {
    responseType: 'json' | 'blob' | 'arraybuffer';
    status?: number;
    contentType?: string;
    data?: () => unknown;
    body?: string;
    skipped?: BodySkip;
    /** Tap có mở `FileReader` không — Blob nhị phân / quá lớn thì KHÔNG được đọc. */
    readsBlob?: boolean;
  }
  const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

  it.each<[string, BodyCase]>([
    [
      'blob + application/json ⇒ đọc bằng FileReader',
      {
        responseType: 'blob',
        contentType: 'application/json; charset=utf-8',
        data: () => nativeBlob('{"id":7,"ten":"Ân"}'),
        body: '{"id":7,"ten":"Ân"}',
        readsBlob: true,
      },
    ],
    [
      'blob + text/plain ⇒ đọc',
      {
        responseType: 'blob',
        contentType: 'text/plain',
        data: () => nativeBlob('xin chào', 'text/plain'),
        body: 'xin chào',
        readsBlob: true,
      },
    ],
    [
      'blob + application/graphql-response+json ⇒ đọc',
      {
        responseType: 'blob',
        contentType: 'application/graphql-response+json',
        data: () => nativeBlob('{"data":{}}'),
        body: '{"data":{}}',
        readsBlob: true,
      },
    ],
    [
      'blob + image/png ⇒ `binary`, không đọc',
      {
        responseType: 'blob',
        contentType: 'image/png',
        data: () => nativeBlob('\u0089PNG', 'image/png'),
        skipped: 'binary',
      },
    ],
    [
      'blob không có content-type ⇒ `binary`, không đọc',
      { responseType: 'blob', data: () => nativeBlob('???', ''), skipped: 'binary' },
    ],
    [
      'blob JSON trên trần đọc ⇒ `tooLarge`, không đọc',
      {
        responseType: 'blob',
        contentType: 'application/json',
        data: () => nativeBlob('{}', 'application/json', MAX_BODY_READ_BYTES + 1),
        skipped: 'tooLarge',
      },
    ],
    [
      'blob JSON mà FileReader lỗi ⇒ `unreadable`',
      {
        responseType: 'blob',
        contentType: 'application/json',
        data: () => ({ blobId: 'không-có', offset: 0, size: 10, type: 'application/json' }),
        skipped: 'unreadable',
        readsBlob: true,
      },
    ],
    [
      'blob 0 byte (204) ⇒ không có thân — KHÔNG phải "không bắt được"',
      { responseType: 'blob', status: 204, contentType: 'application/json' },
    ],
    [
      'json + application/json ⇒ JSON.stringify',
      {
        responseType: 'json',
        contentType: 'application/json',
        data: () => '{ "a": 1, "b": [true] }',
        body: '{"a":1,"b":[true]}',
      },
    ],
    [
      'json parse hỏng ⇒ `unreadable`',
      {
        responseType: 'json',
        contentType: 'application/json',
        data: () => '<html>502</html>',
        skipped: 'unreadable',
      },
    ],
    [
      'arraybuffer + application/json ⇒ giải mã UTF-8',
      {
        responseType: 'arraybuffer',
        contentType: 'application/json',
        data: () => base64('{"ok":"có"}'),
        body: '{"ok":"có"}',
      },
    ],
    [
      'arraybuffer + application/octet-stream ⇒ `binary`',
      {
        responseType: 'arraybuffer',
        contentType: 'application/octet-stream',
        data: () => 'AQID',
        skipped: 'binary',
      },
    ],
  ])('`responseType` %s', async (_name, c) => {
    stop = tapNetwork();
    const xhr = openRn();
    xhr.responseType = c.responseType;
    xhr.send();
    native.respond(lastId(), c.status ?? 200, c.data?.(), {
      headers: c.contentType ? { 'Content-Type': c.contentType } : {},
    });

    expect(onlyEntry()).toMatchObject({ status: c.status ?? 200, durationMs: 0 });

    await flush();

    const entry = onlyEntry();
    expect(entry.responseBody).toBe(c.body);
    expect(entry.responseBodySkipped).toBe(c.skipped);
    expect(entry.error).toBeUndefined();
    expect(blobReads).toHaveLength(c.readsBlob ? 1 : 0);
  });

  it('thân Blob lớn ⇒ cắt ở buffer kèm cờ, bản đầy đủ ở `fullBodies`', async () => {
    stop = tapNetwork();
    const big = JSON.stringify({ items: 'x'.repeat(10_000) });
    const xhr = openRn();
    xhr.responseType = 'blob';
    xhr.send();
    native.respond(lastId(), 200, nativeBlob(big), { headers: { 'Content-Type': 'application/json' } });
    await flush();

    const entry = onlyEntry();
    expect(entry).toMatchObject({
      responseBody: `${big.slice(0, DEFAULT_BODY_LIMIT)}…+${big.length - DEFAULT_BODY_LIMIT}`,
      responseTruncated: true,
    });
    expect(fullBodies.get(entry.id, 'response')).toEqual({ text: big, truncated: false });
  });

  it('thân Blob vượt cả trần kho đầy đủ (dưới trần đọc) ⇒ kho cắt ở `FULL_BODY_LIMIT`, có cờ', async () => {
    stop = tapNetwork();
    const huge = 'y'.repeat(FULL_BODY_LIMIT + 500);
    const xhr = openRn();
    xhr.responseType = 'blob';
    xhr.send();
    native.respond(lastId(), 500, nativeBlob(huge, 'text/plain'), {
      headers: { 'Content-Type': 'text/plain' },
    });
    await flush();

    const entry = onlyEntry();
    expect(entry).toMatchObject({ status: 500, responseTruncated: true });
    expect(fullBodies.get(entry.id, 'response')).toEqual({
      text: `${'y'.repeat(FULL_BODY_LIMIT)}…+500`,
      truncated: true,
    });
  });

  it('thân response lớn bị cắt ở buffer, bản đầy đủ nằm ở `fullBodies`', () => {
    stop = tapNetwork(10);
    const xhr = openRn();
    xhr.send();
    native.respond(lastId(), 200, 'y'.repeat(25));

    const entry = onlyEntry();
    expect(entry).toMatchObject({ responseBody: `${'y'.repeat(10)}…+15`, responseTruncated: true });
    expect(fullBodies.get(entry.id, 'response')).toEqual({ text: 'y'.repeat(25), truncated: false });
  });

  /* RN hạ chữ thường làm khoá: lần sau THAY lần trước. Hai khoá trong dòng = hai header trong curl,
     trong khi request thật chỉ mang một. */
  it('header khác hoa thường ⇒ lần sau thay lần trước, như RN gửi', () => {
    stop = tapNetwork();
    const xhr = openRn('POST');
    xhr.setRequestHeader('content-type', 'text/plain');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send('{}');

    expect(native.last().headers).toEqual({ 'content-type': 'application/json' });
    expect(onlyEntry().requestHeaders).toEqual({ 'Content-Type': 'application/json' });
  });

  /* RN vẫn nhận `setRequestHeader` sau `send` (readyState còn OPENED) nhưng native đã cầm bản sao. */
  it('header đặt sau `send` không vào dòng (native cũng không nhận)', () => {
    stop = tapNetwork();
    const xhr = openRn();
    xhr.setRequestHeader('X-Trace', '1');
    xhr.send();
    xhr.setRequestHeader('X-Late', '2');

    expect(native.last().headers).toEqual({ 'x-trace': '1' });
    expect(onlyEntry().requestHeaders).toEqual({ 'X-Trace': '1' });
  });

  it('nhiều request đồng thời, xong ngược thứ tự ⇒ mỗi dòng đúng kết cục của nó', () => {
    stop = tapNetwork();
    openRn('GET', 'https://api.test/a').send();
    const idA = lastId();
    openRn('POST', 'https://api.test/b').send('{}');
    const idB = lastId();
    openRn('GET', 'https://api.test/c').send();
    const idC = lastId();

    now.mockReturnValue(1100);
    native.respond(idC, 500, 'oops');
    now.mockReturnValue(1200);
    native.complete(idB, 'The network connection was lost.');
    now.mockReturnValue(1300);
    native.respond(idA, 200, 'A');

    const byUrl = Object.fromEntries(networkEntries().map((e) => [e.url, e]));
    expect(networkEntries()).toHaveLength(3);
    expect(byUrl['https://api.test/a']).toMatchObject({ status: 200, durationMs: 300, responseBody: 'A' });
    expect(byUrl['https://api.test/b']).toMatchObject({ error: 'network', durationMs: 200 });
    expect(byUrl['https://api.test/c']).toMatchObject({ status: 500, durationMs: 100, responseBody: 'oops' });
    networkEntries().forEach(expectSettled);
  });

  /* Giới hạn đã biết (Rozenite #82): thứ đi trước khi vá thì không thấy — lý do `startCapture` phải
     gọi ở module scope. Điều test khoá: không có dòng ma, request của app không bị ảnh hưởng. */
  it('request gửi trước `startCapture` ⇒ không có dòng, không ảnh hưởng app; gửi sau thì có', () => {
    const early = openRn('GET', 'https://api.test/boot');
    const onload = jest.fn();
    early.onload = onload;
    early.send();
    const idEarly = lastId();

    stop = startCapture({ enabled: true, console: false, uncaught: false });
    openRn('GET', 'https://api.test/after').send();
    const idLate = lastId();

    native.respond(idEarly, 200, 'boot');
    native.respond(idLate, 200, 'after');

    expect(onload).toHaveBeenCalledTimes(1);
    expect(onlyEntry()).toMatchObject({ url: 'https://api.test/after', status: 200 });
  });

  it('`open` trước, `send` sau `startCapture` ⇒ không có dòng (tap không biết method/URL), không ném', () => {
    const xhr = openRn('GET', 'https://api.test/half');
    stop = startCapture({ enabled: true, console: false, uncaught: false });
    expect(() => xhr.send()).not.toThrow();
    native.respond(lastId(), 200, 'ok');

    expect(xhr.responseText).toBe('ok');
    expect(logBuffer.snapshot()).toHaveLength(0);
  });

  /* RN ném ở lần `open` thứ hai; request thật đi URL thứ nhất. Ghi trước khi gọi hàm gốc thì dòng
     mang URL thứ hai. */
  it('`open` hai lần (RN ném lần hai) ⇒ dòng mang method/URL của lần `open` có hiệu lực', () => {
    stop = tapNetwork();
    const xhr = openRn('GET', 'https://api.test/first');

    expect(() => xhr.open('POST', 'https://api.test/second')).toThrow('Cannot open, already sending');

    xhr.send();
    expect(native.last()).toMatchObject({ method: 'GET', url: 'https://api.test/first' });
    expect(onlyEntry()).toMatchObject({ method: 'GET', url: 'https://api.test/first' });
  });

  /* `abort` đưa xhr của RN về UNSENT nên `open` lại được. Listener của lần `send` đầu mà còn móc thì
     kết quả của request thứ hai đè lên dòng thứ nhất. */
  it('`abort` rồi `open` lại trên cùng xhr ⇒ hai dòng, mỗi dòng đúng kết cục của nó', () => {
    stop = tapNetwork();
    const xhr = openRn('GET', 'https://api.test/a');
    xhr.send();
    xhr.abort();
    xhr.open('GET', 'https://api.test/b');
    xhr.send();
    native.respond(lastId(), 200, 'B');

    const [first, second] = networkEntries();
    expect(networkEntries()).toHaveLength(2);
    expect(first).toMatchObject({ url: 'https://api.test/a', error: 'abort' });
    expect(first.status).toBeUndefined();
    expect(first.responseBody).toBeUndefined();
    expect(second).toMatchObject({ url: 'https://api.test/b', status: 200, responseBody: 'B' });
  });

  it('`send` khi chưa `open` ⇒ lỗi của RN tới app nguyên vẹn, không có dòng', () => {
    stop = tapNetwork();
    const xhr = new RNXMLHttpRequest();

    expect(() => xhr.send()).toThrow('Request has not been opened');
    expect(logBuffer.snapshot()).toHaveLength(0);
  });

  it('`send` hai lần ⇒ RN ném lần hai, chỉ một dòng và dòng đó chốt', () => {
    stop = tapNetwork();
    const xhr = openRn();
    xhr.send();

    expect(() => xhr.send()).toThrow('Request has already been sent');

    native.respond(lastId(), 200, 'ok');
    expect(onlyEntry()).toMatchObject({ status: 200, responseBody: 'ok' });
  });

  it('listener của app (`addEventListener` lẫn `on*`) vẫn chạy, thấy đúng dữ liệu', () => {
    stop = tapNetwork();
    const xhr = openRn();
    const states: number[] = [];
    xhr.onreadystatechange = () => states.push(xhr.readyState);
    const onload = jest.fn(() => xhr.responseText);
    xhr.onload = onload;
    const onLoadListener = jest.fn();
    const onLoadEndListener = jest.fn();
    xhr.addEventListener('load', onLoadListener);
    xhr.addEventListener('loadend', onLoadEndListener);
    xhr.send();
    native.respond(lastId(), 200, '{"ok":true}');

    expect(states).toEqual([2, 3, 4]);
    expect(onload).toHaveBeenCalledTimes(1);
    expect(onload).toHaveReturnedWith('{"ok":true}');
    expect(onLoadListener).toHaveBeenCalledTimes(1);
    expect(onLoadEndListener).toHaveBeenCalledTimes(1);
    expect(onlyEntry()).toMatchObject({ status: 200, responseBody: '{"ok":true}' });
  });

  /* `addEventListener('readystatechange' | 'progress')` của RN bật cờ gửi dữ liệu theo mẩu — mỗi mẩu
     một sự kiện qua cầu. Tap không được tự bật nó. */
  it('tap không bật `incrementalEvents` của RN', () => {
    stop = tapNetwork();
    openRn().send();

    expect(native.last().incremental).toBe(false);
  });

  /* `EventTarget` của RN bắt lỗi của listener và in `console.error`, rồi phát tiếp. */
  it('callback của app ném ⇒ dòng vẫn chốt, listener sau của app vẫn chạy', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    stop = tapNetwork();
    const xhr = openRn();
    xhr.onreadystatechange = () => {
      throw new Error('onreadystatechange của app');
    };
    xhr.onload = () => {
      throw new Error('onload của app');
    };
    const after = jest.fn();
    xhr.addEventListener('loadend', after);
    xhr.send();
    native.respond(lastId(), 200, 'ok');

    expect(onlyEntry()).toMatchObject({ status: 200, responseBody: 'ok' });
    expect(after).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
  });

  it('`stop()` khi request đang bay ⇒ dòng vẫn chốt khi xong', () => {
    stop = tapNetwork();
    openRn().send();
    stop();
    stop = undefined;

    native.respond(lastId(), 200, 'ok');

    expect(onlyEntry()).toMatchObject({ status: 200, responseBody: 'ok' });
  });

  /* `send` của RN đặt `_sent` rồi mới gọi native; native ném đồng bộ thì không có `loadend` nào. */
  it('hàm gốc ném (native từ chối) ⇒ lỗi tới app, dòng chốt kèm lý do thay vì treo', () => {
    stop = tapNetwork();
    native.failNextSend(new Error('Unsupported request body'));
    const xhr = openRn('POST');

    expect(() => xhr.send('{}')).toThrow('Unsupported request body');
    expect(onlyEntry()).toMatchObject({ error: 'Unsupported request body', durationMs: 0 });
    expect(onlyEntry().status).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------------------------------ */

interface FetchResponse {
  status: number;
  text: () => Promise<string>;
}
type Fetch = (
  input: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal },
) => Promise<FetchResponse>;

/**
 * `fetch` của RN = `whatwg-fetch` dựng trên `XMLHttpRequest`. Nạp riêng (`isolateModules`) với các
 * global như trên máy (`deviceGlobals`) vì `whatwg-fetch` dò chúng lúc nạp: có `FileReader` + `Blob`
 * ⇒ nó đặt `responseType = 'blob'` cho MỌI request, đúng như trên máy.
 * (Node có `fetch` riêng nên polyfill không tự cài global — lấy hàm từ export.)
 */
describe('tapNetwork qua `fetch` (whatwg-fetch trên XHR thật của RN)', () => {
  let restoreGlobals: () => void;
  let stop: (() => void) | undefined;
  let fetchRn: Fetch;

  beforeEach(() => {
    restoreGlobals = deviceGlobals();
    blobReads.length = 0;
    jest.isolateModules(() => {
      fetchRn = jest.requireActual<{ fetch: Fetch }>('whatwg-fetch').fetch;
    });
    native.reset();
    logBuffer.clear();
    fullBodies.clear();
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    restoreGlobals();
    jest.restoreAllMocks();
  });

  it('POST FormData ⇒ hàm gốc nhận nguyên FormData, dòng chốt đúng status', async () => {
    stop = tapNetwork();
    const form = new RNFormData();
    form.append('file', { uri: 'file:///a.jpg', name: 'a.jpg', type: 'image/jpeg' });
    const pending = fetchRn('https://api.test/upload', { method: 'POST', body: form });

    expect(native.last().data).toBe(form);
    native.respond(lastId(), 201, { blobId: 'r1', offset: 0, size: 0, type: '' });

    await expect(pending).resolves.toMatchObject({ status: 201 });
    expect(onlyEntry()).toMatchObject({ method: 'POST', status: 201, requestBodySkipped: 'formData' });
    expect(onlyEntry().requestBody).toBeUndefined();
    // Response 0 byte: thật sự không có thân, không phải "không bắt được".
    expect(onlyEntry().responseBodySkipped).toBeUndefined();
  });

  it('huỷ bằng `AbortController` ⇒ dòng chốt `abort`, promise của app nhận AbortError', async () => {
    stop = tapNetwork();
    const controller = new AbortController();
    const pending = fetchRn('https://api.test/slow', { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(onlyEntry()).toMatchObject({ error: 'abort' });
    expect(onlyEntry().status).toBeUndefined();
  });

  /* Trên máy `fetch` xin `responseType: 'blob'` ⇒ tap đọc Blob bằng FileReader RIÊNG; app đọc
     `res.text()` bằng FileReader của nó — hai lần đọc cùng Blob, không lần nào tiêu thụ lần kia. */
  it('thân JSON của `fetch` (Blob) được ghi, và `res.text()` của app vẫn ra đủ', async () => {
    stop = tapNetwork();
    const json = '{"user":{"id":7,"name":"Ân"}}';
    const pending = fetchRn('https://api.test/user');

    expect(native.last().responseType).toBe('blob');
    native.respond(lastId(), 200, nativeBlob(json), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });

    const res = await pending;
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe(json);
    await flush();

    expect(onlyEntry()).toMatchObject({ status: 200, responseBody: json, responseTruncated: false });
    expect(onlyEntry().responseBodySkipped).toBeUndefined();
    expect(blobReads).toHaveLength(2);
  });

  it('ảnh tải bằng `fetch` ⇒ ghi `binary`, tap không đọc Blob', async () => {
    stop = tapNetwork();
    const pending = fetchRn('https://cdn.test/a.png');
    native.respond(lastId(), 200, nativeBlob('\u0089PNG', 'image/png', 20_000), {
      headers: { 'Content-Type': 'image/png' },
    });

    await expect(pending).resolves.toMatchObject({ status: 200 });
    await flush();

    expect(onlyEntry().responseBodySkipped).toBe('binary');
    expect(onlyEntry().responseBody).toBeUndefined();
    expect(blobReads).toHaveLength(0);
  });

  it('lỗi mạng ⇒ dòng chốt `network`, promise của app nhận TypeError', async () => {
    stop = tapNetwork();
    const pending = fetchRn('https://api.test/user');
    native.complete(lastId(), 'The Internet connection appears to be offline.');

    await expect(pending).rejects.toThrow('Network request failed');
    expect(onlyEntry()).toMatchObject({ error: 'network' });
    expect(onlyEntry().status).toBeUndefined();
  });

  it('`runUncaptured(() => fetch(url))` không thêm dòng nào vào nhật ký, request vẫn rời máy', async () => {
    stop = tapNetwork();
    const pending = runUncaptured(() =>
      fetchRn('https://tool.test/issue', { method: 'POST', body: '{"a":1}' }),
    );

    expect(native.last().url).toBe('https://tool.test/issue');
    native.respond(lastId(), 200, nativeBlob('{"ok":true}'), {
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await pending;
    await expect(res.text()).resolves.toBe('{"ok":true}');
    await flush();

    expect(logBuffer.snapshot()).toHaveLength(0);
    // Tap không đọc thân của request bị bỏ qua: chỉ có lần đọc `res.text()` của chính chúng ta.
    expect(blobReads).toHaveLength(1);
  });

  it('`fetch` gọi ngay sau `runUncaptured` vẫn được ghi, kể cả khi `fn` đã ném', async () => {
    stop = tapNetwork();
    expect(() =>
      runUncaptured(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');

    const pending = fetchRn('https://app.test/user');
    native.respond(lastId(), 200, nativeBlob('{}'), {
      headers: { 'Content-Type': 'application/json' },
    });
    await pending;
    await flush();

    expect(onlyEntry()).toMatchObject({ url: 'https://app.test/user', status: 200 });
  });
});
