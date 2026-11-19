import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { DevToolsExportFile } from 'react-native-shake-devtools/plain';

/**
 * Safe file name for the cache folder: characters outside `[A-Za-z0-9._-]` become `_` and a
 * leading dot is replaced, so `..` or `a/../b` can never write outside the cache.
 */
const safeFileName = (name: string): string =>
  name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') || 'file';

/**
 * `bugReport.writeTempFile`: UTF-8 text → a file in the app cache, returns its `file://` URI.
 *
 * The send path passes a name unique per report (`<reportId>-errors.txt`); writing the same name
 * again overwrites it (same report sent again). `File.write()` is asynchronous since
 * `expo-file-system` 58 and creates the file when it is missing. Not verified on device.
 */
export const writeTempFile = async (name: string, content: string): Promise<string> => {
  const file = new File(Paths.cache, safeFileName(name));
  await file.write(content);
  return file.uri;
};

/**
 * `DevToolsConfig.exportFile` (the **Export errors** button of the log screen): one masked text
 * file to the system share sheet. Closing the sheet without picking anything resolves, which is
 * what the library expects. Not verified on device.
 */
export const exportFile = async (file: DevToolsExportFile): Promise<void> => {
  const uri = await writeTempFile(file.name, file.content);
  await Sharing.shareAsync(uri, { mimeType: file.mimeType, dialogTitle: file.name });
};
