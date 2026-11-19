import { maskPersonalData } from '../../capture/mask-label';
import type { LabelSource } from '../../capture/recorded-action';

/**
 * Hình dạng tối thiểu của một fiber React mà bộ ghi đọc. Đây là **nội bộ của React** (không phải
 * API công khai): đã kiểm trên RN 0.86 bản release (Android), nên mọi chỗ đọc đều phòng thủ —
 * thiếu trường thì coi như không có chứ không ném.
 */
export interface FiberLike {
  tag: number;
  type: unknown;
  memoizedProps: unknown;
  return: FiberLike | null;
  child: FiberLike | null;
  sibling: FiberLike | null;
}

/** Kết quả nhận diện một cú chạm. `label` vắng ⇒ không có nhãn nào dùng được (`source: 'none'`). */
export interface TouchTarget {
  kind: 'tap' | 'input';
  label?: string;
  source: LabelSource;
}

type Props = Record<string, unknown>;

/** `tag` của HostText trong React: `memoizedProps` của nó chính là chuỗi hiển thị. */
const HOST_TEXT_TAG = 6;
/** Host type của ô nhập: `AndroidTextInput`, `RCTSinglelineTextInputView`, `RCTMultilineTextInputView`… */
const TEXT_INPUT_HOST = /TextInput/i;
/** Số cấp đi ngược tối đa để tìm phần tử bấm được / ô nhập. */
const MAX_ANCESTORS = 40;
/** Số cấp con cháu dò nhãn khai báo (`accessibilityLabel`/`testID`). */
const MAX_DECLARED_DEPTH = 4;
/** Số cấp và số node tối đa khi dò chữ hiển thị — chặn cây khổng lồ hoặc vòng lặp bất thường. */
const MAX_TEXT_DEPTH = 12;
const MAX_TEXT_NODES = 300;
/** Nhãn dài nhất giữ lại (ký tự), quá thì cắt và thêm `…`. */
const MAX_LABEL = 40;

const propsOf = (f: FiberLike): Props | null =>
  f.memoizedProps && typeof f.memoizedProps === 'object' ? (f.memoizedProps as Props) : null;

const isActionable = (p: Props | null): boolean =>
  !!p &&
  (typeof p.onPress === 'function' ||
    typeof p.onLongPress === 'function' ||
    typeof p.onValueChange === 'function');

const isTextInput = (f: FiberLike): boolean => {
  const p = propsOf(f);
  return (
    (typeof f.type === 'string' && TEXT_INPUT_HOST.test(f.type)) ||
    (!!p && typeof p.onChangeText === 'function')
  );
};

/** Chuỗi không rỗng sau khi bỏ khoảng trắng hai đầu; ngược lại `null`. */
const nonEmpty = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/** Che dữ liệu cá nhân rồi mới cắt (cắt trước có thể chẻ đôi số điện thoại và để lộ nửa chừng). */
const finish = (raw: string): string => {
  const masked = maskPersonalData(raw.replace(/\s+/g, ' ').trim());
  return masked.length > MAX_LABEL ? `${masked.slice(0, MAX_LABEL)}…` : masked;
};

/**
 * Nhãn khai báo trên chính `root` và con cháu tối đa 4 cấp (duyệt theo tầng).
 * Thứ tự ưu tiên: `accessibilityLabel` → `aria-label` → `testID`.
 */
