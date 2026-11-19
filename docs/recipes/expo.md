# Công thức: dùng trong app Expo

> **Trạng thái (6/11/2026).** Viết từ mã nguồn Expo nhánh `sdk-56` (`expo` 56.0.24) và test jest của
> lib trên một `expo/fetch` **giả** dựng theo mã nguồn đó. **Chưa chạy trên máy với app Expo nào**: mọi
> đoạn code dưới đây đã khớp kiểu `DevToolsConfig` của lib (`tsc`), còn hành vi trên máy thì chưa kiểm.
> Chỗ nào chỉ suy từ mã nguồn/tài liệu ghi *(chưa kiểm trên máy)*.
>
> App mẫu dựng theo công thức này (SDK 58, entry `./plain`, Expo Go / dev build / release + noop):
> [`example-expo/`](../../example-expo/README.md) (tiếng Anh) — đã `tsc`, `expo export`, `expo-doctor`; chưa chạy trên máy.

Số phiên bản dưới đây lấy từ `bundledNativeModules.json` của Expo SDK 56: RN 0.85.3, React 19.2.3,
reanimated 4.3.1 + worklets 0.8.3, gesture-handler ~2.31.1, safe-area-context ~5.7.0. Đều nằm trong
khoảng peer của lib, nhưng RN 0.85 **không** có dòng riêng trong bảng "Tương thích" của README (có
0.83 và 0.86).

## 1. Dev build, không phải Expo Go

Lib là JS thuần: không native module, không config plugin. Native nằm ở **peer** và ở các adapter mà
app tự viết:

| Gói | Ai cần | Native |
|---|---|---|
| `react-native-reanimated` (+ `react-native-worklets`) | cảm biến lắc của `DevToolsGate` (mọi entry có UI) | có |
| `react-native-safe-area-context` | đọc inset của sheet | có |
| `@gorhom/bottom-sheet` + `react-native-gesture-handler` | chỉ entry `.` | có (gesture-handler) |
| `expo-secure-store` · `react-native-view-shot` · `expo-file-system` · `expo-sharing` | adapter báo bug ở mục 4 (tuỳ chọn) | có |

Dùng **development build** để phát triển (`npx expo run:android`, `npx expo run:ios`, hoặc
`eas build --profile development`) và một bản **cài được** (EAS `distribution: "internal"`) để giao QA.

Expo Go *(chưa kiểm trên máy)*: các peer trên đều có sẵn trong Expo Go nên lib có thể nạp được, nhưng
cú lắc trong Expo Go mở menu của chính Expo Go, và QA không thử app qua Expo Go. Không khuyên dùng.

Bản dev build có `expo-dev-client` cũng mở **dev menu của Expo** khi lắc, chồng lên panel *(chưa kiểm
trên máy)*. Công tắc `setIsShakeToShowDevMenuEnabled` mà gate gọi là của dev menu RN (iOS), không phải
của `expo-dev-menu`; tắt cử chỉ lắc trong phần cài đặt của dev menu Expo nếu bị vướng. Bản internal
(release) không có dev menu nên không vướng.

## 2. Entry `./plain`: ít peer nhất

```ts
import { DevToolsGate } from 'react-native-shake-devtools/plain';
```

Cùng API với entry `.`, nhưng **không** cần `@gorhom/bottom-sheet` lẫn `react-native-gesture-handler`:

```bash
npx expo install react-native-reanimated react-native-worklets react-native-safe-area-context
```

(`npx expo install` chọn đúng bản theo SDK. Cài reanimated theo hướng dẫn của Expo cho SDK đang dùng.)

Gate của `./plain` vẽ sheet là lớp phủ ngay chỗ nó đứng, nên phải bọc **toàn màn**. Với Expo Router,
đặt ở layout gốc:

```tsx
// app/_layout.tsx
import { Stack } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DevToolsGate } from 'react-native-shake-devtools/plain';
import { devToolsConfig } from '../src/devtools/devtools-config';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1 }}>
        <DevToolsGate config={devToolsConfig} actions={[]}>
          <Stack />
        </DevToolsGate>
      </View>
    </SafeAreaProvider>
  );
}
```

`actions` là các hàng riêng của app (mảng rỗng vẫn chạy). Dựng nhãn hàng trong hook, như README ›
"Ráp vào một app".

## 3. Bật thu sớm: file entry

`startCapture` phải chạy **trước** mọi module của app (lý do ở JSDoc của nó). Với Expo Router, entry
mặc định là `expo-router/entry`; thêm một entry riêng để chen vào trước:

```jsonc
// package.json
{ "main": "index.ts" }
```

