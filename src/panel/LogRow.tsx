import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '../ui/Button';
import { useSheetKit } from '../ui/sheet-kit';
import { SwipeAction } from '../ui/SwipeAction';
import { Text } from '../ui/Text';
import { useStyles, useTheme } from '../ui/use-styles';
import type { DevToolsTheme } from '../ui/theme';
import { formatTime } from '../capture/format-log';
import type { LogEntry, MarkerEntry } from '../capture/log-entry';
import { DEFAULT_SLOW_MS, isAbortedEntry, isSlowEntry } from '../capture/log-query';
import { useDevToolsT } from '../i18n';

/**
 * Bề rộng nút quét — **80**, ghi ở JSDoc của `SwipeActionProps.style`: container quét cần biết nó để
 * tính ngưỡng kéo, nên con số thuộc call-site. Không có bậc token nào cho nó vì nó là kích thước
 * của một slot cụ thể, không phải một bậc của thang.
 */
const SWIPE_ACTION_WIDTH = 80;

/** ⚠️ Hằng module-scope — dựng factory trong render là cache miss vĩnh viễn của `useStyles`. */
const stylesOf = (t: DevToolsTheme) => ({
  row: {
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    gap: t.spacing['2xs'],
  },
  head: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: t.spacing.sm,
  },
  /** Dải hành động của cú giữ lâu — gãy dòng được, lề khớp lề hàng. */
  menu: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    paddingBottom: t.spacing.sm,
  },
  marker: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.md,
    backgroundColor: t.colors.background.surfaceAlt,
  },
  /** Nền đặc cho cả khối hàng + dải hành động: lúc vuốt, nút Chép nằm DƯỚI khối này. */
  container: { backgroundColor: t.colors.background.surface },
  swipeAction: { width: SWIPE_ACTION_WIDTH },
});

/**
 * Mức nào thì chữ màu gì. Chỉ đọc token `text.*`, không có hex nào.
 *
 * `'log'`/`'info'` để `secondary` chứ không `primary`: một màn đầy chữ cùng độ đậm thì mắt
 * không bám được vào đâu, mà dòng đáng đọc là `warn`/`error`.
 */
const toneOfEntry = (entry: Exclude<LogEntry, MarkerEntry>) => {
  if (entry.kind === 'network') {
    /* Bị app huỷ: kết cục trung tính, không phải lỗi (`isErrorEntry`) — xám như request đang chờ. */
    if (isAbortedEntry(entry)) return 'tertiary' as const;
    if (entry.error) return 'danger' as const;
    if (entry.status === undefined) return 'tertiary' as const;
    return entry.status >= 400 ? ('danger' as const) : ('success' as const);
  }
  if (entry.level === 'error') return 'danger' as const;
  if (entry.level === 'warn') return 'warning' as const;
  return 'secondary' as const;
};

/** Nhãn mức của dòng console — lỗi không ai bắt được gọi đúng tên, không lẫn với `console.error`. */
const levelLabel = (entry: Extract<LogEntry, { kind: 'console' }>) =>
  entry.fatal ? 'FATAL' : entry.uncaught ? 'UNCAUGHT' : entry.level.toUpperCase();

/** Một nút trong dải hành động của cú giữ lâu. Nhãn là chuỗi **đã dịch**. */
export interface LogRowAction {
  id: string;
  label: string;
  onPress: () => void;
}

export interface LogRowProps {
  entry: LogEntry;
  /** Dòng console đang mở hết chữ hay không. Dòng mạng mở màn chi tiết thay vì mở tại chỗ. */
  expanded: boolean;
  /**
   * Vắng ⇒ hàng không nhận chạm (mốc). Ba callback đều **nhận chính dòng này** để màn truyền được
   * MỘT hàm ổn định cho mọi hàng — closure riêng từng hàng (`() => press(item)`) là prop mới mỗi
   * lượt, và `memo` của hàng thành vô dụng.
   */
  onPress?: (entry: LogEntry) => void;
  /** Giữ lâu ⇒ màn mở dải hành động (`menu`). */
  onLongPress?: (entry: LogEntry) => void;
  /**
   * Chép **đúng dòng này** ra bộ nhớ tạm — lộ ra khi vuốt hàng sang phải. Chỉ bộ sheet có
   * `SwipeRow` (entry `.`) mới vuốt được; entry `./plain` chép qua dải thao tác của cú giữ lâu.
   */
  onCopy: (entry: LogEntry) => void;
  /** Vừa chép xong ⇒ hiện dấu xác nhận thay cho nhãn trạng thái. */
  copied?: boolean;
  /** Có ⇒ vẽ dải hành động dưới hàng (cú giữ lâu đang mở). */
  menu?: readonly LogRowAction[];
  /** Ngưỡng "chậm" cho nhãn Chậm. Mặc định `DEFAULT_SLOW_MS`. */
  slowMs?: number;
  testID: string;
}

