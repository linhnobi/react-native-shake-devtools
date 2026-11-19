/** Thụt lề mỗi tầng — cùng bậc với `JSON.stringify(_, null, 2)` để hai đường cho ra một hình. */
const INDENT = '  ';

/**
 * **Chức năng:** dàn dòng một chuỗi **trông như JSON** mà KHÔNG cần nó hợp lệ — đọc từng ký tự,
 * thụt lề theo `{ } [ ] ,`, bỏ qua mọi thứ nằm trong chuỗi.
 *
 * ## Vì sao cần, khi đã có `JSON.stringify(JSON.parse(…))`
 *
 * Thân bị cắt ở hạn mức của vòng đệm thì `JSON.parse` ném, và trước đây màn chi tiết rơi về
 * **chuỗi gốc đã nén** — một dòng 4.000 ký tự. Tức là đúng những response dài (thứ cần đọc nhất)
 * lại là thứ khó đọc nhất. Hàm này không cần cấu trúc đóng đủ: cắt giữa chừng thì phần đã có vẫn
 * thụt lề đúng, đuôi `…+N` của `truncate` nằm ở dòng cuối.
 *
 * **Input:** `text` — chuỗi bất kỳ. **Output:** chuỗi đã xuống dòng + thụt lề. Không phải JSON
 * (không mở bằng `{`/`[`) ⇒ trả **nguyên văn**.
 *
 * @example
 * ```ts
 * formatJsonLenient('{"a":[1,2],"b":{}}');   // '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {}\n}'
 * formatJsonLenient('{"a":"x,{y"');          // '{\n  "a": "x,{y"' — dấu trong chuỗi không tính
 * formatJsonLenient('{"items":[{"id":1},{"i…+900');   // ca biên: bị cắt ⇒ vẫn thụt lề phần đã có
 * formatJsonLenient('<html>');               // '<html>' — không phải JSON, giữ nguyên
 * ```
 *
 * **Unit test:** `format-json.test.ts` › `formatJsonLenient` — 5 case: JSON hợp lệ ra đúng hình
 * `JSON.stringify(_, null, 2)` · `{}`/`[]` rỗng giữ một dòng · dấu ngoặc/phẩy trong chuỗi (kể cả
 * `\"`) không tính · thân bị cắt vẫn thụt lề · không phải JSON giữ nguyên.
 */
export const formatJsonLenient = (text: string): string => {
  const start = text.trimStart()[0];
  if (start !== '{' && start !== '[') return text;

  let out = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  const newline = () => `\n${INDENT.repeat(Math.max(0, depth))}`;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '{' || ch === '[') {
      /* Rỗng (`{}` / `[]`) ⇒ giữ trên một dòng, như `JSON.stringify`. */
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (text[j] === (ch === '{' ? '}' : ']')) {
        out += ch + text[j];
        i = j;
      } else {
        depth += 1;
        out += ch + newline();
      }
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      out += newline() + ch;
    } else if (ch === ',') {
      out += ch + newline();
    } else if (ch === ':') {
      out += ': ';
    } else if (!/\s/.test(ch)) {
      out += ch;
    }
  }
  return out;
};

export type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'plain';

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

/**
 * **Chức năng:** chia một chuỗi JSON **đã dàn dòng** thành đoạn để tô màu — khoá · chuỗi · số ·
 * `true`/`false`/`null` · dấu câu · phần còn lại (khoảng trắng, đuôi `…+N`). Chịu được chuỗi bị cắt
 * như {@link formatJsonLenient}. Đoạn liền nhau cùng loại được gộp để số `Text` lồng nhau ít nhất.
 *
 * **Input:** `text`. **Output:** `JsonToken[]`; nối `text` của mọi đoạn lại ra **đúng** chuỗi vào.
 *
 * @example
 * ```ts
 * tokenizeJson('{"a": 1}');
 * // [{ punct '{' }, { key '"a"' }, { punct ': ' }, { number '1' }, { punct '}' }]
 * tokenizeJson('"x');   // ca biên: chuỗi chưa đóng ⇒ một đoạn string tới hết
 * ```
 *
 * **Unit test:** `format-json.test.ts` › `tokenizeJson` — 3 case: phân đúng khoá với chuỗi giá trị
 * · số/literal · nối lại các đoạn ra đúng chuỗi vào (kể cả chuỗi chưa đóng).
 */
export const tokenizeJson = (text: string): JsonToken[] => {
  const tokens: JsonToken[] = [];
  const push = (kind: JsonTokenKind, part: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind && kind !== 'key' && kind !== 'string') last.text += part;
    else tokens.push({ kind, text: part });
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const part = text.slice(i, Math.min(j + 1, text.length));
      /* Khoá = chuỗi mà ký tự kế tiếp (bỏ khoảng trắng) là `:`. */
      let k = j + 1;
      while (k < text.length && text[k] === ' ') k += 1;
      push(text[k] === ':' ? 'key' : 'string', part);
      i += part.length;
    } else if (/[-\d]/.test(ch)) {
      const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
      const part = m ? m[0] : ch;
      push(m ? 'number' : 'plain', part);
      i += part.length;
    } else if (text.startsWith('true', i) || text.startsWith('null', i)) {
      push('literal', text.slice(i, i + 4));
      i += 4;
    } else if (text.startsWith('false', i)) {
      push('literal', 'false');
      i += 5;
    } else if ('{}[],:'.includes(ch)) {
      push('punct', ch);
      i += 1;
    } else {
      push('plain', ch);
      i += 1;
    }
  }
  return tokens;
};
