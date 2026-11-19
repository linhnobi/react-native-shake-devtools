import { Pressable, View } from 'react-native';
import { Chip } from '../ui/Chip';
import { Text } from '../ui/Text';
import { useStyles } from '../ui/use-styles';
import type { DevToolsTheme } from '../ui/theme';
import type { LogFilter, LogStatusFilter } from '../capture/log-entry';
import { DEFAULT_SLOW_MS } from '../capture/log-query';
import { useDevToolsT } from '../i18n';
import type { LogExportState } from './use-log-export';

/**
 * `Chip size="sm"` cao 32 ⇒ thiếu 12dp so với sàn chạm 44; chia đều trên/dưới, không nới hộp
 * thật. Hai hàng chip cách nhau `spacing.compact` (12) = đúng 6 + 6 ⇒ vùng chạm hai hàng **chạm**
 * nhau mà không **chồng** — hạ khoảng cách dưới 12 là bấm hàng trên trúng hàng dưới.
 */
const CHIP_HIT_SLOP = { top: 6, bottom: 6 } as const;

/** ⚠️ Hằng module-scope — xem ghi chú cùng tên ở `DevToolsRow.tsx`. */
const stylesOf = (t: DevToolsTheme) => ({
  root: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    gap: t.spacing.compact,
  },
  /* `flexWrap` là lưới an toàn cho chữ phóng to / tiếng Anh dài: hàng gãy xuống chứ không tràn
     ra ngoài mép sheet. Khoảng cách dọc khi gãy là `compact` — cùng lý do `CHIP_HIT_SLOP`. */
  row: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
    gap: t.spacing.sm,
    rowGap: t.spacing.compact,
  },
  /** Đẩy bộ đếm về mép phải của hàng. */
  spacer: { flex: 1 },
});

const KIND_FILTERS: readonly LogFilter[] = ['all', 'console', 'network'];

/** Bảng tra khoá i18n — ghép chuỗi `` t(`log.filter${f}`) `` thì `Leaves<typeof vi>` hết kiểm được. */
const KIND_KEY = {
  all: 'log.filterAll',
  console: 'log.filterConsole',
  network: 'log.filterNetwork',
} as const;

export interface FilterChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}

/**
 * Một chip bấm được. `Chip` của design system chỉ vẽ, nên bọc `Pressable` + bù vùng chạm. Dùng
 * chung cho thanh lọc và hàng tab của màn chi tiết request.
 */
export const FilterChip = ({ label, selected, onPress, testID }: FilterChipProps) => (
  <Pressable
    testID={testID}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ selected }}
    hitSlop={CHIP_HIT_SLOP}
    onPress={onPress}
  >
    <Chip label={label} state={selected ? 'active' : 'default'} />
  </Pressable>
);

export interface LogToolbarProps {
  kind: LogFilter;
  onKindChange: (kind: LogFilter) => void;
  status: LogStatusFilter;
  onStatusChange: (status: LogStatusFilter) => void;
  /** Số dòng lỗi trong **cả** nhật ký (không theo bộ lọc) — số trên chip "Chỉ lỗi". */
  errorCount: number;
  /** Số request chậm trong cả nhật ký — số trên chip "Chậm ≥3s". */
  slowCount: number;
  /** Số dòng đang hiện sau khi lọc. */
  shown: number;
  /** Số dòng đang giữ. */
  total: number;
  /** Kết quả lượt xuất gần nhất — hiện ~2 giây thay chỗ bộ đếm. */
  exportState: LogExportState;
}

