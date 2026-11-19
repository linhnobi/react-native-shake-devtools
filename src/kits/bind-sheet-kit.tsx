import { memo } from 'react';
import { DevToolsGate } from '../gate/DevToolsGate';
import { DevToolsPanel } from '../panel/DevToolsPanel';
import { LogDetail } from '../panel/LogDetail';
import { LogRow } from '../panel/LogRow';
import { LogSheet } from '../panel/LogSheet';
import { withSheetKit, type SheetKit } from '../ui/sheet-kit';

/**
 * **Chức năng:** gắn một bộ sheet vào năm component export ra ngoài mà cần bộ sheet — mỗi entry gọi
 * một lần với bộ của nó (`.` ⇒ gorhom, `./plain` ⇒ RN thuần) và export kết quả dưới đúng tên cũ.
 *
 * Thêm một component export mới mà bên trong (trực tiếp hay gián tiếp) gọi `useSheetKit()` thì
 * phải thêm vào đây, nếu không chỗ gọi ngoài gate sẽ ném lỗi "missing sheet kit".
 *
 * **Input:** `kit` (hằng module). **Output:** `{ DevToolsGate, DevToolsPanel, LogSheet, LogRow,
 * LogDetail }` — cùng props với bản gốc; `LogRow` vẫn là `memo`.
 *
 * @example
 * ```ts
 * export const { DevToolsGate, DevToolsPanel, LogSheet, LogRow, LogDetail } = bindSheetKit(plainKit);
 * // Ca biên: gate đã bọc bộ, `LogSheet` bên trong gate là bản gốc — không bọc hai lớp.
 * ```
 *
 * **Unit test:** `src/plain/entry-parity.test.ts` — hai entry export cùng bộ tên; `src/plain/index.test.ts`
 * render các component đã bọc của `./plain`.
 */
export const bindSheetKit = (kit: SheetKit) => ({
  DevToolsGate: withSheetKit(kit, DevToolsGate, 'DevToolsGate'),
  DevToolsPanel: withSheetKit(kit, DevToolsPanel, 'DevToolsPanel'),
  LogSheet: withSheetKit(kit, LogSheet, 'LogSheet'),
  LogRow: memo(withSheetKit(kit, LogRow, 'LogRow')),
  LogDetail: withSheetKit(kit, LogDetail, 'LogDetail'),
});
