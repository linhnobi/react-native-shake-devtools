import { redactText, truncate } from '../capture/redact';
import { clipText } from './steps';

/**
 * Ngữ cảnh do **app** gắn vào bản báo bug (`DevToolsBugReportConfig.appContext`): user id, bản
 * build/môi trường, cờ tính năng, một lát state Redux/Zustand, `Sentry.lastEventId()`…
 *
 * Khai là `object` chứ không `Record<string, unknown>`: kiểu `interface RootState { … }` của app
 * **không** gán được vào kiểu có index signature, nên `() => store.getState()` sẽ đỏ vô cớ. Lib vẫn
 * kiểm lúc chạy: giá trị không phải object thường (mảng, chuỗi, `null`…) bị bỏ, form ghi "không lấy
 * được".
 */
export type DevToolsAppContext = object;

/** Trần chờ hàm ngữ cảnh **async** của app. Quá trần ⇒ coi như không lấy được, form không đợi. */
export const APP_CONTEXT_TIMEOUT_MS = 1500;

/** Trần ký tự của `context.json` (đã thụt lề). Vượt ⇒ cắt bớt khoá/phần tử, có dấu cắt. */
export const APP_CONTEXT_MAX_CHARS = 32_000;

/** Số dòng tối đa của mục "App context" trong thân ticket (mỗi khoá cấp đầu một dòng). */
export const APP_CONTEXT_SUMMARY_LINES = 10;

/** Độ dài tối đa của giá trị một dòng trong mục "App context". */
const SUMMARY_VALUE_MAX = 100;

/** Độ dài tối đa của khoá một dòng trong mục "App context". */
const SUMMARY_KEY_MAX = 40;

/** Tầng sâu nhất còn in (object cấp đầu là tầng 0). Sâu hơn ⇒ `[Object]` / `[Array(n)]`. */
const MAX_DEPTH = 8;

/** Số khoá tối đa mỗi object/Map; số phần tử tối đa mỗi mảng/Set; số ký tự tối đa mỗi chuỗi. */
const MAX_KEYS = 200;
const MAX_ITEMS = 100;
const MAX_STRING = 2000;

/**
 * Phần đọc thêm sau mốc cắt chuỗi trước khi che: token bắt đầu trước mốc mà kéo qua mốc vẫn khớp mẫu
 * (JWT cần đủ ba phần). Chuỗi rất lớn (ảnh base64 trong state) không bị chạy regex trên cả chuỗi.
 */
const REDACT_MARGIN = 8192;

/** Dấu cho chỗ không đọc được (getter ném, Proxy ném, `toJSON` ném). Trung lập ngôn ngữ như `<redacted>`. */
const UNREADABLE = '[Unreadable]';

/** Ngữ cảnh đã chụp: `context.json` và các dòng tóm tắt — **đã che** cả hai. */
export interface AppContextSnapshot {
  /** Nội dung `context.json`: JSON thụt lề 2, đã che, ≤ {@link APP_CONTEXT_MAX_CHARS} ký tự. */
  readonly json: string;
  /** `[khoá cấp đầu, giá trị một dòng]`, tối đa {@link APP_CONTEXT_SUMMARY_LINES} dòng. */
  readonly lines: ReadonlyArray<readonly [string, string]>;
  /** Số khoá cấp đầu không vào `lines`. */
  readonly more: number;
}

/**
 * Trạng thái ngữ cảnh trong bản nháp: `pending` (hàm async chưa xong) · `ready` · `failed` (`threw`:
 * ném hoặc reject · `timeout` · `invalid`: không phải object).
 */
export type AppContextState =
  | { readonly status: 'pending' }
  | ({ readonly status: 'ready' } & AppContextSnapshot)
  | { readonly status: 'failed'; readonly reason: 'threw' | 'timeout' | 'invalid' };

/** Ngân sách ký tự còn lại của một lần chụp (ước lượng theo JSON thụt lề). */
interface Budget {
  left: number;
}

const isPlainTarget = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Object không prototype: khoá `__proto__` của dữ liệu thành khoá thường thay vì đổi prototype của
 * object kết quả (gán `out['__proto__'] = …` lên `{}` là đổi prototype, mất khoá).
 */
