import type { DevToolsLocale } from '../i18n/types';
import {
  STORE_TIMEOUT_ERROR,
  STORE_TIMEOUT_MS,
  withStoreTimeout,
  type LogStore,
} from '../capture/log-persist';
import type { BugReport } from './bug-report';
import type { ConnectionStore, StoredConnection } from './connections/connection-store';
import {
  ConnectorError,
  type ConnectorErrorKind,
  type ConnectorType,
  type ConnectorValues,
  type SendContext,
  type SendResult,
} from './connectors/types';

/**
 * Trạng thái một bản báo trong hàng đợi.
 *
 * - `sending`: đang gửi (mỗi mục chỉ có tối đa một lần gửi đang bay).
 * - `pending`: chờ gửi lại tự động (lỗi `network`/`rate-limit`, hoặc `uncertain` khi
 *   `resume.committed`).
 * - `uncertain`: request **có thể đã tới** đích mà bước không đảo ngược chưa được đánh dấu xong
 *   (`resume.committed`) ⇒ **không** tự gửi lại, chỉ `retryNow` (QA kiểm tra đích trước).
 * - `failed`: hết `MAX_ATTEMPTS` lần, hoặc lỗi lạ ⇒ chỉ còn gửi tay / Chia sẻ.
 * - `sent`: xong, giữ `result` 24 giờ để màn hình còn hiện link.
 * - `blocked`: `auth`/`permission`/`validation` hoặc kết nối không còn ⇒ QA phải sửa rồi gửi tay.
 */
export type QueueState = 'sending' | 'pending' | 'uncertain' | 'failed' | 'sent' | 'blocked';

/** Một bản báo trong hàng đợi — bất biến; mỗi lần đổi trạng thái là một đối tượng mới. */
export interface QueuedReport {
  readonly report: BugReport;
  readonly connectionId: string;
  readonly state: QueueState;
  /** Số lần connector thực sự được gọi (lần thiếu kết nối không tính). */
  readonly attempts: number;
  /**
   * Tiến độ connector đã `checkpoint` (vd `issueKey`, `fileIds`). `committed: true` ⇒ bước không
   * đảo ngược đã xong (R34); thiếu cờ đó thì chỉ là tiến độ upload.
   */
  readonly resume?: Readonly<Record<string, unknown>>;
  readonly result?: SendResult;
  readonly lastError?: {
    readonly kind: ConnectorErrorKind | 'connection-missing';
    readonly message: string;
    readonly field?: string;
  };
  /** Mốc (epoch ms) `retryDue` được phép gửi lại; chỉ có ở `pending`. */
  readonly nextAttemptAt?: number;
  /** Mốc gửi xong — để bỏ mục `sent` quá 24 giờ khi `load` (ruling R25). */
  readonly sentAt?: number;
}

/** Tên file hàng đợi trong `LogStore`. Dọn phiên chỉ đụng `session-*.json` nên file này an toàn. */
export const QUEUE_FILE = 'report-queue.json';
/** Tên file giữ lại bản hỏng (kho không có "đổi tên", nên ghi bản sao rồi xoá file gốc). */
const CORRUPT_FILE = 'report-queue.corrupt.json';
export const RETRY_EVERY_MS = 60_000;
export const MAX_ATTEMPTS = 5;
/** Mục `sent` cũ hơn ngần này bị bỏ khi `load`. */
const SENT_TTL_MS = 24 * 3600_000;
const QUEUE_FORMAT = 1;

export interface SendQueue {
  /** Đọc hàng đợi từ `store` (nếu có). Không bao giờ ném. */
  load(): Promise<void>;
  /** Thêm bản báo rồi gửi. Cùng `report.id` đã có ⇒ trả đúng mục đang có, không gửi lần hai. */
  submit(report: BugReport, connectionId: string): Promise<QueuedReport>;
  /** Gửi các mục `pending` đã đến hạn. Do cổng gọi định kỳ — hàng đợi không tự đặt timer. */
  retryDue(): Promise<void>;
  /** Gửi ngay một mục (mọi trạng thái trừ `sending`/`sent`) — đường duy nhất cho `uncertain`. */
  retryNow(reportId: string): Promise<QueuedReport>;
  discard(reportId: string): Promise<void>;
  /** Ảnh chụp ổn định: cùng tham chiếu cho tới khi hàng đợi đổi (dùng được với `useSyncExternalStore`). */
  items(): readonly QueuedReport[];
  /**
   * Hàng đợi chỉ nằm trong RAM: không có `store`, hoặc kho **đọc** treo (`list()`/`read()` quá 5 s)
   * ⇒ không đọc, không ghi kho nữa cho tới hết lần chạy. Ghi chậm không bao giờ làm cờ này bật.
   * Đổi sang `true` thì người nghe được báo.
   */
  ramOnly(): boolean;
  subscribe(l: () => void): () => void;
}

