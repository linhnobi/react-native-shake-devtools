import { StrictMode, type ReactElement } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { gorhomKit } from '../../kits/gorhom-kit';
import { plainKit } from '../../kits/plain-kit';
import { renderWithDevTools } from '../../testing/render-with-devtools';
import type { SheetKit } from '../../ui/sheet-kit';
import { darkTheme, lightTheme } from '../../ui/theme';
import {
  ConnectionListCorruptError,
  ConnectionStoreReadError,
  createConnectionStore,
  type ConnectionStore,
  type DevToolsSecureStore,
  type StoredConnection,
} from '../connections/connection-store';
import { builtinConnectorTypes } from '../connectors/builtin';
import type { ConnectorType } from '../connectors/types';
import { ConnectionsPage } from './ConnectionsPage';
import { ResetConnectionsNotice } from './ResetConnectionsNotice';

/** Kho bảo mật giả trong RAM. */
const memoryStore = (): DevToolsSecureStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
};

const types = builtinConnectorTypes;
const typeOf = (id: string): ConnectorType => types.find((t) => t.id === id) as ConnectorType;

const realStore = () => {
  const secure = memoryStore();
  const store = createConnectionStore(secure, {
    secretFieldIdsOf: (id) => types.find((t) => t.id === id)?.secretFieldIds ?? [],
  });
  return { secure, store };
};

const JIRA_TOKEN = 'ATATT-very-secret-1a2b';
const SLACK_HOOK = 'https://hooks.slack.com/services/T0/B0/zzzz9z8y';

const jira: StoredConnection = {
  id: 'c-jira',
  typeId: 'jira-cloud',
  name: 'Jira DEMO',
  ticketLocale: 'vi',
  values: { site: 'https://acme.atlassian.net', email: 'qa@acme.vn', project: '1', issueType: '2' },
  createdAt: 1,
};
const slack: StoredConnection = {
  id: 'c-slack',
  typeId: 'slack',
  name: 'Kênh QA',
  ticketLocale: 'en',
  values: { mode: 'webhook' },
  createdAt: 2,
};

const seeded = async () => {
  const { secure, store } = realStore();
  await store.save(jira, { token: JIRA_TOKEN });
  await store.save(slack, { webhookUrl: SLACK_HOOK });
  return { secure, store };
};

/** Kho kết nối giả cho các ca lỗi; mặc định danh sách rỗng và mọi thao tác thành công. */
const fakeStore = (over: Partial<ConnectionStore> = {}): ConnectionStore => ({
  list: jest.fn(async () => []),
  save: jest.fn(async () => undefined),
  remove: jest.fn(async () => undefined),
  secrets: jest.fn(async () => null),
  lastUsed: jest.fn(async () => null),
  setLastUsed: jest.fn(async () => undefined),
  resetAll: jest.fn(async () => undefined),
  ...over,
});

const handlers = () => ({ onAdd: jest.fn(), onEdit: jest.fn(), onBack: jest.fn() });
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));

/**
 * Gắn `ui` **sau** lượt render đầu, bên trong một `<StrictMode>` đã có — để React chạy kép effect lúc
 * gắn (gắn → dọn → gắn lại) như ở app dev, nơi trang được mở sau khi sheet đã có trên cây.
 */
const mountInStrictMode = (ui: ReactElement, kit: SheetKit) => {
  const result = renderWithDevTools(<StrictMode>{null}</StrictMode>, { kit });
  result.rerender(<StrictMode>{ui}</StrictMode>);
  return result;
};

const UNREADABLE =
  'Không đọc được kho bảo mật nhiều lần liền (có thể khoá của kho đã bị hệ điều hành thu hồi). Đặt lại sẽ xoá mọi kết nối đã lưu cùng bí mật của chúng; sau đó tạo lại từ đầu.';

