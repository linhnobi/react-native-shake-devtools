**English** · [Tiếng Việt](for-developers.vi.md)

# For developers: your QA sent you this

`react-native-shake-devtools` lets a QA tester shake a test build and send a prefilled bug ticket
(screenshot, automatically recorded steps, error log, device info, optional app context) straight to
your team's Jira, Slack, Lark/Feishu or a webhook. It is also an in-app devtools panel for React
Native: console, HTTP and error logs, and the previous session after a crash.

This page is the short version. The full detail is in the [README](../README.md).

## Why it is safe in a test build

- **You decide when it runs.** `enabled` is required on `startCapture` and on `DevToolsGate`, has no
  default and is never inferred from `__DEV__`. With anything but `true`, capture patches and writes
  nothing; with `false`, the gate renders only your app (no panel, shake listener or recorder).
- **It can be stripped from production.** With `enabled: false` the code is still in the bundle,
  doing nothing. A Metro resolver (`react-native-shake-devtools/metro`) swaps every import of the
  library for an empty no-op entry with the same exports, so your imports stay the same in every
  flavor. Importing any other path of the package stops the bundle with an error instead of
  shipping real code.
- **What leaves the device is redacted.** Share, export, logs saved to disk and bug reports go
  through one rule (`src/capture/redact.ts`): tokens, passwords, cookies, API keys, JWTs, `Bearer`
  values and known token prefixes become `<redacted>`. The raw cURL never goes into a report.
- **Secrets stay in your secure store.** Connection tokens live only in the `secureStore` your app
  provides (Keychain/Keystore), never in the log, log files on disk, `console.*` or error text.
- **Its own requests stay out of the log**, through `runUncaptured` and an
  `X-Shake-Devtools: internal` header (the destination sees that header in its access logs).
- **No telemetry, no backend.** The library only talks to the destinations the tester set up. There
  is no server of ours in between.
- **No native module, no runtime dependency.** Screenshots, secure storage, sharing and disk come
  from packages your app picks. The peers (Reanimated, safe-area-context) are native: rebuild.

Limits, so you can judge: masking is a safety net, not data-loss prevention. Business data in
bodies, text the tester types into the form and your `sessionInfo` are sent as they are;
`appContext` gets secrets masked, not personal data. `FLAG_SECURE` does not block the bug-report
screenshot: return `null` from `captureScreen` on PIN, OTP and card screens. A Slack bot token or
Lark App Secret on a QA phone is an accepted risk; use a dedicated app with minimal scopes, or the
Webhook connector as a relay. Full page: [security-privacy.md](security-privacy.md).

## Install in three steps

Not on npm yet: [install.md](install.md) shows how to install from Git, and has a one-prompt
version for Claude Code, Cursor or Codex.

**Bare React Native (≥ 0.76)**

1. Install the package and the peers of the `./plain` entry (`react-native-reanimated`,
   `react-native-worklets`, `react-native-safe-area-context`), set up Reanimated's Babel plugin,
   rebuild. [install.md › 1](install.md#1-install)
2. Write one `enabled` rule from your own flavor or environment (false for production), and call
   `startCapture({ enabled })` at module scope, before the app renders.
   [install.md › 2–3](install.md#2-decide-when-it-is-enabled)
3. Wrap the full-screen root in `<DevToolsGate config={{ enabled }} actions={[]}>`. Optional:
   `bugReport` (a `secureStore` and a `captureScreen`) and the Metro no-op resolver.
   [install.md › 4–5](install.md#4-optional-bug-report)

**Expo (in progress: nothing has run in an Expo app yet)**

1. Use a development or internal build, not Expo Go, and
   `npx expo install react-native-reanimated react-native-worklets react-native-safe-area-context`.
2. Add an entry file that imports your capture file first, then `expo-router/entry`; take `enabled`
   from an `EXPO_PUBLIC_*` variable or the EAS build profile.
3. Wrap the root layout in `DevToolsGate`. Bug-report adapters use `expo-secure-store`,
   `react-native-view-shot`, `expo-file-system` and `expo-sharing`; the resolver goes on
   `expo/metro-config`.

All three are sections 1–5 of the [Expo recipe](recipes/expo.md) (Vietnamese); the
[Expo example app](../example-expo/README.md) follows it, with an English README.

## Confirm the production build is clean

1. A test in your app locks `'prod' ⇒ enabled: false`. The rule belongs to your app.
2. Bundle the production JS with the swap on (`DEVTOOLS_NOOP` is the README's example variable; the
   library reads none) and look at what is left:

   ```sh
   mkdir -p build && DEVTOOLS_NOOP=1 npx react-native bundle --platform android --dev false \
     --entry-file index.js --bundle-output build/prod.js --sourcemap-output build/prod.js.map
   # library files left: only src/noop/* and src/i18n/vi.ts, src/i18n/en.ts
   grep -o 'react-native-shake-devtools[/\\]*src[^"]*' build/prod.js.map | sort -u
   # strings only the real code has: expect 0
   grep -c -e X-Shake-Devtools -e devtools.connections.v1 -e devtools-panel-dismiss build/prod.js
   ```

   Expo: `DEVTOOLS_NOOP=1 npx expo export --platform android --no-bytecode --source-maps --clear`,
   same checks on the files in `dist/_expo/static/js/android/`. Run once without the variable to see
   the strings appear, so you know the check can see them.
3. On a device the production build opens normally; `useDevTools().open()` does nothing.

Gradle does not count `DEVTOOLS_NOOP` as an input of the JS bundle task: when you switch it on the
same variant, build with `--rerun-tasks` or the APK can keep the old bundle. Measured with the bare
example app (2026-11-06): 7 library files left instead of 58, and the no-op release ran on an
Android phone. Per-flavor setup on multi-flavor Android, iOS and EAS is not verified.
[README › Keeping it out of production](../README.md#keeping-it-out-of-production)

## Status

Pre-release `0.0.1`, not on npm yet.

- **Measured on one Android phone** (Android 14, RN 0.86): the panel and log capture, both UI
  entries, the no-op release build, and bug reporting end to end through a **Webhook** connection
  (screenshot, steps, offline queue, expired token, report after a crash).
- **Not verified yet:**
  - No report has been sent to a real **Jira, Slack or Lark/Feishu** workspace (waiting for test
    accounts); those connectors are tested with jest and a mocked `fetch`.
  - **iOS:** only the shake threshold was measured on an iPhone; the rest is untested.
  - **Expo:** `expo/fetch` capture is tested with jest only; nothing has run in an Expo app (dev
    build, Expo Go or EAS).
  - Android 15/16 keyboard handling, app context and render-error capture on a device.
- **Not captured:** native crashes, WebSocket, requests made by native SDKs.

Full list: [README › Not yet verified](../README.md#not-yet-verified).

## Feedback

Questions, bugs and what you saw in your app: `<feedback-link>`. Your React Native or Expo version,
platform and connector help most. Security issues: not in public, see [SECURITY.md](../SECURITY.md).
