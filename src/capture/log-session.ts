import type { LogEntry } from './log-entry';
import { isErrorEntry } from './log-query';
import type { RecordedAction } from './recorded-action';
import { redactBody, redactHeaders, redactText, redactUrl } from './redact';

/**
 * Phiên bản khuôn file — đổi khuôn thì tăng số, `parseSession` bỏ qua file khuôn **lạ**.
 * Khuôn 2 thêm `actions` (các thao tác cuối của QA); khuôn 1 vẫn đọc được (`actions` vắng).
 */
export const SESSION_FORMAT = 2;

/** Tiền tố + đuôi tên file phiên. `planPrune` chỉ đụng file khớp khuôn này. */
const SESSION_FILE_RE = /^session-(\d+)\.json$/;

/** Một phiên nhật ký đã ghi xuống đĩa — **đã che** header và khoá bí mật trong thân. */
export interface StoredSession {
  /** `SESSION_FORMAT` (đang ghi) hoặc `1` (file của bản cũ, không có `actions`). */
  readonly format: 1 | typeof SESSION_FORMAT;
  /** Tên file của phiên, vd `session-1790000000000.json`. */
  readonly name: string;
  /** Mốc bắt đầu phiên (lúc gọi `startCapture`). */
  readonly startedAt: number;
  /** Mốc lần ghi cuối — với phiên đã chết, đây là "lúc cuối cùng còn thấy app". */
  readonly savedAt: number;
  /** Phiên kết thúc vì một lỗi JS **fatal** (đã kịp ghi trước khi chết). */
  readonly fatal: boolean;
  /** Dòng phụ môi trường, vd `'UAT · 1.0.2'`. */
  readonly build?: string;
  /** Số dòng phiên đó từng giữ trong RAM — để biết file chỉ là **một phần**. */
  readonly totalInMemory: number;
  readonly entries: readonly LogEntry[];
  /**
   * Các thao tác cuối của QA trước lúc ghi (cũ→mới, nhãn **đã che** từ lúc vào bộ đệm). Vắng ở file
   * `format: 1`.
   */
  readonly actions?: readonly RecordedAction[];
}

/** Một file trong kho — đúng những gì `LogStore.list` trả. */
export interface LogStoreFile {
  readonly name: string;
  /** Mili-giây, giờ máy. */
  readonly modifiedAt: number;
}

/** File có đúng khuôn tên phiên không — kho chỉ đụng những file này, rác lạ để nguyên. */
export const isSessionFile = (name: string): boolean => SESSION_FILE_RE.test(name);

/**
 * Tên file của một phiên theo mốc bắt đầu. Chỉ chữ số — an toàn cho mọi hệ tệp, và sắp theo tên
 * cũng là sắp theo thời gian.
 */
export const sessionFileName = (startedAt: number): string =>
  `session-${startedAt}.json`;

/**
 * **Chức năng:** chọn những dòng đáng ghi xuống đĩa — **mọi lỗi** + `contextSize` dòng cuối
 * (bối cảnh ngay trước lúc app chết), giữ thứ tự cũ→mới, không trùng.
 *
 * Không ghi cả 300 dòng: đĩa sống lâu hơn RAM (tới 72 giờ), nên thứ nằm trên đĩa phải ít nhất có
 * thể. Lỗi là thứ người ta mở phiên cũ ra để tìm; 50 dòng cuối là câu trả lời cho "trước khi chết
 * app đang làm gì".
 *
 * **Input:** `entries` (cũ→mới) · `contextSize`.
 * **Output:** mảng mới, cũ→mới.
 *
 * @example
 * ```ts
 * pickForPersist([err1, a, b, c], 2);   // [err1, b, c]
 * pickForPersist([a, b], 5);            // ca biên: ít hơn contextSize ⇒ lấy hết [a, b]
 * ```
 *
 * **Unit test:** `log-session.test.ts` › `pickForPersist` — 3 case: lỗi cũ ngoài cửa sổ vẫn được
 * lấy · lỗi nằm trong cửa sổ không bị lấy hai lần · ít dòng hơn cửa sổ thì lấy hết.
 */
