import { darkTheme, lightTheme } from '../ui/theme';
import { syntaxColorsOf } from './syntax-colors';

/** Tương phản WCAG 2.x của hai màu `#RRGGBB`. */
const contrast = (a: string, b: string) => {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('syntaxColorsOf', () => {
  it.each([lightTheme, darkTheme])(
    'mọi loại đoạn JSON (kể cả dấu câu · chữ thường) ≥ 4,5 trên nền khối code — theme %#',
    (theme) => {
      const colors = syntaxColorsOf(theme);

      for (const [kind, color] of Object.entries(colors)) {
        expect({ kind, ok: contrast(color, theme.colors.background.surface) >= 4.5 }).toEqual({
          kind,
          ok: true,
        });
      }
    },
  );

  it('sáng lấy bậc 700, chuỗi KHÁC màu khoá', () => {
    const theme = lightTheme;
    const c = syntaxColorsOf(theme);

    expect(c.key).toBe(theme.palette.info[700]);
    expect(c.number).toBe(theme.palette.accent[700]);
    expect(c.punct).toBe(theme.colors.text.secondary);
    expect(c.string).not.toBe(c.key);
  });

  it('tối lấy bậc 300', () => {
    const theme = darkTheme;
    const c = syntaxColorsOf(theme);

    expect(c.key).toBe(theme.palette.info[300]);
    expect(c.literal).toBe(theme.palette.danger[300]);
    expect(c.punct).toBe(theme.palette.neutral[300]);
  });
});
