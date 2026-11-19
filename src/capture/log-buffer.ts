import type { LogEntry } from './log-entry';
import { isErrorEntry } from './log-query';

/** Sức chứa mặc định. 300 dòng ≈ vài phút thao tác, đủ để lần ngược một lỗi vừa xảy ra. */
export const DEFAULT_CAPACITY = 300;

/**
 * Số dòng **lỗi** được giữ thêm sau khi đã rời vòng chính.
 *
 * Vòng chính đạp dòng cũ theo số lượng, không phân biệt dòng nào quan trọng — một màn ồn ào (log
 * thư viện, request polling) đi hết 300 dòng trong một hai phút là lỗi lúc nãy biến mất trước khi
 * kịp mở nhật ký. 100 lỗi đủ cho một buổi thử mà vẫn chặn được vòng lặp lỗi làm phình RAM.
 */
export const DEFAULT_ERROR_CAPACITY = 100;

export interface LogBuffer {
  /**
   * Ghi một dòng. Đầy thì **đạp dòng cũ nhất**; dòng bị đạp mà là lỗi thì chuyển sang vòng giữ
   * lỗi. Không bao giờ ném. Dòng console/mạng được đóng dấu màn hiện tại (`setScreen`).
   */
  push: (entry: LogEntry) => void;
  /**
   * Sửa một dòng đã ghi (dùng khi request xong: điền `status`/`durationMs`/thân phản hồi).
   * Không tìm thấy `id` ⇒ **no-op**, vì dòng đó có thể đã bị đạp ra khỏi vòng.
   */
  patch: (id: number, partial: Partial<LogEntry>) => void;
  /**
   * Ảnh chụp cũ→mới: **các lỗi đã rời vòng chính** rồi tới **vòng chính**. Trả **cùng một tham
   * chiếu** tới khi có thay đổi — xem JSDoc dưới.
   */
  snapshot: () => readonly LogEntry[];
  clear: () => void;
  /** Đăng ký nghe thay đổi; trả hàm huỷ đăng ký. */
  subscribe: (listener: () => void) => () => void;
  setCapacity: (n: number) => void;
  /** Sức chứa của vòng giữ lỗi. `0` ⇒ tắt (hành vi cũ: lỗi bị đạp như mọi dòng khác). */
  setErrorCapacity: (n: number) => void;
  /**
   * Màn đang mở — từ giờ mọi dòng console/mạng được ghi kèm `screen` này. `undefined` ⇒ thôi
   * đóng dấu. Không tự ghi mốc: ghi mốc là việc của `markScreen` (có chống trùng).
   */
  setScreen: (name: string | undefined) => void;
  nextId: () => number;
}

