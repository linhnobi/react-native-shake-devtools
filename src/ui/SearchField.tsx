import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useDevToolsT } from '../i18n/use-devtools-t';
import { Icon } from './Icon';
import { useSheetKit } from './sheet-kit';
import { useStyles, useTheme } from './use-styles';
import type { DevToolsTheme } from './theme';

/** ⚠️ Hằng module-scope — `useStyles` nhớ theo tham chiếu factory. */
const stylesOf = (t: DevToolsTheme) => ({
  field: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    minHeight: t.size.field,
    paddingLeft: t.spacing.sm,
    borderRadius: t.radius.md,
    borderWidth: t.borderWidth.thin,
    borderColor: t.colors.border.strong,
    backgroundColor: t.colors.background.surface,
  },
  input: {
    flex: 1,
    paddingVertical: 0,
    ...t.typography.bodyM_Medium,
    fontWeight: '400' as const,
    color: t.colors.text.primary,
  },
  clear: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    width: t.size.field,
    height: t.size.field,
  },
});

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  /** Chữ gợi ý — cũng là tên a11y của ô. */
  placeholder?: string;
  /** Có ⇒ hiện nút ✕ khi ô có chữ; bấm gọi hàm này (thường là `onChangeText('')`). */
  onClear?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * **Chức năng:** ô tìm một dòng để đặt **trong bottom-sheet** — ô nhập lấy từ bộ sheet
 * (`SheetKit.TextInput`). Bộ gorhom: `BottomSheetTextInput`, tự báo focus cho sheet để sheet né bàn
 * phím (ô nhập thường thì gorhom không biết). Bộ thuần: `TextInput` của RN — `PlainSheet` nghe
 * thẳng sự kiện `Keyboard`, không cần ô đăng ký.
 *
 * ⚠️ Chỉ dùng **bên trong** sheet của lib: ngoài sheet, ô của gorhom không có context để đăng ký,
 * và ngoài entry thì không có bộ sheet (`useSheetKit` ném lỗi).
 *
 * **Input:** {@link SearchFieldProps}. **Output:** khung viền chứa ô nhập; nút ✕ hiện khi `value`
 * khác rỗng và có `onClear`. `testID` gắn vào chính ô nhập (`<testID>-root` cho khung,
 * `<testID>-clear` cho nút xoá).
 *
 * @example
 * ```tsx
 * <SearchField testID="search" value={q} onChangeText={setQ} onClear={() => setQ('')}
 *   placeholder="Tìm URL, mã lỗi…" />
 * // Ca biên: value rỗng ⇒ không vẽ nút ✕, dù có `onClear`.
 * ```
 *
 * **Unit test:** `SearchField.test.tsx` › `SearchField` — 4 case: gõ chữ gọi `onChangeText` · ✕ chỉ
 * hiện khi có chữ · bấm ✕ gọi `onClear` · nhãn a11y của ô và của ✕ theo ngôn ngữ.
 */
export const SearchField = ({
  value,
  onChangeText,
  placeholder,
  onClear,
  style,
  testID,
}: SearchFieldProps) => {
  const t = useDevToolsT();
  const theme = useTheme();
  const styles = useStyles(stylesOf);
  const { TextInput } = useSheetKit();
  const name = placeholder ?? t('a11y.searchField');

  return (
    <View testID={testID ? `${testID}-root` : undefined} style={style}>
      <View style={styles.field}>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.text.tertiary}
          accessibilityLabel={name}
          keyboardAppearance={theme.mode}
          selectionColor={theme.colors.text.brand}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          autoComplete="off"
          style={styles.input}
        />
        {onClear && value !== '' ? (
          <Pressable
            testID={testID ? `${testID}-clear` : undefined}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.clearInput', { label: name })}
            onPress={onClear}
            style={styles.clear}
          >
            <Icon name="close" size={theme.size.iconSm} color={theme.colors.text.secondary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};
