import { View } from 'react-native';
import { useDevToolsT } from '../../i18n';
import type { DevToolsKey } from '../../i18n/types';
import { Button } from '../../ui/Button';
import { Text, type TextTone } from '../../ui/Text';
import type { DevToolsTheme } from '../../ui/theme';
import { useStyles } from '../../ui/use-styles';
import { isCommitted, type QueuedReport, type QueueState } from '../send-queue';

/** ⚠️ Hằng module-scope — `useStyles` nhớ theo tham chiếu factory. */
const stylesOf = (t: DevToolsTheme) => ({
  root: { gap: t.spacing.sm },
  actions: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: t.spacing.xs,
    marginTop: t.spacing.xs,
  },
});

/** Màu dòng chính (và nhãn trạng thái ở trang Hàng đợi) theo trạng thái. */
export const STATE_TONE: Record<QueueState, TextTone> = {
  sending: 'primary',
  sent: 'success',
  pending: 'warning',
  uncertain: 'warning',
  blocked: 'danger',
  failed: 'danger',
};

/** Câu của trạng thái `blocked` theo nhóm lỗi; nhóm khác (không xảy ra) ⇒ như `permission`. */
const BLOCKED: Readonly<Record<string, DevToolsKey>> = {
  auth: 'report.status.auth',
  permission: 'report.status.permission',
  validation: 'report.status.validation',
  'connection-missing': 'report.status.missing',
};

export interface SendStatusProps {
  /** Mục hàng đợi của bản báo đang xem — bản mới nhất (màn đổi theo hàng đợi). */
  item: QueuedReport;
  /** Tên đích trong câu báo (tên loại kết nối, vd `Jira`). */
  target: string;
  /** Kết nối mức nhẹ (không ảnh/file) ⇒ màn thành công có "Chia sẻ ảnh và log". */
  light: boolean;
  /** Vừa chép link ⇒ nút đổi chữ "Đã chép". */
  copied: boolean;
  /** Đang gửi lại thủ công. */
  retrying: boolean;
  onOpen: (url: string) => void;
  onCopy: (url: string) => void;
  /** "Báo bug khác". Vắng ⇒ không có nút (trang mở từ Hàng đợi: nháp đang soạn là bản khác). */
  onAnother?: () => void;
  /** Mọi nút "Chia sẻ …" — nhận `id` của bản báo đang hiện (R35: nháp đã giao cho hàng đợi). */
  onShare: (reportId: string) => void;
  /** Gửi lại thủ công (`retryNow`): `uncertain` · `failed` · `blocked` không còn nháp. */
  onRetry: () => void;
  /**
   * Có ⇒ bản báo này **chính là nháp đang soạn** (bị chặn, R31 giữ nháp): "Sửa bản báo" về form +
   * câu "Bản nháp vẫn được giữ.". Vắng ⇒ bản chỉ còn trong hàng đợi: sửa kết nối rồi "Gửi lại".
   */
  onEdit?: () => void;
  /** Vắng ⇒ không có nút "Mở màn kết nối". */
  onManageConnections?: () => void;
  /**
   * Kết nối của bản báo còn trong kho (và loại của nó còn đăng ký). Bản `blocked` vì kết nối không
   * còn chỉ gửi lại được khi `true` (kết nối cùng id có lại).
   */
  connectionReady: boolean;
  /** Bỏ bản báo khỏi hàng đợi — `ReportSheet` lo bấm hai lần (`discardArmed`). */
  onDiscard: () => void;
  /** Đã bấm "Bỏ bản báo" một lần ⇒ nút đổi chữ "Bỏ thật?". */
  discardArmed: boolean;
  /**
   * Hàng đợi chỉ nằm trong RAM (app không bật `persist`) ⇒ bản còn chờ trong hàng đợi nhắc "sẽ mất
   * nếu app bị tắt" (spec 5.6).
   */
  ramOnly?: boolean;
}

/** Trạng thái bản báo còn nằm trong hàng đợi chờ QA hay chờ gửi — mất theo app nếu hàng đợi chỉ ở RAM. */
const KEPT_IN_QUEUE: ReadonlySet<QueueState> = new Set<QueueState>([
  'sending',
  'pending',
  'uncertain',
  'failed',
]);

