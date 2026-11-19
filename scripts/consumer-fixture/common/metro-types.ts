// Consumer fixture (scripts/check-consumer.mjs). `./metro` runs in Node, but a `metro.config.js`
// with `// @ts-check` (or a typed config) reads its types.
import {
  NOOP_ENTRIES,
  devtoolsNoopResolver,
  toNoopRequest,
  type DevtoolsNoopResolverOptions,
  type NoopResolveRequest,
} from 'react-native-shake-devtools/metro';

declare const appResolver: NoopResolveRequest;
const options: DevtoolsNoopResolverOptions = { enabled: true, resolveRequest: appResolver };
export const resolveRequest: NoopResolveRequest = devtoolsNoopResolver(options);
export const swapped: string = toNoopRequest('react-native-shake-devtools/capture');
export const count: number = Object.keys(NOOP_ENTRIES).length;
// @ts-expect-error `enabled` must be a boolean
devtoolsNoopResolver({ enabled: 'yes' });
