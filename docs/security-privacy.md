# Security and privacy

This page states, as precisely as the code allows, what `react-native-shake-devtools` captures, what
it redacts and where, where secrets live, and what it never does. Every claim names the file that
implements it, so you can check it. To report a vulnerability, read [SECURITY.md](../SECURITY.md).

The tool is meant for **dev, QA and UAT builds**. The lib never decides by itself whether it is
allowed to run: `DevToolsConfig.enabled` is required and has no default (`src/gate/devtools-props.ts`).

## What is captured

Capture starts only when your app calls `startCapture()` (`src/capture/start-capture.ts`). Nothing is
patched before that. It records into an in-memory ring buffer (`src/capture/log-buffer.ts`):

| Source | What is stored | Where in code |
|---|---|---|
| `console.*` | the logged text | `src/capture/console-tap.ts` |
| HTTP made through `XMLHttpRequest` (axios, RN `fetch`) | method, URL (including query string), request headers, request body (text only), status, duration, response body (text only, up to 1 MB read) | `src/capture/network-tap.ts` |
| HTTP made through Expo's native global `fetch` (`expo/fetch`, SDK 56+) | the same fields; the response body is read from a `clone()` | `src/capture/fetch-tap.ts` |
| Uncaught JS errors (including render errors with no error boundary, which React Native 0.81+ reports through `ExceptionsManager.handleException` instead of `ErrorUtils`) and unhandled promise rejections | message and stack | `src/capture/global-error-tap.ts`, `src/capture/rejection-tap.ts` |
| Screen changes and user markers | route name you pass to `markScreen()`, a flag from the user | `src/capture/markers.ts` |
| Touches (only when `bugReport` is enabled) | an auto-recorded step per tap or long-press, labelled from the pressed element's accessibility label, `testID` or visible text; text inside a text field never becomes a label | `src/report/recorder/` |
| App context (only when `bugReport.appContext` is set) | whatever object your callback returns, read once when QA opens the bug-report form, serialised and redacted at that moment (below) | `src/report/app-context.ts` |

Details that matter for privacy:

- **Bodies are truncated, not skipped.** Request and response bodies are cut to `bodyLimit`
  (default 4000 characters) in the buffer. The full text of a truncated body is kept in RAM only
  (`src/capture/full-body-store.ts`) so the detail screen can show it.
- **Non-text bodies are not read.** `FormData`, `Blob`, `ArrayBuffer` request bodies and binary
  responses are never read (`network-tap.ts`, `fetch-tap.ts`); the log records the reason.
- **Visible text in step labels** can be turned off with `bugReport.recordVisibleText: false`
  (recommended for banking and health apps); then only `accessibilityLabel` and `testID` are used.
- **Not captured:** WebSocket traffic, native SDK requests, `<Image>` loads, and requests that bypass
  both `XMLHttpRequest` and the global `fetch` (for example `expo/fetch` imported and called
  directly).

Capture is raw in RAM on purpose, so the "Copy cURL" action can produce a command that actually runs.
The buffer therefore holds real tokens while the app is running. It is not a security boundary; the
protection is applied where data **leaves** the buffer, below (`src/capture/redact.ts`, header comment).

## What is redacted, and where

The redaction policy lives in `src/capture/redact.ts`. It changed on 2026-11-09: the earlier policy
matched only eight exact snake_case JSON keys with string values, so `accessToken`, `refreshToken`
and `apiKey`, the usual names in JavaScript apps, were written to disk and sent in `errors.txt`.

**One name rule** (`isSecretName`) covers header names, JSON keys at any depth, and form-body or URL
query/fragment parameters. Names are lowercased and stripped of `_`, `-` and `.` before matching.

- **Exact names:** `pass`, `pin`, `pincode`, `auth`, `jwt`, `cardnumber`, `securitycode`.
- **Name endings**, plural included: `token`, `secret`, `password`, `passwd`, `passcode`, `apikey`,
  `authorization`, `cookie`, `credential`, `privatekey`, `signature`, `sessionid`, `otp`, `cvv`, `cvc`.
  For example `refreshToken`, `client_secret`, `x-api-key`, `X-CSRF-Token`, `set-cookie`,
  `X-Amz-Signature`. Matching on the ending keeps `passwordHint`, `tokenExpiresAt` and
  `passwordPolicy` readable.
- **Excluded**, because they look secret but are debugging information: `token_type`,
  `nextPageToken`, `pageToken`, `nextToken`, `continuationToken`.
- **URL parameters only:** `code` (OAuth), `key` (`?key=AIza…`) and `sig` are also masked, and so is
  `user:pass@` before the host. In bodies, `code` and `key` are usually error codes and business keys,
  so they are left alone.
