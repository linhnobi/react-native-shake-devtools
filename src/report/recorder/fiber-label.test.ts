import { describeTouchTarget, fiberFromTouchEvent, type FiberLike } from './fiber-label';

interface NodeSpec {
  type?: unknown;
  tag?: number;
  props?: unknown;
  children?: NodeSpec[];
}

/** Dựng cây fiber giả: nối `return` / `child` / `sibling`. */
const build = (spec: NodeSpec, parent: FiberLike | null = null): FiberLike => {
  const fiber: FiberLike = {
    tag: spec.tag ?? 5,
    type: spec.type ?? 'View',
    memoizedProps: spec.props ?? {},
    return: parent,
    child: null,
    sibling: null,
  };
  let prev: FiberLike | null = null;
  for (const c of spec.children ?? []) {
    const cf = build(c, fiber);
    if (prev) prev.sibling = cf;
    else fiber.child = cf;
    prev = cf;
  }
  return fiber;
};

/** Chữ hiển thị: HostText có `memoizedProps` là chính chuỗi. */
const text = (s: string): NodeSpec => ({ tag: 6, type: null, props: s });

/** `<Text>s</Text>` = host `RCTText` chứa một HostText. */
const rnText = (s: string): NodeSpec => ({ type: 'RCTText', children: [text(s)] });

/** Đi xuống theo chỉ số con ở mỗi cấp — lấy ra fiber lá bị chạm. */
const down = (f: FiberLike, ...path: number[]): FiberLike => {
  let cur = f;
  for (const i of path) {
    let c = cur.child as FiberLike;
    for (let k = 0; k < i; k++) c = c.sibling as FiberLike;
    cur = c;
  }
  return cur;
};

const noop = () => undefined;
const ON = { recordVisibleText: true };

