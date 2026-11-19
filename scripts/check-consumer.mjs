#!/usr/bin/env node
/**
 * Consumer check: the package as an app sees it after `npm install`. `npm run check` type-checks
 * `src/` with the library's own settings; an app's tsc reads the packed `lib/typescript/*.d.ts`
 * (the `types` condition) with the app's settings, and Node resolves `exports` on its own rules.
 *
 *   npm run check:consumer                 build, pack, install, check; temp dir removed afterwards
 *   npm run check:consumer -- --keep       keep the temp app (`npx tsc -p tsconfig.<cell>.json`)
 *   npm run check:consumer -- --reuse=DIR  skip build, pack and install; check the app kept in DIR
 *
 * 1. `npm run build` (bob), then `npm pack --ignore-scripts` into a temp dir.
 * 2. A throwaway app there installs the tarball, every peer, `react-native-worklets`, `typescript`,
 *    `@types/react` and `@react-native/typescript-config`, at the versions the root lockfile
 *    resolved for the root devDependencies (the preset takes the `react-native` version).
 *    Dependency install scripts are skipped. Needs the npm registry.
 * 3. Surface: for every no-op entry and its real twin (taken from `exports`), the TypeScript checker
 *    lists the exports; names and kinds (value, type) must match. A generated `noop-surface.ts` then
 *    asserts that every value and every type export has the identical type on both sides; it is
 *    type-checked in step 4.
 * 4. The fixture (`scripts/consumer-fixture/`, written from the README) is type-checked with the
 *    app's own TypeScript under `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
 *    and `skipLibCheck: false`, in these cells: `bundler`; `nodenext` from an ES module and from a
 *    CommonJS module; the `@react-native/typescript-config` preset; and `bundler` again with
 *    `@gorhom/*` and `react-native-gesture-handler` removed, over the code that uses only `./plain`
 *    and the headless entries (README "Entries": `./plain` needs neither).
 *    A cell fails on an error located in this package's files (`node_modules/<package>/`), in the
 *    fixture, or in no file at all (setup). Errors inside other packages' `.d.ts`, which
 *    `skipLibCheck: false` brings out, are counted and ignored: they are not this package's to fix.
 * 5. Node: every `exports` entry resolves through `import` and `require` from inside the app, every
 *    condition target exists, and `./metro` loads both ways and swaps an entry for its no-op.
 *
 * No dependency of its own: Node built-ins, and the app's TypeScript once it is installed.
 * Exit code 1 on any failure.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'scripts', 'consumer-fixture');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const pkg = readJson(path.join(ROOT, 'package.json'));
const PKG = pkg.name;

const argv = process.argv.slice(2);
const keep = argv.includes('--keep');
const reuse = argv.find((a) => a.startsWith('--reuse='))?.slice('--reuse='.length);

/** Removed for the last cell: README "Entries" says `./plain` needs neither. */
const HIDDEN_FOR_PLAIN = ['@gorhom', 'react-native-gesture-handler'];

/** Options every cell adds on top of its module settings: what a strict app turns on. */
const STRICT = {
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  skipLibCheck: false,
  noEmit: true,
  types: [],
};
const BASE = { target: 'es2022', lib: ['es2022'], jsx: 'react-jsx' };
const ESM_ALL = ['src/esm/**/*'];
/** `id` names the cell's `tsconfig.<id>.json` in the app. */
const CELLS = [
  {
    id: 'bundler',
    name: 'bundler',
    include: ESM_ALL,
    options: { ...BASE, module: 'esnext', moduleResolution: 'bundler' },
  },
  {
    id: 'nodenext-esm',
    name: 'nodenext (ESM)',
    include: ESM_ALL,
    options: { ...BASE, module: 'nodenext', moduleResolution: 'nodenext' },
  },
  {
    id: 'nodenext-cjs',
    name: 'nodenext (CJS)',
    include: ['src/cjs/**/*'],
    options: { ...BASE, module: 'nodenext', moduleResolution: 'nodenext' },
  },
  {
    id: 'rn-preset',
    name: '@react-native/typescript-config',
    include: ESM_ALL,
    extends: '@react-native/typescript-config',
    options: {},
  },
  {
    id: 'plain-no-optional-peers',
    name: 'bundler, ./plain without gorhom + gesture-handler',
    include: ['src/esm/common/**/*', 'src/esm/ui/plain.tsx', 'src/esm/ui/root-plain.tsx'],
    hide: HIDDEN_FOR_PLAIN,
    options: { ...BASE, module: 'esnext', moduleResolution: 'bundler' },
  },
];

