import {
  REDACTED,
  redactBody,
  redactHeaders,
  redactText,
  redactUrl,
  setExtraSecretKeys,
  truncate,
} from './redact';

const R = REDACTED;
/** JWT giả, đủ ba phần (header.payload.signature) như token thật. */
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl';

describe('redactHeaders', () => {
  it('che `Authorization`', () => {
    const input = { Authorization: 'Bearer abc' };

    expect(redactHeaders(input)).toEqual({ Authorization: REDACTED });
    // Trả map MỚI — bộ đệm giữ header thô cho `toCurl`, che không được phép ghi đè lên nó.
    expect(input.Authorization).toBe('Bearer abc');
  });

  it('không đụng `Content-Type`', () => {
    const out = redactHeaders({ Authorization: 'Bearer abc', 'Content-Type': 'application/json' });

    expect(out).toEqual({ Authorization: REDACTED, 'Content-Type': 'application/json' });
  });

  it('khớp bất kể hoa thường', () => {
    const out = redactHeaders({ AUTHORIZATION: 'a', authorization: 'b', Cookie: 'sid=1' });

    expect(out).toEqual({ AUTHORIZATION: REDACTED, authorization: REDACTED, Cookie: REDACTED });
  });

  it('map rỗng trả map rỗng', () => {
    const input = {};
    const out = redactHeaders(input);

    expect(out).toEqual({});
    expect(out).not.toBe(input);
  });
});

describe('redactBody', () => {
  it('che `password`', () => {
    expect(redactBody('{"password":"123","id":7}')).toBe(`{"password":"${REDACTED}","id":7}`);
  });

  it('che nhiều khoá trong một thân', () => {
    expect(redactBody('{"otp":"9","token":"t"}')).toBe(
      `{"otp":"${REDACTED}","token":"${REDACTED}"}`,
    );
  });

  /* Khớp NGUYÊN tên khoá: `passwordHint` không phải `password`, và chữ "password" nằm ở vị trí
     giá trị cũng không phải khoá. */
  it('không đụng khoá thường', () => {
    const body = '{"username":"linh","passwordHint":"mèo","note":"password"}';

    expect(redactBody(body)).toBe(body);
  });

  it('`undefined`/chuỗi rỗng ⇒ `undefined`', () => {
    expect(redactBody(undefined)).toBeUndefined();
    expect(redactBody('')).toBeUndefined();
  });
});

/*
  Bản đầu chỉ khớp ĐÚNG tên `password|pass|pin|otp|token|refresh_token|access_token|client_secret`
  với giá trị chuỗi. App JS đặt tên kiểu camelCase (`accessToken`), nên token thật lọt ra file phiên
  trên đĩa, `errors.txt` gửi lên Jira và nút Chia sẻ (đánh giá bảo mật 9/11/2026, mục 1).
*/
describe('redactBody — tên khoá ngoài đời: camelCase, lồng nhau, số, mảng, form', () => {
  it('che token camelCase và snake_case, giữ `token_type`', () => {
    expect(
      redactBody('{"accessToken":"a1","refreshToken":"r1","id_token":"i1","token_type":"Bearer"}'),
    ).toBe(`{"accessToken":"${R}","refreshToken":"${R}","id_token":"${R}","token_type":"Bearer"}`);
  });

  it('che khoá lồng nhau, giữ khoá thường bên cạnh', () => {
    expect(
      redactBody('{"data":{"auth":{"apiKey":"k1","clientSecret":"s1"},"user":{"name":"Linh"}}}'),
    ).toBe(`{"data":{"auth":{"apiKey":"${R}","clientSecret":"${R}"},"user":{"name":"Linh"}}}`);
  });

  it('che giá trị số và cả mảng; giữ `null` và boolean (không bịa ra là có giá trị)', () => {
    expect(
      redactBody('{"pin":1234,"cvv":"123","tokens":["a","b"],"password":null,"otpVerified":true}'),
    ).toBe(`{"pin":"${R}","cvv":"${R}","tokens":"${R}","password":null,"otpVerified":true}`);
  });

  it('chuỗi bí mật có dấu nháy thoát bị che trọn, không lộ đuôi', () => {
    expect(redactBody('{"password":"a\\"b","id":1}')).toBe(`{"password":"${R}","id":1}`);
  });

  it('giữ khoảng trắng quanh dấu hai chấm', () => {
    expect(redactBody('{ "token" : "x" }')).toBe(`{ "token" : "${R}" }`);
  });

  it('thân bị cắt ngay giữa giá trị bí mật ⇒ không lộ phần đã giữ', () => {
    expect(redactBody('{"accessToken":"eyJabc…+120')).toBe(`{"accessToken":"${R}"`);
  });

  it('không che khoá phân trang, mốc hết hạn, chính sách mật khẩu', () => {
    const body = '{"nextPageToken":"p2","tokenExpiresAt":1700000000,"passwordPolicy":"8+"}';

    expect(redactBody(body)).toBe(body);
  });

  /* `code`, `key` chỉ là bí mật trong URL (mã OAuth, `?key=AIza…`); trong thân JSON chúng thường là
     mã lỗi và khoá nghiệp vụ, thứ dev cần đọc. */
  it('không che `code`, `key` trong thân JSON', () => {
    const body = '{"code":"ORDER_NOT_FOUND","key":"user-1"}';

    expect(redactBody(body)).toBe(body);
  });

  it('thân form-urlencoded', () => {
    expect(redactBody('grant_type=password&username=linh&password=hunter2&client_secret=s3')).toBe(
      `grant_type=password&username=linh&password=${R}&client_secret=${R}`,
    );
  });

  it('JWT trong thân không phải JSON', () => {
    expect(redactBody(`<auth>${JWT}</auth>`)).toBe(`<auth>${R}</auth>`);
  });
});

