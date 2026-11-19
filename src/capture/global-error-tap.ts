import { muteConsoleTap } from './console-tap';
import { logBuffer } from './log-buffer';

/** Số ký tự tối đa của dòng lỗi toàn cục — cùng hạn với một dòng console, nhưng gồm cả stack. */
const UNCAUGHT_LIMIT = 2000;

/**
 * Chờ tối đa bao lâu cho việc ghi đĩa trước khi trả lỗi **fatal** về cho handler gốc của RN.
 *
 * Handler gốc ở bản release là thứ làm app chết; gọi nó ngay thì lượt ghi phiên (bất đồng bộ, qua
 * native module) có thể không kịp xong và phiên crash — đúng phiên cần xem nhất — không nằm lại
 * trên đĩa. 800ms là trễ người dùng không phân biệt được với "app đơ rồi tắt".
 */
export const FATAL_FLUSH_BUDGET_MS = 800;

/** Hình dạng tối thiểu của `global.ErrorUtils` mà RN dựng sẵn. */
interface ErrorUtilsLike {
  getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

/** Hình dạng tối thiểu của object `ExceptionsManager` của RN mà tap cần. */
interface ExceptionsManagerLike {
  handleException: (error: unknown, isFatal: boolean) => void;
}

/**
 * Object `ExceptionsManager` mà RN **thật sự dùng**, hoặc `undefined` (không phải RN, hay hình dạng
 * lạ). RN 0.81+ là `export default` (ESM); RN 0.76 là `module.exports`.
 *
 * Vá đúng object này thì có tác dụng vì mọi nơi trong RN gọi qua thuộc tính lúc chạy
 * (`ExceptionsManager.handleException(...)`, Babel dịch thành `_ExceptionsManager.default.…`),
 * không giữ bản sao hàm. `require` nằm trong `try` như ở `rejection-tap.ts`: Metro coi đó là phụ
 * thuộc tuỳ chọn khi `transformer.allowOptionalDependencies` bật (`@react-native/metro-config`,
 * `expo/metro-config`, mặc định của Metro từ 0.87), nên bản RN nào thiếu file thì bundle vẫn qua,
 * `require` ném lúc chạy và chỉ mất đường này. Config Metro tự viết không bật cờ đó thì bundle dừng
 * ở "Unable to resolve module". Không khoá sau `__DEV__`: ca cần nhất là bản release.
 */
const rnExceptionsManager = (): ExceptionsManagerLike | undefined => {
  try {
    /* Chuỗi phải viết thẳng: Metro chỉ nhận `require` với một chuỗi hằng. */
    const mod = require('react-native/Libraries/Core/ExceptionsManager') as
      | (Partial<ExceptionsManagerLike> & { default?: Partial<ExceptionsManagerLike> })
      | undefined;
    const em = typeof mod?.default?.handleException === 'function' ? mod.default : mod;
    return typeof em?.handleException === 'function' ? (em as ExceptionsManagerLike) : undefined;
  } catch {
    return undefined;
  }
};

const isObject = (v: unknown): v is object =>
  (typeof v === 'object' && v !== null) || typeof v === 'function';

/**
 * **Chức năng:** dựng dòng text cho một lỗi không ai bắt — `Tên: thông điệp` + stack, cắt ở
 * `UNCAUGHT_LIMIT`. Không bao giờ ném.
 *
 * Khác `formatArgs` của console (chỉ `name: message`): với lỗi không ai bắt, **stack là manh mối
 * duy nhất** — không có dòng `console.*` nào của app đứng trước nó.
 *
 * **Input:** `error` — bất kỳ thứ gì bị `throw` (không nhất thiết là `Error`).
 * **Output:** chuỗi nhiều dòng.
 *
 * @example
 * ```ts
 * formatUncaught(new TypeError('x is undefined'));  // 'TypeError: x is undefined\n    at …'
 * formatUncaught('bùm');                            // ca biên: throw chuỗi ⇒ 'bùm'
 * ```
 *
 * **Unit test:** `global-error-tap.test.ts` › `formatUncaught` — 4 case: `Error` có stack ra tên +
 * thông điệp + stack · thông điệp rỗng ⇒ tiêu đề chỉ là tên, không in hai lần · `throw` chuỗi ra
 * nguyên chuỗi · cắt ở `UNCAUGHT_LIMIT`.
 */
export const formatUncaught = (error: unknown): string => {
  let text: string;
  if (error instanceof Error) {
    /* Thông điệp rỗng thì chỉ còn tên — `'Error: '` với dấu hai chấm treo là rác. */
    const head = error.message ? `${error.name}: ${error.message}` : error.name;
    /* Stack của Hermes đã mở đầu bằng chính dòng tiêu đề (`name: message`, hoặc chỉ `name` khi
       thông điệp rỗng) — bỏ dòng đó để khỏi in hai lần. */
    const stack = (error.stack ?? '')
      .split('\n')
      .filter((l, i) => !(i === 0 && l.trim() === head));
    text = [head, ...stack].join('\n').trimEnd();
  } else {
    try {
      text = typeof error === 'string' ? error : (JSON.stringify(error) ?? String(error));
    } catch {
      text = String(error);
    }
  }
  return text.length > UNCAUGHT_LIMIT ? `${text.slice(0, UNCAUGHT_LIMIT)}…` : text;
};

const NOOP = () => undefined;

let installed = false;
let uninstall: () => void = NOOP;

/**
 * **Chức năng:** bắt **lỗi JS không ai bắt** (kể cả lỗi làm chết app) vào nhật ký, qua **hai
 * cửa** của RN: `ErrorUtils.setGlobalHandler`, và `ExceptionsManager.handleException` cho lỗi
 * fatal không đi qua `ErrorUtils` (lỗi **render** không có error boundary, RN 0.81+).
 *
 * Trước hàm này, app crash ⇒ nhật ký chết theo tiến trình và dòng cuối cùng người ta thấy (nếu
 * có) là một `console.error` không kèm stack. Nay lỗi được ghi thành một dòng `uncaught` có stack,
 * và `onFatal` (thường là "ghi phiên xuống đĩa") được chạy **trước** khi trả lỗi về RN.
 *
 * ## Vì sao cần cửa thứ hai (lỗi render, React 19)
 *
 * | RN | Lỗi render không boundary đi đường nào |
 * |---|---|
 * | 0.76 (React 18) | `ReactFiberErrorDialog` → `handleException(e, false)`, rồi React **ném lại** lỗi ⇒ `ErrorUtils.reportFatalError` ⇒ cửa một thấy, fatal |
 * | 0.81 · 0.86 · 0.88 (React 19) | React gọi `onUncaughtError` mà RN truyền vào `ReactFabric.render`; hàm đó gọi **thẳng** `ExceptionsManager.handleException(e, true)`, React **không** ném lại ⇒ cửa một không bao giờ thấy |
 *
 * Thiếu cửa hai, trên RN 0.81+ lỗi render chỉ vào nhật ký qua `console.error(e)` của RN thành một
 * dòng `ERROR` không stack, `onFatal` không chạy, và ở bản release app chết trước khi phiên kịp
 * ghi. Cửa hai chỉ nhận lời gọi **fatal** chưa đi qua cửa một; lời gọi không fatal (lỗi bị error
 * boundary bắt, promise reject ở dev) đi thẳng tới RN như cũ.
 *
 * 🔴 **Bọc chồng, không thay thế.** Hàm gốc (RedBox/LogBox ở dev, báo crash ở release, và bất kỳ
 * SDK crash-report nào cài trước) luôn được gọi, đúng một lần. Lỗi **fatal** thì gọi sau khi
 * `onFatal` xong hoặc sau `FATAL_FLUSH_BUDGET_MS`, cái nào tới trước.
 *
 * **Một lỗi = một dòng lỗi.** Hàm gốc của RN `console.error` lại chính lỗi đó (ở cả dev lẫn
 * release). Lời gọi hàm gốc chạy trong `muteConsoleTap`: chỉ còn dòng `UNCAUGHT`/`FATAL` có stack,
 * còn hàm gốc của `console` (LogBox, màn đỏ, Metro) vẫn nhận như cũ. Lỗi đi qua **cả hai** cửa
 * (handler của RN ở cửa một gọi lại `handleException`, kể cả khi một SDK trả lỗi về muộn) chỉ
 * được ghi và `onFatal` một lần.
 *
 * ⚠️ **Không** bắt promise bị reject mà không ai `catch`: ca đó không bao giờ tới `ErrorUtils` —
 * Hermes có bộ theo dõi riêng, và `tapUnhandledRejections` lo nó. Crash **native** (Java/ObjC)
 * cũng không đi qua đây. Cửa hai dựa vào đường dẫn nội bộ
 * `react-native/Libraries/Core/ExceptionsManager` (đọc từ mã RN 0.76–0.88); thiếu file đó thì chỉ
 * còn cửa một. Đường lỗi render trên máy thật **chưa kiểm** — chỉ jest.
 *
 * **Input:** `onFatal?` — việc cần làm trước khi app chết; trả Promise thì được chờ (có trần).
 * **Output:** hàm **gỡ**, trả handler cũ và `handleException` cũ về chỗ. Gọi lần hai khi chưa gỡ
 * ⇒ no-op (trả hàm gỡ của lần một). `global.ErrorUtils` vắng (môi trường không phải RN) ⇒ không
 * làm gì, trả hàm rỗng.
 *
 * @example
 * ```ts
 * const stop = tapGlobalErrors(() => persistence.flush({ fatal: true }));
 * // throw trong một setTimeout ⇒ dòng 'uncaught' vào nhật ký ⇒ phiên được ghi ⇒ RedBox / crash
 * // throw trong render, không boundary (RN 0.81+) ⇒ y như vậy, qua cửa `handleException`
 * stop();
 * // Ca biên: onFatal treo mãi ⇒ handler gốc vẫn được gọi sau 800ms, app không kẹt ở trạng thái lỗi.
 * ```
 *
 * **Unit test:** `global-error-tap.test.ts` › `tapGlobalErrors` — 8 case: lỗi thường ⇒ dòng
 * `uncaught` vào buffer và handler gốc được gọi ngay · lỗi fatal ⇒ `fatal: true` và handler gốc
 * gọi **sau** `onFatal` · `onFatal` treo ⇒ handler gốc vẫn được gọi sau `FATAL_FLUSH_BUDGET_MS` ·
 * handler gốc chỉ được gọi đúng một lần · lỗi thường: `console.error` của handler gốc không thành
 * dòng thứ hai · lỗi fatal: như vậy, cả khi trả về sau `onFatal` · gọi hai lần chỉ bọc một lớp ·
 * `stop()` trả handler cũ. › `tapGlobalErrors — lỗi render không error boundary (React 19)` —
 * 8 case, gọi `onUncaughtError` **thật** của RN: ⭐ một dòng `uncaught` fatal, `onFatal` chạy trước
 * khi RN nhận lỗi · release: báo native fatal một lần, sau khi ghi · `onFatal` treo ⇒ RN vẫn nhận
 * sau trần · lỗi fatal qua `ErrorUtils` (kể cả `throw` chuỗi) vẫn một dòng · SDK trả lỗi về muộn ⇒
 * vẫn một dòng · `onCaughtError` không thành fatal · `stop()` trả `handleException` gốc · ⭐ với
 * `persist`: phiên được ghi `fatal: true` một lần.
 */
export const tapGlobalErrors = (
  onFatal?: () => Promise<unknown> | void,
): (() => void) => {
  if (installed) return uninstall;
  const eu = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!eu || typeof eu.setGlobalHandler !== 'function') return NOOP;

