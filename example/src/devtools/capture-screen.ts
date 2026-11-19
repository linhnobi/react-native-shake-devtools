import { Dimensions, PixelRatio } from 'react-native';
import { captureScreen as viewShotCaptureScreen } from 'react-native-view-shot';
import type { DevToolsCapturedImage } from 'react-native-shake-devtools';

/**
 * Chụp màn hình app bằng `react-native-view-shot`, cho `bugReport.captureScreen`.
 *
 * **Chức năng:** lib gọi hàm này trước khi panel che màn (lúc lắc hoặc `open()`), và khi QA bấm
 * "Chụp lại". Ảnh là file JPEG chất lượng 0.7 trong thư mục cache của app (`result: 'tmpfile'`),
 * lib chỉ giữ `uri`, không đọc nội dung.
 *
 * **Input:** không có.
 *
 * **Output:** `{ uri, mimeType: 'image/jpeg', width, height }`. `width`/`height` là kích thước
 * cửa sổ nhân tỉ lệ điểm ảnh, tức kích thước thật khi view-shot không bị ép `width`/`height`.
 *
 * 🔴 **Luật chặn chụp nằm ở app, không ở lib.** Hàm trả `null` ⇒ lib hiểu "màn này không cho
 * chụp" và form hiện "màn bị chặn" thay cho ảnh. Example cho chụp mọi màn nên không bao giờ trả
 * `null`. App thật có màn nhạy cảm (nhập PIN, OTP, số thẻ, CCCD) thì chặn ngay đầu hàm này, vd
 * `if (isSensitiveRoute(navigationRef.getCurrentRoute()?.name)) return null;`. ⚠️ `FLAG_SECURE`
 * (Android) **không** chặn được view-shot: đã đo trên SM-M346B (7/11/2026), `screencap` ra 0 byte
 * mà ảnh view-shot vẫn đủ nội dung. Màn nào bật `FLAG_SECURE` thì cũng phải chặn ở đây.
 *
 * Ném lỗi (hoặc quá 1,5 giây) ⇒ lib hiện "không chụp được" và vẫn mở panel, nên không cần
 * `try/catch` ở đây.
 *
 * @example
 * const bugReport = { captureScreen: captureExampleScreen };
 *
 * **Unit test:** không có; example kiểm tay trên máy thật (hàng "Báo bug" ở `example/README.md`).
 */
export const captureExampleScreen = async (): Promise<DevToolsCapturedImage | null> => {
  const uri = await viewShotCaptureScreen({
    format: 'jpg',
    quality: 0.7,
    result: 'tmpfile',
  });
  const { width, height } = Dimensions.get('window');
  const ratio = PixelRatio.get();
  return {
    uri,
    mimeType: 'image/jpeg',
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
};
