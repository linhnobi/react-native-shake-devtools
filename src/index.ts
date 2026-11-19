/**
 * `react-native-shake-devtools` — công cụ gỡ lỗi **trong app**, dùng chung cho mọi app.
 *
 * ## Lib này KHÔNG chứa gì
 *
 * Không biết "prod" là gì · không đọc `BuildConfig`/`.env` của app nào · không biết app có
 * những công cụ gì. Nó chỉ có **cơ chế** (bắt cú lắc, chính sách bật/tắt, vỏ sheet) + **một
 * sổ đăng ký hành động**. Phần đổi theo app — `enabled`, dòng phụ môi trường, danh sách hàng —
 * app truyền vào qua `DevToolsConfig` + `DevToolsAction[]`, sống ở
 * thư mục của app (vd `src/devtools/`).
 *
 * Nhờ vậy thêm một app mới tốn 3 việc và **không sửa file nào trong đây**: khai dependency, viết
 * cấu hình + mảng hành động, mount `<DevToolsGate>`. Lib tự mang theme và chuỗi (vi · en) của nó —
 * không bước nạp bundle i18n nào, không cần design system của app.
 *
 * ## Năm entry
 *
 * | Entry | Có gì | Kéo theo |
 * |---|---|---|
 * | `react-native-shake-devtools/shake` | bắt cú lắc, headless | chỉ `react-native-reanimated` |
 * | `react-native-shake-devtools/capture` | thu console + HTTP, headless | không gì (thuần JS) |
 * | `react-native-shake-devtools/i18n` | chuỗi dựng sẵn `devtoolsStrings` (vi · en) + kiểu để ghi đè | không gì (kiểu) |
 * | `react-native-shake-devtools` *(file này)* | + panel, màn nhật ký, cổng môi trường, theme + chuỗi tự mang | + `@gorhom/bottom-sheet`, `react-native-gesture-handler`, `react-native-safe-area-context` |
 * | `react-native-shake-devtools/plain` | cùng API với file này, sheet dựng bằng RN lõi | + `react-native-safe-area-context` — **không** gorhom, **không** gesture-handler |
 *
 * ## Điều kiện ở app
 *
 * `DevToolsPanel` dựng trên `BottomSheetModal` của gorhom nên cây app phải có
 * `BottomSheetModalProvider` + `GestureHandlerRootView` ở gốc cây (`SafeAreaProvider` nếu có thì
 * sheet chừa đúng status bar / home indicator; không có thì inset coi là 0). Không muốn hai provider
 * đầu thì dùng entry `./plain` (`src/plain/index.ts`).
 *
 * Năm component cần bộ sheet (`DevToolsGate` · `DevToolsPanel` · `LogSheet` · `LogRow` · `LogDetail`)
 * export từ `./kits/gorhom` — bản đã gắn bộ gorhom, cùng tên và props với bản gốc.
 *
 * ## Giao diện
 *
 * `DevToolsGate` tự bọc `DevToolsUiProvider`; chọn ngôn ngữ · ghi đè chuỗi · ép sáng/tối qua
 * `DevToolsConfig.locale` · `strings` · `colorScheme`. Ghép panel/màn nhật ký không qua gate thì
 * tự bọc `<DevToolsUiProvider>`.
 */

export { DevToolsGate } from './kits/gorhom';
export { DevToolsUiProvider } from './ui/DevToolsUiProvider';
export type { DevToolsUiProviderProps } from './ui/DevToolsUiProvider';
export type { DevToolsKeyboardInputMode } from './ui/context';
export type { DevToolsColorScheme } from './ui/theme';
export { devtoolsStrings } from './i18n';
export type { DeepPartial, DevToolsLocale, DevToolsStrings } from './i18n';
export { useDevTools } from './gate/devtools-context';
export type { DevToolsContextValue } from './gate/devtools-context';
export { isRunningFromMetro } from './gate/is-running-from-metro';
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
} from './gate/devtools-props';
export type { DevToolsAppContext } from './report/app-context';
export type {
  BugReport,
  DevToolsCapturedImage,
  ReportFile,
  ScreenshotState,
} from './report/bug-report';
export type {
  DevToolsSecureStore,
  StoredConnection,
} from './report/connections/connection-store';
export { ConnectorError, defineConnector } from './report/connectors/types';
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
} from './report/connectors/types';
export { jiraCloudConnector } from './report/connectors/jira';
export { slackConnector } from './report/connectors/slack';
export { larkConnector } from './report/connectors/lark';
export { webhookConnector } from './report/connectors/webhook';
export type { ReportStep, ReportStepKind } from './report/steps';

export { DevToolsPanel } from './kits/gorhom';
export { DevToolsRow } from './panel/DevToolsRow';
export { DevToolsChoiceRow } from './panel/DevToolsChoiceRow';
export type { DevToolsChoiceRowProps } from './panel/DevToolsChoiceRow';
export { LogSheet } from './kits/gorhom';
export type { LogSheetProps } from './panel/LogSheet';
export { LogRow } from './kits/gorhom';
export type { LogRowProps } from './panel/LogRow';
export { useLogEntries } from './panel/use-log-entries';
export { useLogExport } from './panel/use-log-export';
export type {
  LogExportState,
  UseLogExportInput,
  UseLogExportResult,
} from './panel/use-log-export';

export * from './capture';
export { copyText } from './panel/copy-text';
export { usePausableEntries } from './panel/use-pausable-entries';
export type { PausableEntries } from './panel/use-pausable-entries';
export { usePreviousSession } from './panel/use-previous-session';
export { LogDetail } from './kits/gorhom';
export { LogDetailActions, copyTextOf } from './panel/LogDetail';
export type { DetailTab, LogDetailProps, LogDetailActionsProps } from './panel/LogDetail';
export type { LogRowAction } from './panel/LogRow';

export {
  DEFAULT_SHAKE_CONFIG,
  SAMPLE_INTERVAL_MS,
  resolveShakeConfig,
} from './shake/shake-config';
export { createShakeState, stepShake } from './shake/detect-shake';
export type {
  ShakeConfig,
  ShakeSample,
  ShakeState,
  ShakeStep,
} from './shake/detect-shake';
export { useShake } from './shake/use-shake';
