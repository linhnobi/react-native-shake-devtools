import { useMemo, useSyncExternalStore } from 'react';
import { logBuffer } from '../capture/log-buffer';
import type { LogEntry } from '../capture/log-entry';
import { throttleListener } from './throttle-listener';

/**
 * Nhịp làm mới của các bề mặt đang mở (panel, màn nhật ký): tối đa 4 lần/giây. Đủ nhanh để thấy
 * dòng mới "ngay", đủ thưa để một loạt request không chiếm luồng JS mà cú bấm đang chờ.
 */
export const LIVE_REFRESH_MS = 250;

/** Ảnh chụp rỗng dùng chung — phải là **một** tham chiếu, xem lý do ở JSDoc dưới. */
const EMPTY: readonly LogEntry[] = [];

const NEVER = () => () => undefined;
const EMPTY_SNAPSHOT = () => EMPTY;

/** Đăng ký buffer qua bộ gom nhịp — huỷ đăng ký thì huỷ luôn lượt đang hẹn. */
const throttledSubscribe = (ms: number) => (onChange: () => void) => {
  const throttled = throttleListener(onChange, ms);
  const off = logBuffer.subscribe(throttled.listener);
  return () => {
    off();
    throttled.cancel();
  };
};

/**
 * **Chức năng:** đọc vòng đệm nhật ký, nhưng **chỉ khi bề mặt đang mở**.
 *
 * ## Vì sao phải có tham số `active` thay vì cứ đăng ký
 *
 * Panel và màn nhật ký được mount sẵn (chúng là component controlled, `visible` mới là thứ
 * bật/tắt). Đăng ký vô điều kiện nghĩa là **mỗi dòng log bắt được đều làm cả hai render
 * lại** — kể cả khi không có gì hiện trên màn. Với thu mạng đang bật, đó là một lần render
 * cho mỗi request và mỗi `console.log` của toàn app.
 *
 * Tệ hơn perf: nếu bất cứ thứ gì trong cây render đó gọi `console.*` (React vẫn in cảnh báo
 * lúc render), ta có vòng — log → render → log. Chốt `inside` của `tapConsole` không cứu
 * được ca này vì hai lần gọi nằm ở hai lượt khác nhau.
 *
 * ## `throttleMs` — gom nhịp ở chỗ ĐĂNG KÝ, không ở giá trị trả về
 *
 * Bề mặt đang mở truyền `LIVE_REFRESH_MS`: một loạt dòng dồn trong 250 ms chỉ làm component render
 * **một** lần. Gom ở listener (chứ không nhận mảng rồi làm chậm nó bằng một hook khác) vì chính
 * lời báo của `useSyncExternalStore` là thứ bắt component render — gom sau đó thì component vẫn
 * render theo từng dòng, chỉ là render ra cùng kết quả. Component render vì lý do khác (người
 * dùng bấm) thì vẫn đọc snapshot **mới nhất**, không phải bản của lần báo trước.
 *
 * **Input:** `active` — bề mặt có đang hiện không · `throttleMs` — cửa sổ gộp (mặc định `0`:
 * báo theo từng dòng).
 * **Output:** mảng cũ→mới khi `active`; **cùng một** mảng rỗng khi không. Trả rỗng bằng hằng
 * `EMPTY` chứ không phải `[]` mới mỗi lần: `useSyncExternalStore` so bằng `Object.is`, một
 * mảng mới mỗi lượt là render vô tận — đúng cái bẫy mà `createLogBuffer` đã tránh bằng cache.
 *
 * @example
 * ```ts
 * const entries = useLogEntries(visible, LIVE_REFRESH_MS);
 * // Ca biên: visible === false ⇒ [] và KHÔNG đăng ký listener nào vào buffer
 * ```
 *
 * **Unit test:** `use-log-entries.test.ts` › `useLogEntries` — 5 case: `active` trả đúng nội
 * dung buffer · `active` false trả mảng rỗng · `active` false **không** đăng ký listener ·
 * đổi `active` false→true thì bắt kịp dữ liệu đã có sẵn trong buffer · `throttleMs` gộp một loạt
 * dòng thành một lần render mà không rơi dòng cuối.
 */
export const useLogEntries = (
  active: boolean,
  throttleMs = 0,
): readonly LogEntry[] => {
  const subscribe = useMemo(() => {
    if (!active) return NEVER;
    return throttleMs > 0 ? throttledSubscribe(throttleMs) : logBuffer.subscribe;
  }, [active, throttleMs]);
  const getSnapshot = useMemo(
    () => (active ? logBuffer.snapshot : EMPTY_SNAPSHOT),
    [active],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
};
