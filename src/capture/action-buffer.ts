import type { RecordedAction } from './recorded-action';

/** Sức chứa mặc định. 100 thao tác dư cho một ca tái hiện lỗi; form chỉ hiện 30 bước cuối. */
export const DEFAULT_ACTION_CAPACITY = 100;

export interface ActionBuffer {
  /** Ghi một thao tác. Đầy thì **đạp thao tác cũ nhất**. Không bao giờ ném. */
  push: (a: RecordedAction) => void;
  /** Ảnh chụp cũ → mới. Trả **cùng một tham chiếu** tới khi có thay đổi. */
  snapshot: () => readonly RecordedAction[];
  /** Các thao tác có `at >= at`, cũ → mới. */
  since: (at: number) => readonly RecordedAction[];
  clear: () => void;
  /** Đăng ký nghe thay đổi; trả hàm huỷ đăng ký. */
  subscribe: (listener: () => void) => () => void;
}

/**
 * **Chức năng:** dựng vòng đệm thao tác của QA (chạm, nhập, Back, app xuống/lên nền) — thuần, không
 * biết React, không biết RN. Cùng khuôn với `createLogBuffer`.
 *
 * `snapshot()` trả cùng một tham chiếu tới khi có ghi/xoá, vì UI đọc qua `useSyncExternalStore`
 * (so bằng `Object.is`): trả mảng mới mỗi lần gọi sẽ gây vòng lặp render.
 *
 * **Input:** `capacity` — số thao tác tối đa; `<= 0` kẹp về `1`.
 * **Output:** {@link ActionBuffer}. Mỗi lời gọi dựng một vòng **độc lập**.
 *
 * @example
 * ```ts
 * const b = createActionBuffer(2);
 * b.push(a1); b.push(a2); b.push(a3);
 * b.snapshot();                    // [a2, a3] — a1 bị đạp
 * b.since(a3.at);                  // [a3]
 * b.snapshot() === b.snapshot();   // true — chưa có gì đổi
 * createActionBuffer(0);           // ca biên: kẹp về sức chứa 1
 * ```
 *
 * **Unit test:** `action-buffer.test.ts` — 8 case: sức chứa mặc định 100 · thứ tự cũ→mới · thứ 101
 * đạp thao tác cũ nhất · sức chứa tuỳ chỉnh và kẹp về 1 · `since` lọc `at >= t` · `snapshot` cùng
 * tham chiếu khi chưa đổi · `subscribe` báo mỗi lần push/clear và huỷ được · các bộ đệm độc lập.
 */
export const createActionBuffer = (capacity = DEFAULT_ACTION_CAPACITY): ActionBuffer => {
  const max = Math.max(1, capacity);
  let items: RecordedAction[] = [];
  let cached: readonly RecordedAction[] | null = null;
  const listeners = new Set<() => void>();

  const changed = () => {
    cached = null;
    listeners.forEach((l) => l());
  };

  return {
    push: (a) => {
      items.push(a);
      if (items.length > max) items = items.slice(items.length - max);
      changed();
    },
    snapshot: () => {
      if (cached === null) cached = items.slice();
      return cached;
    },
    since: (at) => items.filter((a) => a.at >= at),
    clear: () => {
      items = [];
      changed();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/** Vòng đệm thao tác **dùng chung** của app — `TouchRecorder` ghi vào, bug report đọc ra. */
export const actionBuffer = createActionBuffer();
