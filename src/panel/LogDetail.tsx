import { useMemo } from 'react';
import { View } from 'react-native';
import { Button } from '../ui/Button';
import { useSheetKit } from '../ui/sheet-kit';
import { Text } from '../ui/Text';
import { useStyles } from '../ui/use-styles';
import type { DevToolsTheme } from '../ui/theme';
import { prettyBody } from '../capture/format-error-report';
import { withFullBodies } from '../capture/full-body-store';
import { formatDateTime } from '../capture/format-log';
import type { NetworkEntry } from '../capture/log-entry';
import { isAbortedEntry } from '../capture/log-query';
import { redactBody, redactHeaders } from '../capture/redact';
import { toCurl } from '../capture/to-curl';
import { useDevToolsT } from '../i18n';
import { JsonBody } from './JsonBody';
import { MONO_FONT } from './JsonTree';
import { FilterChip } from './LogToolbar';

export type DetailTab = 'overview' | 'headers' | 'request' | 'response' | 'curl';

const TABS: readonly DetailTab[] = ['overview', 'headers', 'request', 'response', 'curl'];

const TAB_KEY = {
  overview: 'log.tabOverview',
  headers: 'log.tabHeaders',
  request: 'log.tabRequest',
  response: 'log.tabResponse',
  curl: 'log.tabCurl',
} as const;

/** ⚠️ Hằng module-scope — xem ghi chú cùng tên ở `DevToolsRow.tsx`. */
const stylesOf = (t: DevToolsTheme) => ({
  tabs: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: t.spacing.sm,
    rowGap: t.spacing.compact,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
  },
  body: {
    paddingHorizontal: t.spacing.md,
    paddingBottom: t.spacing.md,
    gap: t.spacing.sm,
  },
  field: { gap: t.spacing['2xs'] },
  /* Cùng nền với khối thân (`JsonBody`) — `surface` + viền mảnh, xem lý do ở `syntax-colors.ts`. */
  code: {
    padding: t.spacing.sm,
    borderRadius: t.radius.sm,
    borderWidth: t.borderWidth.thin,
    borderColor: t.colors.border.subtle,
    backgroundColor: t.colors.background.surface,
  },
  mono: { fontFamily: MONO_FONT },
  /** Không lề: vỏ footer của `Sheet` (`footerType="button"`) đã có lề ngang + lề trên. */
  actions: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: t.spacing.sm,
  },
});

/** Kết cục của request, dạng người đọc: `500`, `network`, hoặc câu "đang chờ"/"Đã huỷ" đã dịch. */
const outcomeOf = (entry: NetworkEntry, pending: string, cancelled: string) => {
  if (entry.status !== undefined) return String(entry.status);
  if (isAbortedEntry(entry)) return cancelled;
  return entry.error ?? pending;
};

/**
 * Lệnh curl để **hiện**: header và thân đã che. Bản chép (`toCurl(entry)`) thì thô — xem bảng
 * chính sách ở đầu `redact.ts`: màn hình là đường "người đứng cạnh đọc được", clipboard là đường
 * ở lại với người đang gỡ.
 */
const shownCurl = (entry: NetworkEntry) =>
  toCurl({
    ...entry,
    requestHeaders: redactHeaders({ ...(entry.requestHeaders ?? {}) }),
    requestBody: redactBody(entry.requestBody),
  });

/**
 * **Chức năng:** nội dung chép của **tab đang mở** — đúng thứ đang thấy trên màn (đã che), trừ
 * tab cURL chép bản **chạy được** (header thật).
 *
 * **Input:** `entry` · `tab`. **Output:** chuỗi; `''` khi tab không có gì để chép (thân rỗng).
 *
 * @example
 * ```ts
 * copyTextOf(e, 'overview');  // URL
 * copyTextOf(e, 'curl');      // toCurl(e) — có Authorization thật
 * copyTextOf(e, 'request');   // ca biên: GET không thân ⇒ ''
 * ```
 *
 * **Unit test:** `LogDetail.test.tsx` › `copyTextOf` — 4 case: tab tổng quan chép URL · tab
 * header chép bản đã che · tab cURL chép bản thô · thân rỗng ⇒ chuỗi rỗng.
 */
