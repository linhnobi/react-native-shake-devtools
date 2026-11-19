/**
 * Resolver của preset RN, đi qua luật jest mà reanimated / worklets tự phát hành.
 *
 * Reanimated 4 chạy trên `react-native-worklets`. Hai package này có hai bản cho một số module:
 * `X.native.ts` (gọi JSI) và `X.ts`. Preset RN ưu tiên đuôi `.native`, nên jest lấy bản JSI và nổ
 * ngay ở dòng import của mọi suite chạm reanimated, kể cả gián tiếp:
 *
 *     TypeError: Cannot read properties of undefined (reading 'loadUnpackersWithCode')
 *     [Worklets] `runOnUISync` is not supported on web.      ← reanimated ≥ 4.7
 *
 * `react-native-reanimated/mock` không gỡ được: nó import lại `./index` và kéo đúng chuỗi đó.
 * Cách gỡ là bỏ đuôi `.native` cho đúng những module đó, và danh sách ấy **đổi theo version**:
 * worklets 0.11 bỏ cho cả package worklets; reanimated 4.7 thêm một danh sách module của chính nó
 * (`react-native-reanimated/jest/resolver.js`). Nên file này không chép luật mà gọi resolver mà
 * package đang cài phát hành — reanimated nếu có, không thì worklets, không có cả hai (reanimated 3)
 * thì thôi. Reanimated khi ấy chạy thật trong jest, `Animated.View` ra `View`.
 *
 * Resolver của package gọi thẳng `options.defaultResolver`, tức bỏ qua resolver của preset RN
 * (preset đó xoá `exports` của `react-native` để test mock được subpath). Vì vậy `defaultResolver`
 * truyền cho nó được thay bằng resolver của preset RN.
 *
 * Resolver của preset RN nằm ở chỗ khác nhau theo dòng RN (CI chạy cả dòng cũ, xem
 * `jest.config.js` mục 5): RN ≥ 0.85 ở `@react-native/jest-preset`, RN 0.80–0.84 ở
 * `react-native/jest/`, RN ≤ 0.79 không có — preset khi đó dùng resolver mặc định của jest.
 */
const tryRequire = (ids) => {
  for (const id of ids) {
    let file;
    try {
      file = require.resolve(id);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') continue;
      throw error;
    }
    return require(file);
  }
  return null;
};

const rnResolver =
  tryRequire(['@react-native/jest-preset/jest/resolver.js', 'react-native/jest/resolver.js']) ??
  ((request, options) => options.defaultResolver(request, options));

const packageResolver = tryRequire([
  'react-native-reanimated/jest/resolver.js',
  'react-native-worklets/jest/resolver.js',
]);

module.exports = (request, options) => {
  const viaRn = (req, opts) =>
    rnResolver(req, { ...opts, defaultResolver: options.defaultResolver });

  return packageResolver
    ? packageResolver(request, { ...options, defaultResolver: viaRn })
    : viaRn(request, options);
};
