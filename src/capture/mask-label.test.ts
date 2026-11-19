import { maskPersonalData } from './mask-label';

describe('maskPersonalData', () => {
  /* Tiêu đề, "Thực tế" và bước của báo bug lấy dòng đầu của lỗi qua hàm này, nên token trong
     câu lỗi (`console.error('refresh failed', token)`) phải bị che ở đây trước khi vào Jira. */
  it('che JWT và token có tiền tố đã biết trong câu lỗi', () => {
    expect(
      maskPersonalData(
        'refresh failed eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl xoxb-000000000000-fakefakefake',
      ),
    ).toBe('refresh failed <redacted> <redacted>');
  });

  it('che số điện thoại có dấu cách, giữ 3 ký tự cuối', () => {
    expect(maskPersonalData('Nguyễn Văn A · 0912 345 678')).toBe('Nguyễn Văn A · •••678');
  });

  it('che email, giữ 3 ký tự cuối', () => {
    expect(maskPersonalData('qa.lan@khachhang.vn')).toBe('•••.vn');
  });

  it('giữ nguyên số ngắn hơn 6 chữ số', () => {
    expect(maskPersonalData('Mã 12345')).toBe('Mã 12345');
  });

  it('giữ nguyên chữ thường', () => {
    expect(maskPersonalData('Thanh toán')).toBe('Thanh toán');
  });

  it('che chuỗi số liền và chuỗi số xen dấu chấm', () => {
    expect(maskPersonalData('CCCD 012345678901')).toBe('CCCD •••901');
    expect(maskPersonalData('Giá 1.250.000')).toBe('Giá •••000');
  });

  it('che chuỗi số xen gạch nối (số điện thoại, số thẻ quốc tế)', () => {
    expect(maskPersonalData('Gọi 0912-345-678')).toBe('Gọi •••678');
    expect(maskPersonalData('Call +1-555-123-4567')).toBe('Call +•••567');
    expect(maskPersonalData('Card 4111-1111-1111-1111')).toBe('Card •••111');
    expect(maskPersonalData('Mã 12-345')).toBe('Mã 12-345');
  });

  it('che đúng chuỗi 6 chữ số, không che 5 chữ số', () => {
    expect(maskPersonalData('OTP 123456')).toBe('OTP •••456');
    expect(maskPersonalData('OTP 12345')).toBe('OTP 12345');
  });

  it('che nhiều thứ trong một nhãn, giữ phần còn lại', () => {
    expect(maskPersonalData('Gửi tới a.b@c.com hoặc 0987654321 nhé')).toBe('Gửi tới •••com hoặc •••321 nhé');
  });

  it('không nuốt dấu câu đứng sau email', () => {
    expect(maskPersonalData('Mail qa@x.vn.')).toBe('Mail •••.vn.');
  });

  it('chuỗi rỗng trả chuỗi rỗng', () => {
    expect(maskPersonalData('')).toBe('');
  });
});
