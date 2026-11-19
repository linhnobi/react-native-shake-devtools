import { fireEvent, screen, within } from '@testing-library/react-native';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { fullBodies } from '../capture/full-body-store';
import type { NetworkEntry } from '../capture/log-entry';
import { toCurl } from '../capture/to-curl';
import {
  copyTextOf,
  LogDetail,
  LogDetailActions,
  type DetailTab,
  type LogDetailActionsProps,
} from './LogDetail';

/** Request đủ mặt: header bí mật, thân có khoá bí mật, thân phản hồi JSON, màn lúc gửi. */
const NET: NetworkEntry = {
  id: 7,
  kind: 'network',
  at: new Date(2026, 8, 24, 14, 26, 40).getTime(),
  method: 'POST',
  url: 'https://api.test/user/create',
  status: 500,
  durationMs: 812,
  requestHeaders: {
    Authorization: 'Bearer secret-token',
    'Content-Type': 'application/json',
  },
  requestBody: '{"name":"A","password":"p@ss"}',
  responseBody: '{"code":"E42","message":"boom"}',
  screen: 'UserCreate',
};

/** GET không thân, chưa có phản hồi — ca "không có gì để chép / để hiện". */
const BARE: NetworkEntry = {
  id: 8,
  kind: 'network',
  at: NET.at,
  method: 'GET',
  url: 'https://api.test/user/list',
};

/**
 * Chữ của khối `Code` đọc thẳng từ `children` chứ không qua `toHaveTextContent`: matcher đó gộp
 * `\n` thành dấu cách, tức "dàn dòng" và "một dòng" trông như nhau.
 */
const codeOf = (testID: string): unknown => screen.getByTestId(testID).props.children;

const renderDetail = (entry: NetworkEntry, tab: DetailTab) =>
  renderWithDevTools(<LogDetail entry={entry} tab={tab} onTabChange={jest.fn()} />);

describe('copyTextOf', () => {
  it('tab tổng quan chép URL', () => {
    expect(copyTextOf(NET, 'overview')).toBe('https://api.test/user/create');
  });

  it('tab header chép bản đã che', () => {
    const text = copyTextOf(NET, 'headers');

    expect(text).toBe('Authorization: <redacted>\nContent-Type: application/json');
    expect(text).not.toContain('secret-token');
  });

  /* Curl mang `<redacted>` thì mọi endpoint cần đăng nhập đều 401 — bản chép phải thô. */
  it('tab cURL chép bản thô', () => {
    const text = copyTextOf(NET, 'curl');

    expect(text).toBe(toCurl(NET));
    expect(text).toContain('Bearer secret-token');
  });

  it('thân rỗng ⇒ chuỗi rỗng', () => {
    expect(copyTextOf(BARE, 'request')).toBe('');
    expect(copyTextOf(BARE, 'response')).toBe('');
  });
});

