import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Linking } from 'react-native';
import { useDevToolsT } from '../../i18n';
import type { DevToolsLocale } from '../../i18n/types';
import { copyText } from '../../panel/copy-text';
import { Button } from '../../ui/Button';
import { useDevToolsUi } from '../../ui/context';
import { Icon } from '../../ui/Icon';
import { useSheetKit } from '../../ui/sheet-kit';
import { Text } from '../../ui/Text';
import type { DevToolsTheme } from '../../ui/theme';
import { useSheetBackHandler } from '../../ui/use-sheet-back-handler';
import { useStyles } from '../../ui/use-styles';
import type { ConnectionStore, StoredConnection } from '../connections/connection-store';
import type { ConnectorType } from '../connectors/types';
import type { ReportController, ReportDraftPatch } from '../report-controller';
import { isCommitted, queueCounts, type QueuedReport, type SendQueue } from '../send-queue';
import type { ReportStep } from '../steps';
import { ConnectionEditor } from './ConnectionEditor';
import { ConnectionPicker, type ConnectionChoice } from './ConnectionPicker';
import { ConnectionsPage } from './ConnectionsPage';
import { QueuePage } from './QueuePage';
import { ReportForm, ReportFormFooter } from './ReportForm';
import { SendStatus } from './SendStatus';
import { StepsEditor, stepsNote } from './StepsEditor';

/** Dấu "Đã chép" trên nút Chép link — cùng nhịp với dấu chép ở màn nhật ký. */
const COPIED_HINT_MS = 1500;
/** "Huỷ nháp" / "Bỏ bản báo" chờ lần bấm thứ hai bao lâu rồi tự về như cũ. */
const DISCARD_ARM_MS = 3000;

/** Trang có thân đặt trong vùng cuộn của chính sheet này. */
type BodyPage = 'form' | 'steps' | 'pick' | 'status' | 'queue';
/**
 * Trang trong sheet báo bug. Một `Sheet` cho mọi trang — đổi trang không mở sheet thứ hai. Hai trang
 * kết nối là thân trang có vùng cuộn riêng (`ConnectionsPage`, `ConnectionEditor`).
 */
type Page = BodyPage | 'connections' | 'connection-edit';
/** Trang Kết nối mở từ đâu — Quay lại của nó về đúng chỗ đó. */
type ConnectionsFrom = 'form' | 'pick' | 'status';
/**
 * Trang kết quả đang hiện bản nào, mở từ đâu: `send` — bản vừa bấm Gửi; `queue` — bản QA chạm ở
 * trang Hàng đợi (‹ về lại Hàng đợi).
 */
type StatusFrom = 'send' | 'queue';

/** Câu báo kết quả chia sẻ gần nhất (gate giữ tới khi đóng sheet). */
export type ReportShareNotice = 'image-dropped' | 'share-failed';

/** Form thêm/sửa kết nối đang mở. `seq` là `key` của form — mỗi lần mở là một form mới. */
interface Editing {
  readonly type: ConnectorType;
  /** Có ⇒ sửa kết nối này; vắng ⇒ thêm mới. */
  readonly initial?: StoredConnection;
  readonly seq: number;
}

const SCROLL_ID: Record<BodyPage, string> = {
  form: 'devtools-report-form',
  steps: 'devtools-report-steps',
  pick: 'devtools-report-picker',
  status: 'devtools-report-status',
  queue: 'devtools-report-queue',
};

const FULL = { image: true, files: true } as const;
const NO_ITEMS: readonly QueuedReport[] = [];
const noSubscribe = () => () => undefined;
const noItems = () => NO_ITEMS;

/** ⚠️ Hằng module-scope — `useStyles` nhớ theo tham chiếu factory. */
const stylesOf = (t: DevToolsTheme) => ({
  /** `contentMode="scroll"`: vùng nội dung có chiều cao chặn, vùng cuộn ăn hết phần còn lại. */
  scroll: { flex: 1 },
  content: { padding: t.spacing.md, paddingBottom: t.spacing.lg, gap: t.spacing.sm },
});

