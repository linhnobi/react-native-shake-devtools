import { createLogBuffer, type LogBuffer } from './log-buffer';
import type { ConsoleEntry, MarkerEntry } from './log-entry';
import { createMarkers, type Markers } from './markers';

let buffer: LogBuffer;
let markers: Markers;

/** Một dòng console "của app" ghi sau mốc — để xem nó có mang dấu màn không. */
const appLog = (): ConsoleEntry => ({
  id: buffer.nextId(),
  kind: 'console',
  at: 0,
  level: 'info',
  text: 'x',
});

const labels = (type: MarkerEntry['type']) =>
  buffer
    .snapshot()
    .filter((e): e is MarkerEntry => e.kind === 'marker' && e.type === type)
    .map((e) => e.label);

describe('createMarkers', () => {
  beforeEach(() => {
    buffer = createLogBuffer();
    markers = createMarkers(buffer);
  });

  it('`screen` ghi mốc + đóng dấu dòng sau', () => {
    markers.screen('UserList');
    buffer.push(appLog());

    const [marker, line] = buffer.snapshot();
    expect(marker).toMatchObject({ kind: 'marker', type: 'screen', label: 'UserList' });
    expect(line).toMatchObject({ kind: 'console', screen: 'UserList' });
    // Mốc lấy `id` từ chính vòng đệm ⇒ nằm đúng chỗ trên dòng thời gian.
    expect(line.id).toBeGreaterThan(marker.id);
  });

  /* `onStateChange` của navigation có thể bắn nhiều lần cho cùng một màn. */
  it('trùng màn liền nhau chỉ ghi một mốc', () => {
    markers.screen('UserList');
    markers.screen('UserList');
    expect(labels('screen')).toEqual(['UserList']);

    // Quay lại màn cũ sau một màn khác là đổi màn thật, không phải trùng.
    markers.screen('UserDetail');
    markers.screen('UserList');
    expect(labels('screen')).toEqual(['UserList', 'UserDetail', 'UserList']);
  });

  it('tên rỗng/`undefined` là no-op', () => {
    markers.screen('');
    markers.screen(undefined);
    expect(buffer.snapshot()).toEqual([]);

    markers.screen('UserList');
    markers.screen(undefined);
    buffer.push(appLog());

    expect(labels('screen')).toEqual(['UserList']);
    // Không xoá dấu màn đang có.
    expect(buffer.snapshot()[1]).toMatchObject({ kind: 'console', screen: 'UserList' });
  });

  it('`user` tăng số thứ tự', () => {
    const returned = [markers.user(), markers.user(), markers.user()];

    expect(returned).toEqual([1, 2, 3]);
    // Nhãn của mốc chính là số trả về — nút ⚑ và nhật ký nói cùng một con số.
    expect(labels('user')).toEqual(returned.map(String));
  });

  /* Hai mốc cùng số trong một buổi thử là thứ gây nhầm khi đối chiếu ảnh chụp. */
  it('số thứ tự không về 0 sau `clear`', () => {
    expect(markers.user()).toBe(1);

    buffer.clear();

    expect(markers.user()).toBe(2);
    expect(labels('user')).toEqual(['2']);
  });
});
