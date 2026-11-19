import { useEffect, useRef, type ReactNode } from 'react';
import { AppState, BackHandler, View, type GestureResponderEvent } from 'react-native';
import { actionBuffer, type ActionBuffer } from '../../capture/action-buffer';
import { describeTouchTarget, fiberFromTouchEvent, type TouchTarget } from './fiber-label';

/** Giữ từ ngần này ms trở lên là chạm giữ lâu. */
const LONG_PRESS_MS = 500;
/** Ngón dịch quá ngần này dp (theo từng trục) là cuộn/kéo, không phải chạm. */
const TAP_SLOP = 10;

const ROOT_STYLE = { flex: 1 } as const;

interface Gesture {
  at: number;
  x: number;
  y: number;
  target: TouchTarget;
  /** Đã vượt ngưỡng dịch (cuộn) hoặc có từ hai ngón ⇒ bỏ cử chỉ này. */
  void: boolean;
}

export interface TouchRecorderProps {
  children: ReactNode;
  /** Có ghi chữ hiển thị làm nhãn không (`config.bugReport.recordVisibleText`). */
  recordVisibleText: boolean;
  /** Bộ đệm đích. Mặc định: `actionBuffer` dùng chung của app. */
  buffer?: ActionBuffer;
}

const touchCount = (e: GestureResponderEvent): number => {
  const raw = e as unknown as { touches?: unknown; nativeEvent?: { touches?: unknown } };
  const list = Array.isArray(raw.touches) ? raw.touches : raw.nativeEvent?.touches;
  return Array.isArray(list) ? list.length : 1;
};

/**
 * **Chức năng:** bọc cây app, ghi lại thao tác của QA — chạm, chạm giữ, nhập liệu, nút Back, app
 * xuống/lên nền — vào {@link ActionBuffer} để bug report dựng "các bước tái hiện".
 *
 * ## Cách bắt
 *
 * Chỉ **nghe** `onTouchStart/Move/End/Cancel` trên View gốc (sự kiện nổi bọt từ mọi con), không
 * xin quyền responder nên **không** tranh cử chỉ với nút hay `ScrollView` của app. Nhãn lấy từ
 * fiber của phần tử bị chạm ngay lúc `onTouchStart` (xem `describeTouchTarget`), đã che dữ liệu
 * cá nhân. Không nhận diện được phần tử ⇒ **không ghi** (không ghi "chạm vào cái gì đó").
 *
 * - Dịch > 10 dp (kể cả giữa chừng) ⇒ cuộn, không ghi. Từ hai ngón ⇒ không ghi.
 * - Giữ ≥ 500 ms ⇒ `long-press`; ô nhập luôn là `input`.
 * - Ghi lúc nhả (hoặc bị huỷ sau một lần bắt đầu hợp lệ), `at` = lúc **bắt đầu** chạm.
 * - Back: ghi rồi trả `false` — **không nuốt** Back của app.
 * - `background`/`foreground`: chỉ ghi `foreground` khi trước đó đã `background`.
 *
 * **Input:** {@link TouchRecorderProps}. **Output:** View `flex: 1` bọc `children`. Gỡ mọi listener
 * khi unmount.
 *
 * ⚠️ Fiber là nội bộ của React, không phải API công khai — thiếu thì bỏ qua chứ không ném.
 *
 * @example
 * ```tsx
 * <TouchRecorder recordVisibleText buffer={actionBuffer}>
 *   <App />
 * </TouchRecorder>
 * // Ca biên: chạm vào vùng không có nhãn/onPress nào ⇒ không có thao tác nào được ghi.
 * ```
 *
 * **Unit test:** `TouchRecorder.test.tsx` — 15 case: flex 1 · tap · ngưỡng dịch 10/11 · trượt giữa
 * chừng · long-press 499/500 ms · hai ngón · cancel · end không start · ô nhập · không nhận diện
 * được · `recordVisibleText` bật/tắt · buffer dùng chung · Back không bị nuốt · background/foreground
 * · unmount gỡ listener.
 */
export function TouchRecorder({ children, recordVisibleText, buffer }: TouchRecorderProps) {
  const target = buffer ?? actionBuffer;
  const visibleRef = useRef(recordVisibleText);
  visibleRef.current = recordVisibleText;
  const bufferRef = useRef(target);
  bufferRef.current = target;
  const gesture = useRef<Gesture | null>(null);

  useEffect(() => {
    let wasBackground = false;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      bufferRef.current.push({ at: Date.now(), kind: 'back', source: 'none' });
      return false;
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        wasBackground = true;
        bufferRef.current.push({ at: Date.now(), kind: 'background', source: 'none' });
      } else if (state === 'active' && wasBackground) {
        wasBackground = false;
        bufferRef.current.push({ at: Date.now(), kind: 'foreground', source: 'none' });
      }
    });
    return () => {
      back.remove();
      app.remove();
    };
  }, []);

  const onTouchStart = (e: GestureResponderEvent) => {
    if (touchCount(e) > 1) {
      if (gesture.current) gesture.current.void = true;
      return;
    }
    gesture.current = null;
    const fiber = fiberFromTouchEvent(e);
    if (!fiber) return;
    const described = describeTouchTarget(fiber, { recordVisibleText: visibleRef.current });
    if (!described) return;
    const { pageX, pageY } = e.nativeEvent;
    gesture.current = { at: Date.now(), x: pageX, y: pageY, target: described, void: false };
  };

  const track = (e: GestureResponderEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (touchCount(e) > 1) g.void = true;
    const { pageX, pageY } = e.nativeEvent;
    if (Math.abs(pageX - g.x) > TAP_SLOP || Math.abs(pageY - g.y) > TAP_SLOP) g.void = true;
  };

  const finish = (e: GestureResponderEvent) => {
    track(e);
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.void) return;
    const long = Date.now() - g.at >= LONG_PRESS_MS;
    bufferRef.current.push({
      at: g.at,
      kind: g.target.kind === 'input' ? 'input' : long ? 'long-press' : 'tap',
      ...(g.target.label !== undefined ? { label: g.target.label } : {}),
      source: g.target.source,
    });
  };

  return (
    <View
      style={ROOT_STYLE}
      onTouchStart={onTouchStart}
      onTouchMove={track}
      onTouchEnd={finish}
      onTouchCancel={finish}
    >
      {children}
    </View>
  );
}
