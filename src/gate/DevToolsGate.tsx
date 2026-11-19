import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  DevSettings,
  Share,
  TurboModuleRegistry,
  type TurboModule,
} from 'react-native';
import { activePersistStore } from '../capture/log-persist';
import { useDevToolsT } from '../i18n';
import { useDevToolsUi } from '../ui/context';
import { DevToolsUiProvider } from '../ui/DevToolsUiProvider';
import { DevToolsPanel } from '../panel/DevToolsPanel';
import { LogSheet } from '../panel/LogSheet';
import { usePreviousSession } from '../panel/use-previous-session';
import type { ScreenshotState } from '../report/bug-report';
import {
  createConnectionStore,
  type DevToolsSecureStore,
} from '../report/connections/connection-store';
import { mergeConnectorTypes } from '../report/connectors/builtin';
import type { ConnectorType } from '../report/connectors/types';
import { makeConnectorContext } from '../report/connectors/http';
import { makeUploadPart } from '../report/connectors/upload';
import { TouchRecorder } from '../report/recorder/TouchRecorder';
import { takeScreenshot, useReportController } from '../report/report-controller';
import { RETRY_EVERY_MS, createSendQueue, queueCounts } from '../report/send-queue';
import { shareReport } from '../report/share-report';
import { ReportSheet, type ReportShareNotice } from '../report/ui/ReportSheet';
import { resolveShakeConfig } from '../shake/shake-config';
import { useShake } from '../shake/use-shake';
import type { ShakeConfig } from '../shake/detect-shake';
import { DevToolsContext, type DevToolsContextValue } from './devtools-context';
import type {
  DevToolsBugReportConfig,
  DevToolsGateProps,
  DevToolsPanelReportRow,
} from './devtools-props';
import { isRunningFromMetro } from './is-running-from-metro';

const DEFAULT_SNOOZE_MINUTES = 30;
const MS_PER_MINUTE = 60_000;
const NO_QUEUED = { waiting: 0, attention: 0 } as const;

/**
 * Chụp lại: đợi sheet báo bug báo đã rời màn (`onClosed`) tối đa ngần này, quá hẹn thì vẫn chụp. Dư
 * cho hoạt ảnh đóng (bản thuần 200 ms, gorhom ~300 ms), đủ ngắn để QA không tưởng nút hỏng.
 */
export const RETAKE_CLOSE_FALLBACK_MS = 1000;

/**
 * Bề mặt nào đang mở. Một biến nhiều trạng thái chứ **không** phải nhiều cờ `boolean` độc lập:
 * hai cờ cho phép trạng thái "cả hai cùng mở", mà gorhom mặc định `stackBehavior="push"` sẽ
 * chồng hai lớp backdrop lên nhau (nền tối gấp đôi, thấy panel mờ sau màn nhật ký). Kiểu dữ
 * liệu này làm ca đó **không biểu diễn được**.
 */
type DevToolsView = 'none' | 'panel' | 'log' | 'previous' | 'report';

/**
 * Kho kết nối + hàng đợi gửi của báo bug — dựng **một lần** (R26) cho tới khi đổi **có/không có
 * `secureStore`** hoặc đổi **tập id** loại kết nối. App viết `bugReport: { secureStore, connectorTypes }`
 * inline (object mới mỗi lượt render) thì vẫn KHÔNG dựng lại: dựng lại là một hàng đợi mới đọc lại file
 * trong lúc hàng đợi cũ còn đang gửi ⇒ mục `sending` thành `pending` và bị gửi lần hai (ticket trùng).
 *
 * Object sống (kho bảo mật, loại kết nối, `writeTempFile`) đọc qua `latest` lúc dùng:
 * - kho kết nối nhận một **vỏ** gọi tới `latest.current.secureStore` (bản mới nhất);
 * - hàng đợi nhận mảng `liveTypes` **cùng một tham chiếu**, được thay nội dung mỗi lượt render (cùng
 *   id, object mới nhất) — hàng đợi tra theo id lúc gửi nên luôn gặp bản mới nhất.
 *
 * Không có `secureStore` ⇒ `services` là `null`: không lưu được kết nối nên không có gì để gửi.
 * `ramOnly`: hàng đợi dựng khi app chưa bật `persist` (không có `LogStore`) ⇒ chỉ nằm trong RAM.
 *
 * `connectorTypes` là danh sách đã ghép — màn báo bug đọc tên loại và `capabilities` từ đó, trang
 * Kết nối đọc lại kho (cả bí mật) mỗi khi tham chiếu của nó đổi. Nên nó **giữ tham chiếu cũ** khi
 * mọi phần tử vẫn là đúng các object cũ (app viết `connectorTypes: [myType]` inline ⇒ mảng mới mỗi
 * lượt, object như cũ); object loại nào đổi thì mới ra mảng mới.
 */
