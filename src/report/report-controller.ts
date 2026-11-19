import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { actionBuffer } from '../capture/action-buffer';
import { logBuffer } from '../capture/log-buffer';
import { previousSession } from '../capture/log-persist';
import { countErrors } from '../capture/log-query';
import type { StoredSession } from '../capture/log-session';
import { markUser } from '../capture/markers';
import type { DevToolsSessionInfo } from '../capture/session-info';
import { getCaptureStartedAt } from '../capture/start-capture';
import type { DevToolsBugReportConfig } from '../gate/devtools-props';
import type { DevToolsStrings } from '../i18n/types';
import { safeInfo } from '../panel/use-log-export';
import { useDevToolsUi } from '../ui/context';
import { snapshotAppContext, type AppContextState } from './app-context';
import {
  buildBugReport,
  newReportId,
  type BugReport,
  type DevToolsCapturedImage,
  type ReportDraft,
  type ScreenshotState,
} from './bug-report';
import { isCommitted, type QueuedReport, type SendQueue } from './send-queue';
import { buildSteps, isObject, reportWindow, type ReportStep, type ReportWindow } from './steps';
import { suggestFromCrash, suggestReport, type Suggestion } from './suggest';

/** Trần chờ hàm chụp của app. Quá trần ⇒ coi như chụp hỏng, panel vẫn mở (không kẹt đóng). */
export const CAPTURE_TIMEOUT_MS = 1500;

/**
 * **Chức năng:** gọi hàm chụp màn hình của app và đổi kết quả thành `ScreenshotState` theo hợp đồng
 * spec 5.2 — **không bao giờ ném**, và **không treo quá** `timeoutMs` (hàm chụp kẹt không được giữ
 * panel đóng mãi).
 *
 * - Vắng hàm ⇒ `'none'` (form không có khối ảnh).
 * - Trả ảnh ⇒ chính ảnh đó. Trả `null` ⇒ `'blocked'` (app chặn chụp màn này).
 * - Ném (đồng bộ hay reject) ⇒ `'failed'`. Quá `timeoutMs` ⇒ `'failed'`; ảnh về muộn bị bỏ.
 *
 * **Input:** `capture?` — `DevToolsBugReportConfig.captureScreen` · `timeoutMs` (mặc định
 * {@link CAPTURE_TIMEOUT_MS}). **Output:** `Promise<ScreenshotState>`, luôn resolve.
 *
 * @example
 * ```ts
 * await takeScreenshot(config.captureScreen);   // { uri: 'file:///…jpg', … } | 'blocked' | 'failed'
 * await takeScreenshot(undefined);              // ca biên: 'none'
 * ```
 *
 * **Unit test:** `report-controller.test.ts` › `takeScreenshot` — 4 case: vắng hàm ⇒ `none` · ảnh /
 * `null` ⇒ `blocked` · ném đồng bộ hay reject ⇒ `failed` · treo ⇒ `failed` đúng ở mốc trần.
 */
export const takeScreenshot = (
  capture: (() => Promise<DevToolsCapturedImage | null>) | undefined,
  timeoutMs: number = CAPTURE_TIMEOUT_MS,
): Promise<ScreenshotState> => {
  if (!capture) return Promise.resolve('none');
  return new Promise<ScreenshotState>((resolve) => {
    let settled = false;
    const finish = (state: ScreenshotState) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(state);
    };
    const timer = setTimeout(() => finish('failed'), timeoutMs);
    let pending: Promise<DevToolsCapturedImage | null>;
    try {
      pending = Promise.resolve(capture());
    } catch {
      finish('failed');
      return;
    }
    pending.then(
      (image) => finish(image ?? 'blocked'),
      () => finish('failed'),
    );
  });
};

/** Phần QA sửa được của bản nháp. */
export type ReportDraftPatch = Partial<
  Pick<ReportDraft, 'title' | 'steps' | 'actual' | 'expected' | 'attach'>
>;

