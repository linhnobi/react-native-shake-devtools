/**
 * Entry `react-native-shake-devtools/noop/shake` — bản **rỗng** của `react-native-shake-devtools/shake`.
 *
 * **Chức năng:** cùng tên export, cùng kiểu với entry thật; `useShake` không đăng ký cảm biến nào
 * và **không** kéo `react-native-reanimated`. Luật chọn giá trị trả về: xem đầu `noop/capture.ts`.
 *
 * `createShakeState` · `stepShake` giữ chỉ thị `'worklet'` như bản thật: app nào tự gọi chúng
 * trong worklet của mình (cảm biến riêng) thì ở bản noop vẫn không nổ "non-worklet function on the
 * UI thread" — plugin worklets của app biên dịch cả file này.
 *
 * **Input:** như entry thật. **Output:** `useShake` ⇒ `false` (không bao giờ đang lắc) ·
 * `stepShake` ⇒ không bao giờ `fired` · hằng giữ đúng giá trị bản thật.
 *
 * @example
 * ```ts
 * useShake(openPanel, config);   // false — không nghe cảm biến, `openPanel` không bao giờ được gọi
 * stepShake(s, sample, config);  // { state: s, fired: false } — ca biên: trả lại đúng `state` vào
 * ```
 *
 * **Unit test:** `noop-surface.test.ts` · `noop-isolation.test.ts`.
 */
import { Platform } from 'react-native';
import type * as Real from '../shake';

export type { ShakeConfig, ShakeSample, ShakeState, ShakeStep } from '../shake';

export const SAMPLE_INTERVAL_MS: typeof Real.SAMPLE_INTERVAL_MS = 50;

/** Giữ đúng ngưỡng của bản thật (`shake-config.ts`) — `noop-surface.test.ts` so hai bên. */
export const DEFAULT_SHAKE_CONFIG: typeof Real.DEFAULT_SHAKE_CONFIG = {
  threshold: Platform.OS === 'ios' ? 7 : 12,
  releaseRatio: 0.4,
  sustainMs: 400,
  cooldownMs: 2000,
  baselineAlpha: 0.1,
};

export const resolveShakeConfig: typeof Real.resolveShakeConfig = () => DEFAULT_SHAKE_CONFIG;

export const createShakeState: typeof Real.createShakeState = () => {
  'worklet';
  return {
    baseline: -1,
    activeSince: Number.NEGATIVE_INFINITY,
    firedAt: Number.NEGATIVE_INFINITY,
  };
};

export const stepShake: typeof Real.stepShake = (state) => {
  'worklet';
  return { state, fired: false };
};

export const useShake: typeof Real.useShake = () => false;
