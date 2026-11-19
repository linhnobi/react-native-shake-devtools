import type { DevToolsLocale } from '../../i18n/types';
import type { ConnectorValues } from '../connectors/types';

/**
 * Kho kết nối của QA (spec 5.4 tầng "kết nối", 5.5): danh sách kết nối **không bí mật** và từng
 * bộ bí mật cùng nằm trong `secureStore` do app cấp (Keychain/Keystore). Lib không tự lưu gì ở
 * AsyncStorage hay bộ nhớ thường.
 */

/**
 * Kho bảo mật do app cấp (`config.bugReport.secureStore`) — cài bằng `react-native-keychain`,
 * `expo-secure-store` hoặc tương đương.
 */
export interface DevToolsSecureStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Một kết nối QA đã lưu. `values` KHÔNG chứa ô bí mật — chúng ở `ConnectionStore.secrets`. */
export interface StoredConnection {
  readonly id: string;
  /** `ConnectorType.id` của loại kết nối. */
  readonly typeId: string;
  readonly name: string;
  /** Ngôn ngữ ticket của kết nối này (spec 11.2). */
  readonly ticketLocale: DevToolsLocale;
  readonly values: ConnectorValues;
  readonly createdAt: number;
}

export interface ConnectionStore {
  list(): Promise<readonly StoredConnection[]>;
  save(c: StoredConnection, secrets: ConnectorValues): Promise<void>;
  remove(id: string): Promise<void>;
  secrets(id: string): Promise<ConnectorValues | null>;
  lastUsed(): Promise<string | null>;
  setLastUsed(id: string): Promise<void>;
  /**
   * Xoá **mọi** kết nối: danh sách, kết nối dùng gần nhất và bí mật của mọi id còn đọc được. Lối
   * thoát khi danh sách đã lưu bị hỏng (`save`/`remove` ném {@link ConnectionListCorruptError}) —
   * chỉ gọi khi QA bấm "Đặt lại kết nối", không bao giờ tự gọi (ruling R18).
   */
  resetAll(): Promise<void>;
}

/**
 * Danh sách kết nối đã lưu không đọc được (JSON hỏng, hoặc không phải mảng) — khác với lỗi kho thoáng
 * qua (khoá máy, huỷ sinh trắc): lỗi này không tự hết, UI đưa nút "Đặt lại kết nối" (`resetAll`).
 *
 * **Chức năng:** `Error` riêng để UI phân biệt bằng `instanceof` / {@link isConnectionListCorrupt}.
 * `Object.setPrototypeOf` vì Babel của RN có thể hạ lớp xuống ES5 (như `ConnectorError`).
 *
 * @example
 * ```ts
 * await store.save(c, s).catch((e) => isConnectionListCorrupt(e) && showReset());
 * ```
 *
 * **Unit test:** `connection-store.test.ts` › `ConnectionListCorruptError` — 2 case: JSON hỏng/không
 * phải mảng ⇒ save/remove ném lỗi này · kho ném khi đọc ⇒ không phải lỗi này.
 */
export class ConnectionListCorruptError extends Error {
  constructor() {
    super('Stored connection list is corrupted');
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ConnectionListCorruptError';
  }
}

/**
 * **Chức năng:** `error` có phải {@link ConnectionListCorruptError} không (danh sách hỏng, cần đặt lại).
 *
 * **Input:** lỗi bất kỳ. **Output:** `boolean`.
 *
 * @example
 * isConnectionListCorrupt(new ConnectionListCorruptError()); // true
 * isConnectionListCorrupt(new Error('get failed'));          // false — lỗi kho thoáng qua
 *
 * **Unit test:** `connection-store.test.ts` › `ConnectionListCorruptError` — trong 2 case trên.
 */
export const isConnectionListCorrupt = (error: unknown): error is ConnectionListCorruptError =>
  error instanceof ConnectionListCorruptError;

