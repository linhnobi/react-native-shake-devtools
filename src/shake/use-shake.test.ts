import { renderHook } from '@testing-library/react-native';
import { createShakeState, stepShake, type ShakeStep } from './detect-shake';
import { resolveShakeConfig } from './shake-config';
import { useShake } from './use-shake';

type MockReading = { x: number; y: number; z: number };
type MockReaction = {
  prepare: () => MockReading;
  react: (current: MockReading, previous: MockReading | null) => void;
  deps: readonly unknown[];
};

/*
  Reanimated giả ở RANH MODULE — thứ được test là phần nối dây của hook, không phải Reanimated.
  - `sensor` là object thường: test đặt `value` rồi gọi `emit`, thay cho luồng UI.
  - `useAnimatedReaction` giữ worklet của lần đăng ký trước và CHỈ thay khi `deps` đổi, như bản
    thật. Mock mà thay handler mỗi render thì case "đổi `onShake`" xanh cả khi hook giữ closure cũ.
  - `runOnJS(fn)` trả thẳng `fn`.
*/
const mockSensor: { value: MockReading; isAvailable: boolean } = {
  value: { x: 0, y: 0, z: 0 },
  isAvailable: true,
};
let mockReaction: MockReaction | undefined;

jest.mock('react-native-reanimated', () => {
  const { useRef } = jest.requireActual('react');
  const sameDeps = (a: readonly unknown[], b: readonly unknown[]) =>
    a.length === b.length && a.every((d, i) => Object.is(d, b[i]));
  return {
    SensorType: { ACCELEROMETER: 1 },
    useAnimatedSensor: () => ({ sensor: mockSensor, isAvailable: mockSensor.isAvailable }),
    useSharedValue: (init: unknown) => useRef({ value: init }).current,
    useAnimatedReaction: (
      prepare: MockReaction['prepare'],
      react: MockReaction['react'],
      deps: readonly unknown[] = [],
    ) => {
      if (!mockReaction || !sameDeps(mockReaction.deps, deps)) {
        mockReaction = { prepare, react, deps };
      }
    },
    runOnJS: (fn: () => void) => fn,
  };
});

/* Spy xuyên qua bản thật: mặc định chạy thuật toán thật, case nào cần "bắn" thì ép một lần. */
jest.mock('./detect-shake', () => {
  const actual = jest.requireActual('./detect-shake');
  return { ...actual, stepShake: jest.fn(actual.stepShake) };
});

const stepShakeMock = jest.mocked(stepShake);

/* Một tham chiếu cho mọi render ⇒ deps `[config]` không đổi ⇒ worklet không dựng lại. */
const CFG = resolveShakeConfig();
const READING: MockReading = { x: 0, y: 0, z: 9.81 };
const FIRED: ShakeStep = { state: createShakeState(), fired: true };

/** Đẩy một mẫu theo đường Reanimated đi: `sensor.value` đổi → `prepare` đọc → `react` xử lý. */
const emit = (reading: MockReading) => {
  mockSensor.value = reading;
  const reaction = mockReaction;
  if (!reaction) throw new Error('hook chưa đăng ký useAnimatedReaction');
  reaction.react(reaction.prepare(), null);
};

beforeEach(() => {
  mockSensor.isAvailable = true;
  mockReaction = undefined;
  stepShakeMock.mockClear();
});

describe('useShake', () => {
  it('trả đúng `isAvailable` của sensor', () => {
    expect(renderHook(() => useShake(jest.fn(), CFG)).result.current).toBe(true);

    // Ca biên: máy không có gia tốc kế ⇒ app phải có đường vào dự phòng.
    mockSensor.isAvailable = false;
    expect(renderHook(() => useShake(jest.fn(), CFG)).result.current).toBe(false);
  });

  it('`stepShake` nhận đúng `x/y/z` của mẫu', () => {
    renderHook(() => useShake(jest.fn(), CFG));
    emit({ x: 1.5, y: -2, z: 9.81 });

    expect(stepShakeMock).toHaveBeenCalledTimes(1);
    expect(stepShakeMock).toHaveBeenCalledWith(
      createShakeState(),
      { t: expect.any(Number), x: 1.5, y: -2, z: 9.81 },
      CFG,
    );
  });

  it('`fired` ⇒ gọi `onShake` đúng một lần', () => {
    const onShake = jest.fn();
    renderHook(() => useShake(onShake, CFG));

    emit(READING);
    expect(onShake).not.toHaveBeenCalled();

    stepShakeMock.mockReturnValueOnce(FIRED);
    emit(READING);
    // Mẫu sau chạy bản thật trên state vừa ghi (chưa mồi) ⇒ chỉ mồi nền, không bắn nữa.
    emit(READING);
    expect(onShake).toHaveBeenCalledTimes(1);
  });

  /*
    `CFG` giữ nguyên ⇒ mock giữ worklet của render ĐẦU, đúng như Reanimated thật. Hook chỉ gọi
    được hàm mới nếu nó đọc `onShake` qua ref thay vì bắt thẳng vào closure của worklet.
  */
  it('đổi `onShake` giữa chừng thì lần bắn sau gọi hàm MỚI (không giữ closure cũ)', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = renderHook(({ cb }: { cb: () => void }) => useShake(cb, CFG), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });

    stepShakeMock.mockReturnValueOnce(FIRED);
    emit(READING);

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
