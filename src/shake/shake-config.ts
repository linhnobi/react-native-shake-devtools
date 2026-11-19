import { Platform } from 'react-native';
import type { ShakeConfig } from './detect-shake';

/**
 * Nhịp lấy mẫu — 20 Hz. Đủ dày để thấy 3 lần đảo chiều trong 1 giây, và thưa hơn `'auto'`
 * của Reanimated (60–120 Hz) nhiều lần, tức ít tốn pin hơn đúng ngần đó.
 */
export const SAMPLE_INTERVAL_MS = 50;

/**
 * Ngưỡng mặc định theo nền tảng — **cả hai bậc giờ đều là số ĐO trên máy thật.**
 *
 * Hai nền lệch nhau **cả một bậc độ lớn**, và lệch ngược hướng với phỏng đoán ban đầu: cùng
 * một cú lắc dứt khoát, độ lệch so với nền có trung vị **27,8 m/s² trên Android** nhưng chỉ
 * **1,68 trên iOS** (đỉnh thì vẫn cao: p90 = 14,9 · max 33,6). Lý do là trọng lực: iOS trả
 * gia tốc **thô**, nên `|a|` dao động quanh 9,7 và phần lớn mẫu trong một cú lắc nằm **gần
 * nền**, chỉ các đỉnh mới vọt lên. Vì vậy bậc iOS phải thấp hơn Android, không phải cao hơn.
 *
 * 🔴 Cái giết cú lắc trên iOS không phải đỉnh mà là [`sustainMs`](#DEFAULT_SHAKE_CONFIG):
 * tín hiệu iOS dao động qua lại nên độ lệch liên tục rơi xuống dưới vạch nhả
 * (`releaseRatio × threshold`), `activeSince` bị đặt lại trước khi đủ 400 ms. Đo 14/9/2026:
 * với `threshold: 10` cũ thì **không cú lắc nào bắn**, kể cả cú có đỉnh 33,6 m/s².
 *
 * App override được qua `DevToolsConfig.shake` mà không phải sửa lib — đó là lý do bảng này
 * là *mặc định*, không phải hằng khoá cứng.
 */
export const DEFAULT_SHAKE_CONFIG: ShakeConfig = {
  /*
    ✅ **ĐÃ ĐO trên máy thật** (SM-M346B1 · Android 14 · 14/9/2026, 261 mẫu của một cú lắc
    thật): độ lệch khi lắc có p10 = 5,6 · **trung vị 27,8** · p90 = 72 · max 112 m/s².
    Đi bộ cầm máy nằm ở ~3–4. Ngưỡng 12 nằm giữa hai vùng đó, cách xa cả hai đầu.

    Đây là con số ĐO, không còn là con số suy như bản 9 trước đó.

    ✅ **ĐÃ ĐO trên máy thật** (iPhone 12 · iOS 26.2.1 · 14/9/2026): một cú lắc dứt khoát 9 s
    cho độ lệch p10 = 0,12 · trung vị 1,68 · p90 = 14,9 · max 33,6 m/s²; máy nằm yên 35 s cho
    max **0,45**. Chuỗi gia tốc thô được ghi lại rồi chạy `stepShake` mô phỏng ở mọi bậc — kết
    quả: ngưỡng ≥ 10 **không bao giờ bắn**, 8–9 bắn muộn (4,9–5,3 s, tức phải lắc 5 giây),
    4–7 bắn trong 1,8–2,2 s. Chọn **7**: bắn sau 2,2 s và vẫn cách vùng máy-nằm-yên 15 lần.

    ✅ **Verify END-TO-END trên chính máy đó**: tạm bỏ điều kiện `!fromMetro` của `DevToolsGate`
    (đẩy bằng Fast Refresh, revert ngay sau đó) rồi lắc thật — panel tự bật, không phải chạm gì.
    Tức số này đã đi hết đường dây cảm biến → `stepShake` → gate, không chỉ đúng trên mô phỏng.

    ⚠️ Ca **đi bộ cầm máy** của iOS thì CHƯA đo được (ba lượt thử đều rơi đúng lúc máy nằm
    yên hoặc app tụt xuống nền — iOS dừng CoreMotion khi app không active, nên cửa sổ đo hẹp).
    Nếu QA thấy panel tự mở lúc đi lại, đây là con số phải nâng trước tiên; vùng an toàn còn
    tới 8–9 mà không mất khả năng bắn.
  */
  threshold: Platform.OS === 'ios' ? 7 : 12,
  /** 0,4 — vùng đệm, xem `ShakeConfig.releaseRatio`. */
  releaseRatio: 0.4,
  /** 400 ms ≈ 5 mẫu ở nhịp thật 83 ms. Một cú xóc kéo ~150 ms nên không với tới. */
  sustainMs: 400,
  cooldownMs: 2000,
  baselineAlpha: 0.1,
};

/**
 * **Chức năng:** trộn phần app khai đè lên bảng mặc định của nền tảng đang chạy.
 *
 * **Input:** `overrides` — khai thiếu khoá nào thì khoá đó lấy mặc định; `undefined` ⇒ lấy
 * nguyên [`DEFAULT_SHAKE_CONFIG`](#DEFAULT_SHAKE_CONFIG).
 * **Output:** `ShakeConfig` đủ 5 khoá, luôn là **object mới** (không chia sẻ tham chiếu với
 * hằng mặc định, nên caller nhét vào deps của hook được mà không sợ mutate chéo).
 *
 * @example
 * ```ts
 * resolveShakeConfig();                      // { threshold: 12, releaseRatio: 0.4, … } trên Android (iOS: 7)
 * resolveShakeConfig({ sustainMs: 600 });    // chỉ đổi thời lượng giữ, 4 khoá kia giữ mặc định
 * resolveShakeConfig({});                    // ca biên: object rỗng ≡ undefined
 * resolveShakeConfig({ threshold: undefined }); // ca biên: khoá khai `undefined` ≡ không khai
 * ```
 *
 * ⚠️ Khoá mang giá trị `undefined` bị **bỏ** trước khi trộn: `exactOptionalPropertyTypes` đang
 * tắt nên `{ threshold: undefined }` qua được typecheck, và spread thẳng thì nó **đè** mặc định
 * bằng `undefined` — ngưỡng thành `NaN` khi so sánh, cảm biến không bao giờ bắn.
 *
 * **Unit test:** `shake-config.test.ts` › `resolveShakeConfig` — 4 case: `undefined` trả đủ 5
 * khoá · override một khoá không đụng bốn khoá kia · object rỗng ≡ `undefined` · trả object
 * mới chứ không phải chính hằng mặc định.
 */
export const resolveShakeConfig = (
  overrides?: Partial<ShakeConfig>,
): ShakeConfig => ({
  ...DEFAULT_SHAKE_CONFIG,
  ...Object.fromEntries(
    Object.entries(overrides ?? {}).filter(([, v]) => v !== undefined),
  ),
});
