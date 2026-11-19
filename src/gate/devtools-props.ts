import type { ReactNode } from 'react';
import type { DevToolsSessionInfo } from '../capture/session-info';
import type { DeepPartial, DevToolsLocale, DevToolsStrings } from '../i18n/types';
import type { DevToolsAppContext } from '../report/app-context';
import type { DevToolsCapturedImage, ScreenshotState } from '../report/bug-report';
import type { DevToolsSecureStore } from '../report/connections/connection-store';
import type { ConnectorType } from '../report/connectors/types';
import type { ShakeConfig } from '../shake/detect-shake';
import type { DevToolsKeyboardInputMode } from '../ui/context';
import type { DevToolsColorScheme } from '../ui/theme';

/**
 * Một hàng trong panel gỡ lỗi.
 *
 * 📌 `label`/`hint` là **chuỗi đã dịch**, không phải key — app gọi `t()` tại render rồi
 * truyền xuống (gọi `t()` tại render, không ở module scope). Truyền key xuống đây sẽ không tra
 * được: key của app nằm ở bộ chuỗi riêng của app, còn lib chỉ có bộ chuỗi (`DevToolsStrings`) của
 * chính nó.
 */
export interface DevToolsAction {
  /** Định danh ổn định — dùng làm `key` của list và hậu tố `testID`. */
  id: string;
  label: string;
  /** Dòng phụ dưới nhãn. Vắng ⇒ hàng một dòng. */
  hint?: string;
  /** Vắng ⇒ hàng vẫn vẽ nhưng **không bấm được** (chỗ cắm chưa nối). */
  onPress?: () => void;
  /** Con số bên phải hàng, vd số request đã bắt. `0` và `undefined` đều là không vẽ. */
  badge?: number;
  /** Bấm xong có đóng panel không. Mặc định `true`; đặt `false` cho hàng bật/tắt cờ. */
  dismissOnPress?: boolean;
  /**
   * Hàng **chọn một** — các lựa chọn hiện sẵn thành chip dưới nhãn, chạm một lần là áp dụng (không
   * phải mở rồi mới chọn). Panel **không đóng** sau cú chạm chip. Có `choices` thì `onPress` bị bỏ qua.
   */
  choices?: readonly DevToolsChoice[];
  /** `id` của chip đang sáng. */
  selectedId?: string;
  /** Gọi khi chạm một chip — kể cả chip đang sáng (app tự quyết có bỏ qua không). */
  onSelect?: (id: string) => void;
}

/** Một lựa chọn của hàng chọn-một. `label` là chuỗi **đã dịch** (cùng luật với `DevToolsAction`). */
export interface DevToolsChoice {
  id: string;
  label: string;
}

/**
 * Một file lib đã dựng xong nội dung, chờ app đưa ra ngoài.
 *
 * Lib dựng **nội dung + tên**, app lo **đường ra** (ghi đĩa, khay chia sẻ, MediaStore) — vì mọi
 * đường ra đều là native module, mà lib không được kéo native module vào (cùng luật với
 * `DeviceLocalePort` của i18n).
 */
export interface DevToolsExportFile {
  /** Tên file gợi ý, đã an toàn cho mọi hệ tệp, vd `'devtools-errors-20260924-142640.txt'`. */
  readonly name: string;
  readonly mimeType: 'text/plain';
  /** Nội dung **đã che** dữ liệu nhạy cảm — app ghi nguyên văn, không che lại. */
  readonly content: string;
}

/**
 * Một file đưa cho `DevToolsBugReportConfig.shareFiles` — ảnh mang `uri` (file trong cache của hàm
 * chụp), file chữ (`errors.txt`, `timeline.json`) mang `content` **đã che**. `name` là tên người nhận
 * thấy. Gate chỉ cho một lần chia sẻ một lúc, và đường gửi ghi tạm dưới tên khác
 * (`<reportId>-<tên>`), nên app ghi file chia sẻ theo `name` không đè file nào đang dùng.
 */
export interface DevToolsShareFile {
  readonly name: string;
  readonly mimeType: string;
  readonly uri?: string;
  readonly content?: string;
}

