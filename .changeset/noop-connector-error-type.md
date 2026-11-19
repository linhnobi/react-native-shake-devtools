---
'react-native-shake-devtools': patch
---

The no-op entries (`react-native-shake-devtools/noop` and `react-native-shake-devtools/noop/plain`) now
export `ConnectorError` as a type as well as a value, like the real entries, where it is a class. Before,
code that used the name as a type (`let last: ConnectorError | undefined`) failed to typecheck when
TypeScript read a no-op entry (for example through a `paths` alias for production builds), with
`'ConnectorError' refers to a value, but is being used as a type here`. Runtime behaviour is unchanged.
