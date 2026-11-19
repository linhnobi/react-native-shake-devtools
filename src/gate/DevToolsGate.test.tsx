import { act, fireEvent, screen, within } from '@testing-library/react-native';
import {
  AppState,
  DevSettings,
  Pressable,
  Share,
  Text,
  useColorScheme,
  type AppStateStatus,
} from 'react-native';
import { lastMockSheet } from '../testing/bottom-sheet.mock';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { darkTheme } from '../ui/theme';
import type { SheetKit } from '../ui/sheet-kit';
import { gorhomKit } from '../kits/gorhom-kit';
import { plainKit } from '../kits/plain-kit';
import { actionBuffer } from '../capture/action-buffer';
import { logBuffer } from '../capture/log-buffer';
import * as logPersist from '../capture/log-persist';
import { parseSession, type StoredSession } from '../capture/log-session';
import { DevToolsPanel } from '../panel/DevToolsPanel';
import { LogSheet } from '../panel/LogSheet';
import type { DevToolsCapturedImage } from '../report/bug-report';
import {
  createConnectionStore,
  type DevToolsSecureStore,
} from '../report/connections/connection-store';
import type { ConnectorType } from '../report/connectors/types';
import { RETRY_EVERY_MS, createSendQueue, type QueuedReport } from '../report/send-queue';
import { TouchRecorder } from '../report/recorder/TouchRecorder';
import { ReportSheet, type ReportSheetProps } from '../report/ui/ReportSheet';
import { useShake } from '../shake/use-shake';
import { useDevTools } from './devtools-context';
import type { DevToolsConfig, DevToolsExportFile, DevToolsShareFile } from './devtools-props';
import { DevToolsGate, RETAKE_CLOSE_FALLBACK_MS } from './DevToolsGate';
import { isRunningFromMetro } from './is-running-from-metro';

/*
  Mọi thứ chạm native bị thay bằng bản điều khiển được:
  · `isRunningFromMetro` — đổi theo từng ca (offline ⇒ panel nghe lắc; Metro ⇒ dòng dev menu).
  · `useShake` — không đụng cảm biến thật. "Listener đang mount" = `ShakeListener` đang nằm trong
    cây, đo bằng một effect mount/unmount bên trong hook giả; `onShake` được giữ lại để ca test tự
    "lắc". Hàm giả đặt tên `use…` cho đúng luật hook (nó gọi `useEffect`).
  · `usePreviousSession` — `previousSession` không có setter public; biến test thay cho đĩa.
  Factory đọc các biến `mock…` LƯỜI (lúc render), nên `jest.mock` bị hoist vẫn không chạm TDZ.
*/
jest.mock('./is-running-from-metro', () => ({ isRunningFromMetro: jest.fn(() => false) }));

const mockShake: { mounted: number; onShake: (() => void) | undefined } = {
  mounted: 0,
  onShake: undefined,
};
jest.mock('../shake/use-shake', () => {
  const { useEffect } = jest.requireActual('react');
  function useMockShake(onShake: () => void) {
    mockShake.onShake = onShake;
    useEffect(() => {
      mockShake.mounted += 1;
      return () => {
        mockShake.mounted -= 1;
      };
    }, []);
    return true;
  }
  return { useShake: jest.fn(useMockShake) };
});

let mockPrevious: StoredSession | null = null;
jest.mock('../panel/use-previous-session', () => ({ usePreviousSession: () => mockPrevious }));

/*
  Hàng đợi gửi giả: gate chỉ cần `load` / `retryDue` đúng lúc. Factory trả hàm đọc `mockQueue`
  LƯỜI (lúc gate gọi), nên mỗi ca tự dựng hàng đợi của mình trong `beforeEach`.
*/
type FakeQueue = {
  load: jest.Mock;
  ramOnly: jest.Mock;
  retryDue: jest.Mock;
  submit: jest.Mock;
  retryNow: jest.Mock;
  discard: jest.Mock;
  items: jest.Mock;
  subscribe: jest.Mock;
};
let mockQueue: FakeQueue;
jest.mock('../report/send-queue', () => ({
  ...jest.requireActual('../report/send-queue'),
  createSendQueue: jest.fn(() => mockQueue),
}));
/* Kho kết nối thật, chỉ bọc spy để đếm số lần gate dựng nó. */
jest.mock('../report/connections/connection-store', () => {
  const actual = jest.requireActual('../report/connections/connection-store');
  return { ...actual, createConnectionStore: jest.fn(actual.createConnectionStore) };
});

/*
  Màn báo bug thật là Task 15. Bản giả ở đây dựng trên `Sheet` THẬT của bộ sheet (gorhom hoặc thuần)
  để `onClosed` là tín hiệu thật "sheet đã rời màn hình", và in nháp ra để ca test đọc. Mọi sự kiện
  quan trọng (sheet rời màn, lần chụp) ghi vào `mockEvents` để kiểm THỨ TỰ.
*/
const mockEvents: string[] = [];
/** `false` ⇒ sheet giả KHÔNG nối `onClosed` (màn báo bug quên nối, hoặc tín hiệu đóng bị lỡ). */
let mockForwardClosed = true;
jest.mock('../report/ui/ReportSheet', () => {
  const { createElement: h } = jest.requireActual('react');
  const { Pressable, Text } = jest.requireActual('react-native');
  const { useSheetKit } = jest.requireActual('../ui/sheet-kit');
  const shotOf = (s: unknown) =>
    typeof s === 'object' && s !== null ? (s as { uri: string }).uri : String(s);
  return {
    ReportSheet: (props: {
      visible: boolean;
      onDismiss: () => void;
      onClosed: () => void;
      onRetake: () => void;
      controller: {
        draft: { screenshot: unknown; title: string; steps: unknown[] } | null;
        ready: boolean;
        update: (p: { title: string }) => void;
        discard: () => void;
      };
    }) => {
      const { Sheet } = useSheetKit();
      const draft = props.controller.draft;
      return h(
        Sheet,
        {
          testID: 'report-sheet',
          title: 'Báo bug',
          visible: props.visible,
          onDismiss: props.onDismiss,
          onClosed: () => {
            if (!mockForwardClosed) return;
            mockEvents.push('closed');
            props.onClosed();
          },
        },
        h(Text, { testID: 'report-shot' }, shotOf(draft?.screenshot)),
        h(Text, { testID: 'report-title' }, draft?.title ?? ''),
        h(Text, { testID: 'report-steps' }, String(draft?.steps.length ?? 0)),
        h(Text, { testID: 'report-ready' }, String(props.controller.ready)),
        h(Pressable, {
          testID: 'report-edit',
          onPress: () => props.controller.update({ title: 'QA đã sửa' }),
        }),
        h(Pressable, { testID: 'report-retake', onPress: props.onRetake }),
        h(Pressable, { testID: 'report-discard', onPress: () => props.controller.discard() }),
      );
    },
  };
});

