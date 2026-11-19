import { en } from './en';
import type {
  DeepPartial,
  DevToolsKey,
  DevToolsLocale,
  DevToolsStrings,
  TVars,
} from './types';
import { vi } from './vi';

/** Chuỗi dựng sẵn của lib theo ngôn ngữ. */
export const devtoolsStrings: Record<DevToolsLocale, DevToolsStrings> = { vi, en };

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Trộn sâu `override` lên `base` — **không** sửa `base`. Chỉ lá chuỗi được ghi đè; giá trị không
 * phải chuỗi/đối tượng (`undefined`, số…) bị bỏ qua để một bản dịch dở dang không xoá chuỗi gốc.
 */
const mergeDeep = (base: unknown, override: unknown): unknown => {
  if (override === null || typeof override !== 'object') return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override)) {
    if (typeof value === 'string') out[key] = value;
    else if (value !== null && typeof value === 'object') out[key] = mergeDeep(out[key], value);
  }
  return out;
};

/**
 * **Chức năng:** dựng bộ chuỗi đầy đủ cho một ngôn ngữ, có ghi đè của app.
 *
 * Thứ tự ưu tiên (cao → thấp): `strings` của app › chuỗi dựng sẵn của `locale` › tiếng Anh. Lớp
 * cuối là lưới an toàn: ngôn ngữ nào thiếu khoá thì rơi về tiếng Anh thay vì hiện khoá thô.
 *
 * **Input:** `locale` · `strings?` — cây con ghi đè/dịch thêm (`DeepPartial<DevToolsStrings>`).
 * **Output:** `DevToolsStrings` đầy đủ, object mới (không dùng chung với `vi`/`en`).
 *
 * @example
 * ```ts
 * resolveStrings('vi').panel.title;                                    // 'Công cụ gỡ lỗi'
 * resolveStrings('en', { panel: { title: 'Dev menu' } }).panel.title;  // 'Dev menu'
 * resolveStrings('en', { panel: { title: 'Dev menu' } }).panel.log;    // 'Logs' — ca biên: chỉ ghi đè đúng khoá được khai
 * ```
 *
 * **Unit test:** `translate.test.ts` › `resolveStrings` — 3 case: dùng chuỗi dựng sẵn theo ngôn
 * ngữ · ghi đè một khoá giữ nguyên các khoá còn lại · không làm hỏng `vi`/`en` dựng sẵn.
 */
export const resolveStrings = (
  locale: DevToolsLocale,
  strings?: DeepPartial<DevToolsStrings>,
): DevToolsStrings => {
  const layered = mergeDeep(devtoolsStrings.en, devtoolsStrings[locale]);
  return mergeDeep(layered, strings) as DevToolsStrings;
};

const lookup = (tree: unknown, key: string): string | undefined => {
  let node: unknown = tree;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !hasOwn(node, part)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
};

/** `{{biến}}`, hoặc `{{biến|dạng số ít|dạng số nhiều}}` (nhóm 2, 3). */
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*(?:\|([^|}]*)\|([^|}]*))?\}\}/g;

/**
 * **Chức năng:** tra một khoá trong bộ chuỗi rồi thay `{{biến}}`.
 *
 * Số ít / số nhiều (tiếng Anh): `{{biến|dạng số ít|dạng số nhiều}}` ⇒ biến bằng 1 thì in dạng số
 * ít, còn lại (0, 2…, `null`) dạng số nhiều — vd `'{{count}} recorded {{count|step|steps}}'`. Chỉ
 * chọn chữ, không in giá trị; thiếu biến thì để nguyên như `{{biến}}`. Tiếng Việt không cần.
 *
 * Quy ước thiếu dữ liệu (giữ hành vi của thư viện dịch mà lib dùng trước đây, để chữ trên màn
 * không đổi):
 * - **thiếu khoá** ⇒ trả **chính khoá** (`'panel.title'`) — nhìn là biết khoá chưa có chữ;
 * - **thiếu biến** (`undefined` hoặc không truyền) ⇒ để nguyên `{{biến}}` trong câu;
 * - biến `null` ⇒ chuỗi rỗng; số · boolean ⇒ `String(giá trị)`;
 * - giá trị biến **không** bị escape (chữ đi thẳng lên `<Text>`, không qua HTML).
 *
 * **Input:** `strings` · `key` · `vars?`. **Output:** chuỗi.
 *
 * @example
 * ```ts
 * translate(strings, 'panel.logHint', { total: 214, errors: 12 });  // '214 dòng · 12 lỗi'
 * translate(strings, 'panel.logHint', { total: 214 });               // '214 dòng · {{errors}} lỗi' — ca biên: thiếu biến
 * translate(strings, 'panel.nope' as never);                         // 'panel.nope' — ca biên: thiếu khoá
 * ```
 *
 * **Unit test:** `translate.test.ts` › `translate` — 8 case: thay biến · thiếu biến giữ `{{biến}}` ·
 * `null` thành rỗng · biến số 0 vẫn hiện · thiếu khoá trả khoá · `{{biến|một|nhiều}}` · chuỗi đếm
 * tiếng Anh số ít/nhiều, tiếng Việt không đổi · không escape ký tự đặc biệt.
 */
export const translate = (strings: DevToolsStrings, key: DevToolsKey, vars?: TVars): string => {
  const template = lookup(strings, key);
  if (template === undefined) return key;
  if (!vars) return template;
  return template.replace(
    PLACEHOLDER,
    (match, name: string, one: string | undefined, other: string | undefined) => {
      if (!hasOwn(vars, name)) return match;
      const value = vars[name];
      if (value === undefined) return match;
      if (one !== undefined && other !== undefined) return Number(value) === 1 ? one : other;
      return value === null ? '' : String(value);
    },
  );
};
