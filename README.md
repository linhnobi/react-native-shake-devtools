**English** · [Tiếng Việt](README.vi.md)

# react-native-shake-devtools

**QA bug reporting from test builds — straight to Jira / Slack / Lark, open source, no backend.**
It is also an in-app devtools panel for React Native: console, HTTP and error logs, the previous
session after a crash, and device info, one shake away.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<!-- TODO: 20–30 s video: shake → prefilled form → send → Jira ticket -->

> **Status: pre-release (`0.0.1`), not published to npm yet.** Bug reporting has run end to end on
> one Android device through a **Webhook** connection
> ([Measured on a device](#measured-on-a-device-bug-reporting-android)), but no report has been
> sent to a real Jira, Slack or Lark workspace yet (waiting for test accounts); those three
> connectors are covered by jest with a mocked `fetch`. The devtools panel and log capture are
> device-tested on Android as listed under [Compatibility](#compatibility); iOS is mostly untested.
> See [Not yet verified](#not-yet-verified).

**A developer whose QA sent this?** Start with the one-page [docs/for-developers.md](docs/for-developers.md).

## Contents

- [Why](#why)
- [Install and quickstart](#install-and-quickstart)
- [Features](#features)
- [Comparison](#comparison)
- [Compatibility](#compatibility)
- [Configuration reference](#configuration-reference)
- [Security and privacy](#security-and-privacy)
- [Measured on a device: bug reporting (Android)](#measured-on-a-device-bug-reporting-android)
- [Not yet verified](#not-yet-verified)
- [Contributing](#contributing)
- [License](#license)

## Why

A QA tester holds a test build with the JavaScript bundled in: no Metro, no computer next to them.
When something breaks, they take a screenshot, try to remember what they tapped, and type a ticket
by hand. The developer then asks back: which build, which device, which user, what did you tap
before that, which request failed?

The library already collects most of what a good ticket needs: console, HTTP and error logs, screen
changes, device info, and the previous session if the app crashed. Bug reporting closes the loop:

1. QA shakes the phone. A screenshot is taken before the panel covers the screen.
2. A report opens prefilled: a title from the latest error (e.g. `[Checkout] POST /orders → 500`),
   automatically recorded steps, the error log and device info.
3. QA edits what they want and taps **Send to …**. The ticket is created in the team's own Jira, Slack,
   Lark/Feishu or webhook, sent directly from the device with a connection QA set up on the device.
   There is no server of ours in between.

Desktop tools such as Reactotron and Rozenite need a computer or a dev build. This library runs on
the build QA already has.

## Install and quickstart

Bare React Native ≥ 0.76. **Expo support is in progress**: `startCapture` also records
`expo/fetch`, the global `fetch` in Expo SDK 56+, but nothing has run in an Expo app yet. See
[docs/install.md](docs/install.md) for the current install guide, and the
[Expo recipe](docs/recipes/expo.md) (Vietnamese) for a dev build, the capture entry file, bug-report
adapters built on Expo modules and the Metro resolver. The [Expo example app](example-expo/README.md)
(SDK 58) follows that recipe for Expo Go, a dev build and a no-op release; it type-checks and bundles,
but has not run on a device yet.

> The package is not on npm yet. The commands below are what installation will look like once it
> is published. To try it today, run the [example app](example/README.md) (README in Vietnamese).

### 1. Install the package and its peers

There are two UI entries with the same API. Pick one:

```sh
# react-native-shake-devtools/plain: sheet built with React Native core
npm install react-native-shake-devtools react-native-reanimated react-native-worklets \
  react-native-safe-area-context

# react-native-shake-devtools: sheet built on @gorhom/bottom-sheet
npm install react-native-shake-devtools react-native-reanimated react-native-worklets \
  react-native-safe-area-context react-native-gesture-handler @gorhom/bottom-sheet
```

`react-native-worklets` is required by Reanimated 4; leave it out if you stay on Reanimated 3.16.
Set up Reanimated as its own docs describe, Babel plugin included: the shake detector runs as a
worklet. The library has no native code of its own; its peers do, so rebuild the app after
installing them.

### 2. Start capturing before the app renders

```ts
// src/devtools/devtools-config.ts: one rule for capture and the panel
export const DEVTOOLS_ENABLED = appEnv !== 'prod'; // appEnv from your native flavor, not __DEV__

// src/devtools/capture.ts
import { startCapture } from 'react-native-shake-devtools/capture';
import { DEVTOOLS_ENABLED } from './devtools-config';

// `enabled` is required: with anything but `true`, nothing is patched and nothing is written.
startCapture({ enabled: DEVTOOLS_ENABLED }); // console, XHR/fetch, uncaught errors, rejections
```

```js
// index.js: import it first, so the earliest requests are captured
import './src/devtools/capture';
import { AppRegistry } from 'react-native';
import App from './src/App';
```

Call it at module scope, not in a `useEffect`: effects run after the first render, and the app's
first requests go out before that.

### 3. Mount `DevToolsGate`

```tsx
// App.tsx (entry ./plain)
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DevToolsGate, type DevToolsConfig } from 'react-native-shake-devtools/plain';
import { DEVTOOLS_ENABLED } from './devtools/devtools-config';

const config: DevToolsConfig = {
  enabled: DEVTOOLS_ENABLED, // required, no default
  subtitle: `${appEnv.toUpperCase()} · ${version}`,
};

export default function App() {
  return (
    <SafeAreaProvider>
      <DevToolsGate config={config} actions={[]}>
        <RootNavigator />
      </DevToolsGate>
    </SafeAreaProvider>
  );
}
```

- **Entry `./plain`:** mount the gate at the root, in a view that fills the screen. The sheet is an
  overlay drawn where the gate sits.
- **Entry `.` (gorhom):** the root needs `GestureHandlerRootView` → `SafeAreaProvider` (optional) →
  `BottomSheetModalProvider` → `DevToolsGate`, in that order.
- `actions` are your own panel rows. Build them in a hook and pass already translated labels.
- The `startCapture` guard and `config.enabled` must come from the same rule (here
  `DEVTOOLS_ENABLED`), so capture never runs in a build where the panel is off.
- Do not use `__DEV__` for that rule: test builds bundled with `--dev true` have `__DEV__ === true`
  as well, so it cannot tell UAT from production.

Shake a build that has its JS bundled in to open the panel. In a debug build that loads JS from
Metro, React Native's dev menu keeps the shake and the panel appears as an item inside it. You can
also open the panel from your own UI with `useDevTools().open()`.

Next steps: [enable bug reporting](#bug-reporting), [keep logs across crashes](#logs), and
[keep it out of production](#keeping-it-out-of-production).

## Features

### Logs

- **Console:** `console.log`, `info`, `warn`, `error` and `debug`.
- **HTTP:** the library patches `XMLHttpRequest`, so axios and React Native's `fetch` are both
  captured. Text response bodies of `fetch` are read too. `startCapture` also wraps Expo's native
  global `fetch` (`expo/fetch`, Expo SDK 56+), which does not go through `XMLHttpRequest`; it wraps
  it only when `fetch` carries Expo's `Symbol.for('expo.builtin')` marker and is not the whatwg
  polyfill, so nothing is logged twice. Tested with jest against a fake `expo/fetch` only.
- **Uncaught JS errors:** one `FATAL`/`UNCAUGHT` row with a stack per error (React Native's own
  duplicate `console.error` is not logged a second time). This includes an error thrown while
  rendering with no error boundary: on React Native 0.81+ (React 19) React hands it to React
  Native's `ExceptionsManager` without going through `ErrorUtils`, so the library also wraps that
  call. Errors an error boundary catches stay non-fatal `ERROR` rows. The render-error path is
  covered by jest against React Native's own handler; not yet verified on a device.
  That wrap depends on a React Native internal file, `react-native/Libraries/Core/ExceptionsManager`,
  reached with a `require` inside `try`. The file exists in every React Native version CI runs
  (0.76.9, 0.78.3, 0.83.10, 0.86.3, 0.88.1), and jest checks there that the library wraps the object
  React Native calls. If a later React Native moves or removes it, an app whose Metro config comes
  from `@react-native/metro-config` or `expo/metro-config` still bundles, because both set
  `transformer.allowOptionalDependencies: true`, and nothing throws at runtime. Only this path is
  lost: a render error with no boundary is logged as one `ERROR` row without a stack, and the
  session is not written at the crash. Other uncaught errors are unaffected. A hand-written Metro
  config without that option (Metro's own default before 0.87) fails the bundle with "Unable to
  resolve module" instead. Read from the Metro and Expo sources; not checked on a device.
- **Unhandled promise rejections** (Hermes only): one `UNCAUGHT` row with a stack, in release
  builds too, where React Native does not track them at all. A late `catch` adds a `warn` row with
  the same id.
- **Screen markers:** `markScreen(route)` from your `NavigationContainer`'s `onStateChange`, and a
  ⚑ button (`markUser()`). Every row is also stamped with the current screen.
- **Filter and search:** errors only, hide errors, slow (≥ 3 s); search with `status:404`,
  `status:5xx`, `status:err`, `method:post`, `screen:user`. Free text also matches request and
  response bodies, up to the first `bodyLimit` characters kept in the log (4,000 by default). The
  search reads the raw body only to decide which rows match; the rows themselves are still
  shown masked. You can pause the list while capture keeps running.
- **Request detail:** Overview · Headers · Request · Response · cURL. Secret headers and listed
  JSON keys are masked on screen ([what is masked](#security-and-privacy)); only **Copy cURL** uses
  the raw request, so the command actually runs.
- **Export errors** as a masked text file (through your `exportFile`, or `Share` as text), and
  **copy device info**.
- **Copy for AI:** one tap copies a masked Markdown bundle to paste into a coding agent (Claude Code,
  Cursor, Copilot): a one-line instruction for the agent, app/device/session info, uncaught errors
  and unhandled rejections with stacks, recent steps (screens, taps, requests, errors), failed
  (≥ 400 or network error) and slow requests with method, URL, status, duration, headers and cut
  bodies, and recent console errors and warnings. It is capped at 40,000 characters, keeping the most
  severe and most recent items and saying what was left out. Find it in the panel as the **Copy for
  AI** row under **Logs** (running session), and in the footer of the **Previous session** log
  (after a crash). It goes to the clipboard (`Share` if the clipboard is unavailable). Build it
  yourself with `formatAiContext(entries, options)` from `react-native-shake-devtools/capture`.
- **Previous session across crashes:** with `startCapture({ persist })` and a `LogStore` from the
  app, every error plus the last 50 rows (masked, ≤ 1 MB per session) is written to disk every
  2 s, and immediately on a fatal JS error (render errors with no boundary included), before React
  Native's handler runs. Files older than
  72 h and sessions beyond 3 are deleted at startup; `clearPersistedLogs()` on logout. Native
  crashes are not covered.

What is not captured: `expo/fetch` imported and called directly (`import { fetch } from
'expo/fetch'`), a global `fetch` that another SDK wrapped before `startCapture`, WebSocket, requests
made by native SDKs, `<Image>` loads, requests sent before `startCapture`, non-string request bodies
(FormData, Blob, ArrayBuffer), binary or > 1 MB response bodies, and `text/event-stream` bodies on
`expo/fetch`. On `expo/fetch`, a body that is not read (binary, > 1 MB, `text/event-stream`,
HEAD/204) keeps the time to headers as its duration (the "slow" chip can miss it), and a failure in
the middle of such a body is not seen. `AbortSignal.timeout(ms)` is logged as `timeout` on
`expo/fetch` but as `abort` with React Native's `fetch` (whatwg-fetch only calls `xhr.abort()`).
With `expo` < 56.0.8, an app that clones a response a second time hits Expo's `bodyUsed` bug
(expo/expo#46397). Details:
[HTTP: what is not captured](README.vi.md#http-cái-gì-không-bắt-được) and
[retention](README.vi.md#nhật-ký-giữ-được-bao-lâu) (Vietnamese).

Already using Sentry? Pass `startCapture({ rejections: false })`. Hermes keeps a single rejection
tracker, and whoever registers last wins.

### Bug reporting

Optional: without `DevToolsConfig.bugReport`, nothing is mounted or recorded and the panel has no
**Report a bug** row. Every native capability comes from your app; the library adds no native
module and no new peer dependency.

- **Screenshot at shake**, taken by your `captureScreen` before the panel covers the screen. Return
  `null` to block a screen; a throw or a call longer than 1.5 s shows "Screenshot failed" on the
  panel row ("Could not take a screenshot" on the form) and the panel still opens. **Retake** is on
  the form.
- **Steps recorded automatically:** taps (moving ≤ 10 dp counts as a tap, holding ≥ 500 ms as a
  long press), text fields tapped (never their value), screen changes, Android Back, app
  background/foreground, errors. Labels come from the touched element's React fiber; runs of 6 or
  more digits (spaces, dots or hyphens allowed in between, e.g. `0912-345-678`,
  `4111-1111-1111-1111`) and email addresses are masked down to their last 3 characters. Text
  inside a text field (including a mention field that renders the typed value as child text) never
  becomes a label. Set `recordVisibleText: false` to skip visible text. 100 actions are buffered,
  the form shows up to 30, and the last 30 are saved with the session when the app crashes.
- **Prefilled form:** title and "Actual" from the latest error, editable steps (▲▼ to reorder,
  delete, add), "Expected", and attachment chips: Screenshot · Error log · Device info · App
  context (when you provide `appContext`) · Previous session (after a crash). Drafts are saved
  automatically, so closing the sheet and shaking again brings the same draft back.
- **App context from your app:** `bugReport.appContext` returns what only your app knows (user id,
  build and environment, feature flags, a Redux or Zustand slice, `Sentry.lastEventId()`), sync or
  async. It is called once, when QA opens the form (not on shake). A throw, a rejection, more than
  1.5 s or a non-object never blocks the form; the chip then reads "App context unavailable". The
  value is serialised safely (cycles, functions, BigInt, `Date`, `Error`, `Map`/`Set`) with caps that
  leave visible markers (`[Object]`, `…+N more`): depth 8, 200 keys, 100 items, 2000 characters per
  string, 32,000 characters in all. It is redacted like request bodies, `redactKeys` included. The
  ticket gets a short **App context** section (one line per top-level key, up to 10) and, where the
  connection carries files, a `context.json` attachment; the Webhook gets `appContext` in its
  `report` part plus a `context.json` part. A report about the previous **crashed** session never
  calls it, because the state after a restart is not the state at the crash. Recipes for Redux,
  Zustand, feature flags and Sentry: [docs/recipes/bug-report-context.md](docs/recipes/bug-report-context.md).
- **After sending:** e.g. `Created DEMO-482` with Open / Copy link / Report another bug. A new ⚑ marker
  is set, so the next report only contains later actions.
- **Send queue page:** a report handed to the queue does not disappear when the result screen
  closes. The **Report a bug** row's subtitle adds `· N waiting · M need attention`, and the form
  shows a banner (in the warning colour when a report failed, is blocked or may not have been sent)
  that opens the **Send queue** page. Each report shows why it failed, with **Send again** (failed,
  not sure it was sent, or blocked once the connection is fixed), **Share** and **Discard report**
  (tap twice; not offered while sending). A `blocked` report that belongs to the draft being edited
  is not counted, because the form already says so.
- **Ticket language per connection** (vi/en): section headings and device-info labels (`App`,
  `OS`, …) follow the connection, except the Webhook's `deviceInfo` JSON, which keeps the original
  English labels so a server can read it; steps QA rewrote are sent as typed. `errors.txt` and `timeline.json` are always in
  neutral English. `timeline.json` has method, path (no query string), status and duration, and no
  request or response bodies.

**Four built-in connectors.** QA creates connections on the device: pick a type, fill in the
fields, **Test connection**, save. Several connections can be stored; the last one used is
remembered.

| Connector | Level | QA enters | Sends | Needs from your admin |
|---|---|---|---|---|
| Jira Cloud | – | site URL, email, API token | issue (description in ADF), then attachments | an API token for an account with Browse, Create issues and Create attachments. Tokens expire after at most 365 days, so a 401 is common and reported as such. Atlassian Guard can block API tokens |
| Slack | light | incoming webhook URL | Block Kit message, **no image or files** | an incoming webhook for one channel |
| Slack | full | bot token `xoxb-` + channel | one message with image and files (`files.getUploadURLExternal` → `completeUploadExternal`) | a Slack app with `files:write` + `chat:write` (the workspace may require Owner approval); the bot invited to the channel |
| Lark / Feishu | light | Lark or Feishu, group bot webhook (+ signing secret if enabled) | `interactive` card, **no image or files**, body ≤ 20 KB (trimmed to fit) | a custom bot added to the group |
| Lark / Feishu | full | domain, App ID + App Secret, chat ID | card with image and files (`im/v1/images`, `im/v1/files`, `im/v1/messages`) | a self-built app approved by the tenant admin (`im:resource` + one send-message scope), bot in the group; every scope change needs re-approval |
| Webhook | – | URL + one optional header (its value is a secret) | `multipart/form-data`: a `report` JSON part + the files | a server that returns 2xx; returning JSON `{ url?, key? }` shows a link. Also the relay path if you want tokens kept server-side |

The light levels of Slack and Lark cannot carry images or files; that is a platform limit, not a
library one. After a light send, the success screen offers **Share screenshot and logs** so QA can add
them to the thread.

**Webhook to `http://` on an Android release build** (measured on 2026-11-07, SM-M346B, release
build of `example/`). Android 9+ blocks cleartext HTTP by default, and React Native sets
`usesCleartextTraffic=false` for release builds. A request to `http://…` (an internal relay,
`http://localhost` through `adb reverse`) is refused by the OS before it leaves the device, so the
library only sees a `network` error: the server receives nothing, the screen says "Queued", and
after 5 attempts (about 7.5 minutes) the report ends as "Sending failed · Network request failed".
**Test connection** for a webhook makes no request, so it still succeeds; QA only finds out when
sending. Debug builds allow cleartext, so this does not show up during development. The fix
belongs to the **app**: use `https`, or declare a `network_security_config` that allows cleartext
to **that host only** (measured: allowing `localhost` makes the send work, and **Send again** on the
failed report in the queue delivers it).

Your own connectors: `defineConnector({ id, label, fields, secretFieldIds, capabilities, test,
send })` passed through `bugReport.connectorTypes`, throwing `ConnectorError(kind, message)` with
`kind` one of `auth`, `permission`, `validation`, `network`, `uncertain`, `rate-limit`, `unknown`.
`send` receives the `BugReport`: the app context, when attached, is `report.appContext`
(`{ lines, more }`, already redacted) plus `context.json` in `report.files`.
Two rules keep a resend from creating a duplicate ticket:

- Call `ctx.checkpoint({ …, committed: true })` exactly when the irreversible step has finished
  (the ticket or message now exists at the destination, e.g. right after creating the issue), not
  earlier. Checkpoint earlier progress (files already uploaded, …) without `committed`. The queue
  retries an `uncertain` failure automatically only once `committed: true` is set (the next attempt
  receives `ctx.resume` and only finishes the rest); without it, QA checks the destination and
  resends by hand.
- When catching errors, branch on `error.kind` or `error.name === 'ConnectorError'`, not on
  `instanceof ConnectorError`: the no-op entry has its own `ConnectorError` class, so `instanceof`
  can be wrong across entries.

**Offline queue and retries:**

- Automatic retry only when the request certainly never reached the server (`network`: offline,
  DNS failure, connection refused): when the app returns to the foreground, when the panel opens,
  and every 60 s, up to 5 attempts, then "Sending failed" with a Share option.
- A timeout after sending (`uncertain`) is not retried automatically: the screen says "Not sure it
  was sent. Check Jira before sending again" and offers a manual resend. The exception is a send whose ticket or
  message already exists at the destination (the connector checkpointed it as `committed`, see
  above): it is retried like `network`, and the resend only adds the missing parts. Jira and Slack
  have no idempotency key; Lark uses `report.id` as `uuid`.
- `auth`, `permission`, `validation`: not retried automatically. The report stays in the queue as
  blocked, the draft is kept and QA is sent to the field to fix; **Send again** once it is fixed.
- Tapping Send twice, or shaking again while sending, creates one ticket (the queue dedupes by
  `report.id`).
- The queue is persisted through the app's `LogStore` when `persist` is on, otherwise it lives in
  memory and the screen says it will be lost if the app is killed. The queue file
  (`report-queue.json`) holds only reports and metadata, never secrets.
  - The gate takes the `LogStore` **once**, when it builds the queue (when the gate mounts): call
    `startCapture({ persist })` **before** the gate mounts. Called later, the queue stays in memory
    for that whole run.
  - Queue **reads** from the store (`list`/`read`) are capped at **5 s**, like session writes. If a
    read hangs, the queue stops reading and writing the store for the rest of that run and keeps
    working in memory: the screen says reports will be lost if the app is closed, and the Send
    button does not get stuck on "Preparing…". **Writes** are never abandoned halfway: a slow write only makes the
    next one late, and the file always catches up with the latest state (an old `pending` copy left
    on disk would be sent again at the next launch, creating a duplicate ticket). Only how long a
    send waits for the store is capped at 5 s.

Full detail: [Báo bug](README.vi.md#báo-bug) (Vietnamese).

### UI

- **Two entries, same API:** `react-native-shake-devtools` (sheet on `@gorhom/bottom-sheet`) and
  `react-native-shake-devtools/plain` (sheet built with React Native core, no gorhom and no
  gesture-handler). On `./plain`, copying a log row is long-press only, drag-to-close works from
  the handle and header, and on Android the sheet jumps above the keyboard once it has opened
  instead of animating. [Comparison](README.vi.md#entry-plain-không-cần-gorhom) (Vietnamese).
- **vi/en UI** built in (`locale`, default `'en'`); override any string with `strings`.
- **Dark mode:** follows the system, or forced with `colorScheme`. While a sheet is open the status
  bar style is pushed onto React Native's `StatusBar` stack and removed on close. The Android
  navigation bar keeps the system colour.
- **Android Back** steps back one level, like the header button: request detail → log list →
  closed. On the panel, Back closes it. Once the sheet is closed, Back goes to the app.
- No `<Modal>`: sheets render in the app's window, so `FLAG_SECURE` covers them too.

### Keeping it out of production

1. `enabled` is required and has no default. It is not derived from `__DEV__`.
2. Your app's tests lock `'prod' ⇒ enabled: false`, because the rule belongs to the app.
3. Optional: a Metro resolver swaps every import of the library for an empty no-op entry with the
   same exports, so the production bundle carries almost none of it.

```js
// metro.config.js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { devtoolsNoopResolver } = require('react-native-shake-devtools/metro');

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  resolver: {
    resolveRequest: devtoolsNoopResolver({
      enabled: process.env.DEVTOOLS_NOOP === '1', // your rule; the library reads no env vars
      // resolveRequest: your existing resolver, if any
    }),
  },
});
```

- Your code keeps a single `import … from 'react-native-shake-devtools'` for every flavor.
- With the swap on, importing any other path of the package (e.g. `…/src/…`) stops the bundle with
  an error instead of silently shipping real code.
- `import type` is unaffected. Metro must read `package.json#exports`
  (`unstable_enablePackageExports`, on by default since RN 0.79).
- No-op behaviour: `DevToolsGate` renders its `children`, `useDevTools()` returns
  `{ enabled: false, isOpen: false, open: () => {} }`, capture functions patch nothing, redaction
  functions drop everything the real ones would mask. Apart from the no-op files themselves, only
  the two string tables (`i18n/vi.ts`, `i18n/en.ts`, ≈ 6 KB) are bundled.
- Measured on 2026-11-06 with `example/` (`react-native bundle --platform android --dev false`,
  Metro 0.84.6): 7 library files left in the sourcemap instead of 58, about 390 KB less
  unminified. A noop release build ran on a Samsung SM-M346B without crashing.
- ⚠️ Gradle does not treat `DEVTOOLS_NOOP` as an input of `createBundle<Variant>JsAndAssets`.
  Rebuilding the same variant with a different value can reuse the old bundle (`UP-TO-DATE`); use
  `--rerun-tasks` when you switch. Per-flavor setup on Android and iOS:
  [Ba lớp chặn prod](README.vi.md#ba-lớp-chặn-prod) (Vietnamese).

### Entries

| Entry | Contains | Pulls in |
|---|---|---|
| `react-native-shake-devtools/shake` | shake detection, headless | `react-native-reanimated` |
| `react-native-shake-devtools/capture` | console, HTTP and global error capture, persistence, formatting; plain JS | nothing |
| `react-native-shake-devtools/i18n` | `devtoolsStrings = { vi, en }` and the string types | nothing |
| `react-native-shake-devtools` | + panel, log screen, gate, theme, bug reporting | + `@gorhom/bottom-sheet`, `react-native-gesture-handler`, `react-native-safe-area-context` |
| `react-native-shake-devtools/plain` | same API as `.`, sheet built with React Native core | + `react-native-safe-area-context` |

Both UI entries also need `react-native-reanimated` (the gate's shake sensor). Each entry has a
no-op twin (`…/noop`, `…/noop/capture`, `…/noop/shake`, `…/noop/i18n`, `…/noop/plain`) for the
Metro resolver; `react-native-shake-devtools/metro` runs in Node for `metro.config.js`. Apps do not
import the no-op paths directly.

## Comparison

Facts below come from each project's public README, pricing page and npm data, checked
2026-11-06. Buoy was checked again on 2026-11-09, against its
[pricing](https://buoy.gg/pricing) and [Bug Links](https://buoy.gg/buoy/latest/docs/tools/bug-links)
pages. Prices are as of 2026-11.

| | **react-native-shake-devtools** | react-native-network-logger | Reactotron / Rozenite | Buoy | Instabug (now Luciq) / Shake |
|---|---|---|---|---|---|
| License | MIT | MIT | MIT | proprietary | Shake: MIT SDK, SaaS service · Luciq: SaaS (SDK license not checked) |
| Where it runs | in the app | in the app | desktop (Reactotron app, React Native DevTools plugins) | in the app | SDK in the app, reports in their SaaS |
| QA on a test or release build, no Metro or computer | yes, built for this | yes, behind your own flag | no: needs a desktop connection or a dev build | paid plans only (free tier runs on dev builds) | yes |
| Bug ticket straight to your Jira / Slack / Lark, no server in between | yes (+ webhook)¹ | no | no | no: Bug Links (Solo and Business plans) gives a link to paste into Slack or your tracker | through their SaaS; integrations depend on the plan |
| Auto-recorded repro steps | yes | no | no | in Bug Links (paid plans), with app state and masked screenshots | yes |
| Console, network (secrets masked), crashes, previous session | yes | network only | yes, on the desktop | yes | yes |
| Removal from production | `enabled` + no-op entries + Metro resolver | up to you | off in production | free tier does not run in production | n/a |
| Price | free | free | free | free (dev builds only) · Solo $30/month · Business $60/seat/month | Shake: free for 20 bugs/month, Starter $160/month · Luciq: enterprise pricing |

¹ Implemented and covered by tests with a mocked `fetch`; not yet sent to a real workspace (see
[Not yet verified](#not-yet-verified)).

Reactotron and Rozenite complement this library rather than replace it: they serve the developer
at the desk, this serves QA holding the phone.

## Compatibility

Checked on 2026-11-06 on Windows **with jest and tsc only**: no native build, no device. CI
([`.github/workflows/check.yml`](.github/workflows/check.yml), Linux) re-runs every ✅ row on each
pull request, each push to `main` and every Monday.

| RN | React | reanimated (+ worklets) | gesture-handler | gorhom | safe-area-context | Node in CI | Result |
|---|---|---|---|---|---|---|---|
| 0.76.9 | 18.3.1 | 3.16.7 | 2.18.1 | 5.0.6 | 4.0.2 | 20 | ✅ lower bound of every peer |
| 0.78.3 | 19.0.0 | 3.16.7 | 2.18.1 | 5.0.6 | 4.0.2 | 20 | ✅ lowest React 19, other peers at their lower bound |
| 0.83.10 | 19.2.0 | 4.3.4 + 0.8.3 | 2.33.1 | 5.1.8 | 5.6.2 | 22 | ✅ |
| **0.86.3** (pinned) | 19.2.3 | 4.5.5 + 0.11.4 | 3.1.0 | 5.2.14 | 5.8.1 | 20.19.4 · 22.13.0 · 24.3.0 · latest LTS | ✅ `npm run check` from the lockfile |
| 0.88.1 | 19.3.0 | 4.7.1 + 0.13.1 | 3.5.0 | 5.2.14 | 5.11.1 | 24 | ✅ latest at the time of the check |

- ✅ on the pinned row means the full `npm run check`. On the other rows it means
  `tsc -p tsconfig.lib.json` (library code only) plus the full jest suite.
- The 0.76 and 0.78 rows push peers to their lower bounds to catch library code that uses newer
  APIs. RN 0.78 + reanimated 3.16 does **not** build natively (reanimated 3.16 supports RN
  0.74–0.77); for native builds, follow each package's own compatibility table.
- React is pinned to the exact renderer version each RN release embeds.
- Peer `react-native-gesture-handler >= 2.18`: the library imports
  `react-native-gesture-handler/ReanimatedSwipeable`, which exists from 2.18.0.
- Node: `^20.19.4 || ^22.13 || >=24.3` (`engines.node`, following RN 0.86).
- Peer ranges: `react >= 18.2`, `react-native >= 0.76`, `react-native-reanimated >= 3.16 || >= 4`;
  `@gorhom/bottom-sheet >= 5`, `react-native-gesture-handler >= 2.18` and
  `react-native-safe-area-context >= 4` are optional peers (see [Entries](#entries)).

| Platform | Status |
|---|---|
| Android | Tested on a Samsung SM-M346B (Android 14), RN 0.86, new architecture: shake threshold, the `./plain` entry (Back, keyboard, long-press, drag to close), `FLAG_SECURE` on both UI entries, the four keyboard-mode combinations, unhandled rejections in a release build, the no-op release build. Bug reporting end to end through a Webhook connection, on both UI entries (2026-11-07, [Measured on a device](#measured-on-a-device-bug-reporting-android)); Jira, Slack and Lark not sent to yet |
| iOS | Shake threshold measured on an iPhone (2026-09-14). Everything else is untested |
| Expo | In progress: `expo/fetch` capture is tested with jest only, and nothing has run in an Expo app. See [docs/install.md](docs/install.md) and the [Expo recipe](docs/recipes/expo.md) (Vietnamese) |

## Configuration reference

### `DevToolsGate` props

| Prop | Type | Notes |
|---|---|---|
| `config` | `DevToolsConfig` | below |
| `actions` | `DevToolsAction[]` | your rows: `id`, `label` and `hint?` (already translated), `onPress?` (absent ⇒ not pressable), `badge?`, `dismissOnPress?` (default `true`), or single-choice chips with `choices?`, `selectedId?`, `onSelect?` |
| `children` | `ReactNode` | the wrapped tree; `useDevTools()` works inside it |

`useDevTools()` returns `{ open, isOpen, enabled }`, and a silent value when there is no gate
above it.

### `DevToolsConfig`

| Field | Type | Default | What it does |
|---|---|---|---|
| `enabled` | `boolean` | **required, no default** | whether devtools run at all; your rule, not `__DEV__` |
| `subtitle` | `string` | – | line under the panel title, e.g. `'UAT · 1.0.2'` |
| `shake` | `Partial<ShakeConfig>` | `threshold` 12 (Android) / 7 (iOS) m/s², `releaseRatio` 0.4, `sustainMs` 400, `cooldownMs` 2000, `baselineAlpha` 0.1 | override shake detection |
| `snoozeMinutes` | `number` | `30` | how long the "Pause shake for N minutes" row mutes shake detection |
| `showLog` | `boolean` | `true` | show the built-in Logs row; set `false` if you never call `startCapture()` |
| `exportFile` | `(file: DevToolsExportFile) => Promise<void>` | `Share.share` with text | write the masked error report (`devtools-errors-YYYYMMDD-HHmmss.txt`) and open your share sheet. Reject ⇒ "Export failed"; resolve if the user just closes the share sheet |
| `sessionInfo` | `() => DevToolsSessionInfo` | – | `appVersion`, `env`, `device`, `os`, `user` (masked by you) for **Copy device info** and export headers; called when needed, a throw is ignored |
| `locale` | `'vi' \| 'en'` | `'en'` | language of the library's own strings |
| `strings` | `DeepPartial<DevToolsStrings>` | – | override or translate strings; keep the reference stable (module constant or `useMemo`) |
| `colorScheme` | `'light' \| 'dark'` | system, light if unknown | force light or dark |
| `androidKeyboardInputMode` | `'adjustPan' \| 'adjustResize'` | `'adjustPan'` | Android: whether your window resizes when the keyboard opens (below) |
| `bugReport` | `DevToolsBugReportConfig` | – | enables bug reporting; absent ⇒ nothing of the feature is mounted |

To use the panel or log screen without `DevToolsGate`, wrap them in
`<DevToolsUiProvider locale strings colorScheme androidKeyboardInputMode>`.

### `DevToolsConfig.bugReport`

| Field | Type | Without it |
|---|---|---|
| `captureScreen` | `() => Promise<DevToolsCapturedImage \| null>` (e.g. `react-native-view-shot`); `null` ⇒ "this screen can't be captured" | no screenshot block on the form |
| `secureStore` | `{ getItem, setItem, removeItem }` backed by Keychain/Keystore (`react-native-keychain`, `expo-secure-store`, …) for connections and secrets | connections can't be saved or used; Share still works |
| `connectorTypes` | `readonly ConnectorType[]` from `defineConnector`; same `id` as a built-in ⇒ yours wins | only the 4 built-in types |
| `shareFiles` | `(files, message) => Promise<void>`: share several files and images through the system share sheet | falls back to `exportFile` (one text file), then `Share` (text); the screen says the image could not be shared |
| `writeTempFile` | `(name, content) => Promise<string>` returning `file://…`, so `errors.txt` and `timeline.json` are uploaded as real files on disk. `name` is **unique per report** (`<reportId>-errors.txt`, only `[A-Za-z0-9._-]`): the queue resends several reports in parallel, and files written to one shared directory never overwrite each other; the destination still sees `errors.txt`. Text files handed to `shareFiles` keep their original names (`errors.txt`, …) | text files go as in-memory string parts of React Native's `FormData` (`{ string, name, type }`, never a `Blob`). Measured on Android (SM-M346B, 2026-11-07): the destination receives a **file** part with its `filename` and the right content, and OkHttp appends `; charset=utf-8` to the `content-type`. iOS follows the RN 0.86 source, not measured |
| `recordVisibleText` | `boolean`, default `true`: use visible text inside the touched element as the step label (masked). Set `false` for banking or health apps | – |
| `appContext` | `() => DevToolsAppContext \| Promise<DevToolsAppContext>` (any object): your own context, called once when QA opens the form; 1.5 s cap when async. Becomes an **App context** ticket section and `context.json`, redacted like request bodies but **not** masked for personal data ([recipes](docs/recipes/bug-report-context.md)) | no App context chip, section or file |

`bugReport` can be written inline: the gate builds the connection store and send queue once, and
rebuilds only when `secureStore` appears or disappears or the set of `connectorTypes` ids changes.

```ts
const config: DevToolsConfig = {
  enabled,
  bugReport: {
    captureScreen: () => viewShotCapture(),
    secureStore: keychainStore,
    shareFiles: (files, message) => shareMany(files, message),
    writeTempFile: (name, content) => writeCacheFile(name, content),
  },
};
```

The [example app](example/src/devtools/) wires all four with `react-native-view-shot`,
`react-native-keychain`, `react-native-share` and `react-native-blob-util`.

### `startCapture(options)`

| Option | Default | |
|---|---|---|
| `enabled` | **required, no default** | same rule as `DevToolsConfig.enabled`; pass the same value. Only `true` starts capture: `false`, a missing key (from JavaScript) or another truthy value (`'true'`, `1`) patches nothing, writes nothing and returns an empty stop function |
| `redactKeys` | `[]` | extra secret names of your own (JSON keys, form/query parameters, headers), on top of the built-in rule ([what is masked](#security-and-privacy)); any spelling, matched as a whole name after normalising (`customerRef` = `customer_ref`). Cleared when capture stops |
| `capacity` | `300` | rows kept in memory |
| `errorCapacity` | `100` | extra errors kept after they leave the main ring; `0` turns it off |
| `bodyLimit` | `4000` | characters kept per request/response body |
| `console` · `network` · `uncaught` · `rejections` | `true` | turn each tap on or off |
| `persist` | off | `{ store: LogStore, ttlHours = 72, maxSessions = 3, maxBytes = 1_000_000, contextSize = 50, flushMs = 2000, build? }`. `LogStore` is `{ list, read, write, remove }` implemented by the app. The bug-report send queue is stored there too and takes it once, when `DevToolsGate` mounts: call `startCapture({ persist })` before that, or the queue stays in memory for the whole run |

### Android: keyboard inside the sheet

The log screen has a search field inside the sheet, and the sheet must be lifted exactly once when
the keyboard opens. The library can't tell whether your window resizes, so you declare it:

| Your app's window on the running device | `androidKeyboardInputMode` | Wrong value gives |
|---|---|---|
| edge-to-edge | `'adjustPan'` *(default)* | `'adjustResize'`: the keyboard covers the sheet footer and the end of the list |
| **not** edge-to-edge + manifest `adjustResize` | `'adjustResize'` | `'adjustPan'`: lifted twice, footer over the search field, empty list |
| manifest `adjustPan` | `'adjustPan'` | – |

With RN 0.86 and target SDK ≥ 35 the window becomes edge-to-edge on Android 16+, and on Android 15
unless the theme opts out, even with `edgeToEdgeEnabled=false`. Either set
`edgeToEdgeEnabled=true` and keep the default, or:

```ts
androidKeyboardInputMode:
  Platform.OS === 'android' && Number(Platform.Version) < 35 ? 'adjustResize' : 'adjustPan',
```

Measured on Android 14; the Android 15/16 rows are inferred from RN 0.86 source.

## Security and privacy

Summary; the full page is [docs/security-privacy.md](docs/security-privacy.md), and to report a
vulnerability see [SECURITY.md](SECURITY.md).

- **Secrets** (API tokens, App Secret, webhook header values) live only in the app's
  `secureStore`. The library never writes them to `LogStore`, AsyncStorage, the log buffer,
  `console.*` or error strings, and shows them as `••••` + the last 4 characters after saving.
- **The tool's own requests never enter the log**, through two independent mechanisms:
  `runUncaptured`, and an `X-Shake-Devtools: internal` header on every connector request. Both the
  `XMLHttpRequest` tap and the Expo `fetch` tap honour them. The destination receives that header
  too, so it appears in their access logs.
- **What is masked** (replaced with `<redacted>`) when a request is shared, exported, copied for
  AI, persisted or attached to a report. One name rule (`src/capture/redact.ts`) covers header names, JSON keys at
  any depth, and form or query parameters. Names are compared lowercased with `_`, `-` and `.`
  removed, so `access_token`, `accessToken` and `Access-Token` are the same name.
  - **Exact names:** `pass`, `pin`, `pincode`, `auth`, `jwt`, `cardnumber`, `securitycode`.
  - **Name endings:** `token`, `secret`, `password`, `passwd`, `passcode`, `apikey`,
    `authorization`, `cookie`, `credential`, `privatekey`, `signature`, `sessionid`, `otp`, `cvv`,
    `cvc` (plural too). Examples: `refreshToken`, `client_secret`, `X-CSRF-Token`, `set-cookie`.
  - **Kept readable:** `token_type`, `nextPageToken`, `passwordHint`, `tokenExpiresAt`.
  - **URLs only:** `code`, `key` and `sig` are also masked, plus `user:pass@`.
  - **Your own names:** add them with `startCapture({ redactKeys })`.
  - **Values:** strings and numbers are masked, and so is a whole array. An object is walked
    key by key, and `null`/`true`/`false` stay visible.
  - **Bodies:** a body starting with `{` or `[` is always read as JSON, including compact JSON with
    base64 `=` padding and bodies cut off at `bodyLimit`. Other `k=v&k2=v2` bodies are masked by
    parameter name, and raw JSON inside a form value or URL parameter is masked by key too.
  - **Patterns:** JWTs, `Bearer` followed by 16 or more characters, and token prefixes of
    Slack, GitHub, Atlassian, AWS, Google and Stripe are masked wherever they appear: bodies,
    console text, URLs, error lines and report titles. So are Slack and Lark webhook paths.

  Response headers are not recorded.
- **Not masked:** business data in bodies (names, addresses, amounts), secrets under names that
  match none of the rules above (add those through `redactKeys`), and the URL and console text
  **on screen**. These follow the same rule as **Copy cURL**, which stays raw by design so the
  command runs (the in-memory buffer keeps raw values). Raw cURL never goes into a bug report or the
  **Copy for AI** bundle. The rules are a safety net against leaking a live token, not a
  data-loss-prevention system. Don't paste test-build logs anywhere public, and remember that
  **Copy for AI** is meant to be pasted into a third-party AI service: response bodies in it still
  carry business data.
- **Screenshots:** `FLAG_SECURE` does **not** stop `react-native-view-shot` (measured on Android 14:
  `adb screencap` returns nothing, yet the bug-report screenshot of the same window arrives with its
  real content). Block sensitive screens (PIN, OTP, card number) in your `captureScreen` by
  returning `null`.
- **Report text** QA types or edits (title, steps, actual, expected) and the `sessionInfo` your app
  provides are sent as written; mask user data in `sessionInfo` before returning it. Step labels
  taken from visible text have long digit runs and email addresses masked, and text inside a text
  field never becomes a label.
- **App context** (`bugReport.appContext`) leaves the device in the ticket section and
  `context.json`. Secret names (your `redactKeys` included) and token patterns are masked as in
  request bodies; personal data is not. Return only what a ticket needs, and mask the user yourself
  as with `sessionInfo`. QA can untick the chip.
- **Persisted logs** use the same masking, and should go in a cache directory (not backed up). Apps
  that handle sensitive data should have security review before turning on `persist`.
- **Long-lived secrets on QA devices** are an accepted risk, with a warning: a Slack bot token or a
  Lark App Secret opens every permission of its app. The add-connection screen recommends a
  dedicated bug-report app with minimal scopes (Slack `files:write`, `chat:write`; Lark
  `im:resource` + one send-message scope), revocable at any time from the platform console. If you
  don't want tokens on devices at all, use the Webhook connector as a relay.
- **Feishu:** the full level calls the older `tenant_access_token/internal` endpoint, which Feishu
  marks as not recommended but which still works and which Lark still documents. If Feishu turns it
  off, use Webhook/relay.
- The library makes no network requests of its own besides testing connections and sending
  reports, and it is designed to be disabled or stripped in production.

## Measured on a device: bug reporting (Android)

2026-11-07, Samsung SM-M346B, Android 14, RN 0.86.3 new architecture, release build of `example/`
(`./gradlew app:installRelease`). Reports were really sent through a **Webhook** connection to a test
server on the dev machine (`adb reverse tcp:8787 tcp:8787`) that saved every multipart part. The
measured builds carried a few temporary changes, all reverted: a block of recorder test buttons, a
`network_security_config` for `localhost`, `FLAG_SECURE`, no `writeTempFile`, and the `./plain`
entry. **Jira, Slack, Lark: waiting for test accounts**, nothing sent to them yet.

| # | Check | Result |
|---|---|---|
| 1 | Step recorder, 17 test steps | ✅ 17/17 steps right: `Tap "Pay now"` (first visible text), `"Add to cart"` (`accessibilityLabel`), `"btn-testid-only"`, `Tap (unlabeled button)` (unlabelled block, Switch), TouchableOpacity, gesture-handler 3.1 Pressable and RectButton, `Type in the "Email"` / `"Password" field`, `Tap` and `Long-press "Nguyễn Văn A · •••678"`, `⚠ GET /status/500 → 500`, screen marker. Scrolling (a swipe starting on a button) and taps inside the panel are **not** recorded. Typed text (`secret@corp.com`, `hunter2`) is absent from the form, `report`, `timeline.json`, `errors.txt` and the app's logcat (0 lines; only `adbd`/`uiautomator`, the measuring tools, logged it). The screenshot shows it, as a screenshot of that screen would |
| 2 | Screenshot when the panel opens (`open()`) | ✅ the image is the app screen, not the panel. **Retake** closes the sheet first; the new image has no sheet in it. **`FLAG_SECURE`**: `adb screencap` returns 0 bytes, yet `view-shot` **still captures the whole screen** (the image reaching the webhook has the real content, not black), so `FLAG_SECURE` does not protect the bug-report screenshot; block sensitive screens in `captureScreen` |
| 3 | Send through a Webhook | ✅ title prefilled `[Home] GET /status/500 → 500`, Actual prefilled, chips Screenshot · Error log · Device info. The server received `report` (JSON) + `screenshot.jpg` (`image/jpeg`) + `errors.txt` (`text/plain`) + `timeline.json` (`application/json`) with the right `filename`s, plus the `X-Shake-Devtools: internal` header; no part contained a secret (the header value, the token/password of "POST with secrets", typed text). The screen showed "Created WH-3" (server answered `{ url, key }`). The log screen has no row for the webhook request |
| 3b | No `writeTempFile` | ✅ `errors.txt` and `timeline.json` arrive as **file** parts with their `filename`, the right content, and `content-type` `text/plain; charset=utf-8` / `application/json; charset=utf-8` (OkHttp appends the charset) |
| 4 | Offline, queue | ✅ server stopped → Send ⇒ "Queued"; with the sheet closed the Report row hint reads `1 waiting` and the form shows `Send queue: 1 waiting`; server back ⇒ delivered 70 s later (60 s cadence), **exactly once**. A `failed` report (the cleartext case above, after 5 attempts): the banner switched to "need attention" while the form was open → queue page → status page with the reason and the check-the-destination note → **Send again** ⇒ delivered once. The failed report survived an APK reinstall |
| 5 | Expired token (server answers 401) | ✅ "The Webhook token has expired, enter it again" + `HTTP 401: …` + "Your draft is kept."; **Edit the report** shows title and Actual intact. **Share** opens the system sheet with `SEND_MULTIPLE`, 3 items (image + 2 text files) and the message. Server back to 200, send again ⇒ delivered once |
| 6 | Crash, then report | ✅ the panel shows "The app crashed last time"; the form has `[Crash] Error: Example uncaught error`, Actual `The app crashed: …`, the 9 steps of the crashed session (ending `Open screen Checkout`, `Tap "Throw uncaught error"`, `⚠ Error: …`), Previous session chip on, Screenshot chip off; `previous-session.txt` attached. `errors.txt`, `timeline.json` and the "Error log (N)" chip also come from the crashed session (re-measured after the fix: the chip reads `(2)`, the crashed session's 500 and fatal error; a network error from the session after the restart is left out). The next report has no `[Crash]` and no Previous session chip |
| 7 | Connections screen, keyboard (gorhom) | ✅ add/edit/delete a Webhook works; the header value only ever shows as `••••WXYZ` (list; the edit page leaves the field empty with "Saved ••••WXYZ"); Back goes edit → list → form. The keyboard does not cover the connection editor's fields, the Title field or the Send bar. The first run found a bug: focusing **Expected** left the sticky Send bar on top of the field (only ~30 px visible). After the fix (a `scroll` sheet's content area reserves the footer height at its bottom) Expected sits fully above the footer (y 913–1138, footer from 1138), also when tapped with the keyboard already open (Actual showing 50 px ⇒ scrolled fully into view, 913–1138); the Logs list still ends right above its footer. `./plain` is unchanged |
| 8 | `./plain` entry (no `GestureHandlerRootView`, no `BottomSheetModalProvider`) | ✅ no gorhom in the bundle; recorder right; Back: steps page → form → sheet closed; Title and Expected stay above the Send bar with the keyboard open; connection edit + Back one level at a time; Webhook send delivered |
| 9 | Keychain | ✅ the connection survives an app restart and an APK reinstall; the secret is never shown in clear |

Also noted: the screenshot was taken on `open()` (the "Open debug tools" button); a physical shake
was not used in this run (same capture path in the gate).

## Not yet verified

Jest and tsc pass; the points below need a device or a real workspace.

- **No report has been sent to a real workspace — waiting for test accounts**: the Jira, Slack and
  Lark connector tests use a mocked `fetch`, and nothing has gone to Jira Cloud (classic or scoped
  token), Slack (webhook or bot) or Lark/Feishu yet. The shared send path (queue, multipart,
  offline, 401, share) has run for real through the Webhook connector on Android. Some Lark error
  codes are not matched against documentation; unknown codes fall back to `unknown`.
- **iOS:** the whole bug-reporting flow (screenshot, form, send, share; iOS secure layers may come
  out white; the `{ string, name, type }` `FormData` part follows the `RCTNetworking` source only);
  the `./plain` entry; shaking while walking (the iOS threshold comes from measurements of real
  shakes and of a phone at rest only); the no-op swap through an Xcode build setting and the
  "Bundle React Native code and images" run script.
- **Bug-reporting details still to check on a device:** SurfaceView and TextureView areas (video,
  maps, camera) in a `view-shot` image may come out black (`example/` has none). Native
  react-navigation header and tab buttons may not be recorded as steps (`markScreen` still records
  the screen change; `example/` has no react-navigation). `fetch(file://…).blob()` for the Slack
  upload (needs Slack). **App context** (`bugReport.appContext`, 2026-11-18): jest only, on both
  sheet kits; the chip, the time a large store snapshot takes on a real JS thread, and
  `context.json` arriving at a destination have not been run on a device. `example/` wires it with
  fake data since 2026-11-19 (panel row **App context (example)**: normal, large, throws, never
  resolves); not run on a device yet.
- **Android 15/16:** keyboard handling in the sheet (measured on Android 14 only). `./plain` on a
  window that is not edge-to-edge.
- **Unhandled rejections in debug builds** (`--dev true`): release builds are measured; the debug
  behaviour (LogBox still shows) is inferred from RN 0.86 source.
- **Per-flavor no-op on Android:** setting `DEVTOOLS_NOOP` per `createBundle<Variant>JsAndAssets`
  task for several flavors in one Gradle command.
- **Expo:** `expo/fetch` capture is built from Expo's source and changelog
  (`packages/expo/src/winter/installGlobal.ts`, `runtime.native.ts`, `fetch/FetchResponse.ts`;
  56.0.0 "Use `expo/fetch` as default fetch") and tested with jest against a fake `expo/fetch`.
  Nothing has run in an Expo app yet (dev build, Expo Go or EAS); the
  [Expo recipe](docs/recipes/expo.md) marks what is unchecked.

Known limitation: on Android, in a debug build with bundled JS, shaking also opens React Native's
dev menu on top of the panel. Android exposes no switch for the dev menu's shake alone. On iOS the
gate turns the dev menu's shake off in that case.

Full list with dates: [Chưa verify](README.vi.md#chưa-verify) (Vietnamese).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md); taking part means agreeing to the
[Code of Conduct](CODE_OF_CONDUCT.md). In short:

```bash
npm install
npm run typecheck   # tsc --noEmit, with React Native's globals and again with lib DOM
npm test            # jest
npm run check       # both, jest in CI mode
npm run check:consumer  # pack, install into a temp app, strict tsc + exports (needs the registry)
```

Node `^20.19.4 || ^22.13 || >=24.3`. Shake, the keyboard, the share sheet and crash persistence
can't be checked in jest: use the [example app](example/README.md), an RN 0.86 app that loads
`../src` through Metro. Notes on the jest, Babel and CI setup:
[Phát triển](README.vi.md#phát-triển) (Vietnamese).

**Release build:** `npm run build` (react-native-builder-bob, `tsconfig.build.json`; `prepare` runs
it on `npm install` and `npm pack`) writes `lib/`, which is not committed. Every entry in `exports`
has three conditions: `types` → `lib/typescript/` (your app's tsc reads the `.d.ts` files and does
not type-check library code), `react-native` → `src/` (your app's Metro and jest still consume the
source, and your worklets plugin compiles the `'worklet'` functions, as with reanimated and gorhom),
and `default` → `lib/module/` (ESM). `./metro` points straight at `src/metro/` (CommonJS for Node).
The package contains `lib/` and `src/` without tests; see `npm pack --dry-run`.

## License

[MIT](LICENSE) © LinhNobi