/**
 * Kho bảo mật **ném khi đọc** trên đường ghi (`save`/`remove`) — thoáng qua (khoá máy, huỷ sinh trắc)
 * hoặc vĩnh viễn (khoá Keystore Android bị hệ điều hành thu hồi: `getItem` ném mãi). Một lần thì chưa
 * biết là loại nào; UI đếm số lần liền nhau để quyết định đưa "Đặt lại kết nối" (ruling R39).
 *
 * **Chức năng:** `Error` riêng, `message` giữ nguyên thông điệp lỗi gốc của kho (không chứa bí mật —
 * kho chỉ đọc khoá danh sách / kết nối dùng gần nhất). `Object.setPrototypeOf` như các lớp lỗi khác.
 *
 * @example
 * ```ts
 * await store.save(c, s).catch((e) => isConnectionStoreReadError(e) && countReadFailure());
 * ```
 *
 * **Unit test:** `connection-store.test.ts` › `ConnectionStoreReadError` — 1 case: kho ném khi đọc lúc
 * save/remove ⇒ lỗi này, giữ thông điệp gốc; JSON hỏng / lỗi ghi ⇒ không phải lỗi này.
 */
export class ConnectionStoreReadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Secure store read failed');
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ConnectionStoreReadError';
  }
}

/**
 * **Chức năng:** `error` có phải {@link ConnectionStoreReadError} không (đọc kho hỏng trên đường ghi).
 *
 * **Input:** lỗi bất kỳ. **Output:** `boolean`.
 *
 * @example
 * isConnectionStoreReadError(new ConnectionStoreReadError(new Error('get failed'))); // true
 * isConnectionStoreReadError(new ConnectionListCorruptError());                      // false
 *
 * **Unit test:** `connection-store.test.ts` › `ConnectionStoreReadError` — trong case trên.
 */
export const isConnectionStoreReadError = (error: unknown): error is ConnectionStoreReadError =>
  error instanceof ConnectionStoreReadError;

const LIST_KEY = 'devtools.connections.v1';
const SECRET_KEY_PREFIX = 'devtools.secret.';
const LAST_KEY = 'devtools.lastConnection';

const secretKey = (id: string): string => `${SECRET_KEY_PREFIX}${id}`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStoredConnection = (v: unknown): v is StoredConnection =>
  isRecord(v) &&
  typeof v.id === 'string' &&
  typeof v.typeId === 'string' &&
  typeof v.name === 'string' &&
  (v.ticketLocale === 'vi' || v.ticketLocale === 'en') &&
  isRecord(v.values) &&
  typeof v.createdAt === 'number';

