import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

/*
  Lưới chặn "màu tay": mọi màu của UI phải đi qua token của `theme.ts` (nên đổi theo sáng/tối).
  Quét mã nguồn `src/` — bỏ file test, bỏ `theme.ts` (nơi duy nhất được khai màu) — tìm hex ·
  `rgb()/rgba()/hsl()` · tên màu trong chuỗi (`'white'`, `'black'`…). `'transparent'` được phép
  (không phải màu cụ thể). Chú thích bị gỡ trước khi quét: ví dụ `color="#fff"` trong JSDoc không tính.
*/
const SRC = join(__dirname, '..');
const ALLOWED = new Set(['ui/theme.ts']);
// Bộ định dạng payload connector dựng body gửi API bên thứ ba (vd. `template: 'red'` của thẻ Lark), không phải style RN.
const SKIPPED_DIRS = ['report/connectors/'];

const NAMED = [
  'white',
  'black',
  'red',
  'green',
  'blue',
  'gray',
  'grey',
  'orange',
  'yellow',
  'purple',
  'pink',
  'brown',
  'cyan',
  'magenta',
  'silver',
  'gold',
  'navy',
  'teal',
  'lime',
];
const NAMED_RE = new RegExp(`['"\`](?:${NAMED.join('|')})['"\`]`, 'i');
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const FUNC_RE = /\b(?:rgba?|hsla?)\s*\(/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });

/** Gỡ chú thích khối và chú thích dòng (không đụng `//` trong URL kiểu `https://`). */
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const posixRel = (root: string, f: string) => relative(root, f).split(sep).join('/');

/** File thuộc phạm vi quét: bỏ `theme.ts` và các thư mục payload connector. */
const scannedFiles = (root: string) =>
  sourceFiles(root).filter((f) => {
    const rel = posixRel(root, f);
    return !ALLOWED.has(rel) && !SKIPPED_DIRS.some((dir) => rel.startsWith(dir));
  });

const findOffenders = (root: string, files: string[]) =>
  files.flatMap((f) => {
    const code = stripComments(readFileSync(f, 'utf8'));
    return code
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => HEX_RE.test(line) || FUNC_RE.test(line) || NAMED_RE.test(line))
      .map(({ line, n }) => `${posixRel(root, f)}:${n}  ${line.trim()}`);
  });

describe('màu UI chỉ đến từ token của theme', () => {
  const files = scannedFiles(SRC);

  it('quét đủ nhiều file (không quét nhầm thư mục rỗng)', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('không file nào ngoài theme.ts chứa hex · rgb()/hsl() · tên màu', () => {
    expect(findOffenders(SRC, files)).toEqual([]);
  });

  it('bộ quét tự nhận ra màu tay (không "xanh giả")', () => {
    for (const bad of ["color: '#fff'", 'bg = "rgba(0,0,0,.5)"', "tint: 'White'", 'x = `#12ab34`']) {
      expect(HEX_RE.test(bad) || FUNC_RE.test(bad) || NAMED_RE.test(bad)).toBe(true);
    }
    for (const ok of ["borderColor: 'transparent'", 'color: colors.text.primary']) {
      expect(HEX_RE.test(ok) || FUNC_RE.test(ok) || NAMED_RE.test(ok)).toBe(false);
    }
  });

  describe('phạm vi quét', () => {
    let root: string;
    const put = (rel: string, code: string) => {
      const full = join(root, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, code);
    };

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'colour-guard-'));
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('bỏ qua tên màu trong src/report/connectors/ (enum API bên thứ ba, không phải màu UI)', () => {
      put('report/connectors/lark/card.ts', "export const header = { template: 'red' };\n");

      expect(findOffenders(root, scannedFiles(root))).toEqual([]);
    });

    it('vẫn bắt màu tay ở file UI (panel/, report/ui/)', () => {
      put('panel/Row.tsx', "export const s = { color: '#fff' };\n");
      put('report/ui/Form.tsx', "export const s = { backgroundColor: 'red' };\n");
      put('report/connectors/lark/card.ts', "export const header = { template: 'red' };\n");

      const offenders = findOffenders(root, scannedFiles(root)).join('\n');

      expect(offenders).toContain('panel/Row.tsx:1');
      expect(offenders).toContain('report/ui/Form.tsx:1');
      expect(offenders).not.toContain('connectors');
    });
  });
});
