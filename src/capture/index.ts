/**
 * Entry `react-native-shake-devtools/capture` — tầng **thu** nhật ký. Không UI, không i18n, không React.
 *
 * Dùng entry này khi chỉ cần *bắt* console/mạng/lỗi toàn cục và tự làm gì đó với dữ liệu (đẩy
 * lên server nội bộ, ghi file, gửi qua WebSocket). Muốn cả màn xem thì dùng entry `.` — entry đó
 * tái xuất nguyên file này.
 *
 * 🔴 Bật thu là quyết định của **app**, không của lib — `startCapture` không tự hỏi môi
 * trường, và cũng không chạy khi app chưa truyền `enabled: true` (bắt buộc). Xem JSDoc của nó.
 */

export {
  createLogBuffer,
  logBuffer,
  DEFAULT_CAPACITY,
  DEFAULT_ERROR_CAPACITY,
} from './log-buffer';
export type { LogBuffer } from './log-buffer';

export {
  actionBuffer,
  createActionBuffer,
  DEFAULT_ACTION_CAPACITY,
} from './action-buffer';
export type { ActionBuffer } from './action-buffer';
export type { LabelSource, RecordedAction, RecordedActionKind } from './recorded-action';

export { NETWORK_ABORTED } from './log-entry';
export type {
  BodySkip,
  ConsoleEntry,
  LogEntry,
  LogFilter,
  LogLevel,
  LogStatusFilter,
  MarkerEntry,
  NetworkEntry,
} from './log-entry';
export {
  DEFAULT_SLOW_MS,
  countErrors,
  filterLog,
  isAbortedEntry,
  isErrorEntry,
  isSlowEntry,
  matchesQuery,
  parseQuery,
} from './log-query';
export type { LogQuery, ParsedQuery } from './log-query';

export { redactBody, redactHeaders, truncate, REDACTED } from './redact';
export { toCurl } from './to-curl';
export { formatArgs, tapConsole } from './console-tap';
export {
  tapNetwork,
  runUncaptured,
  DEFAULT_BODY_LIMIT,
  MAX_BODY_READ_BYTES,
} from './network-tap';
export { maskPersonalData } from './mask-label';
export {
  createFullBodyStore,
  fullBodies,
  withFullBodies,
  FULL_BODY_ERRORS,
  FULL_BODY_LIMIT,
  FULL_BODY_RECENT,
} from './full-body-store';
export type { BodySide, FullBody, FullBodyStore } from './full-body-store';
export {
  FATAL_FLUSH_BUDGET_MS,
  formatUncaught,
  tapGlobalErrors,
} from './global-error-tap';
export { tapUnhandledRejections } from './rejection-tap';
export { createMarkers, markScreen, markUser } from './markers';
export type { Markers } from './markers';

export {
  clearPersistedLogs,
  flushPersistedLogs,
  previousSession,
  startPersistence,
} from './log-persist';
export type { LogStore, PersistOptions, PersistenceHandle } from './log-persist';
export {
  SESSION_FORMAT,
  isSessionFile,
  parseSession,
  pickForPersist,
  pickPrevious,
  planPrune,
  redactEntry,
  serializeSession,
  sessionFileName,
  utf8Bytes,
} from './log-session';
export type { LogStoreFile, PrunePolicy, StoredSession } from './log-session';

export { formatSessionInfo, sessionInfoPairs } from './session-info';
export type { DevToolsSessionInfo } from './session-info';

export { getCaptureStartedAt, startCapture } from './start-capture';
export type { CaptureOptions } from './start-capture';
export { formatDateTime, formatEntry, formatLog, formatTime } from './format-log';
export {
  errorReportFileName,
  formatErrorReport,
  prettyBody,
} from './format-error-report';
export type { ErrorReportMeta } from './format-error-report';
export { AI_CONTEXT_MAX_CHARS, formatAiContext } from './format-ai-context';
export type { AiContextOptions } from './format-ai-context';
