[English](for-developers.md) · **Tiếng Việt**

# Cho dev: QA của bạn gửi trang này

`react-native-shake-devtools` cho QA lắc máy trên bản test rồi gửi một ticket điền sẵn (ảnh màn
hình, các bước tự ghi, log lỗi, thông tin máy, ngữ cảnh app nếu có) thẳng vào Jira, Slack,
Lark/Feishu hoặc webhook của team. Nó cũng là một panel devtools ngay trong app React Native: log
console, HTTP, lỗi, và phiên trước khi app crash.

Trang này là bản ngắn. Chi tiết đầy đủ ở [README.vi.md](../README.vi.md).

## Vì sao cài vào bản test là an toàn

- **App quyết định khi nào chạy.** `enabled` là trường bắt buộc ở `startCapture` và `DevToolsGate`,
  không có mặc định, không bao giờ suy từ `__DEV__`. Khác `true` thì capture không vá gì, không ghi
  gì; `false` thì gate chỉ render app của bạn (không panel, không nghe lắc, không ghi thao tác).
- **Gỡ hẳn khỏi bản prod được.** Với `enabled: false`, code vẫn nằm trong bundle nhưng không làm gì.
  Resolver Metro (`react-native-shake-devtools/metro`) tráo mọi import của lib sang bản noop rỗng cùng
  tên export, nên code app giữ nguyên một dòng import cho mọi flavor. Import một đường khác của gói
  thì bundle dừng với lỗi, thay vì lặng lẽ mang code thật vào.
- **Thứ gì rời máy cũng được che.** Chia sẻ, xuất file, log lưu xuống đĩa và bug report đều qua một
  luật (`src/capture/redact.ts`): token, mật khẩu, cookie, API key, JWT, giá trị `Bearer` và các tiền
  tố token đã biết thành `<redacted>`. cURL thô không bao giờ vào bug report.
- **Bí mật chỉ nằm trong secure store của app.** Token của kết nối chỉ sống trong `secureStore` app
  cấp (Keychain/Keystore), không bao giờ vào nhật ký, file log trên đĩa, `console.*` hay chuỗi lỗi.
- **Request của chính tool không vào nhật ký**, nhờ `runUncaptured` và header
  `X-Shake-Devtools: internal` (đích nhận được header này, nó có trong access log của đích).
- **Không telemetry, không backend.** Lib chỉ gọi tới đích mà tester đã cấu hình. Không có server nào
  của tác giả ở giữa.
- **Không native module, không runtime dependency.** Chụp màn, kho bảo mật, chia sẻ, ghi đĩa do gói
  app tự chọn cấp. Các peer (Reanimated, safe-area-context) có native code nên phải build lại app.

Giới hạn, để bạn tự cân: che là lưới an toàn, không phải hệ thống chống rò rỉ dữ liệu. Dữ liệu
nghiệp vụ trong thân request, chữ tester gõ vào form và `sessionInfo` của app đi nguyên văn;
`appContext` được che bí mật nhưng không che dữ liệu cá nhân. `FLAG_SECURE` **không** chặn ảnh báo
bug: màn PIN, OTP, số thẻ thì `captureScreen` phải trả `null`. Bot token Slack hay App Secret Lark
nằm trên máy QA là rủi ro được chấp nhận; dùng app riêng với quyền tối thiểu, hoặc kết nối Webhook
làm relay. Trang đầy đủ (tiếng Anh): [security-privacy.md](security-privacy.md).

## Cài trong ba bước

Chưa có trên npm: [install.md](install.md) (tiếng Anh) hướng dẫn cài từ Git, kèm prompt một lần dán
cho Claude Code, Cursor hay Codex.

**React Native thường (≥ 0.76)**

