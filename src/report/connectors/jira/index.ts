import type { DevToolsKey, DevToolsLocale } from '../../../i18n/types';
import type { BugReport, ReportFile } from '../../bug-report';
import {
  ConnectorError,
  defineConnector,
  type ConnectorContext,
  type ConnectorField,
  type ConnectorValues,
  type SendContext,
  type UploadPart,
} from '../types';
import { toAdf, toJiraSummary } from './adf';
import {
  isJiraBase,
  jiraAuth,
  jiraRequest,
  jiraT,
  jsonProp,
  locateJiraBase,
  normalizeJiraSite,
  resolveJiraBase,
  type JiraAuth,
} from './base-url';
import {
  fieldsToFill,
  jiraFieldKey,
  jiraFieldToConnectorField,
  listCreateFields,
  listIssueTypes,
  listProjects,
  toJiraFieldValue,
  type JiraFieldMeta,
  type JiraUnsupportedField,
} from './fields';

/**
 * Giá trị các ô (không bí mật) của kết nối Jira. `baseUrl`/`cloudId` do **Thử kết nối** suy ra
 * (`ConnectorTestResult.resolved`). Trường bắt buộc của Jira nằm ở khoá `field.<jiraFieldId>`.
 * Token đi riêng qua `secrets.token`.
 */
export type JiraValues = {
  readonly site?: string;
  readonly email?: string;
  readonly project?: string;
  readonly issueType?: string;
  readonly baseUrl?: string;
  readonly cloudId?: string;
};

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** Ô bắt buộc còn trống ⇒ `validation` trên ô đó, message nêu nhãn ô theo `locale`. */
const missing = (locale: DevToolsLocale, field: string, labelKey: DevToolsKey): ConnectorError =>
  new ConnectorError(
    'validation',
    jiraT(locale, 'connections.jira.fieldMissing', { label: jiraT(locale, labelKey) }),
    { field },
  );

/** Site đã chuẩn hoá + `JiraAuth`. Thiếu/sai ⇒ `validation` trên đúng ô, trước mọi request. */
const credentials = (
  values: JiraValues,
  secrets: ConnectorValues,
  locale: DevToolsLocale,
): { site: string; auth: JiraAuth } => {
  if (str(values.site) === undefined) throw missing(locale, 'site', 'connections.jira.site');
  const site = normalizeJiraSite(values.site);
  if (site === undefined) {
    throw new ConnectorError('validation', jiraT(locale, 'connections.jira.siteInvalid'), {
      field: 'site',
    });
  }
  const email = str(values.email);
  if (email === undefined) throw missing(locale, 'email', 'connections.jira.email');
  const token = str(secrets.token);
  if (token === undefined) throw missing(locale, 'token', 'connections.jira.token');
  return { site, auth: jiraAuth(email, token) };
};

/** `baseUrl` đã lưu nếu hợp lệ (site hoặc gateway), không thì dò lại (`locateJiraBase`). */
const baseFor = async (
  values: JiraValues,
  site: string,
  auth: JiraAuth,
  ctx: ConnectorContext,
): Promise<string> => {
  if (isJiraBase(values.baseUrl, site)) return values.baseUrl;
  return (await locateJiraBase(site, auth, ctx)).baseUrl;
};

const isUnsupported = (f: ConnectorField | JiraUnsupportedField): f is JiraUnsupportedField =>
  'unsupported' in f;

const unsupportedMessage = (locale: DevToolsLocale, f: JiraUnsupportedField): string =>
  jiraT(locale, 'connections.jira.fieldUnsupported', { name: f.name, type: f.type });

/**
 * Ô cho form kết nối. Kiểu chưa hỗ trợ ⇒ ô mang `unsupportedType` + câu báo ở `help` để UI khoá Lưu
 * (spec 11.3).
 */
const editorField = (meta: JiraFieldMeta, locale: DevToolsLocale): ConnectorField => {
  const field = jiraFieldToConnectorField(meta, locale);
  if (!isUnsupported(field)) return field;
  return {
    id: jiraFieldKey(meta.fieldId),
    label: field.name,
    kind: 'text',
    required: true,
    unsupportedType: field.type,
    help: unsupportedMessage(locale, field),
  };
};

