const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro của app example — nạp thẳng `../src` của lib, không qua bước build nào.
 *
 * Gốc repo có `node_modules` riêng (jest + tsc của lib), trong đó cũng có `react`,
 * `react-native`, `react-native-reanimated`… Để Metro với tới đó thì bundle mang HAI bản React
 * và app chết ngay lúc mở (hook gọi sai bản, reanimated đăng ký hai lần). Ba dòng dưới giữ đúng
 * một bản, là bản của example:
 *
 * 1. `blockList` chặn cả `node_modules` ở gốc repo. File trong `../src` dò `react` lên các thư
 *    mục cha thì không thấy gì.
 * 2. `nodeModulesPaths` cho mọi file (cả `../src`) tra tiếp vào `example/node_modules`.
 * 3. `extraNodeModules` trỏ tên gói `react-native-shake-devtools` về gốc repo. Metro đọc
 *    `exports` trong `package.json` của lib, nên các entry phụ (`/shake`, `/capture`, `/i18n`)
 *    cũng chạy như khi cài từ npm. Điều kiện `react-native` của `exports` trỏ `src/`, nên không
 *    cần `npm run build`; có `lib/` thì Metro cũng không đụng tới.
 *
 * Babel: Metro dùng `babel.config.js` của example cho MỌI file nó biến đổi, kể cả `../src`. Hàm
 * `'worklet'` của lib vì thế được plugin worklets của example biên dịch. `babel.config.js` ở gốc
 * repo chỉ dành cho jest.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const root = path.resolve(__dirname, '..');
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const defaultConfig = getDefaultConfig(__dirname);
const defaultBlockList = defaultConfig.resolver.blockList;

const config = {
  watchFolders: [root],
  resolver: {
    blockList: [
      ...(Array.isArray(defaultBlockList)
        ? defaultBlockList
        : [defaultBlockList]),
      new RegExp(`^${escapeRegExp(path.join(root, 'node_modules'))}[\\\\/].*$`),
    ].filter(Boolean),
    nodeModulesPaths: [path.join(__dirname, 'node_modules')],
    extraNodeModules: {
      'react-native-shake-devtools': root,
    },
  },
};

module.exports = mergeConfig(defaultConfig, config);
