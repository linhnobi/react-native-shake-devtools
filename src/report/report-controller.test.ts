import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import { actionBuffer } from '../capture/action-buffer';
import { logBuffer } from '../capture/log-buffer';
import type { ConsoleEntry, MarkerEntry, NetworkEntry } from '../capture/log-entry';
import type { StoredSession } from '../capture/log-session';
import { markUser } from '../capture/markers';
import type { RecordedAction } from '../capture/recorded-action';
import { devtoolsStrings } from '../i18n/translate';
import { DevToolsUiProvider } from '../ui/DevToolsUiProvider';
import { APP_CONTEXT_TIMEOUT_MS } from './app-context';
import type { BugReport, DevToolsCapturedImage, ReportDraft } from './bug-report';
import {
  CAPTURE_TIMEOUT_MS,
  createReportController,
  takeScreenshot,
  useReportController,
  type ReportControllerDeps,
} from './report-controller';
import type { QueuedReport, QueueState, SendQueue } from './send-queue';
import { buildSteps, reportWindow } from './steps';
import { suggestFromCrash, suggestReport } from './suggest';

/* ⚑ mới sau khi gửi: thay bằng spy để đếm lời gọi, và để cửa sổ của bản nháp sau đo được riêng
   theo `lastSentAt` (mốc ⚑ thật cũng nằm đúng mốc đó và sẽ che mất `lastSentAt`). */
jest.mock('../capture/markers', () => ({ markUser: jest.fn(() => 1) }));

const vi = devtoolsStrings.vi;
const T0 = 1_790_000_000_000;

const IMAGE: DevToolsCapturedImage = {
  uri: 'file:///cache/shot-1.jpg',
  mimeType: 'image/jpeg',
  width: 1080,
  height: 2400,
};
const IMAGE_2: DevToolsCapturedImage = { ...IMAGE, uri: 'file:///cache/shot-2.jpg' };

const tap = (at: number, label: string): RecordedAction => ({ at, kind: 'tap', label, source: 'text' });
const screenMark = (at: number, label: string): MarkerEntry => ({
  id: logBuffer.nextId(),
  kind: 'marker',
  at,
  type: 'screen',
  label,
});
const http500 = (at: number): NetworkEntry => ({
  id: logBuffer.nextId(),
  kind: 'network',
  at,
  method: 'POST',
  url: 'https://api.test/orders?token=abc',
  status: 500,
  screen: 'Checkout',
});
const fatalError = (id: number, at: number): ConsoleEntry => ({
  id,
  kind: 'console',
  at,
  level: 'error',
  uncaught: true,
  fatal: true,
  text: "TypeError: Cannot read property 'id' of undefined\n    at Cart (Cart.tsx:12)",
});

const crashed = (over: Partial<StoredSession> = {}): StoredSession => ({
  format: 2,
  name: 'session-1789999000000.json',
  startedAt: T0 - 1_000_000,
  savedAt: T0 - 700_000,
  fatal: true,
  totalInMemory: 4,
  entries: [
    { id: 1, kind: 'marker', at: T0 - 900_000, type: 'screen', label: 'Cart' },
    fatalError(2, T0 - 700_000),
  ],
  actions: [tap(T0 - 800_000, 'Thêm vào giỏ'), tap(T0 - 750_000, 'Thanh toán')],
  ...over,
});

/** Hàng đợi giả — ghi thứ tự `load`/`submit`, trả mục ở trạng thái `state`. */
const makeQueue = (state: QueueState = 'sent') => {
  const calls: string[] = [];
  const queue = {
    load: jest.fn(async () => {
      calls.push('load');
    }),
    submit: jest.fn(async (report: BugReport, connectionId: string): Promise<QueuedReport> => {
      calls.push('submit');
      return {
        report,
        connectionId,
        state,
        attempts: 1,
        ...(state === 'sent' ? { result: { key: 'DEMO-482' } } : {}),
      };
    }),
    retryDue: jest.fn(async () => undefined),
    retryNow: jest.fn(async (_reportId: string): Promise<QueuedReport> => {
      throw new Error('not stubbed');
    }),
    discard: jest.fn(async (_reportId: string): Promise<void> => undefined),
    items: jest.fn((): readonly QueuedReport[] => []),
    subscribe: jest.fn(() => () => undefined),
  };
  return { queue: queue as typeof queue & SendQueue, calls };
};

