import { formatJsonLenient } from './format-json';
import { formatDateTime, formatTime } from './format-log';
import type { ConsoleEntry, LogEntry, NetworkEntry } from './log-entry';
import { isErrorEntry } from './log-query';
import { redactBody, redactHeaders, redactText, redactUrl } from './redact';
import { sessionInfoPairs, type DevToolsSessionInfo } from './session-info';

/** Thông tin đầu file — thứ người nhận file (BE, hạ tầng) cần mà không có trong từng dòng. */
export interface ErrorReportMeta {
  /** Mốc dựng file (`Date.now()`) — đi vào dòng đầu **và** tên file. */
  readonly generatedAt: number;
  /** Dòng phụ môi trường của app, vd `'UAT · 1.0.2'` — lấy từ `DevToolsConfig.subtitle`. */
  readonly build?: string;
  /** Bản build · máy · user (đã che) — lấy từ `DevToolsConfig.sessionInfo`. */
  readonly info?: DevToolsSessionInfo;
  /** Mốc bắt đầu thu nhật ký — in thành dòng `Session`. */
  readonly sessionStartedAt?: number;
  /** Nhãn nguồn khi xuất **phiên trước** thay vì phiên đang chạy, vd `'previous session'`. */
  readonly source?: string;
}

const RULE = '='.repeat(64);
const THIN_RULE = '-'.repeat(64);

/** Một dòng đầu file, nhãn đệm 10 cho thẳng cột với khối `formatSessionInfo`. */
const headLine = (label: string, value: string) => `${label.padEnd(10)}: ${value}`;

/**
 * **Chức năng:** thân đã che, **dàn dòng nếu là JSON hợp lệ** — dùng chung cho file xuất và màn
 * chi tiết request.
 *
 * Thân bị cắt (`…+N`) không còn là JSON hợp lệ ⇒ dàn bằng {@link formatJsonLenient} (chỉ thụt lề
 * theo dấu ngoặc/phẩy, không dựng lại cấu trúc). 🔄 10/10/2026: trước đây giữ nguyên chuỗi nén một
 * dòng — đúng những response dài nhất lại khó đọc nhất. Che **trước** khi dàn, vì `redactBody`
 * khớp khuôn `"khoá":"giá trị"` liền nhau của JSON chưa dàn.
 *
 * **Input:** `raw` — thân thô trong buffer. **Output:** chuỗi đã che (có thể nhiều dòng), hoặc
 * `undefined` khi không có thân.
 *
 * @example
 * ```ts
 * prettyBody('{"a":1,"password":"x"}');  // '{\n  "a": 1,\n  "password": "<redacted>"\n}'
 * prettyBody('{"a":1,"b…+20');            // ca biên: bị cắt ⇒ '{\n  "a": 1,\n  "b…+20'
 * prettyBody('<html>');                   // không phải JSON ⇒ giữ nguyên
 * ```
 *
 * **Unit test:** `format-error-report.test.ts` › `formatErrorReport` — phủ qua case "JSON hợp lệ
 * được dàn đẹp; thân bị cắt vẫn thụt lề" và "khoá `password` bị che"; `formatErrorReport — che URL và
 * console` › "token base64 có đệm `=` trong thân JSON nén, kể cả thân bị cắt".
 */
export const prettyBody = (raw: string | undefined): string | undefined => {
  const safe = redactBody(raw);
  if (safe === undefined) return undefined;
  try {
    return JSON.stringify(JSON.parse(safe), null, 2);
  } catch {
    return formatJsonLenient(safe);
  }
};

const indent = (text: string) =>
  text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');

const consoleLevel = (entry: ConsoleEntry) =>
  entry.fatal ? 'FATAL' : entry.uncaught ? 'UNCAUGHT' : entry.level.toUpperCase();

const networkBlock = (entry: NetworkEntry): string[] => {
  const outcome =
    entry.error ??
    (entry.status === undefined ? 'pending' : String(entry.status));
  const took = entry.durationMs === undefined ? '' : `  ${entry.durationMs}ms`;
  const lines = [
    `${formatTime(entry.at)}  ${entry.method} ${redactUrl(entry.url)} → ${outcome}${took}`,
  ];
  if (entry.screen) lines.push(`  Screen: ${entry.screen}`);

  const headers = Object.entries(redactHeaders({ ...(entry.requestHeaders ?? {}) }));
  if (headers.length > 0) {
    lines.push('  Request headers:');
    headers.forEach(([name, value]) => lines.push(`    ${name}: ${value}`));
  }
  const req = prettyBody(entry.requestBody);
  if (req) {
    lines.push(`  Request body${entry.requestTruncated ? ' (truncated)' : ''}:`);
    lines.push(indent(req));
  }
  const res = prettyBody(entry.responseBody);
  if (res) {
    lines.push(`  Response body${entry.responseTruncated ? ' (truncated)' : ''}:`);
    lines.push(indent(res));
  }
  return lines;
};

const consoleBlock = (entry: ConsoleEntry): string[] => {
  const [first, ...rest] = redactText(entry.text).split('\n');
  return [
    `${formatTime(entry.at)}  ${consoleLevel(entry)}  ${first}`,
    ...(entry.screen ? [`  Screen: ${entry.screen}`] : []),
    ...rest.map((l) => `    ${l.trim()}`),
  ];
};

