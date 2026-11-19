import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BackHandler, Pressable, Share, View } from 'react-native';
import { Button } from '../ui/Button';
import { useSheetKit, type SheetListHandle } from '../ui/sheet-kit';
import { Text } from '../ui/Text';
import { Icon } from '../ui/Icon';
import { useStyles } from '../ui/use-styles';
import type { DevToolsTheme } from '../ui/theme';
import { actionBuffer } from '../capture/action-buffer';
import { prettyBody } from '../capture/format-error-report';
import { formatDateTime, formatEntry, formatLog, formatTime } from '../capture/format-log';
import { fullBodies, withFullBodies } from '../capture/full-body-store';
import { logBuffer } from '../capture/log-buffer';
import type {
  LogEntry,
  LogFilter,
  LogStatusFilter,
  NetworkEntry,
} from '../capture/log-entry';
import { countErrors, filterLog, isAbortedEntry, isSlowEntry } from '../capture/log-query';
import type { StoredSession } from '../capture/log-session';
import { markUser } from '../capture/markers';
import type { DevToolsSessionInfo } from '../capture/session-info';
import { getCaptureStartedAt } from '../capture/start-capture';
import { toCurl } from '../capture/to-curl';
import type { DevToolsExportFile } from '../gate/devtools-props';
import { useDevToolsT } from '../i18n';
import { copyText } from './copy-text';
import { LogActionBar } from './LogActionBar';
import { LogDetail, LogDetailActions, type DetailTab } from './LogDetail';
import { LogRow, type LogRowAction } from './LogRow';
import { LogSearchField } from './LogSearchField';
import { LogToolbar } from './LogToolbar';
import { useAiCopy } from './use-ai-copy';
import { LIVE_REFRESH_MS, useLogEntries } from './use-log-entries';
import { useLogExport } from './use-log-export';
import { usePausableEntries } from './use-pausable-entries';

/** Dấu "Đã chép" ở lại bao lâu. Đủ để mắt bắt được, ngắn hơn một nhịp cuộn. */
const COPIED_HINT_MS = 1500;

/**
 * Số "màn" FlatList dựng sẵn quanh vùng đang thấy. Mặc định 21 — với hàng cao ~50dp là gần hết 300
 * dòng của buffer bị dựng (ở entry `.` mỗi dòng một `ReanimatedSwipeable`). 7 = ba màn trên, ba màn dưới: cuộn
 * nhanh vẫn không lộ khoảng trắng, mà số hàng phải giữ chỉ còn khoảng một phần ba.
 */
const LIST_WINDOW_SIZE = 7;
/** Đủ phủ một màn máy cao khi mở sheet, để lượt dựng đầu không phải vá thêm một mẻ. */
const LIST_INITIAL_ROWS = 15;

/**
 * Nhãn nguồn trong đầu file khi xuất **phiên trước** — dữ liệu trong file (tiếng Anh kỹ thuật,
 * trung lập ngôn ngữ như phần còn lại của file), không phải chữ trên màn.
 */
const ARCHIVE_SOURCE = 'previous session'; // nhãn trong nội dung file xuất, không hiện trên màn

/** ⚠️ Hằng module-scope — xem ghi chú cùng tên ở `DevToolsRow.tsx`. */
const stylesOf = (t: DevToolsTheme) => ({
  divider: {
    height: t.borderWidth.thin,
    backgroundColor: t.colors.border.subtle,
  },
  empty: {
    padding: t.spacing.md,
    alignItems: 'center' as const,
    gap: t.spacing.sm,
  },
  /** Dòng chỉ đường cho cử chỉ — nằm giữa thanh lọc và danh sách. */
  swipeHint: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing['2xs'],
  },
  /** Dải "đã tạm dừng" — chạm để chạy tiếp. */
  paused: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    backgroundColor: t.colors.background.surfaceAlt,
  },
  /** Bắt buộc: `contentMode="scroll"` cho vùng nội dung chiều cao có chặn, list phải ăn hết phần còn lại — không có `flex: 1` thì list cao bằng nội dung và mất luôn khả năng cuộn. */
  list: { flex: 1 },
});

