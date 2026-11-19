# Recipe: attach your app's own context to bug reports

> **Status (2026-11-18).** The library side is covered by jest (`src/report/app-context.test.ts` and
> the connector tests). The snippets below use the public types of this package; the Redux, Zustand,
> Sentry and feature-flag calls follow those libraries' documented APIs but are **not compiled in
> this repo**, and nothing here has run on a device yet.

A bug report already carries a screenshot, the recorded steps, the error log and device info. What it
cannot know is your app's state: who is logged in, which build and environment, which feature flags
are on, what is in the cart, which Sentry event matches the crash. `bugReport.appContext` adds that.

```ts
import type { DevToolsAppContext, DevToolsConfig } from 'react-native-shake-devtools';

const appContext = (): DevToolsAppContext => ({
  userId: session.current?.userId, // an id, not an email
  env: APP_ENV,
  build: `${APP_VERSION} (${BUILD_NUMBER})`,
});

export const config: DevToolsConfig = {
  enabled,
  bugReport: { captureScreen, secureStore, appContext },
};
```

## What happens with the value

- **When:** called **once**, when QA taps **Report a bug** and the draft is created (not on shake, not
  on send). Closing and reopening the sheet keeps the same draft and the same context, like the
  screenshot and steps.
- **Sync or async:** both work. Sync is preferred: the form has the context immediately. An async
  callback has **1.5 s**; after that, or if it throws, rejects or returns something that is not an
  object, the form still works and the chip reads **App context unavailable**. A sync callback that
  loops forever cannot be cut off (JavaScript is single-threaded), so keep it cheap.
- **Where it goes:** a short **App context** section in the ticket (one line per top-level key, up
  to 10, values cut at 100 characters, then "…and N more keys") on every connection, including the
  text-only Slack and Lark webhooks; a full `context.json` attachment on connections that carry files
  (Jira, Slack bot, Lark app, Webhook) and on Share; for the Webhook, also `appContext: { lines, more }`
  in the `report` JSON part.
- **What QA sees:** an **App context** chip next to **Device info**, on by default. Unticking it
  removes the section and the file.
- **Safe to serialise anything:** cycles become `"[Circular]"`, functions `"[Function name]"`,
  BigInt `"12n"`, `Date` an ISO string, `Error` `{ name, message }`, `Map` an object, `Set` an
  array, typed arrays `"[Uint8Array(n)]"`, and a throwing getter `"[Unreadable]"`. `toJSON` is used
  like `JSON.stringify` does.
- **Caps, with visible markers:** depth 8 (`"[Object]"`, `"[Array(n)]"`), 200 keys per object
  (`"…": "+N more"`), 100 items per array (`"…+N more"`), 2000 characters per string (`…+N`) and
  32,000 characters for the whole file. Each top-level key gets a fair share of that budget, so a big
  store slice listed first does not push out `userId` listed after it.

## Redaction: what is masked and what is not

The context is redacted **when it is read**, before it is stored in the draft or the send queue, with
the same rules as request bodies ([security and privacy](../security-privacy.md)):

- values under secret-looking names at any depth: `accessToken`, `refresh_token`, `apiKey`,
  `password`, `pin`, `cookie`, … (strings, numbers and arrays become `"<redacted>"`);
- token patterns anywhere: JWTs, `Bearer …`, Slack/GitHub/Atlassian/AWS/Google/Stripe prefixes;
- your own names, added with `startCapture({ redactKeys: ['customerRef'] })`.

**Personal data is not masked.** A user id, an email or an order number you return is sent as you
return it, because that is usually why you added it. Return only what a ticket needs, prefer ids to
names and emails, and mask the rest yourself, as you do in `sessionInfo`.

## Reports about a crash

When the form opens for the **previous session that crashed**, `appContext` is **not called** and no
context is attached. The state after a restart is not the state at the crash, and attaching it would
mislead whoever reads the ticket. The crash report still has the crashed session's steps,
`errors.txt`, `timeline.json` and `previous-session.txt`.

## Redux

Pick the slices that explain a bug. The whole store works (caps and markers keep it bounded), but it
is noisy and tends to carry personal data and cache payloads (RTK Query's `api` slice, for example).

```ts
import { store } from './store';

const appContext = () => {
  const state = store.getState();
  return {
    userId: state.auth.userId,
    route: state.navigation?.current,
    cart: { items: state.cart.items.length, total: state.cart.total },
    checkout: { step: state.checkout.step, paymentMethod: state.checkout.paymentMethod },
  };
};
```

`interface RootState { … }` is fine: `DevToolsAppContext` is `object`, so interfaces need no index
signature.

## Zustand

`getState()` works outside React. The store's actions are functions; they would show up as
`"[Function addItem]"`, so pick the data fields.

```ts
import { useCartStore } from './cart-store';
import { useSessionStore } from './session-store';

const appContext = () => {
  const { items, coupon, total } = useCartStore.getState();
  return {
    userId: useSessionStore.getState().userId,
    cart: { items: items.map((i) => i.sku), coupon, total },
  };
};
```

## Feature flags

Send the flag **values** the build is running with. A `Map` or a plain object both work.

```ts
// Your own flags module:
const appContext = () => ({ flags: featureFlags.snapshot() });

// LaunchDarkly React Native SDK:
const appContext = () => ({ flags: ldClient.allFlags() });

// @react-native-firebase/remote-config: ConfigValue objects → plain values.
const appContext = () => ({
  flags: Object.fromEntries(
    Object.entries(remoteConfig().getAll()).map(([key, value]) => [key, value.asString()]),
  ),
});
```

## Sentry

`Sentry.lastEventId()` (`@sentry/react-native`) returns the id of the last event Sentry captured in
this run, or `undefined`. With it in the ticket, the developer searches Sentry for that id and lands on
the matching event, with its breadcrumbs and native stack.

```ts
import * as Sentry from '@sentry/react-native';

const appContext = () => ({
  userId: session.current?.userId,
  sentryEventId: Sentry.lastEventId() ?? 'none',
});
```

It is an id of this run only: after a crash and a restart it no longer points at the crash, which is
one more reason the crash report does not call `appContext`.

## Async values

Keep async reads short; the form gives up after 1.5 s and sends without the context.

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const appContext = async () => ({
  userId: session.current?.userId,
  lastSyncAt: await AsyncStorage.getItem('lastSyncAt'),
});
```

## Putting it together

```ts
const appContext = (): DevToolsAppContext => {
  const state = store.getState();
  return {
    userId: state.auth.userId,
    env: APP_ENV,
    build: `${APP_VERSION} (${BUILD_NUMBER})`,
    flags: featureFlags.snapshot(),
    checkout: { step: state.checkout.step, paymentMethod: state.checkout.paymentMethod },
    sentryEventId: Sentry.lastEventId() ?? 'none',
  };
};
```

The ticket then shows, for example:

```
App context
userId: u-42
env: uat
build: 1.4.0 (812)
flags: {"newCheckout":true,"applePay":false}
checkout: {"step":"payment","paymentMethod":"card"}
sentryEventId: 3f9c1e…
```
