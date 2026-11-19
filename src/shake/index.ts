/**
 * Entry `react-native-shake-devtools/shake` — **headless**: bắt cú lắc, không vẽ gì, không có text nào.
 *
 * Dùng entry này khi chỉ cần *"lắc máy → chạy hàm X"*. Nó không kéo `@gorhom/bottom-sheet` lẫn
 * `react-native-safe-area-context` vào đồ thị module, nên một thư viện khác import được mà không
 * ôm theo cả tầng UI.
 *
 * Cần luôn cả panel gỡ lỗi (sheet + danh sách hành động) thì dùng entry `.` (sheet gorhom) hoặc
 * `./plain` (sheet RN lõi, không gorhom/gesture-handler) thay vì entry này.
 */

export { createShakeState, stepShake } from './detect-shake';
export type {
  ShakeConfig,
  ShakeSample,
  ShakeState,
  ShakeStep,
} from './detect-shake';

export {
  DEFAULT_SHAKE_CONFIG,
  SAMPLE_INTERVAL_MS,
  resolveShakeConfig,
} from './shake-config';

export { useShake } from './use-shake';
