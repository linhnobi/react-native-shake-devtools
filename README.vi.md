[English](README.md) · **Tiếng Việt**

# `react-native-shake-devtools`

Công cụ gỡ lỗi **trong app**, dùng chung cho mọi app: lắc máy → panel → **nhật ký** (console ·
HTTP · lỗi không ai bắt · mốc đổi màn), **phiên trước** lưu trên đĩa, **thông tin thiết bị**. Hàng
riêng của từng app (vd giả lập trạng thái màn) do app cắm vào.

**Bạn là dev và QA gửi link này?** Đọc bản một trang trước: [docs/for-developers.vi.md](docs/for-developers.vi.md).

## Đường chia lib ↔ app

| Mảnh | Ai sở hữu |
|---|---|
| Thuật toán lắc, ngưỡng, cửa sổ, cooldown | lib |
| Chính sách nghe (foreground · Metro · tắt tạm) | lib |
| Vỏ sheet + hàng bấm + theme (sáng/tối) + chuỗi vi/en của vỏ | lib — tự mang, không cần design system hay thư viện i18n của app |
| **"prod" là gì, và có được bật không** | **app** |
| Dòng phụ (môi trường · phiên bản) | app |
| **Có những hàng nào trong sheet** | app |
| Thu · lọc · định dạng xuất · luật lưu và tự xoá (TTL, số phiên, trần byte) | lib |
| Ghi file, khay chia sẻ, kho đĩa (`LogStore`), đọc thông tin máy/user | app — đều là native module |
| Báo bug: ghi thao tác, che nhãn, dựng bước, gợi ý tiêu đề | lib |
| Báo bug: form, màn Kết nối, hàng đợi, 4 loại kết nối có sẵn, định dạng ADF/Block Kit/thẻ Lark | lib |
| Chụp màn hình và luật màn nào được chụp (`captureScreen`) | app |
| Kho bảo mật (`secureStore`) | app |
| Loại kết nối riêng của khách (`connectorTypes`) | app |
| Ghi file tạm cho file chữ cần upload (tuỳ chọn) — `writeTempFile` | app |
| Chia sẻ **nhiều file và ảnh** (`shareFiles`) | app |

Lib **không bao giờ** tự biết mình có được bật hay không — `DevToolsConfig.enabled` là trường
bắt buộc, không có mặc định. Đó là chỗ duy nhất luật "không chạy ở prod" được viết, và nó sống
trong app, nơi test được.

## Năm entry

| Entry | Có gì | Kéo theo |
|---|---|---|
| `react-native-shake-devtools/shake` | bắt cú lắc, **headless** — không UI, không text | chỉ `react-native-reanimated` |
| `react-native-shake-devtools/capture` | thu console · HTTP · lỗi toàn cục, lưu phiên, định dạng xuất — thuần JS | không gì |
| `react-native-shake-devtools/i18n` | chuỗi dựng sẵn `devtoolsStrings = { vi, en }` + kiểu `DevToolsStrings` · `DevToolsLocale` | không gì (kiểu) |
| `react-native-shake-devtools` | + panel, màn nhật ký, cổng môi trường, theme + chuỗi tự mang | + `@gorhom/bottom-sheet`, `react-native-gesture-handler`, `react-native-safe-area-context` |
| `react-native-shake-devtools/plain` | **cùng API** với entry `.`, sheet dựng bằng React Native lõi | + `react-native-safe-area-context` — **không** gorhom, **không** gesture-handler |

Hai entry có giao diện đều kéo thêm `react-native-reanimated` (cảm biến lắc của `DevToolsGate`).

Mỗi entry có một bản **rỗng** cùng bề mặt (`…/noop`, `…/noop/capture`, `…/noop/shake`, `…/noop/i18n`,
`…/noop/plain`)
để Metro tráo vào bản prod, cộng `react-native-shake-devtools/metro` chạy trong Node cho
`metro.config.js` — xem "Ba lớp chặn prod". App không import thẳng các đường này.

Entry `.` dựng sheet trên `BottomSheetModal` của gorhom: cây app cần `BottomSheetModalProvider` +
`GestureHandlerRootView` ở gốc. `SafeAreaProvider` thì tuỳ — có thì sheet chừa đúng status bar / home
indicator, không có thì inset coi là 0. App không muốn gorhom/gesture-handler thì dùng `./plain` —
mục dưới.

### Entry `plain`: không cần gorhom

```ts
import { DevToolsGate } from 'react-native-shake-devtools/plain'; // thay cho 'react-native-shake-devtools'
```

Cùng tên export, cùng props, cùng `DevToolsConfig`. Khác ở gốc app và ở vài cử chỉ:

| | entry `.` (gorhom) | entry `./plain` |
|---|---|---|
| Gốc app cần | `GestureHandlerRootView` + `BottomSheetModalProvider` (+ `SafeAreaProvider` tuỳ) | chỉ `SafeAreaProvider` tuỳ; **`DevToolsGate` phải phủ toàn màn** (sheet là lớp phủ vẽ ngay chỗ gate đứng) |
| Gói phải cài | gorhom, gesture-handler, reanimated, safe-area-context | reanimated, safe-area-context |
| Chép một dòng nhật ký | vuốt phải, hoặc giữ lâu → dải thao tác | **chỉ** giữ lâu → dải thao tác (dòng gợi ý đổi theo) |
| Kéo để đóng | cả sheet, có nấc | chỉ vùng thanh kéo + header, nhả quá ngưỡng là đóng |
| Cỡ `dynamic` | gorhom đo nội dung, hoạt ảnh tới nấc | ôm nội dung, trần 94% |
| Bàn phím | gorhom (`useAnimatedKeyboard`), mượt | sự kiện `Keyboard`: iOS trượt theo bàn phím, Android **nhảy** sau khi bàn phím mở xong |
| Chặn chụp màn hình | cùng window với app — FLAG_SECURE phủ | cùng window (lớp phủ trong cây app, không `<Modal>`) — FLAG_SECURE phủ |

Bản `plain` đã thử trên Samsung SM-M346B (Android 14, edge-to-edge), ngày 6/11/2026: Back lùi từng
cấp, ô tìm + danh sách + chân sheet nằm trên bàn phím, giữ lâu ra dải Chép/Chia sẻ, kéo thanh kéo
~130 dp là đóng (~60 dp thì bật lại), FLAG_SECURE phủ cả panel lẫn màn nhật ký (`screencap` ra 0
byte, giống bản gorhom). **iOS chưa thử.**

### Nút Back (Android)

Cả hai entry: Back lùi **từng cấp**, giống nút trên header. Panel đang mở ⇒ đóng panel. Màn nhật ký ⇒
đóng về app (không về panel — như nút ✕). Trang chi tiết request ⇒ về danh sách, Back lần nữa mới
đóng. Sheet đóng rồi thì Back trả lại cho app. gorhom 5.2.14 không tự nghe Back, nên trước đây Back
đi thẳng xuống app (điều hướng lùi / thoát) trong khi sheet vẫn nằm trên màn.

## Tương thích

Kiểm ngày 6/11/2026 trên Windows, **chỉ bằng jest + tsc**: không build native, không chạy trên máy.
CI ([`.github/workflows/check.yml`](.github/workflows/check.yml), Linux) chạy lại mọi dòng ✅ ở mỗi
PR, mỗi lần push `main` và mỗi thứ Hai.

| RN | React | reanimated (+ worklets) | gesture-handler | gorhom | safe-area-context | Node trong CI | Kết quả |
|---|---|---|---|---|---|---|---|
| 0.76.9 | 18.3.1 | 3.16.7 | 2.18.1 | 5.0.6 | 4.0.2 | 20 | ✅ cận dưới của mọi peer |
| 0.78.3 | 19.0.0 | 3.16.7 | 2.18.1 | 5.0.6 | 4.0.2 | 20 | ✅ React 19 thấp nhất, peer khác ở cận dưới |
| 0.83.10 | 19.2.0 | 4.3.4 + 0.8.3 | 2.33.1 | 5.1.8 | 5.6.2 | 22 | ✅ |
| **0.86.3** (ghim) | 19.2.3 | 4.5.5 + 0.11.4 | 3.1.0 | 5.2.14 | 5.8.1 | 20.19.4 · 22.13.0 · 24.3.0 · LTS mới nhất | ✅ `npm run check` theo lockfile |
| 0.88.1 | 19.3.0 | 4.7.1 + 0.13.1 | 3.5.0 | 5.2.14 | 5.11.1 | 24 | ✅ mới nhất lúc kiểm |

- ✅ ở dòng **ghim** = `npm run check` đủ. Ở dòng khác = `tsc -p tsconfig.lib.json` (chỉ mã lib — app
  biên dịch thẳng `src/`) + đủ suite jest. File test mock `useColorScheme`, `Share.share` theo kiểu
  của RN 0.86, mà kiểu đó đổi qua từng dòng, nên không typecheck file test ở dòng khác.
- Dòng 0.76 / 0.78 dồn peer về cận dưới để bắt mã lib lỡ dùng API mới. Tổ hợp 0.78 + reanimated
  3.16 **không** build native được (reanimated 3.16 chỉ nhận RN 0.74–0.77) — build native được với
  gói nào thì theo bảng tương thích của chính gói đó.
