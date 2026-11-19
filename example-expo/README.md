# Expo example

A minimal Expo app for trying `react-native-shake-devtools` in **Expo Go**, a development build and
a release build. It loads the library's `../src` through Metro (no build step) on the `./plain`
entry, and wires the bug report with Expo modules, as [the Expo recipe](../docs/recipes/expo.md)
(Vietnamese) describes.

| | |
|---|---|
| Expo SDK | **58** (`expo` 58.0.26), created with `create-expo-app` 5.0.0, template `blank-typescript@sdk-58` |
| React Native · React | 0.88.1 · 19.3.0 |
| Native modules | `react-native-reanimated` 4.7.1 + `react-native-worklets` 0.13.0, `react-native-safe-area-context` 5.11.1, `react-native-view-shot` 6.1.1, `expo-secure-store`, `expo-file-system`, `expo-sharing` |
| Node | `^22.13.0 \|\| ^24.3.0 \|\| >=26` (Expo 58's `engines`; Node 20 is not enough here) |

**Status (2026-11-19): not verified on device.** Checked on Windows without a phone, after the app
context row and the render-crash, 401 and Coupon code scenarios were added: `tsc`,
`npx expo export --dev` for Android and iOS, the no-op swap (`npm run check:noop`, which also exports
production bundles for both), and `npx expo-doctor` (1.21.8: 20/20 checks passed). On 2026-11-18,
before those additions, `npx expo start` served the Expo Go manifest
(`runtimeVersion: exposdk:58.0.0`) and the Android dev bundle, fetched with `curl`. Everything under
[On the phone](#4-on-the-phone) is what to look at, not what has been seen.

## Setup

```bash
cd example-expo
npm ci
```

The repo root's `node_modules` is not needed to run the app (Metro blocks it on purpose, see
[How the app loads the library](#how-the-app-loads-the-library)).

## 1. Expo Go

1. Install Expo Go on the phone. It must run SDK 58: Expo Go from the stores only runs the latest
   SDK, which is 58 at the time of writing.
2. On the computer: `npm start` (`npx expo start`). Phone and computer on the same Wi-Fi.
3. Scan the QR code: Android with Expo Go's scanner, iOS with the Camera app. If the LAN does not
   work, `npx expo start --tunnel`.
4. In Expo Go a shake opens **Expo Go's** menu, not the panel (the JS comes from Metro, so the gate
   leaves the shake alone). Open the panel with **Open debug tools** on the screen.

## 2. Development build (debug, JS from Metro)

Needs the Android SDK, or Xcode on a Mac. `expo-dev-client` is not installed, so this is a plain
debug build and `npx expo start` keeps targeting Expo Go.

```bash
npx expo run:android               # USB device with debugging on, or an emulator
npx expo run:ios --device          # real iPhone; pick a signing team in Xcode the first time
```

This generates `android/` and `ios/` (ignored by git; delete them to start again). A shake opens
React Native's dev menu; the panel may also be listed there as **Debug tools**. The button works in
every build.

## 3. Release build: shake, then the no-op swap

```bash
npx expo run:android --variant release
npx expo run:ios --configuration Release --device
```

The JS is embedded, so a firm shake opens the panel directly. The Android release build is signed
with the debug keystore of Expo's native template (`expo-template-bare-minimum` 58.0.35), so it
installs straight away.

**No-op build** (what a production build ships): the Metro resolver in `metro.config.js` swaps every
import of the library for its no-op entry when `DEVTOOLS_NOOP=1`.

```bash
# bash
DEVTOOLS_NOOP=1 npx expo run:android --variant release --no-build-cache
```

```powershell
# PowerShell
$env:DEVTOOLS_NOOP = '1'; npx expo run:android --variant release --no-build-cache; Remove-Item Env:DEVTOOLS_NOOP
```

Expected: the line **Devtools are off in this bundle** under the button, the button disabled, a
shake does nothing, and the demo buttons still work (requests go out, nothing is captured). Build
again without the variable to get the panel back.

Gradle does not count `DEVTOOLS_NOOP`, nor files outside `example-expo/` such as `../src`, as
inputs of the JS bundle task (same as the bare `example/`; README › "Keeping it out of
production"). After changing either, build with `--no-build-cache`, or the APK can keep the old JS.

**Static check, no device:** `npm run check:noop` (about 1.5 minutes). It runs `expo export` for
Android and iOS with `DEVTOOLS_NOOP=1` and checks that the only library files in the source map
are `src/noop/*` and the two string tables, and that three strings only the real code has
(`devtools-panel-dismiss`, `devtools.connections.v1`, `X-Shake-Devtools`) are absent. A control
export without the variable must contain them. Output on 2026-11-19: 8 library files with the
swap, 110 without, on both platforms.

## 4. On the phone

Open the panel with **Open debug tools** (or a shake in a release build), then **Logs**. The row
**Render crash, no boundary** and the rows from **App context** to **Typed text** repeat checks of
the bare `example/` (its README › "Thử gì trên máy thật"), here on React Native 0.88 and the
`./plain` entry.

| Check | Do | Expected |
|---|---|---|
| `expo/fetch` is the global `fetch` | look at the first line of the screen | `Global fetch: expo/fetch (Expo built-in marker present)` |
| `expo/fetch` rows | **GET with fetch (expo/fetch)** | one row `GET …/todos/1`, status 200, a duration; its detail shows the JSON body. The result line at the bottom says the app read the whole body (the tap reads a clone) |
| XHR rows | **GET with XMLHttpRequest** | one row `GET …/posts/1`, 200. One row per request, never two |
| Failures | **Failing request (HTTP 500)**, **Network error** | a red 500 row; a network error row with no status |
| Redaction | **POST with secrets**, open the row | Headers and Request show `<redacted>` for `Authorization` and `password`; only **Copy cURL** keeps the raw values |
| Console | **console.warn + console.error** | a WARN and an ERROR row; the error badge counts the error |
| Unhandled rejection | tap it, wait 3 s | one `UNCAUGHT` row `Uncaught (in promise, id: N): Error: Expo example unhandled rejection` with a stack; the app keeps running |
| Render error inside a boundary | **Throw during render (error boundary)** | the boundary text appears on the screen, and the log gets an ERROR row with `Expo example render error`. React Native logs caught render errors through `console.error` (RN 0.88 source), so this is not an `UNCAUGHT` row and not a crash. In Expo Go and debug builds LogBox may show it as well |
| Render crash, no boundary | release build ([section 3](#3-release-build-shake-then-the-no-op-swap)) › section Crash › **Throw during render** | the app closes. Reopen it and open the panel: the banner **The app crashed last time**, and **Previous session** holds **one** `FATAL` row `Error: Expo example uncaught render error` with a stack (not a plain `ERROR` row without a stack, not two rows). On React Native 0.81+ this error skips `ErrorUtils` (`onUncaughtError` → `ExceptionsManager.handleException(error, true)`), and the library wraps that call; jest covers it, a device has not. In Expo Go and debug builds LogBox shows the error full screen instead of closing the app, so use a release build for this check |
| Screenshot | open the panel | the **Report a bug** row says `Screenshot taken`; the form shows the app screen without the panel. **Retake** works |
| App context | panel › row **App context (example)**, pick **Normal** › **Report a bug** | the form has an **App context** chip. The ticket has an App context section: `auth` shows `"refreshToken":"<redacted>","accessToken":"<redacted>"` (the access token is base64 ending in `=`), `customerRef: <redacted>` (masked only through `redactKeys: ['customerRef']` in `capture.ts`), `lastAuthHeader: Bearer <redacted>`; `tokenExpiresAt` stays readable. The log has **one** `[expo-example] appContext called (mode: normal)` row per draft, none on the shake or on send |
| Large app context | pick **Large**, tap **Discard draft** if a draft is open › **Report a bug** | the form opens without a stall. `context.json` has the truncation marks `…+493 more`, `"…": "+218 more"`, `[Object]`, `[Circular]`, `…+3820` (counts from the library's serializer under jest, same data as `example/`), `userId` is still there; the App context section ends with `…and 7 more keys` |
| Broken app context | pick **Throws** or **Never resolves**, discard the old draft › **Report a bug** | the chip reads **App context unavailable** (Never resolves: after about 1.5 s). The form and **Send** still work |
| Failed request with secrets | **POST with secrets → 401** › panel › **Copy for AI** › paste into a notes app | the Markdown has `POST` `…/status/401`; `access_token`, `Authorization`, `refreshToken` (base64 with `=`) and `password` are all `<redacted>`; no `fake-` text anywhere, no cURL command |
| Typed text | type `typed-secret-123` into the **Coupon code** field › **Report a bug**, and **Copy for AI** | the step reads `Type in the "Coupon code" field`. The typed string is not in the form, the ticket, the attached files or the Copy for AI block |
| Secure store | **Report a bug** › add a connection › **Webhook**, type an HTTPS URL (and an optional header), **Test connection**, save. Close the app completely and reopen it | the connection is still there (stored with `expo-secure-store`) |
| Send to webhook | **Send to …** | the server gets one `multipart/form-data` POST: a `report` JSON part plus the screenshot, `errors.txt` and `timeline.json`, with the header `X-Shake-Devtools: internal`. That request does not appear in the log |
| Share | **Share** on the form (or on a failed report in the send queue) | share sheets open one after another: `bug-report.txt`, the screenshot, `errors.txt`, `timeline.json` (`expo-sharing` takes one file per call). On Android the sheets may stack |
| Export | **Logs** › **Export errors** | the share sheet opens with a `devtools-errors-….txt` file |
| Persisted `LogStore` | after a few rows, reload (Expo Go menu › Reload) or close and reopen the app | the panel has a **Previous session** row with the earlier rows (files in the app cache, `expo-file-system`) |
| Send queue survives a restart | airplane mode, **Send to …**, close the app, reopen it with the network back | the report is still in the queue and is sent again (queue stored through the same `LogStore`) |

Webhook endpoint: any HTTPS endpoint you can watch, for example your own server or a request
inspector such as webhook.site (a third-party service: it receives this demo app's screenshot and
logs). Use `https`: a release build on Android refuses plain `http` (README › "Webhook to `http://`
on an Android release build").

## Expo Go and the native modules (SDK 58)

Versions come from `node_modules/expo/bundledNativeModules.json` of `expo` 58.0.26, and
`npx expo install` pinned exactly these. The "In Expo Go" column relies on Expo's documentation
(each library's page marks Expo Go support), as known when this was written; it was not re-checked
online, and nothing has run in Expo Go: **expected, not verified on device**.

| Native module | Used for | SDK 58 version | In Expo Go |
|---|---|---|---|
| `expo` (modules core, `expo/fetch`, file system, constants…) | runtime, global `fetch` | 58.0.26 | yes (expected) |
| `react-native-reanimated` + `react-native-worklets` | shake sensor of the gate | 4.7.1 + 0.13.0, exact | yes (expected); the JS version must equal Expo Go's native one, which `npx expo install` ensures |
| `react-native-safe-area-context` | sheet insets | ~5.11.1 | yes (expected) |
| `react-native-view-shot` | `captureScreen` | 6.1.1 | yes (expected) |
| `expo-secure-store` | `secureStore` | ~58.0.3 | yes (expected) |
| `expo-file-system` | `LogStore`, `writeTempFile` | ~58.0.14 | yes (expected) |
| `expo-sharing` | `exportFile`, `shareFiles` | ~58.0.23 | yes (expected) |
| `expo-status-bar` | status bar | ~58.0.5 | yes (expected) |

Not used, on purpose: `@gorhom/bottom-sheet` and `react-native-gesture-handler` (the `./plain`
entry needs neither), and `react-native-share`, `react-native-keychain`, `react-native-blob-util`
(the bare `example/` uses them; they are not in Expo Go).

## How the app loads the library

| File | What it does |
|---|---|
| `metro.config.js` | Expo's default config, plus: watch the repo root; block the root `node_modules` (the library's dev copies of React and React Native, so the bundle has **one** React), `example/` and the root dot-folders; look up packages only in `example-expo/node_modules`; map `react-native-shake-devtools` to the repo root (Metro reads its `exports`). Then the no-op resolver, on with `DEVTOOLS_NOOP=1` |
| Babel | no `babel.config.js`: `babel-preset-expo` adds `react-native-worklets/plugin` when it is installed, and Metro uses it for `../src` too, so the shake worklet is compiled (the exported bundle has `__workletHash` in `src/shake/`) |
| `tsconfig.json` | `paths` for the two entries the app imports (`/plain`, `/capture`) to `../src`, and pins `react`, `react-native`, reanimated and safe-area types to this app's copies (otherwise `../src` would see the root's). `lib` is Expo's default (`DOM`, `ESNext`); the library's source type-checks with and without `DOM` |
| `index.ts` | imports `src/devtools/capture` **before** `expo` and `App`. Expo's Metro config runs `expo/build/winter` (which installs `expo/fetch` as the global `fetch`) before `index.ts`; the exported dev bundle starts with `setup-env.js` → `expo/build/winter/index.js` → `index.ts`, so `startCapture` sees `expo/fetch` |
| `src/devtools/` | `devtools-env.ts` (the `enabled` switch, `true` here), `capture.ts` (`startCapture` with a persisted `LogStore`, and `redactKeys: ['customerRef']`), `devtools-config.ts` (panel config and the `bugReport` block, built per app context mode), `app-context.ts` (`bugReport.appContext`: fake data and the four modes, copied from `example/`, no native module), `use-example-actions.ts` (the panel rows **App context (example)** and **Clear saved sessions**), and one adapter per Expo module |
| `src/HomeScreen.tsx`, `src/scenarios.ts` | the demo buttons: fetch, XHR, 500, network error, POST with secrets (200 and 401), console, unhandled rejection, a render error inside and outside an error boundary, and the **Coupon code** field |

## Not verified

Everything on a device, in Expo Go, a development build or a release build: the table in section 4,
whether Expo Go's menu lists the panel (the gate registers it with `DevSettings.addMenuItem`),
`--no-build-cache` making Gradle bundle the JS again after `DEVTOOLS_NOOP` changes, and
EAS builds (no `eas.json` here).
