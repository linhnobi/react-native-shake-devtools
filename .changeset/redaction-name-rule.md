---
'react-native-shake-devtools': minor
---

Redaction now masks the secret names JavaScript apps actually use. Before, only eight exact
snake_case JSON keys with string values were masked, so `accessToken`, `refreshToken` and `apiKey`
reached persisted sessions, the shared log and `errors.txt`.

One name rule now covers header names, JSON keys at any depth, and form or query parameters. Names are
compared lowercased without `_`, `-` and `.`, by exact name or by name ending (`…token`, `…secret`,
`…password`, `…apikey`, `…cookie`, …). Debugging names such as `token_type` and `nextPageToken` stay
readable.

- **Values:** numbers and arrays under a secret name are masked too. `null` and booleans stay visible.
- **Bodies:** form-encoded bodies are masked by parameter name.
- **URLs:** query and fragment parameters (plus `code`, `key`, `sig`) and `user:pass@` are masked in
  shared lines, `errors.txt` and persisted sessions.
- **Free text:** console text and error lines are masked too, including report titles prefilled from
  an error. This covers JSON printed inside the text, JWTs, `Bearer` tokens, and tokens with a known
  prefix (Slack, GitHub, Atlassian, AWS, Google, Stripe).

New `startCapture({ redactKeys })` adds app-specific names. **Copy cURL** stays raw by design.
