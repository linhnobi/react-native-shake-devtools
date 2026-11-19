import { View } from 'react-native';
import { Text } from './Text';
import { useTheme } from './use-styles';

export interface ChipProps {
  label: string;
  /** `active` = đang chọn (nền đặc). Mặc định `default`. */
  state?: 'default' | 'active';
  testID?: string;
}

/**
 * **Chức năng:** viên thuốc nhãn — không tự bấm được (bọc trong `Pressable` của chỗ dùng, vì chip
 * là phần **hiển thị** của một lựa chọn chứ không phải nút).
 *
 * **Input:** {@link ChipProps}. **Output:** `View` role `text`, `accessibilityState.selected` theo
 * `state` để trạng thái chọn đi ra cả bằng a11y, không chỉ bằng màu.
 *
 * @example
 * ```tsx
 * <Pressable onPress={pick}><Chip label="Chỉ lỗi" state={on ? 'active' : 'default'} /></Pressable>
 * // Ca biên: `active` đổi cả nền lẫn màu chữ (chữ trên nền đặc dùng `text.onFilled`).
 * ```
 *
 * **Unit test:** `Chip.test.tsx` › `Chip` — 3 case: vẽ nhãn · `active` đổi nền + màu chữ + báo
 * `selected` · `default` dùng nền phụ.
 */
export const Chip = ({ label, state = 'default', testID }: ChipProps) => {
  const { colors, spacing, radius, borderWidth } = useTheme();
  const active = state === 'active';
  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityState={{ selected: active }}
      style={{
        alignSelf: 'flex-start',
        paddingVertical: spacing['2xs'],
        paddingHorizontal: spacing.sm,
        borderRadius: radius.pill,
        borderWidth: borderWidth.thin,
        borderColor: active ? colors.background.brand : colors.border.subtle,
        backgroundColor: active ? colors.background.brand : colors.background.surfaceAlt,
      }}
    >
      <Text
        variant="captionS_Medium"
        style={{ color: active ? colors.text.onFilled : colors.text.secondary }}
      >
        {label}
      </Text>
    </View>
  );
};
