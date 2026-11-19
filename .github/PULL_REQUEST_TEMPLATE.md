## What and why

<!-- What changes, and the problem it solves. Link the issue: Fixes #123 -->

## How I tested

<!-- jest, example/ app on a device, both. Name the device and OS, or say "jest only". -->

- [ ] `npm run check` passes
- [ ] Platforms tried: <!-- Android / iOS / not applicable -->

## Checklist

- [ ] Tests live next to the changed file and fail without my change
- [ ] No new runtime dependency and no native module in the library
- [ ] Any new public export has an empty twin in `src/noop/` (same name and type)
- [ ] Any new user-facing string is in both `src/i18n/vi.ts` and `src/i18n/en.ts`
- [ ] Nothing sensitive is logged, stored outside `secureStore`, or sent anywhere new (see `docs/security-privacy.md`)
- [ ] Public functions have JSDoc in the repo format
- [ ] Added a changeset (`npm run changeset`) for a user-visible change, or this is docs/internal only
- [ ] Docs updated if behaviour changed
