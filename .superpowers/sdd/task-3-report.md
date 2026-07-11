# Task 3 Report: Bootstrap authentication and server-side permissions

## Status

Implemented the temporary Stage 2 bootstrap administrator boundary. The eight
permission keys and authenticated `SessionUser.id` audit subject are stable; no Stage
3 user-management UI or Task 4 management API was added. Existing Sites/demo pages
and untracked `exports/` artifacts were not changed or staged.

## Implementation

- Added the exact eight-key `Permission` union and exact, deny-default membership check.
- Added HS256 JWT sessions bound to `sub`, issuer `quotation-app`, audience
  `quotation-admin`, `iat`, and a 12-hour `exp`.
- Added fail-closed `AUTH_SECRET` validation: missing or fewer than 32 characters
  produces typed `AUTH_CONFIGURATION_ERROR` (500), with no fallback secret.
- Added typed `AuthError` responses for missing/invalid sessions (401), uniform login
  failure (401), and missing permission (403).
- Added `requirePermission()`, which reads only `quotation_session`, verifies the JWT,
  reloads the user and permissions from PostgreSQL, rejects missing/inactive users,
  filters unknown database keys, and returns the stable user ID for audit attribution.
- Added bcrypt cost-12 hashing, a 14-character bootstrap password minimum, lowercase
  trimmed email normalization, and constant-contract credential failures. Unknown-user
  password checks use a dummy cost-12 hash to avoid an obvious fast enumeration path.
- Added `POST /api/auth/bootstrap` as the temporary administrator login endpoint. It
  accepts only email/password, never body-supplied role or permissions, and sets a
  12-hour `quotation_session` cookie with `httpOnly`, production `secure`,
  `sameSite=lax`, and `path=/`.
- Added a one-time bootstrap script that upserts the active administrator and replaces
  its permission rows with all eight keys inside one PostgreSQL transaction. It never
  logs the password or hash.
- Added the Next.js 16 `/admin/:path*` proxy redirect as UX only; server API handlers
  remain responsible for calling `requirePermission()`.

## TDD evidence

### RED 1: authorization/session/password boundary

Command: `npx vitest run tests/auth.test.ts`

Result: exit 1 because `@/lib/auth/permissions` did not exist. This was the expected
missing-feature failure before any authentication production module was created.

### GREEN 1

Command: `npx vitest run tests/auth.test.ts`

Result after implementation and correcting a test fixture that was accidentally
exactly 14 characters: 13/13 tests passed.

### RED 2: admin proxy

Command: `npx vitest run tests/auth.test.ts`

Result: exit 1 because `@/proxy` did not exist.

### GREEN 2

Command: `npx vitest run tests/auth.test.ts`

Result: 15/15 tests passed after implementing missing-cookie redirect and
session-cookie pass-through.

## Security test coverage

- Exact approved permission list and deny-default behavior.
- JWT required claims, 12-hour lifetime, expiry, and tamper rejection.
- Missing and weak secret rejection.
- Missing and inactive database user rejection.
- Missing permission rejection with stable 403 key.
- Database-backed active session user return.
- Production/development cookie flags.
- Uniform missing-user, inactive-user, and wrong-password failure contract.
- Email normalization and 13/14-character bootstrap password boundary.
- Admin proxy redirect and pass-through behavior.

## Verification

Fresh final results before commit:

- `npm run test:unit`: 4 files, 38 tests passed.
- `npm run test:logic`: 53 passed, 0 failed.
- `npm run test:localization`: 20 passed, 0 failed.
- `npx tsc --noEmit`: exit 0.
- Task-scoped ESLint over all changed TypeScript: exit 0.
- `npm run build`: exit 0; Next.js compiled, type-checked, generated all pages, and
  registered `/api/auth/bootstrap` plus the Proxy middleware.
- `git diff --check`: exit 0.

The initial sandboxed build failed only because the existing Google Geist fonts could
not be fetched. The required network-enabled rerun passed.

## Changed files

