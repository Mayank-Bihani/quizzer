# claude-task--001: Implement quiz creation, ordered units, and locking

**Sprint:** 3  **Slug:** `quiz-creation-units-lock`  **Status:** Draft

This packet implements Phase 3 QUIZZING creation on top of the accepted AUTH guard and BANK contract boundaries. It stops before student play, scheduled room opening, scoring, results, Telegram, and recurring-template materialization.

---

## 1. Context

Quizzer's third backend phase is the first QUIZZING slice: an admin creates a recoverable draft, draws never-used questions as complete RC/LRDI groups plus standalones, previews ordered timed units, configures timing/marks/admission, and locks the result into a scheduled quiz (`PRD.md:103-119`; `PRD.md:263-284`). The current repository has exact schema and TypeScript contracts but only one-line stubs for the pure selector, QUIZZING persistence, routes, and application mounting (`src/core/selection.ts:1`; `src/db/quizzes.ts:1`; `src/routes/quizzes.ts:1`; `src/index.ts:1`).

The ownership boundary is fixed. QUIZZING alone writes `quizzes`, `quiz_units`, and `quiz_questions`; BANK alone writes `questions` and `passages`. QUIZZING obtains eligible content and retires it only through `BankContract.listUnused`, `getByIds`, and `claimUnused` (`MODULES.md:52-78`; `src/core/contracts.ts:25-80`). BANK confirms both newly claimed IDs and requested IDs already owned by the same quiz ID/number while omitting IDs owned by another quiz, which makes a retry after an ambiguous successful claim safe without adding release semantics (`BANK.md:123-144`; `CONTRACTS.md:100-111`).

The draw counts graded questions, not clocks. A complete passage group becomes one `rc` or `lrdi` unit and each standalone becomes one unit. QUIZZING assigns contiguous integer unit, flat-question, and subquestion positions; labels such as `1.2` are derived only for display (`QUIZZING.md:47-56`; `DATA_MODEL.md:27-37`; `src/core/contracts.ts:71-80`). The stored timing policy supplies positive integer seconds for every unit kind in the actual draw, optional per-unit allowances can override it, and `windowSec` is always derived from the final allowances plus transition slack (`QUIZZING.md:58-88`; `DATA_MODEL.md:39-56`).

The six HTTP routes and their direct wire shapes are already fixed: paginated list, create, reshuffle, patch, lock, and cancel. Creation and reshuffle return full authored content for admin preview; lock returns either assigned room identity or an exact short-claim result (`API.md:111-142`; `src/core/api.ts:211-274`). Use the Sprint 1 common admin guard; QUIZZING must not parse sessions or query roles itself (`todos/sprint 1/claude-task--001--google-auth-roles-guards.md:83-88`).

The initial schema is an unapplied baseline and already represents the 100-question cap, nullable draft settings, internal draft number reservation, lifecycle states, admission timestamps, room identity, ordered units, and flat/sub positions (`migrations/0001_init.sql:38-104`; `migrations/0001_init.sql:181-210`). Preserve it and the established contracts. The first valid lock attempt reserves the next positive sequential number on the draft, reuses it across retries, keeps it hidden until successful scheduling, and permits gaps from abandoned reservations. Full BANK confirmation precedes the atomic room-code/scheduled publication; true short claims never schedule and retirement is never released (`PRD.md:103-119`; `QUIZZING.md:68-77`; `DATA_MODEL.md:40-44`).

## 2. Objective

After this packet ships, an authenticated admin can create and recover a quiz draft whose exact question count and difficulty vector are satisfied by complete groups and standalones, preview its stable integer ordering, reshuffle it before lock, and configure valid per-kind/per-unit timing, marks, seat cap, and admission schedule. The server derives all dependent timestamps and duration fields, locks only a completely valid and successfully retired draw, assigns unique human-readable room identity, and supports safe lifecycle cancellation. Every operation uses the fixed wire contracts and module ownership boundaries.

## 3. Assumptions

- Sprint 1 AUTH and the Sprint 2 `BankContract` surface are implemented first. QUIZZING receives an admin guard/current-user helper and an injected BANK facade; it does not duplicate either module (`src/core/contracts.ts:18-23`; `src/core/contracts.ts:63-69`).
- Runtime is TypeScript/Hono on Cloudflare Workers with D1 bound as `DB`. Core selection code has no platform imports, as required for portability (`PLAN.md:47-70`; `PRD.md:247-258`; `wrangler.toml:14-20`).
- All request timestamps are finite integer epoch milliseconds. All values ending in `Sec` are finite integers in seconds and are multiplied by 1,000 only when deriving epoch-millisecond timestamps (`DATA_MODEL.md:39-53`).
- `CreateQuizDraftRequest.difficultyMix` contains only `easy`, `medium`, and `hard` non-negative integer counts whose sum equals `count`; `count` is an integer from 1 through 100. The selector must satisfy that vector exactly across graded questions, including every member of a selected group (`PRD.md:103-109`; `src/core/contracts.ts:4-9`; `src/core/contracts.ts:57-61`; `migrations/0001_init.sql:62-69`).
- `BankContract.listUnused` supplies the eligible unused candidate pool and only complete four-to-five-question groups; QUIZZING still validates the returned grouping/section/order before composing or locking a draft (`BANK.md:25-36`; `BANK.md:146-153`; `QUIZZING.md:47-62`).
- Group kind derives only from section: grouped `verbal` is `rc`; grouped `quant` or `lr` is `lrdi`; a standalone has no passage and sub-position 1 (`src/core/contracts.ts:25-31`; `QUIZZING.md:53-56`).
- Draft IDs remain server-generated opaque strings. Admin path IDs are bounded, non-empty opaque strings; no UUID syntax is inferred from `TEXT` schema columns (`migrations/0001_init.sql:62-85`).
- A create or reshuffle performs a fresh randomized selection over the current eligible pool, with random generation injected into the pure selector so tests are deterministic. Random selection may coincidentally return the same composition or order; the API promises a redraw, not a visibly different result.
- Room codes use one centralized, documented, section-prefixed, human-readable format with cryptographically random symbols and bounded uniqueness retries. The exact alphabet/length is an implementation constant, not a client-selected field; the database uniqueness constraint is authoritative (`PRD.md:113-115`; `migrations/0001_init.sql:63-80`; `src/core/config.ts:1`).
- Quiz numbers are positive and sequentially allocated, but need not be contiguous. On the first valid lock attempt, atomically reserve the next number on the still-`draft` row before calling BANK. Reuse that stored number on every retry; abandonment, cancellation, or a true short claim may leave a permanent gap (`PRD.md:111-115`; `QUIZZING.md:68-77`; `DATA_MODEL.md:40-44`; `migrations/0001_init.sql:62-80`).
- A reserved number is internal while `room_code IS NULL`: `QuizAdminSummary.quizNumber` must serialize as `null` for that draft or a cancellation before successful scheduling, even though D1 contains the reservation. Once room code and scheduled state were successfully published, later scheduled/cancelled summaries retain the visible number and room code (`API.md:136-142`; `src/core/api.ts:67-92`; `src/core/api.ts:251-256`).
- No dependency is added for selection. Use an injected shuffle source plus a dynamic-programming/backtracking search whose remaining-difficulty state is pruned to the target vector and total cap of 100. Candidate traversal is linear in the eligible BANK input; selected membership, response content, and D1 child writes can never exceed 100 graded questions.
- Shared pagination is fixed: omitted values mean `limit=50`, `offset=0`; accept only integer `limit` from 1 through 100 and non-negative integer `offset`; malformed, fractional, or out-of-range values return 400 without clamping; `total` is the full filtered count (`API.md:24-44`; `src/core/api.ts:35-53`).