let previous: StoredSession | null = null;

const controllerWith = (over: Partial<ReportControllerDeps> = {}) =>
  createReportController({
    strings: () => vi,
    queue: () => makeQueue().queue,
    previous: () => previous,
    ...over,
  });

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  logBuffer.clear();
  actionBuffer.clear();
  previous = null;
  jest.mocked(markUser).mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('takeScreenshot', () => {
  it('app không cấp hàm chụp ⇒ `none`', async () => {
    await expect(takeScreenshot(undefined)).resolves.toBe('none');
  });

  it('có ảnh ⇒ đúng ảnh đó; trả `null` ⇒ `blocked`', async () => {
    await expect(takeScreenshot(async () => IMAGE)).resolves.toBe(IMAGE);
    await expect(takeScreenshot(async () => null)).resolves.toBe('blocked');
  });

  it('hàm chụp ném (đồng bộ hay reject) ⇒ `failed`, không ném ra ngoài', async () => {
    await expect(
      takeScreenshot(() => {
        throw new Error('view-shot not linked');
      }),
    ).resolves.toBe('failed');
    await expect(takeScreenshot(() => Promise.reject(new Error('boom')))).resolves.toBe('failed');
  });

  it(`hàm chụp treo ⇒ \`failed\` đúng sau ${CAPTURE_TIMEOUT_MS} ms, không sớm hơn`, async () => {
    let result: unknown = 'pending';
    void takeScreenshot(() => new Promise(() => undefined)).then((s) => {
      result = s;
    });

    await jest.advanceTimersByTimeAsync(CAPTURE_TIMEOUT_MS - 1);
    expect(result).toBe('pending');

    await jest.advanceTimersByTimeAsync(1);
    expect(result).toBe('failed');
  });
});

