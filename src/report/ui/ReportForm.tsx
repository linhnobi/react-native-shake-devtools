import { Image, Pressable, View } from 'react-native';
import { useDevToolsT } from '../../i18n';
import { Button } from '../../ui/Button';
import { useSheetKit } from '../../ui/sheet-kit';
import { Text } from '../../ui/Text';
import type { DevToolsTheme } from '../../ui/theme';
import { useStyles, useTheme } from '../../ui/use-styles';
import type { ReportDraft } from '../bug-report';
import type { ReportDraftPatch } from '../report-controller';

/** Cạnh ngang ảnh thu nhỏ (dp); cao theo tỉ lệ ảnh, kẹp trong [`THUMB_MIN_H`, `THUMB_MAX_H`]. */
const THUMB_W = 72;
const THUMB_MIN_H = 48;
const THUMB_MAX_H = 160;

/**
 * `Chip` của design system chỉ vẽ (cao ~24) ⇒ bù vùng chạm cho chip bấm được, như `FilterChip` của
 * thanh lọc nhật ký. Hàng chip cách nhau `spacing.compact` (10) — vùng chạm hai hàng chạm nhau,
 * không chồng.
 */
const CHIP_HIT_SLOP = { top: 6, bottom: 6 } as const;

/** ⚠️ Hằng module-scope — `useStyles` nhớ theo tham chiếu factory. */
const stylesOf = (t: DevToolsTheme) => ({
  root: { gap: t.spacing.md },
  shot: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: t.spacing.sm,
    padding: t.spacing.xs,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.background.surfaceAlt,
  },
  shotImage: {
    width: THUMB_W,
    borderRadius: t.radius.sm,
    borderWidth: t.borderWidth.thin,
    borderColor: t.colors.border.subtle,
  },
  shotText: { flex: 1 },
  field: { gap: t.spacing['2xs'] },
  label: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  input: {
    minHeight: t.size.field,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    borderRadius: t.radius.md,
    borderWidth: t.borderWidth.thin,
    borderColor: t.colors.border.strong,
    backgroundColor: t.colors.background.surface,
    ...t.typography.bodyM_Medium,
    fontWeight: '400' as const,
    color: t.colors.text.primary,
  },
  /** Viền nhấn: chữ trong ô do máy điền sẵn (spec 4.3.2). */
  prefilled: { borderColor: t.colors.background.brand },
  multiline: { minHeight: t.size.field * 2, textAlignVertical: 'top' as const },
  stepsCard: {
    minHeight: t.size.minTouch,
    justifyContent: 'center' as const,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.md,
    borderWidth: t.borderWidth.thin,
    borderColor: t.colors.border.subtle,
    backgroundColor: t.colors.background.surfaceAlt,
  },
  chips: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: t.spacing.xs,
    rowGap: t.spacing.compact,
  },
  chip: {
    paddingVertical: t.spacing['2xs'],
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.pill,
    borderWidth: t.borderWidth.thin,
  },
  footerRow: { flexDirection: 'row' as const, gap: t.spacing.xs },
  /** Banner hàng đợi (C1): trung tính — chỉ có bản hàng đợi tự lo. */
  queueBanner: {
    minHeight: t.size.minTouch,
    justifyContent: 'center' as const,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    borderRadius: t.radius.md,
    borderWidth: t.borderWidth.thin,
    borderColor: t.colors.border.subtle,
    backgroundColor: t.colors.background.surfaceAlt,
  },
  /** …cảnh báo — có bản QA phải ra tay: viền màu cảnh báo. */
  queueBannerAttention: { borderColor: t.colors.text.warning },
});

interface AttachChipProps {
  testID: string;
  label: string;
  selected: boolean;
  /** Kết nối đang chọn không mang được phần này ⇒ chip tắt và khoá. */
  disabled?: boolean;
  onPress: () => void;
}

