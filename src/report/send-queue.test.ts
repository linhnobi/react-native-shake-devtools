import { planPrune, type LogStoreFile } from '../capture/log-session';
import type { LogStore } from '../capture/log-persist';
import type { BugReport } from './bug-report';
import type { ConnectionStore, StoredConnection } from './connections/connection-store';
import {
  ConnectorError,
  type ConnectorErrorKind,
  type ConnectorType,
  type ConnectorValues,
  type SendContext,
  type SendResult,
} from './connectors/types';
import { makeUploadPart } from './connectors/upload';
import {
  MAX_ATTEMPTS,
  QUEUE_FILE,
  RETRY_EVERY_MS,
  createSendQueue,
  isCommitted,
  queueCounts,
  type QueueState,
  type QueuedReport,
  type SendQueue,
} from './send-queue';

const TOKEN = 'tok-SECRET-1234567890';

const report = (id = 'rpt-1', over: Partial<BugReport> = {}): BugReport => ({
  id,
  createdAt: 1_700_000_000_000,
  title: 'Crash khi thanh toán',
  steps: [],
  actual: 'POST /orders → 500',
  files: [{ name: 'errors.txt', mimeType: 'text/plain', content: 'boom' }],
  ...over,
});

const connection = (id = 'c1'): StoredConnection => ({
  id,
  typeId: 'fake',
  name: 'Fake',
  ticketLocale: 'vi',
  values: { baseUrl: 'https://x.test' },
  createdAt: 1,
});

/** Kho kết nối giả — bí mật nằm ở `secretsById`, `null` ⇒ Keychain trống. */
const makeConnections = (
  list: StoredConnection[],
  secretsById: Record<string, ConnectorValues | null> = {
    c1: { token: TOKEN },
  },
): ConnectionStore & { list: jest.Mock } => ({
  list: jest.fn(async () => list),
  save: jest.fn(),
  remove: jest.fn(),
  secrets: jest.fn(async (id: string) => secretsById[id] ?? null),
  lastUsed: jest.fn(),
  setLastUsed: jest.fn(),
  resetAll: jest.fn(),
});