const STATES: readonly QueueState[] = [
  'sending',
  'pending',
  'uncertain',
  'failed',
  'sent',
  'blocked',
];
const ERROR_KINDS: readonly string[] = [
  'auth',
  'permission',
  'validation',
  'network',
  'uncertain',
  'rate-limit',
  'unknown',
  'connection-missing',
];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Đọc một phần tử đã lưu; sai hình dạng ⇒ `null` (bỏ). Chỉ giữ các trường của `QueuedReport`. */
const parseItem = (v: unknown): QueuedReport | null => {
  if (!isRecord(v) || !isRecord(v.report)) return null;
  const r = v.report;
  if (
    typeof r.id !== 'string' ||
    typeof r.title !== 'string' ||
    !Array.isArray(r.files) ||
    !Array.isArray(r.steps)
  ) {
    return null;
  }
  if (typeof v.connectionId !== 'string' || typeof v.attempts !== 'number') return null;
  if (!STATES.includes(v.state as QueueState)) return null;
  const le = v.lastError;
  return {
    report: r as unknown as BugReport,
    connectionId: v.connectionId,
    state: v.state as QueueState,
    attempts: v.attempts,
    ...(isRecord(v.resume) ? { resume: v.resume } : {}),
    ...(isRecord(v.result) ? { result: v.result as SendResult } : {}),
    ...(isRecord(le) && typeof le.message === 'string' && ERROR_KINDS.includes(le.kind as string)
      ? {
          lastError: {
            kind: le.kind as ConnectorErrorKind | 'connection-missing',
            message: le.message,
            ...(typeof le.field === 'string' ? { field: le.field } : {}),
          },
        }
      : {}),
    ...(typeof v.nextAttemptAt === 'number' ? { nextAttemptAt: v.nextAttemptAt } : {}),
    ...(typeof v.sentAt === 'number' ? { sentAt: v.sentAt } : {}),
  };
};

/**
 * Đợi `work` tối đa {@link STORE_TIMEOUT_MS}: xong (hay hỏng) trước thì về ngay, quá trần thì thôi
 * đợi — **việc vẫn chạy tiếp**. Không bao giờ ném.
 */
const waitAtMost = (work: Promise<unknown>): Promise<void> =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, STORE_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    work.then(done, done);
  });

const errorKind = (e: unknown): ConnectorErrorKind =>
  e instanceof ConnectorError ? e.kind : 'unknown';

/**
 * **Chức năng:** mục hàng đợi đã qua **bước không đảo ngược** — connector đánh dấu
 * `checkpoint({ …, committed: true })` đúng lúc ticket/tin đã nằm ở đích (ruling R34). Tiến độ upload
 * (Slack `fileIds`, Lark `imageKey`) không tính: bước cuối có thể chưa chạy, gửi lại tự động có thể
 * đăng trùng (R36). Một chỗ cho mọi nơi dùng luật này — hàng đợi (tự gửi lại `uncertain`, `sending`
 * lúc `load`), bộ điều khiển (gửi lại nháp `blocked`) và màn kết quả — để R34/R36 không lệch nhau.
 *
 * **Input:** `item` (hoặc `undefined`). **Output:** `true` khi `item.resume.committed === true`.
 *
 * @example
 * ```ts
 * isCommitted({ resume: { issueKey: 'DEMO-9', committed: true } });  // true
 * isCommitted({ resume: { fileIds: ['F0'] } });                       // ca biên: false
 * ```
 *
 * **Unit test:** `send-queue.test.ts` › `isCommitted` — 1 case (committed · chỉ upload · giá trị khác
 * `true` · vắng `resume` · `undefined`); phủ thêm qua R36 của hàng đợi và R34 ở
 * `report-controller.test.ts`.
 */
export const isCommitted = (item: Pick<QueuedReport, 'resume'> | undefined): boolean =>
  item?.resume?.committed === true;