/*
  Mock `AppState` của preset: `currentState` là một `jest.fn` (≠ `'active'`) ⇒ gate khởi động như
  đang ở nền. Ghi đè thành `'active'`, và gom MỌI listener `'change'` để phát sự kiện cho tất cả —
  provider bọc ngoài (theme…) cũng có thể nghe, effect của chúng chạy SAU effect của gate.
*/
let appStateListeners: Array<(state: AppStateStatus) => void> = [];
const emitAppState = (state: AppStateStatus) =>
  act(() => appStateListeners.forEach((listener) => listener(state)));

const listening = () => mockShake.mounted > 0;
const shake = () => act(() => mockShake.onShake?.());
const panel = () => screen.queryByTestId('devtools-panel');

const renderGate = (config: DevToolsConfig) =>
  renderWithDevTools(
    <DevToolsGate config={{ locale: 'vi', ...config }} actions={[]}>
      <Text testID="app-child">app</Text>
    </DevToolsGate>,
  );

const makeFakeQueue = (): FakeQueue => ({
  load: jest.fn(async () => undefined),
  ramOnly: jest.fn(() => false),
  retryDue: jest.fn(async () => undefined),
  submit: jest.fn(),
  retryNow: jest.fn(),
  discard: jest.fn(),
  items: jest.fn(() => []),
  subscribe: jest.fn(() => () => undefined),
});

beforeEach(() => {
  mockShake.mounted = 0;
  mockShake.onShake = undefined;
  mockPrevious = null;
  mockQueue = makeFakeQueue();
  mockEvents.length = 0;
  mockForwardClosed = true;
  jest.mocked(createSendQueue).mockClear();
  jest.mocked(createConnectionStore).mockClear();
  actionBuffer.clear();
  logBuffer.clear();
  jest.mocked(useShake).mockClear();
  jest.mocked(isRunningFromMetro).mockReturnValue(false);

  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
    if (type === 'change') appStateListeners.push(listener);
    return { remove: jest.fn() };
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('DevToolsGate', () => {
  it('`enabled: false` ⇒ chỉ render children, không mount listener', () => {
    renderGate({ enabled: false });

    expect(screen.getByTestId('app-child')).toBeOnTheScreen();
    expect(listening()).toBe(false);
    expect(useShake).not.toHaveBeenCalled();
    /* Không chỉ "chưa mở": panel và màn nhật ký hoàn toàn không có trong cây. */
    expect(screen.UNSAFE_queryByType(DevToolsPanel)).toBeNull();
    expect(screen.UNSAFE_queryAllByType(LogSheet)).toHaveLength(0);
  });

  it('dev/uat ⇒ có listener', () => {
    renderGate({ enabled: true });

    expect(screen.getByTestId('app-child')).toBeOnTheScreen();
    expect(listening()).toBe(true);
    expect(useShake).toHaveBeenCalledWith(expect.any(Function), expect.any(Object));
  });

  it('app xuống nền ⇒ tháo listener', () => {
    renderGate({ enabled: true });
    expect(listening()).toBe(true);

    emitAppState('background');
    expect(listening()).toBe(false);

    emitAppState('active');
    expect(listening()).toBe(true);
  });

  it('chạy từ Metro ⇒ không mount listener nhưng **vẫn** đăng ký dòng dev menu', () => {
    jest.mocked(isRunningFromMetro).mockReturnValue(true);
    const addMenuItem = jest.spyOn(DevSettings, 'addMenuItem').mockImplementation(() => undefined);

    renderGate({ enabled: true });

    expect(listening()).toBe(false);
    expect(addMenuItem).toHaveBeenCalledTimes(1);
    expect(addMenuItem).toHaveBeenCalledWith('Công cụ gỡ lỗi', expect.any(Function));

    /* Dòng dev menu là cửa vào thay cho cú lắc: bấm nó thì panel mở. */
    const [, openFromMenu] = addMenuItem.mock.calls[0];
    act(() => {
      openFromMenu();
    });

    expect(panel()).toBeOnTheScreen();
  });

  it('`onShake` ⇒ panel mở', () => {
    renderGate({ enabled: true });
    expect(panel()).toBeNull();

    shake();

    expect(panel()).toBeOnTheScreen();
  });

  it('panel mở ⇒ tháo listener (không bắn chồng)', () => {
    renderGate({ enabled: true });

    shake();

    expect(panel()).toBeOnTheScreen();
    expect(listening()).toBe(false);

    fireEvent.press(screen.getByTestId('devtools-panel-dismiss'));

    expect(panel()).toBeNull();
    expect(listening()).toBe(true);
  });

  it('bấm hàng tắt lắc ⇒ đóng panel và không mount lại listener cho tới khi hết giờ', async () => {
    jest.useFakeTimers();
    const minutes = 5;
    renderGate({ enabled: true, snoozeMinutes: minutes });

    shake();
    fireEvent.press(screen.getByTestId('devtools-row-snooze'));

    expect(panel()).toBeNull();
    expect(listening()).toBe(false);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(minutes * 60_000 - 1);
    });
    expect(listening()).toBe(false);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(listening()).toBe(true);
  });

  it('có phiên trước ⇒ hàng "Phiên trước" mở màn phiên trước', () => {
    /* Chỉ một mốc: `MarkerRow` không bọc `ReanimatedSwipeable`, màn phiên trước vẽ được thật. */
    mockPrevious = {
      format: 1,
      name: 'session-1790000000000.json',
      startedAt: 1790000000000,
      savedAt: 1790000300000,
      fatal: false,
      totalInMemory: 1,
      entries: [{ id: 1, kind: 'marker', at: 1790000100000, type: 'screen', label: 'UserList' }],
    };
    renderGate({ enabled: true });

    shake();
    fireEvent.press(screen.getByTestId('devtools-row-previous'));

    expect(panel()).toBeNull();
    expect(screen.getByTestId('devtools-log-sheet')).toBeOnTheScreen();
    expect(screen.getByText(/^Lần ghi cuối /)).toBeOnTheScreen();
    expect(screen.getByText('→ Màn UserList')).toBeOnTheScreen();
  });

  describe('cấu hình giao diện', () => {
    const renderRaw = (config: DevToolsConfig) =>
      renderWithDevTools(
        <DevToolsGate config={config} actions={[]}>
          <Text testID="app-child">app</Text>
        </DevToolsGate>,
      );

    it('vắng `locale` ⇒ chữ của vỏ bằng tiếng Anh', () => {
      renderRaw({ enabled: true });
      shake();

      expect(screen.getByText('Debug tools')).toBeOnTheScreen();
      expect(screen.getByText('Logs')).toBeOnTheScreen();
    });

    it('`strings` ghi đè đúng khoá được khai, khoá còn lại giữ chữ theo `locale`', () => {
      renderRaw({ enabled: true, locale: 'vi', strings: { panel: { title: 'Dev menu' } } });
      shake();

      expect(screen.getByText('Dev menu')).toBeOnTheScreen();
      expect(screen.getByText('Nhật ký')).toBeOnTheScreen();
    });

    it('`colorScheme` ép theme tối, thắng chế độ của hệ thống', () => {
      jest.mocked(useColorScheme).mockReturnValue('light');
      renderRaw({ enabled: true, locale: 'vi', colorScheme: 'dark' });
      shake();

      expect(screen.getByText('Nhật ký')).toHaveStyle({ color: darkTheme.colors.text.primary });
    });

    it('`androidKeyboardInputMode` đi tới sheet của gorhom; vắng ⇒ `adjustPan`', () => {
      const { unmount } = renderRaw({ enabled: true });
      shake();
      expect(lastMockSheet()?.props.android_keyboardInputMode).toBe('adjustPan');
      unmount();

      renderRaw({ enabled: true, androidKeyboardInputMode: 'adjustResize' });
      shake();
      expect(lastMockSheet()?.props.android_keyboardInputMode).toBe('adjustResize');
    });
  });
});

