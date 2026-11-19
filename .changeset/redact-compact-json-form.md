---
'react-native-shake-devtools': patch
---

Fix a token leak in redaction. A compact JSON body (no spaces) that contained an `=` sign anywhere,
for example a base64 token with padding such as `{"refreshToken":"dGVzdA=="}`, was mistaken for a
form body. Its secret keys were then not masked, so the token reached persisted sessions on disk,
`errors.txt` in bug reports and the shared log. `JSON.stringify` produces exactly this shape, so
login and token-refresh responses were the usual victims.

A body that starts with `{` or `[` is now always read as JSON, including a body cut off at
`bodyLimit`. Real form bodies (`grant_type=refresh_token&refresh_token=…`) are still masked by
parameter name. Secret JSON keys are also masked when raw JSON sits inside a form value or a URL
parameter. Sessions already written to disk by an earlier version are masked again when they are
shared, exported or attached to a bug report, but the files themselves keep the token until they
expire (72 hours by default) or the app calls `clearPersistedLogs()`.
