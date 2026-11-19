import { StrictMode, type ReactElement } from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import type { SheetKit } from '../../ui/sheet-kit';
import { gorhomKit } from '../../kits/gorhom-kit';
import { plainKit } from '../../kits/plain-kit';
import { canReadText, readText } from '../../panel/copy-text';
import { renderWithDevTools } from '../../testing/render-with-devtools';
import type { DevToolsLocale } from '../../i18n/types';
import { darkTheme, lightTheme } from '../../ui/theme';
import {
  ConnectionListCorruptError,
  ConnectionStoreReadError,
  type ConnectionStore,
  type StoredConnection,
} from '../connections/connection-store';
import { jiraCloudConnector } from '../connectors/jira';
import { slackConnector } from '../connectors/slack';
import {
  ConnectorError,
  type ConnectorContext,
  type ConnectorField,
  type ConnectorTestResult,
  type ConnectorType,
  type ConnectorValues,
} from '../connectors/types';
import { ConnectionEditor } from './ConnectionEditor';

/*
  Bộ nhớ tạm giả: `Clipboard` thật của lõi RN là getter có `warnOnce` (in cảnh báo deprecated vào
  output test), nên thay hẳn module bọc nó — test riêng của `copy-text` đã khoá phần chạm `Clipboard`.
*/
jest.mock('../../panel/copy-text', () => ({
  copyText: jest.fn(() => true),
  canReadText: jest.fn(() => true),
  readText: jest.fn(async () => '  pasted-secret-9876\n'),
}));

const TOKEN = 'ATATT-top-secret-token-1a2b';
const SITE = 'https://acme.atlassian.net';
const RESOLVED = { baseUrl: 'https://api.atlassian.com/ex/jira/cid-1', cloudId: 'cid-1' };
const PROJECTS = [
  { id: '10000', label: 'Mobile' },
  { id: '10001', label: 'Web' },
];
const PRIORITY: ConnectorField = {
  id: 'field.priority',
  label: 'Priority',
  kind: 'select',
  required: true,
  options: [
    { id: 'p1', label: 'High' },
    { id: 'p2', label: 'Low' },
  ],
};
const SPRINT_HELP =
  'Trường Sprint (kiểu gh-sprint) chưa hỗ trợ, nhờ admin đặt giá trị mặc định hoặc bỏ bắt buộc.';
const SPRINT: ConnectorField = {
  id: 'field.customfield_10020',
  label: 'Sprint',
  kind: 'text',
  required: true,
  unsupportedType: 'gh-sprint',
  help: SPRINT_HELP,
};

type TestFn = (
  values: ConnectorValues,
  secrets: ConnectorValues,
  ctx: ConnectorContext,
) => Promise<ConnectorTestResult>;

/** Loại giống Jira (id `jira-cloud`): project từ `test`, loại issue `dependsOn`, trường thêm. */
const makeJira = (extra: readonly ConnectorField[] = [PRIORITY]) => {
  const test = jest.fn<ReturnType<TestFn>, Parameters<TestFn>>(async () => ({
    account: 'Nguyễn QA',
    options: { project: PROJECTS },
    resolved: RESOLVED,
  }));
  const loadOptions = jest.fn(async (fieldId: string, values: ConnectorValues) => {
    if (fieldId !== 'issueType') return [];
    return values.project === '10000'
      ? [
          { id: '1', label: 'Bug' },
          { id: '2', label: 'Task' },
        ]
      : [{ id: '3', label: 'Story' }];
  });
  const loadExtraFields = jest.fn(async (_values: ConnectorValues) => extra);
  const type: ConnectorType = {
    id: 'jira-cloud',
    label: () => 'Jira Cloud',
    fields: () => [
      { id: 'site', label: 'Địa chỉ Jira', kind: 'url', required: true },
      { id: 'email', label: 'Email', kind: 'text', required: true },
      { id: 'token', label: 'API token', kind: 'secret', required: true },
      { id: 'project', label: 'Project', kind: 'select', required: true },
      { id: 'issueType', label: 'Loại issue', kind: 'select', required: true, dependsOn: 'project' },
    ],
    secretFieldIds: ['token'],
    capabilities: () => ({ image: true, files: true }),
    test,
    loadOptions,
    loadExtraFields,
    send: jest.fn(),
  };
  return { type, test, loadOptions, loadExtraFields };
};

/** Loại đơn giản kiểu webhook: một ô URL bắt buộc + một ô bí mật tuỳ chọn. */
const makeHook = (id = 'hook') => {
  const test = jest.fn<ReturnType<TestFn>, Parameters<TestFn>>(async () => ({}));
  const type: ConnectorType = {
    id,
    label: () => 'Hook',
    fields: () => [
      { id: 'url', label: 'URL nhận', kind: 'url', required: true, help: 'Dạng https://…' },
      { id: 'headerValue', label: 'Giá trị header', kind: 'secret' },
    ],
    secretFieldIds: ['headerValue'],
    capabilities: () => ({ image: true, files: true }),
    test,
    send: jest.fn(),
  };
  return { type, test };
};