describe('DevToolsGate — báo bug', () => {
  const IMAGE: DevToolsCapturedImage = {
    uri: 'file:///cache/shot-1.jpg',
    mimeType: 'image/jpeg',
    width: 1080,
    height: 2400,
  };
  const IMAGE_2: DevToolsCapturedImage = { ...IMAGE, uri: 'file:///cache/shot-2.jpg' };

  const makeSecureStore = (): DevToolsSecureStore => {
    const map = new Map<string, string>();
    return {
      getItem: async (key) => map.get(key) ?? null,
      setItem: async (key, value) => {
        map.set(key, value);
      },
      removeItem: async (key) => {
        map.delete(key);
      },
    };
  };

  /** Chỗ trong app gọi `useDevTools().open()` (vd chạm 7 lần vào dòng phiên bản). */
  const Opener = () => {
    const { open } = useDevTools();
    return <Pressable testID="app-open" onPress={open} />;
  };

  const renderReport = (
    config: Omit<DevToolsConfig, 'enabled'> & { enabled?: boolean },
    kit?: SheetKit,
  ) =>
    renderWithDevTools(
      <DevToolsGate config={{ locale: 'vi', enabled: true, ...config }} actions={[]}>
        <Text testID="app-child">app</Text>
        <Opener />
      </DevToolsGate>,
      kit ? { kit } : undefined,
    );

  /** Nhả chuỗi Promise (chụp → trạng thái → setState) trong `act`; chạy được với cả đồng hồ giả. */
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

  /** `captureScreen` mà ca test tự quyết lúc nào trả ảnh. */
  const deferredCapture = () => {
    let resolve: (v: DevToolsCapturedImage | null) => void = () => undefined;
    const fn = jest.fn(
      () =>
        new Promise<DevToolsCapturedImage | null>((r) => {
          resolve = r;
        }),
    );
    return { fn, resolve: (v: DevToolsCapturedImage | null) => resolve(v) };
  };

  const reportRow = () => within(screen.getByTestId('devtools-row-report'));
  /** Props mới nhất gate đưa cho màn báo bug (bản giả ở trên). */
  const sheetProps = () => screen.UNSAFE_getByType(ReportSheet).props as ReportSheetProps;
  const tap = (at: number, label: string) =>
    actionBuffer.push({ at, kind: 'tap', label, source: 'text' });

  it('không khai `bugReport` ⇒ không `TouchRecorder`, panel không có hàng Báo bug, không dựng hàng đợi', () => {
    renderGate({ enabled: true });

    expect(screen.UNSAFE_queryByType(TouchRecorder)).toBeNull();
    expect(screen.UNSAFE_queryByType(ReportSheet)).toBeNull();
    shake();
    expect(panel()).toBeOnTheScreen();
    expect(screen.queryByTestId('devtools-row-report')).toBeNull();
    expect(createSendQueue).not.toHaveBeenCalled();
  });

  it('`enabled: false` ⇒ không gì cả: không bọc, không hàng đợi, `open()` không chụp', () => {
    const captureScreen = jest.fn(async () => IMAGE);
    renderReport({ enabled: false, bugReport: { captureScreen, secureStore: makeSecureStore() } });

    fireEvent.press(screen.getByTestId('app-open'));

    expect(screen.getByTestId('app-child')).toBeOnTheScreen();
    expect(screen.UNSAFE_queryByType(TouchRecorder)).toBeNull();
    expect(screen.UNSAFE_queryByType(ReportSheet)).toBeNull();
    expect(createSendQueue).not.toHaveBeenCalled();
    expect(captureScreen).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
  });

  it('có `bugReport` ⇒ `TouchRecorder` bọc children; `recordVisibleText` mặc định `true`', () => {
    const { unmount } = renderReport({ bugReport: {} });
    const recorder = screen.UNSAFE_getByType(TouchRecorder);
    expect(recorder.props.recordVisibleText).toBe(true);
    expect(within(recorder).getByTestId('app-child')).toBeOnTheScreen();
    unmount();

    renderReport({ bugReport: { recordVisibleText: false } });
    expect(screen.UNSAFE_getByType(TouchRecorder).props.recordVisibleText).toBe(false);
  });

  it('lắc ⇒ `captureScreen` chạy TRƯỚC khi panel hiện; lắc thêm lúc đang chụp không chụp lần hai', async () => {
    const capture = deferredCapture();
    tap(1, 'Giỏ hàng');
    tap(2, 'Thanh toán');
    renderReport({ bugReport: { captureScreen: capture.fn } });

    shake();

    expect(capture.fn).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
    expect(listening()).toBe(false);
    act(() => mockShake.onShake?.());
    expect(capture.fn).toHaveBeenCalledTimes(1);

    capture.resolve(IMAGE);
    await settle();

    expect(panel()).toBeOnTheScreen();
    expect(reportRow().getByText('Ảnh đã chụp · 2 bước tự ghi')).toBeOnTheScreen();
  });

  it('`useDevTools().open()` cũng chụp trước khi panel hiện', async () => {
    const capture = deferredCapture();
    renderReport({ bugReport: { captureScreen: capture.fn } });

    fireEvent.press(screen.getByTestId('app-open'));

    expect(capture.fn).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();

    capture.resolve(IMAGE);
    await settle();

    expect(panel()).toBeOnTheScreen();
  });

  const returnsNull = async (): Promise<DevToolsCapturedImage | null> => null;
  const throws = async (): Promise<DevToolsCapturedImage | null> => {
    throw new Error('view-shot');
  };

  it.each([
    ['trả `null`', 'blocked', returnsNull, 'Màn này không cho chụp ảnh · 0 bước tự ghi'],
    ['ném', 'failed', throws, 'Không chụp được ảnh · 0 bước tự ghi'],
  ] as const)('`captureScreen` %s ⇒ nháp mang `%s`', async (_case, state, captureScreen, hint) => {
    renderReport({ bugReport: { captureScreen } });

    shake();
    await settle();
    expect(reportRow().getByText(hint)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('devtools-row-report'));

    expect(panel()).toBeNull();
    expect(screen.getByTestId('report-shot')).toHaveTextContent(state);
  });

  it('`captureScreen` treo ⇒ sau 1,5 s panel vẫn mở, ảnh `failed`', async () => {
    jest.useFakeTimers();
    renderReport({ bugReport: { captureScreen: () => new Promise(() => undefined) } });

    shake();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1499);
    });
    expect(panel()).toBeNull();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(panel()).toBeOnTheScreen();
    expect(reportRow().getByText('Không chụp được ảnh · 0 bước tự ghi')).toBeOnTheScreen();
  });

  it('`bugReport.appContext` chỉ được gọi khi QA mở form (không phải lúc lắc), một lần cho mỗi nháp', () => {
    const appContext = jest.fn(() => ({ userId: 'u-42' }));
    renderReport({ bugReport: { appContext } });

    shake();
    expect(appContext).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('devtools-row-report'));

    expect(appContext).toHaveBeenCalledTimes(1);
    expect(sheetProps().controller.draft?.appContext).toMatchObject({
      status: 'ready',
      lines: [['userId', 'u-42']],
    });
  });

  it('không có `captureScreen` ⇒ panel mở ngay, dòng phụ không có đoạn ảnh', () => {
    renderReport({ bugReport: {} });

    shake();

    expect(panel()).toBeOnTheScreen();
    expect(reportRow().getByText('0 bước tự ghi')).toBeOnTheScreen();
  });

  it('một sheet devtools đang mở thì `open()` không chụp nữa', async () => {
    const captureScreen = jest.fn(async () => IMAGE);
    renderReport({ bugReport: { captureScreen } });
    shake();
    await settle();
    fireEvent.press(screen.getByTestId('devtools-row-log'));
    expect(screen.getByTestId('devtools-log-sheet')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('app-open'));
    await settle();

    expect(panel()).toBeOnTheScreen();
    expect(captureScreen).toHaveBeenCalledTimes(1);
  });

  it('bấm hàng Báo bug ⇒ nháp mang ảnh lúc lắc; đóng rồi lắc lại ⇒ "Có bản nháp", gặp đúng nháp cũ', async () => {
    const captureScreen = jest.fn(async (): Promise<DevToolsCapturedImage | null> => IMAGE);
    tap(1, 'Thanh toán');
    renderReport({ bugReport: { captureScreen } });
    shake();
    await settle();

    fireEvent.press(screen.getByTestId('devtools-row-report'));
    expect(screen.getByTestId('report-shot')).toHaveTextContent(IMAGE.uri);
    fireEvent.press(screen.getByTestId('report-edit'));

    /* Người dùng vuốt sheet báo bug xuống: modal đóng rồi báo `onDismiss`. */
    act(() => lastMockSheet()?.close());
    expect(screen.queryByTestId('report-shot')).toBeNull();
    tap(2, 'Huỷ đơn');
    captureScreen.mockImplementation(async () => IMAGE_2);
    shake();
    await settle();

    expect(reportRow().getByText('Có bản nháp')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('devtools-row-report'));
    expect(screen.getByTestId('report-title')).toHaveTextContent('QA đã sửa');
    expect(screen.getByTestId('report-shot')).toHaveTextContent(IMAGE.uri);
    expect(screen.getByTestId('report-steps')).toHaveTextContent('1');
  });

  it('dòng phụ không đếm mục `blocked` của chính nháp đang soạn (N4); bản khác cần xử lý vẫn đếm', async () => {
    const listeners = new Set<() => void>();
    let items: readonly QueuedReport[] = [];
    mockQueue.items.mockImplementation(() => items);
    mockQueue.subscribe.mockImplementation((l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    });
    renderReport({ bugReport: { secureStore: makeSecureStore() } });
    shake();
    await settle();
    fireEvent.press(screen.getByTestId('devtools-row-report'));
    const draftId = sheetProps().controller.draft?.id as string;
    act(() => lastMockSheet()?.close());

    const blocked = (id: string): QueuedReport => ({
      report: { id, createdAt: 1, title: id, steps: [], actual: '', files: [] },
      connectionId: 'c1',
      state: 'blocked',
      attempts: 1,
    });
    items = [blocked(draftId), blocked('rpt-other')];
    act(() => listeners.forEach((l) => l()));
    shake();
    await settle();

    expect(reportRow().getByText('Có bản nháp · 1 cần xử lý')).toBeOnTheScreen();
  });

  it('kho lưu bền treo lúc hàng đợi đọc (M4) ⇒ hàng đợi báo RAM-only, màn báo bug nhắc "sẽ mất nếu app bị tắt"', async () => {
    const listeners = new Set<() => void>();
    mockQueue.subscribe.mockImplementation((l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    });
    jest.spyOn(logPersist, 'activePersistStore').mockReturnValue({
      list: () => new Promise(() => undefined),
      read: async () => '',
      write: async () => undefined,
      remove: async () => undefined,
    });
    renderReport({ bugReport: { secureStore: makeSecureStore() } });
    await settle();
    expect(sheetProps().ramOnlyQueue).toBe(false);

    mockQueue.ramOnly.mockReturnValue(true);
    act(() => listeners.forEach((l) => l()));

    expect(sheetProps().ramOnlyQueue).toBe(true);
  });

  it('dòng phụ hàng Báo bug đếm hàng đợi (chờ gửi · cần xử lý) và đổi theo hàng đợi (C1)', async () => {
    const queued = (id: string, state: QueuedReport['state']): QueuedReport => ({
      report: { id, createdAt: 1, title: id, steps: [], actual: '', files: [] },
      connectionId: 'c1',
      state,
      attempts: 1,
    });
    let items: readonly QueuedReport[] = [
      queued('a', 'pending'),
      queued('b', 'pending'),
      queued('c', 'failed'),
      queued('d', 'sent'),
    ];
    const listeners = new Set<() => void>();
    mockQueue.items.mockImplementation(() => items);
    mockQueue.subscribe.mockImplementation((l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    });
    renderReport({ bugReport: { secureStore: makeSecureStore() } });
    shake();
    await settle();

    expect(reportRow().getByText('0 bước tự ghi · 2 chờ gửi · 1 cần xử lý')).toBeOnTheScreen();

    items = [queued('a', 'sent'), queued('b', 'pending'), queued('c', 'failed'), queued('d', 'sent')];
    act(() => listeners.forEach((l) => l()));
    expect(reportRow().getByText('0 bước tự ghi · 1 chờ gửi · 1 cần xử lý')).toBeOnTheScreen();
  });

  it('phiên crash trước HỎNG (phần tử null, url là số) ⇒ panel vẫn mở, hàng Báo bug dựng được nháp crash — app không sập', async () => {
    const broken = {
      format: 2,
      name: 'session-1.json',
      startedAt: 1,
      savedAt: 2,
      fatal: true,
      totalInMemory: 2,
      entries: [null, { id: 1, kind: 'network', at: 1, method: 'GET', url: 42, status: 500 }],
      actions: [],
    } as unknown as StoredSession;
    /*
      Panel (dải crash, hàng Phiên trước) nhận đúng thứ đĩa đưa ra: file đi qua `parseSession`. Bộ
      điều khiển báo bug nhận thẳng object hỏng — để chứng minh chính nó cũng không ném (lớp phòng
      thủ thứ hai, nếu phiên hỏng tới được nó bằng đường nào khác).
    */
    mockPrevious = parseSession(JSON.stringify(broken));
    const get = jest.spyOn(logPersist.previousSession, 'get').mockReturnValue(broken);
    try {
      renderReport({ bugReport: {} });
      shake();
      await settle();

      expect(panel()).toBeOnTheScreen();
      expect(screen.getByTestId('devtools-panel-crash')).toBeOnTheScreen();
      expect(screen.getByTestId('devtools-row-previous')).toBeOnTheScreen();
      expect(reportRow().getByText('1 bước tự ghi')).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('devtools-row-report'));
      expect(screen.getByTestId('report-title')).toHaveTextContent('[Crash] GET → 500');
    } finally {
      get.mockRestore();
    }
  });

  describe.each([
    ['gorhom', gorhomKit],
    ['plain', plainKit],
  ] as const)('Chụp lại — kit %s', (_name, kit) => {
    it('chụp chỉ SAU khi sheet báo bug đã rời màn hình; quay về form, chữ QA sửa và các bước còn nguyên, chỉ ảnh đổi', async () => {
      jest.useFakeTimers();
      const captureScreen = jest.fn(async (): Promise<DevToolsCapturedImage | null> => IMAGE);
      tap(1, 'Giỏ hàng');
      tap(2, 'Thanh toán');
      renderReport({ bugReport: { captureScreen } }, kit);
      shake();
      await settle();
      fireEvent.press(screen.getByTestId('devtools-row-report'));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(300);
      });
      fireEvent.press(screen.getByTestId('report-edit'));
      captureScreen.mockImplementation(async () => {
        mockEvents.push('capture');
        return IMAGE_2;
      });

      fireEvent.press(screen.getByTestId('report-retake'));
      if (kit === plainKit) expect(mockEvents).toEqual([]);
      expect(panel()).toBeNull();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(300);
      });
      await settle();

      expect(mockEvents).toEqual(['closed', 'capture']);
      expect(captureScreen).toHaveBeenCalledTimes(2);
      expect(panel()).toBeNull();
      expect(screen.getByTestId('report-shot')).toHaveTextContent(IMAGE_2.uri);
      expect(screen.getByTestId('report-title')).toHaveTextContent('QA đã sửa');
      expect(screen.getByTestId('report-steps')).toHaveTextContent('2');

      /* `onClosed` tới trước ⇒ hẹn dự phòng đã huỷ: không có lần chụp thứ ba. */
      await act(async () => {
        await jest.advanceTimersByTimeAsync(RETAKE_CLOSE_FALLBACK_MS * 2);
      });
      expect(captureScreen).toHaveBeenCalledTimes(2);
      expect(mockEvents).toEqual(['closed', 'capture']);
    });
  });

  it('"Báo bug khác" (hàng đợi đã nhận bản báo, nháp đã xoá) ⇒ đi đường Chụp lại: đóng, chụp, mở NHÁP MỚI bằng ảnh vừa chụp', async () => {
    jest.useFakeTimers();
    const captureScreen = jest.fn(async (): Promise<DevToolsCapturedImage | null> => IMAGE);
    renderReport({ bugReport: { captureScreen } });
    shake();
    await settle();
    fireEvent.press(screen.getByTestId('devtools-row-report'));
    fireEvent.press(screen.getByTestId('report-edit'));
    /* Như sau khi hàng đợi nhận bản báo (R31): bộ điều khiển đã xoá nháp, sheet đang ở trang kết quả. */
    fireEvent.press(screen.getByTestId('report-discard'));
    expect(screen.getByTestId('report-title')).toHaveTextContent('');
    captureScreen.mockImplementation(async () => {
      mockEvents.push('capture');
      return IMAGE_2;
    });

    fireEvent.press(screen.getByTestId('report-retake'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    await settle();

    expect(mockEvents).toEqual(['closed', 'capture']);
    expect(screen.getByTestId('report-shot')).toHaveTextContent(IMAGE_2.uri);
    expect(screen.getByTestId('report-title')).not.toHaveTextContent('QA đã sửa');
    expect(panel()).toBeNull();
  });

  it('màn báo bug nhận danh sách loại kết nối đã ghép (có sẵn + của app), giữ nguyên tham chiếu khi app truyền mảng mới cùng các loại', async () => {
    const secureStore = makeSecureStore();
    const linear = { id: 'linear', secretFieldIds: [] } as unknown as ConnectorType;
    const ui = (connectorTypes: readonly ConnectorType[]) => (
      <DevToolsGate config={{ locale: 'vi', enabled: true, bugReport: { secureStore, connectorTypes } }} actions={[]}>
        <Text testID="app-child">app</Text>
      </DevToolsGate>
    );
    const { rerender } = renderWithDevTools(ui([linear]));

    const first = sheetProps().connectorTypes;
    expect(first.map((t) => t.id)).toEqual(['jira-cloud', 'slack', 'lark', 'webhook', 'linear']);

    /* Mảng mới, cùng object ⇒ cùng tham chiếu: trang Kết nối không đọc lại kho bí mật mỗi lượt render. */
    rerender(ui([linear]));
    expect(sheetProps().connectorTypes).toBe(first);

    /* Object loại mới ⇒ mảng mới mang đúng object đó. */
    const linear2 = { ...linear } as ConnectorType;
    rerender(ui([linear2]));
    expect(sheetProps().connectorTypes).not.toBe(first);
    expect(sheetProps().connectorTypes.find((t) => t.id === 'linear')).toBe(linear2);
    await settle();
  });

  it('ngữ cảnh gửi của từng bản báo: file chữ ghi tạm dưới tên `<reportId>-<tên>`, tên phần upload giữ tên gốc; không có `writeTempFile` ⇒ phần chuỗi, không Blob (R43, R44)', async () => {
    const writeTempFile = jest.fn(async (name: string) => `file:///cache/${name}`);
    const view = renderReport({ bugReport: { secureStore: makeSecureStore(), writeTempFile } });
    const errors = { name: 'errors.txt', mimeType: 'text/plain', content: 'boom' };

    const ctxA = jest
      .mocked(createSendQueue)
      .mock.calls[0][0].makeSendContext('vi', undefined, () => undefined, 'rpt-A');
    await expect(ctxA.uploadPart(errors)).resolves.toEqual({
      uri: 'file:///cache/rpt-A-errors.txt',
      name: 'errors.txt',
      type: 'text/plain',
    });
    expect(writeTempFile).toHaveBeenCalledWith('rpt-A-errors.txt', 'boom');
    await settle();
    view.unmount();

    renderReport({ bugReport: { secureStore: makeSecureStore() } });
    const ctxB = jest
      .mocked(createSendQueue)
      .mock.calls[1][0].makeSendContext('vi', undefined, () => undefined, 'rpt-B');
    const part = await ctxB.uploadPart(errors);
    expect(part).not.toBeInstanceOf(Blob);
    expect(part).toEqual({ string: 'boom', name: 'errors.txt', type: 'text/plain' });
    await settle();
  });

  it('hàng đợi không có kho lưu bền (app không bật `persist`) ⇒ màn báo bug biết hàng đợi chỉ ở RAM; có kho ⇒ không', async () => {
    const view = renderReport({ bugReport: { secureStore: makeSecureStore() } });
    expect(jest.mocked(createSendQueue).mock.calls[0][0].store).toBeUndefined();
    expect(sheetProps().ramOnlyQueue).toBe(true);
    await settle();
    view.unmount();

    const logStore = {
      list: async () => [],
      read: async () => '',
      write: async () => undefined,
      remove: async () => undefined,
    };
    jest.spyOn(logPersist, 'activePersistStore').mockReturnValue(logStore);
    renderReport({ bugReport: { secureStore: makeSecureStore() } });
    expect(jest.mocked(createSendQueue).mock.calls[1][0].store).toBe(logStore);
    expect(sheetProps().ramOnlyQueue).toBe(false);
    await settle();
  });

  describe('Chia sẻ (R8, R35)', () => {
    const MESSAGE_HEAD = 'QA đã sửa\n\nCác bước:';
    const queued = (id: string): QueuedReport => ({
      report: {
        id,
        createdAt: 1,
        title: 'Bản báo trong hàng đợi',
        steps: [],
        actual: 'POST /orders → 500',
        files: [
          { name: 'screenshot.jpg', mimeType: 'image/jpeg', uri: IMAGE.uri },
          { name: 'errors.txt', mimeType: 'text/plain', content: 'boom' },
        ],
      },
      connectionId: 'c1',
      state: 'pending',
      attempts: 1,
    });

    /** Mở form báo bug (nháp mang ảnh lúc lắc, tiêu đề QA đã sửa). */
    const openForm = async (config: Omit<DevToolsConfig, 'enabled'>) => {
      const view = renderReport(config);
      shake();
      await settle();
      fireEvent.press(screen.getByTestId('devtools-row-report'));
      fireEvent.press(screen.getByTestId('report-edit'));
      return view;
    };
    const share = async (reportId: string | null) => {
      await act(async () => {
        sheetProps().onShare(reportId);
      });
      await settle();
    };

    it('`onShare(null)` + app cấp `shareFiles` ⇒ một lần gọi với mọi file của NHÁP đang soạn, tin nhắn theo ngôn ngữ giao diện; không có câu báo', async () => {
      const shareFiles = jest.fn(async () => undefined);
      const nativeShare = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
      await openForm({ bugReport: { captureScreen: async () => IMAGE, shareFiles } });

      await share(null);

      expect(shareFiles).toHaveBeenCalledTimes(1);
      const [files, message] = shareFiles.mock.calls[0] as unknown as [
        DevToolsShareFile[],
        string,
      ];
      expect(files.map((f) => f.name)).toEqual(['screenshot.jpg', 'errors.txt', 'timeline.json']);
      expect(files[0].uri).toBe(IMAGE.uri);
      expect(message.startsWith(MESSAGE_HEAD)).toBe(true);
      expect(nativeShare).not.toHaveBeenCalled();
      expect(sheetProps().shareNotice).toBeUndefined();
      expect(screen.getByTestId('report-title')).toHaveTextContent('QA đã sửa');
    });

    it('`onShare(id)` ⇒ chia sẻ đúng bản báo hàng đợi đang giữ với `id` đó (nháp của nó đã xoá)', async () => {
      const shareFiles = jest.fn(async () => undefined);
      const item = queued('rpt-queued');
      mockQueue.items.mockReturnValue([queued('rpt-other'), item]);
      await openForm({ bugReport: { secureStore: makeSecureStore(), shareFiles } });

      await share('rpt-queued');

      expect(shareFiles).toHaveBeenCalledTimes(1);
      const [files, message] = shareFiles.mock.calls[0] as unknown as [
        DevToolsShareFile[],
        string,
      ];
      expect(files).toBe(item.report.files);
      expect(message.startsWith('Bản báo trong hàng đợi\n\n')).toBe(true);
    });

    it('không có `shareFiles`, có `exportFile` ⇒ một file .txt; bản báo có ảnh ⇒ câu "ảnh không chia sẻ được" tới khi đóng sheet', async () => {
      const exportFile = jest.fn(async () => undefined);
      await openForm({ exportFile, bugReport: { captureScreen: async () => IMAGE } });

      await share(null);

      expect(exportFile).toHaveBeenCalledTimes(1);
      const file = (exportFile.mock.calls[0] as unknown as [DevToolsExportFile])[0];
      expect(file.name).toMatch(/^bug-report-rpt-.*\.txt$/);
      expect(file.content.startsWith(MESSAGE_HEAD)).toBe(true);
      expect(sheetProps().shareNotice).toBe('image-dropped');

      /* Đóng sheet rồi mở lại ⇒ câu báo không còn. */
      act(() => sheetProps().onDismiss());
      shake();
      await settle();
      fireEvent.press(screen.getByTestId('devtools-row-report'));
      expect(sheetProps().visible).toBe(true);
      expect(sheetProps().shareNotice).toBeUndefined();
    });

    it('không có `shareFiles` lẫn `exportFile` ⇒ `Share.share({ message })` của RN; không ảnh ⇒ không câu báo', async () => {
      const nativeShare = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
      await openForm({ bugReport: {} });

      await share(null);

      expect(nativeShare).toHaveBeenCalledTimes(1);
      const [content] = nativeShare.mock.calls[0];
      expect((content as { message: string }).message.startsWith(MESSAGE_HEAD)).toBe(true);
      expect(sheetProps().shareNotice).toBeUndefined();
    });

    it('chia sẻ bị từ chối ⇒ câu "Không chia sẻ được" (`share-failed`), nháp còn nguyên; lần chia sẻ sau thành công thì câu biến mất', async () => {
      const shareFiles = jest
        .fn()
        .mockRejectedValueOnce(new Error('share sheet failed'))
        .mockResolvedValueOnce(undefined);
      await openForm({ bugReport: { shareFiles } });

      await share(null);

      expect(sheetProps().shareNotice).toBe('share-failed');
      expect(screen.getByTestId('report-title')).toHaveTextContent('QA đã sửa');

      await share(null);

      expect(shareFiles).toHaveBeenCalledTimes(2);
      expect(sheetProps().shareNotice).toBeUndefined();
    });

    it('một lần chia sẻ một lúc; đường chia sẻ của app treo mãi ⇒ đóng rồi mở lại sheet là chia sẻ lại được, kết quả muộn của lần treo bị bỏ', async () => {
      let settleHung: () => void = () => undefined;
      const shareFiles = jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              settleHung = () => reject(new Error('late'));
            }),
        )
        .mockResolvedValue(undefined);
      await openForm({ bugReport: { shareFiles } });

      await share(null);
      await share(null);
      expect(shareFiles).toHaveBeenCalledTimes(1);

      act(() => sheetProps().onDismiss());
      shake();
      await settle();
      fireEvent.press(screen.getByTestId('devtools-row-report'));
      expect(sheetProps().visible).toBe(true);

      await share(null);
      expect(shareFiles).toHaveBeenCalledTimes(2);
      expect(sheetProps().shareNotice).toBeUndefined();

      /* Lần treo (lượt mở trước) cuối cùng ném: không thành câu báo của lượt này. */
      await act(async () => {
        settleHung();
      });
      await settle();
      expect(sheetProps().shareNotice).toBeUndefined();
      await share(null);
      expect(shareFiles).toHaveBeenCalledTimes(3);
    });

    it('`id` không còn trong hàng đợi ⇒ không gọi đường chia sẻ nào, câu "Không chia sẻ được"', async () => {
      const shareFiles = jest.fn(async () => undefined);
      await openForm({ bugReport: { secureStore: makeSecureStore(), shareFiles } });

      await share('rpt-gone');

      expect(shareFiles).not.toHaveBeenCalled();
      expect(sheetProps().shareNotice).toBe('share-failed');
    });
  });

  describe('Chụp lại — sheet không báo đã rời màn (`onClosed` bị lỡ)', () => {
    /** Mở form báo bug với nháp đã sửa, rồi bấm Chụp lại; sheet giả không nối `onClosed`. */
    const startRetake = async () => {
      jest.useFakeTimers();
      mockForwardClosed = false;
      const captureScreen = jest.fn(async (): Promise<DevToolsCapturedImage | null> => IMAGE);
      const view = renderReport({ bugReport: { captureScreen } });
      shake();
      await settle();
      fireEvent.press(screen.getByTestId('devtools-row-report'));
      fireEvent.press(screen.getByTestId('report-edit'));
      captureScreen.mockImplementation(async () => {
        mockEvents.push('capture');
        return IMAGE_2;
      });
      fireEvent.press(screen.getByTestId('report-retake'));
      return { captureScreen, view };
    };

    it(`quá ${RETAKE_CLOSE_FALLBACK_MS} ms vẫn chưa có \`onClosed\` ⇒ vẫn chụp, rồi quay về form với ảnh mới`, async () => {
      const { captureScreen } = await startRetake();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(RETAKE_CLOSE_FALLBACK_MS - 1);
      });
      expect(captureScreen).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('report-shot')).toBeNull();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1);
      });
      await settle();

      expect(mockEvents).toEqual(['capture']);
      expect(captureScreen).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('report-shot')).toHaveTextContent(IMAGE_2.uri);
      expect(screen.getByTestId('report-title')).toHaveTextContent('QA đã sửa');
    });

    it('lắc và `open()` trong lúc đợi bị bỏ qua; xong đợt chụp lại thì dùng lại được', async () => {
      const { captureScreen } = await startRetake();

      expect(listening()).toBe(false);
      fireEvent.press(screen.getByTestId('app-open'));
      act(() => mockShake.onShake?.());
      await settle();
      expect(panel()).toBeNull();
      expect(captureScreen).toHaveBeenCalledTimes(1);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(RETAKE_CLOSE_FALLBACK_MS);
      });
      await settle();
      expect(screen.getByTestId('report-shot')).toHaveTextContent(IMAGE_2.uri);

      act(() => lastMockSheet()?.close());
      expect(listening()).toBe(true);
      shake();
      await settle();

      expect(captureScreen).toHaveBeenCalledTimes(3);
      expect(panel()).toBeOnTheScreen();
    });

    it('gate gỡ khỏi cây trong lúc đợi ⇒ hẹn dự phòng bị huỷ, không chụp', async () => {
      const { captureScreen, view } = await startRetake();

      view.unmount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(RETAKE_CLOSE_FALLBACK_MS * 2);
      });

      expect(captureScreen).toHaveBeenCalledTimes(1);
      expect(mockEvents).toEqual([]);
    });

    it('app bỏ `bugReport` trong lúc đợi ⇒ không kẹt ở view báo bug rỗng: về app, lắc lại mở panel', async () => {
      const { captureScreen, view } = await startRetake();

      view.rerender(
        <DevToolsGate config={{ locale: 'vi', enabled: true }} actions={[]}>
          <Text testID="app-child">app</Text>
          <Opener />
        </DevToolsGate>,
      );
      await act(async () => {
        await jest.advanceTimersByTimeAsync(RETAKE_CLOSE_FALLBACK_MS);
      });
      await settle();

      expect(captureScreen).toHaveBeenCalledTimes(1);
      expect(listening()).toBe(true);
      shake();
      expect(panel()).toBeOnTheScreen();
    });
  });

  it('sheet báo bug do người dùng đóng (không phải Chụp lại) ⇒ không chụp, về app', async () => {
    const captureScreen = jest.fn(async () => IMAGE);
    renderReport({ bugReport: { captureScreen } });
    shake();
    await settle();
    fireEvent.press(screen.getByTestId('devtools-row-report'));

    act(() => lastMockSheet()?.close());
    await settle();

    expect(mockEvents).toEqual(['closed']);
    expect(captureScreen).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('report-shot')).toBeNull();
    expect(panel()).toBeNull();
  });

  it('hàng đợi: dựng một lần với các loại có sẵn; `load()` khi mount; nút Gửi chỉ sẵn sàng khi load xong', async () => {
    let finishLoad: () => void = () => undefined;
    mockQueue.load.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishLoad = resolve;
        }),
    );
    const secureStore = makeSecureStore();
    const { rerender } = renderReport({ bugReport: { secureStore } });

    expect(createSendQueue).toHaveBeenCalledTimes(1);
    const deps = jest.mocked(createSendQueue).mock.calls[0][0];
    expect(deps.connectorTypes.map((t) => t.id)).toEqual(['jira-cloud', 'slack', 'lark', 'webhook']);
    expect(deps.store).toBeUndefined();
    expect(mockQueue.load).toHaveBeenCalledTimes(1);

    shake();
    fireEvent.press(screen.getByTestId('devtools-row-report'));
    expect(screen.getByTestId('report-ready')).toHaveTextContent('false');
    expect(mockQueue.retryDue).not.toHaveBeenCalled();

    finishLoad();
    await settle();
    expect(screen.getByTestId('report-ready')).toHaveTextContent('true');

    /* App truyền object cấu hình MỚI mỗi lượt render (cùng `secureStore`) ⇒ không dựng lại, nháp còn. */
    rerender(
      <DevToolsGate config={{ locale: 'vi', enabled: true, bugReport: { secureStore } }} actions={[]}>
        <Text testID="app-child">app</Text>
        <Opener />
      </DevToolsGate>,
    );
    expect(createSendQueue).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('report-shot')).toHaveTextContent('none');
  });

  it('app viết `bugReport` inline (secureStore, connectorTypes MỚI mỗi lượt, cùng id) ⇒ không dựng lại; đọc qua object mới nhất', async () => {
    const storeA = makeSecureStore();
    const storeB = makeSecureStore();
    const getB = jest.spyOn(storeB, 'getItem');
    const getA = jest.spyOn(storeA, 'getItem');
    /* Chỉ bản mới nhất khai `token` là ô bí mật — để biết kho kết nối hỏi đúng bản đó. */
    const typeOf = (label: string, secretFieldIds: string[] = []) =>
      ({ id: 'linear', secretFieldIds, label: () => label }) as unknown as ConnectorType;
    const ui = (secureStore: DevToolsSecureStore, connectorTypes: readonly ConnectorType[]) => (
      <DevToolsGate config={{ locale: 'vi', enabled: true, bugReport: { secureStore, connectorTypes } }} actions={[]}>
        <Text testID="app-child">app</Text>
        <Opener />
      </DevToolsGate>
    );
    const { rerender } = renderWithDevTools(ui(storeA, [typeOf('v1')]));
    await settle();
    shake();
    fireEvent.press(screen.getByTestId('devtools-row-report'));
    expect(screen.getByTestId('report-ready')).toHaveTextContent('true');

    const latestType = typeOf('v3', ['token']);
    rerender(ui(storeA, [typeOf('v2')]));
    expect(screen.getByTestId('report-ready')).toHaveTextContent('true');
    rerender(ui(storeB, [latestType]));
    expect(screen.getByTestId('report-ready')).toHaveTextContent('true');
    await settle();

    expect(createSendQueue).toHaveBeenCalledTimes(1);
    expect(createConnectionStore).toHaveBeenCalledTimes(1);
    expect(mockQueue.load).toHaveBeenCalledTimes(1);
    expect(mockQueue.retryDue).toHaveBeenCalledTimes(2);

    const deps = jest.mocked(createSendQueue).mock.calls[0][0];
    expect(deps.connectorTypes.find((t) => t.id === 'linear')).toBe(latestType);
    getA.mockClear();
    await deps.connections.list();
    expect(getB).toHaveBeenCalled();
    expect(getA).not.toHaveBeenCalled();
    /* Ô bí mật lấy theo loại kết nối mới nhất: lưu `token` trong `values` bị chặn. */
    await expect(
      deps.connections.save(
        { id: 'c1', typeId: 'linear', name: 'L', ticketLocale: 'vi', values: { token: 'x' }, createdAt: 1 },
        {},
      ),
    ).rejects.toThrow(/token/);
  });

  it('đổi tập loại kết nối (id mới) ⇒ dựng lại hàng đợi với danh sách mới', async () => {
    const secureStore = makeSecureStore();
    const type = (id: string) => ({ id, secretFieldIds: [] }) as unknown as ConnectorType;
    const ui = (connectorTypes: readonly ConnectorType[]) => (
      <DevToolsGate config={{ locale: 'vi', enabled: true, bugReport: { secureStore, connectorTypes } }} actions={[]}>
        <Text testID="app-child">app</Text>
      </DevToolsGate>
    );
    const { rerender } = renderWithDevTools(ui([type('linear')]));
    rerender(ui([type('linear'), type('trello')]));

    expect(createSendQueue).toHaveBeenCalledTimes(2);
    expect(jest.mocked(createSendQueue).mock.calls[1][0].connectorTypes.map((t) => t.id)).toEqual([
      'jira-cloud',
      'slack',
      'lark',
      'webhook',
      'linear',
      'trello',
    ]);
    /* `load()` của hàng đợi resolve sau lượt render — nhả trong `act`. */
    await settle();
  });

  it('không có `secureStore` ⇒ không dựng hàng đợi, nút Gửi không sẵn sàng; vẫn có hàng Báo bug', () => {
    renderReport({ bugReport: {} });

    shake();
    expect(screen.getByTestId('devtools-row-report')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('devtools-row-report'));

    expect(createSendQueue).not.toHaveBeenCalled();
    expect(screen.getByTestId('report-ready')).toHaveTextContent('false');
  });

  it('`retryDue()` ngay sau khi load xong, khi app lên lại, khi mở panel, và mỗi 60 s lúc app đang mở', async () => {
    jest.useFakeTimers();
    const { unmount } = renderReport({ bugReport: { secureStore: makeSecureStore() } });
    await settle();
    expect(mockQueue.retryDue).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(RETRY_EVERY_MS);
    });
    expect(mockQueue.retryDue).toHaveBeenCalledTimes(2);

    emitAppState('background');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(RETRY_EVERY_MS * 3);
    });
    expect(mockQueue.retryDue).toHaveBeenCalledTimes(2);

    emitAppState('active');
    expect(mockQueue.retryDue).toHaveBeenCalledTimes(3);

    shake();
    expect(panel()).toBeOnTheScreen();
    expect(mockQueue.retryDue).toHaveBeenCalledTimes(4);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(RETRY_EVERY_MS);
    });
    expect(mockQueue.retryDue).toHaveBeenCalledTimes(5);

    unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(RETRY_EVERY_MS * 3);
    });
    expect(mockQueue.retryDue).toHaveBeenCalledTimes(5);
  });
});