describe.each([
  ['gorhom', gorhomKit],
  ['plain', plainKit],
] as const)('ConnectionsPage — kit %s', (_name, kit) => {
  const renderPage = (connections: ConnectionStore | null, h = handlers()) => {
    renderWithDevTools(
      <ConnectionsPage connections={connections} connectorTypes={types} {...h} />,
      { kit },
    );
    return h;
  };

  it('app không cấp secureStore ⇒ chỉ hiện "App chưa cấp kho bảo mật"', () => {
    renderPage(null);

    expect(screen.getByText('App chưa cấp kho bảo mật')).toBeOnTheScreen();
    expect(screen.queryByText('+ Thêm kết nối')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('connections-empty')).not.toBeOnTheScreen();
  });

  it('danh sách: tên, loại · mức (Nhẹ/Đầy đủ), bí mật chỉ hiện ••••xxxx', async () => {
    const { store } = await seeded();
    renderPage(store);

    const jiraRow = await screen.findByTestId('connection-row-c-jira');
    expect(within(jiraRow).getByText('Jira DEMO')).toBeOnTheScreen();
    expect(within(jiraRow).getByText('Jira Cloud · Đầy đủ')).toBeOnTheScreen();
    expect(within(jiraRow).getByText('API token ••••1a2b')).toBeOnTheScreen();

    const slackRow = screen.getByTestId('connection-row-c-slack');
    expect(within(slackRow).getByText('Kênh QA')).toBeOnTheScreen();
    expect(within(slackRow).getByText('Slack · Nhẹ')).toBeOnTheScreen();
    expect(within(slackRow).getByText('Webhook URL ••••9z8y')).toBeOnTheScreen();

    const rendered = JSON.stringify(screen.toJSON());
    expect(rendered).not.toContain(JIRA_TOKEN);
    expect(rendered).not.toContain(SLACK_HOOK);
  });

  it('chưa có kết nối ⇒ câu trống + nút Thêm', async () => {
    renderPage(realStore().store);

    expect(await screen.findByTestId('connections-empty')).toBeOnTheScreen();
    expect(screen.getByText('+ Thêm kết nối')).toBeOnTheScreen();
  });

  it('"+ Thêm kết nối" → chọn loại → onAdd(loại đó); Huỷ thì ẩn lựa chọn', async () => {
    const h = renderPage(realStore().store);
    await screen.findByTestId('connections-empty');

    fireEvent.press(screen.getByTestId('connections-add'));
    expect(screen.getByText('Chọn loại kết nối')).toBeOnTheScreen();
    for (const label of ['Jira Cloud', 'Slack', 'Lark / Feishu', 'Webhook']) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
    fireEvent.press(screen.getByTestId('connections-type-cancel'));
    expect(screen.queryByText('Chọn loại kết nối')).not.toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('connections-add'));
    fireEvent.press(screen.getByTestId('connections-type-slack'));
    expect(h.onAdd).toHaveBeenCalledTimes(1);
    expect(h.onAdd).toHaveBeenCalledWith(typeOf('slack'));
  });

  it('Sửa → onEdit(kết nối); Quay lại → onBack', async () => {
    const { store } = await seeded();
    const h = renderPage(store);

    fireEvent.press(await screen.findByTestId('connection-row-c-jira-edit'));
    expect(h.onEdit).toHaveBeenCalledWith(jira);

    fireEvent.press(screen.getByTestId('connections-back'));
    expect(h.onBack).toHaveBeenCalledTimes(1);
  });

  it('xoá có hỏi lại: Huỷ giữ nguyên; Xoá hẳn xoá cả bí mật và hàng biến mất', async () => {
    const { secure, store } = await seeded();
    renderPage(store);

    fireEvent.press(await screen.findByTestId('connection-row-c-jira-delete'));
    expect(
      screen.getByText('Xoá "Jira DEMO"? Bí mật đã lưu của kết nối này cũng bị xoá.'),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('connection-row-c-jira-cancel'));
    expect(screen.queryByTestId('connection-row-c-jira-confirm')).not.toBeOnTheScreen();
    expect(secure.data.has('devtools.secret.c-jira')).toBe(true);

    fireEvent.press(screen.getByTestId('connection-row-c-jira-delete'));
    fireEvent.press(screen.getByTestId('connection-row-c-jira-confirm'));

    await waitFor(() => expect(screen.queryByTestId('connection-row-c-jira')).not.toBeOnTheScreen());
    expect(screen.getByTestId('connection-row-c-slack')).toBeOnTheScreen();
    expect(secure.data.has('devtools.secret.c-jira')).toBe(false);
  });

  it('xoá lỗi thường ⇒ câu lỗi, không có nút Đặt lại', async () => {
    const store = fakeStore({
      list: jest.fn(async () => [jira]),
      remove: jest.fn(async () => Promise.reject(new Error('Keychain locked'))),
    });
    renderPage(store);

    fireEvent.press(await screen.findByTestId('connection-row-c-jira-delete'));
    fireEvent.press(screen.getByTestId('connection-row-c-jira-confirm'));

    expect(await screen.findByText('Không xoá được kết nối. Thử lại.')).toBeOnTheScreen();
    expect(screen.queryByText('Đặt lại kết nối')).not.toBeOnTheScreen();
    expect(screen.queryByText(/Keychain locked/)).not.toBeOnTheScreen();
  });

  it('danh sách hỏng (xoá ném lỗi đọc nghiêm ngặt) ⇒ "Đặt lại kết nối" gọi resetAll rồi tải lại', async () => {
    let listed: StoredConnection[] = [jira];
    const store = fakeStore({
      list: jest.fn(async () => listed),
      remove: jest.fn(async () => Promise.reject(new ConnectionListCorruptError())),
      resetAll: jest.fn(async () => {
        listed = [];
      }),
    });
    renderPage(store);

    fireEvent.press(await screen.findByTestId('connection-row-c-jira-delete'));
    fireEvent.press(screen.getByTestId('connection-row-c-jira-confirm'));

    expect(await screen.findByTestId('connections-corrupt')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Đặt lại kết nối'));

    expect(await screen.findByTestId('connections-empty')).toBeOnTheScreen();
    expect(store.resetAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('connections-corrupt')).not.toBeOnTheScreen();
  });

  it('list ném lỗi danh sách hỏng ⇒ hiện Đặt lại; đặt lại lỗi ⇒ báo lỗi, vẫn giữ nút', async () => {
    const store = fakeStore({
      list: jest.fn(async () => Promise.reject(new ConnectionListCorruptError())),
      resetAll: jest.fn(async () => Promise.reject(new Error('remove failed'))),
    });
    renderPage(store);

    expect(await screen.findByTestId('connections-corrupt')).toBeOnTheScreen();
    expect(screen.queryByText('+ Thêm kết nối')).not.toBeOnTheScreen();
    fireEvent.press(screen.getByText('Đặt lại kết nối'));

    expect(await screen.findByText('Không đặt lại được kết nối. Thử lại.')).toBeOnTheScreen();
    expect(screen.getByText('Đặt lại kết nối')).toBeOnTheScreen();
  });

  it('list ném lỗi khác ⇒ câu "Không đọc được danh sách", không đặt lại', async () => {
    renderPage(fakeStore({ list: jest.fn(async () => Promise.reject(new Error('get failed'))) }));

    expect(await screen.findByText('Không đọc được danh sách kết nối. Thử lại.')).toBeOnTheScreen();
    expect(screen.queryByText('Đặt lại kết nối')).not.toBeOnTheScreen();
  });

  /*
    Kho đọc hỏng VĨNH VIỄN (vd khoá Keystore Android bị thu hồi: `getItem` ném mãi) không bao giờ
    thành "danh sách hỏng" ⇒ ruling R39: hai lần xoá liền nhau hỏng vì lỗi ĐỌC kho mới đưa Đặt lại,
    kèm cảnh báo rằng mọi kết nối và bí mật sẽ mất. Một lần thành công ở giữa thì đếm lại.
  */
  it('xoá hỏng vì lỗi đọc kho: một lần ⇒ chỉ báo lỗi; hai lần liền ⇒ Đặt lại kèm cảnh báo', async () => {
    const readError = () => new ConnectionStoreReadError(new Error('Keystore key invalidated'));
    const store = fakeStore({
      list: jest.fn(async () => [jira, slack]),
      remove: jest
        .fn(async (_id: string) => undefined)
        .mockRejectedValueOnce(readError())
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(readError())
        .mockRejectedValueOnce(readError()),
    });
    const deleteJira = async () => {
      fireEvent.press(await screen.findByTestId('connection-row-c-jira-delete'));
      fireEvent.press(screen.getByTestId('connection-row-c-jira-confirm'));
    };
    renderPage(store);

    await deleteJira();
    expect(await screen.findByText('Không xoá được kết nối. Thử lại.')).toBeOnTheScreen();
    expect(screen.queryByText('Đặt lại kết nối')).not.toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('connection-row-c-slack-delete'));
    fireEvent.press(screen.getByTestId('connection-row-c-slack-confirm'));
    await waitFor(() => expect(store.list).toHaveBeenCalledTimes(2));

    await deleteJira();
    expect(await screen.findByText('Không xoá được kết nối. Thử lại.')).toBeOnTheScreen();
    expect(screen.queryByText('Đặt lại kết nối')).not.toBeOnTheScreen();

    await deleteJira();
    expect(await screen.findByText(UNREADABLE)).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Đặt lại kết nối'));

    await waitFor(() => expect(store.resetAll).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('connection-row-c-jira')).toBeOnTheScreen();
    expect(screen.queryByText(UNREADABLE)).not.toBeOnTheScreen();
  });

  /*
    StrictMode (dev) chạy effect hai lần khi gắn: gắn → dọn → gắn lại. Cờ "còn gắn" chỉ đặt ở lúc
    khởi tạo ref thì sau lượt dọn đầu nằm `false` mãi ⇒ trang kẹt "Đang tải…", khối Đặt lại kẹt bận.
    Gắn bằng `mountInStrictMode` (sau lượt render đầu, trong StrictMode có sẵn) — như trang mở sau
    trong app; gắn ngay ở lượt đầu dưới wrapper của `renderWithDevTools` thì React bỏ qua lượt chạy kép.
  */
  it('StrictMode: trang tải xong danh sách', async () => {
    const { store } = await seeded();
    mountInStrictMode(
      <ConnectionsPage connections={store} connectorTypes={types} {...handlers()} />,
      kit,
    );

    expect(await screen.findByTestId('connection-row-c-jira')).toBeOnTheScreen();
    expect(screen.queryByText('Đang tải kết nối…')).not.toBeOnTheScreen();
  });

  it('StrictMode: khối Đặt lại thôi bận và báo lỗi khi đặt lại hỏng', async () => {
    const store = fakeStore({
      list: jest.fn(async () => Promise.reject(new ConnectionListCorruptError())),
      resetAll: jest.fn(async () => Promise.reject(new Error('remove failed'))),
    });
    mountInStrictMode(
      <ConnectionsPage connections={store} connectorTypes={types} {...handlers()} />,
      kit,
    );

    fireEvent.press(await screen.findByText('Đặt lại kết nối'));

    expect(await screen.findByText('Không đặt lại được kết nối. Thử lại.')).toBeOnTheScreen();
    expect(screen.getByTestId('connections-corrupt-reset')).toBeEnabled();
    expect(screen.getByText('Đặt lại kết nối')).toBeOnTheScreen();
  });

  it('StrictMode: ResetConnectionsNotice thôi bận sau khi đặt lại (hỏng rồi thành công)', async () => {
    const resetAll = jest
      .fn(async () => undefined)
      .mockRejectedValueOnce(new Error('remove failed'));
    const onReset = jest.fn();
    mountInStrictMode(
      <ResetConnectionsNotice
        testID="notice"
        reason="unreadable"
        connections={fakeStore({ resetAll })}
        onReset={onReset}
      />,
      kit,
    );
    expect(screen.getByText(UNREADABLE)).toBeOnTheScreen();

    press('notice-reset');
    expect(await screen.findByText('Không đặt lại được kết nối. Thử lại.')).toBeOnTheScreen();
    expect(screen.getByTestId('notice-reset')).toBeEnabled();

    press('notice-reset');
    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('notice-reset')).toBeEnabled();
    expect(screen.queryByText('Không đặt lại được kết nối. Thử lại.')).not.toBeOnTheScreen();
  });

  it('kết nối trỏ tới loại app đã gỡ ⇒ hiện id loại, không có nút Sửa, vẫn xoá được', async () => {
    const orphan: StoredConnection = { ...jira, id: 'c-old', typeId: 'linear', name: 'Linear' };
    renderPage(fakeStore({ list: jest.fn(async () => [orphan]) }));

    const row = await screen.findByTestId('connection-row-c-old');
    expect(within(row).getByText('Loại "linear" không còn trong app')).toBeOnTheScreen();
    expect(screen.queryByTestId('connection-row-c-old-edit')).not.toBeOnTheScreen();
    expect(screen.getByTestId('connection-row-c-old-delete')).toBeOnTheScreen();
  });

  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ] as const)('chế độ %s: chữ và nền lấy màu của đúng theme', async (colorScheme, theme) => {
    const { store } = await seeded();
    renderWithDevTools(
      <ConnectionsPage connections={store} connectorTypes={types} {...handlers()} />,
      { kit, colorScheme },
    );

    const row = await screen.findByTestId('connection-row-c-jira');
    expect(row).toHaveStyle({ backgroundColor: theme.colors.background.surface });
    expect(within(row).getByText('Jira DEMO')).toHaveStyle({ color: theme.colors.text.primary });
    expect(within(row).getByText('Jira Cloud · Đầy đủ')).toHaveStyle({
      color: theme.colors.text.secondary,
    });
    expect(within(row).getByText('API token ••••1a2b')).toHaveStyle({
      color: theme.colors.text.tertiary,
    });
  });

  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ] as const)('chế độ %s: câu "App chưa cấp kho bảo mật" theo theme', (colorScheme, theme) => {
    renderWithDevTools(
      <ConnectionsPage connections={null} connectorTypes={types} {...handlers()} />,
      { kit, colorScheme },
    );

    expect(screen.getByText('App chưa cấp kho bảo mật')).toHaveStyle({
      color: theme.colors.text.secondary,
    });
  });
});

describe('ConnectionsPage — tiếng Anh', () => {
  it('chữ của trang theo ngôn ngữ giao diện', async () => {
    const { store } = await seeded();
    renderWithDevTools(
      <ConnectionsPage connections={store} connectorTypes={types} {...handlers()} />,
      { locale: 'en' },
    );

    expect(await screen.findByText('Slack · Light')).toBeOnTheScreen();
    expect(screen.getByText('Jira Cloud · Full')).toBeOnTheScreen();
    expect(screen.getByText('+ Add connection')).toBeOnTheScreen();
  });
});
