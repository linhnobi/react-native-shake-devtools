# Good first issues (drafts)

Ready-to-file issue drafts for newcomers. Each has context, acceptance criteria and the files to touch.
They are drafts: a maintainer opens them (labels `good first issue` / `help wanted`) once the repository
is public. Read [CONTRIBUTING.md](../CONTRIBUTING.md) first; `npm run check` must be green for every one
of them.

| # | Title | Type | Size |
|---|---|---|---|
| 1 | [Decouple the UI locale from the ticket locale](#1-decouple-the-ui-locale-from-the-ticket-locale) | prerequisite for 2 to 6 | medium |
| 2 | [Add Japanese (`ja`) UI strings](#2-add-japanese-ja-ui-strings) | locale | small |
| 3 | [Add Korean (`ko`) UI strings](#3-add-korean-ko-ui-strings) | locale | small |
| 4 | [Add Simplified Chinese (`zh`) UI strings](#4-add-simplified-chinese-zh-ui-strings) | locale | small |
| 5 | [Add Thai (`th`) UI strings](#5-add-thai-th-ui-strings) | locale | small |
| 6 | [Add Indonesian (`id`) UI strings](#6-add-indonesian-id-ui-strings) | locale | small |
| 7 | [Discord connector](#7-discord-connector) | connector | medium |
| 8 | [Microsoft Teams connector](#8-microsoft-teams-connector) | connector | medium |
| 9 | [Recipe: report the current screen with react-navigation and expo-router](#9-recipe-report-the-current-screen-with-react-navigation-and-expo-router) | docs | small |
| 10 | [Screenshots and GIFs for the README](#10-screenshots-and-gifs-for-the-readme) | docs | small |
| 11 | [Telegram connector](#11-telegram-connector) | connector | medium |
| 12 | [Recipe: a ClickUp, Trello, Asana or YouTrack connector](#12-recipe-a-clickup-trello-asana-or-youtrack-connector) | docs | small |

Issues 2 to 6 can only start after issue 1 lands, or together with it if you want a bigger first
contribution. Issues 7, 8 and 11 can be built entirely **in your own app** through
`bugReport.connectorTypes` first, then contributed as built-in connectors.

---

## 1. Decouple the UI locale from the ticket locale

**Labels:** `help wanted`, `i18n`

**Context.** `DevToolsLocale` is the union `'vi' | 'en'` (`src/i18n/types.ts`). It is used for two
different things: the language of the library's own UI (panel, log screen, bug-report form) and the
language of the ticket sent to Jira, Slack or Lark (`StoredConnection.ticketLocale`, headings such as
Steps, Actual, Expected, Environment). Ticket headings are hand-built per connector (`jira/adf.ts`,
`slack/blocks.ts`, `lark/card.ts`, `share-report.ts`) and validated as `'vi' | 'en'` when a connection
is loaded (`connections/connection-store.ts`). A new UI language should not force someone to translate
every ticket template.

**Proposal.** Introduce `DevToolsUiLocale` (open union, for UI strings) while `DevToolsLocale` for
tickets stays `'vi' | 'en'`. A UI locale that has no ticket template falls back to `en` for tickets.

**Acceptance criteria**
- `DevToolsConfig.locale` accepts every UI locale; adding one means adding a strings file and one
  registry entry, nothing else.
- Ticket text and `ticketLocale` keep working unchanged for `vi` and `en`; an unknown stored
  `ticketLocale` falls back to `en` instead of dropping the connection.
- An unsupported `locale` value falls back to `en` for UI strings (the type allows only supported ones;
  this protects JavaScript callers).
- `src/noop/i18n.ts` and `src/noop/index.ts` keep the same surface (the typecheck proves it).
- Tests cover: new UI locale resolves, ticket fallback to `en`, stored connection with an old value.

**Files to touch:** `src/i18n/types.ts`, `src/i18n/translate.ts`, `src/i18n/index.ts`,
`src/gate/devtools-props.ts`, `src/report/connections/connection-store.ts`,
`src/report/connectors/ticket-text.ts`, `src/noop/i18n.ts`, `src/noop/index.ts`, with tests next to each.

---

## Issues 2 to 6: add a UI locale

Shared description for the five locale issues below.

**Context.** The built-in UI strings live in `src/i18n/vi.ts` and `src/i18n/en.ts` (about 300 lines each,
typed by `DevToolsStrings`). Strings can contain `{{variables}}` that must keep their exact names. Today
a language is added by passing a full set through `DevToolsConfig.strings`; this issue ships it as a
first-class locale.

**Acceptance criteria (all five)**
- A new `src/i18n/<code>.ts` implementing the whole `DevToolsStrings` type (tsc proves completeness).
- Every `{{variable}}` is present and unchanged; plural or count forms read naturally.
- The locale is registered so `config.locale: '<code>'` works, and the no-op strings table includes it
  (the no-op i18n keeps the string tables as plain data).
- A test (next to `translate.test.ts`) resolves a handful of keys in the new locale and checks that all
  variables match `en`.
- A native or fluent speaker reviewed the text; say so in the PR. Prefer short, common UI wording over
  literal translation. Keep technical terms (cURL, HTTP, headers, Jira) untranslated.

**Files to touch:** `src/i18n/<code>.ts` (new), `src/i18n/translate.ts`, `src/i18n/index.ts`,
`src/i18n/translate.test.ts`, `src/noop/i18n.ts`.

### 2. Add Japanese (`ja`) UI strings

Locale code `ja`. Use polite form (です・ます) consistently and standard katakana for terms such as
"screenshot".

### 3. Add Korean (`ko`) UI strings

Locale code `ko`. Use the polite 해요/합니다 register consistently.

### 4. Add Simplified Chinese (`zh`) UI strings

Locale code `zh` (Simplified, mainland usage). Traditional Chinese (`zh-TW`) is a separate, later issue.
Note that Lark/Feishu users are a main audience for this locale.

### 5. Add Thai (`th`) UI strings

Locale code `th`. Check that Thai text with tone marks is not clipped in the sheet header and rows
(line height); include a screenshot from a device or emulator in the PR.

### 6. Add Indonesian (`id`) UI strings

Locale code `id`. Use formal-neutral wording that reads well for QA teams.

---

## 7. Discord connector

**Labels:** `good first issue`, `connector`

**Context.** A Discord channel is a common place for indie and open-source teams to receive bug reports.
Built-in connectors are objects made with `defineConnector` and live in `src/report/connectors/`
(`webhook.ts` is the simplest to copy). Connectors declare form `fields`, `secretFieldIds`
(the webhook URL contains the secret), `capabilities`, `test` and `send`, and throw
`ConnectorError(kind, message)` so the UI and queue know whether to retry.

**Proposal.** `discordConnector`: the QA pastes a Discord channel webhook URL. `send` posts one message
with an embed (title, steps, actual/expected, environment) and uploads the screenshot and
`errors.txt` / `timeline.json` as attachments (multipart with a `payload_json` part). Check Discord's
current webhook docs for file and embed limits before you start and truncate content to fit.

What we found on 2026-11-09, so re-check before relying on it:
- The default upload limit is 20 MiB per file, for each file in a request
  ([reference](https://docs.discord.com/developers/reference)).
- `content` holds at most 2,000 characters, and a message has at most 10 embeds.
- `?wait=true` returns the created message.
- When the webhook belongs to a **forum channel**, `thread_name` makes every report its own post
  ([webhook docs](https://docs.discord.com/developers/resources/webhook)). That works like a free
  tracker, so support it as an optional field.

**Acceptance criteria**
- Fields: webhook URL (secret). `test` validates the URL shape and does a harmless check without
  posting a visible message if the API allows it; otherwise it documents what it posts.
- `send` creates one message with attachments; failures map to `ConnectorError` kinds: `auth` (invalid
  webhook), `rate-limit` (HTTP 429), `validation`, `network`, `uncertain` (timeout after sending).
- Does not retry unsafely: Discord has no idempotency key, so a timeout after sending is `uncertain`.
- All requests go through `ctx.fetch` (so they carry `X-Shake-Devtools: internal` and stay out of the
  log), and secrets are listed in `secretFieldIds` and never appear in error text.
- Registered in `builtinConnectorTypes`, exported from `src/index.ts` and `src/plain/index.ts`, with a
  no-op twin in `src/noop/index.ts` and `src/noop/plain.ts`.
- Tests (next to the file) with a mocked `fetch`: success, 4xx, 429, timeout, content truncation.
- A short section in the README table of built-in connectors.

**Files to touch:** `src/report/connectors/discord/index.ts` and `index.test.ts` (new),
`src/report/connectors/builtin.ts`, `src/index.ts`, `src/plain/index.ts`, `src/noop/index.ts`,
`src/noop/plain.ts`, README connector table.

---

## 8. Microsoft Teams connector

**Labels:** `good first issue`, `connector`

**Context.** Many enterprise customers use Teams. Microsoft retired the old Office 365 connector webhooks
in favour of the **Workflows** app ("Post to a channel when a webhook request is received"), which
accepts an Adaptive Card payload. Verify the current payload format and limits in Microsoft's
documentation before you start; do not rely on the legacy MessageCard format.

What Microsoft's page said on 2026-11-09
([Create an Incoming Webhook](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook)):
- Connector-based incoming webhooks were retired in May 2026.
- A Workflows webhook accepts Adaptive Card and MessageCard payloads.
- A message is capped at **28 KB**; anything larger returns an error.
- More than four requests a second are throttled.
- A workflow belongs to the user who created it, so it can become an orphan flow when that person
  leaves. The README section for this connector should tell admins to add a co-owner.

**Proposal.** `teamsConnector` with a Workflows webhook URL (secret). `send` posts an Adaptive Card with
title, steps, actual/expected and environment. A webhook cannot carry images or files, so (like the light
Slack and Lark connectors) it declares no file capability and the success screen offers **Share
screenshot and logs** so the QA can attach them to the thread.

**Acceptance criteria**
- Fields: webhook URL (secret). Connector `capabilities` say that files are not supported.
- The card respects the size limit (truncate steps and text, keep the title and actual/expected).
- Errors map to `ConnectorError` kinds (`auth`, `validation`, `rate-limit`, `network`, `uncertain`).
- Same registration, export, no-op and test requirements as the Discord issue.
- Ticket text honours `ticketLocale` through `ticket-text.ts`.

**Files to touch:** `src/report/connectors/teams/index.ts`, `card.ts` and tests (new),
`src/report/connectors/builtin.ts`, `src/index.ts`, `src/plain/index.ts`, `src/noop/index.ts`,
`src/noop/plain.ts`, README connector table.

---

## 9. Recipe: report the current screen with react-navigation and expo-router

**Labels:** `good first issue`, `documentation`

**Context.** Every log line is stamped with the current screen, and the bug-report title and steps use
it, but only if the app calls `markScreen(route)` when navigation changes (`src/capture/markers.ts`).
The README shows the idea in one line for `NavigationContainer`. People need copy-paste recipes.

**Proposal.** A `docs/recipes/navigation.md` with tested snippets for: `react-navigation` (v6/v7:
`onStateChange` plus the first screen via `onReady`), `expo-router` (a listener on the navigation state
or `usePathname`), and a note on nested navigators (report the leaf route).

**Acceptance criteria**
- Each snippet compiles in a fresh app of that stack, and the PR says which versions you used.
- It shows the resulting log line or bug-report title so readers can confirm it works.
- It states what is **not** verified (for example Expo Go) instead of guessing.
- Linked from the README and from `docs/install.md`.

**Files to touch:** `docs/recipes/navigation.md` (new), `docs/install.md`, README.

---

## 10. Screenshots and GIFs for the README

**Labels:** `good first issue`, `documentation`

**Context.** The README has no visuals. People decide in seconds whether a devtool is worth trying.
The `example/` app runs on a real device and has buttons that generate every kind of log.

**Proposal.** Capture a small, consistent set from the `example/` app (release build so the shake works):
the panel, the log screen with an error filter, a request detail page showing `<redacted>` headers,
the bug-report form, the sent confirmation. Light and dark, Android and iOS where you have the device.

**Acceptance criteria**
- Images in `docs/images/`, PNG or WebP under 300 KB each, GIFs under 3 MB, 1080 px wide at most.
- No real personal data, tokens or company names visible (use the example's demo data).
- Short alt text on every image in the Markdown that embeds them.
- The PR lists device, OS and build type for each image. No iOS image is submitted unless taken on iOS.

---

## 11. Telegram connector

**Labels:** `good first issue`, `connector`

**Context.** Many teams in Vietnam, Eastern Europe and Indonesia use a Telegram group as their bug
channel; in the 2024 Stack Overflow survey, Telegram was used by about a fifth of all respondents. A bot
can post text, a photo and documents with only a bot token and a chat id, so it fits the "paste it on
the device" model. Read the Discord issue (#7) first: the shape is the same.

**Proposal.** `telegramConnector`: the QA pastes a bot token (from BotFather) and the group's chat id,
after adding the bot to the group. `send` posts the screenshot with `sendPhoto` and a short caption, or
uses `sendMessage` when there is no screenshot. It then posts `errors.txt` and `timeline.json` with
`sendDocument`, or with one `sendMediaGroup` of documents. Check the
[Bot API](https://core.telegram.org/bots/api) for the current limits before you start. On 2026-11-09 it
gave:
- 4,096 characters per message and 1,024 per caption;
- 10 MB for a photo and 50 MB for a document;
- 2 to 10 items in a media group, where documents can only be grouped with documents.

Telegram has no idempotency key, so call `ctx.checkpoint({ …, committed: true })` right after the first
message exists. A retry then only posts the files that are still missing.

**Acceptance criteria**
- Fields: bot token (secret) and chat id. `test` calls `getMe` and `getChat`, which post nothing, so a
  wrong token and a bot that is not in the group are reported before the first send.
- The bot token is part of the request URL (`/bot<token>/…`): no error text, log row or thrown message
  may contain that URL. Add a test that fails if it does.
- Text is escaped for the chosen `parse_mode` (HTML is simpler than MarkdownV2) and truncated to fit.
- Errors map to `ConnectorError` kinds: 401 → `auth`; 400 "chat not found" → `validation`; 403 (bot
  removed from the group) → `permission`; 429 → `rate-limit`; timeout after sending → `uncertain`.
- Same registration, export, no-op and test requirements as the Discord issue; ticket text honours
  `ticketLocale` through `ticket-text.ts`.

**Files to touch:** `src/report/connectors/telegram/index.ts` and tests (new),
`src/report/connectors/builtin.ts`, `src/index.ts`, `src/plain/index.ts`, `src/noop/index.ts`,
`src/noop/plain.ts`, README connector table.

---

## 12. Recipe: a ClickUp, Trello, Asana or YouTrack connector

**Labels:** `good first issue`, `documentation`, `connector`

**Context.** Not every tracker should be built into the library. `defineConnector` lets an app add its
own connector through `bugReport.connectorTypes`. A tested recipe per tracker helps teams on those tools
without growing the package. Each of these trackers accepts a pastable personal token and has an
attachment endpoint.

**Proposal.** One recipe per PR in `docs/recipes/connectors/<tracker>.md`: a complete `defineConnector`
snippet that creates the item, uploads the screenshot and the two text files, and maps errors to
`ConnectorError` kinds. Link the tracker's official API pages you used.

**Acceptance criteria**
- Tested against a free account of that tracker; the PR says which plan, which date and what was
  verified (with screenshots of the created item, with no tokens visible).
- Uses `ctx.fetch`, lists every secret in `secretFieldIds`, and never puts a secret in error text.
- Says what the tracker cannot do (for example no idempotency key, so a timeout is `uncertain`).
- Linked from the README section on custom connectors.

**Files to touch:** `docs/recipes/connectors/<tracker>.md` (new), README.

**Files to touch:** `docs/images/*` (new), README.
