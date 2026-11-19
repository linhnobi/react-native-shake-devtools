import { tapConsole } from './console-tap';
import { tapFetch } from './fetch-tap';
import { tapGlobalErrors } from './global-error-tap';
import { DEFAULT_CAPACITY, DEFAULT_ERROR_CAPACITY, logBuffer } from './log-buffer';
import type { ConsoleEntry } from './log-entry';
import {
  flushPersistedLogs,
  startPersistence,
  type LogStore,
  type PersistenceHandle,
} from './log-persist';
import { DEFAULT_BODY_LIMIT, tapNetwork } from './network-tap';
import { tapUnhandledRejections } from './rejection-tap';
import { REDACTED, redactBody } from './redact';
import { startCapture } from './start-capture';

/*
  Sáu bản vá giả ở RANH MODULE — thứ được test là phần nối dây của `startCapture` (vá cái nào, hàm
  tắt gỡ những gì), không phải từng bản vá: mỗi bản đã có test riêng. `logBuffer` thì THẬT để kiểm
  `capacity` bằng hành vi chứ không bằng spy.
*/
jest.mock('./console-tap');
jest.mock('./network-tap');
jest.mock('./fetch-tap');
jest.mock('./global-error-tap');
jest.mock('./rejection-tap');
jest.mock('./log-persist');

type Tap = 'console' | 'network' | 'fetch' | 'uncaught' | 'rejections' | 'persist';

const con = (id: number): ConsoleEntry => ({
  id,
  kind: 'console',
  at: id,
  level: 'info',
  text: `dòng ${id}`,
});

const fakeStore = (): LogStore => ({
  list: jest.fn(),
  read: jest.fn(),
  write: jest.fn(),
  remove: jest.fn(),
});

