import { muteConsoleTap } from './console-tap';
import { formatUncaught } from './global-error-tap';
import { logBuffer } from './log-buffer';

/**
 * Tuỳ chọn của bộ theo dõi promise reject — đúng hình dạng `enable` của gói `promise`
 * (`promise/setimmediate/rejection-tracking`), thứ Hermes nhúng sẵn làm `Promise` của nó.
 *
 * `id` là số thứ tự **hiển thị** (0, 1, 2…) do bộ theo dõi cấp: `onHandled` nhận đúng `id` mà
 * `onUnhandled` đã nhận cho cùng promise, nên ghép cặp được hai dòng.
 */
export interface RejectionTrackerOptions {
  /** `true` ⇒ báo mọi loại giá trị bị reject, không chỉ `whitelist`. */
  readonly allRejections?: boolean;
  /** Các lớp lỗi được báo khi `allRejections` tắt. Vắng ⇒ `ReferenceError · TypeError · RangeError`. */
  readonly whitelist?: readonly unknown[];
  /** Promise bị reject và **chưa ai `catch`** sau 2 giây (100ms với ba lớp ở `whitelist` mặc định). */
  readonly onUnhandled?: (id: number, rejection: unknown) => void;
  /** Promise đã bị báo ở `onUnhandled`, nay mới có người `catch`. */
  readonly onHandled?: (id: number, rejection: unknown) => void;
}

/** Hình dạng tối thiểu của `global.HermesInternal` mà tap này cần. */
interface HermesInternalLike {
  hasPromise?: () => boolean;
  enablePromiseRejectionTracker?: (options: RejectionTrackerOptions) => void;
}

const NOOP = () => undefined;

/**
 * Bộ theo dõi **câm**, đăng ký khi gỡ tap ở bản `--dev false`. Hermes không có lệnh "tắt" bộ
 * theo dõi, chỉ có lệnh đăng ký đè; `whitelist` rỗng + `allRejections` tắt ⇒ không bao giờ báo.
 */
const SILENT: RejectionTrackerOptions = {
  allRejections: false,
  whitelist: [],
  onUnhandled: NOOP,
  onHandled: NOOP,
};

/**
 * **Chức năng:** dựng dòng text cho một promise bị reject mà không ai `catch` — tiền tố giống hệt
 * thông điệp RN 0.86 in ở LogBox (`Uncaught (in promise, id: N)`) để dò chéo được, rồi giá trị bị
 * reject qua `formatUncaught` (tên · thông điệp · **stack** của chỗ ném).
 *
 * **Input:** `id` — số do bộ theo dõi cấp · `rejection` — bất kỳ giá trị nào bị reject.
 * **Output:** chuỗi nhiều dòng; phần sau tiền tố đã cắt theo `formatUncaught`. Không bao giờ ném.
 *
 * @example
 * ```ts
 * formatRejection(0, new TypeError('x is undefined'));
 * // 'Uncaught (in promise, id: 0): TypeError: x is undefined\n    at …'
 * formatRejection(3, undefined);   // ca biên: `Promise.reject()` ⇒ 'Uncaught (in promise, id: 3): undefined'
 * ```
 *
 * **Unit test:** `rejection-tap.test.ts` › `tapUnhandledRejections` — case "reject không ai
 * catch ⇒ dòng lỗi `uncaught` có stack" kiểm text của hàm này.
 */
export const formatRejection = (id: number, rejection: unknown): string =>
  `Uncaught (in promise, id: ${id}): ${formatUncaught(rejection)}`;

/**
 * Dòng `warn` khi promise đã bị báo nay mới được `catch`. Chữ y hệt `onHandled` của RN 0.86 in ở
 * dev — để bản `--dev true` và `--dev false` cho ra cùng một dòng.
 */
const formatHandled = (id: number): string =>
  `Promise rejection handled (id: ${id})\n` +
  'This means you can ignore any previous messages of the form ' +
  `"Uncaught (in promise, id: ${id})"`;

