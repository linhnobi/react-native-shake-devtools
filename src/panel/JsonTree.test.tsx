import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { copyText } from './copy-text';
import { JsonTree, type JsonValue } from './JsonTree';

/* Bộ nhớ tạm là native — thay bằng spy để đọc đúng chuỗi được chép. */
jest.mock('./copy-text', () => ({ copyText: jest.fn(() => true) }));

const VALUE: JsonValue = {
  code: 200,
  data: { items: [{ id: 1 }, { id: 2 }], total: 2 },
};

describe('JsonTree', () => {
  it('tầng 0–1 mở sẵn, tầng 2 gập với tóm tắt', () => {
    renderWithDevTools(<JsonTree value={VALUE} />);

    expect(screen.getByTestId('json-node-1-code')).toHaveTextContent(/code: 200/);
    expect(screen.getByTestId('json-node-2-items')).toHaveTextContent(/items: 2 phần tử/);
    expect(screen.queryByTestId('json-node-3-0')).toBeNull();
  });

  it('chạm nhánh gập ⇒ con hiện ra', () => {
    renderWithDevTools(<JsonTree value={VALUE} />);

    fireEvent.press(screen.getByTestId('json-node-2-items'));

    expect(screen.getByTestId('json-node-3-0')).toBeOnTheScreen();
    expect(screen.getByTestId('json-node-3-1')).toBeOnTheScreen();
  });

  it('mảng dài hơn một đợt ⇒ nút "Xem thêm" hiện đợt tiếp', () => {
    renderWithDevTools(<JsonTree value={Array.from({ length: 60 }, (_, i) => i)} />);

    expect(screen.queryByTestId('json-node-1-55')).toBeNull();
    fireEvent.press(screen.getByTestId('json-more-0-root'));
    expect(screen.getByTestId('json-node-1-55')).toBeOnTheScreen();
  });

  it('giữ một hàng ⇒ `copyText` nhận JSON của đúng nhánh', () => {
    renderWithDevTools(<JsonTree value={VALUE} />);

    fireEvent(screen.getByTestId('json-node-1-data'), 'longPress');

    expect(copyText).toHaveBeenCalledWith(
      JSON.stringify({ items: [{ id: 1 }, { id: 2 }], total: 2 }, null, 2),
    );
  });
});
