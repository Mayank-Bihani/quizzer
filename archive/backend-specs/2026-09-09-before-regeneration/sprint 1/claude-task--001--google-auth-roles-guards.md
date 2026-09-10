# claude-task--001: Implement AUTH — Google sign-in, roles, sessions, route guards, superadmin bootstrap

**Sprint:** 1  **Slug:** `google-auth-roles-guards`  **Status:** Draft

> Phase 1 of `PLAN.md:706-727`'s build sequence, backend half only (`todos/PROGRESS.md`'s Sprint 1
> row — the Manage Admins **screen** is frontend and out of scope here; see §4). AUTH.md, CONTRACTS.md
> §2, API.md's AUTH section, `src/core/contracts.ts`'s `AuthContract`, and `migrations/0001_init.sql`'s
> `users` table are the resolved, final decisions this packet builds against — nothing in them is
> re-litigated below.

---

## 1. Context

Nothing is built yet. Every file this packet touches is currently a one-line comment stub pointing
back at the docs (confirmed by reading each one): `src/routes/auth.ts:1`, `src/routes/admins.ts:1`,
`src/db/users.ts:1`, `src/services/jwt.ts:1`, `src/services/cache.ts:1`, `src/core/config.ts:1`,
`src/index.ts:1`. The schema is already final — `migrations/0001_init.sql:24-34` defines `users`
exactly as AUTH.md §4 describes it, so **this task writes code against an existing table, not a new
migration.**

AUTH is "the gate in front of everything else" (AUTH.md:12-13) — nothing else in the system is
reachable without it, and every other phase's spec (Sprints 2-8, `todos/PROGRESS.md`) assumes
`AuthContract` exists exactly as `src/core/contracts.ts:30-40` types it.

**Resolved decisions this packet must not re-decide** (cited as settled fact, per the caller's
instruction):
- **The KV-cached-role mechanism.** `requireRole` and `currentUser` both read the same
  `role:<uid>` KV cache with a D1 fallback on a miss — there is **no** separate D1-direct read for
  `requireRole`. This was explicitly re-affirmed after COUNCIL_FINDINGS.md #12 found the docs
  self-contradictory: AUTH.md §7 (`AUTH.md:154-162`) resolved it as "the admin list is fixed and
  never changes in practice for this deployment... `requireRole` uses the same KV-cached-role-
  with-D1-fallback mechanism as `currentUser`... since there's no revocation risk to guard
  against." `src/core/contracts.ts:32-37`'s inline comment on `requireRole` says the same thing.
  Do not build a second, D1-direct code path "to be safe" — that is the exact thing #12 rejected.
- **The guard-group split for `POST /api/admin/users/:id/role`.** COUNCIL_FINDINGS.md #8
  (`COUNCIL_FINDINGS.md:42`) settled that this one route needs `requireRole('superadmin')` while
  the rest of `/api/admin/*` needs only `requireRole('admin')` — mounting the whole prefix at one
  role either lets an admin self-promote or locks admins out of quiz creation entirely. AUTH.md
  §3.3 (`AUTH.md:85-89`) says the same: this route "is its own mount point... not covered by the
  outer group's guard."
- **The 30-day session TTL, no silent refresh.** Resolved 2026-09-05, AUTH.md §7
  (`AUTH.md:154-156`): 30 days, chosen to "comfortably exceed the longest quiz window"
  (`AUTH.md:137-140`); on lapse the student just signs in again with Google, one click. Do not
  build a refresh-token or silent-reissue endpoint.
- **`GET /api/images/:key`'s carve-out from BANK's admin-only group.** COUNCIL_FINDINGS.md #11
  (`COUNCIL_FINDINGS.md:45`) and AUTH.md §3.3 (`AUTH.md:91-94`) settled that this route is
  `requireAuth()` only, not `requireRole('admin')`. **This route's handler is BANK's, not AUTH's**
  (`src/routes/images.ts`, MODULES.md:115-117) — out of scope here (§4) — but this task's
  `requireAuth()` guard is the exact function that route will import, so its behavior must be
  correct standalone, independent of any BANK code.

**Reusable pattern to mirror:** none yet exists in this codebase (AUTH is Phase 1, first to be
built) — the guardrails in §8 are drawn from `PLAN.md`'s stated conventions (`core/` has zero
platform imports, `PLAN.md:673`; camelCase wire types / snake_case columns split at the db layer,
`CONTRACTS.md:230-235`) rather than from an existing sibling module.

**Existing frontend work this task must not touch or assume is wired up:** `mockups/student/signin.html`
and `mockups/admin/manage-admins.html` are static reference mockups only — no React app exists yet
(`wrangler.toml:6-12`'s `[assets]` block is commented out specifically because `web/dist` doesn't
exist). This task is backend-only; see §4.

## 2. Objective

After this ships: a client holding a valid Google ID token can `POST /api/auth/google` and receive
a session cookie plus their `CurrentUser`; every subsequent request carrying that cookie is
resolvable to a real, current D1 role via `requireAuth()`/`requireRole()`/`currentUser()`; the
first person whose email matches `SUPERADMIN_EMAIL` is auto-promoted on their first sign-in; a
superadmin can list users and promote/demote via a route that a plain admin cannot reach; and
every route mounted anywhere in the app is guarded by construction, not by handler-level discipline.

## 3. Assumptions

- **Runtime:** Cloudflare Workers, `nodejs_compat` on (`wrangler.toml:4`), TypeScript strict mode
  (`tsconfig.json:8`). `crypto.subtle` (WebCrypto) is available in the Workers runtime for both
  RS256 verification of Google's ID token and HS256 signing of our own session token — no JWT
  library is installed (`package.json:18-27` lists only `hono` as a runtime dependency) and none
  should be added (§8a).
