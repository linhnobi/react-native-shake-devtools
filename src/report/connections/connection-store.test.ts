import {
  ConnectionListCorruptError,
  ConnectionStoreReadError,
  createConnectionStore,
  isConnectionListCorrupt,
  isConnectionStoreReadError,
  maskSecret,
  type DevToolsSecureStore,
  type StoredConnection,
} from './connection-store';

/** Kho giả trong RAM; `fail` cho phép ép từng thao tác ném lỗi. */
const memoryStore = (
  initial: Record<string, string> = {},
): DevToolsSecureStore & {
  data: Map<string, string>;
  fail: { get?: boolean; set?: boolean; remove?: boolean };
  delay: number;
} => {
  const data = new Map(Object.entries(initial));
  const fail: { get?: boolean; set?: boolean; remove?: boolean } = {};
  const self = {
    data,
    fail,
    delay: 0,
    getItem: async (key: string) => {
      if (fail.get) throw new Error('get failed');
      return data.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      if (fail.set) throw new Error('set failed');
      if (self.delay > 0) await new Promise((r) => setTimeout(r, self.delay));
      data.set(key, value);
    },
    removeItem: async (key: string) => {
      if (fail.remove) throw new Error('remove failed');
      data.delete(key);
    },
  };
  return self;
};

const conn = (id: string, extra: Partial<StoredConnection> = {}): StoredConnection => ({
  id,
  typeId: 'jira',
  name: `Conn ${id}`,
  ticketLocale: 'vi',
  values: { baseUrl: 'https://x.atlassian.net', email: 'qa@x.com' },
  createdAt: 1000,
  ...extra,
});

const secretIdsOf = (typeId: string): readonly string[] =>
  typeId === 'jira' ? ['token'] : typeId === 'webhook' ? ['headerValue', 'token'] : [];

const make = (store: DevToolsSecureStore) =>
  createConnectionStore(store, { secretFieldIdsOf: secretIdsOf });

