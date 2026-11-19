import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
  type Ref,
} from 'react';
import type { FlatListProps, ScrollViewProps, TextInputProps } from 'react-native';

/**
 * Bộ phần dựng sheet mà tầng panel dùng — tách khỏi gorhom để entry `./plain` không kéo gorhom,
 * `@gorhom/portal` hay `react-native-gesture-handler` vào đồ thị module.
 *
 * 🔴 File này và mọi file panel dùng chung **không được** import (kể cả `import type`) từ
 * `@gorhom/*` hay `react-native-gesture-handler`: lib phát hành nguồn `.ts`, tsc của app kiểm luôn
 * các file đó (`skipLibCheck` chỉ bỏ qua `.d.ts`), nên app dùng `./plain` mà không cài gorhom sẽ
 * đỏ typecheck ngay ở dòng import kiểu. `src/plain/index.test.ts` dò cả đồ thị để chặn việc này.
 *
 * Hai bộ có sẵn: `gorhomKit` (`src/kits/gorhom.tsx`, entry `.`) và `plainKit`
 * (`src/kits/plain.tsx`, entry `./plain`).
 */

export type SheetSize = 'dynamic' | 'fullScreenSafe';
export type SheetContentMode = 'view' | 'scroll' | 'scrollable';

export interface SheetProps {
  /**
   * `true` ⇒ mở, `false` ⇒ đóng. Người dùng tự đóng sheet (vuốt/kéo xuống · chạm nền · nút Back
   * của Android) thì gọi `onDismiss`.
   */
  visible: boolean;
  /** Gọi khi **người dùng** đóng sheet. Đóng bằng code (`visible=false`) thì không gọi. */
  onDismiss: () => void;
  /**
   * Gọi **một lần** khi sheet đã rời hẳn màn hình (hoạt ảnh đóng xong, sheet ra khỏi cây) — dù đóng
   * bằng code hay người dùng đóng. Chưa từng mở, hoặc bị một lượt mở cắt ngang lúc đang trượt xuống,
   * thì không gọi. Dùng khi cần màn hình **không còn** sheet, vd chụp lại màn của app cho bug report.
   */
  onClosed?: () => void;
  /** Tiêu đề căn giữa ở header. */
  title: string;
  /** Dòng phụ dưới tiêu đề. */
  description?: string;
  /** Slot trái / phải của header (nút ✕, Chia sẻ…). Giữ **ổn định** (`useMemo`) — xem JSDoc `Sheet`. */
  leftAction?: ReactNode;
  rightAction?: ReactNode;
  /**
   * `dynamic` — cao theo nội dung (trần 94% màn). `fullScreenSafe` — cao tối đa nhưng chừa
   * status bar. Mặc định `dynamic`.
   */
  size?: SheetSize;
  /**
   * `view` — nội dung tĩnh, sheet ôm theo. `scroll` — con là list tự cuộn (`SheetKit.FlatList` /
   * `SheetKit.ScrollView`), vùng nội dung có chiều cao chặn. `scrollable` — con duy nhất là
   * `SheetKit.ScrollView`, sheet vẫn ôm theo nội dung (`size="dynamic"`) nhưng nội dung dài hơn trần
   * 94% màn thì vùng cuộn co lại và cuộn được; `testID` của sheet không gắn vào nội dung ở chế độ này
   * (gắn lên chính `ScrollView`). Mặc định `view`.
   */
  contentMode?: SheetContentMode;
  /** Chân sheet (nhóm nút). Giữ **ổn định** (`useMemo`) — xem JSDoc `Sheet`. */
  footer?: ReactNode;
  /** Gắn vào vùng nội dung; header/footer/handle có hậu tố `-header` · `-footer`. */
  testID?: string;
  children?: ReactNode;
}

/** Hàng vuốt-để-lộ-nút (bên trái). Bộ nào không có cử chỉ vuốt thì bỏ trống `SheetKit.SwipeRow`. */
export interface SheetSwipeRowProps {
  /** Bề rộng khối nút lộ ra — container vuốt tính ngưỡng kéo theo nó. */
  actionWidth: number;
  /** Vẽ khối nút; gọi `close()` để khép hàng lại. */
  renderAction: (close: () => void) => ReactNode;
  children: ReactNode;
}