/** Mốc: một dải mảnh, không vuốt, không chạm — nó là bối cảnh, không phải dữ liệu để chép. */
const MarkerRow = ({ entry, testID }: { entry: MarkerEntry; testID: string }) => {
  const t = useDevToolsT();
  const styles = useStyles(stylesOf);
  return (
    <View style={styles.marker} testID={testID}>
      <Text variant="captionS_Regular" tone="tertiary">
        {formatTime(entry.at)}
      </Text>
      <Text variant="captionS_Medium" tone="secondary">
        {entry.type === 'screen'
          ? t('log.markerScreen', { screen: entry.label })
          : t('log.markerUser', { n: entry.label })}
      </Text>
    </View>
  );
};

/**
 * **Chức năng:** một dòng trong màn nhật ký — giờ, nhãn trạng thái, nội dung; chạm để mở; vuốt
 * phải để chép (chỉ entry `.`); giữ lâu để mở dải hành động.
 *
 * **Nội dung** dòng không đi qua i18n, **chrome** thì có — ranh giới cố ý: `GET`, `404`,
 * `WARN`, URL là *dữ liệu đã bắt*, chính khối chữ QA gửi cho BE, nên phải đọc y nhau ở mọi ngôn
 * ngữ. Còn nhãn nút "Chép", "Chậm", câu của mốc là giao diện, nên chúng dịch.
 *
 * ## Ba cử chỉ, ba việc
 *
 * | Cử chỉ | Dòng console | Dòng mạng | Mốc |
 * |---|---|---|---|
 * | Chạm | mở/đóng hết chữ | mở màn chi tiết (do màn quyết) | — |
 * | Vuốt phải *(chỉ entry `.`)* | chép dòng | chép lệnh curl | — |
 * | Giữ lâu | dải hành động (do màn cấp) | dải hành động | — |
 *
 * Vuốt là đường tắt cho người đã biết; giữ lâu mở một dải **nhìn thấy được** với nhãn rõ ràng —
 * lối vào cho người không biết cử chỉ vuốt tồn tại. Vỏ vuốt lấy từ bộ sheet (`SheetKit.SwipeRow`:
 * entry `.` là `ReanimatedSwipeable` của gesture-handler, cấu hình ở `kits/gorhom-kit.tsx`). Bộ
 * không có `SwipeRow` (entry `./plain`) ⇒ hàng không vuốt, dải giữ lâu là lối duy nhất để chép.
 *
 * ## `memo` — chỉ hàng thật sự đổi mới render lại
 *
 * Ở entry `.` mỗi hàng là một `ReanimatedSwipeable` (cử chỉ + shared value) cộng vài `Text` — không rẻ, và
 * FlatList giữ sẵn hàng chục hàng. Không có `memo` thì mở một dòng, bấm Chép hay một dòng log mới
 * đổ về đều render lại **mọi** hàng đang dựng. Muốn `memo` có tác dụng, màn phải truyền callback
 * ổn định (xem `onPress`) và `menu` chỉ cho đúng hàng đang mở dải.
 *
 * **Input:** {@link LogRowProps}.
 * **Output:** hàng vuốt được; mốc thì là dải mảnh. Request đã xong mà chậm mang nhãn "Chậm".
 *
 * @example
 * ```tsx
 * <LogRow testID="log-3" entry={e} expanded={false} onPress={openDetail} onCopy={copyRow}
 *   onLongPress={toggleMenu} menu={menuOpen ? actions : undefined} />
 * // openDetail · copyRow · toggleMenu nhận `entry` — một hàm dùng chung cho mọi hàng.
 * // Ca biên: entry là network chưa xong ⇒ nhãn trạng thái trống, chữ mờ — nhưng VẪN chép được
 * //          (chép đúng trạng thái "pending", đó là thông tin thật).
 * ```
 *
 * **Unit test:** `LogRow.test.tsx` › `LogRow` — 10 case: dòng console hiện mức viết hoa · lỗi
 * fatal hiện `FATAL` · dòng mạng hiện method + status + thời lượng · status ≥ 400 dùng tone
 * danger · request bị huỷ hiện "Đã huỷ" tone xám · request chậm có nhãn "Chậm" · mốc màn hiện câu đã dịch và không nhận chạm · `menu` vẽ
 * đủ nút và bấm gọi đúng hành động · `onLongPress` được gọi (kèm chính dòng đó) khi giữ lâu ·
 * `copied` hiện dấu xác nhận. `LogRow — bộ sheet` — 2 case: bộ gorhom có nút Chép vuốt, bấm chép
 * đúng dòng · bộ thuần không có nút vuốt, giữ lâu vẫn mở dải.
 */
