import { formatErrorReport } from '../capture/format-error-report';
import type { LogEntry } from '../capture/log-entry';
import type { StoredSession } from '../capture/log-session';
import type { RecordedAction } from '../capture/recorded-action';
import { sessionInfoPairs, type DevToolsSessionInfo } from '../capture/session-info';
import type { AppContextState } from './app-context';
import type { ReportStep, ReportWindow } from './steps';
import { formatTimeline } from './timeline';

/** Ảnh màn hình do hàm chụp của app trả về. */
export interface DevToolsCapturedImage {
  readonly uri: string;
  readonly mimeType: 'image/jpeg' | 'image/png';
  readonly width: number;
  readonly height: number;
}

/**
 * Trạng thái ảnh trong form: có ảnh · `'none'` (app không cấp hàm chụp) · `'blocked'` (màn bị
 * chặn chụp) · `'failed'` (hàm chụp ném lỗi).
 */
export type ScreenshotState = DevToolsCapturedImage | 'none' | 'blocked' | 'failed';

/** Một file đính kèm: ảnh mang `uri`, file chữ mang `content`. */
export interface ReportFile {
  readonly name: string;
  readonly mimeType: string;
  readonly uri?: string;
  readonly content?: string;
}

/** Bản nháp trong form — thứ QA đang sửa trước khi gửi. */
export interface ReportDraft {
  readonly id: string;
  readonly createdAt: number;
  readonly window: ReportWindow;
  readonly title: string;
  readonly steps: readonly ReportStep[];
  readonly actual: string;
  readonly expected: string;
  readonly screenshot: ScreenshotState;
  readonly attach: {
    readonly screenshot: boolean;
    readonly errors: boolean;
    readonly deviceInfo: boolean;
    readonly previousSession: boolean;
    /** Chip "Ngữ cảnh app" — chỉ có tác dụng khi `appContext` đã `ready`. */
    readonly appContext: boolean;
  };
  /** Có ⇒ form mở từ lần crash trước. */
  readonly crash?: { readonly sessionName: string };
  /**
   * Ngữ cảnh app chụp **lúc dựng nháp** (`bugReport.appContext`), đã che. Vắng ⇒ app không cấp hàm,
   * hoặc nháp crash (ngữ cảnh lúc này không phải của phiên crash, nên không chụp).
   */
  readonly appContext?: AppContextState;
}

/** Tóm tắt ngữ cảnh app trong `BugReport` — mục "App context" của thân ticket. */
export interface ReportAppContext {
  /** `[khoá cấp đầu, giá trị một dòng]`, đã che và đã cắt (≤ 10 dòng, giá trị ≤ 100 ký tự). */
  readonly lines: ReadonlyArray<readonly [string, string]>;
  /** Số khoá cấp đầu không vào `lines` (bản đầy đủ nằm ở file `context.json`). */
  readonly more: number;
}

/** Gói báo bug dùng chung — mỗi loại kết nối chỉ dịch cấu trúc này sang định dạng của đích. */
export interface BugReport {
  readonly id: string;
  readonly createdAt: number;
  readonly title: string;
  readonly steps: readonly ReportStep[];
  readonly actual: string;
  readonly expected?: string;
  readonly subtitle?: string;
  readonly deviceInfo?: ReadonlyArray<readonly [string, string]>;
  /**
   * Tóm tắt ngữ cảnh do app cấp (`bugReport.appContext`), **đã che**. Bản đầy đủ là file
   * `context.json` trong `files`. Vắng ⇒ app không cấp, QA bỏ chip, hoặc báo về phiên crash.
   * Bản báo cũ trong hàng đợi (trước khi có trường này) không có nó.
   */
  readonly appContext?: ReportAppContext;
  readonly files: readonly ReportFile[];
}

