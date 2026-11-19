import {
  createShakeState,
  stepShake,
  type ShakeConfig,
  type ShakeSample,
  type ShakeStep,
} from './detect-shake';

/*
  Bộ số CỐ ĐỊNH của test — không lấy `DEFAULT_SHAKE_CONFIG` vì hằng đó đổi theo `Platform.OS` và
  được phép chỉnh sau mỗi lượt đo. Mọi chuỗi mẫu bên dưới dựng THEO bộ này (bội của `threshold`,
  bội của `DT`), nên đổi số ở đây không làm test đổi ý nghĩa.
*/
const CFG: ShakeConfig = {
  threshold: 12,
  releaseRatio: 0.4,
  sustainMs: 400,
  cooldownMs: 2000,
  baselineAlpha: 0.1,
};

/** Nhịp mẫu của test (ms). */
const DT = 50;
/** Nền iOS: gia tốc thô còn nguyên trọng lực. Nền Android là 0. */
const GRAVITY = 9.81;
/** Độ lệch chắc chắn trên ngưỡng. */
const STRONG = CFG.threshold * 2;

const repeat = (n: number, v: number): number[] => Array.from({ length: n }, () => v);

/**
 * Chuỗi độ lệch → chuỗi mẫu, cộng lên trục `z` (trục trọng lực khi máy nằm ngửa) quanh `base`.
 * Phần tử đầu là mẫu mồi nền.
 */
const series = (devs: readonly number[], base = 0): ShakeSample[] =>
  devs.map((d, i) => ({ t: i * DT, x: 0, y: 0, z: base + d }));

/** Nạp cả chuỗi từ state đầu; `fired` là chỉ số các mẫu đã bắn. */
const feed = (samples: readonly ShakeSample[], config: ShakeConfig = CFG) => {
  let state = createShakeState();
  const steps: ShakeStep[] = [];
  const fired: number[] = [];
  samples.forEach((sample, i) => {
    const step = stepShake(state, sample, config);
    steps.push(step);
    state = step.state;
    if (step.fired) fired.push(i);
  });
  return { steps, fired };
};

describe('createShakeState', () => {
  it('trả state chưa mồi', () => {
    const s = createShakeState();
    expect(s.baseline).toBe(-1);
    // Hệ quả của cờ: mẫu kế tiếp đi nhánh mồi nền, không phán quyết.
    expect(stepShake(s, { t: 0, x: 0, y: 0, z: STRONG }, CFG)).toEqual({
      state: { ...s, baseline: STRONG },
      fired: false,
    });
  });

  /* Mốc `0` thì mọi mẫu có `t < cooldownMs` rơi vào nhánh "đang nguội" ⇒ câm suốt quãng đầu. */
  it('hai mốc thời gian là âm vô cùng (ca biên đồng hồ bắt đầu từ 0)', () => {
    const s = createShakeState();
    expect(s.activeSince).toBe(Number.NEGATIVE_INFINITY);
    expect(s.firedAt).toBe(Number.NEGATIVE_INFINITY);

    const { fired } = feed(series([0, ...repeat(16, STRONG)]));
    expect(fired).toHaveLength(1);
    expect(fired[0] * DT).toBeLessThan(CFG.cooldownMs);
  });
});