- React ghim **đúng** bản renderer RN nhúng (0.76 → 18.3.1, 0.78 → 19.0.0, 0.83 → 19.2.0, 0.88 →
  19.3.0). Với RN 0.78, React 19.0.9 (lệch một bản vá) làm 5 suite chạm renderer đỏ "Incompatible
  React versions".
- Peer `react-native-gesture-handler >=2.18`: lib import `react-native-gesture-handler/ReanimatedSwipeable`,
  subpath này có từ 2.18.0 — với 2.16.2, tsc và 3 suite jest đỏ ở dòng import.
- Node: `engines.node` của package.json (`^20.19.4 || ^22.13 || >=24.3`, theo RN 0.86). Mỗi job CI
  khẳng định Node đang chạy nằm trong khoảng đó.
- Chạy lại một dòng trên máy: làm đúng bước "Cài bộ version" của workflow (`npm pkg set …` ·
  `npm pkg delete …` · `npm install --no-package-lock`), rồi `npx tsc --noEmit -p tsconfig.lib.json`
  và `npm run test:ci`. Xong thì `git checkout package.json && npm ci` để về bản ghim.

## Ráp vào một app

```ts
// vd `src/devtools/devtools-config.ts` của app
export const buildDevToolsConfig = (appEnv: AppEnv, version: string): DevToolsConfig => ({
  enabled: appEnv !== 'prod',                       // ⬅️ luật của app, ở đúng chỗ test được
  subtitle: `${appEnv.toUpperCase()} · ${version}`,
});
```

```tsx
// vd `App.tsx` của app
<DevToolsGate config={devToolsConfig} actions={useDevToolsActions()}>
  <RootNavigator />
</DevToolsGate>
```

Nhãn hàng phải dựng **trong hook** (`t()` gọi tại render, không ở module scope), không phải mảng hằng module.

Thêm app mới tốn 3 việc, **không sửa file nào trong lib**: khai dependency · viết
`devtools-config.ts` + `use-devtools-actions.ts` · mount `<DevToolsGate>`. Không có bước nạp bundle
i18n: cổng tự bọc `DevToolsUiProvider` (theme + chuỗi) theo `DevToolsConfig`.

App **Expo** (dev build, `./plain`, entry gọi `startCapture`, adapter báo bug bằng module Expo, resolver Metro): [`docs/recipes/expo.md`](docs/recipes/expo.md). App mẫu theo công thức đó (SDK 58, Expo Go / dev build / release noop; đã `tsc` + bundle, chưa chạy trên máy): [`example-expo/`](example-expo/README.md).

### Giao diện: bốn trường tuỳ chọn của `DevToolsConfig`

| Trường | Làm gì | Mặc định |
|---|---|---|
| `locale?: 'vi' \| 'en'` | ngôn ngữ chuỗi **của vỏ** (nhãn hàng của app do app dịch sẵn) | `'en'` |
| `strings?: DeepPartial<DevToolsStrings>` | ghi đè / dịch thêm — chỉ cần khai khoá muốn đổi; giữ tham chiếu ổn định (hằng module hoặc `useMemo`) | không |
| `colorScheme?: 'light' \| 'dark'` | ép chế độ màu | vắng ⇒ theo hệ thống (`useColorScheme()`), hệ thống không báo ⇒ sáng |
| `androidKeyboardInputMode?: 'adjustPan' \| 'adjustResize'` | **Android:** cửa sổ của app có co lại khi bàn phím mở không — mục dưới | `'adjustPan'` |

```ts
const config: DevToolsConfig = {
  enabled: appEnv !== 'prod',
  locale: 'vi',
  strings: { panel: { title: 'Dev menu' } },   // khoá lấy từ `DevToolsStrings`
  colorScheme: appTheme,                        // app tự quản sáng/tối thì truyền vào
};
```

Ghép panel hoặc màn nhật ký **không** qua `DevToolsGate` thì tự bọc `<DevToolsUiProvider locale
strings colorScheme androidKeyboardInputMode>`; không bọc gì thì lib dùng tiếng Anh + theme theo
hệ thống + `adjustPan`.

**Thanh trạng thái và giới hạn đã biết.** Khi một sheet của lib (panel · nhật ký · phiên trước) đang
mở, lib đẩy một mục vào ngăn xếp `StatusBar` của RN và gỡ đúng mục đó khi đóng, nên kiểu của app được
trả lại nguyên vẹn. Thanh trạng thái nằm trên lớp phủ làm tối app chứ không nằm trên sheet, nên kiểu
chữ theo màu lớp phủ: chỉ khi **cả sheet lẫn hệ thống đều sáng** mới là `dark-content`, còn lại là
`light-content` (đã đo: panel ép sáng trên máy tối mà dùng chữ tối thì icon gần như biến mất). Cần
thiết khi `colorScheme` ép ngược hệ thống (panel tối trên máy sáng). App nên khai kiểu
bằng `<StatusBar barStyle>` — chỉ gọi `StatusBar.setBarStyle(...)` rồi đóng sheet thì RN rơi về kiểu
mặc định. iOS: ô nhập của lib đặt `keyboardAppearance` theo theme. Còn **không** làm được nếu thiếu
native: **màu thanh điều hướng Android** (và bàn phím Android) theo hệ thống chứ không theo theme của
sheet — panel sáng trên máy tối thì thanh điều hướng ở dưới đáy vẫn tối/xám.

### Android: bàn phím trong sheet

Màn nhật ký có ô tìm nằm trong sheet của gorhom. Khi bàn phím mở, sheet phải được bù **đúng một
lần**: hoặc cửa sổ co lại, hoặc gorhom đẩy sheet lên. Lib không tự biết cửa sổ của app có co hay
không, nên app khai:

| Cửa sổ của app trên máy đang chạy | `androidKeyboardInputMode` | Khai sai thì |
|---|---|---|
| edge-to-edge | `'adjustPan'` *(mặc định)* | `'adjustResize'`: bàn phím che chân sheet và cuối danh sách |
| **không** edge-to-edge + manifest `adjustResize` | `'adjustResize'` | `'adjustPan'`: bù hai lần, chân sheet đè lên ô tìm, danh sách trống |
| manifest `adjustPan` | `'adjustPan'` | — |

Entry `./plain` đọc cùng giá trị này, cùng nghĩa: `'adjustPan'` ⇒ sheet tự nâng đáy lên bằng chiều cao
bàn phím (`keyboardDidShow`) **cộng inset đáy**, `'adjustResize'` ⇒ không nâng (cửa sổ đã co, sheet neo
đáy tự lên theo). iOS luôn nâng, không cộng. Phần cộng vì `endCoordinates.height` của RN trên Android
là inset IME trừ inset thanh hệ thống: thiếu nó thì trên cửa sổ edge-to-edge chân sheet nằm dưới bàn
phím đúng một dải cao bằng thanh điều hướng (đo: 135 px trên SM-M346B, Android 14, `adjustPan`).

Cùng một bản build có thể rơi vào hai dòng đầu tuỳ đời Android. Với React Native 0.86 và target
SDK ≥ 35, cửa sổ tự thành edge-to-edge trên Android 16+, và trên Android 15 nếu theme không
opt-out, kể cả khi `edgeToEdgeEnabled=false`. Có hai cách khai đúng:

```ts
// Cách gọn: bật `edgeToEdgeEnabled=true` trong android/gradle.properties, để mặc định.

// App giữ `edgeToEdgeEnabled=false` (mặc định của khuôn RN 0.86): chỉ Android ≤ 14 mới co cửa sổ.
androidKeyboardInputMode:
  Platform.OS === 'android' && Number(Platform.Version) < 35 ? 'adjustResize' : 'adjustPan',
```

Đo bằng app `example/` trên Samsung SM-M346B (Android 14), ngày 6/11/2026: cả bốn tổ hợp (edge-to-edge
bật/tắt × hai giá trị) ra đúng như bảng. Phần Android 15/16 suy từ `WindowUtil.kt` của RN 0.86,
**chưa đo** trên máy.

## Màn nhật ký