/** LogStore giả trong RAM; `files` để test soi nội dung đã ghi. */
const makeStore = (): LogStore & {
  files: Map<string, string>;
  writes: Array<{ name: string; content: string }>;
} => {
  const files = new Map<string, string>();
  const writes: Array<{ name: string; content: string }> = [];
  return {
    files,
    writes,
    list: async (): Promise<readonly LogStoreFile[]> =>
      [...files.keys()].map((name) => ({ name, modifiedAt: 0 })),
    read: async (name) => {
      const v = files.get(name);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    write: async (name, content) => {
      writes.push({ name, content });
      files.set(name, content);
    },
    remove: async (name) => {
      files.delete(name);
    },
  };
};

type SendFn = (ctx: SendContext) => Promise<SendResult>;

interface Harness {
  queue: SendQueue;
  send: jest.Mock;
  connections: ReturnType<typeof makeConnections>;
  setNow: (n: number) => void;
  contexts: Array<{ resume: unknown }>;
}

const T0 = 1_000_000;

const build = (
  opts: {
    send?: SendFn;
    store?: LogStore;
    connections?: ReturnType<typeof makeConnections>;
  } = {},
): Harness => {
  let now = T0;
  const send = jest.fn(
    async (_r: BugReport, _v: ConnectorValues, _s: ConnectorValues, ctx: SendContext) =>
      (opts.send ?? (async () => ({ key: 'BUG-1', url: 'https://x.test/BUG-1' })))(ctx),
  );
  const type = { id: 'fake', send } as unknown as ConnectorType;
  const contexts: Array<{ resume: unknown }> = [];
  const connections = opts.connections ?? makeConnections([connection()]);
  const queue = createSendQueue({
    connections,
    connectorTypes: [type],
    makeSendContext: (_locale, resume, checkpoint) => {
      contexts.push({ resume });
      return {
        fetch: jest.fn(),
        locale: 'vi',
        timeoutMs: 30_000,
        resume,
        checkpoint,
        uploadPart: jest.fn(),
      } as unknown as SendContext;
    },
    store: opts.store,
    now: () => now,
  });
  return { queue, send, connections, setNow: (n) => (now = n), contexts };
};

const fail = (kind: ConnectorErrorKind, extra: { field?: string; retryAfterMs?: number } = {}) =>
  new ConnectorError(kind, `${kind} error`, extra);

describe('isCommitted', () => {
  it('chỉ `resume.committed === true` là ticket đã có; tiến độ upload, giá trị khác `true`, vắng ⇒ false', () => {
    expect(isCommitted({ resume: { issueKey: 'DEMO-9', committed: true } })).toBe(true);
    expect(isCommitted({ resume: { fileIds: ['F0'] } })).toBe(false);
    expect(isCommitted({ resume: { committed: 'yes' } })).toBe(false);
    expect(isCommitted({})).toBe(false);
    expect(isCommitted(undefined)).toBe(false);
  });
});

describe('queueCounts', () => {
  it('cần xử lý = failed/blocked/uncertain; chờ gửi = pending/sending; sent không tính', () => {
    const item = (state: QueueState): QueuedReport => ({
      report: report(`rpt-${state}`),
      connectionId: 'c1',
      state,
      attempts: 1,
    });
    expect(queueCounts([])).toEqual({ waiting: 0, attention: 0 });
    expect(
      queueCounts(
        (['failed', 'blocked', 'uncertain', 'pending', 'sending', 'sent', 'sent'] as const).map(item),
      ),
    ).toEqual({ waiting: 2, attention: 3 });
  });

  it('`ownDraftId`: mục `blocked` của chính nháp đang soạn không tính (form đã nói về nó); trạng thái khác cùng id vẫn tính (N4)', () => {
    const blocked: QueuedReport = {
      report: report('rpt-draft'),
      connectionId: 'c1',
      state: 'blocked',
      attempts: 1,
    };
    const failed: QueuedReport = { ...blocked, report: report('rpt-other'), state: 'failed' };
    expect(queueCounts([blocked, failed], { ownDraftId: 'rpt-draft' })).toEqual({
      waiting: 0,
      attention: 1,
    });
    expect(queueCounts([blocked, failed])).toEqual({ waiting: 0, attention: 2 });
    expect(
      queueCounts([{ ...blocked, state: 'pending' }], { ownDraftId: 'rpt-draft' }),
    ).toEqual({ waiting: 1, attention: 0 });
  });
});

describe('createSendQueue', () => {
  it('gửi thành công → sent kèm result, xoá lỗi cũ', async () => {
    const h = build();
    const item = await h.queue.submit(report(), 'c1');
    expect(item.state).toBe('sent');
    expect(item.result).toEqual({ key: 'BUG-1', url: 'https://x.test/BUG-1' });
    expect(item.attempts).toBe(1);
    expect(item.lastError).toBeUndefined();
    expect(h.queue.items()).toHaveLength(1);
  });

  it('ảnh cache đã mất: connector trả skippedFiles → sent một lần, không lặp lại', async () => {
    const h = build({
      send: async () => ({ key: 'BUG-2', skippedFiles: ['screenshot.jpg'] }),
    });
    const item = await h.queue.submit(report(), 'c1');
    expect(item.state).toBe('sent');
    expect(item.result?.skippedFiles).toEqual(['screenshot.jpg']);
    await h.queue.retryDue();
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('network → pending, nextAttemptAt = now + 60 000; retryDue chỉ gửi sau mốc', async () => {
    let calls = 0;
    const h = build({
      send: async () => {
        calls += 1;
        if (calls === 1) throw fail('network');
        return { key: 'BUG-3' };
      },
    });
    const item = await h.queue.submit(report(), 'c1');
    expect(item.state).toBe('pending');
    expect(item.nextAttemptAt).toBe(T0 + RETRY_EVERY_MS);
    expect(item.lastError).toEqual({
      kind: 'network',
      message: 'network error',
      field: undefined,
    });

    h.setNow(T0 + RETRY_EVERY_MS - 1);
    await h.queue.retryDue();
    expect(h.send).toHaveBeenCalledTimes(1);

    h.setNow(T0 + RETRY_EVERY_MS);
    await h.queue.retryDue();
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.queue.items()[0].state).toBe('sent');
    expect(h.queue.items()[0].attempts).toBe(2);
  });

  it('đến lần thứ 5 vẫn network → failed, không tự gửi lại nữa', async () => {
    const h = build({
      send: async () => {
        throw fail('network');
      },
    });
    await h.queue.submit(report(), 'c1');
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      expect(h.queue.items()[0].state).toBe('pending');
      h.setNow(T0 + i * RETRY_EVERY_MS);
      await h.queue.retryDue();
    }
    const item = h.queue.items()[0];
    expect(item.attempts).toBe(MAX_ATTEMPTS);
    expect(item.state).toBe('failed');
    h.setNow(T0 + 100 * RETRY_EVERY_MS);
    await h.queue.retryDue();
    expect(h.send).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it('uncertain (chưa có resume) → uncertain; retryDue KHÔNG gửi lại, retryNow mới gửi', async () => {
    let calls = 0;
    const h = build({
      send: async () => {
        calls += 1;
        if (calls === 1) throw fail('uncertain');
        return { key: 'BUG-4' };
      },
    });
    const item = await h.queue.submit(report(), 'c1');
    expect(item.state).toBe('uncertain');
    expect(item.nextAttemptAt).toBeUndefined();
    h.setNow(T0 + 10 * RETRY_EVERY_MS);
    await h.queue.retryDue();
    expect(h.send).toHaveBeenCalledTimes(1);

    const after = await h.queue.retryNow('rpt-1');
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(after.state).toBe('sent');
  });

  it.each(['auth', 'permission', 'validation'] as const)(
    '%s → blocked, giữ lastError.field và bản báo, không tự gửi lại',
    async (kind) => {
      const h = build({
        send: async () => {
          throw fail(kind, { field: 'customfield_1' });
        },
      });
      const item = await h.queue.submit(report(), 'c1');
      expect(item.state).toBe('blocked');
      expect(item.lastError).toEqual({
        kind,
        message: `${kind} error`,
        field: 'customfield_1',
      });
      expect(item.report.title).toBe('Crash khi thanh toán');
      h.setNow(T0 + 10 * RETRY_EVERY_MS);
      await h.queue.retryDue();
      expect(h.send).toHaveBeenCalledTimes(1);
    },
  );

  it('rate-limit có retryAfterMs → nextAttemptAt theo giá trị đó; không có → 60 s', async () => {
    const h = build({
      send: async () => {
        throw fail('rate-limit', { retryAfterMs: 12_345 });
      },
    });
    const item = await h.queue.submit(report('a'), 'c1');
    expect(item.state).toBe('pending');
    expect(item.nextAttemptAt).toBe(T0 + 12_345);

    const h2 = build({
      send: async () => {
        throw fail('rate-limit');
      },
    });
    const item2 = await h2.queue.submit(report('b'), 'c1');
    expect(item2.nextAttemptAt).toBe(T0 + RETRY_EVERY_MS);
  });

  it('unknown / lỗi lạ → failed, không tự gửi lại, không lộ message của lỗi lạ', async () => {
    const h = build({
      send: async () => {
        throw new TypeError(`bad ${TOKEN}`);
      },
    });
    const item = await h.queue.submit(report(), 'c1');
    expect(item.state).toBe('failed');
    expect(item.lastError?.kind).toBe('unknown');
    expect(JSON.stringify(item)).not.toContain(TOKEN);
    h.setNow(T0 + 10 * RETRY_EVERY_MS);
    await h.queue.retryDue();
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('checkpoint({issueKey}) rồi ném network → lần sau nhận resume.issueKey', async () => {
    let calls = 0;
    const h = build({
      send: async (ctx) => {
        calls += 1;
        if (calls === 1) {
          ctx.checkpoint({ issueKey: 'BUG-9' });
          throw fail('network');
        }
        return { key: 'BUG-9' };
      },
    });
    const item = await h.queue.submit(report(), 'c1');
    expect(item.state).toBe('pending');
    expect(item.resume).toEqual({ issueKey: 'BUG-9' });
    expect(h.contexts[0].resume).toBeUndefined();

    h.setNow(T0 + RETRY_EVERY_MS);
    await h.queue.retryDue();
    expect(h.contexts[1].resume).toEqual({ issueKey: 'BUG-9' });
  });

  it('R36: uncertain sau checkpoint `{ committed: true }` (ticket đã có) → tự gửi lại như network', async () => {
    let calls = 0;
    const h = build({
      send: async (ctx) => {
        calls += 1;
        if (calls === 1) {
          ctx.checkpoint({ issueKey: 'BUG-9', committed: true });
          throw fail('uncertain');
        }
        return { key: 'BUG-9' };
      },
    });
    const item = await h.queue.submit(report(), 'c1');
    expect(item.state).toBe('pending');
    expect(item.nextAttemptAt).toBe(T0 + RETRY_EVERY_MS);
    h.setNow(T0 + RETRY_EVERY_MS);
    await h.queue.retryDue();
    expect(h.queue.items()[0].state).toBe('sent');
    expect(h.contexts[1].resume).toEqual({ issueKey: 'BUG-9', committed: true });
  });

  it('R36: uncertain sau checkpoint chỉ-upload `{ fileIds }` → uncertain, KHÔNG tự gửi lại; retryNow mới gửi', async () => {
    let calls = 0;
    const h = build({
      send: async (ctx) => {
        calls += 1;
        if (calls === 1) {
          // Slack: file đã upload, bước không đảo ngược (completeUploadExternal) chưa chắc đã xong
          ctx.checkpoint({ fileIds: ['F0'] });
          throw fail('uncertain');
        }
        return {};
      },
    });
    const item = await h.queue.submit(report(), 'c1');
    expect(item.state).toBe('uncertain');
    expect(item.resume).toEqual({ fileIds: ['F0'] });
    expect(item.nextAttemptAt).toBeUndefined();

    h.setNow(T0 + 10 * RETRY_EVERY_MS);
    await h.queue.retryDue();
    expect(h.send).toHaveBeenCalledTimes(1);

    const after = await h.queue.retryNow('rpt-1');
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(after.state).toBe('sent');
  });

  it('R36: network sau checkpoint chỉ-upload vẫn tự gửi lại như trước', async () => {
    let calls = 0;
    const h = build({
      send: async (ctx) => {
        calls += 1;
        if (calls === 1) {
          ctx.checkpoint({ fileIds: ['F0'] });
          throw fail('network');
        }
        return {};
      },
    });
    const item = await h.queue.submit(report(), 'c1');
    expect(item.state).toBe('pending');
    h.setNow(T0 + RETRY_EVERY_MS);
    await h.queue.retryDue();
    expect(h.queue.items()[0].state).toBe('sent');
  });

  describe('chống gửi trùng', () => {
    it('submit hai lần cùng report.id (tuần tự) → một mục, trả đúng mục đang có, một lần gửi', async () => {
      const h = build();
      const first = await h.queue.submit(report(), 'c1');
      const second = await h.queue.submit(report(), 'c1');
      expect(second).toBe(first);
      expect(h.queue.items()).toHaveLength(1);
      expect(h.send).toHaveBeenCalledTimes(1);
    });

    it('submit hai lần liền khi lần đầu còn đang gửi → một lần gửi', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const h = build({
        send: async () => {
          await gate;
          return { key: 'BUG-5' };
        },
      });
      const p1 = h.queue.submit(report(), 'c1');
      const p2 = h.queue.submit(report(), 'c1');
      release();
      const [a, b] = await Promise.all([p1, p2]);
      expect(h.send).toHaveBeenCalledTimes(1);
      expect(h.queue.items()).toHaveLength(1);
      expect(a.report.id).toBe(b.report.id);
      expect(h.queue.items()[0].state).toBe('sent');
    });

    it('retryDue và retryNow không bắt đầu mục đang sending', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let calls = 0;
      const h = build({
        send: async () => {
          calls += 1;
          if (calls === 1) throw fail('network');
          await gate;
          return { key: 'BUG-6' };
        },
      });
      await h.queue.submit(report(), 'c1'); // pending
      h.setNow(T0 + RETRY_EVERY_MS);
      const due = h.queue.retryDue(); // bắt đầu lần 2 (đang treo ở gate)
      await Promise.resolve();
      await h.queue.retryDue();
      const now = await h.queue.retryNow('rpt-1');
      expect(now.state).toBe('sending');
      expect(h.send).toHaveBeenCalledTimes(2);
      release();
      await due;
      expect(h.queue.items()[0].state).toBe('sent');
      expect(h.send).toHaveBeenCalledTimes(2);
    });

    it('retryNow cho id lạ → ném', async () => {
      const h = build();
      await expect(h.queue.retryNow('nope')).rejects.toThrow('nope');
    });
  });

  describe('kết nối mất (Review Focus 3)', () => {
    it('kết nối đã bị xoá → blocked connection-missing, bản báo còn nguyên, không gọi connector', async () => {
      const h = build({ connections: makeConnections([]) });
      const item = await h.queue.submit(report(), 'gone');
      expect(item.state).toBe('blocked');
      expect(item.lastError?.kind).toBe('connection-missing');
      expect(item.report.files).toHaveLength(1);
      expect(item.attempts).toBe(0);
      expect(h.send).not.toHaveBeenCalled();
    });

    it('secrets() trả null (Keychain trống) → blocked connection-missing; khôi phục xong retryNow gửi được', async () => {
      const secretsById: Record<string, ConnectorValues | null> = { c1: null };
      const connections = makeConnections([connection()], secretsById);
      const h = build({ connections });
      const item = await h.queue.submit(report(), 'c1');
      expect(item.state).toBe('blocked');
      expect(item.lastError?.kind).toBe('connection-missing');
      expect(h.send).not.toHaveBeenCalled();

      secretsById.c1 = { token: TOKEN };
      const after = await h.queue.retryNow('rpt-1');
      expect(after.state).toBe('sent');
    });

    it('loại kết nối không còn được đăng ký → cũng là connection-missing', async () => {
      const bad: StoredConnection = {
        ...connection('c9'),
        typeId: 'removed-type',
      };
      const h = build({
        connections: makeConnections([bad], { c9: { token: TOKEN } }),
      });
      const item = await h.queue.submit(report(), 'c9');
      expect(item.state).toBe('blocked');
      expect(item.lastError?.kind).toBe('connection-missing');
    });
  });

  describe('lưu bền', () => {
    it('có store: ghi QUEUE_FILE sau mỗi lần đổi trạng thái, không chứa bí mật', async () => {
      const store = makeStore();
      const h = build({ store });
      await h.queue.submit(report(), 'c1');
      const writes = store.writes.filter((w) => w.name === QUEUE_FILE);
      // pending → sending → sending (attempts) → sent
      expect(writes.length).toBeGreaterThanOrEqual(3);
      const states = writes.map(
        (w) => (JSON.parse(w.content) as { items: Array<{ state: string }> }).items[0]?.state,
      );
      expect(states).toContain('sending');
      expect(states[states.length - 1]).toBe('sent');
      for (const w of store.writes) expect(w.content).not.toContain(TOKEN);
      // lỗi connector có chứa token cũng không được ghi (message chỉ do ConnectorError soạn)
      expect(store.files.has(QUEUE_FILE)).toBe(true);
    });

    it('checkpoint được ghi ngay', async () => {
      const store = makeStore();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const h = build({
        store,
        send: async (ctx) => {
          ctx.checkpoint({ issueKey: 'BUG-7' });
          await gate;
          return { key: 'BUG-7' };
        },
      });
      const p = h.queue.submit(report(), 'c1');
      await new Promise((r) => setImmediate(r));
      expect(store.files.get(QUEUE_FILE)).toContain('BUG-7');
      release();
      await p;
    });

    it('load() đọc lại đúng mục đã ghi (pending có resume + lỗi)', async () => {
      const store = makeStore();
      let calls = 0;
      const send: SendFn = async (ctx) => {
        calls += 1;
        if (calls === 1) {
          ctx.checkpoint({ issueKey: 'BUG-8' });
          throw fail('network');
        }
        return { key: 'BUG-8' };
      };
      const h1 = build({ store, send });
      await h1.queue.submit(report(), 'c1');

      const h2 = build({ store, send });
      await h2.queue.load();
      const [item] = h2.queue.items();
      expect(item.state).toBe('pending');
      expect(item.resume).toEqual({ issueKey: 'BUG-8' });
      expect(item.report.id).toBe('rpt-1');
      expect(item.nextAttemptAt).toBe(T0 + RETRY_EVERY_MS);
      expect(item.attempts).toBe(1);

      h2.setNow(T0 + RETRY_EVERY_MS);
      await h2.queue.retryDue();
      expect(h2.contexts[0].resume).toEqual({ issueKey: 'BUG-8' });
      expect(h2.queue.items()[0].state).toBe('sent');
    });

    it('R25: mục sent cũ hơn 24 giờ bị bỏ khi load, mới hơn thì giữ', async () => {
      const store = makeStore();
      const h1 = build({ store });
      await h1.queue.submit(report('old'), 'c1');
      h1.setNow(T0 + 23 * 3600_000);
      await h1.queue.submit(report('fresh'), 'c1');

      const h2 = build({ store });
      h2.setNow(T0 + 25 * 3600_000); // old: 25 h, fresh: 2 h
      await h2.queue.load();
      expect(h2.queue.items().map((i) => i.report.id)).toEqual(['fresh']);
    });

    it('R26 + R36: sending lúc load → pending chỉ khi resume.committed, ngược lại uncertain', async () => {
      const store = makeStore();
      const mk = (id: string, resume?: Record<string, unknown>) => ({
        report: report(id),
        connectionId: 'c1',
        state: 'sending',
        attempts: 1,
        ...(resume ? { resume } : {}),
      });
      store.files.set(
        QUEUE_FILE,
        JSON.stringify({
          v: 1,
          items: [
            mk('with', { issueKey: 'K-1', committed: true }),
            mk('upload', { fileIds: ['F0'] }),
            mk('without'),
          ],
        }),
      );
      const h = build({ store });
      await h.queue.load();
      const byId = Object.fromEntries(h.queue.items().map((i) => [i.report.id, i]));
      expect(byId.with.state).toBe('pending');
      expect(byId.upload.state).toBe('uncertain');
      expect(byId.without.state).toBe('uncertain');

      // pending không có nextAttemptAt ⇒ đến hạn ngay; uncertain thì không tự gửi
      await h.queue.retryDue();
      expect(h.send).toHaveBeenCalledTimes(1);
      expect(h.queue.items().find((i) => i.report.id === 'with')?.state).toBe('sent');
      expect(h.queue.items().find((i) => i.report.id === 'upload')?.state).toBe('uncertain');
      expect(h.queue.items().find((i) => i.report.id === 'without')?.state).toBe('uncertain');
    });

    it('file hỏng → load không ném, bắt đầu rỗng, giữ file hỏng đổi tên', async () => {
      const store = makeStore();
      store.files.set(QUEUE_FILE, '{not json');
      const h = build({ store });
      await expect(h.queue.load()).resolves.toBeUndefined();
      expect(h.queue.items()).toEqual([]);
      expect(store.files.has(QUEUE_FILE)).toBe(false);
      const corrupt = [...store.files.entries()].find(([n]) => n !== QUEUE_FILE);
      expect(corrupt?.[0]).toMatch(/^report-queue\.corrupt/);
      expect(corrupt?.[1]).toBe('{not json');
      // hàng đợi vẫn dùng được
      await h.queue.submit(report(), 'c1');
      expect(h.queue.items()).toHaveLength(1);
    });

    it('phần tử sai hình dạng bị bỏ, phần tử đúng giữ', async () => {
      const store = makeStore();
      store.files.set(
        QUEUE_FILE,
        JSON.stringify({
          v: 1,
          items: [
            null,
            {
              report: { nope: true },
              connectionId: 'c1',
              state: 'pending',
              attempts: 0,
            },
            {
              report: report('ok'),
              connectionId: 'c1',
              state: 'blocked',
              attempts: 1,
            },
            {
              report: report('bad-state'),
              connectionId: 'c1',
              state: 'zzz',
              attempts: 1,
            },
          ],
        }),
      );
      const h = build({ store });
      await h.queue.load();
      expect(h.queue.items().map((i) => i.report.id)).toEqual(['ok']);
    });

    const oldFile = (): string =>
      JSON.stringify({
        v: 1,
        items: [{ report: report('old'), connectionId: 'c1', state: 'blocked', attempts: 1 }],
      });
    const idsOf = (store: { files: Map<string, string> }): string[] =>
      (
        JSON.parse(store.files.get(QUEUE_FILE) as string) as {
          items: Array<{ report: { id: string } }>;
        }
      ).items
        .map((i) => i.report.id)
        .sort();

    it('đọc lỗi → submit KHÔNG ghi đè file gốc; kho hồi lại → lần ghi sau gộp cũ + mới', async () => {
      const store = makeStore();
      const original = oldFile();
      store.files.set(QUEUE_FILE, original);
      const realList = store.list;
      store.list = async () => {
        throw new Error('io');
      };
      const h = build({ store });
      await expect(h.queue.load()).resolves.toBeUndefined();
      const item = await h.queue.submit(report('new'), 'c1');
      expect(item.state).toBe('sent'); // vẫn chạy trong RAM
      expect(store.files.get(QUEUE_FILE)).toBe(original);
      expect(store.writes.filter((w) => w.name === QUEUE_FILE)).toHaveLength(0);

      store.list = realList;
      await h.queue.submit(report('new2'), 'c1');
      expect(idsOf(store)).toEqual(['new', 'new2', 'old']);
      expect(
        h.queue
          .items()
          .map((i) => i.report.id)
          .sort(),
      ).toEqual(['new', 'new2', 'old']);
    });

    it('submit trước khi load xong → file cuối cùng có cả cũ lẫn mới', async () => {
      const store = makeStore();
      store.files.set(QUEUE_FILE, oldFile());
      const realList = store.list;
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      store.list = async () => {
        await gate;
        return realList();
      };
      const h = build({ store });
      const loading = h.queue.load();
      const submitting = h.queue.submit(report('new'), 'c1');
      await new Promise((r) => setImmediate(r));
      expect(store.writes.filter((w) => w.name === QUEUE_FILE)).toHaveLength(0);
      release();
      await Promise.all([loading, submitting]);
      expect(idsOf(store)).toEqual(['new', 'old']);
    });

    it('load() gọi lại là idempotent: không làm sống lại mục đã discard', async () => {
      const store = makeStore();
      store.files.set(QUEUE_FILE, oldFile());
      const h = build({ store });
      await h.queue.load();
      await h.queue.load();
      expect(h.queue.items()).toHaveLength(1);
      await h.queue.discard('old');
      await h.queue.load();
      expect(h.queue.items()).toEqual([]);
    });

    describe('kho treo (M4): mỗi lời gọi kho có trần 5 s', () => {
      const hanging = () => new Promise<never>(() => undefined);
      afterEach(() => {
        jest.useRealTimers();
      });

      it.each([
        ['list()', (s: ReturnType<typeof makeStore>) => (s.list = hanging)],
        [
          'read()',
          (s: ReturnType<typeof makeStore>) => {
            s.files.set(QUEUE_FILE, JSON.stringify({ v: 1, items: [] }));
            s.read = hanging;
          },
        ],
      ])(
        '%s treo ⇒ `load()` xong đúng sau 5 s; hàng đợi thành RAM-only (báo người nghe), không đụng kho nữa; gửi vẫn chạy',
        async (_case, stall) => {
          jest.useFakeTimers();
          const store = makeStore();
          stall(store);
          const write = jest.spyOn(store, 'write');
          const h = build({ store });
          const listener = jest.fn();
          h.queue.subscribe(listener);
          let loaded = false;
          const p = h.queue.load().then(() => {
            loaded = true;
          });

          await jest.advanceTimersByTimeAsync(4999);
          expect(loaded).toBe(false);
          expect(h.queue.ramOnly()).toBe(false);
          await jest.advanceTimersByTimeAsync(1);
          await p;

          expect(loaded).toBe(true);
          expect(h.queue.ramOnly()).toBe(true);
          expect(listener).toHaveBeenCalled();
          await h.queue.submit(report(), 'c1');
          expect(h.queue.items()[0].state).toBe('sent');
          expect(write).not.toHaveBeenCalled();
        },
      );

      it('write() treo ⇒ gửi vẫn xong (mỗi lần chờ ghi tối đa 5 s); ghi chậm KHÔNG làm kho thành "treo", các lần ghi sau xếp hàng sau lần đang bay (R46)', async () => {
        jest.useFakeTimers();
        const store = makeStore();
        const write = jest.spyOn(store, 'write').mockImplementation(hanging);
        const h = build({ store });
        await h.queue.load();

        let item: QueuedReport | undefined;
        const p = h.queue.submit(report(), 'c1').then((i) => {
          item = i;
        });
        await jest.advanceTimersByTimeAsync(20_000);
        await p;

        expect(item?.state).toBe('sent');
        expect(h.queue.ramOnly()).toBe(false);
        /* Chuỗi ghi tuần tự đợi lần ghi THẬT — lần sau chưa chạy khi lần trước chưa xong. */
        expect(write).toHaveBeenCalledTimes(1);
      });

      it('lần ghi đầu mất > 5 s rồi mới xong; trong lúc đó mục đi pending → sending → sent ⇒ file cuối cùng ghi `sent`, hàng đợi mới đọc file đó không gửi lại (N1, R46)', async () => {
        jest.useFakeTimers();
        const store = makeStore();
        const realWrite = store.write;
        let slow = true;
        const write = jest.spyOn(store, 'write').mockImplementation((name, content) => {
          if (!slow) return realWrite(name, content);
          slow = false;
          /* Lần ghi native cập bến muộn, mang ảnh chụp CŨ của lúc nó được gọi. */
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              void realWrite(name, content).then(resolve);
            }, 90_000);
          });
        });
        let calls = 0;
        const h = build({
          store,
          send: async () => {
            calls += 1;
            if (calls === 1) throw fail('network');
            return { key: 'BUG-1' };
          },
        });
        await h.queue.load();

        const submitted = h.queue.submit(report(), 'c1');
        await jest.advanceTimersByTimeAsync(20_000);
        expect((await submitted).state).toBe('pending');
        h.setNow(T0 + RETRY_EVERY_MS);
        const retried = h.queue.retryDue();
        await jest.advanceTimersByTimeAsync(20_000);
        await retried;
        expect(h.queue.items()[0].state).toBe('sent');
        /* Lần ghi đầu vẫn đang bay: file chưa có gì. */
        expect(store.files.has(QUEUE_FILE)).toBe(false);

        await jest.advanceTimersByTimeAsync(60_000);

        expect(h.queue.ramOnly()).toBe(false);
        expect(write.mock.calls.length).toBeGreaterThan(1);
        const saved = JSON.parse(store.files.get(QUEUE_FILE) as string) as {
          items: QueuedReport[];
        };
        expect(saved.items.map((i) => i.state)).toEqual(['sent']);

        jest.useRealTimers();
        const fresh = build({ store, send: async () => ({ key: 'BUG-2' }) });
        fresh.setNow(T0 + 10 * RETRY_EVERY_MS);
        await fresh.queue.load();
        await fresh.queue.retryDue();
        expect(fresh.send).not.toHaveBeenCalled();
        expect(fresh.queue.items()[0].state).toBe('sent');
      });

      it('`ramOnly()`: không có store ⇒ true; kho đọc ghi bình thường ⇒ false', async () => {
        expect(build().queue.ramOnly()).toBe(true);
        const h = build({ store: makeStore() });
        await h.queue.load();
        await h.queue.submit(report(), 'c1');
        expect(h.queue.ramOnly()).toBe(false);
      });
    });

    it('ghi lỗi → hàng đợi vẫn chạy trong RAM', async () => {
      const store = makeStore();
      store.write = async () => {
        throw new Error('disk full');
      };
      const h = build({ store });
      await h.queue.load();
      const item = await h.queue.submit(report(), 'c1');
      expect(item.state).toBe('sent');
    });

    it('không có store: chỉ giữ trong RAM', async () => {
      const h = build();
      await h.queue.load();
      await h.queue.submit(report(), 'c1');
      expect(h.queue.items()).toHaveLength(1);
    });

    it('report-queue.json không bị dọn phiên đụng tới', () => {
      const files: LogStoreFile[] = [
        { name: QUEUE_FILE, modifiedAt: 0 },
        { name: 'session-1.json', modifiedAt: 0 },
      ];
      const doomed = planPrune(files, {
        now: 10 * 3600_000 * 1000,
        ttlMs: 1,
        maxSessions: 1,
        current: 'session-9.json',
      });
      expect(doomed).toEqual(['session-1.json']);
    });
  });

  describe('discard / subscribe / items', () => {
    it('discard xoá mục, ghi lại file và báo subscriber', async () => {
      const store = makeStore();
      const h = build({
        store,
        send: async () => {
          throw fail('auth');
        },
      });
      await h.queue.submit(report(), 'c1');
      const l = jest.fn();
      const off = h.queue.subscribe(l);
      await h.queue.discard('rpt-1');
      expect(h.queue.items()).toEqual([]);
      expect(l).toHaveBeenCalled();
      expect(JSON.parse(store.files.get(QUEUE_FILE) as string).items).toEqual([]);
      l.mockClear();
      off();
      await h.queue.discard('rpt-1'); // id lạ: không ném
      expect(l).not.toHaveBeenCalled();
    });

    it('discard khi đang gửi: kết quả về sau không đưa mục trở lại', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const h = build({
        send: async () => {
          await gate;
          return { key: 'BUG-10' };
        },
      });
      const p = h.queue.submit(report(), 'c1');
      await new Promise((r) => setImmediate(r));
      await h.queue.discard('rpt-1');
      release();
      await p;
      expect(h.queue.items()).toEqual([]);
    });

    it('items() trả cùng tham chiếu khi không đổi (an toàn cho useSyncExternalStore)', async () => {
      const h = build();
      await h.queue.submit(report(), 'c1');
      expect(h.queue.items()).toBe(h.queue.items());
    });

    it('subscribe được gọi khi trạng thái đổi', async () => {
      const h = build();
      const l = jest.fn();
      h.queue.subscribe(l);
      await h.queue.submit(report(), 'c1');
      expect(l).toHaveBeenCalled();
    });
  });

  describe('file tạm theo từng bản báo (I2, R44)', () => {
    it('hai bản báo gửi lại SONG SONG, chung một thư mục tạm ⇒ mỗi ticket nhận đúng nội dung của bản mình', async () => {
      /* Thư mục tạm chung của app (như `CacheDir` của example): ghi cùng tên là đè. */
      const dir = new Map<string, string>();
      let release: () => void = () => undefined;
      const bothWritten = new Promise<void>((resolve) => {
        release = resolve;
      });
      const writeTempFile = jest.fn(async (name: string, content: string) => {
        dir.set(name, content);
        if (writeTempFile.mock.calls.length === 2) release();
        return `file:///cache/${name}`;
      });
      const received: Record<string, { content: string | undefined; name: string }> = {};
      const send = jest.fn(
        async (r: BugReport, _v: ConnectorValues, _s: ConnectorValues, ctx: SendContext) => {
          const part = await ctx.uploadPart(r.files[0]);
          /* Native đọc file lúc request bay — tới lúc đó bản kia cũng đã ghi file tạm của nó. */
          await bothWritten;
          const uri = 'uri' in part ? part.uri : '';
          received[r.id] = { content: dir.get(uri.replace('file:///cache/', '')), name: part.name };
          return { key: r.id };
        },
      );
      const store = makeStore();
      const pending = (id: string, content: string) => ({
        report: report(id, { files: [{ name: 'errors.txt', mimeType: 'text/plain', content }] }),
        connectionId: 'c1',
        state: 'pending',
        attempts: 1,
        nextAttemptAt: 0,
      });
      store.files.set(
        QUEUE_FILE,
        JSON.stringify({ v: 1, items: [pending('rpt-A', 'lỗi của A'), pending('rpt-B', 'lỗi của B')] }),
      );
      const queue = createSendQueue({
        connections: makeConnections([connection()]),
        connectorTypes: [{ id: 'fake', send } as unknown as ConnectorType],
        makeSendContext: (_locale, resume, checkpoint, reportId) =>
          ({
            fetch: jest.fn(),
            locale: 'vi',
            timeoutMs: 30_000,
            resume,
            checkpoint,
            uploadPart: makeUploadPart({ writeTempFile, reportId }),
          }) as unknown as SendContext,
        store,
        now: () => T0,
      });

      await queue.load();
      await queue.retryDue();

      expect(send).toHaveBeenCalledTimes(2);
      expect(received).toEqual({
        'rpt-A': { content: 'lỗi của A', name: 'errors.txt' },
        'rpt-B': { content: 'lỗi của B', name: 'errors.txt' },
      });
      expect(writeTempFile.mock.calls.map(([name]) => name).sort()).toEqual([
        'rpt-A-errors.txt',
        'rpt-B-errors.txt',
      ]);
    });
  });
});
