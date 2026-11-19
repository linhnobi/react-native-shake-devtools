import type { vi } from './vi';

/** Ngôn ngữ lib có sẵn chuỗi. */
export type DevToolsLocale = 'vi' | 'en';

/** Biến thay vào `{{tên}}`. */
export type TVars = Record<string, string | number | boolean | null | undefined>;

/**
 * Hình dạng của bộ chuỗi — suy từ `vi.ts` (ngôn ngữ nguồn) nhưng **mở rộng lá về `string`**: bản
 * khai literal (`as const`) của `vi` mà dùng thẳng làm kiểu thì `en` không thể khác chữ nào.
 */
export type LocaleOf<T> = { [K in keyof T]: T[K] extends string ? string : LocaleOf<T[K]> };

/** Bộ chuỗi đầy đủ của một ngôn ngữ. `en` phải cùng hình với `vi` — thiếu khoá là lỗi typecheck. */
export type DevToolsStrings = LocaleOf<typeof vi>;

/** Cây con tuỳ ý của `T` — mọi cấp đều tuỳ chọn, lá vẫn là `string`. */
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> };

/** Đường dẫn chấm tới từng lá chuỗi, vd `'panel.title'`. */
export type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Khoá hợp lệ của `t()` — gõ sai là lỗi typecheck. */
export type DevToolsKey = Leaves<DevToolsStrings>;
