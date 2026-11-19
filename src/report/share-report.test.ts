import type { DevToolsExportFile, DevToolsShareFile } from '../gate/devtools-props';
import type { BugReport } from './bug-report';
import { shareReport } from './share-report';

const IMAGE = { name: 'screenshot.jpg', mimeType: 'image/jpeg', uri: 'file:///cache/shot.jpg' };
const ERRORS = { name: 'errors.txt', mimeType: 'text/plain', content: 'ERR boom' };
const TIMELINE = { name: 'timeline.json', mimeType: 'application/json', content: '[{"a":1}]' };

const report = (over: Partial<BugReport> = {}): BugReport => ({
  id: 'rpt-1',
  createdAt: 0,
  title: 'Crash khi thanh toán',
  steps: [
    { id: 'a', kind: 'screen', at: 1, label: 'Cart' },
    { id: 'b', kind: 'tap', at: 2, label: 'Pay', count: 2 },
  ],
  actual: 'POST /orders → 500',
  expected: 'Thanh toán thành công',
  deviceInfo: [['App', '1.2.3']],
  files: [IMAGE, ERRORS, TIMELINE],
  ...over,
});

const setup = () => {
  const shareFiles = jest.fn<Promise<void>, [readonly DevToolsShareFile[], string]>(() =>
    Promise.resolve(),
  );
  const exportFile = jest.fn<Promise<void>, [DevToolsExportFile]>(() => Promise.resolve());
  const share = jest.fn<Promise<unknown>, [string]>(() => Promise.resolve({ action: 'shared' }));
  return { shareFiles, exportFile, share };
};

