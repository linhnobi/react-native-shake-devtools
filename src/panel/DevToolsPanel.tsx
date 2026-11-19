import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '../ui/Button';
import { useSheetKit } from '../ui/sheet-kit';
import { Text } from '../ui/Text';
import { Icon } from '../ui/Icon';
import { useStyles } from '../ui/use-styles';
import type { DevToolsTheme } from '../ui/theme';
import { actionBuffer } from '../capture/action-buffer';
import { formatDateTime } from '../capture/format-log';
import { logBuffer } from '../capture/log-buffer';
import { countErrors } from '../capture/log-query';
import { formatSessionInfo } from '../capture/session-info';
import { getCaptureStartedAt } from '../capture/start-capture';
import type { DevToolsPanelProps } from '../gate/devtools-props';
import { useDevToolsT } from '../i18n';
import { copyText } from './copy-text';
import { DevToolsChoiceRow } from './DevToolsChoiceRow';
import { DevToolsRow } from './DevToolsRow';
import { useAiCopy } from './use-ai-copy';
import { LIVE_REFRESH_MS, useLogEntries } from './use-log-entries';
import { safeInfo } from './use-log-export';
import { usePreviousSession } from './use-previous-session';

/** Dấu "Đã chép" trên hàng thông tin thiết bị — cùng nhịp với dấu chép ở màn nhật ký. */
const COPIED_HINT_MS = 1500;

/** ⚠️ Hằng module-scope — xem ghi chú cùng tên ở `DevToolsRow.tsx`. */
const stylesOf = (t: DevToolsTheme) => ({
  divider: {
    height: t.borderWidth.thin,
    /* Thụt đúng bằng lề trong của hàng; sát mép thì kẻ trông như chia KHỐI chứ không phải
       chia hai dòng cùng nhóm. */
    marginHorizontal: t.spacing.md,
    backgroundColor: t.colors.border.subtle,
  },
  /** Dải báo crash — nền nguy hiểm nhạt, bấm được, lề khớp lề hàng. */
  banner: {
    marginHorizontal: t.spacing.md,
    marginBottom: t.spacing.sm,
    padding: t.spacing.sm,
    borderRadius: t.radius.md,
    gap: t.spacing['2xs'],
    backgroundColor: t.colors.background.dangerSubtle,
  },
});

/** Chuỗi tóm tắt một dòng cho hàng thông tin thiết bị — ghép giá trị đã có, không thêm chữ. */
const summaryOf = (values: ReadonlyArray<string | undefined>) =>
  values.filter(Boolean).join(' · ');

/** Khoá câu cho đoạn ảnh của dòng phụ hàng Báo bug; `'none'` (app không cấp hàm chụp) ⇒ bỏ đoạn. */
const SHOT_HINT = {
  blocked: 'panel.reportShotBlocked',
  failed: 'panel.reportShotFailed',
  none: undefined,
} as const;

