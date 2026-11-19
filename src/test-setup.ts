/**
 * Setup jest của lib.
 *
 * Bốn thứ phải dựng sẵn, mỗi thứ chữa một kiểu đỏ khó đọc:
 *
 * 0. `react-native-gesture-handler/jestSetup` — mock native của gesture-handler. Thiếu nó thì mọi
 *    suite chạm `SwipeAction`/`LogRow` (kể cả gián tiếp qua `DevToolsGate`) chết ở dòng import:
 *    `TurboModuleRegistry.getEnforcing(...): 'RNGestureHandlerModule' could not be found`.
 * 1. Mock `@gorhom/bottom-sheet` của lib (`testing/bottom-sheet.mock.tsx`) — bản chính thức render
 *    mọi sheet kể cả chưa mở và bỏ qua header/footer/backdrop; bản của lib mở sheet đúng lúc
 *    `present()` và render đủ các vùng.
 * 2. Mock `react-native-safe-area-context` — bản thật đo insets qua `onLayout`, trong jest render
 *    0 con.
 * 3. `@testing-library/react-native` — RNTL v13 bỏ subpath `/extend-expect`, entry chính tự đăng
 *    ký matcher.
 *
 * 📌 Test render thành phần có chữ hoặc theme bọc bằng `renderWithDevTools` (`testing/`) — nó dựng
 * `DevToolsUiProvider`, để chữ ra tiếng Việt và theme cố định. Phần thân `DevToolsPanel`/`LogSheet`
 * còn cần `BottomSheetModalProvider` · `GestureHandlerRootView` ở app thật; trong jest mock gorhom
 * không đòi chúng.
 */
import 'react-native-gesture-handler/jestSetup';
import '@testing-library/react-native';

jest.mock('@gorhom/bottom-sheet', () =>
  require('./testing/bottom-sheet.mock').createBottomSheetMock(),
);

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