describe('connection-store', () => {
  it('save rồi list trả kết nối; secrets() trả bí mật đã lưu', async () => {
    const store = memoryStore();
    const cs = make(store);
    await cs.save(conn('a'), { token: 'tok-1' });
    expect(await cs.list()).toEqual([conn('a')]);
    expect(await cs.secrets('a')).toEqual({ token: 'tok-1' });
    expect(await cs.secrets('missing')).toBeNull();
  });

  it('bí mật nằm ở devtools.secret.<id> dạng một chuỗi JSON, không lọt vào JSON danh sách', async () => {
    const store = memoryStore();
    const cs = make(store);
    await cs.save(conn('a'), { token: 'tok-SECRET-1' });
    expect(JSON.parse(store.data.get('devtools.secret.a') as string)).toEqual({
      token: 'tok-SECRET-1',
    });
    expect(store.data.get('devtools.connections.v1')).not.toContain('tok-SECRET-1');
  });

  it('save ném khi values chứa ô bí mật; thông điệp nêu id ô, không nêu giá trị; không ghi gì', async () => {
    const store = memoryStore();
    const cs = make(store);
    const bad = conn('a', { values: { baseUrl: 'u', token: 'xoxb-TOPSECRET' } });
    const err = await cs.save(bad, { token: 'xoxb-TOPSECRET' }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('token');
    expect((err as Error).message).not.toContain('xoxb-TOPSECRET');
    expect(store.data.size).toBe(0);
  });

  it('save phát hiện ô bí mật theo loại (webhook: headerValue)', async () => {
    const cs = make(memoryStore());
    await expect(
      cs.save(conn('w', { typeId: 'webhook', values: { headerValue: 'abc' } }), {}),
    ).rejects.toThrow(/headerValue/);
  });

  it('save id đã có thì thay tại chỗ; id mới thì nối cuối; list theo thứ tự chèn', async () => {
    const cs = make(memoryStore());
    await cs.save(conn('a'), { token: '1' });
    await cs.save(conn('b'), { token: '2' });
    await cs.save(conn('c'), { token: '3' });
    await cs.save(conn('a', { name: 'Renamed' }), { token: '1b' });
    const list = await cs.list();
    expect(list.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(list[0]?.name).toBe('Renamed');
    expect(await cs.secrets('a')).toEqual({ token: '1b' });
  });

  it('remove xoá kết nối và khoá bí mật', async () => {
    const store = memoryStore();
    const cs = make(store);
    await cs.save(conn('a'), { token: '1' });
    await cs.save(conn('b'), { token: '2' });
    await cs.remove('a');
    expect((await cs.list()).map((c) => c.id)).toEqual(['b']);
    expect(store.data.has('devtools.secret.a')).toBe(false);
    expect(store.data.has('devtools.secret.b')).toBe(true);
  });

  it('remove xoá devtools.lastConnection khi nó trỏ vào id đó, giữ nguyên khi trỏ id khác', async () => {
    const store = memoryStore();
    const cs = make(store);
    await cs.save(conn('a'), { token: '1' });
    await cs.save(conn('b'), { token: '2' });
    await cs.setLastUsed('a');
    expect(await cs.lastUsed()).toBe('a');
    await cs.remove('b');
    expect(await cs.lastUsed()).toBe('a');
    await cs.remove('a');
    expect(await cs.lastUsed()).toBeNull();
    expect(store.data.has('devtools.lastConnection')).toBe(false);
  });

  it('JSON danh sách hỏng ⇒ list() trả [], không ném', async () => {
    const cs = make(memoryStore({ 'devtools.connections.v1': '{not json' }));
    expect(await cs.list()).toEqual([]);
  });

  it('danh sách không phải mảng, hoặc phần tử sai hình dạng ⇒ bỏ qua', async () => {
    expect(await make(memoryStore({ 'devtools.connections.v1': '{"a":1}' })).list()).toEqual([]);
    const mixed = JSON.stringify([conn('a'), { id: 5 }, null, 'x']);
    const cs = make(memoryStore({ 'devtools.connections.v1': mixed }));
    expect((await cs.list()).map((c) => c.id)).toEqual(['a']);
  });

  it('bí mật hỏng ⇒ secrets() trả null, không ném', async () => {
    const cs = make(memoryStore({ 'devtools.secret.a': 'oops', 'devtools.secret.b': '[1]' }));
    expect(await cs.secrets('a')).toBeNull();
    expect(await cs.secrets('b')).toBeNull();
  });

  it('kho ném khi đọc ⇒ list/secrets/lastUsed không ném (trả []/null/null)', async () => {
    const store = memoryStore();
    const cs = make(store);
    await cs.save(conn('a'), { token: '1' });
    store.fail.get = true;
    expect(await cs.list()).toEqual([]);
    expect(await cs.secrets('a')).toBeNull();
    expect(await cs.lastUsed()).toBeNull();
  });

  it('kho ném khi ghi ⇒ save/remove/setLastUsed ném lại lỗi của kho', async () => {
    const store = memoryStore();
    const cs = make(store);
    await cs.save(conn('a'), { token: '1' });
    store.fail.set = true;
    await expect(cs.save(conn('b'), { token: '2' })).rejects.toThrow('set failed');
    await expect(cs.setLastUsed('a')).rejects.toThrow('set failed');
    store.fail.set = false;
    store.fail.remove = true;
    await expect(cs.remove('a')).rejects.toThrow('remove failed');
  });

  it('đọc danh sách lỗi lúc save ⇒ save ném, không ghi gì; sau khi hết lỗi danh sách cũ còn nguyên', async () => {
    const store = memoryStore();
    const cs = make(store);
    await cs.save(conn('a'), { token: '1' });
    await cs.save(conn('b'), { token: '2' });
    const before = new Map(store.data);
    store.fail.get = true;
    await expect(cs.save(conn('c'), { token: '3' })).rejects.toThrow('get failed');
    expect(store.data).toEqual(before);
    store.fail.get = false;
    expect((await cs.list()).map((c) => c.id)).toEqual(['a', 'b']);
    expect(await cs.secrets('a')).toEqual({ token: '1' });
  });

  it('đọc lỗi lúc remove ⇒ remove ném, không xoá nửa chừng', async () => {
    const store = memoryStore();
    const cs = make(store);
    await cs.save(conn('a'), { token: '1' });
    await cs.setLastUsed('a');
    const before = new Map(store.data);
    store.fail.get = true;
    await expect(cs.remove('a')).rejects.toThrow('get failed');
    expect(store.data).toEqual(before);
    store.fail.get = false;
    expect((await cs.list()).map((c) => c.id)).toEqual(['a']);
    expect(await cs.secrets('a')).toEqual({ token: '1' });
    expect(await cs.lastUsed()).toBe('a');
  });

  it('JSON danh sách hỏng ⇒ save/remove ném và giữ nguyên giá trị đã lưu (không reset dữ liệu)', async () => {
    const store = memoryStore({ 'devtools.connections.v1': '{not json' });
    const cs = make(store);
    await expect(cs.save(conn('a'), { token: '1' })).rejects.toThrow();
    await expect(cs.remove('a')).rejects.toThrow();
    expect(store.data.get('devtools.connections.v1')).toBe('{not json');
    expect(store.data.has('devtools.secret.a')).toBe(false);
    expect(await cs.list()).toEqual([]);
  });

  it('một lần ghi hỏng không làm kẹt hàng đợi ghi: lần sau vẫn chạy', async () => {
    const store = memoryStore();
    const cs = make(store);
    store.fail.set = true;
    await expect(cs.save(conn('a'), { token: '1' })).rejects.toThrow();
    store.fail.set = false;
    await cs.save(conn('b'), { token: '2' });
    expect((await cs.list()).map((c) => c.id)).toEqual(['b']);
  });

  it('hai save liền nhau (kho chậm) không làm mất kết nối nào', async () => {
    const store = memoryStore();
    store.delay = 5;
    const cs = make(store);
    await Promise.all([
      cs.save(conn('a'), { token: '1' }),
      cs.save(conn('b'), { token: '2' }),
      cs.save(conn('c'), { token: '3' }),
    ]);
    expect((await cs.list()).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('lastUsed trả null khi chưa đặt', async () => {
    expect(await make(memoryStore()).lastUsed()).toBeNull();
  });

  it('values không bí mật (kể cả boolean và mảng) được giữ nguyên qua list', async () => {
    const cs = make(memoryStore());
    const c = conn('a', { values: { url: 'u', flag: true, labels: ['x', 'y'] } });
    await cs.save(c, { token: 't' });
    expect(await cs.list()).toEqual([c]);
  });

  describe('ConnectionStoreReadError', () => {
    it('kho ném khi đọc lúc save/remove ⇒ ConnectionStoreReadError giữ thông điệp gốc; JSON hỏng thì không', async () => {
      const store = memoryStore();
      const cs = make(store);
      await cs.save(conn('a'), { token: '1' });
      store.fail.get = true;

      const saved = await cs.save(conn('b'), { token: '2' }).catch((e: unknown) => e);
      const removed = await cs.remove('a').catch((e: unknown) => e);
      for (const err of [saved, removed]) {
        expect(err).toBeInstanceOf(ConnectionStoreReadError);
        expect(isConnectionStoreReadError(err)).toBe(true);
        expect((err as Error).message).toBe('get failed');
      }

      const corrupt = await make(memoryStore({ 'devtools.connections.v1': '{not json' }))
        .save(conn('c'), { token: '3' })
        .catch((e: unknown) => e);
      expect(isConnectionStoreReadError(corrupt)).toBe(false);
      expect(isConnectionStoreReadError(new Error('set failed'))).toBe(false);
    });
  });

  describe('ConnectionListCorruptError', () => {
    it('JSON hỏng hoặc không phải mảng ⇒ save/remove ném ConnectionListCorruptError', async () => {
      for (const raw of ['{not json', '{"a":1}']) {
        const cs = make(memoryStore({ 'devtools.connections.v1': raw }));
        const saved = await cs.save(conn('a'), { token: '1' }).catch((e: unknown) => e);
        const removed = await cs.remove('a').catch((e: unknown) => e);
        expect(saved).toBeInstanceOf(ConnectionListCorruptError);
        expect(removed).toBeInstanceOf(ConnectionListCorruptError);
        expect(isConnectionListCorrupt(saved)).toBe(true);
      }
    });

    it('kho ném khi đọc (lỗi thoáng qua) ⇒ KHÔNG phải ConnectionListCorruptError', async () => {
      const store = memoryStore();
      store.fail.get = true;
      const err = await make(store)
        .save(conn('a'), { token: '1' })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(ConnectionListCorruptError);
      expect(isConnectionListCorrupt(err)).toBe(false);
      expect(isConnectionListCorrupt(new Error('x'))).toBe(false);
      expect(isConnectionListCorrupt(undefined)).toBe(false);
    });
  });

  describe('resetAll', () => {
    it('xoá danh sách, lastConnection và bí mật của mọi id trong danh sách', async () => {
      const store = memoryStore({ 'other.key': 'keep' });
      const cs = make(store);
      await cs.save(conn('a'), { token: '1' });
      await cs.save(conn('b'), { token: '2' });
      await cs.setLastUsed('b');

      await cs.resetAll();

      expect([...store.data.keys()]).toEqual(['other.key']);
      expect(await cs.list()).toEqual([]);
      expect(await cs.lastUsed()).toBeNull();
    });

    it('JSON danh sách hỏng ⇒ vẫn xoá danh sách + lastConnection; sau đó save chạy lại được', async () => {
      const store = memoryStore({
        'devtools.connections.v1': '{not json',
        'devtools.lastConnection': 'a',
      });
      const cs = make(store);

      await cs.resetAll();
      expect(store.data.size).toBe(0);

      await cs.save(conn('n'), { token: 'new' });
      expect((await cs.list()).map((c) => c.id)).toEqual(['n']);
    });

    it('phần tử sai hình dạng nhưng còn id chuỗi ⇒ bí mật của id đó cũng bị xoá', async () => {
      const store = memoryStore({
        'devtools.connections.v1': JSON.stringify([conn('a'), { id: 'half' }, { id: 7 }, null]),
        'devtools.secret.a': '{"token":"1"}',
        'devtools.secret.half': '{"token":"2"}',
        'devtools.secret.7': '{"token":"3"}',
      });

      await make(store).resetAll();

      expect([...store.data.keys()]).toEqual(['devtools.secret.7']);
    });

    it('kho ném khi đọc ⇒ vẫn xoá danh sách + lastConnection (không biết id nào để xoá bí mật)', async () => {
      const store = memoryStore({
        'devtools.connections.v1': JSON.stringify([conn('a')]),
        'devtools.lastConnection': 'a',
        'devtools.secret.a': '{"token":"1"}',
      });
      store.fail.get = true;

      await make(store).resetAll();

      expect([...store.data.keys()]).toEqual(['devtools.secret.a']);
    });

    it('xoá lỗi ⇒ ném lại lỗi của kho; bí mật xoá trước nên danh sách còn để lần sau thử lại', async () => {
      const store = memoryStore();
      const cs = make(store);
      await cs.save(conn('a'), { token: '1' });
      store.fail.remove = true;

      await expect(cs.resetAll()).rejects.toThrow('remove failed');
      expect(store.data.has('devtools.connections.v1')).toBe(true);

      store.fail.remove = false;
      await cs.resetAll();
      expect(store.data.size).toBe(0);
    });

    it('xếp hàng sau các lần ghi đang chờ: save rồi resetAll liền nhau ⇒ cuối cùng trống', async () => {
      const store = memoryStore();
      store.delay = 5;
      const cs = make(store);

      await Promise.all([cs.save(conn('a'), { token: '1' }), cs.resetAll()]);

      expect(store.data.size).toBe(0);
    });
  });

  describe('maskSecret', () => {
    it("'xoxb-123456' → '••••3456'", () => {
      expect(maskSecret('xoxb-123456')).toBe('••••3456');
    });
    it("chuỗi ≤ 4 ký tự ⇒ '••••' (không lộ gì)", () => {
      expect(maskSecret('abcd')).toBe('••••');
      expect(maskSecret('ab')).toBe('••••');
      expect(maskSecret('')).toBe('••••');
    });
    it('5 ký tự ⇒ chỉ lộ 4 ký tự cuối', () => {
      expect(maskSecret('12345')).toBe('••••2345');
    });
  });
});
