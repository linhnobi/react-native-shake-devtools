import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { useMemo, useSyncExternalStore } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { actionBuffer } from '../../capture/action-buffer';
import { logBuffer } from '../../capture/log-buffer';
import type { MarkerEntry, NetworkEntry } from '../../capture/log-entry';
import type { StoredSession } from '../../capture/log-session';
import type { RecordedAction } from '../../capture/recorded-action';
import { devtoolsStrings } from '../../i18n/translate';
import { gorhomKit } from '../../kits/gorhom-kit';
import { plainKit } from '../../kits/plain-kit';
import { copyText } from '../../panel/copy-text';
import { mockBackHandler, type BackHandlerMock } from '../../testing/back-handler.mock';
import { renderWithDevTools } from '../../testing/render-with-devtools';
import type { SheetKit } from '../../ui/sheet-kit';
import { darkTheme, lightTheme, type DevToolsTheme } from '../../ui/theme';
import type { BugReport, DevToolsCapturedImage, ScreenshotState } from '../bug-report';
import {
  createConnectionStore,
  type ConnectionStore,
  type StoredConnection,
} from '../connections/connection-store';
import {
  ConnectorError,
  type ConnectorType,
  type SendContext,
  type SendResult,
} from '../connectors/types';
import {
  createReportController,
  type ReportController,
  type ReportControllerStore,
} from '../report-controller';
import { createSendQueue, type SendQueue } from '../send-queue';
import { ReportSheet, type ReportSheetProps } from './ReportSheet';

/* Bộ nhớ tạm là native — spy để đọc đúng link được chép. */
jest.mock('../../panel/copy-text', () => ({ copyText: jest.fn(() => true) }));
/* ⚑ sau khi hàng đợi nhận bản báo: spy, để cửa sổ của nháp sau đo được theo `lastSentAt` (mốc ⚑ thật
   nằm đúng mốc đó và sẽ che mất nguồn `sent`). */
jest.mock('../../capture/markers', () => ({
  ...jest.requireActual('../../capture/markers'),
  markUser: jest.fn(() => 1),
}));

const vi = devtoolsStrings.vi;
const RAM_ONLY = 'Bản báo chỉ nằm trong bộ nhớ, sẽ mất nếu app bị tắt.';

const IMAGE: DevToolsCapturedImage = {
  uri: 'file:///cache/shot-1.jpg',
  mimeType: 'image/jpeg',
  width: 1080,
  height: 2400,
};

const JIRA: StoredConnection = {
  id: 'c-jira',
  typeId: 'jira-cloud',
  name: 'Jira · DEMO',
  ticketLocale: 'vi',
  values: {},
  createdAt: 1,
};
const SLACK: StoredConnection = {
  id: 'c-slack',
  typeId: 'slack',
  name: 'Slack · #qa',
  ticketLocale: 'vi',
  values: { mode: 'webhook' },
  createdAt: 2,
};

const SENT: SendResult = { key: 'DEMO-482', url: 'https://acme.atlassian.net/browse/DEMO-482' };

/** Loại kết nối giả: `light` ⇒ như Slack/Lark mức nhẹ (không ảnh, không file). */
const fakeType = (
  id: string,
  label: string,
  send: jest.Mock,
  light = false,
): ConnectorType => ({
  id,
  label: () => label,
  fields: () => [],
  secretFieldIds: ['token'],
  capabilities: () => (light ? { image: false, files: false } : { image: true, files: true }),
  test: async () => ({}),
  send,
});

const memoryStore = () => {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: async (k: string) => {
      m.delete(k);
    },
  };
};

const tap = (at: number, label: string): RecordedAction => ({ at, kind: 'tap', label, source: 'text' });
const http500 = (at: number): NetworkEntry => ({
  id: logBuffer.nextId(),
  kind: 'network',
  at,
  method: 'POST',
  url: 'https://api.test/orders?token=abc',
  status: 500,
  screen: 'Checkout',
});
const userMark = (at: number, label: string): MarkerEntry => ({
  id: logBuffer.nextId(),
  kind: 'marker',
  at,
  type: 'user',
  label,
});

const crashed = (): StoredSession => ({
  format: 2,
  name: 'session-1.json',
  startedAt: 1,
  savedAt: 2,
  fatal: true,
  totalInMemory: 2,
  entries: [
    {
      id: 1,
      kind: 'console',
      at: 3,
      level: 'error',
      uncaught: true,
      fatal: true,
      text: 'TypeError: boom',
    },
  ],
  actions: [tap(1, 'Giỏ hàng'), tap(2, 'Thanh toán')],
});

/** Vỏ thay `useReportController`: nháp thật của bộ điều khiển thuần, render lại khi nháp đổi. */
const Harness = ({
  store,
  ready,
  ...rest
}: Omit<ReportSheetProps, 'controller'> & { store: ReportControllerStore; ready: boolean }) => {
  const draft = useSyncExternalStore(store.subscribe, store.getDraft);
  const controller = useMemo<ReportController>(
    () => ({
      draft,
      ready,
      begin: store.begin,
      update: store.update,
      retake: store.retake,
      discard: store.discard,
      /* Tra `store.send` lúc gọi — test spy được sau khi render. */
      send: (connectionId) => store.send(connectionId),
      buildReport: store.buildReport,
      previewSteps: store.previewSteps,
      errorCount: store.errorCount,
    }),
    [draft, ready, store],
  );
  return <ReportSheet controller={controller} {...rest} />;
};

interface SetupOptions {
  kit: SheetKit;
  colorScheme?: 'light' | 'dark';
  shot?: ScreenshotState;
  /** Kết nối đã lưu. Mặc định `[JIRA]`. */
  saved?: StoredConnection[];
  lastUsed?: string;
  /** `send` của loại Jira giả. Mặc định trả `SENT`. */
  jiraSend?: jest.Mock;
  /** `send` của loại Slack nhẹ giả. */
  slackSend?: jest.Mock;
  /** Hàng đợi đã đọc xong file (R27). Mặc định `true` (khi có kho). */
  ready?: boolean;
  /** App không cấp `secureStore` ⇒ không kho kết nối, không hàng đợi. */
  noStore?: boolean;
  previous?: StoredSession | null;
  /** `bugReport.appContext` của app. Vắng ⇒ app không cấp. */
  appContext?: () => unknown;
  props?: Partial<Omit<ReportSheetProps, 'controller'>>;
}

/** Cho mọi lời hứa đang chờ (kho kết nối trong RAM, hàng đợi) chạy xong. */
const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

const setup = async (o: SetupOptions) => {
  const jiraSend = o.jiraSend ?? jest.fn(async () => SENT);
  const slackSend = o.slackSend ?? jest.fn(async (): Promise<SendResult> => ({}));
  const types = [
    fakeType('jira-cloud', 'Jira', jiraSend),
    fakeType('slack', 'Slack', slackSend, true),
  ];
  let connections: ConnectionStore | null = null;
  let queue: SendQueue | null = null;
  if (!o.noStore) {
    connections = createConnectionStore(memoryStore(), { secretFieldIdsOf: () => ['token'] });
    for (const c of o.saved ?? [JIRA]) await connections.save(c, { token: 'secret-1234' });
    if (o.lastUsed) await connections.setLastUsed(o.lastUsed);
    queue = createSendQueue({
      connections,
      connectorTypes: types,
      makeSendContext: (locale, resume, checkpoint) => ({
        fetch: jest.fn(),
        locale,
        timeoutMs: 30_000,
        resume,
        checkpoint,
        uploadPart: jest.fn(),
      }),
      now: () => Date.now(),
    });
  }
  const q = queue;
  const store = createReportController({
    strings: () => vi,
    queue: () => q,
    previous: () => o.previous ?? null,
    appContext: () => o.appContext,
  });
  store.begin(o.shot ?? IMAGE);
  /* Không có lỗi/mốc màn ⇒ gợi ý tiêu đề rỗng và Gửi khoá (R24). Ca nào không tự dựng tiêu đề thì
     nháp có sẵn một tiêu đề (vẫn là chữ "điền sẵn" — QA chưa gõ vào ô). */
  if (store.getDraft()?.title.trim() === '') store.update({ title: 'Không đặt được hàng' });
  const props = {
    visible: true,
    onDismiss: jest.fn(),
    onClosed: jest.fn(),
    onRetake: jest.fn(),
    onShare: jest.fn(),
    ...o.props,
  };
  const element = (visible: boolean) => (
    <Harness
      store={store}
      ready={o.ready ?? !o.noStore}
      queue={queue}
      connections={connections}
      connectorTypes={types}
      {...props}
      visible={visible}
    />
  );
  const view = renderWithDevTools(element(props.visible), {
    kit: o.kit,
    colorScheme: o.colorScheme,
  });
  await flush();
  /** Gate đổi `visible` (đóng bằng code / mở lại); đợi hết hoạt ảnh trượt của bộ thuần (200 ms). */
  const setVisible = async (visible: boolean) => {
    view.rerender(element(visible));
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
    });
  };
  return { store, queue, connections, props, jiraSend, slackSend, setVisible };
};

const send = () => screen.getByTestId('devtools-report-send');
const footer = () => screen.getByTestId('devtools-report-sheet-footer');

/** Bấm Gửi rồi đợi hàng đợi trả trạng thái. */
const pressSend = async () => {
  fireEvent.press(send());
  await flush();
};

/** Như gate: đóng sheet, rồi mở lại với một nháp mới (nháp cũ đã giao cho hàng đợi). */
const reopenWithNewDraft = async (s: Awaited<ReturnType<typeof setup>>) => {
  await s.setVisible(false);
  act(() => s.store.begin('none'));
  await s.setVisible(true);
};

/** testID theo đúng thứ tự cây đang vẽ (duyệt sâu). */
const testIdsInOrder = (): string[] => {
  const out: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const { props, children } = node as { props?: { testID?: string }; children?: unknown };
    if (props?.testID) out.push(props.testID);
    visit(children);
  };
  visit(screen.toJSON());
  return out;
};

const KITS: ReadonlyArray<readonly [string, SheetKit]> = [
  ['gorhom', gorhomKit],
  ['plain', plainKit],
];

let back: BackHandlerMock;

beforeEach(() => {
  logBuffer.clear();
  actionBuffer.clear();
  jest.mocked(copyText).mockClear();
  back = mockBackHandler();
});

afterEach(() => {
  back.restore();
  jest.restoreAllMocks();
});

