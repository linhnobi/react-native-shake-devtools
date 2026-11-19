import { throttleListener } from './throttle-listener';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('throttleListener', () => {
  it('lần đầu gọi ngay', () => {
    const fn = jest.fn();
    const t = throttleListener(fn, 250);

    t.listener();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  /* Listener của `useSyncExternalStore` không mang dữ liệu — gộp ba lần thành một không mất gì. */
  it('các lần trong cửa sổ gộp thành một lần ở cuối cửa sổ', () => {
    const fn = jest.fn();
    const t = throttleListener(fn, 250);

    t.listener();
    jest.advanceTimersByTime(100);
    t.listener();
    t.listener();
    t.listener();
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(149);
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('sau quãng yên lại gọi ngay', () => {
    const fn = jest.fn();
    const t = throttleListener(fn, 250);

    t.listener();
    jest.advanceTimersByTime(400);
    t.listener();

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('`cancel` bỏ lượt đang hẹn', () => {
    const fn = jest.fn();
    const t = throttleListener(fn, 250);

    t.listener();
    t.listener();
    t.cancel();
    jest.advanceTimersByTime(1000);

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