| Việc | Ở đâu | Ghi chú |
|---|---|---|
| Định nghĩa "lỗi" | `capture/log-query.ts` › `isErrorEntry` | `console.error` (kể cả lỗi và promise reject không ai bắt) · HTTP ≥ 400 · lỗi vận chuyển (mất mạng, timeout). `warn`, request đang bay, request **bị app huỷ** (hàng xám "Đã huỷ"), mốc **không** tính. Chip, huy hiệu panel, vòng giữ lỗi, file xuất dùng chung một hàm |
| Chip lọc kết cục | `panel/LogToolbar.tsx` | **Chỉ lỗi · N** (`isErrorEntry`) · **Ẩn lỗi** (mọi dòng trừ lỗi — gồm `warn`, request đang chờ và request bị huỷ) · **Chậm ≥3s · N**. Chọn một, chạm lại chip đang sáng là bỏ lọc |
| "Chậm" | `isSlowEntry` | request đã xong và ≥ `DEFAULT_SLOW_MS` (3 giây) — chip đọc ngưỡng từ hằng này. Không loại trừ lỗi |
| Tìm | `filterLog` · `parseQuery` | chuỗi con, không phân biệt hoa thường; hiểu `status:404` · `status:5xx` · `status:err` · `method:post` · `screen:user`. Chữ tự do khớp method, URL, status, lỗi, màn, và cả **body request/response** trong phần đã giữ (`bodyLimit`, mặc định 4.000 ký tự). Body được tìm trên bản **thô**, chỉ để chọn dòng nào hiện; chữ hiện ra vẫn đi qua `redactBody` |
| Tạm dừng | `usePausableEntries` | chỉ dừng **màn** (ảnh chụp), thu vẫn chạy; dải "↑ N dòng mới" |
| Nhịp làm mới · hiệu năng | `useLogEntries(…, LIVE_REFRESH_MS)` · mục "Hiệu năng" ở JSDoc `LogSheet` | panel và màn nhật ký render tối đa 4 lần/giây theo log mới; footer/header của sheet phải nhận phần tử **ổn định** (`useMemo`), nếu không gorhom dựng lại chúng mỗi lượt và cú chạm rơi |
| Đánh dấu · mốc đổi màn | `capture/markers.ts` | `markUser()` (nút ⚑) · `markScreen(route)` (app nối vào `NavigationContainer`); màn còn được **đóng dấu lên từng dòng** (`entry.screen`) |
| Chi tiết request | `panel/LogDetail.tsx` | trang **trong** sheet: Tổng quan · Headers · Request · Response · cURL; mọi thứ hiện đã che, chỉ "Chép cURL" lấy bản thô |
| Giữ lâu một dòng | `LogRow` › `menu` | dải nút nhìn thấy được: Chép cURL / URL / response / dòng · Chia sẻ dòng này |
| Xuất lỗi | `formatErrorReport` → `DevToolsConfig.exportFile` | nội dung **đã che** + thông tin phiên + màn của từng lỗi; tên `devtools-errors-YYYYMMDD-HHmmss.txt`. Vắng `exportFile` ⇒ `Share.share` text |
| Thông tin thiết bị | `DevToolsConfig.sessionInfo` → hàng "Chép thông tin thiết bị" | app cấp bản build · máy · OS · user **đã che**; lib thêm giờ mở app |
| Chép cho AI | `capture/format-ai-context.ts` › `formatAiContext` → `panel/use-ai-copy.ts` | khối **Markdown đã che** để dán vào agent lập trình (Claude Code, Cursor, Copilot): một dòng dặn agent · app/máy/phiên · lỗi và promise reject không ai bắt kèm stack · các bước gần đây (màn, chạm, request, lỗi) · request lỗi (≥ 400, lỗi vận chuyển) và chậm có method, URL, status, thời lượng, header, thân đã cắt · `console.error`/`warn` gần đây. Trần 40.000 ký tự, giữ mục nặng nhất và mới nhất, ghi rõ đã bỏ gì; mục lặp gộp `×N`. Vào bộ nhớ tạm (`copyText`), bộ nhớ tạm vắng ⇒ `Share.share`. Không bao giờ có lệnh cURL. Ở hàng **Chép cho AI** của panel (phiên đang chạy) và chân màn **Phiên trước** (sau crash); chân màn nhật ký sống đã kín chỗ |

Hàng có sẵn của panel (theo thứ tự): dải **crash** (khi phiên trước chết vì lỗi JS fatal) · **Nhật
ký** (huy hiệu đỏ đếm **lỗi**, dòng phụ "N dòng · M lỗi") · **Chép cho AI** · **Phiên trước** · **Chép
thông tin thiết bị** · hàng của app · Tắt lắc.

Một app cắm gì: `exportFile` (ghi file + khay chia sẻ), `sessionInfo`, kho đĩa (`LogStore`), mốc
màn (`markScreen` trong `onStateChange` của `NavigationContainer`), xoá khi đăng xuất
(`clearPersistedLogs`).

### HTTP: cái gì không bắt được

`tapNetwork` bọc `XMLHttpRequest.prototype`, nên bắt được axios và `fetch` của RN (polyfill whatwg
dựng trên XHR). `startCapture` bọc thêm `fetch` toàn cục của Expo SDK 56+ (`expo/fetch`, native, không
qua XHR). Request đi đường khác thì nhật ký **im lặng**, không có dòng nào báo thiếu:

| Không thấy | Vì sao |
|---|---|
| `expo/fetch` gọi **thẳng** (`import { fetch } from 'expo/fetch'`), hoặc `fetch` toàn cục đã bị SDK khác bọc **trước** `startCapture` | `startCapture` chỉ bọc khi `fetch` toàn cục mang dấu `Symbol.for('expo.builtin')` của Expo (Sentry RN dò cùng dấu) và không phải polyfill whatwg — hàm lạ thì không bọc, để khỏi ghi trùng với tap XHR. Thân `text/event-stream` không đọc. Xem `docs/recipes/expo.md` |
| `expo/fetch`: thời lượng tới **hết thân** và lỗi giữa thân, khi thân không được đọc (nhị phân, trên 1 MB, `text/event-stream`, HEAD/204) | Thân chữ được đọc qua `response.clone()` nên thời lượng tính tới hết thân, như XHR. Thân không đọc thì thời lượng chỉ tới lúc có header (chip "Chậm" có thể sót) và dòng giữ status dù thân hỏng giữa chừng. `expo` < 56.0.8: app tự `clone()` thêm lần nữa thì dính lỗi `bodyUsed` (expo/expo#46397) |
| Thân request không phải chuỗi (FormData, Blob, ArrayBuffer) | Cố ý không đọc vào — đọc FormData là chỗ tool cùng loại crash. Tab Request ghi lý do, không ghi "Không có thân" |
| Thân response nhị phân (ảnh, PDF, `content-type` không phải chữ) hoặc trên 1 MB | Không đọc; tab Response ghi lý do. Thân chữ (`json`, `text/*`, `xml`, form, GraphQL) của `fetch` — RN đặt `responseType = 'blob'` — được đọc bất đồng bộ bằng `FileReader` riêng, rồi cắt như mọi thân |
| Request gửi (hoặc `open`) trước `startCapture` | Lúc đó chưa vá — lý do phải gọi ở module scope |
| WebSocket, request của SDK native, ảnh của `<Image>` | Không đi qua XHR của JS |

Nhãn kết cục tầng vận chuyển trên dòng: `network` · `timeout` (là lỗi) · `abort` (app huỷ — **không**
phải lỗi, hàng hiện "Đã huỷ"). Huỷ bằng `AbortSignal.timeout(ms)` ghi `timeout` với `expo/fetch`
nhưng `abort` với `fetch` của RN (whatwg-fetch chỉ gọi `xhr.abort()`, tap XHR không thấy lý do). Phần
`expo/fetch` dựng từ mã nguồn và changelog của Expo (`packages/expo/src/winter/installGlobal.ts`,
`runtime.native.ts`, `fetch/FetchResponse.ts`; mục 56.0.0 "Use `expo/fetch` as default fetch") và test
jest trên `expo/fetch` giả, ngày 6/11/2026, **chưa** chạy thử trên app Expo.

## Nhật ký giữ được bao lâu

| Tầng | Giữ gì | Tự xoá khi |
|---|---|---|
| RAM — vòng chính | 300 dòng (`DEFAULT_CAPACITY`); console cắt ở 2000 ký tự, mỗi thân cắt ở 4000 | dòng thứ 301 vào (đạp dòng cũ nhất) · bấm Xoá · reload JS · tiến trình chết |
| RAM — vòng giữ lỗi | thêm tối đa 100 **lỗi** đã rời vòng chính (`DEFAULT_ERROR_CAPACITY`) | lỗi thứ 101 · bấm Xoá · tiến trình chết |
| Đĩa — theo phiên *(app bật `persist`)* | mọi lỗi + 50 dòng cuối, **đã che**, ≤ 1 MB/phiên, gom ghi 2 giây một lần + ghi ngay khi lỗi fatal | lúc khởi động: file > **72 giờ** · vượt **3 phiên** · **đăng xuất** xoá sạch |

Lỗi JS không ai bắt đi qua `tapGlobalErrors` (`ErrorUtils`): ghi thành dòng `FATAL`/`UNCAUGHT` có
stack, lưu phiên xuống đĩa (chờ tối đa 800 ms) **rồi** mới trả về handler gốc của RN. Crash
**native** không đi qua đường này.

**Lỗi render không có error boundary.** Từ RN 0.81 (React 19), React không ném lại lỗi này nữa mà
gọi `onUncaughtError` RN truyền vào renderer, và hàm đó gọi thẳng
`ExceptionsManager.handleException(error, true)`, không qua `ErrorUtils`. Nên `tapGlobalErrors` bọc
thêm lời gọi đó: lỗi render thành dòng `FATAL` có stack và phiên được ghi trước khi app chết, như
mọi lỗi fatal khác. Lỗi bị error boundary bắt vẫn là dòng `ERROR` thường (app không chết). Đường
này đã kiểm bằng jest với chính hàm của RN; **chưa kiểm trên máy thật**.

| RN | Lỗi render không boundary, nếu chỉ bọc `ErrorUtils` |
|---|---|
| 0.76 (React 18) | React ném lại lỗi ⇒ tới `ErrorUtils` như fatal ⇒ đã bắt được (kèm một dòng `ERROR` không fatal từ `ReactFiberErrorDialog`) |
| 0.81 · 0.86 · 0.88 (React 19) | không bao giờ tới `ErrorUtils` ⇒ chỉ một dòng `ERROR` không stack, phiên không được ghi kịp ⇒ nay lib bọc thêm `handleException` |

**Phụ thuộc vào file nội bộ của RN.** Lib với tới `ExceptionsManager` bằng `require` đường nội bộ
`react-native/Libraries/Core/ExceptionsManager`, đặt trong `try`. File này có ở mọi bản RN mà CI chạy
(0.76.9, 0.78.3, 0.83.10, 0.86.3, 0.88.1), và jest ở từng dòng đó kiểm lib bọc đúng object RN gọi.
Bản RN sau này dời hoặc xoá file: app dùng config Metro từ `@react-native/metro-config` hay
`expo/metro-config` vẫn bundle được (cả hai bật `transformer.allowOptionalDependencies: true`), lúc
chạy không có gì ném ra; chỉ mất đường này — lỗi render không boundary quay về một dòng `ERROR` không
stack, và phiên không được ghi lúc crash. Lỗi không ai bắt khác không đổi. Config Metro tự viết không
bật cờ đó (mặc định của chính Metro trước 0.87) thì bundle dừng với "Unable to resolve module". Đọc
từ mã nguồn Metro và Expo; chưa kiểm trên máy.

**Một lỗi = một dòng lỗi.** Handler gốc của RN `console.error` lại chính lỗi đó, ở cả dev lẫn
release. Lib không ghi dòng `ERROR` lặp đó (LogBox, màn đỏ, Metro vẫn nhận như cũ). Trước bản này,
mỗi lỗi không ai bắt thành hai dòng `UNCAUGHT` + `ERROR` không stack, và **huy hiệu đếm 2**. Nay
huy hiệu, chip "Chỉ lỗi" và file xuất đếm 1 cho mỗi lỗi.

Promise reject không ai `catch` (vd `await api()` thiếu `try/catch`) không tới `ErrorUtils`; nó đi
qua `tapUnhandledRejections` (bộ theo dõi của Hermes) và thành dòng `UNCAUGHT` có stack, chữ mở đầu
`Uncaught (in promise, id: N)`. Dòng này tính là lỗi và được lưu phiên như mọi lỗi khác, nhưng
không phải fatal nên không ghi đĩa ngay.

| | Không có lib | Có lib |
|---|---|---|
| `--dev true` (debug, UAT) | RN tự theo dõi: LogBox + một `console.error` không có stack chỗ ném | **một** dòng `UNCAUGHT` có stack; LogBox giữ nguyên (lib chuyển tiếp cho bộ của RN) |
| `--dev false` (release) | RN **không** theo dõi (`polyfillPromise.js` chỉ bật trong `__DEV__`), reject mất không dấu vết | **một** dòng `UNCAUGHT` có stack |

- Hermes chờ **2 giây** (100 ms với `TypeError` · `ReferenceError` · `RangeError`) mới coi là "không
  ai catch". `catch` trong khoảng đó thì không có dòng nào.
- `catch` **sau** khi đã báo: dòng lỗi giữ nguyên, thêm dòng `warn` `Promise rejection handled (id: N)`
  cùng `id`. Huy hiệu không đếm thêm.
- Hermes giữ **một** bộ theo dõi, ai đăng ký sau thì đè. App có SDK cũng đăng ký bộ này (vd Sentry)
  thì tắt phần này bằng `startCapture({ rejections: false })`.
- Chỉ chạy với Hermes. JSC thì không làm gì.

🔴 Ghi dữ liệu xuống đĩa: đã che token/mật khẩu, nên đặt trong thư mục cache (không sao lưu), tự xoá
theo luật trên — nhưng app xử lý dữ liệu nhạy cảm nên được bảo mật duyệt trước khi bật `persist`.

## Báo bug

QA lắc máy, điền một form, bấm Gửi — ticket ra Jira/Slack/Lark/webhook của khách, kèm ảnh màn hình,
các bước tự ghi và log lỗi. Tính năng **tuỳ chọn**: app không khai `bugReport`, hoặc `enabled:
false`, thì lib không mount gì, không ghi gì, panel không có hàng "Báo bug".

### Luồng QA

1. **Lắc máy** (hoặc `useDevTools().open()`). Ảnh được chụp **trước** khi panel che màn hình.
2. Panel có hàng **Báo bug** ở đầu. Dòng phụ cho biết đã có ảnh chưa và bao nhiêu bước tự ghi.
3. **Form**: ảnh thu nhỏ (nút Chụp lại) · tiêu đề điền sẵn từ lỗi gần nhất (vd `[Checkout] POST
   /orders → 500`) · các bước tự ghi (sửa, đổi thứ tự bằng ▲▼, xoá, thêm) · Thực tế · Mong đợi ·
   chip đính kèm (Ảnh · Log lỗi · Thông tin máy · Ngữ cảnh app nếu app cấp `appContext` · Phiên
   trước nếu vừa crash) · nút **Gửi tới …** dính ở đáy sheet.
4. **Gửi xong**: `Đã tạo DEMO-482` kèm Mở / Chép link / Báo bug khác. Tool tự đặt mốc ⚑ mới, nên bug
   sau chỉ chứa thao tác từ mốc đó.
5. Các trạng thái khác: mất mạng ⇒ xếp hàng, tự gửi lại · token hết hạn ⇒ nhập lại, **bản nháp được
   giữ** · màn không cho chụp ⇒ form ghi rõ · chưa có kết nối ⇒ nút thành **Thêm kết nối**; vẫn còn
   đường **Chia sẻ**. Bản nháp tự lưu: đóng sheet rồi lắc lại gặp đúng bản đang soạn.
6. **Hàng đợi gửi**: bản báo đã giao cho hàng đợi không biến mất khi trang kết quả đóng. Dòng phụ hàng
   Báo bug thêm `· N chờ gửi · M cần xử lý`; form có banner (màu cảnh báo khi có bản gửi thất bại, bị
   chặn hay không chắc đã gửi) mở trang **Hàng đợi gửi**. Mỗi bản: lý do lỗi, **Gửi lại** (thất bại ·
   không chắc đã gửi · bị chặn sau khi sửa kết nối), **Chia sẻ**, **Bỏ bản báo** (bấm hai lần; không có
   lúc đang gửi). Bản `blocked` của chính nháp đang soạn không tính vào số đếm — form đã nói về nó.

Các bước do máy ghi từ cú chạm (dịch tối đa 10 dp tính là chạm, giữ ≥ 500 ms là giữ lâu), lấy nhãn
từ fiber React của nút bấm; bộ đệm 100 thao tác, form hiện tối đa 30 bước, lưu 30 bước khi crash.
Nhãn đi qua bước che: chuỗi ≥ 6 chữ số (cho phép xen dấu cách, dấu chấm hoặc gạch nối — `0912-345-678`,
`4111-1111-1111-1111`) và email, giữ 3 ký tự cuối. Chữ nằm trong một ô nhập (kể cả ô mention vẽ giá
trị đã gõ thành chữ con) không bao giờ thành nhãn.

### Cấu hình `bugReport`

Mọi năng lực native do **app** cấp — lib không có native module và không thêm peer dependency nào.

```ts
const config: DevToolsConfig = {
  enabled,
  bugReport: {
    captureScreen: () => viewShotCapture(),        // trả null ⇒ "màn này không cho chụp"
    secureStore: keychainStore,                    // getItem / setItem / removeItem
    shareFiles: (files, message) => shareMany(files, message),
    writeTempFile: (name, content) => writeCacheFile(name, content),
    connectorTypes: [myCustomerConnector],         // cộng thêm vào 4 loại có sẵn
    recordVisibleText: true,                       // false cho app ngân hàng/y tế
    appContext: () => ({ userId, flags: flags.snapshot(), sentryEventId: Sentry.lastEventId() }),
  },
};
```

| Trường | Việc | Vắng thì |
|---|---|---|
| `captureScreen` | `() => Promise<DevToolsCapturedImage \| null>`; gate gọi **trước** khi panel che màn, ở cả cú lắc lẫn `open()`. Luật "màn nào được chụp" nằm trong hàm. Ném, hoặc quá 1,5 s ⇒ "không chụp được", panel vẫn mở | form không có khối ảnh |
| `secureStore` | Keychain/Keystore (`react-native-keychain`, `expo-secure-store`…) cho danh sách kết nối và bí mật | không lưu được kết nối, không gửi được; vẫn còn Chia sẻ |
| `connectorTypes` | loại kết nối riêng của khách (`defineConnector`); trùng `id` với loại có sẵn ⇒ loại của app thắng | chỉ 4 loại có sẵn |
| `shareFiles` | `(files, message) => Promise<void>` — chia sẻ **nhiều file và ảnh** qua khay hệ thống. Trường **mới**; không mở rộng `exportFile` vì đổi kiểu đó là thay đổi phá vỡ | rơi về `exportFile` (một file chữ) rồi `Share` (chữ); màn **nói rõ** "ảnh không chia sẻ được", không im lặng bỏ ảnh |
| `writeTempFile` | `(name, content) => Promise<string>` trả `file://…` — để upload `errors.txt`/`timeline.json` như file thật trên đĩa. `name` **riêng cho từng bản báo** (`<reportId>-errors.txt`, chỉ `[A-Za-z0-9._-]`): hàng đợi gửi lại nhiều bản song song, ghi chung một thư mục cũng không đè nhau; tên file đích thấy vẫn là `errors.txt`. File chữ đưa cho `shareFiles` giữ tên gốc (`errors.txt`…) | file chữ đi thành phần chuỗi trong bộ nhớ của `FormData` RN (`{ string, name, type }`, không bao giờ `Blob`). Đã đo trên Android (SM-M346B, 7/11/2026): đích nhận phần **file** có `filename`, đúng nội dung, `content-type` thêm `; charset=utf-8` (OkHttp tự gắn). iOS theo mã nguồn RN 0.86, chưa đo |
| `recordVisibleText` | lấy chữ hiển thị trong nút làm nhãn bước chạm (đã che). Mặc định `true` | — |
| `appContext` | `() => object \| Promise<object>` — ngữ cảnh riêng của app (user id, build/env, cờ tính năng, lát state Redux/Zustand, `Sentry.lastEventId()`). Gọi **một lần lúc QA mở form** (không phải lúc lắc); async thì trần 1,5 s. Ném, reject, quá hạn, trả thứ không phải object ⇒ form vẫn chạy, chip ghi "không lấy được". Dựng an toàn (vòng, hàm, BigInt, `Date`, `Error`, `Map`/`Set`; trần sâu 8 · 200 khoá · 100 phần tử · 2000 ký tự/chuỗi · 32 000 ký tự cả file, có dấu cắt `[Object]`/`…+N more`), **che như thân request** (gồm `redactKeys`) nhưng **không** che dữ liệu cá nhân. Thành mục **Ngữ cảnh app** trong ticket (mỗi khoá cấp đầu một dòng, tối đa 10) và file `context.json` (đích nhận file); webhook nhận `appContext` trong phần `report` + phần `context.json`. Báo về **phiên crash** ⇒ không gọi, không kèm (ngữ cảnh sau khi mở lại app không phải lúc crash). Công thức: [`docs/recipes/bug-report-context.md`](docs/recipes/bug-report-context.md) | không có chip, mục hay file ngữ cảnh |

Gate dựng kho kết nối và hàng đợi **một lần**, chỉ dựng lại khi đổi có/không có `secureStore` hoặc
đổi **tập id** của `connectorTypes` — viết `bugReport` inline trong JSX vẫn an toàn.

### Bốn loại kết nối có sẵn

QA tạo **kết nối** trên máy: chọn loại → điền ô → **Thử kết nối** → lưu. Lưu được nhiều kết nối, mỗi
lần gửi chọn một; app nhớ kết nối dùng lần trước.

| Loại | QA nhập | Gửi gì | Cần gì từ admin của khách |
|---|---|---|---|
| **Jira Cloud** | Site URL, email, API token | issue (mô tả dạng ADF) rồi đính kèm file | API token của một tài khoản có quyền Browse, Create issues, Create attachments. Token có hạn tối đa 365 ngày ⇒ 401 là ca thường gặp, màn báo rõ. Org bật Atlassian Guard có thể chặn API token |
| **Slack** — nhẹ | webhook URL | tin Block Kit, **không có ảnh/file** | tạo Incoming Webhook cho một kênh |
| **Slack** — đầy đủ | bot token `xoxb-` + kênh | tin kèm ảnh và file (luồng `files.getUploadURLExternal` → `completeUploadExternal`, một tin duy nhất) | cài một Slack app có `files:write` + `chat:write` (workspace có thể bắt Owner duyệt), **mời bot vào kênh** |
| **Lark / Feishu** — nhẹ | chọn Lark quốc tế hay Feishu, webhook bot nhóm (+ secret ký nếu bật) | thẻ `interactive`, **không có ảnh/file**, thân ≤ 20 KB (cắt nội dung cho vừa) | thêm bot tuỳ chỉnh vào nhóm |
| **Lark / Feishu** — đầy đủ | chọn miền, App ID + App Secret, chat id | thẻ có ảnh + file (`im/v1/images`, `im/v1/files`, `im/v1/messages`) | app tự dựng, admin tenant **duyệt** (`im:resource` + một quyền gửi tin), bot đã vào nhóm; **mỗi lần đổi quyền phải duyệt lại** |
| **Webhook** | URL + một header tuỳ chọn (giá trị là bí mật) | `multipart/form-data`: phần `report` (JSON) + các file | server trả 2xx; trả JSON `{ url?, key? }` thì hiện link. Cũng là đường "relay" cho khách muốn giữ token phía server |

**Mức nhẹ của Slack và Lark không gửi được ảnh/file** — giới hạn của nền tảng, không phải của lib
(block ảnh của Slack cần URL công khai; tin ảnh của Lark cần `image_key` mà bot nhóm không lấy
được). Sau khi gửi ở mức nhẹ, màn thành công có nút **Chia sẻ ảnh và log** để QA tự đính vào thread.

**Webhook tới `http://` trên Android bản release** (đã đo 7/11/2026 trên SM-M346B, bản release của
`example/`): Android 9+ chặn HTTP thường (cleartext) theo mặc định, và RN đặt `usesCleartextTraffic=false`
cho bản release. Request tới `http://…` (relay nội bộ, `http://localhost` qua `adb reverse`) bị hệ điều
hành từ chối trước khi rời máy ⇒ lib chỉ thấy lỗi `network`: máy chủ không nhận gì, màn báo "Đã xếp
hàng", gửi lại 5 lần rồi thành "Gửi thất bại · Network request failed" (~7,5 phút). **Thử kết nối**
của Webhook không gọi mạng nên vẫn báo chạy được — QA chỉ thấy lỗi lúc gửi. Bản debug cho phép
cleartext nên lúc phát triển không thấy lỗi này. Việc của **app**: dùng `https`, hoặc khai
`network_security_config` cho phép cleartext tới **đúng host đó** (đã đo: khai cho `localhost` là gửi
được, và bản "Gửi thất bại" trong hàng đợi gửi lại được bằng nút **Gửi lại**).

Loại kết nối riêng của khách: `defineConnector<V>({ id, label, fields, secretFieldIds, capabilities,
test, send })` rồi truyền qua `bugReport.connectorTypes`. Lỗi ném bằng `ConnectorError(kind, message)`
với `kind` là một trong `auth` · `permission` · `validation` · `network` · `uncertain` · `rate-limit`
· `unknown`; màn hình và hàng đợi quyết định báo gì và có gửi lại không theo đúng nhóm đó.

Hai luật cho người viết connector riêng, để gửi lại không tạo ticket trùng. Gọi
`ctx.checkpoint({ …, committed: true })` **đúng lúc** bước không đảo ngược vừa xong (ticket/tin đã nằm
ở đích, vd ngay sau khi tạo issue) — không sớm hơn; tiến độ trước đó (file đã upload…) thì checkpoint
**không** kèm `committed`. Hàng đợi chỉ tự gửi lại một lỗi `uncertain` khi đã có `committed: true` (lần
sau nhận lại `ctx.resume` để chỉ làm nốt); thiếu cờ đó thì QA tự kiểm tra đích rồi bấm gửi lại. Khi
bắt lỗi, rẽ nhánh theo `error.kind` hoặc `error.name === 'ConnectorError'`, **không** theo
`instanceof ConnectorError`: bản no-op có lớp `ConnectorError` riêng, nên `instanceof` giữa các entry
có thể sai.

**Ngôn ngữ ticket theo từng kết nối** (`StoredConnection.ticketLocale`, vi/en, mặc định theo ngôn ngữ
giao diện lúc tạo kết nối): tiêu đề các mục (Steps/Actual/Expected/Environment) và nhãn thông tin
máy (`App` → `Ứng dụng`, `OS` → `Hệ điều hành`…) dựng theo ngôn ngữ đó — riêng phần JSON `deviceInfo`
của Webhook giữ nhãn gốc tiếng Anh để server đọc bằng máy. Bước nào QA đã sửa chữ thì gửi đúng chữ QA
gõ, không dịch. `errors.txt` và `timeline.json` luôn tiếng Anh trung lập. `timeline.json` chỉ có
method, đường dẫn (bỏ query), status, thời lượng — **không có thân request/response**.

### Hàng đợi và gửi lại

- Chỉ **tự gửi lại khi chắc chắn request chưa tới server**: mất mạng, không phân giải được tên miền,
  từ chối kết nối (`network`). Gửi lại khi app lên lại từ nền, khi mở panel, và mỗi **60 giây**; tối
  đa **5 lần**, sau đó chuyển "Gửi thất bại" kèm đường Chia sẻ.
- **Timeout sau khi đã gửi** (`uncertain`) thì **không** tự gửi lại: màn báo "không chắc đã gửi,
  kiểm tra ở Jira trước", kèm nút gửi lại thủ công. Ngoại lệ: ticket/tin đã nằm ở đích (connector đã
  checkpoint `committed`, xem trên) thì gửi lại như `network`, lần sau chỉ làm nốt phần còn thiếu.
  Jira và Slack không có khoá chống trùng; Lark dùng `report.id` làm `uuid`.