- **App-specific names:** `startCapture({ redactKeys: [...] })` adds names, matched as whole
  normalised names. They are cleared when capture stops.

**Values under a secret name.** Strings and numbers become `"<redacted>"`, and a whole array is
masked. An object is walked, and its own keys are judged one by one. `null`, `true` and `false` stay
visible, since "the token is null" is debugging information. The JSON is never parsed and
re-serialised: formatting, key order and large numbers are kept, and a body cut off at `bodyLimit`
is still masked to its end.

**JSON or form body.** A body whose first non-space character is `{` or `[` is always read as JSON,
even when it is cut off or is compact JSON that happens to look like `k=v` (a base64 token with `=`
padding, such as `{"refreshToken":"dGVzdA=="}`). Only other bodies shaped like `k=v&k2=v2` are masked
by parameter name. Secret JSON keys are then masked in every body and URL, including raw JSON inside
a form value or a query parameter (`state={"refreshToken":"…"}`). JSON that is percent-encoded inside
a parameter (`%7B%22…`) is not decoded, so it is masked only if the parameter name itself is secret.
Before 2026-11-18, compact JSON containing `=` was split as one form parameter and its tokens were
not masked.

**Value patterns**, applied to bodies, header values, console text, URLs, step labels and error lines:
- JWTs (three dot-separated parts starting `eyJ`);
- `Bearer` followed by 16 or more token characters;
- tokens with a known prefix: Slack `xox?-`, GitHub `ghp_`/`github_pat_`, Atlassian `ATATT`, AWS
  `AKIA`/`ASIA`, Google `AIza`, Stripe `sk_live_`/`sk_test_`;
- Slack and Lark webhook paths.

This is a safety net against pasting a live token into a ticket, not a data-loss-prevention system:

> **Not redacted:** business data in bodies (names, addresses, amounts), secrets stored under names
> the rule does not match (add them with `redactKeys`), and the URL and console text **on the device
> screen**. The screen stays with the person debugging, like "Copy cURL"; everything that leaves
> through share, export, "Copy for AI", disk or a bug report is redacted. Do not paste a UAT log
> somewhere public.

Where the policy is applied:

| Output | Redacted? | Notes |
|---|---|---|
| Request detail page and JSON body viewer | headers and bodies yes; the URL is shown as captured | `src/panel/LogDetail.tsx`, `src/panel/JsonBody.tsx` |
| Share, "Copy line", `errors.txt` export | yes: URL, headers, bodies, console text | `src/capture/format-log.ts`, `src/capture/format-error-report.ts` |
| "Copy for AI" Markdown (clipboard, or `Share` without a clipboard) | yes: URL, headers, bodies, console text and stacks; steps like `timeline.json`; no cURL | `src/capture/format-ai-context.ts`, see below |
| Sessions persisted to disk | yes, before writing: URL, headers, bodies, console text | `redactEntry` in `src/capture/log-session.ts`, called from `src/capture/log-persist.ts` |
| Bug report (`errors.txt`, `timeline.json`, steps) | yes | see below |
| Bug report app context (`context.json`, App context section) | yes, secret names and value patterns; **not** personal data | see below |
| "Copy cURL" to the clipboard | **no, by design** | stays with the person debugging; **the raw cURL never enters a bug report** (`src/capture/to-curl.ts`) |

"Copy for AI" specifics (`src/capture/format-ai-context.ts`, `src/panel/use-ai-copy.ts`):

- It is built to be pasted into a **third-party AI service** (Claude Code, Cursor, Copilot and the
  like), so it follows the share policy, not the "Copy cURL" one. It never contains a cURL command.
- Contents: the build line and your `sessionInfo()` (passed only through `redactText`, so mask the
  user there, as for `errors.txt`), uncaught errors and unhandled rejections with stacks
  (`redactText`), failed (≥ 400 or network error) and slow requests with the redacted URL, redacted
  request headers and redacted request/response bodies cut to 2,000 characters each, recent
  `console.error`/`console.warn` text (`redactText`), and recent steps. Steps carry screen names,
  tap labels, request **paths** (host, query and fragment dropped) and the first line of errors,
  all through `maskPersonalData`, like `timeline.json`. A text-field step carries the field's label,
  never the typed text. Nothing the tester typed in the bug-report form is included.
- Size: at most 40,000 characters; the most severe and most recent items are kept and the text says
  what was left out.
- Where it goes: the panel row (running session) and the Previous session footer put it on the
  device clipboard with React Native's core `Clipboard`; only when that API is missing does it open
  the system share sheet. Clipboard contents can be read by other apps and, with clipboard sync,
  by the developer's computer. Response bodies still carry business data.