1. Cài gói và các peer của entry `./plain` (`react-native-reanimated`, `react-native-worklets`,
   `react-native-safe-area-context`), cài plugin Babel của Reanimated, build lại app.
   [install.md › 1](install.md#1-install)
2. Viết một luật `enabled` theo flavor hay môi trường của app (`false` ở prod), rồi gọi
   `startCapture({ enabled })` ở module scope, trước khi app render.
   [install.md › 2–3](install.md#2-decide-when-it-is-enabled)
3. Bọc gốc app (phủ toàn màn) bằng `<DevToolsGate config={{ enabled }} actions={[]}>`. Tuỳ chọn:
   `bugReport` (`secureStore` và `captureScreen`) và resolver noop của Metro.
   [install.md › 4–5](install.md#4-optional-bug-report)

**Expo (đang làm: chưa chạy trong app Expo nào)**

1. Dùng development build hoặc bản internal, không dùng Expo Go, rồi
   `npx expo install react-native-reanimated react-native-worklets react-native-safe-area-context`.
2. Thêm file entry import file capture của app trước, rồi mới `expo-router/entry`; lấy `enabled` từ
   biến `EXPO_PUBLIC_*` hoặc profile build của EAS.
3. Bọc layout gốc bằng `DevToolsGate`. Adapter báo bug dùng `expo-secure-store`,
   `react-native-view-shot`, `expo-file-system`, `expo-sharing`; resolver gắn vào
   `expo/metro-config`.

Cả ba bước là mục 1–5 của [công thức Expo](recipes/expo.md); [app mẫu Expo](../example-expo/README.md)
(README tiếng Anh) làm theo công thức đó.

## Kiểm bản prod đã sạch

1. Test của app khoá `'prod' ⇒ enabled: false`. Luật này là của app.
2. Bundle JS prod với resolver bật (`DEVTOOLS_NOOP` là biến ví dụ của README; lib không đọc biến môi
   trường nào) rồi xem còn lại gì:

   ```sh
   mkdir -p build && DEVTOOLS_NOOP=1 npx react-native bundle --platform android --dev false \
     --entry-file index.js --bundle-output build/prod.js --sourcemap-output build/prod.js.map
   # file của lib còn lại: chỉ src/noop/* và src/i18n/vi.ts, src/i18n/en.ts
   grep -o 'react-native-shake-devtools[/\\]*src[^"]*' build/prod.js.map | sort -u
   # chuỗi chỉ code thật mới có: mong đợi 0
   grep -c -e X-Shake-Devtools -e devtools.connections.v1 -e devtools-panel-dismiss build/prod.js
   ```

   Expo: `DEVTOOLS_NOOP=1 npx expo export --platform android --no-bytecode --source-maps --clear`,
   kiểm y vậy trên các file trong `dist/_expo/static/js/android/`. Chạy thêm một lần không đặt biến
   để thấy các chuỗi đó xuất hiện, tức phép kiểm nhìn thấy được chúng.
3. Trên máy, bản prod mở bình thường; `useDevTools().open()` không làm gì.

Gradle không coi `DEVTOOLS_NOOP` là input của task bundle JS: đổi giá trị trên **cùng** variant thì
build kèm `--rerun-tasks`, không thì APK có thể giữ bundle cũ. Đã đo với app mẫu `example/`
(6/11/2026): còn 7 file của lib thay vì 58, bản release noop chạy trên một máy Android. Đặt biến theo
flavor cho app Android nhiều flavor, iOS và EAS: chưa verify.
[README.vi › Ba lớp chặn prod](../README.vi.md#ba-lớp-chặn-prod)

## Trạng thái

Bản pre-release `0.0.1`, chưa lên npm.

- **Đã đo trên một máy Android** (Android 14, RN 0.86): panel và thu log, cả hai entry giao diện,
  bản release noop, và báo bug đầu-cuối qua kết nối **Webhook** (ảnh, các bước, hàng đợi khi mất
  mạng, token hết hạn, báo bug sau crash).
- **Chưa verify:**
  - Chưa gửi bug report nào tới workspace **Jira, Slack hay Lark/Feishu** thật (đang chờ tài khoản
    thử); ba connector này mới test bằng jest với `fetch` giả.
  - **iOS:** mới đo ngưỡng lắc trên iPhone; phần còn lại chưa thử.
  - **Expo:** thu `expo/fetch` mới test bằng jest; chưa chạy trong app Expo nào (dev build, Expo Go
    hay EAS).
  - Bàn phím trong sheet trên Android 15/16, ngữ cảnh app và bắt lỗi render trên máy.
- **Không bắt:** crash native, WebSocket, request của SDK native.

Danh sách đầy đủ: [README.vi › Chưa verify](../README.vi.md#chưa-verify).

## Góp ý

Câu hỏi, lỗi, và những gì bạn thấy trong app của mình: `<feedback-link>`. Ghi kèm phiên bản React
Native hoặc Expo, nền tảng và loại kết nối là giúp nhiều nhất. Lỗi bảo mật: đừng đăng công khai, xem
[SECURITY.md](../SECURITY.md).
