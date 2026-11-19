import { act, renderHook } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { mockBackHandler, type BackHandlerMock } from '../testing/back-handler.mock';
import { useSheetBackHandler } from './use-sheet-back-handler';

let back: BackHandlerMock;

beforeEach(() => {
  back = mockBackHandler();
});
afterEach(() => back.restore());

describe('useSheetBackHandler', () => {
  it('`visible=false` ⇒ không đăng ký gì, Back rơi xuống app', () => {
    const onBack = jest.fn();
    renderHook(() => useSheetBackHandler(false, onBack));

    expect(back.count()).toBe(0);
    expect(back.pressBack()).toBe(false);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('`visible=true` ⇒ Back gọi `onBack` và dừng ở sheet', () => {
    const onBack = jest.fn();
    renderHook(() => useSheetBackHandler(true, onBack));

    let handled = false;
    act(() => {
      handled = back.pressBack();
    });
    expect(handled).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('đổi `onBack` không đăng ký lại: handler đăng ký sau sheet vẫn được gọi trước, và sheet gọi bản mới', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = renderHook(({ onBack }) => useSheetBackHandler(true, onBack), {
      initialProps: { onBack: first },
    });
    /* Trang con trong sheet (vd trang chi tiết) đăng ký SAU sheet. */
    const child = jest.fn(() => true);
    const childSub = BackHandler.addEventListener('hardwareBackPress', child);

    rerender({ onBack: second });
    act(() => {
      back.pressBack();
    });
    expect(child).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    childSub.remove();
    act(() => {
      back.pressBack();
    });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('`visible` về `false` ⇒ gỡ handler', () => {
    const onBack = jest.fn();
    const { rerender } = renderHook(({ visible }) => useSheetBackHandler(visible, onBack), {
      initialProps: { visible: true },
    });
    expect(back.count()).toBe(1);

    rerender({ visible: false });

    expect(back.count()).toBe(0);
    expect(back.pressBack()).toBe(false);
    expect(onBack).not.toHaveBeenCalled();
  });
});