/*
  Khuôn nhận thân form khớp cả JSON **nén** (không khoảng trắng, không `&`) có một dấu `=` ở bất kỳ
  đâu — đúng thứ `JSON.stringify` sinh ra cho token base64 có đệm `==`. Thân đó bị tách như một tham
  số form tên `{"refreshToken":"dGVzdA`, không tên nào khớp quy tắc, và token ra ngoài nguyên vẹn
  (file phiên trên đĩa, `errors.txt`, nút Chia sẻ). Thân bắt đầu bằng `{`/`[` giờ luôn đi đường khoá
  JSON; thân form thật vẫn che theo tên tham số.
*/
describe('redactBody — JSON nén có `=` không bị coi là thân form', () => {
  it('token base64 có đệm `==` trong JSON nén', () => {
    expect(redactBody('{"refreshToken":"dGVzdA=="}')).toBe(`{"refreshToken":"${R}"}`);
  });

  it('base64 có đệm trong object lồng nhau và trong mảng', () => {
    expect(redactBody('{"data":{"session":{"accessToken":"YWJjZA==","expiresIn":3600}}}')).toBe(
      `{"data":{"session":{"accessToken":"${R}","expiresIn":3600}}}`,
    );
    expect(
      redactBody('[{"apiKey":"a2V5MQ==","id":1},{"items":[{"clientSecret":"c2VjcmV0=","n":2}]}]'),
    ).toBe(`[{"apiKey":"${R}","id":1},{"items":[{"clientSecret":"${R}","n":2}]}]`);
  });

  it('JSON nén bị cắt ở `bodyLimit` có `=` ⇒ vẫn che, kể cả khi bị cắt giữa giá trị bí mật', () => {
    const body = JSON.stringify({ filter: 'a=b', refreshToken: 'dGVzdGluZy1yZWZyZXNo==', id: 7 });
    const cutInSecret = truncate(body, 34).text;
    const cutAfterSecret = truncate(body, 56).text;

    expect(cutInSecret).toBe('{"filter":"a=b","refreshToken":"dG…+29');
    expect(redactBody(cutInSecret)).toBe(`{"filter":"a=b","refreshToken":"${R}"`);
    expect(cutAfterSecret).toBe('{"filter":"a=b","refreshToken":"dGVzdGluZy1yZWZyZXNo==",…+7');
    expect(redactBody(cutAfterSecret)).toBe(`{"filter":"a=b","refreshToken":"${R}",…+7`);
  });

  it('chuỗi giá trị JSON có `&` và `=` giữ nguyên, JSON vẫn đọc được, khoá bí mật vẫn che', () => {
    const out = redactBody('{"redirect":"/cb?a=1&b=2","refreshToken":"dGVzdA==","id":1}');

    expect(out).toBe(`{"redirect":"/cb?a=1&b=2","refreshToken":"${R}","id":1}`);
    expect(JSON.parse(out ?? '')).toEqual({ redirect: '/cb?a=1&b=2', refreshToken: R, id: 1 });
  });

  it('thân form thật vẫn che theo tên tham số (giá trị đã mã hoá và chưa mã hoá)', () => {
    expect(redactBody('grant_type=refresh_token&refresh_token=abc%3D%3D')).toBe(
      `grant_type=refresh_token&refresh_token=${R}`,
    );
    expect(redactBody('refresh_token=dGVzdA==&client_id=app')).toBe(
      `refresh_token=${R}&client_id=app`,
    );
    expect(redactBody('a=b&c=d')).toBe('a=b&c=d');
  });

  /* Cùng lỗi theo chiều ngược lại: đi đường form thì trước đây bỏ qua hẳn đường khoá JSON. */
  it('giá trị form mang JSON thô ⇒ khoá bí mật bên trong vẫn bị che', () => {
    expect(redactBody('payload={"refreshToken":"dGVzdA=="}&v=2')).toBe(
      `payload={"refreshToken":"${R}"}&v=2`,
    );
  });
});

