import { fireEvent, renderHook, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { renderWithDevTools } from '../testing/render-with-devtools';
import { useDevTools } from './devtools-context';
import type { DevToolsConfig } from './devtools-props';
import { DevToolsGate } from './DevToolsGate';

/*
  Gate chỉ được thử qua bề mặt public ở đây (`useDevTools()` + panel hiện ra), nên mọi thứ chạm
  native bị thay bằng bản câm:
  · `isRunningFromMetro` — `false` để gate đi nhánh offline (nhánh Metro đăng ký dòng dev menu).
  · `useShake` — không đụng cảm biến gia tốc thật của reanimated.
*/
jest.mock('./is-running-from-metro', () => ({ isRunningFromMetro: () => false }));

jest.mock('../shake/use-shake', () => ({ useShake: jest.fn() }));

/** Đọc hook như một màn thật: một nút gọi `open`, một dòng chữ in `enabled`/`isOpen`. */
const Probe = () => {
  const { open, isOpen, enabled } = useDevTools();
  return (
    <Pressable testID="probe-open" onPress={open}>
      <Text testID="probe-state">{`enabled=${enabled} isOpen=${isOpen}`}</Text>
    </Pressable>
  );
};

const renderGate = (config: DevToolsConfig) =>
  renderWithDevTools(
    <DevToolsGate config={{ locale: 'vi', ...config }} actions={[]}>
      <Probe />
    </DevToolsGate>,
  );

const panel = () => screen.queryByTestId('devtools-panel');
const state = () => screen.getByTestId('probe-state');

describe('useDevTools', () => {
  it('trong gate trả `open` mở được panel', () => {
    renderGate({ enabled: true });
    expect(state()).toHaveTextContent('enabled=true isOpen=false');
    expect(panel()).toBeNull();

    fireEvent.press(screen.getByTestId('probe-open'));

    expect(panel()).toBeOnTheScreen();
    expect(state()).toHaveTextContent('enabled=true isOpen=true');
  });

  /* Cố ý không throw: màn gọi hook phải dùng được ở app không mount gate. */
  it('ngoài gate trả bản câm và không ném', () => {
    const { result } = renderHook(() => useDevTools());

    expect(result.current.enabled).toBe(false);
    expect(result.current.isOpen).toBe(false);
    expect(() => result.current.open()).not.toThrow();
    expect(result.current.isOpen).toBe(false);
  });

  it('bản prod trả `enabled: false`', () => {
    renderGate({ enabled: false });
    expect(state()).toHaveTextContent('enabled=false isOpen=false');

    /* Đường vào bằng code cũng phải câm ở prod, không riêng cú lắc. */
    fireEvent.press(screen.getByTestId('probe-open'));

    expect(panel()).toBeNull();
    expect(state()).toHaveTextContent('enabled=false isOpen=false');
  });
});
