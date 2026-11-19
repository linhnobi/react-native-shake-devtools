/**
 * Mock `@gorhom/bottom-sheet` cho jest — hạ tầng test, **không** export từ entry nào của lib.
 *
 * Vì sao không dùng thẳng `@gorhom/bottom-sheet/mock`: bản chính thức render `children` **vô điều
 * kiện** (mọi sheet chưa mở vẫn nằm trong cây ⇒ test kiểu "bấm thì sheet hiện" xanh kể cả khi
 * `visible` nối sai), bỏ qua `handleComponent`/`footerComponent`/`backdropComponent` (nơi `Sheet`
 * đặt header · chân · nền), và không có `BottomSheetFooter`.
 *
 * Bản này giữ phần còn lại của mock chính thức, chỉ thay bốn thứ `Sheet` chạm vào. `present()` và
 * `close()` **có** đổi cây; mock cố ý không giả lập hoạt ảnh hay hình học (không có giai đoạn
 * "đang trượt") — những thứ đó chỉ đo được trên máy thật.
 *
 * **Portal:** `BottomSheetModal` thật render cả sheet qua `@gorhom/portal` ở chỗ
 * `BottomSheetModalProvider` đứng (gốc app, **trên** `DevToolsGate`), nên context đặt giữa provider
 * đó và sheet — `SheetKitContext`, `DevToolsUiContext` — **không** tới nội dung, header, chân. Mock
 * giả lập đúng điều đó: mọi thứ modal vẽ nằm dưới hai context ấy đặt lại về `null`. Thiếu bước này
 * thì test xanh mà máy thật ném "missing sheet kit" và mất theme trong sheet (đo trên SM-M346B,
 * 6/11/2026).
 */
import { Component, createElement, type ReactNode } from 'react';
import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { DevToolsUiContext } from '../ui/context';
import { SheetKitContext } from '../ui/sheet-kit';

interface StyledProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

interface ModalProps {
  children?: ReactNode;
  handleComponent?: () => ReactNode;
  footerComponent?: (props: Record<string, never>) => ReactNode;
  backdropComponent?: (props: Record<string, never>) => ReactNode;
  onChange?: (index: number) => void;
  onDismiss?: () => void;
  accessibilityLabel?: string;
  backgroundStyle?: StyleProp<ViewStyle>;
  snapPoints?: Array<string | number>;
  enableDynamicSizing?: boolean;
  maxDynamicContentSize?: number;
  keyboardBehavior?: string;
  keyboardBlurBehavior?: string;
  android_keyboardInputMode?: string;
  topInset?: number;
  stackBehavior?: string;
}

/** Lớp chứa: `testID` ở vùng nội dung (như `Sheet`), nên `View` thường là đủ. */
const MockView = ({ children, style, testID }: StyledProps) =>
  createElement(View, { style, testID }, children);

const MockBackdrop = ({ style, accessibilityLabel }: StyledProps) =>
  createElement(View, { style, accessibilityLabel });

/**
 * Trạng thái bàn phím mà sheet giả "nhìn thấy". Số theo `KEYBOARD_STATUS` của gorhom (không export
 * public): 1 = đang hiện, 2 = đã ẩn. Mặc định ẩn; `resetMockSheet()` đặt lại.
 */
let mockKeyboardStatus = 2;

/**
 * Chiều cao chân sheet mà gorhom "đo được" (`animatedLayoutState.footerHeight`). Mặc định 0;
 * `resetMockSheet()` đặt lại.
 */
let mockFooterHeight = 0;

/**
 * `useBottomSheetInternal` của mock chính thức trả `0` cho mọi giá trị động, nên không giả được bàn
 * phím hay chân sheet. Bản này trả `animatedKeyboardState` đọc từ {@link mockKeyboardStatus} và
 * `animatedLayoutState` đọc từ {@link mockFooterHeight}; các trường khác vẫn lấy của mock chính thức.
 */
const createUseBottomSheetInternal = (official: () => Record<string, unknown>) => () =>
  new Proxy(
    {
      animatedKeyboardState: { get: () => ({ status: mockKeyboardStatus }) },
      animatedLayoutState: { get: () => ({ footerHeight: mockFooterHeight }) },
    },
    {
      get: (target, prop: string) =>
        prop in target ? target[prop as keyof typeof target] : official()[prop],
    },
  );

class MockBottomSheetModal extends Component<ModalProps, { presented: boolean }> {
  /** Thể hiện mới nhất — để test gọi `props.onChange(-1)` giả lập vuốt xuống. */
  static last: MockBottomSheetModal | null = null;
  /** Số lần `present()` đã được gọi trên mọi thể hiện — test "không present". */
  static presentCalls = 0;