- `auth` / `permission` / `validation`: **không** tự gửi lại. Bản báo nằm trong hàng đợi ở trạng thái
  bị chặn, giữ bản nháp, đưa QA tới chỗ cần sửa; sửa xong bấm **Gửi lại**.
- QA bấm Gửi hai lần hoặc lắc lại khi đang gửi ⇒ **một** ticket (hàng đợi gộp theo `report.id`).
- Kết nối bị xoá hoặc Keychain trống (gỡ app, khôi phục máy) khi hàng đợi còn bản: báo "kết nối không
  còn", giữ bản, đưa đường Chia sẻ. Ảnh trong cache bị hệ điều hành xoá trước lần gửi lại: ticket
  vẫn được tạo, ảnh ghi vào danh sách bỏ qua.
- Hàng đợi lưu qua `LogStore` của app nếu app bật `persist`; không thì chỉ ở RAM và màn báo "sẽ mất
  nếu app bị tắt". File hàng đợi (`report-queue.json`) chỉ có bản báo và metadata, **không bao giờ có
  bí mật**.
  - Gate lấy `LogStore` **một lần**, lúc dựng hàng đợi (khi gate mount): gọi `startCapture({ persist })`
    **trước** khi gate mount. Gọi sau ⇒ hàng đợi chỉ ở RAM cho cả lần chạy đó.
  - Hàng đợi **đọc** kho (`list`/`read`) có trần **5 giây** (như ghi phiên). Đọc treo ⇒ hàng đợi thôi
    đọc/ghi kho cho tới hết lần chạy, chạy trong RAM, màn báo "sẽ mất nếu app bị tắt" — nút Gửi không
    kẹt ở "Đang chuẩn bị…". **Ghi** thì không bao giờ bị bỏ giữa chừng: ghi chậm chỉ làm lần ghi sau
    tới muộn, file luôn đuổi kịp trạng thái mới nhất (một bản `pending` cũ nằm lại trên đĩa sẽ bị gửi
    lại ở lần mở app sau ⇒ ticket trùng); chỉ thời gian chờ của lần gửi bị chặn ở 5 giây.

