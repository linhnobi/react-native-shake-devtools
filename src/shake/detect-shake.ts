/**
 * Nhận biết "đang lắc máy" từ chuỗi mẫu gia tốc — **hàm thuần**: không biết Reanimated,
 * không biết React, không giữ state ngoài, không import gì.
 *
 * ## Vì sao tách hẳn khỏi hook
 *
 * Đây là phần DUY NHẤT có phép đo, và cũng là phần khó chạm nhất nếu để trong worklet:
 * chạy trên luồng UI, không breakpoint, không log. Tách ra thì mọi hành vi kiểm được bằng
 * chuỗi mẫu tổng hợp trong jest, còn hook chỉ còn việc nối dây.
 *
 * ## 🔴 Đơn vị cảm biến LỆCH giữa hai nền tảng — lý do thuật toán phải tự trừ nền
 *
 * `SensorType.ACCELEROMETER` của Reanimated **không** trả cùng một đại lượng trên hai bên:
 *
 * | | Android | iOS |
 * |---|---|---|
 * | Cảm biến thật | `TYPE_LINEAR_ACCELERATION` | `CMAccelerometerData.acceleration` |
 * | Trọng lực | đã trừ | **còn nguyên** |
 * | Đứng yên đo được | ≈ 0 m/s² | ≈ 9,81 m/s² |
 *
 * Nguồn: `ReanimatedSensorType.kt` khai `ACCELEROMETER(Sensor.TYPE_LINEAR_ACCELERATION)`;
 * `ReanimatedSensor.m` gọi `startAccelerometerUpdates` rồi nhân `9.81`.
 *
 * ⇒ Ngưỡng tuyệt đối kiểu `magnitude > 15` đúng một bên, sai bên kia. Module này **mồi đường
 * nền từ chính mẫu đầu tiên** rồi chỉ xét ĐỘ LỆCH so với nền — cùng một cú lắc vật lý cho cùng
 * một phán quyết trên cả hai. Đó cũng là thứ test khoá: khoá **quan hệ**, không khoá số.
 *
 * ## `'worklet'` ở đây có tác dụng gì
 *
 * Metro transform file này bằng `.babelrc.js` của app (phải có `react-native-worklets/plugin`).
 * Trong jest thì chỉ thị là chuỗi vô hại và hàm chạy như JS thường, đúng thứ test cần.
 */

/**
 * Một mẫu cảm biến.
 *
 * `t` là mốc thời gian (ms). Hàm chỉ dùng **hiệu** giữa hai mốc, không dùng trị tuyệt đối —
 * nên nguồn đồng hồ là việc của caller và đổi được mà không chạm thuật toán.
 */
export interface ShakeSample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ShakeConfig {
  /** Độ lệch so với nền (m/s²) để coi là **đang bị lắc**. */
  readonly threshold: number;
  /**
   * Ngưỡng **nhả**, theo tỉ lệ của `threshold` (0..1). Trạng thái "đang lắc" chỉ bị huỷ khi
   * độ lệch tụt xuống dưới `threshold × releaseRatio`.
   *
   * Vùng đệm giữa hai ngưỡng (Schmitt trigger) để một mẫu hụt giữa cú lắc không xoá công đã
   * tích — đo trên máy thật: p10 của độ lệch khi lắc là 5,6 m/s², tức có mẫu tụt sâu.
   */
  readonly releaseRatio: number;
  /**
   * Phải **giữ** trạng thái lắc liên tục ngần này (ms) thì mới bắn.
   *
   * 🔴 Tiêu chí theo **thời gian**, không theo số mẫu — đo trên SM-M346B1 14/9/2026: khai
   * `interval: 50` nhưng Android giao mẫu mỗi **~83 ms**. Mọi tiêu chí đếm mẫu vì thế đổi ý
   * nghĩa theo từng máy; tiêu chí thời gian thì không.
   */
  readonly sustainMs: number;
  /** Sau khi bắn, im trong ngần này — chống một cú lắc dài bắn hai lần. */
  readonly cooldownMs: number;
  /** Hệ số làm mượt đường nền (0..1). CHỈ áp cho mẫu yên — xem `stepShake` lớp 2. */
  readonly baselineAlpha: number;
}

