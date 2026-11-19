import {
  getGenericPassword,
  resetGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import type { DevToolsSecureStore } from 'react-native-shake-devtools';

/** Tiền tố `service` của mọi mục lib lưu, để không đụng mục Keychain khác của app. */
const SERVICE_PREFIX = 'shake-devtools:';

/**
 * Kho bảo mật của app example, cài `DevToolsSecureStore` bằng `react-native-keychain`.
 *
 * **Chức năng:** lib lưu danh sách kết nối và bí mật của QA (token Jira, webhook Slack…) qua kho
 * này. Mỗi khoá là **một mục generic password riêng**, `service = 'shake-devtools:<key>'`, nên
 * xoá một khoá không động tới khoá khác. Keychain (iOS) và Keystore (Android) mã hoá giá trị.
 *
 * **Input:** `getItem(key)` · `setItem(key, value)` · `removeItem(key)`.
 *
 * **Output:** `getItem` trả `null` khi chưa có khoá (Keychain trả `false`). Máy vừa khôi phục
 * hoặc app vừa cài lại cũng trả `null`; lib xử lý ca đó ở phía nó.
 *
 * 📌 Phải là **hằng ở module scope**: gate dựng kho kết nối một lần theo tham chiếu `secureStore`.
 *
 * @example
 * const bugReport = { secureStore: keychainSecureStore };
 *
 * **Unit test:** không có; example kiểm tay trên máy thật.
 */
export const keychainSecureStore: DevToolsSecureStore = {
  getItem: async key => {
    const found = await getGenericPassword({ service: SERVICE_PREFIX + key });
    return found ? found.password : null;
  },
  setItem: async (key, value) => {
    const saved = await setGenericPassword(key, value, {
      service: SERVICE_PREFIX + key,
    });
    if (!saved) throw new Error(`Keychain refused to store "${key}"`);
  },
  removeItem: async key => {
    await resetGenericPassword({ service: SERVICE_PREFIX + key });
  },
};
