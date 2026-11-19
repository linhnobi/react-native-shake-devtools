import type { ComponentType, ReactNode, Ref } from 'react';
import {
  FlatList,
  ScrollView,
  TextInput,
  type ScrollViewProps,
  type TextInputProps,
} from 'react-native';
import { PlainSheet } from '../ui/PlainSheet';
import type { SheetFlatListProps, SheetKit } from '../ui/sheet-kit';

const PlainFlatList = <T,>({ ref, ...props }: SheetFlatListProps<T>): ReactNode => (
  <FlatList ref={ref as Ref<FlatList<T>>} {...props} />
);

/**
 * **Chức năng:** bộ sheet của entry `./plain` — chỉ React Native lõi: `PlainSheet` +
 * `TextInput` · `ScrollView` · `FlatList` của RN. **Không** có `SwipeRow`: hàng nhật ký không vuốt
 * để chép được, dòng gợi ý chỉ nói tới cú giữ lâu (dải thao tác có sẵn nút Chép).
 *
 * 🔴 File này không được import gì (kể cả `import type`) từ `@gorhom/*` hay
 * `react-native-gesture-handler` — xem `src/plain/index.test.ts`.
 *
 * **Input:** không (hằng module). **Output:** {@link SheetKit}.
 *
 * @example
 * ```tsx
 * <SheetKitContext.Provider value={plainKit}>{children}</SheetKitContext.Provider>
 * // Ca biên: không dùng trực tiếp ở app — entry `./plain` export bản đã bọc (`bindSheetKit`).
 * ```
 *
 * **Unit test:** gián tiếp — `src/plain/index.test.ts` render panel + nhật ký qua entry `./plain`.
 */
export const plainKit: SheetKit = {
  Sheet: PlainSheet,
  TextInput: TextInput as unknown as ComponentType<TextInputProps>,
  ScrollView: ScrollView as unknown as ComponentType<ScrollViewProps>,
  FlatList: PlainFlatList,
};
