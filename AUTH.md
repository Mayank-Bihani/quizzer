# Quizzer — Auth Module

> **Scope:** the `auth` module only. Product requirements in [[PRD]] §5.1; index in [[MODULES]].
> **Status:** module spec, nothing built. Phase 1. Audited and resolved 2026-09-04 — see [[AUDIT]]
> §11.
> **Last updated:** 2026-09-04

---

## 1. What this module is

The gate in front of everything else. It establishes **who you are** and **what role you hold**, and
nothing in the app is reachable without it.

| It does | It does not |
|---|---|
| Google Sign-In, verify the ID token server-side | Accept any other login method (AUTH-1) |
| Create a durable user record on first sign-in | Treat Telegram as an identity (AUTH-6) |
| Issue and verify our own session | Treat the room code as a credential — it is a door, not a login |
| Enforce `student` / `admin` / `superadmin` on every route | Decide who may join a *specific* quiz — that is Quizzing's seat claim |
| Bootstrap the first superadmin from a deploy secret | Offer self-service signup for elevated roles |

**Why the user record matters beyond login:** it is what makes history and weekly ranking follow a
real person across quizzes (AUTH-2). Without it there is no [[PRD]] G4 or G5.

## 2. Requirements covered

AUTH-1 … AUTH-6, ADMIN-3. Gates every requirement in every other module.

---

## 3. Responsibilities

### 3.1 Sign-in

1. Client runs Google Identity Services, receives a Google **ID token** (JWT).
2. `POST /api/auth/google` sends it to the Worker.
3. Worker fetches Google's **JWKS**, cached in KV, and verifies: signature, `iss`, `aud` (our client
   id), `exp`, `nbf`.
4. Look up `users` by `google_sub`. Create on first sight with `role='student'` (AUTH-3).
5. Issue **our own session token**, set as an `HttpOnly; Secure; SameSite=Lax` cookie.

**Why our own session rather than passing Google's token around:** Google ID tokens expire in ~1
hour, which is shorter than a quiz window plus a review session, and re-verifying against JWKS on
every request is wasteful. Ours is signed with a Worker secret and verified locally.

### 3.2 The role-revocation rule

AUTH-5 requires that demoting an admin **revokes access within ~60 seconds**. That rules out
baking the role into the session token — a token issued before the demotion would stay valid until
expiry.

**Therefore: the session token carries `user_id` only.** The role is read per request, from a KV
entry keyed by user id and invalidated the moment a role changes, falling back to D1 on a miss.

```
session token  →  { uid, iat, exp }        ← no role
role lookup    →  KV `role:<uid>`  →  D1 `users.role`
role change    →  write D1, delete KV key  ← revocation propagates within KV's global
                                              consistency window (~60s), not instantly
```

**This was originally documented as "revocation is immediate," which is false** — a KV delete is
itself an eventually-consistent write, so a demoted admin hitting a different edge location can
still be served the stale cached role for up to ~60s ([[AUDIT]] §3.4). The fix would be to have
`requireRole('admin')` / `requireRole('superadmin')` read `users.role` from D1 directly, bypassing
KV, while leaving KV in place for `requireAuth()`-only routes where the role is only used for
display. **Deliberately not built right now**: this is a low-stakes single-operator project where
a role is expected to be revoked rarely if ever, and a ~60-second window isn't worth a route-level
D1/KV split today. AUTH-5's acceptance criterion is worded to match reality rather than promise
something the mechanism doesn't deliver. Revisit if revocation ever needs to be provably immediate.

### 3.3 Guards

```ts
requireAuth()                  // any signed-in user
requireRole('admin')           // admin or superadmin
requireRole('superadmin')      // superadmin only
currentUser(ctx)               // { id, name, role, pictureUrl }
```

Mounted per route group, not per handler — a route that forgets its guard should be a structural
impossibility, not a review catch.

**One route group needs two guards.** `/api/admin/*` is mostly `requireRole('admin')`, but
`POST /api/admin/users/:id/role` is `requireRole('superadmin')` only (§3.5) — mounting the whole
prefix at one role either lets an admin self-promote or locks admins out of quiz creation. That
one route is its own mount point (or a `/api/admin/superadmin/*` sub-prefix), not covered by the
outer group's guard (COUNCIL_FINDINGS.md #8).

