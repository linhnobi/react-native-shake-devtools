import { formatSessionInfo, sessionInfoPairs } from './session-info';

/** Đủ năm trường — khai CỐ Ý lệch thứ tự để thứ tự in ra chỉ có thể đến từ hàm. */
const FULL = {
  user: '***812 · admin',
  os: 'Android 14',
  device: 'Samsung SM-A525F',
  env: 'UAT',
  appVersion: '1.0.2 (58)',
};

/** Giờ máy (constructor local) — múi giờ của máy chạy test chỉ đổi đuôi `±HH:MM`. */
const STARTED_AT = new Date(2026, 8, 24, 14, 26, 40).getTime();

describe('sessionInfoPairs', () => {
  it('đúng thứ tự cố định', () => {
    expect(sessionInfoPairs(FULL)).toEqual([
      ['App', '1.0.2 (58)'],
      ['Env', 'UAT'],
      ['Device', 'Samsung SM-A525F'],
      ['OS', 'Android 14'],
      ['User', '***812 · admin'],
    ]);
  });

  it('trường vắng bị bỏ', () => {
    expect(sessionInfoPairs({ appVersion: '1.0.2 (58)', os: 'Android 14' })).toEqual([
      ['App', '1.0.2 (58)'],
      ['OS', 'Android 14'],
    ]);
    // Chuỗi rỗng cũng tính là vắng — không in dòng `Env       : `.
    expect(sessionInfoPairs({ env: '' })).toEqual([]);
    expect(sessionInfoPairs({})).toEqual([]);
  });

  it('có `startedAt` thì thêm dòng `Session` ngày giờ đầy đủ', () => {
    const pairs = sessionInfoPairs({ env: 'UAT' }, STARTED_AT);

    expect(pairs.map(([label]) => label)).toEqual(['Env', 'Session']);
    expect(pairs[1][1]).toMatch(/^2026-09-24 14:26:40 [+-]\d{2}:\d{2}$/);
    // Không truyền mốc ⇒ không có dòng `Session`.
    expect(sessionInfoPairs({ env: 'UAT' }).map(([label]) => label)).toEqual(['Env']);
  });
});

describe('formatSessionInfo', () => {
  it('nhãn thẳng cột', () => {
    const lines = formatSessionInfo(FULL, STARTED_AT).split('\n');

    expect(lines.slice(0, 3)).toEqual([
      'App       : 1.0.2 (58)',
      'Env       : UAT',
      'Device    : Samsung SM-A525F',
    ]);
    // Khoá QUAN HỆ: mọi dòng — kể cả `Session` dài nhất — có dấu `:` ở cùng một cột.
    expect(lines).toHaveLength(6);
    expect(new Set(lines.map((l) => l.indexOf(':'))).size).toBe(1);
  });

  it('rỗng ⇒ chuỗi rỗng', () => {
    expect(formatSessionInfo({})).toBe('');
  });
});