/** Loại có mức đầy đủ mang bí mật sống lâu (như Slack bot / Lark app). */
const makeBot = () => {
  const test = jest.fn<ReturnType<TestFn>, Parameters<TestFn>>(async () => ({}));
  const type: ConnectorType = {
    id: 'bot',
    label: () => 'Bot',
    fields: () => [
      {
        id: 'mode',
        label: 'Cách kết nối',
        kind: 'select',
        required: true,
        options: [
          { id: 'webhook', label: 'Webhook' },
          { id: 'bot', label: 'Bot' },
        ],
      },
      {
        id: 'botToken',
        label: 'Bot token',
        kind: 'secret',
        required: true,
        visibleWhen: { field: 'mode', equals: 'bot' },
      },
    ],
    secretFieldIds: ['botToken'],
    capabilities: (v) => ({ image: v.mode === 'bot', files: v.mode === 'bot' }),
    longLivedSecret: (v) => v.mode === 'bot',
    test,
    send: jest.fn(),
  };
  return { type, test };
};

const fakeStore = (over: Partial<ConnectionStore> = {}) => ({
  list: jest.fn(async () => [] as readonly StoredConnection[]),
  save: jest.fn(async (_c: StoredConnection, _s: ConnectorValues) => undefined),
  remove: jest.fn(async () => undefined),
  secrets: jest.fn(async (_id: string): Promise<ConnectorValues | null> => null),
  lastUsed: jest.fn(async () => null),
  setLastUsed: jest.fn(async () => undefined),
  resetAll: jest.fn(async () => undefined),
  ...over,
});

const LONG_LIVED =
  'Bí mật này mở được mọi quyền của app và được lưu trên máy này. Nên nhờ admin tạo một app riêng cho báo bug với quyền tối thiểu (Slack: files:write, chat:write; Lark: im:resource và một quyền gửi tin). Có thể thu hồi bất cứ lúc nào ở console của nền tảng.';

const SAVE_FAILED = 'Không lưu được kết nối vào kho bảo mật. Thử lại.';
const UNREADABLE =
  'Không đọc được kho bảo mật nhiều lần liền (có thể khoá của kho đã bị hệ điều hành thu hồi). Đặt lại sẽ xoá mọi kết nối đã lưu cùng bí mật của chúng; sau đó tạo lại từ đầu.';

/**
 * Gắn `ui` **sau** lượt render đầu, bên trong một `<StrictMode>` đã có — để React chạy kép effect lúc
 * gắn (gắn → dọn → gắn lại) như ở app dev, nơi form được mở sau khi sheet đã có trên cây. Gắn ngay ở
 * lượt đầu dưới wrapper của `renderWithDevTools` thì React bỏ qua lượt chạy kép.
 */
const mountInStrictMode = (ui: ReactElement, kit: SheetKit) => {
  const result = renderWithDevTools(<StrictMode>{null}</StrictMode>, { kit });
  result.rerender(<StrictMode>{ui}</StrictMode>);
  return result;
};

const field = (id: string) => screen.getByTestId(`connection-field-${id}`);
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
const selected = (testID: string): boolean | undefined =>
  screen.getByTestId(testID).props.accessibilityState?.selected;

const fillJira = () => {
  fireEvent.changeText(field('site'), SITE);
  fireEvent.changeText(field('email'), 'qa@acme.vn');
  fireEvent.changeText(field('token'), TOKEN);
};

/** Thử kết nối thành công (đợi câu báo thành công). */
const testOk = async () => {
  press('connection-editor-test');
  await screen.findByTestId('connection-editor-test-ok');
};

/**
 * Jira giả: điền, thử, chọn Mobile → Bug, đợi trường thêm (Priority) hiện ra. Mỗi cú bấm gây việc
 * bất đồng bộ phải được theo **ngay** bởi một lần đợi — chen một `await` khác vào giữa là cập nhật
 * state rơi ra ngoài `act`.
 */
const jiraUpToIssueType = async () => {
  fillJira();
  await testOk();
  press('connection-field-project-10000');
  fireEvent.press(await screen.findByTestId('connection-field-issueType-1'));
  await screen.findByTestId('connection-field-field.priority-p1');
};