export const pickForPersist = (
  entries: readonly LogEntry[],
  contextSize: number,
): LogEntry[] => {
  const tailStart = Math.max(0, entries.length - Math.max(0, contextSize));
  return entries.filter((e, i) => i >= tailStart || isErrorEntry(e));
};

/**
 * **Chức năng:** che một dòng **trước khi ghi đĩa** — header bí mật, khoá bí mật trong thân, tham số
 * bí mật trong URL, và bí mật trong chữ của dòng console (JSON in ra, JWT, `Bearer …`).
 *
 * 🔴 Khác RAM (giữ thô để `toCurl` chạy được): đĩa sống qua cả lần mở app sau, có thể qua tay
 * người dùng khác trên cùng máy — nó thuộc nhóm "đi ra khỏi phiên đang gỡ" của bảng chính sách ở
 * đầu `redact.ts`. Ghi thô xuống đĩa là để một token còn sống nằm trong cache tới 72 giờ.
 *
 * **Input:** `entry`. **Output:** dòng mới; console không có gì để che và mốc trả **cùng tham chiếu**.
 *
 * @example
 * ```ts
 * redactEntry(net({ requestHeaders: { Authorization: 'Bearer x' } })).requestHeaders;
 * // { Authorization: '<redacted>' }
 * redactEntry(con('login {"accessToken":"a1"}')).text; // 'login {"accessToken":"<redacted>"}'
 * redactEntry(consoleEntry) === consoleEntry;   // ca biên: không có gì để che ⇒ cùng tham chiếu
 * ```
 *
 * **Unit test:** `log-session.test.ts` › `redactEntry` — 5 case: header bí mật bị che · khoá
 * `password` trong thân bị che · JSON nén có token base64 đệm `=` bị che · URL và dòng console mang
 * bí mật bị che · dòng console không có bí mật trả nguyên.
 */
export const redactEntry = (entry: LogEntry): LogEntry => {
  if (entry.kind === 'console') {
    const text = redactText(entry.text);
    return text === entry.text ? entry : { ...entry, text };
  }
  if (entry.kind !== 'network') return entry;
  return {
    ...entry,
    url: redactUrl(entry.url),
    requestHeaders: entry.requestHeaders
      ? redactHeaders({ ...entry.requestHeaders })
      : undefined,
    requestBody: redactBody(entry.requestBody),
    responseBody: redactBody(entry.responseBody),
  };
};

/**
 * Số byte UTF-8 của một chuỗi, không cấp phát mảng. Tiếng Việt có dấu là 2–3 byte/ký tự — đo bằng
 * `.length` thì trần 1 MB thật ra là 2–3 MB.
 */
export const utf8Bytes = (text: string): number => {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i += 1;
    } else n += 3;
  }
  return n;
};

/**
 * **Chức năng:** đổi một phiên thành chuỗi JSON **vừa trần byte** — vượt trần thì bỏ dòng thường
 * cũ nhất trước, rồi mới tới lỗi cũ nhất, cho tới khi vừa.
 *
 * Thứ tự bỏ có chủ ý: dòng thường chỉ là bối cảnh, lỗi là lý do file tồn tại. Một vòng lặp lỗi
 * (cùng một request hỏng mỗi giây) vẫn không làm đầy máy vì cuối cùng lỗi cũng bị cắt.
 *
 * **Input:** `session` · `maxBytes`.
 * **Output:** chuỗi JSON. Kể cả khi đã bỏ hết dòng mà đầu file vẫn vượt trần (không thể xảy ra với
 * trần hợp lý) vẫn trả chuỗi — không bao giờ ném, không bao giờ trả rỗng.
 *
 * @example
 * ```ts
 * serializeSession(session, 1_000_000);  // JSON đủ dòng
 * serializeSession(session, 600);        // ca biên: bỏ dòng thường trước, lỗi còn lại
 * ```
 *
 * **Unit test:** `log-session.test.ts` › `serializeSession` — 3 case: dưới trần giữ đủ dòng · vượt
 * trần bỏ dòng thường trước lỗi · kết quả đọc lại được bằng `parseSession`.
 */
