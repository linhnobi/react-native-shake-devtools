import { actionBuffer } from './action-buffer';
import { createLogBuffer, type LogBuffer } from './log-buffer';
import type { ConsoleEntry, NetworkEntry } from './log-entry';
import {
  PERSISTED_ACTIONS,
  activePersistStore,
  clearPersistedLogs,
  previousSession,
  startPersistence,
  type LogStore,
  type PersistenceHandle,
} from './log-persist';
import {
  SESSION_FORMAT,
  parseSession,
  serializeSession,
  type LogStoreFile,
  type StoredSession,
} from './log-session';
import type { RecordedAction } from './recorded-action';
import { REDACTED } from './redact';

const HOUR = 3_600_000;
/** Nhịp gom nhỏ cho các case chạy giờ giả — mặc định 2000 ms chỉ làm test chậm, không đổi gì. */
const FLUSH_MS = 50;

interface FakeFile {
  content: string;
  modifiedAt: number;
}

/** Kho trong RAM: một `Map` tên → nội dung, mỗi hàm bọc `jest.fn` để đếm lời gọi. */
const makeStore = (seed: Record<string, FakeFile> = {}) => {
  const files = new Map<string, FakeFile>(Object.entries(seed));
  const store = {
    list: jest.fn(
      async (): Promise<readonly LogStoreFile[]> =>
        Array.from(files, ([name, f]) => ({ name, modifiedAt: f.modifiedAt })),
    ),
    read: jest.fn(async (name: string): Promise<string> => {
      const f = files.get(name);
      if (!f) throw new Error(`không có file ${name}`);
      return f.content;
    }),
    write: jest.fn(async (name: string, content: string): Promise<void> => {
      files.set(name, { content, modifiedAt: Date.now() });
    }),
    remove: jest.fn(async (name: string): Promise<void> => {
      files.delete(name);
    }),
  } satisfies LogStore;
  return { store, files };
};

type FakeStore = ReturnType<typeof makeStore>['store'];

const pushConsole = (
  buffer: LogBuffer,
  level: ConsoleEntry['level'] = 'info',
  text = 'x',
): number => {
  const id = buffer.nextId();
  buffer.push({ id, kind: 'console', at: Date.now(), level, text });
  return id;
};

/** Một phiên cũ hợp lệ nằm sẵn trong kho, sửa lần cuối `ageMs` trước. */
const storedFile = (name: string, ageMs: number, over: Partial<StoredSession> = {}) => {
  const savedAt = Date.now() - ageMs;
  const session: StoredSession = {
    format: SESSION_FORMAT,
    name,
    startedAt: savedAt - 60_000,
    savedAt,
    fatal: false,
    build: 'UAT · 1.0.2',
    totalInMemory: 1,
    entries: [{ id: 1, kind: 'console', at: savedAt, level: 'error', text: 'bùm' }],
    ...over,
  };
  return { session, file: { content: serializeSession(session, 1_000_000), modifiedAt: savedAt } };
};

/** File của lần ghi GẦN NHẤT, đọc lại bằng chính `parseSession`. */
const lastWrite = (store: FakeStore): { name: string; session: StoredSession } => {
  const calls = store.write.mock.calls;
  if (calls.length === 0) throw new Error('chưa có lần ghi nào');
  const [name, content] = calls[calls.length - 1];
  const session = parseSession(content);
  if (!session) throw new Error(`file ${name} không đọc lại được`);
  return { name, session };
};

/*
  Chạy nhịp gom bằng giờ giả rồi chờ lần ghi nó sinh ra xong hẳn. `advanceTimersByTimeAsync` nhả
  microtask sau mỗi timer nên `store.write` đã được GỌI khi nó trả về; await kết quả của các lời
  gọi đó là chờ chính chuỗi kho — không đi đường tắt qua `handle.flush()`.
*/
const runBatch = async (store: FakeStore) => {
  await jest.advanceTimersByTimeAsync(FLUSH_MS);
  await Promise.all(store.write.mock.results.map((r) => r.value));
};

let handle: PersistenceHandle | undefined;

/** Thao tác thứ `n` — `at` tăng dần để thứ tự đọc lại kiểm được. */
const act = (n: number, over: Partial<RecordedAction> = {}): RecordedAction => ({
  at: n,
  kind: 'tap',
  label: `nút ${n}`,
  source: 'text',
  ...over,
});

beforeEach(() => {
  // `actionBuffer` dùng chung cả app: ca trước để lại gì là ca sau thấy nấy.
  actionBuffer.clear();
});