```ts
// index.ts — thứ tự import là thứ tự chạy
import './src/devtools/capture';
import 'expo-router/entry';
```

```ts
// src/devtools/capture.ts
import { startCapture } from 'react-native-shake-devtools/capture';
import { DEVTOOLS_ENABLED } from './devtools-env';

startCapture({ enabled: DEVTOOLS_ENABLED }); // required; anything but `true` patches nothing
```

```ts
// src/devtools/devtools-env.ts
/** Luật của app. `EXPO_PUBLIC_*` được Expo nhúng vào bundle lúc build. */
export const DEVTOOLS_ENABLED = process.env.EXPO_PUBLIC_APP_ENV !== 'production';
```

Không dùng `__DEV__` làm khoá: bản EAS internal/preview build ở chế độ release nên `__DEV__` là
`false` đúng ở bản QA cần công cụ. Không có Expo Router thì làm y vậy, đổi dòng cuối của `index.ts`
thành `registerRootComponent(App)` của `expo`.

### `fetch` của Expo SDK 56+ cũng được bắt

Từ SDK 56, Expo cài `expo/fetch` (native, **không** qua `XMLHttpRequest`) làm `fetch` toàn cục trên
Android/iOS (changelog `expo` 56.0.0: "Use `expo/fetch` as default fetch", expo/expo#44987).
`startCapture` bọc thêm `fetch` đó (mã ở `src/capture/fetch-tap.ts`, không export riêng):

- **Dò:** `fetch` toàn cục mang dấu `Symbol.for('expo.builtin')` (Expo đóng lên mọi global nó cài qua
  `installGlobal`, `expo/src/winter/installGlobal.ts`) và **không** có cờ `polyfill` của whatwg-fetch
  ⇒ bọc. Sentry RN dò đúng dấu này (`isExpoFetchEnabled`, getsentry/sentry-react-native#6226, merge
  2/6/2026). `fetch` của RN (whatwg trên XHR) ⇒ không bọc, tap XHR đã bắt — không ghi trùng.
- **Thời điểm:** config Metro của Expo (`expo/metro-config`) chạy `expo/src/winter` **trước** module
  chính (`getModulesRunBeforeMainModule` của `@expo/metro-config`, nhánh `sdk-56`), nên lúc
  `src/devtools/capture.ts` chạy, `fetch` toàn cục đã là `expo/fetch`. App không dùng config Metro của
  Expo thì thêm `import 'expo';` lên đầu `index.ts` *(chưa kiểm trên máy)*.
- **Ngữ nghĩa** như dòng của tap XHR: method, URL, header thô (che khi xuất), thân request (cùng
  hạn mức và lý do bỏ qua), status, lỗi `network`/`timeout`/`abort` (huỷ không tính là lỗi), màn đang
  mở. Thân response chỉ đọc khi `content-type` là chữ và ≤ 1 MB, bằng **bản clone**
  (`response.clone()`, Expo `tee` luồng) — `res.text()` của app vẫn ra đủ. Ba chỗ **khác**:
  - **Thời lượng:** status vào lúc có header; thân đọc xong thì thời lượng thành thời gian tới hết
    thân (như `loadend` của XHR). Thân **không** đọc (nhị phân, trên 1 MB, SSE, HEAD/204/304) thì
    thời lượng chỉ tới lúc có header — tải 6 s một ảnh vẫn ghi vài chục ms, chip "Chậm ≥3s" không thấy.
  - **Hỏng giữa thân:** chỉ thấy khi tap đang đọc thân (dòng chuyển sang `network`); thân không đọc
    thì dòng giữ status.
  - **`AbortSignal.timeout(ms)`** ghi `timeout`; cùng ca đó qua `fetch` của RN ghi `abort`
    (whatwg-fetch chỉ gọi `xhr.abort()`).
- Request của chính tool (connector báo bug) vẫn bị loại trừ: `runUncaptured` và header
  `X-Shake-Devtools`.

Không bắt được, hoặc bắt thiếu:

| Ca | Vì sao |
|---|---|
| `import { fetch } from 'expo/fetch'` rồi gọi thẳng | binding của module, không đi qua `fetch` toàn cục |
| SDK bọc `fetch` **trước** `startCapture` (vd `Sentry.init` chạy trước) | hàm bọc của SDK không mang dấu ⇒ tap không dám bọc (có thể là XHR bên dưới). Gọi `startCapture` trước: SDK bọc ra ngoài, cả hai cùng thấy request. Hàm bọc của tap **mang lại** dấu, nên SDK dò dấu sau đó vẫn bật đúng |
| `text/event-stream` (SSE) | chỉ có status và thời lượng tới header, thân ghi "không đọc được": đọc nhánh `tee` của luồng không hồi kết sẽ giữ kết nối sống cả khi app đã huỷ |
| Thân nhị phân hoặc `content-length` > 1 MB | như tap XHR: ghi lý do, **không** clone (đường đọc của app không đổi). Khác XHR: thời lượng chỉ tới header |

Khi tap đọc thân, `res.text()`/`json()` của app đọc qua nhánh `tee` của luồng thay vì một lần đọc
native *(chưa đo hiệu năng trên máy)*. `expo` < 56.0.8 có lỗi `bodyUsed` khi một response bị clone
**hai** lần (expo/expo#46397). Tap clone một lần; app tự clone thêm thì nên dùng ≥ 56.0.8.
`EXPO_PUBLIC_USE_RN_FETCH=1` trả `fetch` về polyfill của RN, khi đó tap XHR bắt như app RN thường.

## 4. Báo bug với module Expo

Bốn trường của `DevToolsBugReportConfig` (`src/gate/devtools-props.ts`). Mọi adapter là **hằng ở
module scope**: gate dựng kho kết nối theo tham chiếu `secureStore`.

```bash
npx expo install expo-secure-store react-native-view-shot expo-file-system expo-sharing
```

### `secureStore` — `expo-secure-store`

```ts
// src/devtools/secure-store.ts
import * as SecureStore from 'expo-secure-store';
import type { DevToolsSecureStore } from 'react-native-shake-devtools/plain';

/**
 * expo-secure-store chỉ nhận khoá khớp `/^[\w.-]+$/`. Khoá của lib (`devtools.connections.v1`,
 * `devtools.secret.<id>`, `devtools.lastConnection`) vốn hợp lệ; đổi ký tự lạ (nếu có) cho chắc.
 */
const safeKey = (key: string) =>
  key.replace(/[^\w.-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);

/** Không theo bản sao lưu sang máy khác — lib tự xử lý ca kho trống (cài lại, đổi máy). */
const WRITE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const expoSecureStore: DevToolsSecureStore = {
  getItem: (key) => SecureStore.getItemAsync(safeKey(key)),
  setItem: (key, value) => SecureStore.setItemAsync(safeKey(key), value, WRITE_OPTIONS),
  removeItem: (key) => SecureStore.deleteItemAsync(safeKey(key)),
};
```

### `captureScreen` — `react-native-view-shot`

Expo không có module chính chủ nào chụp màn thành file; `react-native-view-shot` là gói nằm trong danh
sách SDK của Expo (`npx expo install` chọn bản 5.1.0 cho SDK 56). `expo-screen-capture` thì ngược lại:
**chặn** chụp (`usePreventScreenCapture` — FLAG_SECURE trên Android). FLAG_SECURE **không** chặn được
`view-shot` (đã đo trên Android 14, app RN thường, 7/11/2026: ảnh vẫn đủ nội dung), nên màn đã chặn thì
`captureScreen` phải tự trả `null` — form ghi "màn này không cho chụp" và ảnh màn nhạy cảm không rời máy.

```ts
// src/devtools/capture-screen.ts
import { Dimensions, PixelRatio } from 'react-native';
import { captureScreen as viewShot } from 'react-native-view-shot';
import type { DevToolsCapturedImage } from 'react-native-shake-devtools/plain';

/** Màn nhạy cảm của app (PIN, OTP, thẻ…): luật chặn chụp là của app. */
const isSensitiveScreen = (): boolean => false;

export const captureScreen = async (): Promise<DevToolsCapturedImage | null> => {
  if (isSensitiveScreen()) return null;
  const uri = await viewShot({ format: 'jpg', quality: 0.7, result: 'tmpfile' });
  const { width, height } = Dimensions.get('window');
  const ratio = PixelRatio.get();
  return {
    uri,
    mimeType: 'image/jpeg',
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
};
```

Ném lỗi hoặc quá 1,5 s ⇒ lib ghi "không chụp được" và vẫn mở panel, không cần `try/catch`.

### `writeTempFile` + `exportFile` — `expo-file-system`, `expo-sharing`

API `File`/`Paths` của `expo-file-system` (mặc định từ `expo-file-system` 19 / SDK 54; API cũ ở
`expo-file-system/legacy`).
Từ `expo-file-system` 58 (SDK 58), `write` **trả Promise** (bản đồng bộ là `writeSync`; changelog
58.0.0, expo/expo#45992), nên luôn `await` — ở SDK cũ hơn, `await` một giá trị thường cũng vô hại.

```ts
// src/devtools/files.ts
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { DevToolsExportFile } from 'react-native-shake-devtools/plain';

/** `bugReport.writeTempFile`: chuỗi UTF-8 → file trong cache, trả `file://…`. */
export const writeTempFile = async (name: string, content: string): Promise<string> => {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  await file.write(content);
  return file.uri;
};

/** `DevToolsConfig.exportFile` (nút Xuất lỗi): một file chữ ra khay chia sẻ. */
export const exportFile = async (file: DevToolsExportFile): Promise<void> => {
  const uri = await writeTempFile(file.name, file.content);
  await Sharing.shareAsync(uri, { mimeType: file.mimeType, dialogTitle: file.name });
};
```

### `shareFiles` — nhiều file một lần

`expo-sharing` (56.0.27) chia sẻ **một** file mỗi lần gọi (`shareAsync(url, options)`), không nhận
tin nhắn kèm. Lib cam kết không im lặng bỏ ảnh, nên adapter không được chỉ chia sẻ file đầu. Hai cách:

**a) Chỉ module Expo** — mở lần lượt từng khay, tin nhắn đi thành file đầu *(chưa kiểm trên máy:
`shareAsync` trên Android có thể resolve trước khi khay đóng, khi đó các khay chồng nhau)*:

```ts
// src/devtools/share-files.ts
import * as Sharing from 'expo-sharing';
import type { DevToolsShareFile } from 'react-native-shake-devtools/plain';
import { writeTempFile } from './files';

export const shareFiles = async (
  files: readonly DevToolsShareFile[],
  message: string,
): Promise<void> => {
  const all: DevToolsShareFile[] = [
    { name: 'bug-report.txt', mimeType: 'text/plain', content: message },
    ...files,
  ];
  for (const file of all) {
    const uri = file.uri ?? (await writeTempFile(file.name, file.content ?? ''));
    await Sharing.shareAsync(uri, { mimeType: file.mimeType, dialogTitle: file.name });
  }
};
```

**b) Một khay cho mọi file** — `react-native-share` (gói cộng đồng có native code, cần dev build),
y như `example/src/devtools/share-files.ts` của repo, chỉ đổi phần ghi file sang `writeTempFile` ở
trên *(chưa kiểm trên app Expo)*.

### Ghép lại

```ts
// src/devtools/devtools-config.ts
import type { DevToolsConfig } from 'react-native-shake-devtools/plain';
import { captureScreen } from './capture-screen';
import { DEVTOOLS_ENABLED } from './devtools-env';
import { exportFile, writeTempFile } from './files';
import { expoSecureStore } from './secure-store';
import { shareFiles } from './share-files';

export const devToolsConfig: DevToolsConfig = {
  enabled: DEVTOOLS_ENABLED,
  subtitle: process.env.EXPO_PUBLIC_APP_ENV,
  exportFile,
  bugReport: {
    captureScreen,
    secureStore: expoSecureStore,
    shareFiles,
    writeTempFile,
  },
};
```

## 5. Gỡ khỏi bản prod: resolver Metro trong `metro.config.js` của Expo

Như README › "Lớp 3", chỉ khác cách lấy config gốc:

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { devtoolsNoopResolver } = require('react-native-shake-devtools/metro');

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = devtoolsNoopResolver({
  enabled: process.env.DEVTOOLS_NOOP === '1', // ⬅️ luật của app
  resolveRequest: config.resolver.resolveRequest, // giữ resolver sẵn có, nếu có
});

module.exports = config;
```

Đặt biến theo profile build của EAS *(chưa kiểm trên EAS)* — `env` của profile có mặt suốt lúc build,
kể cả bước Metro bundle:

```jsonc
// eas.json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "env": { "EXPO_PUBLIC_APP_ENV": "uat" }
    },
    "production": {
      "env": { "EXPO_PUBLIC_APP_ENV": "production", "DEVTOOLS_NOOP": "1" }
    }
  }
}
```

Build cục bộ: `DEVTOOLS_NOOP=1 npx expo export` hoặc `DEVTOOLS_NOOP=1 npx expo run:android --variant
release`; đổi giá trị biến thì chạy kèm `--clear` cho chắc (cache của Metro). Lớp 1 (`enabled` theo
`EXPO_PUBLIC_APP_ENV`) vẫn giữ: bản noop bỏ code, không thay luật. Các entry phụ (`/plain`,
`/capture`, `/noop/…`) cần Metro đọc `package.json#exports` — mặc định bật từ RN 0.79, SDK 56 dùng
RN 0.85.
