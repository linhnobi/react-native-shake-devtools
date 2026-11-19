import {
  BottomSheetFlatList,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { useContext, type ComponentType, type ReactNode, type Ref } from 'react';
import type { ScrollViewProps, TextInputProps } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { FooterReservedContext, Sheet } from '../ui/Sheet';
import type {
  SheetFlatListProps,
  SheetKit,
  SheetListHandle,
  SheetSwipeRowProps,
} from '../ui/sheet-kit';

/*
  Danh sách / vùng cuộn của gorhom trong sheet có chân: chân của gorhom nằm ĐÈ lên nội dung, nên phải
  chừa đáy bằng chiều cao chân. Sheet `contentMode="scroll"` đã chừa sẵn ở vùng nội dung
  (`FooterReservedContext`, xem `ScrollContent` trong `Sheet.tsx`) ⇒ vùng cuộn không đệm thêm; còn lại
  (vùng cuộn là con trực tiếp của sheet, `scrollable`) ⇒ `enableFooterMarginAdjustment` đệm như cũ.
  Cờ này là chuyện riêng của gorhom nên nằm ở đây, không ở `LogSheet`/`LogDetail`.
*/
type GorhomListRef = Ref<SheetListHandle>;
const AnyBottomSheetFlatList = BottomSheetFlatList as unknown as ComponentType<
  Record<string, unknown> & { ref?: GorhomListRef }
>;

const GorhomFlatList = <T,>({ ref, ...props }: SheetFlatListProps<T>): ReactNode => {
  const footerReserved = useContext(FooterReservedContext);
  return (
    <AnyBottomSheetFlatList ref={ref} enableFooterMarginAdjustment={!footerReserved} {...props} />
  );
};

const GorhomScrollView = ({ children, ...props }: ScrollViewProps) => {
  const footerReserved = useContext(FooterReservedContext);
  return (
    <BottomSheetScrollView enableFooterMarginAdjustment={!footerReserved} {...props}>
      {children}
    </BottomSheetScrollView>
  );
};

/**
 * Hàng vuốt phải để lộ nút (nút Chép của `LogRow`). `overshootLeft={false}` để hàng không kéo quá
 * bề rộng nút rồi bật lại — với danh sách dày đặc, cú bật đó làm mất dấu dòng đang xem. Ngưỡng =
 * nửa bề rộng nút: kéo quá nửa là nhả tay thì hàng mở hẳn, dưới nửa thì đóng lại.
 */
const GorhomSwipeRow = ({ actionWidth, renderAction, children }: SheetSwipeRowProps) => (
  <ReanimatedSwipeable
    friction={2}
    leftThreshold={actionWidth / 2}
    overshootLeft={false}
    renderLeftActions={(_progress, _translation, methods) => renderAction(() => methods.close())}
  >
    {children}
  </ReanimatedSwipeable>
);

/**
 * **Chức năng:** bộ sheet của entry `.` — `Sheet` trên `BottomSheetModal`, ô nhập/vùng cuộn/danh
 * sách của gorhom (tự đăng ký với sheet để né bàn phím), hàng vuốt-để-chép của gesture-handler.
 *
 * **Điều kiện ở app:** `BottomSheetModalProvider` + `GestureHandlerRootView` ở gốc cây.
 *
 * **Input:** không (hằng module). **Output:** {@link SheetKit}.
 *
 * @example
 * ```tsx
 * <SheetKitContext.Provider value={gorhomKit}>{children}</SheetKitContext.Provider>
 * // Ca biên: không dùng trực tiếp ở app — entry `.` export bản đã bọc (`bindSheetKit`).
 * ```
 *
 * **Unit test:** gián tiếp — `renderWithDevTools` gắn bộ này mặc định, mọi test panel chạy trên nó.
 */
export const gorhomKit: SheetKit = {
  Sheet,
  TextInput: BottomSheetTextInput as unknown as ComponentType<TextInputProps>,
  ScrollView: GorhomScrollView,
  FlatList: GorhomFlatList,
  SwipeRow: GorhomSwipeRow,
};
