import type { DevToolsTheme } from '../ui/theme';
import type { JsonTokenKind } from '../capture/format-json';

/** Màu của từng loại đoạn JSON. */
export type SyntaxColors = Record<JsonTokenKind, string>;

/**
 * **Chức năng:** kiểu chữ của **khoá** — đậm, để mắt bám cấu trúc kể cả khi không phân biệt được
 * màu. `bold` chứ không `500`: Menlo (iOS) chỉ có Regular/Bold, `500` hiện như thường.
 */
export const SYNTAX_KEY_WEIGHT = 'bold' as const;

/**
 * **Chức năng:** bảng màu tô JSON của màn chi tiết request — khoá · chuỗi · số · `true/false/null`
 * · dấu câu (kèm ▸/▾, tóm tắt) · chữ thường. Một chỗ cho cả **Cây** lẫn **Văn bản**.
 *
 * ## Vì sao không dùng thẳng token `colors.text.*`
 *
 * Màu chữ ngữ nghĩa (`brand` · `success`…) chỉ có **một bậc** cho mỗi chế độ và gần nhau (xanh
 * dương ↔ xanh lá), nên khoá và chuỗi khó phân biệt. Ở đây lấy từ `theme.palette`: sáng → bậc
 * **700** (đậm), tối → bậc **300** (nhạt), mỗi loại một sắc (dương · lá · cam · đỏ). Số đo WCAG với
 * bảng màu của lib (`ui/theme.ts`), nền `background.surface`:
 *
 * | Loại | Sáng (nền trắng) | Tối (nền tối) |
 * |---|---|---|
 * | khoá | `info.700` 7,21 | `info.300` 9,43 |
 * | chuỗi | `success.700` 6,64 | `success.300` 10,27 |
 * | số | `accent.700` 6,80 | `accent.300` 10,10 |
 * | bool/null | `danger.700` 6,96 | `danger.300` 8,92 |
 * | dấu câu | `text.secondary` 8,65 | `neutral.300` 9,64 |
 *
 * Rẽ nhánh theo `theme.mode` ở **đúng một chỗ này**; màu vẫn đọc từ `theme.palette`, không hex tay.
 *
 * **Input:** `theme`. **Output:** {@link SyntaxColors}.
 *
 * @example
 * ```ts
 * syntaxColorsOf(lightTheme).key;   // palette.info[700]
 * syntaxColorsOf(darkTheme).key;    // palette.info[300] — ca biên: tối lấy bậc nhạt
 * ```
 *
 * **Unit test:** `syntax-colors.test.ts` › `syntaxColorsOf` — 2 case: sáng lấy bậc 700 + chuỗi
 * khác màu khoá · tối lấy bậc 300.
 */
export const syntaxColorsOf = ({ mode, palette, colors }: DevToolsTheme): SyntaxColors => {
  const dark = mode === 'dark';
  return {
    key: dark ? palette.info[300] : palette.info[700],
    string: dark ? palette.success[300] : palette.success[700],
    number: dark ? palette.accent[300] : palette.accent[700],
    literal: dark ? palette.danger[300] : palette.danger[700],
    punct: dark ? palette.neutral[300] : colors.text.secondary,
    plain: colors.text.primary,
  };
};