describe('describeTouchTarget', () => {
  it('lấy DÒNG CHỮ ĐẦU TIÊN của Pressable, không gộp các dòng', () => {
    const root = build({
      type: 'Pressable',
      props: { onPress: noop },
      children: [{ children: [rnText('Pay now'), rnText('A · RN Pressable + text')] }],
    });
    expect(describeTouchTarget(down(root, 0, 0, 0), ON)).toEqual({ kind: 'tap', label: 'Pay now', source: 'text' });
    // chạm vào dòng thứ hai vẫn ra nhãn của nút (dòng đầu), vì nhãn là của nút
    expect(describeTouchTarget(down(root, 0, 1, 0), ON)).toEqual({ kind: 'tap', label: 'Pay now', source: 'text' });
  });

  it('accessibilityLabel thắng chữ hiển thị', () => {
    const root = build({
      type: 'Pressable',
      props: { onPress: noop, accessibilityLabel: 'Add to cart' },
      children: [rnText('+')],
    });
    expect(describeTouchTarget(down(root, 0, 0), ON)).toEqual({
      kind: 'tap',
      label: 'Add to cart',
      source: 'accessibilityLabel',
    });
  });

  it('aria-label cũng được tính là accessibilityLabel', () => {
    const root = build({ type: 'Pressable', props: { onPress: noop, 'aria-label': 'Close' } });
    expect(describeTouchTarget(root, ON)).toEqual({ kind: 'tap', label: 'Close', source: 'accessibilityLabel' });
  });

  it('accessibilityLabel ở con cháu gần cũng được lấy, và thắng testID của cha', () => {
    const root = build({
      type: 'Pressable',
      props: { onPress: noop, testID: 'btn' },
      children: [{ children: [{ props: { accessibilityLabel: 'Save' } }] }],
    });
    expect(describeTouchTarget(root, ON)).toEqual({ kind: 'tap', label: 'Save', source: 'accessibilityLabel' });
  });

  it('không dò sâu quá 4 cấp để tìm nhãn khai báo', () => {
    let deep: NodeSpec = { props: { accessibilityLabel: 'Too deep' } };
    for (let i = 0; i < 4; i++) deep = { children: [deep] }; // nhãn nằm ở cấp 5
    const root = build({ type: 'Pressable', props: { onPress: noop }, children: [deep] });
    expect(describeTouchTarget(root, ON)).toEqual({ kind: 'tap', source: 'none' });
  });

  it('testID là nhãn khi không có accessibilityLabel', () => {
    const root = build({
      type: 'Pressable',
      props: { onPress: noop, testID: 'checkout-btn' },
      children: [rnText('Thanh toán')],
    });
    expect(describeTouchTarget(root, ON)).toEqual({ kind: 'tap', label: 'checkout-btn', source: 'testID' });
  });

  it('Pressable không chữ, không nhãn ⇒ source none và không có label', () => {
    const root = build({ type: 'Pressable', props: { onPress: noop }, children: [{}] });
    const result = describeTouchTarget(down(root, 0), ON);
    expect(result).toEqual({ kind: 'tap', source: 'none' });
    expect(result).not.toHaveProperty('label');
  });

  it('onLongPress và onValueChange cũng là phần tử bấm được', () => {
    const a = build({ type: 'Pressable', props: { onLongPress: noop }, children: [rnText('Hold')] });
    expect(describeTouchTarget(down(a, 0, 0), ON)).toEqual({ kind: 'tap', label: 'Hold', source: 'text' });
    const b = build({ type: 'Switch', props: { onValueChange: noop, accessibilityLabel: 'Dark mode' } });
    expect(describeTouchTarget(b, ON)).toEqual({ kind: 'tap', label: 'Dark mode', source: 'accessibilityLabel' });
  });

  it('chữ hiển thị đi qua bước che dữ liệu cá nhân', () => {
    const root = build({
      type: 'Pressable',
      props: { onPress: noop },
      children: [rnText('Nguyễn Văn A · 0912 345 678')],
    });
    expect(describeTouchTarget(down(root, 0, 0), ON)).toEqual({
      kind: 'tap',
      label: 'Nguyễn Văn A · •••678',
      source: 'text',
    });
  });

  it('accessibilityLabel chứa số điện thoại cũng bị che', () => {
    const root = build({ type: 'Pressable', props: { onPress: noop, accessibilityLabel: 'Gọi 0912345678' } });
    expect(describeTouchTarget(root, ON)).toEqual({
      kind: 'tap',
      label: 'Gọi •••678',
      source: 'accessibilityLabel',
    });
  });

  it('recordVisibleText:false ⇒ không lấy chữ hiển thị (source none)', () => {
    const root = build({
      type: 'Pressable',
      props: { onPress: noop },
      children: [rnText('Nguyễn Văn A · 0912 345 678')],
    });
    const result = describeTouchTarget(down(root, 0, 0), { recordVisibleText: false });
    expect(result).toEqual({ kind: 'tap', source: 'none' });
    expect(JSON.stringify(result)).not.toContain('Nguyễn');
  });

  it('recordVisibleText:false vẫn dùng accessibilityLabel và testID', () => {
    const a = build({ type: 'Pressable', props: { onPress: noop, accessibilityLabel: 'Pay' }, children: [rnText('Hi')] });
    expect(describeTouchTarget(a, { recordVisibleText: false })).toEqual({
      kind: 'tap',
      label: 'Pay',
      source: 'accessibilityLabel',
    });
    const b = build({ type: 'Pressable', props: { onPress: noop, testID: 'pay' }, children: [rnText('Hi')] });
    expect(describeTouchTarget(b, { recordVisibleText: false })).toEqual({
      kind: 'tap',
      label: 'pay',
      source: 'testID',
    });
  });

  it('cắt nhãn 60 ký tự còn 40 ký tự + …', () => {
    const long = 'x'.repeat(60);
    const root = build({ type: 'Pressable', props: { onPress: noop }, children: [rnText(long)] });
    const result = describeTouchTarget(down(root, 0, 0), ON);
    expect(result?.label).toBe(`${'x'.repeat(40)}…`);
  });

  it('nhãn đúng 40 ký tự không bị cắt', () => {
    const exact = 'y'.repeat(40);
    const root = build({ type: 'Pressable', props: { onPress: noop }, children: [rnText(exact)] });
    expect(describeTouchTarget(down(root, 0, 0), ON)?.label).toBe(exact);
  });

  it('che trước rồi mới cắt: số điện thoại ở ranh giới cắt không lộ nửa chừng', () => {
    const s = `${'a'.repeat(30)} 0912345678`; // thô 41 ký tự, sau che 37
    const root = build({ type: 'Pressable', props: { onPress: noop }, children: [rnText(s)] });
    expect(describeTouchTarget(down(root, 0, 0), ON)?.label).toBe(`${'a'.repeat(30)} •••678`);
  });

  it('bỏ qua chữ rỗng/khoảng trắng, lấy dòng chữ có nội dung đầu tiên', () => {
    const root = build({
      type: 'Pressable',
      props: { onPress: noop },
      children: [rnText('   '), rnText('  Gửi   đi  ')],
    });
    expect(describeTouchTarget(root, ON)).toEqual({ kind: 'tap', label: 'Gửi đi', source: 'text' });
  });

  it('dừng ở tổ tiên bấm được GẦN NHẤT', () => {
    const root = build({
      type: 'Pressable',
      props: { onPress: noop, accessibilityLabel: 'Outer' },
      children: [{ type: 'Pressable', props: { onPress: noop, accessibilityLabel: 'Inner' }, children: [rnText('x')] }],
    });
    expect(describeTouchTarget(down(root, 0, 0, 0), ON)?.label).toBe('Inner');
  });

  it('không có tổ tiên bấm được và không phải ô nhập ⇒ null', () => {
    const root = build({ type: 'View', children: [{ children: [rnText('Chỉ là chữ')] }] });
    expect(describeTouchTarget(down(root, 0, 0, 0), ON)).toBeNull();
  });

  it('chỉ đi ngược tối đa 40 cấp', () => {
    let spec: NodeSpec = { type: 'View' };
    for (let i = 0; i < 45; i++) spec = { children: [spec] };
    const root = build({ type: 'Pressable', props: { onPress: noop }, children: [spec] });
    let leaf = root;
    while (leaf.child) leaf = leaf.child;
    expect(describeTouchTarget(leaf, ON)).toBeNull();
  });

  it('ô nhập: dùng placeholder và KHÔNG chứa value', () => {
    const input = build({
      type: 'AndroidTextInput',
      props: { placeholder: 'Email', value: 'secret@corp.com', defaultValue: 'secret-default' },
    });
    const result = describeTouchTarget(input, ON);
    expect(result).toEqual({ kind: 'input', label: 'Email', source: 'placeholder' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('ô nhập không placeholder, không nhãn ⇒ không lộ value', () => {
    const input = build({ type: 'AndroidTextInput', props: { value: 'secret@corp.com' } });
    const result = describeTouchTarget(input, ON);
    expect(result).toEqual({ kind: 'input', source: 'none' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('ô nhập có accessibilityLabel thắng placeholder (kể cả secureTextEntry)', () => {
    const input = build({
      type: 'AndroidTextInput',
      props: { accessibilityLabel: 'Password', placeholder: 'Nhập mật khẩu', secureTextEntry: true, value: 'hunter2' },
    });
    const result = describeTouchTarget(input, ON);
    expect(result).toEqual({ kind: 'input', label: 'Password', source: 'accessibilityLabel' });
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('nhận ô nhập theo host type RCTSinglelineTextInputView và theo onChangeText', () => {
    const a = build({ type: 'RCTSinglelineTextInputView', props: { placeholder: 'Tên' } });
    expect(describeTouchTarget(a, ON)).toEqual({ kind: 'input', label: 'Tên', source: 'placeholder' });
    const b = build({ type: 'MyField', props: { onChangeText: noop, placeholder: 'Mã' } });
    expect(describeTouchTarget(b, ON)).toEqual({ kind: 'input', label: 'Mã', source: 'placeholder' });
  });

  it('chạm vào con của ô nhập: ô nhập thắng Pressable bọc ngoài', () => {
    const root = build({
      type: 'Pressable',
      props: { onPress: noop, accessibilityLabel: 'Wrapper' },
      children: [{ type: 'AndroidTextInput', props: { placeholder: 'Email' }, children: [{}] }],
    });
    expect(describeTouchTarget(down(root, 0, 0), ON)).toEqual({
      kind: 'input',
      label: 'Email',
      source: 'placeholder',
    });
  });

  it('chữ trong cây con của ô nhập (mention/rich-text input) không bao giờ thành nhãn của phần tử bọc ngoài', () => {
    // <Pressable onPress><AndroidTextInput onChangeText><Text>{giá trị đã gõ}</Text></AndroidTextInput><Icon/></Pressable>
    const row = build({
      type: 'Pressable',
      props: { onPress: noop },
      children: [
        { type: 'AndroidTextInput', props: { onChangeText: noop }, children: [rnText('anh Hùng ơi chuyển khoản')] },
        { type: 'Icon' },
      ],
    });
    expect(describeTouchTarget(down(row, 1), ON)).toEqual({ kind: 'tap', source: 'none' });

    // Ô nhập nhận theo host type (không có onChangeText); chữ đứng SAU ô nhập vẫn làm nhãn được.
    const bar = build({
      type: 'Pressable',
      props: { onPress: noop },
      children: [
        { type: 'RCTSinglelineTextInputView', children: [rnText('đã gõ bí mật')] },
        rnText('Gửi'),
      ],
    });
    expect(describeTouchTarget(down(bar, 1, 0), ON)).toEqual({ kind: 'tap', label: 'Gửi', source: 'text' });
  });

  it('placeholder cũng được che dữ liệu cá nhân', () => {
    const input = build({ type: 'AndroidTextInput', props: { placeholder: 'vd 0912 345 678' } });
    expect(describeTouchTarget(input, ON)?.label).toBe('vd •••678');
  });

  it('không nổ khi fiber thiếu trường (memoizedProps null, child undefined)', () => {
    const odd = { tag: 5, type: 'Pressable', memoizedProps: null, return: null } as unknown as FiberLike;
    expect(describeTouchTarget(odd, ON)).toBeNull();
    const odd2 = {
      tag: 5,
      type: 'Pressable',
      memoizedProps: { onPress: noop },
      return: null,
    } as unknown as FiberLike;
    expect(describeTouchTarget(odd2, ON)).toEqual({ kind: 'tap', source: 'none' });
  });
});

describe('fiberFromTouchEvent', () => {
  const fiber = build({});

  it('lấy _targetInst trước', () => {
    expect(fiberFromTouchEvent({ _targetInst: fiber, target: { __internalInstanceHandle: build({}) } })).toBe(fiber);
  });

  it('không có _targetInst thì lấy target.__internalInstanceHandle', () => {
    expect(fiberFromTouchEvent({ target: { __internalInstanceHandle: fiber } })).toBe(fiber);
  });

  it('không có gì ⇒ null', () => {
    expect(fiberFromTouchEvent({})).toBeNull();
    expect(fiberFromTouchEvent({ target: 7 })).toBeNull();
    expect(fiberFromTouchEvent(null)).toBeNull();
    expect(fiberFromTouchEvent(undefined)).toBeNull();
    expect(fiberFromTouchEvent('x')).toBeNull();
  });
});
