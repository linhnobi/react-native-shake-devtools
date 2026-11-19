import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { plainKit } from '../kits/plain-kit';
import { mockBackHandler, type BackHandlerMock } from '../testing/back-handler.mock';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { formatLog } from '../capture/format-log';
import { logBuffer } from '../capture/log-buffer';
import type { ConsoleEntry, LogEntry, NetworkEntry } from '../capture/log-entry';
import type { StoredSession } from '../capture/log-session';
import { toCurl } from '../capture/to-curl';
import { copyText } from './copy-text';
import { LogSheet, type LogSheetProps } from './LogSheet';

jest.mock('./copy-text', () => ({ copyText: jest.fn(() => true) }));

/*
  `LogRow` bọc `ReanimatedSwipeable` — cử chỉ vuốt không phải thứ file này kiểm. Thay bằng một hàng
  bấm được, giữ đúng `testID` + nội dung + cờ `expanded` + dải `menu` mà màn truyền xuống, và gọi
  callback **kèm chính dòng đó** như `LogRow` thật (màn truyền một hàm chung cho mọi hàng). Dựng
  bằng `createElement` chứ không JSX: factory của `jest.mock` bị hoist, không được chạm `_jsx`.
*/
jest.mock('./LogRow', () => {
  const { createElement } = jest.requireActual('react');
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    LogRow: ({
      entry,
      expanded,
      onPress,
      onLongPress,
      menu,
      testID,
    }: {
      entry: { kind: string; url?: string; text?: string; label?: string };
      expanded: boolean;
      onPress?: (e: unknown) => void;
      onLongPress?: (e: unknown) => void;
      menu?: { id: string; label: string; onPress: () => void }[];
      testID: string;
    }) =>
      createElement(
        View,
        null,
        createElement(
          Pressable,
          {
            testID,
            onPress: onPress ? () => onPress(entry) : undefined,
            onLongPress: onLongPress ? () => onLongPress(entry) : undefined,
          },
          createElement(
            Text,
            null,
            entry.kind === 'network' ? entry.url : (entry.text ?? entry.label),
          ),
          expanded ? createElement(Text, { testID: `${testID}-expanded` }, 'open') : null,
        ),
        ...(menu ?? []).map((a) =>
          createElement(Pressable, {
            key: a.id,
            testID: `${testID}-act-${a.id}`,
            onPress: a.onPress,
          }),
        ),
      ),
  };
});

const con = (id: number, level: ConsoleEntry['level'], text: string): ConsoleEntry => ({
  id,
  kind: 'console',
  at: id,
  level,
  text,
});

const net = (
  id: number,
  url: string,
  status?: number,
  over: Partial<NetworkEntry> = {},
): NetworkEntry => ({
  id,
  kind: 'network',
  at: id,
  method: 'GET',
  url,
  status,
  ...over,
});

/** 1 console lỗi · 1 console thường · 1 request lỗi (chậm) · 1 request ổn. */
const MIXED: LogEntry[] = [
  con(1, 'error', 'TypeError: boom'),
  con(2, 'info', 'screen mounted'),
  net(3, 'https://api.test/user/list', 500, {
    durationMs: 4200,
    requestHeaders: { Authorization: 'Bearer secret-abc' },
  }),
  net(4, 'https://api.test/order/list', 200, { durationMs: 80 }),
];

/**
 * Đẩy dòng có `id` viết tay vào vòng đệm. 🔴 Phải **đẩy bộ đếm `nextId` qua `id` lớn nhất**: bộ đếm
 * chỉ đi lên (`createLogBuffer`, `seq`) và mốc "Đánh dấu" cấp id từ nó — để nguyên thì mốc đầu tiên
 * nhận `id = 1`, trùng dòng seed `id = 1` ⇒ hai hàng cùng `testID`/`keyExtractor`.
 */
const seed = (entries: LogEntry[]) =>
  entries.forEach((e) => {
    while (logBuffer.nextId() < e.id) {
      /* tiến bộ đếm tới `e.id` */
    }
    logBuffer.push(e);
  });

