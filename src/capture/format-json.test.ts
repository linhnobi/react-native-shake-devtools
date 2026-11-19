import { formatJsonLenient, tokenizeJson } from './format-json';

describe('formatJsonLenient', () => {
  it('JSON hợp lệ ra đúng hình `JSON.stringify(_, null, 2)`', () => {
    const raw = '{"a":[1,2],"b":{"c":"x"},"d":null}';
    expect(formatJsonLenient(raw)).toBe(JSON.stringify(JSON.parse(raw), null, 2));
  });

  it('`{}` / `[]` rỗng giữ một dòng', () => {
    expect(formatJsonLenient('{"a":{},"b":[]}')).toBe('{\n  "a": {},\n  "b": []\n}');
  });

  it('ngoặc/phẩy/`:` trong chuỗi (kể cả `\\"`) không tính', () => {
    expect(formatJsonLenient('{"a":"x,{y:\\"]"}')).toBe('{\n  "a": "x,{y:\\"]"\n}');
  });

  it('thân bị cắt vẫn thụt lề phần đã có', () => {
    expect(formatJsonLenient('{"items":[{"id":1},{"i…+900')).toBe(
      '{\n  "items": [\n    {\n      "id": 1\n    },\n    {\n      "i…+900',
    );
  });

  it('không phải JSON ⇒ giữ nguyên', () => {
    expect(formatJsonLenient('<html>a, b</html>')).toBe('<html>a, b</html>');
  });
});

describe('tokenizeJson', () => {
  it('phân đúng khoá với chuỗi giá trị', () => {
    const tokens = tokenizeJson('{\n  "a": "b"\n}');
    expect(tokens.find((x) => x.text === '"a"')?.kind).toBe('key');
    expect(tokens.find((x) => x.text === '"b"')?.kind).toBe('string');
  });

  it('số và literal', () => {
    const kinds = tokenizeJson('[-1.5e3, true, false, null]')
      .filter((x) => x.kind === 'number' || x.kind === 'literal')
      .map((x) => `${x.kind}:${x.text}`);
    expect(kinds).toEqual(['number:-1.5e3', 'literal:true', 'literal:false', 'literal:null']);
  });

  it('nối lại các đoạn ra đúng chuỗi vào (kể cả chuỗi chưa đóng)', () => {
    const text = '{\n  "a": [1, "x\\"y"],\n  "b": "chưa đóng…+9';
    expect(
      tokenizeJson(text)
        .map((x) => x.text)
        .join(''),
    ).toBe(text);
  });
});
