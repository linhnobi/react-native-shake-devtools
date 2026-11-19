# Contributing

Thanks for helping. This library is small, has no runtime dependencies and runs inside other people's
apps, so changes are held to a high bar for safety and for keeping the production no-op in sync. This
page tells you how to get set up and which conventions a pull request has to follow.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). To report a vulnerability, do
**not** open an issue; follow [SECURITY.md](SECURITY.md).

Looking for something to start with? See [docs/good-first-issues.md](docs/good-first-issues.md).
If you are an AI coding agent, read [AGENTS.md](AGENTS.md).

## Development setup

You need Node `^20.19.4 || ^22.13 || >=24.3` (the `engines.node` field, which follows React Native 0.86).

```bash
git clone https://github.com/linhnobi/react-native-shake-devtools.git
cd react-native-shake-devtools
npm ci
npm run check      # typecheck + jest in CI mode; must be green before you open a PR
```

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` over `src/` (tests included), then the library code again with `lib: DOM` (`tsconfig.dom.json`), as an Expo app that reads `src/` sees it |
| `npm test` | jest (pass `--watch` while iterating) |
| `npm run test:ci` | jest in CI mode |
| `npm run check` | typecheck then `test:ci`; this is what CI runs on the pinned React Native 0.86 |
| `npm run check:consumer` | builds and packs the package, installs the tarball into a temporary app and type-checks it the way a strict app does; see below |
| `npm run changeset` | add a changeset for a user-visible change (see below) |

CI (`.github/workflows/check.yml`) also runs the suite on the lowest and newest supported React
Native, React, Reanimated, gesture-handler and gorhom versions listed in the compatibility table.

`npm run check:consumer` (`scripts/check-consumer.mjs`, also a CI job) checks what `npm run check`
cannot see: the packed `lib/typescript/*.d.ts` read by an app's own tsc with `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `skipLibCheck: false`, under `bundler`,
`nodenext` and the `@react-native/typescript-config` preset; the no-op entries against the real ones;
and every `exports` entry through Node's `import` and `require`. It needs the npm registry and takes
about two minutes, most of it `npm install`. The code it type-checks is in
`scripts/consumer-fixture/`; when you add or change a public API, use it there the way the README
does. Pass `-- --keep` to keep the temporary app.

## Try your change on a device

Shake detection, the keyboard inside the sheet, the share tray and persisted sessions cannot be tested
by jest. The [`example/`](example/README.md) app is a React Native 0.86 app that loads `../src`
directly through Metro, so edits show up with Fast Refresh and there is no build step for the library.

```bash
cd example
npm install
npm run android:release   # JS is embedded, shaking opens the panel, no Metro needed
npm start                 # or a debug build: Metro here, `npm run android` in another terminal
```

On iOS use `npm run pods` once, then `npm run ios -- --device`. The example README has a checklist of
what to try on a real device. Say in your PR which devices and OS versions you tested on; "jest only"
is fine for logic changes, but say so.

## Conventions

These are enforced by review and, where noted, by tests.

- **TypeScript, strict.** No `any` without a reason in a comment. `npm run typecheck` must pass.
- **Tests live next to the file** they cover: `foo.ts` has `foo.test.ts`, `Foo.tsx` has
  `Foo.test.tsx`. Behaviour changes come with a test that fails without the change. Use
  `@testing-library/react-native` for components.
- **No runtime dependencies.** `package.json` has no `dependencies`; native packages are optional
  peers. Do not add one. If you think you need a package, open an issue first.
- **No native module in the library.** Anything native (screenshots, secure storage, file sharing,
  writing to disk) is supplied by the app through `DevToolsConfig`. The lib asks, the app provides.
- **No `<Modal>`.** It creates a separate window that `FLAG_SECURE` does not cover. Screens live in the
  existing sheet.
- **No hard-coded colours.** Use the theme (`src/ui/theme.ts`); `no-hardcoded-colors.test.ts` checks it.
- **User-facing strings in both locales.** Add every new string to `src/i18n/vi.ts` and `src/i18n/en.ts`
  (and the `DevToolsStrings` type). Bug-report ticket text follows the connection's `ticketLocale`.
- **The no-op surface rule.** Every export of a public entry (`.`, `./capture`, `./shake`, `./i18n`,
  `./plain`) must have an empty twin in `src/noop/` with the same name and type, because production
  builds swap the real entry for the no-op one. The no-op version must never return raw data (its
  redaction helpers drop everything the real ones would redact). If you forget, `npm run typecheck`
  fails and names the missing export (`src/noop/noop-surface.test.tsx`). Do not import real library
  code from a no-op module (`src/noop/noop-isolation.test.ts`).
- **Secrets and privacy.** Never write a secret to `LogStore`, the log buffer, `console.*` or an error
  string. Anything that leaves the device goes through `src/capture/redact.ts`. Read
  [docs/security-privacy.md](docs/security-privacy.md) before touching capture, connectors or the
  queue. Never add telemetry.
- **JSDoc in the existing format.** Public functions use the Vietnamese format found across `src/`
  (the maintainer's working language; English-only JSDoc is accepted from new contributors and may be
  translated in review):

  ```ts
  /**
   * **Chức năng:** what the function does and why it exists.
   *
   * **Input:** the parameters. **Output:** the return value, including the edge cases.
   *
   * @example
   * ```ts
   * redactBody('{"password":"123"}');  // '{"password":"<redacted>"}'
   * redactBody(undefined);              // edge case: undefined
   * ```
   *
   * **Unit test:** `redact.test.ts` › `redactBody`: how many cases and which.
   */
  ```

  Explain the reason for a decision, not just the mechanics, and mark anything not verified on a
  device as "not verified". The README is held to the same standard.
- **Commit messages** follow Conventional Commits in English (`feat:`, `fix:`, `docs:`, `test:`,
  `chore:`, `build:`), with a scope when useful: `fix(report): ...`.

## Changesets

A change that users can see (feature, fix, behaviour change) needs a changeset:

```bash
npm run changeset
```

Pick the bump (`patch`, `minor`, `major`), write a one-paragraph user-facing summary and commit the
generated `.changeset/*.md` file. Docs-only and internal changes do not need one.

## Pull requests

1. Fork, branch from `main`, keep the change focused.
2. Run `npm run check`.
3. Fill in the pull request template: what changed, why, how you tested it, and which platforms.
4. Be ready to explain any new export (and its no-op twin), new string (both locales) or new
   permission the app has to grant.

## Reporting bugs and requesting features

Use the issue templates. For a bug, include the React Native version, whether the app is bare or
Expo, the platform and device, and which entry you import (`.` or `./plain`). Please check that you
are on the latest `main` first.