const render = (props: Partial<LogSheetProps> = {}) =>
  renderWithDevTools(<LogSheet visible onDismiss={jest.fn()} {...props} />);

const row = (id: number) => screen.queryByTestId(`devtools-log-${id}`);

beforeEach(() => {
  logBuffer.clear();
  (copyText as jest.Mock).mockClear();
});
afterEach(() => jest.restoreAllMocks());

describe('LogSheet', () => {
  it('buffer rỗng ⇒ câu "chưa bắt được", KHÔNG phải câu "không khớp bộ lọc"', () => {
    render();

    expect(screen.getByText('Chưa bắt được dòng nào')).toBeTruthy();
    expect(screen.queryByTestId('devtools-log-no-match')).toBeNull();
  });

  it('vẽ đủ N dòng', () => {
    seed(MIXED);
    render();

    [1, 2, 3, 4].forEach((id) => expect(row(id)).toBeTruthy());
  });

  /* Chip đổi ngay, danh sách lọc lại ở lượt render hoãn (`useDeferredValue`) — nên `waitFor`. */
  it('lọc `Console` bỏ dòng mạng', async () => {
    seed(MIXED);
    render();

    fireEvent.press(screen.getByTestId('devtools-log-filter-console'));

    await waitFor(() => expect(row(3)).toBeNull());
    expect(row(1)).toBeTruthy();
    expect(row(4)).toBeNull();
  });

  it('lọc `Mạng` bỏ dòng console', async () => {
    seed(MIXED);
    render();

    fireEvent.press(screen.getByTestId('devtools-log-filter-network'));

    await waitFor(() => expect(row(1)).toBeNull());
    expect(row(2)).toBeNull();
    expect(row(3)).toBeTruthy();
  });

  it('chạm dòng console mở hết chữ, chạm lần nữa đóng', () => {
    seed(MIXED);
    render();

    fireEvent.press(screen.getByTestId('devtools-log-1'));
    expect(screen.getByTestId('devtools-log-1-expanded')).toBeTruthy();

    fireEvent.press(screen.getByTestId('devtools-log-1'));
    expect(screen.queryByTestId('devtools-log-1-expanded')).toBeNull();
  });

  it('nút xoá làm rỗng buffer', () => {
    seed(MIXED);
    render();

    fireEvent.press(screen.getByTestId('devtools-log-clear'));

    expect(logBuffer.snapshot()).toHaveLength(0);
    expect(screen.getByText('Chưa bắt được dòng nào')).toBeTruthy();
  });

  /* Nút nhường một khung hình (vòng quay kịp vẽ) rồi mới định dạng — nên `waitFor`. */
  it('nút chia sẻ gọi `Share.share` với khối text của `formatLog` (MỌI dòng)', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    seed(MIXED);
    render();

    fireEvent.press(screen.getByTestId('devtools-log-share'));

    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({ message: formatLog(logBuffer.snapshot()) }),
    );
    expect(share).toHaveBeenCalledTimes(1);
  });
});

describe('LogSheet — tìm kiếm', () => {
  it('gõ chữ ⇒ chỉ còn dòng khớp URL', async () => {
    seed(MIXED);
    render();

    fireEvent.changeText(screen.getByTestId('devtools-log-search'), 'USER');

    await waitFor(() => expect(row(4)).toBeNull());
    expect(row(3)).toBeTruthy();
    expect(row(1)).toBeNull();
  });

  it('lọc hết ⇒ câu `noMatch` + "Bỏ lọc" đưa về đủ dòng', async () => {
    seed(MIXED);
    render();

    fireEvent.press(screen.getByTestId('devtools-log-filter-console'));
    fireEvent.changeText(screen.getByTestId('devtools-log-search'), 'zzz-khong-co');

    await waitFor(() => expect(screen.getByTestId('devtools-log-no-match')).toBeTruthy());
    expect(screen.getByText('Không có dòng nào khớp bộ lọc')).toBeTruthy();

    fireEvent.press(screen.getByTestId('devtools-log-reset-filters'));

    await waitFor(() => expect(row(4)).toBeTruthy());
    [1, 2, 3].forEach((id) => expect(row(id)).toBeTruthy());
  });
});