const useReportServices = (
  bugReport: DevToolsBugReportConfig | undefined,
  latest: { readonly current: DevToolsBugReportConfig | undefined },
) => {
  const hasStore = bugReport?.secureStore !== undefined;
  const liveTypes = useRef<ConnectorType[]>([]).current;
  const merged = mergeConnectorTypes(bugReport?.connectorTypes);
  liveTypes.splice(0, liveTypes.length, ...merged);
  const typeIds = merged.map((type) => type.id).join('|');
  const shownTypes = useRef(merged);
  const prev = shownTypes.current;
  if (prev.length !== merged.length || merged.some((type, i) => type !== prev[i])) {
    shownTypes.current = merged;
  }

  const services = useMemo(() => {
    if (!hasStore) return null;
    const secureStore = (): DevToolsSecureStore => {
      const store = latest.current?.secureStore;
      if (!store) throw new Error('config.bugReport.secureStore is no longer provided');
      return store;
    };
    const connections = createConnectionStore(
      {
        getItem: async (key) => secureStore().getItem(key),
        setItem: async (key, value) => secureStore().setItem(key, value),
        removeItem: async (key) => secureStore().removeItem(key),
      },
      {
        secretFieldIdsOf: (typeId) =>
          liveTypes.find((type) => type.id === typeId)?.secretFieldIds ?? [],
      },
    );
    const store = activePersistStore();
    const queue = createSendQueue({
      connections,
      connectorTypes: liveTypes,
      /* `reportId`: file tạm của các bản báo gửi lại song song mang tên riêng, không đè nhau (R44). */
      makeSendContext: (locale, resume, checkpoint, reportId) => ({
        ...makeConnectorContext(locale),
        resume,
        checkpoint,
        uploadPart: makeUploadPart({ writeTempFile: latest.current?.writeTempFile, reportId }),
      }),
      store,
      now: Date.now,
    });
    return { connections, queue, ramOnly: store === undefined };
    /* `typeIds`: chỉ tập id đổi mới dựng lại — object loại kết nối mới (cùng id) đi qua `liveTypes`. */
  }, [hasStore, typeIds, liveTypes, latest]);
  return { services, connectorTypes: shownTypes.current };
};

/**
 * Bề mặt native mà gate cần thêm ngoài `DevSettings` của JS: công tắc cú lắc của dev menu RN
 * **không** nằm trong API public (`DevSettings` chỉ có `addMenuItem` · `reload` ·
 * `onFastRefresh`), phải lấy thẳng từ TurboModule.
 */
type DevSettingsShakeToggle = TurboModule & {
  setIsShakeToShowDevMenuEnabled?: (enabled: boolean) => void;
};

/**
 * Nghe cảm biến. Là component **riêng** chứ không phải một nhánh `if` bên trong `useShake`:
 * tắt cảm biến = **tháo component**, vì `useAnimatedSensor` không có đường đăng ký lại sau
 * `unregister()`. Mọi điều kiện bật/tắt vì thế nằm ở chỗ *mount* nó, không nằm trong nó.
 */
const ShakeListener = ({
  onShake,
  config,
}: {
  onShake: () => void;
  config: ShakeConfig;
}) => {
  useShake(onShake, config);
  return null;
};

