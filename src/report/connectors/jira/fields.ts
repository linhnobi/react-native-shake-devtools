import type { DevToolsLocale } from '../../../i18n/types';
import type {
  ConnectorContext,
  ConnectorField,
  ConnectorOption,
  ConnectorValues,
} from '../types';
import { adfFromText } from './adf';
import { jiraRequest, jiraT, jsonProp, type JiraAuth } from './base-url';

/** `schema` của một trường trong createmeta. */
export interface JiraFieldSchema {
  readonly type: string;
  readonly items?: string;
  readonly system?: string;
  readonly custom?: string;
}

/** Một giá trị được phép của trường chọn (`option` có `value`; priority/component/version có `name`). */
export interface JiraAllowedValue {
  readonly id: string;
  readonly name?: string;
  readonly value?: string;
}

/** Metadata một trường của màn tạo issue (`createmeta/{project}/issuetypes/{id}`), đã lọc dạng. */
export interface JiraFieldMeta {
  readonly fieldId: string;
  readonly name: string;
  readonly required: boolean;
  readonly hasDefaultValue?: boolean;
  readonly schema: JiraFieldSchema;
  readonly allowedValues?: readonly JiraAllowedValue[];
}

/** Trường có kiểu lib chưa hỗ trợ (spec 11.3). `type` là tên kiểu đưa vào câu báo cho admin. */
export interface JiraUnsupportedField {
  readonly unsupported: true;
  readonly name: string;
  readonly type: string;
}

/** Cách lib nhập và gửi một trường — một trong các kiểu spec 11.3 hỗ trợ. */
type JiraInputKind = 'text' | 'textarea' | 'number' | 'select' | 'multiselect' | 'labels' | 'date';

/** Trường connector tự điền (hoặc không bao giờ điền qua form): không bao giờ hiện cho QA. */
const FILLED_BY_CONNECTOR: ReadonlySet<string> = new Set([
  'summary',
  'description',
  'project',
  'issuetype',
  'attachment',
]);

/** Số mục xin mỗi trang; và số trang tối đa (chặn vòng lặp nếu server báo `total` sai). */
const PAGE_SIZE = 50;
const MAX_PAGES = 20;

/** Ngày `YYYY-MM-DD` ở đầu chuỗi (một mình, hoặc phần đầu của chuỗi ISO có giờ). */
const ISO_DATE = /^\s*(\d{4}-\d{2}-\d{2})(?:[T\s]|$)/;

/** Id ô của trường Jira trong form kết nối: `field.<jiraFieldId>`. */
export const jiraFieldKey = (fieldId: string): string => `field.${fieldId}`;

const kindOf = ({ type, items, system, custom }: JiraFieldSchema): JiraInputKind | undefined => {
  if (type === 'string') {
    // `environment` là trường hệ thống kiểu string nhưng REST v3 chỉ nhận ADF (spec 5.4.1).
    return (custom !== undefined && /textarea/i.test(custom)) || system === 'environment'
      ? 'textarea'
      : 'text';
  }
  if (type === 'number') return 'number';
  if (type === 'date') return 'date';
  if (type === 'option' || type === 'priority' || type === 'version') return 'select';
  if (type === 'array' && (items === 'option' || items === 'component' || items === 'version')) {
    return 'multiselect';
  }
  if (type === 'array' && items === 'string') return 'labels';
  return undefined;
};

/** Tên kiểu cho câu báo: khoá ngắn của trường tuỳ chỉnh (`gh-sprint`), `array<…>`, hoặc `type`. */
const typeLabel = ({ type, items, custom }: JiraFieldSchema): string => {
  if (custom !== undefined) return custom.slice(custom.lastIndexOf(':') + 1);
  return type === 'array' ? `array<${items ?? '?'}>` : type;
};

