import { darkTheme, lightTheme, themeOf, type DevToolsTheme } from './theme';

/** Độ sáng tương đối WCAG 2.x của màu `#RRGGBB`. */
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Chữ nào, trên nền nào — `disabled` bị miễn (chữ vô hiệu không phải thông tin phải đọc). */
const TEXT_TONES = ['primary', 'secondary', 'tertiary', 'brand', 'danger', 'success', 'warning'] as const;

const checkContrast = (theme: DevToolsTheme) => {
  const { colors, palette } = theme;
  const grounds = [colors.background.surface, colors.background.surfaceAlt];
  for (const tone of TEXT_TONES) {
    for (const ground of grounds) {
      expect({ tone, ground, ratio: contrast(colors.text[tone], ground) >= 4.5 }).toEqual({
        tone,
        ground,
        ratio: true,
      });
    }
  }
  /* Cảnh báo/lỗi thật sự nằm trên dải nền nguy hiểm nhạt. */
  expect(contrast(colors.text.danger, colors.background.dangerSubtle)).toBeGreaterThanOrEqual(4.5);
  /* Chữ trên nền đặc (nút primary, ô chip đang chọn, khối vuốt). */
  for (const fill of ['brand', 'success', 'danger'] as const) {
    expect(contrast(colors.text.onFilled, colors.background[fill])).toBeGreaterThanOrEqual(4.5);
  }
  /* Màu cú pháp: bậc đọc ở chế độ này phải ≥ 3 trên nền khối code (chữ nhỏ nên đặt tới 4,5). */
  const step = theme.mode === 'dark' ? 300 : 700;
  for (const hue of ['info', 'success', 'accent', 'danger', 'neutral'] as const) {
    expect(contrast(palette[hue][step], colors.background.surface)).toBeGreaterThanOrEqual(4.5);
  }
};

describe('themeOf', () => {
  it('"light" ⇒ theme sáng, "dark" ⇒ theme tối', () => {
    expect(themeOf('light')).toBe(lightTheme);
    expect(themeOf('dark')).toBe(darkTheme);
    expect(lightTheme.mode).toBe('light');
    expect(darkTheme.mode).toBe('dark');
  });

  it('giá trị lạ (null · undefined · unspecified) rơi về sáng', () => {
    expect(themeOf(null)).toBe(lightTheme);
    expect(themeOf(undefined)).toBe(lightTheme);
    expect(themeOf('unspecified')).toBe(lightTheme);
  });

  it('trả cùng một object với cùng đầu vào (cache style khoá theo tham chiếu)', () => {
    expect(themeOf('dark')).toBe(themeOf('dark'));
  });
});

/** Mọi cặp chữ-trên-nền mà màn thật vẽ, ngoài lưới `checkContrast` ở trên. */
const checkUsedPairs = (theme: DevToolsTheme) => {
  const { colors } = theme;
  const { surface, surfaceAlt, dangerSubtle } = colors.background;
  /* Dải crash: tiêu đề `danger` + thân `primary` trên nền nguy hiểm nhạt. */
  expect(contrast(colors.text.primary, dangerSubtle)).toBeGreaterThanOrEqual(4.5);
  /* Nút primary lúc nhấn (`brandPressed`) vẫn đọc được chữ `onFilled`. */
  expect(contrast(colors.text.onFilled, colors.background.brandPressed)).toBeGreaterThanOrEqual(4.5);
  /* Biên ô tìm · nút viền là ranh giới điều khiển ⇒ ≥ 3 (WCAG 1.4.11) trên nền của nó. */
  expect(contrast(colors.border.strong, surface)).toBeGreaterThanOrEqual(3);
  /* Chữ vô hiệu được miễn 4,5 nhưng không được biến mất: nút khoá nằm trên `surfaceAlt`. */
  expect(contrast(colors.text.disabled, surface)).toBeGreaterThanOrEqual(3);
  expect(contrast(colors.text.disabled, surfaceAlt)).toBeGreaterThanOrEqual(3);
};

describe('độ tương phản của bảng màu', () => {
  it('theme sáng: các cặp phụ (dải crash · nhấn · biên · vô hiệu)', () =>
    checkUsedPairs(lightTheme));

  it('theme tối: các cặp phụ (dải crash · nhấn · biên · vô hiệu)', () => checkUsedPairs(darkTheme));

  it('theme sáng: chữ ≥ 4,5 trên nền, màu cú pháp ≥ 4,5', () => checkContrast(lightTheme));

  it('theme tối: chữ ≥ 4,5 trên nền, màu cú pháp ≥ 4,5', () => checkContrast(darkTheme));

  it('hai theme dùng chung thang kích thước, chỉ khác màu', () => {
    expect(darkTheme.spacing).toBe(lightTheme.spacing);
    expect(darkTheme.typography).toBe(lightTheme.typography);
    expect(darkTheme.colors.background.surface).not.toBe(lightTheme.colors.background.surface);
  });
});
