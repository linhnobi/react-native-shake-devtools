import { SearchField } from '../ui/SearchField';
import { useStyles } from '../ui/use-styles';
import type { DevToolsTheme } from '../ui/theme';
import { useDevToolsT } from '../i18n';

/** ⚠️ Hằng module-scope — xem ghi chú cùng tên ở `DevToolsRow.tsx`. */
const stylesOf = (t: DevToolsTheme) => ({
  root: {
    marginHorizontal: t.spacing.md,
    marginTop: t.spacing.sm,
  },
});

export interface LogSearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
}

/**
 * **Chức năng:** ô tìm của màn nhật ký — `SearchField` của lib (đăng ký bàn phím với sheet).
 *
 * Không debounce ở đây: ô là controlled, màn lọc bằng `useDeferredValue` — gõ không bị giật mà
 * cũng không có nhịp trễ cố định nào phải chỉnh.
 *
 * **Input:** `value` · `onChangeText`.
 * **Output:** thanh tìm có nút ✕ (hiện khi ô có chữ).
 *
 * @example
 * ```tsx
 * <LogSearchField value={query} onChangeText={setQuery} />
 * // Ca biên: bấm ✕ ⇒ onChangeText('') — danh sách về đủ dòng ngay, không chờ debounce.
 * ```
 *
 * **Unit test:** `LogSheet.test.tsx` › `LogSheet — tìm kiếm` — 2 case phủ gián tiếp (gõ chữ ⇒
 * danh sách lọc · lọc hết rồi "Bỏ lọc" ⇒ ô tìm rỗng, về đủ dòng). Nút ✕ là hành vi của
 * `SearchField`, test ở `SearchField.test.tsx`.
 */
export const LogSearchField = ({ value, onChangeText }: LogSearchFieldProps) => {
  const t = useDevToolsT();
  const styles = useStyles(stylesOf);

  return (
    <SearchField
      testID="devtools-log-search"
      style={styles.root}
      value={value}
      onChangeText={onChangeText}
      onClear={() => onChangeText('')}
      placeholder={t('log.searchPlaceholder')}
    />
  );
};