/**
 * Kẻ giữa hai dòng. Ở module scope, **không** viết `() => <View/>` thẳng trong JSX: đó là một
 * *kiểu component mới* mỗi lần render ⇒ ô của FlatList (`PureComponent`) thấy prop đổi và render
 * lại **mọi** ô đang dựng, còn các đường kẻ thì bị gỡ ra dựng lại.
 */
const LogSeparator = () => {
  const styles = useStyles(stylesOf);
  return <View style={styles.divider} />;
};

export interface LogSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** Dòng phụ môi trường (`DevToolsConfig.subtitle`) — đi vào đầu file báo cáo lỗi. */
  subtitle?: string;
  /** Đường ra của nút **Xuất lỗi** (`DevToolsConfig.exportFile`). Vắng ⇒ `Share.share` text. */
  exportFile?: (file: DevToolsExportFile) => Promise<void>;
  /** Thông tin bản build · máy · user (`DevToolsConfig.sessionInfo`) — vào đầu file xuất. */
  sessionInfo?: () => DevToolsSessionInfo;
  /**
   * Có ⇒ màn xem **phiên đã lưu** (chỉ đọc) thay vì nhật ký sống: không tạm dừng, không đánh
   * dấu, không xoá — chỉ tìm, lọc, xem chi tiết, xuất.
   */
  archive?: StoredSession | null;
}

/** Tiêu đề trang chi tiết: `POST · 500` — dữ liệu, không phải câu (trừ "đang chờ"/"Đã huỷ" đã dịch). */
const detailTitle = (entry: NetworkEntry, pending: string, cancelled: string) =>
  [
    entry.method,
    entry.status ?? (isAbortedEntry(entry) ? cancelled : entry.error) ?? pending,
  ].join(' · ');

