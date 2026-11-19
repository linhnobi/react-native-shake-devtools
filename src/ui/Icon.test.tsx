import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { Icon, type IconName } from './Icon';
import { lightTheme } from './theme';

const NAMES: IconName[] = ['close', 'delete', 'back'];

/** Mọi nét của icon `id` (View con có testID `<id>-bar-N`) → màu của từng nét. */
const strokeColors = (id: string): unknown[] =>
  screen
    .getAllByTestId(new RegExp(`^${id}-bar-`), { includeHiddenElements: true })
    .map((bar) => {
      /* Nét đặc dùng `backgroundColor`, nét viền dùng `borderColor`. */
      const style = StyleSheet.flatten(bar.props.style);
      return style.backgroundColor ?? style.borderColor;
    });

describe('Icon', () => {
  it('khung vuông đúng `size`, ẩn khỏi a11y', () => {
    renderWithDevTools(<Icon name="close" size={20} testID="i" />);

    expect(screen.getByTestId('i', { includeHiddenElements: true })).toHaveStyle({
      width: 20,
      height: 20,
    });
    expect(screen.queryByTestId('i')).toBeNull();
  });

  it('mặc định lấy màu chữ chính của theme', () => {
    for (const name of NAMES) {
      const { unmount } = renderWithDevTools(<Icon name={name} size={24} testID={`i-${name}`} />);
      const colors = strokeColors(`i-${name}`);

      expect(colors.length).toBeGreaterThan(0);
      expect(new Set(colors)).toEqual(new Set([lightTheme.colors.text.primary]));
      unmount();
    }
  });

  it('`color` truyền vào được áp cho mọi nét của cả ba icon', () => {
    for (const name of NAMES) {
      const { unmount } = renderWithDevTools(
        <Icon name={name} size={24} color="#123456" testID={`c-${name}`} />,
      );

      expect(new Set(strokeColors(`c-${name}`))).toEqual(new Set(['#123456']));
      unmount();
    }
  });
});