export const serializeSession = (
  session: StoredSession,
  maxBytes: number,
): string => {
  const entries = session.entries.slice();
  let text = JSON.stringify({ ...session, entries });
  while (utf8Bytes(text) > maxBytes && entries.length > 0) {
    const plain = entries.findIndex((e) => !isErrorEntry(e));
    entries.splice(plain >= 0 ? plain : 0, 1);
    text = JSON.stringify({ ...session, entries });
  }
  return text;
};

/** Phần tử của `actions` đọc từ đĩa có đúng dáng thao tác không — file là dữ liệu ngoài, không tin. */
const isRecordedAction = (a: unknown): a is RecordedAction =>
  typeof a === 'object' &&
  a !== null &&
  typeof (a as RecordedAction).at === 'number' &&
  typeof (a as RecordedAction).kind === 'string';

/**
 * Phần tử của `entries` đọc từ đĩa có đúng dáng dòng nhật ký không — đủ những trường panel, màn phiên
 * trước và báo bug đọc **lúc render** (`id`, `at`, `kind` và `text`/`level` · `method`/`url` ·
 * `type`/`label` theo loại). File là dữ liệu ngoài, không tin: một dòng `null` lọt qua là sập cả app.
 */
const isLogEntry = (e: unknown): e is LogEntry => {
  if (typeof e !== 'object' || e === null) return false;
  const x = e as Record<string, unknown>;
  if (typeof x.id !== 'number' || typeof x.at !== 'number') return false;
  switch (x.kind) {
    case 'console':
      return typeof x.level === 'string' && typeof x.text === 'string';
    case 'network':
      return typeof x.method === 'string' && typeof x.url === 'string';
    case 'marker':
      return typeof x.type === 'string' && typeof x.label === 'string';
    default:
      return false;
  }
};

/**
 * **Chức năng:** đọc lại một file phiên. File hỏng, khuôn lạ, thiếu trường **bắt buộc** (`format` ·
 * `name` · `startedAt` · `savedAt` · `entries`) ⇒ `null`; thiếu trường phụ (`fatal` · `build` ·
 * `totalInMemory`) thì lấy giá trị mặc định; `actions` vắng (file `format: 1`) hoặc không phải mảng ⇒
 * `undefined`. Phần tử sai dáng của `entries` và `actions` bị bỏ (panel đếm lỗi và vẽ từng dòng lúc
 * render). Không ném, vì một file rác trong cache không được làm hỏng panel gỡ lỗi — càng không được
 * làm sập app.
 *
 * **Input:** `text` — nội dung file. **Output:** `StoredSession | null`.
 *
 * @example
 * ```ts
 * parseSession(serializeSession(s, 1e6));  // s
 * parseSession('{không phải json');        // ca biên: null
 * ```
 *
 * **Unit test:** `log-session.test.ts` › `parseSession` — 6 case: đọc lại đúng thứ đã ghi · JSON
 * hỏng ⇒ null · khuôn lạ (không phải 1 hay `SESSION_FORMAT`) ⇒ null · file `format: 1` đọc được với
 * `actions` là `undefined` · `actions` đọc lại đúng, phần tử rác bị bỏ · phần tử `entries` sai dáng
 * bị bỏ.
 */
