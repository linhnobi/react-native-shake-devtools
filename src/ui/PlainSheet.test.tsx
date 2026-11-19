import { act, fireEvent, screen } from '@testing-library/react-native';
import { Keyboard, Platform, Pressable, Text, type KeyboardEvent } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { plainKit } from '../kits/plain-kit';
import { mockBackHandler, type BackHandlerMock } from '../testing/back-handler.mock';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { DevToolsUiProvider } from './DevToolsUiProvider';
import { PlainSheet, shouldCloseOnRelease } from './PlainSheet';
import type { SheetProps } from './sheet-kit';
import { lightTheme } from './theme';

const onDismiss = jest.fn();
let back: BackHandlerMock;

/* Listener `Keyboard` bắt theo tên để tự phát — xem `use-sheet-keyboard.test.ts`. */
let keyboardListeners: Record<string, Array<(e: KeyboardEvent) => void>> = {};
const emitKeyboard = (name: string, height: number) =>
  act(() =>
    (keyboardListeners[name] ?? []).forEach((fn) =>
      fn({
        duration: 0,
        easing: 'keyboard',
        endCoordinates: { height, width: 390, screenX: 0, screenY: 800 - height },
      } as KeyboardEvent),
    ),
  );

const sheet = (props: Partial<SheetProps> = {}) => (
  <PlainSheet visible onDismiss={onDismiss} title="Tiêu đề" testID="s" {...props}>
    <Text>Nội dung</Text>
  </PlainSheet>
);

const renderSheet = (ui = sheet()) => renderWithDevTools(ui, { kit: plainKit });

const withInsets = (insets: { top: number; bottom: number }, ui = sheet()) => (
  <SafeAreaInsetsContext.Provider value={{ left: 0, right: 0, ...insets }}>{ui}</SafeAreaInsetsContext.Provider>
);

