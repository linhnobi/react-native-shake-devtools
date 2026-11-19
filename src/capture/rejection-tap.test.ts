import { dirname } from 'path';
import { tapConsole } from './console-tap';
import { logBuffer } from './log-buffer';
import type { ConsoleEntry } from './log-entry';
import { countErrors, isErrorEntry } from './log-query';
import {
  formatRejection,
  tapUnhandledRejections,
  type RejectionTrackerOptions,
} from './rejection-tap';

/*
  Bộ theo dõi RN đăng ký ở `__DEV__`, giả lập đúng việc RN 0.86 làm: `onUnhandled` đi qua
  `ExceptionsManager.handleException` ⇒ `console.error(error)` (rồi LogBox); `onHandled` in
  `console.warn`. Hai lời gọi `console.*` đó là thứ tap phải chặn khỏi nhật ký.
*/
jest.mock('react-native/Libraries/promiseRejectionTrackingOptions', () => ({
  __esModule: true,
  default: {
    allRejections: true,
    onUnhandled: jest.fn((id: number) => {
      console.error(new Error(`Uncaught (in promise, id: ${id})`));
    }),
    onHandled: jest.fn((id: number) => {
      console.warn(`Promise rejection handled (id: ${id})`);
    }),
  },
}));

const rnTracker = jest.requireMock<{
  default: Required<Pick<RejectionTrackerOptions, 'onUnhandled' | 'onHandled'>>;
}>('react-native/Libraries/promiseRejectionTrackingOptions').default;

const g = globalThis as unknown as { HermesInternal?: unknown; __DEV__: boolean };

const entries = () => logBuffer.snapshot() as readonly ConsoleEntry[];