## 4. Out of Scope

- **Student join, seats, active-unit delivery, clocks, batch submission, scoring, and resume:** these are Phase 4 and depend on the locked creation records produced here (`PRD.md:274-276`; `QUIZZING.md:93-175`).
- **Room preparation/opening and safe close:** `openRoom`/`closeQuiz` and cron/lazy orchestration land in later QUIZZING/SCHEDULER phases; this packet stops at `status='scheduled'` (`src/core/contracts.ts:138-147`; `MODULES.md:199-208`).
- **Results, review, ranking, reports, and weekly boards:** they do not participate in creation and land in Phases 5, 7, and 8 (`PRD.md:275-279`).
- **Recurring template CRUD or materialization:** QUIZ-7's unattended recurrence belongs to Phase 7; this packet neither exposes template routes nor writes `quiz_templates` (`QUIZZING.md:87-91`; `PRD.md:278-279`).
- **Question/passages CRUD, imports, images, or BANK policy resolution:** Sprint 2 owns these surfaces. This packet consumes only the accepted `BankContract` (`MODULES.md:14-18`; `CONTRACTS.md:72-106`).
- **Cross-admin distributed transactions, automatic claim release, or content recycling:** the accepted single-admin scope keeps retirement one-way and exposes a short claim instead (`QUIZZING.md:71-78`; `src/core/contracts.ts:63-68`).
- **Speed bonuses, scoring grace, or editable `windowSec`:** V1 contains none of these; the duration is derived and speed bonus is reserved for V2 (`PRD.md:112-117`; `PRD.md:303-308`).
- **Frontend and mockup changes:** the backend is verified before frontend integration, and current mockups do not govern timing/navigation behavior (`PLAN.md:72-77`; `QUIZZING.md:277-282`).
- **Telegram announcements:** this packet may produce records later consumed by announcements, but it sends no messages and writes no `telegram_posts` rows (`MODULES.md:52-64`).

## 5. Open Questions

(none)

The project owner resolved lock reservation/retry semantics, the shared pagination policy, and the 100-graded-question cap in the current authoritative documents (`PRD.md:103-116`; `API.md:24-44`; `QUIZZING.md:60-77`; `DATA_MODEL.md:27-44`). No Phase 3 product or production decision remains open.

## 6. Pre-flight Checklist

- [ ] Required skill loaded: **`clean-code`** — always required; separate pure selection, lifecycle orchestration, persistence, and HTTP parsing.
- [ ] Required skill loaded: **`prod-safety-gate`** — lock permanently retires bank content and changes the production admission lifecycle.
- [ ] Required skill loaded: **`test-driven-development`** — whole-group selection, derived fields, lifecycle transitions, and lock failure behavior are new observable behavior.
- [ ] Required skill loaded: **`vibesec`** — admin HTTP input, identifiers, pagination, stored JSON, and authorization require runtime validation and bounded work.
- [ ] Confirm Sprint 1 AUTH and Sprint 2 BANK implementations and their tests pass. Do not compensate for an unfinished prerequisite by duplicating its code.
- [ ] Confirm the working tree is clean, or record a baseline that isolates this packet's implementation from unrelated changes.
- [ ] Confirm the branch is current with the repository trunk before editing.
- [ ] Apply the existing initial migration to isolated local/test D1; do not edit it (`package.json:6-14`; `migrations/0001_init.sql:38-104`; `migrations/0001_init.sql:181-210`).
- [ ] Confirm the existing test harness can inject an isolated D1 database, a fake `BankContract`, deterministic randomness, and an accepted admin identity. Extend shared helpers instead of creating a second Worker bootstrap.
- [ ] Read before editing: `PRD.md:103-119`, `PRD.md:263-299`, `PLAN.md:79-94`, `PLAN.md:185-208`, `PLAN.md:251-271`, `MODULES.md:23-108`, `DATA_MODEL.md:27-56`, `CONTRACTS.md:72-106`, `API.md:109-142`, `QUIZZING.md:36-91`, `QUIZZING.md:253-287`, `src/core/contracts.ts:25-80`, `src/core/api.ts:211-274`, and `migrations/0001_init.sql:38-104`, `migrations/0001_init.sql:181-210`.
- [ ] Re-read AC-1 through AC-17 and distinguish implementer verification from AC-OPERATOR. Draw the reserve → claim/confirm → publish lock sequence before writing production code and identify every crash/response-loss boundary.

