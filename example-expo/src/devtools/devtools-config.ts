import { Platform } from 'react-native';
import type { DevToolsConfig } from 'react-native-shake-devtools/plain';
import { type AppContextMode, exampleAppContext } from './app-context';
import { captureScreen } from './capture-screen';
import { APP_VERSION, BUILD_LABEL, DEVTOOLS_ENABLED } from './devtools-env';
import { exportFile, writeTempFile } from './files';
import { expoSecureStore } from './secure-store';
import { shareFiles } from './share-files';

const deviceName = (): string =>
  Platform.OS === 'android'
    ? `${Platform.constants.Manufacturer} ${Platform.constants.Model}`
    : Platform.OS === 'ios'
      ? Platform.isPad
        ? 'iPad'
        : 'iPhone'
      : Platform.OS;

/** Module-scope, so its reference stays the same however often the config is built. */
const sessionInfo = () => ({
  appVersion: APP_VERSION,
  env: 'EXPO EXAMPLE',
  device: deviceName(),
  os: `${Platform.OS} ${Platform.Version}`,
  // A real app masks this before it gets here; the library does not mask it again.
  user: '***123 · demo',
});

/**
 * Panel configuration for the selected app context mode (the panel row **App context
 * (example)**, see `use-example-actions.ts`), so the mode is a parameter and `App` memoises the
 * result on it.
 *
 * Every adapter is a module-scope constant, so it keeps the same reference each time the config
 * is built (the gate builds the connection store once, keyed on `secureStore`). Only
 * `appContext` is a new function per mode; the library reads the latest one when it creates a
 * draft.
 *
 * The `bugReport` block turns on **Report a bug** (first row of the panel). Each function is an
 * Expo module supplied by the app; the library pulls in no native module. Connections are not set
 * in code: the tester creates one on the device (panel › Report a bug › connection › Webhook) and
 * types the URL there; it is stored through `expoSecureStore`.
 */
export const buildDevToolsConfig = (contextMode: AppContextMode): DevToolsConfig => ({
  enabled: DEVTOOLS_ENABLED, // required, no default; see devtools-env.ts
  subtitle: BUILD_LABEL,
  locale: 'en',
  exportFile,
  sessionInfo,
  bugReport: {
    captureScreen,
    secureStore: expoSecureStore,
    shareFiles,
    writeTempFile,
    // The app's own context: the ticket's "App context" section + `context.json`. Fake data, no
    // native module (app-context.ts).
    appContext: exampleAppContext(contextMode, APP_VERSION),
  },
});