export const parseSession = (text: string): StoredSession | null => {
  try {
    const raw = JSON.parse(text) as Partial<StoredSession> | null;
    if (
      !raw ||
      (raw.format !== SESSION_FORMAT && raw.format !== 1) ||
      typeof raw.name !== 'string' ||
      typeof raw.startedAt !== 'number' ||
      typeof raw.savedAt !== 'number' ||
      !Array.isArray(raw.entries)
    ) {
      return null;
    }
    return {
      format: raw.format,
      name: raw.name,
      startedAt: raw.startedAt,
      savedAt: raw.savedAt,
      fatal: raw.fatal === true,
      build: typeof raw.build === 'string' ? raw.build : undefined,
      totalInMemory:
        typeof raw.totalInMemory === 'number' ? raw.totalInMemory : raw.entries.length,
      entries: (raw.entries as unknown[]).filter(isLogEntry),
      actions: Array.isArray(raw.actions)
        ? (raw.actions as unknown[]).filter(isRecordedAction)
        : undefined,
    };
  } catch {
    return null;
  }
};

export interface PrunePolicy {
  readonly now: number;
  /** File sửa lần cuối cũ hơn ngần này ⇒ xoá. */
  readonly ttlMs: number;
  /** Số phiên tối đa **kể cả phiên hiện tại**. */
  readonly maxSessions: number;
  /** Tên file của phiên đang chạy — không bao giờ bị xoá. */
  readonly current: string;
}

/**
 * **Chức năng:** kế hoạch dọn kho — trả **tên các file phải xoá** theo hai luật: quá hạn TTL, và
 * vượt số phiên tối đa (giữ những phiên mới nhất).
 *
 * Thuần: nhận danh sách, trả danh sách — việc xoá thật do người gọi làm. Chỉ đụng file đúng khuôn
 * `session-<số>.json`: kho là một thư mục trong cache, rác lạ trong đó không phải của mình để xoá.
 *
 * **Input:** `files` — kết quả `LogStore.list()` · `policy`.
 * **Output:** mảng tên file (không trùng khi tên đầu vào không trùng — kho thật không có hai file
 * cùng tên), không bao giờ chứa `policy.current`.
 *
 * @example
 * ```ts
 * planPrune(files, { now, ttlMs: 72 * 3600_000, maxSessions: 3, current: 'session-9.json' });
 * // ['session-1.json']  — quá hạn, hoặc là phiên thứ 4 trở đi
 * planPrune([{ name: 'ghi-chu.txt', modifiedAt: 0 }], policy);  // ca biên: [] — không phải file phiên
 * ```
 *
 * **Unit test:** `log-session.test.ts` › `planPrune` — 4 case: file quá TTL bị xoá · vượt
 * `maxSessions` thì xoá phiên cũ nhất · không bao giờ xoá phiên hiện tại · bỏ qua file không đúng
 * khuôn.
 */
export const planPrune = (
  files: readonly LogStoreFile[],
  policy: PrunePolicy,
): string[] => {
  const sessions = files
    .filter((f) => SESSION_FILE_RE.test(f.name) && f.name !== policy.current)
    .slice()
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
  const keepOthers = Math.max(0, policy.maxSessions - 1);
  return sessions
    .filter((f, i) => policy.now - f.modifiedAt > policy.ttlMs || i >= keepOthers)
    .map((f) => f.name);
};

/**
 * **Chức năng:** chọn **phiên trước** để hiện ở panel — file phiên mới nhất không phải phiên hiện
 * tại, còn trong hạn TTL.
 *
 * **Input:** `files` · `policy` (dùng `now`, `ttlMs`, `current`).
 * **Output:** tên file, hoặc `undefined` khi không có.
 *
 * @example
 * ```ts
 * pickPrevious(files, policy);   // 'session-8.json'
 * pickPrevious([], policy);      // ca biên: undefined
 * ```
 *
 * **Unit test:** `log-session.test.ts` › `pickPrevious` — 2 case: lấy phiên mới nhất khác phiên
 * hiện tại · phiên quá hạn không được chọn.
 */
export const pickPrevious = (
  files: readonly LogStoreFile[],
  policy: Omit<PrunePolicy, 'maxSessions'>,
): string | undefined =>
  files
    .filter(
      (f) =>
        SESSION_FILE_RE.test(f.name) &&
        f.name !== policy.current &&
        policy.now - f.modifiedAt <= policy.ttlMs,
    )
    .sort((a, b) => b.modifiedAt - a.modifiedAt)[0]?.name;