  const previous = eu.getGlobalHandler();
  /** Lỗi (object) đã ghi thành dòng fatal — nhận mặt khi chính lỗi đó tới cửa hai về sau. */
  const fatalSeen = new WeakSet<object>();
  /** > 0 khi lib đang trả một lỗi về RN: `handleException` gọi trong lúc đó là chính lỗi ấy. */
  let handingOver = 0;
  let live = true;

  /* Hàm gốc của RN `console.error` lại chính lỗi này, ở cả dev lẫn release — dòng đó không có
     stack và làm huy hiệu đếm đôi. Dòng `uncaught` đã đủ, nên lúc trả về RN thì bộ thu console bỏ
     qua; hàm gốc của `console` vẫn chạy (LogBox, màn đỏ, Metro vẫn thấy). */
  const handOff = (toRn: () => void) => () => {
    handingOver += 1;
    try {
      muteConsoleTap(toRn);
    } finally {
      handingOver -= 1;
    }
  };

  /** Ghi một dòng `uncaught`, rồi trả lỗi về RN — lỗi fatal thì sau `onFatal` (có trần). */
  const report = (error: unknown, isFatal: boolean, toRn: () => void) => {
    try {
      logBuffer.push({
        id: logBuffer.nextId(),
        kind: 'console',
        at: Date.now(),
        level: 'error',
        text: formatUncaught(error),
        uncaught: true,
        fatal: isFatal,
      });
      if (isFatal && isObject(error)) fatalSeen.add(error);
    } catch {
      /* Nuốt: công cụ gỡ lỗi hỏng không được chặn đường báo lỗi của chính app. */
    }

    const handToRn = handOff(toRn);
    if (!isFatal || !onFatal) {
      handToRn();
      return;
    }

    let handed = false;
    const handOver = () => {
      if (handed) return;
      handed = true;
      handToRn();
    };
    setTimeout(handOver, FATAL_FLUSH_BUDGET_MS);
    try {
      Promise.resolve(onFatal()).then(handOver, handOver);
    } catch {
      handOver();
    }
  };

