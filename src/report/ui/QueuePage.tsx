import { Pressable, View } from 'react-native';
import { useDevToolsT } from '../../i18n';
import type { DevToolsKey } from '../../i18n/types';
import { Text } from '../../ui/Text';
import type { DevToolsTheme } from '../../ui/theme';
import { useStyles } from '../../ui/use-styles';
import {
  ATTENTION_STATES,
  WAITING_STATES,
  type QueuedReport,
  type QueueState,
} from '../send-queue';
import { STATE_TONE } from './SendStatus';

/** ⚠️ Hằng module-scope — `useStyles` nhớ theo tham chiếu factory. */
const stylesOf = (t: DevToolsTheme) => ({
  root: { gap: t.spacing.md },
  section: { gap: t.spacing.xs },
  row: {
    minHeight: t.size.minTouch,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
    gap: t.spacing['2xs'],
    borderRadius: t.radius.md,
    borderWidth: t.borderWidth.thin,
    borderColor: t.colors.border.subtle,
    backgroundColor: t.colors.background.surfaceAlt,
  },
  meta: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    gap: t.spacing.xs,
  },
  metaText: { flexShrink: 1 },
});

/** Nhãn trạng thái ngắn trên hàng. */
const STATE_LABEL: Record<QueueState, DevToolsKey> = {
  sending: 'report.queue.stateSending',
  pending: 'report.queue.statePending',
  uncertain: 'report.queue.stateUncertain',
  failed: 'report.queue.stateFailed',
  blocked: 'report.queue.stateBlocked',
  sent: 'report.queue.stateSent',
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Mốc của hàng: bản đã gửi ⇒ lúc gửi xong; còn lại ⇒ lúc tạo bản báo. */
const atOf = (item: QueuedReport): number => item.sentAt ?? item.report.createdAt;

/** Mới nhất trước. */
const newestFirst = (a: QueuedReport, b: QueuedReport) => atOf(b) - atOf(a);

export interface QueuePageProps {
  /** `queue.items()` — mọi bản hàng đợi còn giữ. */
  items: readonly QueuedReport[];
  /** Tên kết nối theo id; `undefined` ⇒ kết nối không còn. */
  connectionName: (connectionId: string) => string | undefined;
  /** Mốc "bây giờ" cho thời gian tương đối. */
  now: number;
  /** Hàng đợi chỉ nằm trong RAM (app không bật `persist`) ⇒ câu "sẽ mất nếu app bị tắt". */
  ramOnly: boolean;
  /** Chạm một hàng ⇒ trang kết quả của bản đó. */
  onOpen: (reportId: string) => void;
}

/**
 * **Chức năng:** trang **Hàng đợi gửi** trong sheet báo bug (C1, spec 4.5 · 5.6) — nơi QA gặp lại
 * mọi bản báo đã giao cho hàng đợi sau khi trang kết quả đã đóng, để gửi lại, chia sẻ hay bỏ.
 *
 * - Ba nhóm, mỗi nhóm **mới nhất trước** (mốc = lúc gửi xong với bản `sent`, lúc tạo với bản khác):
 *   **Cần xử lý** (`failed` · `blocked` · `uncertain`) · **Đang chờ gửi** (`pending` · `sending`) ·
 *   **Đã gửi** (hàng đợi giữ 24 giờ). Nhóm rỗng không vẽ; cả ba rỗng ⇒ "Hàng đợi trống.".
 * - Một hàng: tiêu đề (trống ⇒ "(Chưa có tiêu đề)"), dòng `<tên kết nối> · <thời gian tương đối>`
 *   (kết nối đã xoá ⇒ "Kết nối không còn") và nhãn trạng thái tô theo màu của trạng thái. Chạm ⇒
 *   `onOpen(report.id)` (trang kết quả của đúng bản đó).
 * - `ramOnly` ⇒ câu "Hàng đợi chỉ nằm trong bộ nhớ…" ở đầu trang.
 *
 * testID: `devtools-report-queue-section-<attention|waiting|sent>` ·
 * `devtools-report-queue-row-<reportId>` (+ `-meta`, `-state`) · `devtools-report-queue-empty` ·
 * `devtools-report-queue-ram-only`.
 *
 * **Input:** {@link QueuePageProps}. **Output:** khối nội dung (vùng cuộn do `ReportSheet` lo).
 *
 * @example
 * ```tsx
 * <QueuePage items={queue.items()} connectionName={(id) => byId[id]?.name} now={Date.now()}
 *   ramOnly={false} onOpen={openItem} />
 * // Ca biên: items rỗng ⇒ chỉ có câu "Hàng đợi trống.".
 * ```
 *
 * **Unit test:** `ReportSheet.test.tsx` › `hàng đợi (C1, I3)` — phủ qua sheet (×2 bộ sheet): nhóm và
 * thứ tự, nội dung hàng (tiêu đề trống · kết nối không còn · thời gian tương đối · nhãn trạng thái) ·
 * chạm hàng mở trang kết quả · câu RAM · trống sau khi bỏ bản cuối; màu sáng/tối ở `ReportSheet sáng/tối`.
 */
export const QueuePage = ({ items, connectionName, now, ramOnly, onOpen }: QueuePageProps) => {
  const t = useDevToolsT();
  const styles = useStyles(stylesOf);

  const ago = (at: number): string => {
    const age = Math.max(0, now - at);
    if (age < MINUTE) return t('report.queue.justNow');
    if (age < HOUR) return t('report.queue.minutesAgo', { count: Math.floor(age / MINUTE) });
    if (age < DAY) return t('report.queue.hoursAgo', { count: Math.floor(age / HOUR) });
    return t('report.queue.daysAgo', { count: Math.floor(age / DAY) });
  };

  const groups: ReadonlyArray<readonly [string, DevToolsKey, QueuedReport[]]> = [
    [
      'attention',
      'report.queue.sectionAttention',
      items.filter((i) => ATTENTION_STATES.has(i.state)).sort(newestFirst),
    ],
    [
      'waiting',
      'report.queue.sectionWaiting',
      items.filter((i) => WAITING_STATES.has(i.state)).sort(newestFirst),
    ],
    ['sent', 'report.queue.sectionSent', items.filter((i) => i.state === 'sent').sort(newestFirst)],
  ];

  return (
    <View testID="devtools-report-queue-body" style={styles.root}>
      {ramOnly ? (
        <Text testID="devtools-report-queue-ram-only" variant="captionS_Regular" tone="warning">
          {t('report.queue.ramOnly')}
        </Text>
      ) : null}
      {items.length === 0 ? (
        <Text testID="devtools-report-queue-empty" variant="bodyM_Medium" tone="secondary">
          {t('report.queue.empty')}
        </Text>
      ) : null}
      {groups.map(([id, heading, rows]) =>
        rows.length === 0 ? null : (
          <View key={id} style={styles.section}>
            <Text
              testID={`devtools-report-queue-section-${id}`}
              variant="captionS_Bold"
              tone="secondary"
            >
              {t(heading)}
            </Text>
            {rows.map((item) => {
              const rid = item.report.id;
              const title = item.report.title.trim();
              const connection =
                connectionName(item.connectionId) ?? t('report.queue.connectionGone');
              return (
                <Pressable
                  key={rid}
                  testID={`devtools-report-queue-row-${rid}`}
                  accessibilityRole="button"
                  onPress={() => onOpen(rid)}
                  style={styles.row}
                >
                  <Text variant="bodyM_Medium" numberOfLines={2}>
                    {title === '' ? t('report.queue.untitled') : title}
                  </Text>
                  <View style={styles.meta}>
                    <Text
                      testID={`devtools-report-queue-row-${rid}-meta`}
                      variant="captionS_Regular"
                      tone="secondary"
                      numberOfLines={1}
                      style={styles.metaText}
                    >
                      {`${connection} · ${ago(atOf(item))}`}
                    </Text>
                    <Text
                      testID={`devtools-report-queue-row-${rid}-state`}
                      variant="captionS_Medium"
                      tone={STATE_TONE[item.state]}
                    >
                      {t(STATE_LABEL[item.state])}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ),
      )}
    </View>
  );
};