/** Bản nháp đang soạn và các hành động trên nó — thứ form báo bug (Task 15) dùng. */
export interface ReportController {
  readonly draft: ReportDraft | null;
  /**
   * Hàng đợi gửi đã đọc xong file của nó (R27) — UI chỉ bật nút Gửi khi `true`. Luôn `false` khi app
   * không cấp `secureStore` (không có hàng đợi, không gửi được).
   */
  readonly ready: boolean;
  /** Tạo nháp nếu chưa có; đã có thì GIỮ nguyên (cả ảnh lẫn các bước — nháp không tự làm mới). */
  begin(screenshot: ScreenshotState): void;
  update(patch: ReportDraftPatch): void;
  /** Chỉ đổi ảnh; chữ và các bước QA đã sửa giữ nguyên. Không có nháp ⇒ không làm gì. */
  retake(screenshot: ScreenshotState): void;
  discard(): void;
  /**
   * Dựng `BugReport` từ nháp, đợi hàng đợi đọc xong rồi `submit`. Hàng đợi **nhận** bản báo (mọi
   * trạng thái trừ `blocked`, R31) ⇒ đặt mốc ⚑ mới, nhớ mốc gửi (cửa sổ của bug sau), đánh dấu
   * crash đã báo, xoá nháp. `blocked` ⇒ giữ nháp để QA sửa; gửi lại thì mục `blocked` cũ được thay
   * bằng bản mới tới kết nối được chọn — trừ khi ticket đã có ({@link isCommitted}) và gửi lại
   * cùng kết nối: khi đó `retryNow` làm nốt mục cũ (R34).
   */
  send(connectionId: string): Promise<QueuedReport>;
  /**
   * `BugReport` của nháp đang soạn, dựng bằng **đúng** ngữ cảnh `send` dùng (bộ đệm, dòng phụ, thông
   * tin máy, phiên crash) — cho đường Chia sẻ (R8). Không gửi, không đổi nháp. Không có nháp ⇒ `null`.
   */
  buildReport(): BugReport | null;
  /** Số bước một bản nháp **mới** sẽ có nếu bắt đầu lúc này — dòng phụ của hàng "Báo bug". */
  previewSteps(): number;
  /**
   * Số lỗi `errors.txt` của nháp đang soạn sẽ chứa — số trên chip "Log lỗi (N)". Cùng nguồn với
   * `buildReport`: nháp thường ⇒ bộ đệm trong cửa sổ của nháp; nháp crash ⇒ phiên crash. Không có
   * nháp ⇒ 0.
   */
  errorCount(): number;
}

/** Nguồn dữ liệu của bộ điều khiển; đọc lại mỗi lần dùng (giá trị mới nhất của gate). */
export interface ReportControllerDeps {
  /** Bộ chuỗi giao diện — tiêu đề và "Thực tế" gợi ý dựng theo ngôn ngữ của app. */
  readonly strings: () => DevToolsStrings;
  /** Hàng đợi gửi; `null` khi app không cấp `secureStore`. */
  readonly queue: () => SendQueue | null;
  readonly subtitle?: () => string | undefined;
  /** Đã gọi an toàn (hàm của app ném ⇒ `undefined`). */
  readonly sessionInfo?: () => DevToolsSessionInfo | undefined;
  /** Phiên trước đọc từ đĩa. Mặc định `previousSession.get()`. */
  readonly previous?: () => StoredSession | null;
  /**
   * Hàm ngữ cảnh **mới nhất** của app (`bugReport.appContext`), đọc lúc dựng nháp. Vắng hoặc trả
   * `undefined` ⇒ nháp không có ngữ cảnh.
   */
  readonly appContext?: () => (() => unknown) | undefined;
}

/** Bộ điều khiển thuần (không React): bản nháp là một store ngoài, đọc bằng `useSyncExternalStore`. */
export interface ReportControllerStore extends Omit<ReportController, 'draft' | 'ready'> {
  getDraft(): ReportDraft | null;
  subscribe(listener: () => void): () => void;
}

interface Composed {
  readonly window: ReportWindow;
  readonly steps: ReportStep[];
  readonly suggestion: Suggestion;
  readonly crash: StoredSession | null;
}