/**
 * Cấu hình **báo bug trong app** (spec 5.7) — mọi năng lực native do app cấp, lib không có native
 * module. Vắng cả khối ⇒ panel không có hàng "Báo bug", gate không bọc bộ ghi thao tác, không dựng gì.
 *
 * Viết inline được (object mới mỗi lượt render): gate dựng kho kết nối và hàng đợi gửi **một lần**,
 * chỉ dựng lại khi đổi có/không có `secureStore` hoặc đổi **tập id** của `connectorTypes`; các hàm và
 * object mới nhất được đọc lúc dùng.
 *
 * Hàng đợi gửi lưu bền vào `LogStore` của `startCapture({ persist })`, lấy **một lần** lúc dựng (khi
 * gate mount): gọi `startCapture({ persist })` **trước** khi gate mount, không thì hàng đợi chỉ nằm
 * trong RAM cho cả lần chạy đó (màn báo bug nhắc "sẽ mất nếu app bị tắt").
 */
export interface DevToolsBugReportConfig {
  /**
   * Chụp màn hình của app (vd `react-native-view-shot`). Gate gọi **trước** khi panel che màn, ở cả
   * cú lắc lẫn `useDevTools().open()`, và sau khi sheet báo bug đã rời màn (nút Chụp lại).
   *
   * Trả `null` ⇒ "màn này không cho chụp" (luật chặn nằm ở app). Ném, hoặc quá 1,5 s chưa xong ⇒
   * "không chụp được", panel vẫn mở. Vắng ⇒ form không có khối ảnh.
   */
  captureScreen?: () => Promise<DevToolsCapturedImage | null>;
  /**
   * Kho bảo mật (Keychain/Keystore — `react-native-keychain`, `expo-secure-store`…) cho danh sách kết
   * nối và bí mật của QA. Vắng ⇒ không lưu được kết nối, không gửi được; vẫn còn đường Chia sẻ.
   */
  secureStore?: DevToolsSecureStore;
  /**
   * Loại kết nối riêng của app, **cộng thêm** vào các loại có sẵn (Jira Cloud, Slack, Lark, Webhook).
   * Trùng `id` với loại có sẵn ⇒ loại của app thắng.
   */
  connectorTypes?: readonly ConnectorType[];
  /**
   * Chia sẻ nhiều file và ảnh (khay chia sẻ của hệ thống) — dùng khi không gửi được, hoặc sau khi gửi
   * tới đích không nhận file. Vắng ⇒ rơi về `exportFile` (một file chữ) rồi `Share` (chữ).
   */
  shareFiles?: (files: readonly DevToolsShareFile[], message: string) => Promise<void>;
  /**
   * Ghi chuỗi ra file tạm, trả `uri` (`file://…`) — để upload file chữ (`errors.txt`,
   * `timeline.json`) như một file thật trên đĩa. `name` **riêng cho từng bản báo**
   * (`<reportId>-errors.txt`, chỉ gồm `[A-Za-z0-9._-]`): hàng đợi gửi lại nhiều bản **song song**,
   * nên ghi chung một thư mục cũng không đè nhau; tên file đích thấy vẫn là `errors.txt`. Ghi cùng
   * `name` lần nữa thì đè là đúng (cùng bản báo gửi lại). Đường chia sẻ (`shareFiles`) giữ tên gốc.
   *
   * Vắng ⇒ file chữ đi thành phần chuỗi trong bộ nhớ của `FormData` RN (`{ string, name, type }`;
   * Android và iOS gửi được theo mã nguồn RN 0.86 — chưa đo trên máy). Không bao giờ dùng `Blob`.
   */
  writeTempFile?: (name: string, content: string) => Promise<string>;
  /**
   * Lấy **chữ hiển thị** bên trong nút làm nhãn bước chạm (đã che số dài và email). Mặc định `true`;
   * app ngân hàng/y tế nên đặt `false` (chỉ còn `accessibilityLabel`/`testID`).
   */
  recordVisibleText?: boolean;
  /**
   * Ngữ cảnh **riêng của app** gắn vào bản báo bug: user id, bản build/môi trường, cờ tính năng, một
   * lát state Redux/Zustand, `Sentry.lastEventId()`… Trả một **object thường**, đồng bộ hoặc async.
   *
   * - Gọi **một lần lúc dựng bản nháp** (QA bấm hàng "Báo bug"): trạng thái lúc thấy bug. Nháp giữ
   *   nguyên khi đóng/mở lại sheet, nên ngữ cảnh cũng không tự làm mới (như ảnh và các bước).
   * - Ném, reject, quá 1,5 s (`async`), hoặc trả thứ không phải object ⇒ form vẫn mở, chip "Ngữ cảnh
   *   app" ghi không lấy được, bản báo không có ngữ cảnh. Hàm **đồng bộ** treo thì không trần nào cắt
   *   được: giữ hàm này rẻ.
   * - Vào ticket thành mục **"App context"** ngắn (mỗi khoá cấp đầu một dòng, tối đa 10) và file
   *   **`context.json`** (đích nhận file); QA bỏ được bằng chip. Webhook nhận cả hai.
   * - **Đã che** như thân request (`redact.ts`, gồm `startCapture({ redactKeys })`): khoá bí mật ở mọi
   *   tầng và mẫu token. **Không** che dữ liệu cá nhân — user id, email trả về đây được gửi nguyên:
   *   chỉ trả thứ ticket cần, tự che như với `sessionInfo`.
   * - Chịu được vòng, hàm, BigInt, `Date`, `Error`, `Map`/`Set`; có trần sâu 8 tầng, 200 khoá, 100 phần
   *   tử, 2000 ký tự mỗi chuỗi, 32 000 ký tự cả file — phần bị cắt có dấu (`[Object]`, `…+N more`).
   * - **Báo về phiên crash** (nháp mở sau lần crash trước): **không gọi** hàm này, không kèm ngữ cảnh —
   *   ngữ cảnh sau khi mở lại app không phải trạng thái lúc crash.
   *
   * Vắng ⇒ form không có chip "Ngữ cảnh app". Công thức (Redux, Zustand, cờ tính năng, Sentry):
   * `docs/recipes/bug-report-context.md`.
   *
   * @example
   * ```ts
   * appContext: () => ({
   *   userId: store.getState().auth.userId,
   *   flags: featureFlags.snapshot(),
   *   sentryEventId: Sentry.lastEventId(),
   * }),
   * ```
   */
  appContext?: () => DevToolsAppContext | Promise<DevToolsAppContext>;
}