/** Những gì gate đưa cho màn báo bug. */
export interface ReportSheetProps {
  visible: boolean;
  /** Người dùng đóng sheet (vuốt · nền · Back · ✕) ⇒ gate về app; nháp vẫn còn. */
  onDismiss: () => void;
  /**
   * Sheet đã rời hẳn màn hình — nối thẳng vào `SheetProps.onClosed` (R29). Gate dựa vào nó để chỉ
   * chụp lại màn **sau khi** sheet không còn che (nút Chụp lại).
   */
  onClosed: () => void;
  controller: ReportController;
  /** `null` khi app không cấp `secureStore`. */
  queue: SendQueue | null;
  /** `null` khi app không cấp `secureStore`. */
  connections: ConnectionStore | null;
  /** Loại kết nối đang có (có sẵn + của app) — tên loại và `capabilities` của kết nối đã lưu. */
  connectorTypes: readonly ConnectorType[];
  /**
   * Nút Chụp lại: gate đóng sheet, đợi `onClosed`, chụp, `controller.retake(ảnh)`, mở lại form.
   * Cũng là đường **"Báo bug khác"** sau khi hàng đợi đã nhận bản báo (nháp đã xoá ⇒ gate mở nháp
   * mới bằng ảnh vừa chụp).
   */
  onRetake: () => void;
  /**
   * Mọi nút "Chia sẻ …" (R8, R35). `null` ⇒ bản nháp đang soạn (form, chưa có kết nối); có `id` ⇒
   * bản báo đang hiện ở trang kết quả — nháp của nó đã giao cho hàng đợi (R31), gate lấy bản báo từ
   * `queue.items()` theo `id` này.
   */
  onShare: (reportId: string | null) => void;
  /**
   * Kết quả lần chia sẻ gần nhất: ảnh không đi kèm được (spec 5.7) hoặc đường chia sẻ báo lỗi ⇒ màn
   * nói rõ ở form và trang kết quả.
   */
  shareNotice?: ReportShareNotice;
  /**
   * Hàng đợi không có kho lưu bền (app không bật `persist`) ⇒ trang kết quả `pending`/`uncertain`/
   * `failed` nhắc "sẽ mất nếu app bị tắt" (spec 5.6).
   */
  ramOnlyQueue?: boolean;
}

/** `capabilities` của một kết nối; loại vắng hoặc hàm của app ném ⇒ coi như đầy đủ (gửi tự báo). */
const capabilitiesOf = (type: ConnectorType | undefined, c: StoredConnection) => {
  if (!type) return FULL;
  try {
    return type.capabilities(c.values);
  } catch {
    return FULL;
  }
};

const typeLabelOf = (
  type: ConnectorType | undefined,
  c: StoredConnection,
  locale: DevToolsLocale,
): string => {
  if (!type) return c.name;
  try {
    return type.label(locale);
  } catch {
    return c.name;
  }
};

/**
 * Nút "bấm hai lần mới làm" (Huỷ nháp, Bỏ bản báo): lần bấm đầu chỉ đổi chữ (`armed`), quá
 * `DISCARD_ARM_MS` thì về như cũ; `scope` đổi (sang trang khác, bản báo khác, đóng sheet — `null`) ⇒
 * cũng về như cũ. `press()` trả `true` đúng ở lần bấm thứ hai.
 */
const useTwoTap = (scope: string | null) => {
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const disarm = useCallback(() => {
    armedRef.current = false;
    setArmed(false);
  }, []);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(disarm, DISCARD_ARM_MS);
    return () => clearTimeout(timer);
  }, [armed, disarm]);
  useEffect(() => {
    disarm();
  }, [scope, disarm]);
  const press = useCallback((): boolean => {
    if (!armedRef.current) {
      armedRef.current = true;
      setArmed(true);
      return false;
    }
    disarm();
    return true;
  }, [disarm]);
  return { armed, press };
};

/**
 * Danh sách kết nối đã lưu + kết nối dùng lần trước, đọc lại mỗi lần sheet mở và mỗi lần `reload`
 * (QA vừa thêm/sửa/xoá/đặt lại ở trang Kết nối). `select` đổi lựa chọn ngay trên màn và nhớ vào kho
 * (lỗi ghi bị nuốt — lựa chọn trên màn vẫn đúng).
 */
const useConnectionList = (store: ConnectionStore | null, visible: boolean) => {
  const [state, setState] = useState<{
    list: readonly StoredConnection[];
    last: string | null;
  } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!visible || !store) return undefined;
    let live = true;
    Promise.all([store.list(), store.lastUsed()]).then(
      ([list, last]) => {
        if (live) setState({ list, last });
      },
      () => {
        if (live) setState({ list: [], last: null });
      },
    );
    return () => {
      live = false;
    };
  }, [visible, store, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const select = useCallback(
    (id: string) => {
      setPicked(id);
      store?.setLastUsed(id).catch(() => undefined);
    },
    [store],
  );

  const list = state?.list ?? [];
  const last = state?.last ?? null;
  const selected = list.find((c) => c.id === (picked ?? last)) ?? list[0] ?? null;
  return { loaded: store === null || state !== null, list, last, selected, select, reload };
};

