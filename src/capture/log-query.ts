import {
  NETWORK_ABORTED,
  type LogEntry,
  type LogFilter,
  type LogStatusFilter,
  type NetworkEntry,
} from './log-entry';

/**
 * Request chạy lâu từ ngưỡng này trở lên là **chậm**. 3 giây: quá ngưỡng người dùng bắt đầu nghĩ
 * app treo, và vẫn trên xa thời gian của một request bình thường ở mạng uat (vài trăm ms).
 */
export const DEFAULT_SLOW_MS = 3000;

/** Bộ tiêu chí của màn nhật ký — ba trục độc lập, trục nào `'all'`/rỗng là không lọc. */
export interface LogQuery {
  readonly kind: LogFilter;
  readonly status: LogStatusFilter;
  /**
   * Chữ tìm — không phân biệt hoa thường. Hiểu ba tiền tố (`status:` · `method:` · `screen:`),
   * phần còn lại khớp chuỗi con. Xem `parseQuery`.
   */
  readonly text: string;
  /** Ngưỡng "chậm" cho `status: 'slow'`. Mặc định `DEFAULT_SLOW_MS`. */
  readonly slowMs?: number;
}

/**
 * **Chức năng:** một dòng nhật ký có phải **lỗi** không — định nghĩa DUY NHẤT, dùng chung cho
 * chip lọc, bộ đếm, vòng giữ lỗi của buffer và file xuất, để mọi chỗ không thể lệch nhau.
 *
 * Lỗi là một trong ba ca:
 * - `console.error` (mức `'error'`) — gồm cả lỗi JS không ai bắt (`uncaught`). `warn` **không**
 *   tính — gộp vào thì chip "Chỉ lỗi" ngập cảnh báo deprecated của thư viện.
 * - request hỏng tầng vận chuyển (`error` có giá trị: mất mạng, timeout). Request **bị app huỷ**
 *   (`isAbortedEntry`) **không** tính: huỷ là app tự quyết (rời màn, gõ tiếp ô tìm), tính vào thì
 *   huy hiệu đỏ nhảy theo mỗi lần React Query/axios huỷ request cũ.
 * - request có `status >= 400`.
 *
 * **Input:** `entry`.
 * **Output:** `boolean`. Request **chưa xong** ⇒ `false`. Mốc ⇒ luôn `false`.
 *
 * @example
 * ```ts
 * isErrorEntry({ id: 1, kind: 'network', at: 0, method: 'GET', url: '/x', status: 500 }); // true
 * isErrorEntry({ id: 2, kind: 'console', at: 0, level: 'warn', text: 'ối' });             // false
 * isErrorEntry({ id: 3, kind: 'network', at: 0, method: 'GET', url: '/x' });              // ca biên: đang bay ⇒ false
 * ```
 *
 * **Unit test:** `log-query.test.ts` › `isErrorEntry` — 8 case: `console.error` là lỗi · `warn`
 * không phải lỗi · status 400 là lỗi (biên dưới) · status 399 không phải lỗi · lỗi vận chuyển là
 * lỗi · request bị huỷ không phải lỗi · request đang bay không phải lỗi · mốc không bao giờ là lỗi.
 */
export const isErrorEntry = (entry: LogEntry): boolean => {
  if (entry.kind === 'marker') return false;
  if (entry.kind === 'console') return entry.level === 'error';
  if (entry.error) return !isAbortedEntry(entry);
  return entry.status !== undefined && entry.status >= 400;
};

/**
 * **Chức năng:** request có phải bị **app huỷ** không (`xhr.abort()`, `AbortController`) — kết cục
 * trung tính: không lỗi, hàng hiện xám "Đã huỷ".
 *
 * **Input:** `entry`. **Output:** `boolean`; console, mốc ⇒ `false`.
 *
 * @example
 * ```ts
 * isAbortedEntry(net({ error: 'abort' }));    // true
 * isAbortedEntry(net({ error: 'timeout' }));  // ca biên: hết giờ không phải huỷ ⇒ false
 * ```
 *
 * **Unit test:** `log-query.test.ts` › `isErrorEntry` — case "request bị huỷ không phải lỗi".
 */