## 7. Acceptance Criteria

1. **AC-1 — Validate exact creation input.** `POST /api/admin/quizzes` accepts only `CreateQuizDraftRequest`; reject unknown keys, a blank title, non-finite or non-integer `scheduledAt`, a `count` outside integer 1..100, unknown difficulty keys, negative/fractional difficulty counts, or a difficulty sum different from `count` with `400 {message}` and no BANK/D1 write (`PRD.md:103-109`; `API.md:12-23`; `src/core/api.ts:229-240`; `src/core/contracts.ts:57-61`). Use the application's ordinary bounded request-body parsing; do not invent a product title-length rule in this packet.
2. **AC-2 — Draw exact whole-unit composition.** Call `BankContract.listUnused` with the validated filters and select an exact difficulty vector totaling the requested graded count. Treat every eligible passage group as one indivisible candidate and each standalone as one candidate. Never duplicate an ID, split a group, mix sections, include an invalid group, or silently reuse/relax the mix. Return 409 with no draft write when supply exists but no exact whole-unit composition does, or when the unused pool is insufficient (`PRD.md:107-119`; `QUIZZING.md:47-62`; `src/core/contracts.ts:57-69`).
3. **AC-3 — Keep selection pure, bounded, and testable.** `src/core/selection.ts` has no Worker, Hono, D1, KV, R2, global-clock, or global-random dependency. It accepts candidate content plus an injected ordering/random source; prunes remaining easy/medium/hard states to the requested vector and 100-question cap; and never returns more than 100 questions. Property tests over mixed standalone/four/five-member groups prove every successful draw is exact and every reported impossibility has no valid whole-unit solution within the generated case (`PRD.md:247-258`; `DATA_MODEL.md:27-38`; `src/core/selection.ts:1`; `QUIZZING.md:289-292`).
4. **AC-4 — Construct canonical ordered units.** A selected grouped verbal candidate becomes `rc`; grouped quant/lr becomes `lrdi`; a standalone becomes `standalone`. Assign contiguous one-based `unitPosition`; assign contiguous one-based flat `position` across unit order; preserve grouped questions in BANK `groupPosition` order and assign contiguous `subPosition`; standalone sub-position is 1. Persist no decimal labels or string positions. `questionCount` equals graded items and `unitCount` equals clocks (`QUIZZING.md:47-56`; `DATA_MODEL.md:27-37`; `migrations/0001_init.sql:185-210`).
5. **AC-5 — Persist a recoverable draft atomically.** After selection, insert one generated-ID `quizzes` row with `status='draft'`, title, section, requested count/mix, scheduled time, derived `lobby_opens_at`, creator, and epoch-millisecond creation time plus all `quiz_units` and `quiz_questions` rows in one D1 transaction/batch. Initial unit allowances are null. Quiz number, room code, admission end, marks, and derived working window remain null until their inputs/lock step exist. Any failed child write leaves no quiz or membership rows (`QUIZZING.md:85-90`; `migrations/0001_init.sql:62-99`; `migrations/0001_init.sql:185-210`; `src/core/api.ts:224-240`).
6. **AC-6 — Return exact admin preview shapes.** Create returns the direct `CreateQuizDraftResponse`; questions are ordered by flat position and contain full `QuestionFull` admin content, while units contain exact `QuizUnitDefinition` values. Never add an envelope, internal snake_case columns, creator metadata, retirement fields, or student-redacted `ServedQuestion` shapes (`API.md:12-16`; `API.md:128-134`; `src/core/api.ts:231-238`).
7. **AC-7 — List recoverable quizzes consistently and hide reservations.** `GET /api/admin/quizzes` validates optional status; defaults to `limit=50, offset=0`; accepts only integer limit 1..100 and non-negative integer offset; returns 400 without clamping otherwise; applies a stable newest-first ordering with ID as the final tie-break; and returns the full filtered `total` plus ordered unit definitions without an N+1 query. Every `QuizAdminSummary` maps a reserved database number to `quizNumber:null` while `room_code` is null; a number and room code become visible only after successful scheduled publication and remain visible if that scheduled quiz is later cancelled (`API.md:24-44`; `API.md:119-142`; `src/core/api.ts:67-92`; `src/core/api.ts:221-222`).
8. **AC-8 — Reshuffle only an unlocked draft.** `POST /api/admin/quizzes/:id/reshuffle` returns 404 for an unknown opaque ID and 409 unless status is `draft`. Perform a fresh randomized draw from the current unused pool using the stored selection filters; preserve title, schedule, settings, and any internally reserved quiz number; atomically replace unit/question membership; discard every old per-unit override; and reapply the stored timing policy to the new unit kinds. A coincidentally identical composition/order is valid. Content already retired during an earlier short claim is never released and will be absent from the unused pool; a later lock still reuses the same hidden reservation. Return the exact response, including recomputed `unitCount` and nullable derived `windowSec`; a failure leaves the prior draft unchanged (`PRD.md:111-115`; `QUIZZING.md:58-83`; `src/core/api.ts:242-249`).
9. **AC-9 — Patch only allowlisted settings and lifecycle states.** `PATCH /api/admin/quizzes/:id` rejects an empty body, unknown keys, nulls, malformed arrays, duplicate/unknown unit positions, non-positive/fractional unit allowances or join window, negative/fractional slack, non-finite marks, `marksCorrect <= 0`, `marksWrong > 0`, and seat caps outside integer 1..120. It returns 404 when absent and 409 unless status is `draft` or `scheduled`. All validation precedes mutation, and the response is exact `QuizAdminSummary` (`API.md:119-142`; `src/core/api.ts:255-274`).
10. **AC-10 — Apply timing policy and overrides exactly.** When `timingPolicy` is present, require a positive integer value for every kind in the current draw, replace the stored policy, reset every unit to its kind default, then apply request `unitTimeLimits`. When only `unitTimeLimits` is present, change only the listed units. A reshuffle always discards overrides and reapplies defaults from the stored policy. Missing policies for used kinds or repeated/unknown positions fail before writes (`QUIZZING.md:64-77`; `src/core/contracts.ts:71-80`; `src/core/api.ts:255-270`).
11. **AC-11 — Derive duration and admission fields on every relevant write.** Never accept `windowSec`, `endsAt`, or `lobbyOpensAt` from a client. Set `lobbyOpensAt = scheduledAt - 300000`; when `joinWindowSec` exists set `endsAt = scheduledAt + joinWindowSec*1000`; set `windowSec = SUM(quiz_units.time_limit_sec) + slackSec` only when every current unit allowance and slack are present, otherwise keep it null in a draft. Recompute after schedule, admission, policy, allowance, slack, or reshuffle changes, without coupling admission length to working duration (`QUIZZING.md:80-91`; `DATA_MODEL.md:39-56`; `migrations/0001_init.sql:58-99`).
12. **AC-12 — Validate the complete lock snapshot.** Lock is legal only from `draft`. Before any retirement, re-read the quiz and membership, obtain fresh BANK content through its contract, and verify exact stored count/mix/section, unique IDs, contiguous unit/flat/sub positions, one question per standalone, full four-to-five-member passage groups in BANK order, matching passage IDs/kinds, a complete positive timing policy, positive unit allowances, non-negative integer slack, positive integer admission length, finite positive correct marks, finite non-positive wrong marks, and seat cap 1..120. Any failure returns 400/409 as appropriate without calling `claimUnused` (`QUIZZING.md:58-72`; `DATA_MODEL.md:27-56`; `migrations/0001_init.sql:62-99`; `migrations/0001_init.sql:185-210`).
13. **AC-13 — Reserve stable identity, then retire idempotently through BANK.** After AC-12 validation and before BANK, atomically/conditionally reserve on the still-`draft` row either its existing `quiz_number` or `COALESCE(MAX(quiz_number), 0) + 1`. A first attempt persists that next positive sequential allocation; every retry reuses it. Unique-allocation conflicts retry within a named bound. The row remains `draft`, `room_code` remains null, and all API summaries hide the reservation. Pass the complete ordered question-ID set with that stable quiz ID/number to `BankContract.claimUnused`. Treat requested IDs newly claimed or already owned by that exact pair as confirmed; omit other-owned IDs. If confirmation is short, return `{locked:false,requestedCount,claimedCount}`, keep the draft and reservation, never schedule/substitute/release, and accept that abandonment or cancellation leaves a sequence gap (`PRD.md:111-115`; `QUIZZING.md:68-77`; `BANK.md:123-144`; `src/core/contracts.ts:63-69`; `src/core/api.ts:251-256`).
14. **AC-14 — Assign room identity and publish scheduled state only after full confirmation.** After all requested IDs are confirmed, generate a unique human-readable section-prefixed room code and atomically/conditionally set `room_code` plus `status='scheduled'` on the same still-`draft` row carrying the reserved number; all complete derived/settings fields must already satisfy the lifecycle check. Room-code collisions retry within a named bound without changing the reserved number. If BANK committed but this publication did not, a retry reuses the number and BANK confirms the same-owned IDs, then retries publication. If publication committed but the HTTP response was lost, a repeat lock receives the documented 409 already-locked response and the admin recovers the now-visible room code/number through the list endpoint. A successful first/publication retry response is exactly `{locked:true,roomCode,quizNumber}`. Never claim cross-module atomicity (`PRD.md:111-115`; `QUIZZING.md:71-77`; `API.md:119-142`; `migrations/0001_init.sql:62-99`; `src/core/api.ts:251-256`).
15. **AC-15 — Cancel without recycling.** `POST /api/admin/quizzes/:id/cancel` returns 404 when absent, 409 for `ended` or already `cancelled`, and atomically changes `draft`, `scheduled`, or `open` to `cancelled`. Return exact `QuizAdminSummary`. Never clear BANK retirement fields, delete composition, or add a release call. Cancellation after a number-only reservation preserves the D1 number as an accepted gap but returns `quizNumber:null`/`roomCode:null`; cancellation after successful scheduling preserves and exposes its existing identity. Cancelling an unclaimed draft leaves candidates unused because they were never retired (`PRD.md:111-115`; `QUIZZING.md:38-45`; `DATA_MODEL.md:40-44`; `src/core/api.ts:67-92`; `src/core/api.ts:275-276`).
16. **AC-16 — Enforce admin access and ownership.** All six routes use the shared Sprint 1 `requireRole('admin')` behavior: admins and superadmins are admitted; missing auth returns 401 and students return 403. QUIZZING neither parses cookies nor reads/writes `users`, BANK tables, runtime/result/board tables, Telegram rows, R2, or KV. `migrations/0001_init.sql`, `src/core/contracts.ts`, and `src/core/api.ts` remain byte-for-byte unchanged (`MODULES.md:52-94`; `todos/sprint 1/claude-task--001--google-auth-roles-guards.md:83-88`).
17. **AC-17 — Prove creation behavior test-first.** Before production code, add failing tests for 1/100/101 count boundaries, exact mixed-unit draws, impossible vectors, randomized reshuffle, integer ordering, atomic draft replacement, policy/override precedence, every derived field, 50/0 pagination defaults and all 1..100/invalid boundaries, all lifecycle/status paths, full lock validation, durable/hidden reservation, sequence gaps, same-owner claim confirmation, true short claims, every pre/post-reservation/claim/publication crash and response-loss boundary, unique room/number collisions, cancellation visibility, exact DTO allowlists, and the 401/403 matrix. Watch each focused test fail for the intended missing behavior before implementing the minimum passing code (`QUIZZING.md:289-292`).
18. **AC-OPERATOR — Smoke-test creation against provisioned prerequisites.** After AUTH, BANK, and the initial D1 schema are deployed, an operator signs in as an admin; verifies omitted pagination reports 50/0; creates and reshuffles one mixed-unit draft from non-production fixture content; confirms its pre-lock responses contain no room code/quiz number; patches every settings class; locks it once; verifies the now-visible identity, admission fields, and derived duration; confirms the retired BANK rows carry the same quiz ID/number; and cancels it. Record only opaque IDs/counts/statuses; do not copy session cookies or question solutions into deployment logs (`API.md:24-44`; `API.md:136-142`; `wrangler.toml:14-30`; `QUIZZING.md:58-90`).

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not edit `migrations/0001_init.sql`, `src/core/contracts.ts`, or `src/core/api.ts`; do not add schema columns, request fields, response envelopes, or route aliases.
- Do not read or write `questions`/`passages` directly. Use only the injected `BankContract`; never import BANK persistence internals into QUIZZING.
- Do not claim that BANK retirement and QUIZZING scheduling are one atomic D1 operation. They cross module/service boundaries and the current contract exposes neither a shared transaction nor release.
- Do not clear, overwrite, or release retired content on short claim, cancellation, exception, rollback, or operator convenience.
- Do not reserve or retire content at draft creation or reshuffle. Retirement occurs only during lock.
- Do not split a passage group, pad an impossible draw, relax difficulty counts, reduce requested count, substitute used questions, or silently retry with a different composition during lock.
- Do not store display labels such as `1.2`; database IDs and all ordering fields remain strings/integers as established.
- Do not accept or persist a direct `windowSec`, `endsAt`, `lobbyOpensAt`, speed bonus, grace, per-question time, or timing field on BANK content.
- Do not assign a quiz number at draft creation. Reserve it only on the first valid lock attempt; do not replace it on retry or expose it while `room_code` is null. Do not assign a room code before full BANK confirmation, recycle number gaps, clear identity on cancellation, or derive authorization from a room code.
- Do not use `Math.random()` inside core selection or make tests depend on global candidate/database ordering. Inject randomized ordering and use explicit stable tie-breaks.
- Do not interpolate status, ordering, JSON, pagination, IDs, or request values into SQL. Bind values and select sort/filter branches from fixed allowlists.
- Do not implement student play, seats, `openRoom`, `closeQuiz`, result routes, board logic, template materialization, Telegram, frontend, mockups, or observability in this packet.
- Do not edit Sprint 1/Sprint 2 packets, product documents, fixtures, or the progress tracker.

