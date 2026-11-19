import { tapConsole } from './console-tap';
import { FATAL_FLUSH_BUDGET_MS, formatUncaught, tapGlobalErrors } from './global-error-tap';
import { logBuffer } from './log-buffer';
import { flushPersistedLogs, startPersistence, type LogStore } from './log-persist';
import { countErrors } from './log-query';
import { parseSession } from './log-session';

/*
  Hai đầu ra của `ExceptionsManager` THẬT của RN (bản devDependency): LogBox ở `__DEV__`, module
  native ở release. Mock ở đây để đếm RN nhận lỗi bao nhiêu lần và lúc nào; phần còn lại của
  `ExceptionsManager` (dựng `data`, `console.error(e)`, cờ `isFatal`) là mã thật.
*/
jest.mock('react-native/Libraries/LogBox/LogBox', () => ({
  __esModule: true,
  default: { addException: jest.fn() },
}));
jest.mock('react-native/Libraries/Core/NativeExceptionsManager', () => ({
  __esModule: true,
  default: { reportException: jest.fn() },
}));

/** Khớp hằng `UNCAUGHT_LIMIT` ở module scope của `global-error-tap.ts` (không export). */
const UNCAUGHT_LIMIT = 2000;

type Handler = (error: unknown, isFatal?: boolean) => void;

const g = globalThis as unknown as { ErrorUtils?: unknown; __DEV__?: boolean };