export interface ShakeState {
  /** Đường nền của magnitude. `-1` = **chưa mồi** (chưa nhận mẫu nào). */
  readonly baseline: number;
  /** Mốc bắt đầu chuỗi "đang lắc" hiện tại. `-Infinity` = không ở trong chuỗi nào. */
  readonly activeSince: number;
  readonly firedAt: number;
}

export interface ShakeStep {
  readonly state: ShakeState;
  readonly fired: boolean;
}

/**
 * **Chức năng:** dựng state khởi đầu cho [`stepShake`](#stepShake).
 *
 * **Input:** không.
 * **Output:** `ShakeState` với `baseline = -1` (cờ *chưa mồi*) và hai mốc thời gian là
 * `-Infinity` — **không phải `0`**: mốc `0` khiến mọi mẫu có `t` nhỏ rơi vào nhánh "đang
 * nguội" và hàm câm vĩnh viễn khi đồng hồ của test bắt đầu gần 0.
 *
 * @example
 * ```ts
 * const s = createShakeState();
 * s.baseline;                         // -1 — mẫu đầu chỉ để mồi, không phán quyết
 * s.firedAt === Number.NEGATIVE_INFINITY;  // true — không có cooldown giả ở mẫu đầu
 * ```
 *
 * **Unit test:** `detect-shake.test.ts` › `createShakeState` — 2 case: trả state chưa mồi ·
 * hai mốc thời gian là âm vô cùng (ca biên đồng hồ bắt đầu từ 0).
 */
export const createShakeState = (): ShakeState => {
  'worklet';
  return {
    baseline: -1,
    activeSince: Number.NEGATIVE_INFINITY,
    firedAt: Number.NEGATIVE_INFINITY,
  };
};

/**
 * **Chức năng:** nạp **một** mẫu, trả state mới + có phải vừa nhận ra cú lắc không.
 *
 * Bốn lớp chặn dương tính giả, theo thứ tự rẻ → đắt:
 * 1. **Mẫu đầu chỉ mồi nền** — không phán quyết. Thiếu bước này thì trên iOS mẫu đầu lệch
 *    9,81 so với nền `0` và app tự mở panel ngay khi khởi động.
 * 2. **Nền chỉ học từ mẫu YÊN** — đang lắc mà vẫn cập nhật nền thì nền đuổi theo cú lắc và
 *    độ lệch teo dần về 0.
 * 3. **Đòi GIỮ LỆCH liên tục đủ `sustainMs`** — thứ tách "lắc" khỏi "một cú xóc" là **thời
 *    lượng**, không phải số đỉnh: cú xóc xe máy kéo ~150 ms, lắc thì hàng giây. Kèm
 *    **hysteresis** (`releaseRatio`): chỉ tụt dưới `threshold × releaseRatio` mới xoá mốc bắt
 *    đầu, nên một mẫu hụt giữa cú lắc không xoá công đã giữ.
 * 4. **Nguội sau khi bắn.**
 *
 * 🔄 Thuật toán **đếm đỉnh** trong cửa sổ (`peaksToFire`/`windowMs`) đã bị bỏ 14/9/2026 — đo trên
 * máy thật thì khi lắc liên tục độ lệch không bao giờ tụt về gần 0, chỉ có đúng một sườn lên và
 * bộ đếm đứng ở 1. JSDoc này được sửa theo code ngày 24/9/2026.
 *
 * **Input:** `state` (từ lần gọi trước) · `sample` · `config`.
 * **Output:** `ShakeStep`. `fired = true` **đúng một mẫu** — mẫu đầu tiên mà lệch đã giữ liên
 * tục đủ `sustainMs`; state trả về khi đó đã xoá `activeSince` và đóng dấu `firedAt`.
 *
 * @example
 * ```ts
 * const cfg = { threshold: 12, releaseRatio: 0.4, sustainMs: 400,
 *               cooldownMs: 2000, baselineAlpha: 0.1 };
 * let s = createShakeState();
 * let last = { state: s, fired: false };
 * // mồi nền 0, rồi lệch 20 m/s² mỗi 50 ms — giữ trên ngưỡng
 * [0, 20, 20, 20, 20, 20, 20, 20, 20, 20].forEach((x, i) => {
 *   last = stepShake(s, { t: i * 50, x, y: 0, z: 0 }, cfg);
 *   s = last.state;
 * });
 * last.fired;   // true — mẫu t = 450, giữ đủ 400 ms kể từ t = 50
 *
 * // Ca biên — nền iOS 9,81 cho CÙNG phán quyết với nền Android 0:
 * // cùng chuỗi trên nhưng `x: 9.81 + m` cũng bắn ở đúng mẫu đó.
 * ```
 *
 * **Unit test:** `detect-shake.test.ts` › `stepShake` — 8 case: mẫu đầu chỉ mồi nền và không
 * bắn · đứng yên 100 mẫu **không** bắn · đi bộ (đỉnh ~4) **không** bắn · một cú xóc đơn (một
 * đỉnh) **không** bắn · giữ lệch đủ `sustainMs` thì **bắn** đúng một mẫu · lắc mạnh liên tục
 * không về 0 vẫn **bắn** (khoá hysteresis) · bắn xong trong `cooldownMs` **không** bắn lần hai ·
 * 🔑 cùng chuỗi lệch thì nền 0 và nền 9,81 cho **cùng** kết quả (khoá tính bất biến theo nền).
 */
