# Sales Quotation Prototype

A Next.js application for creating, reviewing, and approving sales quotations.
Production builds target the standard Node.js runtime and emit a standalone
server at `.next/standalone/server.js`.

## Prerequisites

- Node.js `>=22.13.0`
- PostgreSQL when database-backed features are enabled

## Quick Start

```bash
npm install
npm run dev
```

Create a production build and run it with Next.js:

```bash
npm run build
npm run start
```

## Database

Server-side database access uses PostgreSQL through Drizzle and `pg`. Set a
PostgreSQL connection string before calling `getDb()`:

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/quotation"
```

Add application tables to `db/schema.ts`, then generate migrations with
`npm run db:generate`. Database connections are pooled and the runtime requires
`DATABASE_URL` rather than platform-specific bindings.

Apply the checked-in migrations before starting the import administration
surface:

```bash
export DATABASE_URL="postgresql://quotation:local-only@127.0.0.1:5432/quotation"
npm run db:migrate
```

## Import Administration

The controlled import UI is available at `/admin/imports`. It uses the native
PostgreSQL database and S3-compatible object storage; configure `S3_ENDPOINT`,
`S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` before
uploading. For local MinIO, the endpoint must be reachable from the application
process and the bucket must already exist.

Create or rotate the local bootstrap administrator with explicit environment
values. The password must contain at least 14 characters and `AUTH_SECRET` must
contain at least 32 characters:

```bash
export BOOTSTRAP_ADMIN_EMAIL="admin@example.test"
export BOOTSTRAP_ADMIN_PASSWORD="choose-a-local-password"
export AUTH_SECRET="choose-a-local-session-secret-at-least-32-chars"
npx tsx scripts/create-bootstrap-admin.ts
```

Do not commit those runtime values. The bootstrap script activates that account
and grants the complete administration permission set.

Publish datasets in dependency order:

1. Building Master
2. Sales Package Master
3. Rate Card

The formal downloads are named `02_Buildings_Template.xlsx`,
`03_Sales_Packages_Template.xlsx`, and `04_Rate_Card_Template.xlsx`. Building
and Package imports accept one XLSX or CSV source. A Rate Card upload is exactly
one XLSX workbook or one atomic set containing all four CSV files named:

- `building-prices.csv`
- `metadata.csv`
- `package-buildings.csv`
- `package-prices.csv`

Partial, extra, duplicate, or differently named Rate Card CSV sets are rejected.
Rate Cards have no business-entered effective date or version value. Publishing
generates the version identifier and publication timestamp, makes that version
`Current`, and retains the prior `Current` version and all of its child rows as
read-only `Historical` data.

Server-side permissions are rechecked against the active database user. Building
upload/process/publish requires `data.import.building`; Package requires
`data.import.package`; Rate Card upload/process requires `rate_card.upload` and
publication requires `rate_card.publish`. Administration summary, history,
detail, and error reports require `data.audit.read`; original-file download also
requires `data.file.download`. Authentication alone does not grant access.

The quotation screens still use browser-local demo data. Publishing imports in
`/admin/imports` does not replace the quotation prototype's demo customers,
buildings, packages, prices, or approval state.

## Project Shape

- `app/` contains the Next.js App Router entry points.
- `components/` contains the quotation workflow UI.
- `lib/` contains quotation rules, localization, display data, and client-side
  Demo persistence.
- `db/` contains the PostgreSQL Drizzle factory and schema.
- `tests/runtime-config.test.ts` checks the Node standalone runtime contract.
- `tests/quotation.test.ts` and `tests/localization.test.ts` remain dedicated
  Node test-runner suites.

## Workspace Auth Headers

OpenAI workspace deployments can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated deployments may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the application
needs optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
hosting layer's access policy controls for workspace-wide restrictions, or
enforce explicit server-side membership or allowlist checks.

## Verification Commands

- `npm run test:unit`: run Vitest-owned unit tests.
- `npm run test:logic`: run the quotation domain suite with Node's test runner.
- `npm run test:localization`: run localization and copy audits with Node's test
  runner.
- `npm run test:integration`: run every native PostgreSQL integration,
  concurrency, publication, import, and lifecycle suite after applying all
  migrations to `docker-compose.test.yml`.
- `npm run test:e2e`: run the focused production health, login, and dashboard
  browser smoke with pinned Playwright.
- `npm run check:committed-secrets`: reject tracked secret files, private keys,
  and high-confidence credential formats.
- `npm run build`: type-check and create the production Next.js build.

Pull requests and `main` pushes run these gates in GitHub Actions, plus ESLint,
ShellCheck, a production Docker build, and a real MinIO S3 put/get/delete smoke.
The image is built exactly once. A trusted `main` run saves that image as an
immutable same-run artifact; only after every quality, database, browser, and
container gate passes does CI load that exact artifact and push its full Git SHA
tag. CI extracts exactly one canonical digest from that exact push result (with
no post-push tag lookup) and uploads an immutable
three-field release manifest bound to both the Git SHA and CI run ID. A
successful trusted `main` CI run is the only automatic production trigger. The
delivery workflow downloads that triggering run's exact manifest, validates its
SHA/run/digest fields through the validator checked out from that same trusted
commit, and pulls the recorded `repo@sha256` directly without
consulting the mutable tag. It deploys that digest through the protected GitHub
`production` environment.
See `docs/operations/release-checklist.md` and
`docs/operations/vps-runbook.md` before releasing or rolling back.

## Building Identity Operations

- The Building Team allocates and governs permanent, unique IRIS Building IDs.
  An identifier is never reused, renamed, or deleted; a building that leaves
  operation is deactivated so its identity and commercial history remain.
- Sales Operations uploads and publishes only approved building-master and
  Rate Card files under the applicable permissions.
- ERP Building ID is an optional external mapping. A blank ERP mapping leaves
  an active building eligible for new Rate Cards, and adding the mapping later
  updates the same building UUID rather than creating a replacement identity.
- New Rate Card prices and package memberships resolve IRIS Building IDs to
  active building UUIDs. Deactivation blocks new references but does not alter
  published Rate Cards or their historical package membership.
- The focused production Rate Card publisher locks and resolves active IRIS
  building references and package codes, inserts a draft version and its
  children transactionally, then publishes the completed version.
- This IRIS-focused implementation does not complete all of Stage 2. The
  customer/brand and package processors, controlled rollback, activation,
  supersession, administration UI, and deployment work remain in
  `docs/superpowers/plans/2026-07-11-stage-2-data-import-vps.md`.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Drizzle PostgreSQL Guide](https://orm.drizzle.team/docs/get-started-postgresql)
