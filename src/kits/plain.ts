/**
 * Năm component cần bộ sheet, đã gắn bộ **RN thuần** — entry `./plain` (`src/plain/index.ts`)
 * export từ đây. Xem `bindSheetKit`.
 */
import { bindSheetKit } from './bind-sheet-kit';
import { plainKit } from './plain-kit';

export const { DevToolsGate, DevToolsPanel, LogSheet, LogRow, LogDetail } = bindSheetKit(plainKit);