/** Phần của ref danh sách mà panel dùng — chung cho `FlatList` của RN và `BottomSheetFlatList`. */
export interface SheetListHandle {
  scrollToOffset: (params: { offset: number; animated?: boolean | null }) => void;
}

export type SheetFlatListProps<T> = FlatListProps<T> & { ref?: Ref<SheetListHandle> };

/**
 * Các phần đổi theo bộ sheet. Mọi trường là **kiểu component ổn định** (hằng module) — đổi tham
 * chiếu giữa hai lượt render là cả cây con bị gỡ ra dựng lại.
 */
export interface SheetKit {
  /** Vỏ sheet: header căn giữa · hai cỡ · nội dung tĩnh/cuộn · chân · nền chạm để đóng · Back. */
  Sheet: ComponentType<SheetProps>;
  /** Ô nhập đặt **trong** sheet (bộ gorhom: ô tự đăng ký để sheet né bàn phím). */
  TextInput: ComponentType<TextInputProps>;
  /** Vùng cuộn trong sheet `contentMode="scroll"`. */
  ScrollView: ComponentType<ScrollViewProps>;
  /** Danh sách trong sheet `contentMode="scroll"`. */
  FlatList: <T>(props: SheetFlatListProps<T>) => ReactNode;
  /** Vỏ vuốt của hàng nhật ký. Vắng ⇒ hàng không vuốt được (chỉ còn chạm + giữ lâu). */
  SwipeRow?: ComponentType<SheetSwipeRowProps>;
}

/** Context rỗng ⇒ component dùng chung bị render ngoài entry (import thẳng file trong `src/`). */
export const SheetKitContext = createContext<SheetKit | null>(null);

/**
 * **Chức năng:** đọc bộ sheet mà entry đã gắn (`.` ⇒ gorhom · `./plain` ⇒ RN thuần).
 *
 * Không có mặc định, cố ý: mặc định nào cũng buộc file dùng chung import một bộ, mà import bộ
 * gorhom là kéo gorhom vào đồ thị của `./plain`.
 *
 * **Input:** không. **Output:** {@link SheetKit}. Không có provider ⇒ ném lỗi nói rõ cách sửa.
 *
 * @example
 * ```tsx
 * const { Sheet, FlatList } = useSheetKit();
 * // Ca biên: render `LogSheet` lấy thẳng từ `src/panel/LogSheet` (không qua entry) ⇒ ném lỗi.
 * ```
 *
 * **Unit test:** `sheet-kit.test.tsx` › `useSheetKit` — 2 case: có provider ⇒ trả đúng bộ · không
 * provider ⇒ ném lỗi nhắc import từ entry.
 */
export const useSheetKit = (): SheetKit => {
  const kit = useContext(SheetKitContext);
  if (!kit) {
    throw new Error(
      'react-native-shake-devtools: missing sheet kit. Import components from ' +
        "'react-native-shake-devtools' or 'react-native-shake-devtools/plain', not from files under src/.",
    );
  }
  return kit;
};

/**
 * **Chức năng:** bọc một component dùng chung với bộ sheet của entry — entry export bản đã bọc
 * dưới đúng tên cũ (`DevToolsGate`, `LogSheet`…), nên chỗ gọi không phải dựng provider nào.
 *
 * **Input:** `kit` (hằng module) · `Inner` · `name` (tên hiện trong React DevTools).
 * **Output:** component cùng props với `Inner`, render `Inner` dưới `SheetKitContext`.
 *
 * @example
 * ```tsx
 * export const LogSheet = withSheetKit(plainKit, LogSheetBase, 'LogSheet');
 * // Ca biên: lồng hai lớp (gate đã bọc, `LogSheet` bên trong cũng bọc) ⇒ lớp trong thắng, cùng bộ.
 * ```
 *
 * **Unit test:** `sheet-kit.test.tsx` › `withSheetKit` — 1 case: component bọc đọc được đúng bộ và
 * nhận đủ props.
 */
export const withSheetKit = <P extends object>(
  kit: SheetKit,
  Inner: ComponentType<P>,
  name: string,
): ComponentType<P> => {
  const Wrapped = (props: P) => (
    <SheetKitContext.Provider value={kit}>
      <Inner {...props} />
    </SheetKitContext.Provider>
  );
  Wrapped.displayName = name;
  return Wrapped;
};
