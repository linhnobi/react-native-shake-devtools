import { actionBuffer } from './action-buffer';
import { fullBodies } from './full-body-store';
import type { LogBuffer } from './log-buffer';
import {
  SESSION_FORMAT,
  isSessionFile,
  parseSession,
  pickForPersist,
  pickPrevious,
  planPrune,
  redactEntry,
  serializeSession,
  sessionFileName,
  type LogStoreFile,
  type StoredSession,
} from './log-session';

/**
 * Kho file của nhật ký — **app** cài (vd `react-native-blob-util` vào một thư mục trong
 * `CacheDir`), lib chỉ gọi. Cùng lý do với `DevToolsConfig.exportFile`: mọi đường ghi đĩa là
 * native module, mà lib không kéo native module.
 *
 * Mọi hàm được phép reject — lib nuốt lỗi, một kho hỏng không được làm hỏng app đang gỡ.
 */
export interface LogStore {
  /** Liệt kê file trong kho (chỉ tên + giờ sửa). Thư mục chưa tồn tại ⇒ mảng rỗng. */
  list: () => Promise<readonly LogStoreFile[]>;
  read: (name: string) => Promise<string>;
  /** Ghi **đè** cả file. */
  write: (name: string, content: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
}

export interface PersistOptions {
  store: LogStore;
  /** File cũ hơn ngần này giờ bị xoá lúc app khởi động. Mặc định `72`. */
  ttlHours?: number;
  /** Số phiên giữ lại, **kể cả phiên đang chạy**. Mặc định `3`. */
  maxSessions?: number;
  /** Trần mỗi file (byte UTF-8). Mặc định `1_000_000`. */
  maxBytes?: number;
  /** Số dòng cuối ghi kèm làm bối cảnh (ngoài mọi dòng lỗi). Mặc định `50`. */
  contextSize?: number;
  /** Gom ghi: chờ ngần này mili-giây sau thay đổi đầu tiên rồi ghi một lần. Mặc định `2000`. */
  flushMs?: number;
  /** Dòng phụ môi trường ghi vào file, vd `'UAT · 1.0.2'`. */
  build?: string;
}

export interface PersistenceHandle {
  /**
   * Ghi mà không chờ nhịp gom. Thường thì **xếp hàng** sau các thao tác kho đang dở (hai lần ghi
   * không bao giờ đua nhau). `fatal` ⇒ **ghi thẳng, không xếp hàng** (app sắp chết, không chờ được
   * bước khởi động) và đánh dấu phiên chết vì lỗi JS fatal — dấu này **dính** tới hết phiên.
   */
  flush: (fatal?: boolean) => Promise<void>;
  /**
   * Xoá mọi file phiên + quên phiên trước, và **mở phiên mới**: dòng đang có trong RAM không bao
   * giờ được ghi xuống đĩa nữa (vẫn xem được trên màn cho tới khi bị đạp ra).
   */
  clearAll: () => Promise<void>;
  stop: () => void;
  /** Xong bước khởi động (đọc phiên trước + dọn kho). Test chờ cái này. */
  ready: Promise<void>;
}

/* -------------------------------------------------- phiên trước (store ngoài React) */

let previous: StoredSession | null = null;
const listeners = new Set<() => void>();

const setPrevious = (next: StoredSession | null) => {
  previous = next;
  listeners.forEach((l) => l());
};

/**
 * Phiên **trước** đọc được lúc khởi động — nguồn của hàng "Phiên trước" và dải báo crash ở panel.
 * Store ngoài React cùng khuôn với `logBuffer` (đọc bằng `useSyncExternalStore`).
 */
export const previousSession = {
  get: (): StoredSession | null => previous,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

let active: PersistenceHandle | null = null;
/** Kho của lần `startPersistence` đang chạy — cùng vòng đời với `active`. */
let activeStore: LogStore | undefined;

/** Số thao tác cuối của QA ghi kèm phiên (spec: lưu 30 bước khi crash). */
export const PERSISTED_ACTIONS = 30;

/**
 * **Chức năng:** kho file của lần `startPersistence` đang chạy — để nơi khác (hàng đợi bug report)
 * ghi chung một thư mục mà app đã cài, không bắt app khai kho lần hai.
 *
 * **Input:** không. **Output:** `LogStore`, hoặc `undefined` khi chưa bật lưu / đã `stop`.
 *
 * @example
 * ```ts
 * activePersistStore();   // appLogStore khi đang chạy
 * activePersistStore();   // ca biên: undefined sau handle.stop()
 * ```
 *
 * **Unit test:** `log-persist.test.ts` › `activePersistStore` — 1 case: trả kho khi đang chạy,
 * `undefined` sau khi dừng.
 */
export const activePersistStore = (): LogStore | undefined => activeStore;

/**
 * Trần thời gian cho **một** lời gọi kho. Mọi thao tác xếp hàng qua một chuỗi, nên một lời gọi
 * native treo mãi (thẻ nhớ lỗi, module kẹt) sẽ chặn **mọi** lần ghi sau — kể cả lần ghi của phiên
 * crash. Quá trần ⇒ reject, chuỗi đi tiếp.
 */
export const STORE_TIMEOUT_MS = 5000;

/** `name` của lỗi {@link withStoreTimeout} ném khi quá trần — để chỗ gọi phân biệt "kho treo". */
export const STORE_TIMEOUT_ERROR = 'LogStoreTimeoutError';

/**
 * Bọc một lời gọi kho với trần {@link STORE_TIMEOUT_MS}: quá trần ⇒ reject `Error` có
 * `name === STORE_TIMEOUT_ERROR` (lời gọi native vẫn chạy tiếp, chỉ không ai đợi nó nữa). Dùng chung
 * cho ghi phiên và hàng đợi gửi báo bug (`send-queue.ts`). Nội bộ — không xuất ở entry `capture`.
 */
export const withStoreTimeout = <T>(work: Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('log store timeout');
      error.name = STORE_TIMEOUT_ERROR;
      reject(error);
    }, STORE_TIMEOUT_MS);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });

