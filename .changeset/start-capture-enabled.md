---
'react-native-shake-devtools': minor
---

**Breaking:** `startCapture` now requires `enabled`, with the same rule as `DevToolsConfig.enabled`. Only
`true` starts capture. `false`, a missing key (when called from JavaScript) or another truthy value such
as `'true'` patches nothing, writes nothing to disk and returns an empty stop function. Before, an app
that forgot its own `if (enabled)` guard patched console and HTTP in production builds, and wrote logs
to disk there if `persist` was set. Migrate `if (enabled) startCapture(options)` to
`startCapture({ enabled, ...options })`.
