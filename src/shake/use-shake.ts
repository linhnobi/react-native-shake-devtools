import { useCallback, useEffect, useRef } from 'react';
import {
  SensorType,
  runOnJS,
  useAnimatedReaction,
  useAnimatedSensor,
  useSharedValue,
} from 'react-native-reanimated';
import { createShakeState, stepShake, type ShakeConfig } from './detect-shake';
import { SAMPLE_INTERVAL_MS } from './shake-config';

/**
 * **Chức năng:** đăng ký cảm biến gia tốc và gọi `onShake` mỗi khi nhận ra một cú lắc.
 *
 * Hook **không** có công tắc bật/tắt, và đó là chủ ý: muốn ngừng nghe thì **tháo component
 * chứa nó**. `useAnimatedSensor` đăng ký lúc mount và `unregister` lúc unmount, còn gọi
 * `unregister()` thủ công thì không có đường đăng ký lại — nên một prop `enabled` sẽ là cái
 * bẫy tắt-được-mà-không-bật-lại-được.
 *
 * **Input:** `onShake` — **không cần ổn định**, hook tự giữ tham chiếu mới nhất qua ref ·
 * `config` — bộ tham số đã trộn, xem `resolveShakeConfig`.
 * **Output:** `boolean` — máy **có** cảm biến gia tốc hay không. `false` ⇒ cửa lắc câm, và
 * gọi là app buộc phải có đường vào dự phòng (vd chạm 7 lần vào dòng phiên bản ở Cài đặt).
 *
 * @example
 * ```tsx
 * const available = useShake(() => setOpen(true), resolveShakeConfig());
 * // Ca biên: máy không có cảm biến ⇒ available === false, onShake KHÔNG bao giờ được gọi
 * ```
 *
 * **Unit test:** `use-shake.test.ts` › `useShake` — 4 case: trả đúng `isAvailable` của sensor ·
 * `stepShake` nhận đúng `x/y/z` của mẫu · `fired` ⇒ gọi `onShake` đúng một lần · đổi `onShake`
 * giữa chừng thì lần bắn sau gọi hàm MỚI (không giữ closure cũ).
 */
export const useShake = (onShake: () => void, config: ShakeConfig): boolean => {
  const { sensor, isAvailable } = useAnimatedSensor(SensorType.ACCELEROMETER, {
    interval: SAMPLE_INTERVAL_MS,
  });
  const state = useSharedValue(createShakeState());

  /*
    `runOnJS` bắt hàm vào closure của worklet, nên nó cần một tham chiếu ỔN ĐỊNH. Ref giữ bản
    mới nhất của `onShake`, `fire` là vỏ bọc không bao giờ đổi ⇒ worklet không phải dựng lại
    mỗi lần cha render, và cũng không gọi nhầm closure cũ.
  */
  const latest = useRef(onShake);
  useEffect(() => {
    latest.current = onShake;
  });
  const fire = useCallback(() => {
    latest.current();
  }, []);

  useAnimatedReaction(
    () => sensor.value,
    (reading) => {
      'worklet';
      const step = stepShake(
        state.value,
        /*
          `Date.now()` chứ không phải `performance.now()`: đây là runtime worklet của
          Reanimated, và `Date.now` là global Hermes chắc chắn có ở đó, còn `performance`
          thì không có gì bảo đảm. Đồng hồ tường trôi/nhảy không ảnh hưởng: thuật toán chỉ
          dùng HIỆU trong khoảng dưới 2 giây.
        */
        { t: Date.now(), x: reading.x, y: reading.y, z: reading.z },
        config,
      );
      state.value = step.state;
      if (step.fired) {
        runOnJS(fire)();
      }
    },
    [config],
  );

  return isAvailable;
};
