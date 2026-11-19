import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Text } from './Text';
import { useStyles } from './use-styles';
import type { DevToolsTheme } from './theme';

/**
 * Style dùng chung của hai bộ sheet (gorhom · RN thuần): nền, thanh kéo, header, chân.
 *
 * ⚠️ Hằng module-scope — `useStyles` nhớ theo tham chiếu factory.
 */
export const sheetStylesOf = (t: DevToolsTheme) => ({
  sheet: {
    backgroundColor: t.colors.background.surface,
    borderTopLeftRadius: t.radius.lg,
    borderTopRightRadius: t.radius.lg,
  },
  handle: { alignItems: 'center' as const, paddingTop: t.spacing.xs, paddingBottom: t.spacing['2xs'] },
  indicator: {
    width: 40,
    height: 4,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.background.handle,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: t.spacing.md,
    paddingBottom: t.spacing.sm,
    gap: t.spacing.xs,
    borderBottomWidth: t.borderWidth.thin,
    borderBottomColor: t.colors.border.subtle,
  },
  headerContent: { flex: 1, alignItems: 'center' as const, gap: t.spacing['2xs'] },
  headerSide: { alignItems: 'center' as const, justifyContent: 'center' as const },
  title: { textAlign: 'center' as const },
  footer: {
    paddingHorizontal: t.spacing.md,
    paddingTop: t.spacing.sm,
    backgroundColor: t.colors.background.surface,
    borderTopWidth: t.borderWidth.thin,
    borderTopColor: t.colors.border.subtle,
  },
  /** `contentMode="scroll"`: vùng nội dung có chiều cao chặn, list con ăn hết phần còn lại. */
  scrollContent: { flex: 1 },
});

export interface SheetHeaderProps {
  title: string;
  description?: string;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
  testID?: string;
}

/**
 * **Chức năng:** header của sheet — tiêu đề căn giữa thật sự, dù hai nút hai bên rộng khác nhau.
 * Dùng chung cho cả hai bộ sheet.
 *
 * Hai cột biên **luôn** render (kể cả khi trống) và cùng `minWidth` = bề rộng của cột rộng hơn —
 * nếu chỉ có nút phải thì tiêu đề không trôi sang trái đúng nửa bề rộng nút. Bề rộng đo bằng
 * `onLayout` ở lớp **bọc sát** nội dung (không phải lớp ngoài, vì lớp ngoài chịu `minWidth` nên số
 * đo sẽ tự khoá ở giá trị cũ).
 *
 * Là component riêng để state đo nằm **trong** nó: state ở `Sheet` sẽ đổi `renderHandle`, và gorhom
 * render hàm đó như một kiểu component ⇒ cả header bị gỡ ra dựng lại mỗi lần đo.
 *
 * **Input:** {@link SheetHeaderProps}. **Output:** hàng header; slot trái/phải có testID
 * `<testID>-left` · `<testID>-right`.
 *
 * @example
 * ```tsx
 * <SheetHeader testID="s-header" title="Nhật ký" rightAction={shareButton} />
 * // Ca biên: chỉ có nút phải ⇒ cột trái trống vẫn rộng bằng cột phải, tiêu đề vẫn ở giữa.
 * ```
 *
 * **Unit test:** gián tiếp qua `Sheet.test.tsx` và `PlainSheet.test.tsx` (tiêu đề · dòng phụ · bấm
 * slot trái/phải).
 */
export const SheetHeader = ({ title, description, leftAction, rightAction, testID }: SheetHeaderProps) => {
  const styles = useStyles(sheetStylesOf);
  const [leftWidth, setLeftWidth] = useState(0);
  const [rightWidth, setRightWidth] = useState(0);
  const onLeftLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setLeftWidth((prev) => (prev === w ? prev : w));
  }, []);
  const onRightLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setRightWidth((prev) => (prev === w ? prev : w));
  }, []);
  const side = Math.max(leftAction ? leftWidth : 0, rightAction ? rightWidth : 0);
  const sideStyle = useMemo(
    () => (side > 0 ? [styles.headerSide, { minWidth: side }] : styles.headerSide),
    [styles.headerSide, side],
  );

  return (
    <View testID={testID} style={styles.header}>
      <View testID={testID ? `${testID}-left` : undefined} style={sideStyle}>
        <View onLayout={onLeftLayout}>{leftAction}</View>
      </View>
      <View style={styles.headerContent}>
        <Text variant="bodyM_Medium" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {description ? (
          <Text variant="captionS_Regular" tone="secondary" style={styles.title}>
            {description}
          </Text>
        ) : null}
      </View>
      <View testID={testID ? `${testID}-right` : undefined} style={sideStyle}>
        <View onLayout={onRightLayout}>{rightAction}</View>
      </View>
    </View>
  );
};
