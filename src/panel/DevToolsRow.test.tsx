import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithDevTools } from '../testing/render-with-devtools';
import type { DevToolsRowProps } from '../gate/devtools-props';
import { DevToolsRow } from './DevToolsRow';

const LABEL = 'Mở nhật ký';
const HINT = 'Console + mạng, 300 dòng gần nhất';

const row = (props: Partial<DevToolsRowProps> = {}) => (
  <DevToolsRow testID="row" label={LABEL} {...props} />
);

const render = (props: Partial<DevToolsRowProps> = {}) => renderWithDevTools(row(props));

describe('DevToolsRow', () => {
  it('vẽ nhãn', () => {
    render();

    expect(screen.getByText(LABEL)).toBeOnTheScreen();
    /* Nhãn cũng là tên a11y của hàng — hàng không có icon nào khác để đọc lên. */
    expect(screen.getByLabelText(LABEL)).toBeOnTheScreen();
  });

  it('`hint` vắng thì không vẽ dòng phụ', () => {
    const { rerender } = render({ hint: HINT });
    expect(screen.getByText(HINT)).toBeOnTheScreen();

    rerender(row());

    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.getByText(LABEL)).toBeOnTheScreen();
  });

  it('`badge = 0` không vẽ số', () => {
    const { rerender } = render({ badge: 23 });
    expect(screen.getByTestId('row-badge')).toHaveTextContent('23');

    rerender(row({ badge: 0 }));

    expect(screen.queryByTestId('row-badge')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });

  /*
    Không có `onPress` thì không có gì để quan sát ⇒ dựng hàng CÓ handler rồi gỡ nó đi: chạm sau
    đó không được gọi lại hàm cũ.
  */
  it('không `onPress` ⇒ `disabled` và chạm không gọi gì', () => {
    const onPress = jest.fn();
    const { rerender } = render({ onPress });

    rerender(row());
    const target = screen.getByTestId('row');
    fireEvent.press(target);

    expect(target).toBeDisabled();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('có `onPress` ⇒ chạm gọi đúng một lần', () => {
    const onPress = jest.fn();
    render({ onPress });

    const target = screen.getByTestId('row');
    expect(target).not.toBeDisabled();

    fireEvent.press(target);

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
