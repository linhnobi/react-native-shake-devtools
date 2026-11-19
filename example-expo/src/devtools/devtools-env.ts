/**
 * The one switch for capture and the panel. This file imports nothing, so `capture.ts` can read it
 * before any other module of the app runs.
 *
 * The example always turns devtools on: it exists only to try the library. 🔴 A real app does NOT
 * copy this line. It derives the value from its own environment, for example
 * `process.env.EXPO_PUBLIC_APP_ENV !== 'production'` set per EAS build profile
 * (`docs/recipes/expo.md` § 3), and never from `__DEV__`: an EAS internal build runs in release
 * mode, so `__DEV__` is `false` exactly in the build QA needs the tool in.
 */
export const DEVTOOLS_ENABLED = true;

export const APP_VERSION = '0.0.1';

/** Subtitle under the panel title, also written into saved sessions. */
export const BUILD_LABEL = `EXPO EXAMPLE · ${APP_VERSION}`;