/**
 * **Chức năng:** trang kết quả của **một** bản báo trong hàng đợi — ngay sau khi bấm Gửi, hoặc mở
 * từ trang Hàng đợi (spec 4.4, 4.5, 5.4.3, 5.6; C1, I3). Một câu chính (testID
 * `devtools-report-status-<trạng thái>`) và các hành động của đúng trạng thái đó. **Mọi trạng thái
 * chưa gửi xong đều có đường đi tiếp** (R42): gửi lại khi có thể thành công · Chia sẻ · Bỏ bản báo
 * (trừ lúc đang gửi — request đang bay vẫn có thể tạo ticket, N2).
 *
 * | Trạng thái | Câu | Hành động |
 * |---|---|---|
 * | `sent` | `Đã tạo DEMO-482` (không có mã ⇒ `Đã gửi`); có `skippedFiles` ⇒ câu ghi file chưa gửi được | Mở · Chép link (khi có link) · Chia sẻ ảnh và log (kết nối nhẹ) · Báo bug khác (khi có `onAnother`) |
 * | `sending` | Đang gửi… | Chia sẻ |
 * | `pending` | Đã xếp hàng, sẽ tự gửi lại | Chia sẻ thay vì gửi · Bỏ |
 * | `uncertain` | Không chắc đã gửi, kiểm tra ở <đích> trước khi gửi lại + lý do của connector | Gửi lại · Chia sẻ · Bỏ |
 * | `failed` | Gửi thất bại + lý do của connector; ticket chưa chắc đã có (`!isCommitted`) ⇒ "Có thể đã có ticket ở <đích>. Kiểm tra…" | Gửi lại · Chia sẻ · Bỏ |
 * | `blocked` | theo nhóm lỗi: token hết hạn · không đủ quyền · đích từ chối · kết nối không còn (+ lý do; ticket đã tạo ⇒ câu "gửi lại chỉ làm nốt") | là nháp đang soạn (`onEdit`): Mở màn kết nối · Sửa bản báo · Chia sẻ · Bỏ — chỉ còn trong hàng đợi: Gửi lại (kết nối không còn ⇒ chỉ khi `connectionReady`) · Mở màn kết nối · Chia sẻ · Bỏ |
 *
 * Lý do (`lastError.message`) đã được hàng đợi làm sạch (chỉ `ConnectorError.message` — connector
 * soạn, đã gỡ bí mật; lỗi lạ chỉ còn tên lớp) — màn không bao giờ hiện thân phản hồi thô. Mọi nút
 * "Chia sẻ …" gọi `onShare(item.report.id)` (R35). Hàng đợi chỉ ở RAM (`ramOnly`) ⇒ `sending`,
 * `pending`, `uncertain`, `failed` và `blocked` không còn nháp có câu "sẽ mất nếu app bị tắt".
 *
 * **Input:** {@link SendStatusProps}. **Output:** khối nội dung (vùng cuộn do `ReportSheet` lo).
 *
 * @example
 * ```tsx
 * <SendStatus item={item} target="Jira" light={false} copied={false} retrying={false} onOpen={open}
 *   onCopy={copy} onAnother={onRetake} onShare={onShare} onRetry={retry} onEdit={backToForm}
 *   connectionReady onDiscard={discard} discardArmed={false} />
 * // Ca biên: `sent` không có `url` (webhook Slack) ⇒ không có nút Mở / Chép link.
 * ```
 *
 * **Unit test:** `ReportSheet.test.tsx` › `gửi và kết quả` — 20 case (×2 bộ sheet): khoá khi đang
 * gửi · `sent` · `skippedFiles` · kết nối nhẹ · `pending` · `uncertain` + gửi lại ·
 * `blocked`/`auth` (+ mở màn kết nối) · Back ở `blocked` · `failed` · kết nối không còn + Chia sẻ ·
 * ticket đã tạo + cùng kết nối (câu "làm nốt") · ticket đã tạo + kết nối khác · câu RAM ×3
 * (`pending`/`uncertain`/`failed`) · không câu RAM khi lưu bền · không câu RAM ở `sent`/`blocked`
 * ×2 · đổi theo hàng đợi · Back sau khi gửi; › `hàng đợi (C1, I3)` — `failed` (lý do · "kiểm tra đích
 * trước" · Gửi lại) · `failed` đã `committed` · Chia sẻ + Bỏ ×4 trạng thái · Bỏ hai lần · `blocked`
 * không còn nháp ⇒ Gửi lại · kết nối không còn ⇒ Gửi lại chỉ khi kết nối có lại.
 */
