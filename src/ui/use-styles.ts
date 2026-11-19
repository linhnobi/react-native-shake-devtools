import { StyleSheet } from 'react-native';
import { useDevToolsUi } from './context';
import type { DevToolsTheme } from './theme';

type Named = Record<string, object>;
type Factory<T extends Named> = (theme: DevToolsTheme) => T;

/**
 * Cache theo **(theme, factory)** — một hàng log có hàng chục bản `LogRow`, không có cache thì
 * mỗi bản tự dựng `StyleSheet` giống hệt nhau. Khoá theo tham chiếu nên `WeakMap`: theme/factory
 * hết sống thì mục cache đi theo.
 */
const cache = new WeakMap<DevToolsTheme, WeakMap<Factory<Named>, Named>>();

const stylesFor = <T extends Named>(theme: DevToolsTheme, factory: Factory<T>): T => {
  let perTheme = cache.get(theme);
  if (!perTheme) {
    perTheme = new WeakMap();
    cache.set(theme, perTheme);
  }
  const key = factory as unknown as Factory<Named>;
  const hit = perTheme.get(key);
  if (hit) return hit as T;
  const made = StyleSheet.create(factory(theme) as never) as unknown as T;
  perTheme.set(key, made);
  return made;
};

/**
 * **Chức năng:** dựng `StyleSheet` từ theme hiện tại, nhớ theo cặp (theme, factory).
 *
 * ⚠️ `factory` phải là **hằng ở module scope**. Viết hàm trong thân render là cache miss vĩnh
 * viễn — mỗi render một `StyleSheet` mới, và cũng mất ý nghĩa của cache.
 *
 * **Input:** `factory(theme)` trả object style có tên. **Output:** object style cùng hình.
 *
 * @example
 * ```tsx
 * const stylesOf = (t: DevToolsTheme) => ({ row: { padding: t.spacing.md } });
 * const styles = useStyles(stylesOf);   // styles.row
 * // Ca biên: đổi theme (sáng ↔ tối) ⇒ trả bộ style khác; đổi lại ⇒ lấy lại bộ cũ từ cache.
 * ```
 *
 * **Unit test:** `use-styles.test.tsx` › `useStyles` — 3 case: cùng theme + factory ⇒ cùng tham
 * chiếu · đổi theme ⇒ style theo token mới · hai factory không dùng chung kết quả.
 */
export const useStyles = <T extends Named>(factory: Factory<T>): T => {
  const { theme } = useDevToolsUi();
  return stylesFor(theme, factory);
};

/**
 * **Chức năng:** đọc theme hiện tại (khi cần giá trị lẻ ngoài `StyleSheet`, vd màu động theo
 * trạng thái nhấn).
 *
 * **Input:** không. **Output:** {@link DevToolsTheme}.
 *
 * @example
 * ```tsx
 * const { colors } = useTheme();
 * <Pressable style={({ pressed }) => ({ backgroundColor: pressed ? colors.background.surfaceAlt : colors.background.surface })} />
 * ```
 *
 * **Unit test:** `DevToolsUiProvider.test.tsx` › `useTheme` — gián tiếp qua 4 case của provider.
 */
export const useTheme = (): DevToolsTheme => useDevToolsUi().theme;
