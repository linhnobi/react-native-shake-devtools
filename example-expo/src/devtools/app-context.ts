import type { DevToolsAppContext } from 'react-native-shake-devtools/plain';

/**
 * App context attached to bug reports (`bugReport.appContext`), fake data to try on a device. A
 * copy of `example/src/devtools/app-context.ts` (same data, so the same truncation counts), not an
 * import: each example app stands on its own. The panel row **App context (example)** switches the
 * mode on the spot:
 *
 * | Mode | The function returns | Expected |
 * |---|---|---|
 * | `normal` | a small object: user id, flavour, flags, a store slice with secret-looking keys | the **App context** chip is on; the ticket has an App context section; `refreshToken`, `accessToken`, `customerRef` and the `Bearer …` value come out as `<redacted>`; `tokenExpiresAt` and `token_type` stay readable |
 * | `large` | a big, deep object with a cycle, `Map`, `Date`, `Error`… | `context.json` ≤ 32 000 characters with truncation marks (`[Object]`, `…+N more`); `userId`, after the big arrays, is still there |
 * | `throws` | throws | the form still opens; the chip reads **App context unavailable** |
 * | `never` | a Promise that never settles | after 1.5 s the chip reads **App context unavailable**; Send does not hang |
 *
 * 🔴 A real app does not log in this function. The example logs one `info` line per call, so the
 * tester can see the library calls it **once**, when Report a bug is tapped (not on the shake, not
 * on send).
 */
export type AppContextMode = 'normal' | 'large' | 'throws' | 'never';

export const APP_CONTEXT_MODES: readonly AppContextMode[] = ['normal', 'large', 'throws', 'never'];

export const DEFAULT_APP_CONTEXT_MODE: AppContextMode = 'normal';

const FAKE_USER_ID = 'u-demo-042';

/**
 * Each top-level key becomes one line of the ticket's "App context" section (at most 10 lines,
 * 100 characters per value). The secret keys sit at the **start** of their object so the summary
 * line shows `<redacted>` too, also in Slack/Lark webhooks (text only, no `context.json`).
 */
const normalContext = (appVersion: string) => ({
  userId: FAKE_USER_ID, // an id, not an email: the library does not mask personal data
  flavor: 'uat',
  build: `${appVersion} (42)`,
  // A `Date` becomes an ISO string. Close and reopen the sheet: the value stays (the draft keeps
  // its context).
  capturedAt: new Date(),
  auth: {
    refreshToken: 'fake-refresh-token-0001', // secret-looking name ⇒ <redacted>
    // base64 of "fake-access-token", `=` at the end (old bug R1: compact JSON with `=` slipped
    // past the redaction)
    accessToken: 'ZmFrZS1hY2Nlc3MtdG9rZW4=',
    tokenExpiresAt: '2026-12-31T00:00:00Z', // readable: only keys *ending* in token are masked
    token_type: 'Bearer', // readable: on the exclusion list
  },
  // An app-specific name: masked only because `capture.ts` sets `redactKeys: ['customerRef']`.
  customerRef: 'CR-DEMO-7781',
  // A harmless name, but the value matches `Bearer` + ≥ 16 characters ⇒ masked anyway.
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

/**
 * Over every limit of the library: 12 levels deep, 300 keys, a 500-item array, a 6 000-character
 * string, a cycle.
 */
const largeContext = (appVersion: string) => {
  let deep: Record<string, unknown> = { leaf: 'đáy' };
  for (let level = 12; level > 0; level -= 1) {
    deep = { [`level${level}`]: deep };
  }

  const cyclic: { name: string; self?: unknown } = { name: 'cycle' };
  cyclic.self = cyclic;

  return {
    // First and very big: the budget is shared out per top-level key, so `userId` later on stays.
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
    manyKeys: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`key${i}`, i])),
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
 * The `appContext` function for the selected mode. Built again with the config: the library reads
 * the **latest** function when it creates a draft, so switching the mode in the panel and then
 * tapping Report a bug shows it at once (an existing draft keeps its context: send or discard it
 * first).
 */
export const exampleAppContext =
  (mode: AppContextMode, appVersion: string) =>
  (): DevToolsAppContext | Promise<DevToolsAppContext> => {
    console.info(`[expo-example] appContext called (mode: ${mode})`);
    switch (mode) {
      case 'large':
        return largeContext(appVersion);
      case 'throws':
        throw new Error('Expo example appContext failure');
      case 'never':
        return new Promise<DevToolsAppContext>(() => undefined);
      default:
        return normalContext(appVersion);
    }
  };