- `lib/auth/permissions.ts`
- `lib/auth/session.ts`
- `lib/auth/password.ts`
- `app/api/auth/bootstrap/route.ts`
- `scripts/create-bootstrap-admin.ts`
- `proxy.ts`
- `tests/auth.test.ts`
- `package.json`
- `package-lock.json`
- `.superpowers/sdd/task-3-report.md` (ignored local SDD artifact)

## Self-review

- No request body role or permission data is read.
- The proxy checks only cookie presence and is not represented as an authorization
  boundary; `requirePermission()` always verifies and reloads PostgreSQL state.
- JWT signing and password helpers are imported only by server route/script code; the
  production build completed without a client-side authentication route.
- Bootstrap upsert and permission replacement share one database transaction.
- Password and hash values are absent from log statements and error messages.
- No schema, migration, page, Sites metadata, hosting operation, or `exports/` artifact
  was changed.

## Concerns

- Native PostgreSQL execution was not available in this task environment. The code uses
  the production Node `pg` Drizzle database and the transaction is type-checked, but the
  bootstrap script should receive a native PostgreSQL smoke test in Tasks 10–12.
- Repository-wide `npm run lint` scans pre-existing generated `dist/` bundles and reports
  7 errors/1697 warnings there. All Task 3 source files pass scoped ESLint, so no
  unrelated global lint configuration was changed.
- `npm install` reports the existing 9 audit findings (1 low, 7 moderate, 1 high); no
  potentially breaking automatic audit fix was run.

## Review follow-up: authentication boundary hardening

### Fixes

- Moved `AUTH_SECRET` validation to the first operation in the bootstrap login handler,
  before JSON parsing, email normalization, user lookup, or password comparison. Missing
  and weak secrets now always return `{ error: "AUTH_CONFIGURATION_ERROR" }` with 500,
  independent of submitted credentials.
- Added JWT temporal invariant validation with a fixed 60-second future-`iat` skew:
  `exp` must be strictly greater than `iat`, and the signed lifetime must not exceed the
  12-hour session maximum.
- Added `users.status = 'active'` to the PostgreSQL authorization query itself. Missing
  and inactive users continue to converge on the same external 401 `AUTH_REQUIRED`
  contract, while inactive permission rows are no longer loaded into a session user.

### Review TDD evidence

RED command:

```sh
npx vitest run tests/auth.test.ts
```

RED result: exit 1; 6/21 failed. The verifier accepted a token with `iat` 61 seconds in
the future, a 12-hour-plus-one-second token, and a token with `exp === iat`. Correct,
wrong, and unknown-user credential-shaped requests under a weak secret each returned
401 instead of the required configuration 500.

GREEN focused command:

```sh
npx vitest run tests/auth.test.ts && npx tsc --noEmit && \
  npx eslint app/api/auth/bootstrap/route.ts lib/auth/session.ts tests/auth.test.ts
```

GREEN result: exit 0; focused auth 21/21 passed, TypeScript passed, and changed-file
ESLint passed with no diagnostics.

### Follow-up verification

Final command (network-enabled for the existing Google fonts):

```sh
npx vitest run tests/auth.test.ts && npm run test:unit && \
  npm run test:logic && npm run test:localization && npx tsc --noEmit && \
  npx eslint app/api/auth/bootstrap/route.ts lib/auth/password.ts \
    lib/auth/permissions.ts lib/auth/session.ts proxy.ts \
    scripts/create-bootstrap-admin.ts tests/auth.test.ts && \
  npm run build && git diff --check
```

Final result: exit 0.

- Focused auth: 21/21 passed.
- Unit: 4 files, 44/44 passed.
- Logic: 53 passed, 0 failed.
- Localization: 20 passed, 0 failed.
- TypeScript and Task-scoped ESLint: passed with no diagnostics.
- Next.js production build: compiled, type-checked, generated all pages, and retained
  the bootstrap API route plus Proxy middleware.
- Whitespace verification: clean.
