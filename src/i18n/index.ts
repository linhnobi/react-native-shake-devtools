/**
 * Entry `react-native-shake-devtools/i18n` — chuỗi dựng sẵn của lib và kiểu để app ghi đè.
 *
 * Lib tự dịch, không cần thư viện i18n nào ở app: chọn ngôn ngữ bằng `DevToolsConfig.locale`
 * (`'vi'` | `'en'`, mặc định `'en'`) và ghi đè/dịch thêm bằng `DevToolsConfig.strings`.
 *
 * ```ts
 * import { devtoolsStrings, type DevToolsStrings } from 'react-native-shake-devtools/i18n';
 *
 * devtoolsStrings.vi.panel.title; // 'Công cụ gỡ lỗi'
 * ```
 */
import { en } from './en';
import { vi } from './vi';

export { devtoolsStrings } from './translate';
export { useDevToolsT } from './use-devtools-t';
export type {
  DeepPartial,
  DevToolsKey,
  DevToolsLocale,
  DevToolsStrings,
  TVars,
} from './types';

export { vi as devtoolsVi, en as devtoolsEn };
