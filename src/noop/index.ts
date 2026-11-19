/**
 * Entry `react-native-shake-devtools/noop` — bản **rỗng** của entry `react-native-shake-devtools`,
 * dành cho bản prod.
 *
 * **Chức năng:** cùng tên export, cùng kiểu với entry thật, nhưng không một dòng code devtools:
 * không cảm biến, không sheet, không thu, không kéo `@gorhom/bottom-sheet` ·
 * `react-native-reanimated` · `react-native-gesture-handler` · `react-native-safe-area-context`.
 * App **không import thẳng** đường này — Metro tráo `react-native-shake-devtools` sang đây khi bật
 * `devtoolsNoopResolver` (`react-native-shake-devtools/metro`), nên code app giữ nguyên một dòng
 * import cho mọi flavor. Đây là lớp 3 trong "Ba lớp chặn prod" của README.
 *
 * | Export | Bản noop |
 * |---|---|
 * | `DevToolsGate` · `DevToolsUiProvider` (component **bọc**) | render đúng `children` |
 * | `DevToolsPanel` · `LogSheet` · `LogRow`… (component **chỉ là UI devtools**) | không render gì |
 * | `useDevTools()` | bản câm: `{ enabled: false, isOpen: false, open: () => {} }` — y như ngoài gate |
 * | hook khác | hằng ổn định (cùng tham chiếu mỗi render), rỗng |
 * | `defineConnector` | hàm đồng nhất như bản thật |
 * | `jiraCloudConnector` · `slackConnector` · `larkConnector` · `webhookConnector` | `id` thật, không ô nhập; `test`/`send` từ chối `ConnectorError('unknown', 'devtools disabled')` |
 * | `ConnectorError` | lớp riêng cùng chữ ký (không kéo `src/report/**`) |
 * | phần thu · lắc · chuỗi | tái xuất `noop/capture` · `noop/shake` · `noop/i18n` |
 *
 * Component rỗng trả `<></>` chứ không `null`: kiểu bản thật là `(props) => JSX.Element`, và một
 * Fragment rỗng render ra đúng không gì cả — giữ được kiểu mà không phải ép.
 *
 * **Input:** như entry thật. **Output:** như bảng trên; không hàm nào ném.
 *
 * @example
 * ```tsx
 * <DevToolsGate config={config} actions={actions}>
 *   <RootNavigator />              // bản noop: chỉ còn đúng cây này
 * </DevToolsGate>
 * useDevTools().enabled;           // false — ca biên: đường vào ẩn (chạm 7 lần) tự tắt
 * ```
 *
 * **Unit test:** `noop-surface.test.ts` (kiểu khớp bản thật · hằng khớp · hành vi rỗng) ·
 * `noop-isolation.test.ts` (không kéo gói nặng, không kéo file nguồn nào của lib).
 */
import { createElement, Fragment, memo } from 'react';
import type * as Real from '../index';
import type {
  ConnectorErrorKind,
  ConnectorType,
  ConnectorValues,
  DevToolsContextValue,
  PausableEntries,
  UseLogExportResult,
} from '../index';
import { EMPTY, NOOP } from './shared';

export type {
  BugReport,
  ConnectorContext,
  ConnectorErrorKind,
  ConnectorField,
  ConnectorFieldKind,
  ConnectorOption,
  ConnectorTestResult,
  ConnectorType,
  ConnectorValues,
  DeepPartial,
  DetailTab,
  DevToolsAction,
  DevToolsAppContext,
  DevToolsBugReportConfig,
  DevToolsCapturedImage,
  DevToolsChoice,
  DevToolsChoiceRowProps,
  DevToolsColorScheme,
  DevToolsConfig,
  DevToolsContextValue,
  DevToolsExportFile,
  DevToolsGateProps,
  DevToolsKeyboardInputMode,
  DevToolsLocale,
  DevToolsPanelProps,
  DevToolsPanelReportRow,
  DevToolsRowProps,
  DevToolsSecureStore,
  DevToolsShareFile,
  DevToolsStrings,
  DevToolsUiProviderProps,
  LogDetailActionsProps,
  LogDetailProps,
  LogExportState,
  LogRowAction,
  LogRowProps,
  LogSheetProps,
  PausableEntries,
  ReportFile,
  ReportStep,
  ReportStepKind,
  ScreenshotState,
  SendContext,
  SendResult,
  ShakeConfig,
  ShakeSample,
  ShakeState,
  ShakeStep,
  StoredConnection,
  UploadPart,
  UseLogExportInput,
  UseLogExportResult,
} from '../index';

