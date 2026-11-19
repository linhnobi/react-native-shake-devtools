/**
 * Cấu hình jest của repo.
 *
 * Những điểm preset RN không lo sẵn:
 *
 * 1. `resolver`: thêm luật cho `react-native-worklets` / reanimated (lý do ở `jest.resolver.js`).
 * 2. `transformIgnorePatterns`: preset chỉ transform `react-native` và `@react-native/*`.
 *    `gesture-handler`, `reanimated`, `worklets`, `safe-area-context` phát hành ESM hoặc TS
 *    nguồn; thiếu chúng thì suite đỏ ở dòng import ("Unexpected token 'export'"), không phải
 *    ở assertion. `@gorhom/bottom-sheet` vì `mock.js` của nó (mock của lib dựa vào) có JSX ở
 *    bản 5.1.x.
 * 3. `testMatch`: chỉ nhận `*.test.*` / `*.spec.*`, nên file dữ liệu mẫu cạnh test không bị coi
 *    là suite. Glob **không** mở đầu bằng `<rootDir>`: trên Windows jest dán đường dẫn tuyệt đối
 *    vào glob, và thư mục bắt đầu bằng dấu chấm (vd worktree trong `.claude\worktrees\…`) thành
 *    `\.claude` — glob đọc `\.` là dấu chấm thoát, mất dấu phân cách, nên jest báo "No tests
 *    found" và thoát mã 1. Phạm vi `src/` đã do `roots` giữ.
 * 4. `roots`: jest chỉ quét `src/`. Không khai thì nó quét cả `example/` (thư mục build Android,
 *    Pods), vừa chậm vừa dễ vấp file trùng tên.
 * 5. `preset` theo dòng RN đang cài: từ RN 0.85 preset tách thành gói `@react-native/jest-preset`,
 *    trước đó nằm ngay trong `react-native`. Repo ghim 0.86, nhưng CI cài cả dòng RN thấp nhất
 *    được hỗ trợ để kiểm bảng tương thích (`.github/workflows/check.yml`).
 *
 * Không khai `setupFiles`: khai là THAY mảng của preset (mock lõi RN), không gộp.
 * Mock riêng của repo đăng ký ở `src/test-setup.ts`.
 */
const hasPackage = (name) => {
  try {
    require.resolve(`${name}/package.json`);
    return true;
  } catch {
    return false;
  }
};

const RN_PRESET = hasPackage('@react-native/jest-preset')
  ? '@react-native/jest-preset'
  : 'react-native';

const ESM_PACKAGES = [
  '(jest-)?react-native',
  '@react-native(-community)?',
  'react-native-gesture-handler',
  'react-native-reanimated',
  'react-native-worklets',
  'react-native-safe-area-context',
  '@gorhom/bottom-sheet',
].join('|');

module.exports = {
  preset: RN_PRESET,
  resolver: require.resolve('./jest.resolver.js'),
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  testMatch: ['**/*.(spec|test).[jt]s?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/dist/'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  transformIgnorePatterns: [`node_modules/(?!(${ESM_PACKAGES})/)`],
};
