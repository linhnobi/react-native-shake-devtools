import { errorReportFileName, formatErrorReport } from './format-error-report';
import type { ConsoleEntry, LogEntry, NetworkEntry } from './log-entry';
import { REDACTED } from './redact';

/* Dựng mốc bằng constructor giờ ĐỊA PHƯƠNG — test không phụ thuộc múi giờ của máy chạy CI. */
const AT = new Date(2026, 8, 24, 14, 26, 40, 123).getTime();

const con = (id: number, level: ConsoleEntry['level'], text: string): ConsoleEntry => ({
  id,
  kind: 'console',
  at: AT,
  level,
  text,
});

const net = (id: number, over: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id,
  kind: 'network',
  at: AT,
  method: 'POST',
  url: 'https://api.test/user',
  ...over,
});

const META = { generatedAt: AT, build: 'UAT · 1.0.2' };

describe('formatErrorReport', () => {
  it('chỉ lấy dòng lỗi, bỏ dòng thường', () => {
    const entries: LogEntry[] = [
      con(1, 'info', 'hello'),
      net(2, { status: 200, url: 'https://api.test/ok' }),
      net(3, { status: 500, url: 'https://api.test/broken' }),
    ];
    const out = formatErrorReport(entries, META);

    expect(out).toContain('https://api.test/broken → 500');
    expect(out).not.toContain('https://api.test/ok');
    expect(out).not.toContain('hello');
  });

  it('đầu file có bản build và đếm `N of M`', () => {
    const out = formatErrorReport([con(1, 'error', 'x'), con(2, 'info', 'y')], META);

    expect(out).toContain('Build     : UAT · 1.0.2');
    expect(out).toContain('Errors    : 1 of 2 captured entries');
    expect(out).toMatch(/Generated : 2026-09-24 14:26:40 [+-]\d{2}:\d{2}/);
  });

  /* File rời máy ⇒ cùng nhóm "đi tới người khác" với nút Chia sẻ trong bảng chính sách redact.ts. */
  it('header `Authorization` bị che', () => {
    const out = formatErrorReport(
      [net(1, { status: 401, requestHeaders: { Authorization: 'Bearer secret-abc' } })],
      META,
    );

    expect(out).toContain('Authorization: <redacted>');
    expect(out).not.toContain('secret-abc');
  });

  it('khoá `password` trong thân request bị che', () => {
    const out = formatErrorReport(
      [net(1, { status: 400, requestBody: '{"username":"a","password":"123456"}' })],
      META,
    );

    expect(out).toContain('"password": "<redacted>"');
    expect(out).not.toContain('123456');
  });

  it('JSON hợp lệ được dàn đẹp; thân bị cắt vẫn thụt lề và ghi `(truncated)`', () => {
    const out = formatErrorReport(
      [
        net(1, { status: 500, responseBody: '{"code":"E1","detail":"x"}' }),
        net(2, {
          status: 500,
          responseBody: '{"code":"E2","detail":"xxxx…+120',
          responseTruncated: true,
        }),
      ],
      META,
    );

    expect(out).toContain('    {\n      "code": "E1",');
    /* 10/10/2026: thân bị cắt không còn nén một dòng — thụt lề theo ngoặc/phẩy (`formatJsonLenient`). */
    expect(out).toContain('Response body (truncated):\n    {\n      "code": "E2",\n      "detail": "xxxx…+120');
  });

  it('dòng `console.error` in mức + nội dung', () => {
    const out = formatErrorReport([con(1, 'error', 'TypeError: boom')], META);

    expect(out).toContain('#1  14:26:40.123  ERROR  TypeError: boom');
  });

  it('không có lỗi nào vẫn có đầu file', () => {
    const out = formatErrorReport([], { generatedAt: AT });

    expect(out).toContain('DevTools error report');
    expect(out).toContain('Errors    : 0 of 0 captured entries');
    expect(out).not.toContain('Build');
  });

  it('dòng có `screen` in `Screen:` ngay dưới dòng đầu của mục', () => {
    const out = formatErrorReport([net(1, { status: 500, screen: 'UserCreate' })], META);

    expect(out).toMatch(/→ 500\n {2}Screen: UserCreate/);
  });

  it('lỗi fatal in `FATAL`, các dòng stack thụt lề dưới dòng đầu', () => {
    const fatal: ConsoleEntry = {
      ...con(1, 'error', 'TypeError: boom\n    at render (App.tsx:10)\n    at run (x.js:2)'),
      uncaught: true,
      fatal: true,
    };
    const out = formatErrorReport([fatal], META);

    expect(out).toContain('#1  14:26:40.123  FATAL  TypeError: boom');
    expect(out).toContain('\n    at render (App.tsx:10)\n    at run (x.js:2)');
  });

  /* Mốc là bối cảnh, không phải lỗi — và không được tính vào mẫu số "of M captured entries". */
  it('`info` + `sessionStartedAt` in vào đầu file; mốc không bao giờ lọt vào file', () => {
    const marker: LogEntry = { id: 9, kind: 'marker', at: AT, type: 'screen', label: 'UserList' };
    const out = formatErrorReport([marker, con(1, 'error', 'x')], {
      ...META,
      info: { device: 'Galaxy M34 5G', user: '***812 · admin' },
      sessionStartedAt: AT,
    });

    expect(out).toContain('Device    : Galaxy M34 5G');
    expect(out).toContain('User      : ***812 · admin');
    expect(out).toMatch(/Session {3}: 2026-09-24 14:26:40 [+-]\d{2}:\d{2}/);
    expect(out).toContain('Errors    : 1 of 1 captured entries');
    expect(out).not.toContain('UserList');
  });
});

