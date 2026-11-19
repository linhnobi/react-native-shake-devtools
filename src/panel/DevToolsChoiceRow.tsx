import { Pressable, View } from 'react-native';
import { Chip } from '../ui/Chip';
import { Text } from '../ui/Text';
import { useStyles } from '../ui/use-styles';
import type { DevToolsTheme } from '../ui/theme';
import type { DevToolsChoice } from '../gate/devtools-props';

/** ⚠️ Hằng module-scope — cùng lý do với `DevToolsRow` (cache của `useStyles` khoá theo tham chiếu). */
const stylesOf = (t: DevToolsTheme) => ({
  row: {
    gap: t.spacing.xs,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.md,
    backgroundColor: t.colors.background.surface,
  },
  text: {
    gap: t.spacing['2xs'],
  },
  chips: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: t.spacing.xs,
  },
});

/** Props của {@link DevToolsChoiceRow}. */
export interface DevToolsChoiceRowProps {
  label: string;
  hint?: string;
  choices: readonly DevToolsChoice[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  testID: string;
}

/**
 * **Chức năng:** hàng **chọn một** của panel — nhãn + dòng phụ, bên dưới là mọi lựa chọn bày sẵn
 * thành chip. Một cú chạm là áp dụng: không có bước "mở danh sách" hay "bật rồi mới chọn", và cũng
 * không xoay vòng (xoay vòng 8 bậc là tới 7 cú chạm để quay lại bậc vừa qua).
 *
 * **Input:** `choices` (chuỗi đã dịch) · `selectedId` chip đang sáng · `onSelect(id)`.
 * **Output:** JSX. Vắng `onSelect` ⇒ chip vẫn vẽ nhưng không bấm được.
 *
 * @example
 * ```tsx
 * <DevToolsChoiceRow
 *   testID="devtools-row-network-sim"
 *   label="Giả lập mạng"
 *   choices={[{ id: 'off', label: 'Tắt' }, { id: 'slow', label: 'Chậm' }]}
 *   selectedId="off"
 *   onSelect={networkSim.set}
 * />
 * // Ca biên: selectedId không khớp chip nào ⇒ không chip nào sáng, vẫn chọn được.
 * ```
 *
 * **Unit test:** `DevToolsPanel.test.tsx` › `hàng chọn một` — 2 case: chip đang chọn mang
 * `selected` · chạm chip ⇒ `onSelect(id)` và panel **không** đóng.
 */
export const DevToolsChoiceRow = ({
  label,
  hint,
  choices,
  selectedId,
  onSelect,
  testID,
}: DevToolsChoiceRowProps) => {
  const styles = useStyles(stylesOf);

  return (
    <View testID={testID} style={styles.row}>
      <View style={styles.text}>
        <Text variant="bodyM_Medium" tone="primary">
          {label}
        </Text>
        {hint ? (
          <Text variant="captionS_Regular" tone="tertiary">
            {hint}
          </Text>
        ) : null}
      </View>
      <View style={styles.chips}>
        {choices.map((choice) => {
          const selected = choice.id === selectedId;
          return (
            <Pressable
              key={choice.id}
              testID={`${testID}-${choice.id}`}
              accessibilityRole="button"
              accessibilityLabel={choice.label}
              accessibilityState={{ selected, disabled: !onSelect }}
              disabled={!onSelect}
              onPress={() => onSelect?.(choice.id)}
            >
              <Chip label={choice.label} state={selected ? 'active' : 'default'} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};
