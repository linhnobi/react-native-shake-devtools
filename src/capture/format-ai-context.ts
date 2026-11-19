import { prettyBody } from './format-error-report';
import { formatDateTime, formatTime } from './format-log';
import type { ConsoleEntry, LogEntry, NetworkEntry } from './log-entry';
import { DEFAULT_SLOW_MS, countErrors, isErrorEntry, isSlowEntry } from './log-query';
import { maskPersonalData } from './mask-label';
import type { RecordedAction } from './recorded-action';
import { redactHeaders, redactText, redactUrl } from './redact';
import { sessionInfoPairs, type DevToolsSessionInfo } from './session-info';

/**
 * Trần mặc định của khối "Chép cho AI", tính bằng **ký tự** (≈ 40 KB với chữ ASCII). Đủ chỗ cho vài
 * stack, chục request lỗi kèm thân và vài chục bước, mà vẫn là một lần dán gọn vào ô chat của agent
 * lập trình — dán cả vòng đệm (300 dòng, thân tới 4000 ký tự mỗi bên) là nhấn chìm cửa sổ ngữ cảnh.
 */
export const AI_CONTEXT_MAX_CHARS = 40_000;

/** Đầu vào của {@link formatAiContext}. Cùng nghĩa với `ErrorReportMeta` ở các trường trùng tên. */
export interface AiContextOptions {
  /** Mốc dựng khối (`Date.now()`) — dòng `Generated`. */
  readonly generatedAt: number;
  /** Dòng phụ môi trường của app, vd `'UAT · 1.0.2'` (`DevToolsConfig.subtitle`). */
  readonly build?: string;
  /** Bản build · máy · user (**đã che** ở app) — `DevToolsConfig.sessionInfo`. */
  readonly info?: DevToolsSessionInfo;
  /** Mốc bắt đầu thu nhật ký — dòng `Session`. */
  readonly sessionStartedAt?: number;
  /** Nhãn nguồn khi dựng từ **phiên trước**, vd `'previous session'`. */
  readonly source?: string;
  /**
   * Thao tác QA đã ghi (`actionBuffer.snapshot()`, hoặc `StoredSession.actions`) — chỉ có khi app bật
   * báo bug. Vắng ⇒ phần "Recent steps" chỉ còn mốc màn, request và lỗi.
   */
  readonly actions?: readonly RecordedAction[];
  /** Trần ký tự của cả khối. Mặc định {@link AI_CONTEXT_MAX_CHARS}. */
  readonly maxChars?: number;
  /** Ngưỡng "chậm" (ms). Mặc định `DEFAULT_SLOW_MS`. */
  readonly slowMs?: number;
}

/* ────────────────────────────── Hạn mức ────────────────────────────── */

/** Số mục tối đa mỗi nhóm — chặn một vòng lặp lỗi hay request polling chiếm hết khối. */
const MAX_UNCAUGHT = 10;
const MAX_FAILED = 15;
const MAX_CONSOLE_ERRORS = 20;
const MAX_STEPS = 40;
const MAX_SLOW = 10;
const MAX_WARNINGS = 15;

/** Số ký tự tối đa của từng phần trong một mục. */
const STACK_CHARS = 4000;
const BODY_CHARS = 2000;
const CONSOLE_CHARS = 1000;
const STEP_CHARS = 200;
const VALUE_CHARS = 200;
/** Bản rút gọn của một lỗi không ai bắt giữ bấy nhiêu dòng đầu của stack. */
const COMPACT_STACK_LINES = 12;
/**
 * Chỗ chừa cho các dòng ghi chú (đã cắt bao nhiêu, dòng `Truncated`) và khối rào dài thêm khi nội
 * dung có dấu backtick — những thứ chỉ biết sau khi chọn xong.
 */
const NOTES_RESERVE = 600;
/** Phần cách giữa hai mục (`\n\n`) — tính vào giá của mỗi mục. */
const ITEM_GAP = 2;

/* ────────────────────────────── Chữ ────────────────────────────── */

const TITLE = '# Debug context from a React Native app';
const INSTRUCTION =
  '> **For the coding agent:** find the root cause of the errors below in this codebase and ' +
  'propose a fix. Captured on a device by react-native-shake-devtools; secrets are masked as ' +
  '`<redacted>` and long bodies are cut.';