const bag = (): Record<string, unknown> => Object.create(null) as Record<string, unknown>;

/** Tên dấu ở tầng bị cắt vì quá sâu: `[Object]`, `[Array(3)]`, `[Map(2)]`, `[Set(5)]`. */
const depthMarker = (value: object): string => {
  if (Array.isArray(value)) return `[Array(${value.length})]`;
  if (value instanceof Map) return `[Map(${value.size})]`;
  if (value instanceof Set) return `[Set(${value.size})]`;
  return '[Object]';
};

/** Khoá của một phần tử Map thành chuỗi: chuỗi giữ nguyên, nguyên thuỷ thành chữ, object thành dấu. */
const mapKey = (key: unknown): string => {
  if (typeof key === 'string') return key;
  if (typeof key === 'object' && key !== null) return depthMarker(key);
  if (typeof key === 'function') return '[Function]';
  return String(key);
};

/** Đổi một giá trị lá (không phải object) thành giá trị JSON, có dấu cho thứ JSON không có. */
const leaf = (value: unknown, budget: Budget): unknown => {
  switch (typeof value) {
    case 'string': {
      /* Che theo mẫu trên chuỗi THÔ: sau khi mã hoá JSON, `\n` thành `\` + `n` và mất ranh giới từ
         trước một JWT ở đầu dòng. Che theo tên khoá làm sau, trên cả văn bản JSON. */
      const unread = Math.max(0, value.length - (MAX_STRING + REDACT_MARGIN));
      const redacted = redactText(unread > 0 ? value.slice(0, MAX_STRING + REDACT_MARGIN) : value);
      const text =
        unread > 0
          ? `${redacted.slice(0, MAX_STRING)}…+${redacted.length - MAX_STRING + unread}`
          : (truncate(redacted, MAX_STRING).text ?? '');
      budget.left -= text.length + 2;
      return text;
    }
    case 'number': {
      budget.left -= 8;
      return Number.isFinite(value) ? value : String(value);
    }
    case 'boolean':
      budget.left -= 5;
      return value;
    case 'bigint':
      budget.left -= 8;
      return `${String(value)}n`;
    case 'symbol':
      budget.left -= 12;
      return `[${String(value)}]`;
    case 'function': {
      budget.left -= 12;
      const name = (value as { name?: unknown }).name;
      return typeof name === 'string' && name !== '' ? `[Function ${name}]` : '[Function]';
    }
    case 'undefined':
      budget.left -= 12;
      return '[undefined]';
    default:
      budget.left -= 4;
      return null;
  }
};

/** Một danh sách (mảng / Set) có trần phần tử và ngân sách; phần bỏ ⇒ phần tử cuối `…+N more`. */
const walkList = (
  items: Iterable<unknown>,
  size: number,
  depth: number,
  ancestors: Set<object>,
  budget: Budget,
): unknown[] => {
  const out: unknown[] = [];
  let i = 0;
  for (const item of items) {
    if (i >= MAX_ITEMS || budget.left <= 0) break;
    budget.left -= 2 * (depth + 1) + 2;
    out.push(walk(item, depth + 1, ancestors, budget, false));
    i += 1;
  }
  if (i < size) out.push(`…+${size - i} more`);
  return out;
};

/**
 * Các cặp khoá–giá trị (object / Map) có trần khoá và ngân sách; phần bỏ ⇒ khoá `…` = `+N more`.
 *
 * Ở **cấp đầu**, mỗi khoá chỉ được tiêu tối đa phần chia đều của ngân sách còn lại (khoá nhỏ tiêu ít,
 * phần dư dồn cho khoá sau): một lát state lớn đứng trước không nuốt mất `userId` hay
 * `sentryEventId` đứng sau.
 */
const walkEntries = (
  entries: Iterable<readonly [string, () => unknown]>,
  size: number,
  depth: number,
  ancestors: Set<object>,
  budget: Budget,
): Record<string, unknown> => {
  const out = bag();
  const limit = Math.min(size, MAX_KEYS);
  let i = 0;
  for (const [key, read] of entries) {
    if (i >= MAX_KEYS || budget.left <= 0) break;
    budget.left -= key.length + 2 * (depth + 1) + 6;
    let value: unknown;
    try {
      value = read();
    } catch {
      out[key] = UNREADABLE;
      i += 1;
      continue;
    }
    if (depth === 0) {
      const share: Budget = { left: Math.floor(budget.left / Math.max(1, limit - i)) };
      const start = share.left;
      out[key] = walk(value, 1, ancestors, share, false);
      budget.left -= start - share.left;
    } else {
      out[key] = walk(value, depth + 1, ancestors, budget, false);
    }
    i += 1;
  }
  if (i < size) out['…'] = `+${size - i} more`;
  return out;
};

