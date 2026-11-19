---
'react-native-shake-devtools': minor
---

New **Copy for AI**: one tap copies a masked Markdown bundle to paste into a coding agent (Claude
Code, Cursor, Copilot). It has a one-line instruction for the agent, app/device/session info, uncaught
errors and unhandled rejections with stacks, recent steps, failed and slow requests (method, URL,
status, duration, headers, cut bodies), and recent console errors and warnings.

- **Where:** a **Copy for AI** row under **Logs** in the panel (running session), and a button in the
  footer of the **Previous session** log (after a crash). It goes to the clipboard, or to `Share`
  when the clipboard is unavailable.
- **Size:** at most 40,000 characters. The most severe and most recent items are kept, identical
  items collapse to `×N`, and the text says what was left out.
- **Privacy:** everything passes through the same redaction as Share and `errors.txt`, including
  `startCapture({ redactKeys })`. It never contains a cURL command or text typed into fields.
- **API:** `formatAiContext(entries, options)` and `AI_CONTEXT_MAX_CHARS` from
  `react-native-shake-devtools/capture`, with no-op twins.