describe('errorReportFileName', () => {
  it('đúng khuôn tên', () => {
    expect(errorReportFileName(AT)).toBe('devtools-errors-20260924-142640.txt');
  });

  it('đệm 0 cho tháng/ngày/giờ một chữ số', () => {
    expect(errorReportFileName(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe(
      'devtools-errors-20260102-030405.txt',
    );
  });
});

/* `errors.txt` đi vào Jira/Slack: URL và câu lỗi console cũng phải qua lớp che. */
describe('formatErrorReport — che URL và console', () => {
  it('che token trong query, trong thân camelCase và trong console.error', () => {
    const out = formatErrorReport(
      [
        net(1, {
          url: 'https://api.test/token?client_secret=s1',
          status: 401,
          requestBody: '{"refreshToken":"r1"}',
        }),
        con(2, 'error', 'refresh failed {"accessToken":"a1"}'),
      ],
      META,
    );

    expect(out).toContain(`POST https://api.test/token?client_secret=${REDACTED} → 401`);
    expect(out).toContain(`"refreshToken": "${REDACTED}"`);
    expect(out).toContain(`refresh failed {"accessToken":"${REDACTED}"}`);
    expect(out).not.toContain('client_secret=s1');
    expect(out).not.toContain('"r1"');
    expect(out).not.toContain('"a1"');
  });

  /* JSON nén có `=` (token base64 có đệm) từng bị coi là thân form và vào `errors.txt` nguyên token. */
  it('che token base64 có đệm `=` trong thân JSON nén, kể cả thân bị cắt', () => {
    const out = formatErrorReport(
      [
        net(1, {
          status: 401,
          requestBody: '{"refreshToken":"dGVzdA=="}',
          responseBody: '{"q":"a=b","accessToken":"YWJjZGVmZ2g…+40',
          responseTruncated: true,
        }),
      ],
      META,
    );

    expect(out).toContain(`"refreshToken": "${REDACTED}"`);
    expect(out).toContain(`"accessToken": "${REDACTED}"`);
    expect(out).not.toContain('dGVzdA');
    expect(out).not.toContain('YWJjZGVmZ2g');
  });
});