/**
 * Tạo kho kết nối trên `DevToolsSecureStore`.
 *
 * **Chức năng:** lưu/đọc/xoá kết nối; bí mật của mỗi kết nối là MỘT chuỗi JSON ở
 * `devtools.secret.<id>`; danh sách không bí mật ở `devtools.connections.v1`; kết nối dùng gần nhất
 * ở `devtools.lastConnection`.
 * - Đọc (`list`/`secrets`/`lastUsed`) không bao giờ ném: kho lỗi hoặc JSON hỏng ⇒ `[]`/`null`.
 * - Đường ghi (`save`/`remove`) đọc nghiêm ngặt: đọc lỗi hoặc JSON danh sách hỏng ⇒ ném và không
 *   ghi gì (không bao giờ coi lỗi đọc là "danh sách rỗng" để ghi đè).
 * - Ghi (`save`/`remove`/`setLastUsed`) ném lại lỗi của kho để UI hiện ra, và được xếp hàng tuần tự
 *   (một lần ghi hỏng không làm kẹt các lần sau) nên hai `save` liền nhau không làm mất kết nối.
 * - `save` ném `Error` nếu `values` chứa ô bí mật (id lấy từ `secretFieldIdsOf`). Thông điệp chỉ nêu
 *   **id ô**, không bao giờ nêu giá trị; kiểm tra trước khi ghi nên không ghi gì.
 * - Kho ném khi đọc trên đường ghi ⇒ `ConnectionStoreReadError` (giữ thông điệp gốc), để UI phân biệt
 *   với lỗi ghi và đếm số lần đọc hỏng liền nhau (R39).
 * - Danh sách đã lưu hỏng (JSON hỏng / không phải mảng) ⇒ `save`/`remove` ném
 *   `ConnectionListCorruptError` (mãi mãi, không tự reset). Lối thoát là `resetAll`, do QA bấm: xoá
 *   bí mật của mọi id còn đọc được (kể cả phần tử sai hình dạng), rồi kết nối dùng gần nhất, rồi
 *   danh sách. Đọc lỗi ⇒ vẫn xoá hai khoá sau; xoá lỗi ⇒ ném (danh sách còn để thử lại).
 *
 * **Input:** `store` — kho bảo mật của app; `opts.secretFieldIdsOf(typeId)` — id các ô `secret` của
 * loại kết nối.
 *
 * **Output:** `ConnectionStore`.
 *
 * @example
 * const cs = createConnectionStore(secureStore, { secretFieldIdsOf: (t) => registry.get(t).secretIds });
 * await cs.save({ id: 'a', typeId: 'jira', name: 'Jira', ticketLocale: 'vi', values: { baseUrl }, createdAt: Date.now() }, { token });
 * await cs.list(); // [{ id: 'a', ... }]  (không có token)
 *
 * **Unit test:** `connection-store.test.ts` — 31 ca (save/list, JSON bí mật, ném khi lẫn bí mật,
 * thay tại chỗ + thứ tự, remove + khoá bí mật, remove xoá lastConnection, JSON hỏng/sai hình dạng,
 * bí mật hỏng, kho ném khi đọc/ghi, hàng đợi không kẹt, hai save liền nhau, lastUsed, giữ kiểu
 * values, đọc lỗi và JSON hỏng lúc save/remove, ConnectionStoreReadError ×1,
 * ConnectionListCorruptError ×2, resetAll ×6 (xoá đủ
 * ba loại khoá · JSON hỏng rồi save lại được · phần tử sai hình dạng còn id · đọc lỗi · xoá lỗi rồi
 * thử lại · xếp hàng sau save), maskSecret ×3).
 */