/**
 * **Chức năng:** màn báo bug trong gate (view `'report'`) — **một** `Sheet` của bộ sheet (không
 * `<Modal>`), bảy trang:
 *
 * | Trang | Nội dung | Tiêu đề · Header | Chân |
 * |---|---|---|---|
 * | `form` | {@link ReportForm} (bố cục A+, banner hàng đợi ở đầu khi hàng đợi còn bản chưa gửi xong) | Báo bug · ✕ · Huỷ nháp (bấm hai lần) | {@link ReportFormFooter}: `Gửi tới <kết nối>` + ▾, hoặc Chia sẻ + Thêm kết nối |
 * | `steps` | {@link StepsEditor} | Các bước · ‹ | — |
 * | `pick` | {@link ConnectionPicker} | Gửi tới · ‹ | — |
 * | `queue` | {@link QueuePage} | Hàng đợi gửi · ‹ (✕ khi không có nháp) | — |
 * | `status` | {@link SendStatus} của một bản trong hàng đợi | Báo bug · ✕ (‹ khi mở từ Hàng đợi, hoặc bản `blocked` là nháp đang soạn) | — |
 * | `connections` | {@link ConnectionsPage} | Kết nối · ‹ | — |
 * | `connection-edit` | {@link ConnectionEditor} (loại đang thêm, hoặc kết nối đang sửa) | `Thêm kết nối <loại>` / `Sửa "<tên>"` · ‹ | — |
 *
 * Năm trang đầu nằm trong vùng cuộn của sheet này; hai trang kết nối là thân trang có vùng cuộn
 * riêng (gốc `SheetKit.ScrollView`) nên được đặt thẳng vào sheet.
 *
 * **Hàng đợi** (C1, I3, R42): bản báo đã giao cho hàng đợi không được biến mất khỏi mắt QA khi trang
 * kết quả đóng. Form có banner khi hàng đợi còn bản chưa gửi xong (cảnh báo khi có bản `failed` ·
 * `blocked` · `uncertain`); chạm ⇒ trang Hàng đợi; chạm một hàng ⇒ trang kết quả của bản đó (‹ về
 * Hàng đợi). Mọi bản chưa gửi xong có Chia sẻ (`onShare(id)`) và "Bỏ bản báo" (bấm hai lần,
 * `queue.discard`); `failed`/`uncertain` và `blocked` không còn nháp có "Gửi lại" (`retryNow`).
 * Bỏ xong ⇒ về Hàng đợi (hoặc về form khi bản vừa bỏ là nháp đang soạn bị chặn). "Huỷ nháp" bỏ luôn
 * mục `blocked` của chính nháp đó.
 *
 * **Gửi:** nút khoá từ lúc bấm tới khi hàng đợi trả trạng thái (chốt bằng ref: bấm hai lần liền chỉ
 * một lần gửi). Khoá với nhãn "Đang chuẩn bị…" khi danh sách kết nối hoặc hàng đợi chưa đọc xong
 * (`controller.ready`, R27); khoá khi tiêu đề trống (R24). Gửi xong ⇒ trang `status`, đọc **trực
 * tiếp từ hàng đợi** (`items()` + `subscribe`) nên `pending` gửi lại xong thì màn tự sang `sent`.
 * Hàng đợi nhận bản báo ⇒ bộ điều khiển xoá nháp (R31); `blocked` giữ nháp, "Sửa bản báo" về form.
 * Nháp bị chặn sau khi ticket đã tạo (`resume.committed`) mà kết nối đang chọn vẫn là kết nối cũ ⇒
 * form nói trước rằng Gửi chỉ làm nốt, chữ sửa không áp dụng (R34).
 *
 * **Chia sẻ** (R35): `onShare(null)` từ form (bản nháp đang soạn); `onShare(id)` từ trang kết quả
 * (bản báo hàng đợi đang giữ — nháp của nó đã xoá). `shareNotice` (gate giữ tới khi đóng sheet) hiện
 * ở form và trang kết quả: `image-dropped` ⇒ "Ảnh không chia sẻ được…", `share-failed` ⇒ "Không
 * chia sẻ được". `ramOnlyQueue` ⇒ trang kết quả còn chờ nhắc "sẽ mất nếu app bị tắt" (spec 5.6).
 *
 * **Kết nối:** đọc `list()` + `lastUsed()` mỗi lần sheet mở; mặc định là kết nối dùng lần trước,
 * ▾ mở trang chọn (chọn ⇒ `setLastUsed`). `capabilities` của kết nối đang chọn quyết định chip nào
 * khoá. Chưa có kết nối / app không cấp kho ⇒ chân là "Chia sẻ" + "Thêm kết nối".
 *
 * **Trang Kết nối** mở từ ba chỗ: "Quản lý kết nối" ở trang chọn, "Thêm kết nối" ở chân form, "Mở màn
 * kết nối" ở trang kết quả `blocked`. Thêm/Sửa ⇒ `connection-edit`, mỗi lần mở là một form mới
 * (`key` mới). Lưu hoặc Huỷ ⇒ về danh sách — lần lưu gắn với đúng form đã bấm Lưu (`seq`): kho ghi
 * xong khi QA đã lùi đi hay đã mở form khác thì không kéo QA đi, chữ đang gõ ở form kia còn nguyên.
 * Rời trang Kết nối ⇒ về đúng chỗ đã mở nó và **đọc lại** danh sách (thêm · sửa · xoá · đặt lại đều
 * thấy ở trang chọn và chữ "Gửi tới …"); mỗi lần lưu xong cũng đọc lại. Form đã lưu là kết nối mới
 * và form báo bug đang ở trạng thái chưa có kết nối ⇒ chọn luôn, nhớ là kết nối dùng lần trước.
 *
 * **Back** (Android) và ‹ lùi một cấp: `connection-edit` ⇒ `connections` ⇒ chỗ đã mở nó; `status`
 * mở từ Hàng đợi ⇒ `queue`; `steps`/`pick`/`queue`/`status` của nháp `blocked` ⇒ form; form (và kết
 * quả đã nhận, Hàng đợi khi không có nháp) ⇒ đóng sheet, nháp còn nguyên (handler của sheet). Mở
 * sheet ⇒ luôn về form.
 *
 * **Header/footer ổn định** (`useMemo`, handler đọc giá trị mới nhất qua ref) — gorhom vẽ chúng như
 * kiểu component, xem mục hiệu năng ở `LogSheet`. Chữ máy điền (tiêu đề, Thực tế) giữ hậu tố
 * `-prefilled` tới khi QA gõ vào ô đó (theo từng nháp).
 *
 * **Input:** {@link ReportSheetProps}. **Output:** sheet `fullScreenSafe`, nội dung cuộn.
 *
 * @example
 * ```tsx
 * <ReportSheet visible={view === 'report'} onDismiss={dismiss} onClosed={onReportClosed}
 *   controller={controller} queue={queue} connections={connections} connectorTypes={types}
 *   onRetake={retake} onShare={(reportId) => share(reportId)} shareNotice={notice}
 *   ramOnlyQueue={!persistStore} />
 * // Ca biên: connections === null (app không cấp secureStore) ⇒ chân "Chia sẻ" + "Thêm kết nối";
 * // "Thêm kết nối" mở trang Kết nối chỉ báo "App chưa cấp kho bảo mật".
 * ```
 *
 * **Unit test:** `ReportSheet.test.tsx` — chạy cho cả bộ gorhom và bộ thuần: `form A+` 19 case (có
 * chip "Log lỗi (N)" của nháp crash đếm theo phiên crash) ·
 * `trang sửa các bước` 10 case · `gửi và kết quả` 20 case · `hàng đợi (C1, I3)` 18 case (không banner ·
 * banner trung tính · `pending`→`failed` lúc đóng ⇒ banner → Hàng đợi → kết quả → Gửi lại · `failed`
 * đã `committed` · Chia sẻ + Bỏ ×4 · Bỏ hai lần · nhóm và thứ tự · câu RAM · `blocked` không còn
 * nháp ⇒ Gửi lại · kết nối không còn · `blocked` của nháp không vào banner · `sending` không có Bỏ ·
 * gửi lại theo từng bản · bỏ mục `blocked` của nháp ⇒ nháp còn, về form · Huỷ nháp bỏ
 * mục `blocked`) · `trang kết nối` 9 case (mở từ chân,
 * Back cứng/‹ lùi từng cấp · form mới mỗi lần mở · lưu kết nối đầu tiên ⇒ chọn luôn · lùi về form
 * trong lúc đang lưu ⇒ không bị kéo lại, vẫn chọn + nhớ · lưu của form A về muộn khi đã mở form B ⇒ B
 * còn nguyên, danh sách đọc lại, chọn-luôn theo form A · sửa từ trang chọn ⇒ tên mới ở trang chọn và
 * chân · xoá ⇒ đọc lại · không có kho · mở lại sheet về form) ·
 * sáng/tối 22 trạng thái màn × 2 theme.
 */
