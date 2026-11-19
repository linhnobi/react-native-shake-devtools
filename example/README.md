# App example

App React Native 0.86 dùng để thử `react-native-shake-devtools` trên **máy thật**: cú lắc, bàn
phím trong sheet, chia sẻ file, lưu phiên qua crash. Jest không kiểm được mấy thứ này.

App nạp thẳng `../src` của lib qua Metro, không cần bước build. Sửa lib xong thì Fast Refresh
cập nhật ngay trên máy.

## Chạy

Cần môi trường RN chuẩn ([Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment)), Node `>= 22.11`.

```bash
cd example
npm install

# Android: cắm máy (bật gỡ lỗi USB), rồi
npm start                 # Metro, cổng 8081
npm run android           # terminal khác: build + cài bản debug

# iOS (macOS)
npm run pods              # lần đầu, và mỗi khi đổi gói native
npm run ios -- --device   # máy thật cần chọn Team ký trong Xcode
```

Hai bản build, khác nhau ở **ai giữ cú lắc**:

| Bản | JS lấy từ | Lắc máy thì |
|---|---|---|
| debug (`npm run android` · `npm run ios`) | Metro | mở dev menu của RN. Panel nằm trong dev menu, dòng **Debug tools**. Hoặc bấm nút **Open debug tools** trên màn |
| release (`npm run android:release` · `npm run ios:release`) | JS nhúng sẵn trong app | mở thẳng panel. Bản này không cần Metro |

Muốn thử cú lắc thì dùng bản release. Bản release Android ký bằng `debug.keystore` của khuôn RN,
nên cài thẳng lên máy được.

## Thử gì trên máy thật

| Thử | Làm | Đúng khi |
|---|---|---|
| Lắc | bản release, lắc dứt khoát 2–3 lần | panel mở. Để máy yên trên bàn hoặc cầm đi lại thì panel **không** tự mở |
| Tắt lắc | panel › **Pause shake for 30 minutes** | lắc không mở panel nữa. Mở lại app thì hết tạm tắt |
| Nhật ký | bấm các nút ở mục Console và Network, rồi mở **Logs** | đủ dòng; HTTP có status và thời gian; lỗi tô đỏ; huy hiệu đếm đúng số lỗi |
| Bàn phím trong sheet | **Logs** › chạm ô tìm | ô tìm và danh sách nằm trên bàn phím; đóng bàn phím thì sheet không giật |
| Che bí mật | **POST with secrets** › mở dòng đó | tab Headers / Request hiện `<redacted>` thay cho token và password; riêng **Copy cURL** giữ bản thô |
| Request chậm | **Slow request (4 s)** › chip **Slow ≥3s** | chỉ còn dòng chậm |
| Mốc màn | đổi chip Home / Profile / Checkout, bấm ⚑ | dòng mốc chen giữa nhật ký; dòng ghi sau mang tên màn |
| Xuất lỗi | **Logs** › **Export errors** | khay chia sẻ của máy mở với khối text đã che |
| Promise reject | **Unhandled promise rejection**, chờ 3 giây › **Logs** | một dòng `UNCAUGHT` `Uncaught (in promise, id: N): Error: Example unhandled rejection` có stack; huy hiệu +1; app vẫn chạy. Bản debug: LogBox vẫn hiện, nhật ký vẫn chỉ một dòng |
| Reject bị catch muộn | **Rejection caught after 4 s**, chờ 5 giây › **Logs** | dòng lỗi như trên, sau đó dòng `WARN` `Promise rejection handled (id: N)` cùng `N`; huy hiệu chỉ +1 |
| Crash + phiên trước | bản release › **Throw uncaught error** › mở lại app › mở panel | có dải "The app crashed last time" và hàng **Previous session** |
| Lỗi render (R2) | bản release › **Throw during render** › mở lại app › mở panel | có dải crash, và **Previous session** có đúng một dòng `FATAL` `Example render error` kèm stack, không có dòng `ERROR` trùng. Trên RN 0.81+ lỗi render không ai bắt đi thẳng `ExceptionsManager.handleException`, không qua `ErrorUtils`; lib bọc cả hàm này từ 19/11. **Chưa kiểm trên máy**: ghi lại đúng cái thấy |
| Báo bug | bản release, lắc (hoặc bấm **Open debug tools**) › hàng **Report a bug** | panel có hàng này ở đầu, dòng phụ nói đã có ảnh chụp và số bước tự ghi. Ảnh là màn app **trước** khi panel che, không lẫn panel. Bấm hàng này mở form đã điền sẵn. Khay chia sẻ của máy mở được với file ảnh + chữ. Kho Keychain: lưu một kết nối rồi mở lại app, kết nối vẫn còn |
| Ngữ cảnh app | panel › hàng **App context (example)** chọn **Normal** › **Report a bug** | form có chip **App context**. Ticket có mục App context: `auth` hiện `"refreshToken":"<redacted>","accessToken":"<redacted>"`, `customerRef: <redacted>`, `lastAuthHeader: Bearer <redacted>`; `tokenExpiresAt` vẫn đọc được. Nhật ký có **một** dòng `[example] appContext called` mỗi bản nháp, không có lúc lắc hay lúc gửi |
| Ngữ cảnh lớn | chọn **Large**, bấm **Discard draft** nếu đang có nháp › **Report a bug** | form mở không khựng. `context.json` có dấu cắt (`…+493 more`, `"…": "+218 more"`, `[Object]`, `[Circular]`, `…+3820`, số theo jest), `userId` vẫn còn; mục App context kết thúc bằng `…and 7 more keys` |
| Ngữ cảnh hỏng | chọn **Throws** hoặc **Never resolves**, bỏ nháp cũ › **Report a bug** | chip ghi **App context unavailable** (Never resolves: sau ~1,5 s). Form và nút Gửi vẫn chạy |
| Request lỗi có bí mật | **POST with secrets → 401** › panel › **Copy for AI** › dán vào app ghi chú | khối Markdown có `POST` `…/status/401`; `access_token`, `Authorization`, `refreshToken` (base64 có `=`) và `password` đều là `<redacted>`; không có chữ `fake-` nào, không có lệnh cURL |
| Chữ đã gõ | gõ `typed-secret-123` vào ô **Coupon code** › báo bug, **Copy for AI** | bước ghi `Type in the "Coupon code" field`. Chuỗi đã gõ không có trong form, ticket, file đính kèm, khối Copy for AI |
| Nhiều bước, tiếng Việt | **35 errors in Vietnamese** › **Report a bug** | form có 30 bước dài, tiếng Việt có dấu; tiêu đề và ô Actual là dòng lỗi cuối (`Lỗi 35/35`) |
| Thẻ Lark quá 20 KB | **Copy 24 KB of Vietnamese text** › dán vào ô **Expected** › gửi qua Lark | Lark nhận thẻ đã cắt, có dòng "(Content was truncated.)", không báo lỗi |
| Mất mạng | **Check network** trước và sau khi bật chế độ máy bay | dòng phụ ghi giờ + `online · HTTP 200` hoặc `offline · …`. Nút này không thêm dòng nhật ký, không thành bước. Máy bay mà Wi-Fi vẫn bật thì nút báo `online`: tắt Wi-Fi |
| Ngôn ngữ · theme | panel › hai hàng chip ở cuối | đổi ngay khi panel đang mở |
| Thông tin máy | panel › **Copy device info** | clipboard có hãng, đời máy, OS, giờ mở app |

