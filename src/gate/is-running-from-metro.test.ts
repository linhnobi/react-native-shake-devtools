import { TurboModuleRegistry } from 'react-native';
import { isRunningFromMetro } from './is-running-from-metro';

/*
  Hàm đọc `scriptURL` qua `TurboModuleRegistry.get('SourceCode')` — thay đúng lời gọi đó bằng
  một module giả, không đụng tới `NativeModules` của preset.
*/
const mockSourceCode = (scriptURL: string) =>
  jest
    .spyOn(TurboModuleRegistry, 'get')
    .mockReturnValue({ getConstants: () => ({ scriptURL }) });

afterEach(() => jest.restoreAllMocks());

describe('isRunningFromMetro', () => {
  it('`scriptURL` http ⇒ true', () => {
    const get = mockSourceCode('http://10.0.2.2:8081/index.bundle?platform=android&dev=true');

    expect(isRunningFromMetro()).toBe(true);
    expect(get).toHaveBeenCalledWith('SourceCode');
  });

  /* Bản giao tester (offline bundle, `--dev true`): bundle nằm trong app dù `__DEV__` vẫn là `true`. */
  it('`file://` ⇒ false', () => {
    mockSourceCode('file:///data/user/0/com.example.app/files/index.android.bundle');

    expect(isRunningFromMetro()).toBe(false);
  });

  it('module vắng ⇒ false và **không ném**', () => {
    const get = jest.spyOn(TurboModuleRegistry, 'get').mockReturnValue(null);
    expect(isRunningFromMetro()).toBe(false);

    /* Registry tự ném (native chưa sẵn) cũng phải rơi về an toàn, không lọt ra call-site. */
    get.mockImplementation(() => {
      throw new Error('SourceCode could not be found');
    });
    expect(() => isRunningFromMetro()).not.toThrow();
    expect(isRunningFromMetro()).toBe(false);
  });
});