describe('formatUncaught', () => {
  it('`Error` có stack ra tên + thông điệp + stack', () => {
    const error = new TypeError('x is undefined');
    // Stack kiểu Hermes/V8 mở đầu bằng chính `name: message` — không được in hai lần.
    error.stack = [
      'TypeError: x is undefined',
      '    at render (UserList.tsx:12:3)',
      '    at App (App.tsx:4:1)',
    ].join('\n');

    expect(formatUncaught(error)).toBe(error.stack);

    // Stack không mở đầu bằng `name: message` (kiểu JSC) ⇒ vẫn có dòng đầu đó.
    error.stack = 'render@UserList.tsx:12:3';
    expect(formatUncaught(error)).toBe('TypeError: x is undefined\nrender@UserList.tsx:12:3');
  });

  /* Stack của `new Error('')` mở đầu bằng `Error` (không có dấu hai chấm) — trước khi sửa, tiêu đề
     in thành `Error: ` rồi dòng `Error` lặp lại ngay dưới. */
  it('thông điệp rỗng ⇒ tiêu đề chỉ là tên, không in hai lần', () => {
    const error = new Error('');
    error.stack = 'Error\n    at f (a.js:1:1)';

    expect(formatUncaught(error)).toBe('Error\n    at f (a.js:1:1)');
  });

  it('`throw` chuỗi ra nguyên chuỗi', () => {
    // Không bọc nháy như `JSON.stringify` sẽ làm.
    expect(formatUncaught('bùm')).toBe('bùm');
  });

  it('cắt ở `UNCAUGHT_LIMIT`', () => {
    expect(formatUncaught('x'.repeat(UNCAUGHT_LIMIT + 1))).toBe(`${'x'.repeat(UNCAUGHT_LIMIT)}…`);
    expect(formatUncaught('x'.repeat(UNCAUGHT_LIMIT))).toBe('x'.repeat(UNCAUGHT_LIMIT));

    // Hạn tính cả stack.
    const error = new Error('bùm');
    error.stack = `Error: bùm\n${'    at f (a.js:1:1)\n'.repeat(200)}`;
    const text = formatUncaught(error);

    expect(text.startsWith('Error: bùm\n')).toBe(true);
    expect(text).toHaveLength(UNCAUGHT_LIMIT + 1);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('tapGlobalErrors', () => {
  /* `ErrorUtils` giả giữ MỘT handler như RN; `fire` bắn lỗi vào handler đang cài — đúng đường RN đi. */
  let savedErrorUtils: unknown;
  let hadErrorUtils: boolean;
  let current: Handler;
  let original: jest.Mock;
  let stop: (() => void) | undefined;

  const fire = (error: unknown, isFatal: boolean) => current(error, isFatal);

  beforeEach(() => {
    hadErrorUtils = 'ErrorUtils' in g;
    savedErrorUtils = g.ErrorUtils;
    original = jest.fn();
    current = original;
    g.ErrorUtils = {
      getGlobalHandler: () => current,
      setGlobalHandler: (handler: Handler) => {
        current = handler;
      },
    };
    logBuffer.clear();
  });

  afterEach(() => {
    // Gỡ TRƯỚC khi trả `ErrorUtils` thật: `installed` nằm ở module scope, sót lại là ca sau nhận
    // hàm gỡ cũ và không bọc gì.
    stop?.();
    stop = undefined;
    if (hadErrorUtils) g.ErrorUtils = savedErrorUtils;
    else delete g.ErrorUtils;
    jest.useRealTimers();
  });

  it('lỗi thường ⇒ dòng `uncaught` vào buffer và handler gốc được gọi ngay', () => {
    const onFatal = jest.fn();
    stop = tapGlobalErrors(onFatal);
    const error = new TypeError('x is undefined');

    fire(error, false);

    // Ngay trong lời gọi — không chờ microtask hay timer nào.
    expect(original).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledWith(error, false);
    // Ghi đĩa chỉ dành cho lỗi làm chết app.
    expect(onFatal).not.toHaveBeenCalled();
    expect(logBuffer.snapshot()).toEqual([
      expect.objectContaining({
        kind: 'console',
        level: 'error',
        text: formatUncaught(error),
        uncaught: true,
        fatal: false,
      }),
    ]);
  });

  /* Timer giả cho các ca fatal: bọc chồng luôn hẹn một timer trần 800ms, để timer thật chạy thì nó
     sống quá case. Nhả microtask bằng `advanceTimersByTimeAsync(0)`. */
  it('lỗi fatal ⇒ `fatal: true` và handler gốc gọi **sau** `onFatal`', async () => {
    jest.useFakeTimers();
    let finishFlush: () => void = () => undefined;
    const onFatal = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishFlush = resolve;
        }),
    );
    stop = tapGlobalErrors(onFatal);
    const error = new Error('chết');

    fire(error, true);

    expect(logBuffer.snapshot()).toEqual([
      expect.objectContaining({ uncaught: true, fatal: true }),
    ]);
    expect(onFatal).toHaveBeenCalledTimes(1);
    // Lượt ghi phiên chưa xong ⇒ chưa trả lỗi về RN.
    await jest.advanceTimersByTimeAsync(0);
    expect(original).not.toHaveBeenCalled();

    finishFlush();
    await jest.advanceTimersByTimeAsync(0);

    // Trả ngay khi ghi xong — chưa hề tới trần thời gian, không phải timer trả hộ.
    expect(original).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledWith(error, true);
  });

  it('`onFatal` treo ⇒ handler gốc vẫn được gọi sau `FATAL_FLUSH_BUDGET_MS`', async () => {
    jest.useFakeTimers();
    stop = tapGlobalErrors(() => new Promise<void>(() => undefined));
    const error = new Error('chết');

    fire(error, true);

    await jest.advanceTimersByTimeAsync(FATAL_FLUSH_BUDGET_MS - 1);
    expect(original).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(original).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledWith(error, true);
  });

  /* Ba đường trả lỗi về RN — `onFatal` xong · reject · ném đồng bộ — đều đua với timer trần. */
  it('handler gốc chỉ được gọi đúng một lần', async () => {
    jest.useFakeTimers();
    const variants: Array<() => Promise<unknown> | void> = [
      () => Promise.resolve(),
      () => Promise.reject(new Error('đĩa đầy')),
      () => {
        throw new Error('kho hỏng');
      },
    ];

    for (const onFatal of variants) {
      stop?.();
      original.mockClear();
      stop = tapGlobalErrors(onFatal);

      fire(new Error('chết'), true);
      await jest.advanceTimersByTimeAsync(FATAL_FLUSH_BUDGET_MS * 2);

      expect(original).toHaveBeenCalledTimes(1);
    }
  });

  /*
    Handler gốc giả làm đúng việc `ExceptionsManager.handleException` của RN 0.86: `console.error`
    lại chính lỗi (cả dev lẫn release), rồi LogBox / màn đỏ / báo native. Trước khi sửa, `tapConsole`
    ghi thêm một dòng `ERROR` không stack ⇒ mỗi lỗi đếm 2.
  */
  describe('cùng `tapConsole`', () => {
    let errorSpy: jest.SpyInstance;
    let stopConsole: () => void;

    beforeEach(() => {
      errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      stopConsole = tapConsole();
      original.mockImplementation((error: unknown) => console.error(error));
    });

    afterEach(() => {
      stopConsole();
      errorSpy.mockRestore();
    });

    it('lỗi thường: `console.error` của handler gốc không thành dòng thứ hai', () => {
      stop = tapGlobalErrors();
      const error = new TypeError('x is undefined');

      fire(error, false);

      // Hàm gốc của `console.error` vẫn nhận — LogBox / màn đỏ / Metro không mất gì.
      expect(errorSpy).toHaveBeenCalledWith(error);
      expect(logBuffer.snapshot()).toEqual([expect.objectContaining({ uncaught: true })]);
      expect(countErrors(logBuffer.snapshot())).toBe(1);

      // Chỉ tắt trong lúc trả về RN: `console.error` của app sau đó vẫn vào nhật ký.
      console.error('sau đó');
      expect(logBuffer.snapshot()).toHaveLength(2);
    });

    /* Đường fatal trả về RN muộn (sau `onFatal`, hoặc khi hết trần) — phải tắt đúng lúc đó, không
       phải lúc bắt lỗi. */
    it('lỗi fatal: như vậy, cả khi trả về sau `onFatal`', async () => {
      jest.useFakeTimers();
      stop = tapGlobalErrors(() => Promise.resolve());

      fire(new Error('chết'), true);
      await jest.advanceTimersByTimeAsync(0);

      expect(original).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(logBuffer.snapshot()).toEqual([
        expect.objectContaining({ uncaught: true, fatal: true }),
      ]);

      // Đường trần thời gian: `onFatal` treo ⇒ handler gốc gọi từ timer, vẫn chỉ một dòng.
      stop();
      original.mockClear();
      logBuffer.clear();
      stop = tapGlobalErrors(() => new Promise<void>(() => undefined));

      fire(new Error('chết lần hai'), true);
      await jest.advanceTimersByTimeAsync(FATAL_FLUSH_BUDGET_MS);

      expect(original).toHaveBeenCalledTimes(1);
      expect(logBuffer.snapshot()).toHaveLength(1);
    });
  });

  /* Hai lớp bọc thì mỗi lỗi vào nhật ký HAI lần, và handler gốc bị gọi qua hai tầng. */
  it('gọi hai lần chỉ bọc một lớp', () => {
    stop = tapGlobalErrors();
    const wrapped = current;

    const again = tapGlobalErrors();

    expect(again).toBe(stop);
    expect(current).toBe(wrapped);
    fire(new Error('một lần'), false);
    expect(logBuffer.snapshot()).toHaveLength(1);
    expect(original).toHaveBeenCalledTimes(1);
  });

  it('`stop()` trả handler cũ', () => {
    stop = tapGlobalErrors();
    expect(current).not.toBe(original);

    stop();

    expect(current).toBe(original);
    fire(new Error('sau khi gỡ'), false);
    expect(logBuffer.snapshot()).toHaveLength(0);
    expect(original).toHaveBeenCalledTimes(1);
  });
});

/*
  Lỗi trong lúc RENDER mà không có error boundary, trên RN 0.81+ (React 19).

  RN truyền ba hàm của `src/private/renderer/errorhandling/ErrorHandlers.js` cho `ReactFabric.render`
  (`Libraries/ReactNative/RendererImplementation.js`). React 19 không ném lại lỗi gốc nữa mà gọi
  `onUncaughtError(error, { componentStack })`, và hàm đó gọi THẲNG
  `ExceptionsManager.handleException(error, true)` — không qua `ErrorUtils`. Trước khi sửa, lỗi chỉ
  tới nhật ký qua `console.error(e)` bên trong RN thành một dòng `ERROR` thường, và `onFatal` (ghi
  phiên) không chạy: ở bản release app chết mà phiên trước không có crash.

  Các case gọi ĐÚNG hàm RN gọi (`onUncaughtError` thật, cùng tham số). `ErrorUtils` giả giữ handler
  y như `setUpErrorHandling.js` của RN: tra `ExceptionsManager.handleException` lúc gọi. Trên dòng
  CI RN 0.76 (React 18) hàm này có nhưng renderer bỏ qua tuỳ chọn đó (lỗi được ném lại tới
  `ErrorUtils`); case vẫn kiểm đúng bản vá `handleException`.
*/
describe('tapGlobalErrors — lỗi render không error boundary (React 19)', () => {
  type ErrorInfo = { componentStack?: string };
  interface ExceptionsManagerLike {
    handleException: (error: unknown, isFatal: boolean) => void;
  }

  /* Đi bằng đường dẫn tuyệt đối: RN 0.88 bỏ `./src/*` khỏi `exports`, chỉ chính RN (đường tương
     đối) với tới file này. CI chạy jest trên RN 0.76 → 0.88 — file có ở mọi bản đó. */
  const rnRoot = require('path').dirname(require.resolve('react-native/package.json')) as string;
  const { onUncaughtError, onCaughtError } = require(
    `${rnRoot}/src/private/renderer/errorhandling/ErrorHandlers`,
  ) as {
    onUncaughtError: (error: unknown, info: ErrorInfo) => void;
    onCaughtError: (error: unknown, info: ErrorInfo) => void;
  };
  /* RN 0.81+ `export default`; RN 0.76 · 0.78 `module.exports`. */
  type EmModule = ExceptionsManagerLike & { default?: ExceptionsManagerLike };
  const emModule = require('react-native/Libraries/Core/ExceptionsManager') as EmModule;
  const exceptionsManager: ExceptionsManagerLike = emModule.default ?? emModule;
  const addException = (
    jest.requireMock('react-native/Libraries/LogBox/LogBox') as {
      default: { addException: jest.Mock };
    }
  ).default.addException;
  const reportNative = (
    jest.requireMock('react-native/Libraries/Core/NativeExceptionsManager') as {
      default: { reportException: jest.Mock };
    }
  ).default.reportException;

  const COMPONENT_STACK = '\n    in UserCard\n    in App';

  let savedErrorUtils: unknown;
  let hadErrorUtils: boolean;
  let current: Handler;
  /** Handler toàn cục của RN — y như `handleError` trong `Libraries/Core/setUpErrorHandling.js`. */
  let rnGlobalHandler: jest.Mock;
  let rnHandleException: ExceptionsManagerLike['handleException'];
  let errorSpy: jest.SpyInstance;
  let stopConsole: () => void;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    hadErrorUtils = 'ErrorUtils' in g;
    savedErrorUtils = g.ErrorUtils;
    rnHandleException = exceptionsManager.handleException;
    rnGlobalHandler = jest.fn((error: unknown, isFatal?: boolean) =>
      exceptionsManager.handleException(error, Boolean(isFatal)),
    );
    current = rnGlobalHandler;
    g.ErrorUtils = {
      getGlobalHandler: () => current,
      setGlobalHandler: (handler: Handler) => {
        current = handler;
      },
    };
    addException.mockClear();
    reportNative.mockClear();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    stopConsole = tapConsole();
    logBuffer.clear();
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    stopConsole();
    errorSpy.mockRestore();
    // Lưới an toàn: một case đỏ giữa chừng không được để bản vá sót sang case sau.
    exceptionsManager.handleException = rnHandleException;
    if (hadErrorUtils) g.ErrorUtils = savedErrorUtils;
    else delete g.ErrorUtils;
    jest.useRealTimers();
    logBuffer.clear();
  });

  it('⭐ một dòng `uncaught` fatal, `onFatal` chạy trước khi RN nhận lỗi', async () => {
    let finishFlush: () => void = () => undefined;
    const onFatal = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishFlush = resolve;
        }),
    );
    stop = tapGlobalErrors(onFatal);
    const error = new TypeError("Cannot read property 'name' of undefined");

    onUncaughtError(error, { componentStack: COMPONENT_STACK });

    expect(logBuffer.snapshot()).toEqual([
      expect.objectContaining({
        kind: 'console',
        level: 'error',
        text: formatUncaught(error),
        uncaught: true,
        fatal: true,
      }),
    ]);
    expect(onFatal).toHaveBeenCalledTimes(1);
    // Phiên chưa ghi xong ⇒ RN chưa nhận (ở release đây là lúc app chết).
    await jest.advanceTimersByTimeAsync(0);
    expect(addException).not.toHaveBeenCalled();

    finishFlush();
    await jest.advanceTimersByTimeAsync(0);

    expect(addException).toHaveBeenCalledTimes(1);
    expect(addException).toHaveBeenCalledWith(
      expect.objectContaining({ isFatal: true, isComponentError: true }),
    );
    // `console.error` của RN (`e` ở 0.81+, `data.message` ở 0.76 · 0.78) vẫn tới hàm gốc, nhưng
    // không thành dòng `ERROR` thứ hai.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(countErrors(logBuffer.snapshot())).toBe(1);
    // Đường này không bao giờ đi qua `ErrorUtils` — lý do bọc `ErrorUtils` thôi là không đủ.
    expect(rnGlobalHandler).not.toHaveBeenCalled();
  });

  it('release (`__DEV__` tắt): báo native fatal đúng một lần, sau khi ghi phiên', async () => {
    const savedDev = g.__DEV__;
    g.__DEV__ = false;
    try {
      const onFatal = jest.fn(() => Promise.resolve());
      stop = tapGlobalErrors(onFatal);

      onUncaughtError(new Error('render chết'), { componentStack: COMPONENT_STACK });

      expect(onFatal).toHaveBeenCalledTimes(1);
      expect(reportNative).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(0);

      expect(reportNative).toHaveBeenCalledTimes(1);
      expect(reportNative).toHaveBeenCalledWith(expect.objectContaining({ isFatal: true }));
      expect(addException).not.toHaveBeenCalled();
    } finally {
      g.__DEV__ = savedDev;
    }
  });

  it('`onFatal` treo ⇒ RN vẫn nhận lỗi sau `FATAL_FLUSH_BUDGET_MS`', async () => {
    stop = tapGlobalErrors(() => new Promise<void>(() => undefined));

    onUncaughtError(new Error('render chết'), { componentStack: COMPONENT_STACK });

    await jest.advanceTimersByTimeAsync(FATAL_FLUSH_BUDGET_MS - 1);
    expect(addException).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(addException).toHaveBeenCalledTimes(1);
  });

  /* Lỗi fatal qua `ErrorUtils` (throw trong `onPress`, timer…): handler của RN gọi lại chính
     `ExceptionsManager.handleException` — không được thành dòng thứ hai hay lần ghi thứ hai. */
  it('lỗi fatal qua `ErrorUtils` vẫn chỉ một dòng, một lần `onFatal`', async () => {
    const onFatal = jest.fn(() => Promise.resolve());
    stop = tapGlobalErrors(onFatal);
    const error = new Error('onPress chết');

    current(error, true);
    await jest.advanceTimersByTimeAsync(FATAL_FLUSH_BUDGET_MS);

    expect(rnGlobalHandler).toHaveBeenCalledTimes(1);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(addException).toHaveBeenCalledTimes(1);
    expect(logBuffer.snapshot()).toEqual([
      expect.objectContaining({ uncaught: true, fatal: true }),
    ]);

    // `throw` một chuỗi: không có object để nhận mặt, vẫn một dòng.
    logBuffer.clear();
    onFatal.mockClear();
    current('chuỗi bị ném', true);
    await jest.advanceTimersByTimeAsync(FATAL_FLUSH_BUDGET_MS);

    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(logBuffer.snapshot()).toHaveLength(1);
  });

  /* SDK báo crash bọc `ErrorUtils` và trả lỗi về handler của RN MUỘN (sau khi tự gửi xong). Lúc
     đó lib đã trả lỗi đi từ lâu — vẫn phải nhận ra lỗi đã ghi. */
  it('SDK trả lỗi về RN muộn ⇒ vẫn một dòng, một lần `onFatal`', async () => {
    const sdk: Handler = (error, isFatal) => {
      setTimeout(() => rnGlobalHandler(error, isFatal), 5000);
    };
    current = sdk;
    const onFatal = jest.fn(() => Promise.resolve());
    stop = tapGlobalErrors(onFatal);

    current(new Error('chết'), true);
    await jest.advanceTimersByTimeAsync(10_000);

    expect(rnGlobalHandler).toHaveBeenCalledTimes(1);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(addException).toHaveBeenCalledTimes(1);
    expect(logBuffer.snapshot()).toHaveLength(1);
  });

  /* Error boundary đã bắt ⇒ React gọi `onCaughtError` ⇒ `handleException(error, false)`: app không
     chết, không phải việc của `onFatal`. Giữ nguyên như trước. */
  it('lỗi bị error boundary bắt (`onCaughtError`) không thành lỗi fatal', async () => {
    const onFatal = jest.fn(() => Promise.resolve());
    stop = tapGlobalErrors(onFatal);

    onCaughtError(new Error('boundary bắt'), { componentStack: COMPONENT_STACK });
    await jest.advanceTimersByTimeAsync(FATAL_FLUSH_BUDGET_MS);

    expect(onFatal).not.toHaveBeenCalled();
    expect(addException).toHaveBeenCalledTimes(1);
    expect(addException).toHaveBeenCalledWith(expect.objectContaining({ isFatal: false }));
    expect(logBuffer.snapshot().some((e) => e.kind === 'console' && e.uncaught)).toBe(false);
  });

  it('`stop()` trả `handleException` gốc của RN', async () => {
    stop = tapGlobalErrors(jest.fn());
    expect(exceptionsManager.handleException).not.toBe(rnHandleException);

    stop();
    stop = undefined;

    expect(exceptionsManager.handleException).toBe(rnHandleException);
    onUncaughtError(new Error('sau khi gỡ'), {});
    await jest.advanceTimersByTimeAsync(0);
    expect(logBuffer.snapshot().some((e) => e.kind === 'console' && e.uncaught)).toBe(false);
    expect(addException).toHaveBeenCalledTimes(1);
  });

  /* Đầu–cuối với bộ lưu thật: đúng việc `startCapture({ persist })` nối dây
     (`tapGlobalErrors(() => flushPersistedLogs(true))`). */
  it('⭐ với `persist`: phiên được ghi `fatal: true` một lần, có dòng lỗi render', async () => {
    const files = new Map<string, string>();
    const store: LogStore = {
      list: jest.fn(async () => []),
      read: jest.fn(async (name: string) => files.get(name) ?? ''),
      write: jest.fn(async (name: string, content: string) => {
        files.set(name, content);
      }),
      remove: jest.fn(async () => undefined),
    };
    const handle = startPersistence(logBuffer, { store });
    try {
      await handle.ready;
      stop = tapGlobalErrors(() => flushPersistedLogs(true));

      onUncaughtError(new TypeError('x is undefined'), { componentStack: COMPONENT_STACK });
      // Chưa tới nhịp gom (2000ms): lần ghi nào có ở đây là lần ghi fatal.
      await jest.advanceTimersByTimeAsync(0);

      expect(store.write).toHaveBeenCalledTimes(1);
      const [, content] = jest.mocked(store.write).mock.calls[0];
      const session = parseSession(content);
      expect(session?.fatal).toBe(true);
      expect(session?.entries).toEqual([
        expect.objectContaining({ uncaught: true, fatal: true }),
      ]);
      expect(addException).toHaveBeenCalledTimes(1);
    } finally {
      handle.stop();
    }
  });
});