describe('LogSheet — lọc lỗi', () => {
  it('chip "Chỉ lỗi" chỉ giữ dòng lỗi, chạm lại thì bỏ lọc', async () => {
    seed(MIXED);
    render();

    const chip = screen.getByTestId('devtools-log-status-error');
    expect(screen.getByText('Chỉ lỗi · 2')).toBeTruthy();

    fireEvent.press(chip);
    await waitFor(() => expect(row(2)).toBeNull());
    expect(row(1)).toBeTruthy();
    expect(row(3)).toBeTruthy();
    expect(row(4)).toBeNull();

    fireEvent.press(chip);
    await waitFor(() => expect(row(2)).toBeTruthy());
    [1, 3, 4].forEach((id) => expect(row(id)).toBeTruthy());
  });

  it('chip "Ẩn lỗi" giữ mọi dòng trừ dòng lỗi', async () => {
    seed(MIXED);
    render();

    expect(screen.getByText('Ẩn lỗi')).toBeTruthy();
    fireEvent.press(screen.getByTestId('devtools-log-status-ok'));

    await waitFor(() => expect(row(1)).toBeNull());
    expect(row(2)).toBeTruthy();
    expect(row(4)).toBeTruthy();
    expect(row(3)).toBeNull();
  });

  it('chip "Chậm ≥3s" ghi ngưỡng, chỉ giữ request đã xong và mất từ 3 giây', async () => {
    seed(MIXED);
    render();

    expect(screen.getByText('Chậm ≥3s · 1')).toBeTruthy();
    fireEvent.press(screen.getByTestId('devtools-log-status-slow'));

    await waitFor(() => expect(row(1)).toBeNull());
    expect(row(3)).toBeTruthy();
    [2, 4].forEach((id) => expect(row(id)).toBeNull());
  });

  it('bộ đếm "Hiện N/M" đổi theo bộ lọc', async () => {
    seed(MIXED);
    render();

    expect(screen.getByText('Hiện 4/4 dòng')).toBeTruthy();

    fireEvent.press(screen.getByTestId('devtools-log-status-error'));

    await waitFor(() => expect(screen.getByText('Hiện 2/4 dòng')).toBeTruthy());
  });
});

describe('LogSheet — xuất lỗi', () => {
  it('0 lỗi ⇒ nút xuất bị khoá', () => {
    seed([con(1, 'info', 'ok'), net(2, 'https://api.test/ok', 200)]);
    render();

    expect(screen.getByTestId('devtools-log-export')).toBeDisabled();
  });

  /* Chân màn sống đã kín một dòng trên máy 360dp; phiên đang chạy chép cho AI từ hàng của panel. */
  it('nhật ký sống không có nút Chép cho AI', () => {
    seed(MIXED);
    render();

    expect(screen.queryByTestId('devtools-log-ai')).toBeNull();
  });

  /* File lấy MỌI dòng lỗi, kể cả khi màn đang lọc thứ khác — nút này là "gửi hết lỗi cho BE". */
  it('gọi `exportFile` với file chỉ gồm dòng lỗi, bất kể bộ lọc đang chọn', async () => {
    const exportFile = jest.fn().mockResolvedValue(undefined);
    seed(MIXED);
    render({ exportFile, subtitle: 'UAT · 1.0.2' });

    fireEvent.press(screen.getByTestId('devtools-log-status-ok'));
    fireEvent.press(screen.getByTestId('devtools-log-export'));

    await waitFor(() => expect(exportFile).toHaveBeenCalledTimes(1));
    const { content } = exportFile.mock.calls[0][0];
    expect(content).toContain('TypeError: boom');
    expect(content).toContain('https://api.test/user/list');
    expect(content).not.toContain('screen mounted');
    expect(content).not.toContain('https://api.test/order/list');
    expect(content).toContain('UAT · 1.0.2');
    await waitFor(() => expect(screen.getByTestId('devtools-log-exported')).toBeTruthy());
  });
});