describe.each(KITS)('ReportSheet — kit %s', (_name, kit) => {
  describe('form A+', () => {
    it('thứ tự: ảnh → tiêu đề → thẻ các bước → Thực tế → Mong đợi → chip → nút "Gửi tới <kết nối>" ở chân', async () => {
      actionBuffer.push(tap(Date.now() - 50, 'Giỏ hàng'));
      actionBuffer.push(tap(Date.now() - 40, 'Thanh toán'));
      actionBuffer.push(tap(Date.now() - 30, 'Xác nhận'));
      logBuffer.push(http500(Date.now() - 20));
      await setup({ kit });

      const ids = testIdsInOrder();
      const order = [
        'devtools-report-shot-image',
        'devtools-report-title-prefilled',
        'devtools-report-steps-card',
        'devtools-report-actual-prefilled',
        'devtools-report-expected',
        'devtools-report-attach-screenshot',
        'devtools-report-attach-errors',
        'devtools-report-attach-device',
        'devtools-report-send',
      ].map((id) => ids.indexOf(id));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);

      expect(screen.getByTestId('devtools-report-title-prefilled')).toHaveDisplayValue(
        '[Checkout] POST /orders → 500',
      );
      expect(screen.getByTestId('devtools-report-steps-card')).toHaveTextContent(
        '4 bước tự ghi · Sửa ›',
      );
      expect(screen.getByTestId('devtools-report-actual-prefilled')).toHaveDisplayValue(
        'Gặp lỗi: POST /orders → 500',
      );
      expect(screen.getByTestId('devtools-report-expected')).toHaveDisplayValue('');
      expect(screen.getByTestId('devtools-report-attach-errors')).toHaveTextContent('Log lỗi (1)');
      expect(within(footer()).getByTestId('devtools-report-send')).toHaveTextContent(
        'Gửi tới Jira · DEMO',
      );
      expect(within(footer()).getByTestId('devtools-report-pick')).toBeOnTheScreen();
    });

    it('tiêu đề và Thực tế điền sẵn mang hậu tố `-prefilled` tới khi QA sửa', async () => {
      logBuffer.push(http500(Date.now() - 20));
      const { store } = await setup({ kit });

      fireEvent.changeText(screen.getByTestId('devtools-report-title-prefilled'), 'Không đặt được hàng');

      expect(screen.queryByTestId('devtools-report-title-prefilled')).toBeNull();
      expect(screen.getByTestId('devtools-report-title')).toHaveDisplayValue('Không đặt được hàng');
      expect(screen.getByTestId('devtools-report-actual-prefilled')).toBeOnTheScreen();
      expect(store.getDraft()?.title).toBe('Không đặt được hàng');

      fireEvent.changeText(screen.getByTestId('devtools-report-actual-prefilled'), 'Quay vòng mãi');
      fireEvent.changeText(screen.getByTestId('devtools-report-expected'), 'Ra màn cảm ơn');

      expect(screen.getByTestId('devtools-report-actual')).toHaveDisplayValue('Quay vòng mãi');
      expect(store.getDraft()).toMatchObject({ actual: 'Quay vòng mãi', expected: 'Ra màn cảm ơn' });
    });

    it('tiêu đề trống/chỉ khoảng trắng ⇒ Gửi khoá, có dòng nhắc dưới tiêu đề (R24)', async () => {
      logBuffer.push(http500(Date.now() - 20));
      const { jiraSend } = await setup({ kit });
      expect(screen.queryByTestId('devtools-report-title-required')).toBeNull();

      fireEvent.changeText(screen.getByTestId('devtools-report-title-prefilled'), '   ');

      expect(screen.getByTestId('devtools-report-title-required')).toHaveTextContent(
        'Cần có tiêu đề để gửi',
      );
      expect(send()).toBeDisabled();
      await pressSend();
      expect(jiraSend).not.toHaveBeenCalled();
    });

    it('hàng đợi chưa đọc xong (`ready` false) ⇒ Gửi khoá với nhãn đang chuẩn bị (R27)', async () => {
      await setup({ kit, ready: false });

      expect(send()).toHaveTextContent('Đang chuẩn bị…');
      expect(send()).toBeDisabled();
    });

    it('ảnh: có ảnh ⇒ ảnh thu nhỏ; "Chụp lại" gọi `onRetake`', async () => {
      const { props } = await setup({ kit });

      expect(screen.getByTestId('devtools-report-shot-image').props.source).toEqual({
        uri: IMAGE.uri,
      });
      fireEvent.press(screen.getByTestId('devtools-report-retake'));
      expect(props.onRetake).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['blocked', 'Màn này không cho chụp ảnh'],
      ['failed', 'Không chụp được ảnh'],
    ] as const)('ảnh `%s` ⇒ chỗ ảnh ghi "%s", vẫn có "Chụp lại", không có chip Ảnh', async (shot, text) => {
      const { props } = await setup({ kit, shot });

      expect(screen.getByTestId('devtools-report-shot')).toHaveTextContent(text, { exact: false });
      expect(screen.queryByTestId('devtools-report-shot-image')).toBeNull();
      expect(screen.queryByTestId('devtools-report-attach-screenshot')).toBeNull();
      fireEvent.press(screen.getByTestId('devtools-report-retake'));
      expect(props.onRetake).toHaveBeenCalledTimes(1);
    });

    it('ảnh `none` (app không cấp hàm chụp) ⇒ không có khối ảnh', async () => {
      await setup({ kit, shot: 'none' });

      expect(screen.queryByTestId('devtools-report-shot')).toBeNull();
      expect(screen.queryByTestId('devtools-report-retake')).toBeNull();
      expect(screen.getByTestId('devtools-report-title-prefilled')).toBeOnTheScreen();
    });

    it('chip bật sẵn; chạm thì tắt/bật đúng phần đính kèm của nháp', async () => {
      const { store } = await setup({ kit });
      const chip = (id: string) => screen.getByTestId(`devtools-report-attach-${id}`);
      expect(chip('screenshot')).toBeSelected();
      expect(chip('errors')).toBeSelected();
      expect(chip('device')).toBeSelected();
      expect(screen.queryByTestId('devtools-report-attach-previous')).toBeNull();

      fireEvent.press(chip('errors'));
      fireEvent.press(chip('device'));

      expect(store.getDraft()?.attach).toEqual({
        screenshot: true,
        errors: false,
        deviceInfo: false,
        previousSession: false,
        appContext: true,
      });
      expect(chip('errors')).not.toBeSelected();
      fireEvent.press(chip('errors'));
      expect(store.getDraft()?.attach.errors).toBe(true);
    });

    describe('chip "Ngữ cảnh app"', () => {
      const chip = () => screen.getByTestId('devtools-report-attach-context');

      it('app cấp `appContext` ⇒ chip bật sẵn sau chip Thông tin máy; chạm thì tắt/bật đúng phần của nháp', async () => {
        const { store } = await setup({ kit, appContext: () => ({ userId: 'u-42' }) });

        expect(chip()).toHaveTextContent('Ngữ cảnh app');
        expect(chip()).toBeSelected();
        expect(chip()).toBeEnabled();
        const ids = testIdsInOrder();
        expect(ids.indexOf('devtools-report-attach-context')).toBeGreaterThan(
          ids.indexOf('devtools-report-attach-device'),
        );

        fireEvent.press(chip());
        expect(store.getDraft()?.attach.appContext).toBe(false);
        expect(chip()).not.toBeSelected();
        expect(store.buildReport()?.files.map((f) => f.name)).not.toContain('context.json');
        fireEvent.press(chip());
        expect(store.getDraft()?.attach.appContext).toBe(true);
        expect(store.buildReport()?.files.map((f) => f.name)).toContain('context.json');
      });

      it('app không cấp ⇒ không có chip', async () => {
        await setup({ kit });
        expect(screen.queryByTestId('devtools-report-attach-context')).toBeNull();
      });

      it('hàm ngữ cảnh ném ⇒ form vẫn chạy, chip khoá với câu "không lấy được"', async () => {
        await setup({
          kit,
          appContext: () => {
            throw new Error('store not ready');
          },
        });

        expect(chip()).toBeDisabled();
        expect(chip()).toHaveTextContent('Ngữ cảnh app: không lấy được');
        expect(screen.getByTestId('devtools-report-title-prefilled')).toBeOnTheScreen();
      });

      it('hàm async ⇒ chip khoá lúc chờ, mở khi có kết quả', async () => {
        let resolve: (value: object) => void = () => undefined;
        await setup({
          kit,
          appContext: () =>
            new Promise<object>((r) => {
              resolve = r;
            }),
        });
        expect(chip()).toBeDisabled();

        await act(async () => {
          resolve({ flags: { newCheckout: true } });
        });

        expect(chip()).toBeEnabled();
        expect(chip()).toBeSelected();
      });

      it('kết nối mức nhẹ ⇒ chip vẫn bật được (ngữ cảnh đi trong thân tin, không phải file)', async () => {
        await setup({ kit, saved: [SLACK], appContext: () => ({ userId: 'u-42' }) });

        expect(chip()).toBeEnabled();
        expect(chip()).toBeSelected();
      });

      it('nháp sau crash ⇒ không có chip (không gọi hàm ngữ cảnh)', async () => {
        const read = jest.fn(() => ({ userId: 'u-42' }));
        await setup({ kit, previous: crashed(), appContext: read });

        expect(screen.queryByTestId('devtools-report-attach-context')).toBeNull();
        expect(read).not.toHaveBeenCalled();
      });
    });

    it('nháp sau crash ⇒ chip "Phiên trước (crash)" bật sẵn, chip Ảnh tắt sẵn; tiêu đề `[Crash]`', async () => {
      await setup({ kit, previous: crashed() });

      expect(screen.getByTestId('devtools-report-attach-previous')).toHaveTextContent(
        'Phiên trước (crash)',
      );
      expect(screen.getByTestId('devtools-report-attach-previous')).toBeSelected();
      expect(screen.getByTestId('devtools-report-attach-screenshot')).not.toBeSelected();
      expect(screen.getByTestId('devtools-report-title-prefilled')).toHaveDisplayValue(
        '[Crash] TypeError: boom',
      );
    });

    it('nháp sau crash ⇒ chip "Log lỗi (N)" đếm lỗi của phiên crash, không phải phiên hiện tại', async () => {
      /* Phiên hiện tại (sau khi mở lại app) có 2 lỗi; phiên crash có 1 — errors.txt lấy từ phiên crash. */
      logBuffer.push(http500(Date.now() - 30));
      logBuffer.push(http500(Date.now() - 20));
      await setup({ kit, previous: crashed() });

      expect(screen.getByTestId('devtools-report-attach-errors')).toHaveTextContent('Log lỗi (1)');
    });

    it('kết nối mức nhẹ (`capabilities.image` false) ⇒ chip Ảnh và Log lỗi tắt, khoá, có lý do', async () => {
      const { store } = await setup({ kit, saved: [SLACK] });

      const shot = screen.getByTestId('devtools-report-attach-screenshot');
      const errors = screen.getByTestId('devtools-report-attach-errors');
      expect(shot).toBeDisabled();
      expect(errors).toBeDisabled();
      expect(shot).not.toBeSelected();
      expect(errors).not.toBeSelected();
      expect(screen.getByTestId('devtools-report-attach-device')).toBeEnabled();
      expect(screen.getByTestId('devtools-report-attach-unsupported')).toHaveTextContent(
        'Kết nối này chỉ gửi chữ nên không kèm được ảnh và file. Gửi xong có nút chia sẻ chúng.',
      );

      fireEvent.press(errors);
      expect(store.getDraft()?.attach.errors).toBe(true);
      expect(send()).toHaveTextContent('Gửi tới Slack · #qa');
    });

    it('chưa có kết nối nào ⇒ nút chân là "Thêm kết nối" (mở trang Kết nối), vẫn có "Chia sẻ"', async () => {
      const { props } = await setup({ kit, saved: [] });

      expect(screen.queryByTestId('devtools-report-send')).toBeNull();
      fireEvent.press(within(footer()).getByText('Chia sẻ'));
      /* R35: chia sẻ từ form ⇒ `null` = bản nháp đang soạn. */
      expect(props.onShare).toHaveBeenCalledTimes(1);
      expect(props.onShare).toHaveBeenCalledWith(null);

      fireEvent.press(within(footer()).getByText('Thêm kết nối'));
      await flush();
      expect(screen.getByTestId('connections-page')).toBeOnTheScreen();
    });

    it('app không cấp kho bảo mật ⇒ như chưa có kết nối: "Thêm kết nối" + "Chia sẻ"', async () => {
      const { props } = await setup({ kit, noStore: true });

      expect(within(footer()).getByTestId('devtools-report-add-connection')).toBeOnTheScreen();
      fireEvent.press(within(footer()).getByTestId('devtools-report-share'));
      expect(props.onShare).toHaveBeenCalledTimes(1);
      expect(props.onShare).toHaveBeenCalledWith(null);
    });

    it('nhớ kết nối dùng lần trước; "▾" mở danh sách, chọn kết nối khác ⇒ về form, nhớ lựa chọn', async () => {
      const { connections } = await setup({
        kit,
        saved: [JIRA, SLACK],
        lastUsed: 'c-slack',
      });
      expect(send()).toHaveTextContent('Gửi tới Slack · #qa');

      fireEvent.press(screen.getByTestId('devtools-report-pick'));
      expect(screen.getByTestId('devtools-report-connection-c-jira')).toHaveTextContent('Jira · DEMO', {
        exact: false,
      });
      expect(screen.getByTestId('devtools-report-connection-c-slack')).toBeSelected();
      fireEvent.press(screen.getByTestId('devtools-report-connection-c-jira'));
      await flush();

      expect(send()).toHaveTextContent('Gửi tới Jira · DEMO');
      expect(await connections?.lastUsed()).toBe('c-jira');

      fireEvent.press(screen.getByTestId('devtools-report-pick'));
      fireEvent.press(screen.getByTestId('devtools-report-manage-connections'));
      await flush();
      expect(screen.getByTestId('connections-page')).toBeOnTheScreen();
    });

    it('"Huỷ nháp" hỏi lại một lần; bấm lần hai mới huỷ và đóng sheet', async () => {
      const { store, props } = await setup({ kit });

      fireEvent.press(screen.getByTestId('devtools-report-discard'));
      expect(store.getDraft()).not.toBeNull();
      expect(screen.getByTestId('devtools-report-discard')).toHaveTextContent('Huỷ thật?');

      fireEvent.press(screen.getByTestId('devtools-report-discard'));
      expect(store.getDraft()).toBeNull();
      expect(props.onDismiss).toHaveBeenCalledTimes(1);
    });

    it('`shareNotice: image-dropped` ⇒ câu "Ảnh không chia sẻ được, app chưa hỗ trợ"', async () => {
      await setup({ kit, saved: [], props: { shareNotice: 'image-dropped' } });

      expect(screen.getByTestId('devtools-report-share-notice')).toHaveTextContent(
        'Ảnh không chia sẻ được, app chưa hỗ trợ',
      );
    });

    it('`shareNotice: share-failed` ⇒ câu "Không chia sẻ được", nháp và form còn nguyên', async () => {
      const { store } = await setup({ kit, saved: [], props: { shareNotice: 'share-failed' } });

      expect(screen.getByTestId('devtools-report-share-notice')).toHaveTextContent(
        'Không chia sẻ được',
      );
      expect(screen.getByTestId('devtools-report-form')).toBeOnTheScreen();
      expect(store.getDraft()?.title).toBe('Không đặt được hàng');
    });

    it('nối `onClosed` vào sheet (R29): đóng bằng code ⇒ sheet báo đã rời màn', async () => {
      const { props, setVisible } = await setup({ kit });

      await setVisible(false);

      expect(props.onClosed).toHaveBeenCalledTimes(1);
      expect(props.onDismiss).not.toHaveBeenCalled();
    });
  });

  describe('trang sửa các bước', () => {
    const openSteps = async (o: Partial<SetupOptions> = {}) => {
      actionBuffer.push(tap(Date.now() - 50, 'Giỏ hàng'));
      actionBuffer.push(tap(Date.now() - 40, 'Thanh toán'));
      actionBuffer.push(tap(Date.now() - 30, 'Xác nhận'));
      const ctx = await setup({ kit, ...o });
      fireEvent.press(screen.getByTestId('devtools-report-steps-card'));
      return ctx;
    };
    const stepText = (i: number) => screen.getByTestId(`devtools-report-step-${i}`).props.value;

    it('▲ trên bước 2 ⇒ bước 2 lên đầu; ▲ bước đầu và ▼ bước cuối bị khoá', async () => {
      const { store } = await openSteps();
      expect([0, 1, 2].map(stepText)).toEqual([
        'Chạm "Giỏ hàng"',
        'Chạm "Thanh toán"',
        'Chạm "Xác nhận"',
      ]);
      expect(screen.getByTestId('devtools-report-step-up-0')).toBeDisabled();
      expect(screen.getByTestId('devtools-report-step-down-2')).toBeDisabled();

      fireEvent.press(screen.getByTestId('devtools-report-step-up-1'));

      expect([0, 1, 2].map(stepText)).toEqual([
        'Chạm "Thanh toán"',
        'Chạm "Giỏ hàng"',
        'Chạm "Xác nhận"',
      ]);
      expect(store.getDraft()?.steps.map((s) => s.label)).toEqual(['Thanh toán', 'Giỏ hàng', 'Xác nhận']);

      fireEvent.press(screen.getByTestId('devtools-report-step-down-0'));
      expect(store.getDraft()?.steps.map((s) => s.label)).toEqual(['Giỏ hàng', 'Thanh toán', 'Xác nhận']);
    });

    it('xoá một bước', async () => {
      const { store } = await openSteps();

      fireEvent.press(screen.getByTestId('devtools-report-step-delete-1'));

      expect(store.getDraft()?.steps.map((s) => s.label)).toEqual(['Giỏ hàng', 'Xác nhận']);
      expect(screen.queryByTestId('devtools-report-step-2')).toBeNull();
    });

    it('sửa chữ ⇒ bước thành `kind: text` mang đúng chữ QA gõ', async () => {
      const { store } = await openSteps();
      const original = store.getDraft()?.steps[1];

      fireEvent.changeText(screen.getByTestId('devtools-report-step-1'), 'Chạm "Thanh toán" 2 lần');

      expect(store.getDraft()?.steps[1]).toEqual({
        id: original?.id,
        kind: 'text',
        at: original?.at,
        text: 'Chạm "Thanh toán" 2 lần',
      });
      expect(stepText(1)).toBe('Chạm "Thanh toán" 2 lần');
    });

    it('"+ Thêm bước" thêm một bước `text` rỗng ở cuối, ô nhập của nó được focus', async () => {
      const { store } = await openSteps();
      expect(screen.getByTestId('devtools-report-step-2').props.autoFocus).toBeFalsy();

      fireEvent.press(screen.getByText('+ Thêm bước'));

      const steps = store.getDraft()?.steps ?? [];
      expect(steps).toHaveLength(4);
      expect(steps[3]).toMatchObject({ kind: 'text', text: '' });
      expect(screen.getByTestId('devtools-report-step-3')).toHaveDisplayValue('');
      expect(screen.getByTestId('devtools-report-step-3').props.autoFocus).toBe(true);
      expect(screen.getByTestId('devtools-report-step-2').props.autoFocus).toBeFalsy();
    });

    it('dòng ghi chú: mốc ⚑ ⇒ "Ghi từ mốc ⚑ #2 lúc 10:42"', async () => {
      logBuffer.push(userMark(new Date(2026, 10, 6, 10, 42, 5).getTime(), '2'));
      await setup({ kit, shot: 'none' });
      fireEvent.press(screen.getByTestId('devtools-report-steps-card'));

      expect(screen.getByTestId('devtools-report-steps-note')).toHaveTextContent(
        'Ghi từ mốc ⚑ #2 lúc 10:42',
      );
    });

    it('dòng ghi chú: chưa có mốc nào ⇒ "Ghi từ lúc mở app"', async () => {
      await setup({ kit, shot: 'none' });
      fireEvent.press(screen.getByTestId('devtools-report-steps-card'));

      expect(screen.getByTestId('devtools-report-steps-note')).toHaveTextContent('Ghi từ lúc mở app');
    });

    it('dòng ghi chú: lần gửi trước ⇒ "Ghi từ lần gửi trước lúc 11:05"', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 6, 11, 5, 30).getTime());
      const { store, setVisible } = await setup({ kit, shot: 'none' });
      await pressSend();
      expect(screen.getByTestId('devtools-report-status-sent')).toBeOnTheScreen();

      /* Như gate: đóng sheet, QA bấm "Báo bug" lần nữa ⇒ nháp mới, sheet mở lại ở form. */
      await setVisible(false);
      act(() => store.begin('none'));
      await setVisible(true);
      fireEvent.press(screen.getByTestId('devtools-report-steps-card'));

      expect(screen.getByTestId('devtools-report-steps-note')).toHaveTextContent(
        'Ghi từ lần gửi trước lúc 11:05',
      );
    });

    it('nháp sau crash ⇒ ghi chú nói các bước lấy từ phiên trước', async () => {
      await setup({ kit, shot: 'none', previous: crashed() });
      fireEvent.press(screen.getByTestId('devtools-report-steps-card'));

      expect(screen.getByTestId('devtools-report-steps-note')).toHaveTextContent(
        'Các bước của phiên trước, trước khi app crash',
      );
      expect(stepText(0)).toBe('Chạm "Giỏ hàng"');
    });

    it('Back: trang các bước ⇒ về form (sheet còn mở); form ⇒ đóng sheet, nháp vẫn còn', async () => {
      const { store, props } = await openSteps();
      expect(screen.getByTestId('devtools-report-steps')).toBeOnTheScreen();

      act(() => {
        back.pressBack();
      });
      expect(screen.queryByTestId('devtools-report-steps')).toBeNull();
      expect(screen.getByTestId('devtools-report-form')).toBeOnTheScreen();
      expect(props.onDismiss).not.toHaveBeenCalled();

      act(() => {
        back.pressBack();
      });
      expect(props.onDismiss).toHaveBeenCalledTimes(1);
      expect(store.getDraft()).not.toBeNull();
    });

    it('nút ‹ ở header của trang các bước ⇒ về form', async () => {
      await openSteps();

      fireEvent.press(screen.getByTestId('devtools-report-back'));

      expect(screen.getByTestId('devtools-report-form')).toBeOnTheScreen();
    });
  });

  describe('gửi và kết quả', () => {
    it('bấm Gửi ⇒ nút khoá tới khi hàng đợi trả trạng thái; bấm hai lần liền chỉ một lần gửi', async () => {
      let release: (r: SendResult) => void = () => undefined;
      const jiraSend = jest.fn(
        () =>
          new Promise<SendResult>((resolve) => {
            release = resolve;
          }),
      );
      const { store } = await setup({ kit, jiraSend });
      const submit = jest.spyOn(store, 'send');

      /* Hai cú chạm trong cùng một khung hình: lượt render khoá nút chưa kịp chạy. */
      act(() => {
        fireEvent.press(send());
        fireEvent.press(send());
      });
      await flush();

      expect(send()).toBeDisabled();
      fireEvent.press(send());
      await flush();
      /* Chốt ở chính nút (không chỉ nhờ hàng đợi gộp theo `report.id`). */
      expect(submit).toHaveBeenCalledTimes(1);
      expect(jiraSend).toHaveBeenCalledTimes(1);

      await act(async () => release(SENT));
      await flush();

      expect(screen.getByTestId('devtools-report-status-sent')).toBeOnTheScreen();
      expect(submit).toHaveBeenCalledTimes(1);
      expect(jiraSend).toHaveBeenCalledTimes(1);
    });

    it('`sent` ⇒ "Đã tạo DEMO-482", Mở / Chép link / Báo bug khác; nháp đã giao cho hàng đợi', async () => {
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
      const { store, props } = await setup({ kit });

      await pressSend();

      expect(screen.getByTestId('devtools-report-status-sent')).toHaveTextContent('Đã tạo DEMO-482');
      expect(store.getDraft()).toBeNull();
      fireEvent.press(screen.getByText('Mở'));
      expect(openURL).toHaveBeenCalledWith(SENT.url);
      fireEvent.press(screen.getByText('Chép link'));
      expect(copyText).toHaveBeenCalledWith(SENT.url);
      fireEvent.press(screen.getByText('Báo bug khác'));
      expect(props.onRetake).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Chia sẻ ảnh và log')).toBeNull();
    });

    it('`sent` có `skippedFiles` ⇒ câu ghi file nào chưa gửi được', async () => {
      await setup({
        kit,
        jiraSend: jest.fn(async () => ({ ...SENT, skippedFiles: ['screenshot.jpg'] })),
      });

      await pressSend();

      expect(screen.getByTestId('devtools-report-status-sent')).toBeOnTheScreen();
      expect(screen.getByTestId('devtools-report-skipped')).toHaveTextContent(
        'File chưa gửi được: screenshot.jpg',
      );
    });

    it('`sent` qua kết nối mức nhẹ ⇒ có "Chia sẻ ảnh và log"; không có link thì không có Mở / Chép link', async () => {
      const { props, store } = await setup({ kit, saved: [SLACK] });
      const reportId = store.getDraft()?.id;

      await pressSend();

      expect(screen.getByTestId('devtools-report-status-sent')).toHaveTextContent('Đã gửi');
      expect(screen.queryByText('Mở')).toBeNull();
      expect(screen.queryByText('Chép link')).toBeNull();
      fireEvent.press(screen.getByText('Chia sẻ ảnh và log'));
      /* R35: nháp đã giao cho hàng đợi ⇒ chia sẻ đúng bản báo đang hiện (theo id). */
      expect(props.onShare).toHaveBeenCalledTimes(1);
      expect(props.onShare).toHaveBeenCalledWith(reportId);
    });

    it('`pending` ⇒ "Đã xếp hàng, sẽ tự gửi lại" + "Chia sẻ thay vì gửi"', async () => {
      const { props, store } = await setup({
        kit,
        jiraSend: jest.fn(async () => {
          throw new ConnectorError('network', 'offline');
        }),
      });
      const reportId = store.getDraft()?.id;

      await pressSend();

      expect(screen.getByTestId('devtools-report-status-pending')).toHaveTextContent(
        'Đã xếp hàng, sẽ tự gửi lại',
      );
      expect(store.getDraft()).toBeNull();
      fireEvent.press(screen.getByText('Chia sẻ thay vì gửi'));
      expect(props.onShare).toHaveBeenCalledTimes(1);
      expect(props.onShare).toHaveBeenCalledWith(reportId);
    });

    it('`uncertain` ⇒ "Không chắc đã gửi, kiểm tra ở Jira trước khi gửi lại" + nút gửi lại thủ công', async () => {
      const jiraSend = jest
        .fn()
        .mockRejectedValueOnce(new ConnectorError('uncertain', 'timeout'))
        .mockResolvedValueOnce(SENT);
      await setup({ kit, jiraSend });

      await pressSend();

      expect(screen.getByTestId('devtools-report-status-uncertain')).toHaveTextContent(
        'Không chắc đã gửi, kiểm tra ở Jira trước khi gửi lại',
      );
      fireEvent.press(screen.getByText('Gửi lại'));
      await flush();

      expect(jiraSend).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('devtools-report-status-sent')).toHaveTextContent('Đã tạo DEMO-482');
    });

    it('`blocked`/`auth` ⇒ "Token Jira hết hạn, nhập lại" + mở màn kết nối (Quay lại về trang kết quả); nháp còn nguyên, sửa rồi gửi lại được', async () => {
      const jiraSend = jest
        .fn()
        .mockRejectedValueOnce(new ConnectorError('auth', 'Token expired', { status: 401 }))
        .mockResolvedValueOnce(SENT);
      const { store } = await setup({ kit, jiraSend });
      fireEvent.changeText(
        screen.getByTestId('devtools-report-title-prefilled'),
        'Không đặt được hàng',
      );

      await pressSend();

      expect(screen.getByTestId('devtools-report-status-blocked')).toHaveTextContent(
        'Token Jira hết hạn, nhập lại',
      );
      expect(store.getDraft()?.title).toBe('Không đặt được hàng');
      fireEvent.press(screen.getByText('Mở màn kết nối'));
      await flush();
      expect(screen.getByTestId('connection-row-c-jira')).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('connections-back'));
      await flush();
      expect(screen.getByTestId('devtools-report-status-blocked')).toBeOnTheScreen();

      fireEvent.press(screen.getByText('Sửa bản báo'));
      expect(screen.getByTestId('devtools-report-title')).toHaveDisplayValue('Không đặt được hàng');
      fireEvent.changeText(screen.getByTestId('devtools-report-title'), 'Không đặt được hàng (2)');
      await pressSend();

      expect(jiraSend).toHaveBeenCalledTimes(2);
      expect((jiraSend.mock.calls[1][0] as BugReport).title).toBe('Không đặt được hàng (2)');
      expect(screen.getByTestId('devtools-report-status-sent')).toBeOnTheScreen();
    });

    it('`blocked`: Back ⇒ về form (không đóng sheet)', async () => {
      const { props } = await setup({
        kit,
        jiraSend: jest.fn(async () => {
          throw new ConnectorError('permission', 'Bot is not in the channel');
        }),
      });
      await pressSend();
      expect(screen.getByTestId('devtools-report-status-blocked')).toHaveTextContent(
        'Không đủ quyền gửi tới Jira',
      );
      expect(screen.getByTestId('devtools-report-status-detail')).toHaveTextContent(
        'Bot is not in the channel',
      );

      act(() => {
        back.pressBack();
      });

      expect(screen.getByTestId('devtools-report-form')).toBeOnTheScreen();
      expect(props.onDismiss).not.toHaveBeenCalled();
    });

    it('`failed` ⇒ "Gửi thất bại" + Chia sẻ', async () => {
      const { props, store } = await setup({
        kit,
        jiraSend: jest.fn(async () => {
          throw new Error('boom');
        }),
      });
      const reportId = store.getDraft()?.id;

      await pressSend();

      expect(screen.getByTestId('devtools-report-status-failed')).toHaveTextContent('Gửi thất bại');
      fireEvent.press(within(screen.getByTestId('devtools-report-status')).getByText('Chia sẻ'));
      expect(props.onShare).toHaveBeenCalledTimes(1);
      expect(props.onShare).toHaveBeenCalledWith(reportId);
    });

    it('`blocked` / kết nối không còn ⇒ câu báo + "Chia sẻ" bản báo đó (R35); nháp còn nguyên', async () => {
      /* Kết nối trỏ tới một loại app đã bỏ ⇒ hàng đợi chặn với `connection-missing`. */
      const gone: StoredConnection = { ...JIRA, id: 'c-gone', typeId: 'linear', name: 'Linear · QA' };
      const { props, store } = await setup({ kit, saved: [gone] });
      const reportId = store.getDraft()?.id;

      await pressSend();

      expect(screen.getByTestId('devtools-report-status-blocked')).toHaveTextContent(
        'Kết nối này không còn (đã bị xoá hoặc mất thông tin đăng nhập)',
      );
      expect(store.getDraft()?.id).toBe(reportId);
      fireEvent.press(within(screen.getByTestId('devtools-report-status')).getByText('Chia sẻ'));
      expect(props.onShare).toHaveBeenCalledTimes(1);
      expect(props.onShare).toHaveBeenCalledWith(reportId);
      expect(screen.getByText('Sửa bản báo')).toBeOnTheScreen();
    });

    it('`blocked` khi ticket ĐÃ tạo (`resume.committed`) ⇒ nói rõ gửi lại chỉ làm nốt, chữ sửa không áp dụng; gửi lại cùng kết nối ⇒ làm nốt mục cũ (R34)', async () => {
      const jiraSend = jest
        .fn()
        .mockImplementationOnce(async (_r: BugReport, _v: unknown, _s: unknown, ctx: SendContext) => {
          ctx.checkpoint({ issueKey: 'DEMO-482', committed: true });
          throw new ConnectorError('permission', 'Cannot attach files');
        })
        .mockResolvedValueOnce(SENT);
      await setup({ kit, jiraSend });

      await pressSend();

      const note =
        'Ticket đã được tạo ở Jira. Gửi lại tới kết nối này chỉ gửi nốt phần còn thiếu; chữ đã sửa sẽ không được áp dụng.';
      expect(screen.getByTestId('devtools-report-status-blocked')).toBeOnTheScreen();
      expect(screen.getByTestId('devtools-report-committed')).toHaveTextContent(note);

      fireEvent.press(screen.getByText('Sửa bản báo'));
      expect(screen.getByTestId('devtools-report-committed')).toHaveTextContent(note);
      fireEvent.changeText(screen.getByTestId('devtools-report-title-prefilled'), 'Chữ sửa sau');
      await pressSend();

      expect(jiraSend).toHaveBeenCalledTimes(2);
      const [report, , , ctx] = jiraSend.mock.calls[1] as [BugReport, unknown, unknown, SendContext];
      expect(report.title).toBe('Không đặt được hàng');
      expect(ctx.resume).toMatchObject({ issueKey: 'DEMO-482', committed: true });
      expect(screen.getByTestId('devtools-report-status-sent')).toHaveTextContent('Đã tạo DEMO-482');
    });

    it('`blocked` khi ticket đã tạo nhưng QA chọn kết nối KHÁC ⇒ không có câu "làm nốt"; gửi bản sửa tới kết nối mới', async () => {
      const jiraSend = jest.fn(async (_r: BugReport, _v: unknown, _s: unknown, ctx: SendContext) => {
        ctx.checkpoint({ issueKey: 'DEMO-482', committed: true });
        throw new ConnectorError('permission', 'Cannot attach files');
      });
      const { slackSend } = await setup({ kit, jiraSend, saved: [JIRA, SLACK] });
      await pressSend();

      fireEvent.press(screen.getByText('Sửa bản báo'));
      fireEvent.press(screen.getByTestId('devtools-report-pick'));
      fireEvent.press(screen.getByTestId('devtools-report-connection-c-slack'));
      await flush();
      expect(screen.queryByTestId('devtools-report-committed')).toBeNull();
      fireEvent.changeText(screen.getByTestId('devtools-report-title-prefilled'), 'Chữ sửa sau');
      await pressSend();

      expect(jiraSend).toHaveBeenCalledTimes(1);
      expect(slackSend).toHaveBeenCalledTimes(1);
      expect((slackSend.mock.calls[0][0] as BugReport).title).toBe('Chữ sửa sau');
      expect(screen.getByTestId('devtools-report-status-sent')).toBeOnTheScreen();
    });

    it.each([
      ['pending', 'network'],
      ['uncertain', 'uncertain'],
      ['failed', 'unknown'],
    ] as const)(
      '`%s` khi hàng đợi chỉ nằm trong RAM (`ramOnlyQueue`) ⇒ câu "sẽ mất nếu app bị tắt" (spec 5.6)',
      async (state, kind) => {
        await setup({ kit, jiraSend: failing(kind), props: { ramOnlyQueue: true } });

        await pressSend();

        expect(screen.getByTestId(`devtools-report-status-${state}`)).toBeOnTheScreen();
        expect(screen.getByTestId('devtools-report-ram-only')).toHaveTextContent(RAM_ONLY);
      },
    );

    it('hàng đợi lưu bền (không `ramOnlyQueue`) ⇒ `pending` không có câu RAM', async () => {
      await setup({ kit, jiraSend: failing('network') });

      await pressSend();

      expect(screen.getByTestId('devtools-report-status-pending')).toBeOnTheScreen();
      expect(screen.queryByTestId('devtools-report-ram-only')).toBeNull();
    });

    it.each([
      ['sent', undefined],
      ['blocked', 'auth'],
    ] as const)('`%s` không có câu RAM kể cả khi hàng đợi chỉ ở RAM', async (state, kind) => {
      await setup({
        kit,
        jiraSend: kind ? failing(kind) : undefined,
        props: { ramOnlyQueue: true },
      });

      await pressSend();

      expect(screen.getByTestId(`devtools-report-status-${state}`)).toBeOnTheScreen();
      expect(screen.queryByTestId('devtools-report-ram-only')).toBeNull();
    });

    it('trạng thái theo hàng đợi: mục `pending` được gửi lại xong ⇒ màn tự đổi sang `sent`', async () => {
      const jiraSend = jest
        .fn()
        .mockRejectedValueOnce(new ConnectorError('network', 'offline'))
        .mockResolvedValueOnce(SENT);
      const at = Date.now();
      const now = jest.spyOn(Date, 'now').mockReturnValue(at);
      const { queue } = await setup({ kit, jiraSend });
      await pressSend();
      expect(screen.getByTestId('devtools-report-status-pending')).toBeOnTheScreen();

      now.mockReturnValue(at + 61_000);
      await act(async () => {
        await queue?.retryDue();
      });

      expect(screen.getByTestId('devtools-report-status-sent')).toHaveTextContent('Đã tạo DEMO-482');
    });

    it('đã gửi xong: Back đóng sheet; mở lại thì về form', async () => {
      const { props, store, setVisible } = await setup({ kit });
      await pressSend();

      act(() => {
        back.pressBack();
      });
      expect(props.onDismiss).toHaveBeenCalledTimes(1);

      await setVisible(false);
      act(() => store.begin('none'));
      await setVisible(true);

      expect(screen.getByTestId('devtools-report-form')).toBeOnTheScreen();
      expect(screen.queryByTestId('devtools-report-status')).toBeNull();
    });
  });

  describe('hàng đợi (C1, I3)', () => {
    const banner = (kind: 'attention' | 'waiting') =>
      screen.getByTestId(`devtools-report-queue-banner-${kind}`);
    const row = (id: string) => screen.getByTestId(`devtools-report-queue-row-${id}`);
    const rowState = (id: string) => screen.getByTestId(`devtools-report-queue-row-${id}-state`);

    it('hàng đợi trống hoặc chỉ còn bản đã gửi ⇒ form không có banner', async () => {
      const s = await setup({ kit });
      expect(screen.queryByTestId(/^devtools-report-queue-banner/)).toBeNull();

      await pressSend();
      await reopenWithNewDraft(s);

      expect(s.queue?.items().map((i) => i.state)).toEqual(['sent']);
      expect(screen.getByTestId('devtools-report-form')).toBeOnTheScreen();
      expect(screen.queryByTestId(/^devtools-report-queue-banner/)).toBeNull();
    });

    it('chỉ có bản đang chờ gửi ⇒ banner trung tính kèm số; chạm mở trang Hàng đợi', async () => {
      const s = await setup({ kit, jiraSend: failing('network') });
      await pressSend();
      await reopenWithNewDraft(s);

      expect(banner('waiting')).toHaveTextContent('Hàng đợi gửi: 1 chờ gửi — chạm để xem');
      expect(screen.queryByTestId('devtools-report-queue-banner-attention')).toBeNull();
      fireEvent.press(banner('waiting'));

      expect(screen.getByTestId('devtools-report-queue')).toBeOnTheScreen();
      expect(screen.getByText('Hàng đợi gửi')).toBeOnTheScreen();
    });

    it('`pending` → `failed` lúc sheet đóng ⇒ mở lại có banner cảnh báo → trang Hàng đợi → trang kết quả: lý do + "kiểm tra đích trước" + Gửi lại (`retryNow`); ‹ về Hàng đợi rồi về form', async () => {
      const jiraSend = jest
        .fn()
        .mockRejectedValueOnce(new ConnectorError('network', 'Network request failed'))
        .mockRejectedValueOnce(
          new ConnectorError('unknown', 'Jira trả 503: Service Unavailable', { status: 503 }),
        )
        .mockResolvedValueOnce(SENT);
      const at = Date.now();
      const now = jest.spyOn(Date, 'now').mockReturnValue(at);
      const s = await setup({ kit, jiraSend });
      const reportId = s.store.getDraft()?.id as string;
      await pressSend();
      expect(screen.getByTestId('devtools-report-status-pending')).toBeOnTheScreen();

      await s.setVisible(false);
      now.mockReturnValue(at + 61_000);
      await act(async () => {
        await s.queue?.retryDue();
      });
      expect(s.queue?.items()[0].state).toBe('failed');
      act(() => s.store.begin('none'));
      await s.setVisible(true);

      expect(banner('attention')).toHaveTextContent('Hàng đợi gửi: 1 cần xử lý — chạm để xem');
      fireEvent.press(banner('attention'));
      expect(rowState(reportId)).toHaveTextContent('Gửi thất bại');
      fireEvent.press(row(reportId));

      expect(screen.getByTestId('devtools-report-status-failed')).toHaveTextContent('Gửi thất bại');
      expect(screen.getByTestId('devtools-report-status-detail')).toHaveTextContent(
        'Jira trả 503: Service Unavailable',
      );
      expect(screen.getByTestId('devtools-report-check-first')).toHaveTextContent(
        'Có thể đã có ticket ở Jira. Kiểm tra ở đó trước khi gửi lại.',
      );
      const retryNow = jest.spyOn(s.queue as SendQueue, 'retryNow');
      fireEvent.press(screen.getByTestId('devtools-report-retry'));
      await flush();

      expect(retryNow).toHaveBeenCalledWith(reportId);
      expect(jiraSend).toHaveBeenCalledTimes(3);
      expect(screen.getByTestId('devtools-report-status-sent')).toHaveTextContent('Đã tạo DEMO-482');
      /* Mở từ hàng đợi, nháp đang soạn là bản khác ⇒ không có "Báo bug khác". */
      expect(screen.queryByTestId('devtools-report-another')).toBeNull();

      act(() => {
        back.pressBack();
      });
      expect(rowState(reportId)).toHaveTextContent('Đã gửi');
      fireEvent.press(screen.getByTestId('devtools-report-back'));
      expect(screen.getByTestId('devtools-report-form')).toBeOnTheScreen();
      expect(screen.queryByTestId(/^devtools-report-queue-banner/)).toBeNull();
      expect(s.props.onDismiss).not.toHaveBeenCalled();
    });

    it('`failed` khi ticket ĐÃ tạo (`resume.committed`) ⇒ Gửi lại không kèm câu "kiểm tra đích trước"', async () => {
      await setup({
        kit,
        jiraSend: jest.fn(async (_r: BugReport, _v: unknown, _s: unknown, ctx: SendContext) => {
          ctx.checkpoint({ issueKey: 'DEMO-482', committed: true });
          throw new ConnectorError('unknown', 'Jira trả 502');
        }),
      });
      await pressSend();

      expect(screen.getByTestId('devtools-report-status-failed')).toBeOnTheScreen();
      expect(screen.getByTestId('devtools-report-retry')).toBeOnTheScreen();
      expect(screen.queryByTestId('devtools-report-check-first')).toBeNull();
    });

    it.each([
      ['pending', 'network', 'Chia sẻ thay vì gửi', undefined],
      ['uncertain', 'uncertain', 'Chia sẻ', 'uncertain error'],
      ['failed', 'unknown', 'Chia sẻ', 'unknown error'],
      ['blocked', 'auth', 'Chia sẻ', 'auth error'],
    ] as const)(
      '`%s` ⇒ có Chia sẻ và "Bỏ bản báo"; lý do của connector hiện ra khi có',
      async (state, kind, shareLabel, detail) => {
        const { props, store } = await setup({ kit, jiraSend: failing(kind) });
        const reportId = store.getDraft()?.id;
        await pressSend();

        expect(screen.getByTestId(`devtools-report-status-${state}`)).toBeOnTheScreen();
        if (detail) {
          expect(screen.getByTestId('devtools-report-status-detail')).toHaveTextContent(detail);
        } else {
          expect(screen.queryByTestId('devtools-report-status-detail')).toBeNull();
        }
        expect(screen.getByTestId('devtools-report-status-share')).toHaveTextContent(shareLabel);
        fireEvent.press(screen.getByTestId('devtools-report-status-share'));
        expect(props.onShare).toHaveBeenCalledWith(reportId);
        expect(screen.getByTestId('devtools-report-status-discard')).toHaveTextContent('Bỏ bản báo');
      },
    );

    it('"Bỏ bản báo" hỏi lại một lần (tự về như cũ sau 3 s); bấm lần hai mới bỏ khỏi hàng đợi, về trang Hàng đợi', async () => {
      const s = await setup({ kit, jiraSend: failing('network') });
      await pressSend();
      const discard = () => screen.getByTestId('devtools-report-status-discard');

      fireEvent.press(discard());
      expect(discard()).toHaveTextContent('Bỏ thật?');
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 3100));
      });
      expect(discard()).toHaveTextContent('Bỏ bản báo');
      expect(s.queue?.items()).toHaveLength(1);

      fireEvent.press(discard());
      fireEvent.press(discard());
      await flush();

      expect(s.queue?.items()).toEqual([]);
      expect(screen.getByTestId('devtools-report-queue-empty')).toHaveTextContent('Hàng đợi trống.');
    });

    it('trang Hàng đợi: nhóm Cần xử lý / Đang chờ gửi / Đã gửi, mới nhất trước; hàng = tiêu đề, kết nối, trạng thái, thời gian', async () => {
      const at = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(at);
      const outcome: Record<string, () => Promise<SendResult>> = {
        failedOld: async () => {
          throw new ConnectorError('unknown', 'x');
        },
        uncertainOlder: async () => {
          throw new ConnectorError('uncertain', 'x');
        },
        waiting: async () => {
          throw new ConnectorError('network', 'x');
        },
        done: async () => SENT,
      };
      const jiraSend = jest.fn((r: BugReport) => outcome[r.id]());
      const s = await setup({ kit, jiraSend });
      const report = (id: string, ageMs: number, title = `Bug ${id}`): BugReport => ({
        id,
        createdAt: at - ageMs,
        title,
        steps: [],
        actual: '',
        files: [],
      });
      await act(async () => {
        const q = s.queue as SendQueue;
        await q.submit(report('failedOld', 3 * 60_000), JIRA.id);
        await q.submit(report('uncertainOlder', 2 * 3600_000, '  '), JIRA.id);
        await q.submit(report('waiting', 5_000), JIRA.id);
        await q.submit(report('done', 3 * 86_400_000), JIRA.id);
        /* Kết nối không còn ⇒ blocked/connection-missing; mới nhất trong nhóm cần xử lý. */
        await q.submit(report('gone', 60_000), 'c-gone');
      });

      fireEvent.press(banner('attention'));

      const ids = testIdsInOrder().filter((id) =>
        /^devtools-report-queue-(section-\w+|row-[\w]+)$/.test(id),
      );
      expect(ids).toEqual([
        'devtools-report-queue-section-attention',
        'devtools-report-queue-row-gone',
        'devtools-report-queue-row-failedOld',
        'devtools-report-queue-row-uncertainOlder',
        'devtools-report-queue-section-waiting',
        'devtools-report-queue-row-waiting',
        'devtools-report-queue-section-sent',
        'devtools-report-queue-row-done',
      ]);
      expect(screen.getByTestId('devtools-report-queue-section-attention')).toHaveTextContent(
        'Cần xử lý',
      );
      expect(screen.getByTestId('devtools-report-queue-section-sent')).toHaveTextContent(
        'Đã gửi (giữ 24 giờ)',
      );
      const meta = (id: string) => screen.getByTestId(`devtools-report-queue-row-${id}-meta`);
      expect(within(row('gone')).getByText('Bug gone')).toBeOnTheScreen();
      expect(meta('gone')).toHaveTextContent('Kết nối không còn · 1 phút trước');
      expect(rowState('gone')).toHaveTextContent('Bị chặn');
      expect(meta('failedOld')).toHaveTextContent('Jira · DEMO · 3 phút trước');
      expect(within(row('uncertainOlder')).getByText('(Chưa có tiêu đề)')).toBeOnTheScreen();
      expect(meta('uncertainOlder')).toHaveTextContent('Jira · DEMO · 2 giờ trước');
      expect(rowState('uncertainOlder')).toHaveTextContent('Chưa chắc đã gửi');
      expect(meta('waiting')).toHaveTextContent('Jira · DEMO · vừa xong');
      expect(rowState('waiting')).toHaveTextContent('Chờ gửi lại');
      /* Bản đã gửi: thời gian là lúc gửi xong. */
      expect(meta('done')).toHaveTextContent('Jira · DEMO · vừa xong');
      expect(rowState('done')).toHaveTextContent('Đã gửi');
    });

    it('hàng đợi chỉ ở RAM (app không bật `persist`) ⇒ trang Hàng đợi và trang kết quả mở từ đó đều nhắc "sẽ mất nếu app bị tắt"', async () => {
      const s = await setup({ kit, jiraSend: failing('network'), props: { ramOnlyQueue: true } });
      const reportId = s.store.getDraft()?.id as string;
      await pressSend();
      await reopenWithNewDraft(s);

      fireEvent.press(banner('waiting'));
      expect(screen.getByTestId('devtools-report-queue-ram-only')).toHaveTextContent(
        'Hàng đợi chỉ nằm trong bộ nhớ, các bản báo sẽ mất nếu app bị tắt.',
      );
      fireEvent.press(row(reportId));
      expect(screen.getByTestId('devtools-report-ram-only')).toHaveTextContent(RAM_ONLY);
    });

    it('mục `blocked` không còn nháp (token hết hạn lúc hàng đợi tự gửi lại) ⇒ không "Sửa bản báo"; sửa kết nối xong, "Gửi lại" gửi bằng `retryNow`', async () => {
      const jiraSend = jest
        .fn()
        .mockRejectedValueOnce(new ConnectorError('network', 'offline'))
        .mockRejectedValueOnce(new ConnectorError('auth', 'Token expired', { status: 401 }))
        .mockResolvedValueOnce(SENT);
      const at = Date.now();
      const now = jest.spyOn(Date, 'now').mockReturnValue(at);
      const s = await setup({ kit, jiraSend });
      const reportId = s.store.getDraft()?.id as string;
      await pressSend();
      await s.setVisible(false);
      now.mockReturnValue(at + 61_000);
      await act(async () => {
        await s.queue?.retryDue();
      });
      act(() => s.store.begin('none'));
      await s.setVisible(true);

      fireEvent.press(banner('attention'));
      fireEvent.press(row(reportId));
      expect(screen.getByTestId('devtools-report-status-blocked')).toHaveTextContent(
        'Token Jira hết hạn, nhập lại',
      );
      expect(screen.queryByTestId('devtools-report-edit')).toBeNull();
      expect(screen.queryByText('Bản nháp vẫn được giữ.')).toBeNull();

      fireEvent.press(screen.getByText('Mở màn kết nối'));
      await flush();
      expect(screen.getByTestId('connection-row-c-jira')).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('connections-back'));
      await flush();
      const retryNow = jest.spyOn(s.queue as SendQueue, 'retryNow');
      fireEvent.press(screen.getByTestId('devtools-report-retry'));
      await flush();

      expect(retryNow).toHaveBeenCalledWith(reportId);
      expect(screen.getByTestId('devtools-report-status-sent')).toHaveTextContent('Đã tạo DEMO-482');
    });

    it('mục `blocked` vì kết nối không còn, không còn nháp ⇒ Chia sẻ + Bỏ, không Gửi lại; kết nối cùng id có lại ⇒ có Gửi lại', async () => {
      const at = Date.now();
      const now = jest.spyOn(Date, 'now').mockReturnValue(at);
      const s = await setup({ kit, jiraSend: failing('network') });
      const reportId = s.store.getDraft()?.id as string;
      await pressSend();
      await s.setVisible(false);
      await act(async () => {
        await s.connections?.remove(JIRA.id);
      });
      now.mockReturnValue(at + 61_000);
      await act(async () => {
        await s.queue?.retryDue();
      });
      act(() => s.store.begin('none'));
      await s.setVisible(true);

      fireEvent.press(banner('attention'));
      fireEvent.press(row(reportId));
      expect(screen.getByTestId('devtools-report-status-blocked')).toHaveTextContent(
        'Kết nối này không còn (đã bị xoá hoặc mất thông tin đăng nhập)',
      );
      expect(screen.getByTestId('devtools-report-status-share')).toBeOnTheScreen();
      expect(screen.getByTestId('devtools-report-status-discard')).toBeOnTheScreen();
      expect(screen.queryByTestId('devtools-report-retry')).toBeNull();

      await act(async () => {
        await s.connections?.save(JIRA, { token: 'secret-5678' });
      });
      await s.setVisible(false);
      await s.setVisible(true);
      fireEvent.press(banner('attention'));
      fireEvent.press(row(reportId));
      expect(screen.getByTestId('devtools-report-retry')).toBeOnTheScreen();
    });

    it('mục `blocked` của chính nháp đang soạn không làm hiện banner (form đã nói về nó, N4); bản khác cần xử lý vẫn đếm', async () => {
      const s = await setup({ kit, jiraSend: failing('auth') });
      await pressSend();
      fireEvent.press(screen.getByText('Sửa bản báo'));
      expect(screen.getByTestId('devtools-report-form')).toBeOnTheScreen();
      expect(screen.queryByTestId(/^devtools-report-queue-banner/)).toBeNull();

      await act(async () => {
        await s.queue?.submit(
          { id: 'rpt-other', createdAt: Date.now(), title: 'Khác', steps: [], actual: '', files: [] },
          JIRA.id,
        );
      });

      expect(banner('attention')).toHaveTextContent('Hàng đợi gửi: 1 cần xử lý — chạm để xem');
    });

    it('mục đang gửi (`sending`) ⇒ có Chia sẻ, KHÔNG có "Bỏ bản báo" (N2: bỏ lúc đang gửi vẫn có thể ra ticket)', async () => {
      let release: (r: SendResult) => void = () => undefined;
      const jiraSend = jest.fn(
        () =>
          new Promise<SendResult>((resolve) => {
            release = resolve;
          }),
      );
      const s = await setup({ kit, jiraSend });
      let submitted: Promise<unknown> = Promise.resolve();
      await act(async () => {
        submitted = (s.queue as SendQueue).submit(
          { id: 'busy', createdAt: Date.now(), title: 'Đang gửi', steps: [], actual: '', files: [] },
          JIRA.id,
        );
      });
      await flush();
      expect(s.queue?.items()[0].state).toBe('sending');

      fireEvent.press(banner('waiting'));
      fireEvent.press(row('busy'));

      expect(screen.getByTestId('devtools-report-status-sending')).toBeOnTheScreen();
      expect(screen.getByTestId('devtools-report-status-share')).toBeOnTheScreen();
      expect(screen.queryByTestId('devtools-report-status-discard')).toBeNull();
      await act(async () => {
        release(SENT);
        await submitted;
      });
    });

    it('đang gửi lại bản A (chưa xong) ⇒ mở bản B từ Hàng đợi: Gửi lại của B không bị khoá theo A, gửi được (N6)', async () => {
      const attempts: Record<string, number> = {};
      let releaseA: (r: SendResult) => void = () => undefined;
      const jiraSend = jest.fn((r: BugReport) => {
        attempts[r.id] = (attempts[r.id] ?? 0) + 1;
        if (attempts[r.id] === 1) return Promise.reject(new ConnectorError('unknown', 'x'));
        if (r.id === 'A') {
          return new Promise<SendResult>((resolve) => {
            releaseA = resolve;
          });
        }
        return Promise.resolve(SENT);
      });
      const s = await setup({ kit, jiraSend });
      await act(async () => {
        for (const id of ['A', 'B']) {
          await s.queue?.submit(
            { id, createdAt: Date.now(), title: id, steps: [], actual: '', files: [] },
            JIRA.id,
          );
        }
      });
      const retryNow = jest.spyOn(s.queue as SendQueue, 'retryNow');

      fireEvent.press(banner('attention'));
      fireEvent.press(row('A'));
      fireEvent.press(screen.getByTestId('devtools-report-retry'));
      await flush();
      expect(screen.getByTestId('devtools-report-status-sending')).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('devtools-report-back'));
      fireEvent.press(row('B'));
      fireEvent.press(screen.getByTestId('devtools-report-retry'));
      await flush();

      expect(retryNow.mock.calls.map(([id]) => id)).toEqual(['A', 'B']);
      expect(screen.getByTestId('devtools-report-status-sent')).toHaveTextContent('Đã tạo DEMO-482');
      await act(async () => {
        releaseA(SENT);
      });
      await flush();
    });

    it('bản `blocked` là nháp đang soạn: "Bỏ bản báo" bỏ mục hàng đợi nhưng giữ nháp, về form', async () => {
      const s = await setup({ kit, jiraSend: failing('auth') });
      const draftId = s.store.getDraft()?.id;
      await pressSend();

      fireEvent.press(screen.getByTestId('devtools-report-status-discard'));
      fireEvent.press(screen.getByTestId('devtools-report-status-discard'));
      await flush();

      expect(s.queue?.items()).toEqual([]);
      expect(s.store.getDraft()?.id).toBe(draftId);
      expect(screen.getByTestId('devtools-report-form')).toBeOnTheScreen();
    });

    it('"Huỷ nháp" bỏ luôn mục `blocked` của chính nháp đó trong hàng đợi', async () => {
      const s = await setup({ kit, jiraSend: failing('auth') });
      await pressSend();
      expect(s.queue?.items().map((i) => i.state)).toEqual(['blocked']);
      fireEvent.press(screen.getByText('Sửa bản báo'));

      fireEvent.press(screen.getByTestId('devtools-report-discard'));
      fireEvent.press(screen.getByTestId('devtools-report-discard'));
      await flush();

      expect(s.store.getDraft()).toBeNull();
      expect(s.queue?.items()).toEqual([]);
      expect(s.props.onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('trang kết nối', () => {
    const header = () => within(screen.getByTestId('devtools-report-sheet-header'));
    const tapAndFlush = async (testID: string) => {
      fireEvent.press(screen.getByTestId(testID));
      await flush();
    };
    const pressBack = async () => {
      act(() => {
        back.pressBack();
      });
      await flush();
    };
    /** Chân "Thêm kết nối" (chưa có kết nối) ⇒ trang Kết nối ⇒ "+ Thêm kết nối" ⇒ chọn loại. */
    const openNewEditor = async (typeId: string) => {
      await tapAndFlush('devtools-report-add-connection');
      await tapAndFlush('connections-add');
      await tapAndFlush(`connections-type-${typeId}`);
    };
    const nameInput = () => screen.getByTestId('connection-editor-name');

    it('"Thêm kết nối" ⇒ trang Kết nối (tiêu đề "Kết nối", không còn chân form); chọn loại ⇒ form "Thêm kết nối Jira"; Back cứng ⇒ danh sách; ‹ ⇒ form', async () => {
      await setup({ kit, saved: [] });

      await tapAndFlush('devtools-report-add-connection');
      expect(screen.getByTestId('connections-empty')).toBeOnTheScreen();
      expect(header().getByText('Kết nối')).toBeOnTheScreen();
      expect(screen.queryByTestId('devtools-report-add-connection')).toBeNull();
      expect(screen.queryByTestId('devtools-report-discard')).toBeNull();

      await tapAndFlush('connections-add');
      await tapAndFlush('connections-type-jira-cloud');
      expect(screen.getByTestId('connection-editor')).toBeOnTheScreen();
      expect(header().getByText('Thêm kết nối Jira')).toBeOnTheScreen();

      await pressBack();
      expect(screen.getByTestId('connections-page')).toBeOnTheScreen();
      expect(screen.queryByTestId('connection-editor')).toBeNull();

      await tapAndFlush('devtools-report-back');
      expect(screen.getByTestId('devtools-report-form')).toBeOnTheScreen();
      expect(header().getByText('Báo bug')).toBeOnTheScreen();
    });

    it('mỗi lần mở form thêm kết nối là một form mới (gõ dở, Huỷ, mở lại ⇒ tên mặc định; loại khác ⇒ form của loại đó)', async () => {
      await setup({ kit, saved: [] });
      await openNewEditor('jira-cloud');
      expect(nameInput()).toHaveDisplayValue('Jira');
      fireEvent.changeText(nameInput(), 'Gõ dở');

      await tapAndFlush('connection-editor-cancel');
      expect(screen.getByTestId('connections-page')).toBeOnTheScreen();
      await tapAndFlush('connections-add');
      await tapAndFlush('connections-type-jira-cloud');
      expect(nameInput()).toHaveDisplayValue('Jira');

      await tapAndFlush('connection-editor-cancel');
      await tapAndFlush('connections-add');
      await tapAndFlush('connections-type-slack');
      expect(nameInput()).toHaveDisplayValue('Slack');
      expect(header().getByText('Thêm kết nối Slack')).toBeOnTheScreen();
    });

    it('lưu kết nối mới từ trạng thái chưa có kết nối ⇒ danh sách có nó; về form: "Gửi tới <kết nối mới>", nhớ là kết nối dùng lần trước', async () => {
      const { connections } = await setup({ kit, saved: [] });
      await openNewEditor('slack');
      fireEvent.changeText(nameInput(), 'Slack · #bugs');
      await tapAndFlush('connection-editor-test');
      await tapAndFlush('connection-editor-save');

      expect(screen.getByTestId('connections-page')).toBeOnTheScreen();
      expect(screen.getByText('Slack · #bugs')).toBeOnTheScreen();

      await tapAndFlush('connections-back');
      expect(send()).toHaveTextContent('Gửi tới Slack · #bugs');
      const saved = (await connections?.list()) ?? [];
      expect(saved.map((c) => c.name)).toEqual(['Slack · #bugs']);
      expect(await connections?.lastUsed()).toBe(saved[0]?.id);
    });

    /**
     * Lần `save` đầu của kho kết nối treo tới khi ca test gọi `finish()` (rồi mới ghi thật) — mô
     * phỏng Keychain chậm. Các lần sau chạy thẳng.
     */
    const holdFirstSave = (connections: ConnectionStore) => {
      let finish: () => Promise<void> = async () => undefined;
      const realSave = connections.save.bind(connections);
      jest.spyOn(connections, 'save').mockImplementationOnce(
        (c, s) =>
          new Promise<void>((resolve, reject) => {
            finish = async () => {
              await act(async () => {
                realSave(c, s).then(resolve, reject);
              });
              await flush();
            };
          }),
      );
      return { finish: () => finish() };
    };

    it('QA lùi về form trong lúc kho còn đang lưu ⇒ lưu xong không kéo về trang Kết nối; form vẫn đọc lại và chọn kết nối mới', async () => {
      const { connections } = await setup({ kit, saved: [] });
      const held = holdFirstSave(connections!);
      await openNewEditor('jira-cloud');
      fireEvent.changeText(nameInput(), 'Jira · APP');
      await tapAndFlush('connection-editor-test');
      await tapAndFlush('connection-editor-save');

      await pressBack();
      await pressBack();
      expect(screen.getByTestId('devtools-report-form')).toBeOnTheScreen();
      await held.finish();

      expect(screen.getByTestId('devtools-report-form')).toBeOnTheScreen();
      expect(screen.queryByTestId('connections-page')).toBeNull();
      expect(send()).toHaveTextContent('Gửi tới Jira · APP');
      const saved = (await connections?.list()) ?? [];
      expect(saved.map((c) => c.name)).toEqual(['Jira · APP']);
      expect(await connections?.lastUsed()).toBe(saved[0]?.id);
    });

    it('lưu của form A về muộn khi QA đã mở form B ⇒ B vẫn mở nguyên chữ đang gõ; danh sách vẫn đọc lại; chọn-luôn theo chính form A (thêm mới từ trạng thái chưa có kết nối)', async () => {
      const { connections } = await setup({ kit, saved: [] });
      /* Một kết nối có trong kho mà form chưa đọc (form vẫn ở trạng thái chưa có kết nối) — để form B
         là form SỬA trong khi form A là form THÊM. */
      await connections!.save(SLACK, { token: 'secret-9999' });
      const held = holdFirstSave(connections!);
      await openNewEditor('jira-cloud');
      fireEvent.changeText(nameInput(), 'Jira · APP');
      await tapAndFlush('connection-editor-test');
      await tapAndFlush('connection-editor-save');

      await pressBack();
      await tapAndFlush('connection-row-c-slack-edit');
      expect(header().getByText('Sửa "Slack · #qa"')).toBeOnTheScreen();
      fireEvent.changeText(nameInput(), 'Gõ dở trong B');
      const listCalls = jest.spyOn(connections!, 'list');

      await held.finish();

      expect(screen.getByTestId('connection-editor')).toBeOnTheScreen();
      expect(header().getByText('Sửa "Slack · #qa"')).toBeOnTheScreen();
      expect(nameInput()).toHaveDisplayValue('Gõ dở trong B');
      /* Form báo bug đã đọc lại kho ngay khi A lưu xong (trang Kết nối không gắn lúc này). */
      expect(listCalls).toHaveBeenCalled();
      const saved = (await connections?.list()) ?? [];
      const app = saved.find((c) => c.name === 'Jira · APP');
      expect(app).toBeDefined();
      expect(await connections?.lastUsed()).toBe(app?.id);

      await pressBack();
      await pressBack();
      expect(send()).toHaveTextContent('Gửi tới Jira · APP');
    });

    it('"Quản lý kết nối" ở danh sách chọn ⇒ trang Kết nối; Sửa ⇒ form "Sửa …"; lưu tên mới ⇒ danh sách; Back cứng lùi từng cấp: danh sách chọn rồi form — tên mới ở cả hai', async () => {
      await setup({ kit, saved: [JIRA, SLACK], lastUsed: 'c-jira' });
      await tapAndFlush('devtools-report-pick');
      await tapAndFlush('devtools-report-manage-connections');
      expect(header().getByText('Kết nối')).toBeOnTheScreen();

      await tapAndFlush('connection-row-c-jira-edit');
      expect(header().getByText('Sửa "Jira · DEMO"')).toBeOnTheScreen();
      expect(nameInput()).toHaveDisplayValue('Jira · DEMO');
      fireEvent.changeText(nameInput(), 'Jira · WEB');
      await tapAndFlush('connection-editor-test');
      await tapAndFlush('connection-editor-save');
      expect(screen.getByTestId('connection-row-c-jira')).toHaveTextContent('Jira · WEB', {
        exact: false,
      });

      await pressBack();
      expect(screen.getByTestId('devtools-report-connection-c-jira')).toHaveTextContent(
        'Jira · WEB',
        { exact: false },
      );
      await pressBack();
      expect(send()).toHaveTextContent('Gửi tới Jira · WEB');
    });

    it('xoá kết nối ở trang Kết nối ⇒ quay lại thì danh sách chọn và chân đã đọc lại (xoá hết ⇒ "Thêm kết nối")', async () => {
      await setup({ kit, saved: [JIRA] });
      await tapAndFlush('devtools-report-pick');
      await tapAndFlush('devtools-report-manage-connections');

      await tapAndFlush('connection-row-c-jira-delete');
      await tapAndFlush('connection-row-c-jira-confirm');
      expect(screen.getByTestId('connections-empty')).toBeOnTheScreen();

      await tapAndFlush('connections-back');
      expect(screen.queryByTestId('devtools-report-connection-c-jira')).toBeNull();
      await tapAndFlush('devtools-report-back');
      expect(within(footer()).getByTestId('devtools-report-add-connection')).toBeOnTheScreen();
      expect(screen.queryByTestId('devtools-report-send')).toBeNull();
    });

    it('app không cấp kho bảo mật: "Thêm kết nối" ⇒ trang Kết nối nói "App chưa cấp kho bảo mật"', async () => {
      await setup({ kit, noStore: true });

      await tapAndFlush('devtools-report-add-connection');

      expect(screen.getByTestId('connections-no-store')).toHaveTextContent('App chưa cấp kho bảo mật');
    });

    it('đóng sheet khi đang ở form kết nối, mở lại ⇒ về form báo bug', async () => {
      const { setVisible } = await setup({ kit, saved: [] });
      await openNewEditor('jira-cloud');

      await setVisible(false);
      await setVisible(true);

      expect(screen.getByTestId('devtools-report-form')).toBeOnTheScreen();
      expect(screen.queryByTestId('connection-editor')).toBeNull();
    });
  });
});

/* ------------------------------------------------------------------ sáng / tối (R12) */

const THEMES = { light: lightTheme, dark: darkTheme } as const;
type Mode = keyof typeof THEMES;

const COLOR_KEYS = [
  'color',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderRightColor',
  'tintColor',
] as const;
const COLOR_PROPS = ['placeholderTextColor', 'selectionColor'] as const;

const paintedColors = (): Set<string> => {
  const found = new Set<string>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const { props, children } = node as { props?: Record<string, unknown>; children?: unknown };
    const style = StyleSheet.flatten(props?.style as never) as Record<string, unknown> | undefined;
    for (const key of COLOR_KEYS) {
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

const tokensOf = (theme: DevToolsTheme): Set<string> => {
  const out = new Set<string>(['transparent']);
  for (const group of Object.values(theme.colors)) for (const v of Object.values(group)) out.add(v);
  return out;
};

const expectOnlyThemeColors = (mode: Mode) => {
  const painted = paintedColors();
  const allowed = tokensOf(THEMES[mode]);
  expect({ mode, stray: [...painted].filter((c) => !allowed.has(c)) }).toEqual({ mode, stray: [] });
  expect(painted.has(THEMES[mode].colors.text.primary)).toBe(true);
  expect(painted.has(THEMES[mode].colors.background.surface)).toBe(true);
};

const failing = (kind: ConstructorParameters<typeof ConnectorError>[0]) =>
  jest.fn(async () => {
    throw new ConnectorError(kind, `${kind} error`);
  });

/** Mỗi trạng thái màn: dựng xong thì màn đang hiện đúng trạng thái đó. */
const SCREENS: ReadonlyArray<
  readonly [string, (kit: SheetKit, colorScheme: Mode) => Promise<void>]
> = [
  [
    'form: ảnh, điền sẵn, chip bật',
    async (kit, colorScheme) => {
      logBuffer.push(http500(Date.now() - 20));
      await setup({ kit, colorScheme });
    },
  ],
  [
    'form: tiêu đề trống (dòng nhắc), ảnh bị chặn, nháp crash',
    async (kit, colorScheme) => {
      await setup({ kit, colorScheme, shot: 'blocked', previous: crashed() });
      fireEvent.changeText(screen.getByTestId('devtools-report-title-prefilled'), '');
      expect(screen.getByTestId('devtools-report-title-required')).toBeOnTheScreen();
    },
  ],
  [
    'form: kết nối mức nhẹ (chip khoá + lý do), đang chuẩn bị',
    async (kit, colorScheme) => {
      await setup({ kit, colorScheme, saved: [SLACK], ready: false });
      expect(screen.getByTestId('devtools-report-attach-unsupported')).toBeOnTheScreen();
    },
  ],
  [
    'form: chưa có kết nối, câu ảnh không chia sẻ được',
    async (kit, colorScheme) => {
      await setup({ kit, colorScheme, saved: [], props: { shareNotice: 'image-dropped' } });
      expect(screen.getByTestId('devtools-report-add-connection')).toBeOnTheScreen();
    },
  ],
  [
    'trang sửa các bước',
    async (kit, colorScheme) => {
      actionBuffer.push(tap(Date.now() - 50, 'Giỏ hàng'));
      actionBuffer.push(tap(Date.now() - 40, 'Thanh toán'));
      await setup({ kit, colorScheme });
      fireEvent.press(screen.getByTestId('devtools-report-steps-card'));
      fireEvent.press(screen.getByText('+ Thêm bước'));
    },
  ],
  [
    'chọn kết nối',
    async (kit, colorScheme) => {
      await setup({ kit, colorScheme, saved: [JIRA, SLACK] });
      fireEvent.press(screen.getByTestId('devtools-report-pick'));
      expect(screen.getByTestId('devtools-report-manage-connections')).toBeOnTheScreen();
    },
  ],
  [
    'đã gửi (có file chưa gửi được)',
    async (kit, colorScheme) => {
      await setup({
        kit,
        colorScheme,
        jiraSend: jest.fn(async () => ({ ...SENT, skippedFiles: ['screenshot.jpg'] })),
      });
      await pressSend();
      expect(screen.getByTestId('devtools-report-skipped')).toBeOnTheScreen();
    },
  ],
  [
    'đã gửi qua kết nối nhẹ (Chia sẻ ảnh và log)',
    async (kit, colorScheme) => {
      await setup({ kit, colorScheme, saved: [SLACK] });
      await pressSend();
      expect(screen.getByTestId('devtools-report-status-sent')).toBeOnTheScreen();
    },
  ],
  [
    'xếp hàng',
    async (kit, colorScheme) => {
      await setup({ kit, colorScheme, jiraSend: failing('network') });
      await pressSend();
      expect(screen.getByTestId('devtools-report-status-pending')).toBeOnTheScreen();
    },
  ],
  [
    'không chắc đã gửi',
    async (kit, colorScheme) => {
      await setup({ kit, colorScheme, jiraSend: failing('uncertain') });
      await pressSend();
      expect(screen.getByTestId('devtools-report-status-uncertain')).toBeOnTheScreen();
    },
  ],
  [
    'bị chặn (token hết hạn)',
    async (kit, colorScheme) => {
      await setup({ kit, colorScheme, jiraSend: failing('auth') });
      await pressSend();
      expect(screen.getByTestId('devtools-report-status-blocked')).toBeOnTheScreen();
    },
  ],
  [
    'bị chặn: kết nối không còn (Chia sẻ)',
    async (kit, colorScheme) => {
      await setup({ kit, colorScheme, saved: [{ ...JIRA, typeId: 'linear' }] });
      await pressSend();
      expect(screen.getByTestId('devtools-report-status-share')).toBeOnTheScreen();
    },
  ],
  [
    'bị chặn khi ticket đã tạo (câu "làm nốt") và form gửi lại',
    async (kit, colorScheme) => {
      await setup({
        kit,
        colorScheme,
        jiraSend: jest.fn(async (_r: BugReport, _v: unknown, _s: unknown, ctx: SendContext) => {
          ctx.checkpoint({ issueKey: 'DEMO-482', committed: true });
          throw new ConnectorError('permission', 'Cannot attach files');
        }),
      });
      await pressSend();
      expect(screen.getByTestId('devtools-report-committed')).toBeOnTheScreen();
      expectOnlyThemeColors(colorScheme);
      fireEvent.press(screen.getByText('Sửa bản báo'));
      expect(screen.getByTestId('devtools-report-committed')).toBeOnTheScreen();
    },
  ],
  [
    'gửi thất bại',
    async (kit, colorScheme) => {
      await setup({ kit, colorScheme, jiraSend: failing('unknown') });
      await pressSend();
      expect(screen.getByTestId('devtools-report-status-failed')).toBeOnTheScreen();
    },
  ],
  [
    'xếp hàng chỉ trong RAM (câu "sẽ mất…"), chia sẻ không được',
    async (kit, colorScheme) => {
      await setup({
        kit,
        colorScheme,
        jiraSend: failing('network'),
        props: { ramOnlyQueue: true, shareNotice: 'share-failed' },
      });
      await pressSend();
      expect(screen.getByTestId('devtools-report-ram-only')).toBeOnTheScreen();
      expect(screen.getByTestId('devtools-report-share-notice')).toBeOnTheScreen();
    },
  ],
  [
    'form: banner hàng đợi cần xử lý (cảnh báo)',
    async (kit, colorScheme) => {
      const s = await setup({ kit, colorScheme, jiraSend: failing('unknown') });
      await pressSend();
      await reopenWithNewDraft(s);
      expect(screen.getByTestId('devtools-report-queue-banner-attention')).toBeOnTheScreen();
    },
  ],
  [
    'form: banner hàng đợi chờ gửi (trung tính)',
    async (kit, colorScheme) => {
      const s = await setup({ kit, colorScheme, jiraSend: failing('network') });
      await pressSend();
      await reopenWithNewDraft(s);
      expect(screen.getByTestId('devtools-report-queue-banner-waiting')).toBeOnTheScreen();
    },
  ],
  [
    'trang Hàng đợi: ba nhóm, câu RAM',
    async (kit, colorScheme) => {
      const outcome: Record<string, () => Promise<SendResult>> = {
        a: async () => {
          throw new ConnectorError('unknown', 'x');
        },
        b: async () => {
          throw new ConnectorError('network', 'x');
        },
        c: async () => SENT,
      };
      const s = await setup({
        kit,
        colorScheme,
        jiraSend: jest.fn((r: BugReport) => outcome[r.id]()),
        props: { ramOnlyQueue: true },
      });
      await act(async () => {
        for (const id of ['a', 'b', 'c']) {
          await s.queue?.submit(
            { id, createdAt: Date.now(), title: id, steps: [], actual: '', files: [] },
            JIRA.id,
          );
        }
      });
      fireEvent.press(screen.getByTestId('devtools-report-queue-banner-attention'));
      expect(screen.getByTestId('devtools-report-queue-section-sent')).toBeOnTheScreen();
      expect(screen.getByTestId('devtools-report-queue-ram-only')).toBeOnTheScreen();
    },
  ],
  [
    'kết quả mở từ hàng đợi: thất bại, "kiểm tra đích trước", Bỏ thật?',
    async (kit, colorScheme) => {
      const s = await setup({ kit, colorScheme, jiraSend: failing('unknown') });
      const reportId = s.store.getDraft()?.id as string;
      await pressSend();
      await reopenWithNewDraft(s);
      fireEvent.press(screen.getByTestId('devtools-report-queue-banner-attention'));
      fireEvent.press(screen.getByTestId(`devtools-report-queue-row-${reportId}`));
      fireEvent.press(screen.getByTestId('devtools-report-status-discard'));
      expect(screen.getByTestId('devtools-report-check-first')).toBeOnTheScreen();
      expect(screen.getByTestId('devtools-report-status-discard')).toHaveTextContent('Bỏ thật?');
    },
  ],
  [
    'trang Kết nối: danh sách (bí mật đã che), đang chọn loại',
    async (kit, colorScheme) => {
      await setup({ kit, colorScheme, saved: [JIRA, SLACK] });
      fireEvent.press(screen.getByTestId('devtools-report-pick'));
      fireEvent.press(screen.getByTestId('devtools-report-manage-connections'));
      await flush();
      fireEvent.press(screen.getByTestId('connections-add'));
      expect(screen.getByTestId('connection-row-c-jira')).toHaveTextContent('••••1234', {
        exact: false,
      });
      expect(screen.getByTestId('connections-type-jira-cloud')).toBeOnTheScreen();
    },
  ],
  [
    'trang Kết nối: app không cấp kho bảo mật',
    async (kit, colorScheme) => {
      await setup({ kit, colorScheme, noStore: true });
      fireEvent.press(screen.getByTestId('devtools-report-add-connection'));
      await flush();
      expect(screen.getByTestId('connections-no-store')).toBeOnTheScreen();
    },
  ],
  [
    'form thêm kết nối: đã thử thành công',
    async (kit, colorScheme) => {
      await setup({ kit, colorScheme, saved: [] });
      fireEvent.press(screen.getByTestId('devtools-report-add-connection'));
      await flush();
      fireEvent.press(screen.getByTestId('connections-add'));
      fireEvent.press(screen.getByTestId('connections-type-jira-cloud'));
      await flush();
      fireEvent.press(screen.getByTestId('connection-editor-test'));
      await flush();
      expect(screen.getByTestId('connection-editor-test-ok')).toBeOnTheScreen();
    },
  ],
];

describe.each(KITS)('ReportSheet sáng/tối — kit %s', (_name, kit) => {
  describe.each(['light', 'dark'] as const)('theme %s', (mode) => {
    it.each(SCREENS)('%s: chỉ màu của đúng theme', async (_label, show) => {
      await show(kit, mode);

      expectOnlyThemeColors(mode);
    });
  });
});
