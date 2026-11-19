# react-native-shake-devtools

## 0.1.0

### Minor Changes

- 4258ded: Bug reports can carry your app's own context. Add `bugReport.appContext`, a sync or async callback
  returning a plain object (user id, build and environment, feature flags, a Redux or Zustand slice,
  `Sentry.lastEventId()`), and it is read once when QA opens the report form.
  
  - **Never in the way:** a throw, a rejection, more than 1.5 s or a non-object leaves the form working;
    the new **App context** chip then reads "App context unavailable".
  - **Safe to serialise anything:** cycles, functions, symbols, BigInt, `Date`, `Error`, `Map`/`Set`,
    `toJSON` and throwing getters are handled, with depth, key, item, string and size caps that leave
    visible markers (`[Object]`, `…+N more`).
  - **Redacted like request bodies**, `startCapture({ redactKeys })` included, before it is stored.
    Personal data is not masked: return only what a ticket needs.
  - **Where it goes:** a short **App context** section in every ticket (text-only Slack and Lark
    webhooks included), a `context.json` attachment wherever the connection carries files, and
    `appContext` in the Webhook's `report` part. QA can untick the chip.
  - **Crash reports:** a report about the previous crashed session does not call it, since the state
    after a restart is not the state at the crash.
  
  New exported type: `DevToolsAppContext`. `BugReport` gains an optional `appContext` (`{ lines, more }`)
  that custom connectors can render. Recipes: `docs/recipes/bug-report-context.md`.
- 4258ded: Add in-app bug reporting for QA. Shaking the device opens a pre-filled report (screenshot, auto-recorded
  steps, error log, device info) that can be sent to Jira Cloud, Slack, Lark/Feishu or a webhook, with a
  retry queue for flaky networks. The feature is opt-in through `DevToolsConfig.bugReport`; every native
  capability (screenshot, secure store, file sharing) is supplied by the app. Custom destinations plug in
  through `bugReport.connectorTypes`. The tool's own requests are never written to the network log, and
  secrets live only in the app-provided secure store.
- 4258ded: New **Copy for AI**: one tap copies a masked Markdown bundle to paste into a coding agent (Claude
  Code, Cursor, Copilot). It has a one-line instruction for the agent, app/device/session info, uncaught
  errors and unhandled rejections with stacks, recent steps, failed and slow requests (method, URL,
  status, duration, headers, cut bodies), and recent console errors and warnings.
  
  - **Where:** a **Copy for AI** row under **Logs** in the panel (running session), and a button in the
    footer of the **Previous session** log (after a crash). It goes to the clipboard, or to `Share`
    when the clipboard is unavailable.
  - **Size:** at most 40,000 characters. The most severe and most recent items are kept, identical
    items collapse to `×N`, and the text says what was left out.
  - **Privacy:** everything passes through the same redaction as Share and `errors.txt`, including
    `startCapture({ redactKeys })`. It never contains a cURL command or text typed into fields.
  - **API:** `formatAiContext(entries, options)` and `AI_CONTEXT_MAX_CHARS` from
    `react-native-shake-devtools/capture`, with no-op twins.
- 4258ded: Redaction now masks the secret names JavaScript apps actually use. Before, only eight exact
  snake_case JSON keys with string values were masked, so `accessToken`, `refreshToken` and `apiKey`
  reached persisted sessions, the shared log and `errors.txt`.
  
  One name rule now covers header names, JSON keys at any depth, and form or query parameters. Names are
  compared lowercased without `_`, `-` and `.`, by exact name or by name ending (`…token`, `…secret`,
  `…password`, `…apikey`, `…cookie`, …). Debugging names such as `token_type` and `nextPageToken` stay
  readable.
  
  - **Values:** numbers and arrays under a secret name are masked too. `null` and booleans stay visible.
  - **Bodies:** form-encoded bodies are masked by parameter name.
  - **URLs:** query and fragment parameters (plus `code`, `key`, `sig`) and `user:pass@` are masked in
    shared lines, `errors.txt` and persisted sessions.
  - **Free text:** console text and error lines are masked too, including report titles prefilled from
    an error. This covers JSON printed inside the text, JWTs, `Bearer` tokens, and tokens with a known
    prefix (Slack, GitHub, Atlassian, AWS, Google, Stripe).
  
  New `startCapture({ redactKeys })` adds app-specific names. **Copy cURL** stays raw by design.
