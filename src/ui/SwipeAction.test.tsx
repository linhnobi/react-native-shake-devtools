import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { SwipeAction } from './SwipeAction';
import { lightTheme } from './theme';

describe('SwipeAction', () => {
  it('bấm gọi `onPress`, tên a11y là nhãn', () => {
    const onPress = jest.fn();
    renderWithDevTools(<SwipeAction testID="a" label="Chép" onPress={onPress} />);

    fireEvent.press(screen.getByLabelText('Chép'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Chép')).toHaveStyle({ color: lightTheme.colors.text.onFilled });
  });

  it('`tone` đổi nền (mặc định success)', () => {
    renderWithDevTools(
      <>
        <SwipeAction testID="ok" label="a" />
        <SwipeAction testID="bad" label="b" tone="danger" />
      </>,
    );

    expect(screen.getByTestId('ok')).toHaveStyle({ backgroundColor: lightTheme.colors.background.success });
    expect(screen.getByTestId('bad')).toHaveStyle({ backgroundColor: lightTheme.colors.background.danger });
  });

  it('`style` truyền bề rộng vào khối', () => {
    renderWithDevTools(<SwipeAction testID="a" label="Chép" style={{ width: 80 }} />);

    expect(screen.getByTestId('a')).toHaveStyle({ width: 80, alignSelf: 'stretch' });
  });
});