describe('createReportController', () => {
  it('`begin` lần đầu dựng nháp từ `reportWindow` + `buildSteps` + `suggestReport`', () => {
    actionBuffer.push(tap(T0 - 50, 'Thanh toán'));
    logBuffer.push(screenMark(T0 - 60, 'Checkout'));
    logBuffer.push(http500(T0 - 40));
    const c = controllerWith();

    c.begin(IMAGE);

    const entries = logBuffer.snapshot();
    const window = reportWindow({ entries, sessionStartedAt: 0 });
    const suggestion = suggestReport({ entries, from: window.from, strings: vi });
    const draft = c.getDraft();
    expect(draft).toEqual({
      id: expect.stringMatching(/^rpt-[0-9a-z]+-[0-9a-z]{6}$/),
      createdAt: T0,
      window,
      title: suggestion.title,
      steps: buildSteps({ actions: actionBuffer.snapshot(), entries, from: window.from }),
      actual: suggestion.actual,
      expected: '',
      screenshot: IMAGE,
      attach: {
        screenshot: true,
        errors: true,
        deviceInfo: true,
        previousSession: false,
        appContext: true,
      },
    });
    expect(draft?.title).toBe('[Checkout] POST /orders → 500');
    expect(draft?.steps.map((s) => s.kind)).toEqual(['screen', 'tap', 'error']);
  });

  it('đã có nháp ⇒ `begin` GIỮ nguyên (cả ảnh); thao tác mới vào bộ đệm không đổi `draft.steps`', () => {
    actionBuffer.push(tap(T0 - 50, 'Thanh toán'));
    const c = controllerWith();
    c.begin(IMAGE);
    const first = c.getDraft();

    actionBuffer.push(tap(T0 + 10, 'Huỷ đơn'));
    logBuffer.push(http500(T0 + 20));
    c.begin(IMAGE_2);

    expect(c.getDraft()).toBe(first);
    expect(c.getDraft()?.steps.map((s) => s.label)).toEqual(['Thanh toán']);
    expect(c.getDraft()?.screenshot).toBe(IMAGE);
  });

  it('phiên trước `fatal` chưa báo ⇒ nháp crash: chip Phiên trước bật, chip Ảnh tắt, tiêu đề và các bước từ phiên trước', () => {
    previous = crashed();
    actionBuffer.push(tap(T0 - 5, 'Mở lại app'));
    const c = controllerWith();

    c.begin(IMAGE);

    const draft = c.getDraft() as ReportDraft;
    const suggestion = suggestFromCrash(previous, vi);
    expect(draft.crash).toEqual({ sessionName: 'session-1789999000000.json' });
    expect(draft.attach).toEqual({
      screenshot: false,
      errors: true,
      deviceInfo: true,
      previousSession: true,
      appContext: true,
    });
    expect(draft.title).toBe(suggestion.title);
    expect(draft.title).toBe("[Crash] TypeError: Cannot read property 'id' of undefined");
    expect(draft.actual).toBe(suggestion.actual);
    expect(draft.steps).toEqual(
      buildSteps({ actions: previous.actions ?? [], entries: previous.entries, from: 0 }),
    );
    expect(draft.steps.map((s) => s.label)).toEqual([
      'Cart',
      'Thêm vào giỏ',
      'Thanh toán',
      "TypeError: Cannot read property 'id' of undefined",
    ]);
  });

  it('phiên trước kết thúc bình thường ⇒ nháp thường, không có `crash`', () => {
    previous = crashed({ fatal: false });
    const c = controllerWith();

    c.begin('none');

    expect(c.getDraft()?.crash).toBeUndefined();
    expect(c.getDraft()?.attach.previousSession).toBe(false);
  });

  it('`update` · `retake` · `discard`; người nghe được báo; không có nháp thì `update`/`retake` không làm gì', () => {
    const c = controllerWith();
    const listener = jest.fn();
    c.subscribe(listener);

    c.update({ title: 'không có nháp' });
    c.retake(IMAGE);
    expect(c.getDraft()).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    c.begin('blocked');
    const steps = [{ id: 'x', kind: 'text' as const, at: T0, text: 'Mở app' }];
    c.update({ title: 'QA sửa', steps, expected: 'Không lỗi' });
    c.retake(IMAGE);

    expect(c.getDraft()).toMatchObject({
      title: 'QA sửa',
      steps,
      expected: 'Không lỗi',
      screenshot: IMAGE,
    });
    expect(listener).toHaveBeenCalledTimes(3);

    c.discard();
    expect(c.getDraft()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('`send` thành công ⇒ ⚑ mới, `lastSentAt` cập nhật, `draft` về null, nháp sau không còn `crash`', async () => {
    previous = crashed();
    const { queue } = makeQueue('sent');
    const c = controllerWith({ queue: () => queue });
    c.begin(IMAGE);

    jest.setSystemTime(T0 + 5_000);
    const item = await c.send('c1');

    expect(item.state).toBe('sent');
    expect(queue.submit).toHaveBeenCalledWith(expect.any(Object), 'c1');
    const report = queue.submit.mock.calls[0][0];
    expect(report.files.map((f) => f.name)).toEqual([
      'errors.txt',
      'timeline.json',
      'previous-session.txt',
    ]);
    expect(markUser).toHaveBeenCalledTimes(1);
    expect(c.getDraft()).toBeNull();

    jest.setSystemTime(T0 + 9_000);
    c.begin(IMAGE_2);

    expect(c.getDraft()?.crash).toBeUndefined();
    expect(c.getDraft()?.window).toEqual({ from: T0 + 5_000, source: 'sent' });
    expect(c.getDraft()?.title.startsWith('[Crash]')).toBe(false);
  });

  it.each(['pending', 'uncertain', 'failed'] as const)(
    'hàng đợi NHẬN bản báo (`%s`) ⇒ như gửi xong: ⚑ mới, `lastSentAt`, xoá nháp, crash đã báo (R31)',
    async (state) => {
      previous = crashed();
      const { queue } = makeQueue(state);
      const c = controllerWith({ queue: () => queue });
      c.begin(IMAGE);

      jest.setSystemTime(T0 + 5_000);
      await expect(c.send('c1')).resolves.toMatchObject({ state });

      expect(markUser).toHaveBeenCalledTimes(1);
      expect(c.getDraft()).toBeNull();

      /* Hàng đợi giữ bản báo crash rồi: nháp sau KHÔNG được là bản crash đó lần nữa. */
      jest.setSystemTime(T0 + 9_000);
      c.begin(IMAGE_2);
      expect(c.getDraft()?.crash).toBeUndefined();
      expect(c.getDraft()?.title.startsWith('[Crash]')).toBe(false);
      expect(c.getDraft()?.window).toEqual({ from: T0 + 5_000, source: 'sent' });
    },
  );

  it('`blocked` (token hết hạn, kết nối mất…) ⇒ giữ nháp để sửa, không đặt ⚑, crash chưa coi là đã báo', async () => {
    previous = crashed();
    const { queue } = makeQueue('blocked');
    const c = controllerWith({ queue: () => queue });
    c.begin(IMAGE);
    const draft = c.getDraft();

    await expect(c.send('c1')).resolves.toMatchObject({ state: 'blocked' });

    expect(c.getDraft()).toBe(draft);
    expect(c.getDraft()?.crash).toBeDefined();
    expect(markUser).not.toHaveBeenCalled();
  });

  it('gửi lại nháp đã bị `blocked` (QA đã sửa) ⇒ bỏ mục cũ trong hàng đợi rồi gửi BẢN MỚI — không bị gộp vào mục cũ', async () => {
    const { queue, calls } = makeQueue('blocked');
    const c = controllerWith({ queue: () => queue });
    c.begin('none');
    const first = await c.send('c1');
    queue.items.mockReturnValue([first]);
    queue.discard.mockImplementation(async () => {
      calls.push('discard');
    });
    queue.submit.mockImplementation(async (report: BugReport, connectionId: string) => {
      calls.push('submit');
      return { report, connectionId, state: 'sent', attempts: 1 };
    });

    c.update({ title: 'QA đã sửa' });
    const item = await c.send('c2');

    expect(item.state).toBe('sent');
    expect(queue.discard).toHaveBeenCalledWith(first.report.id);
    expect(calls).toEqual(['load', 'submit', 'load', 'discard', 'submit']);
    expect(queue.submit.mock.calls[1][0]).toMatchObject({ id: first.report.id, title: 'QA đã sửa' });
    expect(queue.submit.mock.calls[1][1]).toBe('c2');
    expect(c.getDraft()).toBeNull();
  });

  /*
    R34: chỉ `resume.committed === true` (connector đánh dấu đúng lúc bước không đảo ngược xong:
    Jira tạo issue, Lark gửi thẻ) mới là "ticket đã có". Tiến độ upload (Slack `fileIds`, Lark
    `imageKey`/`fileKeys`) đảo ngược được ⇒ vẫn gửi BẢN SỬA tới kết nối QA chọn.
  */
  describe('gửi lại nháp `blocked` có `resume` (R34)', () => {
    /** Lần gửi đầu tới `c1` bị chặn và hàng đợi giữ mục đó với `resume`. */
    const blockedWith = async (resume: Readonly<Record<string, unknown>>) => {
      const { queue, calls } = makeQueue('blocked');
      const c = controllerWith({ queue: () => queue });
      c.begin('none');
      c.update({ title: 'Bản đầu' });
      const first = await c.send('c1');
      queue.items.mockReturnValue([{ ...first, resume }]);
      queue.discard.mockImplementation(async () => {
        calls.push('discard');
      });
      queue.submit.mockImplementation(async (report: BugReport, connectionId: string) => {
        calls.push('submit');
        return { report, connectionId, state: 'sent', attempts: 1 };
      });
      queue.retryNow.mockImplementation(async () => {
        calls.push('retryNow');
        return { ...first, state: 'sent' as const };
      });
      c.update({ title: 'Bản đã sửa' });
      return { c, queue, calls, first };
    };

    it.each([
      ['chỉ mới upload (`fileIds`), QA chọn kết nối KHÁC', { fileIds: ['F0'] }, 'c2'],
      ['chỉ mới upload (`fileIds`), CÙNG kết nối', { fileIds: ['F0'] }, 'c1'],
      ['đã `committed`, QA chọn kết nối KHÁC', { issueKey: 'DEMO-9', committed: true }, 'c2'],
    ] as const)('%s ⇒ bỏ mục cũ, gửi bản sửa tới kết nối được chọn', async (_case, resume, target) => {
      const { c, queue, calls, first } = await blockedWith(resume);

      const item = await c.send(target);

      expect(item.state).toBe('sent');
      expect(calls.slice(2)).toEqual(['load', 'discard', 'submit']);
      expect(queue.discard).toHaveBeenCalledWith(first.report.id);
      expect(queue.submit.mock.calls[1][0]).toMatchObject({ title: 'Bản đã sửa' });
      expect(queue.submit.mock.calls[1][1]).toBe(target);
      expect(queue.retryNow).not.toHaveBeenCalled();
      expect(c.getDraft()).toBeNull();
    });

    it('đã `committed` (ticket đã có), CÙNG kết nối ⇒ `retryNow` làm nốt phần thiếu, không gửi bản mới (tránh ticket trùng)', async () => {
      const { c, queue, calls, first } = await blockedWith({ issueKey: 'DEMO-9', committed: true });

      const item = await c.send('c1');

      expect(item.state).toBe('sent');
      expect(calls.slice(2)).toEqual(['load', 'retryNow']);
      expect(queue.retryNow).toHaveBeenCalledWith(first.report.id);
      expect(queue.discard).not.toHaveBeenCalled();
      expect(queue.submit).toHaveBeenCalledTimes(1);
      expect(c.getDraft()).toBeNull();
    });
  });

  it('`send` đợi `queue.load()` xong rồi mới `submit` (R27)', async () => {
    const { queue, calls } = makeQueue('sent');
    const c = controllerWith({ queue: () => queue });
    c.begin('none');

    await c.send('c1');

    expect(calls).toEqual(['load', 'submit']);
  });

  it('`send` khi chưa có nháp, hoặc app chưa cấp kho bảo mật (không có hàng đợi) ⇒ reject', async () => {
    const { queue } = makeQueue();
    await expect(controllerWith({ queue: () => queue }).send('c1')).rejects.toThrow(/draft/);

    const c = controllerWith({ queue: () => null });
    c.begin('none');
    await expect(c.send('c1')).rejects.toThrow(/secureStore/);
    expect(c.getDraft()).not.toBeNull();
  });

  it('`send` xong nhưng QA đã mở nháp mới (huỷ rồi bắt đầu lại) ⇒ không xoá nháp mới', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { queue } = makeQueue();
    queue.submit.mockImplementation(async (report, connectionId) => {
      await held;
      return { report, connectionId, state: 'sent', attempts: 1 };
    });
    const c = controllerWith({ queue: () => queue });
    c.begin('none');
    const sentId = c.getDraft()?.id;

    const sending = c.send('c1');
    c.discard();
    c.begin(IMAGE);
    const next = c.getDraft();
    release();
    await sending;

    expect(queue.submit.mock.calls[0][0].id).toBe(sentId);
    expect(c.getDraft()).toBe(next);
  });

  it('`buildReport` dựng `BugReport` của nháp đang soạn bằng đúng ngữ cảnh của `send` (Chia sẻ, R8); không gửi, không xoá nháp; không có nháp ⇒ `null`', () => {
    previous = crashed();
    logBuffer.push(http500(T0 - 20));
    const { queue } = makeQueue();
    const c = controllerWith({ queue: () => queue, subtitle: () => 'UAT · 1.0.2' });
    expect(c.buildReport()).toBeNull();

    c.begin(IMAGE);
    c.update({ title: 'Không thanh toán được', attach: { ...c.getDraft()!.attach, screenshot: true } });
    const report = c.buildReport();

    expect(report?.id).toBe(c.getDraft()?.id);
    expect(report?.title).toBe('Không thanh toán được');
    expect(report?.files.map((f) => f.name)).toEqual([
      'screenshot.jpg',
      'errors.txt',
      'timeline.json',
      'previous-session.txt',
    ]);
    expect(report?.files.find((f) => f.name === 'errors.txt')?.content).toContain('UAT · 1.0.2');
    expect(queue.load).not.toHaveBeenCalled();
    expect(queue.submit).not.toHaveBeenCalled();
    expect(markUser).not.toHaveBeenCalled();
    expect(c.getDraft()).not.toBeNull();

    /* App không cấp kho bảo mật (không hàng đợi) — Chia sẻ vẫn là đường duy nhất, vẫn dựng được. */
    const noQueue = controllerWith({ queue: () => null });
    noQueue.begin('none');
    expect(noQueue.buildReport()?.id).toBe(noQueue.getDraft()?.id);
  });

  it('`previewSteps` = số bước một nháp mới sẽ có lúc này (crash ⇒ đếm theo phiên trước); không tạo nháp', () => {
    actionBuffer.push(tap(T0 - 50, 'A'));
    actionBuffer.push(tap(T0 - 40, 'B'));
    const c = controllerWith();

    expect(c.previewSteps()).toBe(2);
    expect(c.getDraft()).toBeNull();

    previous = crashed();
    expect(c.previewSteps()).toBe(4);
  });

  it('`errorCount` = số lỗi errors.txt của nháp sẽ chứa: không nháp ⇒ 0; nháp thường ⇒ cửa sổ hiện tại; nháp crash ⇒ phiên crash', () => {
    logBuffer.push(http500(T0 - 30));
    logBuffer.push(http500(T0 - 20));
    const normal = controllerWith();
    expect(normal.errorCount()).toBe(0);
    normal.begin('none');
    expect(normal.errorCount()).toBe(2);

    /* Phiên crash có 1 lỗi; phiên hiện tại (sau khi mở lại app) có 2 — chip phải đếm theo phiên crash. */
    previous = crashed();
    const crash = controllerWith();
    crash.begin('none');
    expect(crash.getDraft()?.crash).toBeDefined();
    expect(crash.errorCount()).toBe(1);
    const errors = crash.buildReport()?.files.find((f) => f.name === 'errors.txt')?.content;
    expect(errors).toContain("Cannot read property 'id' of undefined");
    expect(errors).not.toContain('/orders');
  });

  it('phiên crash hỏng (phần tử null, url số) ⇒ `previewSteps`/`begin` không ném, nháp crash vẫn dựng', () => {
    previous = crashed({
      entries: [
        null,
        { id: 3, kind: 'network', at: T0 - 800_000, method: 'GET', url: 42, status: 500 },
      ] as unknown as StoredSession['entries'],
    });
    const c = controllerWith();

    expect(c.previewSteps()).toBe(3);
    c.begin('none');
    expect(c.getDraft()?.crash).toEqual({ sessionName: 'session-1789999000000.json' });
    expect(c.getDraft()?.title).toBe('[Crash] GET → 500');
    /* Gửi/Chia sẻ dựng được `previous-session.txt` — phần tử hỏng bị bỏ, không làm hỏng lần gửi. */
    const files = c.buildReport()?.files.map((f) => f.name);
    expect(files).toContain('previous-session.txt');
  });

  it('dựng nháp crash ném (file phiên hỏng kiểu chưa lường) ⇒ lùi về nháp thường, không ném', () => {
    actionBuffer.push(tap(T0 - 50, 'A'));
    const broken = crashed();
    Object.defineProperty(broken, 'entries', {
      get: () => {
        throw new Error('corrupt');
      },
    });
    previous = broken;
    const c = controllerWith();

    expect(c.previewSteps()).toBe(1);
    c.begin('none');
    const draft = c.getDraft() as ReportDraft;
    expect(draft.crash).toBeUndefined();
    expect(draft.attach.previousSession).toBe(false);
    expect(draft.steps.map((s) => s.label)).toEqual(['A']);
  });

  describe('ngữ cảnh app (`appContext`)', () => {
    /** Hàm ngữ cảnh async mà test tự quyết lúc xong. */
    const deferred = () => {
      let resolve: (value: object) => void = () => undefined;
      const read = jest.fn(
        () =>
          new Promise<object>((r) => {
            resolve = r;
          }),
      );
      return { read, resolve: (value: object) => resolve(value) };
    };

    it('hàm đồng bộ ⇒ nháp có ngữ cảnh `ready` ngay khi dựng, chip bật sẵn; nháp giữ thì không gọi lại', () => {
      const read = jest.fn(() => ({ userId: 'u-42', session: { accessToken: 'at-1' } }));
      const c = controllerWith({ appContext: () => read });

      c.begin(IMAGE);

      expect(c.getDraft()?.appContext).toMatchObject({
        status: 'ready',
        lines: [
          ['userId', 'u-42'],
          ['session', '{"accessToken":"<redacted>"}'],
        ],
      });
      expect(c.getDraft()?.attach.appContext).toBe(true);
      c.begin(IMAGE_2);
      expect(read).toHaveBeenCalledTimes(1);
    });

    it('app không cấp hàm ⇒ nháp không có `appContext`', () => {
      const c = controllerWith();
      c.begin(IMAGE);
      expect(c.getDraft()?.appContext).toBeUndefined();
      expect(c.buildReport()?.files.map((f) => f.name)).not.toContain('context.json');
    });

    it('hàm ném ⇒ nháp vẫn dựng (form không bị chặn), ngữ cảnh `failed`', () => {
      const c = controllerWith({
        appContext: () => () => {
          throw new Error('store not ready');
        },
      });

      c.begin(IMAGE);

      expect(c.getDraft()?.title).toBeDefined();
      expect(c.getDraft()?.appContext).toEqual({ status: 'failed', reason: 'threw' });
    });

    it('hàm async ⇒ `pending`, xong thì `ready`; người nghe được báo; chữ QA sửa trong lúc đợi giữ nguyên', async () => {
      const { read, resolve } = deferred();
      const c = controllerWith({ appContext: () => read });
      const listener = jest.fn();
      c.subscribe(listener);

      c.begin(IMAGE);
      expect(c.getDraft()?.appContext).toEqual({ status: 'pending' });
      c.update({ title: 'QA gõ trong lúc đợi' });

      resolve({ flags: { newCheckout: true } });
      await jest.advanceTimersByTimeAsync(0);

      expect(c.getDraft()?.appContext).toMatchObject({
        status: 'ready',
        lines: [['flags', '{"newCheckout":true}']],
      });
      expect(c.getDraft()?.title).toBe('QA gõ trong lúc đợi');
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it(`hàm async treo ⇒ \`failed\`/\`timeout\` sau ${APP_CONTEXT_TIMEOUT_MS} ms`, async () => {
      const { read } = deferred();
      const c = controllerWith({ appContext: () => read });

      c.begin(IMAGE);
      await jest.advanceTimersByTimeAsync(APP_CONTEXT_TIMEOUT_MS);

      expect(c.getDraft()?.appContext).toEqual({ status: 'failed', reason: 'timeout' });
    });

    it('nháp bị huỷ trước khi hàm async xong ⇒ kết quả muộn không dựng lại nháp, không đổi nháp mới', async () => {
      const first = deferred();
      const c = controllerWith({ appContext: () => first.read });
      c.begin(IMAGE);
      c.discard();

      first.resolve({ userId: 'old' });
      await jest.advanceTimersByTimeAsync(0);
      expect(c.getDraft()).toBeNull();

      /* Mỗi lần gọi một lời hứa riêng: kết quả của nháp đã huỷ không được ghi vào nháp mới. */
      const resolvers: Array<(value: object) => void> = [];
      const c2 = controllerWith({
        appContext: () => () =>
          new Promise<object>((r) => {
            resolvers.push(r);
          }),
      });
      c2.begin(IMAGE);
      c2.discard();
      c2.begin(IMAGE_2);
      resolvers[0]({ userId: 'stale' });
      await jest.advanceTimersByTimeAsync(0);
      expect(c2.getDraft()?.appContext).toEqual({ status: 'pending' });
      resolvers[1]({ userId: 'fresh' });
      await jest.advanceTimersByTimeAsync(0);
      expect(c2.getDraft()?.appContext).toMatchObject({ lines: [['userId', 'fresh']] });
    });

    it('nháp crash ⇒ KHÔNG gọi hàm ngữ cảnh (ngữ cảnh lúc này không phải của phiên crash)', () => {
      previous = crashed();
      const read = jest.fn(() => ({ userId: 'u-42' }));
      const c = controllerWith({ appContext: () => read });

      c.begin(IMAGE);

      expect(c.getDraft()?.crash).toBeDefined();
      expect(c.getDraft()?.appContext).toBeUndefined();
      expect(read).not.toHaveBeenCalled();
    });

    it('`send` lúc ngữ cảnh còn `pending` ⇒ đợi nó xong rồi mới dựng bản báo (có context.json)', async () => {
      const { queue } = makeQueue('sent');
      const { read, resolve } = deferred();
      const c = controllerWith({ queue: () => queue, appContext: () => read });
      c.begin('none');

      const sending = c.send('conn-1');
      await jest.advanceTimersByTimeAsync(0);
      expect(queue.submit).not.toHaveBeenCalled();

      resolve({ userId: 'u-42' });
      await sending;

      const report = queue.submit.mock.calls[0][0];
      expect(report.files.map((f) => f.name)).toContain('context.json');
      expect(report.appContext).toEqual({ lines: [['userId', 'u-42']], more: 0 });
    });
  });
});

describe('useReportController', () => {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(DevToolsUiProvider, { locale: 'vi' }, children);

  it('render lại khi nháp đổi; `ready` theo hàng đợi; giữ nháp qua các lượt render', () => {
    const { queue } = makeQueue();
    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) => useReportController({}, { queue, ready }),
      { wrapper, initialProps: { ready: false } },
    );
    expect(result.current.draft).toBeNull();
    expect(result.current.ready).toBe(false);

    act(() => result.current.begin('blocked'));
    const draft = result.current.draft;
    expect(draft?.screenshot).toBe('blocked');

    rerender({ ready: true });
    expect(result.current.ready).toBe(true);
    expect(result.current.draft).toBe(draft);
  });

  it('vắng cấu hình `bugReport` ⇒ không dựng nháp; không có hàng đợi ⇒ `ready` luôn `false`', () => {
    const { result } = renderHook(() => useReportController(undefined, { queue: null, ready: true }), {
      wrapper,
    });

    act(() => result.current.begin(IMAGE));

    expect(result.current.draft).toBeNull();
    expect(result.current.ready).toBe(false);
  });

  it('`bugReport.appContext` mới nhất (cấu hình viết inline, đổi mỗi lượt render) được gọi lúc dựng nháp', () => {
    const { queue } = makeQueue();
    const { result, rerender } = renderHook(
      ({ env }: { env: string }) =>
        useReportController({ appContext: () => ({ env }) }, { queue, ready: true }),
      { wrapper, initialProps: { env: 'dev' } },
    );

    rerender({ env: 'uat' });
    act(() => result.current.begin(IMAGE));

    expect(result.current.draft?.appContext).toMatchObject({
      status: 'ready',
      lines: [['env', 'uat']],
    });
  });
});
