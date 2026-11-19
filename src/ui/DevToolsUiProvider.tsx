import { useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { resolveStrings } from '../i18n/translate';
import type { DeepPartial, DevToolsLocale, DevToolsStrings } from '../i18n/types';
import {
  DEFAULT_KEYBOARD_INPUT_MODE,
  DevToolsUiContext,
  type DevToolsKeyboardInputMode,
  type DevToolsUiValue,
} from './context';
import { themeOf, type DevToolsColorScheme } from './theme';

/** Props của {@link DevToolsUiProvider}. */
export interface DevToolsUiProviderProps {
  /** Ngôn ngữ chuỗi dựng sẵn. Mặc định `'en'`. */
  locale?: DevToolsLocale;
  /**
   * Ghi đè / dịch thêm chuỗi. Giữ tham chiếu **ổn định** (hằng module hoặc `useMemo`): object mới
   * mỗi render làm bộ chuỗi trộn lại mỗi lần.
   */
  strings?: DeepPartial<DevToolsStrings>;
  /** Ép chế độ màu. Vắng ⇒ theo hệ thống (`useColorScheme()`); hệ thống không báo ⇒ sáng. */
  colorScheme?: DevToolsColorScheme;
  /**
   * Cửa sổ Android phản ứng thế nào khi bàn phím mở. Mặc định `'adjustPan'` (app edge-to-edge).
   * App không edge-to-edge mà manifest khai `adjustResize` thì truyền `'adjustResize'`. Xem
   * {@link DevToolsKeyboardInputMode}.
   */
  androidKeyboardInputMode?: DevToolsKeyboardInputMode;
  children?: ReactNode;
}

/**
 * **Chức năng:** cấp theme + ngôn ngữ + chuỗi + chế độ bàn phím Android cho mọi thành phần giao
 * diện của lib bên dưới.
 * `DevToolsGate` đã tự bọc provider này theo `DevToolsConfig`; chỉ cần dùng trực tiếp khi app tự
 * ghép panel/màn nhật ký mà không qua gate.
 *
 * **Input:** {@link DevToolsUiProviderProps}. **Output:** `children` trong context.
 *
 * @example
 * ```tsx
 * <DevToolsUiProvider locale="vi" colorScheme="dark">
 *   <LogSheet visible onDismiss={close} />
 * </DevToolsUiProvider>
 * // Ca biên: không truyền gì ⇒ tiếng Anh, màu theo hệ thống.
 * ```
 *
 * **Unit test:** `DevToolsUiProvider.test.tsx` › `DevToolsUiProvider` — 5 case: mặc định (gồm
 * `adjustPan`) · `androidKeyboardInputMode` đi xuống context · `locale` vi · `colorScheme` thắng hệ
 * thống · đổi `colorScheme` đổi theme mà không đổi chuỗi.
 */
export const DevToolsUiProvider = ({
  locale = 'en',
  strings,
  colorScheme,
  androidKeyboardInputMode = DEFAULT_KEYBOARD_INPUT_MODE,
  children,
}: DevToolsUiProviderProps) => {
  const system = useColorScheme();
  const theme = themeOf(colorScheme ?? system);
  const resolved = useMemo(() => resolveStrings(locale, strings), [locale, strings]);
  const value = useMemo<DevToolsUiValue>(
    () => ({ theme, locale, strings: resolved, androidKeyboardInputMode }),
    [theme, locale, resolved, androidKeyboardInputMode],
  );
  return <DevToolsUiContext.Provider value={value}>{children}</DevToolsUiContext.Provider>;
};