export const isAbortedEntry = (entry: LogEntry): boolean =>
  entry.kind === 'network' && entry.error === NETWORK_ABORTED;

/**
 * **Chức năng:** request có **chậm** không — đã xong và mất từ `slowMs` trở lên.
 *
 * **Input:** `entry` · `slowMs` (mặc định `DEFAULT_SLOW_MS`).
 * **Output:** `boolean`. Console, mốc, request đang bay ⇒ `false` (đang bay chưa có thời lượng —
 * request treo được thấy qua nhãn "pending", không qua chip này).
 *
 * @example
 * ```ts
 * isSlowEntry(net({ durationMs: 3200 }));  // true
 * isSlowEntry(net({ durationMs: 3000 }));  // ca biên: đúng ngưỡng ⇒ true
 * isSlowEntry(net({}));                    // đang bay ⇒ false
 * ```
 *
 * **Unit test:** `log-query.test.ts` › `isSlowEntry` — 4 case: trên ngưỡng · đúng ngưỡng là chậm ·
 * dưới ngưỡng · request đang bay không chậm.
 */
export const isSlowEntry = (
  entry: LogEntry,
  slowMs: number = DEFAULT_SLOW_MS,
): entry is NetworkEntry =>
  entry.kind === 'network' &&
  entry.durationMs !== undefined &&
  entry.durationMs >= slowMs;

/**
 * **Chức năng:** đếm số dòng lỗi — con số trên chip "Chỉ lỗi", huy hiệu panel và nút xuất.
 *
 * **Input:** `entries`. **Output:** số nguyên `>= 0`.
 *
 * @example
 * ```ts
 * countErrors([consoleError, networkOk, network500]); // 2
 * countErrors([]);                                    // ca biên: 0
 * ```
 *
 * **Unit test:** `log-query.test.ts` › `countErrors` — 2 case: đếm đúng hỗn hợp · mảng rỗng ⇒ 0.
 */
export const countErrors = (entries: readonly LogEntry[]): number =>
  entries.reduce((n, e) => (isErrorEntry(e) ? n + 1 : n), 0);

/** Một điều kiện có cấu trúc lấy từ ô tìm. */
type Predicate = (entry: LogEntry) => boolean;

/** Kết quả tách chữ tìm: các điều kiện có tiền tố + phần chữ tự do còn lại. */
export interface ParsedQuery {
  readonly predicates: readonly Predicate[];
  /** Chữ tự do, đã hạ chữ thường; rỗng ⇒ không lọc theo chữ. */
  readonly free: string;
}

/**
 * `status:` hiểu ba dạng: mã cụ thể (`404`), cả lớp (`4xx`, `5xx`) và `err` (lỗi vận chuyển —
 * trừ request bị huỷ, cùng luật với `isErrorEntry`). Giá trị lạ ⇒ `undefined` để token rơi về chữ
 * tự do thay vì âm thầm lọc hết.
 */
const statusPredicate = (value: string): Predicate | undefined => {
  if (value === 'err') {
    return (e) => e.kind === 'network' && Boolean(e.error) && !isAbortedEntry(e);
  }
  const cls = /^([1-5])xx$/.exec(value);
  if (cls) {
    const lo = Number(cls[1]) * 100;
    return (e) =>
      e.kind === 'network' &&
      e.status !== undefined &&
      e.status >= lo &&
      e.status < lo + 100;
  }
  if (/^\d{3}$/.test(value)) {
    const code = Number(value);
    return (e) => e.kind === 'network' && e.status === code;
  }
  return undefined;
};