  override state = { presented: false };

  constructor(props: ModalProps) {
    super(props);
    MockBottomSheetModal.last = this;
  }

  present() {
    MockBottomSheetModal.presentCalls += 1;
    this.setState({ presented: true });
  }
  close() {
    this.notifyDismissed();
  }
  dismiss() {
    this.notifyDismissed();
  }
  forceClose() {
    this.notifyDismissed();
  }

  /** Bản thật bắn `onDismiss` khi sheet rời cây — mock bắn ở mọi lệnh đóng. */
  private notifyDismissed() {
    this.setState({ presented: false });
    this.props.onDismiss?.();
  }

  override render() {
    if (!this.state.presented) return null;
    const { children, handleComponent, footerComponent, backdropComponent } = this.props;
    const forwarded = {
      accessibilityLabel: this.props.accessibilityLabel,
      style: this.props.backgroundStyle,
      snapPoints: this.props.snapPoints,
      enableDynamicSizing: this.props.enableDynamicSizing,
      maxDynamicContentSize: this.props.maxDynamicContentSize,
      keyboardBehavior: this.props.keyboardBehavior,
      keyboardBlurBehavior: this.props.keyboardBlurBehavior,
      android_keyboardInputMode: this.props.android_keyboardInputMode,
      topInset: this.props.topInset,
      stackBehavior: this.props.stackBehavior,
    } as ViewProps;
    /* Thứ tự cây thật: nền → thanh kéo + header → nội dung → chân. `{}` chứ không `undefined`: render
       prop thật nhận props của gorhom và spread chúng. Hai provider `null` bên ngoài: xem "Portal"
       ở đầu file. */
    return createElement(
      SheetKitContext.Provider,
      { value: null },
      createElement(
        DevToolsUiContext.Provider,
        { value: null },
        createElement(
          View,
          forwarded,
          backdropComponent?.({}),
          handleComponent?.(),
          children,
          footerComponent?.({}),
        ),
      ),
    );
  }
}

/**
 * **Chức năng:** object thay thế module `@gorhom/bottom-sheet` trong jest.
 *
 * **Input:** không. **Output:** mọi export của mock chính thức; `BottomSheetModal` · `BottomSheetView`
 * · `BottomSheetBackdrop` · `BottomSheetFooter` là bản render đủ vùng.
 *
 * @example
 * ```ts
 * // src/test-setup.ts — factory phải lười, `jest.mock` bị hoist lên đầu file
 * jest.mock('@gorhom/bottom-sheet', () => require('./testing/bottom-sheet.mock').createBottomSheetMock());
 * ```
 *
 * **Unit test:** không có test riêng — hạ tầng, được `Sheet.test.tsx` và mọi test của panel dùng
 * gián tiếp; mock hỏng thì các test đó đỏ.
 */
export const createBottomSheetMock = () => ({
  ...jest.requireActual('@gorhom/bottom-sheet/mock'),
  BottomSheetModal: MockBottomSheetModal,
  BottomSheetView: MockView,
  BottomSheetBackdrop: MockBackdrop,
  BottomSheetFooter: MockView,
  useBottomSheetInternal: createUseBottomSheetInternal(
    jest.requireActual('@gorhom/bottom-sheet/mock').useBottomSheetInternal,
  ),
});

/** Giả lập gorhom báo bàn phím đang hiện (`true`) hoặc đã ẩn (`false`). */
export const setMockKeyboardShown = (shown: boolean): void => {
  mockKeyboardStatus = shown ? 1 : 2;
};

/** Giả lập chiều cao chân sheet gorhom đã đo (`animatedLayoutState.footerHeight`). */
export const setMockFooterHeight = (height: number): void => {
  mockFooterHeight = height;
};

/** Thể hiện `BottomSheetModal` mới nhất của mock — test giả lập cử chỉ đóng của gorhom. */
export const lastMockSheet = (): InstanceType<typeof MockBottomSheetModal> | null =>
  MockBottomSheetModal.last;

/** Số lần `present()` đã gọi từ lúc `resetMockSheet()` gần nhất. */
export const mockPresentCalls = (): number => MockBottomSheetModal.presentCalls;

/** Đặt lại bộ đếm/thể hiện — gọi trong `beforeEach` của test cần chúng. */
export const resetMockSheet = (): void => {
  MockBottomSheetModal.last = null;
  MockBottomSheetModal.presentCalls = 0;
  mockKeyboardStatus = 2;
  mockFooterHeight = 0;
};
