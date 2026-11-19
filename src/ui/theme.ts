/**
 * Bộ token **nội bộ** của lib — chỉ gồm thứ panel gỡ lỗi thật sự dùng, không phải một design
 * system tổng quát. Lib tự mang theme riêng để chạy được trong app nào cũng được, không đòi app
 * host phải có bộ token cụ thể.
 *
 * ## Bảng màu
 *
 * Trung tính, tự chọn cho công cụ gỡ lỗi (không bám thương hiệu nào). Số đo WCAG tính trên
 * `background.surface`:
 *
 * | Nhóm | Sáng | Tối | Ngưỡng |
 * |---|---|---|---|
 * | chữ `primary` · `secondary` · `tertiary` | 17,43 · 8,65 · 6,32 | 15,45 · 9,64 · 7,00 | ≥ 4,5 |
 * | chữ `brand` · `danger` · `success` · `warning` | 6,36 · 6,71 · 6,54 · 6,33 | 8,34 · 8,14 · 9,81 · 10,40 | ≥ 4,5 |
 * | màu cú pháp (`palette.*` bậc 700 sáng / 300 tối) | 6,6 – 8,7 | 8,9 – 10,3 | ≥ 3 (chữ nhỏ nên đặt ≥ 4,5) |
 *
 * Mọi chữ (kể cả `danger` trên `dangerSubtle`, `tertiary` trên `surfaceAlt`) đều ≥ 4,5 ở **cả hai**
 * chế độ — đo bằng script lúc viết, không phải ước lượng. `text.disabled` cố ý thấp hơn 4,5 (chữ
 * vô hiệu được miễn ngưỡng này) nhưng vẫn ≥ 3 trên `surface` · `surfaceAlt` ở cả hai chế độ (nút
 * "Xuất lỗi" khoá nằm trên `surfaceAlt`), nên không biến mất.
 *
 * ## Hai thứ không phải token
 *
 * - Font: dùng font hệ thống (không nhúng font nào), nên `typography` chỉ có cỡ · dòng · độ đậm.
 * - Chiều rộng các ô cụ thể (vd nút vuốt 80) là số của chỗ dùng, không phải bậc của thang.
 */

/** Chế độ màu của theme. */
export type DevToolsColorScheme = 'light' | 'dark';

/** Bảng màu theo bậc — chỉ hai bậc mà màu cú pháp cần: 700 (đậm, nền sáng) · 300 (nhạt, nền tối). */
export interface PaletteStep {
  300: string;
  700: string;
}

/** Kiểu chữ — chỉ bốn bậc panel dùng. */
export interface TypographyToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
}

/**
 * Theme của lib.
 *
 * @example
 * ```ts
 * const { colors, spacing } = useTheme();
 * // colors.text.primary · spacing.md · radius.sm · borderWidth.thin
 * ```
 */
export interface DevToolsTheme {
  mode: DevToolsColorScheme;
  spacing: {
    '2xs': number;
    xs: number;
    compact: number;
    sm: number;
    md: number;
    lg: number;
  };
  radius: { sm: number; md: number; lg: number; pill: number };
  borderWidth: { thin: number };
  /** Kích thước dùng chung của điều khiển. */
  size: {
    /** Vùng chạm tối thiểu (a11y) — nút thấp hơn thì được bù bằng `hitSlop`. */
    minTouch: number;
    /** Cao nút bậc mặc định. */
    buttonMd: number;
    /** Cao nút bậc `sm`. */
    buttonSm: number;
    /** Cạnh icon trong nút mặc định. */
    iconMd: number;
    /** Cạnh icon trong nút `sm`. */
    iconSm: number;
    /** Cao ô tìm. */
    field: number;
  };
  typography: {
    bodyM_Medium: TypographyToken;
    captionS_Bold: TypographyToken;
    captionS_Medium: TypographyToken;
    captionS_Regular: TypographyToken;
  };
  colors: {
    text: {
      primary: string;
      secondary: string;
      tertiary: string;
      brand: string;
      danger: string;
      success: string;
      warning: string;
      disabled: string;
      /** Chữ nằm trên nền đặc (`background.brand` · `success` · `danger`). */
      onFilled: string;
    };
    background: {
      surface: string;
      surfaceAlt: string;
      dangerSubtle: string;
      brand: string;
      brandPressed: string;
      success: string;
      danger: string;
      /** Lớp phủ sau sheet — đã mang alpha, dùng với `opacity={1}`. */
      overlay: string;
      /** Thanh kéo của sheet. */
      handle: string;
    };
    border: { subtle: string; strong: string };
  };
  /** Màu cú pháp JSON — xem `syntax-colors.ts`. */
  palette: {
    info: PaletteStep;
    success: PaletteStep;
    accent: PaletteStep;
    danger: PaletteStep;
    neutral: PaletteStep;
  };
}

