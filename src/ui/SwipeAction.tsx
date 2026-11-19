import { Pressable, Text as RNText, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from './use-styles';

export interface SwipeActionProps {
  label: string;
  onPress?: () => void;
  /** Màu nền. Mặc định `success`. */
  tone?: 'success' | 'danger';
  /**
   * Chỉ nhận **bề rộng** và các thuộc tính bố cục — bề rộng thuộc về chỗ gắn (container vuốt cần
   * biết nó để tính ngưỡng kéo), nên không có số mặc định ở đây.
   */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * **Chức năng:** khối nút nằm sau hàng khi vuốt (đặt vào `renderLeftActions`/`renderRightActions`
 * của `ReanimatedSwipeable`) — nền đặc một sắc, chữ đậm giữa khối.
 *
 * **Input:** {@link SwipeActionProps}. **Output:** `Pressable` role `button` lấp đầy chiều cao hàng
 * (`alignSelf: stretch`), tên a11y = `label`.
 *
 * @example
 * ```tsx
 * <SwipeAction label="Chép" tone="success" style={{ width: 80 }} onPress={copy} />
 * // Ca biên: không truyền `width` ⇒ khối ôm sát chữ — luôn truyền bề rộng qua `style`.
 * ```
 *
 * **Unit test:** `SwipeAction.test.tsx` › `SwipeAction` — 3 case: bấm gọi `onPress` · `tone` đổi nền ·
 * `style` truyền bề rộng vào khối.
 */
export const SwipeAction = ({ label, onPress, tone = 'success', style, testID }: SwipeActionProps) => {
  const { colors, typography, spacing } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        {
          alignSelf: 'stretch',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacing.sm,
          backgroundColor: colors.background[tone],
        },
        style,
      ]}
    >
      <RNText style={{ ...typography.captionS_Bold, color: colors.text.onFilled }}>{label}</RNText>
    </Pressable>
  );
};
