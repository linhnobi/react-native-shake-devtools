import { makeUploadPart, tempFileName } from './upload';

/** FormData thật của RN (bản JS) — chính lớp `fetch`/XHR của RN đưa xuống native. */
const RNFormData: new () => {
  append(key: string, value: unknown): void;
  getParts(): Array<Record<string, unknown>>;
} = jest.requireActual('react-native/Libraries/Network/FormData').default;

describe('makeUploadPart', () => {
  it('file có `uri` ⇒ { uri, name, type } và không ghi file tạm', async () => {
    const writeTempFile = jest.fn();
    const part = makeUploadPart({ writeTempFile, reportId: 'rpt-1' });

    await expect(
      part({ name: 'shot.png', mimeType: 'image/png', uri: 'file:///cache/shot.png' }),
    ).resolves.toEqual({ uri: 'file:///cache/shot.png', name: 'shot.png', type: 'image/png' });
    expect(writeTempFile).not.toHaveBeenCalled();
  });

  it('file có `content` và có `writeTempFile` ⇒ ghi dưới tên RIÊNG của bản báo (`<reportId>-<tên>`), tên phần upload vẫn là tên gốc', async () => {
    const writeTempFile = jest.fn().mockResolvedValue('file:///tmp/rpt-1-errors.txt');
    const part = makeUploadPart({ writeTempFile, reportId: 'rpt-1' });

    await expect(
      part({ name: 'errors.txt', mimeType: 'text/plain', content: 'boom' }),
    ).resolves.toEqual({
      uri: 'file:///tmp/rpt-1-errors.txt',
      name: 'errors.txt',
      type: 'text/plain',
    });
    expect(writeTempFile).toHaveBeenCalledWith('rpt-1-errors.txt', 'boom');
  });

  it('file có `content` mà không có `writeTempFile` ⇒ phần chuỗi trong bộ nhớ của RN `{ string, name, type }` — không bao giờ Blob', async () => {
    const part = await makeUploadPart({ reportId: 'rpt-1' })({
      name: 'errors.txt',
      mimeType: 'text/plain',
      content: 'lỗi',
    });

    expect(part).not.toBeInstanceOf(Blob);
    expect(part).toEqual({ string: 'lỗi', name: 'errors.txt', type: 'text/plain' });

    /* FormData của RN: phần chuỗi mang `filename` + `content-type` — dạng native Android/iOS gửi được. */
    const form = new RNFormData();
    form.append('file', part);
    const [sent] = form.getParts();
    expect(sent.string).toBe('lỗi');
    expect(sent.headers).toEqual({
      'content-disposition': 'form-data; name="file"; filename="errors.txt"',
      'content-type': 'text/plain',
    });
    expect(sent).not.toHaveProperty('uri');
  });

  it('`uri` thắng `content` khi file có cả hai', async () => {
    const writeTempFile = jest.fn();

    await expect(
      makeUploadPart({ writeTempFile, reportId: 'rpt-1' })({
        name: 'a.txt',
        mimeType: 'text/plain',
        uri: 'file:///a.txt',
        content: 'x',
      }),
    ).resolves.toEqual({ uri: 'file:///a.txt', name: 'a.txt', type: 'text/plain' });
    expect(writeTempFile).not.toHaveBeenCalled();
  });

  it('`writeTempFile` ném ⇒ lỗi được truyền ra, không lặng lẽ rơi về phần chuỗi', async () => {
    const writeTempFile = jest.fn().mockRejectedValue(new Error('disk full'));

    await expect(
      makeUploadPart({ writeTempFile, reportId: 'rpt-1' })({
        name: 'a.txt',
        mimeType: 'text/plain',
        content: 'x',
      }),
    ).rejects.toThrow('disk full');
  });

  it('file không có `uri` lẫn `content` ⇒ ném lỗi nêu tên file', async () => {
    await expect(
      makeUploadPart({ reportId: 'rpt-1' })({ name: 'ghost.png', mimeType: 'image/png' }),
    ).rejects.toThrow('ghost.png');
  });
});

describe('tempFileName', () => {
  it('`<reportId>-<tên>`; ký tự ngoài [A-Za-z0-9._-] (dấu `/`, `\\`, khoảng trắng…) thành `_`', () => {
    expect(tempFileName('rpt-mhn3k2xs-4fz9qa', 'errors.txt')).toBe('rpt-mhn3k2xs-4fz9qa-errors.txt');
    expect(tempFileName('rpt/../x', 'a b\\c.txt')).toBe('rpt_.._x-a_b_c.txt');
  });
});