Bug-report specifics (`src/report/`):

- `timeline.json` contains method, path (host, query and fragment dropped), status and duration. It has
  **no headers and no request or response bodies** (`src/report/timeline.ts`).
- `errors.txt` is built by `formatErrorReport`, so it is redacted like a share.
- Step labels, screen names, paths and the first line of errors pass through `maskPersonalData`
  (`src/capture/mask-label.ts`). First, secrets are replaced with `<redacted>`: JSON with a secret
  key, and the value patterns above. This covers report titles and "Actual" text prefilled from an
  error. Then runs of six or more digits (spaces, dots or hyphens allowed in between) and email
  addresses are masked, keeping the last 3 characters.
- Device and user info comes from your `sessionInfo()` callback. The lib does not mask it again, so
  mask the user there.
- **App context** comes from your `bugReport.appContext()` callback (`src/report/app-context.ts`).
  What leaves the device:
  - a `context.json` attachment (pretty JSON, at most 32,000 characters) on connections that carry
    files (Jira, Slack bot, Lark app, Webhook), and on the Share path;
  - an **App context** section in the ticket text, one line per top-level key (at most 10 lines,
    100 characters per value), on every connection, including the text-only Slack and Lark webhooks;
  - for the Webhook, the same lines as `appContext: { lines, more }` in the `report` JSON part.

  It is read once, when QA opens the form, and redacted **at that moment**, before it is stored in
  the draft: value patterns on every string, then the name rule on every key at any depth,
  including names added with `startCapture({ redactKeys })`. The draft, the send queue and every
  connector only ever see the redacted text. Personal data (`maskPersonalData`) is **not** masked:
  user ids, order numbers and emails you return are sent as you return them, because they are
  usually why you added the context. Return only what a ticket needs. QA can untick the
  **App context** chip before sending.

  For a report about the previous **crashed** session, the callback is not called and nothing is
  attached: the state after a restart is not the state at the crash.
- Errors thrown by connectors replace known secrets with `<redacted>` before truncating the excerpt
  (`src/report/connectors/http.ts`, `src/report/connectors/lark/index.ts`).

## Where secrets live

Connection secrets (Jira API token, Slack bot token or webhook, Lark App Secret, webhook header value)
exist in **one place only: the `secureStore` your app provides** (Keychain / Keystore, for example
`react-native-keychain` or `expo-secure-store`).

- `src/report/connections/connection-store.ts` writes the non-secret connection list under
  `devtools.connections.v1` and each secret under `devtools.secret.<id>`, both in that store.
  `save()` throws if a secret field is found among the non-secret values.
- Secrets are not written to `LogStore`, AsyncStorage, the log buffer, `console.*`, or error strings.
  After saving, the UI shows only `••••` plus the last 4 characters (`maskSecret`).
- Without a `secureStore`, connections cannot be saved and nothing is sent; the Share path still works.
- Secrets are fetched from `secureStore` at send time and are never part of the send queue (next
  section).

A long-lived bot token or App Secret on a tester's phone is an accepted, documented risk. The add-
connection screen asks the admin to create a **dedicated app for bug reports with minimum scopes**
(Slack: `files:write`, `chat:write`; Lark: `im:resource` plus one send-message permission), revocable
at any time in the platform console. Customers who do not want a token on devices can use the Webhook
connector as a relay and keep tokens on their server.

## The bug-report send queue

Reports that could not be sent yet are queued (`src/report/send-queue.ts`). What that means for data at
rest:

- **Where.** The queue is the file `report-queue.json` in **your app's `LogStore`**, and only when you
  enabled `startCapture({ persist })` before `DevToolsGate` mounted (the gate takes the store once, at
  mount). Without `persist`, or if a read from the store hangs for more than 5 s, the queue lives in
  RAM only for that run (the UI says it is lost if the app is killed) and nothing more is written.
- **What it contains.** The whole report plus delivery metadata: the title, "actual" and "expected"
  text **as the tester typed them (not redacted)**, the steps, `deviceInfo` exactly as your
  `sessionInfo()` returned it (the lib does not mask it again), the text of `errors.txt`,
  `timeline.json` and `context.json` plus the App context lines (already redacted as described
  above) and the file path of the screenshot. It never contains connection secrets.
- **Free text is sent as typed.** Anything a tester types into the form (title, actual, expected, step
  text they edited) is not redacted before it is stored or sent. Tell testers not to type credentials.
- **Retention.** Items waiting to be sent, uncertain, failed or blocked are kept until they are sent or the
  tester discards them (**Discard report** on the **Send queue** page, which the form's banner opens;
  not offered while an item is sending). Items already `sent` are dropped after 24 hours (on the next
  load). There is no other expiry.
