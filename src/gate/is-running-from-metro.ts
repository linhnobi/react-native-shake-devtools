import { TurboModuleRegistry } from 'react-native';

interface SourceCodeConstants {
  getConstants: () => { scriptURL?: string };
}

/**
 * **Chức năng:** app có đang chạy bundle nạp từ **Metro** không.
 *
 * Đây là cách duy nhất từ JS biết **dev menu của RN đang bật** — mà dev menu cũng mở bằng cú
 * lắc, nên bật cảm biến ở đó là hai lớp cử chỉ phủ chồng nhau.
 *
 * Vì sao không hỏi thẳng thứ khác:
 * - `getUseDeveloperSupport()` (`BuildConfig.DEBUG` và không nhúng bundle) là hàm
 *   **native**, không có đường ra JS.
 * - `__DEV__` **không phân biệt được**: bản giao tester dựng kiểu nhúng sẵn JS (offline bundle)
 *   mà bundle với `--dev true` nên `__DEV__` ở đó cũng là `true`, dù bundle nằm trong APK và dev menu tắt.
 *
 * Đọc qua `TurboModuleRegistry` (root export), **không** deep-import
 * `react-native/Libraries/Core/Devtools/getDevServer`: plugin `warn-on-deep-imports` của RN
 * chèn `console.warn` vào mọi import dạng `react-native/<subpath>`. Cùng đường Reactotron đi.
 *
 * **Input:** không.
 * **Output:** `true` khi `scriptURL` bắt đầu bằng `http`. `false` khi bundle nhúng trong app
 * (`file://` · `assets://`) **và** khi không đọc được module — rơi về an toàn: coi như không
 * có dev menu, tức cảm biến vẫn chạy, thà thừa một cửa còn hơn mất cửa duy nhất.
 *
 * @example
 * ```ts
 * isRunningFromMetro();   // true  — chạy từ Metro (`npx react-native start`)
 * isRunningFromMetro();   // false — bản nhúng sẵn JS, bundle `--dev true` (ca biên: __DEV__ vẫn true)
 * ```
 *
 * **Unit test:** `is-running-from-metro.test.ts` › `isRunningFromMetro` — 3 case: `scriptURL`
 * http ⇒ true · `file://` ⇒ false · module vắng ⇒ false và **không ném**.
 */
export const isRunningFromMetro = (): boolean => {
  try {
    const scriptURL =
      TurboModuleRegistry.get<SourceCodeConstants>('SourceCode')?.getConstants()
        .scriptURL;
    return typeof scriptURL === 'string' && scriptURL.startsWith('http');
  } catch {
    return false;
  }
};