/**
 * **Chức năng:** màn xem nhật ký — danh sách console + HTTP + mốc đã bắt; **tìm**, **lọc** theo
 * loại và kết cục (lỗi / không lỗi / chậm); **tạm dừng** để đọc; **đánh dấu** trước khi tái
 * hiện; chạm dòng mạng để mở **trang chi tiết**; giữ lâu một dòng để mở **dải thao tác**; chia
 * sẻ cả khối; **xuất file** mọi dòng lỗi. Cùng màn này xem được **phiên trước** (prop `archive`).
 *
 * ## Tìm + lọc: ba trục độc lập, một hàm thuần
 *
 * Ô tìm · loại · kết cục đều đi qua `filterLog` — logic ở tầng thuần để file xuất, bộ đếm và vòng
 * giữ lỗi của buffer dùng **cùng** định nghĩa "lỗi". Cả ba đi qua `useDeferredValue`: ô tìm và
 * chip đổi ngay theo ngón tay, còn phép lọc (quét thân request tới 4000 ký tự) và lượt dựng lại
 * danh sách chạy ở độ ưu tiên thấp — chip sáng lên trong khung hình đầu, không đợi danh sách.
 *
 * ## Hiệu năng — vì sao nhiều `useMemo`/`useCallback` ở đây
 *
 * Ngày 24/9/2026 người thử báo "bấm nút chậm"; soát mã ra bốn nguồn (chưa đo từng nguồn tốn bao
 * nhiêu ms trên máy), bốn chốt:
 *
 * | Nguồn | Chốt |
 * |---|---|
 * | `Sheet` (bộ gorhom) dùng `footer` · `leftAction` · `rightAction` làm deps của hàm vẽ footer/header, mà gorhom render hàm đó như **kiểu component** ⇒ phần tử mới = gỡ cả footer/header ra dựng lại (nút đang bị đè cũng mất, cú chạm rơi) | ba phần tử đó `useMemo`, mọi handler bên trong `useCallback` |
 * | Mọi dòng log mới làm màn render | `useLogEntries(…, LIVE_REFRESH_MS)` — gộp tối đa 4 lần/giây |
 * | Mỗi lượt render làm render lại mọi hàng | separator ở module scope, `LogRow` có `memo` + callback nhận `entry`, `windowSize` 7 |
 * | Chia sẻ/Xuất định dạng cả nhật ký ngay trong lượt bấm | nhường một khung hình để vòng quay kịp vẽ |
 *
 * Thêm prop mới cho footer/header thì giữ nó **ổn định** — một closure viết thẳng trong JSX là đủ
 * để mọi chốt ở hàng đầu mất tác dụng.
 *
 * ## Trang chi tiết là trang TRONG sheet
 *
 * `detail` khác `null` ⇒ header đổi sang nút quay lại, thân đổi sang `LogDetail`, footer đổi sang
 * `LogDetailActions`. Không mở sheet thứ hai (hai lớp nền tối, vuốt đóng nhầm cả hai).
 *
 * Nút Back cứng của Android lùi **từng cấp**, giống nút ‹ / ✕ trên header: trang chi tiết ⇒ về
 * danh sách; danh sách ⇒ đóng sheet (về app, không về panel — như nút ✕). Cấp "đóng sheet" do
 * `Sheet`/`PlainSheet` lo (`useSheetBackHandler`); cấp "về danh sách" đăng ký ở đây, **sau** handler
 * của sheet nên được gọi trước, và chỉ khi sheet đang `visible` — đóng sheet giữa trang chi tiết
 * thì `detail` còn nằm trong state, đăng ký vô điều kiện là nuốt mất một lần Back của app.
 *
 * ## Xuất lỗi ≠ Chia sẻ
 *
 * | Nút | Lấy dòng nào | Dạng | Đích |
 * |---|---|---|---|
 * | Chia sẻ (header) | **mọi** dòng đang giữ | text một dòng/mục | dán vào chat |
 * | Xuất lỗi (đáy) | **mọi dòng lỗi** kể cả lỗi đã rời vòng chính, bất kể đang lọc/tạm dừng | file `.txt` có header + JSON dàn đẹp | gửi BE |
 * | Chép cho AI (đáy, **chỉ phiên trước**) | lỗi, request lỗi/chậm, bước, console của phiên đó, có trần kích thước | Markdown vào bộ nhớ tạm (`useAiCopy`) | dán vào agent lập trình |
 *
 * Cả ba đều **che** dữ liệu nhạy cảm (bảng chính sách ở đầu `redact.ts`). Phiên đang chạy chép cho AI
 * từ hàng của panel: chân màn sống đã kín một dòng trên máy 360dp (`LogActionBar`).
 *
 * ## Vì sao "chia sẻ" chứ không phải "chép"
 *
 * App có thể chặn chụp màn hình (FLAG_SECURE trên Android, chặn screenshot trên iOS) nên QA
 * *không chụp màn hình được* — `Share` là đường duy nhất đưa nội dung này sang chat/ticket mà
 * không phải gõ tay.
 *
 * ## Bộ sheet
 *
 * `Sheet` · danh sách lấy từ `useSheetKit()`: entry `.` ⇒ gorhom (`BottomSheetFlatList`, hàng vuốt
 * để chép), entry `./plain` ⇒ RN thuần (`FlatList`, hàng không vuốt). Dòng gợi ý cử chỉ đổi theo
 * bộ: có `SwipeRow` ⇒ "vuốt phải để chép · giữ lâu…", không ⇒ "giữ lâu để chép · chia sẻ".
 *
 * ## Bàn phím
 *
 * Không khai gì — `SearchField` trong `LogSearchField` dùng ô nhập của bộ sheet (gorhom: tự đăng ký
 * với sheet; thuần: `PlainSheet` nghe `Keyboard`), sheet `fullScreenSafe` nên bản gorhom tự chọn
 * `extend`. List khai `keyboardShouldPersistTaps="handled"`.
 *
 * **Input:** {@link LogSheetProps}.
 * **Output:** sheet `fullScreenSafe` — nhật ký cần chiều cao tối đa, nhưng vẫn chừa status
 * bar để đọc được giờ/pin khi đang đối chiếu thời điểm lỗi.
 *
 * @example
 * ```tsx
 * <LogSheet visible={view === 'log'} onDismiss={close} subtitle="UAT · 1.0.2"
 *   exportFile={config.exportFile} sessionInfo={config.sessionInfo} />
 * <LogSheet visible={view === 'previous'} onDismiss={close} archive={previous} />
 * // Ca biên: chưa gọi startCapture ⇒ danh sách rỗng, hiện dòng "chưa bắt được dòng nào".
 * // Ca biên: có dòng nhưng bộ lọc loại hết ⇒ câu "Không có dòng nào khớp bộ lọc" + nút "Bỏ lọc".
 * ```
 *
 * **Unit test:** `LogSheet.test.tsx` › `LogSheet` + 7 describe `LogSheet — …` (tìm kiếm · lọc
 * lỗi · xuất lỗi · tạm dừng & đánh dấu · chi tiết & thao tác · phiên trước · nút Back & bộ sheet) —
 * 27 case: buffer rỗng
 * hiện dòng trống ·
 * vẽ đủ N dòng · lọc `console` bỏ dòng mạng · lọc `network` bỏ dòng console · chạm dòng console
 * mở hết chữ, chạm lần nữa đóng · nút xoá làm rỗng buffer · nút chia sẻ gọi `Share.share` với
 * khối text của `formatLog` · gõ chữ tìm lọc theo URL · lọc hết ⇒ câu `noMatch` + "Bỏ lọc" · chip
 * "Chỉ lỗi" chỉ giữ dòng lỗi và chạm lại thì bỏ lọc · chip "Ẩn lỗi" · chip "Chậm ≥3s" · bộ đếm
 * "Hiện N/M" · nút xuất khoá khi 0 lỗi · nút xuất gọi `exportFile` với file chỉ gồm dòng lỗi · tạm dừng
 * giữ danh sách đứng yên và dải báo số dòng mới · chạm dải thì chạy tiếp · nút đánh dấu ghi mốc ·
 * chạm dòng mạng mở trang chi tiết, nút quay lại về danh sách · giữ lâu mở dải thao tác, chép cURL
 * gọi bộ nhớ tạm với lệnh thô · nhật ký sống không có nút Chép cho AI · phiên trước có nút Chép cho
 * AI chép khối của phiên đó (nguồn, build, thao tác đã lưu) · phiên trước chỉ còn nút Xuất và Chép cho
 * AI, xuất ghi nguồn `previous session` ·
 * phiên trước hiện dòng của phiên đó, không phải nhật ký sống · Back ở trang chi tiết về danh sách,
 * Back lần nữa đóng sheet · đóng sheet giữa trang chi tiết thì Back không còn bị giữ · bộ không có
 * `SwipeRow` ⇒ gợi ý giữ lâu, không có nút Chép vuốt.
 */
