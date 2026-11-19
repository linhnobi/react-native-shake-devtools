import type * as CopyTextModule from './copy-text';

/**
 * Nạp `copy-text` trong một registry **riêng**, với `react-native` giả chỉ có getter `Clipboard`.
 *
 * Hai lý do phải nạp lại mỗi ca: module nhớ `Clipboard` vào biến module-scope (ca trước để
 * lại tham chiếu thì ca sau không bao giờ chạm getter), và getter phải **đếm được** — đó chính
 * là thứ ca 4 khoá. Bản thật của RN là getter có `warnOnce`.
 */
const load = (readClipboard: () => unknown) => {
  const getter = jest.fn(readClipboard);
  let mod!: typeof CopyTextModule;
  jest.isolateModules(() => {
    jest.doMock('react-native', () =>
      Object.defineProperty({}, 'Clipboard', { get: getter, enumerable: true }),
    );
    mod = require('./copy-text');
  });
  return { copyText: mod.copyText, canReadText: mod.canReadText, readText: mod.readText, getter };
};

const fakeClipboard = () => ({
  setString: jest.fn(),
  getString: jest.fn(async () => '  xoxb-123\n'),
});

describe('copyText', () => {
  it('gọi `setString` đúng nội dung', () => {
    const clipboard = fakeClipboard();
    const { copyText } = load(() => clipboard);
    const text = '07:00:00.000 GET /x → 200 31ms\n07:00:01.000 POST /y → 500 12ms';

    expect(copyText(text)).toBe(true);
    expect(clipboard.setString).toHaveBeenCalledTimes(1);
    expect(clipboard.setString).toHaveBeenCalledWith(text);
  });

  /* Rỗng thì giữ nguyên thứ đang có trong bộ nhớ tạm — và không chạm getter, nên không kích cảnh báo. */
  it('chuỗi rỗng trả false và không gọi', () => {
    const clipboard = fakeClipboard();
    const { copyText, getter } = load(() => clipboard);

    expect(copyText('')).toBe(false);
    expect(clipboard.setString).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  /* Hai dạng "vắng": getter trả `undefined`, và getter ném (ngày RN gỡ hẳn module khỏi lõi). */
  it('`Clipboard` vắng trả false không ném', () => {
    const absent = load(() => undefined);
    expect(() => absent.copyText('x')).not.toThrow();
    expect(absent.copyText('x')).toBe(false);

    const removed = load(() => {
      throw new Error('Clipboard has been removed');
    });
    expect(() => removed.copyText('x')).not.toThrow();
    expect(removed.copyText('x')).toBe(false);
  });

  it('gọi hai lần chỉ chạm getter `Clipboard` một lần', () => {
    const clipboard = fakeClipboard();
    const { copyText, getter } = load(() => clipboard);

    copyText('một');
    copyText('hai');

    expect(getter).toHaveBeenCalledTimes(1);
    expect(clipboard.setString.mock.calls).toEqual([['một'], ['hai']]);
  });
});

describe('canReadText / readText', () => {
  it('có `getString` ⇒ canReadText true; readText trả nguyên nội dung bộ nhớ tạm', async () => {
    const clipboard = fakeClipboard();
    const { canReadText, readText } = load(() => clipboard);

    expect(canReadText()).toBe(true);
    await expect(readText()).resolves.toBe('  xoxb-123\n');
    expect(clipboard.getString).toHaveBeenCalledTimes(1);
  });

  /* Ba dạng "vắng": getter trả `undefined`, có object mà thiếu `getString`, và getter ném. */
  it('`Clipboard`/`getString` vắng ⇒ canReadText false, readText trả null, không ném', async () => {
    const cases: Array<() => unknown> = [
      () => undefined,
      () => ({ setString: jest.fn() }),
      () => {
        throw new Error('Clipboard has been removed');
      },
    ];
    for (const readClipboard of cases) {
      const { canReadText, readText } = load(readClipboard);
      expect(canReadText()).toBe(false);
      await expect(readText()).resolves.toBeNull();
    }
  });

  it('`getString` ném hoặc trả thứ không phải chuỗi ⇒ readText trả null', async () => {
    const throwing = load(() => ({ getString: jest.fn(() => Promise.reject(new Error('x'))) }));
    await expect(throwing.readText()).resolves.toBeNull();

    const odd = load(() => ({ getString: jest.fn(async () => 42) }));
    await expect(odd.readText()).resolves.toBeNull();
  });

  it('dùng chung tham chiếu với copyText: chép rồi đọc chỉ chạm getter một lần', async () => {
    const clipboard = fakeClipboard();
    const { copyText, canReadText, readText, getter } = load(() => clipboard);

    copyText('một');
    canReadText();
    await readText();

    expect(getter).toHaveBeenCalledTimes(1);
  });
});
