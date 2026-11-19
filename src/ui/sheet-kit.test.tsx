import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { plainKit } from '../kits/plain-kit';
import { useSheetKit, withSheetKit, SheetKitContext } from './sheet-kit';

const KitName = ({ label }: { label: string }) => {
  const kit = useSheetKit();
  return <Text>{`${label}:${kit === plainKit ? 'plain' : 'other'}`}</Text>;
};

describe('useSheetKit', () => {
  it('có provider ⇒ trả đúng bộ', () => {
    render(
      <SheetKitContext.Provider value={plainKit}>
        <KitName label="a" />
      </SheetKitContext.Provider>,
    );
    expect(screen.getByText('a:plain')).toBeOnTheScreen();
  });

  it('không provider ⇒ ném lỗi nhắc import từ entry', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<KitName label="a" />)).toThrow(/missing sheet kit/);
    jest.restoreAllMocks();
  });
});

describe('withSheetKit', () => {
  it('component bọc đọc được đúng bộ và nhận đủ props', () => {
    const Bound = withSheetKit(plainKit, KitName, 'KitName');
    render(<Bound label="b" />);

    expect(screen.getByText('b:plain')).toBeOnTheScreen();
    expect(Bound.displayName).toBe('KitName');
  });
});
