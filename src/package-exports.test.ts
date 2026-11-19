/**
 * `package.json#exports` — bố cục bản phát hành (`npm run build`, react-native-builder-bob).
 *
 * Mỗi entry bundle được có đúng ba điều kiện, **đúng thứ tự** (resolver lấy khoá đầu tiên khớp):
 *
 * 1. `types` → `lib/typescript/<p>.d.ts`. tsc của app đọc `.d.ts` nên không typecheck mã nguồn lib
 *    (`skipLibCheck` chỉ bỏ qua `.d.ts`). Phải đứng **trước** `react-native`:
 *    `@react-native/typescript-config` bật `customConditions: ["react-native"]`, đứng sau là tsc
 *    của app lại đọc `src/`.
 * 2. `react-native` → `src/<p>.ts`. Metro (`unstable_conditionNames: ["react-native"]`) và preset
 *    jest của RN (`customExportConditions: ['require', 'react-native']`) ăn mã nguồn, như
 *    reanimated · worklets · gesture-handler · gorhom (trường `react-native` → `src`). Hàm `'worklet'`
 *    vì thế do plugin worklets của app biên dịch từ đúng mã viết tay, như trước khi có bước build.
 * 3. `default` → `lib/module/<p>.js` (ESM): Node, bundler web, mọi công cụ khác.
 *
 * `./metro` chạy trong Node (`metro.config.js` của app) và là CommonJS viết tay: trỏ thẳng
 * `src/metro/`, không qua babel của bob (`lib/module/` là `"type": "module"` — `module.exports` vỡ).
 *
 * Test không cần `lib/` đã build: nó khoá đường dẫn. File trong `lib/` có thật hay không do CI kiểm
 * sau `npm run build` (bước `npm pack --dry-run`).
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

type Conditions = Record<string, string>;
const pkg = require('../package.json') as {
  main: string;
  module: string;
  types: string;
  'react-native': string;
  exports: Record<string, string | Conditions>;
};

const exists = (target: string) => fs.existsSync(path.join(ROOT, target));

const bundleable = Object.entries(pkg.exports).filter(
  ([key]) => key !== './metro' && key !== './package.json',
);

/* Danh sách entry (thật ↔ noop) do `metro/noop-resolver.test.ts` khoá; ở đây chỉ khoá hình dạng. */
describe('package.json#exports', () => {
  it.each(bundleable)('%s: types → react-native → default, cùng một đường trong lib/ và src/', (_, value) => {
    const conditions = value as Conditions;
    expect(Object.keys(conditions)).toEqual(['types', 'react-native', 'default']);

    const source = conditions['react-native'];
    expect(source).toMatch(/^\.\/src\/.+\.ts$/);
    expect(exists(source)).toBe(true);

    const stem = source.replace(/^\.\/src\//, '').replace(/\.ts$/, '');
    expect(conditions.types).toBe(`./lib/typescript/${stem}.d.ts`);
    expect(conditions.default).toBe(`./lib/module/${stem}.js`);
  });

  it('./metro: CommonJS trong src/, không có điều kiện react-native (Metro không bundle nó)', () => {
    expect(pkg.exports['./metro']).toEqual({
      types: './src/metro/noop-resolver.d.ts',
      default: './src/metro/noop-resolver.js',
    });
    expect(exists('src/metro/noop-resolver.d.ts')).toBe(true);
    expect(exists('src/metro/noop-resolver.js')).toBe(true);
  });

  it('trường cấp đỉnh (cho công cụ không đọc exports) trùng entry "."', () => {
    const root = pkg.exports['.'] as Conditions;
    expect(pkg.types).toBe(root.types);
    expect(pkg['react-native']).toBe(root['react-native']);
    expect(pkg.main).toBe(root.default);
    expect(pkg.module).toBe(root.default);
  });
});
