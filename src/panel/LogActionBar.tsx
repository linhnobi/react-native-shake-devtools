import { View } from 'react-native';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useStyles } from '../ui/use-styles';
import type { DevToolsTheme } from '../ui/theme';
import { useDevToolsT } from '../i18n';
import type { AiCopyState } from './use-ai-copy';
import type { LogExportState } from './use-log-export';

/** ⚠️ Hằng module-scope — xem ghi chú cùng tên ở `DevToolsRow.tsx`. */
const stylesOf = (t: DevToolsTheme) => ({
  root: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
    gap: t.spacing.sm,
  },
  spacer: { flex: 1 },
});

export interface LogActionBarProps {
  /**
   * `'live'` = phiên đang chạy (đủ bốn nút) · `'archive'` = đang xem phiên trước (chỉ còn Xuất —
   * không tạm dừng/đánh dấu/xoá được thứ đã nằm trên đĩa).
   */
  mode: 'live' | 'archive';
  paused: boolean;
  onTogglePause: () => void;
  onMark: () => void;
  /**
   * Có dòng lỗi nào để xuất không — `false` ⇒ nút Xuất khoá. Là cờ chứ không phải số: thanh này
   * nằm trong footer của sheet, mà footer dựng lại mỗi khi props của nó đổi — nhận số lỗi thì mỗi
   * lỗi mới đổ về là một lần dựng lại, trong khi nút chỉ cần biết "có hay không".
   */
  canExport: boolean;
  exportState: LogExportState;
  onExport: () => void;
  onClear: () => void;
  /**
   * Nút **Chép cho AI** — chỉ vẽ ở `mode="archive"` (phiên trước). Chân màn sống đã kín một dòng trên
   * máy 360dp; phiên đang chạy chép cho AI từ hàng của panel. Vắng ⇒ không vẽ.
   */
  onCopyAi?: () => void;
  /** Trạng thái lượt chép cho AI gần nhất — nhãn nút đổi thành "Đã chép" / "Không chép được". */
  aiState?: AiCopyState;
}

/**
 * **Chức năng:** thanh hành động ở **đáy** màn nhật ký — Tạm dừng · Đánh dấu · Xuất lỗi · Xoá.
 *
 * ## Vì sao ở đáy, không ở thanh lọc
 *
 * Bốn nút này là thứ bấm **trong lúc** đang thao tác app bằng một tay (đánh dấu trước khi tái
 * hiện, tạm dừng để đọc) — vùng ngón cái. Để chung với hai hàng chip ở đỉnh thì hàng đó tràn trên
 * máy 360dp, và nút phá huỷ (Xoá) nằm sát chip lọc là chỗ bấm nhầm.
 *
 * Nút Xuất **khoá** chứ không ẩn khi 0 lỗi — nút biến mất/hiện lại theo từng request làm thanh
 * nhảy bố cục.
 *
 * ## Một dòng trên máy 360dp — vì sao ba nút có chữ KHÔNG có icon (10/10/2026)
 *
 * Đo bằng CoreText, Roboto 15px + kern 0.3 (bậc `sm`): *Tạm dừng* 69,9 · *Đánh dấu* 65,8 · *Xuất
 * lỗi* 53,0. Có icon (≈ 28dp mỗi nút) thì cả thanh ≈ 381dp — vượt chỗ ≈ 328dp của máy 360dp, nút
 * Xuất + Xoá rớt xuống dòng hai. Bỏ icon ở ba nút có chữ ⇒ ≈ 297dp, vừa một dòng. Nút Xoá giữ icon
 * (chỉ-icon, 36dp). `flexWrap` còn lại chỉ là lưới an toàn khi người dùng phóng chữ hệ thống.
 *
 * Ở `mode="archive"` còn chỗ (không có Tạm dừng · Đánh dấu · Xoá) nên thêm nút **Chép cho AI** trước
 * nút Xuất. Màn sống không có nút này: thêm ≈ 85dp là vượt chỗ ≈ 328dp (đo ở trên).
 *
 * **Input:** {@link LogActionBarProps}.
 * **Output:** một hàng nút trên một dòng; chỉ gãy dòng khi chữ hệ thống phóng to. Đặt vào slot `footer` của
 * `Sheet` — vỏ footer lo phần chừa home indicator.
 *
 * @example
 * ```tsx
 * <LogActionBar mode="live" paused={false} onTogglePause={toggle} onMark={mark}
 *   canExport exportState="idle" onExport={run} onClear={clear} />
 * // Ca biên: mode="archive" ⇒ chỉ còn nút Chép cho AI (khi có `onCopyAi`) và Xuất.
 * ```
 *
 * **Unit test:** `LogSheet.test.tsx` › `LogSheet — tạm dừng & đánh dấu` · `LogSheet — xuất lỗi` ·
 * `LogSheet — phiên trước` — phủ qua màn.
 */
export const LogActionBar = ({
  mode,
  paused,
  onTogglePause,
  onMark,
  canExport,
  exportState,
  onExport,
  onClear,
  onCopyAi,
  aiState = 'idle',
}: LogActionBarProps) => {
  const t = useDevToolsT();
  const styles = useStyles(stylesOf);
  const live = mode === 'live';

  return (
    <View style={styles.root}>
      {live ? (
        <>
          <Button
            testID="devtools-log-pause"
            label={paused ? t('log.resume') : t('log.pause')}
            size="sm"
            variant={paused ? 'primary' : 'secondary'}
            onPress={onTogglePause}
          />
          <Button
            testID="devtools-log-mark"
            label={t('log.mark')}
            size="sm"
            variant="secondary"
            onPress={onMark}
          />
        </>
      ) : null}
      <View style={styles.spacer} />
      {!live && onCopyAi ? (
        <Button
          testID="devtools-log-ai"
          label={
            aiState === 'copied'
              ? t('log.copied')
              : aiState === 'failed'
                ? t('log.copyFailed')
                : t('log.copyAi')
          }
          size="sm"
          variant="secondary"
          loading={aiState === 'busy'}
          onPress={onCopyAi}
        />
      ) : null}
      <Button
        testID="devtools-log-export"
        label={t('log.exportErrors')}
        size="sm"
        variant="secondary"
        disabled={!canExport}
        loading={exportState === 'busy'}
        onPress={onExport}
      />
      {live ? (
        <Button
          testID="devtools-log-clear"
          label={t('log.clear')}
          iconOnly
          size="sm"
          variant="tertiary"
          onPress={onClear}
          leftIcon={({ size }) => <Icon name="delete" size={size} />}
        />
      ) : null}
    </View>
  );
};
