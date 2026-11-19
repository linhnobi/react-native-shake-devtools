import { screen } from '@testing-library/react-native';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { Chip } from './Chip';
import { lightTheme } from './theme';

describe('Chip', () => {
  it('vẽ nhãn, role text, mặc định không chọn', () => {
    renderWithDevTools(<Chip testID="c" label="Tất cả" />);

    expect(screen.getByText('Tất cả')).toBeOnTheScreen();
    expect(screen.getByTestId('c').props.accessibilityRole).toBe('text');
    expect(screen.getByTestId('c').props.accessibilityState).toMatchObject({ selected: false });
  });

  it('`active` đổi nền + màu chữ và báo `selected`', () => {
    renderWithDevTools(<Chip testID="c" label="Chỉ lỗi" state="active" />);

    expect(screen.getByTestId('c')).toHaveStyle({ backgroundColor: lightTheme.colors.background.brand });
    expect(screen.getByText('Chỉ lỗi')).toHaveStyle({ color: lightTheme.colors.text.onFilled });
    expect(screen.getByTestId('c').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('`default` dùng nền phụ và chữ phụ', () => {
    renderWithDevTools(<Chip testID="c" label="Console" state="default" />);

    expect(screen.getByTestId('c')).toHaveStyle({
      backgroundColor: lightTheme.colors.background.surfaceAlt,
    });
    expect(screen.getByText('Console')).toHaveStyle({ color: lightTheme.colors.text.secondary });
  });
});
