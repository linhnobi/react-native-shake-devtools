/*
  Entry `./plain` hứa "cùng API với entry `.`". Danh sách export của hai file viết tay song song
  (`src/index.ts` · `src/plain/index.ts`) — thêm ở một bên mà quên bên kia thì test này đỏ.
*/
import * as full from '../index';
import * as plain from './index';

describe('entry ./plain ↔ entry .', () => {
  it('export cùng một bộ tên (giá trị lúc chạy)', () => {
    expect(Object.keys(plain).sort()).toEqual(Object.keys(full).sort());
  });

  it('năm component cần bộ sheet là bản riêng của từng entry; phần còn lại dùng chung', () => {
    const bound = ['DevToolsGate', 'DevToolsPanel', 'LogSheet', 'LogRow', 'LogDetail'] as const;
    for (const name of bound) expect(plain[name]).not.toBe(full[name]);

    expect(plain.DevToolsRow).toBe(full.DevToolsRow);
    expect(plain.useShake).toBe(full.useShake);
    expect(plain.startCapture).toBe(full.startCapture);
  });
});
