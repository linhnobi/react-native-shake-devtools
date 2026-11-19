import { devtoolsStrings, translate } from '../../../i18n/translate';
import type { DevToolsKey, DevToolsLocale, TVars } from '../../../i18n/types';
import type { BugReport, ReportFile } from '../../bug-report';
import { requestJson } from '../http';
import {
  ConnectorError,
  defineConnector,
  type ConnectorContext,
  type ConnectorValues,
  type SendContext,
} from '../types';
import { toSlackBlocks, toSlackText } from './blocks';

/** Giá trị các ô (không bí mật) của Slack. `webhookUrl` và `botToken` đi riêng qua `secrets`. */
export type SlackValues = {
  readonly mode?: string;
  readonly channelId?: string;
};

type Mode = 'webhook' | 'bot';

const API = 'https://slack.com/api/';

/** Mã kênh Slack: `C…` (công khai), `G…` (riêng tư cũ), `D…` (tin nhắn trực tiếp), chữ hoa + số. */
const CHANNEL_ID = /^[CGD][A-Z0-9]{2,}$/;

/** Mã lỗi Slack nằm trong nhóm `auth`. */
const AUTH_CODES: ReadonlySet<string> = new Set([
  'invalid_auth',
  'token_revoked',
  'account_inactive',
  'not_authed',
]);

/** Mã lỗi Slack nằm trong nhóm `permission`. */
const PERMISSION_CODES: ReadonlySet<string> = new Set([
  'not_in_channel',
  'channel_not_found',
  'missing_scope',
]);

/**
 * `conversations.info` trả hai mã này khi bot thiếu quyền đọc kênh (`channels:read`/`groups:read`;
 * kênh riêng còn báo `channel_not_found`) ⇒ bước kiểm thành viên bỏ qua, không phải lỗi (R6).
 */
const MEMBERSHIP_UNREADABLE: ReadonlySet<string> = new Set(['missing_scope', 'channel_not_found']);

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const t = (locale: DevToolsLocale, key: DevToolsKey, vars?: TVars): string =>
  translate(devtoolsStrings[locale], key, vars);

/** Link kết quả chỉ nhận `http(s)` — chuỗi khác (`javascript:`…) bị bỏ, vì màn sẽ hiện nó như link. */
const safeLink = (value: unknown): string | undefined =>
  typeof value === 'string' && /^https?:\/\/\S+$/i.test(value) ? value : undefined;

/** Mọi bí mật của kết nối, để `requestJson` cắt khỏi message lỗi. */
const secretList = (secrets: ConnectorValues): string[] =>
  [str(secrets.webhookUrl), str(secrets.botToken)].filter((s): s is string => s !== undefined);

const missing = (locale: DevToolsLocale, field: string, labelKey: DevToolsKey): ConnectorError =>
  new ConnectorError(
    'validation',
    t(locale, 'connections.slack.fieldMissing', { label: t(locale, labelKey) }),
    { field },
  );

const modeOf = (values: SlackValues, locale: DevToolsLocale): Mode => {
  if (values.mode === 'webhook' || values.mode === 'bot') return values.mode;
  throw new ConnectorError('validation', t(locale, 'connections.slack.modeInvalid'), {
    field: 'mode',
  });
};

