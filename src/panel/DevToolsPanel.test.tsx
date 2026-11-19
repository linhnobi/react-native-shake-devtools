import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { gorhomKit } from '../kits/gorhom-kit';
import { plainKit } from '../kits/plain-kit';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { logBuffer } from '../capture/log-buffer';
import type { ConsoleEntry, LogEntry, MarkerEntry, NetworkEntry } from '../capture/log-entry';
import type { StoredSession } from '../capture/log-session';
import { formatSessionInfo, type DevToolsSessionInfo } from '../capture/session-info';
import { getCaptureStartedAt } from '../capture/start-capture';
import type { DevToolsAction, DevToolsPanelProps } from '../gate/devtools-props';
import { darkTheme, lightTheme } from '../ui/theme';
import { copyText } from './copy-text';
import { DevToolsPanel } from './DevToolsPanel';

/* Bộ nhớ tạm là native — thay bằng spy để đọc đúng khối text panel đưa xuống. */
jest.mock('./copy-text', () => ({ copyText: jest.fn() }));

/*
  `previousSession` của `log-persist` không có setter public (chỉ `startPersistence` đọc đĩa mới
  ghi được vào nó) ⇒ thay hook đọc store bằng một biến test đổi được theo từng ca. Factory đọc
  biến LƯỜI, lúc render — không chạm TDZ dù `jest.mock` bị hoist lên trên khai báo.
*/
let mockPrevious: StoredSession | null = null;
jest.mock('./use-previous-session', () => ({ usePreviousSession: () => mockPrevious }));

const mockCopyText = jest.mocked(copyText);

const con = (id: number, level: ConsoleEntry['level'], text: string): ConsoleEntry => ({
  id,
  kind: 'console',
  at: id,
  level,
  text,
});

const net = (id: number, url: string, status?: number): NetworkEntry => ({
  id,
  kind: 'network',
  at: id,
  method: 'GET',
  url,
  status,
});

const marker = (id: number, label: string): MarkerEntry => ({
  id,
  kind: 'marker',
  at: id,
  type: 'screen',
  label,
});

const seed = (entries: LogEntry[]) => entries.forEach((e) => logBuffer.push(e));

const session = (over: Partial<StoredSession> = {}): StoredSession => ({
  format: 1,
  name: 'session-1790000000000.json',
  startedAt: 1790000000000,
  savedAt: 1790000300000,
  fatal: false,
  totalInMemory: 3,
  entries: [],
  ...over,
});

const actionsOf = (): DevToolsAction[] => [
  { id: 'sim', label: 'Giả lập lỗi mạng', onPress: jest.fn() },
  { id: 'env', label: 'Đổi môi trường', hint: 'UAT', onPress: jest.fn() },
  { id: 'reset', label: 'Xoá dữ liệu đăng nhập', onPress: jest.fn() },
];

const panel = (props: Partial<DevToolsPanelProps> = {}) => (
  <DevToolsPanel
    visible
    onDismiss={jest.fn()}
    actions={[]}
    onSnooze={jest.fn()}
    snoozeMinutes={30}
    {...props}
  />
);

const render = (props: Partial<DevToolsPanelProps> = {}) => renderWithDevTools(panel(props));

beforeEach(() => {
  logBuffer.clear();
  mockPrevious = null;
  mockCopyText.mockReset();
  mockCopyText.mockReturnValue(true);
});