/**
 * **Chức năng:** dựng nội dung **file báo cáo lỗi** — toàn bộ dòng lỗi trong vòng đệm (kể cả lỗi
 * đã rời vòng chính nhưng còn trong vòng giữ lỗi), mỗi dòng đủ chi tiết để BE dò mà không cần hỏi
 * lại: màn đang mở, header, thân request, thân response, stack.
 *
 * Khác `formatLog` (nút Chia sẻ) ở ba chỗ, vì đích khác nhau: `formatLog` dán vào **ô chat** nên
 * gọn một dòng; file thì mở bằng trình soạn thảo nên được phép dài — có đầu file (giờ dựng, bản
 * build, máy, user đã che, số lỗi / số dòng đang giữ), có header, JSON được dàn đẹp.
 *
 * 🔴 **Che như nút Chia sẻ** (`redactHeaders` + `redactBody`) — file rời khỏi máy, cùng nhóm
 * "đi tới người khác" trong bảng chính sách ở đầu `redact.ts`. Thân response vẫn còn dữ liệu
 * nghiệp vụ: đừng gửi file của bản uat vào chỗ công khai.
 *
 * Cố ý **trung lập ngôn ngữ** (tiếng Anh kỹ thuật, không i18n) — cùng lý do với `formatLog`.
 *
 * Luôn lấy **mọi dòng lỗi** của `entries`, bất kể màn đang lọc gì: nút này sinh ra để "gửi hết
 * lỗi cho BE", không phải "gửi thứ đang nhìn".
 *
 * **Input:** `entries` — ảnh chụp buffer (cũ→mới) hoặc dòng của phiên trước · `meta`.
 * **Output:** chuỗi nhiều dòng; không có lỗi nào ⇒ vẫn có đầu file với `Errors : 0`.
 *
 * @example
 * ```ts
 * formatErrorReport(logBuffer.snapshot(), { generatedAt: Date.now(), build: 'UAT · 1.0.2',
 *   info: { device: 'Samsung SM-A525F', user: '***812 · admin' } });
 * // DevTools error report
 * // Generated : 2026-09-24 14:26:40 +07:00
 * // Build     : UAT · 1.0.2
 * // Device    : Samsung SM-A525F
 * // User      : ***812 · admin
 * // Errors    : 2 of 57 captured entries
 * // ================================================================
 * // #1  14:20:11.123  POST https://api/x → 500  812ms
 * //   Screen: UserCreate
 * // …
 * formatErrorReport([], { generatedAt: 0 }); // ca biên: chỉ có đầu file, `Errors : 0 of 0`
 * ```
 *
 * **Unit test:** `format-error-report.test.ts` › `formatErrorReport` — 10 case: chỉ lấy dòng lỗi,
 * bỏ dòng thường · đầu file có bản build + đếm `N of M` · header `Authorization` bị che · khoá
 * `password` trong thân bị che · JSON hợp lệ được dàn đẹp, thân bị cắt giữ nguyên + ghi
 * `(truncated)` · dòng `console.error` in mức + nội dung · không có lỗi vẫn có đầu file · dòng có
 * `screen` in `Screen:` · lỗi fatal in `FATAL` kèm stack thụt lề · `info` + `sessionStartedAt` in
 * vào đầu file, mốc không bao giờ lọt vào file.
 */
export const formatErrorReport = (
  entries: readonly LogEntry[],
  meta: ErrorReportMeta,
): string => {
  const errors = entries.filter(isErrorEntry) as Array<ConsoleEntry | NetworkEntry>;
  const total = entries.filter((e) => e.kind !== 'marker').length;
  const head = [
    meta.source ? `DevTools error report (${meta.source})` : 'DevTools error report',
    headLine('Generated', formatDateTime(meta.generatedAt)),
    ...(meta.build ? [headLine('Build', meta.build)] : []),
    ...sessionInfoPairs(meta.info ?? {}, meta.sessionStartedAt).map(([k, v]) =>
      headLine(k, v),
    ),
    headLine('Errors', `${errors.length} of ${total} captured entries`),
    '(buffer keeps only the most recent entries — older ones are gone)',
    RULE,
  ];

  const blocks = errors.map((entry, i) => {
    const body = entry.kind === 'console' ? consoleBlock(entry) : networkBlock(entry);
    return [`#${i + 1}  ${body[0]}`, ...body.slice(1)].join('\n');
  });

  return [...head, blocks.join(`\n${THIN_RULE}\n`)].join('\n').trimEnd();
};

/**
 * **Chức năng:** tên file báo cáo lỗi — có mốc thời gian để nhiều lần xuất không đè nhau trong
 * thư mục Tải về / luồng chat.
 *
 * Chỉ ký tự an toàn cho mọi hệ tệp (không `:`, không khoảng trắng): tên này đi qua MediaStore,
 * Files của iOS và tên đính kèm của Zalo/Gmail.
 *
 * **Input:** `at` — mili-giây, giờ máy. **Output:** `devtools-errors-YYYYMMDD-HHmmss.txt`.
 *
 * @example
 * ```ts
 * errorReportFileName(new Date(2026, 8, 24, 14, 26, 40).getTime());
 * // 'devtools-errors-20260924-142640.txt'
 * errorReportFileName(new Date(2026, 0, 2, 3, 4, 5).getTime());
 * // ca biên: đệm 0 ⇒ 'devtools-errors-20260102-030405.txt'
 * ```
 *
 * **Unit test:** `format-error-report.test.ts` › `errorReportFileName` — 2 case: đúng khuôn tên ·
 * đệm 0 cho tháng/ngày/giờ một chữ số.
 */
export const errorReportFileName = (at: number): string => {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `devtools-errors-${date}-${time}.txt`;
};
