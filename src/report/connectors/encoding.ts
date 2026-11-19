/**
 * Mã hoá dùng chung cho các connector gửi báo cáo lỗi (Jira, Lark): base64 của UTF-8 cho header
 * `Authorization: Basic …`, SHA-256 và HMAC-SHA256 để ký request.
 *
 * Viết bằng TS thuần vì thư viện **không có dependency runtime** và Hermes của RN 0.76 không đảm
 * bảo có `btoa`/`atob`/`TextEncoder`, càng không có `Buffer`/`crypto` của Node. Mọi hàm chỉ dùng
 * `Uint8Array` + số học 32 bit, nên chạy giống hệt trên Hermes, JSC và Node.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * **Chức năng:** mã hoá chuỗi JS (UTF-16) thành dãy byte UTF-8 — thay `TextEncoder`.
 *
 * Cặp surrogate hợp lệ thành một code point 4 byte (emoji); surrogate lẻ thành U+FFFD (`EF BF BD`)
 * đúng như `TextEncoder`/`Buffer`, thay vì ném lỗi hay sinh byte sai.
 *
 * **Input:** `s` — chuỗi bất kỳ (kể cả rỗng).
 *
 * **Output:** `Uint8Array` các byte UTF-8.
 *
 * @example
 * utf8Bytes('é'); // Uint8Array [0xc3, 0xa9]
 * utf8Bytes('🔑'); // Uint8Array [0xf0, 0x9f, 0x94, 0x91]
 *
 * **Unit test:** `encoding.test.ts` — 2 case: khớp `Buffer` với ASCII/chữ có dấu/CJK/emoji ·
 * surrogate lẻ thành U+FFFD.
 */
export function utf8Bytes(s: string): Uint8Array {
  // Tối đa 3 byte cho mỗi đơn vị UTF-16 (cặp surrogate: 4 byte cho 2 đơn vị ⇒ vẫn ≤ 3/đơn vị).
  const out = new Uint8Array(s.length * 3);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else {
        c = 0xfffd;
      }
    }
    if (c < 0x80) {
      out[n++] = c;
    } else if (c < 0x800) {
      out[n++] = 0xc0 | (c >> 6);
      out[n++] = 0x80 | (c & 0x3f);
    } else if (c < 0x10000) {
      out[n++] = 0xe0 | (c >> 12);
      out[n++] = 0x80 | ((c >> 6) & 0x3f);
      out[n++] = 0x80 | (c & 0x3f);
    } else {
      out[n++] = 0xf0 | (c >> 18);
      out[n++] = 0x80 | ((c >> 12) & 0x3f);
      out[n++] = 0x80 | ((c >> 6) & 0x3f);
      out[n++] = 0x80 | (c & 0x3f);
    }
  }
  return out.slice(0, n);
}

/**
 * **Chức năng:** base64 chuẩn (RFC 4648, bảng `+/`, đệm `=`) của một dãy byte — thay `btoa`.
 *
 * **Input:** `bytes` — dữ liệu thô.
 *
 * **Output:** chuỗi base64, độ dài luôn là bội của 4.
 *
 * @example
 * base64(new Uint8Array([0x4d, 0x61])); // 'TWE='
 *
 * **Unit test:** `encoding.test.ts` — 1 case: đệm `=` đúng cho 0..7 byte và đủ 256 giá trị byte,
 * đối chiếu `Buffer`.
 */
export function base64(bytes: Uint8Array): string {
  let out = '';
  const full = bytes.length - (bytes.length % 3);
  for (let i = 0; i < full; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - full;
  if (rest === 1) {
    const n = bytes[full]! << 16;
    out += B64[n >> 18] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[full]! << 16) | (bytes[full + 1]! << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

/**
 * **Chức năng:** base64 của chuỗi **sau khi** mã hoá UTF-8 — dùng cho `Authorization: Basic`
 * (`email:token`), đúng cả khi email/tên có dấu hay emoji (khác `btoa` chỉ nhận Latin-1).
 *
 * **Input:** `s` — chuỗi bất kỳ.
 *
 * **Output:** chuỗi base64.
 *
 * @example
 * base64Utf8('a@b.com:tok'); // 'YUBiLmNvbTp0b2s='
 *
 * **Unit test:** `encoding.test.ts` — 2 case: mẫu Basic auth `a@b.com:tok` · `Nguyễn:🔑` khớp
 * base64 của byte UTF-8 do `Buffer` tính.
 */
export function base64Utf8(s: string): string {
  return base64(utf8Bytes(s));
}

/** 64 hằng số vòng của SHA-256 (FIPS 180-4 §4.2.2). */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/**
 * **Chức năng:** băm SHA-256 (FIPS 180-4) của một dãy byte.
 *
 * Đệm theo chuẩn (`0x80`, số 0, độ dài bit 64-bit big-endian) rồi nén từng khối 64 byte. Độ dài bit
 * ghi bằng hai nửa 32-bit nên đúng với mọi đầu vào mà `Uint8Array` chứa được.
 *
 * **Input:** `bytes` — dữ liệu cần băm (không bị sửa).
 *
 * **Output:** `Uint8Array` 32 byte.
 *
 * @example
 * sha256(utf8Bytes('abc')); // hex 'ba7816bf…15ad'
 *
 * **Unit test:** `encoding.test.ts` — 6 case: chuỗi rỗng · `'abc'` · vector hai khối của NIST ·
 * độ dài 55..65 byte quanh biên khối · 64 byte · 1 MB (ba nhóm cuối đối chiếu `crypto` của Node).
 */
export function sha256(bytes: Uint8Array): Uint8Array {
  const len = bytes.length;
  // Tin nhắn + 0x80 + 8 byte độ dài, làm tròn lên bội của 64.
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(len / 0x20000000)); // len * 8 >>> 32
  view.setUint32(padded.length - 4, (len << 3) >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!;
      const w2 = w[i - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }

    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0;
    h[5] = (h[5]! + f) | 0;
    h[6] = (h[6]! + g) | 0;
    h[7] = (h[7]! + hh) | 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]!);
  return out;
}

/**
 * **Chức năng:** HMAC-SHA256 (RFC 2104 / RFC 4231) — chữ ký request của connector.
 *
 * Khoá dài hơn khối 64 byte được băm trước; khoá ngắn hơn thì đệm 0 bên phải.
 *
 * **Input:** `key` — khoá bí mật (độ dài bất kỳ, kể cả rỗng); `message` — dữ liệu cần ký.
 *
 * **Output:** `Uint8Array` 32 byte.
 *
 * @example
 * hmacSha256(utf8Bytes('Jefe'), utf8Bytes('what do ya want for nothing?')); // hex '5bdcc146…3843'
 *
 * **Unit test:** `encoding.test.ts` — 5 case: RFC 4231 ca 1 · ca 2 · ca 6 (khoá 131 byte) · khoá
 * rỗng và khoá 64 byte · thông điệp 64 byte và 1 MB (hai nhóm cuối đối chiếu `crypto` của Node).
 */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = new Uint8Array(64);
  block.set(key.length > 64 ? sha256(key) : key);

  const inner = new Uint8Array(64 + message.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    inner[i] = block[i]! ^ 0x36;
    outer[i] = block[i]! ^ 0x5c;
  }
  inner.set(message, 64);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}
