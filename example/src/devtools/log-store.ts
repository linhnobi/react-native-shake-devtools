import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import type { LogStore } from 'react-native-shake-devtools/capture';

/**
 * Database AsyncStorage riêng cho nhật ký: `getAllKeys` chỉ thấy khoá của kho này, và xoá kho
 * không đụng dữ liệu khác của app.
 */
const storage = createAsyncStorage('shake-devtools-log');

/** Nội dung một "file" phiên. */
const CONTENT = 'content:';
/** Giờ ghi cuối (mili-giây) của file đó. Tách khoá riêng để `list` không phải đọc cả nội dung. */
const MTIME = 'mtime:';

/**
 * Kho nhật ký của app example, cài `LogStore` bằng AsyncStorage v3.
 *
 * Lib quyết định ghi gì, khi nào, dọn ra sao (72 giờ · 3 phiên · 1 MB mỗi phiên). Kho chỉ biết
 * đọc · ghi · xoá · liệt kê. App thật nên ghi file vào thư mục cache (vd bằng
 * `react-native-blob-util`): không vào bản sao lưu, và hệ điều hành được dọn khi máy thiếu chỗ.
 * Example dùng AsyncStorage để bớt một native module.
 */
export const asyncStorageLogStore: LogStore = {
  list: async () => {
    const keys = (await storage.getAllKeys()).filter(k => k.startsWith(MTIME));
    if (keys.length === 0) return [];
    const mtimes = await storage.getMany(keys);
    return keys.map(k => ({
      name: k.slice(MTIME.length),
      modifiedAt: Number(mtimes[k] ?? 0),
    }));
  },
  read: async name => {
    const content = await storage.getItem(CONTENT + name);
    if (content === null) throw new Error(`Log file not found: ${name}`);
    return content;
  },
  write: (name, content) =>
    storage.setMany({
      [CONTENT + name]: content,
      [MTIME + name]: String(Date.now()),
    }),
  remove: name => storage.removeMany([CONTENT + name, MTIME + name]),
};