/**
 * **Chức năng:** sheet gỡ lỗi — tiêu đề, dòng phụ môi trường, hàng **Báo bug** (chỉ khi app bật báo
 * bug; luôn đứng đầu), dải báo **phiên trước bị crash**, hàng **Nhật ký** (huy hiệu đếm **lỗi**),
 * hàng **Chép cho AI** (khối Markdown đã che của phiên đang chạy, xem `useAiCopy`; chỉ có khi có hàng
 * Nhật ký), hàng **Phiên trước**, hàng **Chép thông tin thiết bị**, các hàng do app cấp, và hàng tắt
 * lắc tạm.
 *
 * Dòng phụ của hàng Báo bug: `Có bản nháp` khi đang có nháp; không thì `<ảnh> · N bước tự ghi` với
 * `<ảnh>` là `Ảnh đã chụp` / `Màn này không cho chụp ảnh` / `Không chụp được ảnh`, hoặc bỏ hẳn khi
 * app không cấp hàm chụp. Hàng đợi còn bản chưa gửi xong ⇒ thêm `· N chờ gửi` / `· N cần xử lý`.
 *
 * 🔴 Dựng bằng sheet của bộ sheet (`useSheetKit().Sheet` — gorhom ở entry `.`, `PlainSheet` ở
 * `./plain`; cả hai cùng window với app), **tuyệt đối không** `<Modal>` của react-native:
 * `<Modal>` tạo một **window riêng** mà `FLAG_SECURE` không phủ, nên app có thể chặn chụp màn
 * hình (FLAG_SECURE trên Android, chặn screenshot trên iOS) vẫn bị chụp được **đúng cái sheet
 * đang phơi dữ liệu**.
 *
 * ## Huy hiệu đếm lỗi, không đếm tổng
 *
 * Huy hiệu là chữ **đỏ**. Trước 24/9/2026 nó in tổng số dòng (vd `214`) — đọc như 214 lỗi. Nay nó
 * in số **lỗi** (không có lỗi ⇒ không vẽ), còn tổng số dòng nằm ở dòng phụ "214 dòng · 12 lỗi".
 *
 * **Input:** `visible` · `onDismiss` · `subtitle?` · `actions` (mảng rỗng ⇒ chỉ còn các hàng có
 * sẵn) · `onSnooze` · `snoozeMinutes` · `onOpenLog?` · `onOpenPrevious?` · `sessionInfo?` ·
 * `report?` (hàng Báo bug: `hasDraft` · `screenshot` · `steps` · `onPress`).
 * **Output:** sheet `size="dynamic"` — số hàng ít và biết trước.
 *
 * @example
 * ```tsx
 * <DevToolsPanel
 *   visible={open} onDismiss={close} subtitle="UAT · 1.0.2"
 *   actions={[{ id: 'sim', label: 'Giả lập…', onPress: cycle, dismissOnPress: false }]}
 *   onSnooze={snooze} snoozeMinutes={30} onOpenLog={openLog} onOpenPrevious={openPrevious}
 *   sessionInfo={() => ({ appVersion: '1.0.2 (58)', device: 'Pixel 8' })}
 * />
 * // Ca biên: actions = [] và không có phiên trước ⇒ sheet vẫn mở được với Nhật ký · Chép thông
 * // tin · Tắt lắc — đủ để thử cú lắc trên máy thật.
 * ```
 *
 * **Unit test:** `DevToolsPanel.test.tsx` › `DevToolsPanel` — 9 case: `visible=false` không vẽ gì
 * · vẽ đủ N hàng theo `actions` · `subtitle` vắng thì không vẽ dòng phụ · bấm hàng có
 * `dismissOnPress` mặc định ⇒ gọi `onPress` **rồi** `onDismiss` · `dismissOnPress: false` ⇒ không
 * đóng · hàng tắt lắc gọi `onSnooze` · huy hiệu Nhật ký đếm **lỗi**, dòng phụ có tổng · hàng chép
 * thông tin gọi bộ nhớ tạm với khối `formatSessionInfo` và hiện "Đã chép" · phiên trước bị crash
 * ⇒ dải báo + hàng Phiên trước, bấm gọi `onOpenPrevious`. › `DevToolsPanel — hàng "Chép cho AI"` —
 * 4 case: vắng `onOpenLog` ⇒ không có hàng · đứng ngay dưới Nhật ký, có dòng phụ · bấm chép khối đã
 * che (build, máy, request lỗi) và hiện "Đã chép cho AI", panel không đóng · tiếng Anh.
 * › `DevToolsPanel — hàng "Báo bug"` —
 * 16 case: vắng `report` ⇒ không có hàng · là hàng đầu tiên, bấm gọi `onPress` · dòng phụ ×8 (có ảnh ·
 * màn chặn chụp · hàm chụp ném · không có hàm chụp · có bản nháp · hàng đợi chờ gửi + cần xử lý · chỉ
 * cần xử lý · hàng đợi trống) · tiếng Anh ×2 · màu theo theme sáng/tối × kit gorhom/thuần.
 */
