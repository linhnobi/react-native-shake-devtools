# Install guide (for you or for your AI coding agent)

You can follow this by hand, or paste **one prompt** into Claude Code, Cursor or Codex and let the agent
do it. Copy the prompt that matches your project.

> **Status:** the package is not on npm yet (`"private": true`). Until it is, install from Git
> (below). Expo support is **in progress**; parts marked *pending Expo support* are not finished or
> not verified.

## One-prompt install

### Bare React Native

```text
Install and wire up react-native-shake-devtools in this React Native app. Follow
docs/install.md in https://github.com/linhnobi/react-native-shake-devtools (read it first).

Rules:
- Use the "react-native-shake-devtools/plain" entry (React Native core sheet, no gorhom).
- Install: npm install github:linhnobi/react-native-shake-devtools, plus any missing peers:
  react-native-reanimated (+ react-native-worklets for v4) and react-native-safe-area-context.
- Call startCapture({ enabled }) at module scope in App.tsx, before the component tree renders;
  `enabled` is required and must be the same value as the gate's `enabled`.
- Wrap the app root in <DevToolsGate>, which must cover the full screen.
- DevToolsConfig.enabled must come from this app's own environment/flavor rule (never __DEV__),
  and must be false for production. Find our existing env mechanism and use it; if none exists, ask me.
- Do NOT add bug-report wiring yet, unless I say so.
- Run the typecheck and tests, and tell me what you could not verify on a device.
```

### Expo (pending Expo support)

```text
Install and wire up react-native-shake-devtools in this Expo app. Follow docs/install.md in
https://github.com/linhnobi/react-native-shake-devtools (read the "Expo" section first). Expo support
is pending: tell me which parts you could not verify.

Rules:
- Use the "react-native-shake-devtools/plain" entry.
- Install from Git: npm install github:linhnobi/react-native-shake-devtools, then
  npx expo install react-native-reanimated react-native-safe-area-context.
- Call startCapture({ enabled }) at module scope in the root file, before the tree renders.
- Wrap the root in <DevToolsGate>. Take `enabled` from our app's environment (EXPO_PUBLIC_* variable
  or the EAS build profile), false for production. Never __DEV__.
- Check the Expo SDK version. On SDK 56+ the global fetch is expo/fetch; startCapture() wraps it too
  (tested with jest only, not yet in an Expo app; see docs/recipes/expo.md). Call startCapture()
  before any SDK that wraps fetch (for example Sentry.init), and tell me if requests are missing.
- Do not add bug-report wiring unless I say so.
- Run the typecheck and tests.
```

## Manual install

### 1. Install

```bash
npm install github:linhnobi/react-native-shake-devtools
# peers for the "plain" entry (the smallest set):
npm install react-native-reanimated react-native-worklets react-native-safe-area-context
```

Requirements: React Native `>=0.76`, React `>=18.2`, Metro reading `package.json#exports`
(`unstable_enablePackageExports`, on by default since RN 0.79; enable it on 0.76 to 0.78). The
package ships its TypeScript source plus a compiled `lib/` built by its `prepare` script
(react-native-builder-bob; a Git install relies on npm running `prepare`, not verified here): Metro
compiles the source with your app (the `react-native` export condition), and your `tsc` reads the
generated `.d.ts` files. Reanimated needs its usual babel
plugin (`react-native-worklets/plugin` on v4).

Entry `react-native-shake-devtools` (without `/plain`) builds its sheet on `@gorhom/bottom-sheet` and
needs `react-native-gesture-handler` plus `GestureHandlerRootView` and `BottomSheetModalProvider` at the
root. Start with `/plain`; it has the same API.

### 2. Decide when it is enabled

The library never guesses. You write the rule once, in a file you can test:

```ts
// src/devtools/devtools-config.ts
import type { DevToolsConfig } from 'react-native-shake-devtools/plain';

// Use YOUR env/flavor mechanism. Do not use __DEV__: UAT builds often have __DEV__ === true.
const APP_ENV = 'uat' as 'dev' | 'uat' | 'prod';

export const devToolsConfig: DevToolsConfig = {
  enabled: APP_ENV !== 'prod',
  subtitle: `${APP_ENV.toUpperCase()} · 1.0.0`,
};
```

### 3. Start capture and mount the gate

```tsx
// App.tsx
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DevToolsGate, startCapture } from 'react-native-shake-devtools/plain';
import { devToolsConfig } from './src/devtools/devtools-config';

// Module scope, BEFORE the tree renders, so the first requests are captured.
// `enabled` is required; anything but `true` patches nothing.
startCapture({ enabled: devToolsConfig.enabled });

export default function App() {
  return (
    <SafeAreaProvider>
      <DevToolsGate config={devToolsConfig} actions={[]}>
        {/* your app; the gate must cover the whole screen */}
        <RootNavigator />
      </DevToolsGate>
    </SafeAreaProvider>
  );
}
```

Run a **release** build to try the shake (in a debug build the shake opens React Native's dev menu,
where a "Debug tools" entry appears). `actions={[]}` is fine: the panel still has the Logs row. Add your
own rows later through `actions`.