export const ReportSheet = ({
  visible,
  onDismiss,
  onClosed,
  controller,
  queue,
  connections,
  connectorTypes,
  onRetake,
  onShare,
  shareNotice,
  ramOnlyQueue = false,
}: ReportSheetProps) => {
  const t = useDevToolsT();
  const { locale, strings } = useDevToolsUi();
  const styles = useStyles(stylesOf);
  const { Sheet, ScrollView } = useSheetKit();
  const { draft, ready } = controller;

  const [page, setPage] = useState<Page>('form');
  const [connectionsFrom, setConnectionsFrom] = useState<ConnectionsFrom>('form');
  const [editing, setEditing] = useState<Editing | null>(null);
  const editSeq = useRef(0);
  /** `report.id` của bản trang kết quả đang hiện — đọc **trực tiếp** từ hàng đợi theo id này. */
  const [statusId, setStatusId] = useState<string | null>(null);
  const [statusFrom, setStatusFrom] = useState<StatusFrom>('send');
  /* Mở sheet ⇒ luôn về form, bỏ kết quả cũ (nháp mới sau khi gửi, hoặc nháp cũ đóng giữa trang
     con, kể cả trang kết nối). Lần gửi còn đang bay lúc đóng thì vẫn đưa sheet sang trang kết quả
     khi xong. */
  const [openedFor, setOpenedFor] = useState(visible);
  if (openedFor !== visible) {
    setOpenedFor(visible);
    if (visible) {
      setPage('form');
      setStatusId(null);
      setStatusFrom('send');
      setEditing(null);
    }
  }

  const conn = useConnectionList(connections, visible);
  const typeOf = (c: StoredConnection) => connectorTypes.find((type) => type.id === c.typeId);
  const caps = conn.selected ? capabilitiesOf(typeOf(conn.selected), conn.selected) : FULL;

  /*
    Số lỗi `errors.txt` sẽ chứa (nháp thường ⇒ cửa sổ của bug; nháp crash ⇒ phiên crash) — đọc mỗi
    lần mở / đổi nháp, không mỗi lượt render.
  */
  const draftId = draft?.id;
  const { errorCount: countDraftErrors } = controller;
  const errorCount = useMemo(
    () => (visible && draftId !== undefined ? countDraftErrors() : 0),
    [visible, draftId, countDraftErrors],
  );

  /* Ô nào QA đã gõ (theo từng nháp) — chữ máy điền mang viền nhấn tới lúc đó. */
  const [touched, setTouched] = useState<{ id?: string; title: boolean; actual: boolean }>({
    title: false,
    actual: false,
  });
  const touchedNow =
    touched.id === draft?.id ? touched : { id: draft?.id, title: false, actual: false };
  const prefilled = {
    title: !touchedNow.title && (draft?.title.trim() ?? '') !== '',
    actual: !touchedNow.actual && (draft?.actual.trim() ?? '') !== '',
  };

  /* Hàng đợi: trang kết quả và trang Hàng đợi đọc mục mới nhất; banner đếm bản chưa gửi xong. */
  const subscribe = useMemo(
    () => (queue ? (l: () => void) => queue.subscribe(l) : noSubscribe),
    [queue],
  );
  const getItems = useMemo(() => (queue ? () => queue.items() : noItems), [queue]);
  const items = useSyncExternalStore(subscribe, getItems, getItems);
  /* Mục `blocked` của chính nháp đang soạn không tính — form đang hiện nó (N4). */
  const queued = useMemo(() => queueCounts(items, { ownDraftId: draftId }), [items, draftId]);
  const status = statusId ? (items.find((i) => i.report.id === statusId) ?? null) : null;
  /* Trang thật sự vẽ: bản báo không còn trong hàng đợi (đã bỏ) thì không có trang kết quả; nháp đã
     giao cho hàng đợi thì form không còn gì để sửa ⇒ trang kết quả (hoặc Hàng đợi nếu không còn gì). */
  let shownPage: Page = page;
  if (shownPage === 'status' && !status) shownPage = statusFrom === 'queue' ? 'queue' : 'form';
  if ((shownPage === 'form' || shownPage === 'steps') && !draft) {
    shownPage = status ? 'status' : 'queue';
  }
  if (shownPage === 'connection-edit' && (!editing || !connections)) shownPage = 'connections';
  /* Bản đang xem ở trang kết quả chính là nháp đang soạn (bị chặn, R31 giữ nháp). */
  const statusOwnsDraft = status !== null && draft?.id === status.report.id;

  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [sendFailed, setSendFailed] = useState(false);
  /* Bản nào đang được gửi lại thủ công — theo từng `report.id` (N6): gửi lại bản A không khoá bản B. */
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(() => new Set());
  const retryingRef = useRef(new Set<string>());
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [focusId, setFocusId] = useState<string | undefined>(undefined);
  const stepSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(copiedTimer.current);
    };
  }, []);

  /* Giá trị mới nhất cho các handler ổn định (header/footer `useMemo` theo chúng). */
  const latestValues = {
    controller,
    selected: conn.selected,
    last: conn.last,
    noConnections: conn.loaded && conn.list.length === 0,
    connections,
    connectorTypes,
    queue,
    onDismiss,
    status,
    statusFrom,
    shownPage,
    connectionsFrom,
    editing,
  };
  const latest = useRef(latestValues);
  latest.current = latestValues;

  const goForm = useCallback(() => setPage('form'), []);
  const openSteps = useCallback(() => setPage('steps'), []);
  const openPicker = useCallback(() => setPage('pick'), []);
  const openQueue = useCallback(() => setPage('queue'), []);
  const openQueueItem = useCallback((reportId: string) => {
    setStatusId(reportId);
    setStatusFrom('queue');
    setPage('status');
  }, []);

  /* ------------------------------------------------------ trang kết nối */

  const openConnections = useCallback((from: ConnectionsFrom) => {
    setConnectionsFrom(from);
    setPage('connections');
  }, []);
  const manageFromForm = useCallback(() => openConnections('form'), [openConnections]);
  const manageFromPicker = useCallback(() => openConnections('pick'), [openConnections]);
  const manageFromStatus = useCallback(() => openConnections('status'), [openConnections]);

  const { reload: reloadConnections, select: rememberConnection } = conn;
  /* Rời trang Kết nối: về chỗ đã mở nó và đọc lại danh sách — QA có thể đã thêm, sửa, xoá hay đặt
     lại kết nối ở đó, nên danh sách chọn và chữ "Gửi tới …" phải theo kho. */
  const leaveConnections = useCallback(() => {
    setEditing(null);
    setPage(latest.current.connectionsFrom);
    reloadConnections();
  }, [reloadConnections]);

  const openEditor = useCallback((type: ConnectorType, initial?: StoredConnection) => {
    editSeq.current += 1;
    setEditing({ type, initial, seq: editSeq.current });
    setPage('connection-edit');
  }, []);
  const addConnection = useCallback((type: ConnectorType) => openEditor(type), [openEditor]);
  const editConnection = useCallback(
    (c: StoredConnection) => {
      /* Trang Kết nối chỉ có nút Sửa khi loại còn đăng ký. */
      const type = latest.current.connectorTypes.find((x) => x.id === c.typeId);
      if (type) openEditor(type, c);
    },
    [openEditor],
  );
  const closeEditor = useCallback(() => {
    setEditing(null);
    setPage('connections');
  }, []);
  /**
   * Form `saved` (chính form đã bấm Lưu — kho có thể ghi xong sau khi QA đã rời nó, kể cả khi đã mở
   * form khác) vừa lưu `c`. Luôn đọc lại danh sách. Form đó là kết nối **mới** và form báo bug đang ở
   * trạng thái chưa có kết nối ⇒ chọn luôn, nhớ là kết nối dùng lần trước — về form là gửi được
   * ngay. Chỉ về danh sách khi form đó **vẫn** đang mở (cùng `seq`): QA đã lùi đi hay đang gõ ở form
   * khác thì không bị kéo đi, chữ đang gõ không mất.
   */
  const connectionSaved = useCallback(
    (c: StoredConnection, saved: Editing) => {
      const { editing: current, noConnections } = latest.current;
      if (!saved.initial && noConnections) rememberConnection(c.id);
      reloadConnections();
      if (current?.seq === saved.seq) closeEditor();
    },
    [closeEditor, reloadConnections, rememberConnection],
  );

  /*
    ‹ ở header và Back cứng: lùi đúng một cấp (sửa kết nối → danh sách → chỗ đã mở danh sách;
    kết quả mở từ Hàng đợi → Hàng đợi; còn lại → form).
  */
  const goBack = useCallback(() => {
    const { shownPage: p, statusFrom: from } = latest.current;
    if (p === 'connection-edit') closeEditor();
    else if (p === 'connections') leaveConnections();
    else if (p === 'status' && from === 'queue') {
      setStatusId(null);
      setPage('queue');
    } else setPage('form');
  }, [closeEditor, leaveConnections]);

  /* "Huỷ nháp" hỏi lại: lần bấm đầu chỉ đổi chữ, quá `DISCARD_ARM_MS` thì về như cũ. */
  const draftDiscard = useTwoTap(visible && page === 'form' ? 'form' : null);
  const { press: pressDraftDiscard } = draftDiscard;
  const discard = useCallback(() => {
    if (!pressDraftDiscard()) return;
    const { controller: c, queue: q, onDismiss: dismiss } = latest.current;
    /* Nháp bị chặn còn để lại mục `blocked` cùng id trong hàng đợi — huỷ nháp là bỏ luôn mục đó. */
    const id = c.draft?.id;
    const stale =
      id && q ? q.items().find((i) => i.report.id === id && i.state === 'blocked') : undefined;
    c.discard();
    if (stale && q) q.discard(stale.report.id).catch(() => undefined);
    dismiss();
  }, [pressDraftDiscard]);

  /*
    "Bỏ bản báo" ở trang kết quả: bấm hai lần, rồi về Hàng đợi — trừ khi trang mở ngay sau khi Gửi
    mà nháp vẫn còn (bản `blocked` là nháp đang soạn: chỉ mục hàng đợi bị bỏ, nháp ở lại) ⇒ về form.
  */
  const itemDiscard = useTwoTap(
    visible && shownPage === 'status' && status ? status.report.id : null,
  );
  const { press: pressItemDiscard } = itemDiscard;
  const discardItem = useCallback(() => {
    const { queue: q, status: s, controller: c } = latest.current;
    if (!q || !s || !pressItemDiscard()) return;
    q.discard(s.report.id).catch(() => undefined);
    setStatusId(null);
    setPage(latest.current.statusFrom === 'queue' || c.draft === null ? 'queue' : 'form');
  }, [pressItemDiscard]);

  const change = useCallback((patch: ReportDraftPatch) => {
    const { controller: c } = latest.current;
    const id = c.draft?.id;
    if (patch.title !== undefined || patch.actual !== undefined) {
      setTouched((cur) => {
        const base = cur.id === id ? cur : { id, title: false, actual: false };
        return {
          id,
          title: base.title || patch.title !== undefined,
          actual: base.actual || patch.actual !== undefined,
        };
      });
    }
    c.update(patch);
  }, []);

  const changeSteps = useCallback((steps: readonly ReportStep[]) => change({ steps }), [change]);
  const addStep = useCallback(() => {
    const { controller: c } = latest.current;
    if (!c.draft) return;
    const now = Date.now();
    stepSeq.current += 1;
    const id = `qa:${now}:${stepSeq.current}`;
    const step: ReportStep = { id, kind: 'text', at: now, text: '' };
    setFocusId(step.id);
    c.update({ steps: [...c.draft.steps, step] });
  }, []);

  const send = useCallback(async () => {
    const { controller: c, selected, last, connections: store } = latest.current;
    if (sendingRef.current || !selected || !c.ready || !c.draft || c.draft.title.trim() === '') {
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setSendFailed(false);
    /* Lần gửi đầu (chưa nhớ kết nối nào) cũng là "kết nối dùng lần trước" của lần sau. */
    if (selected.id !== last) store?.setLastUsed(selected.id).catch(() => undefined);
    try {
      const item = await c.send(selected.id);
      if (!mounted.current) return;
      setStatusId(item.report.id);
      setStatusFrom('send');
      setPage('status');
    } catch {
      if (mounted.current) setSendFailed(true);
    } finally {
      sendingRef.current = false;
      if (mounted.current) setSending(false);
    }
  }, []);

  const retry = useCallback(async () => {
    const { queue: q, status: s } = latest.current;
    if (!q || !s) return;
    const id = s.report.id;
    if (retryingRef.current.has(id)) return;
    retryingRef.current.add(id);
    setRetrying(new Set(retryingRef.current));
    try {
      /* Trang kết quả đọc bản mới nhất thẳng từ hàng đợi theo `statusId`. */
      await q.retryNow(id);
    } catch {
      // mục đã bị bỏ khỏi hàng đợi — trang kết quả tự lùi về Hàng đợi/form
    } finally {
      retryingRef.current.delete(id);
      if (mounted.current) setRetrying(new Set(retryingRef.current));
    }
  }, []);

  const openUrl = useCallback((url: string) => {
    try {
      Promise.resolve(Linking.openURL(url)).catch(() => undefined);
    } catch {
      // không mở được trình duyệt — vẫn còn nút Chép link
    }
  }, []);
  const copyLink = useCallback((url: string) => {
    if (!copyText(url)) return;
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_HINT_MS);
  }, []);
  const selectConnection = useCallback(
    (id: string) => {
      rememberConnection(id);
      setPage('form');
    },
    [rememberConnection],
  );

  /* Back cứng lùi một cấp; đăng ký SAU handler của sheet nên được gọi trước. */
  const subPage =
    shownPage === 'steps' ||
    shownPage === 'pick' ||
    shownPage === 'connections' ||
    shownPage === 'connection-edit' ||
    (shownPage === 'queue' && draft !== null) ||
    (shownPage === 'status' &&
      (statusFrom === 'queue' || (status?.state === 'blocked' && statusOwnsDraft)));
  useSheetBackHandler(visible && subPage, goBack);

  /* ------------------------------------------------ header / footer ổn định */

  const closeButton = useMemo(
    () => (
      <Button
        testID="devtools-report-dismiss"
        label={t('common.close')}
        iconOnly
        variant="tertiary"
        onPress={onDismiss}
        leftIcon={({ size }) => <Icon name="close" size={size} />}
      />
    ),
    [t, onDismiss],
  );
  const backButton = useMemo(
    () => (
      <Button
        testID="devtools-report-back"
        label={t('report.sheet.back')}
        iconOnly
        variant="tertiary"
        onPress={goBack}
        leftIcon={({ size }) => <Icon name="back" size={size} />}
      />
    ),
    [t, goBack],
  );
  const hasDraft = draft !== null;
  const rightAction = useMemo(
    () =>
      shownPage === 'form' && hasDraft ? (
        <Button
          testID="devtools-report-discard"
          label={
            draftDiscard.armed ? t('report.sheet.discardConfirm') : t('report.sheet.discard')
          }
          variant="tertiary"
          size="sm"
          onPress={discard}
        />
      ) : undefined,
    [shownPage, hasDraft, draftDiscard.armed, t, discard],
  );

  const blank = (draft?.title.trim() ?? '') === '';
  const footerMode: 'send' | 'add' =
    connections === null || (conn.loaded && conn.list.length === 0) ? 'add' : 'send';
  const preparing = !conn.loaded || !ready || !conn.selected;
  const sendLabel = preparing
    ? t('report.form.sendPreparing')
    : t('report.form.sendTo', { name: conn.selected?.name ?? '' });
  const sendDisabled = preparing || blank;
  /* Chia sẻ từ form ⇒ bản nháp đang soạn (R35). */
  const shareDraft = useCallback(() => onShare(null), [onShare]);
  const footer = useMemo(
    () =>
      shownPage === 'form' && hasDraft ? (
        <ReportFormFooter
          mode={footerMode}
          sendLabel={sendLabel}
          sendDisabled={sendDisabled}
          sending={sending}
          onSend={send}
          onPick={openPicker}
          onShare={shareDraft}
          onAddConnection={manageFromForm}
        />
      ) : undefined,
    [
      shownPage,
      hasDraft,
      footerMode,
      sendLabel,
      sendDisabled,
      sending,
      send,
      openPicker,
      shareDraft,
      manageFromForm,
    ],
  );

  /*
    R34: nháp này từng bị chặn SAU khi ticket đã tạo, và QA vẫn đang chọn kết nối cũ ⇒ bấm Gửi chỉ
    làm nốt mục cũ (chữ sửa không áp dụng) — nói trước trên form. Chọn kết nối khác thì câu biến mất
    (gửi bản sửa thành ticket mới ở đích mới).
  */
  const committedItem = draft
    ? items.find((i) => i.report.id === draft.id && i.state === 'blocked' && isCommitted(i))
    : undefined;
  const committedConnection =
    committedItem && committedItem.connectionId === conn.selected?.id ? conn.selected : null;
  const committedNote = committedConnection
    ? t('report.status.committed', {
        target: typeLabelOf(typeOf(committedConnection), committedConnection, locale),
      })
    : undefined;

  /* ------------------------------------------------------------ thân trang */

  let body: ReactNode = null;
  if (shownPage === 'steps' && draft) {
    body = (
      <StepsEditor
        steps={draft.steps}
        note={stepsNote(draft, t)}
        strings={strings}
        focusId={focusId}
        onChange={changeSteps}
        onAdd={addStep}
      />
    );
  } else if (shownPage === 'pick') {
    const choices: ConnectionChoice[] = conn.list.map((c) => {
      const type = typeOf(c);
      const cc = capabilitiesOf(type, c);
      return {
        id: c.id,
        name: c.name,
        typeLabel: typeLabelOf(type, c, locale),
        light: !cc.image || !cc.files,
      };
    });
    body = (
      <ConnectionPicker
        choices={choices}
        selectedId={conn.selected?.id ?? null}
        onSelect={selectConnection}
        onManage={manageFromPicker}
      />
    );
  } else if (shownPage === 'queue') {
    body = (
      <QueuePage
        items={items}
        connectionName={(id) => conn.list.find((c) => c.id === id)?.name}
        now={Date.now()}
        ramOnly={ramOnlyQueue}
        onOpen={openQueueItem}
      />
    );
  } else if (shownPage === 'status' && status) {
    const used = conn.list.find((c) => c.id === status.connectionId);
    const type = used ? typeOf(used) : undefined;
    const usedCaps = used ? capabilitiesOf(type, used) : FULL;
    body = (
      <SendStatus
        item={status}
        target={used ? typeLabelOf(type, used, locale) : t('report.status.targetFallback')}
        light={!usedCaps.image || !usedCaps.files}
        copied={copied}
        retrying={retrying.has(status.report.id)}
        onOpen={openUrl}
        onCopy={copyLink}
        /* Mở từ Hàng đợi: nháp đang soạn là bản khác — "Báo bug khác" sẽ chụp đè ảnh của nó. */
        onAnother={statusFrom === 'send' ? onRetake : undefined}
        onShare={onShare}
        onRetry={retry}
        onEdit={statusOwnsDraft ? goForm : undefined}
        onManageConnections={manageFromStatus}
        connectionReady={used !== undefined && type !== undefined}
        onDiscard={discardItem}
        discardArmed={itemDiscard.armed}
        ramOnly={ramOnlyQueue}
      />
    );
  } else if (shownPage === 'form' && draft) {
    body = (
      <ReportForm
        draft={draft}
        errorCount={errorCount}
        canImage={caps.image}
        canFiles={caps.files}
        prefilled={prefilled}
        sendFailed={sendFailed}
        committedNote={committedNote}
        queued={queued}
        onOpenQueue={openQueue}
        onChange={change}
        onEditSteps={openSteps}
        onRetake={onRetake}
      />
    );
  }

  let title: string;
  /* Hai trang kết nối là thân trang có vùng cuộn riêng (gốc `SheetKit.ScrollView`) — đặt thẳng vào
     sheet, không lồng vào vùng cuộn của các trang kia. */
  let content: ReactNode;
  if (shownPage === 'connections') {
    title = t('connections.page.title');
    content = (
      <ConnectionsPage
        key="connections"
        connections={connections}
        connectorTypes={connectorTypes}
        onAdd={addConnection}
        onEdit={editConnection}
        onBack={leaveConnections}
      />
    );
  } else if (shownPage === 'connection-edit') {
    title = editing?.initial
      ? t('connections.editor.titleEdit', { name: editing.initial.name })
      : t('connections.editor.titleNew', { type: editing?.type.label(locale) ?? '' });
    /* `shownPage` chỉ là 'connection-edit' khi có cả form đang mở lẫn kho kết nối. */
    content =
      editing && connections ? (
        <ConnectionEditor
          key={`connection-editor-${editing.seq}`}
          type={editing.type}
          connections={connections}
          initial={editing.initial}
          uiLocale={locale}
          /* Gắn với đúng form này: lần lưu về muộn vẫn biết nó là của form nào. */
          onSaved={(c) => connectionSaved(c, editing)}
          onCancel={closeEditor}
        />
      ) : null;
  } else {
    title =
      shownPage === 'steps'
        ? t('report.editor.title')
        : shownPage === 'pick'
          ? t('report.picker.title')
          : shownPage === 'queue'
            ? t('report.queue.title')
            : t('report.sheet.title');
    content = (
      <ScrollView
        key={shownPage}
        testID={SCROLL_ID[shownPage]}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {shareNotice && (shownPage === 'form' || shownPage === 'status') ? (
          <Text
            testID="devtools-report-share-notice"
            variant="captionS_Medium"
            tone={shareNotice === 'share-failed' ? 'danger' : 'warning'}
          >
            {t(
              shareNotice === 'share-failed'
                ? 'report.sheet.shareFailed'
                : 'report.sheet.imageDropped',
            )}
          </Text>
        ) : null}
        {body}
      </ScrollView>
    );
  }

  return (
    <Sheet
      testID="devtools-report-sheet"
      visible={visible}
      onDismiss={onDismiss}
      onClosed={onClosed}
      title={title}
      size="fullScreenSafe"
      contentMode="scroll"
      leftAction={subPage ? backButton : closeButton}
      rightAction={rightAction}
      footer={footer}
    >
      {content}
    </Sheet>
  );
};
