import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { JsonBody } from './JsonBody';

/** Gộp chữ của khối văn bản (các đoạn tô màu là `Text` lồng) — giữ nguyên `\n`. */
const textOf = (testID: string): string => {
  const flat = (node: unknown): string =>
    typeof node === 'string'
      ? node
      : Array.isArray(node)
        ? node.map(flat).join('')
        : node && typeof node === 'object' && 'props' in node
          ? flat((node as { props: { children?: unknown } }).props.children)
          : '';
  return flat(screen.getByTestId(testID).props.children);
};

describe('JsonBody', () => {
  it('JSON hợp lệ ⇒ tóm tắt + cây mặc định', () => {
    renderWithDevTools(<JsonBody raw='{"code":200,"data":[1,2]}' testID="b" />);

    expect(screen.getByTestId('b-summary')).toHaveTextContent(/2 khoá: code, data/);
    expect(screen.getByTestId('json-tree')).toBeOnTheScreen();
  });

  it('đổi chip sang Văn bản ⇒ văn bản dàn dòng', () => {
    renderWithDevTools(<JsonBody raw='{"a":1}' testID="b" />);

    fireEvent.press(screen.getByTestId('b-view-text'));

    expect(screen.queryByTestId('json-tree')).toBeNull();
    expect(textOf('b-text')).toBe('{\n  "a": 1\n}');
  });

  it('thân bị cắt ⇒ chỉ văn bản (vẫn thụt lề) + câu báo', () => {
    renderWithDevTools(<JsonBody raw='{"a":[1,…+900' testID="b" />);

    expect(screen.queryByTestId('b-view-tree')).toBeNull();
    expect(screen.getByText(/Không dựng được cây/)).toBeOnTheScreen();
    expect(textOf('b-text')).toBe('{\n  "a": [\n    1,\n    …+900');
  });

  it('khoá `password` bị che trong cả cây lẫn văn bản', () => {
    renderWithDevTools(<JsonBody raw='{"password":"p@ss"}' testID="b" />);

    expect(screen.queryByText(/p@ss/)).toBeNull();
    fireEvent.press(screen.getByTestId('b-view-text'));
    expect(textOf('b-text')).not.toContain('p@ss');
  });
});