/**
 * **Chức năng:** tách chữ trong ô tìm thành **điều kiện có cấu trúc** + **chữ tự do**.
 *
 * | Token | Nghĩa |
 * |---|---|
 * | `status:404` · `status:5xx` · `status:err` | mã cụ thể · cả lớp · lỗi vận chuyển (trừ huỷ) |
 * | `method:post` | method HTTP, không phân biệt hoa thường |
 * | `screen:user` | tên màn **chứa** chữ này |
 * | còn lại | ghép lại bằng một khoảng trắng, khớp chuỗi con như cũ |
 *
 * Token có tiền tố mà giá trị hỏng (`status:abc`, `method:`) **không** bị nuốt — nó rơi về chữ
 * tự do. Nuốt im lặng thì người gõ sai một chữ thấy danh sách rỗng mà không biết vì sao.
 *
 * **Input:** `text` — chữ đã gõ. **Output:** {@link ParsedQuery}.
 *
 * @example
 * ```ts
 * parseQuery('status:5xx user');   // 1 điều kiện + free 'user'
 * parseQuery('Method:POST');       // tiền tố không phân biệt hoa thường
 * parseQuery('status:abc');        // ca biên: 0 điều kiện, free 'status:abc'
 * ```
 *
 * **Unit test:** `log-query.test.ts` › `parseQuery` — 6 case: `status:5xx` khớp cả lớp ·
 * `status:404` khớp đúng mã · `method:` không phân biệt hoa thường · `screen:` khớp chuỗi con tên
 * màn · `status:err` khớp lỗi vận chuyển trừ request bị huỷ · giá trị hỏng rơi về chữ tự do.
 */
export const parseQuery = (text: string): ParsedQuery => {
  const predicates: Predicate[] = [];
  const free: string[] = [];
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    const m = /^(status|method|screen):(.+)$/i.exec(token);
    if (!m) {
      free.push(token);
      continue;
    }
    const key = m[1].toLowerCase();
    const value = m[2].toLowerCase();
    const p =
      key === 'status'
        ? statusPredicate(value)
        : key === 'method'
          ? (e: LogEntry) => e.kind === 'network' && e.method.toLowerCase() === value
          : (e: LogEntry) =>
              e.kind !== 'marker' && (e.screen ?? '').toLowerCase().includes(value);
    if (p) predicates.push(p);
    else free.push(token);
  }
  return { predicates, free: free.join(' ').toLowerCase() };
};

/**
 * Các mẩu chữ của một dòng mà chữ tự do được phép khớp.
 *
 * 🔴 Thân request/response tìm trên bản **thô** (chưa che): chỉ dùng để *quyết định* dòng nào
 * hiện, không đưa chữ nào ra màn — hiển thị vẫn đi qua `redactBody`. Tìm trên bản đã che thì gõ
 * một đoạn của thân (vd mã lỗi nằm cạnh khoá `token`) có thể trượt vì chuỗi đã đổi.
 */
const haystackOf = (entry: LogEntry): readonly (string | undefined)[] => {
  if (entry.kind === 'marker') return [entry.label];
  if (entry.kind === 'console') return [entry.level, entry.text, entry.screen];
  return [
    entry.method,
    entry.url,
    entry.status === undefined ? undefined : String(entry.status),
    entry.error,
    entry.requestBody,
    entry.responseBody,
    entry.screen,
  ];
};

const matchesParsed = (entry: LogEntry, parsed: ParsedQuery): boolean =>
  parsed.predicates.every((p) => p(entry)) &&
  (!parsed.free ||
    haystackOf(entry).some(
      (part) => part !== undefined && part.toLowerCase().includes(parsed.free),
    ));

