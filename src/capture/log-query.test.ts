import type {
  ConsoleEntry,
  LogEntry,
  MarkerEntry,
  NetworkEntry,
} from './log-entry';
import {
  countErrors,
  filterLog,
  isAbortedEntry,
  isErrorEntry,
  isSlowEntry,
  matchesQuery,
  parseQuery,
} from './log-query';

const con = (id: number, level: ConsoleEntry['level'], text = 'x'): ConsoleEntry => ({
  id,
  kind: 'console',
  at: id,
  level,
  text,
});

const net = (id: number, over: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id,
  kind: 'network',
  at: id,
  method: 'GET',
  url: '/api/x',
  ...over,
});

const mark = (id: number, label = 'UserList'): MarkerEntry => ({
  id,
  kind: 'marker',
  at: id,
  type: 'screen',
  label,
});

describe('isErrorEntry', () => {
  it('`console.error` là lỗi', () => {
    expect(isErrorEntry(con(1, 'error'))).toBe(true);
  });

  /* `warn` gộp vào thì chip "Chỉ lỗi" ngập cảnh báo deprecated của thư viện. */
  it('`console.warn` KHÔNG phải lỗi', () => {
    expect(isErrorEntry(con(1, 'warn'))).toBe(false);
  });

  it('status 400 là lỗi — biên dưới', () => {
    expect(isErrorEntry(net(1, { status: 400 }))).toBe(true);
  });

  it('status 399 không phải lỗi', () => {
    expect(isErrorEntry(net(1, { status: 399 }))).toBe(false);
  });

  it('lỗi tầng vận chuyển (không có status) là lỗi', () => {
    expect(isErrorEntry(net(1, { error: 'network' }))).toBe(true);
  });

  /* Huỷ là app tự quyết (rời màn, gõ tiếp ô tìm) — tính vào thì huy hiệu đỏ nhảy theo mỗi lần huỷ. */
  it('request bị app huỷ KHÔNG phải lỗi (timeout thì vẫn là lỗi)', () => {
    expect(isErrorEntry(net(1, { error: 'abort', durationMs: 40 }))).toBe(false);
    expect(isAbortedEntry(net(1, { error: 'abort' }))).toBe(true);
    expect(isErrorEntry(net(1, { error: 'timeout' }))).toBe(true);
    expect(isAbortedEntry(net(1, { error: 'timeout' }))).toBe(false);
  });

  it('request đang bay (chưa status, chưa error) KHÔNG phải lỗi', () => {
    expect(isErrorEntry(net(1))).toBe(false);
  });

  it('mốc không bao giờ là lỗi', () => {
    expect(isErrorEntry(mark(1))).toBe(false);
  });
});

describe('isSlowEntry', () => {
  it('trên ngưỡng là chậm', () => {
    expect(isSlowEntry(net(1, { status: 200, durationMs: 3200 }), 3000)).toBe(true);
  });

  it('đúng ngưỡng là chậm', () => {
    expect(isSlowEntry(net(1, { status: 200, durationMs: 3000 }), 3000)).toBe(true);
  });

  it('dưới ngưỡng không chậm', () => {
    expect(isSlowEntry(net(1, { status: 200, durationMs: 2999 }), 3000)).toBe(false);
  });

  /* Request treo được thấy qua nhãn "pending", không qua chip "Chậm ≥3s". */
  it('request đang bay không chậm', () => {
    expect(isSlowEntry(net(1), 3000)).toBe(false);
  });
});

describe('countErrors', () => {
  it('đếm đúng trên nhật ký hỗn hợp', () => {
    const entries: LogEntry[] = [
      con(1, 'error'),
      con(2, 'info'),
      net(3, { status: 200 }),
      net(4, { status: 500 }),
      net(5, { error: 'network' }),
      net(6),
      mark(7),
      net(8, { error: 'abort' }),
    ];
    expect(countErrors(entries)).toBe(3);
  });

  it('mảng rỗng ⇒ 0', () => {
    expect(countErrors([])).toBe(0);
  });
});

