import { act, renderHook } from '@testing-library/react-native';
import { logBuffer } from '../capture/log-buffer';
import type { ConsoleEntry, LogEntry } from '../capture/log-entry';
import { useLogEntries } from './use-log-entries';

const con = (id: number): ConsoleEntry => ({
  id,
  kind: 'console',
  at: id,
  level: 'info',
  text: `dòng ${id}`,
});

const seed = (...ids: number[]) => ids.forEach((id) => logBuffer.push(con(id)));

const renderEntries = (active: boolean) =>
  renderHook(({ on }: { on: boolean }) => useLogEntries(on), {
    initialProps: { on: active },
  });

const idsOf = (entries: readonly LogEntry[]) => entries.map((e) => e.id);

beforeEach(() => logBuffer.clear());
afterEach(() => jest.restoreAllMocks());

describe('useLogEntries', () => {
  it('`active` trả đúng nội dung buffer', () => {
    seed(1, 2);
    const { result } = renderEntries(true);

    expect(result.current).toBe(logBuffer.snapshot());
    expect(idsOf(result.current)).toEqual([1, 2]);

    /* Đang mở thì dòng mới phải hiện ngay — tức hook thật sự nghe buffer. */
    act(() => {
      logBuffer.push(con(3));
    });
    expect(idsOf(result.current)).toEqual([1, 2, 3]);
  });

  /* Cùng MỘT mảng rỗng qua các lượt: mảng mới mỗi lần là render vô tận với `useSyncExternalStore`. */
  it('`active` false trả mảng rỗng', () => {
    seed(1, 2);
    const { result, rerender } = renderEntries(false);

    expect(result.current).toHaveLength(0);

    const first = result.current;
    rerender({ on: false });
    expect(result.current).toBe(first);
  });

  it('`active` false **không** đăng ký listener', () => {
    const subscribe = jest.spyOn(logBuffer, 'subscribe');
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useLogEntries(false);
    });
    const afterMount = renders;

    act(() => seed(1, 2, 3));

    expect(subscribe).not.toHaveBeenCalled();
    expect(renders).toBe(afterMount);
  });

  it('đổi `active` false→true thì bắt kịp dữ liệu đã có sẵn trong buffer', () => {
    const { result, rerender } = renderEntries(false);

    /* Ghi lúc bề mặt còn đóng — không ai nghe, nên hook không được báo. */
    seed(1, 2);
    expect(result.current).toHaveLength(0);

    rerender({ on: true });
    expect(idsOf(result.current)).toEqual([1, 2]);
  });

  /* Một loạt request đổ về trong lúc màn mở: một lần render cho cả loạt, dòng cuối vẫn tới. */
  it('`throttleMs` gộp một loạt dòng thành một lần render mà không rơi dòng cuối', () => {
    jest.useFakeTimers();
    try {
      let renders = 0;
      const { result } = renderHook(() => {
        renders += 1;
        return useLogEntries(true, 250);
      });
      const afterMount = renders;

      act(() => seed(1));
      expect(idsOf(result.current)).toEqual([1]);
      expect(renders).toBe(afterMount + 1);

      act(() => seed(2, 3, 4));
      expect(renders).toBe(afterMount + 1);

      act(() => {
        jest.advanceTimersByTime(250);
      });
      expect(idsOf(result.current)).toEqual([1, 2, 3, 4]);
      expect(renders).toBe(afterMount + 2);
    } finally {
      jest.useRealTimers();
    }
  });
});