afterEach(() => {
  actionBuffer.clear();
  // `active` nằm ở module scope: sót một handle là ca sau nhận lại handle cũ với kho cũ.
  handle?.stop();
  handle = undefined;
  jest.useRealTimers();
});

describe('startPersistence', () => {
  it('khởi động đọc phiên trước vào `previousSession`', async () => {
    const prev = storedFile('session-1000.json', HOUR, { fatal: true });
    const { store } = makeStore({ 'session-1000.json': prev.file });
    const listener = jest.fn();
    const unsubscribe = previousSession.subscribe(listener);

    handle = startPersistence(createLogBuffer(), { store });
    await handle.ready;
    unsubscribe();

    expect(store.read).toHaveBeenCalledWith('session-1000.json');
    expect(previousSession.get()).toEqual(prev.session);
    // Store ngoài React: panel đọc qua `useSyncExternalStore`, không báo thì panel không vẽ lại.
    expect(listener).toHaveBeenCalled();
  });

  it('khởi động xoá file quá hạn', async () => {
    const { store, files } = makeStore({
      'session-1.json': storedFile('session-1.json', 73 * HOUR).file,
      'session-2.json': storedFile('session-2.json', HOUR).file,
      // Rác lạ trong thư mục kho: không phải của mình để xoá, dù cũ tới đâu.
      'ghi-chu.txt': { content: 'x', modifiedAt: 0 },
    });

    handle = startPersistence(createLogBuffer(), { store });
    await handle.ready;

    expect(store.remove).toHaveBeenCalledTimes(1);
    expect(store.remove).toHaveBeenCalledWith('session-1.json');
    expect(Array.from(files.keys()).sort()).toEqual(['ghi-chu.txt', 'session-2.json']);
  });

  it('thay đổi trong buffer được gom thành MỘT lần ghi', async () => {
    jest.useFakeTimers();
    const { store } = makeStore();
    const buffer = createLogBuffer();
    handle = startPersistence(buffer, { store, flushMs: FLUSH_MS });
    await handle.ready;

    const ids = [pushConsole(buffer), pushConsole(buffer), pushConsole(buffer, 'error', 'bùm')];
    await jest.advanceTimersByTimeAsync(FLUSH_MS - 1);
    expect(store.write).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await Promise.all(store.write.mock.results.map((r) => r.value));
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(lastWrite(store).name).toMatch(/^session-\d+\.json$/);
    expect(lastWrite(store).session.entries.map((e) => e.id)).toEqual(ids);

    // Không có thay đổi mới ⇒ nhịp gom không tự bắn lại.
    await jest.advanceTimersByTimeAsync(FLUSH_MS * 5);
    expect(store.write).toHaveBeenCalledTimes(1);
  });

  it('file ghi xuống đã che `Authorization`', async () => {
    jest.useFakeTimers();
    const { store } = makeStore();
    const buffer = createLogBuffer();
    handle = startPersistence(buffer, { store, flushMs: FLUSH_MS });
    await handle.ready;

    const raw: NetworkEntry = {
      id: buffer.nextId(),
      kind: 'network',
      at: Date.now(),
      method: 'POST',
      url: '/api/login',
      status: 401,
      requestHeaders: { Authorization: 'Bearer token-con-song' },
      requestBody: '{"password":"123"}',
    };
    buffer.push(raw);
    await runBatch(store);

    const written = lastWrite(store).session.entries[0] as NetworkEntry;
    expect(written.requestHeaders).toEqual({ Authorization: REDACTED });
    expect(written.requestBody).toBe(`{"password":"${REDACTED}"}`);
    expect(store.write.mock.calls[0][1]).not.toContain('token-con-song');
    // RAM vẫn giữ bản thô — `toCurl` cần header thật mới chạy được.
    expect((buffer.snapshot()[0] as NetworkEntry).requestHeaders).toEqual(raw.requestHeaders);
  });

  it('`flush(true)` ghi `fatal: true`', async () => {
    const { store } = makeStore();
    const buffer = createLogBuffer();
    handle = startPersistence(buffer, { store });
    await handle.ready;

    pushConsole(buffer, 'error', 'TypeError: undefined is not a function');
    await handle.flush(true);

    expect(store.write).toHaveBeenCalledTimes(1);
    expect(lastWrite(store).session.fatal).toBe(true);
  });

  it('`clearAll` xoá file, quên phiên trước, và dòng cũ không bao giờ được ghi lại', async () => {
    jest.useFakeTimers();
    const { store, files } = makeStore({
      'session-1000.json': storedFile('session-1000.json', HOUR).file,
    });
    const buffer = createLogBuffer();
    handle = startPersistence(buffer, { store, flushMs: FLUSH_MS });
    await handle.ready;
    expect(previousSession.get()).not.toBeNull();

    const oldId = pushConsole(buffer, 'info', 'dữ liệu của người vừa đăng xuất');
    await runBatch(store);
    const oldName = lastWrite(store).name;

    await handle.clearAll();
    expect(previousSession.get()).toBeNull();
    expect(Array.from(files.keys())).toEqual([]);

    const newId = pushConsole(buffer, 'info', 'người sau đăng nhập');
    await runBatch(store);
    const next = lastWrite(store);
    expect(next.name).not.toBe(oldName);
    expect(next.session.entries.map((e) => e.id)).toEqual([newId]);
    // Dòng cũ vẫn xem được trên màn — chỉ là không bao giờ xuống đĩa nữa.
    expect(buffer.snapshot().map((e) => e.id)).toEqual([oldId, newId]);
  });

  it('kho reject không làm ném', async () => {
    const boom = () => Promise.reject(new Error('đĩa hỏng'));
    const store = {
      list: jest.fn(boom),
      read: jest.fn(boom),
      write: jest.fn(boom),
      remove: jest.fn(boom),
    } satisfies LogStore;
    const buffer = createLogBuffer();
    handle = startPersistence(buffer, { store });

    await expect(handle.ready).resolves.toBeUndefined();
    pushConsole(buffer, 'error', 'bùm');
    await expect(handle.flush(true)).resolves.toBeUndefined();
    await expect(handle.clearAll()).resolves.toBeUndefined();
    // Đã thử ghi thật — chỉ là kho không nhận.
    expect(store.write).toHaveBeenCalledTimes(1);
  });

  /*
    Ở dev, RedBox để JS chạy tiếp và `console.error` của RN rơi vào buffer ⇒ nhịp gom chạy lại.
    Trước khi sửa, lần ghi đó đè file bằng `fatal: false` và dải báo crash không bao giờ hiện.
  */
  it('⭐ dấu `fatal` còn nguyên sau một lần ghi gom về sau', async () => {
    jest.useFakeTimers();
    const { store } = makeStore();
    const buffer = createLogBuffer();
    handle = startPersistence(buffer, { store, flushMs: FLUSH_MS });
    await handle.ready;

    pushConsole(buffer, 'error', 'TypeError: bùm');
    await handle.flush(true);
    pushConsole(buffer, 'error', 'console.error của RN sau RedBox');
    await runBatch(store);

    expect(store.write).toHaveBeenCalledTimes(2);
    expect(lastWrite(store).session.fatal).toBe(true);
  });

  /* Đăng xuất tự động ngay lúc mở app: kết quả đọc đĩa về SAU lệnh xoá phải bị bỏ. */
  it('⭐ `clearAll` chen vào lúc khởi động thì phiên trước không sống lại', async () => {
    const prev = storedFile('session-1000.json', HOUR);
    const { store, files } = makeStore({ 'session-1000.json': prev.file });
    let release: (text: string) => void = () => undefined;
    store.read.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );

    handle = startPersistence(createLogBuffer(), { store });
    /* Chờ tới đúng lúc bước khởi động ĐANG đọc file (read đã gọi, chưa trả) rồi mới đăng xuất. */
    for (let i = 0; i < 50 && store.read.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(store.read).toHaveBeenCalledTimes(1);
    const cleared = handle.clearAll();
    release(prev.file.content);
    await handle.ready;
    await cleared;

    expect(previousSession.get()).toBeNull();
    expect(Array.from(files.keys())).toEqual([]);
  });

  it('⭐ một file xoá hỏng không giữ lại các file quá hạn khác', async () => {
    const { store, files } = makeStore({
      'session-1.json': storedFile('session-1.json', 80 * HOUR).file,
      'session-2.json': storedFile('session-2.json', 79 * HOUR).file,
      'session-3.json': storedFile('session-3.json', 78 * HOUR).file,
    });
    store.remove.mockImplementationOnce(() => Promise.reject(new Error('khoá file')));

    handle = startPersistence(createLogBuffer(), { store });
    await handle.ready;

    expect(store.remove).toHaveBeenCalledTimes(3);
    // Lượt đầu hỏng (file mới nhất trong số quá hạn còn lại) — hai file kia vẫn được xoá.
    expect(files.size).toBe(1);
  });

  describe('thao tác của QA', () => {
    it('40 thao tác trong bộ đệm ⇒ file chỉ có 30 thao tác CUỐI', async () => {
      jest.useFakeTimers();
      const { store } = makeStore();
      const buffer = createLogBuffer();
      handle = startPersistence(buffer, { store, flushMs: FLUSH_MS });
      await handle.ready;

      for (let n = 1; n <= 40; n += 1) actionBuffer.push(act(n));
      pushConsole(buffer);
      await runBatch(store);

      const { session } = lastWrite(store);
      expect(PERSISTED_ACTIONS).toBe(30);
      expect(session.format).toBe(SESSION_FORMAT);
      expect(session.actions?.map((a) => a.at)).toEqual(
        Array.from({ length: 30 }, (_, i) => i + 11),
      );
    });

    it('`flush(true)` (fatal) ghi cả `actions`', async () => {
      const { store } = makeStore();
      const buffer = createLogBuffer();
      handle = startPersistence(buffer, { store });
      await handle.ready;

      actionBuffer.push(act(1));
      actionBuffer.push({ at: 2, kind: 'back', source: 'none' });
      pushConsole(buffer, 'error', 'TypeError: bùm');
      await handle.flush(true);

      const { session } = lastWrite(store);
      expect(session.fatal).toBe(true);
      expect(session.actions).toEqual([act(1), { at: 2, kind: 'back', source: 'none' }]);
    });

    it('nhãn xuống file đúng là chuỗi đã che nằm sẵn trong bộ đệm', async () => {
      const { store } = makeStore();
      const buffer = createLogBuffer();
      handle = startPersistence(buffer, { store });
      await handle.ready;

      // Bộ ghi chạm che nhãn TRƯỚC khi push; ở đây push thẳng chuỗi đã che để chốt: tầng ghi đĩa
      // không đổi nhãn và cũng không có đường nào đưa chuỗi gốc vào.
      actionBuffer.push(act(1, { label: 'Số thẻ ***4242' }));
      pushConsole(buffer);
      await handle.flush(true);

      expect(lastWrite(store).session.actions?.[0].label).toBe('Số thẻ ***4242');
      expect(store.write.mock.calls[0][1]).toContain('***4242');
    });

    it('bộ đệm trống ⇒ `actions` là mảng rỗng, không phải `undefined`', async () => {
      const { store } = makeStore();
      const buffer = createLogBuffer();
      handle = startPersistence(buffer, { store });
      await handle.ready;

      pushConsole(buffer, 'error', 'bùm');
      await handle.flush(true);

      expect(lastWrite(store).session.actions).toEqual([]);
    });

    it('`clearAll` ⇒ thao tác của người trước không xuống đĩa ở phiên mới', async () => {
      jest.useFakeTimers();
      const { store } = makeStore();
      const buffer = createLogBuffer();
      handle = startPersistence(buffer, { store, flushMs: FLUSH_MS });
      await handle.ready;

      actionBuffer.push(act(Date.now(), { label: 'người vừa đăng xuất' }));
      await jest.advanceTimersByTimeAsync(10);
      await handle.clearAll();
      await jest.advanceTimersByTimeAsync(10);
      actionBuffer.push(act(Date.now(), { label: 'người sau' }));
      pushConsole(buffer);
      await runBatch(store);

      expect(lastWrite(store).session.actions?.map((a) => a.label)).toEqual(['người sau']);
    });
  });

  describe('clearPersistedLogs', () => {
    /* R11: form báo bug đọc thẳng `actionBuffer` — chỉ chặn đường xuống đĩa là mới che một nửa. */
    it('đăng xuất xoá cả thao tác trong RAM — có hay không bật lưu', async () => {
      actionBuffer.push(act(1, { label: 'người vừa đăng xuất' }));
      await clearPersistedLogs();
      expect(actionBuffer.snapshot()).toEqual([]);

      const { store } = makeStore();
      handle = startPersistence(createLogBuffer(), { store });
      await handle.ready;
      actionBuffer.push(act(2, { label: 'người vừa đăng xuất' }));
      await clearPersistedLogs();

      expect(actionBuffer.snapshot()).toEqual([]);
      expect(previousSession.get()).toBeNull();
    });
  });

  describe('activePersistStore', () => {
    it('trả kho khi persistence đang chạy, `undefined` sau khi dừng', () => {
      const { store } = makeStore();
      expect(activePersistStore()).toBeUndefined();

      handle = startPersistence(createLogBuffer(), { store });
      expect(activePersistStore()).toBe(store);

      handle.stop();
      expect(activePersistStore()).toBeUndefined();
    });
  });
});