describe('startCapture', () => {
  /** Hàm gỡ của từng bản vá giả — đếm được `startCapture` có gọi đủ không. */
  let stops: Record<Tap, jest.Mock>;

  beforeEach(() => {
    jest.clearAllMocks();
    stops = {
      console: jest.fn(),
      network: jest.fn(),
      fetch: jest.fn(),
      uncaught: jest.fn(),
      rejections: jest.fn(),
      persist: jest.fn(),
    };
    jest.mocked(tapConsole).mockReturnValue(stops.console);
    jest.mocked(tapNetwork).mockReturnValue(stops.network);
    jest.mocked(tapFetch).mockReturnValue(stops.fetch);
    jest.mocked(tapGlobalErrors).mockReturnValue(stops.uncaught);
    jest.mocked(tapUnhandledRejections).mockReturnValue(stops.rejections);
    const handle: PersistenceHandle = {
      stop: stops.persist,
      flush: jest.fn(),
      clearAll: jest.fn(),
      ready: Promise.resolve(),
    };
    jest.mocked(startPersistence).mockReturnValue(handle);
    logBuffer.clear();
  });

  afterEach(() => {
    // `logBuffer` là singleton thật — trả sức chứa mặc định để case sau không thừa hưởng.
    logBuffer.setCapacity(DEFAULT_CAPACITY);
    logBuffer.setErrorCapacity(DEFAULT_ERROR_CAPACITY);
    logBuffer.clear();
  });

  it('vá cả console lẫn network theo mặc định', () => {
    startCapture({ enabled: true });

    expect(tapConsole).toHaveBeenCalledTimes(1);
    expect(tapNetwork).toHaveBeenCalledTimes(1);
    expect(tapNetwork).toHaveBeenCalledWith(DEFAULT_BODY_LIMIT);
    // `fetch` native của Expo, cùng hạn mức thân (tap tự no-op khi `fetch` là polyfill trên XHR).
    expect(tapFetch).toHaveBeenCalledTimes(1);
    expect(tapFetch).toHaveBeenCalledWith(DEFAULT_BODY_LIMIT);
    expect(tapGlobalErrors).toHaveBeenCalledTimes(1);
    expect(tapUnhandledRejections).toHaveBeenCalledTimes(1);
    // `persist` vắng ⇒ chỉ RAM, không mở phiên ghi đĩa.
    expect(startPersistence).not.toHaveBeenCalled();
  });

  it('`console: false` chỉ vá network', () => {
    startCapture({ enabled: true, console: false });

    expect(tapConsole).not.toHaveBeenCalled();
    expect(tapNetwork).toHaveBeenCalledTimes(1);
  });

  it('`network: false` chỉ vá console', () => {
    startCapture({ enabled: true, network: false });

    expect(tapNetwork).not.toHaveBeenCalled();
    expect(tapFetch).not.toHaveBeenCalled();
    expect(tapConsole).toHaveBeenCalledTimes(1);
  });

  it('`capacity` được áp vào buffer', () => {
    startCapture({ enabled: true, capacity: 2 });

    [1, 2, 3].forEach((id) => logBuffer.push(con(id)));

    expect(logBuffer.snapshot().map((e) => e.id)).toEqual([2, 3]);
  });

  it('hàm trả về gỡ sạch mọi bản vá', () => {
    const stop = startCapture({ enabled: true });
    expect(stops.console).not.toHaveBeenCalled();

    stop();

    expect(stops.console).toHaveBeenCalledTimes(1);
    expect(stops.network).toHaveBeenCalledTimes(1);
    expect(stops.fetch).toHaveBeenCalledTimes(1);
    expect(stops.uncaught).toHaveBeenCalledTimes(1);
    expect(stops.rejections).toHaveBeenCalledTimes(1);
  });

  /* `tapGlobalErrors` là đường DUY NHẤT của `startCapture` tới `ErrorUtils`. */
  it('`uncaught: false` không đụng `ErrorUtils`', () => {
    const stop = startCapture({ enabled: true, uncaught: false });

    expect(tapGlobalErrors).not.toHaveBeenCalled();
    expect(tapConsole).toHaveBeenCalledTimes(1);
    expect(tapNetwork).toHaveBeenCalledTimes(1);

    stop();
    expect(stops.uncaught).not.toHaveBeenCalled();
  });

  /* Lối thoát cho app có SDK khác (vd Sentry) cũng đăng ký bộ theo dõi của Hermes: Hermes chỉ
     giữ một bộ, bật thì đè mất bộ của SDK. */
  it('`rejections: false` không đăng ký bộ theo dõi promise reject', () => {
    const stop = startCapture({ enabled: true, rejections: false });

    expect(tapUnhandledRejections).not.toHaveBeenCalled();
    // Lỗi đồng bộ không ai bắt là đường riêng — vẫn bật.
    expect(tapGlobalErrors).toHaveBeenCalledTimes(1);

    stop();
    expect(stops.rejections).not.toHaveBeenCalled();
  });

  /*
    `enabled` bắt buộc, không mặc định — cùng luật với `DevToolsConfig.enabled` (AGENTS.md, luật 4).
    App quên khoá theo môi trường thì trước đây bản prod vẫn vá console/HTTP (và ghi đĩa nếu có
    `persist`). Giờ thiếu `enabled: true` ⇒ không vá gì cả.
  */
  describe('`enabled`', () => {
    const expectNothingPatched = () => {
      expect(tapConsole).not.toHaveBeenCalled();
      expect(tapNetwork).not.toHaveBeenCalled();
      expect(tapFetch).not.toHaveBeenCalled();
      expect(tapGlobalErrors).not.toHaveBeenCalled();
      expect(tapUnhandledRejections).not.toHaveBeenCalled();
      expect(startPersistence).not.toHaveBeenCalled();
    };

    it('`enabled: false` ⇒ không vá gì, không ghi đĩa, hàm tắt gọi được', () => {
      const stop = startCapture({ enabled: false, persist: { store: fakeStore() } });

      expectNothingPatched();
      expect(() => stop()).not.toThrow();
    });

    it('`enabled: false` ⇒ không đổi sức chứa của buffer', () => {
      startCapture({ enabled: false, capacity: 1 });

      [1, 2, 3].forEach((id) => logBuffer.push(con(id)));

      expect(logBuffer.snapshot().map((e) => e.id)).toEqual([1, 2, 3]);
    });

    it('gọi từ JS mà thiếu `enabled`, hoặc giá trị truthy khác `true` ⇒ coi như tắt', () => {
      startCapture({ persist: { store: fakeStore() } } as never);
      startCapture(undefined as never);
      startCapture({ enabled: 'true' } as never);
      startCapture({ enabled: 1 } as never);

      expectNothingPatched();
    });

    it('kiểu bắt buộc `enabled`', () => {
      // Không chạy hàm: chỉ để `tsc` (npm run typecheck) đỏ nếu `enabled` lại thành tuỳ chọn.
      const typeOnly = () => {
        // @ts-expect-error `enabled` là bắt buộc
        startCapture();
        // @ts-expect-error `enabled` là bắt buộc
        startCapture({ console: true });
      };
      expect(typeof typeOnly).toBe('function');
    });
  });

  it('`redactKeys` thêm khoá che khi bật, tắt thu thì bỏ', () => {
    const stop = startCapture({ enabled: true, redactKeys: ['customerRef'] });

    expect(redactBody('{"customerRef":"c1"}')).toBe(`{"customerRef":"${REDACTED}"}`);

    stop();
    expect(redactBody('{"customerRef":"c1"}')).toBe('{"customerRef":"c1"}');
  });

  it('có `persist` thì bật lưu và tắt thu thì dừng lưu', () => {
    const persist = { store: fakeStore() };

    const stop = startCapture({ enabled: true, persist });

    expect(startPersistence).toHaveBeenCalledTimes(1);
    expect(startPersistence).toHaveBeenCalledWith(logBuffer, persist);
    // Lỗi fatal nối sẵn với việc lưu: `onFatal` của bộ bắt lỗi ghi phiên ngay, đánh dấu fatal.
    const onFatal = jest.mocked(tapGlobalErrors).mock.calls[0][0];
    void onFatal?.();
    expect(flushPersistedLogs).toHaveBeenCalledWith(true);
    expect(stops.persist).not.toHaveBeenCalled();

    stop();

    expect(stops.persist).toHaveBeenCalledTimes(1);
  });
});