export const stepShake = (
  state: ShakeState,
  sample: ShakeSample,
  config: ShakeConfig,
): ShakeStep => {
  'worklet';
  const magnitude = Math.sqrt(
    sample.x * sample.x + sample.y * sample.y + sample.z * sample.z,
  );

  // Lớp 1 — mẫu đầu chỉ mồi nền.
  if (state.baseline < 0) {
    return { state: { ...state, baseline: magnitude }, fired: false };
  }

  /*
    🔴 `Math.abs` là bắt buộc, không phải cho chắc: `magnitude` là CHUẨN nên luôn ≥ 0, mà trên
    Android nền ≈ 0 ⇒ `deviation` gần như không bao giờ âm. Bản đầu của hàm này đếm *đảo dấu*
    của `deviation` và vì thế **không bao giờ bắn trên Android** (đo trên máy thật 14/9/2026:
    cảm biến đăng ký đúng, worklet chạy đúng, bộ đếm đứng yên ở 0).
  */
  const deviation = Math.abs(magnitude - state.baseline);
  const quiet = deviation <= config.threshold;
  // Lớp 2 — nền chỉ học từ mẫu yên.
  const baseline = quiet
    ? state.baseline + config.baselineAlpha * (magnitude - state.baseline)
    : state.baseline;

  // Lớp 4 — đang nguội.
  if (sample.t - state.firedAt < config.cooldownMs) {
    return { state: { ...state, baseline }, fired: false };
  }

  /*
    Lớp 3 — **giữ liên tục đủ lâu**, có hysteresis.

    🔴 Bản trước đếm *sườn lên của đỉnh* và cũng hỏng, theo cách chỉ số đo mới lộ: khi lắc
    liên tục, độ lệch **không bao giờ tụt về gần 0** (đo thật: trung vị 27,8 m/s², p10 5,6)
    nên cờ `inPeak` khoá cứng, chỉ có đúng một sườn lên, bộ đếm đứng ở 1. Mô phỏng của tôi
    không bắt được vì fixture tự bịa có mẫu đầu rất lớn ⇒ đường nền mồi cao ⇒ dao động quanh
    nền một cách giả tạo.

    Thứ phân biệt "lắc" với "một cú xóc" không phải số đỉnh mà là **thời lượng**: cú xóc kéo
    ~150 ms, lắc thì hàng giây. Nên đo đúng thứ đó.
  */
  let activeSince = state.activeSince;
  if (deviation > config.threshold) {
    if (activeSince === Number.NEGATIVE_INFINITY) activeSince = sample.t;
  } else if (deviation < config.threshold * config.releaseRatio) {
    activeSince = Number.NEGATIVE_INFINITY;
  }
  /* Khoảng giữa hai ngưỡng: GIỮ NGUYÊN — đó chính là vùng đệm. */

  if (
    activeSince !== Number.NEGATIVE_INFINITY &&
    sample.t - activeSince >= config.sustainMs
  ) {
    return {
      state: {
        baseline,
        activeSince: Number.NEGATIVE_INFINITY,
        firedAt: sample.t,
      },
      fired: true,
    };
  }

  return {
    state: { baseline, activeSince, firedAt: state.firedAt },
    fired: false,
  };
};