/**
 * Cấu hình panel — thứ **app** phải cấp, vì lib không biết gì về app.
 *
 * Ba thứ cố ý **không** có ở đây: `appEnv`, `version`, `isProd`. Lib nhận `boolean` và
 * `string` đã nấu chín; thêm app mới không phải mở lại union nào trong lib.
 */
export interface DevToolsConfig {
  /**
   * 🔴 **BẮT BUỘC, KHÔNG CÓ MẶC ĐỊNH** — cố ý.
   *
   * Lib không biết "prod" của app bạn là gì, nên nó không được phép đoán. Bắt khai ⇒
   * TypeScript ép mỗi app quyết định ngay tại call-site, và quyết định đó nằm trong một
   * file test được của app.
   *
   * ⚠️ **Đừng khai `__DEV__`**: bản giao tester dựng kiểu nhúng sẵn JS (offline bundle) mà
   * bundle với `--dev true`, nên `__DEV__` ở bản UAT cũng là `true` — nó không phân biệt được uat với
   * prod. Khoá đúng là môi trường lấy từ flavor native.
   */
  enabled: boolean;
  /** Dòng phụ dưới tiêu đề panel, vd `'UAT · 1.0.2'`. Lib không tự đoán được nội dung này. */
  subtitle?: string;
  /** Khai đè ngưỡng lắc. Vắng ⇒ mặc định theo nền tảng, xem `resolveShakeConfig`. */
  shake?: Partial<ShakeConfig>;
  /**
   * Số phút tắt tạm khi người dùng bấm hàng "tắt lắc". Mặc định `30`.
   *
   * Là **số phút** chứ không phải mili-giây vì nó đi thẳng vào nhãn hiển thị.
   */
  snoozeMinutes?: number;
  /**
   * Hiện hàng **Nhật ký** (hàng có sẵn của lib, mở màn xem log). Mặc định `true`.
   *
   * Đặt `false` cho app **không** gọi `startCapture()` — không thì hàng đó mở ra một danh
   * sách vĩnh viễn rỗng và trông như hỏng. Bật thu là việc riêng của app, xem `startCapture`.
   */
  showLog?: boolean;
  /**
   * Đưa file báo cáo lỗi (nút **Xuất lỗi** của màn nhật ký) ra ngoài app.
   *
   * Vắng ⇒ lib rơi về `Share.share({ message })` của lõi RN: vẫn gửi được, nhưng là **khối
   * text** chứ không phải file đính kèm (Android `Share` của lõi không nhận file). App có
   * `react-native-blob-util` + `react-native-share` thì cấp hàm này để ra file thật.
   *
   * Promise **reject** ⇒ màn hiện "Không xuất được"; người dùng tự đóng khay chia sẻ thì app
   * nên **resolve** (đó không phải lỗi).
   */
  exportFile?: (file: DevToolsExportFile) => Promise<void>;
  /**
   * Bản build · máy · user (**đã che**) của phiên đang gỡ — vào hàng "Chép thông tin thiết bị"
   * của panel và đầu file xuất lỗi.
   *
   * Là **hàm**, lib gọi lúc cần (mở panel, bấm xuất) chứ không đọc một lần lúc dựng cấu hình: phiên
   * đăng nhập đổi sau khi app khởi động. Hàm ném ⇒ lib bỏ qua, chỉ thiếu mấy dòng thông tin.
   */
  sessionInfo?: () => DevToolsSessionInfo;
  /**
   * Ngôn ngữ chuỗi dựng sẵn của lib — `'vi'` hoặc `'en'`. Mặc định `'en'`.
   *
   * Chỉ đổi chữ **của vỏ** (tiêu đề, nút, gợi ý…); nhãn từng hàng do app truyền vào đã là chuỗi dịch sẵn
   * của app.
   */
  locale?: DevToolsLocale;
  /**
   * Ghi đè hoặc dịch thêm chuỗi của vỏ — chỉ cần khai khoá muốn đổi, phần còn lại giữ nguyên.
   * Dùng để đổi một câu, hoặc thêm bản dịch cho ngôn ngữ lib chưa có bằng cách khai **cả bộ** vào
   * một trong hai `locale` có sẵn. Biến `{{tên}}` trong câu giữ đúng tên như bản gốc.
   *
   * Giữ tham chiếu **ổn định** (hằng module hoặc `useMemo`) — object mới mỗi render làm bộ chuỗi
   * trộn lại mỗi lần. Khoá lấy từ `DevToolsStrings` (`react-native-shake-devtools/i18n`).
   *
   * @example
   * ```ts
   * strings: { panel: { title: 'Dev menu', snooze: 'Mute shake for {{minutes}} min' } }
   * ```
   */
  strings?: DeepPartial<DevToolsStrings>;
  /**
   * Ép chế độ màu của panel và màn nhật ký: `'light'` hoặc `'dark'`. Vắng ⇒ theo hệ thống
   * (`useColorScheme()`); hệ thống không báo ⇒ sáng.
   *
   * Hữu ích khi app tự quản chế độ màu riêng (không theo hệ thống) — truyền giá trị app đang dùng.
   */
  colorScheme?: DevToolsColorScheme;
  /**
   * **Android:** cửa sổ của app có co lại khi bàn phím mở hay không. Lib không tự biết được, mà khai
   * sai thì màn nhật ký hỏng lúc gõ tìm. iOS bỏ qua trường này. Xem {@link DevToolsKeyboardInputMode}.
   *
   * | Cửa sổ của app trên máy đang chạy | Giá trị |
   * |---|---|
   * | edge-to-edge | `'adjustPan'` *(mặc định)* |
   * | manifest khai `android:windowSoftInputMode="adjustPan"` | `'adjustPan'` |
   * | **không** edge-to-edge + manifest `adjustResize` | `'adjustResize'` |
   *
   * Cùng một bản build có thể rơi vào hai dòng khác nhau tuỳ đời Android. Với React Native 0.86 và
   * target SDK ≥ 35, cửa sổ tự thành edge-to-edge trên Android 16+, và trên Android 15 nếu theme
   * không opt-out (`windowOptOutEdgeToEdgeEnforcement`), kể cả khi `edgeToEdgeEnabled=false`. App để
   * mặc định của khuôn RN 0.86 vì vậy chỉ không edge-to-edge trên Android ≤ 14, nên tính theo máy:
   *
   * ```ts
   * androidKeyboardInputMode: Platform.OS === 'android' && Number(Platform.Version) < 35 ? 'adjustResize' : 'adjustPan',
   * ```
   *
   * Cách gọn nhất là bật `edgeToEdgeEnabled=true` rồi để mặc định: mọi đời máy đều đúng.
   *
   * Đã đo trên Samsung SM-M346B (Android 14): không edge-to-edge thì `'adjustPan'` bù hai lần,
   * `'adjustResize'` đúng; edge-to-edge thì `'adjustPan'` đúng, `'adjustResize'` để bàn phím che chân
   * sheet. Phần Android 15/16 suy từ `WindowUtil.kt` của RN 0.86, **chưa đo** trên máy.
   */
  androidKeyboardInputMode?: DevToolsKeyboardInputMode;
  /**
   * Bật **báo bug trong app**: hàng "Báo bug" ở đầu panel, ảnh chụp lúc lắc, các bước tự ghi, gửi tới
   * Jira/Slack/Webhook do QA tự cấu hình. Vắng ⇒ không có gì của tính năng này. Xem
   * {@link DevToolsBugReportConfig}.
   */
  bugReport?: DevToolsBugReportConfig;
}

