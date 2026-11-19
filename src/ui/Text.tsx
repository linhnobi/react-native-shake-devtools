import { memo } from 'react';
import { Text as RNText, type StyleProp, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme } from './use-styles';
import type { DevToolsTheme } from './theme';

/** Bậc chữ — khoá của `theme.typography`. */
export type TextVariant = keyof DevToolsTheme['typography'];

/** Tông màu chữ — bảy sắc ngữ nghĩa (không gồm `disabled`/`onFilled`, hai màu đó do điều khiển tự chọn). */
export type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'brand'
  | 'danger'
  | 'success'
  | 'warning';

export interface TextProps extends Omit<RNTextProps, 'style'> {
  /** Bậc chữ. Mặc định `captionS_Regular`. */
  variant?: TextVariant;
  /** Tông màu. Mặc định `primary`. */
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
}

const TextComponent = ({ variant = 'captionS_Regular', tone = 'primary', style, ...rest }: TextProps) => {
  const { typography, colors } = useTheme();
  return <RNText style={[typography[variant], { color: colors.text[tone] }, style]} {...rest} />;
};

TextComponent.displayName = 'Text';

/**
 * **Chức năng:** chữ của lib — bậc chữ (`variant`) + tông màu (`tone`) lấy từ theme, font hệ thống.
 * `style` đứng **cuối** nên thắng token (dùng để ghi đè cục bộ như `fontFamily` mono).
 *
 * **Input:** {@link TextProps} (mọi prop của `<Text>` của RN, trừ `style` nhận `StyleProp<TextStyle>`).
 * **Output:** `<Text>` đã tô màu. `memo` — render lại chỉ khi prop hoặc theme đổi.
 *
 * @example
 * ```tsx
 * <Text variant="captionS_Bold" tone="danger">Lỗi</Text>
 * // Ca biên: không truyền gì ⇒ captionS_Regular + primary.
 * ```
 *
 * **Unit test:** `Text.test.tsx` › `Text` — 3 case: mặc định · variant + tone theo theme (sáng/tối) ·
 * `style` ghi đè token.
 */
export const Text = memo(TextComponent);
