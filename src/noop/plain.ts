/**
 * Entry `react-native-shake-devtools/noop/plain` — bản **rỗng** của `react-native-shake-devtools/plain`.
 *
 * **Chức năng:** entry `./plain` hứa "cùng API với entry `.`" (cùng tên export, cùng props — khoá ở
 * `plain/entry-parity.test.ts`), chỉ khác bộ sheet bên trong. Bản noop không có sheet nào, nên bản
 * rỗng của hai entry là **một**: file này tái xuất nguyên `noop/index.ts`. Metro tráo
 * `…/plain` sang đây ở bản prod (xem `devtoolsNoopResolver`).
 *
 * **Input:** như entry thật. **Output:** như `noop/index.ts` — gate và provider render đúng
 * `children`, UI devtools không render gì, phần thu không vá gì.
 *
 * @example
 * ```tsx
 * import { DevToolsGate } from 'react-native-shake-devtools/plain'; // bản prod: Metro trỏ về đây
 * <DevToolsGate config={config} actions={actions}><App /></DevToolsGate>; // chỉ còn <App />
 * // Ca biên: `./plain` thêm export mà `.` không có ⇒ `noop-surface.test.tsx` đỏ ở cặp plain.
 * ```
 *
 * **Unit test:** `noop-surface.test.tsx` (cặp `plain/index.ts` ⇔ `noop/plain.ts`) ·
 * `noop-isolation.test.ts`.
 */
export * from './index';