  /* Cửa một: lỗi ném ra ngoài JS (timer, sự kiện, `onPress`, render trên RN 0.76). */
  eu.setGlobalHandler((error, isFatal) =>
    report(error, Boolean(isFatal), () => previous(error, isFatal)),
  );

  /* Cửa hai: lời gọi `handleException` fatal không qua cửa một (`onUncaughtError` của RN 0.81+). */
  const em = rnExceptionsManager();
  const rnHandleException = em?.handleException;
  const patched = (error: unknown, isFatal: boolean): void => {
    const toRn = () => rnHandleException?.call(em, error, isFatal);
    if (!live || !isFatal || handingOver > 0) {
      toRn();
      return;
    }
    /* Đã ghi ở cửa một, rồi một SDK trả lỗi về handler của RN muộn: chỉ trả tiếp, im console. */
    if (isObject(error) && fatalSeen.has(error)) {
      muteConsoleTap(toRn);
      return;
    }
    report(error, true, toRn);
  };
  if (em && rnHandleException) em.handleException = patched;

  /* So với CHÍNH NÓ, không với cờ chung — xem ghi chú cùng chỗ ở `console-tap.ts`: hàm gỡ của
     một lần bọc cũ không được gỡ lần bọc mới (tắt thu → bật thu). */
  const stop = () => {
    if (uninstall !== stop) return;
    eu.setGlobalHandler(previous);
    /* Ai đó đã bọc đè lên bản vá thì không gỡ được mà không làm mất lớp của họ — bản vá tự đứng
       ngoài nhờ `live`. */
    live = false;
    if (em && em.handleException === patched && rnHandleException) {
      em.handleException = rnHandleException;
    }
    installed = false;
    uninstall = NOOP;
  };
  uninstall = stop;
  installed = true;
  return stop;
};
