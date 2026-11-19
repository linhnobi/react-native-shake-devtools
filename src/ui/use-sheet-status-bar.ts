import { useEffect, useRef } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { useTheme } from './use-styles';
import type { DevToolsColorScheme } from './theme';

type StackEntry = ReturnType<typeof StatusBar.pushStackEntry>;

/**
 * Thanh trạng thái nằm **trên lớp phủ** (đã làm tối app), không nằm trên sheet — nên kiểu chữ phải
 * hợp với màu lớp phủ trộn lên app, mà app thì theo hệ thống:
 *
 * | hệ thống | sheet | nền thật sau thanh trạng thái | kiểu |
 * |---|---|---|---|
 * | sáng | tối (phủ 0,6) | xám ≈ #666 | `light-content` (5,7 : 1; chữ tối chỉ 3,7) |
 * | sáng | sáng (phủ 0,5) | xám ≈ #808080 | `dark-content` (5,3 : 1) |
 * | tối | bất kỳ | gần đen | `light-content` (chữ tối trên nền này gần như biến mất — đo trên máy) |
 *
 * Tức: chỉ khi **cả hai** đều sáng mới dùng chữ tối. Theo thẳng theme của sheet thì hỏng ở dòng cuối
 * (panel ép sáng trên máy tối).
 */
const barStyleOf = (sheet: DevToolsColorScheme, system: string | null | undefined) =>
  sheet === 'light' && system !== 'dark' ? ('dark-content' as const) : ('light-content' as const);

/**
 * **Chức năng:** khi một sheet của lib đang mở, đẩy một mục vào ngăn xếp `StatusBar` của RN với
 * `barStyle` đọc được trên lớp phủ (xem {@link barStyleOf}), và gỡ đúng mục đó khi đóng / gỡ sheet.
 * Dùng chung cho cả hai bộ sheet (`Sheet` gorhom · `PlainSheet`), nên sheet mới dựng trên cùng lớp
 * này tự có.
 *
 * ## Vì sao
 *
 * Kiểu chữ thanh trạng thái do app/hệ thống chọn, không biết lớp phủ của sheet. Theme của panel ép
 * ngược hệ thống (panel tối trên máy sáng) ⇒ icon tối trên lớp phủ tối, khó đọc.
 *
 * ## Vì sao dùng ngăn xếp, không `setBarStyle`
 *
 * `StatusBar.pushStackEntry`/`popStackEntry` theo **tham chiếu mục**: gỡ mục của mình không đụng mục
 * của `<StatusBar>` app hay của sheet khác, kể cả khi hai sheet chồng/nối nhau; RN gộp các lần cập
 * nhật trong một khung (`setImmediate`) nên panel ⇒ nhật ký không nháy về kiểu app ở giữa. Đổi theme
 * khi đang mở thì `replaceStackEntry` tại chỗ (giữ nguyên vị trí trong ngăn xếp).
 *
 * ⚠️ App chỉ dùng `StatusBar.setBarStyle(...)` bắt buộc (không có `<StatusBar>` khai báo) thì ngăn xếp
 * rỗng sau khi đóng, RN trả về kiểu mặc định — app nên dùng `<StatusBar barStyle>`.
 *
 * Màu thanh điều hướng Android **không** nằm trong phạm vi (cần native).
 *
 * **Input:** `visible` — sheet đang mở. **Output:** không.
 *
 * @example
 * ```tsx
 * useSheetStatusBar(visible);
 * // Ca biên: sheet theme tối ⇒ 'light-content'; đổi sang sáng khi đang mở ⇒ 'dark-content' (cùng mục).
 * ```
 *
 * **Unit test:** `sheet-status-bar.test.tsx` — mỗi kit 11 case: kiểu theo bảng sheet × hệ thống (4) ·
 * hệ thống đổi khi đang mở · chưa mở thì không đụng · đóng và gỡ khi đang mở đều trả kiểu app · đổi
 * theme sheet cập nhật tại chỗ · hai sheet nối tiếp · hai sheet chồng gỡ đúng mục.
 */
export const useSheetStatusBar = (visible: boolean): void => {
  const { mode } = useTheme();
  const system = useColorScheme();
  const style = barStyleOf(mode, system);
  const entry = useRef<StackEntry | null>(null);
  /* Kiểu đang nằm trong mục — để lượt chạy đầu của effect thứ hai không thay mục bằng chính nó. */
  const applied = useRef(style);

  useEffect(() => {
    if (!visible) return;
    applied.current = style;
    entry.current = StatusBar.pushStackEntry({ barStyle: style, animated: true });
    return () => {
      if (entry.current) StatusBar.popStackEntry(entry.current);
      entry.current = null;
    };
    // Chỉ `visible` mở/đóng mục; đổi theme khi đang mở do effect dưới thay tại chỗ.
  }, [visible]);

  useEffect(() => {
    if (!entry.current || applied.current === style) return;
    applied.current = style;
    entry.current = StatusBar.replaceStackEntry(entry.current, { barStyle: style, animated: true });
  }, [style]);
};
