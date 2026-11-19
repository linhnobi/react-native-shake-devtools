/**
 * Che dữ liệu nhạy cảm (ở chỗ **xuất**) và cắt bớt thân request (ở chỗ **ghi**).
 *
 * ## Vì sao tầng này tồn tại, khi công cụ chỉ chạy ở dev/uat
 *
 * Vì nhật ký **rời khỏi máy được**: QA bấm "chia sẻ" rồi dán vào chat/ticket. Một
 * `Authorization: Bearer …` dán nhầm vào ticket là một token còn sống nằm trong hệ thống
 * không ai kiểm soát.
 *
 * ## 🔄 Che ở chỗ **XUẤT**, không ở chỗ ghi (đảo lại quyết định ngày 14/9/2026)
 *
 * Bản đầu của file này che ngay lúc ghi vào bộ đệm, với lập luận *"che ở chỗ hiện thì token
 * vẫn nằm trong RAM"*. Lập luận đó vẫn đúng, nhưng nó **loại trừ** một tính năng được yêu
 * cầu sau đó: chép một request ra lệnh `curl` **chạy được ngay**. Một curl mang
 * `Authorization: <redacted>` thì mọi endpoint cần đăng nhập đều trả 401 — tức tính năng đó
 * không tồn tại.
 *
 * Nên tầng che dời ra **chỗ xuất**, và mỗi đường xuất có một chính sách riêng:
 *
 * | Đường ra | Đi đâu | Che? |
 * |---|---|---|
 * | `formatLog` → nút **Chia sẻ** | chat, ticket, người khác | **CÓ** |
 * | `LogRow` → màn hình | mắt người cầm máy | **CÓ** |
 * | `toCurl` → **bộ nhớ tạm** | terminal của chính người đang gỡ | **KHÔNG** |
 *
 * Ranh giới là *"nội dung này đi tới người khác hay ở lại với người đang gỡ lỗi"* — chép vào
 * clipboard rồi dán sang terminal là đường ở lại; chia sẻ là đường đi ra.
 *
 * ## 🔄 Khớp theo **quy tắc tên**, không theo danh sách đúng tên (sửa 9/11/2026)
 *
 * Bản trước chỉ che đúng 8 tên khoá viết kiểu snake_case với giá trị chuỗi. App JS đặt tên kiểu
 * camelCase (`accessToken`, `refreshToken`, `apiKey`), nên token thật lọt vào file phiên trên đĩa,
 * `errors.txt` gửi lên Jira và nút Chia sẻ. Giờ mọi tên (khoá JSON, tham số form/query, header) đi
 * qua **một** quy tắc (`isSecretName`): chuẩn hoá rồi khớp đúng tên hoặc **đuôi** tên, có danh sách
 * loại trừ cho tên trông giống nhưng không phải bí mật (`token_type`, `nextPageToken`). Thêm một
 * lớp theo **mẫu giá trị** (JWT, `Bearer …`, token có tiền tố đã biết) cho chữ không có tên khoá:
 * dòng console, câu lỗi, đường dẫn URL.
 *
 * ⚠️ Đánh đổi phải nói thẳng: bộ đệm **giữ token thật trong RAM**, và ai dán clipboard vào
 * nhầm chỗ thì token đi theo. Đây không phải lớp bảo mật, chỉ là lưới chắn sơ suất ở đường
 * hay dùng nhất. Thân response vẫn còn nguyên dữ liệu nghiệp vụ — đừng dán nhật ký uat vào
 * chỗ công khai.
 */

/**
 * Dấu thay cho giá trị bí mật.
 *
 * Cố ý **trung lập ngôn ngữ**, không đi qua i18n: nó nằm trong *dữ liệu đã bắt* chứ không
 * phải trong giao diện. Dữ liệu này được chép ra ngoài (ticket, chat) nên nó phải đọc được
 * y nhau bất kể app đang chạy ngôn ngữ gì — và một hàm thuần ngoài React thì cũng không có
 * `t()` để gọi (lib trả dữ liệu, app dịch tại render).
 */
export const REDACTED = '<redacted>';

/* ───────────────────────────── Quy tắc tên ───────────────────────────── */

/** Chuẩn hoá tên: chữ thường, bỏ mọi ký tự không phải chữ/số — `access_token`, `accessToken`,
 *  `Access-Token` cùng thành `accesstoken`. */
