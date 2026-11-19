import { logBuffer } from './log-buffer';
import type { LogLevel } from './log-entry';

/** `console.<tên>` nào được bắt, và nó thành mức nào trong nhật ký. */
const TAPPED: ReadonlyArray<readonly [keyof Console, LogLevel]> = [
  ['log', 'info'],
  ['info', 'info'],
  ['warn', 'warn'],
  ['error', 'error'],
  ['debug', 'debug'],
];

/** Số ký tự tối đa của một dòng console. Dài hơn thì cắt — xem `formatArgs`. */
const LINE_LIMIT = 2000;

/**
 * Số phần tử (mảng) / khoá (object) tối đa được đọc ở **mỗi cấp** khi dựng chữ cho một đối số.
 * Dòng vốn bị cắt ở `LINE_LIMIT`; đọc hết 10.000 phần tử để rồi vứt 9.950 là việc thừa — và việc
 * đó chạy **đồng bộ** trên mọi `console.*` của app ở bản dev/uat.
 */
const MAX_ITEMS_PER_LEVEL = 50;

/** Dấu thay cho phần bị bỏ vì vượt hạn mức. */
const OMITTED = '…';

/**
 * `JSON.stringify` có hạn mức: mỗi cấp chỉ đọc `MAX_ITEMS_PER_LEVEL` phần tử/khoá, và khi tổng
 * chữ đã vượt `LINE_LIMIT` thì mọi giá trị sau đó thay bằng `…` (không đi sâu nữa). Giá trị nhỏ ra
 * **y hệt** `JSON.stringify`. Vòng tham chiếu vẫn ném như cũ (người gọi bắt).
 */
const boundedStringify = (value: unknown): string | undefined => {
  let spent = 0;
  return JSON.stringify(value, (key: string, v: unknown) => {
    spent += key.length + (typeof v === 'string' ? v.length : 1);
    if (key !== '' && spent > LINE_LIMIT) return OMITTED;
    if (Array.isArray(v)) {
      return v.length > MAX_ITEMS_PER_LEVEL
        ? [...v.slice(0, MAX_ITEMS_PER_LEVEL), OMITTED]
        : v;
    }
    if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length <= MAX_ITEMS_PER_LEVEL) return v;
      const head: Record<string, unknown> = {};
      for (const k of keys.slice(0, MAX_ITEMS_PER_LEVEL)) {
        head[k] = (v as Record<string, unknown>)[k];
      }
      head[OMITTED] = keys.length - MAX_ITEMS_PER_LEVEL;
      return head;
    }
    return v;
  });
};

/**
 * **Chức năng:** gộp tham số của một lời gọi `console.*` thành một dòng text.
 *
 * Object đi qua `JSON.stringify` **có hạn mức** (`MAX_ITEMS_PER_LEVEL` mỗi cấp, dừng đi sâu khi
 * đã đủ `LINE_LIMIT` chữ): trước đây cả object bị stringify rồi mới cắt còn 2000 ký tự — một
 * `console.log(response)` với danh sách nghìn dòng tốn trọn chi phí đó ngay trên luồng JS.
 *
 * **Input:** mảng tham số bất kỳ (object lồng nhau, `Error`, vòng tham chiếu, `undefined`).
 * **Output:** chuỗi một dòng, đã cắt ở `LINE_LIMIT`. **Không bao giờ ném** — một bản vá
 * `console` mà ném thì làm chết đúng lời gọi đang cố báo lỗi, tức xoá mất manh mối.
 *
 * @example
 * ```ts
 * formatArgs(['http ok', { status: 200 }]);   // 'http ok {"status":200}'
 * formatArgs([new Error('bùm')]);             // 'Error: bùm'
 * formatArgs([Array.from({ length: 1e5 }, (_, i) => i)]); // '[0,1,…,49,"…"]' — đọc 50 phần tử
 * const a = {}; a.self = a; formatArgs([a]);  // ca biên: '[object]' — vòng tham chiếu, không ném
 * ```
 *
 * **Unit test:** `console-tap.test.ts` › `formatArgs` — 7 case: chuỗi giữ nguyên · object
 * thành JSON · `Error` ra `name: message` · vòng tham chiếu không ném · cắt ở `LINE_LIMIT` ·
 * mảng khổng lồ chỉ giữ 50 phần tử đầu kèm dấu `…` · object nhiều khoá chỉ bị đọc 50 khoá.
 */
export const formatArgs = (args: unknown[]): string => {
  const parts = args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    try {
      return boundedStringify(a) ?? String(a);
    } catch {
      return '[object]';
    }
  });
  const line = parts.join(' ');
  return line.length > LINE_LIMIT ? `${line.slice(0, LINE_LIMIT)}…` : line;
};

const NOOP = () => undefined;

/* Trạng thái vá — ở module scope vì `console` cũng là global: hai lời gọi `tapConsole()` từ
   hai nơi khác nhau vẫn phải thấy chung một sự thật. */
let installed = false;
let uninstall: () => void = NOOP;

/** Số lớp `muteConsoleTap` đang mở. Ở module scope vì cùng lý do với `installed`. */
let muted = 0;