### Bí mật

- Token, App Secret, giá trị header webhook chỉ sống trong `secureStore` của app; lib không ghi vào
  `LogStore`, AsyncStorage, `logBuffer`, `console.*` hay chuỗi lỗi. Sau khi lưu chỉ hiện dạng `••••`
  + 4 ký tự cuối.
- **Request của chính tool không bao giờ vào nhật ký**, hai lớp độc lập: gọi trong `runUncaptured` **và**
  mọi request của connector mang header **`X-Shake-Devtools: internal`** để `network-tap` bỏ qua XHR
  đó (kể cả khi `fetch` toàn cục bị app/SDK bọc rồi `await` trước khi mở XHR). ⚠️ Header này là một
  phần của request thật nên **đích cũng nhận được nó** (Jira, Slack, Lark, server webhook của khách) —
  vô hại, nhưng nó có trong access log của đích.
- Mọi thứ rời máy đi qua chính sách che của `redact.ts`. **cURL thô không bao giờ vào bug report.**
- Bí mật lâu dài trên máy QA là rủi ro được chấp nhận có cảnh báo: bot token Slack và App Secret
  Lark mở được mọi quyền của app. Màn thêm kết nối mức đầy đủ nhắc nhờ admin tạo **app riêng cho báo
  bug** với quyền tối thiểu (Slack: `files:write`, `chat:write`; Lark: `im:resource` + một quyền gửi
  tin), thu hồi được bất cứ lúc nào ở console của nền tảng.
- **Feishu — chọn có ý thức endpoint token cũ.** Lark/Feishu mức đầy đủ gọi
  `POST /open-apis/auth/v3/tenant_access_token/internal`. Tài liệu Feishu ghi endpoint này là "历史版本，不推荐使用"
  (bản cũ, không khuyến khích) và khuyên endpoint mới `accounts.feishu.cn/oauth/v3/token` với App
  Secret ở **phía server**; endpoint cũ vẫn chạy và Lark quốc tế vẫn ghi nó. Nếu Feishu tắt endpoint
  này, khách chuyển sang **Webhook/relay** (token ở server của khách).

## Ba lớp chặn prod

1. `enabled` **bắt buộc**, không mặc định, không suy từ `__DEV__` — bản giao tester nhúng sẵn JS
   (offline bundle) nhưng bundle với `--dev true` nên `__DEV__` ở bản UAT cũng `true`.
2. Test ở **app** khoá quan hệ `'prod' ⇒ enabled false`, vì luật là của app.
3. *(tuỳ chọn)* gỡ hẳn khỏi bundle prod: Metro tráo mọi import của lib sang bản noop — mục dưới.
   Phần lib đã bundle và chạy trên máy; đặt biến theo flavor: biến của shell đã đo (có bẫy task
   `UP-TO-DATE`), app nhiều flavor và iOS **chưa verify**.

### Lớp 3: bản noop + `resolveRequest` của Metro

| Entry thật | Bản noop |
|---|---|
| `react-native-shake-devtools` | `react-native-shake-devtools/noop` |
| `react-native-shake-devtools/capture` | `react-native-shake-devtools/noop/capture` |
| `react-native-shake-devtools/shake` | `react-native-shake-devtools/noop/shake` |
| `react-native-shake-devtools/i18n` | `react-native-shake-devtools/noop/i18n` |
| `react-native-shake-devtools/plain` | `react-native-shake-devtools/noop/plain` (= bản noop của `.`: bản rỗng không có sheet nào để khác nhau) |

Cùng tên export, cùng kiểu — thêm export ở bản thật mà quên bản noop thì `tsc` đỏ, nêu đúng tên
(`noop/noop-surface.test.tsx`). Hành vi:

| Loại | Bản noop |
|---|---|
| `DevToolsGate` · `DevToolsUiProvider` | render đúng `children` |
| panel · màn nhật ký · hàng · `LogRow`… | không render gì |
| `useDevTools()` | bản câm `{ enabled: false, isOpen: false, open: () => {} }` |
| `startCapture` · `tap*` · `startPersistence` | không vá gì, trả hàm gỡ / handle rỗng |
| `logBuffer` · `fullBodies` · `previousSession` | luôn rỗng |
| hàm định dạng · truy vấn · hook khác | rỗng của kiểu trả về (`''` · `[]` · `undefined` · `false` · `0`), hằng ổn định |
| hàm che (`redact*`) | bỏ **hết** phần bản thật sẽ che — không bao giờ trả dữ liệu thô |
| hằng (`DEFAULT_CAPACITY`…, bảng chuỗi vi/en) | giữ nguyên giá trị (có test so) |

Không kéo gorhom · reanimated · gesture-handler · safe-area-context, và không kéo file nguồn nào
của lib ngoài hai bảng chuỗi thuần dữ liệu `i18n/vi.ts` · `i18n/en.ts` (≈ 6 KB) —
`noop/noop-isolation.test.ts` gài bẫy từng module rồi nạp bản noop. Giữ bảng chuỗi vì app có thể
đọc `devtoolsStrings` ở module scope của file cấu hình, mà file đó vẫn chạy ở prod.

Code app giữ nguyên **một** dòng `import … from 'react-native-shake-devtools'` cho mọi flavor; Metro
tráo lúc bundle:

```js
// metro.config.js của app
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { devtoolsNoopResolver } = require('react-native-shake-devtools/metro');

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  resolver: {
    resolveRequest: devtoolsNoopResolver({
      enabled: process.env.DEVTOOLS_NOOP === '1', // ⬅️ luật của app — lib không tự đọc biến môi trường
      // resolveRequest: resolver app đang có (svg…), nếu có; vắng ⇒ resolver mặc định của Metro
    }),
  },
});
```

- Bật mà code (của app hay thư viện khác) import một đường **khác** của gói, vd
  `react-native-shake-devtools/src/…` ⇒ bundle **dừng** với lỗi "Không có bản noop", thay vì lặng lẽ
  mang code thật vào.
- `import type` không bị ảnh hưởng (Babel xoá trước khi Metro resolve); `tsc` của app vẫn đọc kiểu
  bản thật.
- Cần Metro đọc `package.json#exports` (`unstable_enablePackageExports`, mặc định bật từ RN 0.79) —
  như các entry phụ có sẵn.
- Lớp 1 vẫn giữ (`enabled: appEnv !== 'prod'`): bản noop bỏ code, không thay luật.

Đã kiểm ngày 6/11/2026: bundle app `example/` (`react-native bundle --platform android --dev false`,
Metro 0.84.6) qua resolver này với `DEVTOOLS_NOOP=1` ⇒ sourcemap còn **7** file của lib (5 file
`src/noop/` + `vi.ts` · `en.ts`) thay vì 58, bundle (chưa minify) nhẹ ≈ 390 KB, mấy chuỗi đặc trưng của code thật
(`setIsShakeToShowDevMenuEnabled`, `log store timeout`) biến mất. Bản release Android
bundle noop (`DEVTOOLS_NOOP=1 ./gradlew app:installRelease`) chạy trên SM-M346B cùng ngày: app mở
bình thường, nút mở panel không làm gì, không crash.

**Đặt `DEVTOOLS_NOOP` theo flavor.** Khoá phải là flavor (lý do ở "Chưa verify"), mà chỉ Gradle / Xcode
biết flavor.

- *Android, biến của shell — đã đo (6/11/2026, `example/`, Gradle 9.3.1, một variant `release`):*
  `DEVTOOLS_NOOP=1 ./gradlew app:installRelease` **có** tới Metro, kể cả khi daemon Gradle đã chạy sẵn
  từ một shell không có biến. ⚠️ Nhưng biến **không** là input của task
  `createBundle<Variant>JsAndAssets`: build lại **không** đặt biến, mã không đổi ⇒ task
  `UP-TO-DATE` và APK vẫn mang bundle noop cũ (đo được). Chiều ngược lại (suy ra, cùng cơ chế): prod build ngay
  sau một lần build không biến thì mang code devtools (lớp 1 vẫn giữ). Mỗi flavor một variant thì
  mỗi task một output riêng nên không lẫn (suy từ tên task, chưa đo); đổi biến trên **cùng** variant thì chạy kèm
  `--rerun-tasks` (hoặc xoá `app/build/generated/assets/react/`). `assembleRelease` gom mọi flavor
  một lệnh thì cả lệnh dùng chung một giá trị biến.
