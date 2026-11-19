import type { NetworkEntry } from './log-entry';
import { toCurl } from './to-curl';

const req = (over: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id: 1,
  kind: 'network',
  at: 0,
  method: 'GET',
  url: 'https://api.test/x',
  ...over,
});

/** Lệnh shell nhiều dòng: mọi dòng trừ dòng cuối kết thúc bằng ` \`. */
const multiline = (...lines: string[]) => lines.join(' \\\n');

describe('toCurl', () => {
  /* `--data-raw` rỗng khiến curl âm thầm đổi method sang POST — thân rỗng cũng phải bỏ dòng. */
  it('GET không thân không sinh `--data-raw`', () => {
    expect(toCurl(req())).not.toContain('--data-raw');
    expect(toCurl(req({ requestBody: '' }))).not.toContain('--data-raw');
  });

  it('POST có thân sinh `--data-raw`', () => {
    expect(toCurl(req({ method: 'POST', requestBody: '{"a":1}' }))).toBe(
      multiline("curl -X POST 'https://api.test/x'", `  --data-raw '{"a":1}'`),
    );
  });

  /* Khoá quyết định "không che": curl mang `<redacted>` thì mọi endpoint cần đăng nhập trả 401. */
  it('header giữ NGUYÊN giá trị `Authorization`', () => {
    const out = toCurl(req({ requestHeaders: { Authorization: 'Bearer eyJ.real.token' } }));

    expect(out).toContain(`-H 'Authorization: Bearer eyJ.real.token'`);
    expect(out).not.toContain('<redacted>');
  });

  it('bỏ `content-length`/`host`', () => {
    const out = toCurl(
      req({
        method: 'POST',
        requestHeaders: {
          'Content-Length': '7',
          Host: 'api.test',
          'Content-Type': 'application/json',
        },
        requestBody: '{"a":1}',
      }),
    );

    expect(out).not.toMatch(/content-length/i);
    expect(out).not.toMatch(/-H 'host:/i);
    expect(out).toContain(`-H 'Content-Type: application/json'`);
  });

  it("nháy đơn trong thân được escape `'\\''`", () => {
    const out = toCurl(req({ method: 'POST', requestBody: `{"name":"O'Brien"}` }));

    expect(out).toContain(`  --data-raw '{"name":"O'\\''Brien"}'`);
  });

  /* Khoá tính import-được vào Postman: trình phân tích cURL của nó không hứa nhận dòng comment. */
  it('KHÔNG sinh dòng nào bắt đầu bằng `#`', () => {
    const out = toCurl(
      req({
        method: 'POST',
        status: 500,
        durationMs: 812,
        requestHeaders: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
        requestBody: '{"a":"xxxxxxxxxx…+42',
        requestTruncated: true,
        responseBody: '{"errorCode":"E500"}',
      }),
    );
    const commentLines = out.split('\n').filter((line) => line.trimStart().startsWith('#'));

    expect(commentLines).toEqual([]);
  });

  it('không có header ⇒ chỉ 1 dòng', () => {
    expect(toCurl(req())).toBe("curl -X GET 'https://api.test/x'");
    expect(toCurl(req({ requestHeaders: {} }))).toBe("curl -X GET 'https://api.test/x'");
  });

  /* Response không phải đầu vào của curl — thiếu `status`/`durationMs` không được làm hụt lệnh. */
  it('request chưa xong vẫn dựng đủ lệnh', () => {
    const inFlight = req({
      method: 'PUT',
      requestHeaders: { 'Content-Type': 'application/json' },
      requestBody: '{"id":7}',
    });

    expect(toCurl(inFlight)).toBe(
      multiline(
        "curl -X PUT 'https://api.test/x'",
        "  -H 'Content-Type: application/json'",
        `  --data-raw '{"id":7}'`,
      ),
    );
  });
});
