/**
 * Giả lập nút Back cứng của Android cho jest — hạ tầng test, **không** export từ entry nào.
 *
 * Vì sao cần: jest chạy với `Platform.OS = 'ios'`, mà `BackHandler.ios.js` của RN là bản câm
 * (`addEventListener` không lưu gì). Bản này chép đúng luật của `BackHandler.android.js` (RN 0.86):
 * handler lưu theo thứ tự đăng ký, Back gọi **từ cuối lên đầu**, dừng ở handler đầu tiên trả `true`;
 * không ai giữ ⇒ Back đi xuống app (`exitApp`).
 */
import { BackHandler, type NativeEventSubscription } from 'react-native';

type Handler = Parameters<typeof BackHandler.addEventListener>[1];

export interface BackHandlerMock {
  /** Bấm Back một lần. `true` ⇒ có handler giữ; `false` ⇒ Back rơi xuống app. */
  pressBack: () => boolean;
  /** Số handler đang đăng ký. */
  count: () => number;
  /** Gỡ spy — gọi trong `afterEach`. */
  restore: () => void;
}

/**
 * **Chức năng:** thay `BackHandler.addEventListener` bằng bản giữ handler như Android.
 *
 * **Input:** không. **Output:** {@link BackHandlerMock}.
 *
 * @example
 * ```ts
 * let back: BackHandlerMock;
 * beforeEach(() => { back = mockBackHandler(); });
 * afterEach(() => back.restore());
 * act(() => { back.pressBack(); });
 * // Ca biên: không component nào đăng ký ⇒ `pressBack()` trả `false` (Back xuống app).
 * ```
 *
 * **Unit test:** không có test riêng — hạ tầng, dùng trong `use-sheet-back-handler.test.ts`,
 * `Sheet.test.tsx`, `PlainSheet.test.tsx`, `LogSheet.test.tsx`, `src/plain/index.test.ts`.
 */
export const mockBackHandler = (): BackHandlerMock => {
  const handlers: Handler[] = [];
  const spy = jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_eventName, handler): NativeEventSubscription => {
      if (!handlers.includes(handler)) handlers.push(handler);
      return {
        remove: () => {
          const i = handlers.indexOf(handler);
          if (i !== -1) handlers.splice(i, 1);
        },
      } as NativeEventSubscription;
    });
  return {
    pressBack: () => {
      const event = {} as Parameters<Handler>[0];
      for (let i = handlers.length - 1; i >= 0; i--) {
        if (handlers[i]?.(event)) return true;
      }
      return false;
    },
    count: () => handlers.length,
    restore: () => spy.mockRestore(),
  };
};
