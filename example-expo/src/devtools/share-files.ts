import * as Sharing from 'expo-sharing';
import type { DevToolsShareFile } from 'react-native-shake-devtools/plain';
import { writeTempFile } from './files';

/**
 * `bugReport.shareFiles` with Expo modules only (`docs/recipes/expo.md` § 4, option a).
 *
 * `expo-sharing` shares **one** file per call and takes no message, and the library promises never
 * to drop the screenshot silently, so this opens one share sheet per file, in order: the message
 * as `bug-report.txt`, then the screenshot (already a file, `uri`), then the text files (written to
 * the cache first).
 *
 * ⚠️ Not verified on device: on Android `shareAsync` may resolve before the sheet closes, in which
 * case the sheets stack. A single sheet for every file needs `react-native-share`, which is not in
 * Expo Go (development build only; recipe option b).
 */
export const shareFiles = async (
  files: readonly DevToolsShareFile[],
  message: string,
): Promise<void> => {
  const all: DevToolsShareFile[] = [
    { name: 'bug-report.txt', mimeType: 'text/plain', content: message },
    ...files,
  ];
  for (const file of all) {
    const uri = file.uri ?? (await writeTempFile(file.name, file.content ?? ''));
    await Sharing.shareAsync(uri, { mimeType: file.mimeType, dialogTitle: file.name });
  }
};