/**
 * Bộ theo dõi RN đã đăng ký với Hermes trước khi app chạy, hoặc `undefined` nếu RN không đăng ký.
 *
 * RN 0.86 (`Libraries/Core/polyfillPromise.js`) chỉ gọi `enablePromiseRejectionTracker` **trong
 * `__DEV__`**, với đúng object export mặc định của `Libraries/promiseRejectionTrackingOptions`.
 * Viết `if (__DEV__)` y như
 * RN để Metro bỏ hẳn `require` này khỏi bundle `--dev false`. `require` nằm trong `try`: Metro của
 * RN coi đó là phụ thuộc tuỳ chọn, bản RN nào thiếu file thì chỉ mất đường chuyển tiếp, không vỡ
 * bundle.
 */
const rnDevTracker = (): RejectionTrackerOptions | undefined => {
  if (__DEV__) {
    try {
      /* Chuỗi phải viết thẳng: Metro chỉ nhận `require` với một chuỗi hằng. */
      const mod = require('react-native/Libraries/promiseRejectionTrackingOptions') as {
        default?: RejectionTrackerOptions;
      };
      return mod.default;
    } catch {
      return undefined;
    }
  }
  return undefined;
};

let installed = false;
let uninstall: () => void = NOOP;

/**
 * **Chức năng:** bắt **promise bị reject mà không ai `catch`** (vd `await api()` không
 * `try/catch`) thành một dòng **lỗi** trong nhật ký: `level: 'error'`, `uncaught: true`, có stack —
 * tức được `isErrorEntry` đếm, vào vòng giữ lỗi và được lưu theo phiên như mọi lỗi khác. Chạy ở
 * cả bản `--dev true` (UAT) lẫn `--dev false` (release).
 *
 * ## RN 0.86 + Hermes làm gì với ca này, nếu không có tap
 *
 * | Bản | Bộ theo dõi | Kết quả |
 * |---|---|---|
 * | `--dev true` | RN đăng ký `promiseRejectionTrackingOptions` | LogBox + **một** `console.error` *không có stack của chỗ ném*; **không** đi qua `ErrorUtils` nên `tapGlobalErrors` không thấy |
 * | `--dev false` | **không ai** (`polyfillPromise.js` khoá sau `__DEV__`) | biến mất không dấu vết |
 *
 * ## Nối chuỗi với RN thế nào
 *
 * Hermes giữ **đúng một** bộ theo dõi: đăng ký lần nữa là **đè** (bên trong `enable` gọi `disable`
 * trước), và không có hàm đọc bộ đang cài. Nên tap đăng ký bộ của mình, rồi ở `__DEV__` **tự
 * chuyển tiếp** mọi sự kiện cho đúng object RN đã đăng ký — LogBox vẫn hiện y như cũ. Lúc chuyển
 * tiếp, `console.*` do RN sinh ra **không** vào nhật ký (`muteConsoleTap`): dòng của tap đã đủ và
 * có stack, ghi thêm là một reject thành hai dòng lỗi.
 *
 * ## Reject bị `catch` muộn (`onHandled`)
 *
 * Hermes chỉ báo "chưa ai catch" sau **2 giây** (100ms với `TypeError` · `ReferenceError` ·
 * `RangeError`); `catch` trong khoảng đó thì không có dòng nào. `catch` **sau** khi đã báo thì tap
 * **giữ** dòng lỗi — promise thật sự đã nằm không ai xử lý chừng đó thời gian, và dòng đó có thể
 * đã vào vòng giữ lỗi / xuống đĩa — rồi ghi thêm một dòng **`warn`** cùng `id` (chữ y hệt RN in ở
 * dev). `warn` không tính là lỗi, nên huy hiệu không đếm thêm, nhưng người đọc ghép được cặp.
 *
 * 🔴 **SDK khác cũng đăng ký bộ theo dõi** (vd Sentry): ai đăng ký **sau cùng** thì thắng, bên kia
 * im lặng mất ca này. App dùng SDK như vậy ở bản bật devtools thì tắt bằng
 * `startCapture({ rejections: false })`.
 *
 * ⚠️ Chỉ Hermes có `HermesInternal.hasPromise()` (engine mặc định của RN). JSC ⇒ không làm gì.
 * Bảng trên đọc từ mã RN 0.86; RN 0.76 cũng khoá bộ theo dõi sau `__DEV__` nhưng `onUnhandled` của
 * nó đẩy thẳng vào LogBox (cảnh báo "Possible unhandled promise rejection"), không qua `console`.
 *
 * **Input:** không.
 * **Output:** hàm **gỡ**: ở `__DEV__` đăng ký lại đúng bộ của RN; ở `--dev false` đăng ký một bộ
 * câm (Hermes không có lệnh tắt). Gọi lần hai khi chưa gỡ ⇒ no-op, trả hàm gỡ của lần một. Không có
 * Hermes ⇒ không làm gì, trả hàm rỗng.
 *
 * @example
 * ```ts
 * const stop = tapUnhandledRejections();
 * fetchUser().then(render);  // fetchUser reject ⇒ ~2s sau: dòng 'UNCAUGHT Uncaught (in promise, id: 0): …'
 * stop();
 * // Ca biên: bản --dev true ⇒ LogBox vẫn hiện "Uncaught (in promise, id: 0)", nhật ký chỉ có MỘT dòng.
 * ```
 *
 * **Unit test:** `rejection-tap.test.ts` › `tapUnhandledRejections` — 9 case: không có Hermes ⇒
 * không làm gì · Hermes không dùng Promise của nó ⇒ không làm gì · reject không ai catch ⇒ dòng lỗi
 * `uncaught` có stack · `__DEV__` ⇒ bộ của RN vẫn nhận đủ sự kiện và `console.error` của nó không
 * thành dòng thứ hai · `--dev false` ⇒ không chuyển tiếp, gỡ thì đăng ký bộ câm · catch muộn ⇒
 * dòng lỗi giữ nguyên, thêm dòng `warn` cùng `id` · gọi hai lần chỉ đăng ký một lần · `stop()` ở
 * `__DEV__` trả đúng bộ của RN · bộ theo dõi thật của gói `promise`: đúng thời điểm và ghép đúng `id`.
 */
