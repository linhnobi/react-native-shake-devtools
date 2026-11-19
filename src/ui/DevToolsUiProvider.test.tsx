import { render, screen } from '@testing-library/react-native';
import { Text, useColorScheme } from 'react-native';
import { useDevToolsUi, type DevToolsUiValue } from './context';
import { DevToolsUiProvider } from './DevToolsUiProvider';
import { darkTheme, lightTheme } from './theme';

/** Đọc giá trị context ra chữ + giữ tham chiếu `strings` để so sánh giữa hai lượt render. */
let seen: DevToolsUiValue | undefined;
const Probe = () => {
  const ui = useDevToolsUi();
  seen = ui;
  return <Text testID="probe">{`${ui.theme.mode}|${ui.locale}`}</Text>;
};

/* Preset jest của RN thay `useColorScheme` bằng một `jest.fn` luôn trả 'light' — đặt giá trị ở đây. */
const system = (scheme: 'light' | 'dark' | 'unspecified') =>
  jest.mocked(useColorScheme).mockReturnValue(scheme);

afterEach(() => {
  seen = undefined;
  jest.mocked(useColorScheme).mockReturnValue('light');
});

describe('useDevToolsUi', () => {
  it('không có provider ⇒ tiếng Anh + theme theo hệ thống', () => {
    system('dark');
    render(<Probe />);

    expect(screen.getByTestId('probe')).toHaveTextContent('dark|en');
    expect(seen?.theme).toBe(darkTheme);
    expect(seen?.strings.panel.title).toBe('Debug tools');
    expect(seen?.androidKeyboardInputMode).toBe('adjustPan');
  });

  it('không có provider và hệ thống không báo ⇒ sáng', () => {
    system('unspecified');
    render(<Probe />);

    expect(seen?.theme).toBe(lightTheme);
  });

  it('có provider ⇒ lấy của provider, kể cả khi hệ thống ngược lại', () => {
    system('dark');
    render(
      <DevToolsUiProvider locale="vi" colorScheme="light">
        <Probe />
      </DevToolsUiProvider>,
    );

    expect(screen.getByTestId('probe')).toHaveTextContent('light|vi');
    expect(seen?.strings.panel.title).toBe('Công cụ gỡ lỗi');
  });
});

describe('DevToolsUiProvider', () => {
  it('không truyền gì ⇒ tiếng Anh, màu theo hệ thống', () => {
    system('light');
    render(
      <DevToolsUiProvider>
        <Probe />
      </DevToolsUiProvider>,
    );

    expect(screen.getByTestId('probe')).toHaveTextContent('light|en');
    expect(seen?.androidKeyboardInputMode).toBe('adjustPan');
  });

  it('`androidKeyboardInputMode="adjustResize"` đi xuống context', () => {
    render(
      <DevToolsUiProvider androidKeyboardInputMode="adjustResize">
        <Probe />
      </DevToolsUiProvider>,
    );

    expect(seen?.androidKeyboardInputMode).toBe('adjustResize');
  });

  it('`locale="vi"` đổi bộ chuỗi sang tiếng Việt', () => {
    render(
      <DevToolsUiProvider locale="vi">
        <Probe />
      </DevToolsUiProvider>,
    );

    expect(seen?.locale).toBe('vi');
    expect(seen?.strings.common.close).toBe('Đóng');
  });

  it('`colorScheme` thắng hệ thống', () => {
    system('light');
    render(
      <DevToolsUiProvider colorScheme="dark">
        <Probe />
      </DevToolsUiProvider>,
    );

    expect(screen.getByTestId('probe')).toHaveTextContent('dark|en');
    expect(seen?.theme).toBe(darkTheme);
  });

  it('đổi `colorScheme` đổi theme nhưng giữ nguyên bộ chuỗi (không trộn lại)', () => {
    const { rerender } = render(
      <DevToolsUiProvider colorScheme="light">
        <Probe />
      </DevToolsUiProvider>,
    );
    const strings = seen?.strings;

    rerender(
      <DevToolsUiProvider colorScheme="dark">
        <Probe />
      </DevToolsUiProvider>,
    );

    expect(seen?.theme).toBe(darkTheme);
    expect(seen?.strings).toBe(strings);
  });
});