/** Trạng thái QA phải ra tay (gửi lại · sửa kết nối · chia sẻ · bỏ) — hàng đợi không tự gửi lại. */
export const ATTENTION_STATES: ReadonlySet<QueueState> = new Set<QueueState>([
  'failed',
  'blocked',
  'uncertain',
]);
/** Trạng thái hàng đợi còn tự lo (đang gửi, hoặc chờ tới lượt gửi lại). */
export const WAITING_STATES: ReadonlySet<QueueState> = new Set<QueueState>(['pending', 'sending']);

/**
 * **Chức năng:** đếm bản báo **chưa gửi xong** của hàng đợi theo hai nhóm màn hình dùng — `attention`
 * (`failed` · `blocked` · `uncertain`: QA phải ra tay) và `waiting` (`pending` · `sending`: hàng đợi
 * tự lo). Bản `sent` không tính. Một chỗ cho dòng phụ hàng "Báo bug" của panel, banner của form và
 * trang Hàng đợi.
 *
 * `opts.ownDraftId` — `report.id` của nháp đang soạn: mục **`blocked`** cùng id không tính (form đang
 * hiện chính nháp đó và đã nói nó bị chặn; N4). Trạng thái khác cùng id vẫn tính.
 *
 * **Input:** `items` (vd `queue.items()`) · `opts?`. **Output:** `{ waiting, attention }`.
 *
 * @example
 * ```ts
 * queueCounts([{ state: 'pending' }, { state: 'failed' }, { state: 'sent' }]);   // { waiting: 1, attention: 1 }
 * queueCounts([]);                                                                // ca biên: { waiting: 0, attention: 0 }
 * ```
 *
 * **Unit test:** `send-queue.test.ts` › `queueCounts` — 2 case (rỗng · đủ sáu trạng thái ·
 * `ownDraftId` bỏ đúng mục `blocked` của nháp).
 */
export const queueCounts = (
  items: readonly Pick<QueuedReport, 'state' | 'report'>[],
  opts: { readonly ownDraftId?: string } = {},
): { readonly waiting: number; readonly attention: number } => {
  let waiting = 0;
  let attention = 0;
  for (const i of items) {
    if (i.state === 'blocked' && opts.ownDraftId !== undefined && i.report.id === opts.ownDraftId) {
      continue;
    }
    if (WAITING_STATES.has(i.state)) waiting += 1;
    else if (ATTENTION_STATES.has(i.state)) attention += 1;
  }
  return { waiting, attention };
};

/**
 * Thông điệp lưu vào `lastError`: chỉ tin `ConnectorError` (connector soạn, không bí mật); lỗi lạ
 * chỉ lấy tên lớp — `message` của nó có thể chứa URL/header.
 */
const errorMessage = (e: unknown): string =>
  e instanceof ConnectorError ? e.message : e instanceof Error ? e.name : 'Error';