export const createConnectionStore = (
  store: DevToolsSecureStore,
  opts: { secretFieldIdsOf: (typeId: string) => readonly string[] },
): ConnectionStore => {
  /** Chuỗi hứa hẹn tuần tự hoá mọi lần ghi; luôn "xanh" để lỗi lần trước không chặn lần sau. */
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(op: () => Promise<T>): Promise<T> => {
    const run = chain.then(op);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  /**
   * Đọc **nghiêm ngặt** cho đường ghi: chỉ `null` (chưa có gì) mới là `[]`. Lỗi kho (khoá máy, huỷ
   * sinh trắc, lỗi native thoáng qua) hay JSON hỏng đều ném — nếu nuốt thành `[]` thì `save` sẽ ghi
   * đè và làm mất mọi kết nối khác. Phần tử sai hình dạng (không dùng được) bị bỏ.
   */
  /** `getItem` cho đường ghi: kho ném ⇒ `ConnectionStoreReadError` (UI đếm lỗi đọc liền nhau, R39). */
  const readForWrite = async (key: string): Promise<string | null> => {
    try {
      return await store.getItem(key);
    } catch (error) {
      throw new ConnectionStoreReadError(error);
    }
  };

  const readListStrict = async (): Promise<StoredConnection[]> => {
    const raw = await readForWrite(LIST_KEY);
    if (raw === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ConnectionListCorruptError();
    }
    if (!Array.isArray(parsed)) throw new ConnectionListCorruptError();
    return parsed.filter(isStoredConnection);
  };

  /**
   * Id của mọi phần tử còn mang `id` chuỗi trong danh sách thô — kể cả phần tử sai hình dạng (để
   * `resetAll` xoá được bí mật của chúng). Đọc lỗi / JSON hỏng ⇒ `[]`.
   */
  const readIdsLoose = async (): Promise<string[]> => {
    try {
      const raw = await store.getItem(LIST_KEY);
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((x: unknown) =>
        isRecord(x) && typeof x.id === 'string' ? [x.id] : [],
      );
    } catch {
      return [];
    }
  };

  /** Đọc cho người xem: không bao giờ ném (lỗi kho / JSON hỏng ⇒ `[]`). */
  const readList = async (): Promise<StoredConnection[]> => {
    try {
      return await readListStrict();
    } catch {
      return [];
    }
  };

  const readLast = async (): Promise<string | null> => {
    try {
      return await store.getItem(LAST_KEY);
    } catch {
      return null;
    }
  };

  return {
    list: readList,

    save: async (c, secrets) => {
      const leaked = opts.secretFieldIdsOf(c.typeId).find((id) => id in c.values);
      if (leaked !== undefined) {
        throw new Error(
          `Connection values must not contain the secret field "${leaked}"; pass it in secrets instead`,
        );
      }
      await enqueue(async () => {
        const list = await readListStrict();
        const at = list.findIndex((x) => x.id === c.id);
        const next = at >= 0 ? list.map((x, i) => (i === at ? c : x)) : [...list, c];
        // Bí mật trước, danh sách sau: ghi danh sách lỗi chỉ để lại một bí mật mồ côi (vô hại),
        // ngược lại sẽ để lại kết nối không có bí mật.
        await store.setItem(secretKey(c.id), JSON.stringify(secrets));
        await store.setItem(LIST_KEY, JSON.stringify(next));
      });
    },

    remove: (id) =>
      enqueue(async () => {
        // Đọc hết (nghiêm ngặt) trước khi ghi/xoá bất cứ thứ gì: đọc lỗi ⇒ ném, không xoá nửa chừng.
        const list = await readListStrict();
        const last = await readForWrite(LAST_KEY);
        if (list.some((x) => x.id === id)) {
          await store.setItem(LIST_KEY, JSON.stringify(list.filter((x) => x.id !== id)));
        }
        // Luôn thử xoá bí mật, kể cả khi id đã khỏi danh sách: gọi lại sau lần xoá dở vẫn dọn được.
        await store.removeItem(secretKey(id));
        if (last === id) await store.removeItem(LAST_KEY);
      }),

    secrets: async (id) => {
      try {
        const raw = await store.getItem(secretKey(id));
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        return isRecord(parsed) ? (parsed as ConnectorValues) : null;
      } catch {
        return null;
      }
    },

    lastUsed: readLast,

    setLastUsed: (id) => enqueue(() => store.setItem(LAST_KEY, id)),

    resetAll: () =>
      enqueue(async () => {
        // Bí mật trước, danh sách sau: xoá giữa chừng hỏng thì danh sách còn đó để lần sau tìm lại id.
        // Danh sách không đọc được ⇒ không biết id nào: bí mật của chúng thành mồ côi (kho không
        // liệt kê được khoá) — vô hại, không còn kết nối nào trỏ tới.
        for (const id of await readIdsLoose()) await store.removeItem(secretKey(id));
        await store.removeItem(LAST_KEY);
        await store.removeItem(LIST_KEY);
      }),
  };
};

/**
 * Dạng hiển thị của bí mật đã lưu (spec 5.5): `••••` + 4 ký tự cuối.
 *
 * **Chức năng:** không bao giờ in bí mật ra màn hình sau khi lưu. Chuỗi ≤ 4 ký tự ⇒ chỉ `••••`
 * (không lộ gì). Đếm theo ký tự Unicode nên không cắt đôi emoji.
 *
 * **Input:** `value` — bí mật. **Output:** chuỗi che.
 *
 * @example
 * maskSecret('xoxb-123456'); // '••••3456'
 * maskSecret('abcd'); // '••••'
 *
 * **Unit test:** `connection-store.test.ts` — 3 ca (ví dụ trên, ≤ 4 ký tự, đúng 5 ký tự).
 */
export const maskSecret = (value: string): string => {
  const chars = Array.from(value);
  return chars.length <= 4 ? '••••' : `••••${chars.slice(-4).join('')}`;
};