describe('parseQuery', () => {
  it('`status:5xx` khớp cả lớp 500–599', () => {
    const { predicates, free } = parseQuery('status:5xx');
    const ok = (s: number) => predicates.every((p) => p(net(1, { status: s })));

    expect(free).toBe('');
    expect([ok(500), ok(599), ok(499), ok(600)]).toEqual([true, true, false, false]);
  });

  it('`status:404` khớp đúng mã', () => {
    const { predicates } = parseQuery('status:404');

    expect(predicates[0](net(1, { status: 404 }))).toBe(true);
    expect(predicates[0](net(1, { status: 405 }))).toBe(false);
  });

  it('`method:` không phân biệt hoa thường, cả tiền tố lẫn giá trị', () => {
    const { predicates } = parseQuery('Method:POST');

    expect(predicates[0](net(1, { method: 'POST' }))).toBe(true);
    expect(predicates[0](net(1, { method: 'GET' }))).toBe(false);
  });

  it('`screen:` khớp chuỗi con tên màn', () => {
    const { predicates } = parseQuery('screen:user');

    expect(predicates[0](net(1, { screen: 'UserDetail' }))).toBe(true);
    expect(predicates[0](net(1, { screen: 'OrderList' }))).toBe(false);
  });

  it('`status:err` khớp lỗi vận chuyển, trừ request bị huỷ', () => {
    const [isErr] = parseQuery('status:err').predicates;

    expect(isErr(net(1, { error: 'network' }))).toBe(true);
    expect(isErr(net(1, { error: 'timeout' }))).toBe(true);
    expect(isErr(net(1, { error: 'abort' }))).toBe(false);
    expect(isErr(net(1, { status: 500 }))).toBe(false);
  });

  /* Nuốt im lặng thì người gõ sai một chữ thấy danh sách rỗng mà không biết vì sao. */
  it('giá trị hỏng rơi về chữ tự do', () => {
    const { predicates, free } = parseQuery('status:abc user');

    expect(predicates).toHaveLength(0);
    expect(free).toBe('status:abc user');
  });
});

describe('matchesQuery', () => {
  it('chữ rỗng hoặc chỉ khoảng trắng khớp mọi dòng', () => {
    expect(matchesQuery(net(1), '')).toBe(true);
    expect(matchesQuery(con(2, 'info'), '   ')).toBe(true);
  });

  it('URL khớp không phân biệt hoa thường', () => {
    expect(matchesQuery(net(1, { url: '/api/user/list' }), 'USER')).toBe(true);
    expect(matchesQuery(net(1, { url: '/api/user/list' }), 'order')).toBe(false);
  });

  it('status khớp như chữ', () => {
    expect(matchesQuery(net(1, { status: 404 }), '404')).toBe(true);
  });

  it('khớp trong thân response', () => {
    const e = net(1, { status: 500, responseBody: '{"errorCode":"USER_DUP"}' });
    expect(matchesQuery(e, 'user_dup')).toBe(true);
  });

  it('dòng console khớp theo nội dung', () => {
    expect(
      matchesQuery(con(1, 'error', 'TypeError: undefined is not a function'), 'typeerror'),
    ).toBe(true);
  });

  /* Ký tự đặc biệt trong URL không được biến thành cú pháp regex. */
  it('ký tự `?` khớp đúng nghĩa đen', () => {
    expect(matchesQuery(net(1, { url: '/api/x?page=2' }), '?page=2')).toBe(true);
    expect(matchesQuery(net(2, { url: '/api/xpage=2' }), 'x?page')).toBe(false);
  });
});

describe('filterLog', () => {
  const entries: LogEntry[] = [
    con(1, 'error', 'boom'),
    net(2, { url: '/api/user', status: 200, durationMs: 120 }),
    mark(3),
    net(4, { url: '/api/user', status: 500, durationMs: 4000 }),
    con(5, 'info', 'user loaded'),
    net(6, { url: '/api/order' }),
    net(7, { url: '/api/search', error: 'abort', durationMs: 30 }),
  ];
  const ids = (list: readonly LogEntry[]) => list.map((e) => e.id);

  it('mọi trục "không lọc" ⇒ trả CÙNG tham chiếu', () => {
    expect(filterLog(entries, { kind: 'all', status: 'all', text: '  ' })).toBe(entries);
  });

  it('lọc `kind`', () => {
    expect(ids(filterLog(entries, { kind: 'console', status: 'all', text: '' }))).toEqual([1, 5]);
  });

  it('lọc `status: error`', () => {
    expect(ids(filterLog(entries, { kind: 'all', status: 'error', text: '' }))).toEqual([1, 4]);
  });

  it('lọc `status: ok` giữ cả request đang bay và request bị huỷ', () => {
    expect(ids(filterLog(entries, { kind: 'all', status: 'ok', text: '' }))).toEqual([2, 5, 6, 7]);
  });

  /* Chậm không loại trừ lỗi: request 500 mất 4 giây nằm ở cả hai. */
  it('lọc `status: slow`', () => {
    expect(
      ids(filterLog(entries, { kind: 'all', status: 'slow', text: '', slowMs: 3000 })),
    ).toEqual([4]);
  });

  it('mốc chỉ hiện khi không lọc trục nào (chữ tìm khớp tên màn thì vẫn hiện)', () => {
    expect(ids(filterLog(entries, { kind: 'network', status: 'all', text: '' }))).not.toContain(3);
    expect(ids(filterLog(entries, { kind: 'all', status: 'error', text: '' }))).not.toContain(3);
    expect(ids(filterLog(entries, { kind: 'all', status: 'all', text: 'userlist' }))).toEqual([3]);
  });

  it('ba trục kết hợp, giữ thứ tự cũ→mới', () => {
    expect(
      ids(filterLog(entries, { kind: 'network', status: 'error', text: 'user' })),
    ).toEqual([4]);
  });
});
