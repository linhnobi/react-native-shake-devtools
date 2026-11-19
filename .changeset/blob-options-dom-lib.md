---
'react-native-shake-devtools': patch
---

The library's source now type-checks when an app's tsc reads it with `lib: ["DOM"]`, as an Expo app
does (`expo/tsconfig.base`) when it maps the package to `src/`. Before, the Slack connector failed
with `'lastModified' does not exist in type 'BlobPropertyBag'`: React Native's `Blob` options type
requires `lastModified`, DOM's does not allow it in an object literal. Runtime behaviour is unchanged;
the `Blob` still gets the same `type` and `lastModified` on React Native.
