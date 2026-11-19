import { startCapture } from 'react-native-shake-devtools/capture';
import { BUILD_LABEL, DEVTOOLS_ENABLED } from './devtools-env';
import { fileLogStore } from './log-store';

/*
 * Runs at module scope, imported on the first line of `index.ts`. In a `useEffect` it would be too
 * late: effects run after the first render, and the app's first requests go out before that.
 *
 * Expo's Metro config runs `expo/build/winter` before the main module, so the global `fetch` is
 * already `expo/fetch` here (SDK 58) and `startCapture` wraps it as well as `XMLHttpRequest`.
 *
 * `persist` writes every error line plus the last 50 lines per session to `fileLogStore`, right
 * away on a fatal error, so after a crash the next launch shows "Previous session" in the panel.
 * It also has to run before `DevToolsGate` mounts: the gate takes the store once, for the bug
 * report send queue.
 */
startCapture({
  enabled: DEVTOOLS_ENABLED, // required; anything but `true` patches nothing and writes nothing
  persist: { store: fileLogStore, build: BUILD_LABEL },
  // An app-specific secret name, added to the built-in rules. The example's app context has this
  // key, so on the device it comes out as `<redacted>` in the ticket and in `context.json`.
  redactKeys: ['customerRef'],
});
