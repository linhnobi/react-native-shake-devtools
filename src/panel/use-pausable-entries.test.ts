import { act, renderHook } from '@testing-library/react-native';
import type { ConsoleEntry, LogEntry } from '../capture/log-entry';
import { usePausableEntries } from './use-pausable-entries';

const con = (id: number): ConsoleEntry => ({
  id,
  kind: 'console',
  at: id,
  level: 'info',
  text: `line ${id}`,
});

const range = (from: number, to: number): LogEntry[] =>
  Array.from({ length: to - from + 1 }, (_, i) => con(from + i));

/** `live` đi qua `initialProps` + `rerender` — đúng như `useLogEntries` đổ mảng mới vào mỗi lần buffer đổi. */
const setup = (live: readonly LogEntry[]) =>
  renderHook(({ entries }: { entries: readonly LogEntry[] }) => usePausableEntries(entries), {
    initialProps: { entries: live },
  });

afterEach(() => jest.restoreAllMocks());

describe('usePausableEntries', () => {
  it('đang chạy trả nhật ký sống', () => {
    const first = range(1, 2);
    const { result, rerender } = setup(first);

    expect(result.current.entries).toBe(first);
    expect(result.current.paused).toBe(false);
    expect(result.current.pausedAt).toBeUndefined();
    expect(result.current.fresh).toBe(0);

    const next = range(1, 3);
    rerender({ entries: next });

    expect(result.current.entries).toBe(next);
  });

  it('tạm dừng giữ ảnh chụp dù live đổi', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1790000000000);
    const snapshot = range(1, 2);
    const { result, rerender } = setup(snapshot);

    act(() => result.current.toggle());

    expect(result.current.paused).toBe(true);
    expect(result.current.pausedAt).toBe(1790000000000);

    rerender({ entries: range(1, 4) });

    expect(result.current.entries).toBe(snapshot);
    expect(result.current.paused).toBe(true);
  });

  it('`fresh` đếm dòng mới theo id', () => {
    const { result, rerender } = setup(range(1, 2));

    act(() => result.current.toggle());
    rerender({ entries: range(1, 5) });

    expect(result.current.fresh).toBe(3);
  });

  /*
    Vòng đệm đầy thì đạp dòng cũ ra: độ dài mảng sống đứng yên (3 → 3) trong khi đã có dòng mới.
    Đếm theo độ dài thì ra 0 — đếm theo id mới ra đúng.
  */
  it('`fresh` đúng khi dòng cũ bị đạp ra', () => {
    const { result, rerender } = setup(range(1, 3));

    act(() => result.current.toggle());
    rerender({ entries: range(3, 5) });

    expect(result.current.fresh).toBe(2);

    rerender({ entries: range(4, 6) });

    expect(result.current.fresh).toBe(3);
  });

  it('`resume` về nhật ký sống và `fresh` về 0', () => {
    const { result, rerender } = setup(range(1, 2));

    act(() => result.current.toggle());
    const latest = range(1, 6);
    rerender({ entries: latest });
    expect(result.current.fresh).toBe(4);

    act(() => result.current.resume());

    expect(result.current.entries).toBe(latest);
    expect(result.current.paused).toBe(false);
    expect(result.current.pausedAt).toBeUndefined();
    expect(result.current.fresh).toBe(0);
  });

  /* Thanh nút đáy `useMemo` theo `toggle` — danh tính đổi theo từng dòng log là dựng lại footer. */
  it('`toggle` giữ nguyên danh tính khi live đổi mà vẫn chụp đúng bản mới nhất', () => {
    const { result, rerender } = setup(range(1, 2));
    const toggle = result.current.toggle;

    const latest = range(1, 3);
    rerender({ entries: latest });
    expect(result.current.toggle).toBe(toggle);

    act(() => result.current.toggle());
    expect(result.current.entries).toBe(latest);
  });
});