- *Android, nhiều flavor trong một lệnh:* cần đặt biến riêng cho task `createBundle<Variant>JsAndAssets`
  — chưa kiểm task đó có nhận `environment` theo variant không.
- *iOS:* build setting tự khai theo configuration (vd `DEVTOOLS_NOOP = 1` ở config Release của
  scheme prod) được Xcode đưa thành biến môi trường cho Run Script "Bundle React Native code and
  images" — chưa kiểm.

## Phát triển

Repo tự chạy độc lập. Node `^20.19.4 || ^22.13 || >=24.3` (`engines.node`, theo React Native 0.86).

```bash
npm install
npm run typecheck   # tsc --noEmit, với kiểu toàn cục của RN rồi một lần nữa với lib DOM
npm test            # jest
npm run check       # cả hai, jest chạy chế độ CI
npm run check:consumer  # pack, cài vào app tạm, tsc strict + exports (cần registry npm)
```

**Bản phát hành**: `npm run build` (react-native-builder-bob, `tsconfig.build.json`; `prepare` tự chạy
khi `npm install` / `npm pack`) ra `lib/` — không commit. Mỗi entry trong `exports` có ba điều kiện:
`types` → `lib/typescript/` (tsc của app đọc `.d.ts`, không typecheck mã lib), `react-native` → `src/`
(Metro và jest của app vẫn ăn mã nguồn, `'worklet'` do plugin của app biên dịch — như reanimated,
gorhom), `default` → `lib/module/` (ESM). `./metro` trỏ thẳng `src/metro/` (CommonJS cho Node). Gói
gồm `lib/` + `src/` trừ test — xem `npm pack --dry-run`.

