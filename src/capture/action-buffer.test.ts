import { actionBuffer, createActionBuffer, DEFAULT_ACTION_CAPACITY } from './action-buffer';
import type { RecordedAction } from './recorded-action';

const tap = (at: number, label = `n${at}`): RecordedAction => ({ at, kind: 'tap', label, source: 'text' });

describe('createActionBuffer', () => {
  it('sức chứa mặc định là 100', () => {
    expect(DEFAULT_ACTION_CAPACITY).toBe(100);
  });

  it('giữ đúng thứ tự cũ → mới', () => {
    const b = createActionBuffer();
    b.push(tap(1));
    b.push(tap(2));
    expect(b.snapshot().map((a) => a.at)).toEqual([1, 2]);
  });

  it('thao tác thứ 101 đạp thao tác cũ nhất', () => {
    const b = createActionBuffer();
    for (let i = 1; i <= 101; i++) b.push(tap(i));
    const snap = b.snapshot();
    expect(snap).toHaveLength(100);
    expect(snap[0]?.at).toBe(2);
    expect(snap[99]?.at).toBe(101);
  });

  it('sức chứa tuỳ chỉnh; <= 0 kẹp về 1', () => {
    const small = createActionBuffer(2);
    small.push(tap(1));
    small.push(tap(2));
    small.push(tap(3));
    expect(small.snapshot().map((a) => a.at)).toEqual([2, 3]);

    const clamped = createActionBuffer(0);
    clamped.push(tap(1));
    clamped.push(tap(2));
    expect(clamped.snapshot().map((a) => a.at)).toEqual([2]);
  });

  it('`since(t)` chỉ trả thao tác có at >= t', () => {
    const b = createActionBuffer();
    [10, 20, 30].forEach((t) => b.push(tap(t)));
    expect(b.since(20).map((a) => a.at)).toEqual([20, 30]);
    expect(b.since(31)).toEqual([]);
    expect(b.since(0)).toHaveLength(3);
  });

  it('`snapshot` cùng tham chiếu khi chưa đổi; `push` và `clear` làm đổi', () => {
    const b = createActionBuffer();
    b.push(tap(1));
    const first = b.snapshot();
    expect(b.snapshot()).toBe(first);
    b.push(tap(2));
    expect(b.snapshot()).not.toBe(first);
    const second = b.snapshot();
    b.clear();
    expect(b.snapshot()).toEqual([]);
    expect(b.snapshot()).not.toBe(second);
  });

  it('`subscribe` được báo mỗi lần push (và clear); huỷ rồi thì không báo nữa', () => {
    const b = createActionBuffer();
    const l = jest.fn();
    const off = b.subscribe(l);
    b.push(tap(1));
    b.push(tap(2));
    expect(l).toHaveBeenCalledTimes(2);
    b.clear();
    expect(l).toHaveBeenCalledTimes(3);
    off();
    b.push(tap(3));
    expect(l).toHaveBeenCalledTimes(3);
  });

  it('mỗi lần dựng là một bộ đệm độc lập; `actionBuffer` dùng chung là một bản riêng', () => {
    const a = createActionBuffer();
    const c = createActionBuffer();
    a.push(tap(1));
    expect(c.snapshot()).toEqual([]);
    expect(actionBuffer.snapshot()).toEqual([]);
  });
});