- **Google's JWKS endpoint** is `https://www.googleapis.com/oauth2/v3/certs`; the ID token issuer
  (`iss`) is `https://accounts.google.com` or `accounts.google.com` (Google emits either — verify
  against both). Standard Google Identity Services behavior, not stated in AUTH.md itself but
  required to implement AUTH.md §3.1 step 3's "fetches Google's JWKS."
  <INPUT_REQUIRED: none — this is public, stable Google infrastructure, not a project decision;
  flagged here only so the implementer doesn't have to search for it.>
- **New env bindings needed, not yet in `wrangler.toml`:**
  - `GOOGLE_CLIENT_ID` — the OAuth client id checked against the token's `aud` (AUTH.md §3.1 step
    3). Not a secret (it's public in the Google Sign-In client-side flow) — add as a `[vars]`
    entry (§9, `wrangler.toml`).
  - `SUPERADMIN_EMAIL` — already named and reserved as a secret in `wrangler.toml:43`, not yet
    consumed by any code.
  - The session-signing key — already reserved in `wrangler.toml:44` ("the session-signing key"),
    not yet named. This packet names it `SESSION_SECRET` and treats it as a `wrangler secret put`
    value, per the existing comment's own framing.
  Setting the actual secret values is operator work — AC-OPERATOR-1/2 in §7.
- **Cookie name:** this packet introduces `session` as the cookie name (not specified in AUTH.md,
  which only specifies the attributes: `HttpOnly; Secure; SameSite=Lax`, AUTH.md:41). Any name is
  fine as long as it's consistent between set and read; `session` is chosen for obviousness.
- **`hono/cookie` helpers** (bundled with the installed `hono@^4.6.0`, `package.json:19`) are used
  for reading/writing the cookie rather than hand-rolling `Cookie`/`Set-Cookie` header parsing.
- **`AdminUserSummary`/`SetUserRoleRequest`/`SetUserRoleResponse`** wire types already exist at
  `src/core/api.ts:124-128` and require no changes — this task implements handlers against them,
  it does not modify `core/api.ts` or `core/contracts.ts`.

## 4. Out of Scope

- **The React frontend** (Google Identity Services client-side integration, the Manage Admins
  screen, the sign-in screen) — `PLAN.md:711-712` bundles "Manage Admins screen" into Phase 1, but
  `todos/PROGRESS.md`'s Sprint 1 row scopes this packet to backend only ("sign-in, roles, sessions,
  route guards, superadmin bootstrap" — no UI). `mockups/student/signin.html` and
  `mockups/admin/manage-admins.html` are the static design reference for whoever builds that
  screen later; this task doesn't touch `mockups/` or a `web/` directory (which doesn't exist yet).
- **`GET /api/images/:key`'s route handler** — it uses this task's `requireAuth()` but the route
  itself, and its "fetchable once served to this student" scoping logic, belongs to BANK
  (`src/routes/images.ts`, MODULES.md:115-117, Sprint 2). Only the guard function is this task's
  responsibility.
