#!/usr/bin/env node
/**
 * Static proof of the no-op swap, without a device: `npm run check:noop [-- android ios]`.
 *
 * For each platform it runs `expo export` (production, plain JS + source map) twice:
 *
 * 1. `DEVTOOLS_NOOP=1`: every library file in the source map must be a no-op entry
 *    (`src/noop/*`) or one of the two string tables (`src/i18n/en.ts`, `vi.ts`), and none of the
 *    marker strings may appear in the bundle.
 * 2. Control, without the variable: the markers must appear, which shows the check can see them.
 *
 * The markers are string literals that only the real code has: a test id of the panel, the key of
 * the bug report connection list, and the header the tool puts on its own requests. Output goes to
 * a temporary folder that is removed afterwards. Exit code 1 on any failure.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const repoSrc = path.resolve(projectRoot, '..', 'src');
const expoCli = require.resolve('expo/bin/cli', { paths: [projectRoot] });
const MARKERS = ['devtools-panel-dismiss', 'devtools.connections.v1', 'X-Shake-Devtools'];
const ALLOWED = [/^noop[\\/]/, /^i18n[\\/](en|vi)\.ts$/];

const platforms = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['android'];
let failed = false;

const exportBundle = (platform, noop) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `shake-devtools-${platform}-`));
  const env = { ...process.env };
  if (noop) env.DEVTOOLS_NOOP = '1';
  else delete env.DEVTOOLS_NOOP;
  execFileSync(
    process.execPath,
    [
      expoCli,
      'export',
      '--platform',
      platform,
      '--no-bytecode',
      '--source-maps',
      '--clear',
      '--output-dir',
      outDir,
    ],
    { cwd: projectRoot, env, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const jsDir = path.join(outDir, '_expo', 'static', 'js', platform);
  const files = fs.readdirSync(jsDir);
  const code = fs.readFileSync(path.join(jsDir, files.find((f) => f.endsWith('.js'))), 'utf8');
  const map = JSON.parse(fs.readFileSync(path.join(jsDir, files.find((f) => f.endsWith('.map'))), 'utf8'));
  fs.rmSync(outDir, { recursive: true, force: true });

  const sources = map.sections ? map.sections.flatMap((s) => s.map.sources) : map.sources;
  // Sources are project-relative with a leading slash: `/src/App.tsx`, `/../src/noop/index.ts`.
  const libraryFiles = sources
    .map((s) => path.resolve(projectRoot, `.${s}`))
    .filter((abs) => abs.startsWith(repoSrc + path.sep))
    .map((abs) => path.relative(repoSrc, abs));
  const markers = Object.fromEntries(MARKERS.map((m) => [m, code.split(m).length - 1]));
  return { libraryFiles, markers };
};

for (const platform of platforms) {
  const noop = exportBundle(platform, true);
  const stray = noop.libraryFiles.filter((f) => !ALLOWED.some((re) => re.test(f)));
  const leaked = MARKERS.filter((m) => noop.markers[m] > 0);
  console.log(`[${platform}] DEVTOOLS_NOOP=1: ${noop.libraryFiles.length} library files`);
  for (const f of noop.libraryFiles) console.log(`  src/${f.replace(/\\/g, '/')}`);
  if (stray.length > 0 || leaked.length > 0) {
    failed = true;
    console.error(`  FAIL: real files ${JSON.stringify(stray)}, markers ${JSON.stringify(leaked)}`);
  } else {
    console.log(`  OK: only no-op entries and string tables; markers absent`);
  }

  const control = exportBundle(platform, false);
  const missing = MARKERS.filter((m) => control.markers[m] === 0);
  console.log(`[${platform}] control (no variable): ${control.libraryFiles.length} library files`);
  if (missing.length > 0) {
    failed = true;
    console.error(`  FAIL: markers not found in the real bundle: ${JSON.stringify(missing)}`);
  } else {
    console.log(`  OK: every marker is present in the real bundle`);
  }
}

process.exit(failed ? 1 : 0);
