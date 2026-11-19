/**
 * Babel của repo — chỉ jest đọc file này.
 *
 * App dùng lib (Metro) không đọc nó: Metro transform mọi file, kể cả file trong
 * `node_modules`, bằng config babel ở gốc app. Hàm `'worklet'` của lib (`src/shake/`) vì thế
 * được plugin worklets của app biên dịch.
 *
 * Ở đây cố ý KHÔNG có `react-native-worklets/plugin`: `detect-shake.ts` là hàm thuần, test phải
 * chạy nó như JS thường. Có plugin thì hàm bị biến thành worklet và test đo sai thứ.
 */
module.exports = {
  presets: ['module:@react-native/babel-preset'],
};