/**
 * **Chức năng:** thanh lọc của màn nhật ký — hai trục lọc và bộ đếm. Hành động (tạm dừng, đánh
 * dấu, xuất, xoá) nằm ở thanh đáy `LogActionBar`, trong tầm ngón cái.
 *
 * ```
 * [Tất cả] [Console] [Mạng]              Hiện 12/300 dòng
 * [Chỉ lỗi · 12] [Ẩn lỗi] [Chậm ≥3s · 3]
 * ```
 *
 * ## Hai hàng, hai trục — không gộp
 *
 * *Loại* (console/mạng) và *kết cục* (chỉ lỗi / ẩn lỗi / chậm) là hai câu hỏi độc lập; ca hay
 * dùng nhất là **giao** của chúng ("Mạng" + "Chỉ lỗi" = request hỏng). Gộp vào một nhóm chọn-một
 * thì mất đúng ca đó. Mỗi trục một hàng để chữ "Tất cả" không bị hiểu nhầm sang trục kia.
 *
 * Nhãn gọi theo **việc chip làm** ("Chỉ lỗi", "Ẩn lỗi") chứ không theo kết cục ("Lỗi", "Không
 * lỗi"): chip lỗi mang số đếm nên "Lỗi · 12" trông như dòng báo chứ không như nút lọc; còn "Không
 * lỗi" gồm cả `warn` lẫn request đang chờ, gọi là "thành công" thì sai. Chip chậm ghi luôn ngưỡng
 * (`DEFAULT_SLOW_MS`) để người thử khỏi đoán "chậm" là bao lâu.
 *
 * Trục *kết cục* là nhóm chip **bật/tắt chọn-một**: chạm chip đang sáng ⇒ về "tất cả". Không có
 * chip "Tất cả" thứ hai — hai chip cùng chữ trên hai hàng là thứ chắc chắn gây nhầm.
 *
 * Không dùng `ScrollView` ngang cho gọn một hàng: cuộn ngang lồng trong sheet gorhom tranh cử chỉ
 * kéo của sheet trên Android, và chip bị che một nửa ở mép là chip không ai thấy.
 *
 * Kết quả xuất hiện **thay chỗ** bộ đếm (không dùng `Toast`: toast vẽ ở gốc app, nằm **dưới**
 * sheet).
 *
 * **Input:** {@link LogToolbarProps}.
 * **Output:** khối hai hàng, lề ngang `spacing.md` khớp lề của `LogRow`.
 *
 * @example
 * ```tsx
 * <LogToolbar kind="all" onKindChange={setKind} status="error" onStatusChange={setStatus}
 *   errorCount={12} slowCount={3} shown={12} total={300} exportState="idle" />
 * // Ca biên: errorCount = 0 ⇒ chip "Chỉ lỗi · 0" vẫn bấm được (ra danh sách rỗng với câu
 * //          "Không có dòng nào khớp bộ lọc" — thông tin thật, không phải lỗi).
 * ```
 *
 * **Unit test:** `LogSheet.test.tsx` › `LogSheet — lọc lỗi` — phủ qua màn (chip bật/tắt · chip
 * "Chậm ≥3s" · bộ đếm đổi theo bộ lọc) và `LogSheet — xuất lỗi` (dấu kết quả thay bộ đếm).
 */
export const LogToolbar = ({
  kind,
  onKindChange,
  status,
  onStatusChange,
  errorCount,
  slowCount,
  shown,
  total,
  exportState,
}: LogToolbarProps) => {
  const t = useDevToolsT();
  const styles = useStyles(stylesOf);

  const toggleStatus = (next: Exclude<LogStatusFilter, 'all'>) => () =>
    onStatusChange(status === next ? 'all' : next);

  const counter =
    exportState === 'done' ? (
      <Text variant="captionS_Medium" tone="success" testID="devtools-log-exported">
        {t('log.exported')}
      </Text>
    ) : exportState === 'failed' ? (
      <Text variant="captionS_Medium" tone="danger" testID="devtools-log-export-failed">
        {t('log.exportFailed')}
      </Text>
    ) : (
      /* `secondary` chứ không `tertiary`: một số bộ token có bậc `tertiary` thiếu contrast — cùng lý do
         với dòng chỉ đường cử chỉ vuốt ở `LogSheet`. */
      <Text variant="captionS_Regular" tone="secondary" testID="devtools-log-count">
        {t('log.shownOf', { shown, total })}
      </Text>
    );

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        {KIND_FILTERS.map((f) => (
          <FilterChip
            key={f}
            testID={`devtools-log-filter-${f}`}
            label={t(KIND_KEY[f])}
            selected={kind === f}
            onPress={() => onKindChange(f)}
          />
        ))}
        <View style={styles.spacer} />
        {counter}
      </View>

      <View style={styles.row}>
        <FilterChip
          testID="devtools-log-status-error"
          label={t('log.filterError', { errors: errorCount })}
          selected={status === 'error'}
          onPress={toggleStatus('error')}
        />
        <FilterChip
          testID="devtools-log-status-ok"
          label={t('log.filterOk')}
          selected={status === 'ok'}
          onPress={toggleStatus('ok')}
        />
        <FilterChip
          testID="devtools-log-status-slow"
          label={t('log.filterSlow', {
            seconds: DEFAULT_SLOW_MS / 1000,
            slow: slowCount,
          })}
          selected={status === 'slow'}
          onPress={toggleStatus('slow')}
        />
      </View>
    </View>
  );
};
