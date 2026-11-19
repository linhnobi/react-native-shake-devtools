import { useEffect, useState } from 'react';
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  type KeyboardEvent,
  type LayoutAnimationType,
} from 'react-native';
import type { DevToolsKeyboardInputMode } from './context';

/** Bàn phím nhìn từ phía sheet thuần. */
export interface SheetKeyboard {
  /** Bàn phím đang hiện — chân sheet bỏ inset đáy (bàn phím đã phủ vùng đó). */
  shown: boolean;
  /** Sheet phải tự nhấc lên bao nhiêu (dp). 0 khi cửa sổ đã tự co lại (`adjustResize`). */
  padding: number;
}

const HIDDEN = { shown: false, height: 0 } as const;

/** Bàn phím đang mở sẵn lúc sheet hiện (vd ô nhập của app còn focus khi lắc máy). */
const currentKeyboard = () => {
  if (!Keyboard.isVisible()) return HIDDEN;
  return { shown: true, height: Keyboard.metrics()?.height ?? 0 };
};

/**
 * Trên iOS, sự kiện `keyboardWill…` mang thời lượng + kiểu easing của chính bàn phím: cấu hình
 * `LayoutAnimation` cho lượt layout kế tiếp để sheet trượt cùng nhịp — đúng cách
 * `KeyboardAvoidingView` của RN làm. Android chỉ có `keyboardDid…` (bắn khi bàn phím đã mở xong),
 * không có gì để đồng bộ.
 */
const followKeyboard = (e: KeyboardEvent) => {
  if (Platform.OS !== 'ios' || !e.duration) return;
  const duration = Math.max(e.duration, 10);
  const type = (LayoutAnimation.Types as Record<string, LayoutAnimationType | undefined>)[e.easing] ?? 'keyboard';
  LayoutAnimation.configureNext({ duration, update: { duration, type } });
};

/**
 * **Chức năng:** sheet **thuần** (entry `./plain`) tự né bàn phím — bản gorhom thì gorhom lo.
 *
 * Bù **đúng một lần**, cùng luật với bảng "Android: bàn phím trong sheet" ở README:
 *
 * | Nền · chế độ | Cửa sổ khi bàn phím mở | `padding` |
 * |---|---|---|
 * | iOS | không co | chiều cao bàn phím (`keyboardWillShow`, trượt theo nhịp bàn phím) |
 * | Android `adjustPan` | không co (edge-to-edge, hoặc manifest `adjustPan`) | chiều cao bàn phím **+ `bottomInset`** (`keyboardDidShow` — **nhảy** sau khi bàn phím mở xong) |
 * | Android `adjustResize` | co lại ⇒ sheet neo đáy tự lên theo | 0 |
 *
 * Android: `endCoordinates.height` của RN là inset IME **trừ** inset thanh hệ thống, tức tính từ
 * đỉnh thanh điều hướng. Cửa sổ edge-to-edge thì đáy sheet nằm ở đáy màn (dưới thanh điều hướng), nên
 * phải nhấc thêm đúng inset đáy; cửa sổ không edge-to-edge thì inset đáy = 0, không cộng gì. Đo trên
 * SM-M346B (Android 14, edge-to-edge), 6/11/2026: thiếu phần cộng này thì chân sheet nằm dưới bàn
 * phím đúng một dải cao bằng thanh điều hướng (135 px). iOS báo chiều cao tính từ đáy màn — không cộng.
 *
 * **Input:** `active` (chỉ nghe khi sheet đang hiện) · `androidMode` (`DevToolsConfig.androidKeyboardInputMode`)
 * · `bottomInset` (inset đáy của safe area — thanh điều hướng khi cửa sổ edge-to-edge; mặc định 0).
 * **Output:** {@link SheetKeyboard}.
 *
 * @example
 * ```ts
 * const keyboard = useSheetKeyboard(visible, androidKeyboardInputMode);
 * <Animated.View style={{ bottom: keyboard.padding }} />
 * // Ca biên: Android `adjustResize` + bàn phím mở ⇒ { shown: true, padding: 0 }.
 * ```
 *
 * **Unit test:** `use-sheet-keyboard.test.ts` › `useSheetKeyboard` — 7 case: iOS nghe `keyboardWill…`
 * và đệm bằng chiều cao · Android `adjustPan` nghe `keyboardDid…` và đệm · Android `adjustPan` cộng
 * inset đáy · iOS không cộng inset đáy · Android `adjustResize` báo `shown` nhưng không đệm · ẩn bàn
 * phím ⇒ về 0 · `active=false` không nghe gì.
 */
export const useSheetKeyboard = (
  active: boolean,
  androidMode: DevToolsKeyboardInputMode,
  bottomInset = 0,
): SheetKeyboard => {
  const [state, setState] = useState<{ shown: boolean; height: number }>(HIDDEN);

  useEffect(() => {
    if (!active) {
      setState(HIDDEN);
      return undefined;
    }
    setState(currentKeyboard());
    const ios = Platform.OS === 'ios';
    const subs = [
      Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
        followKeyboard(e);
        setState({ shown: true, height: e.endCoordinates.height });
      }),
      Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (e) => {
        followKeyboard(e);
        setState(HIDDEN);
      }),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, [active]);

  const ios = Platform.OS === 'ios';
  const compensate = ios || androidMode === 'adjustPan';
  if (!state.shown || !compensate) return { shown: state.shown, padding: 0 };
  return { shown: true, padding: ios ? state.height : state.height + bottomInset };
};
