/*
  Entry `./plain` KHÔNG được chạm gorhom, `@gorhom/portal` hay gesture-handler — ở bất kỳ đâu trong
  đồ thị module. Hai lớp chặn:

  1. Lúc chạy: bốn module bị thay bằng mock NÉM khi bị `require`. Nạp entry (và render nó) mà một
     file nào đó kéo chúng vào ⇒ đỏ ngay ở dòng import, kèm tên module. Ca đối chứng nạp entry `.`
     dưới cùng các mock và phải ném — chứng minh mock có hiệu lực, không phải test xanh suông.
  2. Tĩnh: dò mọi `import`/`export … from`/`require` (kể cả `import type` — tsc của app kiểm cả nguồn
     `.ts` của lib, nên một dòng kiểu cũng đủ làm app không cài gorhom đỏ typecheck) từ
     `src/plain/index.ts` xuống.

  🔴 File này không dùng `renderWithDevTools` (nó import bộ gorhom) — render thẳng bằng RNTL.
*/
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';
import { AppState, Pressable } from 'react-native';
import { logBuffer } from '../capture/log-buffer';
import { mockBackHandler, type BackHandlerMock } from '../testing/back-handler.mock';
import { DevToolsGate, DevToolsUiProvider, LogSheet, useDevTools } from './index';

jest.mock('@gorhom/bottom-sheet', () => {
  throw new Error('entry ./plain kéo @gorhom/bottom-sheet vào đồ thị module');
});
jest.mock('@gorhom/portal', () => {
  throw new Error('entry ./plain kéo @gorhom/portal vào đồ thị module');
});
jest.mock('react-native-gesture-handler', () => {
  throw new Error('entry ./plain kéo react-native-gesture-handler vào đồ thị module');
});
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  throw new Error('entry ./plain kéo react-native-gesture-handler/ReanimatedSwipeable vào đồ thị module');
});

const SRC = path.resolve(__dirname, '..');
const FORBIDDEN = /^(@gorhom\/|react-native-gesture-handler(\/|$))/;
/**
 * Câu `import`/`export … from` **ở đầu dòng** (chữ "import" trong comment JSDoc không tính),
 * `import 'x'` trần, `require('x')`, `import('x')`.
 */
const SPECIFIER =
  /^\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;

/** Đường dẫn file của một import tương đối — đúng các đuôi mà jest/Metro của repo dò. */
const resolveLocal = (from: string, spec: string): string => {
  const base = path.resolve(path.dirname(from), spec);
  const candidates = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((ext) => base + ext);
  const hit = candidates.find((file) => fs.existsSync(file));
  if (!hit) throw new Error(`không dò ra ${spec} từ ${from}`);
  return hit;
};

/** Mọi gói ngoài (bare specifier) mà đồ thị từ `entry` chạm tới, kèm file chạm. */
const externalImports = (entry: string): Array<{ spec: string; file: string }> => {
  const seen = new Set<string>();
  const found: Array<{ spec: string; file: string }> = [];
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = fs.readFileSync(file, 'utf8');
    for (const m of code.matchAll(SPECIFIER)) {
      const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (!spec) continue;
      if (spec.startsWith('.')) visit(resolveLocal(file, spec));
      else found.push({ spec, file: path.relative(SRC, file) });
    }
  };
  visit(entry);
  return found;
};

describe('entry ./plain — không gorhom, không gesture-handler', () => {
  it('nạp entry không require @gorhom/bottom-sheet · @gorhom/portal · gesture-handler', () => {
    jest.isolateModules(() => {
      expect(() => require('./index')).not.toThrow();
    });
  });

  it('đối chứng: cùng các mock đó, entry `.` thì ném (mock có hiệu lực)', () => {
    jest.isolateModules(() => {
      expect(() => require('../index')).toThrow(/@gorhom\/bottom-sheet|gesture-handler/);
    });
  });

  it('đồ thị import tĩnh (kể cả `import type`) không có gói bị cấm; entry `.` thì có', () => {
    const plain = externalImports(path.join(SRC, 'plain', 'index.ts'));
    expect(plain.filter(({ spec }) => FORBIDDEN.test(spec))).toEqual([]);
    /* Bộ dò thật sự đi hết đồ thị: thấy cả reanimated (gate) lẫn safe-area (sheet). */
    expect(plain.map(({ spec }) => spec)).toEqual(
      expect.arrayContaining(['react-native-reanimated', 'react-native-safe-area-context']),
    );

    const full = externalImports(path.join(SRC, 'index.ts')).map(({ spec }) => spec);
    expect(full).toEqual(
      expect.arrayContaining([
        '@gorhom/bottom-sheet',
        'react-native-gesture-handler/ReanimatedSwipeable',
      ]),
    );
  });
});

describe('entry ./plain — chạy được không cần provider của gorhom/gesture-handler', () => {
  let back: BackHandlerMock;
  beforeEach(() => {
    logBuffer.clear();
    back = mockBackHandler();
    /* Preset để `currentState` là `jest.fn` ⇒ gate coi như app ở nền ⇒ không gắn cảm biến lắc. */
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
  });
  afterEach(() => back.restore());

  const Opener = () => {
    const { open } = useDevTools();
    return <Pressable testID="open" onPress={open} />;
  };

  it('gate → panel → nhật ký; Back đóng nhật ký về app', () => {
    render(
      <DevToolsGate config={{ enabled: true, locale: 'vi' }} actions={[]}>
        <Opener />
      </DevToolsGate>,
    );
    expect(screen.queryByTestId('devtools-panel')).toBeNull();

    fireEvent.press(screen.getByTestId('open'));
    expect(screen.getByTestId('devtools-panel')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('devtools-row-log'));
    expect(screen.getByTestId('devtools-log-sheet')).toBeOnTheScreen();
    /* Ô tìm là `TextInput` của RN (không phải `BottomSheetTextInput`). */
    expect(screen.getByPlaceholderText('Tìm URL, mã lỗi, nội dung…')).toBeOnTheScreen();

    let handled = false;
    act(() => {
      handled = back.pressBack();
    });
    expect(handled).toBe(true);
    /* Sheet nhật ký đang trượt xuống (còn trong cây tới khi hoạt ảnh xong), nhưng đã nhả Back. */
    expect(back.pressBack()).toBe(false);
  });

  it('nhật ký: hàng không có nút Chép vuốt, dòng gợi ý nói tới giữ lâu', () => {
    logBuffer.push({ id: logBuffer.nextId(), kind: 'console', at: 1, level: 'info', text: 'xin chào' });
    render(
      <DevToolsUiProvider locale="vi">
        <LogSheet visible onDismiss={jest.fn()} />
      </DevToolsUiProvider>,
    );

    expect(screen.getByText('xin chào')).toBeOnTheScreen();
    expect(screen.getByTestId('devtools-log-hint')).toHaveTextContent(
      'Giữ lâu một dòng để chép · chia sẻ',
    );
    expect(screen.queryByText('Chép')).toBeNull();
  });
});
