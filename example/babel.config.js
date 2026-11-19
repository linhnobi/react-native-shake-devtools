/**
 * Babel của app example. Metro dùng file này cho cả `../src` của lib.
 *
 * `react-native-worklets/plugin` phải đứng CUỐI mảng `plugins` (luật của reanimated 4). Nó biên
 * dịch hàm `'worklet'` của lib (`src/shake/`) để chạy trên UI thread.
 */
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: ['react-native-worklets/plugin'],
};
