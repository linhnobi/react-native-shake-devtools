import { useSyncExternalStore } from 'react';
import { previousSession } from '../capture/log-persist';
import type { StoredSession } from '../capture/log-session';

/**
 * **Chức năng:** đọc **phiên trước** (đọc từ đĩa lúc khởi động) và render lại khi nó đổi — lúc đọc
 * xong, hoặc lúc đăng xuất xoá sạch.
 *
 * **Input:** không. **Output:** `StoredSession | null`. App chưa bật lưu (`startCapture` không có
 * `persist`) ⇒ luôn `null`, panel không vẽ hàng "Phiên trước".
 *
 * @example
 * ```ts
 * const previous = usePreviousSession();
 * previous?.fatal;   // true ⇒ panel hiện dải báo crash
 * // Ca biên: đọc đĩa chưa xong lúc panel mở ⇒ null, rồi hàng hiện ra khi đọc xong.
 * ```
 *
 * **Unit test:** không có riêng, và cũng **không** được phủ gián tiếp: `DevToolsPanel.test.tsx` lẫn
 * `DevToolsGate.test.tsx` đều mock chính hook này để cấp phiên trước. Phần được phủ là store bên
 * dưới (`previousSession` — `log-persist.test.ts`, case "khởi động đọc phiên trước": nó báo
 * listener). Hook chỉ là một lời gọi `useSyncExternalStore` lên store đó.
 */
export const usePreviousSession = (): StoredSession | null =>
  useSyncExternalStore(
    previousSession.subscribe,
    previousSession.get,
    previousSession.get,
  );