/**
 * **Chức năng:** giữ **bản nháp báo bug** của lần chạy app và các hành động trên nó (spec 4, 5.1).
 *
 * - `begin` lần đầu dựng nháp từ `reportWindow` (mốc muộn nhất: ⚑ cuối · lần gửi trước · lúc mở app)
 *   + `buildSteps` + `suggestReport`, đọc `logBuffer`/`actionBuffer` **một lần** — thao tác về sau
 *   không làm đổi nháp. Đã có nháp ⇒ giữ nguyên (đóng sheet rồi lắc lại gặp đúng bản đang soạn).
 * - **Crash (R14):** phiên trước `fatal` và **chưa báo trong lần chạy này** ⇒ nháp có `crash`, các bước
 *   lấy từ thao tác + mốc màn + lỗi của phiên trước, tiêu đề/"Thực tế" từ `suggestFromCrash`, chip
 *   Phiên trước bật, chip Ảnh tắt (ảnh lúc này là màn vừa mở lại app). `previous` chỉ được đưa vào
 *   `buildBugReport` cho đúng nháp crash đó. File phiên hỏng tới mức dựng nháp crash ném ⇒ nháp
 *   thường (`begin`/`previewSteps` không bao giờ ném vì file phiên).
 * - `send` → hàng đợi **nhận** bản báo (`sent` · `pending` · `uncertain` · `failed`, R31):
 *   `markUser()` (⚑ mới), nhớ `lastSentAt`, crash đó thành "đã báo" (không còn gợi ý `[Crash]`
 *   nữa), xoá nháp — chỉ xoá khi nháp hiện tại vẫn là bản vừa gửi. Hàng đợi tự gửi lại phần còn
 *   lại; nháp không giữ lại để khỏi gửi cùng một bug hai lần.
 * - `send` → `blocked` (auth · permission · validation · kết nối mất): giữ nháp. Gửi lại nháp đó ⇒
 *   mục `blocked` cũ (cùng `report.id`, `submit` sẽ gộp vào nó) bị bỏ rồi gửi bản QA vừa sửa tới
 *   kết nối QA chọn. Ngoại lệ (R34): ticket đã có (`resume.committed`, xem {@link isCommitted}) và
 *   gửi lại **cùng** kết nối ⇒ `retryNow` làm nốt mục cũ (tránh ticket trùng; chữ sửa không áp
 *   dụng). Tiến độ upload (Slack `fileIds`, Lark `imageKey`) không phải "ticket đã có".
 * - `buildReport` → `BugReport` của nháp hiện tại, cùng hàm ráp với `send` (Chia sẻ, R8): không đụng
 *   hàng đợi (chạy được cả khi app không cấp kho bảo mật), không đổi nháp.
 * - **Ngữ cảnh app** (`deps.appContext`, F3): `begin` gọi hàm của app **một lần** qua
 *   `snapshotAppContext` — đồng bộ ⇒ nháp có ngay; async ⇒ `pending`, xong (hoặc quá trần 1,5 s) thì
 *   cập nhật nháp nếu vẫn là nháp đó. Nháp crash ⇒ không gọi. `send` lúc còn `pending` ⇒ đợi nó rồi
 *   mới dựng bản báo; `buildReport` (Chia sẻ) không đợi — còn `pending` thì bản chia sẻ không có ngữ
 *   cảnh.
 *
 * **Input:** {@link ReportControllerDeps}. **Output:** {@link ReportControllerStore}.
 *
 * @example
 * ```ts
 * const c = createReportController({ strings: () => vi, queue: () => queue });
 * c.begin(await takeScreenshot(captureScreen));
 * c.update({ title: '[Checkout] Không thanh toán được' });
 * await c.send('conn-1');   // QueuedReport; 'sent' ⇒ c.getDraft() === null
 * c.send('conn-1');         // ca biên: chưa có nháp ⇒ reject
 * ```
 *
 * **Unit test:** `report-controller.test.ts` › `createReportController` — 30 case: nháp đầu dựng từ
 * cửa sổ + bước + gợi ý · đã có nháp thì giữ, thao tác mới không đổi bước · nháp crash · phiên trước
 * không fatal · phiên crash hỏng (phần tử null, `url` số) · dựng nháp crash ném ⇒ nháp thường ·
 * update/retake/discard và người nghe · gửi `sent` (⚑, `lastSentAt`, xoá nháp, hết
 * crash) · hàng đợi nhận `pending`/`uncertain`/`failed` ×3 (như `sent`, R31) · `blocked` giữ nháp ·
 * gửi lại sau `blocked` bỏ mục cũ rồi gửi bản sửa · R34 ×4 (upload rồi + kết nối khác / cùng kết
 * nối ⇒ bản sửa; `committed` + kết nối khác ⇒ bản sửa; `committed` + cùng kết nối ⇒ `retryNow`) ·
 * đợi `load` trước `submit` · không nháp / không hàng đợi ⇒ reject · gửi xong không xoá nháp mới ·
 * `buildReport` (cùng ngữ cảnh `send`, không gửi, không hàng đợi vẫn chạy) · `previewSteps` ·
 * `errorCount` (không nháp · cửa sổ hiện tại · phiên crash) · ngữ cảnh app ×8 (đồng bộ có ngay ·
 * vắng hàm · ném · async `pending` → `ready` · treo ⇒ `timeout` · nháp huỷ không bị dựng lại · nháp
 * crash không gọi · `send` đợi `pending`).
 */
