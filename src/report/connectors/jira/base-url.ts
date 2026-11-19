import { devtoolsStrings, translate } from '../../../i18n/translate';
import type { DevToolsKey, DevToolsLocale, TVars } from '../../../i18n/types';
import { base64Utf8 } from '../encoding';
import { requestJson } from '../http';
import { ConnectorError, type ConnectorContext } from '../types';

/**
 * Gốc gateway của Atlassian. **Scoped token** chỉ chạy qua `<gateway>/<cloudId>/rest/api/3/…`; gọi
 * nhầm vào site thì lỗi im lặng (tìm project trả 200 rỗng, tạo issue 401, đọc 404 — spec 5.4.1).
 */
export const JIRA_GATEWAY = 'https://api.atlassian.com/ex/jira';

/** Base URL qua gateway hợp lệ: `<gateway>/<cloudId>` (cloudId là UUID). */
const GATEWAY_BASE = /^https:\/\/api\.atlassian\.com\/ex\/jira\/[A-Za-z0-9-]+$/;

/** `cloudId` nhận từ `tenant_info`: chỉ chữ, số, gạch nối — nó đi thẳng vào đường dẫn URL. */
const CLOUD_ID = /^[A-Za-z0-9-]+$/;

/**
 * Site: `https://` (tuỳ chọn khi QA gõ) + host có ít nhất một dấu chấm, rồi đường dẫn/query bất kỳ
 * (bị bỏ). Không nhận `http` (Basic auth sẽ đi dạng rõ), userinfo hay cổng. Dùng regex vì `URL` của
 * RN không đầy đủ.
 */
const SITE_SHAPE = /^(?:https:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/?#]\S*)?$/i;

/** Status của lần dò mà spec bảo "thử lại qua gateway". */
const TRY_GATEWAY_ON: ReadonlySet<number> = new Set([401, 404]);

/** Thông tin xác thực đã dựng sẵn cho mọi request Jira của một kết nối. */
export interface JiraAuth {
  /** Giá trị header `Authorization`: `Basic <base64Utf8(email:token)>`. */
  readonly header: string;
  /** Bí mật phải cắt khỏi message lỗi: token thô **và** chuỗi base64 của Basic. */
  readonly secrets: readonly string[];
  /** Email đã bỏ khoảng trắng — tên tài khoản dự phòng khi không đọc được `/myself`. */
  readonly email: string;
}

/** Base URL tìm được cho kết nối: site, hoặc gateway kèm `cloudId`. */
export interface JiraBase {
  readonly baseUrl: string;
  readonly cloudId?: string;
}

/** Đọc một khoá của JSON chưa biết hình dạng; không phải đối tượng ⇒ `undefined`. */
export const jsonProp = (json: unknown, key: string): unknown =>
  typeof json === 'object' && json !== null ? (json as Record<string, unknown>)[key] : undefined;

/** Chuỗi theo `locale` của chỗ gọi (message lỗi `validation`, gợi ý ô). */
export const jiraT = (locale: DevToolsLocale, key: DevToolsKey, vars?: TVars): string =>
  translate(devtoolsStrings[locale], key, vars);

/**
 * **Chức năng:** dựng `JiraAuth` từ email + API token: header `Basic` là base64 của **UTF-8**
 * `email:token` (đúng cả khi email có dấu — Review Focus 2). Hai đầu được bỏ khoảng trắng (QA hay dán
 * kèm xuống dòng).
 *
 * **Input:** `email` · `token`. **Output:** `JiraAuth`.
 *
 * @example
 * ```ts
 * jiraAuth('a@b.com', 'tok').header; // 'Basic YUBiLmNvbTp0b2s='
 * ```
 *
 * **Unit test:** `base-url.test.ts` › `jiraAuth` — 1 case: email có dấu, khoảng trắng hai đầu, bí mật.
 */
export const jiraAuth = (email: string, token: string): JiraAuth => {
  const cleanEmail = email.trim();
  const cleanToken = token.trim();
  const basic = base64Utf8(`${cleanEmail}:${cleanToken}`);
  return { header: `Basic ${basic}`, secrets: [cleanToken, basic], email: cleanEmail };
};

/**
 * **Chức năng:** chuẩn hoá ô site QA nhập về origin `https://<host>` (chữ thường): thêm `https://`
 * nếu thiếu, bỏ đường dẫn/query (QA hay dán link một board). Không nhận `http` thường, userinfo,
 * cổng, host không có dấu chấm.
 *
 * **Input:** `raw` — giá trị ô (kiểu bất kỳ). **Output:** origin, hoặc `undefined` nếu sai dạng.
 *
 * @example
 * ```ts
 * normalizeJiraSite('ACME.atlassian.net/jira/boards/1'); // 'https://acme.atlassian.net'
 * normalizeJiraSite('http://acme.atlassian.net');        // ca biên: undefined (không https)
 * ```
 *
 * **Unit test:** `base-url.test.ts` › `normalizeJiraSite` — 13 case: 4 dạng hợp lệ · 9 dạng sai.
 */
export const normalizeJiraSite = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const match = SITE_SHAPE.exec(raw.trim());
  return match === null ? undefined : `https://${match[1].toLowerCase()}`;
};

