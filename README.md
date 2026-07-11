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
- `npm run build`: type-check and create the production Next.js build.

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

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Drizzle PostgreSQL Guide](https://orm.drizzle.team/docs/get-started-postgresql)
