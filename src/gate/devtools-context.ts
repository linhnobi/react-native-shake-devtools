import { createContext, useContext } from 'react';

export interface DevToolsContextValue {
  /** Mở panel bằng code — đường vào thứ hai, song song với cú lắc. */
  open: () => void;
  /** Panel có đang mở không (để đường vào thứ hai không mở chồng). */
  isOpen: boolean;
  /** Gate có đang hoạt động không — `false` ở bản prod. */
  enabled: boolean;
}

/**
 * Giá trị khi **không** có `DevToolsGate` nào ở trên: mọi thứ câm.
 *
 * Cố ý KHÔNG `undefined` + throw: màn hình gọi `useDevTools()` (vd để gắn chạm-7-lần vào
 * dòng phiên bản) phải dùng được ở **mọi** app, kể cả app không mount gate và kể cả bản prod
 * nơi gate render `null`. Ném lỗi ở đó nghĩa là mỗi call-site phải tự bọc `try`.
 */
const FALLBACK: DevToolsContextValue = {
  open: () => undefined,
  isOpen: false,
  enabled: false,
};

export const DevToolsContext = createContext<DevToolsContextValue>(FALLBACK);

/**
 * **Chức năng:** lấy tay cầm mở panel gỡ lỗi từ bất kỳ đâu **bên trong** `DevToolsGate`.
 *
 * **Input:** không.
 * **Output:** `DevToolsContextValue`. Ngoài phạm vi gate — hoặc ở bản prod — trả bản câm
 * (`enabled: false`, `open` là no-op) chứ **không ném**.
 *
 * @example
 * ```tsx
 * const { open, enabled } = useDevTools();
 * // Ca biên: bản prod ⇒ enabled === false ⇒ đừng vẽ đường vào ẩn nào cả
 * return enabled ? <Pressable onPress={open}>{…}</Pressable> : <View>{…}</View>;
 * ```
 *
 * **Unit test:** `devtools-context.test.tsx` › `useDevTools` — 3 case: trong gate trả `open`
 * mở được panel · ngoài gate trả bản câm và không ném · bản prod trả `enabled: false`.
 */
export const useDevTools = (): DevToolsContextValue =>
  useContext(DevToolsContext);