const LogRowComponent = ({
  entry,
  expanded,
  onPress,
  onLongPress,
  onCopy,
  copied = false,
  menu,
  slowMs = DEFAULT_SLOW_MS,
  testID,
}: LogRowProps) => {
  const t = useDevToolsT();
  const { colors } = useTheme();
  const styles = useStyles(stylesOf);
  const { SwipeRow } = useSheetKit();

  if (entry.kind === 'marker') return <MarkerRow entry={entry} testID={testID} />;

  const tone = toneOfEntry(entry);
  const isNetwork = entry.kind === 'network';
  const label = isNetwork ? entry.method : levelLabel(entry);
  const outcome = isNetwork
    ? `${entry.status ?? (isAbortedEntry(entry) ? t('log.cancelled') : entry.error) ?? ''}${entry.durationMs === undefined ? '' : ` · ${entry.durationMs}ms`}`
    : '';
  const slow = isSlowEntry(entry, slowMs);

  const row = (
    <View style={styles.container}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={isNetwork ? entry.url : entry.text}
        accessibilityHint={t('log.rowA11yHint')}
        onPress={onPress ? () => onPress(entry) : undefined}
        onLongPress={onLongPress ? () => onLongPress(entry) : undefined}
        style={({ pressed }) => [
          styles.row,
          {
            backgroundColor: pressed
              ? colors.background.surfaceAlt
              : colors.background.surface,
          },
        ]}
      >
        <View style={styles.head}>
          <Text variant="captionS_Regular" tone="tertiary">
            {formatTime(entry.at)}
          </Text>
          <Text variant="captionS_Bold" tone={tone}>
            {label}
          </Text>
          {outcome ? (
            <Text variant="captionS_Regular" tone={tone}>
              {outcome}
            </Text>
          ) : null}
          {slow ? (
            <Text variant="captionS_Medium" tone="warning" testID={`${testID}-slow`}>
              {t('log.slow')}
            </Text>
          ) : null}
          {copied ? (
            <Text
              variant="captionS_Medium"
              tone="success"
              testID={`${testID}-copied`}
            >
              {t('log.copied')}
            </Text>
          ) : null}
        </View>

        <Text
          variant="captionS_Regular"
          tone="primary"
          numberOfLines={expanded ? 0 : 2}
        >
          {isNetwork ? entry.url : entry.text}
        </Text>
      </Pressable>

      {menu ? (
        <View style={styles.menu} testID={`${testID}-menu`}>
          {menu.map((action) => (
            <Button
              key={action.id}
              testID={`${testID}-act-${action.id}`}
              label={action.label}
              size="sm"
              variant="secondary"
              onPress={action.onPress}
            />
          ))}
        </View>
      ) : null}
    </View>
  );

  if (!SwipeRow) return row;
  return (
    <SwipeRow
      actionWidth={SWIPE_ACTION_WIDTH}
      renderAction={(close) => (
        <SwipeAction
          testID={`${testID}-copy`}
          label={t('log.copy')}
          tone="success"
          style={styles.swipeAction}
          onPress={() => {
            /* Đóng TRƯỚC rồi mới chép: người dùng thấy hàng khép lại ngay, còn dấu xác nhận
               do `copied` lo — để ngược thì hàng nằm mở thêm một nhịp và trông như treo. */
            close();
            onCopy(entry);
          }}
        />
      )}
    >
      {row}
    </SwipeRow>
  );
};

export const LogRow = memo(LogRowComponent);
