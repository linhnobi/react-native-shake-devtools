/**
 * Bề mặt của bản noop khớp bản thật — ba tầng khoá:
 *
 * 1. **Kiểu (tsc):** `SurfaceLock` — mỗi export *giá trị* của entry thật có ở bản noop, cùng kiểu
 *    y hệt, không thừa. Thêm export ở bản thật mà quên bản noop ⇒ `npm run typecheck` đỏ, thông báo
 *    nêu đúng tên: `Type 'true' is not assignable to type '{ thiếu: "tapFoo"; … }'`.
 * 2. **Tên kiểu (jest + TypeScript API):** tsc không liệt kê được export *kiểu* của một module, nên
 *    phần này đọc bằng checker: tập tên export (kiểu + giá trị) hai bên phải bằng nhau, **cùng nghĩa**
 *    — một tên là lớp ở bản thật (vừa kiểu vừa giá trị, vd `ConnectorError`) thì ở bản noop cũng
 *    phải dùng được làm kiểu (`catch (e: unknown)` rồi `let last: ConnectorError`), không chỉ là hằng.
 * 3. **Giá trị (jest):** hằng giữ đúng giá trị bản thật; hàm không ném; component bọc chỉ render
 *    `children`, component UI không render gì.
 */
import { render } from '@testing-library/react-native';
import * as path from 'path';
import { createElement, type ComponentType, type ReactNode } from 'react';
import { Text } from 'react-native';
import * as ts from 'typescript';
import type * as RealCapture from '../capture';
import type * as RealI18n from '../i18n';
import type * as RealRoot from '../index';
import type * as RealPlain from '../plain';
import type * as RealShake from '../shake';
import type * as NoopCapture from './capture';
import type * as NoopI18n from './i18n';
import * as NoopRoot from './index';
import type * as NoopPlain from './plain';
import type * as NoopShake from './shake';

/* ------------------------------------------------------------------ 1. khoá kiểu */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Mismatch<R, N> = {
  [K in keyof R & keyof N]: Equal<R[K], N[K]> extends true ? never : K;
}[keyof R & keyof N];

/**
 * `true` khi `N` (bản noop) có **đúng** các export giá trị của `R` (bản thật), cùng kiểu. Lệch thì
 * thành object nêu tên, và phép gán `= true` bên dưới đỏ kèm các tên đó.
 */
type SurfaceLock<R, N> = [
  Exclude<keyof R, keyof N> | Exclude<keyof N, keyof R> | Mismatch<R, N>,
] extends [never]
  ? true
  : { thiếu: Exclude<keyof R, keyof N>; thừa: Exclude<keyof N, keyof R>; khácKiểu: Mismatch<R, N> };

const surfaceLocks: {
  root: SurfaceLock<typeof RealRoot, typeof NoopRoot>;
  capture: SurfaceLock<typeof RealCapture, typeof NoopCapture>;
  shake: SurfaceLock<typeof RealShake, typeof NoopShake>;
  i18n: SurfaceLock<typeof RealI18n, typeof NoopI18n>;
  plain: SurfaceLock<typeof RealPlain, typeof NoopPlain>;
} = { root: true, capture: true, shake: true, i18n: true, plain: true };

/* ------------------------------------------------------------------ dữ liệu chung */

const SRC = path.resolve(__dirname, '..');

/** [entry thật, bản noop] — đường tương đối từ `src/`. */
const PAIRS = [
  ['index.ts', 'noop/index.ts'],
  ['capture/index.ts', 'noop/capture.ts'],
  ['shake/index.ts', 'noop/shake.ts'],
  ['i18n/index.ts', 'noop/i18n.ts'],
  ['plain/index.ts', 'noop/plain.ts'],
] as const;

const load = (file: string): Record<string, unknown> =>
  require(path.join(SRC, file.replace(/\.ts$/, '')));

const hasFunction = (v: unknown): boolean =>
  typeof v === 'function' ||
  (typeof v === 'object' && v !== null && Object.values(v).some(hasFunction));

/** Tên kiểu component: `DevToolsGate`, `LogRow` — không bắt hằng viết hoa (`DEFAULT_CAPACITY`). */
const isComponentName = (name: string) => /^[A-Z][a-z]/.test(name);

/**
 * Export cần tham số hoặc cố ý từ chối nên không đi qua vòng "gọi không tham số" — mỗi cái có test
 * riêng bên dưới: `ConnectorError` là lớp (cần `new`), `runUncaptured(fn)` chạy `fn`, connector
 * có `test`/`send` từ chối.
 */
const isConnector = (name: string) => /Connector$/.test(name) && name !== 'defineConnector';
const HAS_OWN_TEST = (name: string) => name === 'ConnectorError' || name === 'runUncaptured';