/**
 * Hàng đợi gửi bản báo bug với luật gửi lại an toàn (spec 5.4.3, 5.6).
 *
 * **Chức năng:**
 * - `submit` gộp theo `report.id` (QA bấm Gửi hai lần / lắc lại ⇒ một ticket); mỗi mục chỉ có một
 *   lần gửi đang bay (`retryDue`/`retryNow` bỏ qua mục `sending`).
 * - Lỗi → trạng thái: `network` → `pending` (+60 s, tối đa `MAX_ATTEMPTS` rồi `failed`);
 *   `rate-limit` → `pending` theo `retryAfterMs`; `uncertain` → `uncertain` (chỉ `retryNow`), TRỪ khi
 *   connector đã đánh dấu `resume.committed` (R36, tinh chỉnh R23: ticket/tin đã nằm ở đích, gửi lại
 *   chỉ làm nốt) thì như `network`. Chỉ có tiến độ upload (Slack `fileIds`) thì vẫn `uncertain`;
 *   `auth`/`permission`/`validation` → `blocked` (giữ `field`); lỗi lạ → `failed`.
 * - Kết nối bị xoá, `secrets()` trả `null` hay loại kết nối không còn ⇒ `blocked` với
 *   `lastError.kind = 'connection-missing'`, giữ nguyên bản báo.
 * - Có `store` ⇒ ghi `QUEUE_FILE` sau mọi lần đổi (ghi tuần tự, lỗi ghi bị nuốt). File chỉ có bản báo
 *   và metadata, **không bao giờ có bí mật** (bí mật chỉ sống trong lúc gọi connector). Không có
 *   `store` ⇒ chỉ RAM.
 * - `load`: bỏ `sent` quá 24 giờ (R25); `sending` còn sót → `pending` nếu `resume.committed`, không
 *   thì `uncertain` (R26 theo luật R36); file hỏng ⇒ bắt đầu rỗng, giữ bản hỏng ở
 *   `report-queue.corrupt.json`.
 *   Đọc lỗi (hoặc chưa đọc xong) ⇒ **không bao giờ ghi đè** file: mục ở lại RAM, mỗi lần ghi sau
 *   thử đọc lại rồi gộp (RAM thắng khi trùng id); ghi luôn chờ lần đọc đang bay; `load` gọi lại được.
 * - **Đọc** kho (`list()`/`read()`) có trần 5 s (như `log-persist.ts`, M4). Quá trần ⇒ kho coi như
 *   **treo**: hàng đợi thành RAM-only cho tới hết lần chạy (`ramOnly()`, báo người nghe), `load()`
 *   vẫn xong (Gửi không kẹt ở "Đang chuẩn bị…"), không đọc/ghi kho nữa — chưa đọc được thì không bao
 *   giờ ghi đè file.
 * - **Ghi** không bao giờ bị bỏ giữa chừng (R46): chuỗi ghi tuần tự đợi lần ghi **thật**, nên ghi
 *   chậm chỉ làm lần ghi sau tới muộn và file luôn đuổi kịp bản mới nhất — một ảnh chụp cũ (`pending`)
 *   không bao giờ là thứ cuối cùng nằm trên đĩa (lần mở app sau sẽ gửi lại ⇒ ticket trùng). Chỉ thời
 *   gian **chỗ gọi chờ** (`patch`, `submit`, `discard`…) bị chặn ở 5 s, nên gửi không kẹt theo kho.
 * - Không timer, đồng hồ do `now` truyền vào: cổng lo gọi `retryDue`. Đăng xuất không xoá hàng đợi.
 *
 * **Input:** `deps.connections` · `deps.connectorTypes` (khớp `StoredConnection.typeId`) ·
 * `deps.makeSendContext(locale, resume, checkpoint, reportId)` (ngữ cảnh riêng của **từng** lần gửi —
 * `reportId` để file tạm của các bản gửi song song không đè nhau) · `deps.store?` · `deps.now`.
 *
 * **Output:** `SendQueue`.
 *
 * @example
 * const q = createSendQueue({ connections, connectorTypes, makeSendContext, store, now: Date.now });
 * await q.load();
 * const item = await q.submit(report, 'c1');   // 'sent' | 'pending' | 'blocked' | …
 * await q.retryDue();                          // cổng gọi mỗi 60 s / khi app lên lại
 *
 * **Unit test:** `send-queue.test.ts` › `createSendQueue` — 39 ca (thành công, skippedFiles, network + mốc, trần 5 lần,
 * uncertain + R36 ×3 (committed tự gửi lại · chỉ upload thì không · network sau upload vẫn tự gửi),
 * auth/permission/validation, rate-limit, lỗi lạ, checkpoint, chống trùng ×4, kết nối mất ×3, lưu
 * bền ×12, kho treo ×5 (list · read · write treo không làm "treo" · ghi đầu chậm rồi xong ⇒ file
 * đuổi kịp `sent`, không gửi lại · `ramOnly`), discard ×3, items ổn định, subscribe, hai bản gửi lại
 * song song chung thư mục tạm).
 */