const NONE = '_None captured._';
const COMPACT_REQUEST_NOTE = '_Headers and bodies left out to stay under the size limit._';
const REJECTION = /^Uncaught \(in promise\b/;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * Trường chữ **tuỳ chọn** của một dòng (`screen`, `error`): file phiên trên đĩa là dữ liệu ngoài và
 * `parseSession` chỉ kiểm trường bắt buộc ⇒ sai kiểu coi như vắng.
 */
const optionalText = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** Cắt `text` về `max` ký tự mà không chẻ đôi cặp surrogate (emoji). */
const safeSlice = (text: string, max: number): string => {
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
};

/** Cắt khối nhiều dòng, ghi số ký tự bị bỏ ở một dòng riêng (đọc được trong khối rào). */
const clipBlock = (text: string, max: number): { text: string; cut: boolean } =>
  text.length <= max
    ? { text, cut: false }
    : { text: `${safeSlice(text, max)}\n… [${text.length - max} more characters cut]`, cut: true };

/** Cắt một dòng, thêm `…` khi có cắt. */
const clipLine = (text: string, max: number): string =>
  text.length <= max ? text : `${safeSlice(text, max - 1)}…`;

/** Gộp mọi khoảng trắng (cả xuống dòng) thành một dấu cách — cho tiêu đề và dòng một hàng. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

const firstLine = (text: string): string => {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() !== '') return line.trim();
  }
  return '';
};

/** Dãy backtick liền nhau dài nhất trong `text`. */
const longestTickRun = (text: string): number => {
  let max = 0;
  let run = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 96) {
      run += 1;
      if (run > max) max = run;
    } else run = 0;
  }
  return max;
};

/** Khối rào Markdown — rào dài hơn mọi dãy backtick bên trong, để thân chứa ``` không phá khối. */
const fenced = (body: string, lang: string): string => {
  const ticks = '`'.repeat(Math.max(3, longestTickRun(body) + 1));
  return `${ticks}${lang}\n${body}\n${ticks}`;
};

