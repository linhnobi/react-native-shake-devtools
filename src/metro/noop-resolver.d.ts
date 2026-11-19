/**
 * Kiểu của `noop-resolver.js` (entry `react-native-shake-devtools/metro`). File JS là nguồn — JSDoc
 * đầy đủ ở đó; file này để test TS và `metro.config.js` có `// @ts-check` đọc được kiểu.
 *
 * `context` và kết quả để `any` có chủ ý: lib không phụ thuộc `metro-resolver`, và resolver chỉ
 * chuyển `context` đi (đọc mỗi `context.resolveRequest`) — khai chặt hơn thì kiểu lệch theo từng
 * bản Metro của app.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type NoopResolveRequest = (context: any, moduleName: string, platform: string | null) => any;

export interface DevtoolsNoopResolverOptions {
  /** `true` ⇒ tráo import sang bản noop. Vắng ⇒ `false`. */
  readonly enabled?: boolean;
  /** Resolver app đang có. Vắng ⇒ resolver mặc định của Metro (`context.resolveRequest`). */
  readonly resolveRequest?: NoopResolveRequest;
}

/** Entry công khai → entry noop cùng bề mặt. */
export declare const NOOP_ENTRIES: Readonly<Record<string, string>>;

export declare const toNoopRequest: (moduleName: string) => string;

export declare const devtoolsNoopResolver: (
  options?: DevtoolsNoopResolverOptions,
) => NoopResolveRequest;
