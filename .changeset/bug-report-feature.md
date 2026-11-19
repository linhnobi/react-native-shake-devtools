---
'react-native-shake-devtools': minor
---

Add in-app bug reporting for QA. Shaking the device opens a pre-filled report (screenshot, auto-recorded
steps, error log, device info) that can be sent to Jira Cloud, Slack, Lark/Feishu or a webhook, with a
retry queue for flaky networks. The feature is opt-in through `DevToolsConfig.bugReport`; every native
capability (screenshot, secure store, file sharing) is supplied by the app. Custom destinations plug in
through `bugReport.connectorTypes`. The tool's own requests are never written to the network log, and
secrets live only in the app-provided secure store.