const failures = [];
const fail = (message) => {
  failures.push(message);
  console.error(`FAIL ${message}`);
};
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;
const timed = (label, fn) => {
  const start = Date.now();
  const result = fn();
  console.log(`  ${label.padEnd(12)} ${seconds(Date.now() - start).padStart(7)}`);
  return result;
};

/**
 * `npm` without a shell where possible: under `npm run`, `npm_execpath` is npm's own CLI script.
 * Run directly on Windows, `npm.cmd` needs a shell: one command line, arguments with spaces quoted.
 */
const npm = (args, cwd, { capture = false } = {}) => {
  const cli = process.env.npm_execpath;
  const options = {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  };
  const result =
    cli && /npm-cli\.c?js$/.test(cli)
      ? spawnSync(process.execPath, [cli, ...args], options)
      : process.platform === 'win32'
        ? spawnSync(['npm', ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' '), {
            ...options,
            shell: true,
          })
        : spawnSync('npm', args, options);
  if (result.status !== 0) {
    throw new Error(
      `npm ${args.join(' ')} failed (${result.error?.message ?? `exit ${result.status}`})`,
    );
  }
  return result.stdout;
};

/** Version the root lockfile resolved for a root devDependency (its range when not locked). */
const lockedVersion = (() => {
  const locked = readJson(path.join(ROOT, 'package-lock.json')).packages ?? {};
  return (name) => {
    const range = pkg.devDependencies?.[name];
    if (range === undefined) throw new Error(`${name} is not in the root devDependencies`);
    return locked[`node_modules/${name}`]?.version ?? range;
  };
})();

const createApp = (tmp) => {
  const packed = JSON.parse(
    npm(['pack', '--ignore-scripts', '--json', '--pack-destination', tmp], ROOT, { capture: true }),
  );
  const tarball = packed[0];
  const app = path.join(tmp, 'app');
  fs.mkdirSync(app);
  const dependencies = { [PKG]: `file:../${tarball.filename}` };
  const extras = ['react-native-worklets'].filter(
    (name) => pkg.devDependencies?.[name] !== undefined,
  );
  for (const name of [...Object.keys(pkg.peerDependencies), ...extras])
    dependencies[name] = lockedVersion(name);
  writeJson(path.join(app, 'package.json'), {
    name: 'consumer-check-app',
    version: '0.0.0',
    private: true,
    dependencies,
    devDependencies: {
      typescript: lockedVersion('typescript'),
      '@types/react': lockedVersion('@types/react'),
      // Released in lockstep with react-native; not a root devDependency.
      '@react-native/typescript-config': lockedVersion('react-native'),
    },
  });
  return { app, tarball };
};

/** The fixture twice: as ES modules (`src/esm`) and as CommonJS (`src/cjs`), for `nodenext`. */
const layoutFixture = (app, surfaceSource) => {
  const template = fs.readFileSync(path.join(FIXTURE, 'ui', 'devtools-ui.template.tsx'), 'utf8');
  for (const kind of ['esm', 'cjs']) {
    const dir = path.join(app, 'src', kind);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'ui'), { recursive: true });
    writeJson(path.join(dir, 'package.json'), { type: kind === 'esm' ? 'module' : 'commonjs' });
    fs.cpSync(path.join(FIXTURE, 'common'), path.join(dir, 'common'), { recursive: true });
    for (const [file, entry] of [
      ['gorhom.tsx', PKG],
      ['plain.tsx', `${PKG}/plain`],
    ]) {
      fs.writeFileSync(path.join(dir, 'ui', file), template.replaceAll('__ENTRY__', entry));
    }
    for (const file of ['root-gorhom.tsx', 'root-plain.tsx']) {
      fs.copyFileSync(path.join(FIXTURE, 'ui', file), path.join(dir, 'ui', file));
    }
    fs.writeFileSync(path.join(dir, 'noop-surface.ts'), surfaceSource);
  }
};

const specifier = (key) => (key === '.' ? PKG : `${PKG}/${key.slice(2)}`);

/**
 * Real entry ↔ no-op twin, from `exports`: names and kinds through the checker, then a generated
 * file of type assertions (checked by every cell but the last).
 */
