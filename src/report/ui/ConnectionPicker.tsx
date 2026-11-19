import { Pressable, View } from 'react-native';
import { useDevToolsT } from '../../i18n';
import { Text } from '../../ui/Text';
import type { DevToolsTheme } from '../../ui/theme';
import { useStyles } from '../../ui/use-styles';

/** ⚠️ Hằng module-scope — `useStyles` nhớ theo tham chiếu factory. */
const stylesOf = (t: DevToolsTheme) => ({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    minHeight: t.size.minTouch,
    paddingVertical: t.spacing.xs,
    gap: t.spacing.sm,
  },
  text: { flex: 1, gap: t.spacing['2xs'] },
  divider: { height: t.borderWidth.thin, backgroundColor: t.colors.border.subtle },
});

/** Một kết nối trong danh sách chọn — đã dựng sẵn chữ (tên loại, mức nhẹ). */
export interface ConnectionChoice {
  readonly id: string;
  readonly name: string;
  /** Tên loại kết nối theo ngôn ngữ giao diện, vd `Jira Cloud`. */
  readonly typeLabel: string;
  /** Không gửi được ảnh/file (`capabilities`) ⇒ dòng phụ "… · chỉ gửi chữ". */
  readonly light: boolean;
}

export interface ConnectionPickerProps {
  choices: readonly ConnectionChoice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Mở trang Kết nối. Vắng ⇒ không có hàng "Quản lý kết nối". */
  onManage?: () => void;
}

/**
 * **Chức năng:** trang chọn kết nối của nút ▾ cạnh nút Gửi — trang **trong** sheet báo bug. Mỗi
 * hàng một kết nối đã lưu (tên + loại; mức nhẹ ghi "chỉ gửi chữ"), hàng đang chọn có dấu ✓. Hàng
 * cuối "Quản lý kết nối" mở màn kết nối (chỉ khi có `onManage`).
 *
 * **Input:** {@link ConnectionPickerProps}. **Output:** khối danh sách (vùng cuộn ở `ReportSheet`).
 *
 * @example
 * ```tsx
 * <ConnectionPicker choices={choices} selectedId="c-jira" onSelect={pick}
 *   onManage={openConnections} />
 * // Ca biên: onManage vắng ⇒ chỉ có các hàng kết nối.
 * ```
 *
 * **Unit test:** `ReportSheet.test.tsx` › `form A+` — 1 case (×2 bộ sheet): chọn kết nối khác ⇒ về
 * form, nhớ lựa chọn, "Quản lý kết nối" mở trang Kết nối; `trang kết nối` — sửa kết nối từ đây ⇒
 * tên mới hiện ở danh sách này.
 */
export const ConnectionPicker = ({
  choices,
  selectedId,
  onSelect,
  onManage,
}: ConnectionPickerProps) => {
  const t = useDevToolsT();
  const styles = useStyles(stylesOf);
  return (
    <View>
      {choices.map((c) => {
        const selected = c.id === selectedId;
        return (
          <View key={c.id}>
            <Pressable
              testID={`devtools-report-connection-${c.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onSelect(c.id)}
              style={styles.row}
            >
              <View style={styles.text}>
                <Text variant="bodyM_Medium">{c.name}</Text>
                <Text variant="captionS_Regular" tone="secondary">
                  {c.light ? t('report.picker.light', { type: c.typeLabel }) : c.typeLabel}
                </Text>
              </View>
              {selected ? (
                <Text variant="bodyM_Medium" tone="brand">
                  ✓
                </Text>
              ) : null}
            </Pressable>
            <View style={styles.divider} />
          </View>
        );
      })}
      {onManage ? (
        <Pressable
          testID="devtools-report-manage-connections"
          accessibilityRole="button"
          onPress={onManage}
          style={styles.row}
        >
          <Text variant="bodyM_Medium" tone="brand">
            {t('report.picker.manage')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};