/**
 * Đổi một giá trị bất kỳ thành cây JSON an toàn. Không bao giờ ném: chỗ nào đọc lỗi thành
 * {@link UNREADABLE}. `ancestors` là các object **trên đường đi** (không phải mọi object đã gặp), nên
 * chỉ vòng thật mới thành `[Circular]`; một object dùng chung ở hai nhánh vẫn in đủ cả hai.
 */
const walk = (
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  budget: Budget,
  skipToJSON: boolean,
): unknown => {
  if (typeof value !== 'object' || value === null) return leaf(value, budget);
  if (ancestors.has(value)) {
    budget.left -= 12;
    return '[Circular]';
  }
  try {
    if (value instanceof Date) {
      budget.left -= 26;
      return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString();
    }
    if (value instanceof Error) {
      const out = bag();
      out.name = leaf(String(value.name), budget);
      out.message = leaf(String(value.message), budget);
      return out;
    }
    if (value instanceof RegExp) return leaf(String(value), budget);
    if (ArrayBuffer.isView(value)) {
      budget.left -= 24;
      const length = (value as { length?: unknown }).length;
      return `[${value.constructor.name}(${typeof length === 'number' ? length : value.byteLength})]`;
    }
    if (value instanceof ArrayBuffer) {
      budget.left -= 24;
      return `[ArrayBuffer(${value.byteLength})]`;
    }
    if (depth >= MAX_DEPTH) {
      budget.left -= 16;
      return depthMarker(value);
    }
    const toJSON = skipToJSON ? undefined : (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') {
      /* Như `JSON.stringify`: dùng kết quả `toJSON` (Immutable, Decimal, moment…), một lần cho vị trí này. */
      return walk(toJSON.call(value), depth, ancestors, budget, true);
    }

    ancestors.add(value);
    try {
      if (Array.isArray(value)) return walkList(value, value.length, depth, ancestors, budget);
      if (value instanceof Set) return walkList(value, value.size, depth, ancestors, budget);
      if (value instanceof Map) {
        const entries = function* (): Generator<readonly [string, () => unknown]> {
          for (const [k, v] of value as Map<unknown, unknown>) yield [mapKey(k), () => v];
        };
        return walkEntries(entries(), value.size, depth, ancestors, budget);
      }
      const keys = Object.keys(value);
      const record = value as Record<string, unknown>;
      return walkEntries(
        keys.map((k) => [k, () => record[k]] as const),
        keys.length,
        depth,
        ancestors,
        budget,
      );
    } finally {
      ancestors.delete(value);
    }
  } catch {
    return UNREADABLE;
  }
};

/** Một giá trị cấp đầu thành chữ một dòng: chuỗi in thẳng, còn lại JSON gọn; khoảng trắng gộp, cắt `…`. */
const oneLine = (value: unknown): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return clipText((text ?? '').replace(/\s+/g, ' ').trim(), SUMMARY_VALUE_MAX);
};

/** Tóm tắt từ JSON **đã che** (đọc lại chính văn bản sẽ gửi đi, không đọc cây thô). */
const summarize = (json: string): Pick<AppContextSnapshot, 'lines' | 'more'> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { lines: [], more: 0 };
  }
  if (!isPlainTarget(parsed)) return { lines: [], more: 0 };
  const entries = Object.entries(parsed);
  return {
    lines: entries
      .slice(0, APP_CONTEXT_SUMMARY_LINES)
      .map(([k, v]) => [clipText(k, SUMMARY_KEY_MAX), oneLine(v)] as const),
    more: Math.max(0, entries.length - APP_CONTEXT_SUMMARY_LINES),
  };
};

