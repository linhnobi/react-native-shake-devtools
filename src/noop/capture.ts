/**
 * Entry `react-native-shake-devtools/noop/capture` — bản **rỗng** của `react-native-shake-devtools/capture`.
 *
 * **Chức năng:** cùng tên export, cùng kiểu với entry thật, nhưng không vá gì, không thu gì, không
 * ghi đĩa. Metro tráo `…/capture` sang file này ở bản prod (xem `devtoolsNoopResolver`,
 * `src/metro/noop-resolver.js`), nên code app gọi `startCapture()` · `markScreen()` ·
 * `clearPersistedLogs()` vẫn chạy mà bundle không mang dòng thu nào.
 *
 * Luật chọn giá trị trả về (chung cho mọi entry noop):
 *
 * | Loại | Bản noop |
 * |---|---|
 * | hằng (`DEFAULT_CAPACITY`, `REDACTED`…) | **giữ đúng giá trị** bản thật — có test so |
 * | hàm "bật" (`startCapture`, `tap*`) | không làm gì, trả hàm gỡ rỗng |
 * | kho (`logBuffer`, `fullBodies`, `previousSession`) | luôn rỗng; `subscribe` trả hàm huỷ rỗng |
 * | hàm bất đồng bộ | Promise đã xong |
 * | hàm định dạng / truy vấn | rỗng của kiểu trả về: `''` · mảng rỗng · `undefined` · `null` · `false` · `0` |
 * | hàm **che** (`redact*`, `maskPersonalData`) | bỏ hết phần bản thật sẽ che — không bao giờ trả dữ liệu thô (`maskPersonalData` trả `''`, không trả lại chính chuỗi vào) |
 *
 * **Input:** như entry thật. **Output:** như entry thật, theo bảng trên. Không hàm nào ném.
 *
 * @example
 * ```ts
 * const stop = startCapture({ enabled: true, persist });   // không vá console/XHR, không đọc đĩa
 * stop();                                   // gọi được, không làm gì
 * logBuffer.snapshot();                     // [] — cùng một tham chiếu mọi lần
 * // Ca biên: app quên khoá `startCapture` theo môi trường ⇒ ở bản noop cũng không thu gì.
 * ```
 *
 * **Unit test:** `noop-surface.test.ts` (kiểu + hằng + hành vi rỗng) · `noop-isolation.test.ts`
 * (không kéo file nguồn nào của lib).
 */
import type * as Real from '../capture';
import type { ActionBuffer, FullBodyStore, LogBuffer, ParsedQuery, PersistenceHandle } from '../capture';
import { EMPTY, NOOP, RESOLVED } from './shared';

export type {
  ActionBuffer,
  AiContextOptions,
  BodySide,
  BodySkip,
  CaptureOptions,
  ConsoleEntry,
  DevToolsSessionInfo,
  ErrorReportMeta,
  FullBody,
  FullBodyStore,
  LabelSource,
  LogBuffer,
  LogEntry,
  LogFilter,
  LogLevel,
  LogQuery,
  LogStatusFilter,
  LogStore,
  LogStoreFile,
  Markers,
  MarkerEntry,
  NetworkEntry,
  ParsedQuery,
  PersistOptions,
  PersistenceHandle,
  PrunePolicy,
  RecordedAction,
  RecordedActionKind,
  StoredSession,
} from '../capture';

const blank = (): string => '';
const no = (): false => false;
/** Trả hàm gỡ rỗng — cho mọi hàm "bật" (`tap*`, `startCapture`). */
const off = (): (() => void) => NOOP;

/* ------------------------------------------------------------------ vòng đệm */

export const DEFAULT_CAPACITY: typeof Real.DEFAULT_CAPACITY = 300;
export const DEFAULT_ERROR_CAPACITY: typeof Real.DEFAULT_ERROR_CAPACITY = 100;

const emptyBuffer: LogBuffer = {
  push: NOOP,
  patch: NOOP,
  snapshot: () => EMPTY,
  clear: NOOP,
  subscribe: () => NOOP,
  setCapacity: NOOP,
  setErrorCapacity: NOOP,
  setScreen: NOOP,
  nextId: () => 0,
};

export const logBuffer: typeof Real.logBuffer = emptyBuffer;
export const createLogBuffer: typeof Real.createLogBuffer = () => emptyBuffer;

/* ------------------------------------------------------------------ vòng đệm thao tác QA */

export const DEFAULT_ACTION_CAPACITY: typeof Real.DEFAULT_ACTION_CAPACITY = 100;

const emptyActions: ActionBuffer = {
  push: NOOP,
  snapshot: () => EMPTY,
  since: () => EMPTY,
  clear: NOOP,
  subscribe: () => NOOP,
};

export const actionBuffer: typeof Real.actionBuffer = emptyActions;
export const createActionBuffer: typeof Real.createActionBuffer = () => emptyActions;

/* ------------------------------------------------------------------ truy vấn */

export const DEFAULT_SLOW_MS: typeof Real.DEFAULT_SLOW_MS = 3000;

const EMPTY_QUERY: ParsedQuery = Object.freeze({ predicates: EMPTY, free: '' });

export const NETWORK_ABORTED: typeof Real.NETWORK_ABORTED = 'abort';
export const countErrors: typeof Real.countErrors = () => 0;
export const filterLog: typeof Real.filterLog = () => EMPTY;
export const isAbortedEntry: typeof Real.isAbortedEntry = no;
export const isErrorEntry: typeof Real.isErrorEntry = no;
export const isSlowEntry: typeof Real.isSlowEntry = (_entry, _slowMs): _entry is Real.NetworkEntry =>
  false;
