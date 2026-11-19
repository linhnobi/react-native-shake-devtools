import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react-native';
import type { DevToolsLocale } from '../i18n/types';
import type { DevToolsColorScheme } from '../ui/theme';
import { DevToolsUiProvider } from '../ui/DevToolsUiProvider';
import { SheetKitContext, type SheetKit } from '../ui/sheet-kit';
import { gorhomKit } from '../kits/gorhom-kit';

export interface RenderWithDevToolsOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Ngôn ngữ chuỗi. Mặc định `'vi'` — các test của lib assert chữ tiếng Việt. */
  locale?: DevToolsLocale;
  /** Chế độ màu. Mặc định `'light'` (không để test đổi theo máy chạy). */
  colorScheme?: DevToolsColorScheme;
  /** Bộ sheet. Mặc định `gorhomKit` (entry `.`) — test của bộ thuần truyền `plainKit`. */
  kit?: SheetKit;
}

/**
 * **Chức năng:** `render` của RNTL bọc bộ sheet + `DevToolsUiProvider` — cho test của thành phần
 * dùng theme, chuỗi hoặc sheet của lib. Hạ tầng test, **không** export từ entry nào.
 *
 * ⚠️ File này import bộ gorhom: test chặn gorhom khỏi entry `./plain` (`src/plain/index.test.ts`)
 * **không** được dùng nó.
 *
 * **Input:** `ui` · `{ locale = 'vi', colorScheme = 'light', kit = gorhomKit, ...renderOptions }`.
 * **Output:** `RenderResult`. `rerender` giữ nguyên wrapper.
 *
 * @example
 * ```tsx
 * renderWithDevTools(<DevToolsRow testID="r" label="Nhật ký" onPress={fn} />);
 * renderWithDevTools(<LogSheet … />, { locale: 'en', colorScheme: 'dark', kit: plainKit });
 * // Ca biên: mặc định cố định sáng + tiếng Việt, không phụ thuộc `useColorScheme()` của máy chạy test.
 * ```
 *
 * **Unit test:** không có test riêng — hạ tầng, được mọi test render dùng gián tiếp.
 */
export const renderWithDevTools = (
  ui: ReactElement,
  {
    locale = 'vi',
    colorScheme = 'light',
    kit = gorhomKit,
    ...options
  }: RenderWithDevToolsOptions = {},
): RenderResult => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <SheetKitContext.Provider value={kit}>
      <DevToolsUiProvider locale={locale} colorScheme={colorScheme}>
        {children}
      </DevToolsUiProvider>
    </SheetKitContext.Provider>
  );
  return render(ui, { wrapper: Wrapper, ...options });
};