/** Thân của cổng — chạy **bên trong** `DevToolsUiProvider` (cần `useDevToolsT()`). Xem {@link DevToolsGate}. */
const DevToolsGateBody = ({
  config,
  actions,
  children,
}: DevToolsGateProps) => {
  const t = useDevToolsT();

  const [view, setView] = useState<DevToolsView>('none');
  const [snoozed, setSnoozed] = useState(false);
  const [foreground, setForeground] = useState(
    () => AppState.currentState === 'active',
  );

  const snoozeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const menuRegistered = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /* ------------------------------------------------------------ báo bug */

  /* `enabled: false` ⇒ coi như app không khai: không bọc, không dựng, không chụp. */
  const bugReport = config.enabled ? config.bugReport : undefined;
  const bugReportRef = useRef(bugReport);
  bugReportRef.current = bugReport;
  const { services, connectorTypes } = useReportServices(bugReport, bugReportRef);

  const [queueReady, setQueueReady] = useState(false);
  const controller = useReportController(bugReport, {
    subtitle: config.subtitle,
    sessionInfo: config.sessionInfo,
    queue: services?.queue ?? null,
    ready: queueReady,
  });
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  /** Ảnh chụp lúc mở panel gần nhất — `begin` dùng nó khi QA bấm hàng Báo bug. */
  const [shot, setShot] = useState<ScreenshotState>('none');
  /*
    Đang chụp, hoặc đang đợi sheet báo bug rời màn để chụp lại. Lúc này không nghe lắc và `open()`
    không làm gì: một cú lắc chen vào sẽ chụp trúng sheet đang trượt xuống. Ref cho lời gọi đồng bộ,
    state để tháo listener.
  */
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const retaking = useRef(false);
  const retakeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const markBusy = useCallback((next: boolean) => {
    busyRef.current = next;
    setBusy(next);
  }, []);

  /** Chụp màn của app (có trần 1,5 s) rồi mới chạy `then`. */
  const capture = useCallback(
    (then: (state: ScreenshotState) => void) => {
      markBusy(true);
      void takeScreenshot(bugReportRef.current?.captureScreen).then((state) => {
        if (!mounted.current) return;
        markBusy(false);
        then(state);
      });
    },
    [markBusy],
  );

  /* R27: Gửi chỉ bật khi hàng đợi đã đọc xong file của nó. */
  useEffect(() => {
    setQueueReady(false);
    if (!services) return;
    let live = true;
    services.queue.load().then(
      () => {
        if (live) setQueueReady(true);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [services]);

  /* Gửi lại (spec 5.6): ngay sau khi đọc xong, mỗi lần app lên lại, rồi mỗi 60 s khi app đang mở.
     Xuống nền ⇒ cleanup huỷ nhịp; lên lại ⇒ effect chạy lại. */
  useEffect(() => {
    if (!services || !queueReady || !foreground) return;
    const retry = () => {
      services.queue.retryDue().catch(() => undefined);
    };
    retry();
    const timer = setInterval(retry, RETRY_EVERY_MS);
    return () => clearInterval(timer);
  }, [services, queueReady, foreground]);

  /* …và mỗi lần mở panel. */
  const panelOpen = view === 'panel';
  useEffect(() => {
    if (services && queueReady && panelOpen) services.queue.retryDue().catch(() => undefined);
  }, [services, queueReady, panelOpen]);

  /*
    C1: số bản hàng đợi chưa gửi xong — dòng phụ hàng "Báo bug" nói cho QA biết bản đã giao cho hàng
    đợi còn chờ hay đã hỏng, kể cả khi trang kết quả đã đóng. Nghe hàng đợi (không đọc lúc render): chỉ
    đổi state khi số đổi, nên một lần gửi lại không làm cả gate vẽ lại.
  */
  const [queued, setQueued] = useState<{ waiting: number; attention: number }>(NO_QUEUED);
  /* M4: kho lưu bền treo ⇒ hàng đợi tự thành RAM-only giữa chừng — màn báo bug phải nhắc theo. */
  const [queueStalled, setQueueStalled] = useState(false);
  const queue = services?.queue ?? null;
  /* Mục `blocked` của chính nháp đang soạn không tính — hàng đã ghi "Có bản nháp" (N4). */
  const draftId = controller.draft?.id;
  useEffect(() => {
    if (!queue) {
      setQueued(NO_QUEUED);
      setQueueStalled(false);
      return undefined;
    }
    const update = () => {
      const next = queueCounts(queue.items(), { ownDraftId: draftId });
      setQueued((cur) =>
        cur.waiting === next.waiting && cur.attention === next.attention ? cur : next,
      );
      setQueueStalled(queue.ramOnly());
    };
    update();
    return queue.subscribe(update);
  }, [queue, draftId]);

  const shakeConfig = useMemo(
    () => resolveShakeConfig(config.shake),
    [config.shake],
  );
  /* Hằng suốt vòng đời app, nhưng đọc trong `useMemo` chứ không ở module scope để test
     mock được `TurboModuleRegistry` trước khi component mount. */
  const fromMetro = useMemo(() => isRunningFromMetro(), []);
  const snoozeMinutes = config.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) =>
      setForeground(next === 'active'),
    );
    return () => sub.remove();
  }, []);

  useEffect(
    () => () => {
      if (snoozeTimer.current) clearTimeout(snoozeTimer.current);
      clearTimeout(retakeTimer.current);
    },
    [],
  );

  /*
    Chạy từ Metro thì cú lắc thuộc về dev menu của RN — nên cấp cho dev một dòng TRONG chính
    dev menu đó thay vì tranh cử chỉ. Chốt bằng ref: `t` đổi mỗi lần đổi ngôn ngữ, mà
    `addMenuItem` thì cộng dồn chứ không thay thế ⇒ không chốt là dev menu mọc thêm một dòng
    trùng tên sau mỗi lần đổi ngôn ngữ.
  */
  useEffect(() => {
    if (menuRegistered.current || !config.enabled || !fromMetro) return;
    if (typeof DevSettings?.addMenuItem !== 'function') return;
    menuRegistered.current = true;
    /* Qua `openRef` (bản `open` mới nhất): dòng menu chỉ đăng ký một lần, mà `open` còn chụp ảnh. */
    DevSettings.addMenuItem(t('panel.title'), () => openRef.current());
  }, [config.enabled, fromMetro, t]);

  /*
    Cú lắc chỉ được thuộc về MỘT bên, và bên nào là tuỳ chỗ app lấy JS:
      · từ Metro (máy dev)  → dev menu của RN giữ cú lắc, panel đi nhờ một dòng trong đó.
      · offline (bản tester, JS nhúng trong .app) → panel nghe lắc ⇒ phải TẮT cú lắc của dev
        menu, nếu không tester lắc ra hai thứ chồng nhau — mà lúc đó dev menu gần như vô dụng:
        "Reload" THẤT BẠI vì JS đã đóng băng lúc build, còn
        "Open DevTools" · "Configure Bundler" thì không có Metro nào để nối.

    🔴 Truyền `fromMetro` chứ KHÔNG phải `false`: `RCTDevSettings` ghi giá trị này xuống
    NSUserDefaults, tức nó **bám lại sau khi app tắt**. Gọi một chiều thì chỉ cần một lượt chạy
    offline là cú lắc của dev menu tắt vĩnh viễn cho bundle id đó, kể cả những lần sau chạy với
    Metro — và triệu chứng ("lắc không ra gì cả") không chỉ về đâu để tìm.

    ⚠️ **iOS only.** `DevSettingsModule.kt` của Android là no-op (`// iOS only` ngay trong thân
    hàm), và Android không có công tắc riêng cho cú lắc: `ShakeDetector` bật/tắt theo cả
    `devSupportEnabled`, tắt nó là mất luôn LogBox và màn đỏ. Nên trên Android bản tester vẫn
    thấy dev menu chồng lên panel.
  */
  useEffect(() => {
    if (!config.enabled) return;
    TurboModuleRegistry.get<DevSettingsShakeToggle>(
      'DevSettings',
    )?.setIsShakeToShowDevMenuEnabled?.(fromMetro);
  }, [config.enabled, fromMetro]);

  /*
    Có báo bug ⇒ chụp màn của app TRƯỚC khi panel che nó (spec 5.2), rồi mới mở panel. Chỉ chụp khi
    chưa có sheet devtools nào trên màn — đang mở sheet khác thì ảnh sẽ là chính sheet đó, nên giữ
    ảnh của lần mở trước (ảnh màn app ngay trước khi devtools che lên).
  */
  const open = useCallback(() => {
    if (!config.enabled || busyRef.current) return;
    const report = bugReportRef.current;
    if (!report || viewRef.current !== 'none') {
      setView('panel');
      return;
    }
    if (!report.captureScreen) {
      setShot('none');
      setView('panel');
      return;
    }
    capture((state) => {
      setShot(state);
      setView('panel');
    });
  }, [config.enabled, capture]);
  const openRef = useRef(open);
  openRef.current = open;

  const dismiss = useCallback(() => setView('none'), []);

  /* Hàng Báo bug: dựng nháp bằng ảnh lúc mở panel (đã có nháp ⇒ giữ nguyên) rồi sang màn báo bug. */
  const openReport = useCallback(() => {
    controllerRef.current.begin(shot);
    setView('report');
  }, [shot]);

  /*
    Chụp lại (4 bước): đóng sheet báo bug → đợi nó rời hẳn màn hình (`onClosed`) → chụp →
    `retake` (chỉ đổi ảnh, chữ và các bước giữ nguyên) → mở lại form. Chụp ngay lúc bấm thì ảnh là
    chính cái sheet.

    Tín hiệu đóng có thể lỡ (màn báo bug không nối `onClosed`, hoạt ảnh đóng bị cắt, sheet bị gỡ giữa
    chừng vì app bỏ `bugReport`). Lúc đợi thì cú lắc và `open()` bị chặn, nên lỡ tín hiệu là tắt hẳn
    devtools cả phiên ⇒ có hẹn dự phòng `RETAKE_CLOSE_FALLBACK_MS`: tới hẹn thì đi tiếp như đã nhận
    `onClosed`. Bước tiếp chạy **đúng một lần** (cờ `retaking`), ai tới trước thì huỷ người kia.
  */
  const continueRetake = useCallback(() => {
    if (!retaking.current) return;
    retaking.current = false;
    clearTimeout(retakeTimer.current);
    retakeTimer.current = undefined;
    if (!bugReportRef.current) {
      /* App bỏ `bugReport` (hoặc tắt `enabled`) giữa chừng: không còn màn báo bug để quay về. */
      markBusy(false);
      setView('none');
      return;
    }
    capture((state) => {
      /* Không còn nháp (hàng đợi đã nhận bản báo, nút "Báo bug khác") ⇒ nháp mới bằng ảnh này. */
      const current = controllerRef.current;
      if (current.draft) current.retake(state);
      else current.begin(state);
      setView(bugReportRef.current ? 'report' : 'none');
    });
  }, [capture, markBusy]);

  const retake = useCallback(() => {
    if (viewRef.current !== 'report' || busyRef.current) return;
    retaking.current = true;
    markBusy(true);
    setView('none');
    retakeTimer.current = setTimeout(continueRetake, RETAKE_CLOSE_FALLBACK_MS);
  }, [markBusy, continueRetake]);

  const onReportClosed = continueRetake;

  /*
    Chia sẻ (R8, R35): `null` ⇒ nháp đang soạn, dựng bằng đúng ngữ cảnh `send` dùng
    (`controller.buildReport`); có `id` ⇒ bản báo hàng đợi đang giữ (nháp của nó đã xoá). Tin nhắn
    theo ngôn ngữ giao diện — người nhận là người QA chọn trong khay chia sẻ, không phải đích của
    kết nối. Kết quả thành câu báo trên sheet: ảnh không đi kèm được (`image-dropped`) hoặc đường
    chia sẻ của app báo lỗi (`share-failed`); câu sống tới khi sheet đóng (đóng là đổi `shareRound`,
    kết quả về muộn của lượt trước bị bỏ). Nháp không bị đụng tới. Đọc giá trị mới nhất qua ref nên
    `onShare` ổn định — chân sheet (gorhom vẽ như kiểu component) không dựng lại mỗi lượt render.
  */
  const { locale: uiLocale } = useDevToolsUi();
  const [shareNotice, setShareNotice] = useState<ReportShareNotice | undefined>(undefined);
  const sharing = useRef(false);
  const shareRound = useRef(0);
  const shareDeps = { exportFile: config.exportFile, locale: uiLocale, queue: services?.queue };
  const shareDepsRef = useRef(shareDeps);
  shareDepsRef.current = shareDeps;
  const reportOpen = view === 'report';
  useEffect(() => {
    if (reportOpen) {
      /* Lần chia sẻ của lượt mở trước có thể treo mãi (đường chia sẻ của app không bao giờ xong) —
         không được khoá nút Chia sẻ cả phiên. Kết quả muộn của nó bị bỏ nhờ `shareRound`. */
      sharing.current = false;
      return;
    }
    shareRound.current += 1;
    setShareNotice(undefined);
  }, [reportOpen]);

  const share = useCallback((reportId: string | null) => {
    if (sharing.current) return;
    sharing.current = true;
    const round = shareRound.current;
    const { exportFile, locale, queue } = shareDepsRef.current;
    const run = async (): Promise<ReportShareNotice | undefined> => {
      const report =
        reportId === null
          ? controllerRef.current.buildReport()
          : (queue?.items().find((i) => i.report.id === reportId)?.report ?? null);
      if (!report) throw new Error('No bug report to share');
      const { droppedImage } = await shareReport(report, {
        locale,
        shareFiles: bugReportRef.current?.shareFiles,
        exportFile,
        share: (message) => Share.share({ message }),
      });
      return droppedImage ? 'image-dropped' : undefined;
    };
    run()
      .catch((): ReportShareNotice => 'share-failed')
      .then((notice) => {
        /* Lượt mở đã đổi ⇒ khoá đã được mở lại lúc mở sheet, có thể đang giữ cho lần chia sẻ mới. */
        if (round !== shareRound.current) return;
        sharing.current = false;
        if (mounted.current) setShareNotice(notice);
      });
  }, []);

  /*
    Đóng hẳn chứ không quay về panel: đi qua hai hiệu ứng sheet liên tiếp thì màn nháy, và
    người vừa xem xong nhật ký hầu như luôn muốn về app. Cần panel lại thì lắc lần nữa.
  */
  const openLog = useCallback(() => setView('log'), []);
  const openPrevious = useCallback(() => setView('previous'), []);
  const previous = usePreviousSession();

  const snooze = useCallback(() => {
    setView('none');
    setSnoozed(true);
    /* Huỷ hẹn cũ trước: panel vẫn mở được lúc đang tắt lắc (dòng dev menu, `useDevTools().open`),
       tắt lắc lần hai mà không huỷ thì hẹn của lần một nổ sớm và cắt ngắn lần hai. */
    if (snoozeTimer.current) clearTimeout(snoozeTimer.current);
    snoozeTimer.current = setTimeout(
      () => setSnoozed(false),
      snoozeMinutes * MS_PER_MINUTE,
    );
  }, [snoozeMinutes]);

  const value = useMemo<DevToolsContextValue>(
    () => ({ open, isOpen: view !== 'none', enabled: config.enabled }),
    [open, view, config.enabled],
  );

  const listening =
    config.enabled && foreground && view === 'none' && !snoozed && !fromMetro && !busy;

  const reporting = bugReport !== undefined;
  const hasDraft = controller.draft !== null;
  const { previewSteps } = controller;
  /* Số bước đọc lúc panel mở (đọc bộ đệm), không mỗi render. */
  const reportRow = useMemo<DevToolsPanelReportRow | undefined>(
    () =>
      reporting
        ? {
            hasDraft,
            screenshot: shot,
            steps: panelOpen ? previewSteps() : 0,
            queue: queued,
            onPress: openReport,
          }
        : undefined,
    [reporting, hasDraft, shot, panelOpen, previewSteps, queued, openReport],
  );

  return (
    <DevToolsContext.Provider value={value}>
      {/* Bộ ghi thao tác bọc đúng cây của app: panel và các sheet là anh em, chạm trong đó không bị ghi. */}
      {bugReport ? (
        <TouchRecorder recordVisibleText={bugReport.recordVisibleText !== false}>
          {children}
        </TouchRecorder>
      ) : (
        children
      )}
      {listening ? <ShakeListener onShake={open} config={shakeConfig} /> : null}
      {config.enabled ? (
        <>
          <DevToolsPanel
            visible={view === 'panel'}
            onDismiss={dismiss}
            subtitle={config.subtitle}
            actions={actions}
            onSnooze={snooze}
            snoozeMinutes={snoozeMinutes}
            onOpenLog={config.showLog === false ? undefined : openLog}
            onOpenPrevious={previous ? openPrevious : undefined}
            sessionInfo={config.sessionInfo}
            report={reportRow}
          />
          <LogSheet
            visible={view === 'log'}
            onDismiss={dismiss}
            subtitle={config.subtitle}
            exportFile={config.exportFile}
            sessionInfo={config.sessionInfo}
          />
          {/* Sheet thứ hai chỉ để xem phiên đã lưu — cùng khuôn `LogSheet`, chế độ chỉ đọc. */}
          {previous ? (
            <LogSheet
              visible={view === 'previous'}
              onDismiss={dismiss}
              exportFile={config.exportFile}
              archive={previous}
            />
          ) : null}
          {bugReport ? (
            <ReportSheet
              visible={view === 'report'}
              onDismiss={dismiss}
              onClosed={onReportClosed}
              controller={controller}
              queue={services?.queue ?? null}
              connections={services?.connections ?? null}
              connectorTypes={connectorTypes}
              onRetake={retake}
              onShare={share}
              shareNotice={shareNotice}
              ramOnlyQueue={(services?.ramOnly ?? false) || queueStalled}
            />
          ) : null}
        </>
      ) : null}
    </DevToolsContext.Provider>
  );
};

