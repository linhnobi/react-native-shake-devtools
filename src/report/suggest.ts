import type { ConsoleEntry, LogEntry } from '../capture/log-entry';
import { isErrorEntry } from '../capture/log-query';
import type { StoredSession } from '../capture/log-session';
import { translate } from '../i18n/translate';
import type { DevToolsStrings } from '../i18n/types';
import { clipText, isObject, summarizeErrorEntry } from './steps';

/** Tiêu đề gợi ý dài nhất (ký tự) — kế hoạch chốt; Jira còn cắt thêm ở 255. */
const MAX_TITLE = 120;

/** Chữ máy điền sẵn vào form. QA đọc và sửa cả hai. */
export interface Suggestion {
  readonly title: string;
  /** Ô "Thực tế". Rỗng khi không có lỗi nào để gợi ý. */
  readonly actual: string;
  /** `id` của dòng nhật ký làm căn cứ — vắng khi không có lỗi. */
  readonly entryId?: number;
}

const isFatalEntry = (e: LogEntry): e is ConsoleEntry =>
  e.kind === 'console' && e.uncaught === true && e.fatal === true;

/** Tiền tố `[màn] `; không biết màn ⇒ rỗng (không để `[] `). */
const prefix = (screen: string | undefined): string =>
  screen === undefined || screen === '' ? '' : `[${screen}] `;

/** Màn của mốc màn cuối cùng có `at <= upTo` (mặc định: mốc màn cuối cùng). */
const screenAt = (entries: readonly LogEntry[], upTo?: number): string | undefined => {
  let found: string | undefined;
  for (const e of entries) {
    if (e.kind === 'marker' && e.type === 'screen' && (upTo === undefined || e.at <= upTo)) {
      found = e.label;
    }
  }
  return found;
};

/**
 * **Chức năng:** gợi ý **tiêu đề** và ô **"Thực tế"** từ lỗi **gần nhất** trong cửa sổ thời gian
 * (`at >= from`, theo `isErrorEntry` — request bị huỷ không phải lỗi).
 *
 * - Lỗi HTTP / lỗi JS / promise reject ⇒ `[<màn>] <tóm tắt>`, ví dụ `[Checkout] POST /orders → 500`
 *   (xem `summarizeErrorEntry`: bỏ query, che dữ liệu cá nhân). Màn = `screen` đóng dấu trên dòng
 *   lỗi, thiếu thì lấy mốc màn đứng trước nó.
 * - Lỗi fatal ⇒ `[Crash] <Name>: <message>`.
 * - Không có lỗi ⇒ `[<màn hiện tại>] ` (màn của mốc màn cuối, kể cả mốc nằm trước cửa sổ) để QA
 *   gõ tiếp, `actual` rỗng. Chưa từng có mốc màn nào ⇒ `title` là `''` — không in `[] `.
 * - Tiêu đề cắt ở 120 ký tự (kèm `…`); `actual` dùng `strings` của giao diện.
 *
 * **Input:** `entries` · `from` · `strings`. **Output:** `Suggestion`.
 *
 * @example
 * ```ts
 * suggestReport({ entries, from, strings: en });
 * // { title: '[Checkout] POST /orders → 500', actual: 'Error: POST /orders → 500', entryId: 7 }
 * suggestReport({ entries: [screen('Home')], from: 0, strings: en });   // ca biên: { title: '[Home] ', actual: '' }
 * ```
 *
 * **Unit test:** `suggest.test.ts` › `suggestReport` — 11 case: lỗi HTTP ở Checkout bỏ query ·
 * chỉ trong cửa sổ · request huỷ không phải lỗi · promise reject · màn lấy từ mốc màn trước ·
 * không lỗi ⇒ `[màn] ` · không có mốc màn · tiêu đề 5000 ký tự ≤ 120 · không chẻ surrogate ·
 * `actual` theo ngôn ngữ · lỗi fatal.
 */
export const suggestReport = (i: {
  entries: readonly LogEntry[];
  from: number;
  strings: DevToolsStrings;
}): Suggestion => {
  let latest: LogEntry | undefined;
  for (const e of i.entries) {
    if (e.at >= i.from && isErrorEntry(e)) latest = e;
  }
  if (!latest) return { title: clipText(prefix(screenAt(i.entries)), MAX_TITLE), actual: '' };

  const summary = summarizeErrorEntry(latest);
  if (isFatalEntry(latest)) {
    return {
      title: clipText(`[Crash] ${summary}`, MAX_TITLE),
      actual: translate(i.strings, 'report.suggest.actualCrash', { summary }),
      entryId: latest.id,
    };
  }
  const screen =
    (latest.kind !== 'marker' ? latest.screen : undefined) || screenAt(i.entries, latest.at);
  return {
    title: clipText(`${prefix(screen)}${summary}`, MAX_TITLE),
    actual: translate(i.strings, 'report.suggest.actual', { summary }),
    entryId: latest.id,
  };
};

/**
 * **Chức năng:** gợi ý tiêu đề và "Thực tế" cho bug báo **sau khi app crash**, từ phiên trước: dòng
 * fatal **cuối** của phiên ⇒ `[Crash] <Name>: <message>`. Phiên không còn dòng fatal (đã bị cắt khi
 * dọn) thì lùi về lỗi cuối cùng; không còn lỗi nào ⇒ `[Crash] ` để QA gõ tiếp, `actual` rỗng.
 * File phiên là dữ liệu ngoài: phần tử không phải object bị bỏ, không ném (chạy trong render panel).
 *
 * **Input:** `session` — phiên trước đã chết · `strings`. **Output:** `Suggestion`.
 *
 * @example
 * ```ts
 * suggestFromCrash(session, vi);
 * // { title: "[Crash] TypeError: Cannot read property 'id' of undefined", actual: 'Ứng dụng bị crash: …', entryId: 3 }
 * suggestFromCrash({ ...session, entries: [] }, en);   // ca biên: { title: '[Crash] ', actual: '' }
 * ```
 *
 * **Unit test:** `suggest.test.ts` › `suggestFromCrash` — 4 case: dòng fatal ⇒ `[Crash] …` ·
 * nhiều dòng fatal lấy dòng cuối và tiêu đề ≤ 120 · không còn dòng fatal · phần tử hỏng / `url` số.
 */
export const suggestFromCrash = (session: StoredSession, strings: DevToolsStrings): Suggestion => {
  let fatal: LogEntry | undefined;
  let lastError: LogEntry | undefined;
  for (const e of session.entries) {
    if (!isObject(e)) continue;
    if (isFatalEntry(e)) fatal = e;
    if (isErrorEntry(e)) lastError = e;
  }
  const source = fatal ?? lastError;
  if (!source) return { title: '[Crash] ', actual: '' };
  const summary = summarizeErrorEntry(source);
  return {
    title: clipText(`[Crash] ${summary}`, MAX_TITLE),
    actual: translate(strings, 'report.suggest.actualCrash', { summary }),
    entryId: source.id,
  };
};