- 4258ded: **Breaking:** `startCapture` now requires `enabled`, with the same rule as `DevToolsConfig.enabled`. Only
  `true` starts capture. `false`, a missing key (when called from JavaScript) or another truthy value such
  as `'true'` patches nothing, writes nothing to disk and returns an empty stop function. Before, an app
  that forgot its own `if (enabled)` guard patched console and HTTP in production builds, and wrote logs
  to disk there if `persist` was set. Migrate `if (enabled) startCapture(options)` to
  `startCapture({ enabled, ...options })`.

### Patch Changes

- 4258ded: The library's source now type-checks when an app's tsc reads it with `lib: ["DOM"]`, as an Expo app
  does (`expo/tsconfig.base`) when it maps the package to `src/`. Before, the Slack connector failed
  with `'lastModified' does not exist in type 'BlobPropertyBag'`: React Native's `Blob` options type
  requires `lastModified`, DOM's does not allow it in an object literal. Runtime behaviour is unchanged;
  the `Blob` still gets the same `type` and `lastModified` on React Native.
- 4258ded: The no-op entries (`react-native-shake-devtools/noop` and `react-native-shake-devtools/noop/plain`) now
  export `ConnectorError` as a type as well as a value, like the real entries, where it is a class. Before,
  code that used the name as a type (`let last: ConnectorError | undefined`) failed to typecheck when
  TypeScript read a no-op entry (for example through a `paths` alias for production builds), with
  `'ConnectorError' refers to a value, but is being used as a type here`. Runtime behaviour is unchanged.
- 4258ded: Fix a token leak in redaction. A compact JSON body (no spaces) that contained an `=` sign anywhere,
  for example a base64 token with padding such as `{"refreshToken":"dGVzdA=="}`, was mistaken for a
  form body. Its secret keys were then not masked, so the token reached persisted sessions on disk,
  `errors.txt` in bug reports and the shared log. `JSON.stringify` produces exactly this shape, so
  login and token-refresh responses were the usual victims.
  
  A body that starts with `{` or `[` is now always read as JSON, including a body cut off at
  `bodyLimit`. Real form bodies (`grant_type=refresh_token&refresh_token=…`) are still masked by
  parameter name. Secret JSON keys are also masked when raw JSON sits inside a form value or a URL
  parameter. Sessions already written to disk by an earlier version are masked again when they are
  shared, exported or attached to a bug report, but the files themselves keep the token until they
  expire (72 hours by default) or the app calls `clearPersistedLogs()`.
- 4258ded: Render errors with no error boundary are now captured as fatal on React Native 0.81 and later.
  
  React 19 no longer rethrows such an error. It calls the `onUncaughtError` that React Native passes to
  the renderer, which calls `ExceptionsManager.handleException(error, true)` directly, without going
  through `ErrorUtils`. Until now the library only wrapped `ErrorUtils`, so on React Native 0.81, 0.86
  and 0.88 a render crash showed up as a plain `ERROR` row without a stack, and the previous session was
  not saved before a release build died. The crash was missing from the **Previous session** and from
  crash bug reports after relaunch.
  
  - `startCapture({ enabled: true })` (with `uncaught` left on) now also wraps React Native's
    `ExceptionsManager.handleException` for fatal calls. A render crash becomes one `FATAL` row with a
    stack, and the session is written once before React Native shows LogBox (debug) or crashes
    (release), within the same 800 ms budget as other fatal errors.
  - An error that reaches both `ErrorUtils` and `handleException` is still logged and saved once.
  - Errors caught by an error boundary are not fatal and are logged as before.
  - React Native 0.76 (React 18) already reached `ErrorUtils` and is unchanged.
  
  Tested with jest against React Native's own `onUncaughtError` and `ExceptionsManager`; not yet verified
  on a device.