const normalizeName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Tên bí mật khi khớp **nguyên** (sau chuẩn hoá). Ngắn quá để khớp theo đuôi. */
const SECRET_EXACT: ReadonlySet<string> = new Set([
  'pass',
  'pin',
  'pincode',
  'auth',
  'jwt',
  'cardnumber',
  'securitycode',
]);

/**
 * Tên bí mật khi **kết thúc** bằng một trong các đuôi này (cả dạng số nhiều bỏ `s`): `accesstoken`,
 * `newpassword`, `xapikey`, `setcookie`, `credentials`… Đuôi, không phải chứa: `passwordHint`,
 * `tokenExpiresAt`, `passwordPolicy` không phải bí mật và vẫn đọc được để gỡ lỗi.
 */
const SECRET_SUFFIXES: readonly string[] = [
  'token',
  'secret',
  'password',
  'passwd',
  'passcode',
  'apikey',
  'authorization',
  'cookie',
  'credential',
  'privatekey',
  'signature',
  'sessionid',
  'otp',
  'cvv',
  'cvc',
];

/** Trông giống bí mật nhưng không phải — giữ lại vì cần để gỡ lỗi (kiểu token, con trỏ phân trang). */
const NOT_SECRET: ReadonlySet<string> = new Set([
  'tokentype',
  'pagetoken',
  'nextpagetoken',
  'prevpagetoken',
  'previouspagetoken',
  'nexttoken',
  'continuationtoken',
]);

/** Thêm cho tham số **URL**: `code` (mã OAuth dùng một lần), `key` (`?key=AIza…`), `sig` (SAS). Không
 *  áp cho khoá JSON — `"key"`, `"code"` trong thân thường là dữ liệu nghiệp vụ. */
const URL_EXTRA_EXACT: ReadonlySet<string> = new Set(['code', 'key', 'sig']);

/** Tên app tự thêm qua `startCapture({ redactKeys })`, đã chuẩn hoá. Khớp nguyên tên. */
let extraNames: ReadonlySet<string> = new Set();

/**
 * **Chức năng:** đặt danh sách tên bí mật **riêng của app** (khoá JSON, tham số form/query, header),
 * cộng thêm vào quy tắc mặc định. `startCapture({ redactKeys })` gọi hàm này lúc bật và gọi lại với
 * `[]` khi tắt thu.
 *
 * **Input:** `names` — tên viết kiểu gì cũng được (`customerRef`, `customer_ref`, `X-Tenant-Key`):
 * so sau khi chuẩn hoá, khớp **nguyên tên**. `[]` ⇒ bỏ hết.
 * **Output:** không có; ảnh hưởng mọi lần che sau đó.
 *
 * @example
 * ```ts
 * setExtraSecretKeys(['customerRef']);
 * redactBody('{"customer_ref":"c1"}'); // '{"customer_ref":"<redacted>"}'
 * setExtraSecretKeys([]);              // ca biên: bỏ hết, trở về quy tắc mặc định
 * ```
 *
 * **Unit test:** `redact.test.ts` › `khoá do app thêm` — che trong thân, header, query; bỏ thì thôi
 * che. `start-capture.test.ts` › `redactKeys` — bật thì che, tắt thu thì bỏ.
 */
export const setExtraSecretKeys = (names: readonly string[]): void => {
  extraNames = new Set(names.map(normalizeName).filter((n) => n !== ''));
};

/** Tên (khoá JSON, tham số, header) có mang bí mật không — một quy tắc cho mọi chỗ. */
const isSecretName = (name: string, extraExact?: ReadonlySet<string>): boolean => {
  const key = normalizeName(name);
  if (key === '' || NOT_SECRET.has(key)) return false;
  if (SECRET_EXACT.has(key) || extraNames.has(key) || extraExact?.has(key)) return true;
  const singular = key.endsWith('s') ? key.slice(0, -1) : key;
  return SECRET_SUFFIXES.some((s) => key.endsWith(s) || singular.endsWith(s));
};

/* ─────────────────────────── Mẫu giá trị ─────────────────────────── */

