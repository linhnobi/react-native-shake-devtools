import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

/**
 * **Chức năng:** nút Back cứng của Android đóng sheet đang mở — dùng chung cho cả hai bộ sheet.
 * gorhom 5.2.14 **không** tự đăng ký `BackHandler` (soát `lib/` của gói: không có), nên trước đây
 * Back đi thẳng xuống app (điều hướng lùi hoặc thoát app) trong khi sheet vẫn nằm trên màn.
 *
 * Chỉ đăng ký khi `visible`, và đăng ký lại **chỉ** khi `visible` đổi — `onBack` đọc qua ref. Lý
 * do: `BackHandler` gọi handler theo thứ tự **ngược** thứ tự đăng ký. Trang con trong sheet (trang
 * chi tiết của `LogSheet`) đăng ký handler "lùi một cấp" **sau** sheet nên được gọi trước; nếu
 * handler của sheet đăng ký lại mỗi lần `onBack` đổi tham chiếu thì nó nhảy lên sau trang con, và
 * Back đóng cả sheet thay vì lùi một cấp.
 *
 * iOS không có Back cứng — `BackHandler` ở đó không bao giờ bắn.
 *
 * **Input:** `visible` · `onBack` (thường là "người dùng đóng sheet"). **Output:** không. Handler
 * trả `true` ⇒ Back dừng ở sheet, không xuống app.
 *
 * @example
 * ```ts
 * useSheetBackHandler(visible, requestDismiss);
 * // Ca biên: hai sheet cùng mount nhưng chỉ một `visible` ⇒ chỉ một handler được đăng ký.
 * ```
 *
 * **Unit test:** `use-sheet-back-handler.test.ts` › `useSheetBackHandler` — 4 case: `visible=false`
 * không đăng ký · `visible=true` ⇒ Back gọi `onBack` và trả `true` · đổi `onBack` không đăng ký lại
 * (handler đăng ký sau vẫn được gọi trước) nhưng gọi bản mới · `visible` về `false` ⇒ gỡ handler.
 */
export const useSheetBackHandler = (visible: boolean, onBack: () => void): void => {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBackRef.current();
      return true;
    });
    return () => sub.remove();
  }, [visible]);
};
