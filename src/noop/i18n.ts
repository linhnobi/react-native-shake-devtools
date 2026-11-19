/**
 * Entry `react-native-shake-devtools/noop/i18n` — bản **rỗng** của `react-native-shake-devtools/i18n`.
 *
 * **Chức năng:** cùng tên export, cùng kiểu với entry thật. Bảng chuỗi (`devtoolsStrings` ·
 * `devtoolsVi` · `devtoolsEn`) là **hằng** nên giữ nguyên, lấy thẳng từ `i18n/vi.ts` · `i18n/en.ts`
 * (hai file thuần dữ liệu, không import giá trị nào). Phần có code — `useDevToolsT`, bộ trộn/tra
 * chuỗi, context giao diện — không vào bundle.
 *
 * Vì sao không thay bảng chuỗi bằng object rỗng: app có thể đọc nó ở module scope (vd dựng
 * `DevToolsConfig.strings` từ `devtoolsStrings.en`), mà file cấu hình đó **vẫn chạy ở prod**. Object
 * rỗng ép kiểu thì `devtoolsStrings.en.panel.title` ném `TypeError` ngay lúc mở app. Giá: khoảng
 * 6 KB chuỗi (vi + en, đã bỏ comment) nằm lại trong bundle.
 *
 * **Input:** như entry thật. **Output:** `useDevToolsT()` ⇒ `t` ổn định trả **chính khoá** (cùng
 * quy ước "thiếu khoá" của `translate`).
 *
 * @example
 * ```ts
 * devtoolsStrings.vi.panel.title;          // 'Công cụ gỡ lỗi' — y như bản thật
 * useDevToolsT()('panel.title');           // 'panel.title' — ca biên: noop không tra chuỗi
 * ```
 *
 * **Unit test:** `noop-surface.test.ts` · `noop-isolation.test.ts`.
 */
import type * as Real from '../i18n';
import { en } from '../i18n/en';
import { vi } from '../i18n/vi';

export type { DeepPartial, DevToolsKey, DevToolsLocale, DevToolsStrings, TVars } from '../i18n';

export const devtoolsStrings: typeof Real.devtoolsStrings = { vi, en };
export const devtoolsVi: typeof Real.devtoolsVi = vi;
export const devtoolsEn: typeof Real.devtoolsEn = en;

const t: ReturnType<typeof Real.useDevToolsT> = (key) => key;
export const useDevToolsT: typeof Real.useDevToolsT = () => t;
