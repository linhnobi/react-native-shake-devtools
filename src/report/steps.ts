import type { LogEntry } from '../capture/log-entry';
import { isErrorEntry } from '../capture/log-query';
import { maskPersonalData } from '../capture/mask-label';
import type { RecordedAction, RecordedActionKind } from '../capture/recorded-action';
import type { DevToolsKey, DevToolsStrings } from '../i18n/types';
import { translate } from '../i18n/translate';

/**
 * Loại bước trong form báo bug. Gồm các loại thao tác (`RecordedActionKind`) cộng:
 * - `'screen'` — đổi màn (từ mốc màn của `markScreen`);
 * - `'error'` — một lỗi xảy ra giữa các thao tác (`label` là tóm tắt, xem `summarizeErrorEntry`);
 * - `'text'` — bước **chữ tự do**: QA đã sửa hoặc tự thêm, gửi đúng `text`, không dịch.
 */
export type ReportStepKind = 'screen' | RecordedActionKind | 'error' | 'text';

/**
 * Một bước tái hiện. Bước **có cấu trúc** (loại + nhãn) và được dựng thành câu theo ngôn ngữ lúc
 * hiện lên (`renderStep`); bước QA đã sửa chữ thì thành `kind: 'text'` kèm `text`.
 */
export interface ReportStep {
  /** Ổn định cho cùng một nguồn — để form làm khoá hàng. Dạng `<at>:<kind>:<thứ tự>`. */
  readonly id: string;
  readonly kind: ReportStepKind;
  /** Mốc thời gian (epoch ms). Bước gộp lấy mốc của lần đầu. */
  readonly at: number;
  /** Nhãn phần tử · tên màn · tóm tắt lỗi. Vắng ⇒ không biết. Đã che dữ liệu cá nhân. */
  readonly label?: string;
  /** Số lần lặp liên tiếp khi gộp (`Chạm "Tăng" ×3`). Vắng ⇒ một lần. */
  readonly count?: number;
  /** Chỉ có ở `kind: 'text'`. */
  readonly text?: string;
}

/** Số bước tối đa form hiện (lấy các bước **cuối**). */
export const MAX_FORM_STEPS = 30;

/** Số ký tự tối đa của một tóm tắt lỗi (dòng đầu của thông điệp thường đã đủ để nhận ra lỗi). */
const MAX_SUMMARY = 200;

/** Mở đầu dòng lỗi do bộ theo dõi promise reject ghi, xem `formatRejection` ở `rejection-tap.ts`. */
const REJECTION = /^Uncaught \(in promise, id: \d+\):\s*([\s\S]*)$/;

/** Các loại thao tác được gộp khi lặp liên tiếp cùng nhãn. */
const COLLAPSIBLE: ReadonlySet<ReportStepKind> = new Set(['tap', 'long-press']);

/**
 * **Chức năng:** cắt chuỗi về tối đa `max` ký tự, thêm `…` ở cuối khi có cắt. Không chẻ đôi cặp
 * surrogate (emoji) — chữ nửa emoji hiện thành ký tự rác.
 *
 * **Input:** `text` · `max` (≥ 1). **Output:** chuỗi dài ≤ `max`.
 *
 * @example
 * ```ts
 * clipText('abcdef', 4);   // 'abc…'
 * clipText('abc', 3);      // ca biên: vừa hạn mức ⇒ giữ nguyên 'abc'
 * ```
 *
 * **Unit test:** `suggest.test.ts` › `suggestReport` — case "thông điệp 5000 ký tự" và case "cắt
 * tiêu đề không chẻ đôi cặp surrogate của emoji".
 */
export const clipText = (text: string, max: number): string => {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}…`;
};

/**
 * Phần tử của file phiên đọc từ đĩa là object thật chưa — `parseSession` không kiểm từng dòng, file
 * hỏng có thể đưa `null` hay số vào mảng.
 */
export const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

/** Nhãn hợp lệ: chuỗi không rỗng. File phiên hỏng có thể đưa số/đối tượng vào — coi như vắng. */
const cleanLabel = (label: unknown): string | undefined =>
  typeof label === 'string' && label.trim() !== '' ? label : undefined;

const firstLine = (text: string): string => {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() !== '') return line.trim();
  }
  return '';
};

/**
 * Đường dẫn của URL: bỏ scheme + host, query và fragment. `https://a.com` ⇒ `/`. Không phải chuỗi
 * (file phiên hỏng — dữ liệu ngoài, không tin) ⇒ `''`, không ném.
 */