const surface = (ts, app, exportsMap) => {
  const keys = Object.keys(exportsMap);
  const noopKeys = keys.filter((k) => k === './noop' || k.startsWith('./noop/'));
  const realOf = (k) => (k === './noop' ? '.' : `./${k.slice('./noop/'.length)}`);
  const bundled = keys.filter(
    (k) => k !== './package.json' && k !== './metro' && !noopKeys.includes(k),
  );
  for (const k of bundled.filter((k) => !noopKeys.some((n) => realOf(n) === k))) {
    fail(`surface: ${specifier(k)} has no no-op twin in exports`);
  }
  const pairs = noopKeys.map((k) => [specifier(realOf(k)), specifier(k)]);

  const probeDir = path.join(app, '.surface');
  fs.mkdirSync(probeDir, { recursive: true });
  const probe = path.join(probeDir, 'probe.ts');
  fs.writeFileSync(
    probe,
    pairs
      .flatMap(([r, n], i) => [
        `import * as R${i} from '${r}';`,
        `import * as N${i} from '${n}';`,
        `export { R${i}, N${i} };`,
      ])
      .join('\n'),
  );
  const program = ts.createProgram([probe], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(probe);
  const exportsOf = (spec) => {
    const decl = sourceFile.statements.find(
      (s) => ts.isImportDeclaration(s) && s.moduleSpecifier.text === spec,
    );
    const moduleSymbol = checker.getSymbolAtLocation(decl.moduleSpecifier);
    if (!moduleSymbol) throw new Error(`surface: TypeScript does not resolve ${spec}`);
    const out = new Map();
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const target =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const isType = (target.flags & ts.SymbolFlags.Type) !== 0;
      const isValue = (target.flags & ts.SymbolFlags.Value) !== 0;
      const generic = (target.declarations ?? []).find(
        (d) =>
          ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d) || ts.isClassDeclaration(d),
      );
      const required =
        isType && generic?.typeParameters
          ? generic.typeParameters.filter((p) => !p.default).length
          : 0;
      out.set(symbol.name, { isType, isValue, required });
    }
    return out;
  };

  const lines = [
    '// GENERATED by scripts/check-consumer.mjs: every real entry against its no-op twin.',
    'type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;',
    'type Assert<T extends true> = T;',
    'type Mismatch<R, N> = { [K in keyof R & keyof N]: Equal<R[K], N[K]> extends true ? never : K }[keyof R & keyof N];',
  ];
  let values = 0;
  let types = 0;
  pairs.forEach(([r, n], i) => {
    const real = exportsOf(r);
    const noop = exportsOf(n);
    const onlyReal = [...real.keys()].filter((k) => !noop.has(k));
    const onlyNoop = [...noop.keys()].filter((k) => !real.has(k));
    const kind = [...real.keys()].filter(
      (k) =>
        noop.has(k) &&
        (real.get(k).isType !== noop.get(k).isType || real.get(k).isValue !== noop.get(k).isValue),
    );
    if (onlyReal.length) fail(`surface: ${n} lacks ${onlyReal.join(', ')}`);
    if (onlyNoop.length) fail(`surface: ${n} has extra ${onlyNoop.join(', ')}`);
    if (kind.length)
      fail(`surface: value/type kind differs between ${r} and ${n}: ${kind.join(', ')}`);
    lines.push(
      `import type * as R${i} from '${r}';`,
      `import type * as N${i} from '${n}';`,
      `declare const r${i}: typeof R${i};`,
      `declare const n${i}: typeof N${i};`,
      `export const r${i}AsNoop: typeof N${i} = r${i};`,
      `export const n${i}AsReal: typeof R${i} = n${i};`,
      // Per key: two module namespaces are never `Equal` as a whole.
      `export type V${i} = Assert<Equal<Mismatch<typeof R${i}, typeof N${i}>, never>>;`,
      `export type K${i} = Assert<Equal<keyof typeof R${i}, keyof typeof N${i}>>;`,
    );
    for (const [name, info] of real) {
      if (info.isValue) values += 1;
      if (!info.isType || !noop.has(name)) continue;
      types += 1;
      const args = info.required ? `<${Array(info.required).fill('never').join(', ')}>` : '';
      const id = `T${i}_${name}`;
      lines.push(
        `export type ${id} = Assert<Equal<R${i}.${name}${args}, N${i}.${name}${args}>>;`,
        `declare const ${id}_r: R${i}.${name}${args};`,
        `declare const ${id}_n: N${i}.${name}${args};`,
        `export const ${id}_rn: N${i}.${name}${args} = ${id}_r;`,
        `export const ${id}_nr: R${i}.${name}${args} = ${id}_n;`,
      );
    }
  });
  fs.rmSync(probeDir, { recursive: true, force: true });
  return { source: `${lines.join('\n')}\n`, pairs: pairs.length, values, types };
};