export const matchesQuery: typeof Real.matchesQuery = no;
export const parseQuery: typeof Real.parseQuery = () => EMPTY_QUERY;

/* ------------------------------------------------------------------ che · cắt · cURL */

export const REDACTED: typeof Real.REDACTED = '<redacted>';
export const redactBody: typeof Real.redactBody = () => undefined;
export const redactHeaders: typeof Real.redactHeaders = () => ({});
export const truncate: typeof Real.truncate = () => ({ text: undefined, truncated: false });
export const toCurl: typeof Real.toCurl = blank;
/** Bản thật che số dài/email trong nhãn; bản noop không giữ lại ký tự nào của đầu vào. */
export const maskPersonalData: typeof Real.maskPersonalData = blank;

/* ------------------------------------------------------------------ bắt console · mạng · lỗi */

export const formatArgs: typeof Real.formatArgs = blank;
export const tapConsole: typeof Real.tapConsole = off;
export const DEFAULT_BODY_LIMIT: typeof Real.DEFAULT_BODY_LIMIT = 4000;
export const MAX_BODY_READ_BYTES: typeof Real.MAX_BODY_READ_BYTES = 1_000_000;
export const tapNetwork: typeof Real.tapNetwork = off;
/** Không có tap nào để tắt tạm — chỉ chạy `fn` và trả kết quả của nó. */
export const runUncaptured: typeof Real.runUncaptured = (fn) => fn();
export const FATAL_FLUSH_BUDGET_MS: typeof Real.FATAL_FLUSH_BUDGET_MS = 800;
export const formatUncaught: typeof Real.formatUncaught = blank;
export const tapGlobalErrors: typeof Real.tapGlobalErrors = off;
export const tapUnhandledRejections: typeof Real.tapUnhandledRejections = off;

/* ------------------------------------------------------------------ thân đầy đủ */

export const FULL_BODY_LIMIT: typeof Real.FULL_BODY_LIMIT = 256_000;
export const FULL_BODY_RECENT: typeof Real.FULL_BODY_RECENT = 20;
export const FULL_BODY_ERRORS: typeof Real.FULL_BODY_ERRORS = 20;

const emptyBodies: FullBodyStore = {
  put: NOOP,
  markError: NOOP,
  get: () => undefined,
  clear: NOOP,
};

export const fullBodies: typeof Real.fullBodies = emptyBodies;
export const createFullBodyStore: typeof Real.createFullBodyStore = () => emptyBodies;
/** Kho rỗng ⇒ bản thật cũng trả nguyên `entry`; bản noop làm đúng thế. */
export const withFullBodies: typeof Real.withFullBodies = (entry) => entry;

/* ------------------------------------------------------------------ mốc */

export const createMarkers: typeof Real.createMarkers = () => ({ screen: NOOP, user: () => 0 });
export const markScreen: typeof Real.markScreen = NOOP;
export const markUser: typeof Real.markUser = () => 0;

/* ------------------------------------------------------------------ lưu phiên */

const emptyPersistence: PersistenceHandle = {
  flush: () => RESOLVED,
  clearAll: () => RESOLVED,
  stop: NOOP,
  ready: RESOLVED,
};

export const clearPersistedLogs: typeof Real.clearPersistedLogs = () => RESOLVED;
export const flushPersistedLogs: typeof Real.flushPersistedLogs = () => RESOLVED;
export const previousSession: typeof Real.previousSession = {
  get: () => null,
  subscribe: () => NOOP,
};
export const startPersistence: typeof Real.startPersistence = () => emptyPersistence;

export const SESSION_FORMAT: typeof Real.SESSION_FORMAT = 2;
export const isSessionFile: typeof Real.isSessionFile = no;
export const parseSession: typeof Real.parseSession = () => null;
export const pickForPersist: typeof Real.pickForPersist = () => [];
export const pickPrevious: typeof Real.pickPrevious = () => undefined;
export const planPrune: typeof Real.planPrune = () => [];
/** Che **hết** header và thân (bản thật chỉ che khoá bí mật) — noop không trả dữ liệu thô. */
export const redactEntry: typeof Real.redactEntry = (entry) =>
  entry?.kind === 'network'
    ? { ...entry, requestHeaders: undefined, requestBody: undefined, responseBody: undefined }
    : entry;
export const serializeSession: typeof Real.serializeSession = blank;
export const sessionFileName: typeof Real.sessionFileName = blank;
export const utf8Bytes: typeof Real.utf8Bytes = () => 0;

/* ------------------------------------------------------------------ thông tin phiên · định dạng */

export const formatSessionInfo: typeof Real.formatSessionInfo = blank;
export const sessionInfoPairs: typeof Real.sessionInfoPairs = () => EMPTY;

export const getCaptureStartedAt: typeof Real.getCaptureStartedAt = () => undefined;
export const startCapture: typeof Real.startCapture = off;

export const formatDateTime: typeof Real.formatDateTime = blank;
export const formatEntry: typeof Real.formatEntry = blank;
export const formatLog: typeof Real.formatLog = blank;
export const formatTime: typeof Real.formatTime = blank;

export const errorReportFileName: typeof Real.errorReportFileName = blank;
export const formatErrorReport: typeof Real.formatErrorReport = blank;
export const prettyBody: typeof Real.prettyBody = () => undefined;

export const AI_CONTEXT_MAX_CHARS: typeof Real.AI_CONTEXT_MAX_CHARS = 40_000;
/** Khối "Chép cho AI" mang dữ liệu đã bắt ⇒ bản noop trả chuỗi rỗng, không trả lại gì của đầu vào. */
export const formatAiContext: typeof Real.formatAiContext = blank;
