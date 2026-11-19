import { fireEvent, screen } from '@testing-library/react-native';
import { ActivityIndicator, View } from 'react-native';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { Button } from './Button';
import { lightTheme } from './theme';

describe('Button', () => {
  it('bấm gọi `onPress` đúng một lần', () => {
    const onPress = jest.fn();
    renderWithDevTools(<Button testID="b" label="Chép" onPress={onPress} />);

    fireEvent.press(screen.getByTestId('b'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Chép')).toBeOnTheScreen();
  });

  it('`disabled` chặn chạm và báo a11y', () => {
    const onPress = jest.fn();
    renderWithDevTools(<Button testID="b" label="Chép" disabled onPress={onPress} />);

    fireEvent.press(screen.getByTestId('b'));

    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('b')).toBeDisabled();
    expect(screen.getByTestId('b').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('`loading` chặn chạm, hiện vòng quay thay nhãn, báo `busy`', () => {
    const onPress = jest.fn();
    renderWithDevTools(<Button testID="b" label="Xuất lỗi" loading onPress={onPress} />);

    fireEvent.press(screen.getByTestId('b'));

    expect(onPress).not.toHaveBeenCalled();
    expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    expect(screen.queryByText('Xuất lỗi')).toBeNull();
    expect(screen.getByTestId('b').props.accessibilityState).toMatchObject({ busy: true });
  });

  it('`iconOnly` không vẽ nhãn nhưng nhãn vẫn là tên a11y, icon nhận size + màu theo nút', () => {
    const leftIcon = jest.fn(() => <View testID="icon" />);
    renderWithDevTools(
      <Button testID="b" label="Đóng" iconOnly variant="tertiary" leftIcon={leftIcon} />,
    );

    expect(screen.queryByText('Đóng')).toBeNull();
    expect(screen.getByLabelText('Đóng')).toBe(screen.getByTestId('b'));
    expect(screen.getByTestId('icon')).toBeOnTheScreen();
    expect(leftIcon).toHaveBeenCalledWith({
      size: lightTheme.size.iconMd,
      color: lightTheme.colors.text.brand,
    });
  });

  it('`accessibilityLabel` ghi đè tên a11y, nhãn hiển thị giữ nguyên', () => {
    renderWithDevTools(<Button testID="b" label="Chia sẻ" accessibilityLabel="Chia sẻ dòng này" />);

    expect(screen.getByLabelText('Chia sẻ dòng này')).toBe(screen.getByTestId('b'));
    expect(screen.getByText('Chia sẻ')).toBeOnTheScreen();
  });

  it('bậc `sm` thấp hơn vùng chạm tối thiểu thì được bù `hitSlop`; bậc `md` không cần', () => {
    renderWithDevTools(
      <>
        <Button testID="sm" label="a" size="sm" />
        <Button testID="md" label="b" />
      </>,
    );
    const slop = Math.ceil((lightTheme.size.minTouch - lightTheme.size.buttonSm) / 2);

    expect(screen.getByTestId('sm').props.hitSlop).toMatchObject({ top: slop, bottom: slop });
    /* Ngón tay chạm trúng cả khung 44: cao nút + hai dải bù ≥ vùng chạm tối thiểu. */
    expect(lightTheme.size.buttonSm + 2 * slop).toBeGreaterThanOrEqual(lightTheme.size.minTouch);
    expect(screen.getByTestId('md').props.hitSlop).toBeUndefined();
  });
});
