import { startCapture } from 'react-native-shake-devtools/capture';
import { BUILD_LABEL, DEVTOOLS_ENABLED } from './devtools-config';
import { asyncStorageLogStore } from './log-store';

/*
 * Chạy ở module scope, import từ dòng đầu của `index.js`. Bật trong `useEffect` thì muộn: effect
 * chạy sau lần render đầu, mà request sớm nhất của app bắn đi ngay lúc đó.
 *
 * `persist` lưu mọi dòng lỗi + 50 dòng cuối xuống kho theo phiên. Gặp lỗi fatal thì ghi ngay,
 * nên app crash xong mở lại vẫn có hàng "Phiên trước" và dải crash trong panel.
 */
startCapture({
  enabled: DEVTOOLS_ENABLED, // bắt buộc; khác `true` thì không vá gì, không ghi đĩa
  persist: { store: asyncStorageLogStore, build: BUILD_LABEL },
  // Tên bí mật riêng của app, thêm vào luật che có sẵn. Ngữ cảnh app của example có khoá này, để thấy
  // trên máy nó ra `<redacted>` trong ticket và `context.json`.
  redactKeys: ['customerRef'],
});
