import type { NetworkEntry } from './log-entry';
import {
  FULL_BODY_LIMIT,
  FULL_BODY_RECENT,
  createFullBodyStore,
  withFullBodies,
} from './full-body-store';

const entry = (id: number): NetworkEntry => ({
  id,
  kind: 'network',
  at: 0,
  method: 'GET',
  url: 'https://api.test/x',
  responseBody: '{"a":1…+900',
  responseTruncated: true,
});

describe('createFullBodyStore', () => {
  it('ghi rồi đọc lại đúng mặt', () => {
    const store = createFullBodyStore();
    store.put(1, 'response', '{"big":true}');

    expect(store.get(1, 'response')).toEqual({ text: '{"big":true}', truncated: false });
    expect(store.get(1, 'request')).toBeUndefined();
  });

  it(`quá ${FULL_BODY_RECENT} request ⇒ request cũ nhất bị bỏ`, () => {
    const store = createFullBodyStore();
    for (let id = 1; id <= FULL_BODY_RECENT + 1; id += 1) store.put(id, 'response', 'x');

    expect(store.get(1, 'response')).toBeUndefined();
    expect(store.get(FULL_BODY_RECENT + 1, 'response')).toBeDefined();
  });

  it('request lỗi sống sót khi trôi khỏi nhóm gần nhất', () => {
    const store = createFullBodyStore();
    store.put(1, 'response', 'err');
    store.markError(1);
    for (let id = 2; id <= FULL_BODY_RECENT + 5; id += 1) store.put(id, 'response', 'x');

    expect(store.get(1, 'response')?.text).toBe('err');
  });

  it(`vượt ${FULL_BODY_LIMIT} ký tự ⇒ cắt + \`truncated\``, () => {
    const store = createFullBodyStore();
    store.put(1, 'response', 'x'.repeat(FULL_BODY_LIMIT + 10));

    expect(store.get(1, 'response')?.truncated).toBe(true);
  });

  it('`clear` xoá hết', () => {
    const store = createFullBodyStore();
    store.put(1, 'response', 'x');
    store.clear();

    expect(store.get(1, 'response')).toBeUndefined();
  });
});

describe('withFullBodies', () => {
  it('kho có ⇒ thay thân + cờ', () => {
    const store = createFullBodyStore();
    store.put(7, 'response', '{"a":1,"b":2}');

    expect(withFullBodies(entry(7), store)).toMatchObject({
      responseBody: '{"a":1,"b":2}',
      responseTruncated: false,
    });
  });

  it('kho không có ⇒ trả CÙNG tham chiếu', () => {
    const e = entry(8);
    expect(withFullBodies(e, createFullBodyStore())).toBe(e);
  });
});