const shared = {
  spacing: { '2xs': 4, xs: 8, compact: 10, sm: 12, md: 16, lg: 24 },
  radius: { sm: 6, md: 10, lg: 16, pill: 999 },
  borderWidth: { thin: 1 },
  size: { minTouch: 44, buttonMd: 44, buttonSm: 32, iconMd: 20, iconSm: 16, field: 40 },
  typography: {
    bodyM_Medium: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
    captionS_Bold: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
    captionS_Medium: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
    captionS_Regular: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  },
} as const satisfies Pick<
  DevToolsTheme,
  'spacing' | 'radius' | 'borderWidth' | 'size' | 'typography'
>;

/**
 * Màu cú pháp — dùng chung hai theme: sáng đọc bậc 700, tối đọc bậc 300, nên mỗi chế độ chỉ chạm
 * một nửa bảng.
 */
const palette: DevToolsTheme['palette'] = {
  info: { 300: '#7CC4F2', 700: '#0B5C8A' },
  success: { 300: '#7ED6A0', 700: '#1A6A38' },
  accent: { 300: '#F2B866', 700: '#8A4B00' },
  danger: { 300: '#FF9C94', 700: '#A82A22' },
  neutral: { 300: '#B9BECA', 700: '#454C58' },
};

/** Theme sáng. */
export const lightTheme: DevToolsTheme = {
  ...shared,
  mode: 'light',
  colors: {
    text: {
      primary: '#171A20',
      secondary: '#454C58',
      tertiary: '#586070',
      brand: '#1D5BBF',
      danger: '#B0251C',
      success: '#1B6B3A',
      warning: '#8A5300',
      disabled: '#828998',
      onFilled: '#FFFFFF',
    },
    background: {
      surface: '#FFFFFF',
      surfaceAlt: '#F2F4F7',
      dangerSubtle: '#FDEBEA',
      brand: '#1D5BBF',
      brandPressed: '#174A9C',
      success: '#1B6B3A',
      danger: '#B0251C',
      overlay: 'rgba(10, 14, 20, 0.5)',
      handle: '#C4C9D2',
    },
    border: { subtle: '#E1E4EA', strong: '#8A91A0' },
  },
  palette,
};

/** Theme tối. */
export const darkTheme: DevToolsTheme = {
  ...shared,
  mode: 'dark',
  colors: {
    text: {
      primary: '#ECEEF2',
      secondary: '#B9BECA',
      tertiary: '#9BA2B0',
      brand: '#82B2FF',
      danger: '#FF8F86',
      success: '#74D393',
      warning: '#F2BD52',
      disabled: '#6C7383',
      onFilled: '#0B1220',
    },
    background: {
      surface: '#15171B',
      surfaceAlt: '#20232A',
      dangerSubtle: '#3B1F1F',
      brand: '#82B2FF',
      brandPressed: '#6A9FF0',
      success: '#74D393',
      danger: '#FF8F86',
      overlay: 'rgba(0, 0, 0, 0.6)',
      handle: '#4A505C',
    },
    border: { subtle: '#2F333C', strong: '#6C7383' },
  },
  palette,
};

/**
 * **Chức năng:** chọn theme theo chế độ màu. Giá trị lạ (`null` · `undefined` · `'unspecified'` —
 * những thứ `useColorScheme()` có thể trả) rơi về **sáng**.
 *
 * **Input:** `scheme`. **Output:** `lightTheme` hoặc `darkTheme` — luôn là **cùng một object** với
 * cùng một đầu vào (cache của `useStyles` khoá theo tham chiếu theme).
 *
 * @example
 * ```ts
 * themeOf('dark') === darkTheme;        // true
 * themeOf(null) === lightTheme;         // ca biên: hệ thống không báo ⇒ sáng
 * ```
 *
 * **Unit test:** `theme.test.ts` › `themeOf` — 3 case: "light"/"dark" ra đúng theme · giá trị lạ rơi
 * về sáng · cùng đầu vào cùng object. Cùng file, `độ tương phản của bảng màu` — 3 case khoá các ngưỡng
 * ở bảng trên cho cả hai chế độ (khoá **quan hệ** ≥ 4,5, không ghim số).
 */
export const themeOf = (scheme: string | null | undefined): DevToolsTheme =>
  scheme === 'dark' ? darkTheme : lightTheme;