/**
 * Chữ trông như bí mật dù không có tên khoá đi kèm. Cố ý chỉ gồm mẫu **ít khi nhầm**: JWT đủ ba
 * phần, `Bearer` + chuỗi ≥ 16 ký tự (câu "Bearer token missing" không bị che), token có tiền tố của
 * các dịch vụ hay gặp, gồm cả chính các đích của lib (Slack, Atlassian, đường dẫn webhook Lark).
 */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, REDACTED],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi, `$1 ${REDACTED}`],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, REDACTED],
  [/\bATATT[A-Za-z0-9_=-]{20,}/g, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, REDACTED],
  [/\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}/g, REDACTED],
  [/(hooks\.slack\.com\/services\/)[A-Za-z0-9/_-]+/g, `$1${REDACTED}`],
  [/(\/open-apis\/bot\/v2\/hook\/)[A-Za-z0-9_-]+/g, `$1${REDACTED}`],
];

const redactPatterns = (text: string): string =>
  SECRET_PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);

/* ──────────────────────────── JSON ──────────────────────────── */

const isSpace = (c: string | undefined): boolean =>
  c === ' ' || c === '\n' || c === '\r' || c === '\t';

/** Vị trí ngay sau dấu nháy đóng của chuỗi bắt đầu ở `start` (bỏ qua `\"`); chuỗi dở ⇒ cuối text. */
const stringEnd = (text: string, start: number): number => {
  for (let i = start + 1; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') i += 1;
    else if (c === '"') return i + 1;
  }
  return text.length;
};

/** Vị trí ngay sau `]`/`}` đóng khối bắt đầu ở `start` (hiểu chuỗi); khối dở ⇒ cuối text. */
const blockEnd = (text: string, start: number): number => {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      i = stringEnd(text, i);
      continue;
    }
    if (c === '[' || c === '{') depth += 1;
    else if (c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return text.length;
};

const LITERAL_END = /[\s,\]}]/;

/**
 * Che giá trị của mọi khoá `"tên":` có tên bí mật, ở **bất kỳ đâu** trong chữ — không cần cả chuỗi
 * là JSON hợp lệ, nên chạy được trên thân đã cắt (`…+N`) và trên dòng console có JSON ở giữa.
 * Chuỗi và số ⇒ `"<redacted>"`; mảng ⇒ `"<redacted>"` cả mảng; object ⇒ đi tiếp vào trong (khoá con
 * tự được xét); `null`/`true`/`false` giữ nguyên ("token là null" là thông tin gỡ lỗi, không phải bí
 * mật). Không parse rồi stringify lại: giữ nguyên định dạng, thứ tự khoá và số lớn (ID > 2^53).
 */
const redactJsonKeys = (text: string): string => {
  const parts: string[] = [];
  let last = 0;
  let i = text.indexOf('"');
  while (i !== -1) {
    const end = stringEnd(text, i);
    let j = end;
    while (isSpace(text[j])) j += 1;
    if (text[j] !== ':' || !isSecretName(text.slice(i + 1, end - 1))) {
      i = text.indexOf('"', end);
      continue;
    }
    j += 1;
    while (isSpace(text[j])) j += 1;
    if (j >= text.length) break;
    const c = text[j];
    let valueEnd: number | undefined;
    if (c === '"') valueEnd = stringEnd(text, j);
    else if (c === '[') valueEnd = blockEnd(text, j);
    else if (c !== '{') {
      let k = j;
      while (k < text.length && !LITERAL_END.test(text[k])) k += 1;
      const literal = text.slice(j, k);
      if (literal !== '' && literal !== 'null' && literal !== 'true' && literal !== 'false') {
        valueEnd = k;
      }
    }
    if (valueEnd === undefined) {
      i = text.indexOf('"', j);
      continue;
    }
    parts.push(text.slice(last, j), `"${REDACTED}"`);
    last = valueEnd;
    i = text.indexOf('"', valueEnd);
  }
  if (last === 0) return text;
  parts.push(text.slice(last));
  return parts.join('');
};

/* ───────────────────────── Form / query ───────────────────────── */

/**
 * Thân `application/x-www-form-urlencoded`: `k=v&k2=v2`, không khoảng trắng.
 *
 * ⚠️ Khuôn này **một mình** không phân biệt được form với JSON nén: `{"refreshToken":"dGVzdA=="}` (không
 * khoảng trắng, không `&`, có `=` của đệm base64) cũng khớp. Luôn xét {@link JSON_START} trước.
 */
const FORM_BODY = /^[^=&\s]+=[^&\s]*(?:&[^=&\s]+=[^&\s]*)*$/;