const declaredLabel = (root: FiberLike): { label: string; source: LabelSource } | null => {
  let a11y: string | null = null;
  let aria: string | null = null;
  let testId: string | null = null;
  const queue: Array<{ f: FiberLike; d: number }> = [{ f: root, d: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const { f, d } = queue[i]!;
    const p = propsOf(f);
    if (p) {
      a11y ??= nonEmpty(p.accessibilityLabel);
      aria ??= nonEmpty(p['aria-label']);
      testId ??= nonEmpty(p.testID);
    }
    if (a11y) break;
    if (d < MAX_DECLARED_DEPTH) {
      for (let c = f.child; c; c = c.sibling) queue.push({ f: c, d: d + 1 });
    }
  }
  const accessible = a11y ?? aria;
  if (accessible) return { label: accessible, source: 'accessibilityLabel' };
  if (testId) return { label: testId, source: 'testID' };
  return null;
};

/**
 * Dòng chữ hiển thị **đầu tiên** (HostText) trong cây con của `root`, theo thứ tự duyệt cây.
 * 🔴 Không bao giờ đi vào cây con của một ô nhập: ô mention/rich-text (`<TextInput><Text>{value}
 * </Text></TextInput>`) vẽ chính **giá trị đã gõ** thành HostText con.
 */
const firstVisibleText = (root: FiberLike): string | null => {
  let visited = 0;
  const walk = (start: FiberLike | null, depth: number): string | null => {
    for (let c = start; c && visited < MAX_TEXT_NODES; c = c.sibling) {
      visited++;
      if (isTextInput(c)) continue;
      if (c.tag === HOST_TEXT_TAG) {
        const t = nonEmpty(c.memoizedProps);
        if (t) return t;
      }
      if (depth < MAX_TEXT_DEPTH) {
        const inner = walk(c.child, depth + 1);
        if (inner) return inner;
      }
    }
    return null;
  };
  return walk(root.child, 0);
};

/**
 * **Chức năng:** từ fiber của phần tử QA vừa chạm, tìm ra **cái gì** vừa bị chạm và gọi nó là gì
 * bằng thứ người đọc hiểu được — để dòng timeline ghi "Chạm 'Pay now'" thay vì toạ độ.
 *
 * Đi ngược `return` tối đa 40 cấp. **Gặp ô nhập trước thì dừng** (host type khớp `/TextInput/i`
 * hoặc props có `onChangeText`); không thì dừng ở tổ tiên **gần nhất** có `onPress`, `onLongPress`
 * hoặc `onValueChange`.
 *
 * Nhãn, theo thứ tự ưu tiên:
 * 1. `accessibilityLabel` / `aria-label` — trên phần tử và con cháu tối đa 4 cấp;
 * 2. `testID`;
 * 3. **dòng chữ hiển thị đầu tiên** (không gộp các dòng: spike cho ra nhiễu kiểu
 *    `Pay now A · RN Pressable + text`) — bỏ qua khi `recordVisibleText: false`; không bao giờ lấy
 *    chữ nằm trong cây con của một ô nhập (ô mention vẽ giá trị đã gõ thành chữ con);
 * 4. ô nhập: `placeholder`.
 *
 * Mọi nhãn qua `maskPersonalData` rồi mới cắt còn 40 ký tự + `…`.
 *
 * 🔴 **Không bao giờ đọc `value` / `defaultValue`** của ô nhập — đó là thứ người dùng gõ (mật khẩu,
 * email…). Không có đường nào trong file này chạm tới hai prop đó, và test khoá việc kết quả không
 * chứa chúng.
 *
 * **Input:**
 * - `fiber` — fiber của phần tử bị chạm (lấy từ `fiberFromTouchEvent`).
 * - `opts.recordVisibleText` — `false` ⇒ không lấy chữ hiển thị làm nhãn (app ngân hàng, y tế).
 *   `accessibilityLabel`, `testID` và `placeholder` vẫn dùng: đó là chữ nhà phát triển đặt, không
 *   phải dữ liệu người dùng.
 *
 * **Output:** `{ kind, label?, source }`; `null` khi không có phần tử bấm được và cũng không phải
 * ô nhập. Không bao giờ ném với fiber thiếu trường.
 *
 * @example
 * ```ts
 * // <Pressable onPress><View><Text>Pay now</Text><Text>A · RN Pressable + text</Text></View></Pressable>
 * describeTouchTarget(fiberOfPayNowText, { recordVisibleText: true });
 * // → { kind: 'tap', label: 'Pay now', source: 'text' }
 *
 * // <TextInput placeholder="Email" value="secret@corp.com" />
 * describeTouchTarget(fiberOfInput, { recordVisibleText: true });
 * // → { kind: 'input', label: 'Email', source: 'placeholder' }   (không có 'secret')
 *
 * // <View><Text>Chỉ là chữ</Text></View>
 * describeTouchTarget(fiberOfPlainText, { recordVisibleText: true }); // → null
 * ```
 *
 * **Unit test:** `fiber-label.test.ts` — 30 case: 27 cho `describeTouchTarget` (dòng chữ đầu tiên ·
 * accessibilityLabel/aria-label/testID và thứ tự ưu tiên · giới hạn 4 cấp · không nhãn · onLongPress/
 * onValueChange · che dữ liệu cá nhân · `recordVisibleText:false` · cắt 40 ký tự · che trước khi cắt ·
 * tổ tiên gần nhất · `null` · giới hạn 40 cấp ngược · ô nhập không lộ `value` · secureTextEntry ·
 * nhận ô nhập theo host type/`onChangeText` · chữ trong cây con ô nhập không thành nhãn · fiber
 * thiếu trường) và 3 cho `fiberFromTouchEvent`.
 */
export function describeTouchTarget(
  fiber: FiberLike,
  opts: { recordVisibleText: boolean },
): TouchTarget | null {
  let subject: FiberLike | null = null;
  let isInput = false;
  for (let f: FiberLike | null = fiber, d = 0; f && d < MAX_ANCESTORS; f = f.return, d++) {
    if (isTextInput(f)) {
      subject = f;
      isInput = true;
      break;
    }
    if (isActionable(propsOf(f))) {
      subject = f;
      break;
    }
  }
  if (!subject) return null;

  const declared = declaredLabel(subject);
  if (declared) return { kind: isInput ? 'input' : 'tap', label: finish(declared.label), source: declared.source };

  if (isInput) {
    // Cố ý KHÔNG đọc `value` / `defaultValue`.
    const placeholder = nonEmpty(propsOf(subject)?.placeholder);
    return placeholder
      ? { kind: 'input', label: finish(placeholder), source: 'placeholder' }
      : { kind: 'input', source: 'none' };
  }

  const text = opts.recordVisibleText ? firstVisibleText(subject) : null;
  return text ? { kind: 'tap', label: finish(text), source: 'text' } : { kind: 'tap', source: 'none' };
}

/**
 * **Chức năng:** lấy fiber của phần tử bị chạm từ event của `onTouchStart`.
 *
 * Thử `_targetInst` (cách Sentry dùng), rồi `target.__internalInstanceHandle` (Fabric). Cả hai đều
 * có mặt trên RN 0.86 bản release (kiểm trên máy thật).
 *
 * **Input:** `e` — event chạm (kiểu `unknown`: nội bộ RN, không tin cấu trúc).
 *
 * **Output:** fiber, hoặc `null` nếu event không mang theo (kiến trúc/RN khác).
 *
 * @example
 * ```ts
 * fiberFromTouchEvent({ _targetInst: fiber });                          // → fiber
 * fiberFromTouchEvent({ target: { __internalInstanceHandle: fiber } }); // → fiber
 * fiberFromTouchEvent({});                                              // → null
 * ```
 *
 * **Unit test:** `fiber-label.test.ts` — 3 case: `_targetInst` thắng · chỉ có `target.__internalInstanceHandle` ·
 * không có gì (`{}`, `target` không phải object, `null`, `undefined`, chuỗi) ⇒ `null`.
 */
export function fiberFromTouchEvent(e: unknown): FiberLike | null {
  if (!e || typeof e !== 'object') return null;
  const ev = e as Record<string, unknown>;
  const direct = ev._targetInst;
  if (direct && typeof direct === 'object') return direct as FiberLike;
  const target = ev.target;
  if (target && typeof target === 'object') {
    const handle = (target as Record<string, unknown>).__internalInstanceHandle;
    if (handle && typeof handle === 'object') return handle as FiberLike;
  }
  return null;
}