describe('DevToolsPanel', () => {
  it('`visible=false` không vẽ gì', () => {
    render({ visible: false, subtitle: 'UAT · 1.0.2', actions: actionsOf() });

    expect(screen.queryByTestId('devtools-panel')).toBeNull();
    expect(screen.queryByText('Công cụ gỡ lỗi')).toBeNull();
    expect(screen.queryByTestId('devtools-row-info')).toBeNull();
    expect(screen.queryByTestId('devtools-row-sim')).toBeNull();
  });

  it('vẽ đủ N hàng theo `actions`', () => {
    const actions = actionsOf();
    render({ actions });

    actions.forEach((action) => {
      expect(screen.getByTestId(`devtools-row-${action.id}`)).toBeOnTheScreen();
      expect(screen.getByText(action.label)).toBeOnTheScreen();
    });
    expect(screen.getByText('UAT')).toBeOnTheScreen();
    /* Hàng có sẵn của lib vẫn còn bên cạnh hàng của app. */
    expect(screen.getByTestId('devtools-row-info')).toBeOnTheScreen();
    expect(screen.getByTestId('devtools-row-snooze')).toBeOnTheScreen();
  });

  it('`subtitle` vắng thì không vẽ dòng phụ', () => {
    const { rerender } = render({ subtitle: 'UAT · 1.0.2' });
    expect(screen.getByText('UAT · 1.0.2')).toBeOnTheScreen();

    rerender(panel());

    expect(screen.queryByText('UAT · 1.0.2')).toBeNull();
    expect(screen.getByText('Công cụ gỡ lỗi')).toBeOnTheScreen();
  });

  /* Thứ tự có nghĩa: callback phải thấy sheet vẫn còn `visible` lúc nó chạy. */
  it('bấm hàng có `dismissOnPress` mặc định ⇒ gọi `onPress` **rồi** `onDismiss`', () => {
    const calls: string[] = [];
    const onDismiss = jest.fn(() => void calls.push('dismiss'));
    render({
      onDismiss,
      actions: [{ id: 'sim', label: 'Giả lập lỗi mạng', onPress: () => void calls.push('press') }],
    });

    fireEvent.press(screen.getByTestId('devtools-row-sim'));

    expect(calls).toEqual(['press', 'dismiss']);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('`dismissOnPress: false` ⇒ không đóng', () => {
    const onPress = jest.fn();
    const onDismiss = jest.fn();
    render({
      onDismiss,
      actions: [{ id: 'sim', label: 'Giả lập lỗi mạng', onPress, dismissOnPress: false }],
    });

    fireEvent.press(screen.getByTestId('devtools-row-sim'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('devtools-panel')).toBeOnTheScreen();
  });

  describe('hàng chọn một', () => {
    const choiceAction = (onSelect = jest.fn()): DevToolsAction => ({
      id: 'network',
      label: 'Giả lập mạng',
      choices: [
        { id: 'off', label: 'Tắt' },
        { id: 'slow', label: 'Chậm' },
      ],
      selectedId: 'off',
      onSelect,
    });

    it('chip đang chọn mang `selected`, chip khác thì không', () => {
      render({ actions: [choiceAction()] });

      expect(screen.getByTestId('devtools-row-network-off').props.accessibilityState).toMatchObject({ selected: true });
      expect(screen.getByTestId('devtools-row-network-slow').props.accessibilityState).toMatchObject({ selected: false });
    });

    it('chạm chip ⇒ `onSelect(id)` và panel **không** đóng', () => {
      const onSelect = jest.fn();
      const onDismiss = jest.fn();
      render({ onDismiss, actions: [choiceAction(onSelect)] });

      fireEvent.press(screen.getByTestId('devtools-row-network-slow'));

      expect(onSelect).toHaveBeenCalledWith('slow');
      expect(onDismiss).not.toHaveBeenCalled();
    });
  });

  it('hàng tắt lắc gọi `onSnooze`', () => {
    const onSnooze = jest.fn();
    render({ onSnooze, snoozeMinutes: 30 });

    expect(screen.getByText('Tắt lắc trong 30 phút')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('devtools-row-snooze'));

    expect(onSnooze).toHaveBeenCalledTimes(1);
  });

  /* Huy hiệu đỏ đọc như "số lỗi" ⇒ nó phải LÀ số lỗi; tổng dòng (không tính mốc) nằm ở dòng phụ. */
  it('huy hiệu Nhật ký đếm **lỗi**, dòng phụ có tổng', () => {
    seed([
      con(1, 'error', 'TypeError: boom'),
      con(2, 'info', 'screen mounted'),
      net(3, 'https://api.test/user/list', 500),
      net(4, 'https://api.test/order/list', 200),
      marker(5, 'UserList'),
    ]);
    const onOpenLog = jest.fn();
    render({ onOpenLog });

    expect(screen.getByTestId('devtools-row-log-badge')).toHaveTextContent('2');
    expect(screen.getByText('4 dòng · 2 lỗi')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('devtools-row-log'));

    expect(onOpenLog).toHaveBeenCalledTimes(1);
  });

  it('hàng chép thông tin gọi bộ nhớ tạm với khối `formatSessionInfo` và hiện "Đã chép"', () => {
    const info: DevToolsSessionInfo = {
      appVersion: '1.0.2 (58)',
      env: 'UAT',
      device: 'Pixel 8',
      os: 'Android 14',
      user: '***812 · admin',
    };
    render({ sessionInfo: () => info });

    expect(screen.getByText('Chép thông tin thiết bị')).toBeOnTheScreen();
    expect(screen.getByText('Pixel 8 · Android 14 · 1.0.2 (58)')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('devtools-row-info'));

    expect(mockCopyText).toHaveBeenCalledTimes(1);
    expect(mockCopyText).toHaveBeenCalledWith(formatSessionInfo(info, getCaptureStartedAt()));
    expect(screen.getByText('Đã chép thông tin thiết bị')).toBeOnTheScreen();
  });

  it('phiên trước bị crash ⇒ dải báo + hàng Phiên trước, bấm gọi `onOpenPrevious`', () => {
    mockPrevious = session({
      fatal: true,
      entries: [
        con(1, 'error', 'TypeError: boom'),
        con(2, 'info', 'screen mounted'),
        marker(3, 'UserList'),
      ],
    });
    const onOpenPrevious = jest.fn();
    render({ onOpenPrevious });

    expect(screen.getByTestId('devtools-panel-crash')).toBeOnTheScreen();
    expect(screen.getByText('Lần trước app bị crash')).toBeOnTheScreen();
    expect(screen.getByText(/1 lỗi đã được giữ lại/)).toBeOnTheScreen();
    expect(screen.getByTestId('devtools-row-previous-badge')).toHaveTextContent('1');
    expect(screen.getByText(/· 2 dòng · 1 lỗi$/)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('devtools-panel-crash'));
    fireEvent.press(screen.getByTestId('devtools-row-previous'));

    expect(onOpenPrevious).toHaveBeenCalledTimes(2);
  });
});

describe('DevToolsPanel — hàng "Chép cho AI"', () => {
  /* Hook nhường một khung hình (`setTimeout 0`) trước khi dựng khối — đợi hai vòng macrotask, cùng
     cách `use-ai-copy.test.ts`. */
  const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const flush = () =>
    act(async () => {
      await macrotask();
      await macrotask();
    });

  it('vắng `onOpenLog` (app tắt nhật ký) ⇒ không có hàng', () => {
    render();

    expect(screen.queryByTestId('devtools-row-ai')).toBeNull();
  });

  it('đứng ngay dưới hàng Nhật ký, có dòng phụ nói khối gồm gì', () => {
    render({ onOpenLog: jest.fn() });

    expect(
      screen.getAllByTestId(/^devtools-row-(log|ai|info)$/).map((n) => n.props.testID as string),
    ).toEqual(['devtools-row-log', 'devtools-row-ai', 'devtools-row-info']);
    expect(screen.getByText('Chép cho AI')).toBeOnTheScreen();
    expect(
      screen.getByText('Lỗi, request và các bước dạng Markdown, để dán vào agent lập trình'),
    ).toBeOnTheScreen();
  });

  it('bấm ⇒ chép khối Markdown đã che của phiên đang chạy, hiện "Đã chép cho AI", panel không đóng', async () => {
    seed([
      net(1, 'https://api.test/user/list?access_token=raw-query-token', 500),
      con(2, 'error', 'TypeError: boom'),
    ]);
    const onDismiss = jest.fn();
    render({
      onOpenLog: jest.fn(),
      onDismiss,
      subtitle: 'UAT · 1.0.2',
      sessionInfo: () => ({ device: 'Pixel 8' }),
    });

    fireEvent.press(screen.getByTestId('devtools-row-ai'));
    await flush();

    expect(mockCopyText).toHaveBeenCalledTimes(1);
    const md = mockCopyText.mock.calls[0][0];
    expect(md).toMatch(/^# Debug context from a React Native app\n/);
    expect(md).toContain('`GET https://api.test/user/list?access_token=<redacted>` → 500');
    expect(md).toContain('TypeError: boom');
    expect(md).toContain('- Build: UAT · 1.0.2');
    expect(md).toContain('- Device: Pixel 8');
    expect(md).not.toContain('raw-query-token');
    expect(screen.getByText('Đã chép cho AI')).toBeOnTheScreen();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('tiếng Anh', async () => {
    renderWithDevTools(panel({ onOpenLog: jest.fn() }), { locale: 'en' });

    expect(screen.getByText('Copy for AI')).toBeOnTheScreen();
    expect(
      screen.getByText('Errors, requests and steps as Markdown, to paste into a coding agent'),
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('devtools-row-ai'));
    await flush();

    expect(screen.getByText('Copied for AI')).toBeOnTheScreen();
  });
});

describe('DevToolsPanel — hàng "Báo bug"', () => {
  const IMAGE = { uri: 'file:///shot.jpg', mimeType: 'image/jpeg', width: 10, height: 20 } as const;
  const report = (over: Partial<NonNullable<DevToolsPanelProps['report']>> = {}) => ({
    hasDraft: false,
    screenshot: IMAGE,
    steps: 4,
    onPress: jest.fn(),
    ...over,
  });
  /* Hàng (không tính dải báo crash) theo đúng thứ tự trên màn. */
  const rowIds = () =>
    screen
      .getAllByTestId(/^devtools-row-(report|log|previous|info|snooze|sim|env|reset)$/)
      .map((n) => n.props.testID as string);

  it('vắng `report` (app không khai `bugReport`) ⇒ không có hàng Báo bug', () => {
    render({ onOpenLog: jest.fn(), actions: actionsOf() });

    expect(screen.queryByTestId('devtools-row-report')).toBeNull();
    expect(screen.queryByText('Báo bug')).toBeNull();
  });

  it('là hàng ĐẦU TIÊN, đứng trên cả Nhật ký, Phiên trước và hàng của app; bấm gọi `onPress`', () => {
    mockPrevious = session({ fatal: true });
    const row = report();
    render({
      report: row,
      onOpenLog: jest.fn(),
      onOpenPrevious: jest.fn(),
      actions: actionsOf(),
    });

    expect(rowIds()).toEqual([
      'devtools-row-report',
      'devtools-row-log',
      'devtools-row-previous',
      'devtools-row-info',
      'devtools-row-sim',
      'devtools-row-env',
      'devtools-row-reset',
      'devtools-row-snooze',
    ]);
    expect(screen.getByText('Báo bug')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('devtools-row-report'));

    expect(row.onPress).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['có ảnh', report(), 'Ảnh đã chụp · 4 bước tự ghi'],
    ['màn chặn chụp', report({ screenshot: 'blocked' }), 'Màn này không cho chụp ảnh · 4 bước tự ghi'],
    ['hàm chụp ném', report({ screenshot: 'failed', steps: 2 }), 'Không chụp được ảnh · 2 bước tự ghi'],
    ['app không cấp hàm chụp', report({ screenshot: 'none', steps: 0 }), '0 bước tự ghi'],
    ['đang có bản nháp', report({ hasDraft: true }), 'Có bản nháp'],
    [
      'hàng đợi có bản chờ gửi và bản cần xử lý',
      report({ hasDraft: true, queue: { waiting: 2, attention: 1 } }),
      'Có bản nháp · 2 chờ gửi · 1 cần xử lý',
    ],
    [
      'hàng đợi chỉ có bản cần xử lý',
      report({ queue: { waiting: 0, attention: 3 } }),
      'Ảnh đã chụp · 4 bước tự ghi · 3 cần xử lý',
    ],
    ['hàng đợi trống (hoặc chỉ còn bản đã gửi)', report({ queue: { waiting: 0, attention: 0 } }), 'Ảnh đã chụp · 4 bước tự ghi'],
  ])('dòng phụ — %s', (_case, row, hint) => {
    render({ report: row });

    expect(within(screen.getByTestId('devtools-row-report')).getByText(hint)).toBeOnTheScreen();
  });

  it('tiếng Anh', () => {
    renderWithDevTools(panel({ report: report() }), { locale: 'en' });

    expect(screen.getByText('Report a bug')).toBeOnTheScreen();
    expect(screen.getByText('Screenshot taken · 4 recorded steps')).toBeOnTheScreen();
  });

  it('tiếng Anh — số bản trong hàng đợi', () => {
    renderWithDevTools(panel({ report: report({ queue: { waiting: 1, attention: 2 } }) }), {
      locale: 'en',
    });

    expect(
      screen.getByText('Screenshot taken · 4 recorded steps · 1 waiting · 2 need attention'),
    ).toBeOnTheScreen();
  });

  describe.each([
    ['gorhom', gorhomKit],
    ['plain', plainKit],
  ] as const)('kit %s', (_name, kit) => {
    it.each([
      ['light', lightTheme],
      ['dark', darkTheme],
    ] as const)('chế độ %s: chữ của hàng lấy màu của đúng theme', (colorScheme, theme) => {
      renderWithDevTools(panel({ report: report() }), { kit, colorScheme });

      expect(screen.getByText('Báo bug')).toHaveStyle({ color: theme.colors.text.primary });
      expect(screen.getByText('Ảnh đã chụp · 4 bước tự ghi')).toHaveStyle({
        color: theme.colors.text.tertiary,
      });
      expect(screen.getByTestId('devtools-row-report')).toHaveStyle({
        backgroundColor: theme.colors.background.surface,
      });
    });
  });
});

/*
  Nhiều hàng hơn chiều cao cho phép (example thêm cả chục hàng) thì panel phải cuộn được, không cắt
  mất hàng cuối ("Tạm dừng rung lắc") dưới thanh điều hướng. Vùng cuộn là chính `ScrollView` của bộ
  sheet — bản gorhom `BottomSheetScrollView`, bản thuần `ScrollView` — nên cả hai entry đều có.
*/
describe.each([
  ['gorhom', gorhomKit],
  ['plain', plainKit],
] as const)('DevToolsPanel cuộn được — kit %s', (_name, kit) => {
  const many = Array.from({ length: 40 }, (_v, i) => ({
    id: `a${i}`,
    label: `Hàng ${i}`,
    onPress: jest.fn(),
  }));

  it('mọi hàng, kể cả hàng cuối cùng, nằm trong một vùng cuộn', () => {
    renderWithDevTools(panel({ actions: many }), { kit });

    const scroll = screen.getByTestId('devtools-panel');
    expect(scroll.type).toBe('RCTScrollView');
    expect(within(scroll).getByTestId('devtools-row-a39')).toBeOnTheScreen();
    expect(within(scroll).getByTestId('devtools-row-snooze')).toBeOnTheScreen();
    expect(within(scroll).getByTestId('devtools-row-info')).toBeOnTheScreen();
  });

  it('ít hàng thì vẫn như cũ: vùng cuộn không chặn, hàng bấm được', () => {
    const onSnooze = jest.fn();
    renderWithDevTools(panel({ actions: actionsOf(), onSnooze }), { kit });

    fireEvent.press(screen.getByTestId('devtools-row-snooze'));

    expect(onSnooze).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('devtools-panel').props.scrollEnabled).not.toBe(false);
  });
});
