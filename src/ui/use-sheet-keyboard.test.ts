import { act, renderHook } from '@testing-library/react-native';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';
import { useSheetKeyboard } from './use-sheet-keyboard';

/*
  Bắt listener `Keyboard` theo tên sự kiện để tự phát — `KeyboardObserver` của preset là mock câm.
  `duration: 0` để nhánh iOS không cấu hình `LayoutAnimation` (không có gì để kiểm ở đó trong jest).
*/
let listeners: Record<string, Array<(e: KeyboardEvent) => void>> = {};
const emit = (name: string, height = 0) =>
  act(() =>
    (listeners[name] ?? []).forEach((fn) =>
      fn({
        duration: 0,
        easing: 'keyboard',
        endCoordinates: { height, width: 390, screenX: 0, screenY: 800 - height },
        startCoordinates: { height: 0, width: 390, screenX: 0, screenY: 800 },
        isEventFromThisApp: true,
      } as KeyboardEvent),
    ),
  );

beforeEach(() => {
  listeners = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, fn) => {
    (listeners[name] ??= []).push(fn as (e: KeyboardEvent) => void);
    return {
      remove: () => {
        listeners[name] = (listeners[name] ?? []).filter((x) => x !== fn);
      },
    } as ReturnType<typeof Keyboard.addListener>;
  });
});
afterEach(() => jest.restoreAllMocks());

const asAndroid = () => jest.replaceProperty(Platform, 'OS', 'android');

describe('useSheetKeyboard', () => {
  it('iOS: nghe `keyboardWill…`, đệm đúng chiều cao bàn phím (bỏ qua chế độ Android)', () => {
    const { result } = renderHook(() => useSheetKeyboard(true, 'adjustResize'));
    expect(Object.keys(listeners).sort()).toEqual(['keyboardWillHide', 'keyboardWillShow']);

    emit('keyboardWillShow', 336);
    expect(result.current).toEqual({ shown: true, padding: 336 });
  });

  it('Android `adjustPan`: nghe `keyboardDid…` và đệm bằng chiều cao bàn phím', () => {
    asAndroid();
    const { result } = renderHook(() => useSheetKeyboard(true, 'adjustPan'));
    expect(Object.keys(listeners).sort()).toEqual(['keyboardDidHide', 'keyboardDidShow']);

    emit('keyboardDidShow', 300);
    expect(result.current).toEqual({ shown: true, padding: 300 });
  });

  it('Android `adjustPan` + cửa sổ edge-to-edge: chiều cao RN báo KHÔNG gồm thanh điều hướng ⇒ đệm thêm inset đáy', () => {
    /* Đo trên SM-M346B (Android 14, edge-to-edge), 6/11/2026: bàn phím 873 px tính từ đỉnh thanh
       điều hướng, thanh cao 135 px; không cộng thì chân sheet nằm dưới bàn phím đúng 135 px. */
    asAndroid();
    const { result } = renderHook(() => useSheetKeyboard(true, 'adjustPan', 48));

    emit('keyboardDidShow', 300);
    expect(result.current).toEqual({ shown: true, padding: 348 });
  });

  it('iOS: chiều cao bàn phím đã tính từ đáy màn ⇒ KHÔNG cộng inset đáy', () => {
    const { result } = renderHook(() => useSheetKeyboard(true, 'adjustPan', 34));

    emit('keyboardWillShow', 336);
    expect(result.current).toEqual({ shown: true, padding: 336 });
  });

  it('Android `adjustResize`: báo bàn phím đang hiện nhưng KHÔNG đệm (cửa sổ đã tự co)', () => {
    asAndroid();
    const { result } = renderHook(() => useSheetKeyboard(true, 'adjustResize'));

    emit('keyboardDidShow', 300);
    expect(result.current).toEqual({ shown: true, padding: 0 });
  });

  it('bàn phím ẩn ⇒ về 0', () => {
    const { result } = renderHook(() => useSheetKeyboard(true, 'adjustPan'));
    emit('keyboardWillShow', 336);
    emit('keyboardWillHide');

    expect(result.current).toEqual({ shown: false, padding: 0 });
  });

  it('`active=false` ⇒ không nghe gì; tắt giữa chừng ⇒ gỡ listener và về 0', () => {
    const { result, rerender } = renderHook(({ active }) => useSheetKeyboard(active, 'adjustPan'), {
      initialProps: { active: false },
    });
    expect(Keyboard.addListener).not.toHaveBeenCalled();

    rerender({ active: true });
    emit('keyboardWillShow', 336);
    rerender({ active: false });

    expect(listeners.keyboardWillShow).toEqual([]);
    expect(result.current).toEqual({ shown: false, padding: 0 });
  });
});