/**
 * **Chức năng:** chạy `fn` mà **không** ghi dòng `console.*` nào nó sinh ra vào nhật ký. Hàm gốc
 * của `console` vẫn được gọi như thường (Metro, LogBox vẫn thấy) — chỉ vòng đệm bỏ qua.
 *
 * Dành cho một bộ bắt khác của lib đã tự ghi dòng **đầy đủ hơn** cho cùng sự việc rồi mới trả về
 * handler của RN, mà handler đó lại `console.error` đúng sự việc ấy. Không tắt thì một lỗi thành
 * hai dòng lỗi và huy hiệu đếm đôi. Xem `tapGlobalErrors` · `tapUnhandledRejections`.
 *
 * **Input:** `fn` — chạy **đồng bộ**; dòng `console.*` gọi sau khi `fn` trả về (trong một
 * `setTimeout`, sau `await`) vẫn được ghi.
 * **Output:** đúng giá trị `fn` trả. `fn` ném ⇒ ném lại, và bộ ghi vẫn mở lại.
 *
 * @example
 * ```ts
 * muteConsoleTap(() => console.error('đã ghi ở chỗ khác'));  // in ra Metro, không vào nhật ký
 * muteConsoleTap(() => muteConsoleTap(() => 1));               // ca biên: lồng nhau ⇒ 1, mở lại khi lớp ngoài xong
 * ```
 *
 * **Unit test:** `console-tap.test.ts` › `muteConsoleTap` — 3 case: hàm gốc vẫn được gọi nhưng
 * không có dòng nào vào buffer · sau khi `fn` xong thì ghi lại bình thường · `fn` ném thì vẫn mở lại.
 */
export const muteConsoleTap = <T>(fn: () => T): T => {
  muted += 1;
  try {
    return fn();
  } finally {
    muted -= 1;
  }
};

/**
 * **Chức năng:** bọc `console.log/info/warn/error/debug` để mọi dòng vừa in ra như cũ, vừa
 * rơi vào vòng đệm nhật ký.
 *
 * 🔴 **Bọc chồng, không thay thế.** Hàm gốc luôn được gọi — Reactotron, LogBox và terminal
 * Metro đều đang đứng trên cùng những hàm này. Cướp chỗ của chúng là đánh đổi một công cụ
 * lấy ba công cụ.
 *
 * ⚠️ Có **chốt chống đệ quy** (`inside`): nếu `logBuffer.push` — hay bất cứ thứ gì nó gọi —
 * lại gọi `console.*`, bản vá sẽ gọi chính nó mãi và app treo. Đây không phải lo xa: một
 * listener của buffer ném lỗi là React in `console.error`.
 *
 * **Input:** không.
 * **Output:** hàm **gỡ vá**, trả `console.*` về đúng hàm đang có lúc vá. Gọi `tapConsole()`
 * hai lần mà chưa gỡ ⇒ lần hai là **no-op** (trả hàm gỡ của lần một), nên không chồng hai
 * lớp vá lên nhau.
 *
 * @example
 * ```ts
 * const stop = tapConsole();
 * console.warn('ối');       // vẫn in ra terminal, đồng thời vào nhật ký ở mức 'warn'
 * stop();                   // ca biên: gọi stop() hai lần — lần hai không làm gì
 * ```
 *
 * **Unit test:** `console-tap.test.ts` › `tapConsole` — 6 case: hàm gốc vẫn được gọi với
 * đúng tham số · dòng vào buffer đúng mức · gọi hai lần chỉ vá một lớp · `stop()` khôi phục
 * đúng hàm gốc · `stop()` hai lần không ném · `console.*` ném bên trong buffer không làm
 * treo (chốt đệ quy).
 */
export const tapConsole = (): (() => void) => {
  if (installed) return uninstall;

  const originals = new Map<keyof Console, unknown>();
  /* MỘT cờ dùng chung cho cả 5 hàm: `console.error` gọi bên trong lúc đang xử lý
     `console.log` cũng phải bị chặn. Cờ riêng từng hàm sẽ không thấy ca chéo đó. */
  const guard = { inside: false };

  /* Dựng bản vá ở hàm riêng chứ không inline trong vòng lặp — `no-loop-func` chặn closure
     tạo trong vòng lặp có tham chiếu tới biến thay đổi được. */
  const patch =
    (original: (...a: unknown[]) => void, level: LogLevel) =>
    (...args: unknown[]) => {
      original.apply(console, args);
      if (guard.inside || muted > 0) return;
      guard.inside = true;
      try {
        logBuffer.push({
          id: logBuffer.nextId(),
          kind: 'console',
          at: Date.now(),
          level,
          text: formatArgs(args),
        });
      } catch {
        /* Nuốt: một công cụ gỡ lỗi hỏng không được phép làm hỏng app đang gỡ. */
      } finally {
        guard.inside = false;
      }
    };

  for (const [name, level] of TAPPED) {
    const original = console[name] as ((...a: unknown[]) => void) | undefined;
    if (typeof original !== 'function') continue;
    originals.set(name, original);
    (console as unknown as Record<string, unknown>)[name] = patch(
      original,
      level,
    );
  }

  /*
    So với CHÍNH NÓ (`uninstall !== stop`), không với cờ `installed` dùng chung: giữ một hàm gỡ
    của lần vá cũ rồi gọi nó sau khi đã vá lại (tắt thu → bật thu) thì cờ chung đang `true` của
    lần vá MỚI, và lần gọi đó gỡ mất bản vá mới — im lặng, không còn dòng nào vào nhật ký.
  */
  const stop = () => {
    if (uninstall !== stop) return;
    originals.forEach((fn, name) => {
      (console as unknown as Record<string, unknown>)[name as string] = fn;
    });
    installed = false;
    uninstall = NOOP;
  };
  uninstall = stop;
  installed = true;
  return stop;
};
