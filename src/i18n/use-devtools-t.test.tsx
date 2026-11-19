import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type { DevToolsLocale } from './types';
import { DevToolsUiProvider } from '../ui/DevToolsUiProvider';
import { useDevToolsT } from './use-devtools-t';

const withLocale =
  (locale: DevToolsLocale, strings?: { panel?: { title?: string } }) =>
  ({ children }: { children: ReactNode }) => (
    <DevToolsUiProvider locale={locale} strings={strings}>
      {children}
    </DevToolsUiProvider>
  );

describe('useDevToolsT', () => {
  it('chữ theo `locale` của provider (vi và en)', () => {
    const vi = renderHook(() => useDevToolsT(), { wrapper: withLocale('vi') });
    const en = renderHook(() => useDevToolsT(), { wrapper: withLocale('en') });

    expect(vi.result.current('panel.title')).toBe('Công cụ gỡ lỗi');
    expect(en.result.current('panel.title')).toBe('Debug tools');
  });

  it('không có provider ⇒ tiếng Anh', () => {
    const { result } = renderHook(() => useDevToolsT());

    expect(result.current('panel.title')).toBe('Debug tools');
  });

  it('`strings` của provider ghi đè khoá được khai', () => {
    const strings = { panel: { title: 'Dev menu' } };
    const { result } = renderHook(() => useDevToolsT(), { wrapper: withLocale('vi', strings) });

    expect(result.current('panel.title')).toBe('Dev menu');
    expect(result.current('panel.log')).toBe('Nhật ký');
  });

  it('thay biến', () => {
    const { result } = renderHook(() => useDevToolsT(), { wrapper: withLocale('vi') });

    expect(result.current('panel.snooze', { minutes: 5 })).toBe('Tắt lắc trong 5 phút');
  });

  it('`t` giữ tham chiếu khi render lại với cùng ngôn ngữ, đổi khi đổi ngôn ngữ', () => {
    const { result, rerender } = renderHook(() => useDevToolsT(), {
      wrapper: withLocale('vi'),
    });
    const first = result.current;
    rerender({});

    expect(result.current).toBe(first);

    const en = renderHook(() => useDevToolsT(), { wrapper: withLocale('en') });
    expect(en.result.current).not.toBe(first);
  });
});
