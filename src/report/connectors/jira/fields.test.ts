import type { ConnectorContext } from '../types';
import { jiraAuth } from './base-url';
import {
  fieldsToFill,
  jiraFieldToConnectorField,
  listCreateFields,
  listIssueTypes,
  listProjects,
  toJiraFieldValue,
  type JiraFieldMeta,
  type JiraFieldSchema,
} from './fields';

const BASE = 'https://acme.atlassian.net';
const AUTH = jiraAuth('qa@acme.vn', 'tok-123456');

const meta = (
  schema: JiraFieldSchema,
  over: Partial<Omit<JiraFieldMeta, 'schema'>> = {},
): JiraFieldMeta => ({
  fieldId: 'customfield_10050',
  name: 'Nền tảng',
  required: true,
  hasDefaultValue: false,
  schema,
  ...over,
});

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const makeCtx = (routes: Record<string, () => Response>) => {
  const fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const route = routes[url];
    if (!route || (init?.method ?? 'GET') !== 'GET') throw new Error(`Unexpected request: ${url}`);
    return route();
  });
  const ctx: ConnectorContext = { fetch, locale: 'en', timeoutMs: 1000 };
  return { ctx, urls: () => fetch.mock.calls.map(([url]) => url) };
};

const OPTIONS = [
  { id: '1', value: 'Android' },
  { id: '2', value: 'iOS' },
];
const NAMED = [
  { id: '3', name: 'High' },
  { id: '4', name: 'Low' },
];

