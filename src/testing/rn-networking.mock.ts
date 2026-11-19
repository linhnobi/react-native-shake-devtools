/**
 * Mock `react-native/Libraries/Network/RCTNetworking` cho jest — hạ tầng test, **không** export từ
 * entry nào của lib.
 *
 * Vì sao giả ở tầng NÀY: `XMLHttpRequest` của RN (và `fetch` whatwg dựng trên nó) là JS thuần, chỉ
 * nói chuyện với native qua `RCTNetworking`. Giả đúng chỗ đó thì test chạy trên **chính** lớp XHR
 * của RN — thứ tự `readystatechange` → `load|error|timeout|abort` → `loadend`, getter
 * `responseText` ném với `responseType` khác text, `open`/`send` ném khi sai trạng thái — thay vì
 * trên một bản XHR tự viết chỉ giống những gì mình nghĩ RN làm.
 *
 * Dùng:
 * ```ts
 * jest.mock('react-native/Libraries/Network/RCTNetworking', () =>
 *   require('../testing/rn-networking.mock').createRnNetworkingMock(),
 * );
 * const native = jest.requireMock<RnNetworkingMockModule>('react-native/Libraries/Network/RCTNetworking').default;
 * native.respond(native.last().requestId, 200, '{"ok":true}');
 * ```
 */

/** Một lời gọi `sendRequest` mà native giả đã nhận. */
export interface SentRequest {
  readonly requestId: number;
  readonly method: string;
  readonly url: string;
  /** Header đúng như XHR của RN chuyển xuống native — tên đã hạ chữ thường. */
  readonly headers: Readonly<Record<string, string>>;
  /** Thân **nguyên object** XHR nhận (`send(data)`), chưa qua `convertRequestBody`. */
  readonly data: unknown;
  /** `'text' | 'base64' | 'blob'` — XHR của RN đổi từ `responseType`. */
  readonly responseType: string;
  /** XHR có `onreadystatechange`/`onprogress` ⇒ native gửi dữ liệu theo mẩu. */
  readonly incremental: boolean;
  readonly timeout: number;
}

export interface RespondOptions {
  /** URL cuối sau redirect — native báo qua `didReceiveNetworkResponse`. Vắng ⇒ URL gốc. */
  responseURL?: string;
  headers?: Record<string, string>;
}

export interface RnNetworkingMock {
  addListener: (
    type: string,
    listener: (args: unknown[]) => void,
  ) => { remove: () => void };
  sendRequest: (...args: unknown[]) => void;
  abortRequest: jest.Mock;
  clearCookies: jest.Mock;
  /** Mọi request đã gửi xuống native giả, cũ → mới. */
  readonly sent: SentRequest[];
  /** Request gửi gần nhất; ném nếu chưa có. */
  last: () => SentRequest;
  /** Lần `sendRequest` kế tiếp ném lỗi này (giả native từ chối thân/tham số) rồi tự tắt. */
  failNextSend: (error: Error) => void;
  /** Native đã nhận header phản hồi: XHR sang HEADERS_RECEIVED, có `status`. */
  receiveHeaders: (requestId: number, status: number, options?: RespondOptions) => void;
  /** Native đẩy thân: theo mẩu nếu XHR xin `incremental`, nguyên khối nếu không. */
  receiveData: (requestId: number, data: unknown) => void;
  /** Native báo xong. `error` khác rỗng ⇒ hỏng; `timedOut` ⇒ hỏng vì hết giờ. */
  complete: (requestId: number, error?: string, timedOut?: boolean) => void;
  /** Gọn ba bước: header → thân (nếu có) → xong, không lỗi. */
  respond: (
    requestId: number,
    status: number,
    data?: unknown,
    options?: RespondOptions,
  ) => void;
  /** Xoá listener + lịch sử — gọi ở `beforeEach`. */
  reset: () => void;
}

export interface RnNetworkingMockModule {
  __esModule: true;
  default: RnNetworkingMock;
}

/**
 * **Chức năng:** dựng `RCTNetworking` giả có điều khiển được: ghi lại mọi `sendRequest`, cấp
 * `requestId` tăng dần (gọi callback **đồng bộ**), và cho test bắn các sự kiện native mà XHR của RN
 * nghe (`didReceiveNetworkResponse` · `didReceiveNetworkData` · `didReceiveNetworkIncrementalData` ·
 * `didCompleteNetworkResponse`).
 *
 * **Input:** không. **Output:** module ES (`{ __esModule, default }`) để trả thẳng từ factory của
 * `jest.mock`.
 *
 * @example
 * ```ts
 * native.receiveHeaders(id, 200);
 * native.complete(id, 'The request timed out.', true);   // ca biên: hết giờ SAU khi có header
 * ```
 *
 * **Unit test:** không có suite riêng — là hạ tầng của `capture/network-tap.test.ts`.
 */
export const createRnNetworkingMock = (): RnNetworkingMockModule => {
  const listeners = new Map<string, Set<(args: unknown[]) => void>>();
  const sent: SentRequest[] = [];
  let nextId = 0;
  let pendingFailure: Error | undefined;

  const emit = (type: string, args: unknown[]) =>
    [...(listeners.get(type) ?? [])].forEach((listener) => listener(args));

  const find = (requestId: number) => sent.find((r) => r.requestId === requestId);

  const mock: RnNetworkingMock = {
    addListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
      return { remove: () => void set.delete(listener) };
    },
    sendRequest: (
      method,
      _trackingName,
      url,
      headers,
      data,
      responseType,
      incremental,
      timeout,
      callback,
    ) => {
      if (pendingFailure) {
        const error = pendingFailure;
        pendingFailure = undefined;
        throw error;
      }
      nextId += 1;
      sent.push({
        requestId: nextId,
        method: String(method),
        url: String(url),
        headers: { ...(headers as Record<string, string>) },
        data,
        responseType: String(responseType),
        incremental: Boolean(incremental),
        timeout: Number(timeout),
      });
      (callback as (requestId: number) => void)(nextId);
    },
    abortRequest: jest.fn(),
    clearCookies: jest.fn(),
    sent,
    last: () => {
      const request = sent[sent.length - 1];
      if (!request) throw new Error('Native giả chưa nhận request nào.');
      return request;
    },
    failNextSend: (error) => {
      pendingFailure = error;
    },
    receiveHeaders: (requestId, status, options = {}) =>
      emit('didReceiveNetworkResponse', [
        requestId,
        status,
        options.headers ?? {},
        options.responseURL ?? find(requestId)?.url,
      ]),
    receiveData: (requestId, data) => {
      if (find(requestId)?.incremental && typeof data === 'string') {
        emit('didReceiveNetworkIncrementalData', [requestId, data, data.length, data.length]);
      } else {
        emit('didReceiveNetworkData', [requestId, data]);
      }
    },
    complete: (requestId, error = '', timedOut = false) =>
      emit('didCompleteNetworkResponse', [requestId, error, timedOut]),
    respond: (requestId, status, data, options) => {
      mock.receiveHeaders(requestId, status, options);
      if (data !== undefined && data !== '') mock.receiveData(requestId, data);
      mock.complete(requestId);
    },
    reset: () => {
      listeners.clear();
      sent.length = 0;
      pendingFailure = undefined;
      mock.abortRequest.mockClear();
    },
  };

  return { __esModule: true, default: mock };
};