/** Base URL gateway của một `cloudId`. */
export const jiraGatewayBase = (cloudId: string): string =>
  `${JIRA_GATEWAY}/${encodeURIComponent(cloudId)}`;

/**
 * `candidate` có phải base URL được phép gửi token tới không: đúng site của kết nối, hoặc gateway của
 * Atlassian. Giá trị khác (dữ liệu hỏng/bị sửa) bị bỏ để token không đi tới host lạ.
 */
export const isJiraBase = (candidate: unknown, site: string): candidate is string =>
  typeof candidate === 'string' && (candidate === site || GATEWAY_BASE.test(candidate));

/**
 * **Chức năng:** một request REST tới Jira qua `requestJson`: luôn có `Authorization: Basic …` và
 * `Accept: application/json`; **mọi POST** có `X-Atlassian-Token: no-check` (thiếu thì request từ
 * ngoài Atlassian Cloud có thể bị 403 — spec 5.4.1). `json` ⇒ thân JSON + `Content-Type`; `form` ⇒
 * thân multipart (không tự đặt `Content-Type` để `fetch` thêm `boundary`). Token thô và chuỗi Basic
 * luôn nằm trong `secrets` nên không lọt vào message lỗi.
 *
 * **Input:** `ctx` · `auth` · `url` · `opts` (`method`, `json` | `form`). **Output:** JSON của phản hồi.
 *
 * @example
 * ```ts
 * await jiraRequest(ctx, auth, `${base}/rest/api/3/issue`, { method: 'POST', json: { fields } });
 * ```
 *
 * **Unit test:** kiểm gián tiếp ở `base-url.test.ts` (header mọi GET) và `index.test.ts` (header mọi
 * POST, `Content-Type` của POST /issue, multipart không có `Content-Type`, bí mật bị cắt khỏi lỗi).
 */
export const jiraRequest = async <T>(
  ctx: ConnectorContext,
  auth: JiraAuth,
  url: string,
  opts: { method?: 'GET' | 'POST'; json?: unknown; form?: FormData } = {},
): Promise<T> => {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    Authorization: auth.header,
    Accept: 'application/json',
  };
  if (method === 'POST') headers['X-Atlassian-Token'] = 'no-check';
  let body: RequestInit['body'];
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.form !== undefined) {
    body = opts.form;
  }
  const { json } = await requestJson<T>(ctx, url, { method, headers, body }, {
    secrets: auth.secrets,
  });
  return json;
};

type Probe =
  | { readonly ok: true; readonly empty: boolean }
  | { readonly ok: false; readonly error: ConnectorError };

/**
 * Dò một base bằng `GET /project/search?maxResults=1` (quyền `read:jira-work`, gửi bug cũng cần —
 * ruling R5). 401/404 ⇒ `{ ok: false }` để thử nơi khác; lỗi khác (403 Guard, 429, mạng…) ném luôn.
 */
const probe = async (base: string, auth: JiraAuth, ctx: ConnectorContext): Promise<Probe> => {
  try {
    const json = await jiraRequest<unknown>(
      ctx,
      auth,
      `${base}/rest/api/3/project/search?maxResults=1`,
    );
    const values = jsonProp(json, 'values');
    return { ok: true, empty: !Array.isArray(values) || values.length === 0 };
  } catch (error) {
    if (error instanceof ConnectorError && TRY_GATEWAY_ON.has(error.status ?? 0)) {
      return { ok: false, error };
    }
    throw error;
  }
};

/**
 * `cloudId` từ `GET <site>/_edge/tenant_info`. Site trả lỗi 4xx (trừ 429) hoặc sai dạng ⇒
 * `undefined` (không có gateway để thử). Không có phản hồi (mạng, quá giờ — `status` vắng), 429 hay
 * 5xx ⇒ **ném** lỗi đó: một lần chập chờn không được thành câu "token sai" cho người dùng scoped token.
 */
const readCloudId = async (
  site: string,
  auth: JiraAuth,
  ctx: ConnectorContext,
): Promise<string | undefined> => {
  try {
    const info = await jiraRequest<unknown>(ctx, auth, `${site}/_edge/tenant_info`);
    const cloudId = jsonProp(info, 'cloudId');
    return typeof cloudId === 'string' && CLOUD_ID.test(cloudId) ? cloudId : undefined;
  } catch (error) {
    const status = error instanceof ConnectorError ? error.status : undefined;
    if (status !== undefined && status !== 429 && status < 500) return undefined;
    throw error;
  }
};