/**
 * **Chức năng:** dựng một vòng đệm log — thuần, không biết React, không biết RN.
 *
 * ## Vì sao `snapshot()` phải trả cùng một tham chiếu
 *
 * Màn nhật ký đọc buffer qua `useSyncExternalStore`, mà hàm đó so kết quả bằng `Object.is`:
 * trả mảng mới mỗi lần gọi thì React coi là dữ liệu đổi ở **mọi** lần render và rơi vào vòng
 * lặp render vô tận. Nên mảng được dựng một lần rồi **nhớ lại**, chỉ bỏ nhớ khi có ghi/xoá.
 *
 * ## Hai vòng, một ảnh chụp
 *
 * `items` là vòng chính (mọi dòng, đạp theo số lượng). `kept` giữ **lỗi đã bị đạp ra** khỏi vòng
 * chính, có sức chứa riêng. Dòng bị đạp luôn cũ hơn mọi dòng còn trong vòng chính, nên
 * `[...kept, ...items]` vẫn đúng thứ tự `id` mà không phải sắp lại. Người đọc (`LogSheet`, file
 * xuất, bộ đếm) chỉ thấy **một** nhật ký — lỗi cũ nằm ở đáy, cách phần còn lại một khoảng thời
 * gian, đúng như sự thật.
 *
 * ⚠️ Request **đang bay** mà bị đạp ra thì không vào `kept` (lúc đó nó chưa là lỗi), và `patch` về
 * sau không tìm thấy nó — một request vừa treo đủ lâu cho 300 dòng khác chen qua vừa lỗi thì mất.
 * Ca hiếm; giữ mọi request đang bay thì request treo vĩnh viễn làm phình vòng giữ.
 *
 * **Input:** `capacity` — số dòng vòng chính; `errorCapacity` — số lỗi giữ thêm. `capacity <= 0`
 * bị kẹp về `1` (vòng 0 dòng gần như chắc chắn là lỗi cấu hình); `errorCapacity < 0` kẹp về `0`.
 * **Output:** `LogBuffer`. Mỗi lời gọi dựng một vòng **độc lập** — không chia sẻ trạng thái.
 *
 * @example
 * ```ts
 * const b = createLogBuffer(2, 1);
 * b.push(errA); b.push(c); b.push(d);
 * b.snapshot();                    // [errA, c, d] — errA rời vòng chính nhưng được giữ vì là lỗi
 * b.snapshot() === b.snapshot();   // true — cùng tham chiếu khi chưa có gì đổi
 * createLogBuffer(2, 0);           // ca biên: tắt vòng giữ ⇒ errA bị đạp như dòng thường
 * ```
 *
 * **Unit test:** `log-buffer.test.ts` › `createLogBuffer` — 13 case: giữ đúng thứ tự cũ→mới ·
 * vượt sức chứa thì đạp dòng cũ nhất · `snapshot` cùng tham chiếu khi chưa đổi · `push` làm đổi
 * tham chiếu · `patch` sửa đúng dòng · `patch` id không tồn tại là no-op · `clear` làm rỗng cả hai
 * vòng và báo listener · `setCapacity` nhỏ hơn thì cắt bớt dòng cũ · `capacity <= 0` kẹp về 1 ·
 * ⭐ lỗi bị đạp ra vẫn còn trong ảnh chụp, dòng thường thì không · vòng giữ lỗi đầy thì bỏ lỗi cũ
 * nhất · `errorCapacity = 0` tắt vòng giữ · `setScreen` đóng dấu dòng console/mạng, không đóng dấu
 * mốc.
 */
export const createLogBuffer = (
  capacity = DEFAULT_CAPACITY,
  errorCapacity = DEFAULT_ERROR_CAPACITY,
): LogBuffer => {
  let max = Math.max(1, capacity);
  let errorMax = Math.max(0, errorCapacity);
  let items: LogEntry[] = [];
  let kept: LogEntry[] = [];
  let cached: readonly LogEntry[] | null = null;
  let seq = 0;
  let screen: string | undefined;
  const listeners = new Set<() => void>();

  const changed = () => {
    cached = null;
    listeners.forEach((l) => l());
  };

  const trimKept = () => {
    if (kept.length > errorMax) kept = kept.slice(kept.length - errorMax);
  };

  const trim = () => {
    if (items.length <= max) return;
    const evicted = items.slice(0, items.length - max);
    items = items.slice(items.length - max);
    if (errorMax === 0) return;
    const errors = evicted.filter(isErrorEntry);
    if (errors.length === 0) return;
    kept = kept.concat(errors);
    trimKept();
  };

  const stamp = (entry: LogEntry): LogEntry =>
    screen === undefined || entry.kind === 'marker' || entry.screen !== undefined
      ? entry
      : { ...entry, screen };

  return {
    push: (entry) => {
      items.push(stamp(entry));
      trim();
      changed();
    },
    patch: (id, partial) => {
      const i = items.findIndex((e) => e.id === id);
      if (i < 0) return;
      items[i] = { ...items[i], ...partial } as LogEntry;
      changed();
    },
    snapshot: () => {
      if (cached === null) cached = kept.length ? kept.concat(items) : items.slice();
      return cached;
    },
    clear: () => {
      items = [];
      kept = [];
      changed();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setCapacity: (n) => {
      max = Math.max(1, n);
      trim();
      changed();
    },
    setErrorCapacity: (n) => {
      errorMax = Math.max(0, n);
      trimKept();
      changed();
    },
    setScreen: (name) => {
      screen = name;
    },
    nextId: () => (seq += 1),
  };
};

/**
 * Vòng đệm **dùng chung** của app.
 *
 * Là singleton chứ không phải context: hai bên ghi vào nó — bản vá `console.*` và bản vá
 * `XMLHttpRequest` — đều là **global**, chạy ngoài cây React và không có cách nào nhận
 * context. Bắt chúng đi vòng qua provider chỉ để giữ hình thức sẽ tạo ra một lớp trung gian
 * không ai đọc.
 */
export const logBuffer = createLogBuffer();
