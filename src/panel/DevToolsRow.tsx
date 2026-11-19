import { Pressable, View } from 'react-native';
import { Text } from '../ui/Text';
import { useStyles, useTheme } from '../ui/use-styles';
import type { DevToolsTheme } from '../ui/theme';
import type { DevToolsRowProps } from '../gate/devtools-props';

/**
 * ⚠️ Hằng module-scope — dựng factory trong thân render là cache miss vĩnh viễn của
 * `useStyles` (cache khoá theo *tham chiếu* factory).
 *
 * Lề ngang nằm ở **hàng**, không ở vỏ danh sách, để nền lúc nhấn phủ hết bề ngang sheet —
 * luật chung cho hàng của sheet.
 */
const stylesOf = (t: DevToolsTheme) => ({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: t.spacing.sm,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.md,
  },
  text: {
    flex: 1,
    gap: t.spacing['2xs'],
  },
});

/**
 * **Chức năng:** một hàng bấm được trong panel gỡ lỗi — nhãn + dòng phụ + con số bên phải.
 *
 * Vẽ tại chỗ chứ không dựng thành thành phần chung: hàng này **không có icon dẫn** và chỉ panel
 * gỡ lỗi dùng nó, nên không có lý do tách ra một `ListItem` tổng quát.
 *
 * **Input:** `label` · `hint?` · `onPress?` (vắng ⇒ hàng xám, **không** bấm được) ·
 * `badge?` (`undefined` và `0` đều là không vẽ) · `testID`.
 * **Output:** một `Pressable`. Trạng thái không bấm được đi ra cả bằng màu chữ (`tertiary`)
 * lẫn `accessibilityState.disabled`, không chỉ bằng màu.
 *
 * @example
 * ```tsx
 * <DevToolsRow testID="dev-log" label="Mở nhật ký" badge={23} onPress={openLog} />
 * // Ca biên: không truyền onPress ⇒ hàng vẫn hiện (để thấy trước bộ công cụ sẽ có gì)
 * //          nhưng không nhận chạm, chữ chuyển tone tertiary.
 * ```
 *
 * **Unit test:** `DevToolsRow.test.tsx` › `DevToolsRow` — 5 case: vẽ nhãn · `hint` vắng thì
 * không vẽ dòng phụ · `badge = 0` không vẽ số · không `onPress` ⇒ `disabled` và chạm không
 * gọi gì · có `onPress` ⇒ chạm gọi đúng một lần.
 */
export const DevToolsRow = ({
  label,
  hint,
  onPress,
  badge,
  testID,
}: DevToolsRowProps) => {
  const { colors } = useTheme();
  const styles = useStyles(stylesOf);
  const disabled = !onPress;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed
            ? colors.background.surfaceAlt
            : colors.background.surface,
        },
      ]}
    >
      <View style={styles.text}>
        <Text variant="bodyM_Medium" tone={disabled ? 'tertiary' : 'primary'}>
          {label}
        </Text>
        {hint ? (
          <Text variant="captionS_Regular" tone="tertiary">
            {hint}
          </Text>
        ) : null}
      </View>
      {badge ? (
        <Text
          variant="captionS_Regular"
          tone="danger"
          testID={`${testID}-badge`}
        >
          {String(badge)}
        </Text>
      ) : null}
    </Pressable>
  );
};