describe('bề mặt noop', () => {
  it('kiểu khớp bản thật (khoá ở tsc — chạy tới đây là tsc đã xanh)', () => {
    expect(surfaceLocks).toEqual({ root: true, capture: true, shake: true, i18n: true, plain: true });
  });

  describe('tên export và nghĩa (kiểu / giá trị), kể cả export kiểu (TypeScript checker)', () => {
    let exportNames: (file: string) => string[];

    beforeAll(() => {
      const program = ts.createProgram(
        PAIRS.flat().map((f) => path.join(SRC, f)),
        {
          noEmit: true,
          noLib: true,
          types: [],
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          target: ts.ScriptTarget.ES2022,
        },
      );
      const checker = program.getTypeChecker();
      /* Lớp vừa là kiểu vừa là giá trị; `const X: typeof Real.X` chỉ là giá trị — tên trùng mà nghĩa lệch. */
      const meaning = (exported: ts.Symbol): string => {
        const target =
          exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
        const kinds: string[] = [];
        if (target.flags & ts.SymbolFlags.Type) kinds.push('kiểu');
        if (target.flags & ts.SymbolFlags.Value) kinds.push('giá trị');
        return kinds.join('+');
      };
      exportNames = (file) => {
        const source = program.getSourceFile(path.join(SRC, file));
        const symbol = source && checker.getSymbolAtLocation(source);
        if (!symbol) throw new Error(`không đọc được module ${file}`);
        return checker
          .getExportsOfModule(symbol)
          .map((s) => `${s.name}: ${meaning(s)}`)
          .sort();
      };
    });

    it.each(PAIRS)('%s ⇔ %s', (real, noop) => {
      const names = exportNames(real);
      expect(names.length).toBeGreaterThan(0);
      expect(exportNames(noop)).toEqual(names);
    });
  });

  it.each(PAIRS)('hằng của %s giữ đúng giá trị ở %s', (real, noop) => {
    const realModule = load(real);
    const noopModule = load(noop);
    const constants = Object.keys(realModule).filter((k) => !hasFunction(realModule[k]));

    for (const k of constants) expect([k, noopModule[k]]).toEqual([k, realModule[k]]);
    if (real === 'index.ts') {
      expect(constants).toEqual(
        expect.arrayContaining(['DEFAULT_CAPACITY', 'DEFAULT_SHAKE_CONFIG', 'REDACTED', 'devtoolsStrings']),
      );
    }
  });
});

