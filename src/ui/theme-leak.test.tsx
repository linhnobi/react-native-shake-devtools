import { act, fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { gorhomKit } from '../kits/gorhom-kit';
import { plainKit } from '../kits/plain-kit';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { logBuffer } from '../capture/log-buffer';
import type { LogEntry, NetworkEntry } from '../capture/log-entry';
import type { StoredSession } from '../capture/log-session';
import { LogDetail, type DetailTab } from '../panel/LogDetail';
import { DevToolsPanel } from '../panel/DevToolsPanel';
import { LogSheet } from '../panel/LogSheet';
import { darkTheme, lightTheme, type DevToolsTheme } from './theme';
import type { SheetKit } from './sheet-kit';

/*
  Bộ test "không rò màu" cho dark mode. Một hàm gom MỌI màu thật sự được vẽ ra (style của từng
  host node + `placeholderTextColor`/`selectionColor`) rồi khẳng định chúng đều là token của đúng
  theme đang bật: không có màu của theme kia lọt vào (nền trắng trong dark, chữ đen trên nền tối)
  và không có màu "tay" ngoài bảng. Kiểm trên cả hai entry (kit gorhom · kit thuần) × hai chế độ,
  qua các màn có nhiều trạng thái nhất. Đây là lưới bắt lỗi kiểu "context của theme không tới
  nội dung trong portal của gorhom" (theme rơi về hệ thống ⇒ sáng) mà không cần đoán trước thành phần.

  `ReanimatedSwipeable` thật cần gesture-handler native — thay bằng vỏ trong suốt vẽ dải nút trái
  (nút Chép, nền `success`) rồi tới nội dung hàng.
*/
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const { createElement, Fragment } = jest.requireActual('react');
  const methods = { close: jest.fn(), openLeft: jest.fn(), openRight: jest.fn(), reset: jest.fn() };
  return {
    __esModule: true,
    default: ({
      children,
      renderLeftActions,
    }: {
      children?: unknown;
      renderLeftActions?: (p: unknown, t: unknown, s: typeof methods) => unknown;
    }) => createElement(Fragment, null, renderLeftActions?.({}, {}, methods), children),
  };
});

let mockPrevious: StoredSession | null = null;
jest.mock('../panel/use-previous-session', () => ({ usePreviousSession: () => mockPrevious }));
jest.mock('../panel/copy-text', () => ({ copyText: jest.fn(() => true) }));

/*
  Mỗi ca dựng cả một màn đầy đủ (panel, màn nhật ký, chi tiết request) rồi duyệt hết cây để gom màu.
  Chạy riêng thì mỗi ca vài trăm ms, nhưng khi cả bộ test chạy song song trên máy đang tải, vài ca nặng
  từng vượt trần mặc định 5 s của jest (lỗi timeout, không phải lỗi màu). Nới trần cho riêng file này;
  mọi khẳng định giữ nguyên.
*/
jest.setTimeout(20_000);

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown };

/** Khoá style mang màu. */
const COLOR_STYLE_KEYS = [
  'color',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderRightColor',
  'tintColor',
  'shadowColor',
  'textDecorationColor',
] as const;

/** Prop (ngoài `style`) mang màu — ô nhập. */
const COLOR_PROPS = ['placeholderTextColor', 'selectionColor', 'underlineColorAndroid'] as const;

/** Gom mọi màu đang vẽ trong cây đã render. */
const paintedColors = (): Set<string> => {
  const found = new Set<string>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const { props, children } = node as Node;
    const style = StyleSheet.flatten(props?.style as never) as Record<string, unknown> | undefined;
    for (const key of COLOR_STYLE_KEYS) {
      const v = style?.[key];
      if (typeof v === 'string') found.add(v);
    }
    for (const key of COLOR_PROPS) {
      const v = props?.[key];
      if (typeof v === 'string') found.add(v);
    }
    visit(children);
  };
  visit(screen.toJSON());
  return found;
};