/** Chip đính kèm bật/tắt được, có trạng thái khoá (chữ `disabled` của theme). */
const AttachChip = ({ testID, label, selected, disabled = false, onPress }: AttachChipProps) => {
  const { colors } = useTheme();
  const styles = useStyles(stylesOf);
  const on = selected && !disabled;
  const textColor = disabled
    ? colors.text.disabled
    : on
      ? colors.text.onFilled
      : colors.text.secondary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      hitSlop={CHIP_HIT_SLOP}
      onPress={disabled ? undefined : onPress}
      style={[
        styles.chip,
        {
          borderColor: on ? colors.background.brand : colors.border.subtle,
          backgroundColor: on ? colors.background.brand : colors.background.surfaceAlt,
        },
      ]}
    >
      <Text variant="captionS_Medium" style={{ color: textColor }}>
        {label}
      </Text>
    </Pressable>
  );
};

export interface ReportFormProps {
  draft: ReportDraft;
  /** Số dòng lỗi trong cửa sổ của bug — số trên chip "Log lỗi (N)". */
  errorCount: number;
  /** Kết nối đang chọn gửi được ảnh / file (`ConnectorType.capabilities`). Chưa có ⇒ `true`. */
  canImage: boolean;
  canFiles: boolean;
  /** Ô nào còn chữ máy điền (QA chưa sửa) ⇒ viền nhấn + testID hậu tố `-prefilled`. */
  prefilled: { readonly title: boolean; readonly actual: boolean };
  /** Lần gửi trước không bắt đầu được (lỗi ngoài hàng đợi). */
  sendFailed: boolean;
  /**
   * Có ⇒ nháp này bị chặn SAU khi ticket đã tạo và kết nối đang chọn là kết nối cũ: gửi lại chỉ làm
   * nốt, chữ sửa không áp dụng (R34). Câu đã dịch.
   */
  committedNote?: string;
  /**
   * Bản báo hàng đợi chưa gửi xong (C1): `attention` (thất bại · bị chặn · không chắc đã gửi) và
   * `waiting` (đang gửi · chờ gửi lại). Có bản nào ⇒ banner đầu form, chạm gọi `onOpenQueue`.
   */
  queued?: { readonly waiting: number; readonly attention: number };
  /** Mở trang Hàng đợi. */
  onOpenQueue?: () => void;
  onChange: (patch: ReportDraftPatch) => void;
  onEditSteps: () => void;
  onRetake: () => void;
}

/**
 * **Chức năng:** thân form báo bug theo bố cục A+ (spec 4.3), một trang cuộn, từ trên xuống:
 * 0. **Banner hàng đợi** (C1) — chỉ khi hàng đợi còn bản chưa gửi xong: `Hàng đợi gửi: N chờ gửi ·
 *    M cần xử lý — chạm để xem`. Có bản cần xử lý ⇒ kiểu cảnh báo (testID
 *    `devtools-report-queue-banner-attention`, viền và chữ màu cảnh báo); chỉ có bản đang chờ ⇒ trung
 *    tính (`devtools-report-queue-banner-waiting`). Chạm ⇒ trang Hàng đợi.
 * 1. **Ảnh** thu nhỏ + "Chụp lại" — hoặc câu "Màn này không cho chụp ảnh" / "Không chụp được ảnh";
 *    app không cấp hàm chụp (`'none'`) ⇒ không có khối ảnh.
 * 2. **Tiêu đề** (trên cùng để bàn phím không che). Trống ⇒ dòng nhắc, nút Gửi khoá (R24).
 * 3. Thẻ thu gọn **`N bước tự ghi · Sửa ›`** ⇒ trang sửa các bước.
 * 4. **Thực tế** · **Mong đợi** (không bắt buộc).
 * 5. **Chip** bật sẵn: Ảnh (khi có ảnh) · Log lỗi (N) · Thông tin máy · Ngữ cảnh app (chỉ khi app
 *    cấp `bugReport.appContext`; khoá lúc hàm async đang chờ; khoá + "không lấy được" khi hàm ném,
 *    quá hạn hoặc trả junk; không có ở nháp sau crash) · Phiên trước (crash) — chỉ ở nháp sau crash.
 *    Kết nối mức nhẹ (`capabilities` không có ảnh/file) ⇒ chip Ảnh, Log lỗi, Phiên trước tắt và khoá,
 *    kèm lý do (chip Ngữ cảnh app thì không: nó đi trong thân tin); nháp **không** bị sửa, đổi sang
 *    kết nối đầy đủ là bật lại.
 *
 * Chữ máy điền (tiêu đề, Thực tế) có viền nhấn và testID hậu tố `-prefilled` tới khi QA sửa. Ô nhập
 * là `TextInput` của bộ sheet. Nút Gửi nằm ở chân sheet — {@link ReportFormFooter}.
 *
 * **Input:** {@link ReportFormProps}. **Output:** khối nội dung (vùng cuộn do `ReportSheet` lo).
 *
 * @example
 * ```tsx
 * <ReportForm draft={draft} errorCount={1} canImage canFiles
 *   prefilled={{ title: true, actual: true }} sendFailed={false}
 *   onChange={change} onEditSteps={openSteps} onRetake={onRetake} />
 * // Ca biên: draft.screenshot === 'none' ⇒ form bắt đầu ngay ở ô tiêu đề.
 * ```
 *
 * **Unit test:** `ReportSheet.test.tsx` › `form A+` — phủ qua sheet (×2 bộ sheet): thứ tự · điền
 * sẵn · tiêu đề trống · ảnh (có ảnh · `blocked` · `failed` · `none`) · chip bật/tắt · chip Ngữ cảnh
 * app ×6 (bật/tắt · vắng · ném · async · kết nối nhẹ · nháp crash) · nháp crash · kết nối nhẹ;
 * › `hàng đợi (C1, I3)` — banner: không có (trống / chỉ đã gửi) · trung tính · cảnh báo.
 */