describe('LogDetail', () => {
  it('tab tổng quan hiện method · trạng thái · thời lượng · màn', () => {
    renderDetail(NET, 'overview');

    expect(within(screen.getByTestId('devtools-detail-method')).getByText('POST')).toBeOnTheScreen();
    expect(within(screen.getByTestId('devtools-detail-status')).getByText('500')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('devtools-detail-duration')).getByText('812 ms'),
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('devtools-detail-screen')).getByText('UserCreate'),
    ).toBeOnTheScreen();
  });

  it('tab Headers che `Authorization` và nói chưa bắt header phản hồi', () => {
    renderDetail(NET, 'headers');

    expect(codeOf('devtools-detail-headers')).toBe(
      'Authorization: <redacted>\nContent-Type: application/json',
    );
    expect(screen.queryByText(/secret-token/)).toBeNull();
    expect(screen.getByText('Header phản hồi chưa được ghi lại.')).toBeOnTheScreen();
  });

  it('tab Response hiện tóm tắt + cây JSON', () => {
    renderDetail(NET, 'response');

    expect(screen.getByTestId('devtools-detail-response-summary')).toHaveTextContent(
      /2 khoá: code, message/,
    );
    expect(screen.getByTestId('json-tree')).toBeOnTheScreen();
    expect(screen.getByTestId('json-node-1-code')).toHaveTextContent(/code: "E42"/);
  });

  it('kho có bản đầy đủ ⇒ hiện thân đầy đủ + câu "Đang xem bản đầy đủ"', () => {
    const big = JSON.stringify({ items: Array.from({ length: 3 }, (_, i) => ({ id: i })) });
    fullBodies.put(NET.id, 'response', big);
    renderDetail({ ...NET, responseBody: big.slice(0, 10), responseTruncated: true }, 'response');

    expect(screen.getByTestId('devtools-detail-full-note')).toBeOnTheScreen();
    expect(screen.getByTestId('devtools-detail-response-summary')).toHaveTextContent(/1 khoá: items/);
    fullBodies.clear();
  });

  it('thân rỗng hiện câu "Không có thân"', () => {
    renderDetail(BARE, 'request');

    expect(screen.getByTestId('devtools-detail-no-body')).toHaveTextContent('Không có thân');
    expect(screen.queryByTestId('devtools-detail-request')).toBeNull();
  });

  /* "Không có thân" cho một upload FormData hay một ảnh tải về là tool nói dối. */
  it('có thân mà không bắt được ⇒ nói lý do, KHÔNG nói "Không có thân"', () => {
    const upload: NetworkEntry = {
      ...BARE,
      method: 'POST',
      status: 200,
      requestBodySkipped: 'formData',
      responseBodySkipped: 'binary',
    };
    renderDetail(upload, 'request');

    expect(screen.getByTestId('devtools-detail-body-not-captured')).toHaveTextContent(
      'Không bắt được thân — FormData (có thể kèm tệp).',
    );
    expect(screen.queryByTestId('devtools-detail-no-body')).toBeNull();

    renderDetail(upload, 'response');
    expect(screen.getByTestId('devtools-detail-body-not-captured')).toHaveTextContent(
      'Không bắt được thân — dữ liệu nhị phân.',
    );
  });

  it('request bị huỷ hiện "Đã huỷ" ở ô trạng thái', () => {
    renderDetail({ ...BARE, error: 'abort', durationMs: 40 }, 'overview');

    expect(within(screen.getByTestId('devtools-detail-status')).getByText('Đã huỷ')).toBeOnTheScreen();
  });

  it('tab cURL hiện bản đã che', () => {
    renderDetail(NET, 'curl');

    const shown = codeOf('devtools-detail-curl');
    expect(shown).toContain("-H 'Authorization: <redacted>'");
    expect(shown).toContain('"password":"<redacted>"');
    expect(shown).not.toContain('secret-token');
    expect(shown).not.toContain('p@ss');
  });
});

describe('LogDetailActions', () => {
  const actions = (props: Partial<LogDetailActionsProps> = {}) => (
    <LogDetailActions
      entry={NET}
      tab="overview"
      copied={null}
      onCopy={jest.fn()}
      onShare={jest.fn()}
      {...props}
    />
  );

  it('nhãn nút chính đổi theo tab', () => {
    const { rerender } = renderWithDevTools(actions({ tab: 'overview' }));
    expect(screen.getByTestId('devtools-detail-copy')).toHaveTextContent('Chép URL');

    rerender(actions({ tab: 'response' }));
    expect(screen.getByTestId('devtools-detail-copy')).toHaveTextContent('Chép response');

    rerender(actions({ tab: 'headers' }));
    expect(screen.getByTestId('devtools-detail-copy')).toHaveTextContent('Chép header');
  });

  it('thân rỗng ⇒ nút chép khoá', () => {
    const onCopy = jest.fn();
    renderWithDevTools(actions({ entry: BARE, tab: 'request', onCopy }));

    const copy = screen.getByTestId('devtools-detail-copy');
    expect(copy).toBeDisabled();

    fireEvent.press(copy);

    expect(onCopy).not.toHaveBeenCalled();
    /* Chỉ nút của tab khoá — curl của một GET trần vẫn chép được. */
    expect(screen.getByTestId('devtools-detail-copy-curl')).not.toBeDisabled();
  });

  it('tab cURL không vẽ nút cURL thứ hai', () => {
    renderWithDevTools(actions({ tab: 'curl' }));

    expect(screen.queryByTestId('devtools-detail-copy-curl')).toBeNull();
    expect(screen.getByTestId('devtools-detail-copy')).toHaveTextContent('Chép cURL');
    expect(screen.getAllByText('Chép cURL')).toHaveLength(1);
  });
});
