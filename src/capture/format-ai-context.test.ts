import { AI_CONTEXT_MAX_CHARS, formatAiContext } from './format-ai-context';
import { formatDateTime, formatTime } from './format-log';
import type { ConsoleEntry, LogEntry, MarkerEntry, NetworkEntry } from './log-entry';
import type { RecordedAction } from './recorded-action';
import { REDACTED, setExtraSecretKeys } from './redact';

/*
  Mốc dựng bằng constructor LOCAL như `format-log.test.ts`: `formatTime`/`formatDateTime` đọc giờ
  máy, nên test không phụ thuộc múi giờ của CI.
*/
const BASE = new Date(2026, 8, 24, 14, 0, 0, 0).getTime();
const at = (sec: number) => BASE + sec * 1000;
const GENERATED = at(600);

let nextId = 1;

const con = (sec: number, level: ConsoleEntry['level'], text: string, over: Partial<ConsoleEntry> = {}): ConsoleEntry => ({
  id: nextId++,
  kind: 'console',
  at: at(sec),
  level,
  text,
  ...over,
});

const net = (sec: number, over: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id: nextId++,
  kind: 'network',
  at: at(sec),
  method: 'GET',
  url: 'https://api.test/items',
  status: 200,
  durationMs: 120,
  ...over,
});

const marker = (sec: number, type: MarkerEntry['type'], label: string): MarkerEntry => ({
  id: nextId++,
  kind: 'marker',
  at: at(sec),
  type,
  label,
});

const action = (sec: number, kind: RecordedAction['kind'], label?: string): RecordedAction => ({
  at: at(sec),
  kind,
  label,
  source: 'text',
});

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl';

/** Nội dung của một section `## …` (tới section kế tiếp hoặc hết chuỗi). */
const section = (md: string, title: string): string => {
  const start = md.indexOf(`## ${title}`);
  if (start === -1) throw new Error(`không có section "${title}"`);
  const next = md.indexOf('\n## ', start + 3);
  return next === -1 ? md.slice(start) : md.slice(start, next);
};

beforeEach(() => {
  nextId = 1;
});

afterEach(() => {
  setExtraSecretKeys([]);
});

