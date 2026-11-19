import { act, render } from '@testing-library/react-native';
import { AppState, Text, View, type AppStateStatus } from 'react-native';
import { actionBuffer, createActionBuffer, type ActionBuffer } from '../../capture/action-buffer';
import { mockBackHandler, type BackHandlerMock } from '../../testing/back-handler.mock';
import type { FiberLike } from './fiber-label';
import { TouchRecorder } from './TouchRecorder';

const fiber = (props: Record<string, unknown>, type: unknown = 'View'): FiberLike => ({
  tag: 5,
  type,
  memoizedProps: props,
  return: null,
  child: null,
  sibling: null,
});

const pressable = (label = 'Đăng nhập'): FiberLike => fiber({ onPress: () => undefined, accessibilityLabel: label });

interface EvOpts {
  target?: FiberLike | null;
  x?: number;
  y?: number;
  touches?: number;
}
const ev = ({ target = pressable(), x = 100, y = 200, touches = 1 }: EvOpts = {}) => ({
  _targetInst: target ?? undefined,
  nativeEvent: { pageX: x, pageY: y, touches: Array.from({ length: touches }, () => ({})) },
  touches: Array.from({ length: touches }, () => ({})),
});

let buffer: ActionBuffer;
let back: BackHandlerMock;
let appStateListeners: Array<(s: AppStateStatus) => void>;
let removeAppState: jest.Mock;

const setup = (recordVisibleText = true) => {
  const utils = render(
    <TouchRecorder buffer={buffer} recordVisibleText={recordVisibleText}>
      <Text>child</Text>
    </TouchRecorder>,
  );
  const root = utils.UNSAFE_getByType(View);
  const props = root.props as Record<string, (e: unknown) => void>;
  return {
    ...utils,
    root,
    start: (o?: EvOpts) => act(() => props.onTouchStart?.(ev(o))),
    move: (o?: EvOpts) => act(() => props.onTouchMove?.(ev(o))),
    end: (o?: EvOpts) => act(() => props.onTouchEnd?.(ev(o))),
    cancel: (o?: EvOpts) => act(() => props.onTouchCancel?.(ev(o))),
  };
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_000_000);
  buffer = createActionBuffer();
  back = mockBackHandler();
  appStateListeners = [];
  removeAppState = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
    if (type === 'change') appStateListeners.push(listener);
    return { remove: removeAppState };
  });
});