const BUCKETS = ['package', 'fixture', 'setup', 'other'];

/** One cell: write its tsconfig, build the program the way `tsc -p` does, bucket every error. */
const typecheckCell = (ts, app, cell) => {
  const configFile = path.join(app, `tsconfig.${cell.id}.json`);
  writeJson(configFile, {
    ...(cell.extends ? { extends: cell.extends } : {}),
    compilerOptions: { ...cell.options, ...STRICT },
    include: cell.include,
  });
  const host = {
    ...ts.sys,
    getCurrentDirectory: () => app,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configFile, undefined, host);
  const compilerHost = ts.createCompilerHost(parsed.options);
  compilerHost.getCurrentDirectory = () => app;
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    host: compilerHost,
    configFileParsingDiagnostics: parsed.errors,
  });
  // Unlike `tsc`, collect semantic errors even when an earlier phase reported one, so an error in
  // another package's config or `.d.ts` cannot hide this package's errors.
  const diagnostics = [
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ].filter((d) => d.category === ts.DiagnosticCategory.Error);

  const relative = (file) => path.relative(app, file).split(path.sep).join('/');
  const ownPrefix = `node_modules/${PKG}/`;
  const found = Object.fromEntries(BUCKETS.map((b) => [b, []]));
  for (const d of diagnostics) {
    let where = '';
    if (d.file) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
      where = `${relative(d.file.fileName)}(${line + 1},${character + 1})`;
    }
    const bucket = where.startsWith(ownPrefix)
      ? 'package'
      : where.startsWith('src/')
        ? 'fixture'
        : where === '' || where.startsWith('tsconfig.')
          ? 'setup'
          : 'other';
    found[bucket].push(
      `${where}${where ? ': ' : ''}error TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`,
    );
  }
  const ownFiles = program
    .getSourceFiles()
    .filter((f) => relative(f.fileName).startsWith(ownPrefix)).length;
  if (ownFiles === 0)
    found.setup.push(`no file of ${PKG} in the program: the fixture did not reach the package`);
  return { ownFiles, found };
};

/** Every `exports` entry through Node's own resolver, from a file inside the app. */
const resolveEntries = async (app) => {
  const installed = path.join(app, 'node_modules', PKG);
  const exportsMap = readJson(path.join(installed, 'package.json')).exports;
  const probe = path.join(app, 'resolve-probe.mjs');
  fs.writeFileSync(
    probe,
    'export const resolve = (s) => import.meta.resolve(s);\nexport const load = (s) => import(s);\n',
  );
  const { resolve, load } = await import(pathToFileURL(probe).href);
  const require = createRequire(probe);
  const rel = (file) => path.relative(installed, file).split(path.sep).join('/');
  let entries = 0;
  for (const [key, value] of Object.entries(exportsMap)) {
    const spec = specifier(key);
    entries += 1;
    for (const target of typeof value === 'string' ? [value] : Object.values(value)) {
      if (!fs.existsSync(path.join(installed, target)))
        fail(`exports: ${spec} → ${target} is missing from the package`);
    }
    let viaImport;
    let viaRequire;
    try {
      viaImport = fileURLToPath(resolve(spec));
      if (!fs.existsSync(viaImport)) throw new Error(`missing ${rel(viaImport)}`);
    } catch (error) {
      fail(`exports: import('${spec}') does not resolve: ${error.code ?? error.message}`);
    }
    try {
      viaRequire = require.resolve(spec);
    } catch (error) {
      fail(`exports: require.resolve('${spec}') fails: ${error.code ?? error.message}`);
    }
    if (viaImport && viaRequire)
      console.log(
        `    ${spec.padEnd(44)} import → ${rel(viaImport).padEnd(30)} require → ${rel(viaRequire)}`,
      );
  }

  const metro = require(`${PKG}/metro`);
  const asked = [];
  metro.devtoolsNoopResolver({ enabled: true })(
    { resolveRequest: (_context, name) => (asked.push(name), { type: 'empty' }) },
    `${PKG}/capture`,
    'android',
  );
  if (asked[0] !== `${PKG}/noop/capture`)
    fail(`./metro (require): ${PKG}/capture became ${asked[0]}`);
  const metroEsm = await load(`${PKG}/metro`);
  if (typeof metroEsm.devtoolsNoopResolver !== 'function')
    fail('./metro (import): no named export devtoolsNoopResolver');
  fs.rmSync(probe);
  return entries;
};

const started = Date.now();
const tmp = reuse
  ? path.dirname(path.resolve(reuse))
  : fs.mkdtempSync(path.join(os.tmpdir(), 'shake-devtools-consumer-'));
