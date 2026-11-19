---
'react-native-shake-devtools': patch
---

Render errors with no error boundary are now captured as fatal on React Native 0.81 and later.

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