export const LogSheet = ({
  visible,
  onDismiss,
  subtitle,
  exportFile,
  sessionInfo,
  archive,
}: LogSheetProps) => {
  const t = useDevToolsT();
  const styles = useStyles(stylesOf);
  const { Sheet, FlatList, SwipeRow } = useSheetKit();
  const listRef = useRef<SheetListHandle>(null);

  const [kind, setKind] = useState<LogFilter>('all');
  const [status, setStatus] = useState<LogStatusFilter>('all');
  const [query, setQuery] = useState('');
  /* Ô tìm và chip cập nhật ngay theo ngón tay; phép lọc (quét cả thân request) và lượt dựng lại
     danh sách chạy ở độ ưu tiên thấp. */
  const deferredQuery = useDeferredValue(query);
  const deferredKind = useDeferredValue(kind);
  const deferredStatus = useDeferredValue(status);
  const [openId, setOpenId] = useState<number | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ id: number; tab: DetailTab } | null>(null);
  /** Khoá của thứ vừa chép: `row-<id>` · `tab` · `curl`. */
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [sharing, setSharing] = useState(false);
  const sharingRef = useRef(false);
  const shareTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      if (shareTimer.current) clearTimeout(shareTimer.current);
    },
    [],
  );

  const isArchive = Boolean(archive);
  /* Phiên trước không đăng ký buffer sống: không có lý do gì để render lại theo từng request.
     Nhật ký sống thì gộp nhịp: một loạt dòng trong 250 ms chỉ làm màn render một lần. */
  const live = useLogEntries(visible && !isArchive, LIVE_REFRESH_MS);
  const {
    entries: pausedOrLive,
    paused,
    pausedAt,
    fresh,
    toggle: togglePause,
    resume: resumeLive,
  } = usePausableEntries(live);
  const base = archive ? archive.entries : pausedOrLive;

  /* Mới nhất lên đầu: mở nhật ký ra là để xem thứ VỪA xảy ra, không phải cuộn xuống đáy. */
  const shown = useMemo(
    () =>
      filterLog(base, {
        kind: deferredKind,
        status: deferredStatus,
        text: deferredQuery,
      })
        .slice()
        .reverse(),
    [base, deferredKind, deferredStatus, deferredQuery],
  );
  const shownCount = useMemo(
    () => shown.filter((e) => e.kind !== 'marker').length,
    [shown],
  );
  const slowCount = useMemo(
    () => base.reduce((n, e) => (isSlowEntry(e) ? n + 1 : n), 0),
    [base],
  );
  const errorCount = useMemo(() => countErrors(base), [base]);
  const total = useMemo(() => base.filter((e) => e.kind !== 'marker').length, [base]);

  /* Xuất luôn lấy nhật ký SỐNG (hoặc cả phiên trước) — tạm dừng chỉ dừng màn, không dừng file.
     Đọc lúc bấm qua `getEntries`, nên `exporter.run` không đổi theo từng dòng log. */
  const exportSource = archive ? archive.entries : live;
  const canExport = useMemo(() => countErrors(exportSource) > 0, [exportSource]);
  const getEntries = useMemo(
    () => (archive ? () => archive.entries : logBuffer.snapshot),
    [archive],
  );
  const exporter = useLogExport({
    getEntries,
    build: archive ? archive.build : subtitle,
    exportFile,
    sessionInfo: archive ? undefined : sessionInfo,
    sessionStartedAt: archive ? archive.startedAt : getCaptureStartedAt(),
    source: archive ? ARCHIVE_SOURCE : undefined,
  });
  /* Nút Chép cho AI chỉ vẽ ở phiên trước (xem `LogActionBar`); hook vẫn gọi vô điều kiện (luật hook). */
  const getActions = useMemo(
    () => (archive ? () => archive.actions ?? [] : actionBuffer.snapshot),
    [archive],
  );
  const aiCopy = useAiCopy({
    getEntries,
    getActions,
    build: archive ? archive.build : subtitle,
    sessionInfo: archive ? undefined : sessionInfo,
    sessionStartedAt: archive ? archive.startedAt : getCaptureStartedAt(),
    source: archive ? ARCHIVE_SOURCE : undefined,
  });

  const detailEntry = useMemo(() => {
    if (!detail) return undefined;
    const found = base.find((e) => e.id === detail.id);
    return found?.kind === 'network' ? found : undefined;
  }, [base, detail]);

  /* Back cứng Android ở trang chi tiết ⇒ về danh sách. Đăng ký SAU handler của sheet
     (`useSheetBackHandler`, effect của con chạy trước effect của cha) nên được gọi TRƯỚC —
     BackHandler gọi ngược thứ tự đăng ký — và trả `true` để sheet không đóng. Chỉ khi `visible`:
     sheet đã đóng mà `detail` còn trong state thì không được giữ Back của app. */
  useEffect(() => {
    if (!visible || !detailEntry) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setDetail(null);
      return true;
    });
    return () => sub.remove();
  }, [visible, detailEntry]);

  const flashCopied = useCallback((key: string) => {
    setCopied(key);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), COPIED_HINT_MS);
  }, []);

  const resetFilters = useCallback(() => {
    setKind('all');
    setStatus('all');
    setQuery('');
  }, []);

  const resume = useCallback(() => {
    resumeLive();
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [resumeLive]);

  const clearLog = useCallback(() => {
    logBuffer.clear();
    fullBodies.clear();
    resumeLive();
    setOpenId(null);
    setMenuId(null);
  }, [resumeLive]);

  /* Bản `base` đã commit gần nhất — `share` đọc qua ref để giữ nguyên danh tính (nó nằm trong
     phần tử header, header `useMemo` theo nó). */
  const baseRef = useRef(base);
  useEffect(() => {
    baseRef.current = base;
  }, [base]);

  /*
    Định dạng cả nhật ký (dàn JSON mọi thân request) là việc nặng. Bật vòng quay trên nút TRƯỚC,
    nhường một khung hình cho nó kịp vẽ, rồi mới định dạng — nếu không nút đứng im tới khi khay
    chia sẻ bật lên, trông như chưa nhận cú chạm. Chốt bấm đúp bằng ref, cùng lý do `useLogExport`.
  */
  const share = useCallback(() => {
    if (sharingRef.current) return;
    sharingRef.current = true;
    setSharing(true);
    shareTimer.current = setTimeout(() => {
      let text = '';
      try {
        text = formatLog(baseRef.current);
      } finally {
        sharingRef.current = false;
        setSharing(false);
      }
      if (text) void Share.share({ message: text });
    }, 0);
  }, []);

  /*
    Dòng mạng chép ra **lệnh curl chạy được** (kể cả header `Authorization` thật — xem bảng
    chính sách ở đầu `redact.ts`); dòng console chép nguyên dòng text. Hai loại mục có hai
    thứ hữu ích khác nhau, ép chung một định dạng thì một bên vô dụng.
  */
  const copyRow = useCallback(
    (entry: LogEntry, text?: string) => {
      const body = text ?? (entry.kind === 'network' ? toCurl(withFullBodies(entry)) : formatEntry(entry));
      if (copyText(body)) flashCopied(`row-${entry.id}`);
    },
    [flashCopied],
  );

  /** Dải thao tác của cú giữ lâu — nhãn nói đúng thứ sẽ vào bộ nhớ tạm. */
  const menuFor = useCallback(
    (entry: LogEntry): LogRowAction[] => {
      const done = (fn: () => void) => () => {
        setMenuId(null);
        fn();
      };
      const shareEntry: LogRowAction = {
        id: 'share',
        label: t('log.shareEntry'),
        onPress: done(() => void Share.share({ message: formatEntry(entry) })),
      };
      if (entry.kind !== 'network') {
        return [
          { id: 'line', label: t('log.copyLine'), onPress: done(() => copyRow(entry)) },
          shareEntry,
        ];
      }
      const response = prettyBody(withFullBodies(entry).responseBody);
      return [
        { id: 'curl', label: t('log.copyCurl'), onPress: done(() => copyRow(entry)) },
        { id: 'url', label: t('log.copyUrl'), onPress: done(() => copyRow(entry, entry.url)) },
        ...(response
          ? [
              {
                id: 'response',
                label: t('log.copyResponse'),
                onPress: done(() => copyRow(entry, response)),
              },
            ]
          : []),
        shareEntry,
      ];
    },
    [copyRow, t],
  );

  const pressRow = useCallback((entry: LogEntry) => {
    setMenuId(null);
    if (entry.kind === 'network') setDetail({ id: entry.id, tab: 'overview' });
    else setOpenId((cur) => (cur === entry.id ? null : entry.id));
  }, []);

  const toggleMenu = useCallback(
    (entry: LogEntry) => setMenuId((cur) => (cur === entry.id ? null : entry.id)),
    [],
  );

  /*
    Ba callback của hàng là MỘT hàm cho mọi hàng (hàng tự truyền `entry` vào) — không viết
    `() => pressRow(item)` ở đây: closure mới mỗi lượt là prop mới, `memo` của `LogRow` vô dụng.
    `renderItem` vẫn đổi khi `openId`/`copied`/`menuId` đổi, nhưng khi đó chỉ 1–2 hàng có prop
    khác — các hàng còn lại dừng ở `memo`.
  */
  const renderItem = useCallback(
    ({ item }: { item: LogEntry }) => (
      <LogRow
        testID={`devtools-log-${item.id}`}
        entry={item}
        expanded={openId === item.id}
        copied={copied === `row-${item.id}`}
        menu={menuId === item.id ? menuFor(item) : undefined}
        onPress={item.kind === 'marker' ? undefined : pressRow}
        onLongPress={toggleMenu}
        onCopy={copyRow}
      />
    ),
    [openId, copied, menuId, menuFor, pressRow, toggleMenu, copyRow],
  );

  const back = useCallback(() => setDetail(null), []);
  const changeTab = useCallback(
    (tab: DetailTab) => setDetail((cur) => (cur ? { ...cur, tab } : cur)),
    [],
  );
  const markNow = useCallback(() => {
    markUser();
  }, []);
  const copyDetail = useCallback(
    (id: 'tab' | 'curl', text: string) => {
      if (copyText(text)) flashCopied(id);
    },
    [flashCopied],
  );
  const shareDetail = useCallback(() => {
    if (detailEntry) void Share.share({ message: formatEntry(detailEntry) });
  }, [detailEntry]);

  /*
    🔴 MỘT `Sheet` cho cả hai trang, chỉ props + children đổi theo `onDetail`. Hai nhánh
    `return` với hai modal riêng thì React tháo modal này dựng modal kia ⇒ sheet đóng rồi mở lại
    (hai hiệu ứng trượt) mỗi lần chạm một dòng.
  */
  const onDetail = Boolean(detail && detailEntry);
  const detailTab = detail?.tab;
  const detailCopied = copied === 'tab' || copied === 'curl' ? copied : null;

  /*
    Ba phần tử dưới đây đi vào hàm vẽ header/footer của `Sheet`, mà gorhom render hàm
    đó như một KIỂU component: phần tử mới ⇒ gỡ cả header/footer ra dựng lại (nút đang bị ngón tay
    đè cũng bị gỡ, cú chạm rơi). Nên cả ba `useMemo`, và mọi thứ chúng nhận phải ổn định.
  */
  const closeButton = useMemo(
    () => (
      <Button
        testID="devtools-log-dismiss"
        label={t('common.close')}
        iconOnly
        variant="tertiary"
        onPress={onDismiss}
        leftIcon={({ size }) => <Icon name="close" size={size} />}
      />
    ),
    [t, onDismiss],
  );

  const leftAction = useMemo(
    () =>
      onDetail ? (
        <Button
          testID="devtools-detail-back"
          label={t('log.back')}
          iconOnly
          variant="tertiary"
          onPress={back}
          leftIcon={({ size }) => <Icon name="back" size={size} />}
        />
      ) : (
        closeButton
      ),
    [onDetail, t, back, closeButton],
  );

  const rightAction = useMemo(
    () =>
      onDetail ? (
        closeButton
      ) : (
        <Button
          testID="devtools-log-share"
          label={t('log.share')}
          variant="tertiary"
          loading={sharing}
          onPress={share}
        />
      ),
    [onDetail, closeButton, t, sharing, share],
  );

  const footer = useMemo(
    () =>
      detailEntry && detailTab ? (
        <LogDetailActions
          entry={detailEntry}
          tab={detailTab}
          copied={detailCopied}
          onCopy={copyDetail}
          onShare={shareDetail}
        />
      ) : (
        <LogActionBar
          mode={isArchive ? 'archive' : 'live'}
          paused={paused}
          onTogglePause={paused ? resume : togglePause}
          onMark={markNow}
          canExport={canExport}
          exportState={exporter.state}
          onExport={exporter.run}
          onClear={clearLog}
          onCopyAi={isArchive ? aiCopy.run : undefined}
          aiState={aiCopy.state}
        />
      ),
    [
      detailEntry,
      detailTab,
      detailCopied,
      copyDetail,
      shareDetail,
      isArchive,
      paused,
      resume,
      togglePause,
      markNow,
      canExport,
      exporter.state,
      exporter.run,
      clearLog,
      aiCopy.run,
      aiCopy.state,
    ],
  );

  return (
    <Sheet
      testID="devtools-log-sheet"
      visible={visible}
      onDismiss={onDismiss}
      title={
        detail && detailEntry
          ? detailTitle(detailEntry, t('log.pending'), t('log.cancelled'))
          : archive
            ? t('log.previousTitle')
            : t('log.title')
      }
      description={
        archive && !onDetail
          ? t(archive.fatal ? 'log.previousFatal' : 'log.previousSaved', {
              time: formatDateTime(archive.savedAt),
            })
          : undefined
      }
      size="fullScreenSafe"
      contentMode="scroll"
      leftAction={leftAction}
      rightAction={rightAction}
      footer={footer}
    >
      {detailEntry && detailTab ? (
        <LogDetail entry={detailEntry} tab={detailTab} onTabChange={changeTab} />
      ) : (
        <>
          <View>
            <LogSearchField value={query} onChangeText={setQuery} />
            <LogToolbar
              kind={kind}
              onKindChange={setKind}
              status={status}
              onStatusChange={setStatus}
              errorCount={errorCount}
              slowCount={slowCount}
              shown={shownCount}
              total={total}
              exportState={exporter.state}
            />
            <View style={styles.divider} />
            {paused && !archive ? (
              <Pressable
                testID="devtools-log-paused"
                accessibilityRole="button"
                onPress={resume}
                style={styles.paused}
              >
                <Text variant="captionS_Medium" tone="primary">
                  {t('log.pausedAt', { time: formatTime(pausedAt ?? Date.now()) })}
                </Text>
                {fresh > 0 ? (
                  <Text variant="captionS_Medium" tone="brand" testID="devtools-log-fresh">
                    {t('log.pausedFresh', { fresh })}
                  </Text>
                ) : null}
              </Pressable>
            ) : null}
            {/* Chỉ chỉ đường khi có thứ để vuốt: danh sách rỗng đã có câu của riêng nó. */}
            {shown.length > 0 && !paused ? (
              <View style={styles.swipeHint}>
                {/*
                  `secondary` chứ không phải `tertiary`: đây là chữ PHẢI đọc được — nó là thứ duy
                  nhất nói ra hai cử chỉ ẩn. Một số bộ token có bậc `tertiary` thiếu contrast
                  (đo với bảng màu mặc định lúc viết: 2.09:1 trên nền light, cần 4.5).
                */}
                <Text variant="captionS_Regular" tone="secondary" testID="devtools-log-hint">
                  {t(SwipeRow ? 'log.swipeHint' : 'log.longPressHint')}
                </Text>
              </View>
            ) : null}
          </View>

          <FlatList
            ref={listRef}
            style={styles.list}
            data={shown}
            keyExtractor={(item: LogEntry) => String(item.id)}
            renderItem={renderItem}
            windowSize={LIST_WINDOW_SIZE}
            initialNumToRender={LIST_INITIAL_ROWS}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ItemSeparatorComponent={LogSeparator}
            ListEmptyComponent={
              base.length > 0 ? (
                <View style={styles.empty} testID="devtools-log-no-match">
                  <Text variant="captionS_Regular" tone="secondary">
                    {t('log.noMatch')}
                  </Text>
                  <Button
                    testID="devtools-log-reset-filters"
                    label={t('log.resetFilters')}
                    size="sm"
                    variant="tertiary"
                    onPress={resetFilters}
                  />
                </View>
              ) : (
                <View style={styles.empty}>
                  <Text variant="captionS_Regular" tone="tertiary">
                    {t('log.empty')}
                  </Text>
                </View>
              )
            }
          />
        </>
      )}
    </Sheet>
  );
};