describe.each([
  ['gorhom', gorhomKit],
  ['plain', plainKit],
] as const)('ConnectionEditor — kit %s', (_name, kit) => {
  beforeEach(() => {
    jest.mocked(readText).mockClear();
    jest.mocked(canReadText).mockReturnValue(true);
    jest.mocked(readText).mockResolvedValue('  pasted-secret-9876\n');
  });

  const renderEditor = (
    type: ConnectorType,
    {
      connections = fakeStore(),
      initial,
      uiLocale = 'vi',
      locale = 'vi',
    }: {
      connections?: ReturnType<typeof fakeStore>;
      initial?: StoredConnection;
      uiLocale?: DevToolsLocale;
      locale?: DevToolsLocale;
    } = {},
  ) => {
    const onSaved = jest.fn();
    const onCancel = jest.fn();
    renderWithDevTools(
      <ConnectionEditor
        type={type}
        connections={connections}
        initial={initial}
        uiLocale={uiLocale}
        onSaved={onSaved}
        onCancel={onCancel}
      />,
      { kit, locale },
    );
    return { connections, onSaved, onCancel };
  };

  describe('dựng form từ schema', () => {
    it('Jira thật: các ô của fields("vi"), ô bí mật bị che, ô chọn chờ Thử kết nối', () => {
      renderEditor(jiraCloudConnector);

      expect(screen.getByTestId('connection-editor-name').props.value).toBe('Jira Cloud');
      for (const label of [
        'Tên kết nối',
        'Địa chỉ Jira',
        'Email tài khoản Atlassian',
        'API token',
        'Project',
        'Loại issue',
        'Ngôn ngữ ticket',
      ]) {
        expect(screen.getByText(label)).toBeOnTheScreen();
      }
      expect(screen.getByText('Dạng https://ten-cong-ty.atlassian.net')).toBeOnTheScreen();
      expect(field('token').props.secureTextEntry).toBe(true);
      expect(field('site').props.secureTextEntry).toBeFalsy();
      expect(
        within(field('project')).getByText('Bấm "Thử kết nối" để tải danh sách.'),
      ).toBeOnTheScreen();
      expect(within(field('issueType')).getByText('Chọn "Project" trước.')).toBeOnTheScreen();
    });

    it('ô Ngôn ngữ ticket có ở mọi loại, mặc định theo ngôn ngữ giao diện', () => {
      renderEditor(makeHook().type, { uiLocale: 'en', locale: 'en' });

      expect(screen.getByText('Ticket language')).toBeOnTheScreen();
      expect(selected('connection-editor-locale-en')).toBe(true);
      expect(selected('connection-editor-locale-vi')).toBe(false);
    });

    it('visibleWhen (Slack thật): ô hiện/ẩn theo "Cách kết nối"', () => {
      renderEditor(slackConnector);

      expect(screen.queryByTestId('connection-field-webhookUrl')).not.toBeOnTheScreen();
      expect(screen.queryByTestId('connection-field-botToken')).not.toBeOnTheScreen();

      press('connection-field-mode-webhook');
      expect(field('webhookUrl')).toBeOnTheScreen();
      expect(screen.queryByTestId('connection-field-channelId')).not.toBeOnTheScreen();

      press('connection-field-mode-bot');
      expect(screen.queryByTestId('connection-field-webhookUrl')).not.toBeOnTheScreen();
      expect(field('botToken')).toBeOnTheScreen();
      expect(field('channelId')).toBeOnTheScreen();
    });

    it('nút Dán đọc bộ nhớ tạm vào ô bí mật (bỏ khoảng trắng hai đầu)', async () => {
      renderEditor(slackConnector);
      press('connection-field-mode-webhook');

      press('connection-field-webhookUrl-paste');

      await waitFor(() => expect(field('webhookUrl').props.value).toBe('pasted-secret-9876'));
      expect(readText).toHaveBeenCalledTimes(1);
    });

    it('máy không đọc được bộ nhớ tạm ⇒ không có nút Dán, vẫn gõ được', () => {
      jest.mocked(canReadText).mockReturnValue(false);
      renderEditor(slackConnector);
      press('connection-field-mode-webhook');

      expect(screen.queryByTestId('connection-field-webhookUrl-paste')).not.toBeOnTheScreen();
      fireEvent.changeText(field('webhookUrl'), 'https://hooks.slack.com/x');
      expect(field('webhookUrl').props.value).toBe('https://hooks.slack.com/x');
    });
  });

  describe('Thử kết nối', () => {
    it('gọi type.test(values không bí mật, secrets, ctx theo ngôn ngữ GIAO DIỆN — R38) và điền lựa chọn', async () => {
      const { type, test } = makeJira();
      renderEditor(type);
      fillJira();

      await testOk();

      expect(screen.getByText('Kết nối thành công: Nguyễn QA')).toBeOnTheScreen();
      expect(field('project-10000')).toBeOnTheScreen();
      expect(within(field('project')).getByText('Web')).toBeOnTheScreen();
      expect(test).toHaveBeenCalledTimes(1);
      const [values, secrets, ctx] = test.mock.calls[0]!;
      expect(values).toEqual({ site: SITE, email: 'qa@acme.vn' });
      expect(secrets).toEqual({ token: TOKEN });
      expect(ctx.locale).toBe('vi');

      /* Ngôn ngữ ticket chỉ dành cho `send`; câu báo của Thử kết nối là cho QA đọc ở form này. */
      press('connection-editor-locale-en');
      await testOk();
      expect(test.mock.calls[1]![2].locale).toBe('vi');
    });

    it('R38: test · loadOptions · loadExtraFields nhận ctx theo ngôn ngữ giao diện, không theo ngôn ngữ ticket', async () => {
      const { type, test, loadOptions, loadExtraFields } = makeJira();
      renderEditor(type, { uiLocale: 'en', locale: 'en' });
      press('connection-editor-locale-vi');
      fillJira();
      await testOk();
      press('connection-field-project-10000');
      fireEvent.press(await screen.findByTestId('connection-field-issueType-1'));
      await screen.findByTestId('connection-field-field.priority-p1');

      expect(test.mock.calls[0]![2].locale).toBe('en');
      expect(loadOptions.mock.calls.length).toBeGreaterThan(0);
      for (const call of loadOptions.mock.calls) {
        expect((call as unknown as [string, unknown, unknown, ConnectorContext])[3].locale).toBe('en');
      }
      expect(loadExtraFields).toHaveBeenCalledTimes(1);
      expect(
        (loadExtraFields.mock.calls[0] as unknown as [unknown, unknown, ConnectorContext])[2].locale,
      ).toBe('en');
    });

    it('đổi ô cha ⇒ loadOptions của ô con (kèm resolved), ô con cũ bị xoá chọn', async () => {
      const { type, loadOptions } = makeJira();
      renderEditor(type);
      fillJira();
      await testOk();

      press('connection-field-project-10000');
      fireEvent.press(await screen.findByTestId('connection-field-issueType-1'));
      expect(loadOptions).toHaveBeenCalledWith(
        'issueType',
        { site: SITE, email: 'qa@acme.vn', project: '10000', ...RESOLVED },
        { token: TOKEN },
        expect.objectContaining({ locale: 'vi' }),
      );

      press('connection-field-project-10001');

      expect(await screen.findByTestId('connection-field-issueType-3')).toBeOnTheScreen();
      expect(screen.queryByTestId('connection-field-issueType-1')).not.toBeOnTheScreen();
      expect(loadOptions).toHaveBeenLastCalledWith(
        'issueType',
        expect.objectContaining({ project: '10001' }),
        { token: TOKEN },
        expect.anything(),
      );
      expect(selected('connection-field-issueType-3')).toBe(false);
    });

    it('chọn xong loại issue ⇒ loadExtraFields; trường chưa hỗ trợ chỉ hiện câu báo và khoá Lưu', async () => {
      const { type, loadExtraFields } = makeJira([PRIORITY, SPRINT]);
      renderEditor(type);
      await jiraUpToIssueType();

      expect(screen.getByTestId('connection-field-field.priority-p1')).toBeOnTheScreen();
      expect(loadExtraFields).toHaveBeenCalledTimes(1);
      expect(loadExtraFields.mock.calls[0]![0]).toEqual({
        site: SITE,
        email: 'qa@acme.vn',
        project: '10000',
        issueType: '1',
        ...RESOLVED,
      });
      expect(screen.getByText(SPRINT_HELP)).toBeOnTheScreen();
      expect(screen.getByTestId('connection-field-field.customfield_10020-unsupported')).toBeOnTheScreen();
      expect(screen.queryByTestId('connection-field-field.customfield_10020')).not.toBeOnTheScreen();

      press('connection-field-field.priority-p1');
      expect(screen.getByTestId('connection-editor-save')).toBeDisabled();
      expect(
        screen.getByText('Có trường bắt buộc chưa hỗ trợ nên chưa lưu được kết nối này.'),
      ).toBeOnTheScreen();
    });

    it('Lưu khoá tới khi thử thành công; sửa ô sau khi thử ⇒ khoá lại', async () => {
      const { type } = makeHook();
      renderEditor(type);
      fireEvent.changeText(field('url'), 'https://relay.acme.vn/bugs');

      expect(screen.getByTestId('connection-editor-save')).toBeDisabled();
      expect(
        screen.getByText('Cần "Thử kết nối" thành công với thông tin hiện tại trước khi lưu.'),
      ).toBeOnTheScreen();

      await testOk();
      expect(screen.getByTestId('connection-editor-save')).toBeEnabled();

      fireEvent.changeText(field('url'), 'https://relay.acme.vn/other');
      expect(screen.getByTestId('connection-editor-save')).toBeDisabled();
      expect(screen.queryByTestId('connection-editor-test-ok')).not.toBeOnTheScreen();
    });

    it('ô bắt buộc còn trống sau khi thử ⇒ Lưu khoá kèm lý do', async () => {
      const { type } = makeJira();
      renderEditor(type);
      fillJira();
      await testOk();

      expect(screen.getByTestId('connection-editor-save')).toBeDisabled();
      expect(screen.getByText('Còn ô bắt buộc chưa điền.')).toBeOnTheScreen();
    });
  });

  describe('Lưu', () => {
    it('lưu resolved vào values, bí mật chỉ đi qua secrets; không console nào chứa bí mật', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
        jest.spyOn(console, m),
      );
      const { type } = makeJira();
      const { connections, onSaved } = renderEditor(type);
      await jiraUpToIssueType();
      press('connection-field-field.priority-p1');

      press('connection-editor-save');

      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(connections.save).toHaveBeenCalledTimes(1);
      const [saved, secrets] = jest.mocked(connections.save).mock.calls[0]!;
      expect(secrets).toEqual({ token: TOKEN });
      expect(saved).toEqual({
        id: expect.stringMatching(/^conn-/),
        typeId: 'jira-cloud',
        name: 'Jira Cloud',
        ticketLocale: 'vi',
        values: {
          site: SITE,
          email: 'qa@acme.vn',
          project: '10000',
          issueType: '1',
          'field.priority': 'p1',
          ...RESOLVED,
        },
        createdAt: expect.any(Number),
      });
      expect(onSaved).toHaveBeenCalledWith(saved);
      expect(JSON.stringify(saved)).not.toContain(TOKEN);
      for (const spy of spies) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
        spy.mockRestore();
      }
    });

    it('tên và ngôn ngữ ticket QA chọn đi vào kết nối; Huỷ gọi onCancel', async () => {
      const { type } = makeHook();
      const { connections, onCancel } = renderEditor(type);
      fireEvent.changeText(screen.getByTestId('connection-editor-name'), '  Relay nội bộ ');
      fireEvent.changeText(field('url'), 'https://relay.acme.vn/bugs');
      press('connection-editor-locale-en');
      await testOk();

      press('connection-editor-save');

      await waitFor(() => expect(connections.save).toHaveBeenCalledTimes(1));
      expect(jest.mocked(connections.save).mock.calls[0]![0]).toMatchObject({
        typeId: 'hook',
        name: 'Relay nội bộ',
        ticketLocale: 'en',
        values: { url: 'https://relay.acme.vn/bugs' },
      });
      expect(jest.mocked(connections.save).mock.calls[0]![1]).toEqual({});

      press('connection-editor-cancel');
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('sau khi lưu, bí mật không còn trên màn — chỉ dạng ••••xxxx', async () => {
      const secret = 'hv-SECRET-abcd1234';
      const { type } = makeHook();
      const { onSaved } = renderEditor(type);
      fireEvent.changeText(field('url'), 'https://relay.acme.vn/bugs');
      fireEvent.changeText(field('headerValue'), secret);
      await testOk();

      press('connection-editor-save');
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

      expect(await screen.findByText('Đã lưu ••••1234. Để trống để giữ nguyên.')).toBeOnTheScreen();
      expect(field('headerValue').props.value).toBe('');
      expect(JSON.stringify(screen.toJSON())).not.toContain(secret);
    });

    it('sửa kết nối đã lưu: bí mật cũ chỉ hiện dạng che, được dùng để thử và giữ khi lưu', async () => {
      const saved = 'hv-SAVED-zz9876';
      const initial: StoredConnection = {
        id: 'c-1',
        typeId: 'hook',
        name: 'Relay',
        ticketLocale: 'en',
        values: { url: 'https://relay.acme.vn/bugs' },
        createdAt: 42,
      };
      const connections = fakeStore({ secrets: jest.fn(async () => ({ headerValue: saved })) });
      const { type, test } = makeHook();
      renderEditor(type, { connections, initial });

      expect(await screen.findByText('Đã lưu ••••9876. Để trống để giữ nguyên.')).toBeOnTheScreen();
      expect(field('url').props.value).toBe('https://relay.acme.vn/bugs');
      expect(screen.getByTestId('connection-editor-name').props.value).toBe('Relay');
      expect(selected('connection-editor-locale-en')).toBe(true);
      expect(JSON.stringify(screen.toJSON())).not.toContain(saved);

      await testOk();
      expect(test.mock.calls[0]![1]).toEqual({ headerValue: saved });
      press('connection-editor-save');

      await waitFor(() => expect(connections.save).toHaveBeenCalledTimes(1));
      expect(jest.mocked(connections.save).mock.calls[0]).toEqual([
        { ...initial, values: { url: 'https://relay.acme.vn/bugs' } },
        { headerValue: saved },
      ]);
    });

    it('longLivedSecret ⇒ cảnh báo 5.4.2 hiện một lần trước khi lưu', async () => {
      const { type } = makeBot();
      const { connections } = renderEditor(type);
      press('connection-field-mode-bot');
      fireEvent.changeText(field('botToken'), 'xoxb-1-2-abcd');
      await testOk();

      press('connection-editor-save');
      expect(screen.getByText(LONG_LIVED)).toBeOnTheScreen();
      expect(connections.save).not.toHaveBeenCalled();

      press('connection-editor-warning-cancel');
      expect(screen.queryByText(LONG_LIVED)).not.toBeOnTheScreen();
      press('connection-editor-save');
      expect(screen.getByText(LONG_LIVED)).toBeOnTheScreen();

      press('connection-editor-warning-confirm');
      await waitFor(() => expect(connections.save).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(LONG_LIVED)).not.toBeOnTheScreen();

      press('connection-editor-save');
      await waitFor(() => expect(connections.save).toHaveBeenCalledTimes(2));
      expect(screen.queryByText(LONG_LIVED)).not.toBeOnTheScreen();
    });

    it('mức nhẹ, hoặc sửa kết nối vốn đã sống lâu ⇒ không cảnh báo', async () => {
      const { type } = makeBot();
      const initial: StoredConnection = {
        id: 'c-bot',
        typeId: 'bot',
        name: 'Bot',
        ticketLocale: 'vi',
        values: { mode: 'bot' },
        createdAt: 1,
      };
      const connections = fakeStore({ secrets: jest.fn(async () => ({ botToken: 'xoxb-old-1111' })) });
      renderEditor(type, { connections, initial });
      await screen.findByText('Đã lưu ••••1111. Để trống để giữ nguyên.');
      await testOk();

      press('connection-editor-save');

      await waitFor(() => expect(connections.save).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(LONG_LIVED)).not.toBeOnTheScreen();
    });

    it('lưu ném lỗi danh sách hỏng ⇒ "Đặt lại kết nối" gọi resetAll, rồi Lưu lại được', async () => {
      const save = jest
        .fn(async (_c: StoredConnection, _s: ConnectorValues) => undefined)
        .mockRejectedValueOnce(new ConnectionListCorruptError());
      const connections = fakeStore({ save });
      const { type } = makeHook();
      const { onSaved } = renderEditor(type, { connections });
      fireEvent.changeText(field('url'), 'https://relay.acme.vn/bugs');
      await testOk();

      press('connection-editor-save');
      expect(await screen.findByTestId('connection-editor-corrupt')).toBeOnTheScreen();
      expect(onSaved).not.toHaveBeenCalled();

      fireEvent.press(screen.getByText('Đặt lại kết nối'));
      await waitFor(() => expect(screen.queryByTestId('connection-editor-corrupt')).not.toBeOnTheScreen());
      expect(connections.resetAll).toHaveBeenCalledTimes(1);

      press('connection-editor-save');
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(save.mock.calls[1]![0].id).toBe(save.mock.calls[0]![0].id);
    });

    it('lưu lỗi khác ⇒ câu lỗi chung, không lộ thông điệp gốc, không có Đặt lại', async () => {
      const connections = fakeStore({
        save: jest.fn(async () => Promise.reject(new Error('Keychain: user canceled'))),
      });
      const { type } = makeHook();
      renderEditor(type, { connections });
      fireEvent.changeText(field('url'), 'https://relay.acme.vn/bugs');
      await testOk();

      press('connection-editor-save');

      expect(
        await screen.findByText('Không lưu được kết nối vào kho bảo mật. Thử lại.'),
      ).toBeOnTheScreen();
      expect(screen.queryByText(/user canceled/)).not.toBeOnTheScreen();
      expect(screen.queryByText('Đặt lại kết nối')).not.toBeOnTheScreen();
    });

    /* Ruling R39: kho đọc hỏng vĩnh viễn (Keystore bị thu hồi) không bao giờ là "danh sách hỏng". */
    it('lỗi đọc kho: một lần ⇒ không Đặt lại; thành công ở giữa thì đếm lại; hai lần liền ⇒ Đặt lại + cảnh báo', async () => {
      const readError = () => new ConnectionStoreReadError(new Error('Keystore key invalidated'));
      const save = jest
        .fn(async (_c: StoredConnection, _s: ConnectorValues) => undefined)
        .mockRejectedValueOnce(readError())
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(readError())
        .mockRejectedValueOnce(readError());
      const connections = fakeStore({ save });
      const { type } = makeHook();
      const { onSaved } = renderEditor(type, { connections });
      fireEvent.changeText(field('url'), 'https://relay.acme.vn/bugs');
      await testOk();
      const failedOnce = async () => {
        press('connection-editor-save');
        expect(await screen.findByText(SAVE_FAILED)).toBeOnTheScreen();
        expect(screen.queryByText('Đặt lại kết nối')).not.toBeOnTheScreen();
      };

      await failedOnce();
      press('connection-editor-save');
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      await failedOnce();

      press('connection-editor-save');
      expect(await screen.findByText(UNREADABLE)).toBeOnTheScreen();
      expect(screen.queryByText(SAVE_FAILED)).not.toBeOnTheScreen();

      press('connection-editor-unreadable-reset');
      await waitFor(() => expect(screen.queryByText(UNREADABLE)).not.toBeOnTheScreen());
      expect(connections.resetAll).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledTimes(4);
    });

    it('bấm Lưu hai lần liền (cùng một khung hình) ⇒ chỉ một lần save và onSaved', async () => {
      const { type } = makeHook();
      const { connections, onSaved } = renderEditor(type);
      fireEvent.changeText(field('url'), 'https://relay.acme.vn/bugs');
      await testOk();

      act(() => {
        press('connection-editor-save');
        press('connection-editor-save');
      });

      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(connections.save).toHaveBeenCalledTimes(1);
    });

    it('bấm "Đã hiểu, lưu" hai lần liền ⇒ chỉ một lần save và onSaved', async () => {
      const { type } = makeBot();
      const { connections, onSaved } = renderEditor(type);
      press('connection-field-mode-bot');
      fireEvent.changeText(field('botToken'), 'xoxb-1-2-abcd');
      await testOk();
      press('connection-editor-save');

      act(() => {
        press('connection-editor-warning-confirm');
        press('connection-editor-warning-confirm');
      });

      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(connections.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('đang thử thì sửa ô / StrictMode', () => {
    it('sửa token giữa lúc đang thử ⇒ thử lại được ngay; kết quả cũ về sau không đụng lượt mới', async () => {
      const { type, test } = makeHook();
      const pending: Array<(r: ConnectorTestResult) => void> = [];
      const deferred = () =>
        new Promise<ConnectorTestResult>((resolve) => {
          pending.push(resolve);
        });
      test.mockImplementationOnce(deferred).mockImplementationOnce(deferred);
      renderEditor(type);
      fireEvent.changeText(field('url'), 'https://relay.acme.vn/bugs');

      press('connection-editor-test');
      expect(screen.getByTestId('connection-editor-test')).toBeDisabled();

      fireEvent.changeText(field('headerValue'), 'fixed-secret-5678');
      expect(screen.getByTestId('connection-editor-test')).toBeEnabled();

      press('connection-editor-test');
      expect(test).toHaveBeenCalledTimes(2);
      await act(async () => {
        pending[0]!({ account: 'Kết quả cũ' });
      });
      expect(screen.getByTestId('connection-editor-test')).toBeDisabled();
      expect(screen.queryByTestId('connection-editor-test-ok')).not.toBeOnTheScreen();

      await act(async () => {
        pending[1]!({ account: 'Lượt mới' });
      });
      expect(screen.getByText('Kết nối thành công: Lượt mới')).toBeOnTheScreen();
      expect(screen.getByTestId('connection-editor-test')).toBeEnabled();
      expect(screen.getByTestId('connection-editor-save')).toBeEnabled();
    });

    it('StrictMode: Dán chạy, Thử kết nối tới "Kết nối thành công", Lưu mở khoá và lưu được', async () => {
      const { type } = makeHook();
      const onSaved = jest.fn();
      mountInStrictMode(
        <ConnectionEditor
          type={type}
          connections={fakeStore()}
          uiLocale="vi"
          onSaved={onSaved}
          onCancel={jest.fn()}
        />,
        kit,
      );
      fireEvent.changeText(field('url'), 'https://relay.acme.vn/bugs');

      press('connection-field-headerValue-paste');
      await waitFor(() => expect(field('headerValue').props.value).toBe('pasted-secret-9876'));

      await testOk();
      expect(screen.getByTestId('connection-editor-test')).toBeEnabled();
      expect(screen.getByTestId('connection-editor-save')).toBeEnabled();

      press('connection-editor-save');
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('connection-editor-save')).toBeEnabled();
    });

    it('StrictMode: lưu hỏng không để nút Lưu kẹt ở trạng thái đang lưu', async () => {
      const { type } = makeHook();
      mountInStrictMode(
        <ConnectionEditor
          type={type}
          connections={fakeStore({
            save: jest.fn(async () => Promise.reject(new Error('set failed'))),
          })}
          uiLocale="vi"
          onSaved={jest.fn()}
          onCancel={jest.fn()}
        />,
        kit,
      );
      fireEvent.changeText(field('url'), 'https://relay.acme.vn/bugs');
      await testOk();

      press('connection-editor-save');

      expect(await screen.findByText(SAVE_FAILED)).toBeOnTheScreen();
      expect(screen.getByTestId('connection-editor-save')).toBeEnabled();
    });
  });

  describe('câu báo lỗi khi thử kết nối', () => {
    /**
     * Dựng form với `test` ném `error`, điền và bấm Thử. Hàm đồng bộ: người gọi đợi câu lỗi NGAY sau
     * đó — một `await` chen giữa làm cập nhật state rơi ra ngoài `act`.
     */
    const failWith = (error: unknown, typeId = 'jira-cloud') => {
      const { type, test } = makeJira();
      test.mockRejectedValueOnce(error);
      renderEditor({ ...type, id: typeId });
      fillJira();
      press('connection-editor-test');
    };

    it.each([
      [
        'auth',
        new ConnectorError('auth', 'HTTP 401: Unauthorized'),
        'Sai email hoặc token, hoặc token đã hết hạn',
      ],
      [
        'permission của Jira',
        new ConnectorError('permission', 'HTTP 403: Forbidden'),
        'Không đủ quyền, hoặc tổ chức chặn API token (Atlassian Guard). Liên hệ admin Jira',
      ],
      [
        'network',
        new ConnectorError('network', 'Network request failed'),
        'Không có mạng hoặc không tới được máy chủ. Kiểm tra mạng rồi thử lại.',
      ],
      [
        'uncertain',
        new ConnectorError('uncertain', 'No response within 30000 ms'),
        'Máy chủ không trả lời kịp. Thử lại sau.',
      ],
      [
        'rate-limit',
        new ConnectorError('rate-limit', 'HTTP 429'),
        'Đích đang giới hạn tần suất. Thử lại sau ít phút.',
      ],
      ['lỗi lạ (không phải ConnectorError)', new TypeError('boom'), 'Không thử được kết nối.'],
    ])('%s', async (_kind, error, message) => {
      failWith(error);

      expect(await screen.findByText(message)).toBeOnTheScreen();
      expect(screen.getByTestId('connection-editor-save')).toBeDisabled();
      expect(screen.queryByText('boom')).not.toBeOnTheScreen();
    });

    it('permission của loại khác ⇒ câu của loại kết nối', async () => {
      failWith(
        new ConnectorError('permission', 'Bot chưa ở trong kênh này.'),
        'slack-like',
      );

      expect(await screen.findByText('Bot chưa ở trong kênh này.')).toBeOnTheScreen();
      expect(screen.queryByText(/Atlassian Guard/)).not.toBeOnTheScreen();
    });

    it('validation có field ⇒ câu nằm ngay dưới ô đó', async () => {
      failWith(
        new ConnectorError('validation', 'Chưa điền "Email".', { field: 'email' }),
      );

      const error = await screen.findByTestId('connection-field-email-error');
      expect(error).toHaveTextContent('Chưa điền "Email".');
      expect(screen.queryByTestId('connection-editor-error')).not.toBeOnTheScreen();
    });

    it('lỗi unknown: chi tiết của đích được hiện nhưng bí mật đang nhập bị che', async () => {
      failWith(new ConnectorError('unknown', `HTTP 500: token ${TOKEN} rejected`));

      expect(await screen.findByText('Không thử được kết nối.')).toBeOnTheScreen();
      expect(screen.getByText('HTTP 500: token •••• rejected')).toBeOnTheScreen();
      expect(JSON.stringify(screen.toJSON())).not.toContain(`token ${TOKEN}`);
    });
  });

  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ] as const)('chế độ %s: nhãn, ô nhập, gợi ý và lỗi lấy màu của đúng theme', async (colorScheme, theme) => {
    const { type, test } = makeHook();
    test.mockRejectedValueOnce(new ConnectorError('network', 'offline'));
    renderWithDevTools(
      <ConnectionEditor
        type={type}
        connections={fakeStore()}
        uiLocale="vi"
        onSaved={jest.fn()}
        onCancel={jest.fn()}
      />,
      { kit, colorScheme },
    );

    expect(screen.getByText('URL nhận')).toHaveStyle({ color: theme.colors.text.primary });
    expect(screen.getByText('Dạng https://…')).toHaveStyle({ color: theme.colors.text.tertiary });
    expect(field('url')).toHaveStyle({
      color: theme.colors.text.primary,
      borderColor: theme.colors.border.strong,
      backgroundColor: theme.colors.background.surface,
    });
    expect(screen.getByTestId('connection-editor')).toHaveStyle({
      backgroundColor: theme.colors.background.surface,
    });

    fireEvent.changeText(field('url'), 'https://relay.acme.vn/bugs');
    press('connection-editor-test');
    expect(
      await screen.findByText('Không có mạng hoặc không tới được máy chủ. Kiểm tra mạng rồi thử lại.'),
    ).toHaveStyle({ color: theme.colors.text.danger });
  });
});