/** Mã nội dòng — cùng luật rào như {@link fenced}. */
const inline = (text: string): string => {
  const ticks = '`'.repeat(longestTickRun(text) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${text}${pad}${ticks}`;
};

/**
 * Đường dẫn của URL: bỏ scheme + host, query và fragment — cùng luật với `pathOf` của
 * `src/report/steps.ts` (tầng `capture` không import từ `report`). Không phải chuỗi ⇒ `''`.
 */
const pathOf = (url: unknown): string => {
  if (typeof url !== 'string') return '';
  const path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '').split(/[?#]/)[0];
  return path === '' ? '/' : path;
};

/** Kết cục của request, như `formatLog`: lỗi vận chuyển · status · `pending`. */
const outcomeOf = (entry: NetworkEntry): string => {
  const error = optionalText(entry.error);
  if (error !== undefined) return oneLine(redactText(error));
  return entry.status === undefined ? 'pending' : String(entry.status);
};

/** `screen \`Checkout\`` cho dòng có màn hợp lệ; không có ⇒ mảng rỗng. */
const screenPart = (screen: unknown): string[] => {
  const name = optionalText(screen);
  return name === undefined ? [] : [`screen ${inline(oneLine(redactText(name)))}`];
};

/* ────────────────────────────── Gộp mục lặp ────────────────────────────── */

interface Group<T> {
  entry: T;
  /** Vị trí của lần **mới nhất** trong đầu vào — phân xử khi hai mục cùng `at`. */
  order: number;
  count: number;
}

/**
 * Gộp các mục **y hệt** theo `key` (vòng lặp lỗi, request polling hỏng): mỗi nhóm giữ lần mới nhất và
 * số lần. Ra theo thứ tự lần đầu xuất hiện; người gọi tự xếp.
 */
const groupBy = <T extends LogEntry>(
  items: ReadonlyArray<{ entry: T; order: number }>,
  key: (entry: T) => string,
): Group<T>[] => {
  const groups = new Map<string, Group<T>>();
  for (const { entry, order } of items) {
    const k = key(entry);
    const group = groups.get(k);
    if (!group) groups.set(k, { entry, order, count: 1 });
    else {
      group.count += 1;
      if (entry.at > group.entry.at || (entry.at === group.entry.at && order > group.order)) {
        group.entry = entry;
        group.order = order;
      }
    }
  }
  return [...groups.values()];
};

/* ────────────────────────────── Mục ứng viên ────────────────────────────── */

type PoolId = 'uncaught' | 'failed' | 'consoleErrors' | 'steps' | 'slow' | 'warnings';
type SectionId = 'uncaught' | 'steps' | 'requests' | 'console';

/** Một mục có thể đưa vào khối. `compact` — bản ngắn hơn, dùng khi bản đủ không còn vừa. */
interface Candidate {
  readonly at: number;
  readonly order: number;
  readonly full: string;
  readonly compact?: string;
}

interface Pool {
  readonly id: PoolId;
  readonly section: SectionId;
  readonly max: number;
  /** Mới → cũ. */
  readonly candidates: readonly Candidate[];
}

const newestFirst = (a: Candidate, b: Candidate) => b.at - a.at || b.order - a.order;
const oldestFirst = (a: Candidate, b: Candidate) => a.at - b.at || a.order - b.order;

const uncaughtLabel = (entry: ConsoleEntry): string =>
  entry.fatal ? 'FATAL' : REJECTION.test(entry.text) ? 'UNHANDLED REJECTION' : 'UNCAUGHT';

const uncaughtCandidate = ({ entry, order, count }: Group<ConsoleEntry>): Candidate => {
  const heading = [
    `### ${uncaughtLabel(entry)} at ${formatTime(entry.at)}`,
    ...screenPart(entry.screen),
    ...(count > 1 ? [`×${count}`] : []),
  ].join(' · ');
  const text = clipBlock(redactText(entry.text), STACK_CHARS).text;
  const lines = text.split('\n');
  const compact =
    lines.length > COMPACT_STACK_LINES
      ? `${heading}\n\n${fenced(
          [
            ...lines.slice(0, COMPACT_STACK_LINES),
            `… [${lines.length - COMPACT_STACK_LINES} more lines cut]`,
          ].join('\n'),
          'text',
        )}`
      : undefined;
  return { at: entry.at, order, full: `${heading}\n\n${fenced(text, 'text')}`, compact };
};

/** Thân đã che, dàn đẹp nếu là JSON, rồi cắt — kèm ngôn ngữ của khối rào. */
const bodyBlock = (
  label: string,
  raw: string | undefined,
  truncatedAtCapture: boolean | undefined,
  skipped: string | undefined,
): string | undefined => {
  const pretty = prettyBody(raw);
  if (pretty === undefined) return skipped ? `${label}: not captured (${skipped})` : undefined;
  const { text, cut } = clipBlock(pretty, BODY_CHARS);
  const lang = /^\s*[[{]/.test(text) ? 'json' : 'text';
  return `${label}${cut || truncatedAtCapture ? ' (truncated)' : ''}:\n\n${fenced(text, lang)}`;
};

const requestCandidate = (
  { entry, order, count }: Group<NetworkEntry>,
  slowMs: number,
): Candidate => {
  const took = entry.durationMs === undefined ? '' : ` · ${entry.durationMs} ms`;
  const heading = `### ${inline(`${entry.method} ${oneLine(redactUrl(entry.url))}`)} → ${outcomeOf(entry)}${took}`;
  const meta = [
    `At ${formatTime(entry.at)}`,
    ...screenPart(entry.screen),
    ...(isSlowEntry(entry, slowMs) ? ['slow'] : []),
    ...(count > 1 ? [`×${count}`] : []),
  ].join(' · ');

  const headers = Object.entries(redactHeaders({ ...(entry.requestHeaders ?? {}) }));
  const details = [
    ...(headers.length > 0
      ? [
          `Request headers: ${headers
            .map(([name, value]) => inline(clipLine(oneLine(`${name}: ${value}`), VALUE_CHARS)))
            .join(' · ')}`,
        ]
      : []),
    bodyBlock('Request body', entry.requestBody, entry.requestTruncated, entry.requestBodySkipped),
    bodyBlock('Response body', entry.responseBody, entry.responseTruncated, entry.responseBodySkipped),
  ].filter((part): part is string => part !== undefined);

  const head = `${heading}\n\n${meta}`;
  return {
    at: entry.at,
    order,
    full: [head, ...details].join('\n\n'),
    compact: details.length > 0 ? `${head}\n\n${COMPACT_REQUEST_NOTE}` : undefined,
  };
};

const consoleCandidate = ({ entry, order, count }: Group<ConsoleEntry>): Candidate => {
  const [first, ...rest] = clipBlock(redactText(entry.text), CONSOLE_CHARS).text.split('\n');
  const level = entry.level.toUpperCase().padEnd(5);
  const head = `${formatTime(entry.at)}  ${level}  ${first}${count > 1 ? ` ×${count}` : ''}`;
  return {
    at: entry.at,
    order,
    full: [head, ...rest.map((line) => `    ${line.trim()}`)].join('\n'),
  };
};

interface Step {
  readonly at: number;
  readonly order: number;
  readonly kind: string;
  readonly text: string;
}

/**
 * Dòng thời gian: thao tác QA + mốc màn + mốc ⚑ + mọi request + lỗi (`console.error`, kể cả lỗi
 * không ai bắt). Chữ qua `maskPersonalData` như `timeline.json`; request chỉ còn đường dẫn. Bằng
 * giờ thì thao tác đứng trước (chạm rồi mới đổi màn). Dòng y hệt liên tiếp gộp `×N`, giờ lần đầu.
 */
const stepCandidates = (
  entries: readonly LogEntry[],
  actions: readonly RecordedAction[],
): Candidate[] => {
  const steps: Step[] = [];
  actions.forEach((a, i) => {
    if (typeof a !== 'object' || a === null) return;
    const label = typeof a.label === 'string' && a.label.trim() !== '' ? a.label : undefined;
    steps.push({
      at: a.at,
      order: i,
      kind: a.kind,
      text: label === undefined ? '' : `"${maskPersonalData(oneLine(label))}"`,
    });
  });
  const base = actions.length;
  entries.forEach((e, i) => {
    const order = base + i;
    if (e.kind === 'marker') {
      steps.push(
        e.type === 'screen'
          ? { at: e.at, order, kind: 'screen', text: maskPersonalData(oneLine(e.label)) }
          : { at: e.at, order, kind: 'mark', text: `#${e.label}` },
      );
    } else if (e.kind === 'network') {
      const took = e.durationMs === undefined ? '' : ` ${e.durationMs}ms`;
      steps.push({
        at: e.at,
        order,
        kind: 'request',
        text: `${e.method} ${maskPersonalData(pathOf(e.url))} → ${maskPersonalData(outcomeOf(e))}${took}`,
      });
    } else if (e.level === 'error') {
      steps.push({ at: e.at, order, kind: 'error', text: maskPersonalData(firstLine(e.text)) });
    }
  });
  steps.sort((a, b) => a.at - b.at || a.order - b.order);

  const collapsed: Array<Step & { count: number }> = [];
  for (const step of steps) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev.kind === step.kind && prev.text === step.text) prev.count += 1;
    else collapsed.push({ ...step, count: 1 });
  }
  return collapsed
    .map((s) => ({
      at: s.at,
      order: s.order,
      full: `${formatTime(s.at)}  ${s.kind.padEnd(10)} ${clipLine(s.text, STEP_CHARS)}${
        s.count > 1 ? ` ×${s.count}` : ''
      }`.trimEnd(),
    }))
    .sort(newestFirst);
};

/* ────────────────────────────── Chọn trong trần ────────────────────────────── */

interface Pick {
  readonly pool: Pool;
  readonly candidate: Candidate;
  readonly text: string;
}

/**
 * Chọn mục theo **vòng**: mỗi vòng, từng nhóm theo thứ tự ưu tiên lấy mục **mới nhất** còn lại của
 * nó nếu còn vừa (bản đủ, không vừa thì bản rút gọn). Mục mới nhất không vừa ⇒ nhóm đó dừng — không
 * nhảy qua lấy mục cũ hơn mà nhỏ hơn, để thứ còn lại luôn là phần **mới nhất** của nhóm. Nhờ chia vòng,
 * nhóm nặng nhất cũng không ăn hết chỗ của các nhóm sau.
 */
const choose = (pools: readonly Pool[], budget: number): { picks: Pick[]; shortened: boolean } => {
  const picks: Pick[] = [];
  const taken = new Map<PoolId, number>(pools.map((p) => [p.id, 0]));
  const open = new Set<PoolId>(pools.map((p) => p.id));
  let left = budget;
  let shortened = false;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const pool of pools) {
      if (!open.has(pool.id)) continue;
      const n = taken.get(pool.id) ?? 0;
      const candidate = pool.candidates[n];
      if (candidate === undefined || n >= pool.max) {
        open.delete(pool.id);
        continue;
      }
      let text = candidate.full;
      if (text.length + ITEM_GAP > left) {
        if (candidate.compact === undefined || candidate.compact.length + ITEM_GAP > left) {
          open.delete(pool.id);
          continue;
        }
        text = candidate.compact;
        shortened = true;
      }
      left -= text.length + ITEM_GAP;
      picks.push({ pool, candidate, text });
      taken.set(pool.id, n + 1);
      progressed = true;
    }
  }
  return { picks, shortened };
};