describe('jiraFieldToConnectorField — kiểu hỗ trợ', () => {
  it.each<[string, JiraFieldSchema, unknown, string, unknown]>([
    ['chữ một dòng', { type: 'string', custom: 'x:textfield' }, undefined, 'text', undefined],
    [
      'chữ nhiều dòng (textarea)',
      { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' },
      undefined,
      'textarea',
      undefined,
    ],
    ['environment (ADF)', { type: 'string', system: 'environment' }, undefined, 'textarea', undefined],
    ['số', { type: 'number', custom: 'x:float' }, undefined, 'number', undefined],
    [
      'chọn một',
      { type: 'option', custom: 'x:select' },
      OPTIONS,
      'select',
      [
        { id: '1', label: 'Android' },
        { id: '2', label: 'iOS' },
      ],
    ],
    [
      'chọn nhiều',
      { type: 'array', items: 'option', custom: 'x:multiselect' },
      OPTIONS,
      'multiselect',
      [
        { id: '1', label: 'Android' },
        { id: '2', label: 'iOS' },
      ],
    ],
    [
      'priority',
      { type: 'priority', system: 'priority' },
      NAMED,
      'select',
      [
        { id: '3', label: 'High' },
        { id: '4', label: 'Low' },
      ],
    ],
    [
      'component',
      { type: 'array', items: 'component', system: 'components' },
      NAMED,
      'multiselect',
      [
        { id: '3', label: 'High' },
        { id: '4', label: 'Low' },
      ],
    ],
    [
      'version (nhiều)',
      { type: 'array', items: 'version', system: 'fixVersions' },
      NAMED,
      'multiselect',
      [
        { id: '3', label: 'High' },
        { id: '4', label: 'Low' },
      ],
    ],
    [
      'version (một)',
      { type: 'version', custom: 'x:version' },
      NAMED,
      'select',
      [
        { id: '3', label: 'High' },
        { id: '4', label: 'Low' },
      ],
    ],
    ['labels', { type: 'array', items: 'string', system: 'labels' }, undefined, 'text', undefined],
    ['ngày', { type: 'date', system: 'duedate' }, undefined, 'date', undefined],
  ])('%s', (_name, schema, allowedValues, kind, options) => {
    const field = jiraFieldToConnectorField(
      meta(schema, allowedValues ? { allowedValues: allowedValues as never } : {}),
    );

    expect(field).toMatchObject({
      id: 'field.customfield_10050',
      label: 'Nền tảng',
      kind,
      required: true,
    });
    expect('unsupported' in field).toBe(false);
    if (options !== undefined) expect(field).toMatchObject({ options });
  });

  it('labels có gợi ý cách nhập theo ngôn ngữ', () => {
    const labels = meta({ type: 'array', items: 'string', system: 'labels' });

    expect(jiraFieldToConnectorField(labels, 'vi')).toMatchObject({
      help: 'Nhiều nhãn thì cách nhau bằng dấu cách.',
    });
    expect(jiraFieldToConnectorField(labels, 'en')).toMatchObject({
      help: 'Separate labels with spaces.',
    });
  });
});

describe('jiraFieldToConnectorField — kiểu chưa hỗ trợ', () => {
  it.each<[string, JiraFieldSchema, string]>([
    ['người dùng', { type: 'user', system: 'assignee' }, 'user'],
    [
      'chọn phân cấp',
      {
        type: 'option-with-child',
        custom: 'com.atlassian.jira.plugin.system.customfieldtypes:cascadingselect',
      },
      'cascadingselect',
    ],
    [
      'sprint',
      { type: 'array', items: 'json', custom: 'com.pyxis.greenhopper.jira:gh-sprint' },
      'gh-sprint',
    ],
    ['epic link', { type: 'any', custom: 'com.pyxis.greenhopper.jira:gh-epic-link' }, 'gh-epic-link'],
    ['ngày giờ', { type: 'datetime' }, 'datetime'],
    ['mảng lạ', { type: 'array', items: 'user' }, 'array<user>'],
  ])('%s ⇒ { unsupported: true, name, type: %p }', (_name, schema, type) => {
    expect(jiraFieldToConnectorField(meta(schema, { name: 'Sprint' }))).toEqual({
      unsupported: true,
      name: 'Sprint',
      type,
    });
  });
});

describe('toJiraFieldValue', () => {
  it.each<[string, JiraFieldSchema, unknown, unknown]>([
    ['text', { type: 'string' }, 'Bản UAT', 'Bản UAT'],
    ['number (dấu phẩy thập phân)', { type: 'number' }, '12,5', 12.5],
    ['number', { type: 'number' }, ' 7 ', 7],
    ['select', { type: 'option' }, '1', { id: '1' }],
    ['priority', { type: 'priority' }, '3', { id: '3' }],
    ['version một', { type: 'version' }, '20', { id: '20' }],
    ['multiselect', { type: 'array', items: 'option' }, ['1', '2'], [{ id: '1' }, { id: '2' }]],
    ['multiselect một chuỗi', { type: 'array', items: 'option' }, '5', [{ id: '5' }]],
    ['component', { type: 'array', items: 'component' }, ['10'], [{ id: '10' }]],
    ['version nhiều', { type: 'array', items: 'version' }, ['20', '21'], [{ id: '20' }, { id: '21' }]],
    ['labels từ chuỗi', { type: 'array', items: 'string' }, ' ios  crash,login ', ['ios', 'crash', 'login']],
    ['labels từ mảng', { type: 'array', items: 'string' }, ['a', ' ', 'b'], ['a', 'b']],
    ['date', { type: 'date' }, '2026-11-06', '2026-11-06'],
    ['date dạng ISO', { type: 'date' }, '2026-11-06T10:00:00.000Z', '2026-11-06'],
  ])('%s', (_name, schema, value, expected) => {
    expect(toJiraFieldValue(meta(schema), value as never)).toEqual(expected);
  });

  it('textarea ⇒ tài liệu ADF, giữ chữ có dấu và xuống dòng', () => {
    expect(
      toJiraFieldValue(meta({ type: 'string', custom: 'x:textarea' }), 'Dòng một\nDòng hai'),
    ).toEqual({
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Dòng một' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Dòng hai' },
          ],
        },
      ],
    });
  });

  it.each<[string, JiraFieldSchema, unknown]>([
    ['text rỗng', { type: 'string' }, '   '],
    ['text vắng', { type: 'string' }, undefined],
    ['number sai', { type: 'number' }, 'abc'],
    ['select rỗng', { type: 'option' }, ''],
    ['multiselect rỗng', { type: 'array', items: 'option' }, []],
    ['labels chỉ khoảng trắng', { type: 'array', items: 'string' }, ' , '],
    ['date sai dạng', { type: 'date' }, 'ngày mai'],
    ['kiểu chưa hỗ trợ', { type: 'user' }, 'abc'],
    ['boolean', { type: 'string' }, true],
  ])('%s ⇒ undefined', (_name, schema, value) => {
    expect(toJiraFieldValue(meta(schema), value as never)).toBeUndefined();
  });
});

describe('fieldsToFill', () => {
  it('chỉ giữ trường bắt buộc chưa có mặc định, bỏ các trường connector tự điền', () => {
    const keep = meta({ type: 'string' }, { fieldId: 'customfield_1' });
    const all = [
      keep,
      meta({ type: 'string' }, { fieldId: 'customfield_2', required: false }),
      meta({ type: 'priority' }, { fieldId: 'priority', hasDefaultValue: true }),
      meta({ type: 'user', system: 'reporter' }, { fieldId: 'reporter', hasDefaultValue: true }),
      meta({ type: 'string', system: 'summary' }, { fieldId: 'summary' }),
      meta({ type: 'string', system: 'description' }, { fieldId: 'description' }),
      meta({ type: 'project', system: 'project' }, { fieldId: 'project' }),
      meta({ type: 'issuetype', system: 'issuetype' }, { fieldId: 'issuetype' }),
      meta({ type: 'array', items: 'attachment', system: 'attachment' }, { fieldId: 'attachment' }),
    ];

    expect(fieldsToFill(all)).toEqual([keep]);
  });
});