/** Mọi màu hợp lệ của một theme: token nhóm `colors` + bậc palette mà chế độ đó đọc. */
const allowedOf = (theme: DevToolsTheme): Set<string> => {
  const out = new Set<string>(['transparent']);
  for (const group of Object.values(theme.colors)) for (const v of Object.values(group)) out.add(v);
  const step = theme.mode === 'dark' ? 300 : 700;
  for (const hue of Object.values(theme.palette)) out.add(hue[step]);
  return out;
};

const THEMES = { light: lightTheme, dark: darkTheme } as const;
type Mode = keyof typeof THEMES;
const KITS: ReadonlyArray<readonly [string, SheetKit]> = [
  ['gorhom', gorhomKit],
  ['plain', plainKit],
];

/** Khẳng định cây đang vẽ chỉ chứa màu của `mode` — và đã vẽ đủ nhiều màu để phép kiểm có nghĩa. */
const expectOnlyThemeColors = (mode: Mode) => {
  const painted = paintedColors();
  const allowed = allowedOf(THEMES[mode]);
  const other = allowedOf(THEMES[mode === 'dark' ? 'light' : 'dark']);
  const stray = [...painted].filter((c) => !allowed.has(c));
  const leaked = [...painted].filter((c) => other.has(c) && !allowed.has(c));
  expect({ mode, stray, leaked }).toEqual({ mode, stray: [], leaked: [] });
  /* Không vẽ ra màu nào thì phép kiểm trống rỗng. */
  expect(painted.size).toBeGreaterThan(4);
  expect(painted.has(THEMES[mode].colors.text.primary)).toBe(true);
};

const NET: NetworkEntry = {
  id: 7,
  kind: 'network',
  at: new Date(2026, 8, 24, 14, 26, 40).getTime(),
  method: 'POST',
  url: 'https://api.test/user/create',
  status: 500,
  durationMs: 4800,
  requestHeaders: { Authorization: 'Bearer secret-token', 'Content-Type': 'application/json' },
  requestBody: '{"name":"A","password":"p@ss","ok":true,"n":1,"none":null}',
  responseBody: '{"code":"E42","message":"boom","items":[1,2,3]}',
  screen: 'UserCreate',
};

const ENTRIES: LogEntry[] = [
  { id: 1, kind: 'console', at: 1, level: 'info', text: 'screen mounted' },
  { id: 2, kind: 'console', at: 2, level: 'warn', text: 'cache miss' },
  { id: 3, kind: 'console', at: 3, level: 'error', text: 'TypeError: boom' },
  { id: 4, kind: 'marker', at: 4, type: 'screen', label: 'Home' },
  { ...NET, id: 5 },
  { ...NET, id: 6, status: 200, durationMs: 80 },
  { ...NET, id: 8, status: undefined, durationMs: undefined },
  { ...NET, id: 9, status: undefined, error: 'Network request failed' },
];

const seed = (entries: LogEntry[]) =>
  entries.forEach((e) => {
    while (logBuffer.nextId() < e.id) {
      /* tiến bộ đếm tới `e.id` */
    }
    logBuffer.push(e);
  });

const CRASHED: StoredSession = {
  format: 1,
  name: 'session-1.json',
  startedAt: 1790000000000,
  savedAt: 1790000300000,
  fatal: true,
  totalInMemory: 2,
  entries: [
    { id: 1, kind: 'console', at: 1, level: 'info', text: 'boot' },
    { id: 2, kind: 'console', at: 2, level: 'error', text: 'fatal', fatal: true },
  ],
};

beforeEach(() => {
  logBuffer.clear();
  mockPrevious = null;
});

