# AGENTS.md

Guidance for AI coding agents (Claude Code, Cursor, Codex, Copilot and others) working **in this
repository**. If you are an agent helping a user **install the library in their app**, read
[docs/install.md](docs/install.md) instead.

## What this repo is

`react-native-shake-devtools`: in-app devtools for React Native. Shake the device to open a panel with
a network and console log, uncaught errors, the previous crashed session and device info, plus an
opt-in **bug report** flow that sends a pre-filled ticket (screenshot, auto-recorded steps, error log)
to Jira, Slack, Lark/Feishu or a webhook. Pure TypeScript: no runtime dependencies and no native
module. Everything native (screenshots, secure storage, file sharing, disk) is supplied by the app.

## Commands

```bash
npm ci               # install from the lockfile (Node ^20.19.4 || ^22.13 || >=24.3)
npm run typecheck    # tsc --noEmit over src/ including tests, then library code with lib DOM
npm test             # jest
npm run check        # typecheck + jest in CI mode: run this before saying you are done
npm run check:consumer  # packed package in a temp app: strict tsc, exports (~2 min, registry)
npm run changeset    # add a changeset for a user-visible change
```

Run `npm run check:consumer` too when you change a public export, a public type or `exports`; add
the new API to `scripts/consumer-fixture/` the way the README uses it.

`example/` (bare React Native 0.86) and `example-expo/` (Expo SDK 58, `./plain` entry) are separate
apps with their own `node_modules`; root jest and tsc do not scan them. Device-only behaviour
(shake, keyboard in the sheet, share tray) cannot be verified by jest. Do not claim it works on a
device unless you ran it; say "not verified on device".

## Structure

| Path | What lives there |
|---|---|
| `src/capture/` | Headless, pure JS: console, HTTP (`network-tap.ts`), error and rejection taps, log buffer, persistence, redaction (`redact.ts`), formatters, cURL |
| `src/shake/` | Shake detection, no UI and no text |
| `src/gate/` | `DevToolsGate`, `DevToolsConfig` and all prop types (`devtools-props.ts`) |
| `src/panel/` | Panel, log screen, request detail |
| `src/report/` | Bug report: recorder, steps, timeline, connectors (`connectors/`: jira, slack, lark, webhook), connection store, send queue, form UI |
| `src/ui/`, `src/kits/` | Theme, sheet abstraction; `kits/gorhom*` (entry `.`) and `kits/plain*` (entry `./plain`) |
| `src/i18n/` | `vi.ts` and `en.ts` string tables and the `DevToolsStrings` type |
| `src/noop/` | Empty twins of every public entry, for production |
| `src/metro/` | `noop-resolver.js`, runs in Node inside `metro.config.js` |
| `scripts/` | `check-consumer.mjs` (the packed package as a strict app sees it) and its `consumer-fixture/` |
| `docs/` | Guides: install, security and privacy, recipes, good first issues. `docs/superpowers/` and `docs/growth/` hold the author's local planning notes and stay out of git |

Public entries (see `exports` in `package.json`): `.` (gorhom sheet), `./plain` (React Native core
sheet, same API), `./capture`, `./shake`, `./i18n`, `./noop*`, `./metro`.

## Rules that are easy to break

1. **No-op surface rule.** A new export of any public entry needs an empty twin with the same name
   and type in `src/noop/` (`index.ts`, `capture.ts`, `shake.ts`, `i18n.ts`, `plain.ts`). Forgetting it
   makes `npm run typecheck` fail through `src/noop/noop-surface.test.tsx`. No-op code must never import
   real library code (`src/noop/noop-isolation.test.ts`) and must never return raw data.
2. **No new runtime dependency**, no native module, no `<Modal>`, no hard-coded colours (theme only;
   `src/ui/no-hardcoded-colors.test.ts`).
3. **Both locales.** Every user-facing string goes into `src/i18n/vi.ts` and `src/i18n/en.ts`.
4. **`enabled` stays required with no default.** The library must never decide on its own that it is
   allowed to run, and never infer it from `__DEV__`.
5. **Secrets.** Connection secrets live only in the app's `secureStore`. Never write them to
   `LogStore`, the buffer, `console.*` or error text. Anything leaving the device goes through
   `src/capture/redact.ts`; raw cURL never enters a bug report. The tool's own requests must carry the
   `X-Shake-Devtools: internal` header and run in `runUncaptured`. No telemetry, ever. Read
   [docs/security-privacy.md](docs/security-privacy.md) before touching capture, connectors or the queue.
6. **Do not edit `package.json` `exports`, `main` or `files`** without being asked; the package is
   `"private": true` and publishing is a separate decision.

## Conventions

- Tests sit next to the file: `foo.ts` and `foo.test.ts`. A behaviour change comes with a test that
  fails without it.
- JSDoc on public functions uses the repo's Vietnamese format (`**Chức năng:**`, `**Input:**`,
  `**Output:**`, `@example`, `**Unit test:**`); copy a neighbouring function. Say *why*, and mark what
  is not verified.
- Conventional Commits in English: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `build:`.
- User-visible changes need a `.changeset/*.md` file.
- Match the surrounding code; do not reformat unrelated files.

## Before you finish

1. `npm run check` is green.
2. New exports have no-op twins; new strings exist in `vi` and `en`.
3. Docs that describe the behaviour you changed are updated (`README.md`, `docs/`).
4. Your summary states what was tested on a device and what was only tested by jest.

More: [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) ·
[docs/security-privacy.md](docs/security-privacy.md) · [llms.txt](llms.txt)
