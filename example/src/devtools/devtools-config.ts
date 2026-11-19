import { Platform } from 'react-native';
import type {
  DevToolsColorScheme,
  DevToolsConfig,
  DevToolsKeyboardInputMode,
  DevToolsLocale,
} from 'react-native-shake-devtools';
import { type AppContextMode, exampleAppContext } from './app-context';
import { captureExampleScreen } from './capture-screen';
import { keychainSecureStore } from './secure-store';
import { shareReportFiles, writeCacheFile } from './share-files';

/**
 * App example luôn bật devtools, vì nó chỉ tồn tại để thử lib.
 *
 * 🔴 App thật KHÔNG chép dòng này. Khoá theo môi trường lấy từ native (flavor Android · scheme
 * iOS), và đừng dùng `__DEV__`: bản giao tester nhúng sẵn JS nhưng bundle với `--dev true`, nên
 * `__DEV__` ở đó cũng là `true`.
 */
export const DEVTOOLS_ENABLED = true;

export const APP_VERSION = '0.0.1';

/** Dòng phụ dưới tiêu đề panel, cũng ghi vào file phiên đã lưu. */
export const BUILD_LABEL = `EXAMPLE · ${APP_VERSION}`;

/** `'system'` ⇒ không ép, panel theo chế độ màu của máy. */
export type ThemeChoice = 'system' | DevToolsColorScheme;

/**
 * Chế độ bàn phím Android khớp với bản build của example. `android/gradle.properties` bật
 * `edgeToEdgeEnabled=true`, nên cửa sổ không co lại khi bàn phím mở và giá trị đúng là `'adjustPan'`.
 * Tắt edge-to-edge thì đổi thành `'adjustResize'`, vì manifest của khuôn RN khai `adjustResize`.
 *
 * App thật đặt giá trị này một lần, theo cấu hình native của nó. Example có thêm hàng chip trong
 * panel để đổi tại chỗ và thấy khai sai trông ra sao.
 */
export const DEFAULT_KEYBOARD_MODE: DevToolsKeyboardInputMode = 'adjustPan';

const deviceName = (): string =>
  Platform.OS === 'android'
    ? `${Platform.constants.Manufacturer} ${Platform.constants.Model}`
    : Platform.OS === 'ios'
    ? Platform.isPad
      ? 'iPad'
      : 'iPhone'
    : Platform.OS;

/**
 * Cấu hình panel theo lựa chọn đang có. Ngôn ngữ, theme, chế độ bàn phím và chế độ ngữ cảnh app đổi
 * được ngay trong panel (các hàng chọn-một của `useExampleActions`), nên chúng là tham số chứ không
 * phải hằng.
 *
 * Không khai `exportFile`: nút **Xuất lỗi** rơi về `Share.share` của lõi RN, tức gửi khối text.
 * App thật có `react-native-blob-util` + `react-native-share` thì cấp hàm này để ra file đính kèm.
 *
 * `bugReport` khai bốn hàm dựa trên bốn native module (`view-shot`, `keychain`, `share`,
 * `blob-util`), là hằng ở module scope nên tham chiếu không đổi qua các lần dựng config. Thêm
 * `appContext` (dữ liệu giả, xem `app-context.ts`): hàm mới theo `contextMode`, lib đọc hàm mới
 * nhất lúc dựng nháp.
 */
export const buildDevToolsConfig = (
  locale: DevToolsLocale,
  theme: ThemeChoice,
  keyboardMode: DevToolsKeyboardInputMode,
  contextMode: AppContextMode,
): DevToolsConfig => ({
  enabled: DEVTOOLS_ENABLED,
  subtitle: BUILD_LABEL,
  locale,
  colorScheme: theme === 'system' ? undefined : theme,
  androidKeyboardInputMode: keyboardMode,
  sessionInfo: () => ({
    appVersion: APP_VERSION,
    env: 'EXAMPLE',
    device: deviceName(),
    os: `${Platform.OS} ${Platform.Version}`,
    // App thật che trước khi đưa vào đây; lib không che lại trường này.
    user: '***123 · demo',
  }),
  // Khối này bật tính năng Báo bug (hàng đầu panel). Bỏ cả khối thì hàng biến mất và lib không
  // dựng gì. Mỗi hàm là một native module do app cấp; lib không kéo native module nào.
  bugReport: {
    captureScreen: captureExampleScreen,
    secureStore: keychainSecureStore,
    shareFiles: shareReportFiles,
    writeTempFile: writeCacheFile,
    // Ngữ cảnh riêng của app: mục "App context" trong ticket + `context.json`. Không có native module.
    appContext: exampleAppContext(contextMode, APP_VERSION),
  },
});