const withTimeout = withStoreTimeout;

/** Xoá từng file, **mỗi file một lượt riêng**: một file xoá hỏng không được giữ lại các file sau. */
const removeEach = async (store: LogStore, names: readonly string[]): Promise<void> => {
  for (const n of names) {
    try {
      await withTimeout(store.remove(n));
    } catch {
      /* Để lần khởi động sau dọn tiếp. */
    }
  }
};

/**
 * **Chức năng:** lưu nhật ký xuống đĩa theo **phiên** (mỗi lần mở app một file), tự dọn theo
 * luật, và đọc lại phiên trước lúc khởi động — để app crash xong mở lại vẫn còn thấy chuyện gì
 * đã xảy ra.
 *
 * ## Ghi gì · khi nào · dọn ra sao
 *
 * | | Luật |
 * |---|---|
 * | Ghi gì | mọi dòng lỗi + `contextSize` dòng cuối, **đã che** (`redactEntry`) + `PERSISTED_ACTIONS` thao tác cuối của QA (ảnh chụp `actionBuffer` lúc ghi, nhãn đã che sẵn) |
 * | Khi nào | gom: `flushMs` sau thay đổi đầu tiên; ghi thẳng khi lỗi fatal (`flush(true)`) |
 * | Trần | `maxBytes` mỗi file — vượt thì bỏ dòng thường cũ trước, lỗi sau |
 * | Dọn lúc khởi động | quá `ttlHours` ⇒ xoá; vượt `maxSessions` ⇒ xoá phiên cũ nhất |
 * | Đăng xuất | app gọi `clearPersistedLogs()` ⇒ xoá hết + mở phiên mới |
 *
 * Ghi **đè cả file** mỗi lượt chứ không nối đuôi: file ≤ 1 MB, gom 2 giây một lần, và đè thì
 * không bao giờ có file nửa vời ghép từ hai lần ghi (ca nối đuôi bị chết giữa chừng).
 *
 * 🔴 Chỉ chạy khi app **tự bật** (`startCapture({ persist })`) — lib không tự hỏi môi trường.
 * Ghi dữ liệu xuống đĩa của app xử lý dữ liệu nhạy cảm là quyết định nên có bảo mật duyệt.
 *
 * **Input:** `buffer` · {@link PersistOptions}.
 * **Output:** {@link PersistenceHandle}. Gọi lần hai khi phiên trước chưa `stop` ⇒ trả **chính**
 * handle đang chạy (không mở hai phiên ghi cùng lúc).
 *
 * @example
 * ```ts
 * const p = startPersistence(logBuffer, { store: appLogStore, build: 'UAT · 1.0.2' });
 * await p.ready;          // phiên trước (nếu có) đã nằm trong `previousSession`
 * await p.flush(true);    // ghi ngay, đánh dấu fatal
 * // Ca biên: kho reject mọi lời gọi ⇒ không ném, chỉ là không có gì được lưu.
 * ```
 *
 * ## Bốn chốt chống mất dữ liệu (sửa 24/9/2026 sau lượt soát bằng test)
 *
 * - Lần ghi **fatal** không xếp hàng sau bước khởi động — ghi thẳng.
 * - Dấu `fatal` **dính**: lần ghi gom về sau không xoá nó.
 * - `clearAll` chen vào lúc khởi động ⇒ kết quả đọc phiên trước bị **bỏ** (đếm thế hệ).
 * - Mỗi lời gọi kho có trần 5 giây, mỗi file xoá một lượt riêng: một lời gọi treo/hỏng không chặn
 *   phần còn lại.
 *
 * **Unit test:** `log-persist.test.ts` › `startPersistence` — 16 case: khởi động đọc phiên trước
 * vào `previousSession` · khởi động xoá file quá hạn · thay đổi trong buffer được gom thành **một**
 * lần ghi · file ghi xuống đã che `Authorization` · `flush(true)` ghi `fatal: true` · `clearAll`
 * xoá file, quên phiên trước, và dòng cũ không bao giờ được ghi lại · kho reject không làm ném ·
 * ⭐ dấu `fatal` còn nguyên sau một lần ghi gom về sau · ⭐ `clearAll` chen vào lúc khởi động thì
 * phiên trước không sống lại · ⭐ một file xoá hỏng không giữ lại các file quá hạn khác · 5 case `thao tác của QA` (40 thao tác ⇒ 30 cuối · `flush(true)` ghi cả
 * `actions` · nhãn xuống file đúng chuỗi đã che · bộ đệm trống ⇒ mảng rỗng · `clearAll` loại thao
 * tác của người trước) · 1 case `activePersistStore`.
 */