/** Dựng `context.json` đã che với một ngân sách cho trước. */
const render = (value: object, budget: number): string => {
  const tree = walk(value, 0, new Set(), { left: budget }, false);
  /* Lớp che theo TÊN khoá chạy trên văn bản JSON — cùng hàm che thân request (`redactJsonKeys` +
     mẫu giá trị), gồm cả tên app thêm qua `startCapture({ redactKeys })`. Không dùng `redactBody`:
     nó nhận nhầm JSON gọn có dấu `=` (vd token base64) là thân form. */
  return redactText(JSON.stringify(tree, null, 2) ?? '{}');
};

/**
 * **Chức năng:** chụp ngữ cảnh của app thành `context.json` + vài dòng tóm tắt cho thân ticket,
 * **an toàn với mọi giá trị** và **đã che** bí mật.
 *
 * - Chịu được: tham chiếu vòng (`[Circular]`), hàm (`[Function tên]`), symbol, BigInt (`12n`),
 *   `undefined` (`[undefined]`), `NaN`/`Infinity` (chữ), `Date` (ISO), `Error` (`{ name, message }`),
 *   `RegExp`, `Map` (thành object), `Set` (thành mảng), mảng nhị phân (`[Uint8Array(n)]`), `toJSON`
 *   của app, getter/Proxy/`toJSON` ném (`[Unreadable]`), khoá `__proto__`. Không bao giờ ném.
 * - Trần có **dấu cắt nhìn thấy**: sâu quá {@link MAX_DEPTH} tầng ⇒ `[Object]`/`[Array(n)]`; quá
 *   200 khoá ⇒ khoá `"…": "+N more"`; quá 100 phần tử ⇒ phần tử `"…+N more"`; chuỗi quá 2000 ký tự
 *   ⇒ `…+N`; cả file quá {@link APP_CONTEXT_MAX_CHARS} ký tự ⇒ cắt bớt khoá/phần tử theo ngân sách.
 * - Che như thân request (`redact.ts`): mẫu giá trị trên từng chuỗi thô, rồi tên khoá bí mật ở mọi
 *   tầng trên văn bản JSON (gồm `redactKeys` của app). **Không** che dữ liệu cá nhân
 *   (`maskPersonalData`): user id, mã đơn là thứ app cố ý gửi — app tự che như với `sessionInfo`.
 * - Tóm tắt đọc lại từ JSON **đã che**: mỗi khoá cấp đầu một dòng (chuỗi in thẳng, còn lại JSON
 *   gọn, ≤ 100 ký tự), tối đa {@link APP_CONTEXT_SUMMARY_LINES} dòng, phần dư đếm ở `more`.
 *
 * **Input:** `value` — thứ hàm ngữ cảnh của app trả về.
 * **Output:** {@link AppContextSnapshot}; `value` không phải object thường (mảng, chuỗi, `null`…)
 * ⇒ `null`.
 *
 * @example
 * ```ts
 * serializeAppContext({ userId: 'u-42', session: { accessToken: 'at-1' } });
 * // { json: '{\n  "userId": "u-42",\n  "session": {\n    "accessToken": "<redacted>"\n  }\n}',
 * //   lines: [['userId', 'u-42'], ['session', '{"accessToken":"<redacted>"}']], more: 0 }
 * serializeAppContext('u-42');   // ca biên: null
 * ```
 *
 * **Unit test:** `app-context.test.ts` › `serializeAppContext` — 26 case: object thường · vòng và
 * object dùng chung · hàm/symbol/BigInt/undefined/NaN · Date/Error/RegExp/Map/Set/nhị phân ·
 * `toJSON` · getter và Proxy ném · `__proto__` · 7 trần (sâu · mảng · khoá · chuỗi · chuỗi rất lớn
 * và token vắt qua mốc cắt · tổng · khoá lớn đứng trước không nuốt khoá nhỏ) · 4 che (khoá · mẫu ·
 * `redactKeys` · tóm tắt) · 2 tóm tắt ·
 * 6 junk. › `khoá bí mật trong ngữ cảnh tới mọi kết nối đều đã che` — 5 case: bản báo · Jira (gửi
 * thật) · Webhook (gửi thật) · Slack/Lark mức nhẹ (gửi thật) · Slack bot, Lark app, Chia sẻ.
 */
