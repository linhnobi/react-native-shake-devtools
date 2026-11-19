import type { DevToolsAppContext } from 'react-native-shake-devtools';

/**
 * Ngữ cảnh app gắn vào bản báo bug (`bugReport.appContext`), dữ liệu giả để thử trên máy thật.
 * Panel có hàng **App context (example)** để đổi chế độ tại chỗ:
 *
 * | Chế độ | Hàm trả | Đúng khi |
 * |---|---|---|
 * | `normal` | object nhỏ: user id, flavour, cờ, một lát store có khoá bí mật | chip **App context** bật; ticket có mục App context; `refreshToken`, `accessToken`, `customerRef` và giá trị `Bearer …` ra `<redacted>`; `tokenExpiresAt`, `token_type` vẫn đọc được |
 * | `large` | object to và sâu, có vòng, `Map`, `Date`, `Error`… | `context.json` ≤ 32 000 ký tự, có dấu cắt (`[Object]`, `…+N more`); `userId` đứng sau mảng to vẫn còn |
 * | `throws` | ném lỗi | form vẫn mở, chip ghi **App context unavailable** |
 * | `never` | Promise không bao giờ xong | 1,5 s sau chip ghi **App context unavailable**; Gửi không bị treo |
 *
 * 🔴 App thật không log trong hàm này. Example ghi một dòng `info` mỗi lần lib gọi, để thấy lib gọi
 * **một lần** lúc bấm hàng Báo bug (không phải lúc lắc, không phải lúc gửi).
 */
export type AppContextMode = 'normal' | 'large' | 'throws' | 'never';

export const APP_CONTEXT_MODES: readonly AppContextMode[] = [
  'normal',
  'large',
  'throws',
  'never',
];

export const DEFAULT_APP_CONTEXT_MODE: AppContextMode = 'normal';

const FAKE_USER_ID = 'u-demo-042';

/**
 * Mỗi khoá cấp đầu thành một dòng của mục "App context" trong ticket (tối đa 10 dòng, mỗi giá trị
 * 100 ký tự). Khoá bí mật để ở **đầu** object con nên dòng tóm tắt cũng thấy `<redacted>`, kể cả ở
 * webhook Slack/Lark (chỉ có chữ, không có `context.json`).
 */
const normalContext = (appVersion: string) => ({
  userId: FAKE_USER_ID, // id, không phải email: dữ liệu cá nhân lib không che
  flavor: 'uat',
  build: `${appVersion} (42)`,
  // `Date` ra chuỗi ISO. Đóng rồi mở lại sheet: giá trị không đổi (nháp giữ ngữ cảnh cũ).
  capturedAt: new Date(),
  auth: {
    refreshToken: 'fake-refresh-token-0001', // tên bí mật ⇒ <redacted>
    // base64 của "fake-access-token", có `=` ở cuối (lỗi R1 cũ: JSON liền có `=` lọt khỏi bộ che)
    accessToken: 'ZmFrZS1hY2Nlc3MtdG9rZW4=',
    tokenExpiresAt: '2026-12-31T00:00:00Z', // đọc được: chỉ khoá *kết thúc* bằng token mới bị che
    token_type: 'Bearer', // đọc được: nằm trong danh sách loại trừ
  },
  // Tên riêng của app: chỉ bị che vì `capture.ts` khai `redactKeys: ['customerRef']`.
  customerRef: 'CR-DEMO-7781',
  // Tên vô hại nhưng giá trị khớp mẫu `Bearer` + ≥ 16 ký tự ⇒ vẫn bị che.
  lastAuthHeader: 'Bearer fake-bearer-value-0123456789',
  flags: {
    newCheckout: true,
    applePay: false,
    vietQr: true,
    cartV2: 'variant-b',
  },
  cart: {
    items: [
      { sku: 'SKU-DEMO-1', name: 'Áo thun cổ tròn', qty: 2 },
      { sku: 'SKU-DEMO-2', name: 'Nón bảo hiểm', qty: 1 },
    ],
    total: 349000,
    currency: 'VND',
    coupon: 'GIAMGIA10',
  },
  checkout: {
    step: 'payment',
    paymentMethod: 'card',
    note: 'Giao giờ hành chính, gọi trước khi đến. Đường Nguyễn Thị Minh Khai.',
  },
});

const SENTENCE =
  'Sản phẩm thử nghiệm có mô tả dài để vượt trần ký tự của context.json, kèm dấu tiếng Việt đầy đủ. ';

/** Object vượt mọi trần của lib: sâu 12 tầng, 300 khoá, mảng 500 phần tử, chuỗi 6 000 ký tự, vòng. */
const largeContext = (appVersion: string) => {
  let deep: Record<string, unknown> = { leaf: 'đáy' };
  for (let level = 12; level > 0; level -= 1) {
    deep = { [`level${level}`]: deep };
  }

  const cyclic: { name: string; self?: unknown } = { name: 'cycle' };
  cyclic.self = cyclic;

  return {
    // Đứng đầu và rất to: ngân sách chia đều cho từng khoá cấp đầu, nên `userId` ở sau vẫn còn.
    catalog: Array.from({ length: 500 }, (_, i) => ({
      sku: `SKU-DEMO-${i}`,
      price: 10000 + i,
      description: SENTENCE.repeat(2),
    })),
    history: Array.from({ length: 300 }, (_, i) => ({
      at: `2026-11-19T08:${String(i % 60).padStart(2, '0')}:00Z`,
      event: `Mở màn Giỏ hàng lần ${i}`,
      detail: SENTENCE,
    })),
    longNote: SENTENCE.repeat(60),
    manyKeys: Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [`key${i}`, i]),
    ),
    deep,
    cyclic,
    exotic: {
      when: new Date(0),
      error: new Error('Lỗi mẫu trong state'),
      map: new Map<string, number>([
        ['a', 1],
        ['b', 2],
      ]),
      set: new Set([1, 2, 3]),
      big: BigInt(12),
      onCheckout: function onCheckout() {},
      bytes: new Uint8Array(16),
    },
    ...normalContext(appVersion),
  };
};

/**
 * Hàm `appContext` cho chế độ đang chọn. Gọi lại mỗi lần dựng config: lib đọc hàm **mới nhất** lúc
 * dựng nháp, nên đổi chế độ trong panel rồi bấm Báo bug là thấy ngay (nháp cũ thì giữ ngữ cảnh cũ:
 * gửi hoặc bỏ nháp đó trước).
 */
export const exampleAppContext =
  (mode: AppContextMode, appVersion: string) =>
  (): DevToolsAppContext | Promise<DevToolsAppContext> => {
    console.info(`[example] appContext called (mode: ${mode})`);
    switch (mode) {
      case 'large':
        return largeContext(appVersion);
      case 'throws':
        throw new Error('Example appContext failure');
      case 'never':
        return new Promise<DevToolsAppContext>(() => undefined);
      default:
        return normalContext(appVersion);
    }
  };