export interface DevToolsGateProps {
  config: DevToolsConfig;
  /** Các hàng của panel. Mảng rỗng ⇒ panel chỉ còn hàng tắt-lắc (vẫn mở được để thử cú lắc). */
  actions: DevToolsAction[];
  /**
   * Cây con được bọc, để nơi bên trong gọi `useDevTools()` mở panel bằng code (vd chạm 7 lần
   * vào dòng phiên bản). Vắng ⇒ gate vẫn chạy đủ, chỉ là không ai gọi `useDevTools()` được.
   */
  children?: ReactNode;
}

export interface DevToolsPanelProps {
  visible: boolean;
  onDismiss: () => void;
  subtitle?: string;
  actions: DevToolsAction[];
  onSnooze: () => void;
  snoozeMinutes: number;
  /** Vắng ⇒ không vẽ hàng Nhật ký (app tự tắt qua `DevToolsConfig.showLog`). */
  onOpenLog?: () => void;
  /** Mở màn xem **phiên trước**. Panel chỉ vẽ hàng/dải khi có cả hàm này lẫn phiên đã lưu. */
  onOpenPrevious?: () => void;
  /** Xem `DevToolsConfig.sessionInfo`. */
  sessionInfo?: () => DevToolsSessionInfo;
  /** Hàng "Báo bug" (đứng đầu panel). Vắng ⇒ không vẽ — app không khai `DevToolsConfig.bugReport`. */
  report?: DevToolsPanelReportRow;
}

/** Dữ liệu của hàng "Báo bug" — panel tự dựng dòng phụ từ đây. */
export interface DevToolsPanelReportRow {
  /** Đang có bản nháp ⇒ dòng phụ "Có bản nháp" (ảnh và bước của nháp không tự làm mới). */
  readonly hasDraft: boolean;
  /** Ảnh chụp lúc mở panel. */
  readonly screenshot: ScreenshotState;
  /** Số bước một bản nháp mới sẽ có. */
  readonly steps: number;
  /**
   * Bản báo hàng đợi chưa gửi xong: `waiting` (đang gửi / chờ gửi lại) và `attention` (thất bại · bị
   * chặn · không chắc đã gửi). Số > 0 ⇒ dòng phụ thêm `· N chờ gửi` / `· N cần xử lý`. Vắng ⇒ như 0.
   */
  readonly queue?: { readonly waiting: number; readonly attention: number };
  readonly onPress: () => void;
}

export interface DevToolsRowProps {
  label: string;
  hint?: string;
  onPress?: () => void;
  badge?: number;
  testID: string;
}
