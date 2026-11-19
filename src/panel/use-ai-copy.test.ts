import { act, renderHook } from '@testing-library/react-native';
import { Share } from 'react-native';
import type { LogEntry, NetworkEntry } from '../capture/log-entry';
import type { RecordedAction } from '../capture/recorded-action';
import { copyText } from './copy-text';
import { useAiCopy } from './use-ai-copy';

/* Bộ nhớ tạm là native — thay bằng spy để đọc đúng khối Markdown hook đưa xuống. */
jest.mock('./copy-text', () => ({ copyText: jest.fn() }));
const mockCopyText = jest.mocked(copyText);

const net = (id: number, status: number, url: string): NetworkEntry => ({
  id,
  kind: 'network',
  at: id,
  method: 'POST',
  url,
  status,
  requestHeaders: { Authorization: 'Bearer raw-secret-token-1234567890' },
});

const ENTRIES: LogEntry[] = [net(1, 200, 'https://api.test/fine'), net(2, 500, 'https://api.test/broken')];

/** Một vòng macrotask — cùng lý do với `use-log-export.test.ts`. */
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const flush = () =>
  act(async () => {
    await macrotask();
    await macrotask();
  });

let shareSpy: jest.SpyInstance;

beforeEach(() => {
  mockCopyText.mockReset();
  mockCopyText.mockReturnValue(true);
  shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useAiCopy', () => {
  it('chép khối Markdown đã che vào bộ nhớ tạm ⇒ `copied`; không mở khay chia sẻ', async () => {
    const actions: RecordedAction[] = [{ at: 1, kind: 'tap', label: 'Pay', source: 'text' }];
    const { result } = renderHook(() =>
      useAiCopy({
        getEntries: () => ENTRIES,
        getActions: () => actions,
        build: 'UAT · 1.0.2',
        sessionInfo: () => ({ device: 'Pixel 8' }),
        source: 'previous session',
      }),
    );

    act(() => result.current.run());
    await flush();

    expect(mockCopyText).toHaveBeenCalledTimes(1);
    const md = mockCopyText.mock.calls[0][0];
    expect(md).toMatch(/^# Debug context from a React Native app\n/);
    expect(md).toContain('`POST https://api.test/broken` → 500');
    expect(md).toContain('- Build: UAT · 1.0.2');
    expect(md).toContain('- Device: Pixel 8');
    expect(md).toContain('- Source: previous session');
    expect(md).toContain('tap        "Pay"');
    expect(md).not.toContain('raw-secret-token');
    expect(shareSpy).not.toHaveBeenCalled();
    expect(result.current.state).toBe('copied');
  });

  it('bộ nhớ tạm không dùng được ⇒ rơi về `Share.share` cùng khối Markdown, rồi về `idle`', async () => {
    mockCopyText.mockReturnValue(false);
    const { result } = renderHook(() => useAiCopy({ getEntries: () => ENTRIES }));

    act(() => result.current.run());
    await flush();

    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(shareSpy.mock.calls[0][0].message).toContain('`POST https://api.test/broken` → 500');
    expect(result.current.state).toBe('idle');
  });

  it('`Share.share` reject ⇒ `failed`, không ném ra ngoài', async () => {
    mockCopyText.mockReturnValue(false);
    shareSpy.mockRejectedValue(new Error('no activity'));
    const { result } = renderHook(() => useAiCopy({ getEntries: () => ENTRIES }));

    act(() => result.current.run());
    await flush();

    expect(result.current.state).toBe('failed');
  });

  it('hàm thông tin phiên của app ném ⇒ vẫn chép, chỉ thiếu mấy dòng thông tin', async () => {
    const { result } = renderHook(() =>
      useAiCopy({
        getEntries: () => ENTRIES,
        sessionInfo: () => {
          throw new Error('native module missing');
        },
      }),
    );

    act(() => result.current.run());
    await flush();

    expect(mockCopyText).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('copied');
  });

  /* Cùng lý do với `useLogExport`: `setState('busy')` chưa có hiệu lực giữa hai chạm sát nhau. */
  it('bấm hai lần liền ⇒ chỉ chép một lần', async () => {
    const { result } = renderHook(() => useAiCopy({ getEntries: () => ENTRIES }));

    act(() => {
      result.current.run();
      result.current.run();
    });
    await flush();

    expect(mockCopyText).toHaveBeenCalledTimes(1);
  });

  it('`busy` có hiệu lực trước khi dựng khối; dấu `copied` tự về `idle` sau 1,5 giây', async () => {
    jest.useFakeTimers();
    const { result } = renderHook(() => useAiCopy({ getEntries: () => ENTRIES }));

    act(() => result.current.run());
    expect(result.current.state).toBe('busy');
    expect(mockCopyText).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state).toBe('copied');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1499);
    });
    expect(result.current.state).toBe('copied');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(result.current.state).toBe('idle');
  });

  it('đọc nhật ký lúc bấm, không lúc render', async () => {
    let current: LogEntry[] = [net(1, 200, 'https://api.test/fine')];
    const { result } = renderHook(() => useAiCopy({ getEntries: () => current }));

    current = [...current, net(9, 503, 'https://api.test/late-error')];
    act(() => result.current.run());
    await flush();

    expect(mockCopyText.mock.calls[0][0]).toContain('https://api.test/late-error');
  });
});
