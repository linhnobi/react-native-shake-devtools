import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { SearchField } from './SearchField';

describe('SearchField', () => {
  it('gõ chữ gọi `onChangeText` với chuỗi mới', () => {
    const onChangeText = jest.fn();
    renderWithDevTools(<SearchField testID="s" value="" onChangeText={onChangeText} />);

    fireEvent.changeText(screen.getByTestId('s'), 'status:500');

    expect(onChangeText).toHaveBeenCalledWith('status:500');
  });

  it('nút ✕ chỉ hiện khi ô có chữ và có `onClear`', () => {
    const { rerender } = renderWithDevTools(
      <SearchField testID="s" value="" onChangeText={jest.fn()} onClear={jest.fn()} />,
    );
    expect(screen.queryByTestId('s-clear')).toBeNull();

    rerender(<SearchField testID="s" value="abc" onChangeText={jest.fn()} onClear={jest.fn()} />);
    expect(screen.getByTestId('s-clear')).toBeOnTheScreen();

    rerender(<SearchField testID="s" value="abc" onChangeText={jest.fn()} />);
    expect(screen.queryByTestId('s-clear')).toBeNull();
  });

  it('bấm ✕ gọi `onClear`', () => {
    const onClear = jest.fn();
    renderWithDevTools(<SearchField testID="s" value="abc" onChangeText={jest.fn()} onClear={onClear} />);

    fireEvent.press(screen.getByTestId('s-clear'));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('nhãn a11y của ô và của ✕ theo ngôn ngữ, lấy chữ gợi ý (hoặc nhãn mặc định) làm tên', () => {
    const vi = renderWithDevTools(
      <SearchField testID="s" value="x" onChangeText={jest.fn()} onClear={jest.fn()} placeholder="Tìm URL" />,
    );
    expect(screen.getByLabelText('Tìm URL')).toBe(screen.getByTestId('s'));
    expect(screen.getByLabelText('Xoá nội dung Tìm URL')).toBe(screen.getByTestId('s-clear'));
    vi.unmount();

    renderWithDevTools(
      <SearchField testID="s" value="x" onChangeText={jest.fn()} onClear={jest.fn()} />,
      { locale: 'en' },
    );
    expect(screen.getByLabelText('Search field')).toBe(screen.getByTestId('s'));
    expect(screen.getByLabelText('Clear Search field')).toBe(screen.getByTestId('s-clear'));
  });
});