## App nạp lib thế nào

| File | Việc |
|---|---|
| `metro.config.js` | `watchFolders` gồm gốc repo. Chặn `node_modules` ở gốc repo (bản dev của lib, cho jest + tsc), để bundle chỉ có **một** bản `react` / `react-native` / `reanimated`, là bản trong `example/node_modules`. Trỏ tên `react-native-shake-devtools` về gốc repo, Metro đọc `exports` nên các entry phụ cũng chạy |
| `babel.config.js` | có `react-native-worklets/plugin`. Metro dùng file này cho cả `../src`, nên hàm `'worklet'` của lib được biên dịch |
| `tsconfig.json` | `paths` trỏ 4 entry của lib về `../src` |
| `index.js` | import `src/devtools/capture` **trước** `App`, để thu từ request đầu tiên |
| `src/devtools/` | đúng 3 việc một app phải làm: cấu hình (`devtools-config.ts`), hàng panel (`use-example-actions.ts`), kho lưu phiên (`log-store.ts`, AsyncStorage). Khối `bugReport` của cấu hình nối bốn native module do app cấp: chụp màn (`capture-screen.ts`, `react-native-view-shot`), kho bí mật (`secure-store.ts`, `react-native-keychain`), khay chia sẻ và ghi file cache (`share-files.ts`, `react-native-share` + `react-native-blob-util`). Thêm `appContext` (`app-context.ts`, dữ liệu giả, không native module) và `redactKeys: ['customerRef']` trong `capture.ts` |
| `src/scenarios.ts` | các nút sinh nhật ký: console, HTTP 200/404/500, request chậm, lỗi mạng, request lỗi có bí mật, promise reject, crash; và các nút cho buổi gửi thật: 35 lỗi tiếng Việt, đoạn 24 KB để dán, dò mạng không ghi nhật ký |

Gói native của example ghim cùng dòng minor với `devDependencies` ở gốc repo. Nâng ở một bên
thì nâng cả hai bên.

**Android chạy edge-to-edge** (`edgeToEdgeEnabled=true` trong `android/gradle.properties`, khác
mặc định `false` của khuôn RN). Nhờ vậy cửa sổ không bao giờ co lại khi bàn phím mở, và mặc định
`androidKeyboardInputMode: 'adjustPan'` của lib đúng trên mọi đời Android. Panel có hàng
**Keyboard mode (Android)** để đổi giá trị ngay trên máy và xem khai sai trông ra sao. Bảng đầy đủ:
mục "Android: bàn phím trong sheet" ở [README gốc](../README.md).

**Sửa `../src` rồi build release**: task bundle JS của Gradle chỉ theo dõi file trong `example/`.
`android/app/build.gradle` khai thêm `../src` và `package.json` của lib làm input. Thiếu khai báo
này thì sửa riêng lib xong, Gradle báo `createBundleReleaseJsAndAssets UP-TO-DATE` và APK vẫn mang
JS cũ.

Endpoint dùng để thử là dịch vụ công khai qua HTTPS: `jsonplaceholder.typicode.com` và
`httpbin.org`. Máy không có mạng thì chỉ còn dòng lỗi mạng.
