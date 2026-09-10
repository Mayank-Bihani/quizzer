# claude-task--001: Implement Google authentication, roles, and route guards

**Sprint:** 1  **Slug:** `google-auth-roles-guards`  **Status:** Draft

This packet implements the AUTH foundation required before any bank, quiz, result, or board route can ship.

---

## 1. Context

Quizzer currently has contracts, an initial D1 schema, and one-line ownership stubs, but no executable backend. Phase 1 is explicitly the Google sign-in, session, role, guard, bootstrap, and admin-roster foundation (`PRD.md:263-284`; `MODULES.md:189-208`). AUTH is the gate in front of the other modules and is the sole writer of `users` (`AUTH.md:10-24`; `MODULES.md:52-64`).

V1 supports Google Sign-In only. The Worker verifies the Google ID token, creates a durable student on first sign-in, and issues its own 30-day stateless session cookie (`PRD.md:70-84`; `AUTH.md:34-45`; `AUTH.md:139-164`). The session carries only `uid`, `iat`, and `exp`; each request resolves the current role through `role:<uid>` in KV with D1 fallback so a role change propagates within KV's roughly 60-second consistency window (`AUTH.md:47-71`).

The current public contract consists of five routes and direct, unenveloped success payloads. All error responses use `{ message: string }` (`API.md:12-27`; `API.md:46-58`). The TypeScript source fixes the AUTH wire shapes, including the role mutation accepting `Role` and returning `AdminUserSummary` (`src/core/api.ts:117-136`). The module-to-module behavior boundary names `requireAuth`, `requireRole`, `currentUser`, and `getUserById`; `CurrentUser` intentionally excludes token/session data (`src/core/contracts.ts:11-23`; `CONTRACTS.md:46-68`). Its `requireAuth(): void` and `requireRole(...): void` declarations describe required capabilities rather than Hono's concrete asynchronous `MiddlewareHandler` signatures. Implement route middleware factories/handlers that enforce those semantics; do not claim that the Hono middleware object structurally implements `AuthContract`, and do not change the established contract to fit the framework.

The implementation must preserve these existing authoritative artifacts:

- Do not modify `migrations/0001_init.sql`; the unshipped initial schema already defines the unique Google subject/email, default student role, role constraint, and durable profile columns (`migrations/0001_init.sql:21-35`).
- Do not change the established contract types in `src/core/contracts.ts` or `src/core/api.ts` (`src/core/contracts.ts:4-23`; `src/core/api.ts:117-136`).
- Do not implement BANK, QUIZZING, SCHEDULER, TELEGRAM, frontend, or mockup behavior. The current repository sequence puts AUTH first and frontend later (`PLAN.md:251-264`).

There is no reusable route implementation to mirror: `src/routes/auth.ts`, `src/routes/admins.ts`, `src/services/jwt.ts`, `src/db/users.ts`, and `src/index.ts` are ownership-comment stubs (`src/routes/auth.ts:1`; `src/routes/admins.ts:1`; `src/services/jwt.ts:1`; `src/db/users.ts:1`; `src/index.ts:1`). Preserve their declared ownership while replacing the stubs with the implementation described below.

## 2. Objective

After this packet ships, a valid Google user can establish a secure 30-day Quizzer session, retrieve their current profile, and log out. Every protected handler can use common authentication and role middleware, while admins can view the bounded user roster and only superadmins can change roles. The first configured superadmin is promoted exactly once through sign-in, and subsequent role changes take effect through the documented D1/KV mechanism.

## 3. Assumptions