- **Logout does not clear it.** `clearPersistedLogs()` removes only the `session-*.json` log files (and
  the in-RAM action buffer and full bodies). It does **not** touch `report-queue.json`, on purpose:
  a pending report is the tester's work product and should survive a logout and a restart. If your
  app must not keep a previous user's pending reports, clear them yourself (the tester discards each
  queued report, or your app removes `report-queue.json` from your `LogStore`) at logout. A mounted
  gate keeps its queue in memory and writes the whole file again after its next change, so removing
  the file alone does not clear a queue that is still running.

## The tool's own requests are excluded from the log

Connector requests carry tokens, so they must never appear in the network log. Two independent layers
(`src/capture/network-tap.ts`, `src/report/connectors/http.ts`):

1. The request is made inside `runUncaptured(...)`, which makes `open()` skip tracking.
2. Every connector request also carries the header **`X-Shake-Devtools: internal`**. When the tap sees
   that header it drops the XHR. This covers the case where an app or SDK wraps the global `fetch` and
   awaits before opening the XHR, after the first layer has already ended.

The tap for Expo's native `fetch` (`src/capture/fetch-tap.ts`) applies the same two checks, so on Expo,
where connector requests do not go through `XMLHttpRequest`, they stay out of the log too.

The header is part of the real request, so **the destination (Jira, Slack, Lark, your webhook server)
receives it too**. It is harmless but will appear in the destination's access logs.

## Screenshots

The lib has no native module and takes no screenshot itself. `bugReport.captureScreen` is yours:

- You decide which screens may be captured. Returning `null` means the screen cannot be captured,
  and the panel and form say so ("This screen can't be captured", "This screen does not allow
  screenshots").
- The image is taken **before** the panel covers the screen. A slow or failing capture (over 1.5 s,
  or an error) is reported as "Screenshot failed" on the panel and "Could not take a screenshot" on
  the form; the panel still opens.
- The panel and log screens render in the app's own window (no `<Modal>`), so `FLAG_SECURE` on Android
  and screenshot blocking on iOS keep applying to them.
- `FLAG_SECURE` does **not** stop `react-native-view-shot`: measured on Android 14 (SM-M346B,
  2026-11-07), `adb screencap` of a `FLAG_SECURE` window returns nothing, yet the bug-report screenshot
  of the same window arrives with its real content. Block sensitive screens (PIN, OTP, card number) in
  `captureScreen` by returning `null`; `FLAG_SECURE` alone is not enough.
- The screenshot is uploaded to the destination the tester chose (Jira, Slack, Lark, webhook) when that
  connection type supports files. The lightweight Slack and Lark webhooks cannot carry images.

## No telemetry

The lib makes network requests **only to destinations the tester configured** in a connection (Jira site,
Slack, Lark/Feishu, or webhook URL): sending a report, testing a connection, and the token calls those
connectors need (for example Lark's tenant-token request or Slack's upload-URL steps). There is no
analytics, crash reporting or phone-home to the author or anyone else. The only request the lib
starts itself is the connector transport in `src/report/connectors/http.ts`; the Expo `fetch` tap
(`src/capture/fetch-tap.ts`) only passes the app's own calls through to the original `fetch`.

## Production

Three layers keep devtools out of production (details in the README):

1. `enabled` is required, has no default, and is not inferred from `__DEV__` (UAT builds often
   bundle with `--dev true`). Your app writes the rule `'prod' => enabled: false` and tests it.
2. When `enabled` is `false` the gate renders only its children and mounts no panel, shake listener or
   bug-report recorder. `startCapture({ enabled })` follows the same rule: `enabled` is required, and
   anything but `true` (including a missing key from JavaScript, or `'true'`) patches nothing, writes
   nothing to disk and returns an empty stop function (`src/capture/start-capture.ts`). Pass the
   same value to both.
3. Optional: strip the code. `react-native-shake-devtools/metro` (`src/metro/noop-resolver.js`) swaps
   every import for an empty twin under `src/noop/` with the same names and types. The no-op versions
   patch nothing, return empty data and their redaction helpers never return raw data. It was measured
   on the `example/` Android bundle; per-flavor wiring on multi-flavor Android and iOS is not yet
   verified.

If you enable `persist`, redacted error sessions are written to your `LogStore` for up to 72 hours
(`ttlHours`), at most 3 sessions and 1 MB each by default (`src/capture/log-persist.ts`); the bug-report
queue is stored there too (see above). Call `clearPersistedLogs()` on logout to remove the session
files, and note that it does not clear the report queue. Writing logs to disk in an app that handles
sensitive data is a decision worth a security review.
