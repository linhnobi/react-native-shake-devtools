import { logBuffer, type LogBuffer } from './log-buffer';

export interface Markers {
  /**
   * Ghi mốc **đổi màn** và đóng dấu màn đó lên mọi dòng ghi sau. Tên rỗng hoặc trùng màn vừa
   * ghi ⇒ no-op (một lần `onStateChange` của navigation có thể bắn nhiều lần cho cùng một màn).
   */
  screen: (name: string | undefined) => void;
  /** Ghi mốc **người dùng đánh dấu**; trả số thứ tự của mốc (1, 2, 3…). */
  user: () => number;
}

/**
 * **Chức năng:** dựng bộ ghi mốc cho một vòng đệm — mốc đổi màn (tự động) và mốc "Đánh dấu"
 * (người thử bấm).
 *
 * ## Vì sao cần mốc
 *
 * Một dòng `POST … → 500` không nói nó xảy ra ở màn nào, sau thao tác nào. QA phải tả lại bằng
 * lời, BE phải đoán. Mốc đổi màn trả lời câu thứ nhất; mốc "Đánh dấu" (QA bấm ngay trước khi tái
 * hiện) cắt nhật ký thành "trước" và "trong lúc tái hiện".
 *
 * Màn còn được **đóng dấu lên từng dòng** (`LogBuffer.setScreen`), nên file xuất lỗi và màn chi
 * tiết biết màn của một lỗi kể cả khi mốc đã bị vòng đệm đạp ra.
 *
 * **Input:** `buffer` — vòng đệm đích.
 * **Output:** {@link Markers}. Số thứ tự "Đánh dấu" sống theo bộ ghi, **không** về 0 khi xoá
 * nhật ký — hai mốc cùng số trong một buổi thử là thứ gây nhầm khi đối chiếu ảnh chụp.
 *
 * ⚠️ Màn vừa ghi cũng được nhớ qua lần xoá nhật ký: bấm Xoá rồi ở yên màn đó thì danh sách chưa có
 * mốc màn cho tới lần điều hướng sau. Dòng mới **vẫn** được đóng dấu `screen` đúng — chỉ thiếu dải
 * mốc, thứ mắt người dùng để chia khúc.
 *
 * @example
 * ```ts
 * const m = createMarkers(createLogBuffer());
 * m.screen('UserList'); m.screen('UserList');  // ghi MỘT mốc — lần hai trùng
 * m.user();                                    // 1
 * m.screen(undefined);                         // ca biên: no-op, không xoá dấu màn đang có
 * ```
 *
 * **Unit test:** `markers.test.ts` › `createMarkers` — 5 case: `screen` ghi mốc + đóng dấu dòng
 * sau · trùng màn liền nhau chỉ ghi một mốc · tên rỗng/`undefined` là no-op · `user` tăng số thứ
 * tự · số thứ tự không về 0 sau `clear`.
 */
export const createMarkers = (buffer: LogBuffer): Markers => {
  let lastScreen: string | undefined;
  let userSeq = 0;

  return {
    screen: (name) => {
      if (!name || name === lastScreen) return;
      lastScreen = name;
      buffer.setScreen(name);
      buffer.push({
        id: buffer.nextId(),
        kind: 'marker',
        at: Date.now(),
        type: 'screen',
        label: name,
      });
    },
    user: () => {
      userSeq += 1;
      buffer.push({
        id: buffer.nextId(),
        kind: 'marker',
        at: Date.now(),
        type: 'user',
        label: String(userSeq),
      });
      return userSeq;
    },
  };
};

const markers = createMarkers(logBuffer);

/**
 * Ghi mốc đổi màn vào nhật ký dùng chung. App nối vào `NavigationContainer`:
 *
 * ```tsx
 * const track = () => markScreen(navigationRef.getCurrentRoute()?.name);
 * <NavigationContainer ref={navigationRef} onReady={track} onStateChange={track}>
 * ```
 *
 * Gọi khi thu nhật ký đang tắt (bản prod) thì vẫn chỉ ghi vào RAM một mốc vài chục byte — người
 * gọi nên tự khoá theo `DevToolsConfig.enabled` để khỏi giữ gì ở prod.
 */
export const markScreen: Markers['screen'] = markers.screen;

/** Ghi mốc "Đánh dấu" vào nhật ký dùng chung — nút ⚑ của màn nhật ký gọi hàm này. */
export const markUser: Markers['user'] = markers.user;