/**
 * Giá trị `fields` cho các trường bắt buộc, đọc metadata **mới** lúc gửi (admin có thể đã đổi màn
 * tạo issue). Kiểu chưa hỗ trợ hoặc giá trị trống/sai ⇒ `validation` trên `field.<id>` — ném
 * **trước** khi tạo issue.
 */
const requiredFieldValues = async (
  baseUrl: string,
  project: string,
  issueType: string,
  values: ConnectorValues,
  auth: JiraAuth,
  ctx: ConnectorContext,
): Promise<Record<string, unknown>> => {
  const out: Record<string, unknown> = {};
  for (const meta of fieldsToFill(await listCreateFields(baseUrl, project, issueType, auth, ctx))) {
    const id = jiraFieldKey(meta.fieldId);
    const field = jiraFieldToConnectorField(meta, ctx.locale);
    if (isUnsupported(field)) {
      throw new ConnectorError('validation', unsupportedMessage(ctx.locale, field), { field: id });
    }
    const value = toJiraFieldValue(meta, values[id]);
    if (value === undefined) {
      throw new ConnectorError(
        'validation',
        jiraT(ctx.locale, 'connections.jira.fieldInvalid', { name: meta.name }),
        { field: id },
      );
    }
    out[meta.fieldId] = value;
  }
  return out;
};