describe('LogSheet — tạm dừng & đánh dấu', () => {
  it('tạm dừng ⇒ danh sách đứng yên, dải báo số dòng mới', () => {
    seed(MIXED);
    render();

    fireEvent.press(screen.getByTestId('devtools-log-pause'));
    act(() => logBuffer.push(con(5, 'info', 'dòng mới sau khi dừng')));

    expect(row(5)).toBeNull();
    expect(screen.getByTestId('devtools-log-paused')).toBeTruthy();
    expect(screen.getByText('↑ 1 dòng mới — chạm để xem')).toBeTruthy();
  });

  it('chạm dải tạm dừng ⇒ chạy tiếp, dòng mới hiện ra', () => {
    seed(MIXED);
    render();

    fireEvent.press(screen.getByTestId('devtools-log-pause'));
    act(() => logBuffer.push(con(5, 'info', 'dòng mới sau khi dừng')));
    fireEvent.press(screen.getByTestId('devtools-log-paused'));

    expect(row(5)).toBeTruthy();
    expect(screen.queryByTestId('devtools-log-paused')).toBeNull();
  });

  it('nút "Đánh dấu" ghi một mốc vào nhật ký', () => {
    seed(MIXED);
    render();

    fireEvent.press(screen.getByTestId('devtools-log-mark'));

    const last = logBuffer.snapshot()[logBuffer.snapshot().length - 1];
    expect(last).toMatchObject({ kind: 'marker', type: 'user' });
    expect(row(last.id)).toBeTruthy();
  });
});

describe('LogSheet — chi tiết & thao tác', () => {
  it('chạm dòng mạng mở trang chi tiết; nút quay lại về danh sách', () => {
    seed(MIXED);
    render();

    fireEvent.press(screen.getByTestId('devtools-log-3'));
    expect(screen.getByTestId('devtools-detail-tab-overview')).toBeTruthy();
    expect(screen.getByText('GET · 500')).toBeTruthy();
    expect(row(4)).toBeNull();

    fireEvent.press(screen.getByTestId('devtools-detail-back'));
    expect(row(4)).toBeTruthy();
    expect(screen.queryByTestId('devtools-detail-tab-overview')).toBeNull();
  });

  /* Chép cURL là đường "ở lại với người đang gỡ" ⇒ lệnh THÔ, có token thật (bảng ở `redact.ts`). */
  it('giữ lâu mở dải thao tác; "Chép cURL" chép lệnh thô', () => {
    seed(MIXED);
    render();

    fireEvent(screen.getByTestId('devtools-log-3'), 'longPress');
    fireEvent.press(screen.getByTestId('devtools-log-3-act-curl'));

    expect(copyText).toHaveBeenCalledWith(toCurl(MIXED[2] as NetworkEntry));
    expect((copyText as jest.Mock).mock.calls[0][0]).toContain('Bearer secret-abc');
    expect(screen.queryByTestId('devtools-log-3-act-curl')).toBeNull();
  });
});

