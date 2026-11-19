import { act, renderHook } from '@testing-library/react-native';
import { Share } from 'react-native';
import type { ConsoleEntry, LogEntry, NetworkEntry } from '../capture/log-entry';
import { useLogExport } from './use-log-export';

const con = (id: number, level: ConsoleEntry['level'], text: string): ConsoleEntry => ({
  id,
  kind: 'console',
  at: 0,
  level,
  text,
});

const net = (id: number, status: number, url: string): NetworkEntry => ({
  id,
  kind: 'network',
  at: 0,
  method: 'GET',
  url,
  status,
});

const WITH_ERRORS: LogEntry[] = [
  net(1, 200, 'https://api.test/fine'),
  net(2, 500, 'https://api.test/broken'),
  con(3, 'info', 'just info'),
];

/** Một vòng macrotask — mọi microtask xếp trước nó đều đã chạy xong khi nó trả về. */
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/*
  Đợi `run` chạy hết: vòng thứ nhất nhả lượt `setTimeout(0)` mà `run` dùng để nhường khung hình,
  vòng thứ hai đợi cả chuỗi promise sau đó (dựng file → `exportFile` → `flash`). Timer THẬT cho các
  case này: fake timer của jest có thể giả luôn `setImmediate` mà polyfill Promise của preset RN dựa
  vào, và khi đó `await` không bao giờ trả về. Case cần giả giờ thì dùng `advanceTimersByTimeAsync`
  — hàm này nhả cả microtask lẫn timer.
*/
const flush = () =>
  act(async () => {
    await macrotask();
    await macrotask();
  });

let shareSpy: jest.SpyInstance;

beforeEach(() => {
  shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useLogExport', () => {
  it('0 lỗi ⇒ `run` không gọi gì, trạng thái vẫn `idle`', async () => {
    const exportFile = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useLogExport({ getEntries: () => [net(1, 200, '/ok')], exportFile }),
    );

    act(() => result.current.run());
    await flush();

    expect(exportFile).not.toHaveBeenCalled();
    expect(shareSpy).not.toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
  });

  it('có `exportFile` ⇒ gọi đúng một lần, tên `devtools-errors-*.txt`, nội dung chỉ gồm dòng lỗi', async () => {
    const exportFile = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useLogExport({ getEntries: () => WITH_ERRORS, build: 'UAT · 1.0.2', exportFile }),
    );

    act(() => result.current.run());
    await flush();

    expect(exportFile).toHaveBeenCalledTimes(1);
    const file = exportFile.mock.calls[0][0];
    expect(file.name).toMatch(/^devtools-errors-\d{8}-\d{6}\.txt$/);
    expect(file.mimeType).toBe('text/plain');
    expect(file.content).toContain('https://api.test/broken');
    expect(file.content).not.toContain('https://api.test/fine');
    expect(file.content).toContain('UAT · 1.0.2');
    expect(result.current.state).toBe('done');
  });

  it('không có `exportFile` ⇒ rơi về `Share.share` với khối text', async () => {
    const { result } = renderHook(() => useLogExport({ getEntries: () => WITH_ERRORS }));

    act(() => result.current.run());
    await flush();

    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(shareSpy.mock.calls[0][0].message).toContain('https://api.test/broken');
  });

  it('`exportFile` reject ⇒ `failed`, không ném ra ngoài', async () => {
    const exportFile = jest.fn().mockRejectedValue(new Error('disk full'));
    const { result } = renderHook(() => useLogExport({ getEntries: () => WITH_ERRORS, exportFile }));

    act(() => result.current.run());
    await flush();

    expect(result.current.state).toBe('failed');
  });

  /* `setState('busy')` chưa kịp có hiệu lực giữa hai chạm sát nhau — chốt phải là `ref`. */
  it('bấm hai lần liền ⇒ chỉ một lời gọi', async () => {
    const exportFile = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useLogExport({ getEntries: () => WITH_ERRORS, exportFile }));

    act(() => {
      result.current.run();
      result.current.run();
    });
    await flush();

    expect(exportFile).toHaveBeenCalledTimes(1);
  });

  it('dấu kết quả tự về `idle` sau 2 giây', async () => {
    jest.useFakeTimers();
    const exportFile = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useLogExport({ getEntries: () => WITH_ERRORS, exportFile }));

    act(() => result.current.run());
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state).toBe('done');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1999);
    });
    expect(result.current.state).toBe('done');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(result.current.state).toBe('idle');
  });

  /* Vòng quay "đang xuất" phải kịp vẽ trước khi luồng JS bận dựng file — nếu không nút đứng im. */
  it('`busy` có hiệu lực trước khi dựng file', async () => {
    const exportFile = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useLogExport({ getEntries: () => WITH_ERRORS, exportFile }));

    act(() => result.current.run());

    expect(result.current.state).toBe('busy');
    expect(exportFile).not.toHaveBeenCalled();

    await flush();
    expect(exportFile).toHaveBeenCalledTimes(1);
  });

  /* Màn không phải render lại theo từng dòng log chỉ để nút Xuất có dữ liệu mới nhất. */
  it('đọc nhật ký lúc bấm, không lúc render', async () => {
    const exportFile = jest.fn().mockResolvedValue(undefined);
    let current: LogEntry[] = [net(1, 200, 'https://api.test/fine')];
    const getEntries = () => current;
    const { result } = renderHook(() => useLogExport({ getEntries, exportFile }));

    current = [...current, net(9, 503, 'https://api.test/late-error')];
    act(() => result.current.run());
    await flush();

    expect(exportFile).toHaveBeenCalledTimes(1);
    expect(exportFile.mock.calls[0][0].content).toContain('https://api.test/late-error');
  });
});