describe('shareReport', () => {
  it('có shareFiles: một lần gọi với mọi file (ảnh theo uri, chữ theo content), không bỏ ảnh', async () => {
    const d = setup();

    const result = await shareReport(report(), { locale: 'vi', ...d });

    expect(result).toEqual({ droppedImage: false });
    expect(d.shareFiles).toHaveBeenCalledTimes(1);
    const [files, message] = d.shareFiles.mock.calls[0];
    /* Tên người nhận thấy giữ nguyên (R47/N3) — chỉ đường gửi mới ghi tạm dưới tên riêng của bản báo. */
    expect(files).toEqual([IMAGE, ERRORS, TIMELINE]);
    expect(message).toContain('Crash khi thanh toán');
    expect(message).toContain('Mở màn Cart');
    expect(d.exportFile).not.toHaveBeenCalled();
    expect(d.share).not.toHaveBeenCalled();
  });

  it('tin nhắn dựng theo locale: vi và en', async () => {
    const vi = setup();
    const en = setup();

    await shareReport(report(), { locale: 'vi', ...vi });
    await shareReport(report(), { locale: 'en', ...en });

    const viMsg = vi.shareFiles.mock.calls[0][1];
    const enMsg = en.shareFiles.mock.calls[0][1];
    expect(viMsg).toContain('Crash khi thanh toán');
    expect(viMsg).toContain('Các bước');
    expect(viMsg).toContain('Mở màn Cart');
    expect(viMsg).toContain('Chạm "Pay" ×2');
    expect(viMsg).toContain('Kết quả thực tế');
    expect(viMsg).toContain('POST /orders → 500');
    expect(viMsg).toContain('Kết quả mong đợi');
    expect(viMsg).toContain('Thanh toán thành công');
    expect(viMsg).toContain('Môi trường');
    expect(viMsg).toContain('Ứng dụng: 1.2.3');
    expect(enMsg).toContain('Steps to reproduce');
    expect(enMsg).toContain('Open screen Cart');
    expect(enMsg).toContain('Actual result');
    expect(enMsg).toContain('Expected result');
    expect(enMsg).toContain('Environment');
    expect(enMsg).not.toContain('Các bước');
  });

  it('thiếu expected và deviceInfo: tin nhắn không có mục đó', async () => {
    const d = setup();

    await shareReport(report({ expected: undefined, deviceInfo: undefined }), {
      locale: 'en',
      ...d,
    });

    const message = d.shareFiles.mock.calls[0][1];
    expect(message).not.toContain('Expected result');
    expect(message).not.toContain('Environment');
    expect(message).not.toContain('App context');
  });

  it('có ngữ cảnh app: tin nhắn có mục "App context" (khoá: giá trị, dòng "…and N more") ở cuối', async () => {
    const d = setup();

    await shareReport(
      report({ appContext: { lines: [['userId', 'u-42']], more: 2 } }),
      { locale: 'en', ...d },
    );

    const message = d.shareFiles.mock.calls[0][1];
    expect(message.endsWith('App context:\nuserId: u-42\n…and 2 more keys')).toBe(true);
  });

  it('không có shareFiles, có exportFile: một file .txt gộp tin nhắn + file chữ, droppedImage true', async () => {
    const d = setup();

    const result = await shareReport(report(), {
      locale: 'en',
      exportFile: d.exportFile,
      share: d.share,
    });

    expect(result).toEqual({ droppedImage: true });
    expect(d.exportFile).toHaveBeenCalledTimes(1);
    const file = d.exportFile.mock.calls[0][0];
    expect(file.mimeType).toBe('text/plain');
    expect(file.name).toMatch(/^[A-Za-z0-9._-]+\.txt$/);
    expect(file.content).toContain('Crash khi thanh toán');
    expect(file.content).toContain('Open screen Cart');
    expect(file.content).toContain('errors.txt');
    expect(file.content).toContain('ERR boom');
    expect(file.content).toContain('timeline.json');
    expect(file.content).toContain('[{"a":1}]');
    expect(d.share).not.toHaveBeenCalled();
  });

  it('không có cả hai: share(tin nhắn + file chữ), droppedImage true', async () => {
    const d = setup();

    const result = await shareReport(report(), { locale: 'vi', share: d.share });

    expect(result).toEqual({ droppedImage: true });
    expect(d.share).toHaveBeenCalledTimes(1);
    const text = d.share.mock.calls[0][0];
    expect(text).toContain('Crash khi thanh toán');
    expect(text).toContain('Mở màn Cart');
    expect(text).toContain('ERR boom');
  });

  it('báo cáo không có ảnh: droppedImage false ở cả hai đường rơi', async () => {
    const noImage = report({ files: [ERRORS] });
    const a = setup();
    const b = setup();

    await expect(
      shareReport(noImage, { locale: 'en', exportFile: a.exportFile, share: a.share }),
    ).resolves.toEqual({ droppedImage: false });
    await expect(shareReport(noImage, { locale: 'en', share: b.share })).resolves.toEqual({
      droppedImage: false,
    });
    expect(a.exportFile).toHaveBeenCalledTimes(1);
    expect(b.share).toHaveBeenCalledTimes(1);
  });

  it('báo cáo không có file nào: vẫn chia sẻ tin nhắn, droppedImage false', async () => {
    const d = setup();

    const result = await shareReport(report({ files: [] }), { locale: 'en', share: d.share });

    expect(result).toEqual({ droppedImage: false });
    expect(d.share.mock.calls[0][0]).toContain('Crash khi thanh toán');
  });

  it('không bịa nội dung cho file có uri: đường rơi không đọc/ghi uri vào chữ', async () => {
    const d = setup();

    await shareReport(report(), { locale: 'en', exportFile: d.exportFile, share: d.share });
    await shareReport(report(), { locale: 'en', share: d.share });

    const exported = d.exportFile.mock.calls[0][0].content;
    const shared = d.share.mock.calls[0][0];
    for (const text of [exported, shared]) {
      expect(text).not.toContain('screenshot.jpg');
      expect(text).not.toContain('file:///cache/shot.jpg');
    }
  });


  it('shareFiles: file chuyển nguyên trạng, không thêm content cho ảnh hay uri cho file chữ', async () => {
    const d = setup();

    await shareReport(report(), { locale: 'en', shareFiles: d.shareFiles, share: d.share });

    const [files] = d.shareFiles.mock.calls[0];
    expect(files[0]).not.toHaveProperty('content');
    expect(files[1]).not.toHaveProperty('uri');
    expect(files[2]).not.toHaveProperty('uri');
  });

  it('lỗi từ shareFiles, exportFile, share lan ra cho UI', async () => {
    const a = setup();
    a.shareFiles.mockRejectedValueOnce(new Error('share failed'));
    await expect(
      shareReport(report(), { locale: 'en', shareFiles: a.shareFiles, share: a.share }),
    ).rejects.toThrow('share failed');
    expect(a.share).not.toHaveBeenCalled();

    const b = setup();
    b.exportFile.mockRejectedValueOnce(new Error('export failed'));
    await expect(
      shareReport(report(), { locale: 'en', exportFile: b.exportFile, share: b.share }),
    ).rejects.toThrow('export failed');
    expect(b.share).not.toHaveBeenCalled();

    const c = setup();
    c.share.mockRejectedValueOnce(new Error('rn share failed'));
    await expect(shareReport(report(), { locale: 'en', share: c.share })).rejects.toThrow(
      'rn share failed',
    );
  });
});
