/**
 * Entry `react-native-shake-devtools/plain` — **cùng API** với entry `.` (`src/index.ts`), nhưng
 * sheet dựng bằng React Native lõi (`PlainSheet`): không `@gorhom/bottom-sheet`, không
 * `@gorhom/portal`, không `react-native-gesture-handler` trong đồ thị module — kể cả `import type`,
 * vì lib phát hành nguồn `.ts` và tsc của app kiểm luôn các file đó.
 *
 * ## Điều kiện ở app
 *
 * Không cần `BottomSheetModalProvider` lẫn `GestureHandlerRootView`. **Cần** mount `DevToolsGate` ở
 * gốc, trong một view phủ toàn màn: sheet là lớp phủ `absoluteFill` vẽ ngay chỗ gate đứng (cùng
 * window với app ⇒ FLAG_SECURE vẫn phủ — không dùng `<Modal>`). `SafeAreaProvider` tuỳ, như entry `.`.
 *
 * Vẫn kéo theo: `react-native-reanimated` (cảm biến lắc của gate — `useShake`) và gói
 * `react-native-safe-area-context` (đọc inset; không có provider thì inset = 0).
 *
 * ## Mất gì so với entry `.`
 *
 * - Hàng nhật ký **không vuốt để chép** — giữ lâu mở dải thao tác (có nút Chép); dòng gợi ý đổi theo.
 * - Kéo để đóng chỉ ở vùng thanh kéo + header, không nấc; `dynamic` là `maxHeight: 94%`.
 * - Bàn phím: Android chỉ bù sau khi bàn phím mở xong (nhảy một nhịp). Chưa đo trên máy.
 *
 * Thêm/bớt export ở `src/index.ts` thì sửa y như vậy ở đây — `entry-parity.test.ts` đỏ nếu hai bên
 * lệch tên.
 */

export { DevToolsGate } from '../kits/plain';
export { DevToolsUiProvider } from '../ui/DevToolsUiProvider';
export type { DevToolsUiProviderProps } from '../ui/DevToolsUiProvider';
export type { DevToolsKeyboardInputMode } from '../ui/context';
export type { DevToolsColorScheme } from '../ui/theme';
export { devtoolsStrings } from '../i18n';
export type { DeepPartial, DevToolsLocale, DevToolsStrings } from '../i18n';
export { useDevTools } from '../gate/devtools-context';
export type { DevToolsContextValue } from '../gate/devtools-context';
export { isRunningFromMetro } from '../gate/is-running-from-metro';
export type {
  DevToolsAction,
  DevToolsBugReportConfig,
  DevToolsChoice,
  DevToolsConfig,
  DevToolsExportFile,
  DevToolsGateProps,
  DevToolsPanelProps,
  DevToolsPanelReportRow,
  DevToolsRowProps,
  DevToolsShareFile,
} from '../gate/devtools-props';
export type { DevToolsAppContext } from '../report/app-context';
export type {
  BugReport,
  DevToolsCapturedImage,
  ReportFile,
  ScreenshotState,
} from '../report/bug-report';
export type {
  DevToolsSecureStore,
  StoredConnection,
} from '../report/connections/connection-store';
export { ConnectorError, defineConnector } from '../report/connectors/types';
export type {
  ConnectorContext,
  ConnectorErrorKind,
  ConnectorField,
  ConnectorFieldKind,
  ConnectorOption,
  ConnectorTestResult,
  ConnectorType,
  ConnectorValues,
  SendContext,
  SendResult,
  UploadPart,
} from '../report/connectors/types';
export { jiraCloudConnector } from '../report/connectors/jira';
export { slackConnector } from '../report/connectors/slack';
export { larkConnector } from '../report/connectors/lark';
export { webhookConnector } from '../report/connectors/webhook';
export type { ReportStep, ReportStepKind } from '../report/steps';

export { DevToolsPanel } from '../kits/plain';
export { DevToolsRow } from '../panel/DevToolsRow';
export { DevToolsChoiceRow } from '../panel/DevToolsChoiceRow';
export type { DevToolsChoiceRowProps } from '../panel/DevToolsChoiceRow';
export { LogSheet } from '../kits/plain';
export type { LogSheetProps } from '../panel/LogSheet';
export { LogRow } from '../kits/plain';
export type { LogRowProps } from '../panel/LogRow';
export { useLogEntries } from '../panel/use-log-entries';
export { useLogExport } from '../panel/use-log-export';
export type {
  LogExportState,
  UseLogExportInput,
  UseLogExportResult,
} from '../panel/use-log-export';

export * from '../capture';
export { copyText } from '../panel/copy-text';
export { usePausableEntries } from '../panel/use-pausable-entries';
export type { PausableEntries } from '../panel/use-pausable-entries';
export { usePreviousSession } from '../panel/use-previous-session';
export { LogDetail } from '../kits/plain';
export { LogDetailActions, copyTextOf } from '../panel/LogDetail';
export type { DetailTab, LogDetailProps, LogDetailActionsProps } from '../panel/LogDetail';
export type { LogRowAction } from '../panel/LogRow';

export {
  DEFAULT_SHAKE_CONFIG,
  SAMPLE_INTERVAL_MS,
  resolveShakeConfig,
} from '../shake/shake-config';
export { createShakeState, stepShake } from '../shake/detect-shake';
export type {
  ShakeConfig,
  ShakeSample,
  ShakeState,
  ShakeStep,
} from '../shake/detect-shake';
export { useShake } from '../shake/use-shake';