describe('hành vi noop', () => {
  const values = Object.entries(NoopRoot as Record<string, unknown>);

  it('mọi hàm và phương thức (trừ component) gọi không tham số đều không ném; Promise thì resolve', async () => {
    const calls: Array<[string, () => unknown]> = [];
    for (const [name, value] of values) {
      if (isComponentName(name) || HAS_OWN_TEST(name) || isConnector(name)) continue;
      if (typeof value === 'function') calls.push([name, value as () => unknown]);
      else if (typeof value === 'object' && value !== null) {
        for (const [method, fn] of Object.entries(value)) {
          if (typeof fn === 'function') calls.push([`${name}.${method}`, fn as () => unknown]);
        }
      }
    }

    expect(calls.length).toBeGreaterThan(50);
    for (const [, call] of calls) {
      const out = call();
      if (out instanceof Promise) await expect(out).resolves.toBeUndefined();
      if (typeof out === 'function') expect(() => (out as () => unknown)()).not.toThrow();
    }
  });

  it('component bọc (cổng, provider) render đúng children; component UI devtools không render gì', () => {
    const wrappers: string[] = [];
    for (const [name, component] of values) {
      if (!isComponentName(name) || HAS_OWN_TEST(name)) continue;
      const element = createElement(
        component as ComponentType<{ children?: ReactNode }>,
        null,
        createElement(Text, null, 'cây app'),
      );
      const tree = render(element).toJSON();
      if (tree === null) continue;
      expect(tree).toMatchObject({ type: 'Text', children: ['cây app'] });
      wrappers.push(name);
    }

    expect(wrappers.sort()).toEqual(['DevToolsGate', 'DevToolsUiProvider']);
  });

  it('hook trả hằng ổn định, câm', () => {
    expect(NoopRoot.useDevTools()).toBe(NoopRoot.useDevTools());
    expect(NoopRoot.useDevTools()).toMatchObject({ enabled: false, isOpen: false });
    expect(NoopRoot.useLogEntries(true)).toBe(NoopRoot.useLogEntries(true));
    expect(NoopRoot.useLogEntries(true)).toEqual([]);
    expect(NoopRoot.usePausableEntries([])).toBe(NoopRoot.usePausableEntries([]));
    expect(NoopRoot.useLogExport({ getEntries: () => [] }).state).toBe('idle');
    expect(NoopRoot.usePreviousSession()).toBeNull();
    expect(NoopRoot.useShake(jest.fn(), NoopRoot.DEFAULT_SHAKE_CONFIG)).toBe(false);
  });

  it('thu không làm gì: không vá console/XHR/ErrorUtils, kho luôn rỗng', () => {
    const g = globalThis as Record<string, unknown>;
    const hadXhr = 'XMLHttpRequest' in g;
    const savedXhr = g.XMLHttpRequest;
    class FakeXhr {
      open() {}
    }
    g.XMLHttpRequest = FakeXhr;
    const originalOpen = FakeXhr.prototype.open;
    const originalError = console.error;
    const errorUtils = g.ErrorUtils as { getGlobalHandler?: () => unknown } | undefined;
    const originalHandler = errorUtils?.getGlobalHandler?.();

    const stop = NoopRoot.startCapture({ enabled: true, console: true, network: true, uncaught: true });

    expect(console.error).toBe(originalError);
    expect(FakeXhr.prototype.open).toBe(originalOpen);
    expect(errorUtils?.getGlobalHandler?.()).toBe(originalHandler);
    if (hadXhr) g.XMLHttpRequest = savedXhr;
    else delete g.XMLHttpRequest;
    NoopRoot.logBuffer.push({ id: 1, kind: 'marker', at: 0, type: 'user', label: 'x' });
    expect(NoopRoot.logBuffer.snapshot()).toEqual([]);
    expect(NoopRoot.logBuffer.snapshot()).toBe(NoopRoot.logBuffer.snapshot());
    expect(NoopRoot.getCaptureStartedAt()).toBeUndefined();
    stop();
  });

  it('hàm che không trả dữ liệu thô', () => {
    const entry = {
      id: 1,
      kind: 'network',
      at: 0,
      method: 'POST',
      url: 'https://x',
      requestHeaders: { Authorization: 'Bearer bí-mật' },
      requestBody: '{"password":"bí-mật"}',
      responseBody: '{"token":"bí-mật"}',
    } as const;

    expect(JSON.stringify(NoopRoot.redactEntry(entry))).not.toContain('bí-mật');
    expect(NoopRoot.redactHeaders({ Authorization: 'Bearer bí-mật' })).toEqual({});
    expect(NoopRoot.redactBody('{"password":"bí-mật"}')).toBeUndefined();
    expect(NoopRoot.maskPersonalData('gọi 0912 345 678 hoặc a@b.vn')).toBe('');
  });

  it('runUncaptured chỉ chạy fn và trả kết quả của nó', () => {
    const fn = jest.fn(() => 42);

    expect(NoopRoot.runUncaptured(fn)).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('báo bug noop', () => {
  const connectors = [
    NoopRoot.jiraCloudConnector,
    NoopRoot.slackConnector,
    NoopRoot.larkConnector,
    NoopRoot.webhookConnector,
  ];

  it('ConnectorError giữ chữ ký của bản thật: kind, message, field, retryAfterMs, status', () => {
    const e = new NoopRoot.ConnectorError('rate-limit', 'chậm lại', {
      field: 'f',
      retryAfterMs: 5,
      status: 429,
    });

    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(NoopRoot.ConnectorError);
    expect(e).toMatchObject({
      name: 'ConnectorError',
      kind: 'rate-limit',
      message: 'chậm lại',
      field: 'f',
      retryAfterMs: 5,
      status: 429,
    });
  });

  it('defineConnector là hàm đồng nhất', () => {
    expect(NoopRoot.defineConnector(NoopRoot.slackConnector)).toBe(NoopRoot.slackConnector);
  });

  it.each(connectors.map((c) => [c.id, c] as const))(
    'connector %s: id/label/fields vô hại, test và send từ chối "devtools disabled"',
    async (_id, c) => {
      expect(typeof c.id).toBe('string');
      expect(c.label('vi')).toEqual(expect.any(String));
      expect(c.fields('vi')).toEqual([]);
      expect(c.secretFieldIds).toEqual([]);
      expect(c.capabilities({})).toEqual({ image: false, files: false });

      const ctx = {} as never;
      const report = {} as never;
      const rejection = { name: 'ConnectorError', kind: 'unknown', message: 'devtools disabled' };
      await expect(c.test({}, {}, ctx)).rejects.toMatchObject(rejection);
      await expect(c.send(report, {}, {}, ctx)).rejects.toMatchObject(rejection);
    },
  );

  it('id khớp bản thật', () => {
    const real = require('../index') as typeof import('../index');
    const pairs = [
      [real.jiraCloudConnector, NoopRoot.jiraCloudConnector],
      [real.slackConnector, NoopRoot.slackConnector],
      [real.larkConnector, NoopRoot.larkConnector],
      [real.webhookConnector, NoopRoot.webhookConnector],
    ] as const;

    for (const [r, n] of pairs) expect(n.id).toBe(r.id);
  });
});