### 8b. Coding / quality principles

- **`clean-code`:** keep route handlers to guard/parse/invoke/respond. Put pure exact-vector selection and unit construction in `src/core/selection.ts`, QUIZZING SQL/mappers in `src/db/quizzes.ts`, and cross-module lifecycle sequencing in one small creation service. Use explicit result unions, named bounds, early returns, and functions whose names describe lifecycle predicates.
- **`prod-safety-gate`:** the dangerous surface is lock: a stable reserved number reaches BANK before permanent retirement while scheduled publication remains separate. Implement reserve → claim/confirm → publish as an explicit state machine, test every failure boundary, keep short claims visible, and never report success until the scheduled row is committed.
- **`vibesec`:** parse JSON/query/path input against exact allowlists; reject unknown properties and non-finite/fractional values; enforce count 1..100 and pagination limits, bound candidate state, ID, request body, and collision retries; use parameterized SQL; expose only generic `{message}` errors; never log full question content, solutions, or session data.
- **`test-driven-development`:** begin with selection properties and the complete lock crash/retry matrix, then route/lifecycle cases. Use a real isolated migrated D1 database for atomic persistence and fake only the BANK boundary/random source where controlled outcomes are required.
- Treat `src/core/contracts.ts` and `src/core/api.ts` as compile-time contracts and runtime serialization allowlists. TypeScript structural typing does not remove extra row fields; construct every response field by field.
- Normalize and serialize stored `difficulty_mix` and `timing_policy` deterministically. On read, reject corrupt JSON as an internal invariant failure; do not silently coerce it into defaults.
- Use one database transaction/batch for each QUIZZING-only aggregate mutation: draft+membership creation, reshuffle membership replacement, settings+derived values, final schedule publication, or cancel. Check conditional row counts before dependent writes; a zero-row predicate is a lifecycle conflict.
- Preserve grouped BANK order before assigning sub-positions. Load page/list unit rows in bounded batches and map them without N+1 queries.
- Return generic errors to clients while emitting safe diagnostic categories and opaque quiz IDs through the existing application error mechanism. Never log question bodies, answers, full BANK payloads, or auth credentials.

