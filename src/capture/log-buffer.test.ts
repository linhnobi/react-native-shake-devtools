import { createLogBuffer, type LogBuffer } from './log-buffer';
import type { ConsoleEntry, LogEntry, MarkerEntry, NetworkEntry } from './log-entry';

const con = (id: number, level: ConsoleEntry['level'] = 'info'): ConsoleEntry => ({
  id,
  kind: 'console',
  at: id,
  level,
  text: `dòng ${id}`,
});

const err = (id: number) => con(id, 'error');

/** Nhiều dòng console thường liền nhau — `cons(1, 2, 3)`. */
const cons = (...idList: number[]) => idList.map((id) => con(id));

const net = (id: number, over: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id,
  kind: 'network',
  at: id,
  method: 'GET',
  url: '/api/x',
  ...over,
});

const mark = (id: number): MarkerEntry => ({
  id,
  kind: 'marker',
  at: id,
  type: 'screen',
  label: 'UserList',
});

const pushAll = (b: LogBuffer, entries: readonly LogEntry[]) => entries.forEach((e) => b.push(e));

const ids = (b: LogBuffer) => b.snapshot().map((e) => e.id);

const screenOf = (e: LogEntry) => ('screen' in e ? e.screen : undefined);

describe('createLogBuffer', () => {
  it('giữ đúng thứ tự cũ→mới', () => {
    const b = createLogBuffer();
    pushAll(b, [con(1), net(2), mark(3), con(4, 'warn')]);

    expect(ids(b)).toEqual([1, 2, 3, 4]);
  });

  it('vượt sức chứa thì đạp dòng cũ nhất', () => {
    const b = createLogBuffer(3, 0);
    pushAll(b, cons(1, 2, 3));
    // Vừa đủ sức chứa — chưa đạp dòng nào.
    expect(ids(b)).toEqual([1, 2, 3]);

    b.push(con(4));

    expect(ids(b)).toEqual([2, 3, 4]);
  });

  /* `useSyncExternalStore` so bằng `Object.is`: mảng mới mỗi lần gọi là render vô tận. */
  it('`snapshot` cùng tham chiếu khi chưa đổi', () => {
    const b = createLogBuffer();
    b.push(con(1));
    const first = b.snapshot();

    expect(b.snapshot()).toBe(first);
    // Đổi màn không phải ghi — không được bỏ nhớ.
    b.setScreen('UserList');
    expect(b.snapshot()).toBe(first);

    // Nhánh có vòng giữ lỗi (`kept.concat(items)`) cũng nhớ như vậy.
    const withKept = createLogBuffer(1, 5);
    pushAll(withKept, [err(1), con(2)]);
    expect(withKept.snapshot()).toBe(withKept.snapshot());
  });

  it('`push` làm đổi tham chiếu', () => {
    const b = createLogBuffer();
    const listener = jest.fn();
    b.subscribe(listener);
    const before = b.snapshot();

    b.push(con(1));
    const after = b.snapshot();

    expect(after).not.toBe(before);
    expect(after.map((e) => e.id)).toEqual([1]);
    // Ảnh chụp cũ đứng yên — ai đang giữ nó không thấy dòng mới chen vào.
    expect(before).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('`patch` sửa đúng dòng', () => {
    const b = createLogBuffer();
    pushAll(b, [net(1), net(2)]);
    const before = b.snapshot();

    b.patch(2, { status: 200, durationMs: 50 });
    const after = b.snapshot() as readonly NetworkEntry[];

    expect(after[1]).toEqual({ ...net(2), status: 200, durationMs: 50 });
    expect(after[0]).toEqual(net(1));
    expect(after).not.toBe(before);
    // Sửa trên bản sao — ảnh chụp đã phát ra vẫn giữ dòng cũ.
    expect((before[1] as NetworkEntry).status).toBeUndefined();
  });

  /* Request xong khi dòng của nó đã bị đạp khỏi vòng — `patch` tới trễ, không được hồi sinh nó. */
  it('`patch` id không tồn tại là no-op', () => {
    const b = createLogBuffer(1);
    pushAll(b, [net(1), net(2)]);
    const listener = jest.fn();
    b.subscribe(listener);
    const before = b.snapshot();

    b.patch(1, { status: 500 });
    b.patch(99, { status: 500 });

    expect(b.snapshot()).toBe(before);
    expect(ids(b)).toEqual([2]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('`clear` làm rỗng cả hai vòng và báo listener', () => {
    const b = createLogBuffer(1, 5);
    pushAll(b, [err(1), con(2)]);
    expect(ids(b)).toEqual([1, 2]);
    const listener = jest.fn();
    b.subscribe(listener);

    b.clear();

    expect(b.snapshot()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    // Vòng giữ lỗi rỗng thật, không chỉ là bộ nhớ ảnh chụp bị bỏ.
    b.push(con(3));
    expect(ids(b)).toEqual([3]);
  });

  it('`setCapacity` nhỏ hơn thì cắt bớt dòng cũ', () => {
    const b = createLogBuffer(5, 0);
    pushAll(b, cons(1, 2, 3, 4, 5));

    b.setCapacity(2);

    expect(ids(b)).toEqual([4, 5]);
    // Sức chứa mới áp cho cả các lần ghi sau.
    b.push(con(6));
    expect(ids(b)).toEqual([5, 6]);
  });

  it('`capacity <= 0` kẹp về 1', () => {
    for (const capacity of [0, -3]) {
      const b = createLogBuffer(capacity, 0);
      pushAll(b, cons(1, 2));

      expect(ids(b)).toEqual([2]);
    }

    const b = createLogBuffer(5, 0);
    b.setCapacity(0);
    pushAll(b, cons(1, 2));
    expect(ids(b)).toEqual([2]);
  });

  it('⭐ lỗi bị đạp ra vẫn còn trong ảnh chụp, dòng thường thì không', () => {
    const b = createLogBuffer(2, 5);

    pushAll(b, [
      err(1),
      net(2, { status: 200 }),
      net(3, { status: 500 }),
      con(4, 'warn'),
      net(5, { error: 'network' }),
      con(6),
      con(7),
    ]);

    // 1–5 đều rời vòng chính; chỉ 3 lỗi (console.error · 500 · lỗi vận chuyển) được giữ, nằm ở
    // đáy và vẫn đúng thứ tự `id` mà không phải sắp lại.
    expect(ids(b)).toEqual([1, 3, 5, 6, 7]);
  });

  it('vòng giữ lỗi đầy thì bỏ lỗi cũ nhất', () => {
    const b = createLogBuffer(1, 2);

    pushAll(b, [err(1), err(2), err(3), con(4)]);

    expect(ids(b)).toEqual([2, 3, 4]);
    // Hạ sức chứa vòng giữ cũng bỏ từ lỗi cũ nhất.
    b.setErrorCapacity(1);
    expect(ids(b)).toEqual([3, 4]);
  });

  it('`errorCapacity = 0` tắt vòng giữ', () => {
    const sequence = () => [err(1), con(2), con(3)];
    const on = createLogBuffer(2, 1);
    pushAll(on, sequence());
    expect(ids(on)).toEqual([1, 2, 3]);

    // Cùng chuỗi ghi: tắt vòng giữ thì lỗi bị đạp như dòng thường (âm cũng kẹp về 0).
    for (const errorCapacity of [0, -1]) {
      const off = createLogBuffer(2, errorCapacity);
      pushAll(off, sequence());

      expect(ids(off)).toEqual([2, 3]);
    }

    // Tắt bằng setter thì bỏ luôn lỗi đang giữ.
    on.setErrorCapacity(0);
    expect(ids(on)).toEqual([2, 3]);
  });

  it('`setScreen` đóng dấu dòng console/mạng, không đóng dấu mốc', () => {
    const b = createLogBuffer();
    const plain = con(2);

    b.push(con(1));
    b.setScreen('UserList');
    pushAll(b, [plain, net(3), mark(4)]);
    b.setScreen(undefined);
    b.push(con(5));

    expect(b.snapshot().map((e) => [e.kind, screenOf(e)])).toEqual([
      ['console', undefined],
      ['console', 'UserList'],
      ['network', 'UserList'],
      ['marker', undefined],
      ['console', undefined],
    ]);
    // Đóng dấu trên bản sao — dòng người gọi đưa vào không bị sửa.
    expect(plain).not.toHaveProperty('screen');
  });
});
