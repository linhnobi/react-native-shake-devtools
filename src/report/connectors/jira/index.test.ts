import type { BugReport } from '../../bug-report';
import { base64Utf8 } from '../encoding';
import { ConnectorError, type ConnectorContext, type SendContext } from '../types';
import { makeUploadPart } from '../upload';
import { toAdf } from './adf';
import { JIRA_GATEWAY } from './base-url';
import { jiraCloudConnector } from './index';

/** FormData giả ghi lại từng phần — giống FormData của RN, nhận cả `{ uri, name, type }`. */
class RecordingFormData {
  readonly parts: Array<{ name: string; value: unknown; fileName?: string }> = [];
  append(name: string, value: unknown, fileName?: string): void {
    this.parts.push({ name, value, fileName });
  }
}

const g = globalThis as unknown as { FormData: unknown };
const realFormData = g.FormData;
beforeAll(() => {
  g.FormData = RecordingFormData;
});
afterAll(() => {
  g.FormData = realFormData;
});

const SITE = 'https://acme.atlassian.net';
const CLOUD = '11111111-2222-3333-4444-555555555555';
const GW = `${JIRA_GATEWAY}/${CLOUD}`;
const EMAIL = 'qa@acme.vn';
const TOKEN = 'ATATT-secret-token-123';
const BASIC = base64Utf8(`${EMAIL}:${TOKEN}`);
const SECRETS = { token: TOKEN };

const PROBE = '/rest/api/3/project/search?maxResults=1';
const PROJECTS = '/rest/api/3/project/search?startAt=0&maxResults=50';
const MYSELF = '/rest/api/3/myself';
const ISSUE_TYPES = '/rest/api/3/issue/createmeta/10000/issuetypes?startAt=0&maxResults=50';
const CREATE_META = '/rest/api/3/issue/createmeta/10000/issuetypes/10001?startAt=0&maxResults=50';
const ISSUE = '/rest/api/3/issue';
const ATTACH = '/rest/api/3/issue/DEMO-9/attachments';

const report = (over: Partial<BugReport> = {}): BugReport => ({
  id: 'rpt-1',
  createdAt: 1_700_000_000_000,
  title: 'Crash khi thanh toán',
  steps: [{ id: 'a', kind: 'tap', at: 1, label: 'Thanh toán' }],
  actual: 'POST /orders → 500',
  expected: 'Thanh toán thành công',
  deviceInfo: [['App', '1.2.3']],
  files: [
    { name: 'screenshot.jpg', mimeType: 'image/jpeg', uri: 'file:///cache/s.jpg' },
    { name: 'errors.txt', mimeType: 'text/plain', content: 'boom' },
    { name: 'timeline.json', mimeType: 'application/json', content: '[]' },
  ],
  ...over,
});

const VALUES = {
  site: SITE,
  email: EMAIL,
  project: '10000',
  issueType: '10001',
  baseUrl: SITE,
};

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), {
    status,
  });

const FIELD_META = [
  { fieldId: 'summary', name: 'Summary', required: true, schema: { type: 'string', system: 'summary' } },
  { fieldId: 'issuetype', name: 'Issue Type', required: true, schema: { type: 'issuetype', system: 'issuetype' } },
  { fieldId: 'project', name: 'Project', required: true, schema: { type: 'project', system: 'project' } },
  {
    fieldId: 'reporter',
    name: 'Reporter',
    required: true,
    hasDefaultValue: true,
    schema: { type: 'user', system: 'reporter' },
  },
  {
    fieldId: 'customfield_10050',
    name: 'Nền tảng',
    required: true,
    schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' },
    allowedValues: [
      { id: '1', value: 'Android' },
      { id: '2', value: 'iOS' },
    ],
  },
  {
    fieldId: 'customfield_10060',
    name: 'Ghi chú',
    required: true,
    schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' },
  },
  { fieldId: 'labels', name: 'Labels', required: true, schema: { type: 'array', items: 'string', system: 'labels' } },
  { fieldId: 'customfield_10070', name: 'Điểm', required: true, schema: { type: 'number' } },
  { fieldId: 'duedate', name: 'Due date', required: true, schema: { type: 'date', system: 'duedate' } },
  {
    fieldId: 'components',
    name: 'Components',
    required: true,
    schema: { type: 'array', items: 'component', system: 'components' },
    allowedValues: [{ id: '10', name: 'Checkout' }],
  },
  { fieldId: 'customfield_10080', name: 'Không bắt buộc', required: false, schema: { type: 'string' } },
];
const SPRINT = {
  fieldId: 'customfield_10020',
  name: 'Sprint',
  required: true,
  schema: { type: 'array', items: 'json', custom: 'com.pyxis.greenhopper.jira:gh-sprint' },
};
const createMeta = (fields: unknown[] = FIELD_META) => () =>
  reply(200, { startAt: 0, maxResults: 50, total: fields.length, fields });