- Runtime is TypeScript/Hono on Cloudflare Workers, with D1 bound as `DB` and Workers KV bound as `CACHE` (`PLAN.md:47-59`; `wrangler.toml:14-30`).
- Define three typed Worker string bindings for this implementation: `GOOGLE_CLIENT_ID`, `SESSION_SIGNING_KEY`, and the already documented `SUPERADMIN_EMAIL`. Values are supplied outside source control. `SESSION_SIGNING_KEY` must contain at least 32 bytes of cryptographically random secret material.
- The session cookie is named `quizzer_session` in one exported constant. It uses `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and `Max-Age=2,592,000` seconds. There is no refresh token or silent-refresh endpoint (`AUTH.md:41-45`; `AUTH.md:139-164`).
- Session JWT claims are exactly `{ uid, iat, exp }`; role and Google claims are never copied into the session (`AUTH.md:53-61`). Sign and verify Quizzer sessions with explicitly pinned `HS256`, and verify Google ID tokens with explicitly pinned `RS256`; never select an algorithm from an untrusted header.
- Google JWT verification accepts Google's documented issuer forms, requires the configured audience, validates signature and mandatory `exp`, and validates `nbf` only when the token carries it. It uses a small named clock-tolerance constant as required by the module (`AUTH.md:36-45`; `AUTH.md:134-142`).
- Require `email_verified === true` before using a Google email for account identity or superadmin bootstrap. The current documents do not state that claim explicitly; this is a security invariant inferred from their trust model because verified Google email drives the durable unique account and the deploy-secret bootstrap (`AUTH.md:36-45`; `AUTH.md:98-102`; `migrations/0001_init.sql:25-35`).
- Google JWKS are cached only under AUTH-owned `jwks:*` keys, and roles only under `role:<uid>` (`MODULES.md:81-94`). An unknown `kid` triggers exactly one forced JWKS refetch before rejection (`AUTH.md:134-138`).
- `google_sub` is identity. On repeat sign-in, refresh the Google-provided email, name, and picture while preserving `id`, `role`, and `created_at`. A uniqueness conflict or malformed required identity claim fails closed without exposing database details.
- The admin roster is intentionally a bounded plain array, not paginated (`API.md:24-27`; `src/core/api.ts:131-136`). Return it in deterministic `created_at ASC, id ASC` order.
- The initial migration is an unshipped baseline rather than an applied production migration, so this packet has no data migration (`DATA_MODEL.md:1-5`).
- Tests use Vitest and the installed Cloudflare Workers test pool; the repository already declares the scripts and dev dependencies (`package.json:6-24`).

## 4. Out of Scope

- **Frontend Google Identity Services UI:** the React frontend is intentionally built after backend verification; this packet exposes and tests the API only (`PLAN.md:72-77`).
- **Any non-Google login method or Telegram identity:** AUTH-1 and AUTH-6 deliberately exclude both (`PRD.md:70-80`).
- **Refresh tokens, silent refresh, a session table, and per-session revocation:** V1 accepts stateless sessions until their 30-day expiry and requires re-login afterward (`AUTH.md:139-164`).
- **Instant role revocation across all edge locations:** V1 accepts the documented roughly 60-second KV propagation window (`AUTH.md:47-71`).
- **Email-domain allowlisting or invitation workflows:** every valid Google account enters as a student; elevated roles come only from bootstrap or a superadmin role mutation (`PRD.md:74-79`).
- **Quiz-specific authorization and seat claims:** QUIZZING decides whether an authenticated user may join a particular room (`AUTH.md:15-21`).
- **Question-bank, quiz, result, leaderboard, image, cron, and Telegram handlers:** this packet provides reusable guards for those later packets but does not implement their routes.
- **Schema changes:** `users` already contains every V1 AUTH field and constraint (`migrations/0001_init.sql:25-35`).
- **Request analytics or error-rate alerting:** request-level auth/D1 error tracking is a separately descoped cross-cutting concern (`MODULES.md:155-165`).

## 5. Open Questions / `<INPUT_REQUIRED>`

(none)

The current product and module sources explicitly state that no Phase 1 decision remains open (`PRD.md:322-327`; `AUTH.md:152-164`). Actual OAuth identifiers, secret values, and the superadmin email are operator-supplied configuration, covered by AC-OPERATOR rather than product questions.

## 6. Pre-flight Checklist

- [ ] Required skill loaded: **`clean-code`** — always required; keep route handlers thin and name security decisions explicitly.
- [ ] Required skill loaded: **`prod-safety-gate`** — authentication, secrets, D1 identity writes, and production route mounting affect every request.
- [ ] Required skill loaded: **`test-driven-development`** — every behavior in §7 starts with a failing test and follows red-green-refactor.
- [ ] Required skill loaded: **`vibesec`** — this packet handles external JWTs, session tokens, cookies, PII, role mutation, and admin endpoints.
- [ ] Confirm the working tree is clean, or save a baseline that isolates this packet from unrelated changes.
- [ ] Confirm the branch is current with the repository's trunk before editing.
- [ ] Confirm the repository currently has no lockfile, then run `npm install jose` as the explicit dependency-setup step so npm updates `package.json` and creates `package-lock.json`. Reserve `npm ci` for clean verification after that lockfile exists (`package.json:6-24`).
- [ ] Populate local, uncommitted test values for `GOOGLE_CLIENT_ID`, `SESSION_SIGNING_KEY`, and `SUPERADMIN_EMAIL`; never place real values in a fixture, command transcript, or committed file.
- [ ] Apply the existing schema locally with `npm run db:migrate:local`; do not edit the migration (`package.json:9-14`; `migrations/0001_init.sql:19-35`).
- [ ] Read `PRD.md:45-84`, `AUTH.md:10-175`, `MODULES.md:23-94`, `CONTRACTS.md:46-68`, `API.md:12-58`, `src/core/contracts.ts:4-23`, `src/core/api.ts:117-136`, and `migrations/0001_init.sql:21-35` before writing code.
- [ ] Re-read AC-1 through AC-14 and distinguish implementer checks from AC-OPERATOR configuration/live-account steps. Confirm the route middleware is typed as Hono middleware and tested against the `AuthContract` semantics; do not force it into the contract's framework-neutral `void` method shape (`src/core/contracts.ts:18-23`).

## 7. Acceptance Criteria

1. **AC-1 — Verify Google tokens server-side.** `POST /api/auth/google` accepts only `{ idToken: string }`. Verify the JWT signature against Google JWKS and validate `kid`, pinned algorithm, issuer, configured audience, mandatory `exp`, and `nbf` when present; require usable `sub`, `email`, and `name` claims plus `email_verified === true`. A missing `nbf` is valid, while a present not-yet-valid `nbf` is rejected. A malformed, forged, expired, wrong-issuer, wrong-audience, unverified-email, unknown-key-after-one-refetch, or incomplete token returns `401` with only `{ message: string }` (`AUTH.md:34-45`; `API.md:46-58`). Requiring verified email is a security invariant inferred from email's use as durable identity and the bootstrap credential (`AUTH.md:98-102`; `migrations/0001_init.sql:25-35`).
2. **AC-2 — Cache JWKS safely through AUTH.** Reuse an unexpired `jwks:*` KV entry, derive its TTL from Google's cache metadata with a bounded named fallback, and refetch once on an unknown `kid`. Reject after that single retry. Never log or persist the submitted ID token (`AUTH.md:134-138`; `MODULES.md:81-90`).
3. **AC-3 — Persist one durable Google identity.** First sign-in inserts one `users` row with a generated ID, Google subject/email/profile, current epoch-millisecond `created_at`, and default `student` role. Repeat/concurrent sign-ins for the same `google_sub` resolve to the same row and never overwrite its role (`PRD.md:74-77`; `migrations/0001_init.sql:25-35`).
4. **AC-4 — Bootstrap the initial superadmin exactly once.** After identity upsert, if no superadmin exists and the normalized verified Google email equals `SUPERADMIN_EMAIL`, conditionally promote that user. Once any superadmin exists, later sign-ins never bootstrap another account. A repeated or concurrent matching sign-in is idempotent (`AUTH.md:98-107`).
5. **AC-5 — Issue a secure stateless session.** A successful Google sign-in returns `GoogleSignInResponse` as `CurrentUser` directly and sets `quizzer_session` with `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`. Its signed JWT contains only `uid`, `iat`, and `exp`, expires 30 days after issue, and never includes role, email, Google token, or signing material (`src/core/api.ts:121-123`; `AUTH.md:41-61`; `AUTH.md:139-145`).
6. **AC-6 — Implement session self-view and logout.** `GET /api/auth/me` returns the current `CurrentUser` directly for a valid session and `401 {message}` for a missing, malformed, forged, expired, or unknown-user session. `POST /api/auth/logout` always returns `{ success: true }` and expires the same cookie with matching path/security attributes; it performs no D1/KV cleanup (`src/core/api.ts:125-129`; `AUTH.md:156-164`).
7. **AC-7 — Expose common guard semantics and current-user access.** Export Hono-compatible `requireAuth` middleware and a `requireRole('admin'|'superadmin')` middleware factory, plus `currentUser` and `getUserById` helpers. These functions enforce the four authoritative `AuthContract` behaviors, but the asynchronous Hono middleware signatures do not structurally implement the contract's framework-neutral `void` declarations. The middleware verifies the session, resolves the durable user, loads the current role via `role:<uid>` KV with D1 fallback, and stores only `CurrentUser` in typed Hono context (`src/core/contracts.ts:11-23`; `CONTRACTS.md:46-68`). Test semantic behavior through mounted routes instead of assigning the middleware object to `AuthContract`.
8. **AC-8 — Enforce the role lattice and mount boundaries.** Missing/invalid authentication returns 401. `requireRole('admin')` admits `admin` and `superadmin`; `requireRole('superadmin')` admits only `superadmin`; authenticated but insufficient roles return 403. Mount `POST /api/admin/users/:id/role` at a superadmin-only boundary distinct from ordinary `/api/admin/*` routes, so an admin cannot reach it through an outer admin guard (`AUTH.md:73-96`; `src/routes/admins.ts:1`).
9. **AC-9 — Return the admin roster.** `GET /api/admin/users` is available to admins and superadmins, rejects students with 403, performs a bounded non-paginated read, and returns `{ users: AdminUserSummary[] }` without token/session fields (`API.md:46-58`; `src/core/api.ts:131-136`).
10. **AC-10 — Mutate roles only as superadmin.** `POST /api/admin/users/:id/role` validates the request against `Role`, returns 404 for an unknown target, supports idempotent role assignment, prevents changing the last remaining superadmin to another role with 409, persists the change in D1, deletes `role:<targetId>` from KV, and returns the updated `AdminUserSummary`. A plain admin or student receives 403 and no write (`AUTH.md:98-107`; `API.md:50-58`; `src/core/api.ts:135-136`).
11. **AC-11 — Fail closed on configuration and storage errors.** Missing/weak session signing material, missing Google audience, unusable bootstrap configuration, JWKS failure, D1 failure, or KV failure must not downgrade verification, trust a client role, create a session, or expose stack traces/SQL/provider details. Responses retain the shared `{ message: string }` error shape (`API.md:12-23`). Cache outage may fall back to D1 for a role read only when the D1 read succeeds; it must never reuse an unverified client/session role.
12. **AC-12 — Preserve ownership and contracts.** AUTH is the only writer of `users`, and the only AUTH KV writes are `jwks:*` and `role:<uid>`. No later-module table/key is read or written. `migrations/0001_init.sql`, `src/core/contracts.ts`, and `src/core/api.ts` remain byte-for-byte unchanged (`MODULES.md:52-94`).
13. **AC-13 — Prove behavior test-first.** Before production implementation, add failing Vitest cases for Google verification failures, JWKS cache/rotation, first/repeat/concurrent sign-in, bootstrap-once, session claim/cookie rules, `/me`, logout, the complete role/guard matrix, roster shape, last-superadmin protection, role-cache invalidation, generic errors, and secret/token redaction. Watch each fail for the intended missing behavior, then implement the minimum change to pass (`AUTH.md:166-175`).
14. **AC-OPERATOR — Configure and verify real providers.** The operator creates/selects the Google OAuth Web client, supplies the production `GOOGLE_CLIENT_ID`, a random 32-byte-or-longer `SESSION_SIGNING_KEY`, and normalized `SUPERADMIN_EMAIL` through Cloudflare secret management, provisions the real `DB`/`CACHE` bindings, applies the initial migration, and performs one real Google sign-in. No secret or ID token is pasted into committed files, CI logs, issue text, or review comments (`wrangler.toml:14-30`; `wrangler.toml:43-49`).

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not edit `migrations/0001_init.sql`, `src/core/contracts.ts`, or `src/core/api.ts`; this packet implements the already-set storage and wire contracts.
- Do not add a session table, refresh token, silent-refresh route, password login, email-link login, Telegram login, domain allowlist, or invitation flow.
- Do not put role, email, Google claims, ID tokens, access tokens, or secrets in the Quizzer session JWT. Its payload is only `uid`, `iat`, and `exp`.
- Do not decode-and-trust either Google or Quizzer JWTs without signature, algorithm, time, issuer/audience where applicable, and claim-shape validation.
- Do not use a JWT algorithm selected from the untrusted token header; pin the expected Google and session algorithms in verifier configuration.
- Do not store sessions in local/session storage or return a session token in a JSON response.
- Do not accept a role from Google claims or any sign-in body. New accounts always begin as students except the conditional bootstrap.
- Do not let the general admin guard cover the role-mutation handler. That handler must require superadmin independently.
- Do not authorize from stale role data embedded in a session. Resolve `role:<uid>` on each guarded request with D1 fallback.
- Do not cache a complete user, session, Google token, or PII in the role/JWKS keyspaces.
- Do not continue after an unknown `kid` with arbitrary key selection, repeated unbounded fetches, or stale keys after the single forced refresh fails.
- Do not log cookie values, JWTs, secret bindings, full Google claims, or user email. Use opaque request/error categories and user IDs only where needed.
- Do not add CORS for a separate frontend origin; V1 serves frontend and API from the same Worker/origin (`PLAN.md:72-77`).
- Do not implement or edit later module route files, mockups, frontend assets, product documents, or progress tracking.

### 8b. Coding / quality principles

- **`clean-code`:** keep HTTP handlers limited to parse/validate/invoke/respond. Put Google/session cryptography in `src/services/jwt.ts`, user/role SQL in `src/db/users.ts`, and authorization decisions in the middleware. Use named constants for TTLs, cookie name, algorithms, JWKS key, and clock tolerance; use early returns and expressive full names.
- **`prod-safety-gate`:** production surfaces are the five AUTH HTTP routes, `users` writes, `jwks:*`/`role:*` KV operations, and three secret/config bindings. Every failure must be observable through tests and generic response status while failing closed; no migration is introduced.
- **`vibesec`:** parse allowlisted body fields only, enforce a request-size ceiling before parsing the Google token body, use parameterized D1 statements, normalize the bootstrap email once, compare verified claims only, validate all JWT claims at runtime, and set the complete secure cookie policy centrally.
- **`test-driven-development`:** start AC-1 through AC-13 with a focused failing test; confirm it fails for missing behavior rather than fixture/setup error, add minimal implementation, run the focused test, then run the entire suite before refactoring.
- Add `jose` with `npm install jose`; commit the resulting `package.json` and `package-lock.json`, and keep its use isolated to `src/services/jwt.ts`. Do not handwrite JWT parsing/signature logic or substitute an unreviewed package during implementation.
- Treat `AuthContract` as the authoritative behavior boundary. Keep Hono's concrete middleware types in the route/middleware layer; do not weaken the contract, edit its signatures, use unsafe casts, or claim structural conformance between `void` methods and asynchronous `MiddlewareHandler`s.
- Construct `CurrentUser` and `AdminUserSummary` as explicit allowlists. TypeScript structural typing does not remove extra database properties at runtime; the contracts intentionally exclude session fields (`CONTRACTS.md:61-68`).
- Wrap every SQL value in D1 bindings; no string interpolation for subjects, emails, IDs, roles, or list filters.
- Make bootstrap and last-superadmin protection conditional in SQL at the write boundary so concurrent requests cannot violate them after a prior read.
- Treat KV as an optimization and propagation mechanism, never as the durable identity source. D1 remains authoritative for the user record and role.

## 9. Behavior Spec (per file)

### `package.json` and generated lockfile

- **Current state (lines 6-24):** the project has Hono plus TypeScript, Vitest, Wrangler, and the Workers Vitest pool, but no JWT/JWK dependency (`package.json:6-24`).
- **Required edit:** run `npm install jose` so npm adds the Worker-compatible JWT/JWK dependency to `package.json` and creates `package-lock.json`. Do not hand-edit a synthetic lockfile or add Google SDKs, session stores, validation frameworks, or unrelated packages. Once the lockfile exists, use `npm ci` for clean verification.
- **Estimated diff:** ~2 LOC in `package.json`; generated lockfile size determined by the package manager.
- **Subtleties:** keep all JWT-library-specific code behind `src/services/jwt.ts` so routes and middleware depend on local functions rather than library primitives.

### `src/core/config.ts`

- **Current state (line 1):** one comment reserves shared V1 constants but defines no Worker environment or AUTH constants (`src/core/config.ts:1`).
- **Required edit:** retain the existing documented constants and add typed `Bindings`/Hono context variable definitions plus named AUTH constants: cookie name, 30-day seconds, request-size ceiling, JWT algorithms, Google issuers/JWKS URL/cache key, bounded JWKS fallback TTL, and token clock tolerance. Include `DB`, `CACHE`, `GOOGLE_CLIENT_ID`, `SESSION_SIGNING_KEY`, and `SUPERADMIN_EMAIL` in the bindings type.
- **Estimated diff:** ~45 LOC.
- **Subtleties:** seconds and milliseconds must be explicit in names. Configuration access must reject missing/blank values; never provide a production fallback secret.

### `src/services/jwt.ts`

- **Current state (line 1):** the stub assigns Google verification, JWKS KV caching, and Quizzer session sign/verify to this adapter (`src/services/jwt.ts:1`).
- **Required edit:** implement strict `RS256` Google ID-token verification with cached JWKS and one forced refresh for an unknown `kid`; implement `HS256` Quizzer session signing/verification with the exact `{uid,iat,exp}` payload; expose cookie set/clear helpers using the central policy. Inject `fetch`, time, KV, and configuration at function boundaries so tests use real logic with deterministic adapters.
- **Estimated diff:** ~95 LOC.
- **Subtleties:** inspect the protected header only to choose a matching key, then verify the signature/algorithm before trusting claims. Do not retry network failures indefinitely. Require a finite integer `exp`; when `nbf` exists, require a finite integer and enforce it with the named clock tolerance, but do not reject an otherwise valid token merely because `nbf` is absent. Never return raw Google claims beyond the allowlisted verified identity fields needed by `src/db/users.ts`.

### `src/db/users.ts`

- **Current state (line 1):** the stub assigns the `users` table and AUTH contract persistence to this module (`src/db/users.ts:1`).
- **Required edit:** implement parameterized queries for find/upsert by Google subject, lookup by ID, deterministic roster listing, KV-cached role lookup with D1 fallback, conditional first-superadmin bootstrap, conditional role mutation with last-superadmin protection, and role-key deletion after a successful role change. Map snake_case rows to explicit `CurrentUser`/`AdminUserSummary` objects.
- **Estimated diff:** ~100 LOC.
- **Subtleties:** preserve `role` and `created_at` on repeat sign-in. Distinguish missing target from blocked last-superadmin mutation. A KV miss or cache read failure may query D1; a D1 failure must fail closed. Do not let cache-write failure undo a correct D1 identity read, but surface role-invalidation failure rather than claiming an immediately coherent mutation.

### `src/middleware/auth.ts` (new)

- **Current state:** no middleware file exists; the contract requires four AUTH call surfaces and route-group guards (`src/core/contracts.ts:18-23`; `CONTRACTS.md:55-68`).
- **Required edit:** create typed Hono `requireAuth` middleware and a hierarchical `requireRole` middleware factory, plus `currentUser` and `getUserById` helpers. They must enforce the behavior named by `AuthContract` without being assigned/cast to that interface, whose framework-neutral guard methods return `void`. Parse the named cookie, verify the Quizzer session, resolve the D1 user/current cached role, store an allowlisted `CurrentUser` in context, and return generic 401/403 errors.
- **Estimated diff:** ~85 LOC.
- **Subtleties:** `requireRole('admin')` includes superadmin. Hono middleware may be asynchronous and must call/return `next()` according to Hono's actual type; tests establish equivalence to the documented guard semantics. Avoid boolean switches and duplicate auth reads. `currentUser` may assume the guard has populated context and must never decode cookies a second time.

### `src/routes/auth.ts`

- **Current state (line 1):** the stub names Google sign-in, logout, and `/me` and fixes the `/me` response to `CurrentUser` (`src/routes/auth.ts:1`).
- **Required edit:** export a Hono sub-app with `POST /google`, `POST /logout`, and guarded `GET /me`. Validate content type/body/size, invoke the JWT and user adapters, run conditional bootstrap after upsert, set/clear the session cookie, and serialize only the exact API response types.
- **Estimated diff:** ~75 LOC.
- **Subtleties:** `/google` and `/logout` are callable without an existing session; `/me` is not. Bootstrap compares `SUPERADMIN_EMAIL` only with the verified Google email. Never return the Google token, Quizzer token, email, or `createdAt` from sign-in or `/me`.

### `src/routes/admins.ts`

- **Current state (line 1):** the stub fixes the roster at ordinary admin scope and role mutation at a separate superadmin mount (`src/routes/admins.ts:1`).
- **Required edit:** export distinct admin-roster and superadmin-role route groups or handlers so `GET /users` uses `requireRole('admin')` and `POST /users/:id/role` uses `requireRole('superadmin')` independently. Treat `users.id` as opaque `TEXT`: require only a non-empty string no longer than 256 code units, pass it unchanged to a parameterized lookup, and do not impose UUID syntax. Validate the exact role allowlist, call the user repository, and map missing/last-superadmin outcomes to 404/409 generic errors (`migrations/0001_init.sql:25-35`).
- **Estimated diff:** ~60 LOC.
- **Subtleties:** do not nest role mutation beneath middleware that accidentally weakens or blocks the intended lattice. Ignore no extra body properties; reject them or parse an explicit `{role}` allowlist.

### `src/index.ts`

- **Current state (line 1):** the entry point is only a comment assigning Hono mounting and later scheduler orchestration (`src/index.ts:1`).
- **Required edit:** create/export the Hono Worker app, install a final generic error handler, mount `/api/auth`, mount the ordinary admin roster behind admin middleware, and mount the role mutation behind superadmin middleware at the exact documented paths. Keep a clear composition seam for later guarded route groups and preserve the future scheduled-handler ownership without implementing cron work.
- **Estimated diff:** ~45 LOC.
- **Subtleties:** route declaration order must not let the broad admin mount intercept or weaken the special role route. Export the app in a form the Workers test pool can call without a network listener.

### `vitest.config.ts` (new)

- **Current state:** no Vitest configuration exists, although the Workers pool and `vitest run` are already declared (`package.json:6-24`).
- **Required edit:** configure the installed Cloudflare Workers Vitest pool, point it at the Worker entry/config, and arrange isolated local D1/KV state with `migrations/0001_init.sql` applied for each test file or test suite.
- **Estimated diff:** ~25 LOC.
- **Subtleties:** tests must never bind production IDs, make uncontrolled Google requests, or share user/cache state between cases.

### `tests/jwt.test.ts` (new)

- **Current state:** no tests exist; AUTH nevertheless requires forged/expired/wrong-key and JWKS-rotation coverage (`AUTH.md:166-175`).
- **Required edit:** generate ephemeral asymmetric Google-style keys and a separate session secret in memory. Test signature/issuer/audience/time/claim failures, acceptance when `nbf` is absent, rejection when a present `nbf` is in the future, rejection unless `email_verified === true`, cached-key success, unknown-`kid` one-refetch recovery and failure, exact session claims, expiry, pinned algorithm, cookie attributes, and log/token redaction.
- **Estimated diff:** ~95 LOC.
- **Subtleties:** never call real Google. Assert both successful result shapes and meaningful failure classes/status mapping so a test cannot pass merely because all tokens are rejected.

### `tests/auth.test.ts` (new)

- **Current state:** no route or persistence tests exist; the source requires the signed-out/admin guard matrix, revocation, and bootstrap-once cases (`AUTH.md:166-175`).
- **Required edit:** exercise the exported Hono app with isolated D1/KV and a deterministic Google-verifier adapter. Cover first/repeat/concurrent login, secure cookie, `/me`, logout, user-not-found session, admin/superadmin/student matrices, roster allowlisting, role mutation, missing target, last-superadmin conflict, D1/KV failures, role invalidation, and generic error bodies.
- **Estimated diff:** ~150 LOC split into focused `describe` blocks and helpers.
- **Subtleties:** test behavior through HTTP where possible. Use direct D1 reads only to prove side effects and invariants; do not mock SQL-builder internals. Simulate propagation/cache behavior deterministically rather than sleeping 60 seconds.

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Forged or algorithm-confused Google/session JWT is accepted | Low | High | AC-1, AC-5, AC-13 and the pinned-algorithm hard NOs require negative cryptographic tests. |
| Google rotates to an unknown `kid` and valid users are locked out | Med | High | AC-2 forces one fresh JWKS fetch and a deterministic rotation test. |
| JWKS/provider outage creates an unbounded fetch storm | Med | Med | Bounded cache TTL, one retry only, focused failure tests, and generic 401/5xx handling. |
| Role in a long-lived session survives demotion | Low | High | AC-5 excludes role claims; AC-7/AC-10 resolve and invalidate `role:<uid>`. |
| KV propagation briefly preserves an old role | Med | Med | This is the accepted V1 window; cache invalidation plus explicit manual QA verifies the documented behavior rather than promising instant revocation. |
| An admin can reach the superadmin mutation route due to mount order | Med | High | AC-8, separate route group, route-matrix tests, and index guardrail. |
| Concurrent bootstrap/role mutation removes the last superadmin or promotes more than intended | Low | High | Conditional SQL at the write boundary plus concurrency/idempotency tests in AC-4/AC-10. |
| Repeat sign-in overwrites an elevated role or creates duplicate users | Med | High | AC-3 preserves role and tests repeat/concurrent subject upserts against schema uniqueness. |
| Cookie is readable by JavaScript, sent cross-site, or not cleared consistently | Low | High | One central cookie policy, AC-5/AC-6 response-header assertions, no JSON token response. |
| PII, tokens, or secrets appear in logs/errors | Med | High | AC-11/AC-13 redaction tests and generic shared error shape. |
| Test isolation hides uniqueness/cache defects | Med | Med | Fresh D1/KV per case, explicit concurrent cases, real SQL/schema rather than repository mocks. |
| New dependency or config causes lint/type drift | Low | Med | Isolate JWT dependency, commit lockfile, run typecheck and full tests in §12a. |
| Later module consumers receive a changed AUTH shape | Low | High | AC-12 prohibits contract edits and §12a checks their diff is empty. |
| Operator supplies wrong audience, weak secret, or wrong bootstrap email | Med | High | Configuration validation fails closed; AC-OPERATOR and OP cases verify live setup without exposing values. |
| Documentation and implementation drift on 30-day TTL or guard matrix | Low | Med | Named constants, contract citations, automated header/claim/role-matrix tests, and manual QA. |

## 11. Rollback / Revert Plan

1. Revert the implementation commit with `git revert <sha>`; do not edit or reverse the initial schema because this packet adds no table/column and `users` predates the implementation (`migrations/0001_init.sql:21-35`).
2. Run `npm ci`, `npm run typecheck`, and `npm test` at the reverted revision. If the reverted revision predates the added JWT dependency, its lockfile revert removes it; do not manually retain a mismatched package entry (`package.json:6-24`).
3. Deploy the reverted Worker revision and allow the platform to replace running isolates. No session-store migration or cache-clear is normally required because sessions are stateless (`AUTH.md:139-145`).
4. If the reverted revision uses a different JWT format, cookie name, JWKS key, or role-cache representation, expire `quizzer_session` at the edge/client. Use Wrangler's KV key-list operation twice with the exact prefixes `jwks:` and `role:`, inspect the returned AUTH-owned keys, and delete each returned key by its exact name. A wildcard is not a KV delete operation. Do not enumerate or delete QUIZZING board/unit keys because AUTH does not own them (`MODULES.md:81-94`).
5. Verify the reverted behavior with `curl -i https://<host>/api/auth/me` and the previous revision's health/smoke suite. Confirm the observed status/header matches that revision and no token/stack trace appears. If the previous revision has no AUTH route, a generic 404 is the expected rollback result; if it has AUTH, a signed-out generic 401 is expected.
6. Leave `GOOGLE_CLIENT_ID`, `SESSION_SIGNING_KEY`, and `SUPERADMIN_EMAIL` in Cloudflare until the reverted deployment is verified. Remove or rotate them afterward only if the prior revision does not consume them; never print their values during cleanup.
7. Notify the project owner in the established operational channel with the reverted commit, trigger, impact window, and whether users must sign in again. Do not include IDs, emails, cookies, JWTs, or secret values.

## 12. Verification + Definition of Done

### 12a. Automated verification

Set up the new dependency once. The repository has no lockfile before this packet, so `npm ci` is not the setup command:

```bash
npm install jose
test -f package-lock.json
```

After `package.json` and `package-lock.json` contain the dependency, run clean verification from the repository root:

```bash
npm ci
npm run db:migrate:local
npm run typecheck
npm test
```

Run focused AUTH tests during red-green-refactor:

```bash
npm test -- tests/jwt.test.ts
npm test -- tests/auth.test.ts
```

Prove the authoritative schema/contracts and later-module stubs were not changed:

```bash
git diff --exit-code -- migrations/0001_init.sql src/core/contracts.ts src/core/api.ts
git diff --exit-code -- src/routes/bank.ts src/routes/boards.ts src/routes/images.ts src/routes/play.ts src/routes/quizzes.ts src/routes/reports.ts
git diff --exit-code -- src/db/bank.ts src/db/boards.ts src/db/play.ts src/db/quizzes.ts src/db/results.ts src/db/telegram.ts
git diff --exit-code -- src/services/cache.ts src/services/images.ts src/services/observability.ts src/services/telegram.ts
```

Inspect the final patch for accidentally committed sensitive material without printing environment values:

```bash
git diff --check
git diff --name-only
rg -n "BEGIN (RSA |EC )?PRIVATE KEY|idToken\s*[:=]\s*['\"]|SESSION_SIGNING_KEY\s*=|SUPERADMIN_EMAIL\s*=" --glob '!todos/**' --glob '!*.md' .
```

The final `rg` must produce no committed credential/token literal; variable/type declarations without assigned secret values are allowed and must be reviewed manually.

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | Valid first Google sign-in | Against local/test bindings, submit a test-signed valid Google-shaped ID token to `POST /api/auth/google`; inspect response, cookie, and D1 row. | 200 direct `CurrentUser`; one student row; secure 30-day HttpOnly cookie; no token/email in body. | Not Run |
| BE-2 | External-token claim boundaries | Submit forged, expired, wrong-audience, wrong-issuer, unverified-email, future-`nbf`, and unknown-`kid` tokens; also submit a valid token without `nbf`. | Invalid variants return 401 `{message}` and create no user/session; unknown `kid` causes only one forced refetch; the valid token without `nbf` succeeds. | Not Run |
| BE-3 | Session self-view and logout | Call `/api/auth/me` with valid and forged cookies, then call `/api/auth/logout` twice and retry `/me` with the cleared cookie jar. | Valid session returns current user; invalid/missing returns 401; logout is idempotent and expires the cookie. | Not Run |
| BE-4 | First-superadmin bootstrap | Start with no superadmin; sign in once with nonmatching email, then with the configured matching email twice. | First remains student; matching user becomes the only superadmin; repeat is a no-op and preserves identity. | Not Run |
| BE-5 | Admin guard matrix | Exercise roster and role mutation as signed-out, student, admin, and superadmin sessions. | 401 signed-out; student gets 403 on both; admin reads roster but gets 403 on mutation; superadmin reaches both. | Not Run |
| BE-6 | Role update and cache invalidation | Prime an admin role cache, demote through the superadmin endpoint, and read with a cache miss/propagation simulation. | D1 contains the new role, `role:<uid>` is deleted, response is updated summary, and later guarded access fails without re-login. | Not Run |
| BE-7 | Last-superadmin invariant | With exactly one superadmin, attempt self-demotion; then add a second superadmin and repeat. | First attempt returns 409 with no write; with two, demotion succeeds and at least one superadmin remains. | Not Run |
| BE-8 | Failure redaction | Force Google fetch, D1, KV, and signing failures and inspect status/body/captured logs. | Request fails closed; body is only `{message}`; no SQL, stack, email, token, cookie, or secret value appears. | Not Run |

#### Frontend / UI

N/A — this is a backend-only packet and no `web/` files exist or may be added. If implementation adds frontend files, fail this packet review and add frontend cases.

#### Chrome DevTools / extension verification

N/A — there is no frontend login flow in this packet. Cookie flags and HTTP payloads are verified through response headers and API tests. If a browser UI is added, fail this packet review and add Network/Application-panel cases.

#### Operator-executed (post-cutover, see AC-OPERATOR)

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| OP-1 | Production bindings and migration | Provision/verify `DB` and `CACHE`; set the three AUTH values through Cloudflare secret management; apply `0001_init.sql` remotely without echoing values. | Deployment sees all bindings, configuration validation passes, and `users` exists with no secret material stored in D1. | Not Run |
| OP-2 | Real Google login and bootstrap | Using the configured OAuth client and designated superadmin Google account, perform one real sign-in and inspect the response/cookie without copying the token into logs. | Login succeeds, session cookie has the required flags, and the configured account is the sole initial superadmin. | Not Run |
| OP-3 | Live role propagation | Promote a test student to admin, verify roster access, demote them, and retry until the documented KV window has elapsed. | Promotion grants admin access; demotion removes it within roughly 60 seconds without requiring logout. | Not Run |

### 12c. Definition of Done

- [ ] AC-1 through AC-13 satisfied.
- [ ] AC-OPERATOR completed by the operator or explicitly waived and recorded in §5.
- [ ] Each production behavior began with a focused failing test whose failure was observed and understood.
- [ ] §12a passes locally and in any configured CI.
- [ ] BE-* statuses are no longer `Not Run` and target `Pass`.
- [ ] FE and CHROME remain legitimately N/A because no frontend files were touched.
- [ ] OP-* completed by the operator or explicitly waived in §5.
- [ ] No unresolved input marker remains in §5.
- [ ] §8a Hard NO list respected; every forbidden-path `git diff --exit-code` check is clean.
- [ ] No live secret, Google ID token, cookie, email, or private key is present in source, fixtures, logs, or review artifacts.
- [ ] §11 rollback plan has been reviewed against the release immediately preceding deployment.
- [ ] The implementation leaves a clear guarded mounting seam for BANK and QUIZZING without implementing their routes.

---

End of Codex Task Packet — `claude-task--001`