/**
 * **Chức năng:** một dòng có khớp chữ tìm không — gồm cả tiền tố `status:` / `method:` /
 * `screen:` (xem `parseQuery`).
 *
 * Chữ tự do khớp **chuỗi con, không phân biệt hoa thường** trên: mức + nội dung + màn (console) ·
 * method, URL, status, lỗi vận chuyển, thân request/response, màn (mạng) · nhãn (mốc). Không
 * regex, không fuzzy: một ký tự đặc biệt trong URL (`?`, `.`) không được phép biến thành cú pháp.
 *
 * **Input:** `entry` · `text` — chữ đã gõ.
 * **Output:** `boolean`. `text` rỗng (sau khi cắt) ⇒ `true` — không tìm là không lọc.
 *
 * @example
 * ```ts
 * matchesQuery(networkEntry('/api/user/list', 404), 'USER');        // true
 * matchesQuery(networkEntry('/api/user/list', 404), 'status:4xx');  // true
 * matchesQuery(anyEntry, '   ');                                     // ca biên: true
 * ```
 *
 * **Unit test:** `log-query.test.ts` › `matchesQuery` — 6 case: chữ rỗng/khoảng trắng khớp mọi
 * dòng · URL khớp không phân biệt hoa thường · status khớp như chữ · khớp trong thân response ·
 * dòng console khớp theo nội dung · ký tự đặc biệt (`?`) khớp đúng nghĩa đen.
 */
export const matchesQuery = (entry: LogEntry, text: string): boolean =>
  matchesParsed(entry, parseQuery(text));

/**
 * **Chức năng:** áp cả ba trục lọc (loại · kết cục · chữ tìm) lên nhật ký.
 *
 * Giữ nguyên thứ tự **cũ→mới** của đầu vào — đảo chiều hiển thị là việc của màn, để hàm này
 * dùng lại được cho file xuất (file đọc từ trên xuống theo thời gian).
 *
 * Chữ tìm được tách **một lần** mỗi lượt lọc (không phải mỗi dòng), và trục rẻ chạy trước trục
 * đắt: 300 dòng × 2 thân là ~2,4 triệu ký tự mỗi lượt gõ nếu quét thân trước.
 *
 * Mốc chỉ lọt qua khi `kind` và `status` đều `'all'` — xem `LogFilter`/`LogStatusFilter`.
 *
 * **Input:** `entries` · `query`.
 * **Output:** mảng **mới** đã lọc; mọi trục ở trạng thái "không lọc" ⇒ trả **chính** `entries`
 * (cùng tham chiếu — `useMemo` phía trên khỏi dựng lại list khi không có gì đổi).
 *
 * @example
 * ```ts
 * filterLog(entries, { kind: 'network', status: 'error', text: 'user' });
 * filterLog(entries, { kind: 'all', status: 'slow', text: 'method:get' });
 * filterLog(entries, { kind: 'all', status: 'all', text: '' }) === entries; // ca biên: true
 * ```
 *
 * **Unit test:** `log-query.test.ts` › `filterLog` — 7 case: không lọc trả cùng tham chiếu · lọc
 * `kind` · lọc `status: 'error'` · lọc `status: 'ok'` giữ request đang bay và request bị huỷ · lọc `status: 'slow'` ·
 * mốc chỉ hiện khi không lọc trục nào · ba trục kết hợp và giữ thứ tự cũ→mới.
 */
export const filterLog = (
  entries: readonly LogEntry[],
  query: LogQuery,
): readonly LogEntry[] => {
  const { kind, status, text, slowMs = DEFAULT_SLOW_MS } = query;
  const needle = text.trim();
  if (kind === 'all' && status === 'all' && !needle) return entries;
  const parsed = parseQuery(needle);
  return entries.filter((e) => {
    if (e.kind === 'marker' && (kind !== 'all' || status !== 'all')) return false;
    if (kind !== 'all' && e.kind !== kind) return false;
    if (status === 'error' && !isErrorEntry(e)) return false;
    if (status === 'ok' && isErrorEntry(e)) return false;
    if (status === 'slow' && !isSlowEntry(e, slowMs)) return false;
    return matchesParsed(e, parsed);
  });
};
