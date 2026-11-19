/**
 * What the demo buttons do. Each one produces a kind of log line the panel tells apart. Every
 * function resolves to a short text the screen shows under the buttons, so the tester can see what
 * the app itself got back (for example that `res.text()` still has the whole body after the
 * capture tap read its clone).
 *
 * Public HTTPS endpoints (release builds block plain HTTP on Android):
 * - `jsonplaceholder.typicode.com`: fake JSON, fast.
 * - `httpbin.org`: any status code (`/status/500`, `/status/401`).
 */

const JSON_API = 'https://jsonplaceholder.typicode.com';
const HTTPBIN = 'https://httpbin.org';

/** `true` when the global `fetch` carries Expo's built-in marker and is not RN's whatwg polyfill. */
export const isExpoFetch = (): boolean => {
  const fn = globalThis.fetch as typeof fetch & { polyfill?: unknown };
  return (
    typeof fn === 'function' &&
    (fn as unknown as Record<symbol, unknown>)[Symbol.for('expo.builtin')] === true &&
    fn.polyfill !== true
  );
};

/** GET through the global `fetch`, which is `expo/fetch` on SDK 58 (Android and iOS). */
export const getWithFetch = async (): Promise<string> => {
  const res = await fetch(`${JSON_API}/todos/1`);
  const body = await res.text();
  return `fetch GET → ${res.status}, the app read ${body.length} characters`;
};

/** GET through `XMLHttpRequest`, which `expo/fetch` does not use: captured by the XHR tap. */
export const getWithXhr = (): Promise<string> =>
  new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${JSON_API}/posts/1`);
    xhr.onload = () =>
      resolve(`XHR GET → ${xhr.status}, the app read ${xhr.responseText.length} characters`);
    xhr.onerror = () => resolve('XHR GET → network error');
    xhr.send();
  });

/** HTTP 500 through `fetch`: a red row with a status. */
export const failWith500 = async (): Promise<string> => {
  const res = await fetch(`${HTTPBIN}/status/500`);
  return `fetch GET → ${res.status}`;
};

/** A `.invalid` host never resolves: a transport error row, no status. */
export const failWithNetworkError = async (): Promise<string> => {
  try {
    await fetch('https://unreachable.invalid/ping');
    return 'fetch → unexpectedly succeeded';
  } catch (error) {
    return `fetch → rejected: ${error instanceof Error ? error.message : String(error)}`;
  }
};

/**
 * `Authorization` and the `password` key must show `<redacted>` in the request detail and in
 * every export. Only **Copy cURL** keeps the raw values, on purpose.
 */
export const postWithSecrets = async (): Promise<string> => {
  const res = await fetch(`${JSON_API}/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer example-secret-token',
    },
    body: JSON.stringify({ username: 'demo', password: 'not-a-real-password' }),
  });
  return `fetch POST → ${res.status}`;
};

/**
 * A **failed** request (401) carrying secrets in three places: the query (`access_token`), the
 * `Authorization` header, and a compact JSON body whose base64 value ends in `=` (old bug R1: such
 * a body was read as a form body and leaked the token). Only failed requests reach "Copy for AI",
 * `errors.txt` and the bug report steps, so this is the request to check those three: every value
 * below must come out as `<redacted>`. Same request as `postSecretsUnauthorized` in the bare
 * example.
 */
export const postSecretsUnauthorized = async (): Promise<string> => {
  const res = await fetch(`${HTTPBIN}/status/401?access_token=fake-access-token-0002`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer fake-bearer-token-0002',
    },
    // base64 of "fake-refresh-token-1"
    body: '{"refreshToken":"ZmFrZS1yZWZyZXNoLXRva2VuLTE=","password":"not-a-real-password"}',
  });
  return `fetch POST → ${res.status}`;
};

export const warnAndError = (): string => {
  console.warn('[expo-example] console.warn: cache miss, falling back to network');
  console.error('[expo-example] console.error: handled error', new Error('Boom (handled)'));
  return 'console.warn + console.error sent';
};

/** A broken async "API": the stack of the error points here. */
const failingApi = async (): Promise<never> => {
  throw new Error('Expo example unhandled rejection');
};

/**
 * A rejected promise nobody catches, like `await api()` without `try/catch`. The app keeps
 * running. About 2 s later (Hermes waits for a late `catch`) the log gets an `UNCAUGHT` line
 * `Uncaught (in promise, id: N): Error: Expo example unhandled rejection`.
 */
export const rejectUnhandled = (): string => {
  void failingApi();
  return 'unhandled rejection fired; check the log in ~3 s';
};