### 4. Optional: bug report

Adds a **Report a bug** row. Every native capability is supplied by your app; the library has no native
module. This example uses packages the `example/` app already runs on a device:

```bash
npm install react-native-view-shot react-native-keychain react-native-share react-native-blob-util
```

```ts
// src/devtools/devtools-config.ts (extend the config above)
import { Dimensions, PixelRatio } from 'react-native';
import { captureScreen } from 'react-native-view-shot';
import { getGenericPassword, resetGenericPassword, setGenericPassword } from 'react-native-keychain';
import type { DevToolsConfig, DevToolsSecureStore } from 'react-native-shake-devtools/plain';

const SERVICE = 'shake-devtools:';

const secureStore: DevToolsSecureStore = {
  getItem: async (key) => {
    const found = await getGenericPassword({ service: SERVICE + key });
    return found ? found.password : null;
  },
  setItem: async (key, value) => {
    const saved = await setGenericPassword(key, value, { service: SERVICE + key });
    if (!saved) throw new Error(`Keychain refused to store "${key}"`);
  },
  removeItem: async (key) => {
    await resetGenericPassword({ service: SERVICE + key });
  },
};

export const devToolsConfig: DevToolsConfig = {
  enabled: APP_ENV !== 'prod',
  bugReport: {
    // Return null on screens that must never be captured.
    captureScreen: async () => {
      const uri = await captureScreen({ format: 'jpg', quality: 0.7, result: 'tmpfile' });
      const { width, height } = Dimensions.get('window');
      const ratio = PixelRatio.get();
      return {
        uri,
        mimeType: 'image/jpeg',
        width: Math.round(width * ratio),
        height: Math.round(height * ratio),
      };
    },
    secureStore, // tokens live ONLY here, never in logs
    // shareFiles / writeTempFile / connectorTypes are optional; see example/src/devtools/
    // appContext is optional: your own context (user id, flags, store slice, Sentry event id),
    // redacted like request bodies; see docs/recipes/bug-report-context.md
  },
};
```

Then a tester opens the panel, adds a connection (Jira, Slack, Lark or Webhook), and sends. Read
[security-privacy.md](security-privacy.md) first, and see `example/src/devtools/` for a complete,
device-tested wiring (screenshot with real size, `shareFiles`, `writeTempFile`, a disk `LogStore` for
`persist`).

### 5. Optional: remove it from production bundles

Even with `enabled: false` the code is in the bundle. To drop it, swap it for the empty no-op twin in
`metro.config.js`:

```js
const { devtoolsNoopResolver } = require('react-native-shake-devtools/metro');
module.exports = mergeConfig(getDefaultConfig(__dirname), {
  resolver: {
    resolveRequest: devtoolsNoopResolver({ enabled: process.env.DEVTOOLS_NOOP === '1' }),
  },
});
```

Setting `DEVTOOLS_NOOP` per flavor on Android and iOS has pitfalls (Gradle can reuse a stale bundle when
only the variable changes); see the production section of the README for what was measured and what is
not verified.

## Expo (pending Expo support)

Status of each piece. Nothing here has been run on an Expo app yet. The step-by-step recipe (in
Vietnamese) is [docs/recipes/expo.md](recipes/expo.md).

| Piece | Plan | State |
|---|---|---|
| Install | `npx expo install react-native-reanimated react-native-safe-area-context`, then the Git install above | not verified on Expo |
| No config plugin | the library has no native module, so none should be needed | not verified |
| `fetch` capture | on **SDK 56+** the global `fetch` is `expo/fetch`, which bypasses `XMLHttpRequest`. `startCapture()` also wraps it (`src/capture/fetch-tap.ts`) when it carries Expo's `Symbol.for('expo.builtin')` marker. Not captured: `expo/fetch` imported and called directly, or a global `fetch` another SDK wrapped before `startCapture()` | implemented, tested with jest against a fake `expo/fetch`; not run in an Expo app |
| `secureStore` | `expo-secure-store` with the same three-method shape as above | recipe written; not verified on a device |
| `captureScreen` | `react-native-view-shot` | recipe written; not verified on a device or in Expo Go |
| `shareFiles` / `writeTempFile` | `expo-sharing` and `expo-file-system` | recipe written; not verified on a device |
| Expo Go | may work for capture and the panel; the bug-report pieces are not verified | pending Expo support |
| `enabled` | use an `EXPO_PUBLIC_*` variable or the EAS build profile; never `__DEV__` | works the same as bare |

If you try it on Expo, please open an issue with your SDK version and what you observed. It speeds this
up.

## Checklist for an agent (or you)

- [ ] `startCapture({ enabled })` runs at module scope, with the same `enabled` as the gate
- [ ] `DevToolsGate` wraps the whole app and `enabled` is `false` for production
- [ ] `SafeAreaProvider` is mounted (without it, insets are treated as 0)
- [ ] Release build opens the panel on shake; Logs shows a request after you trigger one
- [ ] Bug report only added with a real `secureStore`; no token appears in logs
- [ ] Typecheck and tests pass; note what was not verified on a device