beforeEach(() => {
  onDismiss.mockClear();
  back = mockBackHandler();
  keyboardListeners = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, fn) => {
    (keyboardListeners[name] ??= []).push(fn as (e: KeyboardEvent) => void);
    return { remove: () => undefined } as ReturnType<typeof Keyboard.addListener>;
  });
});
afterEach(() => {
  back.restore();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('PlainSheet', () => {
  it('`visible=false` ⇒ không có gì trong cây', () => {
    renderSheet(sheet({ visible: false }));

    expect(screen.queryByText('Nội dung')).toBeNull();
    expect(screen.queryByText('Tiêu đề')).toBeNull();
    expect(back.count()).toBe(0);
  });

  it('`visible=true` ⇒ hiện nội dung + tiêu đề + dòng phụ + thanh kéo', () => {
    renderSheet(sheet({ description: 'UAT · 1.0.2' }));

    expect(screen.getByText('Nội dung')).toBeOnTheScreen();
    expect(screen.getByText('Tiêu đề')).toBeOnTheScreen();
    expect(screen.getByText('UAT · 1.0.2')).toBeOnTheScreen();
    expect(screen.getByLabelText('Vuốt xuống để đóng')).toBeOnTheScreen();
    expect(screen.getByTestId('s')).toBeOnTheScreen();
  });

  it('bấm slot trái và slot phải gọi đúng handler của từng bên', () => {
    const onLeft = jest.fn();
    const onRight = jest.fn();
    renderSheet(
      sheet({
        leftAction: <Pressable testID="left" onPress={onLeft} />,
        rightAction: <Pressable testID="right" onPress={onRight} />,
      }),
    );

    fireEvent.press(screen.getByTestId('left'));
    fireEvent.press(screen.getByTestId('right'));

    expect(onLeft).toHaveBeenCalledTimes(1);
    expect(onRight).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('chạm nền ⇒ `onDismiss` đúng một lần, chạm lại không bắn đôi', () => {
    renderSheet();

    fireEvent.press(screen.getByTestId('s-backdrop', { includeHiddenElements: true }));
    fireEvent.press(screen.getByTestId('s-backdrop', { includeHiddenElements: true }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Back ⇒ `onDismiss`; sheet đã đóng thì Back không còn bị giữ', () => {
    const { rerender } = renderSheet();

    let handled = false;
    act(() => {
      handled = back.pressBack();
    });
    expect(handled).toBe(true);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender(sheet({ visible: false }));
    expect(back.pressBack()).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('đóng bằng code ⇒ trượt xong mới gỡ khỏi cây, KHÔNG gọi `onDismiss`; mở lại được', () => {
    /* Mock `NativeAnimatedModule` của preset báo hoạt ảnh xong sau một `setTimeout` 16 ms: đồng hồ
       giả để lượt gỡ khỏi cây chạy TRONG `act` (đợi bằng `waitFor` thì cập nhật kẹt trong act). */
    jest.useFakeTimers();
    const { rerender } = renderSheet();

    rerender(sheet({ visible: false }));
    expect(screen.getByText('Nội dung')).toBeOnTheScreen();
    act(() => jest.advanceTimersByTime(50));
    expect(screen.queryByText('Nội dung')).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();

    rerender(sheet({ visible: true }));
    expect(screen.getByText('Nội dung')).toBeOnTheScreen();
  });

  it('`onClosed` bắn một lần sau khi sheet trượt xong và rời cây; bị lượt mở cắt ngang thì không bắn', () => {
    jest.useFakeTimers();
    const onClosed = jest.fn();
    const { rerender } = renderSheet(sheet({ visible: false, onClosed }));
    rerender(sheet({ onClosed }));
    act(() => jest.advanceTimersByTime(50));
    expect(onClosed).not.toHaveBeenCalled();

    rerender(sheet({ visible: false, onClosed }));
    expect(onClosed).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(50));
    expect(screen.queryByText('Nội dung')).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);

    /* Đóng rồi mở lại ngay trong lúc đang trượt xuống ⇒ sheet chưa từng rời màn hình. */
    rerender(sheet({ onClosed }));
    act(() => jest.advanceTimersByTime(50));
    rerender(sheet({ visible: false, onClosed }));
    rerender(sheet({ onClosed }));
    act(() => jest.advanceTimersByTime(50));
    expect(screen.getByText('Nội dung')).toBeOnTheScreen();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('`fullScreenSafe` chừa status bar; `dynamic` có trần 94%', () => {
    const { unmount } = renderSheet(withInsets({ top: 47, bottom: 34 }, sheet({ size: 'fullScreenSafe' })));
    expect(screen.getByTestId('s-sheet')).toHaveStyle({ top: 47, bottom: 0 });
    unmount();

    renderSheet(withInsets({ top: 47, bottom: 34 }));
    expect(screen.getByTestId('s-sheet')).toHaveStyle({ maxHeight: '94%' });
  });

  it('chân sheet + chừa inset đáy', () => {
    renderSheet(withInsets({ top: 47, bottom: 34 }, sheet({ footer: <Text>Chân</Text> })));

    expect(screen.getByText('Chân')).toBeOnTheScreen();
    expect(screen.getByTestId('s-footer-inset')).toHaveStyle({ height: 34 });
  });

  it('khoảng chừa đáy không nhỏ hơn lề trên của chân, kể cả khi app không có inset đáy', () => {
    renderSheet(withInsets({ top: 0, bottom: 0 }, sheet({ footer: <Text>Chân</Text> })));

    expect(screen.getByTestId('s-footer-inset')).toHaveStyle({ height: lightTheme.spacing.sm });
    expect(screen.getByTestId('s-footer')).toHaveStyle({ paddingTop: lightTheme.spacing.sm });
  });

  it('bàn phím hiện (iOS) ⇒ nâng đáy sheet đúng chiều cao bàn phím, chân bỏ inset đáy', () => {
    renderSheet(
      withInsets({ top: 47, bottom: 34 }, sheet({ size: 'fullScreenSafe', footer: <Text>Chân</Text> })),
    );

    emitKeyboard('keyboardWillShow', 336);

    expect(screen.getByTestId('s-sheet')).toHaveStyle({ bottom: 336 });
    expect(screen.getByTestId('s-footer-inset')).toHaveStyle({ height: lightTheme.spacing.sm });
  });

  it('Android `adjustResize` ⇒ bàn phím hiện nhưng KHÔNG nâng sheet (cửa sổ đã co)', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    renderSheet(
      <DevToolsUiProvider locale="vi" androidKeyboardInputMode="adjustResize">
        {withInsets({ top: 24, bottom: 0 }, sheet({ size: 'fullScreenSafe', footer: <Text>Chân</Text> }))}
      </DevToolsUiProvider>,
    );

    emitKeyboard('keyboardDidShow', 300);

    expect(screen.getByTestId('s-sheet')).toHaveStyle({ bottom: 0 });
  });
});

describe('shouldCloseOnRelease', () => {
  it('kéo quá 120dp ⇒ đóng', () => {
    expect(shouldCloseOnRelease(130, 0, 600)).toBe(true);
    expect(shouldCloseOnRelease(110, 0, 600)).toBe(false);
  });

  it('sheet thấp ⇒ quá ¼ chiều cao là đủ', () => {
    expect(shouldCloseOnRelease(40, 0, 120)).toBe(true);
    expect(shouldCloseOnRelease(25, 0, 120)).toBe(false);
  });

  it('kéo ngắn nhưng hất mạnh ⇒ đóng', () => {
    expect(shouldCloseOnRelease(20, 0.8, 600)).toBe(true);
  });

  it('không kéo xuống (dy ≤ 0) ⇒ không đóng, dù vận tốc lớn', () => {
    expect(shouldCloseOnRelease(0, 2, 600)).toBe(false);
    expect(shouldCloseOnRelease(-50, 2, 600)).toBe(false);
  });
});
