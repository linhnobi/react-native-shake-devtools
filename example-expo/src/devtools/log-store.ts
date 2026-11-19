import { Directory, File, Paths } from 'expo-file-system';
import type { LogStore } from 'react-native-shake-devtools/capture';

/**
 * Own folder in the app cache: not backed up, and the OS may clear it when the device runs low on
 * space. `list` only sees this folder, so clearing it touches nothing else of the app.
 */
const folder = new Directory(Paths.cache, 'shake-devtools-log');

/**
 * `LogStore` on `expo-file-system` (`File`/`Directory` API), for `startCapture({ persist })`.
 *
 * The library decides what to write, when, and what to clean up (72 hours · 3 sessions · 1 MB per
 * session); the store only lists, reads, writes and removes files. The send queue of the bug
 * report (`report-queue.json`) goes through the same store.
 *
 * `File.write()` is asynchronous since `expo-file-system` 58 (SDK 58) and creates the file when it
 * is missing; the folder has to exist first.
 *
 * Not verified on device.
 */
export const fileLogStore: LogStore = {
  list: async () => {
    if (!folder.exists) return [];
    return folder
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .map((file) => ({ name: file.name, modifiedAt: file.lastModified ?? 0 }));
  },
  read: (name) => new File(folder, name).text(),
  write: async (name, content) => {
    folder.create({ intermediates: true, idempotent: true });
    await new File(folder, name).write(content);
  },
  remove: async (name) => {
    const file = new File(folder, name);
    if (file.exists) file.delete();
  },
};
