import { base64Utf8 } from '../encoding';
import { ConnectorError, type ConnectorContext } from '../types';
import { JIRA_GATEWAY, jiraAuth, normalizeJiraSite, resolveJiraBase } from './base-url';

const SITE = 'https://acme.atlassian.net';
const CLOUD = '11111111-2222-3333-4444-555555555555';
const GW = `${JIRA_GATEWAY}/${CLOUD}`;
const EMAIL = 'nguyễn.qa@acme.vn';
const TOKEN = 'ATATT-secret-token-123';
const AUTH = jiraAuth(EMAIL, TOKEN);
const BASIC = base64Utf8(`${EMAIL}:${TOKEN}`);

const PROBE = '/rest/api/3/project/search?maxResults=1';
const MYSELF = '/rest/api/3/myself';
const TENANT = `GET ${SITE}/_edge/tenant_info`;

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), {
    status,
  });
const someProjects = () => reply(200, { values: [{ id: '10000', key: 'DEMO', name: 'Mobile' }] });
const noProjects = () => reply(200, { values: [], isLast: true, total: 0 });
const me = () => reply(200, { displayName: 'Nguyễn QA', emailAddress: EMAIL });
const tenant = () => reply(200, { cloudId: CLOUD });

/** fetch giả theo bảng `"<METHOD> <url>" → phản hồi`; request lạ ⇒ ném để test đỏ rõ ràng. */
const makeCtx = (routes: Record<string, () => Response | Promise<Response>>) => {
  const fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const route = routes[key];
    if (!route) throw new Error(`Unexpected request: ${key}`);
    return route();
  });
  const ctx: ConnectorContext = { fetch, locale: 'en', timeoutMs: 1000 };
  const calls = () => fetch.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`);
  return { ctx, fetch, calls };
};

describe('jiraAuth', () => {
  it('Basic là base64 của UTF-8 `email:token` (email có dấu); bí mật gồm token và chuỗi base64', () => {
    const auth = jiraAuth(`  ${EMAIL} `, ` ${TOKEN}\n`);

    expect(auth.header).toBe(`Basic ${BASIC}`);
    expect(auth.secrets).toEqual(expect.arrayContaining([TOKEN, BASIC]));
    expect(auth.email).toBe(EMAIL);
  });
});

describe('normalizeJiraSite', () => {
  it.each([
    ['acme.atlassian.net', SITE],
    ['https://acme.atlassian.net/', SITE],
    [' https://ACME.atlassian.net/jira/software/projects/DEMO/boards/1 ', SITE],
    ['https://acme.atlassian.net?x=1', SITE],
  ])('%p ⇒ origin https', (raw, expected) => {
    expect(normalizeJiraSite(raw)).toBe(expected);
  });

  it.each([
    'http://acme.atlassian.net',
    '',
    '   ',
    'not a url',
    'ftp://acme.atlassian.net',
    'https://user@acme.atlassian.net',
    'https://localhost',
    undefined,
    42,
  ])('%p ⇒ undefined (sai dạng hoặc không phải https)', (raw) => {
    expect(normalizeJiraSite(raw)).toBeUndefined();
  });
});

describe('resolveJiraBase', () => {
  it('site trả project ⇒ baseUrl = site, không đụng gateway; account là displayName', async () => {
    const { ctx, calls } = makeCtx({
      [`GET ${SITE}${PROBE}`]: someProjects,
      [`GET ${SITE}${MYSELF}`]: me,
    });

    await expect(resolveJiraBase(SITE, AUTH, ctx)).resolves.toEqual({
      baseUrl: SITE,
      account: 'Nguyễn QA',
    });
    expect(calls()).toEqual([`GET ${SITE}${PROBE}`, `GET ${SITE}${MYSELF}`]);
  });

  it.each([401, 404])(
    'site trả %p ⇒ đọc cloudId từ tenant_info, thử gateway, gateway chạy ⇒ baseUrl là gateway',
    async (status) => {
      const { ctx, calls } = makeCtx({
        [`GET ${SITE}${PROBE}`]: () => reply(status, { errorMessages: ['nope'] }),
        [TENANT]: tenant,
        [`GET ${GW}${PROBE}`]: someProjects,
        [`GET ${GW}${MYSELF}`]: me,
      });

      await expect(resolveJiraBase(SITE, AUTH, ctx)).resolves.toEqual({
        baseUrl: GW,
        cloudId: CLOUD,
        account: 'Nguyễn QA',
      });
      expect(calls()).toEqual([
        `GET ${SITE}${PROBE}`,
        TENANT,
        `GET ${GW}${PROBE}`,
        `GET ${GW}${MYSELF}`,
      ]);
    },
  );

  it('site trả 200 với danh sách rỗng (scoped token gọi nhầm site) ⇒ vẫn thử gateway; gateway có project ⇒ gateway', async () => {
    const { ctx } = makeCtx({
      [`GET ${SITE}${PROBE}`]: noProjects,
      [TENANT]: tenant,
      [`GET ${GW}${PROBE}`]: someProjects,
      [`GET ${GW}${MYSELF}`]: me,
    });

    await expect(resolveJiraBase(SITE, AUTH, ctx)).resolves.toMatchObject({
      baseUrl: GW,
      cloudId: CLOUD,
    });
  });

  it('site rỗng và gateway từ chối (token thường, thật sự không thấy project) ⇒ giữ site, đã thử gateway', async () => {
    const { ctx, calls } = makeCtx({
      [`GET ${SITE}${PROBE}`]: noProjects,
      [TENANT]: tenant,
      [`GET ${GW}${PROBE}`]: () => reply(401, 'Unauthorized'),
      [`GET ${SITE}${MYSELF}`]: me,
    });

    await expect(resolveJiraBase(SITE, AUTH, ctx)).resolves.toEqual({
      baseUrl: SITE,
      account: 'Nguyễn QA',
    });
    expect(calls()).toContain(`GET ${GW}${PROBE}`);
  });

  it('cả site lẫn gateway trả 401 ⇒ ConnectorError("auth"), message không lộ token hay chuỗi Basic', async () => {
    const { ctx } = makeCtx({
      [`GET ${SITE}${PROBE}`]: () => reply(401, `bad token ${TOKEN} / Basic ${BASIC}`),
      [TENANT]: tenant,
      [`GET ${GW}${PROBE}`]: () => reply(401, `still bad ${TOKEN}`),
    });

    const error = await resolveJiraBase(SITE, AUTH, ctx).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).kind).toBe('auth');
    expect((error as ConnectorError).message).not.toContain(TOKEN);
    expect((error as ConnectorError).message).not.toContain(BASIC);
  });

  it('site 401 và không đọc được cloudId ⇒ auth, không gọi gateway', async () => {
    const { ctx, calls } = makeCtx({
      [`GET ${SITE}${PROBE}`]: () => reply(401, ''),
      [TENANT]: () => reply(404, ''),
    });

    await expect(resolveJiraBase(SITE, AUTH, ctx)).rejects.toMatchObject({ kind: 'auth' });
    expect(calls().some((c) => c.includes(JIRA_GATEWAY))).toBe(false);
  });

  it.each([
    ['mạng (không có status)', 'network', () => Promise.reject(new ConnectorError('network', 'Network request failed'))],
    ['quá giờ (không có status)', 'uncertain', () => Promise.reject(new ConnectorError('uncertain', 'No response within 1000 ms'))],
    ['429', 'rate-limit', () => reply(429, '')],
    ['500', 'unknown', () => reply(500, '')],
    ['503', 'unknown', () => reply(503, '')],
  ] as const)(
    'site 401, tenant_info lỗi %s ⇒ ném đúng lỗi đó (không kết luận "token sai"), không gọi gateway',
    async (_case, kind, route) => {
      const { ctx, calls } = makeCtx({
        [`GET ${SITE}${PROBE}`]: () => reply(401, ''),
        [TENANT]: route,
      });

      const error = await resolveJiraBase(SITE, AUTH, ctx).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).kind).toBe(kind);
      expect(calls().some((c) => c.includes(JIRA_GATEWAY))).toBe(false);
    },
  );

  it('site và gateway đều 404 ⇒ validation trên ô `site`, message theo ngôn ngữ', async () => {
    const { ctx } = makeCtx({
      [`GET ${SITE}${PROBE}`]: () => reply(404, ''),
      [TENANT]: tenant,
      [`GET ${GW}${PROBE}`]: () => reply(404, ''),
    });

    await expect(resolveJiraBase(SITE, AUTH, ctx)).rejects.toMatchObject({
      kind: 'validation',
      field: 'site',
      message: 'No Jira was found at this address. Check the site URL.',
    });
  });

  it('site trả 403 (vd Atlassian Guard chặn token) ⇒ permission ngay, không thử gateway', async () => {
    const { ctx, calls } = makeCtx({
      [`GET ${SITE}${PROBE}`]: () => reply(403, 'API tokens are blocked'),
    });

    await expect(resolveJiraBase(SITE, AUTH, ctx)).rejects.toMatchObject({
      kind: 'permission',
    });
    expect(calls()).toEqual([`GET ${SITE}${PROBE}`]);
  });

  it.each([401, 403])('/myself trả %p ⇒ bỏ qua, account là email', async (status) => {
    const { ctx } = makeCtx({
      [`GET ${SITE}${PROBE}`]: someProjects,
      [`GET ${SITE}${MYSELF}`]: () => reply(status, ''),
    });

    await expect(resolveJiraBase(SITE, AUTH, ctx)).resolves.toEqual({
      baseUrl: SITE,
      account: EMAIL,
    });
  });

  it('mọi request mang `Authorization: Basic <base64Utf8(email:token)>` và nhận JSON', async () => {
    const { ctx, fetch } = makeCtx({
      [`GET ${SITE}${PROBE}`]: noProjects,
      [TENANT]: tenant,
      [`GET ${GW}${PROBE}`]: someProjects,
      [`GET ${GW}${MYSELF}`]: me,
    });

    await resolveJiraBase(SITE, AUTH, ctx);

    expect(fetch).toHaveBeenCalledTimes(4);
    for (const [, init] of fetch.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe(`Basic ${BASIC}`);
      expect(headers.get('accept')).toBe('application/json');
    }
  });
});