export const SendStatus = ({
  item,
  target,
  light,
  copied,
  retrying,
  onOpen,
  onCopy,
  onAnother,
  onShare,
  onRetry,
  onEdit,
  onManageConnections,
  connectionReady,
  onDiscard,
  discardArmed,
  ramOnly = false,
}: SendStatusProps) => {
  const t = useDevToolsT();
  const styles = useStyles(stylesOf);
  const { state, result, lastError } = item;

  let headline: string;
  switch (state) {
    case 'sending':
      headline = t('report.status.sending');
      break;
    case 'sent':
      headline = result?.key
        ? t('report.status.sentKey', { key: result.key })
        : t('report.status.sent');
      break;
    case 'pending':
      headline = t('report.status.pending');
      break;
    case 'uncertain':
      headline = t('report.status.uncertain', { target });
      break;
    case 'blocked':
      headline = t(BLOCKED[lastError?.kind ?? ''] ?? 'report.status.permission', { target });
      break;
    case 'failed':
      headline = t('report.status.failed');
      break;
  }
  const missing = state === 'blocked' && lastError?.kind === 'connection-missing';
  /* Lý do do connector soạn (đã làm sạch, theo ngôn ngữ ticket) — câu "kết nối không còn" đã đủ rõ. */
  const detail =
    lastError && (state === 'failed' || state === 'uncertain' || (state === 'blocked' && !missing))
      ? lastError.message
      : undefined;
  const url = state === 'sent' ? result?.url : undefined;
  const skipped = state === 'sent' ? (result?.skippedFiles ?? []) : [];
  const ownsDraft = state === 'blocked' && onEdit !== undefined;
  const canRetry =
    state === 'uncertain' ||
    state === 'failed' ||
    (state === 'blocked' && !ownsDraft && (!missing || connectionReady));
  const share = () => onShare(item.report.id);

  return (
    <View testID="devtools-report-status-body" style={styles.root}>
      <Text
        testID={`devtools-report-status-${state}`}
        variant="bodyM_Medium"
        tone={STATE_TONE[state]}
      >
        {headline}
      </Text>
      {detail ? (
        <Text testID="devtools-report-status-detail" variant="captionS_Regular" tone="secondary">
          {detail}
        </Text>
      ) : null}
      {skipped.length > 0 ? (
        <Text testID="devtools-report-skipped" variant="captionS_Regular" tone="warning">
          {t('report.status.skipped', { files: skipped.join(', ') })}
        </Text>
      ) : null}
      {state === 'blocked' && isCommitted(item) ? (
        <Text testID="devtools-report-committed" variant="captionS_Regular" tone="warning">
          {t('report.status.committed', { target })}
        </Text>
      ) : null}
      {state === 'failed' && !isCommitted(item) ? (
        /* Lần hỏng có thể vẫn tới đích (5xx sau khi tạo, hết lượt sau lỗi mạng giữa chừng). */
        <Text testID="devtools-report-check-first" variant="captionS_Regular" tone="warning">
          {t('report.status.checkFirst', { target })}
        </Text>
      ) : null}
      {ownsDraft ? (
        <Text variant="captionS_Regular" tone="secondary">
          {t('report.status.draftKept')}
        </Text>
      ) : null}
      {ramOnly && (KEPT_IN_QUEUE.has(state) || (state === 'blocked' && !ownsDraft)) ? (
        <Text testID="devtools-report-ram-only" variant="captionS_Regular" tone="warning">
          {t('report.status.ramOnly')}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {url ? (
          <>
            <Button
              testID="devtools-report-open"
              label={t('report.status.open')}
              onPress={() => onOpen(url)}
            />
            <Button
              testID="devtools-report-copy-link"
              label={copied ? t('report.status.copied') : t('report.status.copyLink')}
              variant="secondary"
              onPress={() => onCopy(url)}
            />
          </>
        ) : null}
        {state === 'sent' && light ? (
          <Button
            testID="devtools-report-status-share"
            label={t('report.status.shareLight')}
            variant="secondary"
            onPress={share}
          />
        ) : null}
        {state === 'sent' && onAnother ? (
          <Button
            testID="devtools-report-another"
            label={t('report.status.another')}
            variant="secondary"
            onPress={onAnother}
          />
        ) : null}
        {canRetry ? (
          <Button
            testID="devtools-report-retry"
            label={t('report.status.retry')}
            loading={retrying}
            onPress={onRetry}
          />
        ) : null}
        {state === 'blocked' && onManageConnections ? (
          <Button
            testID="devtools-report-open-connections"
            label={t('report.status.openConnections')}
            variant={canRetry ? 'secondary' : 'primary'}
            onPress={onManageConnections}
          />
        ) : null}
        {ownsDraft ? (
          <Button
            testID="devtools-report-edit"
            label={t('report.status.edit')}
            variant="secondary"
            onPress={onEdit}
          />
        ) : null}
        {state !== 'sent' ? (
          <Button
            testID="devtools-report-status-share"
            label={t(state === 'pending' ? 'report.status.shareInstead' : 'report.status.share')}
            variant="secondary"
            onPress={share}
          />
        ) : null}
        {state !== 'sent' && state !== 'sending' ? (
          /* Không bỏ lúc đang gửi (N2): request đang bay vẫn có thể tạo ticket mà QA không còn thấy. */
          <Button
            testID="devtools-report-status-discard"
            label={t(discardArmed ? 'report.status.discardConfirm' : 'report.status.discard')}
            variant="tertiary"
            onPress={onDiscard}
          />
        ) : null}
      </View>
    </View>
  );
};