/**
 * Thân JSON object/mảng (kể cả khi đã bị cắt `…+N`): ký tự đầu không phải khoảng trắng là `{` hoặc
 * `[`. Tên tham số form không bao giờ bắt đầu như vậy, nên thân này **không bao giờ** đi đường form —
 * tách JSON theo `&`/`=` vừa bỏ sót khoá bí mật vừa cắt mất đuôi JSON.
 */
const JSON_START = /^\s*[[{]/;

const decodeName = (raw: string): string => {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
};

/** Che giá trị của tham số có tên bí mật trong `k=v&k2=v2`; cặp không có `=` giữ nguyên. */
const redactParams = (params: string, extraExact?: ReadonlySet<string>): string =>
  params
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq <= 0) return pair;
      const name = pair.slice(0, eq);
      return isSecretName(decodeName(name), extraExact) ? `${name}=${REDACTED}` : pair;
    })
    .join('&');

/* ───────────────────────────── API ───────────────────────────── */

/**
 * **Chức năng:** che giá trị của những header mang bí mật, giữ nguyên phần còn lại.
 *
 * Tên header đi qua cùng quy tắc tên với khoá JSON (`authorization`, `cookie`, `set-cookie`,
 * `x-api-key`, `x-access-token`, `x-csrf-token`, `x-amz-security-token`, `x-goog-api-key`,
 * `x-session-id`… và tên app thêm qua `redactKeys`). Header gỡ lỗi (`content-type`,
 * `x-request-id`, `traceparent`) giữ nguyên. Giá trị của header thường vẫn qua lớp mẫu (JWT…).
 *
 * **Input:** `headers` — map tên → giá trị, tên viết hoa/thường tuỳ ý.
 * **Output:** map **mới**, header bí mật có giá trị `'<redacted>'`; map rỗng vào ⇒ map rỗng ra.
 *
 * ⚠️ `toCurl` **không** gọi hàm này — curl cần header thật mới chạy được. Xem bảng chính sách
 * ở đầu file.
 *
 * @example
 * ```ts
 * redactHeaders({ Authorization: 'Bearer abc', 'Content-Type': 'application/json' });
 * // { Authorization: '<redacted>', 'Content-Type': 'application/json' }
 * redactHeaders({ 'X-Access-Token': 't', 'X-Request-Id': 'r' }); // { 'X-Access-Token': '<redacted>', 'X-Request-Id': 'r' }
 * redactHeaders({ AUTHORIZATION: 'x' });   // ca biên: khớp không phân biệt hoa thường
 * ```
 *
 * **Unit test:** `redact.test.ts` › `redactHeaders` — che `Authorization` · không đụng
 * `Content-Type` · khớp bất kể hoa thường · map rỗng trả map rỗng · che theo tên (x-access-token,
 * csrf, amz, goog, api-key, session) mà giữ header gỡ lỗi.
 */
export const redactHeaders = (
  headers: Record<string, string>,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = isSecretName(name) ? REDACTED : redactPatterns(value);
  }
  return out;
};