describe('tapUnhandledRejections', () => {
  /* `HermesInternal` giả giữ MỘT bộ theo dõi như Hermes thật: đăng ký lần nữa là đè. */
  let hadHermes: boolean;
  let savedHermes: unknown;
  let savedDev: boolean;
  let tracker: RejectionTrackerOptions | undefined;
  let enableTracker: jest.Mock;
  let errorSpy: jest.SpyInstance;
  let stop: (() => void) | undefined;

  const unhandled = (id: number, rejection: unknown) => tracker?.onUnhandled?.(id, rejection);
  const handled = (id: number, rejection: unknown) => tracker?.onHandled?.(id, rejection);

  beforeEach(() => {
    hadHermes = 'HermesInternal' in g;
    savedHermes = g.HermesInternal;
    savedDev = g.__DEV__;
    tracker = undefined;
    enableTracker = jest.fn((options: RejectionTrackerOptions) => {
      tracker = options;
    });
    g.HermesInternal = { hasPromise: () => true, enablePromiseRejectionTracker: enableTracker };
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    logBuffer.clear();
  });

  afterEach(() => {
    // Gỡ TRƯỚC khi trả `HermesInternal`: `installed` nằm ở module scope, sót lại là ca sau nhận
    // hàm gỡ cũ và không đăng ký gì.
    stop?.();
    stop = undefined;
    if (hadHermes) g.HermesInternal = savedHermes;
    else delete g.HermesInternal;
    g.__DEV__ = savedDev;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  /* Jest/Node, JSC: không có chỗ đăng ký — không được ném, không được giả vờ đã cài. */
  it('không có Hermes ⇒ không làm gì', () => {
    for (const hermes of [undefined, {}]) {
      g.HermesInternal = hermes;

      const noop = tapUnhandledRejections();

      expect(() => noop()).not.toThrow();
    }
    expect(enableTracker).not.toHaveBeenCalled();

    // Không đánh dấu "đã cài": có Hermes rồi thì lần gọi sau vẫn đăng ký thật.
    g.HermesInternal = { hasPromise: () => true, enablePromiseRejectionTracker: enableTracker };
    stop = tapUnhandledRejections();
    expect(enableTracker).toHaveBeenCalledTimes(1);
  });

  /* `hasPromise()` false ⇒ RN thay `Promise` bằng bản JS của nó; bộ theo dõi của Hermes khi đó
     canh một `Promise` không ai dùng. */
  it('Hermes không dùng Promise của nó ⇒ không làm gì', () => {
    g.HermesInternal = { hasPromise: () => false, enablePromiseRejectionTracker: enableTracker };

    stop = tapUnhandledRejections();

    expect(enableTracker).not.toHaveBeenCalled();
  });

  it('reject không ai catch ⇒ dòng lỗi `uncaught` có stack', () => {
    stop = tapUnhandledRejections();
    const error = new TypeError('x is undefined');
    error.stack = [
      'TypeError: x is undefined',
      '    at fetchUser (api.ts:12:3)',
      '    at loadProfile (Profile.tsx:30:9)',
    ].join('\n');

    unhandled(0, error);

    expect(tracker?.allRejections).toBe(true);
    expect(entries()).toEqual([
      expect.objectContaining({
        kind: 'console',
        level: 'error',
        uncaught: true,
        fatal: false,
        text: formatRejection(0, error),
      }),
    ]);
    expect(entries()[0].text).toBe(
      'Uncaught (in promise, id: 0): TypeError: x is undefined\n' +
        '    at fetchUser (api.ts:12:3)\n' +
        '    at loadProfile (Profile.tsx:30:9)',
    );
    // Cùng một hàm với chip "Chỉ lỗi", huy hiệu, vòng giữ lỗi và chọn dòng ghi đĩa.
    expect(isErrorEntry(entries()[0])).toBe(true);
  });

  /* Bản `--dev true` (UAT): LogBox phải còn nguyên, nhưng một reject chỉ được là MỘT dòng lỗi. */
  it('`__DEV__` ⇒ bộ của RN vẫn nhận đủ sự kiện, `console.error` của nó không thành dòng thứ hai', () => {
    g.__DEV__ = true;
    const stopConsole = tapConsole();
    try {
      stop = tapUnhandledRejections();
      const error = new Error('API 500');

      unhandled(0, error);

      expect(rnTracker.onUnhandled).toHaveBeenCalledTimes(1);
      expect(rnTracker.onUnhandled).toHaveBeenCalledWith(0, error);
      // Hàm gốc của `console.error` vẫn được gọi — Metro, LogBox vẫn thấy.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(entries()).toHaveLength(1);
      expect(entries()[0]).toEqual(expect.objectContaining({ uncaught: true }));

      // Chỉ tắt trong lúc chuyển tiếp: `console.error` của app sau đó vẫn vào nhật ký.
      console.error('sau đó');
      expect(entries().map((e) => e.text)).toEqual([formatRejection(0, error), 'sau đó']);
    } finally {
      stopConsole();
    }
  });

  /* Bản `--dev false`: RN không đăng ký gì, nên không có ai để chuyển tiếp, và cũng không có bộ
     nào để trả lại khi gỡ. */
  it('`--dev false` ⇒ không chuyển tiếp, gỡ thì đăng ký bộ câm', () => {
    g.__DEV__ = false;
    stop = tapUnhandledRejections();

    unhandled(0, new Error('API 500'));

    expect(entries()).toHaveLength(1);
    expect(rnTracker.onUnhandled).not.toHaveBeenCalled();

    stop();

    expect(enableTracker).toHaveBeenCalledTimes(2);
    expect(tracker).not.toBe(rnTracker);
    // Bộ câm: không báo loại lỗi nào, và kể cả bị gọi thì cũng không ghi gì.
    expect(tracker).toEqual(expect.objectContaining({ allRejections: false, whitelist: [] }));
    unhandled(1, new TypeError('sau khi gỡ'));
    handled(1, new TypeError('sau khi gỡ'));
    expect(entries()).toHaveLength(1);
  });

  it('catch muộn ⇒ dòng lỗi giữ nguyên, thêm dòng `warn` cùng `id`', () => {
    g.__DEV__ = true;
    stop = tapUnhandledRejections();
    const error = new Error('API 500');

    unhandled(2, error);
    handled(2, error);

    expect(entries().map((e) => [e.level, e.text.split('\n')[0]])).toEqual([
      ['error', 'Uncaught (in promise, id: 2): Error: API 500'],
      ['warn', 'Promise rejection handled (id: 2)'],
    ]);
    // `warn` không phải lỗi: huy hiệu vẫn đếm một.
    expect(countErrors(entries())).toBe(1);
    expect(rnTracker.onHandled).toHaveBeenCalledWith(2, error);
  });

  /* Hai lần đăng ký thì lần hai đè lần một — vô hại, nhưng bộ RN cần trả lại khi gỡ sẽ bị lẫn với
     bộ của chính tap. */
  it('gọi hai lần chỉ đăng ký một lần', () => {
    stop = tapUnhandledRejections();

    const again = tapUnhandledRejections();

    expect(again).toBe(stop);
    expect(enableTracker).toHaveBeenCalledTimes(1);
    unhandled(0, new Error('một lần'));
    expect(entries()).toHaveLength(1);
  });

  it('`stop()` ở `__DEV__` trả đúng bộ của RN', () => {
    g.__DEV__ = true;
    const stopOld = tapUnhandledRejections();

    stopOld();

    expect(tracker).toBe(rnTracker);

    // Hàm gỡ của lần cài cũ không được gỡ lần cài mới (tắt thu → bật thu).
    stop = tapUnhandledRejections();
    const calls = enableTracker.mock.calls.length;
    stopOld();
    expect(enableTracker).toHaveBeenCalledTimes(calls);
    expect(tracker).not.toBe(rnTracker);
  });

  /*
    Bộ theo dõi THẬT của gói `promise` — Hermes nhúng chính mã này làm `Promise` của nó (khác mỗi
    tên thuộc tính đã rút gọn). Kiểm ba điều mà bộ giả ở trên chỉ giả định: chờ 2 giây (100ms với
    `TypeError`) mới báo, `catch` trong khoảng đó thì im, `onHandled` mang đúng `id` của
    `onUnhandled`. Lấy gói qua đường của `react-native` (nó là phụ thuộc của RN, không của lib).
  */
  it('bộ theo dõi thật của gói `promise`: đúng thời điểm và ghép đúng `id`', () => {
    jest.useFakeTimers();
    g.__DEV__ = false;
    const paths = [dirname(require.resolve('react-native/package.json'))];
    const tracking = require(
      require.resolve('promise/setimmediate/rejection-tracking', { paths }),
    ) as { enable: (o: RejectionTrackerOptions) => void; disable: () => void };
    const P = require(
      require.resolve('promise/setimmediate/es6-extensions', { paths }),
    ) as PromiseConstructor;
    g.HermesInternal = {
      hasPromise: () => true,
      enablePromiseRejectionTracker: (o: RejectionTrackerOptions) => tracking.enable(o),
    };

    try {
      stop = tapUnhandledRejections();

      const slow = P.reject(new Error('API 500'));
      jest.advanceTimersByTime(1999);
      expect(entries()).toHaveLength(0);
      jest.advanceTimersByTime(1);
      expect(entries().map((e) => e.text.split('\n')[0])).toEqual([
        'Uncaught (in promise, id: 0): Error: API 500',
      ]);

      P.reject(new TypeError('x is undefined'));
      jest.advanceTimersByTime(100);
      expect(entries()).toHaveLength(2);

      // `catch` trước hạn ⇒ không có dòng nào.
      P.reject(new Error('kịp')).catch(() => undefined);
      jest.advanceTimersByTime(5000);
      expect(entries()).toHaveLength(2);

      // `catch` sau khi đã báo ⇒ dòng `warn` mang đúng `id` của dòng lỗi.
      slow.catch(() => undefined);
      expect(entries().map((e) => [e.level, e.text.split('\n')[0]])).toEqual([
        ['error', 'Uncaught (in promise, id: 0): Error: API 500'],
        ['error', 'Uncaught (in promise, id: 1): TypeError: x is undefined'],
        ['warn', 'Promise rejection handled (id: 0)'],
      ]);
    } finally {
      stop?.();
      stop = undefined;
      tracking.disable();
    }
  });
});