export const tapUnhandledRejections = (): (() => void) => {
  if (installed) return uninstall;
  const hermes = (globalThis as { HermesInternal?: HermesInternalLike }).HermesInternal;
  if (
    !hermes ||
    typeof hermes.enablePromiseRejectionTracker !== 'function' ||
    hermes.hasPromise?.() !== true
  ) {
    return NOOP;
  }

  const previous = rnDevTracker();

  /* Chuyển tiếp KHÔNG bọc `try`: RN tự chạy thì lỗi của nó cũng nổ ra như vậy — tap không được
     đổi số phận lỗi của chính RN. `muteConsoleTap` tự mở lại trong `finally`. */
  const forward = (
    fn: ((id: number, rejection: unknown) => void) | undefined,
    id: number,
    rejection: unknown,
  ) => {
    if (fn) muteConsoleTap(() => fn(id, rejection));
  };

  const options: RejectionTrackerOptions = {
    allRejections: true,
    onUnhandled: (id, rejection) => {
      try {
        logBuffer.push({
          id: logBuffer.nextId(),
          kind: 'console',
          at: Date.now(),
          level: 'error',
          text: formatRejection(id, rejection),
          uncaught: true,
          fatal: false,
        });
      } catch {
        /* Nuốt: công cụ gỡ lỗi hỏng không được chặn đường báo lỗi của chính app. */
      }
      forward(previous?.onUnhandled, id, rejection);
    },
    onHandled: (id, rejection) => {
      try {
        logBuffer.push({
          id: logBuffer.nextId(),
          kind: 'console',
          at: Date.now(),
          level: 'warn',
          text: formatHandled(id),
        });
      } catch {
        /* Nuốt — như trên. */
      }
      forward(previous?.onHandled, id, rejection);
    },
  };

  try {
    hermes.enablePromiseRejectionTracker(options);
  } catch {
    return NOOP;
  }

  /* So với CHÍNH NÓ, không với cờ chung — xem ghi chú cùng chỗ ở `console-tap.ts`. */
  const stop = () => {
    if (uninstall !== stop) return;
    try {
      hermes.enablePromiseRejectionTracker?.(previous ?? SILENT);
    } catch {
      /* Nuốt: gỡ hỏng thì bộ của tap vẫn chạy — vẫn đúng, chỉ là chưa trả chỗ. */
    }
    installed = false;
    uninstall = NOOP;
  };
  uninstall = stop;
  installed = true;
  return stop;
};