export const ReportForm = ({
  draft,
  errorCount,
  canImage,
  canFiles,
  prefilled,
  sendFailed,
  committedNote,
  queued,
  onOpenQueue,
  onChange,
  onEditSteps,
  onRetake,
}: ReportFormProps) => {
  const t = useDevToolsT();
  const theme = useTheme();
  const styles = useStyles(stylesOf);
  const { TextInput } = useSheetKit();
  const shot = draft.screenshot;
  const image = typeof shot === 'object' ? shot : null;
  const attach = draft.attach;
  /* Nháp crash không bao giờ mang ngữ cảnh (bộ điều khiển không chụp); chặn thêm ở đây cho chắc. */
  const appContext = draft.crash ? undefined : draft.appContext;
  const toggle = (key: keyof ReportDraft['attach']) => () =>
    onChange({ attach: { ...attach, [key]: !attach[key] } });
  const inputProps = {
    placeholderTextColor: theme.colors.text.tertiary,
    selectionColor: theme.colors.text.brand,
    keyboardAppearance: theme.mode,
  } as const;
  const prefilledMark = (
    <Text variant="captionS_Medium" tone="brand">
      {t('report.form.prefilled')}
    </Text>
  );
  const unsupported = !canImage || !canFiles;
  const waiting = queued?.waiting ?? 0;
  const attention = queued?.attention ?? 0;
  const queueSummary = [
    waiting > 0 ? t('report.queue.countWaiting', { count: waiting }) : undefined,
    attention > 0 ? t('report.queue.countAttention', { count: attention }) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.root}>
      {queueSummary !== '' ? (
        <Pressable
          testID={`devtools-report-queue-banner-${attention > 0 ? 'attention' : 'waiting'}`}
          accessibilityRole="button"
          onPress={onOpenQueue}
          style={[styles.queueBanner, attention > 0 ? styles.queueBannerAttention : null]}
        >
          <Text variant="captionS_Medium" tone={attention > 0 ? 'warning' : 'secondary'}>
            {t('report.queue.banner', { summary: queueSummary })}
          </Text>
        </Pressable>
      ) : null}
      {shot === 'none' ? null : (
        <View testID="devtools-report-shot" style={styles.shot}>
          {image ? (
            <Image
              testID="devtools-report-shot-image"
              source={{ uri: image.uri }}
              accessibilityLabel={t('report.form.shotAlt')}
              resizeMode="cover"
              style={[
                styles.shotImage,
                {
                  height: Math.min(
                    THUMB_MAX_H,
                    Math.max(THUMB_MIN_H, (THUMB_W * image.height) / (image.width || 1)),
                  ),
                },
              ]}
            />
          ) : null}
          <View style={styles.shotText}>
            {image ? null : (
              <Text variant="captionS_Regular" tone="secondary">
                {t(shot === 'blocked' ? 'report.form.shotBlocked' : 'report.form.shotFailed')}
              </Text>
            )}
          </View>
          <Button
            testID="devtools-report-retake"
            label={t('report.form.retake')}
            variant="secondary"
            size="sm"
            onPress={onRetake}
          />
        </View>
      )}

      <View style={styles.field}>
        <View style={styles.label}>
          <Text variant="captionS_Bold" tone="secondary">
            {t('report.form.title')}
          </Text>
          {prefilled.title ? prefilledMark : null}
        </View>
        <TextInput
          testID={prefilled.title ? 'devtools-report-title-prefilled' : 'devtools-report-title'}
          value={draft.title}
          onChangeText={(title) => onChange({ title })}
          accessibilityLabel={t('report.form.title')}
          {...inputProps}
          style={[styles.input, prefilled.title ? styles.prefilled : null]}
        />
        {draft.title.trim() === '' ? (
          <Text testID="devtools-report-title-required" variant="captionS_Regular" tone="danger">
            {t('report.form.titleRequired')}
          </Text>
        ) : null}
      </View>

      <Pressable
        testID="devtools-report-steps-card"
        accessibilityRole="button"
        onPress={onEditSteps}
        style={styles.stepsCard}
      >
        <Text variant="bodyM_Medium" tone="brand">
          {t('report.form.stepsCard', { count: draft.steps.length })}
        </Text>
      </Pressable>

      <View style={styles.field}>
        <View style={styles.label}>
          <Text variant="captionS_Bold" tone="secondary">
            {t('report.form.actual')}
          </Text>
          {prefilled.actual ? prefilledMark : null}
        </View>
        <TextInput
          testID={prefilled.actual ? 'devtools-report-actual-prefilled' : 'devtools-report-actual'}
          value={draft.actual}
          onChangeText={(actual) => onChange({ actual })}
          accessibilityLabel={t('report.form.actual')}
          multiline
          {...inputProps}
          style={[styles.input, styles.multiline, prefilled.actual ? styles.prefilled : null]}
        />
      </View>

      <View style={styles.field}>
        <Text variant="captionS_Bold" tone="secondary">
          {t('report.form.expected')}
        </Text>
        <TextInput
          testID="devtools-report-expected"
          value={draft.expected}
          onChangeText={(expected) => onChange({ expected })}
          accessibilityLabel={t('report.form.expected')}
          placeholder={t('report.form.expectedPlaceholder')}
          multiline
          {...inputProps}
          style={[styles.input, styles.multiline]}
        />
      </View>

      <View style={styles.field}>
        <Text variant="captionS_Bold" tone="secondary">
          {t('report.form.attach')}
        </Text>
        <View style={styles.chips}>
          {image ? (
            <AttachChip
              testID="devtools-report-attach-screenshot"
              label={t('report.form.chipScreenshot')}
              selected={attach.screenshot}
              disabled={!canImage}
              onPress={toggle('screenshot')}
            />
          ) : null}
          <AttachChip
            testID="devtools-report-attach-errors"
            label={t('report.form.chipErrors', { count: errorCount })}
            selected={attach.errors}
            disabled={!canFiles}
            onPress={toggle('errors')}
          />
          <AttachChip
            testID="devtools-report-attach-device"
            label={t('report.form.chipDevice')}
            selected={attach.deviceInfo}
            onPress={toggle('deviceInfo')}
          />
          {appContext ? (
            /* Không khoá theo kết nối: kết nối chỉ gửi chữ vẫn nhận mục "App context" trong thân tin. */
            <AttachChip
              testID="devtools-report-attach-context"
              label={t(
                appContext.status === 'failed'
                  ? 'report.form.chipContextFailed'
                  : 'report.form.chipContext',
              )}
              selected={attach.appContext}
              disabled={appContext.status !== 'ready'}
              onPress={toggle('appContext')}
            />
          ) : null}
          {draft.crash ? (
            <AttachChip
              testID="devtools-report-attach-previous"
              label={t('report.form.chipPrevious')}
              selected={attach.previousSession}
              disabled={!canFiles}
              onPress={toggle('previousSession')}
            />
          ) : null}
        </View>
        {unsupported ? (
          <Text
            testID="devtools-report-attach-unsupported"
            variant="captionS_Regular"
            tone="secondary"
          >
            {t('report.form.attachUnsupported')}
          </Text>
        ) : null}
      </View>

      {committedNote ? (
        <Text testID="devtools-report-committed" variant="captionS_Regular" tone="warning">
          {committedNote}
        </Text>
      ) : null}
      {sendFailed ? (
        <Text testID="devtools-report-send-failed" variant="captionS_Regular" tone="danger">
          {t('report.form.sendFailed')}
        </Text>
      ) : null}
    </View>
  );
};

