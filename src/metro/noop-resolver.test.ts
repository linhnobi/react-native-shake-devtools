import { NOOP_ENTRIES, devtoolsNoopResolver, toNoopRequest } from './noop-resolver';

/*
  `require` chứ không `import`: tsconfig không bật `resolveJsonModule`. Test này chỉ đọc *khoá* của
  `exports`; giá trị (bộ điều kiện `types` / `react-native` / `default`) do `package-exports.test.ts` khoá.
*/
const pkg = require('../../package.json') as { exports: Record<string, unknown> };
const P = 'react-native-shake-devtools';

describe('toNoopRequest', () => {
  it('tráo năm entry công khai sang bản noop', () => {
    expect(toNoopRequest(P)).toBe(`${P}/noop`);
    expect(toNoopRequest(`${P}/capture`)).toBe(`${P}/noop/capture`);
    expect(toNoopRequest(`${P}/shake`)).toBe(`${P}/noop/shake`);
    expect(toNoopRequest(`${P}/i18n`)).toBe(`${P}/noop/i18n`);
    expect(toNoopRequest(`${P}/plain`)).toBe(`${P}/noop/plain`);
  });

  it('để nguyên gói khác, đường tương đối, và gói chỉ trùng tiền tố tên', () => {
    expect(toNoopRequest('react-native')).toBe('react-native');
    expect(toNoopRequest('./capture')).toBe('./capture');
    expect(toNoopRequest(`${P}-extra`)).toBe(`${P}-extra`);
  });

  it('để nguyên đường noop và package.json — không tráo hai lần', () => {
    expect(toNoopRequest(`${P}/noop`)).toBe(`${P}/noop`);
    expect(toNoopRequest(`${P}/noop/capture`)).toBe(`${P}/noop/capture`);
    expect(toNoopRequest(`${P}/package.json`)).toBe(`${P}/package.json`);
  });

  it('đường lạ của gói ⇒ ném, kèm tên đường (không lặng lẽ mang code thật vào bundle prod)', () => {
    expect(() => toNoopRequest(`${P}/src/panel/LogRow`)).toThrow(`${P}/src/panel/LogRow`);
    expect(() => toNoopRequest(`${P}/metro`)).toThrow('Không có bản noop');
  });

  it('khớp package.json#exports: mọi entry bundle được đều có bản noop, mọi đích tráo đều tồn tại', () => {
    const exported = Object.keys(pkg.exports).map((k) => (k === '.' ? P : `${P}/${k.slice(2)}`));
    const nodeOnly = new Set([`${P}/metro`, `${P}/package.json`]);
    const targets = Object.values(NOOP_ENTRIES);
    const bundleable = exported.filter((e) => !nodeOnly.has(e) && !targets.includes(e));

    expect(Object.keys(NOOP_ENTRIES).sort()).toEqual(bundleable.sort());
    expect(targets.every((t) => exported.includes(t))).toBe(true);
  });
});

describe('devtoolsNoopResolver', () => {
  const makeContext = () => ({ resolveRequest: jest.fn(() => ({ type: 'sourceFile' })) });

  it('enabled ⇒ tráo rồi gọi resolver mặc định của Metro với đúng context/platform', () => {
    const context = makeContext();
    const result = devtoolsNoopResolver({ enabled: true })(context, `${P}/capture`, 'android');

    expect(context.resolveRequest).toHaveBeenCalledWith(context, `${P}/noop/capture`, 'android');
    expect(result).toEqual({ type: 'sourceFile' });
  });

  it('enabled false (hoặc vắng) ⇒ chuyển tiếp nguyên văn, kể cả đường lạ của gói', () => {
    const context = makeContext();
    devtoolsNoopResolver({ enabled: false })(context, P, 'ios');
    devtoolsNoopResolver()(context, `${P}/src/x`, 'ios');

    expect(context.resolveRequest.mock.calls.map((c: unknown[]) => c[1])).toEqual([P, `${P}/src/x`]);
  });

  it('có resolver của app ⇒ gọi nó thay resolver mặc định', () => {
    const context = makeContext();
    const upstream = jest.fn(() => ({ type: 'empty' }));
    devtoolsNoopResolver({ enabled: true, resolveRequest: upstream })(context, P, null);

    expect(upstream).toHaveBeenCalledWith(context, `${P}/noop`, null);
    expect(context.resolveRequest).not.toHaveBeenCalled();
  });

  it('đường lạ của gói ⇒ ném trước khi chạm resolver nào', () => {
    const context = makeContext();
    expect(() =>
      devtoolsNoopResolver({ enabled: true })(context, `${P}/src/panel/LogRow`, 'ios'),
    ).toThrow('Không có bản noop');
    expect(context.resolveRequest).not.toHaveBeenCalled();
  });
});