## 9. Behavior Spec (per file)

### `src/core/config.ts`

- **Current state (line 1):** the stub reserves shared V1 constants, including seat cap and room-code format (`src/core/config.ts:1`). Earlier phases may already have replaced it with typed bindings and BANK constants.
- **Required edit:** merge, without replacing earlier constants, named QUIZZING creation bounds: maximum seat cap 120, maximum graded-question count 100, room-code prefix/alphabet/length and collision retries, quiz-number allocation retries, selector state bounds derived from 100, and the shared `limit=50`/maximum 100 pagination constants if they are not already defined once.
- **Estimated diff:** ~15 LOC.
- **Subtleties:** use unit-bearing names. Do not define a second pagination policy or alter AUTH/BANK settings. Configuration bounds must not masquerade as vendor guarantees.

### `src/core/selection.ts`

- **Current state (line 1):** the stub assigns pure whole-group selection and `QuizUnitDefinition` construction here (`src/core/selection.ts:1`).
- **Required edit:** define internal candidate/result/failure types; validate and group `QuestionFull` candidates; derive unit kind; freshly randomize through an injected source for every create/reshuffle call; solve the exact three-difficulty vector with dynamic programming/backtracking pruned to the request vector and 100-question maximum; order selected units/questions; and return canonical unit definitions plus ordered question IDs/content.
- **Estimated diff:** ~95 LOC across short validation, search, and ordering helpers.
- **Subtleties:** one group can contribute multiple difficulty values, so selection cannot choose each difficulty independently. Key search states by the three remaining counts, never mutate caller arrays, reject duplicate IDs/group positions, preserve BANK group order, and distinguish insufficient total supply from an impossible exact group combination only internally; both map to the public 409.

### `src/db/quizzes.ts`

