import { fireEvent, screen, userEvent } from '@testing-library/react-native';
import { plainKit } from '../kits/plain-kit';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { lightTheme } from '../ui/theme';
import type { ConsoleEntry, MarkerEntry, NetworkEntry } from '../capture/log-entry';
import { DEFAULT_SLOW_MS } from '../capture/log-query';
import { LogRow, type LogRowProps } from './LogRow';

/*
  `ReanimatedSwipeable` thật dựng `GestureDetector` + shared value của reanimated — cử chỉ vuốt
  không kiểm được bằng jest, còn file này kiểm NỘI DUNG của hàng. Thay bằng một vỏ trong suốt:
  vẽ dải nút trái (`renderLeftActions`, tức nút Chép) rồi tới `children`, kèm bộ `methods` câm để
  `onPress` của nút Chép gọi `methods.close()` không nổ. Dựng bằng `createElement` chứ không JSX:
  factory của `jest.mock` bị hoist, không được chạm biến `_jsx` mà babel chèn ở đầu file.
*/
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const { createElement, Fragment } = jest.requireActual('react');
  const methods = {
    close: jest.fn(),
    openLeft: jest.fn(),
    openRight: jest.fn(),
    reset: jest.fn(),
  };
  return {
    __esModule: true,
    default: ({
      children,
      renderLeftActions,
    }: {
      children?: unknown;
      renderLeftActions?: (
        progress: unknown,
        translation: unknown,
        swipeable: typeof methods,
      ) => unknown;
    }) => createElement(Fragment, null, renderLeftActions?.({}, {}, methods), children),
  };
});

const theme = lightTheme;
const AT = new Date(2026, 8, 24, 14, 26, 40, 120).getTime();

const con = (over: Partial<ConsoleEntry> = {}): ConsoleEntry => ({
  id: 1,
  kind: 'console',
  at: AT,
  level: 'info',
  text: 'screen mounted',
  ...over,
});

const net = (over: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id: 2,
  kind: 'network',
  at: AT,
  method: 'GET',
  url: 'https://api.test/user/list',
  ...over,
});

const MARKER: MarkerEntry = { id: 3, kind: 'marker', at: AT, type: 'screen', label: 'UserList' };

const row = (props: Partial<LogRowProps> = {}) => (
  <LogRow testID="row" entry={con()} expanded={false} onCopy={jest.fn()} {...props} />
);

const render = (props: Partial<LogRowProps> = {}) => renderWithDevTools(row(props));