const EXTRA_VALUES = {
  'field.customfield_10050': '1',
  'field.customfield_10060': 'Ghi chú\nhai dòng',
  'field.labels': 'ios crash',
  'field.customfield_10070': '3',
  'field.duedate': '2026-11-30',
  'field.components': ['10'],
};

type Route = (init?: RequestInit) => Response | Promise<Response>;

/** Ngữ cảnh gửi giả: fetch theo bảng `"<METHOD> <url>"`, request lạ ⇒ ném để test đỏ rõ ràng. */
const makeCtx = (
  routes: Record<string, Route>,
  opts: { locale?: 'vi' | 'en'; resume?: Record<string, unknown> } = {},
) => {
  const fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const route = routes[key];
    if (!route) throw new Error(`Unexpected request: ${key}`);
    return route(init);
  });
  const checkpoint = jest.fn();
  /* Phần upload thật, app KHÔNG cấp `writeTempFile` (R43): file chữ là phần chuỗi trong bộ nhớ. */
  const uploadPart = jest.fn(makeUploadPart({ reportId: 'rpt-1' }));
  const ctx: SendContext = {
    fetch,
    locale: opts.locale ?? 'en',
    timeoutMs: 1000,
    ...(opts.resume !== undefined ? { resume: opts.resume } : {}),
    checkpoint,
    uploadPart,
  };
  const calls = () => fetch.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`);
  const callTo = (key: string) => {
    const i = calls().indexOf(key);
    return i < 0 ? undefined : { init: fetch.mock.calls[i][1] as RequestInit, order: fetch.mock.invocationCallOrder[i] };
  };
  return { ctx, fetch, checkpoint, uploadPart, calls, callTo };
};

const bodyOf = (init: RequestInit | undefined) => JSON.parse(String(init?.body));
const partsOf = (init: RequestInit | undefined) =>
  (init?.body as unknown as RecordingFormData).parts;
const hasUriPart = (init?: RequestInit) =>
  partsOf(init).some((p) => typeof p.value === 'object' && p.value !== null && 'uri' in p.value);
/** Tên file của từng phần đã gửi: `name` của `{ uri | string, name, type }`. */
const sentNames = (init?: RequestInit) =>
  partsOf(init).map((p) => p.fileName ?? (p.value as { name?: string }).name);

/** Jira lưu đủ: trả mảng attachment mang đúng tên các phần đã gửi. */
const echoAttached: Route = (init) =>
  reply(200, sentNames(init).map((filename, i) => ({ id: String(100 + i), filename })));
/** `GET /issue/DEMO-9?fields=attachment` liệt kê các file đã nằm trên issue. */
const attachedOnIssue = (...names: string[]): Route => () =>
  reply(200, { key: 'DEMO-9', fields: { attachment: names.map((filename, i) => ({ id: String(i), filename })) } });
const offline: Route = () => Promise.reject(new ConnectorError('network', 'Network request failed'));
const timedOut: Route = () =>
  Promise.reject(new ConnectorError('uncertain', 'No response within 1000 ms'));
/** Lần lượt dùng các route; hết thì lặp lại route cuối. */
const inTurn = (...routes: Route[]): Route => {
  let n = 0;
  return (init) => routes[Math.min(n++, routes.length - 1)](init);
};

const PROBE_ATTACHED = '/rest/api/3/issue/DEMO-9?fields=attachment';
const TEXT_FILES = ['errors.txt', 'timeline.json'];
const ALL_FILES = ['screenshot.jpg', ...TEXT_FILES];

const sendRoutes = (base = SITE): Record<string, Route> => ({
  [`GET ${base}${CREATE_META}`]: createMeta(),
  [`POST ${base}${ISSUE}`]: () => reply(201, { id: '10100', key: 'DEMO-9', self: `${base}${ISSUE}/10100` }),
  [`POST ${base}${ATTACH}`]: echoAttached,
  [`GET ${base}${PROBE_ATTACHED}`]: attachedOnIssue(),
});

describe('jiraCloudConnector — khai báo', () => {
  it('id, ô nhập, bí mật và khả năng', () => {
    expect(jiraCloudConnector.id).toBe('jira-cloud');
    expect(jiraCloudConnector.secretFieldIds).toEqual(['token']);
    expect(jiraCloudConnector.capabilities({})).toEqual({ image: true, files: true });

    const fields = jiraCloudConnector.fields('en');
    expect(fields.map((f) => [f.id, f.kind, f.required === true])).toEqual([
      ['site', 'url', true],
      ['email', 'text', true],
      ['token', 'secret', true],
      ['project', 'select', true],
      ['issueType', 'select', true],
    ]);
    expect(fields.find((f) => f.id === 'issueType')?.dependsOn).toBe('project');
  });

  it('nhãn và gợi ý theo ngôn ngữ (token hết hạn tối đa 365 ngày)', () => {
    expect(jiraCloudConnector.label('vi')).toBe('Jira Cloud');
    expect(jiraCloudConnector.fields('vi')[0].label).toBe('Địa chỉ Jira');
    expect(jiraCloudConnector.fields('en')[0].label).toBe('Jira site');
    expect(jiraCloudConnector.fields('vi')[2].help).toContain('365 ngày');
    expect(jiraCloudConnector.fields('en')[2].help).toContain('365 days');
  });
});

describe('jiraCloudConnector.test', () => {
  const asCtx = (c: SendContext): ConnectorContext => ({ fetch: c.fetch, locale: c.locale, timeoutMs: c.timeoutMs });

  it('site chạy ⇒ account, danh sách project, `resolved.baseUrl` = site', async () => {
    const { ctx } = makeCtx({
      [`GET ${SITE}${PROBE}`]: () => reply(200, { values: [{ id: '10000', key: 'DEMO', name: 'Mobile' }] }),
      [`GET ${SITE}${MYSELF}`]: () => reply(200, { displayName: 'QA Một' }),
      [`GET ${SITE}${PROJECTS}`]: () =>
        reply(200, { isLast: true, values: [{ id: '10000', key: 'DEMO', name: 'Mobile' }] }),
    });

    await expect(
      jiraCloudConnector.test({ site: 'acme.atlassian.net/jira', email: EMAIL }, SECRETS, asCtx(ctx)),
    ).resolves.toEqual({
      account: 'QA Một',
      options: { project: [{ id: '10000', label: 'Mobile (DEMO)' }] },
      resolved: { baseUrl: SITE },
    });
  });

  it('scoped token (site trả danh sách rỗng) ⇒ project đọc qua gateway, `resolved` có `cloudId`', async () => {
    const { ctx, calls } = makeCtx({
      [`GET ${SITE}${PROBE}`]: () => reply(200, { values: [] }),
      [`GET ${SITE}/_edge/tenant_info`]: () => reply(200, { cloudId: CLOUD }),
      [`GET ${GW}${PROBE}`]: () => reply(200, { values: [{ id: '10000', key: 'DEMO', name: 'Mobile' }] }),
      [`GET ${GW}${MYSELF}`]: () => reply(200, { displayName: 'QA Một' }),
      [`GET ${GW}${PROJECTS}`]: () =>
        reply(200, { isLast: true, values: [{ id: '10000', key: 'DEMO', name: 'Mobile' }] }),
    });

    await expect(
      jiraCloudConnector.test({ site: SITE, email: EMAIL }, SECRETS, asCtx(ctx)),
    ).resolves.toEqual({
      account: 'QA Một',
      options: { project: [{ id: '10000', label: 'Mobile (DEMO)' }] },
      resolved: { baseUrl: GW, cloudId: CLOUD },
    });
    expect(calls()).not.toContain(`GET ${SITE}${PROJECTS}`);
  });

  it.each([
    ['site', { email: EMAIL }, SECRETS],
    ['email', { site: SITE }, SECRETS],
    ['token', { site: SITE, email: EMAIL }, {}],
  ])('thiếu `%s` ⇒ validation trên đúng ô, không gọi mạng', async (field, values, secrets) => {
    const { ctx, fetch } = makeCtx({});

    await expect(jiraCloudConnector.test(values, secrets, asCtx(ctx))).rejects.toMatchObject({
      kind: 'validation',
      field,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('site dùng http thường ⇒ validation trên `site`, message theo ngôn ngữ', async () => {
    const { ctx } = makeCtx({}, { locale: 'vi' });

    await expect(
      jiraCloudConnector.test({ site: 'http://acme.atlassian.net', email: EMAIL }, SECRETS, asCtx(ctx)),
    ).rejects.toMatchObject({
      kind: 'validation',
      field: 'site',
      message: 'Địa chỉ Jira không hợp lệ. Nhập dạng https://ten-cong-ty.atlassian.net',
    });
  });
});

describe('jiraCloudConnector.loadOptions / loadExtraFields', () => {
  it('loadOptions("issueType") liệt kê loại issue của project qua `baseUrl` đã lưu (gateway)', async () => {
    const { ctx, calls } = makeCtx({
      [`GET ${GW}${ISSUE_TYPES}`]: () =>
        reply(200, {
          total: 2,
          issueTypes: [
            { id: '10001', name: 'Bug' },
            { id: '10002', name: 'Sub-task', subtask: true },
          ],
        }),
    });

    await expect(
      jiraCloudConnector.loadOptions!('issueType', { ...VALUES, baseUrl: GW, cloudId: CLOUD }, SECRETS, ctx),
    ).resolves.toEqual([{ id: '10001', label: 'Bug' }]);
    expect(calls()).toEqual([`GET ${GW}${ISSUE_TYPES}`]);
  });

  it('loadOptions: ô khác, hoặc chưa chọn project ⇒ [] và không gọi mạng', async () => {
    const { ctx, fetch } = makeCtx({});

    await expect(jiraCloudConnector.loadOptions!('project', VALUES, SECRETS, ctx)).resolves.toEqual([]);
    await expect(
      jiraCloudConnector.loadOptions!('issueType', { ...VALUES, project: undefined }, SECRETS, ctx),
    ).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loadExtraFields: chỉ trường bắt buộc chưa có mặc định, id `field.<jiraId>`; kiểu chưa hỗ trợ có `unsupportedType` + câu báo', async () => {
    const { ctx } = makeCtx(
      { [`GET ${SITE}${CREATE_META}`]: createMeta([...FIELD_META, SPRINT]) },
      { locale: 'vi' },
    );

    const fields = await jiraCloudConnector.loadExtraFields!(VALUES, SECRETS, ctx);

    expect(fields.map((f) => [f.id, f.kind])).toEqual([
      ['field.customfield_10050', 'select'],
      ['field.customfield_10060', 'textarea'],
      ['field.labels', 'text'],
      ['field.customfield_10070', 'number'],
      ['field.duedate', 'date'],
      ['field.components', 'multiselect'],
      ['field.customfield_10020', 'text'],
    ]);
    expect(fields[0]).toMatchObject({
      label: 'Nền tảng',
      required: true,
      options: [
        { id: '1', label: 'Android' },
        { id: '2', label: 'iOS' },
      ],
    });
    expect(fields.slice(0, 6).every((f) => f.unsupportedType === undefined)).toBe(true);
    expect(fields[6]).toMatchObject({
      label: 'Sprint',
      required: true,
      unsupportedType: 'gh-sprint',
      help: 'Trường Sprint (kiểu gh-sprint) chưa hỗ trợ, nhờ admin đặt giá trị mặc định hoặc bỏ bắt buộc.',
    });
  });

  it('loadExtraFields: chưa chọn project hoặc loại issue ⇒ [] và không gọi mạng', async () => {
    const { ctx, fetch } = makeCtx({});

    await expect(
      jiraCloudConnector.loadExtraFields!({ ...VALUES, issueType: undefined }, SECRETS, ctx),
    ).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('jiraCloudConnector.send', () => {
  it('POST /issue: summary cắt 255, description ADF theo ngôn ngữ kết nối, trường bắt buộc đúng định dạng', async () => {
    const { ctx, callTo } = makeCtx(sendRoutes(), { locale: 'vi' });
    const long = report({ title: `TypeError: ${'x'.repeat(4990)}` });

    await jiraCloudConnector.send(long, { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx);

    const body = bodyOf(callTo(`POST ${SITE}${ISSUE}`)?.init);
    expect(body.fields.summary.length).toBeLessThanOrEqual(255);
    expect(body.fields.summary.startsWith('TypeError: xxx')).toBe(true);
    expect(body).toEqual({
      fields: {
        project: { id: '10000' },
        issuetype: { id: '10001' },
        summary: body.fields.summary,
        description: toAdf(long, 'vi'),
        customfield_10050: { id: '1' },
        customfield_10060: {
          version: 1,
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Ghi chú' },
                { type: 'hardBreak' },
                { type: 'text', text: 'hai dòng' },
              ],
            },
          ],
        },
        labels: ['ios', 'crash'],
        customfield_10070: 3,
        duedate: '2026-11-30',
        components: [{ id: '10' }],
      },
    });
  });

  it('mọi request có Basic auth; mọi POST có `X-Atlassian-Token: no-check`; POST /issue gửi JSON', async () => {
    const { ctx, fetch, callTo } = makeCtx(sendRoutes());

    await jiraCloudConnector.send(report(), { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx);

    for (const [, init] of fetch.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe(`Basic ${BASIC}`);
      if (init?.method === 'POST') expect(headers.get('x-atlassian-token')).toBe('no-check');
    }
    expect(new Headers(callTo(`POST ${SITE}${ISSUE}`)?.init.headers).get('content-type')).toBe(
      'application/json',
    );
  });

  it('tạo xong ⇒ checkpoint({ issueKey, baseUrl, committed: true }) rồi mới gửi mọi file trong MỘT request, trường `file`', async () => {
    const { ctx, checkpoint, callTo, calls } = makeCtx(sendRoutes());

    const result = await jiraCloudConnector.send(report(), { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx);

    expect(result).toEqual({ key: 'DEMO-9', url: `${SITE}/browse/DEMO-9` });
    expect(checkpoint).toHaveBeenCalledTimes(1);
    // R34: `committed` đánh dấu đúng lúc bước không đảo ngược (tạo issue) xong.
    expect(checkpoint).toHaveBeenCalledWith({ issueKey: 'DEMO-9', baseUrl: SITE, committed: true });
    const attach = callTo(`POST ${SITE}${ATTACH}`)!;
    expect(checkpoint.mock.invocationCallOrder[0]).toBeLessThan(attach.order);
    expect(calls().filter((c) => c.endsWith(ATTACH))).toHaveLength(1);
    const parts = partsOf(attach.init);
    expect(parts.map((p) => p.name)).toEqual(['file', 'file', 'file']);
    expect(parts[0].value).toEqual({ uri: 'file:///cache/s.jpg', name: 'screenshot.jpg', type: 'image/jpeg' });
    /* Không có `writeTempFile`: phần chuỗi `{ string, name, type }` — KHÔNG BAO GIỜ Blob (I1, R43). */
    expect(parts[1].value).toEqual({ string: 'boom', name: 'errors.txt', type: 'text/plain' });
    expect(parts.some((p) => p.value instanceof Blob)).toBe(false);
    expect(new Headers(attach.init.headers).has('content-type')).toBe(false);
  });

  it('đi qua gateway ⇒ mọi request tới gateway nhưng `url` luôn là link site cho người đọc', async () => {
    const { ctx, calls } = makeCtx(sendRoutes(GW));

    const result = await jiraCloudConnector.send(
      report(),
      { ...VALUES, ...EXTRA_VALUES, baseUrl: GW, cloudId: CLOUD },
      SECRETS,
      ctx,
    );

    expect(result).toEqual({ key: 'DEMO-9', url: `${SITE}/browse/DEMO-9` });
    expect(calls().every((c) => c.includes(GW))).toBe(true);
  });

  it('gửi lại với `resume.issueKey` ⇒ KHÔNG POST /issue, không đọc createmeta, chỉ đọc file đã đính rồi gửi đính kèm', async () => {
    const { ctx, calls, checkpoint } = makeCtx(sendRoutes(GW), {
      resume: { issueKey: 'DEMO-9', baseUrl: GW },
    });

    const result = await jiraCloudConnector.send(report(), { ...VALUES, baseUrl: SITE }, SECRETS, ctx);

    expect(result).toEqual({ key: 'DEMO-9', url: `${SITE}/browse/DEMO-9` });
    expect(calls()).toEqual([`GET ${GW}${PROBE_ATTACHED}`, `POST ${GW}${ATTACH}`]);
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it('resume chỉ có `issueKey` ⇒ dùng baseUrl của kết nối', async () => {
    const { ctx, calls } = makeCtx(sendRoutes(), { resume: { issueKey: 'DEMO-9' } });

    await jiraCloudConnector.send(report(), VALUES, SECRETS, ctx);

    expect(calls()).toEqual([`GET ${SITE}${PROBE_ATTACHED}`, `POST ${SITE}${ATTACH}`]);
  });

  it('resume: file đã nằm trên issue không gửi lại; đủ cả thì không POST nào', async () => {
    const partly = makeCtx(
      { ...sendRoutes(), [`GET ${SITE}${PROBE_ATTACHED}`]: attachedOnIssue('screenshot.jpg', 'errors.txt') },
      { resume: { issueKey: 'DEMO-9' } },
    );
    const fully = makeCtx(
      { ...sendRoutes(), [`GET ${SITE}${PROBE_ATTACHED}`]: attachedOnIssue(...ALL_FILES) },
      { resume: { issueKey: 'DEMO-9' } },
    );

    await expect(jiraCloudConnector.send(report(), VALUES, SECRETS, partly.ctx)).resolves.toEqual({
      key: 'DEMO-9',
      url: `${SITE}/browse/DEMO-9`,
    });
    await expect(jiraCloudConnector.send(report(), VALUES, SECRETS, fully.ctx)).resolves.toEqual({
      key: 'DEMO-9',
      url: `${SITE}/browse/DEMO-9`,
    });

    expect(sentNames(partly.callTo(`POST ${SITE}${ATTACH}`)?.init)).toEqual(['timeline.json']);
    expect(fully.calls()).toEqual([`GET ${SITE}${PROBE_ATTACHED}`]);
  });

  it('chỉ có ảnh + máy offline (POST và GET dò đều không có phản hồi) ⇒ ném `network`, KHÔNG báo thành công', async () => {
    const { ctx, calls } = makeCtx({
      ...sendRoutes(),
      [`POST ${SITE}${ATTACH}`]: offline,
      [`GET ${SITE}${PROBE_ATTACHED}`]: offline,
    });
    const onlyShot = report({ files: [report().files[0]] });

    await expect(
      jiraCloudConnector.send(onlyShot, { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx),
    ).rejects.toMatchObject({ kind: 'network' });
    expect(calls().filter((c) => c.endsWith(ATTACH))).toHaveLength(1);
  });

  it('mất mạng thật lúc gửi đính kèm (GET dò cũng hỏng) ⇒ ném `network`; issue đã checkpoint nên lần sau không tạo lại', async () => {
    const { ctx, checkpoint, calls } = makeCtx({
      ...sendRoutes(),
      [`POST ${SITE}${ATTACH}`]: offline,
      [`GET ${SITE}${PROBE_ATTACHED}`]: offline,
    });

    await expect(
      jiraCloudConnector.send(report(), { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx),
    ).rejects.toMatchObject({ kind: 'network' });
    expect(checkpoint).toHaveBeenCalledWith({ issueKey: 'DEMO-9', baseUrl: SITE, committed: true });
    expect(calls().slice(-2)).toEqual([`POST ${SITE}${ATTACH}`, `GET ${SITE}${PROBE_ATTACHED}`]);
  });

  it('chập chờn một lần rồi thông ⇒ gửi lại đủ, ảnh vẫn được đính, không file nào bị bỏ', async () => {
    const { ctx, fetch } = makeCtx({
      ...sendRoutes(),
      [`POST ${SITE}${ATTACH}`]: inTurn(offline, echoAttached),
    });

    await expect(
      jiraCloudConnector.send(report(), { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx),
    ).resolves.toEqual({ key: 'DEMO-9', url: `${SITE}/browse/DEMO-9` });
    const attaches = fetch.mock.calls.filter(([url]) => url === `${SITE}${ATTACH}`);
    expect(attaches).toHaveLength(2);
    expect(sentNames(attaches[1][1])).toEqual(ALL_FILES);
  });

  it('mất phản hồi nhưng Jira đã lưu đủ (GET dò thấy mọi file) ⇒ thành công, không gửi lại', async () => {
    const { ctx, calls } = makeCtx({
      ...sendRoutes(),
      [`POST ${SITE}${ATTACH}`]: timedOut,
      [`GET ${SITE}${PROBE_ATTACHED}`]: attachedOnIssue(...ALL_FILES),
    });

    await expect(
      jiraCloudConnector.send(report(), { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx),
    ).resolves.toEqual({ key: 'DEMO-9', url: `${SITE}/browse/DEMO-9` });
    expect(calls().filter((c) => c.endsWith(ATTACH))).toHaveLength(1);
  });

  it('mất phản hồi, Jira mới lưu một phần ⇒ chỉ gửi lại file chưa có', async () => {
    const { ctx, fetch } = makeCtx({
      ...sendRoutes(),
      [`POST ${SITE}${ATTACH}`]: inTurn(timedOut, echoAttached),
      [`GET ${SITE}${PROBE_ATTACHED}`]: attachedOnIssue('screenshot.jpg'),
    });

    await expect(
      jiraCloudConnector.send(report(), { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx),
    ).resolves.toEqual({ key: 'DEMO-9', url: `${SITE}/browse/DEMO-9` });
    const attaches = fetch.mock.calls.filter(([url]) => url === `${SITE}${ATTACH}`);
    expect(sentNames(attaches[1][1])).toEqual(TEXT_FILES);
  });

  it('ảnh cache đã bị xoá (POST có phần `uri` hỏng cả sau khi GET dò thành công) ⇒ thành công, file chữ vẫn đính, `skippedFiles` (Review Focus 4)', async () => {
    const { ctx, fetch, calls } = makeCtx({
      ...sendRoutes(),
      [`POST ${SITE}${ATTACH}`]: (init) => (hasUriPart(init) ? offline(init) : echoAttached(init)),
    });

    const result = await jiraCloudConnector.send(report(), { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx);

    expect(result).toEqual({
      key: 'DEMO-9',
      url: `${SITE}/browse/DEMO-9`,
      skippedFiles: ['screenshot.jpg'],
    });
    expect(calls().filter((c) => c === `POST ${SITE}${ISSUE}`)).toHaveLength(1);
    const attaches = fetch.mock.calls.filter(([url]) => url === `${SITE}${ATTACH}`);
    expect(attaches).toHaveLength(3);
    expect(sentNames(attaches[2][1])).toEqual(TEXT_FILES);
    expect(calls().filter((c) => c.endsWith(PROBE_ATTACHED))).toHaveLength(1);
  });

  it('resume + ảnh đã mất ⇒ tối đa 1 GET + 3 POST, thành công với `skippedFiles`', async () => {
    const { ctx, calls } = makeCtx(
      {
        ...sendRoutes(),
        [`POST ${SITE}${ATTACH}`]: (init) => (hasUriPart(init) ? offline(init) : echoAttached(init)),
      },
      { resume: { issueKey: 'DEMO-9' } },
    );

    await expect(jiraCloudConnector.send(report(), VALUES, SECRETS, ctx)).resolves.toEqual({
      key: 'DEMO-9',
      url: `${SITE}/browse/DEMO-9`,
      skippedFiles: ['screenshot.jpg'],
    });
    expect(calls()).toEqual([
      `GET ${SITE}${PROBE_ATTACHED}`,
      `POST ${SITE}${ATTACH}`,
      `POST ${SITE}${ATTACH}`,
      `POST ${SITE}${ATTACH}`,
    ]);
  });

  it('lần gửi lại sau GET dò hỏng vì `uncertain` (không phải `network`) ⇒ ném, không kết luận file mất', async () => {
    const { ctx, calls } = makeCtx({
      ...sendRoutes(),
      [`POST ${SITE}${ATTACH}`]: inTurn(offline, timedOut, echoAttached),
    });

    await expect(
      jiraCloudConnector.send(report(), { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx),
    ).rejects.toMatchObject({ kind: 'uncertain' });
    expect(calls().filter((c) => c.endsWith(ATTACH))).toHaveLength(2);
  });

  it('GET dò trả lỗi HTTP (mạng vẫn thông, không biết file nào đã có) ⇒ gửi lại đủ một lần', async () => {
    const { ctx, fetch } = makeCtx({
      ...sendRoutes(),
      [`POST ${SITE}${ATTACH}`]: inTurn(offline, echoAttached),
      [`GET ${SITE}${PROBE_ATTACHED}`]: () => reply(500, 'oops'),
    });

    await expect(
      jiraCloudConnector.send(report(), { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx),
    ).resolves.toEqual({ key: 'DEMO-9', url: `${SITE}/browse/DEMO-9` });
    const attaches = fetch.mock.calls.filter(([url]) => url === `${SITE}${ATTACH}`);
    expect(sentNames(attaches[1][1])).toEqual(ALL_FILES);
  });

  it('Jira trả 200 nhưng thiếu tên một file (vd phần Blob mất tên thành "blob") ⇒ file đó vào `skippedFiles`', async () => {
    const { ctx } = makeCtx({
      ...sendRoutes(),
      [`POST ${SITE}${ATTACH}`]: () =>
        reply(200, [
          { id: '1', filename: 'screenshot.jpg' },
          { id: '2', filename: 'blob' },
          { id: '3', filename: 'timeline.json' },
        ]),
    });

    await expect(
      jiraCloudConnector.send(report(), { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx),
    ).resolves.toEqual({
      key: 'DEMO-9',
      url: `${SITE}/browse/DEMO-9`,
      skippedFiles: ['errors.txt'],
    });
  });

  it.each([401, 403])(
    'POST đính kèm trả %p ⇒ vẫn thành công (issue đã có), mọi file vào `skippedFiles`',
    async (status) => {
      const { ctx } = makeCtx({
        ...sendRoutes(),
        [`POST ${SITE}${ATTACH}`]: () => reply(status, 'no attach permission'),
      });

      await expect(
        jiraCloudConnector.send(report(), { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx),
      ).resolves.toEqual({
        key: 'DEMO-9',
        url: `${SITE}/browse/DEMO-9`,
        skippedFiles: ['screenshot.jpg', 'errors.txt', 'timeline.json'],
      });
    },
  );

  it('file không dựng được phần upload ⇒ bỏ file đó, các file khác vẫn đi chung một request', async () => {
    const { ctx, uploadPart, callTo } = makeCtx(sendRoutes());
    uploadPart.mockImplementation(async (file) => {
      if (file.name === 'errors.txt') throw new ConnectorError('unknown', 'no content');
      return makeUploadPart({ reportId: 'rpt-1' })(file);
    });

    await expect(
      jiraCloudConnector.send(report(), { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx),
    ).resolves.toMatchObject({ skippedFiles: ['errors.txt'] });
    expect(partsOf(callTo(`POST ${SITE}${ATTACH}`)?.init).length).toBe(2);
  });

  it('không có file ⇒ không gọi API đính kèm', async () => {
    const { ctx, calls } = makeCtx(sendRoutes());

    await expect(
      jiraCloudConnector.send(report({ files: [] }), { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx),
    ).resolves.toEqual({ key: 'DEMO-9', url: `${SITE}/browse/DEMO-9` });
    expect(calls().some((c) => c.endsWith('/attachments'))).toBe(false);
  });

  it('trường bắt buộc kiểu chưa hỗ trợ ⇒ validation trên `field.<id>` TRƯỚC khi tạo issue', async () => {
    const { ctx, calls } = makeCtx(
      { ...sendRoutes(), [`GET ${SITE}${CREATE_META}`]: createMeta([...FIELD_META, SPRINT]) },
      { locale: 'vi' },
    );

    await expect(
      jiraCloudConnector.send(report(), { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx),
    ).rejects.toMatchObject({
      kind: 'validation',
      field: 'field.customfield_10020',
      message: 'Trường Sprint (kiểu gh-sprint) chưa hỗ trợ, nhờ admin đặt giá trị mặc định hoặc bỏ bắt buộc.',
    });
    expect(calls()).not.toContain(`POST ${SITE}${ISSUE}`);
  });

  it('trường bắt buộc chưa có giá trị (admin vừa thêm) ⇒ validation trên `field.<id>`, không tạo issue', async () => {
    const { ctx, calls } = makeCtx(sendRoutes());
    const { ['field.customfield_10050']: _omit, ...rest } = EXTRA_VALUES;

    await expect(
      jiraCloudConnector.send(report(), { ...VALUES, ...rest }, SECRETS, ctx),
    ).rejects.toMatchObject({ kind: 'validation', field: 'field.customfield_10050' });
    expect(calls()).not.toContain(`POST ${SITE}${ISSUE}`);
  });

  it('thiếu project/loại issue ⇒ validation trên đúng ô, không gọi mạng', async () => {
    const { ctx, fetch } = makeCtx({});

    await expect(
      jiraCloudConnector.send(report(), { ...VALUES, issueType: undefined }, SECRETS, ctx),
    ).rejects.toMatchObject({ kind: 'validation', field: 'issueType' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POST /issue trả 401 (token hết hạn) ⇒ auth, không lộ token/Basic, không checkpoint', async () => {
    const { ctx, checkpoint } = makeCtx({
      ...sendRoutes(),
      [`POST ${SITE}${ISSUE}`]: () => reply(401, `expired ${TOKEN} Basic ${BASIC}`),
    });

    const error = await jiraCloudConnector
      .send(report(), { ...VALUES, ...EXTRA_VALUES }, SECRETS, ctx)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).kind).toBe('auth');
    expect((error as ConnectorError).message).not.toContain(TOKEN);
    expect((error as ConnectorError).message).not.toContain(BASIC);
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it('`baseUrl` vắng hoặc lạ (không phải site/gateway) ⇒ bỏ qua, dò lại từ site — không gửi token tới host lạ', async () => {
    const { ctx, calls } = makeCtx({
      [`GET ${SITE}${PROBE}`]: () => reply(200, { values: [{ id: '10000' }] }),
      ...sendRoutes(),
    });

    await jiraCloudConnector.send(
      report({ files: [] }),
      { ...VALUES, ...EXTRA_VALUES, baseUrl: 'https://evil.example' },
      SECRETS,
      ctx,
    );

    expect(calls()).toEqual([`GET ${SITE}${PROBE}`, `GET ${SITE}${CREATE_META}`, `POST ${SITE}${ISSUE}`]);
  });
});