export * from './capture';
export {
  DEFAULT_SHAKE_CONFIG,
  SAMPLE_INTERVAL_MS,
  createShakeState,
  resolveShakeConfig,
  stepShake,
  useShake,
} from './shake';
export { devtoolsStrings } from './i18n';

/** Component chỉ là UI devtools: render ra không gì cả. */
const Nothing = () => createElement(Fragment);

/* ------------------------------------------------------------------ cổng · provider */

export const DevToolsGate: typeof Real.DevToolsGate = ({ children }) =>
  createElement(Fragment, null, children);
export const DevToolsUiProvider: typeof Real.DevToolsUiProvider = ({ children }) =>
  createElement(Fragment, null, children);

const MUTED: DevToolsContextValue = Object.freeze({ open: NOOP, isOpen: false, enabled: false });
export const useDevTools: typeof Real.useDevTools = () => MUTED;
export const isRunningFromMetro: typeof Real.isRunningFromMetro = () => false;

/* ------------------------------------------------------------------ báo bug · connector */

/**
 * Nghĩa *kiểu* của `ConnectorError`: ở bản thật đây là lớp nên tên vừa là giá trị vừa là kiểu
 * (`let last: ConnectorError`). Hằng bên dưới chỉ mang nghĩa giá trị; thiếu dòng này thì code app
 * dùng tên làm kiểu đỏ khi tsc đọc bản noop. Chỉ là kiểu — không kéo mã thật nào vào bundle.
 */
export type ConnectorError = Real.ConnectorError;

/**
 * Bản noop của `ConnectorError`: cùng chữ ký và các trường, không kéo `src/report/**`. Ở bản prod
 * không có code thật nào để `instanceof` so — hai lớp không cần là một.
 */
export const ConnectorError: typeof Real.ConnectorError = class ConnectorError extends Error {
  readonly kind: ConnectorErrorKind;
  readonly field?: string;
  readonly retryAfterMs?: number;
  readonly status?: number;

  constructor(
    kind: ConnectorErrorKind,
    message: string,
    opts?: { field?: string; retryAfterMs?: number; status?: number },
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ConnectorError';
    this.kind = kind;
    this.field = opts?.field;
    this.retryAfterMs = opts?.retryAfterMs;
    this.status = opts?.status;
  }
};

/** Hàm đồng nhất như bản thật — chỉ để TypeScript khớp kiểu `V`. */
export const defineConnector: typeof Real.defineConnector = (c) => c;

/** Connector câm: không ô nhập, không khả năng; `test`/`send` từ chối — không có gì để gửi đi. */
const deadConnector = (id: string): ConnectorType<ConnectorValues> => ({
  id,
  label: () => id,
  fields: () => EMPTY,
  secretFieldIds: EMPTY,
  capabilities: () => ({ image: false, files: false }),
  test: () => Promise.reject(new ConnectorError('unknown', 'devtools disabled')),
  send: () => Promise.reject(new ConnectorError('unknown', 'devtools disabled')),
});

export const jiraCloudConnector: typeof Real.jiraCloudConnector = deadConnector('jira-cloud');
export const slackConnector: typeof Real.slackConnector = deadConnector('slack');
export const larkConnector: typeof Real.larkConnector = deadConnector('lark');
export const webhookConnector: typeof Real.webhookConnector = deadConnector('webhook');

/* ------------------------------------------------------------------ panel · màn nhật ký */

export const DevToolsPanel: typeof Real.DevToolsPanel = Nothing;
export const DevToolsRow: typeof Real.DevToolsRow = Nothing;
export const DevToolsChoiceRow: typeof Real.DevToolsChoiceRow = Nothing;
export const LogSheet: typeof Real.LogSheet = Nothing;
export const LogRow: typeof Real.LogRow = memo(Nothing);
export const LogDetail: typeof Real.LogDetail = Nothing;
export const LogDetailActions: typeof Real.LogDetailActions = Nothing;
export const copyTextOf: typeof Real.copyTextOf = () => '';
export const copyText: typeof Real.copyText = () => false;

const IDLE_EXPORT: UseLogExportResult = Object.freeze({ state: 'idle', run: NOOP });
const NOT_PAUSED: PausableEntries = Object.freeze({
  entries: EMPTY,
  paused: false,
  pausedAt: undefined,
  fresh: 0,
  toggle: NOOP,
  resume: NOOP,
});

export const useLogEntries: typeof Real.useLogEntries = () => EMPTY;
export const useLogExport: typeof Real.useLogExport = () => IDLE_EXPORT;
export const usePausableEntries: typeof Real.usePausableEntries = () => NOT_PAUSED;
export const usePreviousSession: typeof Real.usePreviousSession = () => null;