- **Current state (line 1):** the stub owns QUIZZING creation persistence, composition, derived duration, lifecycle, cancellation, and later materialization (`src/db/quizzes.ts:1`).
- **Required edit:** implement a creation-focused repository for atomic draft insertion, draft/settings reads, fixed-policy paginated list+full filtered count, batched ordered unit loading, atomic reshuffle replacement, atomic settings/derived updates, lock snapshot reads, conditional next-number reservation on a draft, atomic room-code/scheduled publication, bounded uniqueness handling, hidden-reservation response mapping, and conditional cancellation. Add explicit snake_case-to-contract mappers.
- **Estimated diff:** ~100 LOC per cohesive repository component; split adjacent QUIZZING-owned persistence helpers if one file would substantially exceed this.
- **Subtleties:** D1 batches do not make calls through `BankContract` atomic. Keep the cross-module call outside repository transactions. Reserve with one conditional statement on `status='draft' AND quiz_number IS NULL`, recover the stored number if another attempt already reserved it, and retry a uniqueness collision without replacing an existing reservation. Hide `quiz_number` whenever `room_code` is null. Check every conditional update result before dependent writes, delete child `quiz_questions` before `quiz_units` during reshuffle, insert units before questions, bind every value, and load units for list pages without N+1 queries.

### `src/services/quiz-creation.ts` (new)

- **Current state:** no creation use-case layer exists; routes and persistence are both one-line stubs (`src/routes/quizzes.ts:1`; `src/db/quizzes.ts:1`).
- **Required edit:** coordinate validated create/list/reshuffle/patch/lock/cancel use cases across the pure selector, QUIZZING repository, injected `BankContract`, current admin identity, injected clock, and injected cryptographic room-code source. Implement the exact reserve-number → idempotent BANK confirm → room-code/scheduled publication state machine and map domain failures into typed route outcomes.
- **Estimated diff:** ~90 LOC.
- **Subtleties:** validate and snapshot before reserving. On each lock request, obtain/reuse the durable number, call `claimUnused` with the same quiz pair, compare a deduplicated confirmed-ID set with the complete request, and publish only on full confirmation. A D1 failure before reservation leaves no number; after reservation leaves the reusable hidden number; after BANK leaves same-owner claims recoverable; after publication leaves a visible scheduled quiz whose repeated lock returns 409. Never hide a short claim behind a redraw or claim cross-module atomicity. Keep HTTP types and Hono context out of this service.

### `src/routes/quizzes.ts`

- **Current state (line 1):** the stub lists the six admin creation routes and prohibits direct duration/bonus settings or edits after open (`src/routes/quizzes.ts:1`).
- **Required edit:** export the Hono sub-app/handlers for list, create, reshuffle, patch, lock, and cancel; strictly parse query/path/JSON inputs; obtain `CurrentUser` from the accepted AUTH helper; invoke creation use cases; serialize the exact API response unions; and map invalid/not-found/lifecycle/pool/late-claim outcomes to generic 400/404/409 errors or the specified 200 lock union.
- **Estimated diff:** ~90 LOC.
- **Subtleties:** `lock` short claim is a successful typed response, not an invented partial-status body. A lock retry after completed publication is the documented 409; the list route is the recovery surface for visible identity. Treat IDs as bounded opaque strings, reject unknown JSON keys, and never expose a hidden reservation or internal recovery metadata.

### `src/index.ts`

- **Current state (line 1):** the entrypoint stub owns Hono mounting and later scheduler orchestration (`src/index.ts:1`); Sprint 1/2 are expected to establish the application, shared errors, AUTH, and BANK routes first.
- **Required edit:** mount the QUIZZING creation sub-app at `/api/admin/quizzes` under the shared `requireRole('admin')` boundary, preserving earlier mounts and the scheduled-handler seam.
- **Estimated diff:** ~8 LOC.
- **Subtleties:** verify all six methods inherit the guard once and no public alias bypasses it. Do not add play/results/template/scheduler handlers.

### `tests/selection.test.ts` (new)

- **Current state:** no executable selection tests exist; current selection behavior is only the pure-logic stub and design verification requirement (`src/core/selection.ts:1`; `QUIZZING.md:284-287`).
- **Required edit:** table/property-test exact counts and difficulty vectors across standalones and mixed four/five-member groups, group atomicity/order, unit kinds/positions, duplicate/malformed candidate rejection, impossible combinations, count 1/100/101, deterministic injected random order, repeated fresh reshuffle calls, and permitted coincidental identical output.
- **Estimated diff:** ~100 LOC plus compact generators/fixtures.
- **Subtleties:** use an independent brute-force oracle for small generated candidate sets rather than restating the production algorithm. Assert input immutability and core's absence of platform imports.

### `tests/quiz-creation.test.ts` (new)

- **Current state:** no QUIZZING creation persistence/service tests exist; the authoritative DDL and interfaces are definitions only (`migrations/0001_init.sql:38-104`; `migrations/0001_init.sql:181-210`; `src/core/api.ts:211-274`).
- **Required edit:** against isolated migrated D1 with a controlled fake `BankContract`, test atomic create/reshuffle/settings mutations; exact response mapping; policy/override precedence; derived fields; exact pagination; lock validation; first-attempt number reservation; hidden summary mapping; gaps; same-owner retry confirmation; true short claims; every reserve/claim/publish success, failure, and response-loss boundary; room/number collisions; and cancel transitions/no release.
- **Estimated diff:** ~100 LOC per cohesive test file; split lock-state tests from repository tests if needed.
- **Subtleties:** force failures immediately before/after every cross-module boundary and D1 publication step. Assert both the QUIZZING rows and recorded BANK calls, including that pre-validation failures never call claim and cancellation never calls release.

### `tests/quizzes.routes.test.ts` (new)