describe('đọc metadata (createmeta mới, có phân trang)', () => {
  it('listCreateFields gom 2 trang qua startAt/maxResults, không dùng `createmeta?expand`', async () => {
    const page = (startAt: number) =>
      `${BASE}/rest/api/3/issue/createmeta/10000/issuetypes/10001?startAt=${startAt}&maxResults=50`;
    const { ctx, urls } = makeCtx({
      [page(0)]: () =>
        reply({
          startAt: 0,
          maxResults: 2,
          total: 3,
          fields: [
            { fieldId: 'summary', name: 'Summary', required: true, schema: { type: 'string', system: 'summary' } },
            { fieldId: 'customfield_1', name: 'A', required: true, schema: { type: 'string' } },
          ],
        }),
      [page(2)]: () =>
        reply({
          startAt: 2,
          maxResults: 2,
          total: 3,
          fields: [
            { fieldId: 'customfield_2', name: 'B', required: false, schema: { type: 'number' }, hasDefaultValue: true },
            { name: 'hỏng: thiếu fieldId', schema: { type: 'string' } },
          ],
        }),
    });

    const fields = await listCreateFields(BASE, '10000', '10001', AUTH, ctx);

    expect(fields.map((f) => f.fieldId)).toEqual(['summary', 'customfield_1', 'customfield_2']);
    expect(fields[2]).toEqual({
      fieldId: 'customfield_2',
      name: 'B',
      required: false,
      hasDefaultValue: true,
      schema: { type: 'number' },
    });
    expect(urls()).toEqual([page(0), page(2)]);
    expect(urls().some((u) => u.includes('createmeta?'))).toBe(false);
  });

  it('listCreateFields nhận cả khoá `values` (một số bản Jira trả như vậy)', async () => {
    const { ctx } = makeCtx({
      [`${BASE}/rest/api/3/issue/createmeta/10000/issuetypes/10001?startAt=0&maxResults=50`]: () =>
        reply({
          startAt: 0,
          maxResults: 50,
          total: 1,
          values: [{ fieldId: 'labels', name: 'Labels', required: true, schema: { type: 'array', items: 'string' } }],
        }),
    });

    await expect(listCreateFields(BASE, '10000', '10001', AUTH, ctx)).resolves.toMatchObject([
      { fieldId: 'labels' },
    ]);
  });

  it('listIssueTypes bỏ loại sub-task (cần issue cha), gom trang', async () => {
    const page = (startAt: number) =>
      `${BASE}/rest/api/3/issue/createmeta/10000/issuetypes?startAt=${startAt}&maxResults=50`;
    const { ctx } = makeCtx({
      [page(0)]: () =>
        reply({
          startAt: 0,
          maxResults: 2,
          total: 3,
          issueTypes: [
            { id: '10001', name: 'Bug', subtask: false },
            { id: '10002', name: 'Sub-task', subtask: true },
          ],
        }),
      [page(2)]: () =>
        reply({ startAt: 2, maxResults: 2, total: 3, issueTypes: [{ id: '10003', name: 'Task' }] }),
    });

    await expect(listIssueTypes(BASE, '10000', AUTH, ctx)).resolves.toEqual([
      { id: '10001', label: 'Bug' },
      { id: '10003', label: 'Task' },
    ]);
  });

  it('listProjects gom trang tới `isLast`, id là id project, nhãn "Tên (KEY)"', async () => {
    const page = (startAt: number) =>
      `${BASE}/rest/api/3/project/search?startAt=${startAt}&maxResults=50`;
    const { ctx, urls } = makeCtx({
      [page(0)]: () =>
        reply({
          startAt: 0,
          maxResults: 1,
          isLast: false,
          values: [{ id: '10000', key: 'DEMO', name: 'Ứng dụng di động' }],
        }),
      [page(1)]: () =>
        reply({ startAt: 1, maxResults: 1, isLast: true, values: [{ id: '10001', key: 'WEB', name: 'Web' }] }),
    });

    await expect(listProjects(BASE, AUTH, ctx)).resolves.toEqual([
      { id: '10000', label: 'Ứng dụng di động (DEMO)' },
      { id: '10001', label: 'Web (WEB)' },
    ]);
    expect(urls()).toEqual([page(0), page(1)]);
  });
});
