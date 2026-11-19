import { REDACTED } from '../../../capture/redact';
import { devtoolsStrings, translate } from '../../../i18n/translate';
import type { DevToolsKey, DevToolsLocale, TVars } from '../../../i18n/types';
import type { BugReport, ReportFile } from '../../bug-report';
import { requestJson } from '../http';
import {
  ConnectorError,
  defineConnector,
  type ConnectorContext,
  type ConnectorErrorKind,
  type ConnectorValues,
  type SendContext,
} from '../types';
import { LARK_APP_CARD_MAX_BYTES, toLarkCard } from './card';
import { larkSign } from './sign';

/**
 * Giá trị các ô (không bí mật) của kết nối Lark/Feishu. Bí mật đi riêng qua `secrets`:
 * `webhookUrl` (URL mang token), `signSecret`, `appSecret`.
 */
export type LarkValues = {
  readonly domain?: string;
  readonly mode?: string;
  readonly appId?: string;
  readonly chatId?: string;
};

/** Hai miền riêng của Lark quốc tế và Feishu (spec 5.4.1) — host của API và của webhook. */
const DOMAINS: Readonly<Record<string, string>> = {
  lark: 'open.larksuite.com',
  feishu: 'open.feishu.cn',
};

/** Webhook của bot nhóm: đúng host của nền tảng, đúng đường dẫn, token chỉ gồm chữ/số/`-`/`_`. */
const WEBHOOK_PATH = /^https:\/\/([^/?#]+)\/open-apis\/bot\/v2\/hook\/([A-Za-z0-9_-]+)$/;

/** Mã nhóm dạng `oc_…`. Chặn ký tự lạ vì mã được ghép vào đường dẫn của request. */
const CHAT_ID = /^oc_[A-Za-z0-9_-]+$/;

/**
 * Số lần một **file trên đĩa** hỏng mạng khi upload được ghi nhận trước khi bỏ nó. RN báo file `uri`
 * đã bị hệ điều hành xoá y hệt mất mạng (`Network request failed`) nên không kết luận "mất file" ở
 * lần đầu — lần 3 mà vẫn hỏng thì bỏ vào `skippedFiles` để không lặp vô hạn (hàng đợi chỉ thử tối đa
 * 5 lần).
 */
const MAX_UPLOAD_FAILS = 2;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const t = (locale: DevToolsLocale, key: DevToolsKey, vars?: TVars): string =>
  translate(devtoolsStrings[locale], key, vars);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Xoá bí mật (≥ 4 ký tự, như `http.ts`) khỏi `text`. */
const scrubSecrets = (text: string, secrets: readonly string[]): string =>
  [...secrets]
    .filter((s) => s.length >= 4)
    .sort((a, b) => b.length - a.length)
    .reduce((acc, secret) => acc.split(secret).join(REDACTED), text);

/**
 * Lỗi do **mã lỗi của Lark** (`code` trong thân JSON). Mang `larkCode` để chỗ gọi phân biệt các
 * trường hợp cùng nhóm `permission` (bot không ở trong nhóm ≠ app thiếu quyền đọc).
 */
class LarkApiError extends ConnectorError {
  readonly larkCode: number;
  constructor(
    larkCode: number,
    kind: ConnectorErrorKind,
    message: string,
    opts?: { field?: string; retryAfterMs?: number; status?: number },
  ) {
    super(kind, message, opts);
    this.larkCode = larkCode;
  }
}

interface CodeRule {
  readonly kind: ConnectorErrorKind;
  /** Câu hướng dẫn theo ngôn ngữ; vắng ⇒ dùng thông điệp gốc của Lark (đã xoá bí mật). */
  readonly key?: DevToolsKey;
  readonly field?: string;
}

/**
 * Bảng ánh xạ mã lỗi Lark ⇒ nhóm lỗi. Lark trả HTTP 200 (webhook) hoặc 400/401 (API) kèm
 * `{ code, msg }`, nên **mã trong thân** mới là nguồn sự thật, không phải status.
 *
 * Nguồn đã đối chiếu ngày 6/11/2026 (open.larksuite.com/document):
 * - `client-docs/bot-v3/add-custom-bot` (bảng mã của bot nhóm): 19021 chữ ký sai hoặc timestamp lệch
 *   quá 1 giờ · 19022 IP không được phép · 19024 thiếu từ khoá · 9499 `Bad Request` (thân sai
 *   định dạng) · 11232 bị giới hạn tần suất do áp lực hệ thống.
 * - `server-docs/im-v1/message/create` (bảng mã gửi tin): 230001 tham số sai · 230002 bot không ở
 *   trong nhóm · 230006 chưa bật bot · 230013 · 230020 giới hạn tần suất · 230025 nội dung quá dài ·
 *   230027 thiếu quyền · 230034 `receive_id` sai · 230035 không có quyền gửi · 232009 nhóm đã giải tán.
 * - `server-docs/im-v1/image/create` và `…/file/create`: 234001 tham số sai · 234002 xác thực hỏng ·
 *   234006 file quá lớn (ảnh 10 MB, file 30 MB) · 234007 app chưa bật bot · 234010 file rỗng · 234011
 *   ảnh sai định dạng · 234039 ảnh quá độ phân giải.
 * - **Chưa đối chiếu được trong phiên này** (trang `generic-error-code` và bảng lỗi của
 *   `tenant_access_token` không đọc được; đây là mã thường gặp ở các SDK chính thức của Lark): 99991661,
 *   99991663, 99991668, 99991671 token thiếu/sai/hết hạn · 99991672 app thiếu scope · 99991400 giới
 *   hạn tần suất chung · 10003, 10013, 10014 App ID/App Secret sai ở bước lấy token · 232011 bot không ở
 *   trong nhóm khi đọc thông tin nhóm. Mã nào ngoài bảng ⇒ `unknown` kèm thông điệp gốc.
 */
const CODE_RULES: Readonly<Record<number, CodeRule>> = {
  // Bot nhóm (webhook).
  19021: { kind: 'auth', key: 'connections.lark.errSign' },
  19022: { kind: 'permission', key: 'connections.lark.errIp' },
  19024: { kind: 'permission', key: 'connections.lark.errKeyword' },
  9499: { kind: 'validation' },
  11232: { kind: 'rate-limit', key: 'connections.lark.errRate' },
  // Gửi tin.
  230001: { kind: 'validation' },
  230002: { kind: 'permission', key: 'connections.lark.errBotNotInChat' },
  230006: { kind: 'permission', key: 'connections.lark.errNoPermission' },
  230013: { kind: 'permission', key: 'connections.lark.errNoPermission' },
  230020: { kind: 'rate-limit', key: 'connections.lark.errRate' },
  230025: { kind: 'validation' },
  230027: { kind: 'permission', key: 'connections.lark.errNoPermission' },
  230034: { kind: 'validation', field: 'chatId' },
  230035: { kind: 'permission', key: 'connections.lark.errNoPermission' },
  232009: { kind: 'validation', field: 'chatId' },
  232011: { kind: 'permission', key: 'connections.lark.errBotNotInChat' },
  // Upload ảnh/file.
  234001: { kind: 'validation' },
  234002: { kind: 'auth', key: 'connections.lark.errCredentials' },
  234006: { kind: 'validation' },
  234007: { kind: 'permission', key: 'connections.lark.errNoPermission' },
  234010: { kind: 'validation' },
  234011: { kind: 'validation' },
  234039: { kind: 'validation' },
  // Token và quyền (xem "chưa đối chiếu" ở trên).
  99991661: { kind: 'auth', key: 'connections.lark.errCredentials' },
  99991663: { kind: 'auth', key: 'connections.lark.errCredentials' },
  99991668: { kind: 'auth', key: 'connections.lark.errCredentials' },
  99991671: { kind: 'auth', key: 'connections.lark.errCredentials' },
  99991672: { kind: 'permission', key: 'connections.lark.errNoPermission' },
  99991400: { kind: 'rate-limit', key: 'connections.lark.errRate' },
  10003: { kind: 'auth', key: 'connections.lark.errCredentials' },
  10013: { kind: 'auth', key: 'connections.lark.errCredentials' },
  10014: { kind: 'auth', key: 'connections.lark.errCredentials' },
};

/** Mã Lark từ chối **chính file** vừa upload (quá lớn, rỗng, sai định dạng/độ phân giải) ⇒ bỏ file. */
const FILE_REFUSED: ReadonlySet<number> = new Set([234006, 234010, 234011, 234039]);

/** Mã "bot không ở trong nhóm" — khác với "app thiếu quyền đọc thông tin nhóm". */
const NOT_IN_CHAT: ReadonlySet<number> = new Set([230002, 232011]);

/** Đổi mã lỗi Lark thành `LarkApiError`. `detail` là thông điệp gốc **đã** xoá bí mật. */
const larkError = (
  code: number,
  detail: string,
  locale: DevToolsLocale,
  extra?: { retryAfterMs?: number; status?: number },
): LarkApiError => {
  const rule = CODE_RULES[code];
  if (rule === undefined) return new LarkApiError(code, 'unknown', detail, extra);
  const message =
    rule.key !== undefined ? `${t(locale, rule.key)} (Lark code ${code})` : detail;
  return new LarkApiError(code, rule.kind, message, { ...extra, field: rule.field });
};

/**
 * Gọi một endpoint của Lark rồi đọc `{ code, msg }`. `code === 0` ⇒ trả JSON. Mã khác 0 ⇒ ném
 * `larkError` — dù Lark trả 200 (bot nhóm) hay 4xx (API: `requestJson` ném `errorFromStatus`, ta đọc
 * `code` từ đoạn trích thân trong message đó; không có `code` ⇒ ném nguyên lỗi HTTP). Mọi `secrets`
 * được xoá khỏi message.
 */
const call = async (
  ctx: ConnectorContext,
  url: string,
  init: RequestInit,
  secrets: readonly string[],
): Promise<Record<string, unknown>> => {
  let json: unknown;
  try {
    ({ json } = await requestJson<unknown>(ctx, url, init, { secrets }));
  } catch (error) {
    const fromBody =
      error instanceof ConnectorError && error.status !== undefined
        ? /"code"\s*:\s*(\d+)/.exec(error.message)
        : null;
    if (!(error instanceof ConnectorError) || fromBody === null) throw error;
    // Mã chưa có trong bảng ⇒ giữ nguyên phân loại của HTTP (429 ⇒ rate-limit kèm `retryAfterMs`,
    // 401 ⇒ auth…): hàng đợi tự gửi lại rate-limit, còn `unknown` thì dừng hẳn. Chỉ 2xx kèm mã lạ
    // (không có phân loại HTTP nào để giữ) mới thành `unknown`.
    if (CODE_RULES[Number(fromBody[1])] === undefined) throw error;
    throw larkError(Number(fromBody[1]), error.message, ctx.locale, {
      status: error.status,
      retryAfterMs: error.retryAfterMs,
    });
  }

  if (isRecord(json)) {
    if (typeof json.code === 'number') {
      if (json.code === 0) return json;
      const msg = typeof json.msg === 'string' ? json.msg : '';
      throw larkError(
        json.code,
        `Lark code ${json.code}${msg ? `: ${scrubSecrets(msg, secrets)}` : ''}`,
        ctx.locale,
      );
    }
    // Phản hồi kiểu cũ của bot nhóm: { StatusCode: 0, StatusMessage }.
    if (json.StatusCode === 0) return json;
  }
  throw new ConnectorError('unknown', 'Unexpected response from Lark');
};

const missing = (locale: DevToolsLocale, field: string, labelKey: DevToolsKey): ConnectorError =>
  new ConnectorError(
    'validation',
    t(locale, 'connections.lark.fieldMissing', { label: t(locale, labelKey) }),
    { field },
  );

/** Nền tảng và cách kết nối; thiếu/sai ⇒ `validation` trên đúng ô, trước mọi request. */
const target = (
  values: LarkValues,
  locale: DevToolsLocale,
): { host: string; base: string; mode: 'webhook' | 'app' } => {
  const domain = str(values.domain);
  if (domain === undefined || DOMAINS[domain] === undefined) {
    throw missing(locale, 'domain', 'connections.lark.domain');
  }
  const mode = str(values.mode);
  if (mode !== 'webhook' && mode !== 'app') {
    throw missing(locale, 'mode', 'connections.lark.mode');
  }
  return { host: DOMAINS[domain], base: `https://${DOMAINS[domain]}`, mode };
};

/**
 * Webhook của bot nhóm: phải đúng host của nền tảng đã chọn — không bao giờ gửi tới host lạ, vì URL
 * chính là khoá. Trả URL và phần token (cả hai là bí mật cần xoá khỏi lỗi). Message lỗi không chứa URL.
 */
const webhookOf = (
  secrets: ConnectorValues,
  host: string,
  locale: DevToolsLocale,
): { url: string; token: string } => {
  const url = str(secrets.webhookUrl);
  if (url === undefined) throw missing(locale, 'webhookUrl', 'connections.lark.webhookUrl');
  const match = WEBHOOK_PATH.exec(url);
  if (match === null || match[1].toLowerCase() !== host) {
    throw new ConnectorError('validation', t(locale, 'connections.lark.webhookInvalid'), {
      field: 'webhookUrl',
    });
  }
  return { url, token: match[2] };
};

/** `appId`, `appSecret`, `chatId` của mức app. */
const appOf = (
  values: LarkValues,
  secrets: ConnectorValues,
  locale: DevToolsLocale,
): { appId: string; appSecret: string; chatId: string } => {
  const appId = str(values.appId);
  if (appId === undefined) throw missing(locale, 'appId', 'connections.lark.appId');
  const appSecret = str(secrets.appSecret);
  if (appSecret === undefined) throw missing(locale, 'appSecret', 'connections.lark.appSecret');
  const chatId = str(values.chatId);
  if (chatId === undefined) throw missing(locale, 'chatId', 'connections.lark.chatId');
  if (!CHAT_ID.test(chatId)) {
    throw new ConnectorError('validation', t(locale, 'connections.lark.chatIdInvalid'), {
      field: 'chatId',
    });
  }
  return { appId, appSecret, chatId };
};

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

/**
 * `POST /open-apis/auth/v3/tenant_access_token/internal` — token sống tối đa 2 giờ, lấy mới mỗi lần
 * gửi/thử (một lần gửi diễn ra trong vài chục giây). Feishu dùng đúng endpoint cũ này có chủ đích
 * (spec 5.4.2); nếu Feishu tắt nó thì khách dùng Webhook/relay.
 */
const fetchToken = async (
  ctx: ConnectorContext,
  base: string,
  appId: string,
  appSecret: string,
): Promise<string> => {
  const json = await call(
    ctx,
    `${base}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
    [appSecret],
  );
  const token = str(json.tenant_access_token);
  if (token === undefined) {
    throw new ConnectorError('unknown', 'Lark did not return a tenant access token');
  }
  return token;
};

/** Tiến độ gửi bằng app, lưu qua `ctx.checkpoint` để gửi lại không upload/gửi lại phần đã xong. */
interface AppState {
  imageKey?: string;
  readonly fileKeys: Record<string, string>;
  /** Số lần mỗi **file trên đĩa** hỏng mạng khi upload (xem `MAX_UPLOAD_FAILS`). */
  readonly uploadFails: Record<string, number>;
  /** File đã quyết định bỏ (mất file, Lark từ chối). */
  readonly skipped: string[];
  cardSent: boolean;
  messageId?: string;
  /** Tên các file đã gửi thành tin riêng. */
  readonly filesSent: string[];
}

const stringRecord = (value: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) if (typeof v === 'string') out[k] = v;
  }
  return out;
};

const numberRecord = (value: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) if (typeof v === 'number') out[k] = v;
  }
  return out;
};

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

const readState = (resume: Readonly<Record<string, unknown>> | undefined): AppState => ({
  imageKey: str(resume?.imageKey),
  fileKeys: stringRecord(resume?.fileKeys),
  uploadFails: numberRecord(resume?.uploadFails),
  skipped: stringList(resume?.skipped),
  cardSent: resume?.cardSent === true,
  messageId: str(resume?.messageId),
  filesSent: stringList(resume?.filesSent),
});

/** Trạng thái dạng JSON gọn để checkpoint — luôn là **toàn bộ** tiến độ tích luỹ, không phải phần mới. */
const snapshot = (s: AppState): Record<string, unknown> => ({
  ...(s.imageKey !== undefined ? { imageKey: s.imageKey } : {}),
  fileKeys: { ...s.fileKeys },
  ...(Object.keys(s.uploadFails).length > 0 ? { uploadFails: { ...s.uploadFails } } : {}),
  ...(s.skipped.length > 0 ? { skipped: [...s.skipped] } : {}),
  /* Thẻ đã vào nhóm: bước không đảo ngược xong (R34). Upload trước đó thì chưa. */
  ...(s.cardSent ? { cardSent: true, committed: true } : {}),
  ...(s.messageId !== undefined ? { messageId: s.messageId } : {}),
  ...(s.filesSent.length > 0 ? { filesSent: [...s.filesSent] } : {}),
});

/** Gửi một tin vào nhóm; `uuid` là khoá chống trùng của Lark (hiệu lực khoảng 1 giờ, tối đa 50 ký tự). */
const postMessage = async (
  ctx: SendContext,
  base: string,
  headers: Record<string, string>,
  secrets: readonly string[],
  chatId: string,
  msg: { type: 'interactive' | 'file'; content: unknown; uuid: string },
): Promise<string | undefined> => {
  const json = await call(
    ctx,
    `${base}/open-apis/im/v1/messages?receive_id_type=chat_id`,
    {
      method: 'POST',
      headers: { ...headers, ...JSON_HEADERS },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: msg.type,
        content: JSON.stringify(msg.content),
        uuid: msg.uuid,
      }),
    },
    secrets,
  );
  return isRecord(json.data) ? str(json.data.message_id) : undefined;
};

/** Gửi bằng app tự dựng (mức đầy đủ): upload ảnh + file, gửi thẻ, rồi từng file một tin. */
const sendWithApp = async (
  report: BugReport,
  values: LarkValues,
  secrets: ConnectorValues,
  ctx: SendContext,
  base: string,
): Promise<{ skippedFiles?: string[] }> => {
  const { appId, appSecret, chatId } = appOf(values, secrets, ctx.locale);
  const token = await fetchToken(ctx, base, appId, appSecret);
  const secretList = [appSecret, token];
  const auth = { Authorization: `Bearer ${token}` };

  const state = readState(ctx.resume);
  const save = () => ctx.checkpoint(snapshot(state));
  const skip = (name: string) => {
    if (!state.skipped.includes(name)) state.skipped.push(name);
    save();
  };

  /**
   * Upload một ảnh/file ⇒ khoá của Lark, hoặc `undefined` nếu bỏ file:
   * - `uploadPart` ném (đọc file trên đĩa hỏng): thử **một lần nữa ngay**; lại ném ⇒ bỏ file.
   * - Lark từ chối chính file (`FILE_REFUSED`) ⇒ bỏ file.
   * - **Không có phản hồi** (mạng): ném để hàng đợi gửi lại — RN báo file `uri` đã bị xoá y như mất
   *   mạng nên không kết luận "mất file" ở lần đầu. Với file trên đĩa, lần hỏng được ghi vào
   *   checkpoint; sau `MAX_UPLOAD_FAILS` lần ghi nhận mà lần kế vẫn hỏng ⇒ bỏ file (⚠️ mạng chập chờn
   *   đúng ba lần liền thì ảnh bị bỏ oan — đổi lại không bao giờ lặp vô hạn).
   * - Lỗi khác (auth, quyền, tần suất, 5xx, `uncertain`) ⇒ ném.
   */
  const upload = async (file: ReportFile, kind: 'image' | 'file'): Promise<string | undefined> => {
    let uploadPart;
    try {
      uploadPart = await ctx.uploadPart(file);
    } catch {
      try {
        uploadPart = await ctx.uploadPart(file);
      } catch {
        skip(file.name);
        return undefined;
      }
    }

    const form = new FormData();
    // Kiểu `append` của RN chỉ khai giá trị Blob/chuỗi; thực tế nhận `{ uri | string, name, type }`.
    const append = form.append.bind(form) as (name: string, value: unknown) => void;
    if (kind === 'image') append('image_type', 'message');
    else {
      append('file_type', 'stream');
      append('file_name', file.name);
    }
    append(kind === 'image' ? 'image' : 'file', uploadPart);

    try {
      const json = await call(
        ctx,
        `${base}/open-apis/im/v1/${kind === 'image' ? 'images' : 'files'}`,
        { method: 'POST', headers: auth, body: form },
        secretList,
      );
      const key = isRecord(json.data)
        ? str(kind === 'image' ? json.data.image_key : json.data.file_key)
        : undefined;
      if (key === undefined) throw new ConnectorError('unknown', 'Lark did not return a file key');
      return key;
    } catch (error) {
      if (error instanceof LarkApiError && FILE_REFUSED.has(error.larkCode)) {
        skip(file.name);
        return undefined;
      }
      if (error instanceof ConnectorError && error.kind === 'network' && file.uri !== undefined) {
        const fails = state.uploadFails[file.name] ?? 0;
        if (fails >= MAX_UPLOAD_FAILS) {
          skip(file.name);
          return undefined;
        }
        state.uploadFails[file.name] = fails + 1;
        save();
      }
      throw error;
    }
  };

  const imageFile = report.files.find((f) => f.mimeType.startsWith('image/'));
  if (
    imageFile !== undefined &&
    state.imageKey === undefined &&
    !state.skipped.includes(imageFile.name)
  ) {
    const key = await upload(imageFile, 'image');
    if (key !== undefined) {
      state.imageKey = key;
      save();
    }
  }

  const attachments = report.files
    .map((file, index) => ({ file, n: index + 1 }))
    .filter(({ file }) => file !== imageFile);
  for (const { file } of attachments) {
    if (state.fileKeys[file.name] !== undefined || state.skipped.includes(file.name)) continue;
    const key = await upload(file, 'file');
    if (key !== undefined) {
      state.fileKeys[file.name] = key;
      save();
    }
  }

  if (!state.cardSent) {
    const card = toLarkCard(report, ctx.locale, {
      imageKey: state.imageKey,
      maxBytes: LARK_APP_CARD_MAX_BYTES,
    });
    state.messageId = await postMessage(ctx, base, auth, secretList, chatId, {
      type: 'interactive',
      content: card,
      uuid: report.id,
    });
    state.cardSent = true;
    save();
  }

  for (const { file, n } of attachments) {
    const fileKey = state.fileKeys[file.name];
    if (fileKey === undefined || state.filesSent.includes(file.name)) continue;
    await postMessage(ctx, base, auth, secretList, chatId, {
      type: 'file',
      content: { file_key: fileKey },
      uuid: `${report.id}-f${n}`,
    });
    state.filesSent.push(file.name);
    save();
  }

  /* Id tin nhắn (`om_…`) không có nghĩa gì với QA — không phải mã ticket ⇒ màn kết quả ghi "Đã gửi". */
  return state.skipped.length > 0 ? { skippedFiles: [...state.skipped] } : {};
};

/**
 * **Chức năng:** loại kết nối **Lark / Feishu** (spec 5.4, 5.4.1, 5.4.2), hai mức:
 *
 * - **Nhẹ — webhook bot nhóm** (`mode: 'webhook'`): POST `{ msg_type: 'interactive', card }` tới URL
 *   của bot. Không có ảnh/file (bot nhóm không có kiểu `file`, kiểu `image` cần `image_key` mà chỉ app
 *   lấy được) nên thẻ ghi câu "file không gửi được qua kênh này". Có khoá ký ⇒ kèm `timestamp` (giây)
 *   và `sign` (`larkSign`). Thân ≤ 20 KB: thẻ được cắt (`toLarkCard`) có chừa chỗ cho phần bao.
 * - **Đầy đủ — app tự dựng** (`mode: 'app'`): lấy `tenant_access_token`, upload ảnh (`im/v1/images`,
 *   `image_type=message`) và file (`im/v1/files`, `file_type=stream`), gửi thẻ có ảnh bằng
 *   `im/v1/messages?receive_id_type=chat_id` với `uuid = report.id`, rồi **mỗi file một tin** `file`
 *   với `uuid = <report.id>-f<n>`.
 *
 * Ô: `domain` (`lark` ⇒ `open.larksuite.com`, `feishu` ⇒ `open.feishu.cn`; hai miền riêng), `mode`,
 * `webhookUrl` + `signSecret` (bí mật, hiện khi `mode = webhook`), `appId` + `appSecret` (bí mật) +
 * `chatId` (hiện khi `mode = app`). `longLivedSecret` ⇒ `true` ở mức app (cảnh báo spec 5.4.2).
 *
 * - `test`: webhook ⇒ chỉ kiểm giá trị, **không gọi mạng** (gửi thử sẽ spam nhóm). App ⇒ lấy token rồi
 *   `GET im/v1/chats/<chatId>`; trả tên nhóm làm `account`. Bot không ở trong nhóm ⇒ `permission` dặn
 *   thêm bot. App **không có quyền đọc** thông tin nhóm ⇒ bỏ bước kiểm này, trả `account` kèm ghi chú
 *   (ruling R6); lúc gửi thật mà bot không ở trong nhóm vẫn ra `permission`.
 * - `send` (app) lưu tiến độ **tích luỹ** qua `ctx.checkpoint` — `imageKey`, `fileKeys`, `uploadFails`,
 *   `skipped`, `cardSent` (+ `messageId`), `filesSent` — sau mỗi upload, sau thẻ và sau mỗi tin file. Gửi
 *   lại với `ctx.resume` thì bỏ qua phần đã xong (và `uuid` còn chống trùng ở phía Lark ~1 giờ). File
 *   mất: xem `MAX_UPLOAD_FAILS` và `upload` — không kết luận "mất" ở lần mạng hỏng đầu tiên. Thẻ
 *   gửi xong thì checkpoint mang thêm `committed: true` (bước không đảo ngược, ruling R34); upload
 *   thì không.
 * - Lỗi: Lark trả `{ code, msg }` (HTTP 200 hay 4xx); mã ánh xạ theo `CODE_RULES` (kèm nguồn tài liệu),
 *   mã lạ ⇒ `unknown`. Token, App Secret, webhook URL, khoá ký luôn là `secrets` của `requestJson` nên
 *   không lọt vào message lỗi.
 *
 * **Input:** theo `ConnectorType`. **Output:** `ConnectorTestResult` / `SendResult` — không có `key`
 * (`message_id` của thẻ chỉ nằm trong checkpoint: nó không phải mã ticket, màn kết quả ghi "Đã gửi").
 *
 * @example
 * ```ts
 * await larkConnector.send(report, { domain: 'feishu', mode: 'webhook' }, { webhookUrl, signSecret }, ctx);
 * await larkConnector.send(report, { domain: 'lark', mode: 'app', appId, chatId }, { appSecret }, ctx);
 * ```
 *
 * **Unit test:** `index.test.ts` — 3 case khai báo · 32 case webhook (2 domain · ngôn ngữ + ghi chú file ·
 * không file · không `uploadPart` · chữ ký · thân ≤ 20 KB · `StatusCode` cũ · 6 mã · message 19021 ·
 * HTTP 400 kèm code · code lạ + HTTP 429/401/403/400 giữ nhóm HTTP · HTTP 500 · 2xx rỗng/không code · bí mật · 7 URL sai · thiếu domain/mode · lỗi
 * mạng) · 1 case `test` webhook · mỗi domain (lark, feishu): 23 case `send` app (luồng đầy đủ · checkpoint · resume đủ + resume mới có ảnh ·
 * không file · thân ≤ 30 KB · mạng hỏng ảnh/file · bỏ ảnh lần 3 · `uploadPart` ném 2 lần/1 lần · 234010 ·
 * 230002 · quyền · tần suất · token hết hạn · App Secret sai · bí mật · thiếu token · 4 ô thiếu hoặc sai) và 6 case
 * `test` app (nhóm · 232011 · 99991672 · thiếu name · App Secret sai · thiếu chatId).
 */
export const larkConnector = defineConnector<LarkValues & ConnectorValues>({
  id: 'lark',
  label: (locale) => t(locale, 'connections.lark.label'),
  fields: (locale) => [
    {
      id: 'domain',
      label: t(locale, 'connections.lark.domain'),
      kind: 'select',
      required: true,
      options: [
        { id: 'lark', label: t(locale, 'connections.lark.domainLark') },
        { id: 'feishu', label: t(locale, 'connections.lark.domainFeishu') },
      ],
    },
    {
      id: 'mode',
      label: t(locale, 'connections.lark.mode'),
      kind: 'select',
      required: true,
      options: [
        { id: 'webhook', label: t(locale, 'connections.lark.modeWebhook') },
        { id: 'app', label: t(locale, 'connections.lark.modeApp') },
      ],
    },
    {
      id: 'webhookUrl',
      label: t(locale, 'connections.lark.webhookUrl'),
      kind: 'secret',
      required: true,
      help: t(locale, 'connections.lark.webhookUrlHelp'),
      visibleWhen: { field: 'mode', equals: 'webhook' },
    },
    {
      id: 'signSecret',
      label: t(locale, 'connections.lark.signSecret'),
      kind: 'secret',
      help: t(locale, 'connections.lark.signSecretHelp'),
      visibleWhen: { field: 'mode', equals: 'webhook' },
    },
    {
      id: 'appId',
      label: t(locale, 'connections.lark.appId'),
      kind: 'text',
      required: true,
      placeholder: 'cli_xxxxxxxx',
      visibleWhen: { field: 'mode', equals: 'app' },
    },
    {
      id: 'appSecret',
      label: t(locale, 'connections.lark.appSecret'),
      kind: 'secret',
      required: true,
      help: t(locale, 'connections.lark.appSecretHelp'),
      visibleWhen: { field: 'mode', equals: 'app' },
    },
    {
      id: 'chatId',
      label: t(locale, 'connections.lark.chatId'),
      kind: 'text',
      required: true,
      help: t(locale, 'connections.lark.chatIdHelp'),
      placeholder: 'oc_xxxxxxxx',
      visibleWhen: { field: 'mode', equals: 'app' },
    },
  ],
  secretFieldIds: ['webhookUrl', 'signSecret', 'appSecret'],
  capabilities: (values) => {
    const app = values.mode === 'app';
    return { image: app, files: app };
  },
  longLivedSecret: (values) => values.mode === 'app',

  test: async (values, secrets, ctx) => {
    const { host, base, mode } = target(values, ctx.locale);
    if (mode === 'webhook') {
      webhookOf(secrets, host, ctx.locale);
      return {};
    }

    const { appId, appSecret, chatId } = appOf(values, secrets, ctx.locale);
    const token = await fetchToken(ctx, base, appId, appSecret);
    try {
      const json = await call(
        ctx,
        `${base}/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`,
        { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
        [appSecret, token],
      );
      const name = isRecord(json.data) ? str(json.data.name) : undefined;
      return { account: name ?? chatId };
    } catch (error) {
      // R6: kiểm nhóm là cố gắng hết sức. App thiếu quyền đọc thông tin nhóm ⇒ bỏ qua, kèm ghi chú;
      // bot không ở trong nhóm hoặc lỗi khác ⇒ ném.
      if (
        error instanceof LarkApiError &&
        error.kind === 'permission' &&
        !NOT_IN_CHAT.has(error.larkCode)
      ) {
        return { account: `${appId} · ${t(ctx.locale, 'connections.lark.testNoRead')}` };
      }
      throw error;
    }
  },

  send: async (report, values, secrets, ctx) => {
    const { host, base, mode } = target(values, ctx.locale);
    if (mode === 'app') return sendWithApp(report, values, secrets, ctx, base);

    const { url, token } = webhookOf(secrets, host, ctx.locale);
    const signSecret = str(secrets.signSecret);
    const timestamp = Math.floor(Date.now() / 1000);
    const card = toLarkCard(report, ctx.locale, { attachmentsNote: report.files.length > 0 });
    await call(
      ctx,
      url,
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          ...(signSecret !== undefined
            ? { timestamp: String(timestamp), sign: larkSign(signSecret, timestamp) }
            : {}),
          msg_type: 'interactive',
          card,
        }),
      },
      [url, token, ...(signSecret !== undefined ? [signSecret] : [])],
    );
    return {};
  },
});