- **Current state:** the six route shapes exist only in source types and narrative tables (`API.md:111-142`; `src/routes/quizzes.ts:1`).
- **Required edit:** exercise the mounted Worker for all six endpoints: 401/403/admin/superadmin matrix, exact JSON/query validation, opaque IDs, 400/404/409 mapping, direct success payloads, pagination defaults/boundaries, 100-question cap, draft/reservation recovery, hidden versus visible identity, full/short lock unions, and exact response allowlists.
- **Estimated diff:** ~95 LOC.
- **Subtleties:** send extra and wrong-typed fields deliberately. Inspect raw JSON to ensure no snake_case, answer leakage beyond the allowed admin `QuestionFull`, internal claim diagnostics, stack text, or response envelope appears.

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Lock retires BANK content but fails before QUIZZING publishes `scheduled` | Med | High | AC-13/14 reuse the durable reservation and BANK same-owner confirmation; crash-boundary tests and rollback preserve recovery. |
| Whole-group selection reports exhaustion despite a valid exact vector | Med | High | AC-2/3 dynamic-state search plus property tests against a brute-force oracle. |
| Selection splits a group or miscounts a mixed-difficulty group | Med | High | AC-2/4 candidate vectors, complete-group validation, and mixed-group fixtures. |
| Draft/reshuffle partially replaces membership | Low | High | AC-5/8 QUIZZING-only atomic batches and forced-child-write failure tests. |
| Policy update leaves stale overrides or incorrect `windowSec` | Med | High | AC-10/11 precedence matrix and persisted-derived-field assertions. |
| Admission cutoff changes when unit timing changes | Low | High | Independent formulas in AC-11 and tests changing each input separately. |
| Concurrent/retried lock assigns duplicate quiz numbers or replaces a reservation | Low | High | AC-13 conditional reservation, uniqueness constraint, stored-number recovery, bounded retries, and permitted sequence gaps. |
| Room identity leaks before full retirement/scheduled publication | Low | High | AC-7/13/14 map reserved drafts to null and assign room code only in the scheduled-state commit. |
| List endpoint scans or returns an unbounded collection | Med | Med | Fixed 50/100 pagination policy, bound SQL parameters, full filtered total, and page-boundary tests. |
| An oversized quiz exhausts selector state, response memory, or D1 child writes | Med | High | Schema and AC-1/3 enforce 100 graded questions with exact 1/100/101 tests. |
| Admin input injects SQL or corrupt JSON/NaN values enter storage | Low | High | Strict runtime allowlists, finite/integer checks, parameterized SQL, and hostile route cases. |
| A student reaches an admin creation handler | Low | High | AC-16 shared route-group guard and mounted 401/403 matrix. |
| Cancellation accidentally releases content or deletes composition | Low | High | AC-15, no BANK release surface, and before/after retirement assertions. |
| Sprint 3 bypasses or weakens BANK's same-owner claim semantics | Low | High | Interface-only dependency, exact confirmed-ID comparison, and Hard NO on BANK internals. |
| Lint/type drift or test isolation hides failures | Med | Med | Focused tests, clean isolated D1 per case, `npm run typecheck`, then full `npm test`. |
| Later run/SCHEDULER consumers receive incomplete scheduled rows | Low | High | AC-12/14 full lock validation and schema lifecycle checks (`migrations/0001_init.sql:89-99`). |
| Product/contract documents drift from implementation | Low | Med | Protected-file byte checks and exact DTO/lifecycle assertions in AC-16/17. |

## 11. Rollback / Revert Plan

1. Stop new creation mutations by routing the six admin endpoints to a temporary maintenance response or rolling traffic back before any data repair. Existing scheduled quizzes must be inventoried first because cancellation/retirement is deliberately one-way (`QUIZZING.md:38-45`; `DATA_MODEL.md:52-56`).
2. Record affected quiz IDs, statuses, raw reserved quiz numbers, room codes, selected question IDs, and whether each BANK claim occurred. Distinguish hidden number-only reservations from successfully published identities; do not record question solutions or session credentials.
3. Run `git revert <sha>` for the Sprint 3 implementation and deploy the rebuilt prior Worker. Keep Sprint 1 AUTH, Sprint 2 BANK, and the initial schema in place; this packet adds no migration (`migrations/0001_init.sql:38-104`; `migrations/0001_init.sql:181-210`).
4. Restart/redeploy the Worker so the prior route graph is active. No KV/R2 clear is required because creation writes neither surface (`MODULES.md:81-94`; `QUIZZING.md:253-265`).
5. Preserve all existing QUIZZING and BANK rows by default. For a never-claimed draft with no reserved number, a reviewed forward repair may delete the draft's `quiz_questions`, then `quiz_units`, then `quizzes` row. For a number-only reservation, preserving or cancelling the draft preserves an accepted hidden gap; deletion also leaves the number un-reused. Never delete a quiz with participants or an opened/ended status.
6. For a fully or ambiguously claimed draft, re-run or manually reproduce the approved protocol with the same stored quiz ID/number: ask BANK to confirm the complete selected ID set, and only on full confirmation assign a unique room code and atomically publish `scheduled`. For a true short claim, leave or cancel the draft with its hidden reservation. Never clear `questions.used_in_quiz_id`, `questions.used_in_quiz_number`, or `passages.used_in_quiz_id`; retirement and sequence gaps are permanent by design (`PRD.md:111-115`; `QUIZZING.md:71-77`; `migrations/0001_init.sql:153-179`).
7. Verify rollback with the admin list route if it remains available, otherwise through reviewed read-only D1 queries: a reserved row with no room code must not expose its number through API output; every scheduled row must satisfy the non-null lifecycle invariant; published room codes/numbers are unique; and gaps are not repaired or reused. Confirm pre-existing AUTH/BANK routes still work (`API.md:136-142`; `migrations/0001_init.sql:62-104`).
8. Notify the project owner through the private deployment/incident channel with affected opaque quiz IDs, claim state, chosen forward repair, and verification result. Never use the student Telegram group for internal failure details.

## 12. Verification + Definition of Done

### 12a. Automated verification

