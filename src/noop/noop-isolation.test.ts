/**
 * Bản noop **không kéo** gì của devtools vào bundle — kiểm bằng bẫy: mọi module bị cấm được
 * `jest.doMock` thành factory ném lỗi, rồi nạp entry noop trong một sổ module sạch
 * (`jest.isolateModules`). Một `require` tới module cấm ⇒ nạp entry ném ⇒ test đỏ, kèm tên module.
 *
 * Mỗi lớp bẫy có **đối chứng**: nạp entry *thật* dưới cùng bẫy thì phải ném — không thì bẫy
 * không bắt được gì và test xanh vô nghĩa.
 *
 * Thứ tự hai `describe` có chủ ý: bẫy của `doMock` sống tới hết file, nên lớp hẹp (gói nặng) chạy
 * trước lớp rộng (mọi file nguồn).
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');

/** Các gói native nặng mà bản prod không được mang. Kể cả subpath lib đang dùng. */
const HEAVY_PACKAGES = [
  '@gorhom/bottom-sheet',
  'react-native-reanimated',
  'react-native-worklets',
  'react-native-gesture-handler',
  'react-native-gesture-handler/ReanimatedSwipeable',
  'react-native-safe-area-context',
];

/** Bảng chuỗi thuần dữ liệu — bản noop cố ý giữ (lý do ở đầu `noop/i18n.ts`). */
const ALLOWED_SOURCES = ['i18n/vi.ts', 'i18n/en.ts'].map((f) => path.join(SRC, f));

const NOOP_ENTRIES = ['./index', './capture', './shake', './i18n', './plain'];

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? walk(full) : [full];
  });

/** Mọi file nguồn của lib ngoài `src/noop/` — code thật, bản noop không được chạm. */
const libSources = (): string[] =>
  walk(SRC).filter(
    (f) =>
      /\.(tsx?|js)$/.test(f) &&
      !/\.d\.ts$/.test(f) &&
      !/\.(test|spec)\.[jt]sx?$/.test(f) &&
      !f.startsWith(path.join(SRC, 'noop') + path.sep) &&
      !f.startsWith(path.join(SRC, 'testing') + path.sep) &&
      f !== path.join(SRC, 'test-setup.ts') &&
      !ALLOWED_SOURCES.includes(f),
  );

const setTraps = (modules: readonly string[]) => {
  for (const name of modules) {
    jest.doMock(name, () => {
      throw new Error(`noop kéo ${name}`);
    });
  }
};

/** Nạp `entry` trong sổ module sạch; trả lỗi ném ra (hoặc `undefined` khi nạp êm). */
const loadError = (entry: string): Error | undefined => {
  let error: Error | undefined;
  jest.isolateModules(() => {
    try {
      require(entry);
    } catch (e) {
      error = e as Error;
    }
  });
  return error;
};

describe('bản noop không kéo gói native nặng', () => {
  beforeAll(() => setTraps(HEAVY_PACKAGES));

  it.each(NOOP_ENTRIES)('nạp %s êm', (entry) => {
    expect(loadError(entry)).toBeUndefined();
  });

  it.each(['../index', '../shake', '../plain'])('đối chứng: entry thật %s vấp bẫy', (entry) => {
    expect(loadError(entry)?.message).toMatch(
      /^noop kéo (@gorhom\/bottom-sheet|react-native-(reanimated|worklets|gesture-handler|safe-area-context))/,
    );
  });
});

describe('bản noop không kéo một file nguồn nào của lib', () => {
  const sources = libSources();

  beforeAll(() => setTraps([...HEAVY_PACKAGES, ...sources]));

  it('bẫy phủ đủ: có cả entry thật lẫn file UI', () => {
    expect(sources).toEqual(
      expect.arrayContaining([
        path.join(SRC, 'index.ts'),
        path.join(SRC, 'capture', 'index.ts'),
        path.join(SRC, 'ui', 'Sheet.tsx'),
        path.join(SRC, 'i18n', 'translate.ts'),
      ]),
    );
  });

  it.each(NOOP_ENTRIES)('nạp %s êm', (entry) => {
    expect(loadError(entry)).toBeUndefined();
  });

  it('đối chứng: entry thật ../capture (thuần JS, không gói nặng nào) vấp bẫy', () => {
    expect(loadError('../capture')?.message).toMatch(/^noop kéo .*capture/);
  });
});
