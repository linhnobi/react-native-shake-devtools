import { createHash, createHmac } from 'crypto';
import { base64, base64Utf8, hmacSha256, sha256, utf8Bytes } from './encoding';

/** Oracle: hex của một dãy byte. */
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));
/** Dãy byte giả ngẫu nhiên nhưng xác định (LCG) — không phụ thuộc `Math.random`. */
const pseudo = (n: number) => {
  const out = new Uint8Array(n);
  let x = 123456789;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
};

describe('utf8Bytes', () => {
  it('khớp Buffer với ASCII, chữ có dấu, CJK và emoji (cặp thay thế)', () => {
    for (const s of [
      '',
      'abc',
      'Nguyễn Văn Á',
      '漢字かな',
      '🔑 key 🚀',
      '\u0000\u007f\u0080߿ࠀ￿',
    ]) {
      expect(hex(utf8Bytes(s))).toBe(hex(bytes(s)));
    }
  });

  it('surrogate lẻ thành U+FFFD như Buffer', () => {
    for (const s of ['\ud83d', 'a\udc00b', '\ud83dx', '\udc00\ud83d']) {
      expect(hex(utf8Bytes(s))).toBe(hex(bytes(s)));
    }
  });
});

describe('base64Utf8', () => {
  it('Basic auth mẫu: a@b.com:tok', () => {
    expect(base64Utf8('a@b.com:tok')).toBe('YUBiLmNvbTp0b2s=');
  });

  it('chuỗi Unicode bằng base64 của byte UTF-8', () => {
    const s = 'Nguyễn:🔑';
    expect(base64Utf8(s)).toBe(Buffer.from(s, 'utf8').toString('base64'));
  });
});

describe('base64', () => {
  it('đệm `=` đúng cho độ dài 0..7 byte và đủ 256 giá trị byte', () => {
    for (let n = 0; n <= 7; n++) {
      const b = pseudo(n);
      expect(base64(b)).toBe(Buffer.from(b).toString('base64'));
    }
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(base64(all)).toBe(Buffer.from(all).toString('base64'));
  });
});

describe('sha256', () => {
  it('chuỗi rỗng', () => {
    expect(hex(sha256(utf8Bytes('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it("'abc'", () => {
    expect(hex(sha256(utf8Bytes('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('vector hai khối của NIST (56 byte buộc đệm sang khối thứ hai)', () => {
    expect(
      hex(sha256(utf8Bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('khớp crypto của Node ở mọi độ dài quanh biên khối 55..65 byte', () => {
    for (let n = 55; n <= 65; n++) {
      const b = pseudo(n);
      expect(hex(sha256(b))).toBe(createHash('sha256').update(b).digest('hex'));
    }
  });

  it('đầu vào 64 byte khớp crypto của Node', () => {
    const b = pseudo(64);
    expect(hex(sha256(b))).toBe(createHash('sha256').update(b).digest('hex'));
  });

  it('đầu vào 1 MB khớp crypto của Node', () => {
    const b = pseudo(1024 * 1024);
    expect(hex(sha256(b))).toBe(createHash('sha256').update(b).digest('hex'));
  });
});

describe('hmacSha256', () => {
  it('RFC 4231 ca 1 (khoá 20 byte 0x0b)', () => {
    expect(hex(hmacSha256(new Uint8Array(20).fill(0x0b), utf8Bytes('Hi There')))).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
  });

  it('RFC 4231 ca 2 (khoá "Jefe")', () => {
    expect(hex(hmacSha256(utf8Bytes('Jefe'), utf8Bytes('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('RFC 4231 ca 6 (khoá 131 byte dài hơn khối ⇒ băm khoá trước)', () => {
    expect(
      hex(
        hmacSha256(
          new Uint8Array(131).fill(0xaa),
          utf8Bytes('Test Using Larger Than Block-Size Key - Hash Key First'),
        ),
      ),
    ).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });

  it('khoá rỗng và khoá đúng 64 byte khớp crypto của Node', () => {
    const msg = pseudo(100);
    for (const key of [new Uint8Array(0), pseudo(64)]) {
      expect(hex(hmacSha256(key, msg))).toBe(createHmac('sha256', key).update(msg).digest('hex'));
    }
  });

  it('thông điệp 64 byte và 1 MB khớp crypto của Node', () => {
    const key = pseudo(32);
    for (const msg of [pseudo(64), pseudo(1024 * 1024)]) {
      expect(hex(hmacSha256(key, msg))).toBe(createHmac('sha256', key).update(msg).digest('hex'));
    }
  });
});