export const createSendQueue = (deps: {
  connections: ConnectionStore;
  connectorTypes: readonly ConnectorType[];
  makeSendContext: (
    locale: DevToolsLocale,
    resume: QueuedReport['resume'],
    checkpoint: (s: Readonly<Record<string, unknown>>) => void,
    reportId: string,
  ) => SendContext;
  store?: LogStore;
  now: () => number;
}): SendQueue => {
  const { store, now } = deps;
  const map = new Map<string, QueuedReport>();
  const listeners = new Set<() => void>();
  let snapshot: readonly QueuedReport[] | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  /** Đã đọc file thành công (hoặc file chưa có) ⇒ mới được ghi đè. Đọc lỗi ⇒ `false`. */
  let loaded = false;
  let inflight: Promise<boolean> | null = null;
  /** Một lần **đọc** kho đã quá 5 s ⇒ kho treo: RAM-only tới hết lần chạy (M4). Ghi không bật cờ này. */
  let stalled = false;

  /**
   * Đọc kho với trần 5 s. Quá trần ⇒ đánh dấu kho treo (một lần) và báo người nghe — màn hình đổi
   * sang câu "chỉ nằm trong bộ nhớ"; lỗi vẫn ném ra cho chỗ gọi. **Chỉ** cho `list()`/`read()` (R46).
   */
  const readStore = <T>(work: () => Promise<T>): Promise<T> =>
    withStoreTimeout(Promise.resolve().then(work)).catch((e: unknown) => {
      if (e instanceof Error && e.name === STORE_TIMEOUT_ERROR && !stalled) {
        stalled = true;
        listeners.forEach((l) => l());
      }
      throw e;
    });

  /**
   * Đọc `QUEUE_FILE` và **gộp** vào RAM (mục trong RAM thắng khi trùng id). Trả `dirty` = có
   * chuẩn hoá/bỏ mục nên cần ghi lại. Lỗi đọc ⇒ `loaded` vẫn `false`.
   */
  const readAndMerge = async (): Promise<boolean> => {
    if (!store || stalled) return false;
    let raw: string | undefined;
    try {
      const files = await readStore(() => store.list());
      if (files.some((f) => f.name === QUEUE_FILE)) {
        raw = await readStore(() => store.read(QUEUE_FILE));
      }
    } catch {
      return false;
    }
    if (raw === undefined) {
      loaded = true;
      return false;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
      try {
        /* Chỉ chặn thời gian `load()` chờ (quá 5 s ⇒ coi như chưa đọc được); lần ghi thật vẫn chạy
           tiếp và không bao giờ làm kho thành "treo" (R46). */
        const copy = raw;
        await withStoreTimeout(Promise.resolve().then(() => store.write(CORRUPT_FILE, copy)));
        await withStoreTimeout(Promise.resolve().then(() => store.remove(QUEUE_FILE)));
        loaded = true;
      } catch {
        // không giữ được bản hỏng ⇒ coi như chưa đọc được, không ghi đè file gốc
      }
      return false;
    }

    let dirty = false;
    for (const v of parsed.items) {
      const item = parseItem(v);
      if (!item) {
        dirty = true;
        continue;
      }
      if (map.has(item.report.id)) continue;
      if (item.state === 'sent' && now() - (item.sentAt ?? 0) > SENT_TTL_MS) {
        dirty = true;
        continue;
      }
      if (item.state === 'sending') {
        dirty = true;
        map.set(item.report.id, {
          ...item,
          state: isCommitted(item) ? 'pending' : 'uncertain',
        });
      } else {
        map.set(item.report.id, item);
      }
    }
    loaded = true;
    snapshot = null;
    listeners.forEach((l) => l());
    return dirty;
  };

  /** Bảo đảm đã đọc file (thử lại nếu lần trước lỗi); dùng chung một lần đọc đang bay. */
  const ensureLoaded = (): Promise<boolean> => {
    if (!store || loaded || stalled) return Promise.resolve(false);
    if (!inflight) {
      inflight = readAndMerge().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  };

  /**
   * Ghi tuần tự; nội dung lấy lúc chạy nên hai lần đổi liền nhau chỉ cần bản mới nhất. Chờ lần đọc
   * đang bay và **không ghi đè** file khi chưa đọc được nó (mục ở lại RAM tới lần ghi sau).
   *
   * Chuỗi đợi lần ghi **thật** (không trần): ghi chậm chỉ làm các lần sau tới muộn, file vẫn đuổi kịp
   * bản mới nhất (R46). Chỗ gọi thì chỉ chờ tối đa {@link STORE_TIMEOUT_MS} — gửi không kẹt theo kho.
   */
  const persist = (): Promise<void> => {
    if (!store || stalled) return Promise.resolve();
    const run = writeChain.then(async () => {
      try {
        await ensureLoaded();
        if (!loaded || stalled) return;
        await store.write(
          QUEUE_FILE,
          JSON.stringify({ v: QUEUE_FORMAT, items: [...map.values()] }),
        );
      } catch {
        // kho hỏng không được làm hỏng việc gửi — hàng đợi vẫn đúng trong RAM
      }
    });
    writeChain = run;
    return waitAtMost(run);
  };

  /** Mọi thay đổi đi qua đây: cập nhật bản chụp, báo người nghe, kích ghi. */
  const changed = (): Promise<void> => {
    snapshot = null;
    listeners.forEach((l) => l());
    return persist();
  };

  const patch = (id: string, p: Partial<QueuedReport>): Promise<void> => {
    const cur = map.get(id);
    if (!cur) return Promise.resolve();
    map.set(id, { ...cur, ...p });
    return changed();
  };

  const block = (id: string, kind: 'connection-missing'): Promise<void> =>
    patch(id, {
      state: 'blocked',
      nextAttemptAt: undefined,
      lastError: { kind, message: 'Connection is no longer available' },
    });

  /** Một lần gửi. Đồng bộ đánh dấu `sending` trước mọi `await` để chặn lần gửi thứ hai. */
  const run = async (id: string): Promise<QueuedReport> => {
    const start = map.get(id);
    if (!start) throw new Error(`Unknown report: ${id}`);
    if (start.state === 'sending' || start.state === 'sent') return start;
    const flushed = patch(id, { state: 'sending', nextAttemptAt: undefined });

    let resolved: {
      connection: StoredConnection;
      secrets: ConnectorValues;
      type: ConnectorType;
    } | null = null;
    try {
      const connection = (await deps.connections.list()).find((c) => c.id === start.connectionId);
      const secrets = connection ? await deps.connections.secrets(connection.id) : null;
      const type = connection && deps.connectorTypes.find((t) => t.id === connection.typeId);
      if (connection && secrets && type) resolved = { connection, secrets, type };
    } catch {
      resolved = null;
    }
    await flushed;
    if (!map.has(id)) return start;
    if (!resolved) {
      await block(id, 'connection-missing');
      return map.get(id) ?? start;
    }

    await patch(id, { attempts: (map.get(id)?.attempts ?? 0) + 1 });
    const checkpoint = (s: Readonly<Record<string, unknown>>): void => {
      const cur = map.get(id);
      if (cur) void patch(id, { resume: { ...cur.resume, ...s } });
    };
    const current = map.get(id);
    if (!current) return start;
    const { connection, secrets, type } = resolved;

    try {
      const result = await type.send(
        current.report,
        connection.values,
        secrets,
        deps.makeSendContext(connection.ticketLocale, current.resume, checkpoint, id),
      );
      await patch(id, {
        state: 'sent',
        result,
        sentAt: now(),
        lastError: undefined,
        nextAttemptAt: undefined,
      });
    } catch (e) {
      const cur = map.get(id);
      if (!cur) return current;
      const kind = errorKind(e);
      const lastError = {
        kind,
        message: errorMessage(e),
        ...(e instanceof ConnectorError && e.field !== undefined ? { field: e.field } : {}),
      };
      const retryable =
        kind === 'network' ||
        kind === 'rate-limit' ||
        // R36: chỉ khi connector đã đánh dấu bước không đảo ngược xong ⇒ gửi lại chỉ làm nốt
        (kind === 'uncertain' && isCommitted(cur));
      if (retryable) {
        const delay =
          kind === 'rate-limit' && e instanceof ConnectorError && e.retryAfterMs !== undefined
            ? e.retryAfterMs
            : RETRY_EVERY_MS;
        await patch(
          id,
          cur.attempts >= MAX_ATTEMPTS
            ? { state: 'failed', lastError, nextAttemptAt: undefined }
            : { state: 'pending', lastError, nextAttemptAt: now() + delay },
        );
      } else if (kind === 'uncertain') {
        await patch(id, {
          state: 'uncertain',
          lastError,
          nextAttemptAt: undefined,
        });
      } else if (kind === 'unknown') {
        await patch(id, {
          state: 'failed',
          lastError,
          nextAttemptAt: undefined,
        });
      } else {
        await patch(id, {
          state: 'blocked',
          lastError,
          nextAttemptAt: undefined,
        });
      }
    }
    return map.get(id) ?? current;
  };

  return {
    async load() {
      if (await ensureLoaded()) await persist();
    },

    async submit(report, connectionId) {
      const existing = map.get(report.id);
      if (existing) return existing;
      map.set(report.id, {
        report,
        connectionId,
        state: 'pending',
        attempts: 0,
      });
      void changed();
      return run(report.id);
    },

    async retryDue() {
      const due = [...map.values()].filter(
        (i) => i.state === 'pending' && (i.nextAttemptAt ?? 0) <= now(),
      );
      await Promise.all(due.map((i) => run(i.report.id)));
    },

    async retryNow(reportId) {
      return run(reportId);
    },

    async discard(reportId) {
      if (!map.delete(reportId)) return;
      await changed();
    },

    items() {
      if (!snapshot) snapshot = [...map.values()];
      return snapshot;
    },

    ramOnly() {
      return !store || stalled;
    },

    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
};