let app = reuse ? path.resolve(reuse) : path.join(tmp, 'app');
try {
  console.log(`consumer check: ${PKG}@${pkg.version}`);
  if (!reuse) {
    timed('build', () => npm(['run', 'build'], ROOT));
    const created = timed('pack', () => createApp(tmp));
    app = created.app;
    console.log(
      `               ${created.tarball.filename}: ${created.tarball.entryCount} files, ${(created.tarball.size / 1024).toFixed(0)} kB`,
    );
    timed('install', () =>
      npm(['install', '--no-audit', '--no-fund', '--ignore-scripts', '--no-package-lock'], app),
    );
  }
  const appRequire = createRequire(path.join(app, 'package.json'));
  const ts = appRequire('typescript');
  const version = (name) => readJson(path.join(app, 'node_modules', name, 'package.json')).version;
  console.log(
    `               react-native ${version('react-native')} · typescript ${ts.version} · @react-native/typescript-config ${version('@react-native/typescript-config')}`,
  );

  const installedExports = readJson(path.join(app, 'node_modules', PKG, 'package.json')).exports;
  const shape = timed('surface', () => surface(ts, app, installedExports));
  console.log(
    `               ${shape.pairs} no-op entries against their real twins: ${shape.values} value + ${shape.types} type exports`,
  );
  layoutFixture(app, shape.source);

  const typecheckStart = Date.now();
  const rows = [];
  for (const cell of CELLS) {
    const moved = [];
    try {
      for (const name of cell.hide ?? []) {
        const from = path.join(app, 'node_modules', name);
        const to = path.join(app, '.hidden', name);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
        moved.push([from, to]);
        try {
          appRequire.resolve(`${name === '@gorhom' ? '@gorhom/bottom-sheet' : name}/package.json`);
          throw new Error(
            `${name} still resolves from the app after removal (a node_modules above it?)`,
          );
        } catch (error) {
          if (error.code !== 'MODULE_NOT_FOUND') throw error;
        }
      }
      rows.push({ cell, ...typecheckCell(ts, app, cell) });
    } finally {
      for (const [from, to] of moved.reverse()) fs.renameSync(to, from);
    }
  }
  console.log(`  ${'typecheck'.padEnd(12)} ${seconds(Date.now() - typecheckStart).padStart(7)}`);
  const width = Math.max(...CELLS.map((c) => c.name.length));
  console.log(
    `    ${'cell'.padEnd(width)}  own files  package  fixture  setup  other packages (ignored)`,
  );
  for (const { cell, ownFiles, found } of rows) {
    const n = (b) => String(found[b].length).padStart(b === 'other' ? 7 : b.length);
    console.log(
      `    ${cell.name.padEnd(width)}  ${String(ownFiles).padStart(9)}  ${n('package')}  ${n('fixture')}  ${n('setup')}  ${n('other')}`,
    );
  }
  const ignored = new Map();
  for (const { found } of rows) {
    for (const line of found.other) {
      const owner = /^node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(line)?.[1] ?? line.split('(')[0];
      ignored.set(owner, (ignored.get(owner) ?? 0) + 1);
    }
  }
  if (ignored.size) {
    console.log(
      `    ignored, by package: ${[...ignored].map(([owner, count]) => `${owner} ${count}`).join(' · ')}`,
    );
  }
  // Same error in several cells: printed once, with the cells it appeared in.
  const failing = new Map();
  for (const { cell, found } of rows) {
    for (const bucket of ['package', 'fixture', 'setup']) {
      for (const line of found[bucket]) {
        const key = `[${bucket}] ${line}`;
        failing.set(key, [...(failing.get(key) ?? []), cell.name]);
      }
    }
  }
  for (const [key, cells] of failing) {
    fail(`${key} (${cells.length === CELLS.length ? 'every cell' : cells.join('; ')})`);
  }

  const resolveStart = Date.now();
  console.log('  resolution (Node, from a file inside the app)');
  const entries = await resolveEntries(app);
  console.log(
    `               ${entries} entries, ${seconds(Date.now() - resolveStart)}; ./metro loads through require and import and swaps ./capture`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  const total = seconds(Date.now() - started);
  if (keep || reuse) console.log(`app kept in ${app}`);
  else fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  console.log(
    failures.length
      ? `consumer check FAILED (${failures.length}) in ${total}`
      : `consumer check passed in ${total}`,
  );
  process.exitCode = failures.length ? 1 : 0;
}
