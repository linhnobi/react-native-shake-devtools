import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StatusBar, Text, useColorScheme } from 'react-native';
import { gorhomKit } from '../kits/gorhom-kit';
import { plainKit } from '../kits/plain-kit';
import { DevToolsUiProvider } from './DevToolsUiProvider';
import { SearchField } from './SearchField';
import { SheetKitContext, type SheetKit } from './sheet-kit';
import { renderWithDevTools } from '../testing/render-with-devtools';
import type { DevToolsColorScheme } from './theme';

/*
  Thanh trạng thái đồng bộ với theme của sheet: chữ/icon của thanh trạng thái nằm TRÊN lớp phủ đã
  làm tối app, nên khi theme ép của panel ngược hệ thống thì phải đẩy `barStyle` riêng và trả lại
  đúng kiểu của app khi đóng. Đọc thẳng ngăn xếp của `StatusBar` (`_propsStack`) — đó là thứ RN gửi
  xuống native, nên "đỉnh ngăn xếp" chính là kiểu đang hiện.
*/
type Entry = { barStyle: { value: string | null | undefined } };
const stack = () =>
  (StatusBar as unknown as { _propsStack: Entry[] })._propsStack.map((e) => e.barStyle.value);
const top = () => stack().at(-1);

const KITS: ReadonlyArray<readonly [string, SheetKit]> = [
  ['gorhom', gorhomKit],
  ['plain', plainKit],
];

const AppBar = () => <StatusBar barStyle="default" />;

/* Preset jest của RN thay `useColorScheme` bằng `jest.fn` — mặc định hệ thống sáng. */
beforeEach(() => {
  jest.mocked(useColorScheme).mockReturnValue('light');
});

describe.each(KITS)('Sheet đồng bộ thanh trạng thái — kit %s', (_name, kit) => {
  const Body = ({
    visible,
    title = 'A',
    scheme,
  }: {
    visible: boolean;
    title?: string;
    scheme: DevToolsColorScheme;
  }) => (
    <SheetKitContext.Provider value={kit}>
      <DevToolsUiProvider colorScheme={scheme}>
        <kit.Sheet visible={visible} onDismiss={jest.fn()} title={title}>
          <Text>nội dung</Text>
        </kit.Sheet>
      </DevToolsUiProvider>
    </SheetKitContext.Provider>
  );

  const app = (children: ReactNode) => (
    <>
      <AppBar />
      {children}
    </>
  );

  /* Thanh trạng thái nằm trên lớp phủ làm tối app ⇒ chữ tối chỉ khi cả sheet lẫn hệ thống đều sáng. */
  it.each([
    ['dark', 'light', 'light-content'],
    ['light', 'light', 'dark-content'],
    ['dark', 'dark', 'light-content'],
    ['light', 'dark', 'light-content'],
  ] as const)('sheet %s trên hệ thống %s ⇒ đẩy barStyle %s', (scheme, system, style) => {
    jest.mocked(useColorScheme).mockReturnValue(system);
    render(app(<Body visible scheme={scheme} />));

    expect(top()).toBe(style);
  });

  it('hệ thống đổi sáng ⇄ tối khi sheet sáng đang mở ⇒ cập nhật đúng mục', () => {
    const { rerender } = render(app(<Body visible scheme="light" />));
    expect(stack()).toEqual(['default', 'dark-content']);

    jest.mocked(useColorScheme).mockReturnValue('dark');
    rerender(app(<Body visible scheme="light" />));

    expect(stack()).toEqual(['default', 'light-content']);
  });

  it('chưa mở ⇒ không đụng ngăn xếp', () => {
    render(app(<Body visible={false} scheme="dark" />));

    expect(stack()).toEqual(['default']);
  });

  it('đóng ⇒ trả lại kiểu của app', () => {
    const { rerender } = render(app(<Body visible scheme="dark" />));
    expect(top()).toBe('light-content');

    rerender(app(<Body visible={false} scheme="dark" />));

    expect(stack()).toEqual(['default']);
  });

  it('gỡ sheet khi đang mở ⇒ cũng trả lại kiểu của app', () => {
    const { unmount } = render(<Body visible scheme="dark" />);
    expect(stack()).toEqual(['light-content']);

    unmount();

    expect(stack()).toEqual([]);
  });

  it('đổi theme sheet khi đang mở ⇒ cập nhật đúng mục, không đẩy thêm mục', () => {
    const { rerender } = render(app(<Body visible scheme="dark" />));
    expect(stack()).toEqual(['default', 'light-content']);

    rerender(app(<Body visible scheme="light" />));

    expect(stack()).toEqual(['default', 'dark-content']);
  });

  it('hai sheet nối tiếp (panel ⇒ nhật ký): luôn có mục của sheet đang mở, đóng hết thì về kiểu app', () => {
    const { rerender } = render(app(<Body visible title="panel" scheme="dark" />));
    expect(top()).toBe('light-content');

    rerender(
      app(
        <>
          <Body visible={false} title="panel" scheme="dark" />
          <Body visible title="log" scheme="dark" />
        </>,
      ),
    );
    expect(stack()).toEqual(['default', 'light-content']);

    rerender(
      app(
        <>
          <Body visible={false} title="panel" scheme="dark" />
          <Body visible={false} title="log" scheme="dark" />
        </>,
      ),
    );
    expect(stack()).toEqual(['default']);
  });

  it('hai sheet chồng nhau: đóng sheet dưới không gỡ nhầm mục của sheet trên', () => {
    const both = (a: boolean, b: boolean) =>
      app(
        <>
          <Body visible={a} title="dưới" scheme="dark" />
          <Body visible={b} title="trên" scheme="light" />
        </>,
      );
    const { rerender } = render(both(true, true));
    expect(stack()).toEqual(['default', 'light-content', 'dark-content']);

    /* Đóng sheet dưới (theme tối) không động tới mục của sheet trên. */
    rerender(both(false, true));
    expect(stack()).toEqual(['default', 'dark-content']);

    rerender(both(false, false));
    expect(stack()).toEqual(['default']);
  });

});

describe('ô nhập của lib trên iOS', () => {
  it.each(['light', 'dark'] as const)('`keyboardAppearance` theo theme %s', (scheme) => {
    renderWithDevTools(<SearchField testID="s" value="" onChangeText={jest.fn()} />, {
      colorScheme: scheme,
    });

    expect(screen.getByTestId('s').props.keyboardAppearance).toBe(scheme);
  });
});