afterEach(() => {
  back.restore();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('TouchRecorder — chạm', () => {
  it('render children và View gốc có flex: 1', () => {
    const { root, getByText } = setup();
    expect(getByText('child')).toBeTruthy();
    expect(root.props.style).toEqual({ flex: 1 });
  });

  it('chạm (dịch ≤ 10, giữ < 500 ms) ⇒ một tap, at = lúc bắt đầu chạm', () => {
    const t = setup();
    t.start();
    jest.advanceTimersByTime(120);
    t.end({ x: 105, y: 207 });

    expect(buffer.snapshot()).toEqual([
      { at: 1_000_000, kind: 'tap', label: 'Đăng nhập', source: 'accessibilityLabel' },
    ]);
  });

  it('dịch đúng 10 vẫn là tap; dịch 11 ⇒ cuộn, không ghi', () => {
    const t = setup();
    t.start();
    t.end({ x: 110, y: 200 });
    expect(buffer.snapshot()).toHaveLength(1);

    t.start();
    t.end({ x: 111, y: 200 });
    expect(buffer.snapshot()).toHaveLength(1);

    t.start();
    t.end({ x: 100, y: 211 });
    expect(buffer.snapshot()).toHaveLength(1);
  });

  it('đã trượt xa giữa chừng (onTouchMove) rồi quay lại vẫn là cuộn, không ghi', () => {
    const t = setup();
    t.start();
    t.move({ x: 100, y: 260 });
    t.end({ x: 100, y: 200 });
    expect(buffer.snapshot()).toEqual([]);
  });

  it('giữ 500 ms ⇒ long-press; 499 ms ⇒ tap', () => {
    const t = setup();
    t.start();
    jest.advanceTimersByTime(499);
    t.end();
    t.start();
    jest.advanceTimersByTime(500);
    t.end();

    expect(buffer.snapshot().map((a) => a.kind)).toEqual(['tap', 'long-press']);
  });

  it('hai ngón (touches.length === 2) ⇒ không ghi, kể cả khi ngón đầu nhả trước', () => {
    const t = setup();
    t.start();
    t.start({ touches: 2 });
    t.end({ touches: 1 });
    t.end({ touches: 0 });
    expect(buffer.snapshot()).toEqual([]);

    /* Cử chỉ kế tiếp một ngón vẫn ghi bình thường. */
    t.start();
    t.end({ touches: 0 });
    expect(buffer.snapshot()).toHaveLength(1);
  });

  it('onTouchCancel sau start hợp lệ ⇒ vẫn ghi như end', () => {
    const t = setup();
    t.start();
    t.cancel();
    expect(buffer.snapshot()).toHaveLength(1);
    expect(buffer.snapshot()[0]?.kind).toBe('tap');
  });

  it('end không có start ⇒ không ghi; một start chỉ ghi một lần', () => {
    const t = setup();
    t.end();
    expect(buffer.snapshot()).toEqual([]);
    t.start();
    t.end();
    t.end();
    expect(buffer.snapshot()).toHaveLength(1);
  });

  it('ô nhập ⇒ kind input; giữ lâu trên ô nhập vẫn là input', () => {
    const input = fiber({ onChangeText: () => undefined, placeholder: 'Email' }, 'RCTSinglelineTextInputView');
    const t = setup();
    t.start({ target: input });
    t.end({ target: input });
    t.start({ target: input });
    jest.advanceTimersByTime(800);
    t.end({ target: input });

    expect(buffer.snapshot().map((a) => [a.kind, a.label, a.source])).toEqual([
      ['input', 'Email', 'placeholder'],
      ['input', 'Email', 'placeholder'],
    ]);
  });

  it('event không có fiber, hoặc fiber không có gì để nhận diện ⇒ không ghi', () => {
    const t = setup();
    t.start({ target: null });
    t.end({ target: null });
    const bare = fiber({});
    t.start({ target: bare });
    t.end({ target: bare });
    expect(buffer.snapshot()).toEqual([]);
  });

  it('`recordVisibleText` quyết định có ghi chữ hiển thị làm nhãn không', () => {
    const textual = fiber({ onPress: () => undefined });
    const rctText: FiberLike = { ...fiber({}, 'RCTText'), return: textual };
    rctText.child = { ...fiber({}), tag: 6, type: null, memoizedProps: 'Đăng nhập', return: rctText };
    textual.child = rctText;
    const on = setup(true);
    on.start({ target: textual });
    on.end({ target: textual });
    expect(buffer.snapshot()[0]).toMatchObject({ label: 'Đăng nhập', source: 'text' });
    on.unmount();
    buffer.clear();

    const off = setup(false);
    off.start({ target: textual });
    off.end({ target: textual });
    const [only] = buffer.snapshot();
    expect(only?.label).toBeUndefined();
    expect(only?.source).toBe('none');
  });

  it('không có `buffer` ⇒ ghi vào actionBuffer dùng chung', () => {
    actionBuffer.clear();
    const utils = render(
      <TouchRecorder recordVisibleText>
        <Text>x</Text>
      </TouchRecorder>,
    );
    const props = utils.UNSAFE_getByType(View).props as Record<string, (e: unknown) => void>;
    act(() => props.onTouchStart?.(ev()));
    act(() => props.onTouchEnd?.(ev()));
    expect(actionBuffer.snapshot()).toHaveLength(1);
    actionBuffer.clear();
  });
});

describe('TouchRecorder — Back và trạng thái app', () => {
  it('Back ⇒ ghi back, handler trả false (không nuốt Back của app)', () => {
    setup();
    expect(back.count()).toBe(1);

    let swallowed = true;
    act(() => {
      swallowed = back.pressBack();
    });

    expect(swallowed).toBe(false);
    expect(buffer.snapshot()).toEqual([{ at: 1_000_000, kind: 'back', source: 'none' }]);
  });

  it('background rồi active ⇒ background, foreground; active lẻ không ghi', () => {
    setup();
    const emit = (s: AppStateStatus) => act(() => appStateListeners.forEach((l) => l(s)));
    emit('active');
    emit('inactive');
    emit('background');
    jest.advanceTimersByTime(5000);
    emit('active');

    expect(buffer.snapshot().map((a) => [a.kind, a.at])).toEqual([
      ['background', 1_000_000],
      ['foreground', 1_005_000],
    ]);
  });

  it('unmount ⇒ gỡ mọi listener', () => {
    const t = setup();
    expect(back.count()).toBe(1);
    expect(appStateListeners).toHaveLength(1);

    t.unmount();

    expect(back.count()).toBe(0);
    expect(removeAppState).toHaveBeenCalledTimes(1);
  });
});