/**
 * **Chức năng:** che bí mật trong thân request/response.
 *
 * - Thân JSON object/mảng (bắt đầu bằng `{`/`[`, kể cả đã bị cắt) ⇒ **không bao giờ** đi đường form.
 * - Thân form (`a=1&password=x`) ⇒ che theo tên tham số.
 * - **Mọi** thân ⇒ che giá trị của mọi khoá JSON có tên bí mật (camelCase, snake_case, lồng nhau, số,
 *   mảng; xem `redactJsonKeys`), kể cả khi thân đã bị cắt dở và cả JSON thô nằm trong giá trị form.
 * - Sau đó che theo mẫu giá trị (JWT, `Bearer …`, token có tiền tố đã biết) ở mọi chỗ.
 *
 * 🔄 18/11/2026: trước đây chỉ dựa vào khuôn form. JSON nén có `=` (token base64 có đệm,
 * `{"refreshToken":"dGVzdA=="}`) khớp khuôn đó, bị tách thành một tham số tên `{"refreshToken":"dGVzdA`
 * và token ra ngoài nguyên vẹn (file phiên, `errors.txt`, nút Chia sẻ).
 *
 * ⚠️ **Chỉ che, KHÔNG cắt.** Cắt là việc của [`truncate`](#truncate) và xảy ra ở tầng khác:
 * cắt lúc **ghi** (chặn bộ đệm phình), che lúc **xuất** (xem bảng chính sách ở đầu file).
 *
 * **Input:** `body` — chuỗi thân; không phải chuỗi hoặc rỗng ⇒ `undefined`.
 * **Output:** chuỗi đã che, giữ nguyên định dạng; `undefined` vào ⇒ `undefined` ra (hàng không có
 * thân thì đừng vẽ ô thân rỗng).
 *
 * @example
 * ```ts
 * redactBody('{"password":"123","id":7}');           // '{"password":"<redacted>","id":7}'
 * redactBody('{"accessToken":"a","token_type":"Bearer"}'); // accessToken che, token_type giữ
 * redactBody('grant_type=password&password=x');      // 'grant_type=password&password=<redacted>'
 * redactBody('{"refreshToken":"dGVzdA=="}');          // ca biên: JSON nén có `=` ⇒ '{"refreshToken":"<redacted>"}'
 * redactBody(undefined);                              // ca biên: undefined
 * ```
 *
 * **Unit test:** `redact.test.ts` › `redactBody`, `redactBody — tên khoá ngoài đời` và `redactBody —
 * JSON nén có `=` không bị coi là thân form` — snake_case và camelCase · lồng nhau · số, mảng,
 * `null`/boolean giữ · nháy thoát · khoảng trắng · thân cắt dở · không che khoá phân trang/hết hạn ·
 * form · JWT ngoài JSON · khoá thường không đụng · rỗng · base64 có đệm trong JSON nén, lồng nhau,
 * mảng, thân cắt · chuỗi JSON có `&`/`=` giữ nguyên · form thật vẫn che theo tên · JSON thô trong giá
 * trị form. Đường ghi đĩa và `errors.txt`: `log-session.test.ts`, `format-error-report.test.ts`,
 * `bug-report.test.ts`.
 */
export const redactBody = (body: string | undefined): string | undefined => {
  if (typeof body !== 'string' || body.length === 0) return undefined;
  const params = !JSON_START.test(body) && FORM_BODY.test(body) ? redactParams(body) : body;
  return redactPatterns(redactJsonKeys(params));
};

/**
 * **Chức năng:** che bí mật trong một URL trước khi nó rời máy (khối Chia sẻ, `errors.txt`, phiên
 * ghi đĩa): `user:pass@`, tham số query và fragment có tên bí mật (thêm `code`, `key`, `sig` riêng
 * cho URL: mã OAuth, khoá Google, chữ ký SAS/S3), khoá JSON bí mật trong JSON **thô** nằm trong URL
 * (URL ghép tay, `?state={"refreshToken":"…"}`; JSON đã mã hoá `%7B%22…` thì không), rồi mẫu giá trị
 * (JWT trong đường dẫn, đường dẫn webhook Slack/Lark).
 *
 * **Input:** `url` — chuỗi URL bất kỳ (tuyệt đối, tương đối, scheme riêng của app).
 * **Output:** URL đã che; không có gì bí mật ⇒ trả lại y nguyên.
 *
 * @example
 * ```ts
 * redactUrl('https://a.vn/me?access_token=x&page=2'); // 'https://a.vn/me?access_token=<redacted>&page=2'
 * redactUrl('acme://cb?code=c#access_token=t');       // 'acme://cb?code=<redacted>#access_token=<redacted>'
 * redactUrl('https://a.vn/orders?page=2');            // ca biên: giữ nguyên
 * ```
 *
 * **Unit test:** `redact.test.ts` › `redactUrl` — 7 case: query · URL ký sẵn S3 · `user:pass@` ·
 * callback OAuth (code, fragment) · đường dẫn webhook Slack/Lark · JSON thô trong query và fragment ·
 * URL thường giữ nguyên.
 */
export const redactUrl = (url: string): string => {
  if (typeof url !== 'string' || url === '') return url;
  const noUser = url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@\s]+@/i, `$1${REDACTED}@`);
  const hash = noUser.indexOf('#');
  const beforeHash = hash === -1 ? noUser : noUser.slice(0, hash);
  const fragment = hash === -1 ? undefined : noUser.slice(hash + 1);
  const q = beforeHash.indexOf('?');
  const path = q === -1 ? beforeHash : beforeHash.slice(0, q);
  const query = q === -1 ? undefined : beforeHash.slice(q + 1);
  const out =
    path +
    (query === undefined ? '' : `?${redactParams(query, URL_EXTRA_EXACT)}`) +
    (fragment === undefined
      ? ''
      : `#${fragment.includes('=') ? redactParams(fragment, URL_EXTRA_EXACT) : fragment}`);
  /* Tham số chỉ được xét theo tên: JSON thô trong giá trị (hoặc cả fragment là JSON) cần đường khoá. */
  return redactPatterns(redactJsonKeys(out));
};

