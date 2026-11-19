import { createHmac } from 'crypto';
import { larkSign } from './sign';

/** Đối chiếu: khoá `${timestamp}\n${secret}` (UTF-8), thông điệp rỗng, base64. */
const reference = (secret: string, timestampSec: number): string =>
  createHmac('sha256', Buffer.from(`${timestampSec}\n${secret}`, 'utf8'))
    .update(Buffer.alloc(0))
    .digest('base64');

describe('larkSign', () => {
  it('khớp crypto.createHmac của Node với hai bộ giá trị ASCII', () => {
    expect(larkSign('demo-secret', 1599360473)).toBe(reference('demo-secret', 1599360473));
    expect(larkSign('abc123XYZ', 1700000000)).toBe(reference('abc123XYZ', 1700000000));
  });

  it('trả base64 hợp lệ của 32 byte (44 ký tự)', () => {
    const sign = larkSign('s', 1);
    expect(sign).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it('secret tiếng Việt có dấu và emoji: HMAC tính trên UTF-8 (Review Focus 2)', () => {
    const secret = 'Bí mật Việt Nam 🔐 đ';
    expect(larkSign(secret, 1599360473)).toBe(reference(secret, 1599360473));
    expect(larkSign(secret, 1599360473)).not.toBe(larkSign('Bi mat Viet Nam', 1599360473));
  });

  it('timestamp khác ⇒ chữ ký khác', () => {
    expect(larkSign('k', 1)).not.toBe(larkSign('k', 2));
  });
});