/**
 * **Chức năng:** tìm base URL chạy được cho token này (spec 5.4.1, ruling R5) — **không** đọc tên
 * tài khoản:
 *
 * 1. Dò site. Có project ⇒ dùng site.
 * 2. Site trả 401/404 **hoặc danh sách rỗng** (không bao giờ coi rỗng là "không có project") ⇒ lấy
 *    `cloudId` từ `<site>/_edge/tenant_info`, dò gateway. Gateway trả 2xx ⇒ dùng gateway + `cloudId`.
 * 3. Gateway không chạy (hoặc không có `cloudId`): site đã trả 2xx rỗng ⇒ dùng site (token thường,
 *    thật sự không thấy project nào). Site lỗi ⇒ có 401 ở site hoặc gateway ⇒ ném lỗi `auth` đó;
 *    còn lại (404 cả hai) ⇒ `validation` trên ô `site` ("Không tìm thấy Jira ở địa chỉ này").
 *
 * Lỗi khác 401/404 (403 Atlassian Guard, 429, 5xx, mạng) ném ngay, không thử tiếp.
 *
 * **Input:** `site` (đã chuẩn hoá) · `auth` · `ctx`. **Output:** `{ baseUrl, cloudId? }`.
 *
 * @example
 * ```ts
 * await locateJiraBase('https://acme.atlassian.net', auth, ctx);
 * // token thường: { baseUrl: 'https://acme.atlassian.net' }
 * // scoped token: { baseUrl: 'https://api.atlassian.com/ex/jira/<cloudId>', cloudId }
 * ```
 *
 * **Unit test:** qua `resolveJiraBase` ở `base-url.test.ts`, và `index.test.ts` (send dò lại khi
 * `baseUrl` vắng/lạ).
 */
export const locateJiraBase = async (
  site: string,
  auth: JiraAuth,
  ctx: ConnectorContext,
): Promise<JiraBase> => {
  const onSite = await probe(site, auth, ctx);
  if (onSite.ok && !onSite.empty) return { baseUrl: site };

  const cloudId = await readCloudId(site, auth, ctx);
  if (cloudId !== undefined) {
    const gateway = jiraGatewayBase(cloudId);
    const viaGateway = await probe(gateway, auth, ctx);
    if (viaGateway.ok) return { baseUrl: gateway, cloudId };
    if (!onSite.ok) throw bothFailed(onSite.error, viaGateway.error, ctx.locale);
  } else if (!onSite.ok) {
    throw bothFailed(onSite.error, undefined, ctx.locale);
  }
  return { baseUrl: site };
};

/** Lỗi khi cả site lẫn gateway đều không dùng được: ưu tiên 401 (`auth`), không thì "không thấy Jira". */
const bothFailed = (
  onSite: ConnectorError,
  viaGateway: ConnectorError | undefined,
  locale: DevToolsLocale,
): ConnectorError => {
  if (onSite.status === 401) return onSite;
  if (viaGateway?.status === 401) return viaGateway;
  return new ConnectorError('validation', jiraT(locale, 'connections.jira.siteNotFound'), {
    field: 'site',
    status: onSite.status,
  });
};

/** Tên hiển thị từ `/myself`. Server trả lỗi HTTP (401/403 khi token thiếu quyền đọc user…) ⇒ bỏ qua. */
const displayName = async (
  base: string,
  auth: JiraAuth,
  ctx: ConnectorContext,
): Promise<string | undefined> => {
  try {
    const me = await jiraRequest<unknown>(ctx, auth, `${base}/rest/api/3/myself`);
    const name = jsonProp(me, 'displayName');
    return typeof name === 'string' && name.trim() !== '' ? name : undefined;
  } catch (error) {
    if (error instanceof ConnectorError && error.status !== undefined) return undefined;
    throw error;
  }
};

/**
 * **Chức năng:** bước dò của **Thử kết nối**: `locateJiraBase` rồi đọc tên hiển thị qua
 * `GET <base>/rest/api/3/myself` (chỉ để hiện, lỗi HTTP của nó bị bỏ qua ⇒ `account` = email).
 *
 * **Input:** `site` (đã chuẩn hoá) · `auth` (`jiraAuth(email, token)`) · `ctx`.
 * **Output:** `{ baseUrl, cloudId?, account }`.
 *
 * @example
 * ```ts
 * await resolveJiraBase('https://acme.atlassian.net', jiraAuth(email, token), ctx);
 * // { baseUrl: 'https://api.atlassian.com/ex/jira/1111…', cloudId: '1111…', account: 'Nguyễn QA' }
 * ```
 *
 * **Unit test:** `base-url.test.ts` › `resolveJiraBase` — 17 case: site có project · site 401 và 404
 * ⇒ gateway (2) · site rỗng ⇒ gateway · site rỗng + gateway 401 ⇒ site · cả hai 401 ⇒ `auth` không
 * lộ bí mật · site 401 + không có cloudId ⇒ `auth` · `tenant_info` không phản hồi / 429 / 5xx ⇒ ném
 * đúng lỗi đó (5) · cả hai 404 ⇒ `validation` ô site · site 403 ⇒ `permission` · `/myself` 401 và 403
 * ⇒ email (2) · header mọi request.
 */
export const resolveJiraBase = async (
  site: string,
  auth: JiraAuth,
  ctx: ConnectorContext,
): Promise<JiraBase & { readonly account: string }> => {
  const base = await locateJiraBase(site, auth, ctx);
  return { ...base, account: (await displayName(base.baseUrl, auth, ctx)) ?? auth.email };
};