**`GET /api/images/:key` is not in BANK's admin-only group**, despite living under `/api`, since
students need to load question images mid-quiz. It's `requireAuth()` only — any signed-in user,
no per-question scoping. These are illustrative images (charts, diagrams), not answer text; the
only way to fetch one "early" is deliberately guessing another question's key, which reveals
nothing worth the effort — not worth BANK reading QUIZZING-owned tables to prevent
(COUNCIL_FINDINGS.md #11, reconsidered) — see [[BANK]] §5.

### 3.4 Superadmin bootstrap

On first run, if no `superadmin` exists, the user whose email matches the `SUPERADMIN_EMAIL` secret
is promoted on their next sign-in (AUTH-4). Runs once and is a no-op thereafter. There is no UI path
to create the first one.

### 3.5 Roster management

`superadmin` can promote a student to `admin` and demote an admin (AUTH-5, ADMIN-3). A superadmin
cannot demote themselves if they are the last one.

---

## 4. Data owned

`users` — sole writer. No other module writes this table.

```sql
users   id, google_sub UNIQUE, email UNIQUE, name, picture_url,
        role ('student'|'admin'|'superadmin'), telegram_id NULL, created_at
```

`telegram_id` is reserved for a deferred feature and is not written by this module today
(see [[TELEGRAM]] §4.3 for why it is not sufficient on its own).

## 5. Interfaces

**Exposes to other modules:** `requireAuth`, `requireRole`, `currentUser`, `getUserById`.

**Consumes:** KV (JWKS cache, role cache), D1 (`users`).

**Routes:** `POST /api/auth/google` · `POST /api/auth/logout` · `GET /api/auth/me` ·
`GET /api/admin/users` · `POST /api/admin/users/:id/role`

---

## 6. Limitations and hard parts

- **JWKS rotation.** Google rotates signing keys. Cache with a TTL, and on an unknown `kid` refetch
  **once** before rejecting — otherwise a rotation locks everyone out until the TTL expires.
- **Clock skew.** Allow a small leeway on `exp` / `nbf` validation.
- **Session TTL vs. the quiz window.** A session expiring mid-quiz would be a disaster — the student
  loses their run through no fault of their own. **The TTL must comfortably exceed the longest quiz
  window** — set at **30 days** (resolved 2026-09-05, §7). No silent refresh: when it lapses, the
  student just signs in again with Google, one click.
- **Stateless sessions cannot be revoked before expiry.** Role changes are handled by §3.2, but a
  compromised session token stays valid until it expires. Acceptable for this app; the fix (a
  server-side session table) is a schema addition if it ever matters.
- **Cookies require same-origin.** They work because the frontend ships inside the same Worker
  ([[PLAN]] §"Frontend deployment"). If the frontend is ever split to another origin, this becomes a
  CORS and `SameSite` problem.
- **Google is a hard dependency.** If Google Sign-In is down, nobody can log in — including students
  mid-quiz whose session has expired. Another reason the TTL is generous.

## 7. Open questions

None remain — see the 2026-09-05 resolution below.

**Resolved 2026-09-05** (project owner): **session TTL** — 30 days; **silent refresh** — skipped,
re-login on lapse; **demoted mid-admin** — the admin list is fixed and never changes in practice
for this deployment, so the ~60-second KV propagation window in §3.2 is moot; `requireRole` uses
the same KV-cached-role-with-D1-fallback mechanism as `currentUser`, not a separate D1-direct
read, since there's no revocation risk to guard against (COUNCIL_FINDINGS.md #12 — this replaces
an earlier, self-contradicting note that claimed a D1-direct read was already built here; it
wasn't, and isn't needed); if a demoted admin is mid-quiz as a participant, demotion doesn't touch
that at all; **logout cleanup** — confirmed nothing beyond clearing the cookie, since sessions are
stateless (§6) and there's no refresh token to revoke.

## 8. Testing

- **Forged and expired tokens** are rejected; a token signed by the wrong key is rejected.
- **JWKS rotation** — swap the key mid-test and assert one refetch recovers rather than locking out.
- **403 matrix** — a `student` receives 403 on every admin route; an `admin` receives 403 on every
  superadmin route. Table-driven over the full route list, so a new unguarded route fails the suite.
- **Revocation** — demote an admin, then assert their access is refused within KV's ~60-second
  propagation window, with no logout required (AUTH-5 acceptance, as reworded — see §3.2).
- **Bootstrap** runs exactly once and is a no-op on the second run.
- **Signed-out access** — a visitor cannot reach any quiz, bank, or leaderboard route.