- **`wrangler d1 migrations apply` tracking / the commented-out `[assets]` block** — real defects
  (COUNCIL_FINDINGS.md #22) but general repo-hygiene, not AUTH-module scope; not in
  `todos/PROGRESS.md`'s Sprint 1 row.
- **A server-side session table / revocable sessions.** AUTH.md §6 (`AUTH.md:141-143`) names this
  explicitly as a known, accepted limitation ("stateless sessions cannot be revoked before
  expiry... acceptable for this app"). Not building it is the resolved decision, not a gap.
- **`telegram_id` population** — reserved column, unwritten by this module today
  (`migrations/0001_init.sql:32`, AUTH.md:118-119). Deferred to TELEGRAM (Sprint 6).
- **Rate-limiting `/api/auth/google`** — not named anywhere in AUTH.md, BANK.md's threat-model
  rejections (COUNCIL_FINDINGS.md #25) establish the project's posture that adversarial-input
  hardening is out of scope at this deployment's scale; treated the same way here.

## 5. Open Questions / `<INPUT_REQUIRED>`

(none) — AUTH.md §7 states "None remain" for the module's own open questions, and the task brief
that produced this packet confirms every decision cited above (KV-cache mechanism, guard-group
split, session TTL) is final. The only genuinely unspecified items (JWKS endpoint URL, cookie
name, session-secret env-var name) are implementation details with no product-behavior
consequence, resolved as Assumptions in §3 rather than raised here.

## 6. Pre-flight Checklist

- [ ] Required skill loaded: **`clean-code`** — always.
- [ ] Required skill loaded: **`vibesec`** — this task is nothing but security-sensitive surface:
      token verification, session signing, cookie attributes, admin-role escalation routes.
- [ ] Required skill loaded: **`test-driven-development`** — every AC in §7 is a behavior change
      with no prior implementation to preserve; write the table-driven guard tests (AC-9, AC-17)
      before the route handlers they test.
- [ ] Working tree clean (`git status`).
- [ ] Branch up to date with `master` (`git rev-parse --show-toplevel` confirms repo root;
      `git status` confirms no divergence).
- [ ] `wrangler.toml` updated per §9 and a local `.dev.vars` (or `wrangler secret put --local`)
      populated with `GOOGLE_CLIENT_ID`, `SUPERADMIN_EMAIL`, `SESSION_SECRET` — none of these
      exist yet (§3); `wrangler dev` will not be able to exercise sign-in without them.
- [ ] Read before editing: `src/core/contracts.ts:1-40` (`AuthContract`, `CurrentUser`, `Role`),
      `src/core/api.ts:110-129` (AUTH wire types), `migrations/0001_init.sql:20-34` (`users`
      table), `AUTH.md` in full, `CONTRACTS.md:44-69`, `API.md:44-56`.
- [ ] Re-read §7: AC-1 through AC-18 are implementer-executed; AC-OPERATOR-1/2/3 are not — flag
      them to the operator rather than attempting them.

## 7. Acceptance Criteria

**Sign-in (AUTH.md §3.1, `AUTH.md:34-45`)**

- **AC-1** — `POST /api/auth/google` with a structurally valid Google ID token (correct signature
  against Google's current JWKS, `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`},
  `aud === GOOGLE_CLIENT_ID`, `exp`/`nbf` valid) for a `google_sub` never seen before: inserts one
  new `users` row with `role = 'student'` (the column default, `migrations/0001_init.sql:30`),
  returns `200` with body `GoogleSignInResponse` (= `CurrentUser`, `src/core/api.ts:114`), and sets
  a `Set-Cookie` header with `HttpOnly; Secure; SameSite=Lax` attributes (AUTH.md:41).
- **AC-2** — The same `google_sub` signing in again does not insert a second row (`google_sub
  UNIQUE`, `migrations/0001_init.sql:26`) and returns that same user's current `CurrentUser`,
  reflecting whatever `role` D1 holds right now — not a cached value from the first sign-in.
- **AC-3** — A token with a bad signature, a `kid` matching no key after the one-refetch recovery
  (AC-4), a wrong `aud`, or an expired `exp` is rejected with `401 {message}` (API.md:48) and no
  `users` row is written or modified.
- **AC-4 (JWKS rotation)** — An unknown `kid` triggers exactly one refetch of the JWKS from Google
  before either succeeding (if the refetched set contains the key) or rejecting (if it still
  doesn't) — AUTH.md §6 (`AUTH.md:134-135`), §8 (`AUTH.md:167`). A second request with a `kid`
  already known to be missing (within the JWKS cache TTL) does not refetch again.
- **AC-5 (clock skew)** — `exp`/`nbf` validation allows a small leeway (recommend 60s, matching
  the KV propagation figure already used elsewhere in this module for consistency — not itself a
  product requirement, an implementation choice) rather than rejecting on sub-minute clock drift
  (AUTH.md §6, `AUTH.md:136`).

**Superadmin bootstrap (AUTH.md §3.4, `AUTH.md:96-100`)**

- **AC-6** — On a sign-in where no row in `users` currently has `role = 'superadmin'`, if the
  verified token's email matches the `SUPERADMIN_EMAIL` secret, that user's row is promoted to
  `role = 'superadmin'` as part of the same request that creates/looks up their `users` row.
- **AC-7** — Once any `superadmin` exists, this promotion never fires again — for that user or any
  other — even if a later sign-in's email also happens to match `SUPERADMIN_EMAIL` (e.g., the
  secret was reused). "Runs once and is a no-op thereafter" (AUTH.md:99).

**`/me` and logout (AUTH.md §5, `AUTH.md:127-129`)**

- **AC-8** — `GET /api/auth/me` with a valid session cookie returns `200` with the signed-in
  user's current `CurrentUser` (role read fresh per §3.2's mechanism, not baked into the cookie —
  the cookie carries `{uid, iat, exp}` only, AUTH.md:57). Without a cookie, or with a cookie that
  fails signature/expiry verification, returns `401`.
- **AC-9** — `POST /api/auth/logout` clears the cookie (an expired/zero-`Max-Age` `Set-Cookie`)
  and returns `200 {success: true}`; no D1 or KV write happens — sessions are stateless and there
  is nothing server-side to revoke (AUTH.md §7, `AUTH.md:161-162`).

**Guards (AUTH.md §3.3, `AUTH.md:73-94`; CONTRACTS.md §2, `CONTRACTS.md:46-69`)**

- **AC-10** — `requireAuth()` rejects with `401` any request with no cookie, a malformed cookie,
  or a cookie whose signature or `exp` doesn't verify. It is mounted as middleware on a route
  group in `src/index.ts`, not called ad hoc inside individual handlers.
- **AC-11** — `requireRole('admin')` allows `role ∈ {admin, superadmin}` and returns `403` for a
  signed-in `student` (and `401` for signed-out, per AC-10). Table-driven test over every route
  mounted under `/api/admin/*` **except** the one in AC-13 — a new route added to that group and
  left unguarded must fail this suite (AUTH.md §8, `AUTH.md:168-169`).
- **AC-12** — `requireRole('superadmin')` allows only `role = 'superadmin'`; a signed-in `admin`
  gets `403`.
- **AC-13 (the guard-group split, COUNCIL_FINDINGS.md #8)** — `POST /api/admin/users/:id/role` is
  mounted at `requireRole('superadmin')`, on its own mount point, not inherited from the outer
  `/api/admin/*` group's `requireRole('admin')`. Verified by: a signed-in plain `admin` gets `200`
  on `GET /api/admin/users` (or any other `/api/admin/*` route from a later phase) but `403` on
  this one specific route.
- **AC-14** — `requireRole` and `currentUser` share one underlying role-lookup function — same KV
  key (`role:<uid>`), same D1 fallback on a miss. No second, D1-direct-only code path exists
  anywhere in the guard implementation (COUNCIL_FINDINGS.md #12, AUTH.md §7). Verified at the code
  level: both call the same exported helper in `src/db/users.ts`.
- **AC-15** — A signed-out visitor gets `401` on every route reachable only via `requireAuth()` or
  `requireRole(...)` — AUTH.md §8's "signed-out access" case (`AUTH.md:173`), same table-driven
  matrix as AC-11 extended to the unauthenticated case.
- **AC-16** — `CurrentUser` as returned by `/me`, the sign-in response, and `currentUser(ctx)`
  contains exactly `{id, name, role, pictureUrl}` (`src/core/contracts.ts:23-28`) — no `email`, no
  session/token field. `AdminUserSummary` (`src/core/api.ts:124`, used only by the roster and
  role-change responses) is the one place `email`/`createdAt` are added.

**Roster management (AUTH.md §3.5, `AUTH.md:102-105`; PRD ADMIN-3, `PRD.md:234`)**

- **AC-17** — `GET /api/admin/users` returns `AdminListUsersResponse` (`{users:
  AdminUserSummary[]}`, `src/core/api.ts:125`) as a plain array — not `PageResponse`-wrapped,
  matching API.md's pagination convention exclusion for the roster (API.md:27, "the admin user
  roster" is named as one of the bounded-size exceptions).
- **AC-18** — `POST /api/admin/users/:id/role {role: 'admin'}` on a `student` promotes them;
  `{role: 'student'}` on an `admin` demotes them; both return `200 SetUserRoleResponse`
  (`= AdminUserSummary`). The write deletes the target user's `role:<uid>` KV entry in the same
  request (AUTH.md:59, "role change → write D1, delete KV key"). A request with `{role:
  'superadmin'}` is rejected `400` — this route promotes/demotes between `student`/`admin` only;
  AUTH.md §3.5's own wording is "promote a student to admin and demote an admin," never "promote
  to superadmin," and there is no product surface for minting a second superadmin this way.
- **AC-19** — Demoting the sole remaining `superadmin` (target's current role is `superadmin` and
  `SELECT COUNT(*) FROM users WHERE role = 'superadmin'` = 1) returns `409` (API.md:52) and the
  `users` table is unchanged.

**AC-OPERATOR** (cannot be executed by the implementer — see §12b's Operator table):

- **AC-OPERATOR-1** — Create a Google OAuth 2.0 Client ID (Web application type) in Google Cloud
  Console; set its authorized JavaScript origin to the deployed Worker's real origin; record the
  Client ID as `GOOGLE_CLIENT_ID` in `wrangler.toml`'s `[vars]` block.
- **AC-OPERATOR-2** — Run `wrangler secret put SUPERADMIN_EMAIL` and `wrangler secret put
  SESSION_SECRET` (a long random value, e.g. `openssl rand -base64 32`) against the deployed
  Worker before the first real sign-in.
- **AC-OPERATOR-3** — Perform the first real sign-in using the email that matches
  `SUPERADMIN_EMAIL` and confirm, via `GET /api/admin/users` or a direct D1 query, that exactly one
  `users` row now has `role = 'superadmin'`.

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not modify `src/core/contracts.ts` or `src/core/api.ts` — `AuthContract`, `CurrentUser`, and
  every AUTH wire type are already final (§3). `git diff -- src/core/contracts.ts src/core/api.ts`
  must be empty at the end of this task.
- Do not modify `migrations/0001_init.sql` — `users` is already correct as specified
  (`migrations/0001_init.sql:24-34`). `git diff -- migrations/0001_init.sql` must be empty.
- Do not add a new npm dependency for JWT signing/verification or JWKS handling (e.g. `jose`,
  `jsonwebtoken`, `jwks-rsa`). `package.json` currently has zero runtime dependencies beyond
  `hono` (`package.json:18-20`); the Workers `crypto.subtle` API is sufficient for both RS256
  verification of Google's token and HS256 signing of the session token.
- Do not build a server-side session table, a refresh/reissue endpoint, or any "silent refresh"
  logic — resolved against in AUTH.md §6/§7 (§4).
- Do not build a second, D1-direct-only role-read path alongside the KV-cached one "to be safe
  about revocation" — COUNCIL_FINDINGS.md #12 rejected exactly this (§1).
- Do not mount `POST /api/admin/users/:id/role` under the same `requireRole('admin')` group as the
  rest of `/api/admin/*` — that reintroduces the self-promotion bug COUNCIL_FINDINGS.md #8 exists
  to close (§1, AC-13).
- Do not add a rate-limiter, CAPTCHA, or IP-based throttling to `/api/auth/google` — out of scope
  (§4), not requested anywhere in AUTH.md.
- Do not implement or stub `GET /api/images/:key`'s route handler — only the `requireAuth()` guard
  it will import (§4).

### 8b. Coding / quality principles

- **`clean-code`** — `requireAuth`/`requireRole` as short Hono middleware factories with early
  returns (reject-and-return before the happy path), not nested conditionals. No magic numbers:
  name the 30-day TTL, the clock-skew leeway, and the JWKS cache TTL as constants in
  `src/core/config.ts` (mirroring its existing role as home for "caps... phase constants",
  `src/core/config.ts:1`), not inline literals in `src/services/jwt.ts`.
- **`vibesec`** — this entire task is the security-sensitive surface: verify Google's ID token
  signature against the actual fetched JWKS (never skip signature verification, never trust an
  unverified `sub`/`email` claim), sign the session token with a secret pulled from Worker
  secrets (never hardcoded, never logged), set every session cookie with `HttpOnly; Secure;
  SameSite=Lax` with no code path that omits `HttpOnly` (a cookie readable from `document.cookie`
  defeats the whole point), and treat `POST /api/admin/users/:id/role` as the single highest-value
  target in the module — the guard-group split (AC-13) is a security control, not a style choice.
- **`test-driven-development`** — write the table-driven guard-matrix test (AC-11/AC-13/AC-15)
  first, over a route list that includes every route this task mounts; a route added later without
  updating that table should be an easy, obvious addition, not a rewrite.
- Mirror the module boundary already stated in `MODULES.md:52-64`: `users` has exactly one writer
  (this task's `src/db/users.ts`); no other file in this task writes to `users` directly.
- Keep `src/core/config.ts` free of platform imports, matching its existing role and `core/`'s
  stated invariant (`PLAN.md:673`, "ZERO platform imports"); the JWKS fetch/cache and cookie
  signing (`src/services/jwt.ts`, `src/services/cache.ts`) are correctly platform-specific and
  belong in `services/`, not `core/`.

## 9. Behavior Spec (per file)

### `src/core/config.ts`

- **Current state (line 1):** one-line comment stub, no exports.
- **Required edit:** add named constants: `SESSION_TTL_MS` (30 days in ms, AUTH.md:139),
  `SESSION_COOKIE_NAME` (`'session'`, §3), `CLOCK_SKEW_LEEWAY_SEC` (AC-5), `JWKS_CACHE_TTL_SEC`
  (a sane default, e.g. 24h — AUTH.md doesn't specify a number, only that it must exist and
  survive one unknown-`kid` refetch, AUTH.md:134-135), `GOOGLE_JWKS_URL`, `GOOGLE_ISSUERS` (array
  of the two accepted `iss` values, §3).
- **Estimated diff:** ~15 LOC.
- **Subtleties:** these are the only new constants this task needs; do not also add QUIZZING/BANK
  constants here even if convenient — this file is shared across all eight phases and each
  phase's own spec owns its own additions.

### `src/services/cache.ts`

- **Current state (line 1):** one-line comment stub describing the full KV keyspace this file will
  eventually own (`jwks:*`, `role:<uid>`, `question:<quizId>`, `board:*`) — this task implements
  only the first two.
- **Required edit:** a thin typed wrapper over the `CACHE` KV binding: `getJwks()`/`setJwks()`
  keyed `jwks:google` with `JWKS_CACHE_TTL_SEC`; `getCachedRole(userId)`/`setCachedRole(userId,
  role)`/`invalidateRole(userId)` keyed `role:<uid>` (MODULES.md:88-89 — "Written by AUTH, Read by
  AUTH").
- **Estimated diff:** ~50 LOC.
- **Subtleties:** do not add `question:<quizId>` or `board:*` handling here — those are QUIZZING's
  (Sprint 4/5, MODULES.md:90-91) and belong in this same file only when that phase's spec adds
  them; adding unused surface now is scope creep this packet's own §8a would flag in review.

### `src/services/jwt.ts`

- **Current state (line 1):** one-line comment stub.
- **Required edit:** two independent concerns in one file, per its existing stub description
  ("Google ID token verification, JWKS fetch + KV cache, our own session token sign/verify"):
  1. `verifyGoogleIdToken(idToken: string, env): Promise<{sub, email, name, pictureUrl}>` — decode
     the JWT header to read `kid`; fetch/cache JWKS via `cache.ts`; on an unknown `kid`, refetch
     **once** before giving up (AC-4); verify signature (RS256, via `crypto.subtle.verify` on an
     imported JWK public key), `iss`, `aud === env.GOOGLE_CLIENT_ID`, `exp`/`nbf` with
     `CLOCK_SKEW_LEEWAY_SEC` leeway (AC-5); throw a typed error the route layer maps to `401`.
  2. `signSession(userId: string, env): Promise<string>` / `verifySession(token: string, env):
     Promise<{uid: string} | null>` — our own token, `{uid, iat, exp}` only (AUTH.md:57, no role
     field — AC-16's "no session/token field" also means the reverse: the session token itself
     carries no role), HMAC-SHA256 over a compact JSON payload, signed with `env.SESSION_SECRET`,
     `exp = iat + SESSION_TTL_MS`.
- **Estimated diff:** ~130 LOC (the largest single file in this task — justified by AUTH.md itself
  bundling both concerns into one file at the stub-comment level, `src/services/jwt.ts:1`; if it
  grows past ~150 LOC in practice, split session sign/verify into a sibling `src/services/session.ts`
  rather than let this file become a dumping ground).
- **Subtleties:** the JWKS refetch-once behavior (AC-4) is the one genuinely tricky piece — an
  unbounded refetch-on-every-unknown-kid is a self-inflicted DoS vector (an attacker can send
  tokens with garbage `kid`s to force a JWKS fetch on every request); cap it at exactly one
  refetch per verification call, not per unknown `kid` ever seen.

### `src/db/users.ts`

- **Current state (line 1):** one-line comment stub naming exactly the four `AuthContract`
  functions plus the KV/D1 mechanism, matching `src/core/contracts.ts:30-40` and CONTRACTS.md §2.
- **Required edit:** implement `AuthContract` against D1 (`env.DB`) and the KV wrapper
  (`cache.ts`):
  - `upsertUserFromGoogle({sub, email, name, pictureUrl}, env)` — `SELECT` by `google_sub`; if
    absent, `INSERT` with `role = 'student'`; return the row either way (AC-1, AC-2).
  - `bootstrapSuperadminIfNeeded(userId, email, env)` — `SELECT COUNT(*) FROM users WHERE role =
    'superadmin'`; if zero and `email === env.SUPERADMIN_EMAIL`, `UPDATE users SET role =
    'superadmin' WHERE id = ?` and invalidate that user's `role:<uid>` KV entry (AC-6, AC-7).
  - `getUserById(id, env)` — D1 read, mapped to `CurrentUser`.
  - `requireAuth()` — Hono middleware factory: read the session cookie via `hono/cookie`, call
    `jwt.ts`'s `verifySession`, `401` on failure/absence, else attach `{uid}` to context (AC-10).
  - `requireRole(role)` — Hono middleware factory: run `requireAuth()`'s check first, then resolve
    the caller's current role via the shared helper described in AC-14 (KV `role:<uid>`, D1
    fallback on miss, write-through the KV entry on a fallback hit), `403` if it doesn't satisfy
    `role` (AC-11, AC-12).
  - `currentUser(ctx)` — reads the same shared role-resolution helper as `requireRole`, returns
    `CurrentUser` (AC-14, AC-16).
  - `listUsers(env)` / `setUserRole(targetId, role, env)` — the roster and promote/demote
    operations backing `src/routes/admins.ts` (AC-17, AC-18, AC-19), including the last-superadmin
    guard (`COUNT(*) FROM users WHERE role = 'superadmin'`) and the KV `role:<uid>` invalidation
    on every successful role write.
- **Estimated diff:** ~140 LOC. This is the single largest concentration of logic in the task; it
  is deliberately not split further because `AuthContract`'s own four functions plus the two
  roster operations are one cohesive unit around one table (`users`) with one writer
  (MODULES.md:58) — splitting it across files would scatter the one-writer boundary this module
  exists to enforce.
- **Subtleties:** `requireRole` and `currentUser` **must** call the same internal role-resolution
  function (AC-14) — do not let them diverge into two implementations that happen to behave the
  same today. The last-superadmin check (AC-19) and the KV-invalidation-on-role-write (AC-18) must
  both happen inside `setUserRole`, not split across the route handler and the db layer, so there
  is one place that can get this wrong instead of two.

### `src/routes/auth.ts`

- **Current state (line 1):** one-line comment stub naming the three routes.
- **Required edit:** `POST /api/auth/google` (verify token via `jwt.ts`, upsert user + bootstrap
  check via `db/users.ts`, sign session, set cookie, return `CurrentUser`, AC-1/2/3/6/7); `POST
  /api/auth/logout` (clear cookie, `{success: true}`, AC-9); `GET /api/auth/me` (mounted behind
  `requireAuth()`, returns `currentUser(ctx)`, AC-8).
- **Estimated diff:** ~70 LOC.
- **Subtleties:** the sign-in handler is the one place all three concerns (JWT verify, DB upsert,
  bootstrap, session issuance) compose — keep each step a single named call into `jwt.ts`/`db/users.ts`
  rather than inlining their logic here, so this file stays readable as "the request/response glue,"
  not a second copy of the verification logic.

### `src/routes/admins.ts`

- **Current state (line 1):** one-line comment stub that already states the guard split
  (`requireRole('admin')` for the list, `requireRole('superadmin')`, own mount point, for the
  role-change route) — this task fulfills exactly that comment.
- **Required edit:** `GET /api/admin/users` (`requireRole('admin')`, calls `listUsers`, AC-17);
  `POST /api/admin/users/:id/role` (its own mount, `requireRole('superadmin')`, validates
  `role ∈ {'admin','student'}` — `400` otherwise, AC-18 — calls `setUserRole`, surfaces `404` if
  `:id` doesn't exist and `409` on the last-superadmin guard, AC-19).
- **Estimated diff:** ~55 LOC.
- **Subtleties:** this file must export its two route groups separately (e.g. one Hono sub-app for
  the admin-guarded routes, one for the superadmin-only route) so `src/index.ts` can mount them
  under different middleware — do not export one flat router that applies a single guard
  internally per-handler, which is exactly the "structural impossibility" property AUTH.md §3.3
  asks for (a forgotten per-handler guard should fail to compile/mount, not fail a code review).

### `src/index.ts`

- **Current state (line 1):** one-line comment stub describing the Hono app, route mounting, and
  cron handler for the whole system (all 8 phases).
- **Required edit:** this task adds only its own slice: mount `src/routes/auth.ts`'s router at
  `/api/auth` (with `/me` behind `requireAuth()`); mount `src/routes/admins.ts`'s admin-guarded
  sub-router at `/api/admin` with `requireRole('admin')` applied as middleware on that sub-router;
  mount its superadmin-only sub-router (or a `/api/admin/superadmin` sub-prefix — implementer's
  choice, AUTH.md:87-88 offers both) with `requireRole('superadmin')`. Define the Worker `Bindings`
  type this task needs: `{ DB: D1Database; CACHE: KVNamespace; GOOGLE_CLIENT_ID: string;
  SUPERADMIN_EMAIL: string; SESSION_SECRET: string }`.
- **Estimated diff:** ~40 LOC (additions only).
- **Subtleties:** `src/index.ts` is shared across every phase — Sprints 2-8 will each add their own
  route mounts and extend `Bindings` (`IMAGES`, `TELEGRAM_BOT_TOKEN`, etc.) in their own specs. Do
  not add placeholder mounts or stub comments for routes this task doesn't implement (`/api/bank/*`,
  `/api/quizzes/*`, etc.) — leave those for their own phase's spec to introduce, so a `git blame`
  on any given mount line points at the phase that actually owns it. Do not implement the
  `scheduled()` cron handler here — that's SCHEDULER's (Sprint 4/7).

### `wrangler.toml`

- **Current state (lines 43-49):** `[vars]` block with Telegram-only entries; a comment
  (`wrangler.toml:43-44`) already reserves `SUPERADMIN_EMAIL` and "the session-signing key" as
  secrets set via `wrangler secret put`, never written here.
- **Required edit:** add `GOOGLE_CLIENT_ID = ""` to the `[vars]` block (it's the OAuth client id,
  public by nature — not a secret, unlike `SUPERADMIN_EMAIL`/`SESSION_SECRET`), with a one-line
  comment citing AUTH.md §3.1 step 3 and noting the operator fills in the real value
  (AC-OPERATOR-1).
- **Estimated diff:** ~3 LOC.
- **Subtleties:** do not add `SUPERADMIN_EMAIL` or `SESSION_SECRET` here — they are secrets by the
  file's own existing convention (`wrangler.toml:43-44`) and must only ever be set via `wrangler
  secret put`, never committed as a `[vars]` value.

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| JWKS refetch-on-unknown-`kid` becomes unbounded (attacker sends garbage `kid`s) | Med | Med | AC-4 caps it at one refetch per verification call; §9's `jwt.ts` subtlety calls this out explicitly |
| `requireRole`/`currentUser` silently diverge into two role-resolution implementations over time | Med | High | AC-14 + §9's `db/users.ts` subtlety mandate one shared internal helper; a unit test asserting they call the same function closes this |
| `POST /api/admin/users/:id/role` accidentally inherits the outer `/api/admin/*` group's `requireRole('admin')` guard (a routing-config typo) | Low | Critical (self-promotion to superadmin) | AC-13's table-driven test — plain admin must get `403` on this one route while getting `200` elsewhere in the group |
| Session cookie set without `HttpOnly` (a copy-paste of a non-HttpOnly example) | Low | Critical (XSS-readable session token) | AC-1/CHROME-1 explicitly check `document.cookie` does not expose it |
| `GOOGLE_CLIENT_ID`/`SUPERADMIN_EMAIL`/`SESSION_SECRET` never actually set in the deployed environment | Med | High (sign-in fails in prod, or bootstrap never fires) | AC-OPERATOR-1/2 + OP-1/OP-2 in §12b |
| Last-superadmin demotion guard checked against a stale KV-cached role instead of a fresh D1 count | Low | High (could brick the only superadmin) | AC-19 specifies the count is a live `COUNT(*)` query, not a cached value — §9 `db/users.ts` |
| `wrangler.toml`'s `[assets]` block being commented out (COUNCIL_FINDINGS.md #22, out of scope §4) surprises whoever runs `wrangler dev` for the Chrome QA cases | Low | Low | §12b's CHROME cases note the Worker serves API-only in local dev; no static asset request is exercised |

## 11. Rollback / Revert Plan

1. `git revert <sha>` on the commit(s) that introduced this task's changes to `src/routes/auth.ts`,
   `src/routes/admins.ts`, `src/db/users.ts`, `src/services/jwt.ts`, `src/services/cache.ts`,
   `src/core/config.ts`, `src/index.ts`, and `wrangler.toml`.
2. No migration to roll back — `migrations/0001_init.sql` was never touched (§8a Hard NO).
3. Redeploy: `npm run deploy` (`package.json:8`) rebuilds the Worker from the reverted tree —
   nothing to rebuild client-side since no frontend depends on this yet (§4).
4. If `GOOGLE_CLIENT_ID`/`SUPERADMIN_EMAIL`/`SESSION_SECRET` were set as part of this rollout and
   the revert removes the code paths that read them, the secrets themselves are harmless to leave
   in place (unused vars/secrets cost nothing) — no `wrangler secret delete` needed unless the
   operator wants to fully undo AC-OPERATOR-1/2.
5. Verification: `curl -i https://<worker>/api/auth/me` returns whatever the pre-revert behavior
   was (likely a 404/500 if AUTH never existed before this task, confirming the revert is clean —
   there is no "prior working version" of this route to restore to, since this is Phase 1's first
   implementation).
6. Notification: since this is a single-operator project (COUNCIL_FINDINGS.md's summary,
   `COUNCIL_FINDINGS.md:110-111`), notify via whatever channel the operator already monitors for
   this deployment (e.g. `TELEGRAM_ALERT_CHAT_ID`/`EMAIL_ALERT_ADDRESS`, `wrangler.toml:47,49`) —
   no wider team to page.

## 12. Verification + Definition of Done

### 12a. Automated verification

```bash
# Typecheck — must pass with zero errors; strict mode is on (tsconfig.json:8)
npm run typecheck

# Unit + guard-matrix tests (vitest + @cloudflare/vitest-pool-workers are already installed,
# package.json:10,23,25 — no test runner needs to be added)
npm test

# Confirm the Hard NO files are untouched
git diff --quiet -- src/core/contracts.ts src/core/api.ts migrations/0001_init.sql \
  && echo "OK: contracts/api/migration untouched" || echo "FAIL: forbidden file modified"

# Confirm no new JWT/JWKS npm dependency was added
node -e "const p=require('./package.json'); const bad=['jose','jsonwebtoken','jwks-rsa','jwt-decode']; \
  const hit=bad.filter(b => p.dependencies?.[b] || p.devDependencies?.[b]); \
  if (hit.length) { console.error('FAIL: forbidden dependency', hit); process.exit(1); } \
  console.log('OK: no forbidden JWT dependency');"
```

Suggested test files (none exist yet — this task creates them): `src/db/users.test.ts` (guard
matrix, AC-10/11/12/13/14/15/17/18/19), `src/services/jwt.test.ts` (AC-3/4/5, forged/expired/
rotated-key tokens against a fixture JWKS), `src/routes/auth.test.ts` (AC-1/2/6/7/8/9, full
sign-in round trip against a mocked Google JWKS).

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | First sign-in creates a student | `wrangler dev`; POST `/api/auth/google` with a fixture ID token (self-signed against a test JWKS, `aud` = local `GOOGLE_CLIENT_ID`) for a fresh `google_sub` | `200`, body has `role: 'student'`, `Set-Cookie` present with `HttpOnly; Secure; SameSite=Lax` | Not Run |
| BE-2 | Repeat sign-in doesn't duplicate | Same request again | `200`, same `id` as BE-1, no new D1 row (`SELECT COUNT(*) FROM users WHERE google_sub = ?` still 1) | Not Run |
| BE-3 | Forged token rejected | POST with a token signed by a key not in the fixture JWKS | `401 {message}` | Not Run |
| BE-4 | Expired token rejected | POST with a token whose `exp` is in the past | `401 {message}` | Not Run |
| BE-5 | JWKS rotation recovers once | Swap the fixture JWKS mid-test (new `kid`), POST with a token signed by the new key | `200` — refetch happened once and succeeded | Not Run |
| BE-6 | Superadmin bootstrap fires once | POST sign-in with the email matching `SUPERADMIN_EMAIL` on a fresh DB (no superadmin yet) | `200`, `role: 'superadmin'` in the response | Not Run |
| BE-7 | Bootstrap doesn't refire | Repeat BE-6's request | `200`, still `superadmin`, and a second matching-email user (different `google_sub`) does **not** also get promoted | Not Run |
| BE-8 | `/me` requires auth | GET `/api/auth/me` with no cookie | `401` | Not Run |
| BE-9 | `/me` with valid session | GET `/api/auth/me` with BE-1's cookie | `200`, matches `CurrentUser` shape exactly (`id,name,role,pictureUrl`, no `email`) | Not Run |
| BE-10 | Logout clears cookie | POST `/api/auth/logout`, then GET `/api/auth/me` with the same (now-cleared) cookie | Logout `200 {success:true}`; the follow-up `/me` `401` | Not Run |
| BE-11 | 403 matrix — admin route as student | GET `/api/admin/users` with a `student`'s cookie | `403` | Not Run |
| BE-12 | 403 matrix — superadmin route as admin | POST `/api/admin/users/:id/role` with an `admin`'s (non-superadmin) cookie | `403` | Not Run |
| BE-13 | Guard-group split (AC-13, the critical one) | Same admin cookie as BE-12 against `GET /api/admin/users` | `200` — proves the admin isn't globally locked out, only off the superadmin-only route | Not Run |
| BE-14 | Promote/demote roundtrip | Superadmin POSTs `{role:'admin'}` for a student, then `{role:'student'}` for that same now-admin user | Both `200`; final `GET /api/admin/users` shows `role:'student'` again | Not Run |
| BE-15 | Reject promote-to-superadmin | Superadmin POSTs `{role:'superadmin'}` for any user | `400` | Not Run |
| BE-16 | Last-superadmin guard | With exactly one superadmin, that superadmin POSTs `{role:'admin'}` targeting themselves | `409`, role unchanged | Not Run |
| BE-17 | Signed-out access to every guarded route | No-cookie request against every route mounted in `src/index.ts` by this task | `401` on every one | Not Run |

#### Frontend / UI

N/A — no frontend build exists yet (`wrangler.toml:6-12`'s `[assets]` block is commented out until
`web/dist` exists; this task is backend-only per §4). `mockups/student/signin.html` and
`mockups/admin/manage-admins.html` are static design references only, not wired to any backend.
If a future task wires a real `web/` app to these routes, that implementation must add FE cases
here.

#### Chrome DevTools / extension verification

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| CHROME-1 | Cookie attributes, real browser | `wrangler dev`; open `http://localhost:8787` in Chrome; DevTools Console: `fetch('/api/auth/google', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({idToken: '<fixture token>'})})` | Network tab shows `Set-Cookie` with `HttpOnly; Secure; SameSite=Lax` (Chrome treats `http://localhost` as a secure context, so `Secure` cookies still set locally) | Not Run |
| CHROME-2 | HttpOnly actually blocks JS access | In the same session, run `document.cookie` in the Console | Session cookie is **not** present in the returned string (only non-HttpOnly cookies would be) | Not Run |
| CHROME-3 | Cookie auto-attaches same-origin | Console: `fetch('/api/auth/me').then(r=>r.json()).then(console.log)`, no manual header | `200`, logs the `CurrentUser` object — proves the browser is attaching the cookie itself, not just curl's explicit `-b` | Not Run |
| CHROME-4 | Logout ends the browser session | Console: `fetch('/api/auth/logout', {method:'POST'})`, then repeat CHROME-3's `/me` fetch | Logout succeeds; the follow-up `/me` call returns `401` | Not Run |

#### Operator-executed (post-cutover, see AC-OPERATOR)

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| OP-1 | Real Google OAuth client provisioned | Create the OAuth Client ID in Google Cloud Console per AC-OPERATOR-1; set `GOOGLE_CLIENT_ID` in `wrangler.toml` | A real Google Sign-In flow against the deployed Worker's origin produces a verifiable ID token | Not Run |
| OP-2 | Secrets set on the deployed Worker | `wrangler secret put SUPERADMIN_EMAIL`; `wrangler secret put SESSION_SECRET` per AC-OPERATOR-2 | `wrangler secret list` shows both present; a real sign-in no longer 500s on a missing binding | Not Run |
| OP-3 | First real superadmin confirmed | Operator signs in with the `SUPERADMIN_EMAIL` address per AC-OPERATOR-3 | `GET /api/admin/users` (or a direct D1 query) shows exactly one `role:'superadmin'` row, matching the operator's own account | Not Run |

**Mandatory-rule note:** every applicable table above has at least one populated case; the FE
table is marked `N/A` with reason per the rule in the spec-writer skill, since no frontend build
exists for this backend-only phase.

#### 12c. Definition of Done

- [ ] AC-1 through AC-19 satisfied (AC-OPERATOR-1/2/3 tracked separately, not implementer work).
- [ ] §12a passes locally (`npm run typecheck`, `npm test`, both `git diff` and dependency checks
      clean).
- [ ] BE-1 through BE-17 and CHROME-1 through CHROME-4 have Status ≠ `Not Run` (target: `Pass`).
- [ ] FE table's `N/A` status stands (no frontend exists to test).
- [ ] OP-1/OP-2/OP-3 completed by the operator, or explicitly waived (recorded in §5 if waived —
      §5 currently has none, so a waiver here would be new information, not a pre-existing gap).
- [ ] No `<INPUT_REQUIRED>` remains in §5 (there are none to begin with).
- [ ] §8a Hard NO list respected — `git diff` on `src/core/contracts.ts`, `src/core/api.ts`, and
      `migrations/0001_init.sql` is empty; no forbidden JWT/JWKS npm dependency was added.
- [ ] §11 Rollback plan rehearsed mentally — implementer can name the exact commit(s) `git revert`
      would target.

---

End of Codex Task Packet — `claude-task--001`