describe('stepShake', () => {
  /* Trên iOS mẫu đầu lệch 9,81 so với nền 0 — ở đây còn lệch gấp 4 ngưỡng mà vẫn không bắn. */
  it('mẫu đầu chỉ mồi nền và không bắn', () => {
    const first = stepShake(createShakeState(), { t: 0, x: 30, y: 40, z: 0 }, CFG);
    expect(first.fired).toBe(false);
    // Nền mồi bằng CHUẨN vector (30-40-50), không bằng một trục.
    expect(first.state.baseline).toBe(50);

    const next = stepShake(first.state, { t: DT, x: 30, y: 40, z: 0 }, CFG);
    expect(next.fired).toBe(false);
    expect(next.state.activeSince).toBe(Number.NEGATIVE_INFINITY);
  });

  it('đứng yên 100 mẫu **không** bắn', () => {
    // Nhiễu ±0,4 quanh nền iOS — máy nằm yên đo thật cho độ lệch tối đa 0,45.
    const devs = Array.from({ length: 100 }, (_, i) => ((i % 5) - 2) * 0.2);
    expect(feed(series(devs, GRAVITY)).fired).toEqual([]);
  });

  it('đi bộ (đỉnh ~4) **không** bắn', () => {
    // Nhịp bước ~2 Hz kéo 3 giây — dài gấp nhiều lần `sustainMs`, nên chỉ ngưỡng mới cản được.
    const gait = [0, 2, 4, 2, 0, 1, 3, 4, 3, 1];
    const devs = Array.from({ length: 60 }, (_, i) => gait[i % gait.length]);
    expect(feed(series(devs)).fired).toEqual([]);
  });

  it('một cú xóc đơn (một đỉnh) **không** bắn', () => {
    // Cú xóc kéo ~150 ms: cao đến mấy cũng không giữ đủ `sustainMs`.
    const devs = [0, 0, 0, ...repeat(3, STRONG * 3), ...repeat(10, 0)];
    expect(feed(series(devs)).fired).toEqual([]);
  });

  /*
    JSDoc gọi là "đủ số đỉnh trong cửa sổ"; thuật toán hiện tại đo THỜI LƯỢNG: giữ lệch trên
    ngưỡng liên tục đủ `sustainMs` thì bắn, tại đúng mẫu chạm mốc đó.
  */
  it('đủ số đỉnh trong cửa sổ thì **bắn** — giữ lệch đủ `sustainMs`, đúng một mẫu', () => {
    const { steps, fired } = feed(series([0, ...repeat(16, STRONG)]));
    // Chuỗi lệch mở ở mẫu 1 ⇒ bắn ở mẫu đầu tiên có `t - activeSince >= sustainMs`.
    expect(fired).toEqual([1 + CFG.sustainMs / DT]);

    const hit = steps[fired[0]].state;
    expect(hit.firedAt).toBe(fired[0] * DT);
    expect(hit.activeSince).toBe(Number.NEGATIVE_INFINITY);
  });

  /*
    Mỗi lần đổi chiều, độ lệch tụt vào VÙNG ĐỆM (dưới `threshold`, trên vạch nhả) chứ không về 0
    — đúng hình dạng đo thật. Bỏ vùng đệm (`releaseRatio: 1`) thì mỗi lần tụt xoá công đã tích.
  */
  it('lắc mạnh liên tục không về 0 vẫn **bắn** (khoá hysteresis)', () => {
    const dip = CFG.threshold * 0.8;
    const devs = [0, ...Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? STRONG : dip))];

    expect(feed(series(devs)).fired).toHaveLength(1);
    expect(feed(series(devs), { ...CFG, releaseRatio: 1 }).fired).toEqual([]);
  });

  it('bắn xong trong `cooldownMs` **không** bắn lần hai', () => {
    // Lắc liên tục 4 giây: đủ dài để bắn lần hai, nhưng chỉ sau khi đã nguội.
    const { fired } = feed(series([0, ...repeat(79, STRONG)]));
    expect(fired).toHaveLength(2);
    expect((fired[1] - fired[0]) * DT).toBeGreaterThanOrEqual(CFG.cooldownMs);
  });

  it('🔑 cùng chuỗi lệch thì nền 0 và nền 9,81 cho **cùng** kết quả (khoá bất biến theo nền)', () => {
    // Đủ các pha: nằm yên · xóc · đi bộ · lắc có tụt vào vùng đệm · nằm yên.
    const dip = CFG.threshold * 0.8;
    const devs = [
      0, 0.2, 0.1, 0.3,
      STRONG * 2, STRONG * 2, 0, 0, 0,
      2, 4, 2, 0, 3, 4,
      ...Array.from({ length: 24 }, (_, i) => (i % 3 === 2 ? dip : STRONG)),
      0, 0.1, 0,
    ];

    const android = feed(series(devs, 0)).fired;
    const ios = feed(series(devs, GRAVITY)).fired;
    // Không để hai bên "cùng câm" mà vẫn xanh.
    expect(android.length).toBeGreaterThan(0);
    expect(ios).toEqual(android);
  });
});