/* ────────────────────────────── Dựng chữ ────────────────────────────── */

const SECTIONS: ReadonlyArray<{
  readonly id: SectionId;
  readonly title: string;
  readonly one: string;
  readonly many: string;
  /** Mục là dòng trong **một** khối rào chung (bước, console), không phải khối riêng. */
  readonly lines: boolean;
}> = [
  { id: 'uncaught', title: 'Uncaught errors and unhandled rejections', one: 'error', many: 'errors', lines: false },
  { id: 'steps', title: 'Recent steps', one: 'step', many: 'steps', lines: true },
  { id: 'requests', title: 'Failed and slow requests', one: 'request', many: 'requests', lines: false },
  { id: 'console', title: 'Console errors and warnings', one: 'console line', many: 'console lines', lines: true },
];

const render = (
  head: readonly string[],
  pools: readonly Pool[],
  picks: readonly Pick[],
  truncatedLine: string | undefined,
): string => {
  const blocks: string[] = [
    [...head, ...(truncatedLine ? [truncatedLine] : [])].join('\n'),
  ];
  for (const s of SECTIONS) {
    const mine = picks.filter((p) => p.pool.section === s.id);
    const total = pools
      .filter((p) => p.section === s.id)
      .reduce((n, p) => n + p.candidates.length, 0);
    const omitted = total - mine.length;
    const items = mine
      .slice()
      .sort((a, b) => oldestFirst(a.candidate, b.candidate))
      .map((p) => p.text);
    const parts = [`## ${s.title}`];
    if (items.length === 0) parts.push(total === 0 ? NONE : '');
    else parts.push(s.lines ? fenced(items.join('\n'), 'text') : items.join('\n\n'));
    if (omitted > 0) parts.push(`_${plural(omitted, `more ${s.one}`, `more ${s.many}`)} not included._`);
    blocks.push(parts.filter((p) => p !== '').join('\n\n'));
  }
  return `${blocks.join('\n\n')}\n`;
};