export const copyTextOf = (entry: NetworkEntry, tab: DetailTab): string => {
  switch (tab) {
    case 'overview':
      return entry.url;
    case 'headers':
      return Object.entries(redactHeaders({ ...(entry.requestHeaders ?? {}) }))
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    case 'request':
      return prettyBody(withFullBodies(entry).requestBody) ?? '';
    case 'response':
      return prettyBody(withFullBodies(entry).responseBody) ?? '';
    case 'curl':
      return toCurl(withFullBodies(entry));
  }
};

const Field = ({ label, value, testID }: { label: string; value: string; testID: string }) => {
  const styles = useStyles(stylesOf);
  return (
    <View style={styles.field} testID={testID}>
      <Text variant="captionS_Regular" tone="secondary">
        {label}
      </Text>
      <Text variant="captionS_Medium" tone="primary" selectable>
        {value}
      </Text>
    </View>
  );
};

const Code = ({ text, testID }: { text: string; testID: string }) => {
  const styles = useStyles(stylesOf);
  return (
    <View style={styles.code}>
      <Text variant="captionS_Regular" tone="primary" style={styles.mono} selectable testID={testID}>
        {text}
      </Text>
    </View>
  );
};

export interface LogDetailProps {
  entry: NetworkEntry;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
}

/**
 * **Chức năng:** trang **chi tiết một request** bên trong màn nhật ký — năm tab Tổng quan ·
 * Headers · Request · Response · cURL. Thân request/response xem bằng {@link JsonBody} (cây JSON
 * gập/mở được hoặc văn bản đơn cách tô màu), đọc **bản đầy đủ** từ `full-body-store` nếu còn giữ
 * (20 request gần nhất + request lỗi), rơi về bản 4 KB của nhật ký khi không.
 *
 * Là **trang trong cùng sheet**, không phải sheet thứ hai: sheet chồng sheet là hai lớp nền tối và
 * một cú vuốt đóng nhầm cả hai (cùng lý do `DevToolsGate` giữ một biến `view` chứ không hai cờ).
 * Header của sheet đổi thành nút quay lại — do `LogSheet` lo.
 *
 * 🔴 Mọi thứ **hiện** đều đã che (header bí mật, khoá bí mật trong thân, cả lệnh curl). Chỉ nút
 * **Chép cURL** lấy bản thô, vì một curl mang `<redacted>` thì mọi endpoint cần đăng nhập đều 401.
 *
 * Header **phản hồi** chưa được bắt (tầng thu chỉ đọc header request) — tab Headers nói rõ điều đó
 * thay vì để trống như thể server không trả header nào.
 *
 * **Input:** {@link LogDetailProps}.
 * **Output:** hàng tab + vùng cuộn (`SheetKit.ScrollView` — gorhom: `BottomSheetScrollView`, thuần:
 * `ScrollView` của RN; sheet dùng `contentMode="scroll"`).
 *
 * @example
 * ```tsx
 * <LogDetail entry={networkEntry} tab={tab} onTabChange={setTab} />
 * // Ca biên: request đang chờ ⇒ tab Response hiện "Không có thân", trạng thái "đang chờ".
 * ```
 *
 * **Unit test:** `LogDetail.test.tsx` › `LogDetail` — 8 case: (1) tab tổng quan hiện method,
 * trạng thái, thời lượng, màn · (2) tab Headers che `Authorization` và nói chưa bắt header phản hồi
 * · (3) tab Response hiện tóm tắt + cây JSON · (4) thân rỗng hiện câu "Không có thân" · (4b) có thân mà không bắt được ⇒ nói lý do, không nói
 * "Không có thân" · (4c) request bị huỷ hiện "Đã huỷ" · (5) tab
 * cURL hiện bản đã che · (6) kho có bản đầy đủ ⇒ hiện thân đầy đủ + câu "Đang xem bản đầy đủ".
 */