export const DevToolsPanel = ({
  visible,
  onDismiss,
  subtitle,
  actions,
  onSnooze,
  snoozeMinutes,
  onOpenLog,
  onOpenPrevious,
  sessionInfo,
  report,
}: DevToolsPanelProps) => {
  const t = useDevToolsT();
  const styles = useStyles(stylesOf);
  const { Sheet, ScrollView } = useSheetKit();
  /* Chỉ đăng ký khi panel đang hiện, xem `useLogEntries`. Gộp nhịp: panel chỉ cần hai con số,
     không cần render theo từng request. */
  const entries = useLogEntries(visible, LIVE_REFRESH_MS);
  const errors = useMemo(() => countErrors(entries), [entries]);
  const total = useMemo(
    () => entries.filter((e) => e.kind !== 'marker').length,
    [entries],
  );
  const previous = usePreviousSession();

  const [infoCopied, setInfoCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  /*
    Đọc MỘT lần mỗi lần mở panel, không mỗi render: panel render lại theo từng dòng log (đang
    đăng ký buffer), còn hàm của app đọc native module đồng bộ (model máy, số build). Vẫn đọc lại
    mỗi lần mở vì phiên đăng nhập có thể đổi giữa hai lần.
  */
  const info = useMemo(
    () => (visible ? (safeInfo(sessionInfo) ?? {}) : {}),
    [visible, sessionInfo],
  );

  /* Đọc nhật ký và thao tác LÚC BẤM (qua `snapshot`), không theo render — hàng không cần dựng lại
     theo từng dòng log mới. */
  const aiCopy = useAiCopy({
    getEntries: logBuffer.snapshot,
    getActions: actionBuffer.snapshot,
    build: subtitle,
    sessionInfo,
    sessionStartedAt: getCaptureStartedAt(),
  });
  const aiLabel =
    aiCopy.state === 'copied'
      ? t('panel.aiCopied')
      : aiCopy.state === 'failed'
        ? t('panel.aiCopyFailed')
        : t('panel.copyAi');

  const copyInfo = () => {
    if (!copyText(formatSessionInfo(info, getCaptureStartedAt()))) return;
    setInfoCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setInfoCopied(false), COPIED_HINT_MS);
  };

  /** Gọi hành động rồi đóng — thứ tự này để callback thấy sheet vẫn còn `visible`. */
  const pick = (action: (typeof actions)[number]) => () => {
    action.onPress?.();
    if (action.dismissOnPress !== false) {
      onDismiss();
    }
  };

  /*
    Nút đóng đi vào hàm vẽ header của `Sheet` — phần tử mới mỗi render là header bị gỡ
    ra dựng lại (gorhom render hàm đó như một kiểu component). Xem mục hiệu năng ở `LogSheet`.
  */
  const closeButton = useMemo(
    () => (
      <Button
        testID="devtools-panel-dismiss"
        label={t('common.close')}
        iconOnly
        variant="tertiary"
        onPress={onDismiss}
        leftIcon={({ size }) => <Icon name="close" size={size} />}
      />
    ),
    [t, onDismiss],
  );

  /* "Có bản nháp" · hoặc "<ảnh> · N bước tự ghi" — đoạn ảnh vắng khi app không cấp hàm chụp; rồi
     số bản hàng đợi chưa gửi xong (C1: bản báo đã giao cho hàng đợi không được biến mất khỏi mắt QA). */
  let reportHint: string | undefined;
  if (report) {
    const shot = report.screenshot;
    const shotKey = typeof shot === 'object' ? 'panel.reportShot' : SHOT_HINT[shot];
    const waiting = report.queue?.waiting ?? 0;
    const attention = report.queue?.attention ?? 0;
    reportHint = summaryOf([
      ...(report.hasDraft
        ? [t('panel.reportDraft')]
        : [shotKey && t(shotKey), t('panel.reportSteps', { count: report.steps })]),
      waiting > 0 ? t('panel.reportWaiting', { count: waiting }) : undefined,
      attention > 0 ? t('panel.reportAttention', { count: attention }) : undefined,
    ]);
  }

  const previousErrors = previous ? countErrors(previous.entries) : 0;
  const previousTotal = previous
    ? previous.entries.filter((e) => e.kind !== 'marker').length
    : 0;

  return (
    <Sheet
      testID="devtools-panel"
      visible={visible}
      onDismiss={onDismiss}
      title={t('panel.title')}
      description={subtitle}
      leftAction={closeButton}
      size="dynamic"
      contentMode="scrollable"
    >
      {/* Vỏ KHÔNG có lề ngang — lề nằm trong từng hàng, xem `DevToolsRow`. Là vùng cuộn: ít hàng thì
          sheet ôm theo như cũ, nhiều hàng hơn trần 94% màn thì cuộn tới được hàng cuối. */}
      <ScrollView testID="devtools-panel">
        {/* Báo bug đứng TRÊN CÙNG, trên cả dải crash: là việc QA lắc máy để làm (spec 4.2). */}
        {report ? (
          <>
            <DevToolsRow
              testID="devtools-row-report"
              label={t('panel.report')}
              hint={reportHint}
              onPress={report.onPress}
            />
            <View style={styles.divider} />
          </>
        ) : null}

        {previous?.fatal && onOpenPrevious ? (
          <Pressable
            testID="devtools-panel-crash"
            accessibilityRole="button"
            onPress={onOpenPrevious}
            style={styles.banner}
          >
            <Text variant="captionS_Bold" tone="danger">
              {t('panel.crashTitle')}
            </Text>
            <Text variant="captionS_Regular" tone="primary">
              {t('panel.crashHint', {
                time: formatDateTime(previous.savedAt),
                errors: previousErrors,
              })}
            </Text>
          </Pressable>
        ) : null}

        {/* Hàng CÓ SẴN của lib — đứng trước hàng của app vì nó là thứ hay dùng nhất. */}
        {onOpenLog ? (
          <>
            <DevToolsRow
              testID="devtools-row-log"
              label={t('panel.log')}
              hint={t('panel.logHint', { total, errors })}
              badge={errors}
              onPress={onOpenLog}
            />
            <View style={styles.divider} />
            {/* Cùng điều kiện với hàng Nhật ký: app tắt nhật ký (không thu) thì khối này luôn rỗng. */}
            <DevToolsRow
              testID="devtools-row-ai"
              label={aiLabel}
              hint={t('panel.copyAiHint')}
              onPress={aiCopy.run}
            />
            <View style={styles.divider} />
          </>
        ) : null}

        {previous && onOpenPrevious ? (
          <>
            <DevToolsRow
              testID="devtools-row-previous"
              label={t('panel.previous')}
              hint={t('panel.previousHint', {
                time: formatDateTime(previous.savedAt),
                total: previousTotal,
                errors: previousErrors,
              })}
              badge={previousErrors}
              onPress={onOpenPrevious}
            />
            <View style={styles.divider} />
          </>
        ) : null}

        <DevToolsRow
          testID="devtools-row-info"
          label={infoCopied ? t('panel.infoCopied') : t('panel.copyInfo')}
          hint={summaryOf([info.device, info.os, info.appVersion]) || undefined}
          onPress={copyInfo}
        />
        <View style={styles.divider} />

        {actions.map((action) => (
          <Fragment key={action.id}>
            {action.choices ? (
              /* Hàng chọn-một: chạm chip là áp dụng, panel giữ nguyên để thấy màn đổi theo. */
              <DevToolsChoiceRow
                testID={`devtools-row-${action.id}`}
                label={action.label}
                hint={action.hint}
                choices={action.choices}
                selectedId={action.selectedId}
                onSelect={action.onSelect}
              />
            ) : (
              <DevToolsRow
                testID={`devtools-row-${action.id}`}
                label={action.label}
                hint={action.hint}
                badge={action.badge}
                onPress={action.onPress ? pick(action) : undefined}
              />
            )}
            <View style={styles.divider} />
          </Fragment>
        ))}

        <DevToolsRow
          testID="devtools-row-snooze"
          label={t('panel.snooze', { minutes: snoozeMinutes })}
          onPress={onSnooze}
        />
      </ScrollView>
    </Sheet>
  );
};