export const startPersistence = (
  buffer: LogBuffer,
  options: PersistOptions,
): PersistenceHandle => {
  if (active) return active;

  const {
    store,
    ttlHours = 72,
    maxSessions = 3,
    maxBytes = 1_000_000,
    contextSize = 50,
    flushMs = 2000,
    build,
  } = options;
  const ttlMs = ttlHours * 3_600_000;

  let startedAt = Date.now();
  let name = sessionFileName(startedAt);
  /** Dòng có `id <= floorId` thuộc về trước lần `clearAll` gần nhất — không ghi xuống đĩa nữa. */
  let floorId = 0;
  /** Thao tác có `at < actionsFloor` thuộc về trước lần `clearAll` gần nhất — cùng ý với `floorId`. */
  let actionsFloor = 0;
  /**
   * Đã gặp lỗi fatal trong phiên này — **dính**: một lần ghi gom về sau (ở dev, RedBox vẫn để JS
   * chạy tiếp và `console.error` của RN vào buffer ⇒ gom lại chạy) không được xoá dấu đó, nếu không
   * dải báo crash ở lần mở sau không bao giờ hiện.
   */
  let fatalSeen = false;
  /**
   * Thế hệ kho — tăng mỗi lần `clearAll`. Bước khởi động chụp thế hệ lúc bắt đầu và **bỏ** kết quả
   * nếu `clearAll` đã chạy chen vào (đăng xuất tự động ngay lúc mở app), để phiên của người vừa
   * đăng xuất không sống lại trong `previousSession`.
   */
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  /* Mọi thao tác kho (trừ lần ghi fatal) xếp hàng qua MỘT chuỗi: hai lần ghi không bao giờ đua
     nhau, và lần ghi sau luôn là lần thắng. */
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (job: () => Promise<void>): Promise<void> => {
    chain = chain.then(job).catch(() => undefined);
    return chain;
  };

  /**
   * Nội dung file của phiên **tại lúc gọi** — `undefined` khi không có gì để ghi. Dựng lúc job
   * CHẠY chứ không lúc xếp hàng: job xếp sau một lần ghi fatal vẫn chứa dòng fatal, không đè file
   * bằng một ảnh chụp cũ hơn.
   */
  const buildText = (): string | undefined => {
    const all = buffer.snapshot();
    const mine = floorId ? all.filter((e) => e.id > floorId) : all;
    if (mine.length === 0) return undefined;
    const session: StoredSession = {
      format: SESSION_FORMAT,
      name,
      startedAt,
      savedAt: Date.now(),
      fatal: fatalSeen,
      build,
      totalInMemory: mine.length,
      entries: pickForPersist(mine, contextSize).map(redactEntry),
      /* Nhãn trong bộ đệm đã che từ lúc vào (Task 2/3) — ghi nguyên, không che lần hai. */
      actions: actionBuffer
        .snapshot()
        .filter((a) => a.at >= actionsFloor)
        .slice(-PERSISTED_ACTIONS),
    };
    return serializeSession(session, maxBytes);
  };

  const flush = (fatal = false): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (stopped) return chain;
    if (fatal) {
      fatalSeen = true;
      /* Ghi THẲNG, không xếp hàng: app sắp chết và chỉ có `FATAL_FLUSH_BUDGET_MS` — không chờ nổi
         bước khởi động (liệt kê · đọc · xoá) nếu crash xảy ra ngay lúc mở app. */
      const text = buildText();
      return text ? withTimeout(store.write(name, text)).catch(() => undefined) : chain;
    }
    return enqueue(async () => {
      const text = buildText();
      if (text) await withTimeout(store.write(name, text));
    });
  };

  const unsubscribe = buffer.subscribe(() => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, flushMs);
  });

  const startGeneration = generation;
  const ready = enqueue(async () => {
    const files = await withTimeout(store.list());
    const now = Date.now();
    const current = name;
    /* Đọc phiên trước và dọn là hai việc ĐỘC LẬP: đọc hỏng không được làm bỏ qua việc dọn. */
    const prevName = pickPrevious(files, { now, ttlMs, current });
    if (prevName) {
      try {
        const prev = parseSession(await withTimeout(store.read(prevName)));
        if (generation === startGeneration) setPrevious(prev);
      } catch {
        /* File phiên trước hỏng/không đọc được ⇒ coi như không có. */
      }
    }
    await removeEach(store, planPrune(files, { now, ttlMs, maxSessions, current }));
  });

  const clearAll = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    generation += 1;
    fatalSeen = false;
    actionsFloor = Date.now();
    const all = buffer.snapshot();
    /* Không dùng `.at(-1)`: `lib` của tsconfig đích dưới ES2022. */
    floorId = all.length ? all[all.length - 1].id : floorId;
    startedAt = Date.now();
    name = sessionFileName(startedAt);
    setPrevious(null);
    return enqueue(async () => {
      const files = await withTimeout(store.list());
      await removeEach(
        store,
        files.map((f) => f.name).filter(isSessionFile),
      );
    });
  };

  const handle: PersistenceHandle = {
    flush,
    clearAll,
    ready,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      if (active === handle) {
        active = null;
        activeStore = undefined;
      }
    },
  };
  active = handle;
  activeStore = store;
  return handle;
};