/**
 * **Chức năng:** đổi một trường bắt buộc của Jira thành ô nhập của form kết nối (spec 11.3):
 *
 * | Jira | ô |
 * |---|---|
 * | `string` | `text` (`textarea` nếu `schema.custom` chứa `textarea`, hoặc là `environment`) |
 * | `number` | `number` |
 * | `option`, `priority`, `version` | `select` (lựa chọn từ `allowedValues`) |
 * | `array<option>`, `array<component>`, `array<version>` | `multiselect` |
 * | `array<string>` (labels) | `text`, có gợi ý "cách nhau bằng dấu cách" theo `locale` |
 * | `date` | `date` |
 *
 * Kiểu khác (`user`, `option-with-child`, sprint, epic link, `datetime`…) ⇒
 * `{ unsupported: true, name, type }` — `type` là khoá ngắn của trường tuỳ chỉnh (`gh-sprint`), hoặc
 * `array<items>`, hoặc `schema.type`.
 *
 * **Input:** `meta` · `locale` (mặc định `'en'`, chỉ cho gợi ý của labels).
 * **Output:** `ConnectorField` (`id` = `field.<fieldId>`, `required` = `meta.required`) hoặc
 * `JiraUnsupportedField`.
 *
 * @example
 * ```ts
 * jiraFieldToConnectorField({ fieldId: 'priority', name: 'Priority', required: true, schema: { type: 'priority' }, allowedValues: [{ id: '3', name: 'High' }] });
 * // { id: 'field.priority', label: 'Priority', kind: 'select', required: true, options: [{ id: '3', label: 'High' }] }
 * jiraFieldToConnectorField({ …, schema: { type: 'user' } }); // ca biên: { unsupported: true, name, type: 'user' }
 * ```
 *
 * **Unit test:** `fields.test.ts` › `jiraFieldToConnectorField` — 13 case: 12 kiểu hỗ trợ · gợi ý
 * labels vi/en; và 6 case kiểu chưa hỗ trợ.
 */
export const jiraFieldToConnectorField = (
  meta: JiraFieldMeta,
  locale: DevToolsLocale = 'en',
): ConnectorField | JiraUnsupportedField => {
  const kind = kindOf(meta.schema);
  if (kind === undefined) {
    return { unsupported: true, name: meta.name, type: typeLabel(meta.schema) };
  }

  const choice = kind === 'select' || kind === 'multiselect';
  const options: ConnectorOption[] = (meta.allowedValues ?? []).map((v) => ({
    id: v.id,
    label: v.value ?? v.name ?? v.id,
  }));
  return {
    id: jiraFieldKey(meta.fieldId),
    label: meta.name,
    kind: kind === 'labels' ? 'text' : kind,
    required: meta.required,
    ...(choice ? { options } : {}),
    ...(kind === 'labels' ? { help: jiraT(locale, 'connections.jira.labelsHelp') } : {}),
  };
};

const nonBlank = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** Danh sách chuỗi không rỗng từ một chuỗi hoặc một mảng. */
const stringsOf = (value: unknown): string[] => {
  const raw: readonly unknown[] = Array.isArray(value) ? value : [value];
  return raw.map(nonBlank).filter((v): v is string => v !== undefined);
};

/**
 * **Chức năng:** đổi giá trị QA nhập (dạng của `ConnectorValues`) thành giá trị `fields` mà REST v3
 * nhận cho từng kiểu: chọn một/priority/version ⇒ `{ id }`; chọn nhiều/component/version nhiều ⇒
 * `[{ id }]`; labels ⇒ `string[]` (tách theo khoảng trắng/dấu phẩy — nhãn Jira không có dấu cách);
 * số ⇒ `number` (nhận dấu phẩy thập phân); ngày ⇒ `'YYYY-MM-DD'` (cắt từ chuỗi ISO); textarea ⇒
 * tài liệu ADF; chữ một dòng ⇒ chuỗi đã bỏ khoảng trắng hai đầu.
 *
 * **Input:** `meta` · `value`.
 * **Output:** giá trị cho `fields[meta.fieldId]`, hoặc `undefined` khi trống, sai dạng, hay kiểu
 * chưa hỗ trợ — chỗ gọi báo lỗi `validation` trên ô đó.
 *
 * @example
 * ```ts
 * toJiraFieldValue(labelsMeta, 'ios crash');     // ['ios', 'crash']
 * toJiraFieldValue(numberMeta, 'abc');           // ca biên: undefined
 * ```
 *
 * **Unit test:** `fields.test.ts` › `toJiraFieldValue` — 24 case: 14 dạng đúng theo kiểu · textarea
 * ra ADF · 9 giá trị trống/sai/kiểu chưa hỗ trợ ⇒ `undefined`.
 */
export const toJiraFieldValue = (
  meta: JiraFieldMeta,
  value: ConnectorValues[string],
): unknown => {
  switch (kindOf(meta.schema)) {
    case 'text':
      return nonBlank(value);
    case 'textarea':
      return typeof value === 'string' && value.trim() !== '' ? adfFromText(value) : undefined;
    case 'number': {
      const text = nonBlank(value);
      const n = text === undefined ? NaN : Number(text.replace(',', '.'));
      return Number.isFinite(n) ? n : undefined;
    }
    case 'date': {
      const match = typeof value === 'string' ? ISO_DATE.exec(value) : null;
      return match === null ? undefined : match[1];
    }
    case 'select': {
      const id = nonBlank(value);
      return id === undefined ? undefined : { id };
    }
    case 'multiselect': {
      const ids = stringsOf(value);
      return ids.length === 0 ? undefined : ids.map((id) => ({ id }));
    }
    case 'labels': {
      const labels = stringsOf(value).flatMap((v) => v.split(/[\s,]+/).filter((l) => l !== ''));
      return labels.length === 0 ? undefined : labels;
    }
    default:
      return undefined;
  }
};

