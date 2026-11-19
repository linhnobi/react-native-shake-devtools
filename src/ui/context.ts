import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';
import { resolveStrings } from '../i18n/translate';
import type { DevToolsLocale, DevToolsStrings } from '../i18n/types';
import { themeOf, type DevToolsTheme } from './theme';

/**
 * Cửa sổ Android phản ứng thế nào khi bàn phím mở, để sheet bù **đúng một lần**. Đây là
 * `android_keyboardInputMode` của gorhom.
 *
 * - `'adjustPan'`: cửa sổ **không** co lại, gorhom tự đẩy sheet lên. Đúng khi app chạy edge-to-edge
 *   (`adjustResize` trong manifest khi đó mất tác dụng), hoặc khi manifest khai `adjustPan`.
 * - `'adjustResize'`: cửa sổ **đã** co lại, gorhom không đẩy thêm. Đúng khi cửa sổ **không**
 *   edge-to-edge và manifest khai `adjustResize`. Với khuôn React Native 0.86 (target SDK 36) điều
 *   này chỉ xảy ra trên Android ≤ 14 khi `edgeToEdgeEnabled=false`. Bảng đầy đủ ở
 *   `DevToolsConfig.androidKeyboardInputMode`.
 *
 * Khai sai thì có hai kiểu hỏng, cả hai đã đo trên Samsung SM-M346B (Android 14):
 * - `'adjustPan'` cho cửa sổ có co: bù hai lần, chân sheet nhảy lên đè ô tìm và danh sách trống.
 * - `'adjustResize'` cho app edge-to-edge: không được bù, bàn phím che chân sheet và cuối danh sách.
 *
 * Entry `./plain` (sheet không gorhom) đọc cùng giá trị, cùng nghĩa: `'adjustPan'` ⇒ `PlainSheet` tự
 * nâng đáy bằng chiều cao bàn phím; `'adjustResize'` ⇒ không nâng. Chưa đo trên máy — xem
 * `useSheetKeyboard`.
 *
 * iOS bỏ qua giá trị này.
 */
export type DevToolsKeyboardInputMode = 'adjustPan' | 'adjustResize';

/** Mặc định của gorhom, và đúng với app edge-to-edge. */
export const DEFAULT_KEYBOARD_INPUT_MODE: DevToolsKeyboardInputMode = 'adjustPan';

/** Thứ `DevToolsUiProvider` cấp xuống: theme + ngôn ngữ + bộ chuỗi đã trộn + chế độ bàn phím Android. */
export interface DevToolsUiValue {
  theme: DevToolsTheme;
  locale: DevToolsLocale;
  strings: DevToolsStrings;
  androidKeyboardInputMode: DevToolsKeyboardInputMode;
}

/** Context rỗng ⇒ không có provider ở trên: dùng mặc định (tiếng Anh, theme theo hệ thống). */
export const DevToolsUiContext = createContext<DevToolsUiValue | null>(null);

/** Chuỗi mặc định khi không có provider — dựng một lần, giữ tham chiếu ổn định. */
const DEFAULT_STRINGS = resolveStrings('en');

/**
 * **Chức năng:** đọc theme + ngôn ngữ + chuỗi + chế độ bàn phím Android của lib. Có
 * `DevToolsUiProvider` ở trên thì lấy của nó; **không có** thì rơi về mặc định: ngôn ngữ `'en'`,
 * theme theo `useColorScheme()`, bàn phím `'adjustPan'`.
 *
 * Mặc định này để panel/hàng/ô riêng lẻ dùng được khi không bọc gì (vd app tự ghép từ các export
 * như `DevToolsRow`), thay vì ném lỗi.
 *
 * **Input:** không. **Output:** {@link DevToolsUiValue}.
 *
 * @example
 * ```tsx
 * const { theme, locale } = useDevToolsUi();
 * // Ca biên: không provider + hệ thống tối ⇒ theme tối, locale 'en'.
 * ```
 *
 * **Unit test:** `DevToolsUiProvider.test.tsx` › `useDevToolsUi` — 3 case: không provider ⇒ en + theme
 * theo hệ thống + `adjustPan` · hệ thống không báo ⇒ sáng · có provider ⇒ lấy của provider dù hệ
 * thống ngược lại.
 */
export const useDevToolsUi = (): DevToolsUiValue => {
  const ctx = useContext(DevToolsUiContext);
  const system = useColorScheme();
  if (ctx) return ctx;
  return {
    theme: themeOf(system),
    locale: 'en',
    strings: DEFAULT_STRINGS,
    androidKeyboardInputMode: DEFAULT_KEYBOARD_INPUT_MODE,
  };
};