export const pathOf = (url: unknown): string => {
  if (typeof url !== 'string') return '';
  const noHost = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');
  const path = noHost.split(/[?#]/)[0];
  return path === '' ? '/' : path;
};

/**
 * **Chức năng:** tóm tắt một dòng lỗi thành **một dòng** để làm bước `error`, tiêu đề và ô "Thực
 * tế". Chữ lấy từ request/thông điệp lỗi đều đi qua `maskPersonalData` (email và chuỗi ≥ 6 chữ
 * số bị che) vì tiêu đề sẽ rời máy vào Jira/Slack của khách.
 *
 * - HTTP ⇒ `METHOD /path → status` (path bỏ host, query, fragment); lỗi vận chuyển ⇒ `→ timeout`.
 *   `url` không phải chuỗi (file phiên hỏng) ⇒ bỏ phần path: `GET → 500`, không ném.
 * - Promise reject (`uncaught`, mở đầu `Uncaught (in promise, id: N)`) ⇒ `Unhandled rejection: <dòng đầu>`.
 * - Lỗi JS / `console.error` ⇒ dòng đầu của `text` (không kèm stack).
 * - Cắt ở {@link MAX_SUMMARY} ký tự. Là chữ trung lập ngôn ngữ (giống `errors.txt`).
 *
 * **Input:** `entry`. **Output:** chuỗi một dòng; mốc ⇒ `label` của mốc.
 *
 * @example
 * ```ts
 * summarizeErrorEntry({ kind: 'network', method: 'POST', url: '/orders?token=x', status: 500, … }); // 'POST /orders → 500'
 * summarizeErrorEntry({ kind: 'console', level: 'error', text: 'TypeError: x\n  at a', … });       // 'TypeError: x'
 * summarizeErrorEntry({ kind: 'network', method: 'GET', url: '/a', error: 'timeout', … });         // 'GET /a → timeout'
 * ```
 *
 * **Unit test:** `steps.test.ts` › `summarizeErrorEntry` — 4 case: HTTP / vận chuyển / lỗi JS /
 * promise reject · bỏ query, fragment, host và che số dài trong path · `url` không phải chuỗi ·
 * cắt thông điệp dài và che email.
 */
export const summarizeErrorEntry = (entry: LogEntry): string => {
  if (entry.kind === 'marker') return entry.label;
  if (entry.kind === 'network') {
    const path = pathOf(entry.url);
    const head = path === '' ? `${entry.method}` : `${entry.method} ${maskPersonalData(path)}`;
    const outcome = entry.status ?? entry.error;
    return clipText(outcome === undefined ? head : `${head} → ${outcome}`, MAX_SUMMARY);
  }
  const text = typeof entry.text === 'string' ? entry.text : '';
  const rejection = entry.uncaught ? REJECTION.exec(text) : null;
  const line = firstLine(rejection ? rejection[1] : text);
  const masked = maskPersonalData(line);
  return clipText(rejection ? `Unhandled rejection: ${masked}` : masked, MAX_SUMMARY);
};

/** Nguồn của mốc đầu cửa sổ thời gian. */
export interface ReportWindow {
  readonly from: number;
  readonly source: 'mark' | 'sent' | 'session';
  /** Số thứ tự của mốc ⚑ (`'2'`) — chỉ có khi `source === 'mark'`. */
  readonly markLabel?: string;
}

/**
 * **Chức năng:** tính **cửa sổ thời gian** của một bug: lấy mốc **muộn nhất** trong ba mốc — ⚑
 * cuối cùng, lần gửi bug trước, lúc mở app. Bằng giờ thì chọn mốc cụ thể hơn
 * (`mark` › `sent` › `session`). Form ghi "Ghi từ mốc ⚑ #2 lúc 10:42" dựa vào `source`/`markLabel`.
 *
 * **Input:** `entries` (tìm mốc `type: 'user'` cuối) · `lastSentAt?` · `sessionStartedAt`.
 * **Output:** `ReportWindow`.
 *
 * @example
 * ```ts
 * reportWindow({ entries: [mark(400, '2')], lastSentAt: 300, sessionStartedAt: 100 });
 * // { from: 400, source: 'mark', markLabel: '2' }
 * reportWindow({ entries: [], sessionStartedAt: 100 });   // ca biên: chưa có gì ⇒ { from: 100, source: 'session' }
 * ```
 *
 * **Unit test:** `steps.test.ts` › `reportWindow` — 5 case: mốc ⚑ mới nhất kèm số · lần gửi mới
 * hơn · chỉ có lúc mở app · mốc/lần gửi cũ hơn lúc mở app · bằng giờ theo thứ tự ưu tiên.
 */
export const reportWindow = (i: {
  entries: readonly LogEntry[];
  lastSentAt?: number;
  sessionStartedAt: number;
}): ReportWindow => {
  let result: ReportWindow = { from: i.sessionStartedAt, source: 'session' };
  if (i.lastSentAt !== undefined && i.lastSentAt >= result.from) {
    result = { from: i.lastSentAt, source: 'sent' };
  }
  let lastMark: { at: number; label: string } | undefined;
  for (const e of i.entries) {
    if (e.kind === 'marker' && e.type === 'user' && (!lastMark || e.at >= lastMark.at)) {
      lastMark = { at: e.at, label: e.label };
    }
  }
  if (lastMark && lastMark.at >= result.from) {
    result = { from: lastMark.at, source: 'mark', markLabel: lastMark.label };
  }
  return result;
};

interface Item {
  readonly at: number;
  readonly seq: number;
  readonly kind: ReportStepKind;
  readonly label?: string;
}

/**
 * **Chức năng:** dựng danh sách bước của form từ thao tác đã ghi, mốc màn và dòng lỗi.
 *
 * 1. Lấy thao tác và mốc màn/lỗi có `at >= from`; mốc ⚑ của người dùng không thành bước. Lỗi chọn
 *    theo `isErrorEntry` — request thành công, `warn` và request bị huỷ **không** thành bước.
 * 2. Xếp theo `at`; bằng giờ thì thao tác đứng trước mốc màn/lỗi (chạm rồi mới đổi màn).
 * 3. Gộp các `tap` / `long-press` liên tiếp cùng nhãn thành một bước `count: N` (mốc của lần đầu).
 * 4. Giữ `max` bước **cuối**.
 *
 * Tất định: cùng đầu vào ra cùng kết quả; `id` = `<at>:<kind>:<thứ tự trong dãy đã xếp, trước khi
 * gộp>` nên bước cũ giữ nguyên `id` khi có bước mới thêm vào cuối. Nhãn không phải chuỗi (file
 * phiên hỏng) hoặc rỗng coi như vắng; phần tử không phải object (file phiên hỏng: `null`, số…) bị
 * bỏ — hàm này chạy trong lúc render panel, ném ra là sập cả app.
 *
 * **Input:** `actions` · `entries` · `from` (mốc đầu cửa sổ) · `max?` (mặc định {@link MAX_FORM_STEPS}).
 * **Output:** `ReportStep[]`, cũ → mới.
 *
 * @example
 * ```ts
 * buildSteps({ from: 0, actions: [tap(1, 'Tăng'), tap(2, 'Tăng'), tap(3, 'Tăng')], entries: [] });
 * // [{ id: '1:tap:0', kind: 'tap', at: 1, label: 'Tăng', count: 3 }]
 * ```
 *
 * **Unit test:** `steps.test.ts` › `buildSteps` — 13 case: trộn theo giờ và lọc `from` · bằng
 * giờ thì thao tác trước · gộp ×3 · không gộp khi khác nhãn/có bước chen · tap khác long-press ·
 * bỏ request ok/warn/huỷ · promise reject · cắt 30 bước cuối · gộp xong mới cắt · nhãn hỏng ·
 * bỏ mốc ⚑ · phần tử hỏng / `url` không phải chuỗi · tất định và `id` ổn định.
 */
export const buildSteps = (i: {
  actions: readonly RecordedAction[];
  entries: readonly LogEntry[];
  from: number;
  max?: number;
}): ReportStep[] => {
  const max = i.max ?? MAX_FORM_STEPS;
  const items: Item[] = [];
  let seq = 0;
  for (const a of i.actions) {
    if (!isObject(a)) continue;
    if (a.at >= i.from) items.push({ at: a.at, seq: seq++, kind: a.kind, label: cleanLabel(a.label) });
  }
  for (const e of i.entries) {
    if (!isObject(e) || e.at < i.from) continue;
    if (e.kind === 'marker') {
      if (e.type === 'screen') {
        items.push({ at: e.at, seq: seq++, kind: 'screen', label: cleanLabel(e.label) });
      }
    } else if (isErrorEntry(e)) {
      items.push({ at: e.at, seq: seq++, kind: 'error', label: summarizeErrorEntry(e) });
    }
  }
  items.sort((a, b) => a.at - b.at || a.seq - b.seq);

  const steps: ReportStep[] = [];
  items.forEach((item, index) => {
    const prev = steps[steps.length - 1];
    if (
      prev &&
      COLLAPSIBLE.has(item.kind) &&
      prev.kind === item.kind &&
      prev.label === item.label
    ) {
      steps[steps.length - 1] = { ...prev, count: (prev.count ?? 1) + 1 };
      return;
    }
    steps.push({
      id: `${item.at}:${item.kind}:${index}`,
      kind: item.kind,
      at: item.at,
      ...(item.label !== undefined ? { label: item.label } : {}),
    });
  });
  return max >= steps.length ? steps : steps.slice(steps.length - max);
};

const key = (name: string): DevToolsKey => `report.step.${name}` as DevToolsKey;

/**
 * **Chức năng:** dựng một bước thành **câu** theo ngôn ngữ của `strings`. Bước `text` trả đúng
 * `step.text` (chữ QA gõ, không dịch). Bước lặp thêm hậu tố ` ×N`. Thiếu nhãn dùng câu riêng
 * (`tapNoLabel`…) chứ không in `undefined`.
 *
 * **Input:** `step` · `strings`. **Output:** chuỗi một dòng.
 *
 * @example
 * ```ts
 * renderStep({ id: 'a', kind: 'tap', at: 0, label: 'Tăng', count: 3 }, vi);   // 'Chạm "Tăng" ×3'
 * renderStep({ id: 'b', kind: 'tap', at: 0, label: 'Pay' }, en);              // 'Tap "Pay"'
 * renderStep({ id: 'c', kind: 'text', at: 0, text: 'Mở app lạ' }, en);        // ca biên: 'Mở app lạ' — không dịch
 * ```
 *
 * **Unit test:** `steps.test.ts` › `renderStep` — 4 case: tiếng Việt · tiếng Anh · thiếu nhãn ·
 * bước `text` không dịch.
 */
export const renderStep = (step: ReportStep, strings: DevToolsStrings): string => {
  const label = step.label;
  const withLabel = (named: string, anonymous: string): string =>
    label === undefined
      ? translate(strings, key(anonymous))
      : translate(strings, key(named), { label });
  let sentence: string;
  switch (step.kind) {
    case 'text':
      return step.text ?? '';
    case 'screen':
      sentence = translate(strings, key('screen'), { label: label ?? '' });
      break;
    case 'tap':
      sentence = withLabel('tap', 'tapNoLabel');
      break;
    case 'long-press':
      sentence = withLabel('longPress', 'longPressNoLabel');
      break;
    case 'input':
      sentence = withLabel('input', 'inputNoLabel');
      break;
    case 'back':
      sentence = translate(strings, key('back'));
      break;
    case 'background':
      sentence = translate(strings, key('background'));
      break;
    case 'foreground':
      sentence = translate(strings, key('foreground'));
      break;
    case 'error':
      sentence = translate(strings, key('error'), { label: label ?? '' });
      break;
  }
  return step.count !== undefined && step.count > 1 ? `${sentence} ×${step.count}` : sentence;
};
