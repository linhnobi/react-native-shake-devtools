import { screen } from '@testing-library/react-native';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { Text } from './Text';
import { darkTheme, lightTheme } from './theme';

describe('Text', () => {
  it('mặc định captionS_Regular + tông primary', () => {
    renderWithDevTools(<Text>chữ</Text>);

    expect(screen.getByText('chữ')).toHaveStyle({
      ...lightTheme.typography.captionS_Regular,
      color: lightTheme.colors.text.primary,
    });
  });

  it('variant + tone lấy từ theme, đổi theo sáng/tối', () => {
    const light = renderWithDevTools(
      <Text variant="captionS_Bold" tone="danger">
        lỗi
      </Text>,
    );
    expect(screen.getByText('lỗi')).toHaveStyle({
      ...lightTheme.typography.captionS_Bold,
      color: lightTheme.colors.text.danger,
    });
    light.unmount();

    renderWithDevTools(
      <Text variant="bodyM_Medium" tone="success">
        ok
      </Text>,
      { colorScheme: 'dark' },
    );
    expect(screen.getByText('ok')).toHaveStyle({
      ...darkTheme.typography.bodyM_Medium,
      color: darkTheme.colors.text.success,
    });
  });

  it('`style` đứng cuối nên thắng token', () => {
    renderWithDevTools(
      <Text tone="primary" style={{ color: 'hotpink', fontFamily: 'monospace' }}>
        ghi đè
      </Text>,
    );

    expect(screen.getByText('ghi đè')).toHaveStyle({ color: 'hotpink', fontFamily: 'monospace' });
  });
});