/**
 * **Chức năng:** cửa vào công cụ gỡ lỗi bằng cú lắc máy — mount **một lần** ở gốc app.
 *
 * Bốn điều kiện phải đúng **cùng lúc** thì mới nghe cảm biến:
 * 1. `config.enabled` — cổng duy nhất, và **app** quyết định nó, không phải lib. Xem JSDoc
 *    của `DevToolsConfig.enabled` về việc vì sao không được lấy `__DEV__`.
 * 2. App đang ở **foreground** — ở nền thì cảm biến chỉ tốn pin.
 * 3. **Không** chạy từ Metro — ở đó dev menu của RN đã chiếm cú lắc; thay vào đó gate cấp
 *    một dòng *trong chính dev menu* (effect `DevSettings` bên dưới). Ngược lại, khi chạy
 *    **offline** gate tắt luôn cú lắc của dev menu (iOS) để hai bên không cùng bật.
 * 4. Chưa bị tắt tạm, và panel chưa mở.
 *
 * Cổng tự bọc `DevToolsUiProvider` theo `config.locale` · `config.strings` · `config.colorScheme` ·
 * `config.androidKeyboardInputMode` — app
 * không cần dựng provider nào của lib.
 *
 * **Input:** `config` · `actions` (các hàng, app tự dựng trong hook để `t()` gọi tại render) ·
 * `children?` (bọc cây con để nơi bên trong gọi được `useDevTools()`).
 * **Output:** ở bản prod (`enabled: false`) render **đúng `children`** — không listener,
 * không panel, và `useDevTools()` bên dưới trả bản câm. Ở dev/uat thì thêm listener + panel.
 *
 * @example
 * ```tsx
 * <Providers …>
 *   <DevToolsGate config={devToolsConfig} actions={useDevToolsActions()}>
 *     <RootNavigator />
 *   </DevToolsGate>
 * </Providers>
 *
 * // Ca biên: config.enabled === false ⇒ không đăng ký cảm biến nào, panel không hề render.
 * ```
 *
 * Có **phiên trước** trên đĩa (`startCapture({ persist })`) ⇒ panel có thêm hàng "Phiên trước"
 * (và dải báo nếu phiên đó crash), bấm vào mở một `LogSheet` chế độ chỉ đọc (`view = 'previous'`).
 *
 * Có **`config.bugReport`** (và `enabled`) ⇒ báo bug trong app:
 * - `TouchRecorder` bọc `children` (chạm trong panel/sheet không bị ghi — chúng là anh em).
 * - Mở panel (lắc · `useDevTools().open()` · dòng dev menu) khi chưa có sheet nào ⇒ **chụp màn trước**
 *   (`captureScreen`, trần 1,5 s), panel hiện sau. Lúc đang chụp không nghe lắc.
 * - Hàng "Báo bug" đứng đầu panel ⇒ `begin(ảnh)` rồi `view = 'report'`. `begin` gọi
 *   `bugReport.appContext` (mới nhất) đúng lúc này — không gọi lúc lắc. Chụp lại: đóng sheet, đợi
 *   `onClosed` của sheet (quá {@link RETAKE_CLOSE_FALLBACK_MS} thì thôi đợi), chụp, `retake`, mở lại
 *   form. Không còn nháp (hàng đợi đã nhận bản báo — nút "Báo bug khác") ⇒ `begin` bằng ảnh vừa
 *   chụp.
 * - Có `secureStore` ⇒ dựng kho kết nối + hàng đợi gửi một lần (`config` inline không làm dựng lại),
 *   `load()` khi mount (Gửi chỉ bật khi xong), `retryDue()` ngay sau khi load, khi app lên lại, khi
 *   mở panel, mỗi 60 s lúc app đang mở.
 * - `ReportSheet` nhận danh sách loại kết nối đã ghép (tên loại, `capabilities`; giữ tham chiếu khi
 *   các object loại không đổi — trang Kết nối của sheet đọc lại kho theo tham chiếu này) và
 *   `ramOnlyQueue` (hàng đợi dựng khi chưa có `LogStore` ⇒ trang kết quả nhắc "sẽ mất nếu app bị
 *   tắt"). Trang Kết nối nằm trong chính sheet.
 * - **Chia sẻ** (`onShare`, R8/R35): `null` ⇒ `controller.buildReport()` (nháp đang soạn, cùng ngữ
 *   cảnh `send`); `id` ⇒ bản báo của mục hàng đợi đó. `shareReport` với ngôn ngữ giao diện,
 *   `bugReport.shareFiles` → `config.exportFile` → `Share.share({ message })`. Ảnh không đi được ⇒
 *   `shareNotice='image-dropped'`; đường chia sẻ ném (hoặc không tìm thấy bản báo) ⇒
 *   `'share-failed'`; câu báo sống tới khi sheet đóng, nháp không bị đụng tới. Một lần chia sẻ một
 *   lúc; mở sheet là mở khoá (đường chia sẻ của app treo mãi không khoá Chia sẻ cả phiên), kết quả
 *   muộn của lượt mở trước bị bỏ.
 *
 * **Unit test:** `DevToolsGate.test.tsx` › `DevToolsGate — báo bug` — 39 case: không khai ⇒ không
 * bọc/không hàng/không hàng đợi · `enabled: false` ⇒ không gì cả · bọc `TouchRecorder` theo
 * `recordVisibleText` · lắc chụp trước panel, không chụp chồng · `open()` chụp trước · `null` ⇒
 * `blocked`, ném ⇒ `failed` · treo ⇒ `failed` sau 1,5 s · `appContext` gọi lúc mở form, không lúc
 * lắc · không hàm chụp ⇒ mở ngay · sheet đang mở thì
 * không chụp · nháp giữ qua lần lắc sau · dòng phụ đếm hàng đợi và đổi theo hàng đợi (không đếm mục
 * `blocked` của nháp đang soạn) · kho treo ⇒
 * hàng đợi RAM-only, màn báo bug nhắc · phiên crash
 * hỏng không làm sập app · Chụp lại ×2 kit
 * (`onClosed` tới trước ⇒ hẹn dự phòng huỷ) · "Báo bug khác" (không nháp ⇒ nháp mới bằng ảnh vừa
 * chụp) · loại kết nối đã ghép, giữ tham chiếu · ngữ cảnh gửi theo `reportId` (file tạm riêng,
 * không Blob) · hàng đợi chỉ ở RAM ⇔ không có `LogStore` · lỡ `onClosed` ×4 (quá hẹn vẫn chụp · lắc/`open()` bị
 * chặn lúc đợi rồi dùng lại được · gỡ gate thì huỷ hẹn · app bỏ `bugReport` giữa chừng thì về app) ·
 * Chia sẻ ×7 (nháp + `shareFiles` · `id` hàng đợi · `exportFile` + câu ảnh tới khi đóng · `Share` ·
 * bị từ chối ⇒ `share-failed`, nháp còn, lần sau thành công thì hết câu · một lần một lúc, treo mãi
 * thì mở lại sheet là chia sẻ lại được · `id` không còn) · người
 * dùng đóng thì không chụp · hàng đợi dựng một lần + `ready` · `bugReport` inline không dựng lại, đọc
 * object mới nhất · đổi tập id thì dựng lại · không `secureStore` · nhịp `retryDue`.
 *
 * **Unit test:** `DevToolsGate.test.tsx` › `DevToolsGate` (+ `cấu hình giao diện`) — 12 case: `enabled: false` ⇒ chỉ
 * render children, không mount listener · dev/uat ⇒ có listener · app xuống nền ⇒ tháo
 * listener · chạy từ Metro ⇒ không mount listener nhưng **vẫn** đăng ký dòng dev menu ·
 * `onShake` ⇒ panel mở · panel mở ⇒ tháo listener (không bắn chồng) · bấm hàng tắt lắc ⇒
 * đóng panel và không mount lại listener cho tới khi hết giờ · có phiên trước ⇒ hàng "Phiên
 * trước" mở màn phiên trước · vắng `locale` ⇒ chữ tiếng Anh · `strings` ghi đè đúng khoá được khai ·
 * `colorScheme` ép theme tối thắng hệ thống · `androidKeyboardInputMode` đi tới sheet (vắng ⇒ `adjustPan`).
 */
export const DevToolsGate = (props: DevToolsGateProps) => (
  <DevToolsUiProvider
    locale={props.config.locale}
    strings={props.config.strings}
    colorScheme={props.config.colorScheme}
    androidKeyboardInputMode={props.config.androidKeyboardInputMode}
  >
    <DevToolsGateBody {...props} />
  </DevToolsUiProvider>
);
