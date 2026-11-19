import { useCallback } from 'react';
import { useDevToolsUi } from '../ui/context';
import { translate } from './translate';
import type { DevToolsKey, TVars } from './types';

/**
 * **Chức năng:** hook `t()` có kiểu khoá của lib — chuỗi lấy từ `locale` + `strings` của
 * `DevToolsUiProvider` gần nhất (ngoài provider: tiếng Anh dựng sẵn).
 *
 * `t` **ổn định** khi ngôn ngữ/chuỗi không đổi: nhiều `useMemo`/`useCallback` ở panel khai `t` làm
 * dep, nên một `t` đổi tham chiếu mỗi render sẽ vô hiệu hoá chúng.
 *
 * **Input:** không. **Output:** `t(key, vars?)`.
 *
 * @example
 * ```tsx
 * const t = useDevToolsT();
 * t('panel.title');                          // 'Công cụ gỡ lỗi' (locale vi)
 * t('panel.snooze', { minutes: 30 });        // 'Tắt lắc trong 30 phút'
 * // Ca biên: gọi `t()` tại render, không ở module scope — module scope chạy trước khi biết ngôn ngữ.
 * ```
 *
 * **Unit test:** `use-devtools-t.test.tsx` › `useDevToolsT` — 5 case: ngôn ngữ en/vi theo
 * provider · không provider thì tiếng Anh · `strings` ghi đè · thay biến · `t` giữ tham chiếu khi
 * render lại với cùng ngôn ngữ.
 */
export const useDevToolsT = () => {
  const { strings } = useDevToolsUi();
  return useCallback((key: DevToolsKey, vars?: TVars) => translate(strings, key, vars), [strings]);
};