/** Webhook URL hợp lệ (https). Message không chứa URL (nó là bí mật). */
const webhookUrlOf = (secrets: ConnectorValues, locale: DevToolsLocale): string => {
  const url = str(secrets.webhookUrl);
  if (url === undefined) throw missing(locale, 'webhookUrl', 'connections.slack.webhookUrl');
  if (!/^https:\/\/[^\s/?#]+\S*$/i.test(url)) {
    throw new ConnectorError('validation', t(locale, 'connections.slack.webhookUrlInvalid'), {
      field: 'webhookUrl',
    });
  }
  return url;
};

/** Token + mã kênh của mức bot; thiếu/sai ⇒ `validation` trên đúng ô, trước mọi request. */
const botOf = (
  values: SlackValues,
  secrets: ConnectorValues,
  locale: DevToolsLocale,
): { token: string; channel: string } => {
  const token = str(secrets.botToken);
  if (token === undefined) throw missing(locale, 'botToken', 'connections.slack.botToken');
  const channel = str(values.channelId);
  if (channel === undefined) throw missing(locale, 'channelId', 'connections.slack.channelId');
  if (!CHANNEL_ID.test(channel)) {
    throw new ConnectorError('validation', t(locale, 'connections.slack.channelIdInvalid'), {
      field: 'channelId',
    });
  }
  return { token, channel };
};

/** 2xx mà thân không phải JSON (Slack trả `ok` / `OK - <length>` dạng chữ): server đã nhận ⇒ thành công. */
const acceptedWithoutJson = (error: unknown): boolean =>
  error instanceof ConnectorError &&
  error.kind === 'unknown' &&
  error.status !== undefined &&
  error.status >= 200 &&
  error.status < 300;

/** Phản hồi của Web API: luôn HTTP 200, thành bại nằm ở `ok`. */
type SlackBody = { ok?: unknown; error?: unknown; needed?: unknown } & Record<string, unknown>;

const errorCode = (body: SlackBody): string =>
  typeof body.error === 'string' && /^[a-z0-9_]{1,64}$/.test(body.error)
    ? body.error
    : 'unknown_error';

/**
 * Đổi `{ ok: false, error }` của Web API thành `ConnectorError` (R: invalid_auth/token_revoked/
 * account_inactive/not_authed ⇒ `auth`; not_in_channel/channel_not_found/missing_scope ⇒
 * `permission`; ratelimited ⇒ `rate-limit`; còn lại `unknown`). Mã lỗi chỉ gồm `[a-z0-9_]` nên an
 * toàn đưa vào message.
 */
const slackError = (body: SlackBody, locale: DevToolsLocale): ConnectorError => {
  const code = errorCode(body);
  if (AUTH_CODES.has(code)) {
    return new ConnectorError('auth', t(locale, 'connections.slack.apiError', { code }));
  }
  if (code === 'not_in_channel') {
    return new ConnectorError('permission', t(locale, 'connections.slack.notInChannel'));
  }
  if (code === 'missing_scope') {
    const needed =
      typeof body.needed === 'string' && /^[\w:.,\- ]{1,100}$/.test(body.needed)
        ? body.needed
        : undefined;
    return new ConnectorError(
      'permission',
      needed === undefined
        ? t(locale, 'connections.slack.missingScopeUnknown')
        : t(locale, 'connections.slack.missingScope', { scope: needed }),
    );
  }
  if (PERMISSION_CODES.has(code)) {
    return new ConnectorError('permission', t(locale, 'connections.slack.apiError', { code }));
  }
  if (code === 'ratelimited') {
    return new ConnectorError('rate-limit', t(locale, 'connections.slack.apiError', { code }));
  }
  return new ConnectorError('unknown', t(locale, 'connections.slack.apiError', { code }));
};

/** Gọi một method Web API; trả phản hồi thô (kể cả `ok: false`). HTTP lỗi ⇒ `errorFromStatus`. */
const rawCall = async (
  ctx: ConnectorContext,
  token: string,
  method: string,
  body: { form: Record<string, string> } | { json: unknown },
  secrets: ConnectorValues,
): Promise<SlackBody> => {
  const form = 'form' in body;
  const { json } = await requestJson<unknown>(
    ctx,
    `${API}${method}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': form
          ? 'application/x-www-form-urlencoded'
          : 'application/json; charset=utf-8',
      },
      // `URLSearchParams` của RN không đầy đủ ⇒ tự ghép form.
      body: form
        ? Object.entries(body.form)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&')
        : JSON.stringify(body.json),
    },
    { secrets: secretList(secrets) },
  );
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new ConnectorError('unknown', 'The Slack response is not a JSON object');
  }
  return json as SlackBody;
};

/** Gọi một method Web API; `ok` khác `true` ⇒ ném `slackError`. */
const call = async (
  ctx: ConnectorContext,
  token: string,
  method: string,
  body: { form: Record<string, string> } | { json: unknown },
  secrets: ConnectorValues,
): Promise<SlackBody> => {
  const result = await rawCall(ctx, token, method, body, secrets);
  if (result.ok !== true) throw slackError(result, ctx.locale);
  return result;
};

/**
 * Byte của một file đính kèm; không dựng/đọc được (file cache đã bị xoá…) hoặc rỗng ⇒ ném. Phần
 * chuỗi (app không cấp `writeTempFile`) ⇒ `Blob` dựng tại chỗ — Slack gửi nó làm **cả** thân
 * request, đường RN gửi được (khác với Blob nằm trong `FormData`).
 */
const readBlob = async (file: ReportFile, ctx: SendContext): Promise<Blob> => {
  const part = await ctx.uploadPart(file);
  if ('string' in part) {
    if (part.string === '') throw new Error('empty file');
    // `BlobOptions` (kiểu toàn cục của RN) bắt buộc `lastModified`, và `BlobManager` của RN lưu nó
    // vào blob. `BlobPropertyBag` của DOM không có trường đó: viết thẳng trong object literal thì
    // tsc của app có lib "DOM" (Expo) báo thừa thuộc tính. Qua một biến thì không còn kiểm thuộc
    // tính thừa ⇒ hợp cả hai bộ kiểu, giá trị gửi xuống RN y như cũ (`tsconfig.dom.json`).
    const options = { type: part.type, lastModified: Date.now() };
    return new Blob([part.string], options);
  }
  const response = await ctx.fetch(part.uri);
  if (response.status >= 400) throw new Error('file not readable');
  const blob = await response.blob();
  if (blob.size === 0) throw new Error('empty file');
  return blob;
};

/** Bước 1 + 2 của luồng upload ngoài: xin `upload_url`, POST byte. Trả `file_id`. */
const uploadFile = async (
  ctx: SendContext,
  token: string,
  name: string,
  blob: Blob,
  secrets: ConnectorValues,
): Promise<string> => {
  const slot = await call(
    ctx,
    token,
    'files.getUploadURLExternal',
    { form: { filename: name, length: String(blob.size) } },
    secrets,
  );
  const fileId = str(slot.file_id);
  const uploadUrl = str(slot.upload_url);
  if (fileId === undefined || uploadUrl === undefined || !/^https:\/\//i.test(uploadUrl)) {
    throw new ConnectorError('unknown', 'Slack did not return a usable upload URL');
  }
  try {
    // `upload_url` đã ký sẵn: không gửi token của bot tới đó.
    await requestJson<unknown>(
      ctx,
      uploadUrl,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob },
      { secrets: secretList(secrets) },
    );
  } catch (error) {
    if (!acceptedWithoutJson(error)) throw error;
  }
  return fileId;
};

/** Tiến độ đã checkpoint (`fileIds` + `fileTitles` cùng độ dài); hỏng/thiếu ⇒ `undefined`. */
const readResume = (
  resume: SendContext['resume'],
): { ids: string[]; titles: string[]; skipped: string[] } | undefined => {
  const strings = (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : undefined;
  const ids = strings(resume?.fileIds);
  const titles = strings(resume?.fileTitles);
  if (!ids || !titles || ids.length === 0 || ids.length !== titles.length) return undefined;
  return { ids, titles, skipped: strings(resume?.skippedFiles) ?? [] };
};

const sendWebhook = async (
  report: BugReport,
  secrets: ConnectorValues,
  ctx: SendContext,
): Promise<{ url?: string; skippedFiles?: string[] }> => {
  const url = webhookUrlOf(secrets, ctx.locale);
  const blocks = toSlackBlocks(report, ctx.locale);
  // Mức nhẹ không đính được file (giới hạn của Slack): báo ngay trong tin.
  if (report.files.length > 0) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: t(ctx.locale, 'report.ticket.attachmentsNote'),
        },
      ],
    });
  }
  try {
    await requestJson<unknown>(
      ctx,
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ text: toSlackText(report), blocks }),
      },
      { secrets: secretList(secrets) },
    );
  } catch (error) {
    if (acceptedWithoutJson(error)) return {};
    // Webhook bị thu hồi/xoá: 404 hoặc `no_service`; token trong URL sai: `invalid_token`.
    if (
      error instanceof ConnectorError &&
      (error.status === 404 || /no_service|invalid_token/.test(error.message))
    ) {
      throw new ConnectorError('auth', error.message, { status: error.status });
    }
    throw error;
  }
  return {};
};

const sendBot = async (
  report: BugReport,
  values: SlackValues,
  secrets: ConnectorValues,
  ctx: SendContext,
): Promise<{ url?: string; skippedFiles?: string[] }> => {
  const { token, channel } = botOf(values, secrets, ctx.locale);
  const blocks = toSlackBlocks(report, ctx.locale);

  let ids: string[] = [];
  let titles: string[] = [];
  let skipped: string[] = [];
  const resumed = readResume(ctx.resume);
  if (resumed) {
    ({ ids, titles, skipped } = resumed);
  } else {
    for (const file of report.files) {
      let blob: Blob;
      try {
        blob = await readBlob(file, ctx);
      } catch {
        skipped.push(file.name);
        continue;
      }
      ids.push(await uploadFile(ctx, token, file.name, blob, secrets));
      titles.push(file.name);
    }
    // Từ đây lần gửi lại không phải upload lại; `completeUploadExternal` là bước chia sẻ không đảo ngược.
    if (ids.length > 0) {
      ctx.checkpoint({ fileIds: ids, fileTitles: titles, skippedFiles: skipped });
    }
  }
  const skippedPart = skipped.length > 0 ? { skippedFiles: skipped } : {};

  // Không có file nào để đính (QA bỏ chọn, hoặc file cache đã bị xoá hết): đăng tin thường — cần chat:write.
  if (ids.length === 0) {
    await call(
      ctx,
      token,
      'chat.postMessage',
      { json: { channel, text: toSlackText(report), blocks } },
      secrets,
    );
    return skippedPart;
  }

  const done = await call(
    ctx,
    token,
    'files.completeUploadExternal',
    {
      json: {
        files: ids.map((id, i) => ({ id, title: titles[i] })),
        channel_id: channel,
        blocks,
      },
    },
    secrets,
  );
  const first = Array.isArray(done.files) ? (done.files[0] as { permalink?: unknown }) : undefined;
  const link = safeLink(first?.permalink);
  return { ...(link !== undefined ? { url: link } : {}), ...skippedPart };
};

/**
 * **Chức năng:** loại kết nối **Slack** (spec 5.4, 5.4.1) với hai mức chọn ở ô `mode`:
 *
 * - `webhook` (mức nhẹ): POST JSON `{ text, blocks }` tới incoming webhook; **không có ảnh/file**
 *   (giới hạn của Slack) ⇒ có file đính kèm thì cuối tin có ghi chú. 2xx là thành công (Slack trả
 *   chữ `ok`). 404/`no_service`/`invalid_token` ⇒ `auth`.
 * - `bot` (mức đầy đủ): bot token `xoxb-` + mã kênh. `files.upload` đã bị khai tử (12/11/2025) nên
 *   dùng luồng ngoài: (1) `files.getUploadURLExternal` (form `filename`, `length`) cho từng file, (2)
 *   POST byte tới `upload_url`, (3) **một** `files.completeUploadExternal` với `files`, `channel_id`,
 *   `blocks` ⇒ bug là một tin nhắn duy nhất. Sau bước 2 gọi `ctx.checkpoint({ fileIds, … })` để lần
 *   gửi lại (`ctx.resume`) bỏ qua upload. File không đọc được (cache bị xoá) ⇒ `skippedFiles`. Không
 *   có file nào ⇒ `chat.postMessage` (cần thêm quyền `chat:write`). Quyền: `files:write` (+
 *   `chat:write`); bot phải ở trong kênh (`not_in_channel` ⇒ `permission`, câu báo nhắc mời bot).
 *   Link kết quả là `permalink` Slack trả về trong `completeUploadExternal`, không có thì bỏ `url`
 *   (không gọi API phụ cần thêm quyền). `upload_url` không nhận token của bot.
 *
 * Web API luôn trả HTTP 200 kèm `{ ok: false, error }`: `invalid_auth`/`token_revoked`/
 * `account_inactive`/`not_authed` ⇒ `auth`; `not_in_channel`/`channel_not_found`/`missing_scope` ⇒
 * `permission`; `ratelimited` (hoặc HTTP 429) ⇒ `rate-limit`; còn lại `unknown`.
 *
 * - `test`: `webhook` chỉ kiểm URL (không gọi mạng — gọi webhook là đăng tin thật). `bot` gọi
 *   `auth.test` (`account` = tên team) rồi `conversations.info`: `is_member: false` ⇒ `permission`;
 *   thiếu quyền đọc kênh (`missing_scope`/`channel_not_found`) ⇒ bỏ qua, `account` kèm ghi chú
 *   chưa kiểm được.
 * - `longLivedSecret`: `true` ở mức `bot` (spec 5.4.2).
 *
 * **Input:** theo `ConnectorType` · **Output:** theo `ConnectorType`.
 *
 * @example
 * ```ts
 * slackConnector.send(report, { mode: 'bot', channelId: 'C0123ABCD' }, { botToken }, ctx);
 * ```
 *
 * **Unit test:** `index.test.ts` — 4 case khai báo · 8 case `send` webhook · 28 case `send` bot (thứ
 * tự upload → checkpoint → complete · upload_url không token · link vắng/không an toàn · file bị
 * xoá · `uploadPart` ném · không có file · mọi file bị bỏ · resume · resume hỏng · not_in_channel ·
 * 10 mã lỗi · missing_scope nêu quyền · 429 · upload 500 · upload_url hỏng · rò token · validation ·
 * mode lạ) · 11 case `test`.
 */
export const slackConnector = defineConnector<SlackValues & ConnectorValues>({
  id: 'slack',
  label: (locale) => t(locale, 'connections.slack.label'),
  fields: (locale) => [
    {
      id: 'mode',
      label: t(locale, 'connections.slack.mode'),
      kind: 'select',
      required: true,
      help: t(locale, 'connections.slack.modeHelp'),
      options: [
        { id: 'webhook', label: t(locale, 'connections.slack.modeWebhook') },
        { id: 'bot', label: t(locale, 'connections.slack.modeBot') },
      ],
    },
    {
      id: 'webhookUrl',
      label: t(locale, 'connections.slack.webhookUrl'),
      kind: 'secret',
      required: true,
      help: t(locale, 'connections.slack.webhookUrlHelp'),
      placeholder: 'https://hooks.slack.com/services/…',
      visibleWhen: { field: 'mode', equals: 'webhook' },
    },
    {
      id: 'botToken',
      label: t(locale, 'connections.slack.botToken'),
      kind: 'secret',
      required: true,
      help: t(locale, 'connections.slack.botTokenHelp'),
      placeholder: 'xoxb-',
      visibleWhen: { field: 'mode', equals: 'bot' },
    },
    {
      id: 'channelId',
      label: t(locale, 'connections.slack.channelId'),
      kind: 'text',
      required: true,
      help: t(locale, 'connections.slack.channelIdHelp'),
      placeholder: 'C0123ABCD',
      visibleWhen: { field: 'mode', equals: 'bot' },
    },
  ],
  secretFieldIds: ['webhookUrl', 'botToken'],
  capabilities: (values) =>
    values.mode === 'bot' ? { image: true, files: true } : { image: false, files: false },
  longLivedSecret: (values) => values.mode === 'bot',

  test: async (values, secrets, ctx) => {
    if (modeOf(values, ctx.locale) === 'webhook') {
      webhookUrlOf(secrets, ctx.locale);
      return {};
    }
    const { token, channel } = botOf(values, secrets, ctx.locale);
    const auth = await call(ctx, token, 'auth.test', { form: {} }, secrets);
    const team = str(auth.team);

    const info = await rawCall(ctx, token, 'conversations.info', { form: { channel } }, secrets);
    if (info.ok !== true) {
      if (!MEMBERSHIP_UNREADABLE.has(errorCode(info))) throw slackError(info, ctx.locale);
      // Không có quyền đọc kênh ⇒ không kiểm được thành viên; việc đó sẽ lộ ra lúc gửi (R6).
      return {
        account: t(ctx.locale, 'connections.slack.membershipUnverified', { team: team ?? 'Slack' }),
      };
    }
    const member = (info.channel as { is_member?: unknown } | undefined)?.is_member;
    if (member === false) {
      throw new ConnectorError('permission', t(ctx.locale, 'connections.slack.notInChannel'));
    }
    return team !== undefined ? { account: team } : {};
  },

  send: async (report, values, secrets, ctx) =>
    modeOf(values, ctx.locale) === 'webhook'
      ? sendWebhook(report, secrets, ctx)
      : sendBot(report, values, secrets, ctx),
});