describe('formatAiContext', () => {
  it('đầu khối: tiêu đề, MỘT dòng dặn agent, thông tin app/máy/phiên và số đếm', () => {
    const md = formatAiContext(
      [net(1), net(2, { status: 500 }), con(3, 'info', 'hi'), marker(4, 'screen', 'Home')],
      {
        generatedAt: GENERATED,
        build: 'UAT · 1.0.2',
        info: { appVersion: '1.0.2 (58)', env: 'UAT', device: 'Pixel 8', os: 'Android 15', user: '***812' },
        sessionStartedAt: BASE,
      },
    );
    const lines = md.split('\n');

    expect(lines[0]).toBe('# Debug context from a React Native app');
    expect(lines[1]).toBe('');
    expect(lines[2]).toMatch(/^> \*\*For the coding agent:\*\* .*root cause.*`<redacted>`/);
    expect(lines[3]).toBe('');
    expect(section(md, 'App and session')).toBe(
      [
        '## App and session',
        '',
        `- Generated: ${formatDateTime(GENERATED)}`,
        '- Build: UAT · 1.0.2',
        '- App: 1.0.2 (58)',
        '- Env: UAT',
        '- Device: Pixel 8',
        '- OS: Android 15',
        '- User: ***812',
        `- Session: ${formatDateTime(BASE)}`,
        '- Captured: 3 entries · 1 error · 0 slow requests (≥ 3000 ms)',
        '',
      ].join('\n'),
    );
  });

  it('các section theo thứ tự cố định; không có gì ⇒ "_None captured._", cùng đầu vào ra cùng chuỗi', () => {
    const md = formatAiContext([], { generatedAt: GENERATED });

    const titles = md.split('\n').filter((l) => l.startsWith('## '));
    expect(titles).toEqual([
      '## App and session',
      '## Uncaught errors and unhandled rejections',
      '## Recent steps',
      '## Failed and slow requests',
      '## Console errors and warnings',
    ]);
    expect(md).toContain('- Captured: 0 entries · 0 errors · 0 slow requests (≥ 3000 ms)');
    expect(md.match(/_None captured\._/g)).toHaveLength(4);
    expect(md).not.toContain('Truncated');
    expect(formatAiContext([], { generatedAt: GENERATED })).toBe(md);
  });

  /* File phiên trên đĩa là dữ liệu ngoài: `parseSession` chỉ kiểm trường bắt buộc, `screen`/`error`
     có thể sai kiểu. Một file hỏng không được làm hỏng cả lượt chép. */
  it('`screen` / `error` sai kiểu (file phiên hỏng) ⇒ bỏ qua trường đó, không ném', () => {
    const md = formatAiContext(
      [
        con(1, 'error', 'Error: x', { uncaught: true, screen: 42 as unknown as string }),
        net(2, { status: undefined, error: { code: 1 } as unknown as string, screen: null as unknown as string }),
      ],
      { generatedAt: GENERATED },
    );

    expect(md).toContain(`### UNCAUGHT at ${formatTime(at(1))}\n`);
    expect(md).toContain('### `GET https://api.test/items` → pending · 120 ms');
  });

  it('`source` (phiên trước) đi vào đầu khối', () => {
    const md = formatAiContext([], { generatedAt: GENERATED, source: 'previous session' });

    expect(md).toContain('- Source: previous session');
  });

  it('lỗi không ai bắt và promise reject: nhãn FATAL / UNCAUGHT / UNHANDLED REJECTION, stack trong khối rào, không lặp lại ở section console', () => {
    const fatal = con(10, 'error', "TypeError: Cannot read property 'id' of undefined\n    at Checkout (index.bundle:12:3)", {
      uncaught: true,
      fatal: true,
      screen: 'Checkout',
    });
    const rejection = con(20, 'error', 'Uncaught (in promise, id: 0): Error: boom\n    at load (index.bundle:9:1)', {
      uncaught: true,
    });
    const uncaught = con(30, 'error', 'Error: plain', { uncaught: true });

    const md = formatAiContext([fatal, rejection, uncaught], { generatedAt: GENERATED });
    const errors = section(md, 'Uncaught errors and unhandled rejections');

    expect(errors).toContain(`### FATAL at ${formatTime(at(10))} · screen \`Checkout\``);
    expect(errors).toContain(
      "```text\nTypeError: Cannot read property 'id' of undefined\n    at Checkout (index.bundle:12:3)\n```",
    );
    expect(errors).toContain(`### UNHANDLED REJECTION at ${formatTime(at(20))}`);
    expect(errors).toContain(`### UNCAUGHT at ${formatTime(at(30))}`);
    /* Cũ → mới trong section. */
    expect(errors.indexOf('FATAL')).toBeLessThan(errors.indexOf('UNHANDLED REJECTION'));
    expect(errors.indexOf('UNHANDLED REJECTION')).toBeLessThan(errors.indexOf('### UNCAUGHT'));
    expect(section(md, 'Console errors and warnings')).toContain('_None captured._');
  });

  it('lỗi lặp y hệt gộp thành một mục `×N`, giờ của lần mới nhất', () => {
    const md = formatAiContext(
      [
        con(1, 'error', 'Error: loop', { uncaught: true }),
        con(2, 'error', 'Error: loop', { uncaught: true }),
        con(3, 'error', 'Error: loop', { uncaught: true }),
      ],
      { generatedAt: GENERATED },
    );
    const errors = section(md, 'Uncaught errors and unhandled rejections');

    expect(errors.match(/### UNCAUGHT/g)).toHaveLength(1);
    expect(errors).toContain(`### UNCAUGHT at ${formatTime(at(3))} · ×3`);
  });

  it('request lỗi (≥ 400, lỗi vận chuyển) và request chậm: method, URL đã che, kết cục, thời lượng; bỏ request ổn, đang chờ, bị huỷ', () => {
    const md = formatAiContext(
      [
        net(1, { url: 'https://api.test/ok' }),
        net(2, { method: 'POST', url: 'https://api.test/orders?access_token=raw-query-token&page=2', status: 500, durationMs: 812, screen: 'Checkout' }),
        net(3, { url: 'https://api.test/profile', status: undefined, durationMs: 30000, error: 'timeout' }),
        net(4, { url: 'https://api.test/report', status: 200, durationMs: 4500 }),
        net(5, { url: 'https://api.test/pending', status: undefined, durationMs: undefined }),
        net(6, { url: 'https://api.test/aborted', status: undefined, durationMs: 10, error: 'abort' }),
      ],
      { generatedAt: GENERATED },
    );
    const requests = section(md, 'Failed and slow requests');

    expect(requests).toContain(
      `### \`POST https://api.test/orders?access_token=${REDACTED}&page=2\` → 500 · 812 ms`,
    );
    expect(requests).toContain(`At ${formatTime(at(2))} · screen \`Checkout\``);
    expect(requests).toContain('### `GET https://api.test/profile` → timeout · 30000 ms');
    expect(requests).toContain('### `GET https://api.test/report` → 200 · 4500 ms');
    expect(requests).toContain(`At ${formatTime(at(4))} · slow`);
    expect(requests.match(/### /g)).toHaveLength(3);
    expect(requests).not.toContain('/ok');
    expect(requests).not.toContain('/pending');
    expect(requests).not.toContain('/aborted');
    expect(md).not.toContain('raw-query-token');
    /* Cũ → mới. */
    expect(requests.indexOf('/orders')).toBeLessThan(requests.indexOf('/profile'));
    expect(requests.indexOf('/profile')).toBeLessThan(requests.indexOf('/report'));
  });

  it('request lặp y hệt (cùng method, URL, kết cục) gộp một mục `×N`, giữ thân của lần mới nhất', () => {
    const md = formatAiContext(
      [
        net(1, { url: 'https://api.test/poll', status: 503, responseBody: '{"try":1}' }),
        net(2, { url: 'https://api.test/poll', status: 503, responseBody: '{"try":2}' }),
      ],
      { generatedAt: GENERATED },
    );
    const requests = section(md, 'Failed and slow requests');

    expect(requests.match(/### /g)).toHaveLength(1);
    expect(requests).toContain(`At ${formatTime(at(2))} · ×2`);
    expect(requests).toContain('"try": 2');
    expect(requests).not.toContain('"try": 1');
  });

  it('header và thân request/response: che bí mật, JSON dàn đẹp trong khối ```json, thân không ghi được thì nói lý do', () => {
    const md = formatAiContext(
      [
        net(1, {
          method: 'POST',
          url: 'https://api.test/login',
          status: 401,
          requestHeaders: { Authorization: 'Bearer raw-header-token-1234567890', 'Content-Type': 'application/json' },
          requestBody: '{"username":"qa","password":"hunter2"}',
          responseBody: '{"error":"expired","accessToken":"raw-response-token"}',
        }),
        net(2, { method: 'POST', url: 'https://api.test/upload', status: 413, requestBodySkipped: 'formData' }),
      ],
      { generatedAt: GENERATED },
    );
    const requests = section(md, 'Failed and slow requests');

    expect(requests).toContain(`Request headers: \`Authorization: ${REDACTED}\` · \`Content-Type: application/json\``);
    expect(requests).toContain(
      `Request body:\n\n\`\`\`json\n{\n  "username": "qa",\n  "password": "${REDACTED}"\n}\n\`\`\``,
    );
    expect(requests).toContain(
      `Response body:\n\n\`\`\`json\n{\n  "error": "expired",\n  "accessToken": "${REDACTED}"\n}\n\`\`\``,
    );
    expect(requests).toContain('Request body: not captured (formData)');
    expect(md).not.toContain('hunter2');
    expect(md).not.toContain('raw-header-token');
    expect(md).not.toContain('raw-response-token');
  });

  it('thân dài bị cắt và ghi rõ; thân bị cắt từ lúc thu cũng ghi `(truncated)`; dấu ``` trong thân không phá khối rào', () => {
    const long = `{"items":"${'x'.repeat(5000)}"}`;
    const md = formatAiContext(
      [
        net(1, { url: 'https://api.test/big', status: 500, responseBody: long }),
        net(2, { url: 'https://api.test/cut', status: 500, responseBody: '{"a":1,"b…+20', responseTruncated: true }),
        net(3, { url: 'https://api.test/md', status: 500, responseBody: 'see ```code``` here' }),
      ],
      { generatedAt: GENERATED },
    );
    const requests = section(md, 'Failed and slow requests');

    expect(requests).toContain('Response body (truncated):\n\n```json\n{\n  "items": "xxx');
    expect(requests).toMatch(/… \[\d+ more characters cut\]\n```/);
    expect(requests.length).toBeLessThan(long.length);
    expect(requests).toContain('/cut` → 500');
    expect(requests).toMatch(/\/cut[\s\S]*Response body \(truncated\):/);
    expect(requests).toContain('````text\nsee ```code``` here\n````');
  });

  it('chữ console, câu lỗi và khoá riêng của app (`redactKeys`) đều qua lớp che; không bao giờ có lệnh cURL', () => {
    setExtraSecretKeys(['customerRef']);
    const md = formatAiContext(
      [
        con(1, 'error', `login failed {"customerRef":"C-778899","jwt":"x"} ${JWT}`),
        con(2, 'error', `Error: bad token ${JWT}`, { uncaught: true }),
        net(3, {
          method: 'POST',
          url: 'https://api.test/pay',
          status: 500,
          requestHeaders: { Authorization: 'Bearer raw-header-token-1234567890' },
          requestBody: '{"customer_ref":"C-112233","amount":5}',
        }),
      ],
      { generatedAt: GENERATED },
    );

    expect(md).not.toContain(JWT);
    expect(md).not.toContain('C-778899');
    expect(md).not.toContain('C-112233');
    expect(md).toContain('"amount": 5');
    expect(md.toLowerCase()).not.toContain('curl');
    expect(md).not.toContain('raw-header-token');
  });

  it('các bước gần đây: thao tác + mốc màn + mốc ⚑ + request + lỗi theo giờ; nhãn nhập chỉ là nhãn ô (che dữ liệu cá nhân); chạm lặp gộp `×N`', () => {
    const md = formatAiContext(
      [
        marker(1, 'screen', 'Home'),
        net(5, { method: 'POST', url: 'https://api.test/orders/1234567?x=1', status: 500, durationMs: 812 }),
        con(6, 'error', 'Failed to load cart\n    at stack'),
        con(7, 'warn', 'not a step'),
        marker(8, 'user', '2'),
      ],
      {
        generatedAt: GENERATED,
        actions: [
          action(2, 'tap', 'Checkout'),
          action(3, 'tap', 'Checkout'),
          action(3.5, 'tap', 'Checkout'),
          action(4, 'input', 'Email qa.lan@khachhang.vn'),
          action(9, 'back'),
        ],
      },
    );
    const steps = section(md, 'Recent steps');
    const pad = (kind: string) => kind.padEnd(10);

    expect(steps).toContain(
      [
        '```text',
        `${formatTime(at(1))}  ${pad('screen')} Home`,
        `${formatTime(at(2))}  ${pad('tap')} "Checkout" ×3`,
        `${formatTime(at(4))}  ${pad('input')} "Email •••.vn"`,
        `${formatTime(at(5))}  ${pad('request')} POST /orders/•••567 → 500 812ms`,
        `${formatTime(at(6))}  ${pad('error')} Failed to load cart`,
        `${formatTime(at(8))}  ${pad('mark')} #2`,
        `${formatTime(at(9))}  back`,
        '```',
      ].join('\n'),
    );
  });

  it('console: lỗi và cảnh báo theo giờ, bỏ info/debug, dòng sau thụt lề, dòng y hệt gộp `×N` (giờ của lần mới nhất)', () => {
    const md = formatAiContext(
      [
        con(1, 'warn', 'VirtualizedList: slow'),
        con(2, 'warn', 'VirtualizedList: slow'),
        con(3, 'info', 'just info'),
        con(4, 'debug', 'just debug'),
        con(5, 'error', 'Failed to load cart\n  {"code": 42}'),
      ],
      { generatedAt: GENERATED },
    );
    const consoleSection = section(md, 'Console errors and warnings');

    expect(consoleSection).toContain(
      [
        '```text',
        `${formatTime(at(2))}  WARN   VirtualizedList: slow ×2`,
        `${formatTime(at(5))}  ERROR  Failed to load cart`,
        '    {"code": 42}',
        '```',
      ].join('\n'),
    );
    expect(md).not.toContain('just info');
    expect(md).not.toContain('just debug');
  });

  it('trần kích thước: không vượt `maxChars`, giữ lỗi nặng nhất dù cũ, giữ request mới nhất, bỏ request cũ nhất và ghi rõ đã cắt', () => {
    const body = JSON.stringify({ data: 'y'.repeat(1900) });
    const entries: LogEntry[] = [
      con(0, 'error', 'TypeError: the oldest fatal', { uncaught: true, fatal: true }),
      ...Array.from({ length: 80 }, (_, i) =>
        net(10 + i, {
          method: 'POST',
          url: `https://api.test/r${i}`,
          status: 500,
          requestBody: body,
          responseBody: body,
        }),
      ),
      ...Array.from({ length: 60 }, (_, i) => con(100 + i, 'warn', `warning number ${i} ${'w'.repeat(300)}`)),
    ];

    const md = formatAiContext(entries, { generatedAt: GENERATED });

    expect(md.length).toBeLessThanOrEqual(AI_CONTEXT_MAX_CHARS);
    expect(md).toContain('TypeError: the oldest fatal');
    expect(md).toContain('`POST https://api.test/r79`');
    expect(md).not.toContain('`POST https://api.test/r0`');
    expect(md).toMatch(/- Truncated: .*most severe and most recent.*40000 characters/);
    expect(section(md, 'Failed and slow requests')).toMatch(/_\d+ more requests not included\._/);
    expect(section(md, 'Console errors and warnings')).toMatch(/_\d+ more console lines not included\._/);
  });

  it('`maxChars` nhỏ: vẫn không vượt trần; mục không vừa thì rút gọn (bỏ header/thân) trước khi bỏ hẳn', () => {
    const body = JSON.stringify({ data: 'z'.repeat(3000) });
    const md = formatAiContext(
      [net(1, { method: 'POST', url: 'https://api.test/only', status: 500, requestBody: body, responseBody: body })],
      { generatedAt: GENERATED, maxChars: 2500 },
    );

    expect(md.length).toBeLessThanOrEqual(2500);
    expect(md).toContain('### `POST https://api.test/only` → 500');
    expect(md).toContain('_Headers and bodies left out to stay under the size limit._');
    expect(md).toContain('- Truncated:');
  });
});