```bash
npm ci
npm run typecheck
npm test -- tests/selection.test.ts
npm test -- tests/quiz-creation.test.ts
npm test -- tests/quizzes.routes.test.ts
npm test

git diff --exit-code -- migrations/0001_init.sql src/core/contracts.ts src/core/api.ts
git diff --exit-code -- PRD.md PLAN.md MODULES.md DATA_MODEL.md CONTRACTS.md API.md QUIZZING.md
git diff --exit-code -- src/routes/auth.ts src/routes/admins.ts src/routes/bank.ts src/routes/images.ts
git diff --exit-code -- src/routes/play.ts src/routes/results.ts src/routes/boards.ts src/routes/reports.ts
git diff --exit-code -- src/db/users.ts src/db/bank.ts src/db/play.ts src/db/results.ts src/db/boards.ts

! rg -n "timePerQSec|graceSec|maxSpeedBonus|speedBonus|baseMarks" \
  src/core/selection.ts src/db/quizzes.ts src/services/quiz-creation.ts src/routes/quizzes.ts
! rg -n "from ['\"]\.\.?/db/bank|questions\s+SET|passages\s+SET" \
  src/core/selection.ts src/db/quizzes.ts src/services/quiz-creation.ts src/routes/quizzes.ts
```

All commands must succeed. The protected-file `git diff` commands must produce no diff, and the two negated `rg` assertions must find no matches. If earlier phases place shared test helpers/configuration elsewhere, review only the Sprint 3 diff rather than reverting prerequisite work.

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | Exact mixed draw | Seed unused standalones plus one verbal and one quant/lr four/five-member group with varied difficulties; create matching quizzes. | Each response exactly meets count/mix, includes whole groups, separates question/unit counts, and uses contiguous integer positions. | Not Run |
| BE-2 | Impossible draw | Request a count/mix that has enough raw questions but no valid whole-group combination. | 409 generic error; no quiz/unit/question row is written and no content is retired. | Not Run |
| BE-3 | Draft recovery/list | Create several statuses; omit pagination; then try limits 1/100/101, fractional/malformed values, negative offset, and status filters. Include a raw D1 draft reservation with no room code and a later cancelled scheduled quiz. | Defaults are 50/0; valid pages return full filtered total and ordered units; invalid values return 400 without clamping; hidden reservation serializes null while previously published identity remains visible after cancellation. | Not Run |
| BE-4 | Reshuffle | Configure policy/overrides, reshuffle an unlocked draft twice with controlled randomness (including a case producing the same output), then attempt after lock. | Each call performs a fresh draw; coincidental identical output is accepted; overrides are discarded, defaults reapplied, duration recomputed; locked attempt is 409 and unchanged. | Not Run |
| BE-5 | Patch matrix | Patch schedule, admission, each timing kind, unit overrides, slack, marks, and cap separately/together; send every invalid boundary. | Precedence and independent formulas are exact; invalid requests are 400 with no partial writes. | Not Run |
| BE-6 | Lock validation | Corrupt each lock invariant in isolated D1, then restore a fully valid draft and lock it. | Invalid snapshots never call BANK; valid snapshot retires the complete ordered ID set and becomes scheduled with unique identity. | Not Run |
| BE-7 | Reservation, short claim, and recovery | Fail before/after number reservation, lose the BANK response after a full claim, return same-owner confirmations on retry, force a true short claim, fail before/after scheduled publication, and retry after a lost HTTP response. | Pre-reservation failure stores no number; later failures preserve/reuse one hidden number; same-owner retry can publish; true short returns exact counts and never schedules/releases; post-publication retry is 409 and identity is recoverable from list. | Not Run |
| BE-8 | Cancellation and gaps | Cancel unclaimed draft, number-reserved draft, scheduled, and open fixtures; retry and try ended. | Legal states become cancelled; number-only reservation stays hidden and creates an accepted gap; published identity remains visible; repeated/ended return 409; composition remains and no BANK release occurs. | Not Run |
| BE-9 | Authorization/input and count cap | Exercise all six routes signed out, as student/admin/superadmin, with extra fields, malformed numbers/JSON, hostile IDs/statuses, and question counts 0/1/100/101. | 401/403 lattice is exact; admin/superadmin work; only 1..100 is accepted; invalid input is generic and causes no unsafe SQL or writes. | Not Run |

#### Frontend / UI

N/A — this is a backend-only packet and no `web/`, design-system, or mockup file may change. If frontend files enter the implementation diff, fail the implementation and add UI cases before proceeding.

#### Chrome DevTools / extension verification

N/A — this packet exposes backend routes only and deliberately defers the React admin builder. Use raw HTTP/API inspection in BE cases. If a browser surface is added, fail the implementation and add Network/Console/DOM cases.

#### Operator-executed (post-cutover, see AC-OPERATOR)

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| OP-1 | Production prerequisite check | Confirm real D1, AUTH admin access, and BANK contract/storage are healthy; apply no new migration. | Creation starts only after prior modules pass their own smoke tests. | Not Run |
| OP-2 | Real creation/lock smoke | With non-production fixture content, create, reshuffle, and patch one mixed-unit quiz; verify draft responses contain null identity; lock once; compare the published API identity/derived fields with D1 and BANK retirement. | No identity leaks before lock; the published number matches BANK's retirement number and appears with room code only after full confirmation; counts/order, admission timestamps, allowances, and duration agree; every selected question/group is retired once. | Not Run |
| OP-3 | Cancel and audit | Cancel the smoke quiz, retry cancel, and inspect D1/BANK state. | Quiz remains identifiable and cancelled, repeated cancel conflicts, and no retired content is released or reused. | Not Run |

### 12c. Definition of Done

- [ ] AC-1 through AC-17 are satisfied.
- [ ] §12a passes locally and in CI.
- [ ] BE-1 through BE-9 have Status other than `Not Run` (target: `Pass`).
- [ ] Frontend and Chrome remain correctly N/A, with no frontend/mockup diff.
- [ ] OP-1 through OP-3 are completed by the operator or explicitly waived and recorded in §5.
- [ ] §5 remains `(none)`; no product decision is reopened or left unresolved.
- [ ] The §8a Hard NO list is respected; every protected-file diff check is empty.
- [ ] The final implementation diff is limited to QUIZZING creation code/tests plus necessary shared mounting/constants.
- [ ] §11 rollback and every reserve/claim/publish crash and response-loss branch have been rehearsed mentally with concrete quiz states.

---

End of Codex Task Packet — `claude-task--001`