export const serializeAppContext = (value: unknown): AppContextSnapshot | null => {
  if (!isPlainTarget(value)) return null;
  let budget = APP_CONTEXT_MAX_CHARS;
  let json = render(value, budget);
  /* Ngân sách là ước lượng: còn vượt thì co lại theo tỉ lệ, vài lượt là vừa. */
  for (let i = 0; i < 4 && json.length > APP_CONTEXT_MAX_CHARS; i += 1) {
    budget = Math.floor((budget * APP_CONTEXT_MAX_CHARS) / json.length) - 512;
    json = render(value, budget);
  }
  if (json.length > APP_CONTEXT_MAX_CHARS) {
    json = JSON.stringify({ '…': `context.json over ${APP_CONTEXT_MAX_CHARS} characters` }, null, 2);
  }
  return { json, ...summarize(json) };
};

/** Kết quả của hàm ngữ cảnh ⇒ trạng thái `ready`/`failed` (bộ dựng không ném, vẫn chặn phòng hờ). */
const toState = (value: unknown): AppContextState => {
  try {
    const snapshot = serializeAppContext(value);
    return snapshot ? { status: 'ready', ...snapshot } : { status: 'failed', reason: 'invalid' };
  } catch {
    return { status: 'failed', reason: 'invalid' };
  }
};

/**
 * **Chức năng:** gọi hàm ngữ cảnh của app **lúc form báo bug mở** và đổi kết quả thành
 * {@link AppContextState} — **không bao giờ ném**, không treo quá `timeoutMs`.
 *
 * - Hàm đồng bộ ⇒ trạng thái trả **ngay** (không phải Promise): bản nháp có ngữ cảnh từ lượt render
 *   đầu, chip không nhấp nháy. Redux `getState()`, Zustand `getState()`, `Sentry.lastEventId()` đều
 *   đồng bộ.
 * - Hàm trả Promise ⇒ Promise luôn resolve: giá trị ⇒ `ready`; reject ⇒ `failed`/`threw`; quá
 *   `timeoutMs` ⇒ `failed`/`timeout` (giá trị về muộn bị bỏ).
 * - Ném (cả getter `then` ném) ⇒ `failed`/`threw`. Không phải object ⇒ `failed`/`invalid`.
 *
 * ⚠️ Hàm **đồng bộ** chạy vòng lặp vô hạn thì không trần nào cắt được (JS một luồng) — app phải giữ
 * hàm này rẻ.
 *
 * **Input:** `read` — `DevToolsBugReportConfig.appContext` · `timeoutMs` (mặc định
 * {@link APP_CONTEXT_TIMEOUT_MS}). **Output:** `AppContextState | Promise<AppContextState>`.
 *
 * @example
 * ```ts
 * snapshotAppContext(() => ({ userId: store.getState().auth.userId }));   // { status: 'ready', … }
 * await snapshotAppContext(async () => ({ flags: await flags.all() }));    // { status: 'ready', … }
 * snapshotAppContext(() => { throw new Error('x'); });                      // ca biên: { status: 'failed', reason: 'threw' }
 * ```
 *
 * **Unit test:** `app-context.test.ts` › `snapshotAppContext` — 7 case: đồng bộ có ngay · ném ·
 * junk · async · reject · treo đúng mốc trần và bỏ kết quả muộn · getter `then` ném.
 */
export const snapshotAppContext = (
  read: () => unknown,
  timeoutMs: number = APP_CONTEXT_TIMEOUT_MS,
): AppContextState | Promise<AppContextState> => {
  let result: unknown;
  let thenable: boolean;
  try {
    result = read();
    thenable =
      (typeof result === 'object' || typeof result === 'function') &&
      result !== null &&
      typeof (result as { then?: unknown }).then === 'function';
  } catch {
    return { status: 'failed', reason: 'threw' };
  }
  if (!thenable) return toState(result);

  return new Promise<AppContextState>((resolve) => {
    let settled = false;
    const finish = (state: AppContextState) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(state);
    };
    const timer = setTimeout(() => finish({ status: 'failed', reason: 'timeout' }), timeoutMs);
    Promise.resolve(result as PromiseLike<unknown>).then(
      (value) => finish(toState(value)),
      () => finish({ status: 'failed', reason: 'threw' }),
    );
  });
};
