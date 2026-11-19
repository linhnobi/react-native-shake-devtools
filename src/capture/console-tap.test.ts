import { formatArgs, muteConsoleTap, tapConsole } from './console-tap';
import { logBuffer } from './log-buffer';
import type { ConsoleEntry } from './log-entry';

/** Khớp hằng `LINE_LIMIT` ở module scope của `console-tap.ts` (không export). */
const LINE_LIMIT = 2000;

const TAPPED = ['log', 'info', 'warn', 'error', 'debug'] as const;
type Tapped = (typeof TAPPED)[number];

const consoleEntries = () => logBuffer.snapshot() as readonly ConsoleEntry[];

describe('formatArgs', () => {
  it('chuỗi giữ nguyên', () => {
    // Không bọc nháy như `JSON.stringify` sẽ làm.
    expect(formatArgs(['http ok'])).toBe('http ok');
  });

  it('object thành JSON', () => {
    expect(formatArgs(['http ok', { status: 200 }])).toBe('http ok {"status":200}');
  });

  it('`Error` ra `name: message`', () => {
    expect(formatArgs([new Error('bùm')])).toBe('Error: bùm');
    expect(formatArgs([new TypeError('x is undefined')])).toBe('TypeError: x is undefined');
  });

  /* Bản vá `console` mà ném thì chết đúng lời gọi đang cố báo lỗi. */
  it('vòng tham chiếu không ném', () => {
    const a: Record<string, unknown> = {};
    a.self = a;

    expect(() => formatArgs([a])).not.toThrow();
    expect(formatArgs([a])).toBe('[object]');
  });

  it('cắt ở `LINE_LIMIT`', () => {
    expect(formatArgs(['x'.repeat(LINE_LIMIT + 500)])).toBe(`${'x'.repeat(LINE_LIMIT)}…`);
    expect(formatArgs(['x'.repeat(LINE_LIMIT)])).toBe('x'.repeat(LINE_LIMIT));
  });

  /* Dòng vốn bị cắt ở 2000 ký tự — dựng chữ cho 100.000 phần tử là việc thừa trên luồng JS. */
  it('mảng khổng lồ chỉ giữ 50 phần tử đầu kèm dấu `…`', () => {
    const huge = Array.from({ length: 100_000 }, (_, i) => i);
    const head = Array.from({ length: 50 }, (_, i) => i).join(',');

    expect(formatArgs([huge])).toBe(`[${head},"…"]`);
  });

  /* Getter đếm số lần đọc: chứng minh phần bị bỏ KHÔNG được đọc, chứ không phải đọc rồi vứt. */
  it('object nhiều khoá chỉ bị đọc 50 khoá', () => {
    let reads = 0;
    const wide: Record<string, number> = {};
    for (let i = 0; i < 10_000; i += 1) {
      Object.defineProperty(wide, `k${i}`, {
        enumerable: true,
        get: () => {
          reads += 1;
          return i;
        },
      });
    }

    const line = formatArgs([wide]);

    expect(reads).toBe(50);
    expect(line.startsWith('{"k0":0,"k1":1,')).toBe(true);
    expect(line).toContain('"…":9950');
  });
});