/**
 * **Chức năng:** ghi ngay phiên đang chạy — dùng khi app sắp chết (lỗi fatal). Chưa bật lưu ⇒
 * Promise đã xong, không làm gì.
 *
 * **Input:** `fatal?`. **Output:** `Promise<void>`, không bao giờ reject.
 *
 * @example
 * ```ts
 * tapGlobalErrors(() => flushPersistedLogs(true));
 * ```
 *
 * **Unit test:** `log-persist.test.ts` › `startPersistence` — phủ qua case `flush(true)`.
 */
export const flushPersistedLogs = (fatal = false): Promise<void> =>
  active ? active.flush(fatal) : Promise.resolve();

/**
 * **Chức năng:** xoá mọi nhật ký đã lưu trên đĩa và mở phiên mới — app gọi ở **hook đăng xuất**.
 *
 * Vì sao phải có: thân response là dữ liệu khách hàng của người vừa đăng nhập. Người sau đăng nhập
 * trên cùng máy không được mở "Phiên trước" ra xem — cùng lý do app xoá lịch sử tìm kiếm khi
 * đăng xuất.
 *
 * Nhật ký trong **RAM** thì giữ (vẫn xem được trên màn): người đang gỡ lỗi luồng đăng xuất cần
 * thấy chính những dòng đó. Chúng chỉ không bao giờ được ghi xuống đĩa nữa.
 *
 * **Thao tác của QA** (`actionBuffer`) thì xoá luôn trong RAM, kể cả khi chưa bật lưu: form báo bug
 * đọc thẳng bộ đệm đó, nên bug của người sau không được mang các bước của người trước (nhãn chạm có
 * thể là tên, số điện thoại đã che một phần của khách vừa đăng xuất).
 *
 * **Input:** không. **Output:** `Promise<void>`, không reject. Chưa bật lưu ⇒ chỉ xoá trong RAM.
 *
 * @example
 * ```ts
 * onLogout(() => { void clearPersistedLogs(); });   // `onLogout`: hook đăng xuất của app
 * ```
 *
 * **Unit test:** `log-persist.test.ts` › `startPersistence` — phủ qua case `clearAll`; ›
 * `clearPersistedLogs` — 1 case: thao tác trong RAM bị xoá, có hay không bật lưu.
 */
export const clearPersistedLogs = (): Promise<void> => {
  /* Đăng xuất ⇒ thân đầy đủ (RAM) của người trước cũng đi — nó chứa dữ liệu nghiệp vụ thô. */
  fullBodies.clear();
  actionBuffer.clear();
  return active ? active.clearAll() : Promise.resolve();
};
