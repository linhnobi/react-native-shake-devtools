import * as SecureStore from 'expo-secure-store';
import type { DevToolsSecureStore } from 'react-native-shake-devtools/plain';

/**
 * `expo-secure-store` only accepts keys matching `/^[\w.-]+$/`. The library's keys
 * (`devtools.connections.v1`, `devtools.secret.<id>`, `devtools.lastConnection`) already do;
 * any other character is escaped to be safe.
 */
const safeKey = (key: string): string =>
  key.replace(/[^\w.-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);

/** Not carried to another device by a backup: the library handles an empty store (reinstall). */
const WRITE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * `DevToolsSecureStore` on `expo-secure-store` (Keychain on iOS, Keystore-encrypted values on
 * Android), for `bugReport.secureStore`. It holds the connections QA saves and their secrets (here:
 * the webhook URL and header the tester types in).
 *
 * Must be a module-scope constant: the gate builds the connection store once, keyed on this
 * reference. Copied from `docs/recipes/expo.md` § 4. Not verified on device.
 */
export const expoSecureStore: DevToolsSecureStore = {
  getItem: (key) => SecureStore.getItemAsync(safeKey(key)),
  setItem: (key, value) => SecureStore.setItemAsync(safeKey(key), value, WRITE_OPTIONS),
  removeItem: (key) => SecureStore.deleteItemAsync(safeKey(key)),
};