/** `POST /issue` — bước **không đảo được** (spec 5.4.3). */
const createIssue = async (
  report: BugReport,
  values: JiraValues & ConnectorValues,
  site: string,
  auth: JiraAuth,
  ctx: SendContext,
): Promise<{ key: string; baseUrl: string }> => {
  const project = str(values.project);
  if (project === undefined) throw missing(ctx.locale, 'project', 'connections.jira.project');
  const issueType = str(values.issueType);
  if (issueType === undefined) throw missing(ctx.locale, 'issueType', 'connections.jira.issueType');

  const baseUrl = await baseFor(values, site, auth, ctx);
  const extra = await requiredFieldValues(baseUrl, project, issueType, values, auth, ctx);
  const created = await jiraRequest<unknown>(ctx, auth, `${baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    json: {
      fields: {
        ...extra,
        project: { id: project },
        issuetype: { id: issueType },
        summary: toJiraSummary(report.title),
        description: toAdf(report, ctx.locale),
      },
    },
  });
  const key = str(jsonProp(created, 'key'));
  if (key === undefined) throw new ConnectorError('unknown', 'Jira did not return an issue key');
  return { key, baseUrl };
};

/**
 * Không có phản hồi HTTP nào (`network`, hoặc lỗi lạ không phải `ConnectorError`). Với RN đây cũng
 * là dạng lỗi khi file `uri` trong FormData không đọc được — native từ chối **trước** khi gửi byte nào.
 */
const isNetwork = (error: unknown): boolean =>
  !(error instanceof ConnectorError) || error.kind === 'network';

/** Request có thể đã đi mà không thấy phản hồi: `network` hoặc `uncertain` (timeout sau khi gửi). */
const unanswered = (error: unknown): boolean =>
  isNetwork(error) || (error instanceof ConnectorError && error.kind === 'uncertain');

/** Tên file trong một mảng attachment của Jira (`[{ filename }]`); không phải mảng ⇒ rỗng. */
const attachmentNames = (list: unknown): ReadonlySet<string> =>
  new Set(
    (Array.isArray(list) ? list : [])
      .map((a: unknown) => jsonProp(a, 'filename'))
      .filter((n): n is string => typeof n === 'string'),
  );

/** Jira từ chối hẳn (4xx trừ 429): issue đã có, gửi lại đính kèm cũng không vào ⇒ không ném. */
const refusedForGood = (error: unknown): boolean =>
  error instanceof ConnectorError &&
  (error.kind === 'auth' ||
    error.kind === 'permission' ||
    error.kind === 'validation' ||
    (error.kind === 'unknown' &&
      error.status !== undefined &&
      error.status >= 400 &&
      error.status < 500));

/** Một file đính kèm đã dựng thành phần upload. */
type Upload = { readonly file: ReportFile; readonly part: UploadPart };

const namesOf = (uploads: readonly Upload[]): string[] => uploads.map((u) => u.file.name);

/**
 * Đính file vào issue `issueUrl` bằng request multipart (trường `file`, mọi file một lần). Trả tên
 * các file **không** vào được. Tối đa **3 POST + 1 GET** mỗi lần gửi:
 *
 * - `uploadPart` ném ⇒ bỏ file đó.
 * - `resumed` (issue có từ lần trước) ⇒ GET dò trước, file đã nằm trên issue không gửi lại.
 * - Mỗi POST thành công: file mà Jira **không** trả về trong danh sách (so theo tên) ⇒ bỏ. Jira từ
 *   chối hẳn (401/403/4xx trừ 429) ⇒ cả lượt bị bỏ, không ném.
 * - POST không có phản hồi (`network`/`uncertain`) ⇒ GET dò `?fields=attachment` (nếu chưa dò):
 *   - GET cũng không có phản hồi ⇒ máy đang offline ⇒ ném (issue đã checkpoint, ảnh còn nguyên cho
 *     lần gửi lại);
 *   - GET thấy đủ file ⇒ chỉ mất phản hồi ⇒ thành công, không gửi lại;
 *   - còn lại (kể cả GET trả lỗi HTTP: mạng vẫn thông nhưng không biết gì) ⇒ gửi lại **một lần** các
 *     file chưa có.
 * - Lần gửi lại đó lại `network` dù mạng vừa được chứng minh còn thông ⇒ kết luận file mang `uri` của
 *   bản báo (ảnh trong cache, không tính file tạm `uploadPart` vừa ghi) đã bị hệ điều hành xoá — RN
 *   từ chối phần `uri` hỏng ngay tại máy, nên thử lại rất rẻ: bỏ chúng, gửi phần chữ còn lại (POST
 *   thứ ba); POST đó hỏng ⇒ ném (danh sách bỏ không được báo, lần sau thử lại cả ảnh).
 * - Lỗi khác (`rate-limit`, 5xx, `uncertain` ở lần gửi lại…) ⇒ ném để hàng đợi xử lý.
 *
 * ⚠️ Rủi ro còn lại: máy rớt mạng đúng giữa GET dò thành công và lần gửi lại, khi ảnh là file duy
 * nhất ⇒ ảnh bị bỏ oan. Cần hai lần POST hỏng kèm một GET thông xen giữa (hoặc ngay trước, khi resume).
 */
const attachFiles = async (
  files: readonly ReportFile[],
  issueUrl: string,
  resumed: boolean,
  auth: JiraAuth,
  ctx: SendContext,
): Promise<string[]> => {
  const skipped: string[] = [];
  let pending: Upload[] = [];
  for (const file of files) {
    try {
      pending.push({ file, part: await ctx.uploadPart(file) });
    } catch {
      skipped.push(file.name);
    }
  }

  /** Một lượt POST. Xong (kể cả bị từ chối hẳn) ⇒ `undefined`; lỗi khác ⇒ trả lỗi cho chỗ gọi. */
  const attempt = async (uploads: readonly Upload[]): Promise<{ error: unknown } | undefined> => {
    const form = new FormData();
    // Kiểu `append` của RN chỉ khai giá trị Blob/chuỗi; thực tế nhận `{ uri | string, name, type }`.
    const append = form.append.bind(form) as (name: string, value: unknown) => void;
    for (const { part } of uploads) append('file', part);
    try {
      const stored = attachmentNames(
        await jiraRequest<unknown>(ctx, auth, `${issueUrl}/attachments`, { method: 'POST', form }),
      );
      skipped.push(...namesOf(uploads.filter((u) => !stored.has(u.file.name))));
    } catch (error) {
      if (!refusedForGood(error)) return { error };
      skipped.push(...namesOf(uploads));
    }
    return undefined;
  };

  /** Bỏ các file đã nằm trên issue. Không có phản hồi ⇒ ném (offline); lỗi HTTP ⇒ giữ nguyên. */
  const notYetAttached = async (uploads: readonly Upload[]): Promise<Upload[]> => {
    let attached: ReadonlySet<string> = new Set();
    try {
      const issue = await jiraRequest<unknown>(ctx, auth, `${issueUrl}?fields=attachment`);
      attached = attachmentNames(jsonProp(jsonProp(issue, 'fields'), 'attachment'));
    } catch (error) {
      if (unanswered(error)) throw error;
    }
    return uploads.filter((u) => !attached.has(u.file.name));
  };

  if (resumed && pending.length > 0) pending = await notYetAttached(pending);
  if (pending.length === 0) return skipped;

  let failure = await attempt(pending);
  if (failure === undefined) return skipped;
  if (!unanswered(failure.error)) throw failure.error;
  if (!resumed) {
    pending = await notYetAttached(pending);
    if (pending.length === 0) return skipped;
  }

  failure = await attempt(pending);
  if (failure === undefined) return skipped;
  const fromDisk = pending.filter((u) => u.file.uri !== undefined);
  if (!isNetwork(failure.error) || fromDisk.length === 0) throw failure.error;
  skipped.push(...namesOf(fromDisk));
  pending = pending.filter((u) => u.file.uri === undefined);
  if (pending.length === 0) return skipped;

  failure = await attempt(pending);
  if (failure === undefined) return skipped;
  throw failure.error;
};

/**
 * **Chức năng:** loại kết nối **Jira Cloud** (spec 5.4, 5.4.1): tạo issue (summary + mô tả ADF + các
 * trường bắt buộc) rồi đính kèm file. Xác thực Basic `email:token`; tự chọn site hay gateway của
 * Atlassian (scoped token) khi **Thử kết nối**.
 *
 * - Ô: `site` (url), `email`, `token` (bí mật, gợi ý hạn 365 ngày), `project` (select, lựa chọn từ
 *   `test`), `issueType` (select, `dependsOn: 'project'`), cộng các trường bắt buộc do
 *   `loadExtraFields` sinh với id `field.<jiraFieldId>`.
 * - `test`: chuẩn hoá site, `resolveJiraBase` (site → gateway, ruling R5), liệt kê project. Trả
 *   `{ account, options: { project }, resolved: { baseUrl, cloudId? } }`.
 * - `loadOptions('issueType')`: loại issue (trừ sub-task) của project đã chọn; ô khác ⇒ `[]`.
 * - `loadExtraFields`: trường **bắt buộc chưa có mặc định** của project + loại issue (trừ trường tự
 *   điền); kiểu chưa hỗ trợ ⇒ ô mang `unsupportedType` + câu báo để UI khoá Lưu (spec 11.3).
 * - `send`:
 *   1. Có `ctx.resume.issueKey` ⇒ bỏ qua bước tạo (issue đã có, spec 5.4.3), dùng `resume.baseUrl`
 *      nếu hợp lệ.
 *   2. Không thì đọc metadata mới, kiểm trường bắt buộc (`validation` trên `field.<id>` **trước** khi
 *      tạo), `POST /issue` với summary ≤ 255 ký tự và mô tả ADF theo `ctx.locale` (ngôn ngữ kết
 *      nối), rồi `ctx.checkpoint({ issueKey, baseUrl, committed: true })` **ngay** (`committed`:
 *      ticket đã có, gửi lại cùng kết nối chỉ được làm nốt — ruling R34).
 *   3. Đính mọi file trong một request (xem `attachFiles`): gửi lại thì bỏ file đã có trên issue;
 *      không có phản hồi ⇒ GET dò — offline thì ném (ảnh còn nguyên), mất phản hồi thì không gửi
 *      lại; chỉ kết luận ảnh mất khi lần gửi lại hỏng ngay sau một GET thông; file Jira không trả về
 *      ⇒ `skippedFiles`; Jira từ chối đính kèm ⇒ vẫn thành công vì issue đã có. Tối đa 3 POST + 1 GET.
 *   4. Trả `{ key, url: <site>/browse/<key>, skippedFiles? }` — `url` luôn là site cho người đọc, kể
 *      cả khi gọi qua gateway.
 *
 * Mọi request mang `Authorization: Basic …`, mọi POST mang `X-Atlassian-Token: no-check`; token thô
 * và chuỗi Basic luôn là `secrets` của `requestJson` nên không lọt vào message lỗi. `baseUrl` lạ
 * trong dữ liệu đã lưu (không phải site/gateway) bị bỏ — không gửi token tới host lạ.
 *
 * **Input:** theo `ConnectorType`. **Output:** `ConnectorTestResult` / `SendResult`.
 *
 * @example
 * ```ts
 * await jiraCloudConnector.send(report, { site, email, project: '10000', issueType: '10001', baseUrl }, { token }, ctx);
 * // { key: 'DEMO-9', url: 'https://acme.atlassian.net/browse/DEMO-9' }
 * ```
 *
 * **Unit test:** `index.test.ts` — 2 case khai báo · 6 case `test` (site · gateway · thiếu 3 ô ·
 * site http) · 4 case `loadOptions`/`loadExtraFields` · 26 case `send` (thân POST /issue · header ·
 * checkpoint rồi một request đính kèm · gateway · resume có/không `baseUrl` · resume bỏ file đã có ·
 * chỉ ảnh + offline ⇒ ném · mất mạng thật ⇒ ném · chập chờn rồi thông · mất phản hồi đã lưu đủ /
 * một phần · ảnh mất ⇒ `skippedFiles` · resume + ảnh mất (1 GET + 3 POST) · gửi lại `uncertain` ⇒
 * ném · GET dò lỗi HTTP · Jira thiếu tên file · đính kèm 401 và 403 (2) · `uploadPart` ném · không
 * file · kiểu chưa hỗ trợ · trường trống · thiếu loại issue · 401 không lộ bí mật · `baseUrl` lạ).
 */
export const jiraCloudConnector = defineConnector<JiraValues & ConnectorValues>({
  id: 'jira-cloud',
  label: (locale) => jiraT(locale, 'connections.jira.label'),
  fields: (locale) => [
    {
      id: 'site',
      label: jiraT(locale, 'connections.jira.site'),
      kind: 'url',
      required: true,
      help: jiraT(locale, 'connections.jira.siteHelp'),
      placeholder: 'https://',
    },
    {
      id: 'email',
      label: jiraT(locale, 'connections.jira.email'),
      kind: 'text',
      required: true,
      placeholder: 'name@company.com',
    },
    {
      id: 'token',
      label: jiraT(locale, 'connections.jira.token'),
      kind: 'secret',
      required: true,
      help: jiraT(locale, 'connections.jira.tokenHelp'),
    },
    {
      id: 'project',
      label: jiraT(locale, 'connections.jira.project'),
      kind: 'select',
      required: true,
    },
    {
      id: 'issueType',
      label: jiraT(locale, 'connections.jira.issueType'),
      kind: 'select',
      required: true,
      dependsOn: 'project',
    },
  ],
  secretFieldIds: ['token'],
  capabilities: () => ({ image: true, files: true }),

  test: async (values, secrets, ctx) => {
    const { site, auth } = credentials(values, secrets, ctx.locale);
    const { baseUrl, cloudId, account } = await resolveJiraBase(site, auth, ctx);
    const project = await listProjects(baseUrl, auth, ctx);
    return {
      account,
      options: { project },
      resolved: cloudId === undefined ? { baseUrl } : { baseUrl, cloudId },
    };
  },

  loadOptions: async (fieldId, values, secrets, ctx) => {
    const project = str(values.project);
    if (fieldId !== 'issueType' || project === undefined) return [];
    const { site, auth } = credentials(values, secrets, ctx.locale);
    return listIssueTypes(await baseFor(values, site, auth, ctx), project, auth, ctx);
  },

  loadExtraFields: async (values, secrets, ctx) => {
    const project = str(values.project);
    const issueType = str(values.issueType);
    if (project === undefined || issueType === undefined) return [];
    const { site, auth } = credentials(values, secrets, ctx.locale);
    const baseUrl = await baseFor(values, site, auth, ctx);
    const metas = fieldsToFill(await listCreateFields(baseUrl, project, issueType, auth, ctx));
    return metas.map((meta) => editorField(meta, ctx.locale));
  },

  send: async (report, values, secrets, ctx) => {
    const { site, auth } = credentials(values, secrets, ctx.locale);

    const resumedKey = str(ctx.resume?.issueKey);
    let key: string;
    let baseUrl: string;
    if (resumedKey !== undefined) {
      key = resumedKey;
      const resumedBase = ctx.resume?.baseUrl;
      baseUrl = isJiraBase(resumedBase, site)
        ? resumedBase
        : await baseFor(values, site, auth, ctx);
    } else {
      ({ key, baseUrl } = await createIssue(report, values, site, auth, ctx));
      /* Issue đã có ở Jira: bước không đảo ngược xong (R34). */
      ctx.checkpoint({ issueKey: key, baseUrl, committed: true });
    }

    const path = encodeURIComponent(key);
    const skippedFiles = await attachFiles(
      report.files,
      `${baseUrl}/rest/api/3/issue/${path}`,
      resumedKey !== undefined,
      auth,
      ctx,
    );
    return {
      key,
      url: `${site}/browse/${path}`,
      ...(skippedFiles.length > 0 ? { skippedFiles } : {}),
    };
  },
});