describe.each(KITS)('không rò màu giữa hai theme — kit %s', (_name, kit) => {
  describe.each(['light', 'dark'] as const)('theme %s', (mode) => {
    const render = (ui: Parameters<typeof renderWithDevTools>[0]) =>
      renderWithDevTools(ui, { colorScheme: mode, kit });

    it('panel: hàng · huy hiệu · dải báo crash · chip chọn-một', () => {
      seed(ENTRIES);
      mockPrevious = CRASHED;
      render(
        <DevToolsPanel
          visible
          onDismiss={jest.fn()}
          subtitle="UAT · 1.0.2"
          onOpenPrevious={jest.fn()}
          onSnooze={jest.fn()}
          snoozeMinutes={30}
          actions={[
            { id: 'sim', label: 'Giả lập lỗi mạng', hint: 'UAT', onPress: jest.fn() },
            {
              id: 'theme',
              label: 'Theme',
              choices: [
                { id: 'a', label: 'A' },
                { id: 'b', label: 'B' },
              ],
              selectedId: 'a',
              onSelect: jest.fn(),
            },
          ]}
        />,
      );

      expect(screen.getByTestId('devtools-panel')).toBeOnTheScreen();
      expectOnlyThemeColors(mode);
      /* Dải crash dùng nền nguy hiểm nhạt của đúng theme. */
      expect(paintedColors().has(THEMES[mode].colors.background.dangerSubtle)).toBe(true);
    });

    it('màn nhật ký: hàng · huy hiệu trạng thái · mốc · thanh lọc · thanh hành động', () => {
      seed(ENTRIES);
      render(<LogSheet visible onDismiss={jest.fn()} />);

      expect(screen.getByTestId('devtools-log-3')).toBeOnTheScreen();
      expectOnlyThemeColors(mode);
      const painted = paintedColors();
      const { colors } = THEMES[mode];
      /* Hàng lỗi · hàng ổn · cảnh báo/chậm · chip đang chọn · ô tìm đều lấy màu của theme này. */
      expect(painted.has(colors.text.danger)).toBe(true);
      expect(painted.has(colors.text.success)).toBe(true);
      expect(painted.has(colors.text.warning)).toBe(true);
      expect(painted.has(colors.background.brand)).toBe(true);
      expect(painted.has(colors.border.strong)).toBe(true);
    });

    it('màn nhật ký: ô tìm có chữ gợi ý, trạng thái tạm dừng, rỗng-sau-lọc', async () => {
      seed(ENTRIES);
      render(<LogSheet visible onDismiss={jest.fn()} />);

      fireEvent.press(screen.getByTestId('devtools-log-pause'));
      expectOnlyThemeColors(mode);
      /* Placeholder đọc từ token `tertiary` của theme này. */
      expect(paintedColors().has(THEMES[mode].colors.text.tertiary)).toBe(true);

      fireEvent.changeText(screen.getByTestId('devtools-log-search'), 'không-có-dòng-nào-khớp');
      await screen.findByTestId('devtools-log-no-match');
      expectOnlyThemeColors(mode);
    });

    it('màn nhật ký: bộ đệm rỗng', () => {
      render(<LogSheet visible onDismiss={jest.fn()} />);

      expectOnlyThemeColors(mode);
    });

    it('màn nhật ký xem phiên trước (archive)', () => {
      render(<LogSheet visible onDismiss={jest.fn()} archive={CRASHED} />);

      expectOnlyThemeColors(mode);
    });

    it.each<DetailTab>(['overview', 'headers', 'request', 'response', 'curl'])(
      'chi tiết request, tab %s',
      (tab) => {
        render(<LogDetail entry={NET} tab={tab} onTabChange={jest.fn()} />);

        expectOnlyThemeColors(mode);
      },
    );

    it('chi tiết request: chuyển cây JSON sang văn bản vẫn đúng màu cú pháp', () => {
      render(<LogDetail entry={NET} tab="request" onTabChange={jest.fn()} />);
      const { palette } = THEMES[mode];
      const step = mode === 'dark' ? 300 : 700;

      act(() => {
        fireEvent.press(screen.getByText('Văn bản'));
      });

      expectOnlyThemeColors(mode);
      expect(paintedColors().has(palette.info[step])).toBe(true);
      expect(paintedColors().has(palette.success[step])).toBe(true);
    });
  });
});