export const LogDetail = ({ entry, tab, onTabChange }: LogDetailProps) => {
  const t = useDevToolsT();
  const styles = useStyles(stylesOf);
  const { ScrollView } = useSheetKit();

  /*
    Chỉ tính phần của tab đang mở, và giữ lại tới khi dòng hoặc tab đổi: dàn JSON hai thân ~4 KB
    và dựng lệnh curl ở MỖI render là việc thừa — màn nhật ký render lại theo nhịp dòng log mới
    trong lúc trang này đang mở.
  */
  const headers = useMemo(
    () =>
      tab === 'headers'
        ? Object.entries(redactHeaders({ ...(entry.requestHeaders ?? {}) }))
        : [],
    [entry, tab],
  );
  /* Thân đầy đủ nếu kho còn giữ (20 request gần nhất + request lỗi) — xem `full-body-store`. */
  const full = useMemo(() => withFullBodies(entry), [entry]);
  const fromStore = full !== entry;
  const raw = tab === 'request' ? full.requestBody : tab === 'response' ? full.responseBody : undefined;
  const stillTruncated = tab === 'request' ? full.requestTruncated : full.responseTruncated;
  /* Có thân mà không ghi lại ⇒ nói đúng lý do, KHÔNG nói "Không có thân". */
  const skipped =
    tab === 'request' ? entry.requestBodySkipped : tab === 'response' ? entry.responseBodySkipped : undefined;
  const curl = useMemo(() => (tab === 'curl' ? shownCurl(full) : ''), [full, tab]);

  return (
    <>
      <View style={styles.tabs}>
        {TABS.map((key) => (
          <FilterChip
            key={key}
            testID={`devtools-detail-tab-${key}`}
            label={t(TAB_KEY[key])}
            selected={tab === key}
            onPress={() => onTabChange(key)}
          />
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {tab === 'overview' ? (
          <>
            <Field testID="devtools-detail-url" label={t('log.fieldUrl')} value={entry.url} />
            <Field testID="devtools-detail-method" label={t('log.fieldMethod')} value={entry.method} />
            <Field
              testID="devtools-detail-status"
              label={t('log.fieldStatus')}
              value={outcomeOf(entry, t('log.pending'), t('log.cancelled'))}
            />
            {entry.durationMs !== undefined ? (
              <Field
                testID="devtools-detail-duration"
                label={t('log.fieldDuration')}
                value={t('log.durationMs', { ms: entry.durationMs })}
              />
            ) : null}
            <Field
              testID="devtools-detail-time"
              label={t('log.fieldTime')}
              value={formatDateTime(entry.at)}
            />
            {entry.screen ? (
              <Field testID="devtools-detail-screen" label={t('log.fieldScreen')} value={entry.screen} />
            ) : null}
          </>
        ) : null}

        {tab === 'headers' ? (
          <>
            {headers.length > 0 ? (
              <Code
                testID="devtools-detail-headers"
                text={headers.map(([k, v]) => `${k}: ${v}`).join('\n')}
              />
            ) : (
              <Text variant="captionS_Regular" tone="secondary">
                {t('log.noHeaders')}
              </Text>
            )}
            <Text variant="captionS_Regular" tone="secondary">
              {t('log.responseHeadersNote')}
            </Text>
          </>
        ) : null}

        {tab === 'request' || tab === 'response' ? (
          raw ? (
            <>
              {stillTruncated ? (
                <Text variant="captionS_Regular" tone="warning">
                  {t('log.truncatedNote')}
                </Text>
              ) : fromStore ? (
                <Text variant="captionS_Regular" tone="secondary" testID="devtools-detail-full-note">
                  {t('log.fullBodyNote')}
                </Text>
              ) : null}
              {/* `key` theo dòng + tab: đổi dòng/tab là cây dựng lại từ đầu, không mang trạng thái gập cũ. */}
              <JsonBody key={`${entry.id}-${tab}`} raw={raw} testID={`devtools-detail-${tab}`} />
            </>
          ) : (
            <Text
              variant="captionS_Regular"
              tone="secondary"
              testID={skipped ? 'devtools-detail-body-not-captured' : 'devtools-detail-no-body'}
            >
              {skipped ? t(`log.bodyNotCaptured.${skipped}`) : t('log.noBody')}
            </Text>
          )
        ) : null}

        {tab === 'curl' ? (
          <>
            <Code testID="devtools-detail-curl" text={curl} />
            <Text variant="captionS_Regular" tone="secondary">
              {t('log.curlNote')}
            </Text>
          </>
        ) : null}
      </ScrollView>
    </>
  );
};

export interface LogDetailActionsProps {
  entry: NetworkEntry;
  tab: DetailTab;
  /** Id của nút vừa chép xong (`'tab'` · `'curl'`) — nút đó đổi nhãn thành "Đã chép". */
  copied: string | null;
  onCopy: (id: 'tab' | 'curl', text: string) => void;
  onShare: () => void;
}

/** Nhãn nút chép theo tab — nói đúng thứ sẽ vào bộ nhớ tạm. */
const COPY_KEY = {
  overview: 'log.copyUrl',
  headers: 'log.copyHeaders',
  request: 'log.copyRequest',
  response: 'log.copyResponse',
  curl: 'log.copyCurl',
} as const;

/**
 * **Chức năng:** thanh đáy của trang chi tiết — chép thứ của tab đang mở · chép cURL · chia sẻ
 * dòng này. Đặt vào slot `footer` của `Sheet`.
 *
 * Nút chép chính **đổi nhãn theo tab** ("Chép URL", "Chép response"…) thay vì một nút "Chép" chung
 * chung: người bấm phải biết trước thứ gì sẽ vào bộ nhớ tạm, nhất là khi tab cURL chép bản có
 * token thật.
 *
 * ## Một dòng trên máy 360dp (10/10/2026)
 *
 * Đo CoreText, Roboto 15px + kern 0.3 (bậc `sm`, padding 8 mỗi bên): *Chép response* 104,4 ·
 * *Chép cURL* 76,4 · *Chia sẻ dòng này* 119,5 ⇒ cả thanh ≈ 364dp, vượt chỗ ≈ 328dp ⇒ nút Chia sẻ
 * rớt dòng. Nút Chia sẻ dùng nhãn ngắn *Chia sẻ* (51,7) ⇒ ≈ 296dp, vừa một dòng; câu đầy đủ "Chia
 * sẻ dòng này" vẫn là nhãn a11y. Nhãn dài nhất của nút chính là *Chép response* — các tab khác ngắn
 * hơn. `flexWrap` còn lại chỉ là lưới an toàn khi phóng chữ hệ thống.
 *
 * **Input:** {@link LogDetailActionsProps}. **Output:** một hàng nút trên một dòng; nút chép khoá
 * khi tab không có gì để chép.
 *
 * @example
 * ```tsx
 * <LogDetailActions entry={e} tab="response" copied={null} onCopy={copy} onShare={share} />
 * // Ca biên: tab="curl" ⇒ không vẽ nút "Chép cURL" thứ hai.
 * ```
 *
 * **Unit test:** `LogDetail.test.tsx` › `LogDetailActions` — 3 case: nhãn nút chính đổi theo tab ·
 * thân rỗng ⇒ nút chép khoá · tab cURL không vẽ nút cURL thứ hai.
 */
export const LogDetailActions = ({
  entry,
  tab,
  copied,
  onCopy,
  onShare,
}: LogDetailActionsProps) => {
  const t = useDevToolsT();
  const styles = useStyles(stylesOf);
  const tabText = useMemo(() => copyTextOf(entry, tab), [entry, tab]);

  return (
    <View style={styles.actions}>
      <Button
        testID="devtools-detail-copy"
        label={copied === 'tab' ? t('log.copied') : t(COPY_KEY[tab])}
        size="sm"
        variant="primary"
        disabled={!tabText}
        onPress={() => onCopy('tab', tabText)}
      />
      {tab !== 'curl' ? (
        <Button
          testID="devtools-detail-copy-curl"
          label={copied === 'curl' ? t('log.copied') : t('log.copyCurl')}
          size="sm"
          variant="secondary"
          onPress={() => onCopy('curl', toCurl(withFullBodies(entry)))}
        />
      ) : null}
      <Button
        testID="devtools-detail-share"
        label={t('log.share')}
        accessibilityLabel={t('log.shareEntry')}
        size="sm"
        variant="tertiary"
        onPress={onShare}
      />
    </View>
  );
};
