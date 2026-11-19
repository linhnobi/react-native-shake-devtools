import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry } from '../capture/log-entry';

export interface PausableEntries {
  /** Thứ màn đang vẽ: ảnh chụp lúc tạm dừng, hoặc nhật ký sống. */
  readonly entries: readonly LogEntry[];
  readonly paused: boolean;
  /** Mốc bấm Tạm dừng (`Date.now()`); `undefined` khi đang chạy. */
  readonly pausedAt: number | undefined;
  /** Số dòng mới vào nhật ký sống kể từ lúc tạm dừng. `0` khi đang chạy. */
  readonly fresh: number;
  readonly toggle: () => void;
  readonly resume: () => void;
}

/**
 * **Chức năng:** cho màn nhật ký **đứng yên** để đọc trong khi app vẫn chạy — giữ ảnh chụp lúc
 * bấm Tạm dừng, đếm số dòng mới đổ vào phía sau.
 *
 * ## Vì sao cần
 *
 * Danh sách xếp mới nhất lên đầu: mỗi dòng mới chèn vào đỉnh đẩy cả danh sách xuống một hàng.
 * Với thu mạng đang bật (polling, log thư viện), dòng đang đọc trôi khỏi tầm mắt vài lần mỗi giây.
 *
 * Tạm dừng **chỉ dừng màn**, không dừng thu: vòng đệm vẫn ghi, file xuất vẫn lấy dữ liệu mới
 * nhất. Dừng thu thì chính lỗi xảy ra trong lúc đang đọc sẽ không bao giờ được ghi.
 *
 * **Input:** `live` — nhật ký sống (cũ→mới, từ `useLogEntries`).
 * **Output:** {@link PausableEntries}. `fresh` đếm theo `id` (không theo độ dài mảng) nên đúng cả
 * khi vòng đệm đã đạp dòng cũ ra trong lúc tạm dừng. `toggle`/`resume` **giữ nguyên danh tính**
 * suốt vòng đời: `toggle` đọc `live` qua ref, không qua closure — nếu không nó đổi theo mỗi lần
 * nhật ký đổi, và thanh nút đáy (`useMemo` theo nó) bị dựng lại theo từng dòng log.
 *
 * @example
 * ```ts
 * const p = usePausableEntries(live);
 * p.toggle();     // tạm dừng — p.entries đứng yên
 * // … 5 request mới vào …
 * p.fresh;        // 5
 * p.resume();     // về nhật ký sống
 * // Ca biên: live bị xoá sạch trong lúc tạm dừng ⇒ fresh = 0, ảnh chụp vẫn giữ tới khi resume.
 * ```
 *
 * **Unit test:** `use-pausable-entries.test.ts` › `usePausableEntries` — 6 case: đang chạy trả
 * nhật ký sống · tạm dừng giữ ảnh chụp dù live đổi · `fresh` đếm dòng mới theo id · `fresh` đúng
 * khi dòng cũ bị đạp ra · `resume` về nhật ký sống và `fresh` về 0 · `toggle` giữ nguyên danh
 * tính khi live đổi mà vẫn chụp đúng bản mới nhất.
 */
export const usePausableEntries = (live: readonly LogEntry[]): PausableEntries => {
  const [frozen, setFrozen] = useState<{
    entries: readonly LogEntry[];
    at: number;
  } | null>(null);

  /* Bản `live` đã commit gần nhất — cú bấm luôn tới sau commit, nên cập nhật trong effect là đủ. */
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  const fresh = useMemo(() => {
    if (!frozen) return 0;
    const lastId = frozen.entries.length
      ? frozen.entries[frozen.entries.length - 1].id
      : 0;
    return live.reduce((n, e) => (e.id > lastId ? n + 1 : n), 0);
  }, [frozen, live]);

  const resume = useCallback(() => setFrozen(null), []);
  const toggle = useCallback(
    () =>
      setFrozen((cur) =>
        cur ? null : { entries: liveRef.current, at: Date.now() },
      ),
    [],
  );

  return {
    entries: frozen ? frozen.entries : live,
    paused: frozen !== null,
    pausedAt: frozen?.at,
    fresh,
    toggle,
    resume,
  };
};