describe('LogRow', () => {
  it('dòng console hiện mức viết hoa', () => {
    render({ entry: con({ level: 'warn', text: 'componentWillMount is deprecated' }) });

    expect(screen.getByText('WARN')).toBeOnTheScreen();
    expect(screen.queryByText('warn')).toBeNull();
    expect(screen.getByText('componentWillMount is deprecated')).toBeOnTheScreen();
  });

  /* Lỗi không ai bắt được gọi đúng tên — không lẫn với một lời `console.error` thường. */
  it('lỗi fatal hiện `FATAL`', () => {
    render({
      entry: con({ level: 'error', uncaught: true, fatal: true, text: 'TypeError: boom' }),
    });

    expect(screen.getByText('FATAL')).toBeOnTheScreen();
    expect(screen.queryByText('UNCAUGHT')).toBeNull();
    expect(screen.queryByText('ERROR')).toBeNull();
  });

  it('dòng mạng hiện method + status + thời lượng', () => {
    render({ entry: net({ status: 200, durationMs: 812 }) });

    expect(screen.getByText('GET')).toBeOnTheScreen();
    expect(screen.getByText('200 · 812ms')).toBeOnTheScreen();
    expect(screen.getByText('https://api.test/user/list')).toBeOnTheScreen();
  });

  /* Biên dưới 400 là danger, 399 thì không — khoá QUAN HỆ với token chứ không ghim mã màu. */
  it('status ≥ 400 dùng tone danger', () => {
    const { rerender } = render({ entry: net({ status: 400, durationMs: 120 }) });

    expect(screen.getByText('GET')).toHaveStyle({ color: theme.colors.text.danger });
    expect(screen.getByText('400 · 120ms')).toHaveStyle({ color: theme.colors.text.danger });

    rerender(row({ entry: net({ status: 399, durationMs: 120 }) }));

    expect(screen.getByText('GET')).toHaveStyle({ color: theme.colors.text.success });
  });

  /* Huỷ không phải lỗi (`isErrorEntry`): xám trung tính, chữ đã dịch thay cho nhãn dữ liệu `abort`. */
  it('request bị huỷ hiện "Đã huỷ" tone xám, không danger', () => {
    const { rerender } = render({ entry: net({ error: 'abort', durationMs: 40 }) });

    expect(screen.getByText('Đã huỷ · 40ms')).toHaveStyle({ color: theme.colors.text.tertiary });
    expect(screen.getByText('GET')).toHaveStyle({ color: theme.colors.text.tertiary });

    rerender(row({ entry: net({ error: 'timeout', durationMs: 5000 }) }));

    expect(screen.getByText('timeout · 5000ms')).toHaveStyle({ color: theme.colors.text.danger });
  });

  it('request chậm có nhãn "Chậm"', () => {
    const { rerender } = render({ entry: net({ status: 200, durationMs: DEFAULT_SLOW_MS }) });

    expect(screen.getByTestId('row-slow')).toHaveTextContent('Chậm');

    rerender(row({ entry: net({ status: 200, durationMs: DEFAULT_SLOW_MS - 1 }) }));

    expect(screen.queryByTestId('row-slow')).toBeNull();
  });

  it('mốc màn hiện câu đã dịch và không nhận chạm', async () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    render({ entry: MARKER, onPress, onLongPress });

    expect(screen.getByText('→ Màn UserList')).toBeOnTheScreen();
    /* Mốc không có vai trò nút, và không có dải vuốt (nút Chép) nào đi kèm. */
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    /*
      `userEvent`, không phải `fireEvent`: `fireEvent.press` đi ngược cây tìm `onPress` và gặp prop
      `onPress` của chính component `LogRow` (composite) ⇒ gọi nó dù hàng mốc không có Pressable nào.
      `userEvent` chỉ bắn vào host view — đúng thứ ngón tay chạm được.
    */
    const user = userEvent.setup();
    await user.press(screen.getByTestId('row'));
    await user.longPress(screen.getByTestId('row'));

    expect(onPress).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('`menu` vẽ đủ nút và bấm gọi đúng hành động', () => {
    const copyCurl = jest.fn();
    const shareEntry = jest.fn();
    render({
      entry: net({ status: 500 }),
      menu: [
        { id: 'curl', label: 'Chép cURL', onPress: copyCurl },
        { id: 'share', label: 'Chia sẻ dòng này', onPress: shareEntry },
      ],
    });

    expect(screen.getByTestId('row-menu')).toBeOnTheScreen();
    expect(screen.getByTestId('row-act-curl')).toHaveTextContent('Chép cURL');
    expect(screen.getByTestId('row-act-share')).toHaveTextContent('Chia sẻ dòng này');

    fireEvent.press(screen.getByTestId('row-act-share'));

    expect(shareEntry).toHaveBeenCalledTimes(1);
    expect(copyCurl).not.toHaveBeenCalled();
  });

  /* Callback nhận chính dòng đó — màn truyền MỘT hàm cho mọi hàng, `memo` của hàng mới có tác dụng. */
  it('`onLongPress` được gọi (kèm chính dòng đó) khi giữ lâu', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    const entry = net({ status: 200 });
    render({ entry, onPress, onLongPress });

    fireEvent(screen.getByTestId('row'), 'longPress');

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledWith(entry);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('`copied` hiện dấu xác nhận', () => {
    const { rerender } = render({ entry: con(), copied: false });
    expect(screen.queryByTestId('row-copied')).toBeNull();

    rerender(row({ entry: con(), copied: true }));

    expect(screen.getByTestId('row-copied')).toHaveTextContent('Đã chép');
  });
});

describe('LogRow — bộ sheet', () => {
  it('bộ gorhom: vuốt lộ nút Chép, bấm chép đúng dòng này', () => {
    const onCopy = jest.fn();
    const entry = net({ status: 500 });
    render({ entry, onCopy });

    fireEvent.press(screen.getByTestId('row-copy'));

    expect(onCopy).toHaveBeenCalledWith(entry);
  });

  it('bộ thuần (không `SwipeRow`): không có nút Chép vuốt, giữ lâu vẫn mở dải thao tác', () => {
    const onLongPress = jest.fn();
    const entry = con();
    renderWithDevTools(row({ entry, onLongPress }), { kit: plainKit });

    expect(screen.queryByTestId('row-copy')).toBeNull();
    fireEvent(screen.getByTestId('row'), 'longPress');
    expect(onLongPress).toHaveBeenCalledWith(entry);
  });
});