describe('redactHeaders — theo tên header', () => {
  it('che x-access-token, csrf, amz, goog, api-key, session; giữ header gỡ lỗi', () => {
    const out = redactHeaders({
      'X-Access-Token': 'a',
      'X-CSRF-Token': 'b',
      'x-amz-security-token': 'c',
      'X-Goog-Api-Key': 'd',
      'api-key': 'e',
      'X-Session-Id': 'f',
      'X-Request-Id': 'r',
      traceparent: 't',
      'Content-Type': 'application/json',
    });

    expect(out).toEqual({
      'X-Access-Token': R,
      'X-CSRF-Token': R,
      'x-amz-security-token': R,
      'X-Goog-Api-Key': R,
      'api-key': R,
      'X-Session-Id': R,
      'X-Request-Id': 'r',
      traceparent: 't',
      'Content-Type': 'application/json',
    });
  });
});

describe('redactHeaders — giá trị của header thường', () => {
  it('vẫn qua lớp mẫu: Bearer dài trong header tên lạ bị che', () => {
    expect(redactHeaders({ 'X-Debug': 'Bearer abcdefghijklmnop1234' })).toEqual({
      'X-Debug': `Bearer ${R}`,
    });
  });
});

describe('redactUrl', () => {
  it('che tham số query mang bí mật, giữ tham số thường và fragment', () => {
    expect(redactUrl('https://api.acme.vn/v1/me?access_token=abc&page=2&apiKey=k#top')).toBe(
      `https://api.acme.vn/v1/me?access_token=${R}&page=2&apiKey=${R}#top`,
    );
  });

  it('URL ký sẵn của S3: che credential và signature, giữ thời hạn', () => {
    expect(
      redactUrl(
        'https://b.s3.amazonaws.com/a.png?X-Amz-Credential=FAKE%2F2026&X-Amz-Expires=60&X-Amz-Signature=deadbeef',
      ),
    ).toBe(
      `https://b.s3.amazonaws.com/a.png?X-Amz-Credential=${R}&X-Amz-Expires=60&X-Amz-Signature=${R}`,
    );
  });

  it('che `user:pass@` trong URL', () => {
    expect(redactUrl('https://linh:hunter2@intranet.acme.vn/api')).toBe(
      `https://${R}@intranet.acme.vn/api`,
    );
  });

  it('callback OAuth: che `code` và token trong fragment, giữ `state`, `token_type`', () => {
    expect(redactUrl('acme://cb?code=abc&state=xyz#access_token=t1&token_type=bearer')).toBe(
      `acme://cb?code=${R}&state=xyz#access_token=${R}&token_type=bearer`,
    );
  });

  it('che token nằm trong đường dẫn webhook Slack và Lark', () => {
    expect(redactUrl('https://hooks.slack.com/services/T000/B000/XXXXXXXX')).toBe(
      `https://hooks.slack.com/services/${R}`,
    );
    expect(redactUrl('https://open.larksuite.com/open-apis/bot/v2/hook/abc-123')).toBe(
      `https://open.larksuite.com/open-apis/bot/v2/hook/${R}`,
    );
  });

  /* Tham số URL đi đường form nên trước đây không bao giờ qua đường khoá JSON: JSON thô trong query
     hoặc fragment (URL tự ghép bằng tay) lọt ra nguyên. */
  it('JSON thô trong query và fragment: che khoá bí mật', () => {
    expect(redactUrl('https://api.acme.vn/x?state={"refreshToken":"dGVzdA=="}&page=2')).toBe(
      `https://api.acme.vn/x?state={"refreshToken":"${R}"}&page=2`,
    );
    expect(redactUrl('acme://cb#{"access_token":"dGVzdA=="}')).toBe(
      `acme://cb#{"access_token":"${R}"}`,
    );
  });

  it('URL không có gì bí mật giữ nguyên', () => {
    const url = 'https://api.acme.vn/v1/orders?page=2&sort=desc&email=a@b.vn';

    expect(redactUrl(url)).toBe(url);
  });
});