/**
 * **Chức năng:** chọn các trường QA phải điền: **bắt buộc** và **chưa có giá trị mặc định** (Jira
 * tự điền mặc định khi request bỏ trống — đó cũng là lời khuyên cho admin ở spec 11.3), trừ các
 * trường connector tự điền (`summary`, `description`, `project`, `issuetype`, `attachment`). Trường
 * không bắt buộc không bao giờ hiện. Ví dụ `reporter` bắt buộc nhưng mặc định là người gọi ⇒ bỏ.
 *
 * **Input:** `metas`. **Output:** mảng con, giữ thứ tự.
 *
 * @example
 * ```ts
 * fieldsToFill([summary, reporterWithDefault, platform]); // [platform]
 * ```
 *
 * **Unit test:** `fields.test.ts` › `fieldsToFill` — 1 case: bỏ không bắt buộc, có mặc định, 5
 * trường tự điền.
 */
export const fieldsToFill = (metas: readonly JiraFieldMeta[]): JiraFieldMeta[] =>
  metas.filter(
    (m) => m.required && m.hasDefaultValue !== true && !FILLED_BY_CONNECTOR.has(m.fieldId),
  );

/**
 * Gom mọi trang của một endpoint GET phân trang `startAt`/`maxResults` (mảng mục ở khoá đầu tiên
 * có trong `itemKeys`). Dừng khi trang rỗng, `isLast`, đủ `total`, hoặc (không có `total`) trang
 * ngắn hơn `maxResults`. `startAt` tiến theo số mục **thô** nhận được (kể cả mục hỏng bị lọc sau).
 * Tối đa `MAX_PAGES` trang.
 */
const collectPages = async (
  url: string,
  itemKeys: readonly string[],
  auth: JiraAuth,
  ctx: ConnectorContext,
): Promise<unknown[]> => {
  const all: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const pageUrl = `${url}?startAt=${all.length}&maxResults=${PAGE_SIZE}`;
    const json = await jiraRequest<unknown>(ctx, auth, pageUrl);
    const items = itemKeys.map((k) => jsonProp(json, k)).find(Array.isArray) ?? [];
    all.push(...items);
    const total = jsonProp(json, 'total');
    const isLast = jsonProp(json, 'isLast');
    const max = jsonProp(json, 'maxResults');
    if (items.length === 0 || isLast === true) break;
    if (typeof total === 'number') {
      if (all.length >= total) break;
    } else if (isLast !== false && items.length < (typeof max === 'number' ? max : PAGE_SIZE)) {
      break;
    }
  }
  return all;
};

/** Gốc createmeta **mới** của một project: `…/issue/createmeta/{project}/issuetypes`. */
const createMetaUrl = (baseUrl: string, project: string): string =>
  `${baseUrl}/rest/api/3/issue/createmeta/${encodeURIComponent(project)}/issuetypes`;

const idOf = (raw: unknown): string | undefined => {
  const id = jsonProp(raw, 'id');
  if (typeof id === 'number') return String(id);
  return nonBlank(id);
};

const parseAllowed = (raw: unknown): JiraAllowedValue | undefined => {
  const id = idOf(raw);
  if (id === undefined) return undefined;
  const name = jsonProp(raw, 'name');
  const value = jsonProp(raw, 'value');
  return {
    id,
    ...(typeof name === 'string' ? { name } : {}),
    ...(typeof value === 'string' ? { value } : {}),
  };
};

/** Một mục createmeta ⇒ `JiraFieldMeta`; thiếu `fieldId` hoặc `schema.type` ⇒ `undefined` (bỏ). */
const parseFieldMeta = (raw: unknown): JiraFieldMeta | undefined => {
  const fieldId = nonBlank(jsonProp(raw, 'fieldId'));
  const schema = jsonProp(raw, 'schema');
  const type = jsonProp(schema, 'type');
  if (fieldId === undefined || typeof type !== 'string') return undefined;

  const name = nonBlank(jsonProp(raw, 'name')) ?? fieldId;
  const hasDefaultValue = jsonProp(raw, 'hasDefaultValue');
  const allowed = jsonProp(raw, 'allowedValues');
  const optional = (key: 'items' | 'system' | 'custom') => {
    const v = jsonProp(schema, key);
    return typeof v === 'string' ? { [key]: v } : {};
  };
  return {
    fieldId,
    name,
    required: jsonProp(raw, 'required') === true,
    ...(typeof hasDefaultValue === 'boolean' ? { hasDefaultValue } : {}),
    schema: { type, ...optional('items'), ...optional('system'), ...optional('custom') },
    ...(Array.isArray(allowed)
      ? {
          allowedValues: allowed
            .map(parseAllowed)
            .filter((v): v is JiraAllowedValue => v !== undefined),
        }
      : {}),
  };
};