describe('tapConsole', () => {
  /* Hàm "gốc" là spy câm: vừa không in ra terminal jest, vừa đếm được lời gọi. */
  let spies: Record<Tapped, jest.SpyInstance>;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    spies = {} as Record<Tapped, jest.SpyInstance>;
    for (const name of TAPPED) {
      spies[name] = jest.spyOn(console, name).mockImplementation(() => undefined);
    }
    logBuffer.clear();
  });

  afterEach(() => {
    // Gỡ vá TRƯỚC khi trả spy: `installed` nằm ở module scope, sót lại là ca sau không vá được.
    stop?.();
    stop = undefined;
    jest.restoreAllMocks();
  });

  it('hàm gốc vẫn được gọi với đúng tham số', () => {
    stop = tapConsole();
    console.warn('ối', { code: 1 });

    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(spies.warn).toHaveBeenCalledWith('ối', { code: 1 });
    expect(spies.warn.mock.contexts[0]).toBe(console);
  });

  it('dòng vào buffer đúng mức', () => {
    stop = tapConsole();
    console.log('l');
    console.info('i');
    console.warn('w');
    console.error('boom', { code: 1 });
    console.debug('d');

    expect(consoleEntries().map((e) => [e.kind, e.level, e.text])).toEqual([
      ['console', 'info', 'l'],
      ['console', 'info', 'i'],
      ['console', 'warn', 'w'],
      ['console', 'error', 'boom {"code":1}'],
      ['console', 'debug', 'd'],
    ]);
  });

  /* Hai lớp vá thì mỗi lời gọi rơi vào buffer HAI lần, và hàm gỡ của lớp trong trả về lớp ngoài. */
  it('gọi hai lần chỉ vá một lớp', () => {
    stop = tapConsole();
    const patched = console.info;
    const again = tapConsole();

    expect(again).toBe(stop);
    expect(console.info).toBe(patched);

    console.info('một lần');
    expect(consoleEntries()).toHaveLength(1);
    expect(spies.info).toHaveBeenCalledTimes(1);
  });

  it('`stop()` khôi phục đúng hàm gốc', () => {
    const originals = TAPPED.map((name) => console[name]);
    stop = tapConsole();
    TAPPED.forEach((name, i) => expect(console[name]).not.toBe(originals[i]));

    stop();

    TAPPED.forEach((name, i) => expect(console[name]).toBe(originals[i]));
    console.error('sau khi gỡ');
    expect(consoleEntries()).toHaveLength(0);
  });

  it('`stop()` hai lần không ném', () => {
    const originalWarn = console.warn;
    stop = tapConsole();
    stop();

    expect(() => stop?.()).not.toThrow();
    expect(console.warn).toBe(originalWarn);
  });

  /*
    Listener của buffer gọi lại `console.error` rồi ném — đúng ca React in lỗi khi một listener
    hỏng. Không có chốt `inside` thì bản vá gọi chính nó mãi; không có `catch` thì lỗi của công
    cụ gỡ lỗi nổ ra ở chỗ gọi `console.warn` của app.
  */
  it('`console.*` ném bên trong buffer không làm treo (chốt đệ quy)', () => {
    stop = tapConsole();
    const unsubscribe = logBuffer.subscribe(() => {
      console.error('listener nổ');
      throw new Error('listener nổ');
    });

    try {
      expect(() => console.warn('kích hoạt')).not.toThrow();
    } finally {
      unsubscribe();
    }

    expect(spies.error).toHaveBeenCalledTimes(1);
    expect(consoleEntries().map((e) => e.text)).toEqual(['kích hoạt']);

    // Chốt được nhả trong `finally` — lời gọi kế tiếp vẫn vào nhật ký.
    console.info('sau đó');
    expect(consoleEntries().map((e) => e.text)).toEqual(['kích hoạt', 'sau đó']);
  });
});

describe('muteConsoleTap', () => {
  let errorSpy: jest.SpyInstance;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    logBuffer.clear();
    stop = tapConsole();
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    jest.restoreAllMocks();
  });

  /* Đúng ca nó sinh ra để chữa: handler của RN `console.error` lại một lỗi lib đã ghi rồi. */
  it('hàm gốc vẫn được gọi nhưng không có dòng nào vào buffer', () => {
    const value = muteConsoleTap(() => {
      console.error('đã ghi ở chỗ khác');
      return 42;
    });

    expect(value).toBe(42);
    expect(errorSpy).toHaveBeenCalledWith('đã ghi ở chỗ khác');
    expect(consoleEntries()).toHaveLength(0);
  });

  it('sau khi `fn` xong thì ghi lại bình thường', () => {
    muteConsoleTap(() => muteConsoleTap(() => console.error('lồng nhau')));

    console.error('sau đó');

    expect(consoleEntries().map((e) => e.text)).toEqual(['sau đó']);
  });

  /* Không mở lại trong `finally` thì một handler của RN ném là nhật ký câm vĩnh viễn. */
  it('`fn` ném thì vẫn mở lại', () => {
    expect(() =>
      muteConsoleTap(() => {
        throw new Error('handler hỏng');
      }),
    ).toThrow('handler hỏng');

    console.error('sau đó');

    expect(consoleEntries().map((e) => e.text)).toEqual(['sau đó']);
  });
});