/**
 * **Chức năng:** dựng khối **Markdown "Chép cho AI"**: một lần dán vào agent lập trình (Claude Code,
 * Cursor, Copilot) là đủ để nó bắt đầu dò lỗi. Gồm: một dòng dặn agent · thông tin app/máy/phiên ·
 * lỗi không ai bắt và promise reject kèm stack · các bước gần đây · request lỗi (status ≥ 400 hoặc
 * lỗi vận chuyển) và request chậm, có method, URL đã che, kết cục, thời lượng, header và thân đã che
 * và cắt · lỗi và cảnh báo console gần đây.
 *
 * ## Vì sao một định dạng riêng, không dùng lại `errors.txt`
 *
 * `errors.txt` là file cho **người** (BE mở bằng trình soạn thảo), không có trần kích thước và không
 * có các bước. Agent cần thứ khác: tiêu đề Markdown để biết phần nào là gì, khối rào để biết đâu là
 * stack/thân, và một trần cứng để không nhấn chìm cửa sổ ngữ cảnh.
 *
 * ## Trần kích thước: giữ cái **nặng nhất** và **mới nhất**
 *
 * Mỗi nhóm có số mục tối đa, và cả khối có trần `maxChars`. Chọn theo vòng, nhóm theo thứ tự ưu tiên
 * (lỗi không ai bắt › request lỗi › `console.error` › bước › request chậm › `console.warn`), trong
 * nhóm lấy từ mới nhất. Mục không vừa thì thử bản rút gọn (request bỏ header/thân, stack còn 12
 * dòng) trước khi bỏ. Có cắt ⇒ dòng `Truncated` ở đầu và ghi chú "N more … not included" cuối nhóm.
 * Mục lặp y hệt gộp `×N`. Trong mỗi nhóm, mục in theo giờ cũ → mới.
 *
 * 🔴 **Che như khối Chia sẻ**: URL qua `redactUrl`, header qua `redactHeaders`, thân qua
 * `redactBody` (trong `prettyBody`), chữ console và stack qua `redactText`, bước qua
 * `maskPersonalData` như `timeline.json`. Tên riêng của app (`startCapture({ redactKeys })`) áp ở
 * mọi chỗ đó. **Không bao giờ** có lệnh cURL thô (không gọi `toCurl`), và không có chữ người dùng gõ
 * vào ô nhập (bước `input` chỉ mang nhãn của ô). Thân response vẫn còn dữ liệu nghiệp vụ.
 *
 * Trung lập ngôn ngữ (tiếng Anh kỹ thuật, không i18n), cùng lý do với `formatLog`. Thuần, tất định:
 * cùng đầu vào ra cùng chuỗi (không đọc giờ máy ngoài `formatTime`/`formatDateTime`).
 *
 * **Input:** `entries` — ảnh chụp buffer (cũ→mới) hoặc dòng của phiên trước · `options`
 * ({@link AiContextOptions}).
 * **Output:** chuỗi Markdown kết thúc bằng `\n`, dài **không quá** `maxChars` (trừ khi riêng phần đầu
 * đã dài hơn trần — phần đầu luôn được giữ). Nhóm rỗng ghi `_None captured._`.
 *
 * ⚠️ Chưa đo kích thước thật trên máy với nhật ký của một app thật; trần tính bằng ký tự, không phải
 * byte (chữ tiếng Việt có dấu tốn 2–3 byte UTF-8 mỗi ký tự).
 *
 * @example
 * ```ts
 * formatAiContext(logBuffer.snapshot(), { generatedAt: Date.now(), build: 'UAT · 1.0.2',
 *   info: sessionInfo(), sessionStartedAt: getCaptureStartedAt(), actions: actionBuffer.snapshot() });
 * // # Debug context from a React Native app
 * //
 * // > **For the coding agent:** find the root cause of the errors below …
 * //
 * // ## App and session
 * // - Generated: 2026-11-18 14:26:40 +07:00
 * // …
 * // ## Failed and slow requests
 * // ### `POST https://api.example.com/orders` → 500 · 812 ms
 * formatAiContext([], { generatedAt: 0 });  // ca biên: đủ đầu khối, mọi nhóm `_None captured._`
 * ```
 *
 * **Unit test:** `format-ai-context.test.ts` › `formatAiContext` — 15 case: đầu khối (tiêu đề, một
 * dòng dặn, thông tin, số đếm) · thứ tự section + rỗng + tất định · `screen`/`error` sai kiểu (file
 * phiên hỏng) không ném · `source` · nhãn
 * FATAL/UNCAUGHT/UNHANDLED REJECTION có stack, không lặp ở console · lỗi lặp gộp `×N` · request lỗi
 * và chậm, bỏ ổn/đang chờ/bị huỷ · request lặp gộp · che header/thân, thân không ghi được · thân dài
 * bị cắt, rào dài hơn backtick trong thân · che console + `redactKeys`, không có cURL · các bước theo
 * giờ, nhãn nhập đã che, chạm lặp gộp · console lỗi/cảnh báo, bỏ info/debug · trần 40000 giữ lỗi
 * nặng và mục mới · `maxChars` nhỏ dùng bản rút gọn.
 */
