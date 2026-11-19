# Security policy

`react-native-shake-devtools` runs inside your app, intercepts its HTTP traffic and console, and can
hold credentials for Jira, Slack and Lark on a tester's device. Security reports are taken seriously.

## Reporting a vulnerability

**Please do not open a public issue for a vulnerability.**

Use GitHub's private vulnerability reporting instead:

1. Go to the [Security tab](https://github.com/linhnobi/react-native-shake-devtools/security) of the
   repository.
2. Choose **Report a vulnerability** and fill in the advisory form
   ([direct link](https://github.com/linhnobi/react-native-shake-devtools/security/advisories/new)).

Helpful details: affected version or commit, React Native version and platform, a minimal
reproduction, and what an attacker gains. If private reporting is unavailable for any reason, open a
public issue that says only "I need a private channel for a security report" (no details) and a
maintainer will follow up.

This is a volunteer-maintained project. The goal is to acknowledge a report within 7 days and to keep
you updated until a fix and a coordinated disclosure are agreed. These are goals, not a guarantee.

## Supported versions

The package has not been published to npm yet (`"private": true`). Until the first release:

| Version | Supported |
|---|---|
| `main` branch | yes |
| anything else | no |

After the first release, the **latest minor version** of the `0.x` line (and later of the latest
major version) receives security fixes. This table will be updated with the first release.

## Scope

In scope: flaws in this library's code that could expose data it handles. In particular:

- **Token handling.** Connection credentials (Jira API token, Slack bot token, Lark App Secret,
  webhook header value) must live only in the app-provided `secureStore`, never in `LogStore`,
  AsyncStorage, the log buffer, `console.*`, error strings, or the screen after saving.
  See `src/report/connections/connection-store.ts`.
- **Redaction.** Captured log data that leaves the device (share, the `errors.txt` and
  `timeline.json` attachments, persisted sessions) must go through the redaction policy in
  `src/capture/redact.ts`; the raw cURL must never enter a bug report. Not covered by that policy, by
  design: text a tester types into the report form, and device/user info supplied by the app's
  `sessionInfo()`. Those are sent as provided. See
  [docs/security-privacy.md](docs/security-privacy.md) for the exact scope and the report queue's
  retention.
- **Own-request exclusion.** The tool's own HTTP requests (which carry tokens) must never appear in the
  network log. This relies on `runUncaptured` and the `X-Shake-Devtools: internal` header handled in
  `src/capture/network-tap.ts` (and in `src/capture/fetch-tap.ts` for Expo's native `fetch`).
- **Production no-op.** A build that enables the Metro no-op resolver must not ship devtools code.
- Anything that lets a remote party (a server response, a deep link, a crafted log line) execute code
  or read data through the tool.

Out of scope:

- Problems that require the app to be misconfigured on purpose, for example setting `enabled: true`
  in production, or supplying a `secureStore` that is not actually secure.
- Data you choose to capture and share: response bodies and URLs are only redacted as documented in
  [docs/security-privacy.md](docs/security-privacy.md), and sharing a log is an explicit user action.
- Vulnerabilities in third-party services (Jira, Slack, Lark) or in the optional peer dependencies;
  report those upstream.
- Findings in the `example/` app that do not affect the library.

For what the library captures and how it protects it, read
[docs/security-privacy.md](docs/security-privacy.md).
