import type { ShakeConfig } from './detect-shake';
import { DEFAULT_SHAKE_CONFIG, resolveShakeConfig } from './shake-config';

/*
  Không ghim con số nào của bảng mặc định: `threshold` đổi theo `Platform.OS` và cả bảng được
  phép chỉnh sau mỗi lượt đo. Test khoá QUAN HỆ giữa kết quả và hằng.
*/
const KEYS: readonly (keyof ShakeConfig)[] = [
  'threshold',
  'releaseRatio',
  'sustainMs',
  'cooldownMs',
  'baselineAlpha',
];

describe('resolveShakeConfig', () => {
  it('`undefined` trả đủ 5 khoá', () => {
    const c = resolveShakeConfig();
    expect(Object.keys(c).sort()).toEqual([...KEYS].sort());
    for (const k of KEYS) expect(typeof c[k]).toBe('number');
    expect(c).toEqual(DEFAULT_SHAKE_CONFIG);
  });

  it('override một khoá không đụng bốn khoá kia', () => {
    const threshold = DEFAULT_SHAKE_CONFIG.threshold + 5;
    const c = resolveShakeConfig({ threshold });
    expect(c.threshold).toBe(threshold);
    expect({ ...c, threshold: DEFAULT_SHAKE_CONFIG.threshold }).toEqual(DEFAULT_SHAKE_CONFIG);
  });

  it('object rỗng ≡ `undefined`', () => {
    expect(resolveShakeConfig({})).toEqual(resolveShakeConfig(undefined));
  });

  it('trả object mới chứ không phải chính hằng mặc định', () => {
    const c = resolveShakeConfig();
    expect(c).not.toBe(DEFAULT_SHAKE_CONFIG);
    expect(resolveShakeConfig()).not.toBe(c);

    // Caller sửa bản của mình thì hằng dùng chung không được đổi theo.
    (c as { threshold: number }).threshold = DEFAULT_SHAKE_CONFIG.threshold + 1;
    expect(DEFAULT_SHAKE_CONFIG.threshold).not.toBe(c.threshold);
  });
});