export const createReportController = (deps: ReportControllerDeps): ReportControllerStore => {
  let draft: ReportDraft | null = null;
  /** Mốc lần gửi thành công gần nhất trong lần chạy này — một trong ba mốc của cửa sổ. */
  let lastSentAt: number | undefined;
  /** Tên file phiên crash đã báo xong trong lần chạy này. */
  let reportedCrash: string | undefined;
  /** Ngữ cảnh app async đang chờ của nháp `id` — `send` đợi nó (có trần) rồi mới dựng bản báo. */
  let contextWait: { readonly id: string; readonly done: Promise<void> } | undefined;
  const listeners = new Set<() => void>();

  const set = (next: ReportDraft | null) => {
    draft = next;
    listeners.forEach((l) => l());
  };

  const previousOf = (): StoredSession | null =>
    deps.previous ? deps.previous() : previousSession.get();

  const unreportedCrash = (): StoredSession | null => {
    const p = previousOf();
    return p && p.fatal && p.name !== reportedCrash ? p : null;
  };

  /**
   * Phiên crash của một nháp crash (đúng tên phiên), phần tử hỏng (không phải object) đã bỏ; nháp
   * thường hoặc phiên đã đổi ⇒ `undefined`.
   */
  const crashSessionOf = (d: ReportDraft): StoredSession | undefined => {
    const previous = d.crash ? previousOf() : null;
    return previous && previous.name === d.crash?.sessionName
      ? { ...previous, entries: previous.entries.filter(isObject) }
      : undefined;
  };

  /**
   * Ráp `BugReport` của một nháp — một chỗ cho cả `send` lẫn `buildReport` (Chia sẻ). Nháp crash ⇒
   * `errors.txt`, `timeline.json` và `previous-session.txt` lấy từ phiên crash.
   */
  const reportOf = (d: ReportDraft): BugReport =>
    buildBugReport(d, {
      entries: logBuffer.snapshot(),
      actions: actionBuffer.snapshot(),
      subtitle: deps.subtitle?.(),
      sessionInfo: deps.sessionInfo?.(),
      sessionStartedAt: getCaptureStartedAt(),
      previous: crashSessionOf(d),
    });

  /**
   * Nháp mới sẽ trông thế nào lúc này. Chạy cả trong RENDER (dòng phụ của hàng "Báo bug" khi panel
   * mở) — ném ra ở đó là sập cả app của khách (gate bọc gốc app, không có error boundary). File
   * phiên trước là dữ liệu ngoài: dựng nháp crash từ nó ném vì một kiểu hỏng chưa lường ⇒ bỏ đường
   * crash, dựng nháp thường (QA vẫn báo được bug, chỉ mất gợi ý `[Crash]`).
   */
  const compose = (): Composed => {
    const entries = logBuffer.snapshot();
    const window = reportWindow({
      entries,
      lastSentAt,
      sessionStartedAt: getCaptureStartedAt() ?? 0,
    });
    const crash = unreportedCrash();
    if (crash) {
      try {
        /* Phiên trước là một file riêng — mọi thao tác, mốc và lỗi trong đó đều thuộc phiên đó. */
        return {
          window,
          crash,
          steps: buildSteps({ actions: crash.actions ?? [], entries: crash.entries, from: 0 }),
          suggestion: suggestFromCrash(crash, deps.strings()),
        };
      } catch {
        /* Lùi về nháp thường ngay dưới. */
      }
    }
    return {
      window,
      crash: null,
      steps: buildSteps({ actions: actionBuffer.snapshot(), entries, from: window.from }),
      suggestion: suggestReport({ entries, from: window.from, strings: deps.strings() }),
    };
  };

  return {
    getDraft: () => draft,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    begin: (screenshot) => {
      if (draft) return;
      const now = Date.now();
      const c = compose();
      const id = newReportId(now, Math.random);
      /*
        Ngữ cảnh app chụp đúng lúc dựng nháp (trạng thái lúc QA thấy bug). Nháp crash thì KHÔNG gọi:
        ngữ cảnh sau khi mở lại app không phải trạng thái lúc crash, kèm vào là chỉ sai cho dev.
        Hàm đồng bộ ⇒ có ngay; async ⇒ `pending`, xong thì cập nhật nháp (nếu vẫn là nháp này).
      */
      const read = c.crash ? undefined : deps.appContext?.();
      const snapshot = read ? snapshotAppContext(read) : undefined;
      let appContext: AppContextState | undefined;
      if (snapshot instanceof Promise) {
        appContext = { status: 'pending' };
        contextWait = {
          id,
          done: snapshot.then((state) => {
            if (draft?.id === id) set({ ...draft, appContext: state });
          }),
        };
      } else {
        appContext = snapshot;
      }
      set({
        id,
        createdAt: now,
        window: c.window,
        title: c.suggestion.title,
        steps: c.steps,
        actual: c.suggestion.actual,
        expected: '',
        screenshot,
        attach: {
          screenshot: c.crash === null,
          errors: true,
          deviceInfo: true,
          previousSession: c.crash !== null,
          appContext: true,
        },
        ...(c.crash ? { crash: { sessionName: c.crash.name } } : {}),
        ...(appContext ? { appContext } : {}),
      });
    },

    update: (patch) => {
      if (draft) set({ ...draft, ...patch });
    },

    retake: (screenshot) => {
      if (draft) set({ ...draft, screenshot });
    },

    discard: () => set(null),

    send: async (connectionId) => {
      let sending = draft;
      if (!sending) throw new Error('No bug report draft to send');
      const queue = deps.queue();
      if (!queue) throw new Error('Sending a bug report needs config.bugReport.secureStore');
      /* R27: hàng đợi chỉ chống gửi trùng theo những gì đã đọc vào RAM. */
      await queue.load();
      /* Ngữ cảnh app async chưa xong (QA bấm Gửi trong ≤ 1,5 s đầu) ⇒ đợi nó, có trần sẵn. */
      if (sending.appContext?.status === 'pending' && contextWait?.id === sending.id) {
        await contextWait.done;
        if (draft?.id === sending.id) sending = draft;
      }

      const report = reportOf(sending);

      /*
        Lần gửi trước của chính nháp này bị `blocked` (token hết hạn…) thì mục đó còn nằm trong hàng
        đợi với cùng `report.id`, và `submit` sẽ trả lại đúng mục cũ mà không gửi gì (R34):
        · ticket ĐÃ có (`committed`) và QA gửi lại CÙNG kết nối ⇒ chỉ làm nốt mục cũ — gửi bản mới
          là ticket trùng; chữ sửa thêm không áp dụng được.
        · còn lại (chưa có ticket — kể cả khi đã upload file —, hoặc QA chọn kết nối khác) ⇒ bỏ mục
          cũ, gửi bản QA vừa sửa tới kết nối được chọn.
      */
      const stale = queue.items().find((i) => i.report.id === report.id);
      let item: QueuedReport;
      if (
        stale?.state === 'blocked' &&
        isCommitted(stale) &&
        stale.connectionId === connectionId
      ) {
        item = await queue.retryNow(report.id);
      } else {
        if (stale?.state === 'blocked') await queue.discard(report.id);
        item = await queue.submit(report, connectionId);
      }

      /* R31: hàng đợi đã NHẬN bản báo (mọi trạng thái trừ `blocked`) ⇒ nó thuộc hàng đợi rồi. */
      if (item.state !== 'blocked') {
        markUser();
        lastSentAt = Date.now();
        if (sending.crash) reportedCrash = sending.crash.sessionName;
        if (draft?.id === sending.id) set(null);
      }
      return item;
    },

    buildReport: () => (draft ? reportOf(draft) : null),

    previewSteps: () => (draft ? draft.steps.length : compose().steps.length),

    errorCount: () => {
      if (!draft) return 0;
      const crashed = crashSessionOf(draft);
      if (crashed) return countErrors(crashed.entries);
      const from = draft.window.from;
      return countErrors(logBuffer.snapshot().filter((e) => e.at >= from));
    },
  };
};