describe('redactText (dòng console, câu lỗi)', () => {
  it('JSON in trong console: che khoá bí mật', () => {
    expect(redactText('Login ok {"accessToken":"a1","user":"linh"}')).toBe(
      `Login ok {"accessToken":"${R}","user":"linh"}`,
    );
  });

  it('che JWT, Bearer dài và token có tiền tố đã biết', () => {
    expect(redactText(`jwt ${JWT}`)).toBe(`jwt ${R}`);
    expect(redactText('Authorization: Bearer abcdefghijklmnop1234')).toBe(
      `Authorization: Bearer ${R}`,
    );
    expect(redactText('slack xoxb-000000000000-fakefakefake')).toBe(`slack ${R}`);
    expect(redactText('jira ATATT3xFfGF0fakefakefakefakefake')).toBe(`jira ${R}`);
  });

  it('câu thường có chữ Token/Bearer không bị che', () => {
    const text = 'Token refreshed successfully; Bearer token missing';

    expect(redactText(text)).toBe(text);
  });
});

describe('khoá do app thêm (`setExtraSecretKeys`)', () => {
  afterEach(() => setExtraSecretKeys([]));

  it('che khoá thêm trong thân, header và query; bỏ đi thì thôi che', () => {
    setExtraSecretKeys(['customerRef', 'X-Tenant-Key']);

    expect(redactBody('{"customer_ref":"c1","id":1}')).toBe(`{"customer_ref":"${R}","id":1}`);
    expect(redactHeaders({ 'x-tenant-key': 'k' })).toEqual({ 'x-tenant-key': R });
    expect(redactUrl('https://a.vn/x?customerRef=c1')).toBe(`https://a.vn/x?customerRef=${R}`);

    setExtraSecretKeys([]);
    expect(redactBody('{"customer_ref":"c1"}')).toBe('{"customer_ref":"c1"}');
  });
});

describe('truncate', () => {
  it('dưới hạn mức giữ nguyên và `truncated: false`', () => {
    expect(truncate('abc', 10)).toEqual({ text: 'abc', truncated: false });
  });

  it('vượt hạn mức có hậu tố `…+N` và `truncated: true`', () => {
    expect(truncate('x'.repeat(20), 10)).toEqual({
      text: `${'x'.repeat(10)}…+10`,
      truncated: true,
    });
  });

  it('vừa đúng hạn mức không cắt', () => {
    expect(truncate('abc', 3)).toEqual({ text: 'abc', truncated: false });
    // Một ký tự quá hạn mức là đủ để cắt — khoá biên ở cả hai phía.
    expect(truncate('abcd', 3)).toEqual({ text: 'abc…+1', truncated: true });
  });

  it('`undefined` ⇒ `{ text: undefined, truncated: false }`', () => {
    expect(truncate(undefined, 10)).toEqual({ text: undefined, truncated: false });
    expect(truncate('', 10)).toEqual({ text: undefined, truncated: false });
  });
});
