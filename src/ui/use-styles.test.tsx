import { renderWithDevTools } from '../testing/render-with-devtools';
import { darkTheme, lightTheme, type DevToolsTheme } from './theme';
import { useStyles } from './use-styles';

const stylesOf = (t: DevToolsTheme) => ({ box: { backgroundColor: t.colors.background.surface } });
const otherStylesOf = (t: DevToolsTheme) => ({ box: { backgroundColor: t.colors.background.surface } });

let got: ReturnType<typeof stylesOf> | undefined;
const Probe = ({ factory = stylesOf }: { factory?: typeof stylesOf }) => {
  got = useStyles(factory);
  return null;
};

afterEach(() => {
  got = undefined;
});

describe('useStyles', () => {
  it('cùng theme + factory ⇒ cùng tham chiếu, kể cả giữa hai lần render và hai component', () => {
    const { rerender } = renderWithDevTools(<Probe />);
    const first = got;
    rerender(<Probe />);
    const second = got;
    renderWithDevTools(<Probe />);

    expect(second).toBe(first);
    expect(got).toBe(first);
  });

  it('đổi theme ⇒ style theo token mới; đổi lại ⇒ lấy lại bộ cũ', () => {
    renderWithDevTools(<Probe />, { colorScheme: 'light' });
    const light = got;
    renderWithDevTools(<Probe />, { colorScheme: 'dark' });
    const dark = got;
    renderWithDevTools(<Probe />, { colorScheme: 'light' });

    expect(light?.box).toMatchObject({ backgroundColor: lightTheme.colors.background.surface });
    expect(dark?.box).toMatchObject({ backgroundColor: darkTheme.colors.background.surface });
    expect(got).toBe(light);
  });

  it('hai factory khác nhau không dùng chung kết quả', () => {
    renderWithDevTools(<Probe factory={stylesOf} />);
    const a = got;
    renderWithDevTools(<Probe factory={otherStylesOf} />);

    expect(got).not.toBe(a);
  });
});