describe('LogSheet — phiên trước', () => {
  const archive: StoredSession = {
    format: 1,
    name: 'session-1.json',
    startedAt: 1,
    savedAt: new Date(2026, 8, 24, 13, 58, 2).getTime(),
    fatal: true,
    build: 'UAT · 1.0.1',
    totalInMemory: 2,
    entries: [con(101, 'error', 'crash trước'), net(102, 'https://api.test/old', 200)],
  };

  it('nút Chép cho AI chép khối Markdown đã che của phiên đó (nguồn, build, thao tác đã lưu), hiện "Đã chép"', async () => {
    seed(MIXED);
    render({
      archive: {
        ...archive,
        actions: [{ at: 100, kind: 'tap', label: 'Thanh toán', source: 'text' }],
      },
    });

    expect(screen.getByText('Chép cho AI')).toBeTruthy();
    fireEvent.press(screen.getByTestId('devtools-log-ai'));

    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    const md = (copyText as jest.Mock).mock.calls[0][0] as string;
    expect(md).toMatch(/^# Debug context from a React Native app\n/);
    expect(md).toContain('- Source: previous session');
    expect(md).toContain('- Build: UAT · 1.0.1');
    expect(md).toContain('crash trước');
    expect(md).toContain('"Thanh toán"');
    /* Phiên trước, không phải nhật ký sống. */
    expect(md).not.toContain('TypeError: boom');
    await waitFor(() => expect(screen.getByTestId('devtools-log-ai')).toHaveTextContent('Đã chép'));
  });

  it('chỉ còn nút Xuất và Chép cho AI; file ghi nguồn `previous session`', async () => {
    const exportFile = jest.fn().mockResolvedValue(undefined);
    render({ archive, exportFile });

    expect(screen.queryByTestId('devtools-log-pause')).toBeNull();
    expect(screen.queryByTestId('devtools-log-mark')).toBeNull();
    expect(screen.queryByTestId('devtools-log-clear')).toBeNull();

    fireEvent.press(screen.getByTestId('devtools-log-export'));

    await waitFor(() => expect(exportFile).toHaveBeenCalledTimes(1));
    const { content } = exportFile.mock.calls[0][0];
    expect(content).toContain('(previous session)');
    expect(content).toContain('crash trước');
    expect(content).toContain('UAT · 1.0.1');
  });

  it('hiện dòng của phiên đó, không phải nhật ký sống', () => {
    seed(MIXED);
    render({ archive });

    expect(row(101)).toBeTruthy();
    expect(row(102)).toBeTruthy();
    expect(row(1)).toBeNull();
    expect(screen.getByText('Phiên trước')).toBeTruthy();
  });
});

describe('LogSheet — nút Back & bộ sheet', () => {
  let back: BackHandlerMock;
  beforeEach(() => {
    back = mockBackHandler();
  });
  afterEach(() => back.restore());

  it('Back ở trang chi tiết ⇒ về danh sách (sheet còn mở); Back lần nữa ⇒ đóng sheet', () => {
    seed(MIXED);
    const onDismiss = jest.fn();
    render({ onDismiss });
    fireEvent.press(screen.getByTestId('devtools-log-3'));
    expect(screen.getByTestId('devtools-detail-tab-overview')).toBeTruthy();

    act(() => {
      back.pressBack();
    });
    expect(screen.queryByTestId('devtools-detail-tab-overview')).toBeNull();
    expect(row(4)).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      back.pressBack();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('đóng sheet giữa trang chi tiết ⇒ Back không còn bị giữ (không nuốt Back của app)', () => {
    const archive: StoredSession = {
      format: 1,
      name: 'session-1.json',
      startedAt: 1,
      savedAt: 2,
      fatal: false,
      totalInMemory: 1,
      entries: [net(102, 'https://api.test/old', 500)],
    };
    const onDismiss = jest.fn();
    const { rerender } = render({ archive, onDismiss });
    fireEvent.press(screen.getByTestId('devtools-log-102'));
    expect(screen.getByTestId('devtools-detail-tab-overview')).toBeTruthy();

    rerender(<LogSheet visible={false} onDismiss={onDismiss} archive={archive} />);

    expect(back.count()).toBe(0);
    expect(back.pressBack()).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dòng gợi ý theo bộ sheet: có vuốt ⇒ "vuốt phải…"; bộ thuần ⇒ "giữ lâu…"', () => {
    seed(MIXED);
    const { unmount } = render();
    expect(screen.getByTestId('devtools-log-hint')).toHaveTextContent(
      'Vuốt phải để chép · giữ lâu để xem thao tác',
    );
    unmount();

    renderWithDevTools(<LogSheet visible onDismiss={jest.fn()} />, { kit: plainKit });
    expect(screen.getByTestId('devtools-log-hint')).toHaveTextContent(
      'Giữ lâu một dòng để chép · chia sẻ',
    );
  });
});