/**
 * **Chức năng:** sinh mã báo bug `rpt-<base36 của now>-<6 ký tự base36>`. Nguồn ngẫu nhiên do
 * người gọi truyền vào để test tất định.
 *
 * **Input:** `now` (epoch ms) · `random` (trả số trong `[0, 1)`; giá trị ngoài khoảng được kẹp).
 * **Output:** chuỗi khớp `/^rpt-[0-9a-z]+-[0-9a-z]{6}$/`.
 *
 * @example
 * ```ts
 * newReportId(36, () => 0);     // 'rpt-10-000000'
 * newReportId(Date.now(), Math.random);   // vd 'rpt-mhn3k2xs-4fz9qa'
 * ```
 *
 * **Unit test:** `bug-report.test.ts` › `newReportId` — 2 case: khớp khuôn · tất định, đệm 0 và
 * `random()` sát 1.
 */
export const newReportId = (now: number, random: () => number): string => {
  const r = Math.min(Math.max(random(), 0), 1 - Number.EPSILON);
  const suffix = Math.floor(r * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `rpt-${now.toString(36)}-${suffix}`;
};

/**
 * **Chức năng:** ráp `BugReport` từ bản nháp và dữ liệu phiên — chọn file đính kèm **theo chip QA
 * bật**, giới hạn trong **cửa sổ của bug** (`draft.window.from`).
 *
 * - Chip Ảnh + có ảnh ⇒ `screenshot.jpg` / `screenshot.png` (theo `mimeType`) mang `uri`.
 * - Chip Log lỗi ⇒ `errors.txt` (`formatErrorReport` của các dòng `at >= from`, đã che) và
 *   `timeline.json` (`formatTimeline`, không thân/header).
 * - **Nháp crash** (`draft.crash`) + `previous` đúng phiên đó ⇒ `errors.txt` và `timeline.json` lấy
 *   từ **phiên crash** (từ đầu phiên, giờ bắt đầu của phiên đó) — cùng nguồn với các bước và
 *   `previous-session.txt`; phiên hiện tại (sau khi mở lại app) không liên quan tới bug.
 * - Chip Thông tin máy + có `sessionInfo` ⇒ `deviceInfo`; tắt ⇒ `undefined`, và `errors.txt`
 *   cũng không in thông tin máy.
 * - Chip Ngữ cảnh app + `draft.appContext` đã `ready` ⇒ `context.json` (JSON đã che, nguyên văn
 *   bản chụp) và `appContext` (`lines`, `more`) cho thân ticket. Chưa chụp xong, chụp hỏng, chip
 *   tắt ⇒ không có cả hai. **Nháp crash ⇒ không bao giờ có**, kể cả khi nháp lỡ mang ngữ cảnh:
 *   ngữ cảnh chụp sau khi mở lại app không phải trạng thái lúc crash.
 * - Chip Phiên trước + có `previous` ⇒ `previous-session.txt` (`formatErrorReport` của phiên đó,
 *   `source: 'previous session'`; không lọc theo cửa sổ vì là phiên khác).
 * - `expected` rỗng/chỉ khoảng trắng ⇒ `undefined`.
 *
 * **Input:** `draft` · `ctx` (`entries`, `actions`, `subtitle?`, `sessionInfo?`,
 * `sessionStartedAt?`, `previous?`). **Output:** `BugReport` — thứ tự file: ảnh · errors ·
 * timeline · context · previous-session.
 *
 * @example
 * ```ts
 * buildBugReport(draft, { entries: logBuffer.snapshot(), actions: actionBuffer.snapshot(),
 *   subtitle: 'UAT · 1.0.2', sessionInfo, sessionStartedAt });
 * // { id, title, steps, actual, expected, deviceInfo, files: [screenshot.jpg, errors.txt, timeline.json] }
 * buildBugReport({ ...draft, expected: '' }, ctx).expected;   // ca biên: undefined
 * ```
 *
 * **Unit test:** `bug-report.test.ts` › `buildBugReport` — 15 case: ảnh jpg · ảnh png · chip
 * Ảnh tắt hoặc không có ảnh · Log lỗi bật ⇒ errors + timeline trong cửa sổ · Log lỗi tắt · che
 * header/thân · phiên crash do bản cũ ghi (token base64 chưa che) vẫn bị che lúc xuất · deviceInfo
 * theo chip · `sessionStartedAt` · Phiên trước · nháp crash ⇒ errors + timeline của phiên crash ·
 * ngữ cảnh app ⇒ context.json + tóm tắt · ngữ cảnh tắt/chưa xong/hỏng/vắng · nháp crash không kèm
 * ngữ cảnh · `expected` rỗng.
 */
export const buildBugReport = (
  draft: ReportDraft,
  ctx: {
    entries: readonly LogEntry[];
    actions: readonly RecordedAction[];
    subtitle?: string;
    sessionInfo?: DevToolsSessionInfo;
    sessionStartedAt?: number;
    previous?: StoredSession;
  },
): BugReport => {
  /*
    Nháp crash: các bước lấy từ phiên crash (từ đầu phiên đó), nên errors.txt và timeline.json cũng
    lấy từ đó — cùng nguồn với các bước và previous-session.txt. Phiên hiện tại (sau khi mở lại app)
    không liên quan tới bug này.
  */
  const crashed =
    draft.crash !== undefined && ctx.previous?.name === draft.crash.sessionName
      ? ctx.previous
      : undefined;
  const entries = crashed ? crashed.entries : ctx.entries;
  const actions = crashed ? (crashed.actions ?? []) : ctx.actions;
  const from = crashed ? 0 : draft.window.from;
  const startedAt = crashed ? crashed.startedAt : ctx.sessionStartedAt;
  const showInfo = draft.attach.deviceInfo && ctx.sessionInfo !== undefined;
  const files: ReportFile[] = [];

  const shot = draft.screenshot;
  if (draft.attach.screenshot && typeof shot === 'object') {
    files.push({
      name: shot.mimeType === 'image/png' ? 'screenshot.png' : 'screenshot.jpg',
      mimeType: shot.mimeType,
      uri: shot.uri,
    });
  }

  if (draft.attach.errors) {
    files.push({
      name: 'errors.txt',
      mimeType: 'text/plain',
      content: formatErrorReport(
        entries.filter((e) => e.at >= from),
        {
          generatedAt: draft.createdAt,
          build: ctx.subtitle,
          info: showInfo ? ctx.sessionInfo : undefined,
          sessionStartedAt: showInfo ? startedAt : undefined,
        },
      ),
    });
    files.push({
      name: 'timeline.json',
      mimeType: 'application/json',
      content: formatTimeline({ actions, entries, from }),
    });
  }

  /* Nháp crash: ngữ cảnh lúc này (sau khi mở lại app) không phải của phiên crash — không kèm. */
  const appContext =
    draft.crash === undefined && draft.attach.appContext && draft.appContext?.status === 'ready'
      ? draft.appContext
      : undefined;
  if (appContext) {
    files.push({ name: 'context.json', mimeType: 'application/json', content: appContext.json });
  }

  if (draft.attach.previousSession && ctx.previous) {
    files.push({
      name: 'previous-session.txt',
      mimeType: 'text/plain',
      content: formatErrorReport(ctx.previous.entries, {
        generatedAt: draft.createdAt,
        build: ctx.previous.build,
        sessionStartedAt: ctx.previous.startedAt,
        source: 'previous session',
      }),
    });
  }

  const expected = draft.expected.trim() === '' ? undefined : draft.expected;
  return {
    id: draft.id,
    createdAt: draft.createdAt,
    title: draft.title,
    steps: draft.steps,
    actual: draft.actual,
    expected,
    subtitle: ctx.subtitle,
    deviceInfo: showInfo
      ? sessionInfoPairs(ctx.sessionInfo as DevToolsSessionInfo, ctx.sessionStartedAt)
      : undefined,
    ...(appContext ? { appContext: { lines: appContext.lines, more: appContext.more } } : {}),
    files,
  };
};