| File | Việc |
|---|---|
| `babel.config.js` | Chỉ jest đọc. Cố ý **không** có `react-native-worklets/plugin` (xem mục cuối). |
| `jest.config.js` | Preset RN (`@react-native/jest-preset` từ RN 0.85, `react-native` trước đó) cộng danh sách gói ESM phải transform. Chỉ quét `src/`. |
| `jest.resolver.js` | Resolver của preset RN, đi qua luật jest mà reanimated / worklets đang cài tự phát hành (bỏ đuôi `.native`), để reanimated chạy thật trong jest. |
| `tsconfig.lib.json` | Typecheck riêng mã lib, bỏ file test — CI dùng cho các dòng RN khác bản ghim (mục "Tương thích"). |
| `tsconfig.dom.json` | Mã lib thêm một lần với lib `DOM` (như app Expo đọc `src/`); `npm run typecheck` chạy nó sau `tsconfig.json`. |
| `scripts/check-consumer.mjs` | `npm run check:consumer`: build + pack, cài tarball vào app tạm, tsc của app đọc `lib/typescript/` với `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `skipLibCheck: false` (`bundler`, `nodenext`, preset RN), bề mặt noop ↔ thật, `exports` qua `import` + `require`. Mã được kiểm nằm ở `scripts/consumer-fixture/`. |
| `.github/workflows/check.yml` | CI: `npm run check` theo lockfile trên bản thấp nhất của từng nhánh `engines.node` + LTS mới nhất, mỗi dòng RN trong bảng "Tương thích", và `npm run check:consumer`. |
| `src/test-setup.ts` | Mock gesture-handler, gorhom, safe-area-context. |

Các gói native trong `devDependencies` ghim theo `~` (cùng dòng minor), không theo `^`.
Lý do: `react-native-reanimated` 4.7 đòi `react-native-worklets` 0.13, nên `^4.5` kéo lệch cặp đó
và `npm install` dừng ở ERESOLVE. Nâng thì nâng cả cặp.

### Thử trên máy thật: app `example/`

Cú lắc, bàn phím trong sheet, khay chia sẻ, lưu phiên qua crash thì jest không kiểm được. Thư mục
[`example/`](example/README.md) là app RN 0.86 nạp thẳng `../src` qua Metro, có sẵn nút sinh từng
loại nhật ký và bảng việc cần thử trên máy.

```bash
cd example && npm install
npm run android:release   # lắc là mở panel, không cần Metro
npm start                 # hoặc chạy bản debug: Metro + `npm run android` ở terminal khác
```

`example/` có `node_modules` riêng. Jest và tsc ở gốc repo không quét thư mục này.

## Đã đo trên máy: báo bug (Android)

Ngày 7/11/2026, Samsung SM-M346B, Android 14, RN 0.86.3 kiến trúc mới, bản release của `example/`
(`./gradlew app:installRelease`). Gửi thật qua kết nối **Webhook** tới một máy chủ thử trên máy dev
(`adb reverse tcp:8787 tcp:8787`), máy chủ lưu từng phần multipart. Bản build đo có vài thay đổi tạm,
đã hoàn lại: một khối nút thử bộ ghi thao tác, `network_security_config` cho `localhost`, FLAG_SECURE,
bỏ `writeTempFile`, đổi sang entry `plain`. **Jira, Slack, Lark: chờ tài khoản thử** — chưa gửi thật lần
nào.

| # | Kiểm | Kết quả |
|---|---|---|
| 1 | Ghi thao tác, 17 bước thử | ✅ 17/17 bước đúng: `Chạm "Pay now"` (dòng chữ đầu) · `"Add to cart"` (`accessibilityLabel`) · `"btn-testid-only"` · `Chạm (nút không nhãn)` (khối không nhãn, Switch) · TouchableOpacity · Pressable và RectButton của gesture-handler 3.1 · `Nhập vào ô "Email"` / `"Password"` · `Chạm` và `Giữ lâu "Nguyễn Văn A · •••678"` · `⚠ GET /status/500 → 500` · mốc màn. Cuộn (vuốt bắt đầu trên nút) và chạm trong panel **không** ghi. Chữ gõ (`secret@corp.com`, `hunter2`) không có trong form, `report`, `timeline.json`, `errors.txt`, và 0 dòng logcat của app (chỉ log của `adbd`/`uiautomator` — công cụ đo — có chuỗi đó). Ảnh chụp thì có chữ gõ, đúng với một ảnh màn hình |
| 2 | Ảnh lúc mở panel (`open()`) | ✅ ảnh là màn app, không lẫn panel. **Chụp lại**: sheet đóng hẳn rồi mới chụp, ảnh không lẫn sheet. **FLAG_SECURE**: `screencap` ra 0 byte nhưng `view-shot` **vẫn chụp đủ màn** — ảnh tới webhook có nội dung thật, không đen ⇒ FLAG_SECURE **không** che được ảnh báo bug; màn nhạy cảm phải chặn trong `captureScreen` (trả `null`) |
| 3 | Gửi qua Webhook | ✅ tiêu đề điền sẵn `[Home] GET /status/500 → 500`, ô Thực tế điền sẵn, chip Ảnh · Log lỗi · Thông tin máy. Máy chủ nhận `report` (JSON) + `screenshot.jpg` (`image/jpeg`) + `errors.txt` (`text/plain`) + `timeline.json` (`application/json`), đúng `filename`; có header `X-Shake-Devtools: internal`; không phần nào chứa bí mật (giá trị header, token/password của "POST with secrets", chữ gõ). Màn "Đã tạo WH-3" (máy chủ trả `{ url, key }`). Màn nhật ký không có dòng nào cho request webhook |
| 3b | Không cấp `writeTempFile` | ✅ `errors.txt`, `timeline.json` tới đích thành phần **file** có `filename`, nội dung đúng, `content-type` `text/plain; charset=utf-8` / `application/json; charset=utf-8` (OkHttp gắn `charset`) |
| 4 | Mất kết nối, hàng đợi | ✅ tắt máy chủ → Gửi ⇒ "Đã xếp hàng"; đóng sheet thì dòng phụ hàng Báo bug ghi `1 chờ gửi`, form có banner `Hàng đợi gửi: 1 chờ gửi`; bật máy chủ ⇒ bản báo tới sau 70 s (nhịp 60 s), **đúng một lần**. Bản `failed` (ca cleartext ở trên, sau 5 lần): banner chuyển "cần xử lý" ngay khi form đang mở → trang Hàng đợi → trang kết quả có lý do + lời nhắc kiểm tra đích trước khi gửi lại → **Gửi lại** ⇒ tới đúng một lần. Bản `failed` còn nguyên qua lần cài đè APK |
| 5 | Token hết hạn (máy chủ trả 401) | ✅ "Token Webhook hết hạn, nhập lại" + `HTTP 401: …` + "Bản nháp vẫn được giữ."; **Sửa bản báo** ⇒ tiêu đề, Thực tế còn nguyên. **Chia sẻ** ⇒ khay hệ thống `SEND_MULTIPLE` 3 mục (ảnh + 2 file chữ, kèm tin nhắn). Máy chủ về 200 rồi gửi lại ⇒ tới một lần |
| 6 | Crash rồi báo | ✅ panel có dải "Lần trước app bị crash"; form: tiêu đề `[Crash] Error: Example uncaught error`, Thực tế `The app crashed: …`, 9 bước của phiên trước (tới `Mở màn Checkout`, `Chạm "Throw uncaught error"`, `⚠ Error: …`), chip Phiên trước bật, chip Ảnh tắt; gửi kèm `previous-session.txt`. `errors.txt`, `timeline.json` và chip "Log lỗi (N)" cũng lấy từ phiên crash (đo lại sau bản sửa: chip `(2)` = lỗi 500 + lỗi fatal của phiên crash, lỗi mạng của phiên sau khi mở lại không vào). Bug kế tiếp không còn `[Crash]`, không còn chip Phiên trước |
| 7 | Màn kết nối, bàn phím (gorhom) | ✅ thêm/sửa/xoá Webhook đạt; giá trị header chỉ hiện `••••WXYZ` (danh sách; trang sửa để ô trống + "Đã lưu ••••WXYZ"); Back: sửa → danh sách → form. Bàn phím không che ô ở trang sửa kết nối, ô Tiêu đề, thanh Gửi. Lượt đầu thấy lỗi: chạm ô **Mong đợi** thì thanh Gửi dính đáy đè lên ô (chỉ còn ~30 px). Sau bản sửa (vùng nội dung sheet `scroll` chừa đáy bằng chiều cao chân): ô Mong đợi nằm trọn trên chân (y 913–1138, chân từ 1138), cả khi chạm lúc bàn phím đang mở (ô Thực tế lộ 50 px ⇒ cuộn lên trọn, 913–1138); danh sách Nhật ký vẫn hết ngay trên chân. Entry `plain` không đổi |
| 8 | Entry `plain` (bỏ `GestureHandlerRootView` + `BottomSheetModalProvider`) | ✅ bundle không có gorhom; ghi thao tác đúng; Back: trang các bước → form → đóng sheet; ô Tiêu đề và ô Mong đợi nằm trên thanh Gửi khi bàn phím mở; sửa kết nối + Back từng cấp; gửi Webhook tới nơi |
| 9 | Keychain | ✅ kết nối còn sau khi tắt/mở app và sau khi cài đè APK; bí mật không lần nào hiện rõ |

Ghi thêm: ảnh chụp lúc `open()` (nút "Open debug tools"); cú lắc thật không thử trong lượt này (cùng
một đường chụp trong gate).

## Chưa verify

- **Entry `./plain` trên iOS**, và trên Android không edge-to-edge (inset đáy = 0 ⇒ không cộng gì —
  suy từ mã, chưa đo). Android 14 edge-to-edge đã đo (mục "Entry `plain`").

- **Bàn phím trong sheet trên Android 15 / 16.** `androidKeyboardInputMode` (mục "Android: bàn phím
  trong sheet") mới đo trên Android 14. Bảng cho Android 15/16 suy từ mã nguồn RN 0.86.
- **Promise reject ở bản debug (`--dev true`).** Bản release đã đo trên SM-M346B (6/11/2026): một
  dòng `UNCAUGHT` có stack, huy hiệu +1; catch muộn thêm dòng `WARN` cùng `id`, huy hiệu không đếm
  thêm; dòng vào phiên trước, không có dải crash. Cột `--dev true` (LogBox vẫn hiện) suy từ mã RN 0.86.

- **Ca "đi bộ cầm máy" của iOS.** Ngưỡng iOS chốt từ hai vùng đo được (lắc thật · máy nằm yên);
  ba lượt đo ca đi bộ ngày 14/9/2026 đều rơi đúng lúc máy nằm yên — iOS dừng CoreMotion khi app
  tụt xuống nền nên cửa sổ đo rất hẹp. Nếu QA thấy panel tự mở lúc đi lại thì đây là con số nâng
  trước tiên (8–9 vẫn còn bắn được).
- **Gỡ khỏi bundle prod theo flavor**: bản noop + resolver đã bundle và chạy trên máy (mục "Lớp 3").
  Khoá tráo phải là *flavor* (`--dev` không thay được: flavor staging nhúng sẵn JS vẫn bundle
  `--dev true`, còn các bản release của flavor staging và prod đều `--dev false`). Chưa kiểm: app
  **nhiều** flavor đặt biến riêng cho từng task `createBundle<Variant>JsAndAssets` trong một lệnh, và
  đường iOS (build setting → Run Script).

- **Báo bug — phần chưa kiểm trên máy** (Android đã đo ngày 7/11/2026, mục "Đã đo trên máy: báo bug";
  jest và tsc xanh):
  - **iOS**: cả luồng báo bug (chụp, form, gửi, chia sẻ) chưa thử trên iOS. Lớp secure của iOS có thể
    ra ảnh trắng; phần chuỗi `{ string, name, type }` của `FormData` trên iOS chỉ theo mã nguồn
    `RCTNetworking`.
  - **Vùng SurfaceView/TextureView** (video, bản đồ, camera) trong ảnh `view-shot`: có thể ra đen —
    `example/` không có vùng nào như vậy nên chưa đo. (FLAG_SECURE thì đã đo: **không** chặn được
    `view-shot`.)
  - **Nút native của react-navigation** (header/tab của native-stack): không đi qua JS nên có thể
    thiếu bước "Chạm Back"; `markScreen` bù phần đổi màn. `example/` không dùng react-navigation.
  - **Ảnh lúc lắc thật**: lượt đo mở panel bằng `open()`; cú lắc đi cùng đường chụp trong gate nhưng
    không lắc tay trong lượt này.
  - **`fetch(file://…).blob()`** (Slack đọc byte ảnh/file để upload): chưa kiểm trên máy — cần Slack.
  - **Ngữ cảnh app** (`bugReport.appContext`, 18/11/2026): chỉ jest (cả hai bộ sheet). Chip trên máy,
    thời gian chụp một store lớn trên luồng JS thật, và `context.json` tới đích đều chưa chạy trên máy.
    `example/` đã ráp trường này bằng dữ liệu giả từ 19/11/2026 (hàng panel **App context (example)**:
    normal, large, throws, never resolves), chưa chạy trên máy.
  - **Mã lỗi của Lark**: một phần mã lỗi (99991661/63/68/71 token, 99991672 thiếu scope, 99991400 giới hạn tần suất, 10003/10013/10014 sai App ID/Secret, 232011) chưa đối chiếu được với tài liệu — mã thường gặp ở SDK chính thức, chưa kiểm
    thật; mã nào lạ thì rơi về `unknown`.
  - **Gửi thật tới Jira, Slack, Lark — chờ tài khoản thử**: test của ba connector này dùng `fetch` giả.
    Chưa có lần gửi thật nào tới Jira Cloud (cả token thường lẫn scoped), Slack (webhook lẫn bot token)
    hay Lark/Feishu. Đường gửi chung (hàng đợi, multipart, mất mạng, 401, chia sẻ) đã chạy thật qua
    Webhook.

## Mấy thứ đã kiểm, ghi lại vì không hiển nhiên

- **`'worklet'` trong thư viện ngoài thư mục app CÓ được biến đổi.** `@react-native/metro-babel-transformer`
  dò babel config **đúng một lần ở `projectRoot`** rồi gắn vào `extends` cho mọi file nó
  transform, kể cả file ngoài thư mục app; đường dò `.babelrc` theo vị trí file thì bị
  `babelrcRoots` chặn ở gốc app. ⇒ file lib ăn `.babelrc.js` của app, tức có
  `react-native-worklets/plugin`. Trong jest thì ngược lại (đọc `babel.config.js` của repo, không
  có plugin) — và đó đúng là thứ test của `detect-shake.ts` cần.
- **Đơn vị cảm biến lệch hai nền tảng**: Android `TYPE_LINEAR_ACCELERATION` (đứng yên ≈ 0),
  iOS `CMAccelerometerData` × 9,81 (đứng yên ≈ 9,68 — đo thật). Đường nền tự mồi lo được phần
  lệch gốc toạ độ, **nhưng KHÔNG lo được phần biên độ**: đo 14/9/2026 thì cùng một cú lắc dứt
  khoát cho độ lệch trung vị **27,8 m/s² trên Android** và **1,68 trên iOS** — lệch cả một bậc,
  vì gia tốc thô của iOS dao động quanh 9,7 nên phần lớn mẫu nằm sát nền, chỉ đỉnh mới vọt lên.
  Vì vậy hai nền **phải** hai ngưỡng (Android 12 · iOS 7), và đó không phải chuyện tinh chỉnh
  cho đẹp: với ngưỡng 10 cũ thì trên iOS **không cú lắc nào bắn**, kể cả cú đỉnh 33,6 m/s².
- **Cú lắc thuộc về ai là tuỳ chỗ app lấy JS.** Chạy từ Metro: dev menu của RN giữ cú lắc, panel
  đi nhờ một dòng `DevSettings.addMenuItem` trong đó. Chạy offline (bản tester, JS nhúng trong
  .app): panel nghe lắc, và gate **tắt cú lắc của dev menu** để hai bên không cùng bật — ở bản
  đó dev menu gần như vô dụng, "Reload" còn thất bại vì JS đã đóng băng lúc build.
  ⚠️ **Chỉ iOS.** `DevSettingsModule.kt` của Android là no-op (`// iOS only` ngay trong thân hàm),
  và Android không có công tắc riêng cho cú lắc: `ShakeDetector` bật/tắt theo cả `devSupportEnabled`
  (tắt nó là mất luôn LogBox và màn đỏ), còn `setMinNumShakes` thì nằm trên `ReactInstanceManagerBuilder`
  — API của kiến trúc cũ, app New Arch không đi qua đó. ⇒ **trên Android, tester lắc vẫn thấy dev
  menu chồng lên panel.** Chưa có đường sửa nào rẻ hơn việc viết native module riêng.