/**
 * **Chức năng:** đọc metadata các trường của màn tạo issue cho một project + loại issue qua
 * `GET <base>/rest/api/3/issue/createmeta/{project}/issuetypes/{issueType}` (endpoint mới, phân
 * trang; **không** dùng `createmeta?expand` đã deprecated — spec 5.4.1). Nhận mảng ở khoá `fields`
 * (theo tài liệu) hoặc `values`; mục sai dạng bị bỏ.
 *
 * **Input:** `baseUrl` · `project` (id) · `issueType` (id) · `auth` · `ctx`.
 * **Output:** `JiraFieldMeta[]` của mọi trang.
 *
 * @example
 * ```ts
 * const metas = await listCreateFields(base, '10000', '10001', auth, ctx);
 * ```
 *
 * **Unit test:** `fields.test.ts` › đọc metadata — 2 case: 2 trang qua `startAt`/`maxResults`, bỏ mục
 * hỏng, không `createmeta?expand` · khoá `values`.
 */
export const listCreateFields = async (
  baseUrl: string,
  project: string,
  issueType: string,
  auth: JiraAuth,
  ctx: ConnectorContext,
): Promise<JiraFieldMeta[]> => {
  const url = `${createMetaUrl(baseUrl, project)}/${encodeURIComponent(issueType)}`;
  const raw = await collectPages(url, ['fields', 'values'], auth, ctx);
  return raw.map(parseFieldMeta).filter((m): m is JiraFieldMeta => m !== undefined);
};

/**
 * **Chức năng:** các loại issue tạo được trong một project (`createmeta/{project}/issuetypes`, phân
 * trang; mảng ở `issueTypes` hoặc `values`). Bỏ loại **sub-task** (cần issue cha nên không tạo được
 * đứng riêng).
 *
 * **Input:** `baseUrl` · `project` (id) · `auth` · `ctx`. **Output:** `ConnectorOption[]` (`id`, tên).
 *
 * @example
 * ```ts
 * await listIssueTypes(base, '10000', auth, ctx); // [{ id: '10001', label: 'Bug' }, …]
 * ```
 *
 * **Unit test:** `fields.test.ts` › đọc metadata — 1 case: bỏ sub-task, gom 2 trang.
 */
export const listIssueTypes = async (
  baseUrl: string,
  project: string,
  auth: JiraAuth,
  ctx: ConnectorContext,
): Promise<ConnectorOption[]> => {
  const raw = await collectPages(
    createMetaUrl(baseUrl, project),
    ['issueTypes', 'values'],
    auth,
    ctx,
  );
  return raw.flatMap((t) => {
    const id = idOf(t);
    if (id === undefined || jsonProp(t, 'subtask') === true) return [];
    return [{ id, label: nonBlank(jsonProp(t, 'name')) ?? id }];
  });
};

/**
 * **Chức năng:** mọi project token này thấy (`GET <base>/rest/api/3/project/search`, phân trang tới
 * `isLast`). `id` là id project (ổn định khi đổi key), nhãn `Tên (KEY)`.
 *
 * **Input:** `baseUrl` · `auth` · `ctx`. **Output:** `ConnectorOption[]`.
 *
 * @example
 * ```ts
 * await listProjects(base, auth, ctx); // [{ id: '10000', label: 'Mobile (DEMO)' }]
 * ```
 *
 * **Unit test:** `fields.test.ts` › đọc metadata — 1 case: 2 trang tới `isLast`, nhãn có dấu.
 */
export const listProjects = async (
  baseUrl: string,
  auth: JiraAuth,
  ctx: ConnectorContext,
): Promise<ConnectorOption[]> => {
  const raw = await collectPages(`${baseUrl}/rest/api/3/project/search`, ['values'], auth, ctx);
  return raw.flatMap((p) => {
    const id = idOf(p);
    if (id === undefined) return [];
    const key = nonBlank(jsonProp(p, 'key'));
    const name = nonBlank(jsonProp(p, 'name')) ?? key ?? id;
    return [{ id, label: key === undefined ? name : `${name} (${key})` }];
  });
};
