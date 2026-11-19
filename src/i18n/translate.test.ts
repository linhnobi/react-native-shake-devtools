import { devtoolsStrings, resolveStrings, translate } from './translate';

const vi = resolveStrings('vi');
const en = resolveStrings('en');

describe('resolveStrings', () => {
  it('dùng chuỗi dựng sẵn theo ngôn ngữ', () => {
    expect(vi.panel.title).toBe('Công cụ gỡ lỗi');
    expect(en.panel.title).toBe('Debug tools');
    expect(vi.common.close).toBe('Đóng');
    expect(en.common.close).toBe('Close');
  });

  it('ghi đè một khoá giữ nguyên các khoá còn lại', () => {
    const custom = resolveStrings('en', { panel: { title: 'Dev menu' } });

    expect(custom.panel.title).toBe('Dev menu');
    expect(custom.panel.log).toBe('Logs');
    expect(custom.log.title).toBe(en.log.title);
  });

  it('không làm hỏng bộ dựng sẵn và trả object mới', () => {
    const custom = resolveStrings('vi', { panel: { title: 'Menu' } });

    expect(custom).not.toBe(devtoolsStrings.vi);
    expect(devtoolsStrings.vi.panel.title).toBe('Công cụ gỡ lỗi');
    expect(resolveStrings('vi').panel.title).toBe('Công cụ gỡ lỗi');
  });
});

describe('translate', () => {
  it('thay biến vào {{tên}}', () => {
    expect(translate(vi, 'panel.logHint', { total: 214, errors: 12 })).toBe('214 dòng · 12 lỗi');
    expect(translate(en, 'panel.snooze', { minutes: 30 })).toBe('Pause shake for 30 minutes');
  });

  it('thiếu biến ⇒ giữ nguyên {{biến}} trong câu; không truyền vars cũng vậy', () => {
    expect(translate(vi, 'panel.logHint', { total: 214 })).toBe('214 dòng · {{errors}} lỗi');
    expect(translate(vi, 'panel.logHint', { total: 214, errors: undefined })).toBe(
      '214 dòng · {{errors}} lỗi',
    );
    expect(translate(vi, 'panel.snooze')).toBe('Tắt lắc trong {{minutes}} phút');
  });

  it('biến null thành rỗng', () => {
    expect(translate(vi, 'panel.logHint', { total: 1, errors: null })).toBe('1 dòng ·  lỗi');
  });

  it('biến số 0 vẫn hiện, không bị coi là thiếu', () => {
    expect(translate(vi, 'panel.logHint', { total: 0, errors: 0 })).toBe('0 dòng · 0 lỗi');
  });

  it('thiếu khoá ⇒ trả chính khoá', () => {
    expect(translate(vi, 'panel.khongCo' as never)).toBe('panel.khongCo');
    /* Khoá trỏ vào một nhánh (không phải lá chuỗi) cũng không phải câu — trả khoá. */
    expect(translate(vi, 'panel' as never)).toBe('panel');
  });

  it('`{{biến|một|nhiều}}` chọn dạng số ít khi biến bằng 1, còn lại dạng số nhiều; thiếu biến giữ nguyên', () => {
    const strings = { panel: { x: '{{n}} {{n|item|items}} · {{m}} {{m|error|errors}}' } } as never;
    const x = 'panel.x' as never;
    expect(translate(strings, x, { n: 1, m: 2 })).toBe('1 item · 2 errors');
    expect(translate(strings, x, { n: 0, m: 1 })).toBe('0 items · 1 error');
    expect(translate(strings, x, { n: '1', m: null })).toBe('1 item ·  errors');
    expect(translate(strings, x, { n: 3 })).toBe('3 items · {{m}} {{m|error|errors}}');
  });

  it('chuỗi tiếng Anh có số đếm: số ít đúng ngữ pháp, tiếng Việt không đổi', () => {
    expect(translate(en, 'panel.reportSteps', { count: 1 })).toBe('1 recorded step');
    expect(translate(en, 'panel.reportSteps', { count: 4 })).toBe('4 recorded steps');
    expect(translate(en, 'report.form.stepsCard', { count: 1 })).toBe('1 recorded step · Edit ›');
    expect(translate(en, 'panel.logHint', { total: 1, errors: 1 })).toBe('1 row · 1 error');
    expect(translate(en, 'panel.logHint', { total: 3, errors: 0 })).toBe('3 rows · 0 errors');
    expect(translate(en, 'panel.previousHint', { time: 't', total: 1, errors: 1 })).toBe(
      't · 1 row · 1 error',
    );
    expect(translate(en, 'panel.crashHint', { time: 't', errors: 1 })).toBe(
      'At t · 1 error was kept — tap to view',
    );
    expect(translate(en, 'panel.crashHint', { time: 't', errors: 2 })).toBe(
      'At t · 2 errors were kept — tap to view',
    );
    expect(translate(en, 'panel.reportAttention', { count: 1 })).toBe('1 needs attention');
    expect(translate(en, 'panel.reportAttention', { count: 2 })).toBe('2 need attention');
    expect(translate(en, 'report.queue.countAttention', { count: 1 })).toBe('1 needs attention');
    expect(translate(en, 'log.jsonObjectCount', { count: 1 })).toBe('1 key');
    expect(translate(en, 'log.jsonArrayCount', { count: 1 })).toBe('1 item');
    expect(translate(en, 'log.jsonObjectSummary', { size: '2 B', count: 1, keys: 'a' })).toBe(
      '2 B · 1 key: a',
    );
    expect(translate(vi, 'panel.reportSteps', { count: 1 })).toBe('1 bước tự ghi');
    expect(translate(vi, 'panel.logHint', { total: 1, errors: 1 })).toBe('1 dòng · 1 lỗi');
  });

  it('không escape ký tự đặc biệt trong giá trị biến', () => {
    expect(translate(vi, 'panel.previousHint', { time: '<b>&"x"</b>', total: 1, errors: 0 })).toBe(
      '<b>&"x"</b> · 1 dòng · 0 lỗi',
    );
  });
});