/** Ngữ cảnh gate truyền cho {@link useReportController}; giá trị mới nhất được đọc lúc dùng. */
export interface ReportControllerContext {
  readonly subtitle?: string;
  readonly sessionInfo?: () => DevToolsSessionInfo;
  /** Hàng đợi gate dựng một lần; `null` khi app không cấp `secureStore`. */
  readonly queue: SendQueue | null;
  /** `queue.load()` đã xong. */
  readonly ready: boolean;
}

/**
 * **Chức năng:** hook React bọc {@link createReportController} — bộ điều khiển dựng **một lần** cho
 * cả vòng đời gate (nháp sống qua mọi lượt render, kể cả khi app truyền object `config` mới mỗi lượt),
 * render lại khi nháp đổi. Chuỗi giao diện lấy từ `DevToolsUiProvider` gần nhất.
 *
 * **Input:** `config` — `DevToolsConfig.bugReport` (vắng ⇒ bộ điều khiển câm: `begin` không làm gì,
 * `draft` luôn `null`) · `ctx` ({@link ReportControllerContext}).
 * **Output:** {@link ReportController}; tham chiếu đổi khi `draft` hoặc `ready` đổi.
 *
 * @example
 * ```tsx
 * const controller = useReportController(config.bugReport, { subtitle, sessionInfo, queue, ready });
 * controller.begin(shot);
 * // Ca biên: config.bugReport vắng ⇒ controller.draft luôn null.
 * ```
 *
 * **Unit test:** `report-controller.test.ts` › `useReportController` — 3 case: render lại khi nháp đổi,
 * `ready` theo hàng đợi, nháp giữ qua các lượt render · vắng cấu hình ⇒ không dựng nháp, không có
 * hàng đợi ⇒ `ready` luôn `false` · `appContext` mới nhất được gọi lúc dựng nháp.
 */
export const useReportController = (
  config: DevToolsBugReportConfig | undefined,
  ctx: ReportControllerContext,
): ReportController => {
  const { strings } = useDevToolsUi();
  const latest = useRef({ strings, ctx, config });
  latest.current = { strings, ctx, config };

  const [store] = useState(() =>
    createReportController({
      strings: () => latest.current.strings,
      queue: () => latest.current.ctx.queue,
      subtitle: () => latest.current.ctx.subtitle,
      sessionInfo: () => safeInfo(latest.current.ctx.sessionInfo),
      appContext: () => latest.current.config?.appContext,
    }),
  );
  const current = useSyncExternalStore(store.subscribe, store.getDraft, store.getDraft);

  const enabled = config !== undefined;
  const draft = enabled ? current : null;
  const ready = enabled && ctx.queue !== null && ctx.ready;

  return useMemo<ReportController>(
    () => ({
      draft,
      ready,
      begin: (screenshot) => {
        if (enabled) store.begin(screenshot);
      },
      update: store.update,
      retake: store.retake,
      discard: store.discard,
      send: store.send,
      buildReport: store.buildReport,
      previewSteps: store.previewSteps,
      errorCount: store.errorCount,
    }),
    [draft, ready, enabled, store],
  );
};
