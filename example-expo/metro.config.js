// @ts-check
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
// An app that installed the package writes `require('react-native-shake-devtools/metro')`. This
// app loads the library from the repo root without installing it, so Node needs the file path.
const { devtoolsNoopResolver } = require('../src/metro/noop-resolver');

/**
 * Metro for the Expo example: loads the library's `../src` straight from the repo root, with no
 * build step, the same way `example/metro.config.js` does, on top of Expo's default config.
 *
 * The repo root has its own `node_modules` (jest + tsc for the library) with another `react` and
 * `react-native`. If Metro could reach it, the bundle would carry two copies of React and the app
 * would die on start. So:
 *
 * 1. `watchFolders` adds the repo root, so Metro sees `../src` and the root `package.json`.
 * 2. `blockList` hides the root `node_modules`, the other app (`example/`, its own React and native
 *    build folders) and the root dot-folders (`.git`, editor and agent folders). A file in `../src`
 *    that looks up `react` through its parent folders then finds nothing there.
 * 3. `nodeModulesPaths` sends every lookup, including those from `../src`, to
 *    `example-expo/node_modules`.
 * 4. `extraNodeModules` maps the package name `react-native-shake-devtools` to the repo root.
 *    Metro reads the `exports` of the library's `package.json` (on by default in Expo), so
 *    `/plain` and `/capture` resolve as they would from npm, to `src/` through the `react-native`
 *    condition.
 *
 * Babel: no `babel.config.js` here. `babel-preset-expo` (the default) adds
 * `react-native-worklets/plugin` when that package is installed, and Metro applies the app's
 * Babel setup to `../src` too, so the library's `'worklet'` functions (`src/shake/`) are compiled.
 *
 * No-op swap: with `DEVTOOLS_NOOP=1`, every import of the library resolves to its no-op entry, as
 * README › "Keeping it out of production" and `docs/recipes/expo.md` § 5 describe. Change the
 * variable ⇒ run Metro with `--clear`, or the cache keeps the previous resolution.
 */
const root = path.resolve(__dirname, '..');
const escapeRegExp = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const underRoot = (/** @type {string} */ pattern) =>
  new RegExp(`^${escapeRegExp(root)}[\\\\/]${pattern}[\\\\/].*$`);

const config = getDefaultConfig(__dirname);

config.watchFolders = [...(config.watchFolders ?? []), root];

config.resolver.blockList = [
  ...[config.resolver.blockList ?? []].flat(),
  underRoot('node_modules'),
  underRoot('example'),
  underRoot('\\.[^\\\\/]+'),
];
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules')];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'react-native-shake-devtools': root,
};

config.resolver.resolveRequest = devtoolsNoopResolver({
  enabled: process.env.DEVTOOLS_NOOP === '1', // the app's rule; the library reads no env vars
  resolveRequest: config.resolver.resolveRequest ?? undefined,
});

module.exports = config;
