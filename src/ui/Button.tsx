import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text as RNText, type ViewStyle } from 'react-native';
import { useTheme } from './use-styles';
import type { DevToolsTheme } from './theme';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary';
export type ButtonSize = 'sm' | 'md';

/** Thứ nút đưa cho `leftIcon`: cạnh icon hợp với bậc nút và màu chữ hiện tại của nút. */
export interface ButtonIconContext {
  size: number;
  color: string;
}

export interface ButtonProps {
  /** Chữ trên nút — và là tên a11y mặc định (nút chỉ có icon vẫn có tên). */
  label: string;
  onPress?: () => void;
  /** Mặc định `primary`. */
  variant?: ButtonVariant;
  /** Mặc định `md`. */
  size?: ButtonSize;
  disabled?: boolean;
  /** Đang chạy: hiện vòng quay thay nhãn và **không** nhận chạm. */
  loading?: boolean;
  /** Chỉ vẽ icon (`leftIcon`), nút vuông; nhãn vẫn là tên a11y. */
  iconOnly?: boolean;
  /** Hàm vẽ icon — nhận {@link ButtonIconContext}. */
  leftIcon?: (ctx: ButtonIconContext) => ReactNode;
  /** Ghi đè tên a11y khi nhãn hiển thị không đủ nghĩa (vd nút "Chia sẻ" mà đích là một dòng). */
  accessibilityLabel?: string;
  testID?: string;
}

type Look = {
  background: string;
  pressedBackground: string;
  borderColor: string;
  color: string;
};

const lookOf = (theme: DevToolsTheme, variant: ButtonVariant, inactive: boolean): Look => {
  const { colors } = theme;
  if (inactive) {
    return {
      background: variant === 'tertiary' ? 'transparent' : colors.background.surfaceAlt,
      pressedBackground: colors.background.surfaceAlt,
      borderColor: variant === 'secondary' ? colors.border.subtle : 'transparent',
      color: colors.text.disabled,
    };
  }
  switch (variant) {
    case 'primary':
      return {
        background: colors.background.brand,
        pressedBackground: colors.background.brandPressed,
        borderColor: 'transparent',
        color: colors.text.onFilled,
      };
    case 'secondary':
      return {
        background: colors.background.surface,
        pressedBackground: colors.background.surfaceAlt,
        borderColor: colors.border.strong,
        color: colors.text.primary,
      };
    case 'tertiary':
      return {
        background: 'transparent',
        pressedBackground: colors.background.surfaceAlt,
        borderColor: 'transparent',
        color: colors.text.brand,
      };
  }
};

/**
 * **Chức năng:** nút bấm của lib — ba kiểu (`primary` đặc · `secondary` viền · `tertiary` chữ) × hai
 * bậc (`md` 44dp · `sm` 32dp, được bù `hitSlop` tới 44dp chạm).
 *
 * **Input:** {@link ButtonProps}. **Output:** `Pressable` role `button`, `accessibilityState`
 * `{ disabled, busy }`. `disabled` hoặc `loading` ⇒ không gọi `onPress`.
 *
 * @example
 * ```tsx
 * <Button label="Xuất lỗi" size="sm" variant="secondary" onPress={run} loading={busy} />
 * <Button label="Đóng" iconOnly variant="tertiary" onPress={close}
 *   leftIcon={({ size }) => <Icon name="close" size={size} />} />
 * // Ca biên: iconOnly không vẽ nhãn nhưng `label` vẫn là tên a11y; loading ⇒ vòng quay, chạm bị chặn.
 * ```
 *
 * **Unit test:** `Button.test.tsx` › `Button` — 6 case: gọi `onPress` · `disabled` chặn chạm và báo
 * a11y · `loading` chặn chạm + hiện vòng quay thay nhãn · `iconOnly` không vẽ nhãn mà giữ tên a11y ·
 * `accessibilityLabel` ghi đè tên · bậc `sm` được bù `hitSlop`.
 */
export const Button = ({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  iconOnly = false,
  leftIcon,
  accessibilityLabel,
  testID,
}: ButtonProps) => {
  const theme = useTheme();
  const [pressed, setPressed] = useState(false);
  const inactive = disabled || loading;
  const look = lookOf(theme, variant, inactive);

  const handlePress = useCallback(() => {
    /* Chốt ở đây chứ không chỉ ở `disabled` của Pressable: gọi trực tiếp `onPress` prop của
       element (test, hoặc cầu nối a11y) không đi qua cờ đó. */
    if (!inactive) onPress?.();
  }, [inactive, onPress]);

  const height = size === 'sm' ? theme.size.buttonSm : theme.size.buttonMd;
  const slop = Math.max(0, Math.ceil((theme.size.minTouch - height) / 2));
  const typo = size === 'sm' ? theme.typography.captionS_Bold : theme.typography.bodyM_Medium;
  const iconSize = size === 'sm' ? theme.size.iconSm : theme.size.iconMd;

  const root: ViewStyle = {
    minHeight: height,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderRadius: theme.radius.md,
    borderWidth: theme.borderWidth.thin,
    borderColor: look.borderColor,
    backgroundColor: pressed && !inactive ? look.pressedBackground : look.background,
    ...(iconOnly
      ? { width: height, height }
      : { paddingHorizontal: size === 'sm' ? theme.spacing.sm : theme.spacing.md }),
  };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={handlePress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      hitSlop={slop > 0 ? { top: slop, bottom: slop, left: iconOnly ? slop : 0, right: iconOnly ? slop : 0 } : undefined}
      style={root}
    >
      {loading ? (
        <ActivityIndicator size="small" color={look.color} />
      ) : iconOnly ? (
        leftIcon?.({ size: iconSize, color: look.color })
      ) : (
        <>
          {leftIcon?.({ size: iconSize, color: look.color })}
          <RNText
            numberOfLines={1}
            style={{ ...typo, color: look.color, fontWeight: '600' }}
          >
            {label}
          </RNText>
        </>
      )}
    </Pressable>
  );
};