export interface ReportFormFooterProps {
  /**
   * `send` — nút "Gửi tới <kết nối>" + ▾. `add` — chưa có kết nối (hoặc app chưa cấp kho bảo mật):
   * "Chia sẻ" + "Thêm kết nối".
   */
  mode: 'send' | 'add';
  /** Chữ nút gửi: `Gửi tới …` hoặc `Đang chuẩn bị…`. */
  sendLabel: string;
  sendDisabled: boolean;
  /** Đang gửi ⇒ vòng quay, không nhận chạm. */
  sending: boolean;
  onSend: () => void;
  onPick: () => void;
  onShare: () => void;
  /** Mở trang Kết nối. Vắng ⇒ nút "Thêm kết nối" khoá. */
  onAddConnection?: () => void;
}

/**
 * **Chức năng:** chân sheet của form — nút Gửi dính đáy, vẫn thấy khi bàn phím mở (spec 4.3.6).
 * Phải giữ **ổn định** (`useMemo` ở chỗ gọi): gorhom vẽ chân như một kiểu component.
 *
 * **Input:** {@link ReportFormFooterProps}. **Output:** một hàng nút.
 *
 * @example
 * ```tsx
 * <ReportFormFooter mode="send" sendLabel="Gửi tới Jira · DEMO" sendDisabled={false}
 *   sending={false} onSend={send} onPick={openPicker} onShare={onShare} />
 * // Ca biên: mode="add" ⇒ "Chia sẻ" + "Thêm kết nối", không có nút Gửi.
 * ```
 *
 * **Unit test:** `ReportSheet.test.tsx` › `form A+` (nút Gửi, ▾, R24, R27, chưa có kết nối, không
 * có kho) và `gửi và kết quả` (khoá khi đang gửi).
 */
export const ReportFormFooter = ({
  mode,
  sendLabel,
  sendDisabled,
  sending,
  onSend,
  onPick,
  onShare,
  onAddConnection,
}: ReportFormFooterProps) => {
  const t = useDevToolsT();
  const styles = useStyles(stylesOf);
  if (mode === 'add') {
    return (
      <View style={styles.footerRow}>
        <Button
          testID="devtools-report-share"
          label={t('report.form.share')}
          variant="secondary"
          onPress={onShare}
        />
        <Button
          testID="devtools-report-add-connection"
          label={t('report.form.addConnection')}
          disabled={!onAddConnection}
          onPress={onAddConnection}
        />
      </View>
    );
  }
  return (
    <View style={styles.footerRow}>
      <Button
        testID="devtools-report-send"
        label={sendLabel}
        disabled={sendDisabled}
        loading={sending}
        onPress={onSend}
      />
      <Button
        testID="devtools-report-pick"
        label="▾"
        accessibilityLabel={t('report.form.pickConnection')}
        variant="secondary"
        disabled={sending}
        onPress={onPick}
      />
    </View>
  );
};
