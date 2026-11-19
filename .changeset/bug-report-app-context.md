---
'react-native-shake-devtools': minor
---

Bug reports can carry your app's own context. Add `bugReport.appContext`, a sync or async callback
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