/**
 * **Chức năng:** che bí mật trong chữ tự do — dòng console, câu lỗi, nhãn: JSON in ở giữa câu (khoá
 * có tên bí mật) và mẫu giá trị (JWT, `Bearer …`, token có tiền tố đã biết).
 *
 * **Input:** `text` — chuỗi bất kỳ.
 * **Output:** chuỗi đã che; không có gì để che ⇒ trả lại **đúng chuỗi đó** (so `===` được).
 *
 * @example
 * ```ts
 * redactText('login {"accessToken":"a1"}');          // 'login {"accessToken":"<redacted>"}'
 * redactText('Authorization: Bearer abcdefghijklmnop'); // 'Authorization: Bearer <redacted>'
 * redactText('Token refreshed successfully');        // ca biên: giữ nguyên
 * ```
 *
 * **Unit test:** `redact.test.ts` › `redactText` — 3 case: JSON trong console · JWT, Bearer dài,
 * token có tiền tố · câu thường có chữ Token/Bearer giữ nguyên.
 */
export const redactText = (text: string): string =>
  typeof text === 'string' && text !== '' ? redactPatterns(redactJsonKeys(text)) : text;

/**
 * **Chức năng:** cắt thân request cho vừa hạn mức bộ nhớ, và **nói ra** là đã cắt.
 *
 * Cắt bằng **ký tự**, không bằng byte: mục đích là chặn bộ đệm phình chứ không phải đo đúng
 * dung lượng, và đếm byte UTF-8 cho mỗi request là chi phí vô ích trên luồng JS của app.
 *
 * Trả kèm cờ `truncated` chứ không để người đọc dò hậu tố trong chuỗi: một thân JSON bị cắt
 * giữa chừng là **JSON hỏng**, và nơi hiện nó phải nói ra — màn chi tiết request in câu "thân đã
 * bị cắt bớt", file xuất ghi `(truncated)`. `toCurl` thì cố ý **không** chèn cảnh báo vào lệnh
 * (giữ lệnh import được vào Postman — xem JSDoc của nó); dấu `…+N` trong thân là dấu hiệu duy nhất.
 *
 * **Input:** `body` — chuỗi thân · `limit` — số ký tự tối đa.
 * **Output:** `{ text, truncated }`; `undefined`/rỗng vào ⇒ `{ text: undefined, truncated: false }`.
 *
 * @example
 * ```ts
 * truncate('abc', 10);            // { text: 'abc', truncated: false }
 * truncate('x'.repeat(20), 10);   // { text: 'xxxxxxxxxx…+10', truncated: true }
 * truncate('abc', 3);             // ca biên: vừa đúng hạn mức ⇒ KHÔNG cắt
 * ```
 *
 * **Unit test:** `redact.test.ts` › `truncate` — 4 case: dưới hạn mức giữ nguyên và
 * `truncated: false` · vượt hạn mức có hậu tố `…+N` và `truncated: true` · vừa đúng hạn mức
 * không cắt · `undefined` ⇒ `{ text: undefined, truncated: false }`.
 */
export const truncate = (
  body: string | undefined,
  limit: number,
): { text: string | undefined; truncated: boolean } => {
  if (typeof body !== 'string' || body.length === 0) {
    return { text: undefined, truncated: false };
  }
  if (body.length <= limit) return { text: body, truncated: false };
  /*
    Hậu tố `…+<số>` là **dấu hiệu trung lập ngôn ngữ**, không phải câu. Cùng lý do với
    `REDACTED`: chuỗi này nằm trong dữ liệu sẽ được chép ra ngoài, nên nó không được đổi
    theo ngôn ngữ app — và hàm thuần ngoài React cũng không có `t()`.
  */
  return {
    text: `${body.slice(0, limit)}…+${body.length - limit}`,
    truncated: true,
  };
};
