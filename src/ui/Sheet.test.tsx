import { act, fireEvent, screen } from '@testing-library/react-native';
import { useContext } from 'react';
import { Pressable, Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { gorhomKit } from '../kits/gorhom-kit';
import { mockBackHandler } from '../testing/back-handler.mock';
import { renderWithDevTools } from '../testing/render-with-devtools';
import {
  lastMockSheet,
  mockPresentCalls,
  resetMockSheet,
  setMockFooterHeight,
  setMockKeyboardShown,
} from '../testing/bottom-sheet.mock';
import { useDevToolsUi } from './context';
import { DevToolsUiProvider } from './DevToolsUiProvider';
import { Sheet, type SheetProps } from './Sheet';
import { SheetKitContext } from './sheet-kit';
import { darkTheme, lightTheme } from './theme';

const onDismiss = jest.fn();

const sheet = (props: Partial<SheetProps> = {}) => (
  <Sheet visible onDismiss={onDismiss} title="Tiêu đề" testID="s" {...props}>
    <Text>Nội dung</Text>
  </Sheet>
);

beforeEach(() => {
  onDismiss.mockClear();
  resetMockSheet();
});

describe('Sheet', () => {
  it('`visible=false` ⇒ không present, không có gì trong cây', () => {
    renderWithDevTools(sheet({ visible: false }));

    expect(mockPresentCalls()).toBe(0);
    expect(screen.queryByText('Nội dung')).toBeNull();
    expect(screen.queryByText('Tiêu đề')).toBeNull();
  });

  it('`visible=true` ⇒ present, hiện nội dung + tiêu đề + dòng phụ + thanh kéo', () => {
    renderWithDevTools(sheet({ description: 'UAT · 1.0.2' }));

    expect(mockPresentCalls()).toBe(1);
    expect(screen.getByText('Nội dung')).toBeOnTheScreen();
    expect(screen.getByText('Tiêu đề')).toBeOnTheScreen();
    expect(screen.getByText('UAT · 1.0.2')).toBeOnTheScreen();
    expect(screen.getByLabelText('Vuốt xuống để đóng')).toBeOnTheScreen();
    expect(screen.getByTestId('s')).toBeOnTheScreen();
  });

  it('bấm slot trái và slot phải gọi đúng handler của từng bên', () => {
    const onLeft = jest.fn();
    const onRight = jest.fn();
    renderWithDevTools(
      sheet({
        leftAction: <Pressable testID="left" onPress={onLeft} />,
        rightAction: <Pressable testID="right" onPress={onRight} />,
      }),
    );

    fireEvent.press(screen.getByTestId('left'));
    expect(onLeft).toHaveBeenCalledTimes(1);
    expect(onRight).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('right'));
    expect(onRight).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('người dùng đóng (gorhom báo index −1) ⇒ `onDismiss` đúng một lần, báo lại không bắn đôi', () => {
    renderWithDevTools(sheet());

    act(() => lastMockSheet()?.props.onChange?.(-1));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    act(() => lastMockSheet()?.props.onChange?.(-1));
    act(() => lastMockSheet()?.props.onDismiss?.());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('đóng bằng code (`visible=false`) gỡ sheet khỏi cây mà KHÔNG gọi `onDismiss`; mở lại được', () => {
    const { rerender } = renderWithDevTools(sheet());
    expect(screen.getByText('Nội dung')).toBeOnTheScreen();

    rerender(sheet({ visible: false }));

    expect(screen.queryByText('Nội dung')).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();

    rerender(sheet({ visible: true }));

    expect(screen.getByText('Nội dung')).toBeOnTheScreen();
    expect(mockPresentCalls()).toBe(2);
  });

  it('`onClosed` bắn một lần khi sheet đã rời màn hình — đóng bằng code hay người dùng đóng; chưa mở thì không bắn', () => {
    const onClosed = jest.fn();
    const { rerender } = renderWithDevTools(sheet({ visible: false, onClosed }));
    expect(onClosed).not.toHaveBeenCalled();

    rerender(sheet({ onClosed }));
    expect(onClosed).not.toHaveBeenCalled();

    /* Đóng bằng code: gorhom báo `onDismiss` của modal khi sheet đã rời cây. */
    rerender(sheet({ visible: false, onClosed }));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    /* Người dùng vuốt xuống: index −1 rồi modal rời cây. */
    rerender(sheet({ onClosed }));
    act(() => lastMockSheet()?.props.onChange?.(-1));
    expect(onClosed).toHaveBeenCalledTimes(1);
    act(() => lastMockSheet()?.props.onDismiss?.());
    expect(onClosed).toHaveBeenCalledTimes(2);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('chân sheet + chừa inset đáy; `fullScreenSafe` xin gorhom chừa status bar', () => {
    const insets = { top: 47, bottom: 34, left: 0, right: 0 };
    renderWithDevTools(
      <SafeAreaInsetsContext.Provider value={insets}>
        {sheet({ size: 'fullScreenSafe', footer: <Text>Chân</Text> })}
      </SafeAreaInsetsContext.Provider>,
    );

    expect(screen.getByText('Chân')).toBeOnTheScreen();
    expect(screen.getByTestId('s-footer-inset')).toHaveStyle({ height: 34 });
    expect(lastMockSheet()?.props.topInset).toBe(47);
    expect(lastMockSheet()?.props.snapPoints).toEqual(['100%']);
    expect(lastMockSheet()?.props.enableDynamicSizing).toBe(false);
  });

  it('khoảng chừa đáy không nhỏ hơn lề trên của chân sheet, kể cả khi app không có inset đáy', () => {
    const insets = { top: 0, bottom: 0, left: 0, right: 0 };
    renderWithDevTools(
      <SafeAreaInsetsContext.Provider value={insets}>
        {sheet({ footer: <Text>Chân</Text> })}
      </SafeAreaInsetsContext.Provider>,
    );

    expect(screen.getByTestId('s-footer-inset')).toHaveStyle({ height: lightTheme.spacing.sm });
    expect(screen.getByTestId('s-footer')).toHaveStyle({ paddingTop: lightTheme.spacing.sm });
  });

  it('bàn phím đang hiện ⇒ bỏ inset đáy (bàn phím đã che vùng đó), chỉ giữ lề bằng lề trên', () => {
    setMockKeyboardShown(true);
    const insets = { top: 47, bottom: 34, left: 0, right: 0 };
    renderWithDevTools(
      <SafeAreaInsetsContext.Provider value={insets}>
        {sheet({ size: 'fullScreenSafe', footer: <Text>Chân</Text> })}
      </SafeAreaInsetsContext.Provider>,
    );

    expect(screen.getByText('Chân')).toBeOnTheScreen();
    expect(screen.getByTestId('s-footer-inset')).toHaveStyle({ height: lightTheme.spacing.sm });
  });

  it('`dynamic` dùng nấc theo nội dung, không chừa status bar', () => {
    renderWithDevTools(sheet({ size: 'dynamic' }));

    expect(lastMockSheet()?.props.snapPoints).toBeUndefined();
    expect(lastMockSheet()?.props.enableDynamicSizing).toBe(true);
    expect(lastMockSheet()?.props.topInset).toBeUndefined();
    expect(lastMockSheet()?.props.keyboardBehavior).toBe('interactive');
  });

  /* gorhom 5.2.14 không tự nghe Back — `Sheet` đăng ký qua `useSheetBackHandler`. */
  it('Back của Android ⇒ `onDismiss` đúng một lần; sheet đã đóng thì Back không còn bị giữ', () => {
    const back = mockBackHandler();
    const { rerender } = renderWithDevTools(sheet());

    let handled = false;
    act(() => {
      handled = back.pressBack();
    });
    expect(handled).toBe(true);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    /* App nhận `onDismiss` ⇒ hạ `visible`; sheet đóng và gỡ handler. */
    rerender(sheet({ visible: false }));
    expect(screen.queryByText('Nội dung')).toBeNull();
    expect(back.pressBack()).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    back.restore();
  });

  it('chế độ bàn phím Android lấy từ provider: vắng ⇒ `adjustPan`, khai `adjustResize` ⇒ `adjustResize`', () => {
    const { unmount } = renderWithDevTools(sheet());
    expect(lastMockSheet()?.props.android_keyboardInputMode).toBe('adjustPan');
    unmount();

    renderWithDevTools(
      <DevToolsUiProvider locale="vi" androidKeyboardInputMode="adjustResize">
        {sheet()}
      </DevToolsUiProvider>,
    );
    expect(lastMockSheet()?.props.android_keyboardInputMode).toBe('adjustResize');
  });

  it('gorhom vẽ sheet qua portal (context của gate không tới) ⇒ nội dung, header, chân vẫn đọc được bộ sheet + theme + ngôn ngữ', () => {
    /* Mock đặt hai context về `null` quanh mọi thứ modal vẽ, như portal thật (đầu `bottom-sheet.mock.tsx`). */
    const Probe = ({ id }: { id: string }) => {
      const kit = useContext(SheetKitContext);
      const ui = useDevToolsUi();
      return (
        <Text testID={id}>
          {[kit === gorhomKit ? 'kit' : 'no-kit', ui.locale, ui.theme === darkTheme ? 'dark' : 'light'].join(' ')}
        </Text>
      );
    };

    renderWithDevTools(
      <Sheet
        visible
        onDismiss={onDismiss}
        title="Tiêu đề"
        leftAction={<Probe id="in-header" />}
        footer={<Probe id="in-footer" />}
      >
        <Probe id="in-content" />
      </Sheet>,
      { locale: 'en', colorScheme: 'dark' },
    );

    for (const id of ['in-content', 'in-header', 'in-footer']) {
      expect(screen.getByTestId(id)).toHaveTextContent('kit en dark');
    }
  });
});

describe('Sheet — chân sheet và vùng cuộn (gorhom)', () => {
  /*
    Chân của gorhom nằm ĐÈ lên đáy vùng nội dung. Android cuộn ô đang focus vào trong khung nhìn của
    ScrollView (lúc chạm ô, và khi bàn phím làm khung co lại); khung còn kéo xuống dưới chân thì ô
    nằm sát đáy bị chân che (đo trên SM-M346B, 7/11/2026: ô "Mong đợi" chỉ còn ~30 px). Sheet
    `contentMode="scroll"` phải chừa ở đáy vùng nội dung đúng chiều cao chân mà gorhom đo được, và
    vùng cuộn bên trong không đệm chân thêm lần nữa.
  */
  const { ScrollView, FlatList } = gorhomKit;

  it('`scroll` ⇒ vùng nội dung chừa đáy bằng chiều cao chân gorhom đo; ScrollView bên trong không đệm chân lần nữa', () => {
    setMockFooterHeight(120);
    renderWithDevTools(
      <Sheet
        visible
        onDismiss={onDismiss}
        title="Tiêu đề"
        testID="s"
        size="fullScreenSafe"
        contentMode="scroll"
        footer={<Text>Gửi</Text>}
      >
        <ScrollView testID="scroll">
          <Text>Nội dung</Text>
        </ScrollView>
      </Sheet>,
    );

    expect(screen.getByTestId('s')).toHaveStyle({ marginBottom: 120 });
    expect(screen.getByTestId('scroll').props.enableFooterMarginAdjustment).toBe(false);
  });

  it('`scroll` + danh sách ⇒ danh sách cũng không đệm chân lần nữa', () => {
    setMockFooterHeight(96);
    renderWithDevTools(
      <Sheet
        visible
        onDismiss={onDismiss}
        title="Tiêu đề"
        testID="s"
        contentMode="scroll"
        footer={<Text>Gửi</Text>}
      >
        <FlatList testID="list" data={['a']} renderItem={({ item }) => <Text>{item}</Text>} />
      </Sheet>,
    );

    expect(screen.getByTestId('s')).toHaveStyle({ marginBottom: 96 });
    expect(screen.getByTestId('list').props.enableFooterMarginAdjustment).toBe(false);
  });

  it('gorhom chưa đo chân (giá trị khởi tạo âm) ⇒ không chừa gì', () => {
    setMockFooterHeight(-999);
    renderWithDevTools(
      <Sheet visible onDismiss={onDismiss} title="Tiêu đề" testID="s" contentMode="scroll">
        <ScrollView testID="scroll" />
      </Sheet>,
    );

    expect(screen.getByTestId('s')).toHaveStyle({ marginBottom: 0 });
  });

  it('`scrollable` (vùng cuộn là con trực tiếp, sheet ôm nội dung) ⇒ giữ cách cũ: vùng cuộn tự đệm chân', () => {
    setMockFooterHeight(120);
    renderWithDevTools(
      <Sheet visible onDismiss={onDismiss} title="Tiêu đề" contentMode="scrollable">
        <ScrollView testID="scroll" />
      </Sheet>,
    );

    expect(screen.getByTestId('scroll').props.enableFooterMarginAdjustment).toBe(true);
  });
});