export const formatAiContext = (
  entries: readonly LogEntry[],
  options: AiContextOptions,
): string => {
  const maxChars = options.maxChars ?? AI_CONTEXT_MAX_CHARS;
  const slowMs = options.slowMs ?? DEFAULT_SLOW_MS;

  const indexed = entries.map((entry, order) => ({ entry, order }));
  const consoles = indexed.filter(
    (x): x is { entry: ConsoleEntry; order: number } => x.entry.kind === 'console',
  );
  const networks = indexed.filter(
    (x): x is { entry: NetworkEntry; order: number } => x.entry.kind === 'network',
  );

  const uncaught = groupBy(
    consoles.filter((x) => x.entry.uncaught),
    (e) => `${uncaughtLabel(e)}\n${e.text}`,
  ).map(uncaughtCandidate);
  const consoleErrors = groupBy(
    consoles.filter((x) => !x.entry.uncaught && x.entry.level === 'error'),
    (e) => e.text,
  ).map(consoleCandidate);
  const warnings = groupBy(
    consoles.filter((x) => x.entry.level === 'warn'),
    (e) => e.text,
  ).map(consoleCandidate);
  const requestKey = (e: NetworkEntry) => `${e.method} ${redactUrl(e.url)} ${outcomeOf(e)}`;
  const failed = groupBy(
    networks.filter((x) => isErrorEntry(x.entry)),
    requestKey,
  ).map((g) => requestCandidate(g, slowMs));
  const slow = groupBy(
    networks.filter((x) => !isErrorEntry(x.entry) && isSlowEntry(x.entry, slowMs)),
    requestKey,
  ).map((g) => requestCandidate(g, slowMs));

  /* Thứ tự mảng = thứ tự ưu tiên khi chọn. */
  const pools: Pool[] = [
    { id: 'uncaught', section: 'uncaught', max: MAX_UNCAUGHT, candidates: uncaught.sort(newestFirst) },
    { id: 'failed', section: 'requests', max: MAX_FAILED, candidates: failed.sort(newestFirst) },
    { id: 'consoleErrors', section: 'console', max: MAX_CONSOLE_ERRORS, candidates: consoleErrors.sort(newestFirst) },
    { id: 'steps', section: 'steps', max: MAX_STEPS, candidates: stepCandidates(entries, options.actions ?? []) },
    { id: 'slow', section: 'requests', max: MAX_SLOW, candidates: slow.sort(newestFirst) },
    { id: 'warnings', section: 'console', max: MAX_WARNINGS, candidates: warnings.sort(newestFirst) },
  ];

  const value = (text: string) => clipLine(oneLine(redactText(text)), VALUE_CHARS);
  const captured = entries.filter((e) => e.kind !== 'marker').length;
  const slowCount = entries.reduce((n, e) => (isSlowEntry(e, slowMs) ? n + 1 : n), 0);
  const head = [
    TITLE,
    '',
    INSTRUCTION,
    '',
    '## App and session',
    '',
    `- Generated: ${formatDateTime(options.generatedAt)}`,
    ...(options.build ? [`- Build: ${value(options.build)}`] : []),
    ...(options.source ? [`- Source: ${value(options.source)}`] : []),
    ...sessionInfoPairs(options.info ?? {}, options.sessionStartedAt).map(
      ([label, v]) => `- ${label}: ${value(v)}`,
    ),
    `- Captured: ${plural(captured, 'entry', 'entries')} · ${plural(
      countErrors(entries),
      'error',
      'errors',
    )} · ${plural(slowCount, 'slow request', 'slow requests')} (≥ ${slowMs} ms)`,
  ];
  const truncatedLine = `- Truncated: kept the most severe and most recent items to stay under ${maxChars} characters`;

  const fixed = render(head, pools, [], undefined).length;
  const { picks, shortened } = choose(pools, maxChars - fixed - NOTES_RESERVE);
  const all = pools.reduce((n, p) => n + p.candidates.length, 0);

  /* Lưới an toàn: ước lượng ở trên chừa chỗ cho ghi chú, nhưng trần là cam kết — còn vượt thì bỏ
     dần mục được chọn sau cùng (ưu tiên thấp nhất ở vòng cuối). */
  let kept = picks;
  let out = render(head, pools, kept, shortened || kept.length < all ? truncatedLine : undefined);
  while (out.length > maxChars && kept.length > 0) {
    kept = kept.slice(0, -1);
    out = render(head, pools, kept, truncatedLine);
  }
  return out;
};
