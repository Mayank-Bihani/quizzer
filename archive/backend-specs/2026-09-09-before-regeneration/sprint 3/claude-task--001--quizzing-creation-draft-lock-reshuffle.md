# claude-task--001: Build QUIZZING creation — auto-pick, composition report, reshuffle, lock + retire, draft status

**Sprint:** 3  **Slug:** `quizzing-creation-draft-lock-reshuffle`  **Status:** Draft

> Phase 3 per `todos/PROGRESS.md`'s packet table (depends on Phase 1 / AUTH, Phase 2 / BANK — both
> tracked `done` as **specs**, but neither has landed as code yet: `src/db/users.ts`, `src/db/bank.ts`,
> `src/bindings.ts`, `vitest.config.ts` are either single-line stub comments or do not exist on disk
> — confirmed by reading the repo directly, not assumed). Every doc this packet cites (`QUIZZING.md`
> §1–4, §8–9, §11; `API.md`'s QUIZZING-creation section; `CONTRACTS.md` §3; `src/core/contracts.ts`;
> `src/core/api.ts`; `migrations/0001_init.sql`) is marked resolved/final — see `AUDIT.md` §11 and
> `COUNCIL_FINDINGS.md`'s 2026-09-05 resolution log. This packet does not re-open any of those
> decisions; it only turns them into code, and is scoped to **creation only** — the run (Phase 4),
> results (Phase 5), and boards (Phase 7) sub-areas of the QUIZZING module are explicitly out of
> scope (§4).

---

## 1. Context

QUIZZING is "the product... the largest module by a wide margin," split into four phase-mapped
sub-areas (`QUIZZING.md:11-21`): Creation (Phase 3, this packet), Run (Phase 4), Results (Phase 5),
Boards (Phase 7). This packet builds **only** the Creation row of that table: "Auto-pick, composition
report, lock + retire, room code, per-quiz parameters" (`QUIZZING.md:18`).

**Nothing in `src/` implements this yet** — every file this packet touches is a single-line
ownership comment, confirmed by reading each one directly:

- `src/routes/quizzes.ts:1` — names all five routes and their status-transition behavior already,
  accurately, as a one-line spec
- `src/db/quizzes.ts:1` — names the same five operations **plus** `openRoom`, `closeQuiz`,
  `materializeTemplates` (Phase 4/5/7 concerns this packet does not implement — §4)
- `src/core/selection.ts:1` — "unused-question draw, difficulty mix, whole passage groups solved
  with standalones — builds `SelectionFilters`"
- `src/core/config.ts:1` — "caps, room-code format, and phase constants (e.g. seat cap 120)"
- `src/index.ts:1` — the eventual full Hono app; today mounts nothing

**The creation flow, in the module's own words** (`QUIZZING.md:63-103`):
`POST /api/admin/quizzes` creates a `'draft'` quiz — a status distinct from `'scheduled'`
(`QUIZZING.md:63-65`, COUNCIL_FINDINGS.md #2/#3) — because scoring/timing params and the room
identity (room code, quiz number) aren't known until later steps. `question_count`/`difficulty_mix`
from the draw **are** stored at draft time (COUNCIL_FINDINGS.md #5), so reshuffle and the
window-length derivation have something to read. The seven numbered steps (`QUIZZING.md:71-83`):
draw → report composition → reshuffle/preview → set per-quiz params → lock (`claimUnused`, short
return means redraw-and-retry) → status flips `draft`→`scheduled`, room code + quiz number assigned
**only now**.

**Schema is already final for this phase** — `migrations/0001_init.sql:73-130` (`quizzes`, with the
draft/scheduled CHECK constraints), `:40-57` (`quiz_templates` — read-only for this packet, see §4),
`:211-218` (`quiz_questions`). No new migration is needed; every column this packet writes already
exists, confirmed by reading the full file.

**Module boundary this packet must respect:** "This module resolves `quizId → questionIds` itself,
then calls BANK's `getByIds(questionIds)`" (`QUIZZING.md:95-97`) — it does **not** ask BANK to read
`quiz_questions`. `BankContract.listUnused`/`claimUnused`/`getByIds`
(`src/core/contracts.ts:77-87`) are consumed as an interface only; this packet does not implement
them (they're BANK's Phase-2 packet, `todos/sprint 2/claude-task--001--bank-csv-import-admin-crud.md`).

**Sequencing assumption, mirroring Sprint 2's own precedent exactly** (`todos/sprint 2/...:38-45,
62-67`): this packet is written against `AuthContract` and `BankContract` as **contracts**
(`src/core/contracts.ts:30-40`, `:77-87`), not against implemented code. If Phase 1/2 haven't
landed by build time, stub both behind the same import paths Sprint 1/2's own packets name
(`requireAuth`/`requireRole`/`currentUser` from `src/db/users.ts`; `listUnused`/`claimUnused`/
`getByIds` from `src/db/bank.ts`) rather than forking the interface — replace the stub, don't
fork, once those phases land for real.

**Reusable pattern to mirror:** Sprint 2's packet is "the first module with real logic in this
repo" (`todos/sprint 2/...:43-45, 327-329`) and explicitly says later phases should mirror *it*.
This packet follows its conventions: a thin Hono sub-app in `routes/*.ts` delegating to a `db/*.ts`
D1-access layer, pure zero-platform-import logic in `core/*.ts`, `*.test.ts` co-located next to the
file it tests, a `fixtures/<module>/` directory for committed test fixtures, and the same
`vitest.config.ts` (extended additively if Sprint 2 already added it, created fresh with the same
shape if not).

## 2. Objective

After this ships: an admin can `POST /api/admin/quizzes` with a section type, requested count, and
difficulty mix, and receive back a `'draft'` quiz with a full composition report (whole passage
groups plus standalones, drawn only from the never-used pool, never split) — no room code, no quiz
number, no scoring params yet. They can `reshuffle` to redraw a fresh composition as many times as
they like, `PATCH` per-quiz scoring/timing/seat-cap parameters (server-validated and, for the
window length, server-derived), and `lock` the quiz — which atomically retires every drawn question
via `claimUnused` (a short return means some questions were taken by another admin; the draft stays
a draft, and the admin redraws and retries per the module's own documented flow), assigns the room
code and sequential quiz number **only on a successful lock**, and flips `status` from `'draft'` to
`'scheduled'`. An admin can `cancel` a draft or scheduled quiz at any point before it ends. Every
[[SCHEDULER]]-facing predicate (`status = 'draft'` excluded, `status = 'cancelled'` excluded)
continues to hold structurally because this packet writes rows exactly as the schema's CHECK
constraints and the module doc require — nothing in Phase 4/5/7 needs to special-case a
still-drafting quiz.

## 3. Assumptions

- **AUTH/BANK are contracts, not code, as of this writing** — confirmed: `src/db/users.ts`,
  `src/db/bank.ts` are single-line stubs; `src/bindings.ts` and `vitest.config.ts` (both promised
  by Sprint 2's own packet, `todos/sprint 2/...:68-72, 87-91`) do not exist on disk at all. This
  packet defines `src/bindings.ts` itself if it's still missing at build time, using **exactly**
  Sprint 2's own spec'd shape (`todos/sprint 2/...:336-343`: `{ DB: D1Database; IMAGES: R2Bucket;
  CACHE: KVNamespace; TELEGRAM_BOT_TOKEN?: string; SUPERADMIN_EMAIL?: string; SESSION_SECRET?:
  string }`) so there is no drift if Sprint 1/2 land later — merge additively if it already exists.
  Same for `vitest.config.ts`.
- **`WINDOW_SLACK_SEC` has no numeric value anywhere in the docs.** `QUIZZING.md:311` and
  `PRD.md:118` both say "`count × time_per_q_sec` + slack" with no number. This packet picks
  **300 seconds (5 minutes)** as a named, tunable constant in `core/config.ts`, mirroring Sprint
  2's own precedent for an undocumented numeric constant (that packet's D1 batch-chunk-size pick,
  `todos/sprint 2/...:80-86`, itself flagged the same way). Not a blocker — trivially adjustable,
  and `windowSec`'s floor (`≥ count × time_per_q_sec`, QUIZZING.md:89-90) holds regardless of the
  slack's exact value.
- **Room code format has one example, no algorithm.** `QNT-8417` (`PRD.md:116`, `PLAN.md:581`) is
  the only instance in any doc. This packet generates `` `QNT-${4 random decimal digits, zero-padded}` ``,
  regenerated on a `room_code` UNIQUE conflict (vanishingly unlikely at this deployment's scale —
  "~22 quizzes/day," `PLAN.md:619-626`). Both the prefix and digit count are named constants in
  `core/config.ts`. Purely cosmetic — the room code is explicitly "not a credential"
  (`QUIZZING.md:299`) — so this doesn't affect correctness.
- **`quiz_number` assignment at lock, not draft.** COUNCIL_FINDINGS.md #36 (`COUNCIL_FINDINGS.md:80`)
  says "Use `INSERT ... RETURNING` with retry-on-conflict rather than `SELECT MAX()+1`" — written
  when assignment happened at the draft-creation `INSERT`. Assignment now happens at lock, which is
  an `UPDATE` on an already-existing row, not an `INSERT`. This packet computes
  `next = SELECT MAX(quiz_number)+1 FROM quizzes`, attempts the locking `UPDATE ... WHERE id = ? AND
  status = 'draft'` with `quiz_number = next`, and retries with `next+1` on a `UNIQUE` constraint
  violation — matching the finding's intent (never trust a stale read blindly) while fitting the
  UPDATE-not-INSERT shape. This is defensive, not required for correctness in practice: "concurrent
  admin actions locking overlapping quizzes don't happen in this deployment"
  (`CONTRACTS.md:102-105`).
- **`endsAt`/`lobbyOpensAt` derivation formulas are inferred, not stated as a formula anywhere, but
  the inference is tight:**
  - `lobbyOpensAt = scheduledAt − 5 minutes` — the migration's own comment says so directly:
    `migrations/0001_init.sql:82` ("T−5m: seats seed, room code still hidden"), matching the
    Telegram timeline's "T−5 min | Room is OPEN" row (`PLAN.md:581`).
  - `endsAt = scheduledAt + windowSec × 1000` — inferred from `QUIZZING.md:207-209`'s own framing:
    "Every results endpoint... calls `closeQuiz` when it sees `now >= ends_at + window_sec`... a
    student who joined right at the join window's close still has a full `window_sec` running."
    That phrase only reads correctly if `ends_at` is itself `scheduledAt + windowSec` — a joiner at
    the last instant before `ends_at` then has a deadline of `ends_at + window_sec`, exactly the
    quoted gate. `API.md:243` ("Server derives... `endsAt` from `scheduledAt`/`windowSec`") is
    consistent with this and cites no other input.
  - Both are recomputed by `PATCH` handling whenever `scheduledAt` or the effective `windowSec`
    changes (`QUIZZING.md:311-313`), never left to drift.
- **`windowSec`'s own value has two paths, both textually supported:** (a) if the admin's `PATCH`
  body includes `windowSec` explicitly, that value is used as given (validated against the floor,
  §7); (b) if the `PATCH` doesn't include `windowSec` but changes `timePerQSec` (or this is the
  first `PATCH` to set `timePerQSec` at all), the server auto-computes
  `windowSec = questionCount × timePerQSec + WINDOW_SLACK_SEC`. This reconciles "auto-derived...
  not a one-time default the admin can silently desync" (`QUIZZING.md:311-313`) with
  `UpdateQuizParamsRequest` still type-permitting `windowSec` as an explicit input
  (`src/core/api.ts:232-242`) — an admin adding deliberate extra buffer is a legitimate PATCH, but
  it can never leave `windowSec` stale relative to a *later* `timePerQSec` change, because any
  `PATCH` that changes `timePerQSec` without also re-supplying `windowSec` re-derives it.
- **`core/selection.ts`'s whole-passage-group solving algorithm is unspecified beyond the
  requirement** ("solving the requested count using whole passage groups plus standalones — a
  group is drawn entirely or not at all," `QUIZZING.md:71-74`). This packet picks a **fetch-wide,
  then backtrack** strategy (detailed in §9): call `listUnused` with a generous fixed per-difficulty
  cap (`SELECTION_FETCH_CAP_PER_DIFFICULTY = 500` in `core/config.ts` — well above any realistic
  per-difficulty bucket size for "a bank of a few thousand questions total," `API.md:35-38`'s own
  characterization of this deployment's scale), then run a randomized backtracking search over
  {whole passage groups, standalone questions} as atomic items, pruned on remaining
  size/per-difficulty budget, returning the first exact match. This padded fetch is an **internal
  query strategy only** — it never changes what's stored on the `quizzes` row (`question_count`/
  `difficulty_mix` stay exactly the admin's original `SelectionFilters`, per COUNCIL_FINDINGS.md #5)
  or what `reshuffle` reports as "the same stored parameters."
- **`SelectionFilters.difficultyMix` values must sum to `count`** — not stated explicitly anywhere,
  but implied by the type's own shape and by "the composition is reported before lock" only making
  sense against a coherent target. Validated server-side (400 on mismatch) as a reasonable
  extension of the existing precedent of pre-validating admin input before accepting a draft
  (`QUIZZING.md:90-93`, re-scoped per the point below).
- **`QUIZZING.md:91`'s "before accepting the draft or any later `PATCH`" phrase (for
  `grace_sec < time_per_q_sec` / `marks_wrong <= 0`) predates the finalized `CreateQuizDraftRequest`
  shape.** That request type is `SelectionFilters & { title, scheduledAt }` only
  (`src/core/api.ts:211-214`) — it carries no `graceSec`/`marksWrong` field at all; those are
  `PATCH`-only and stay `NULL` on the draft row (`API.md:129-131`). There is nothing to validate on
  this axis at draft-creation time. This packet applies the `grace_sec`/`marks_wrong` validation at
  `PATCH` time only — the place those fields can actually appear — and treats the module doc's
  wording as describing the effective behavior across the two-step flow (draft, then `PATCH`), not
  a literal claim that draft creation receives those fields.
- **No route exists anywhere for creating or editing `quiz_templates` rows** (grep-confirmed across
  `API.md`, `QUIZZING.md`, `PLAN.md`, `SCHEDULER.md`) — out of scope, §4.
- **The seed bank fixture from Sprint 2** (`fixtures/bank/seed-bank.csv`/`.zip`,
  `todos/sprint 2/...:483-489`, "a hard dependency for every later phase... QUIZZING creation needs
  a real unused pool to draw from") is reused here as the base fixture. This packet adds one more,
  `fixtures/quizzing/selection-bank.csv` (+ a matching image ZIP only if it references images),
  sized specifically to exercise the solver: enough standalone questions across all three
  difficulties, and at least three passage groups (sizes 4 and 5) with **mixed internal
  difficulty**, so AC-4 and AC-5 below (group-integrity and infeasible-group exclusion) have real
  fixture data to run against rather than being asserted only in a unit test with synthetic data.

## 4. Out of Scope

- **The run (Phase 4)** — `join`, seat claim, `answer`/`skip`/`timeout`, `openRoom`,
  `quiz_seats`/`participants`/`answers` tables (`QUIZZING.md §5`). `db/quizzes.ts`'s own ownership
  comment (`src/db/quizzes.ts:1`) names `openRoom` because the file spans phases; this packet
  implements none of it.
- **Results (Phase 5)** — `closeQuiz`, scoring, leaderboard/review routes, `board_computed_at`
  claiming (`QUIZZING.md §6`). Same file-spans-phases note applies to `closeQuiz` in
  `src/db/quizzes.ts:1`.
- **Boards (Phase 7)** — weekly boards, `computeWeeklyBoards`, and **recurring template
  materialization** (`materializeTemplates`, `QUIZZING.md §4` recurring-quiz paragraph,
  `:99-103`) — SCHEDULER's own unattended draw, Phase 7 per `todos/PROGRESS.md`'s table. Same note
  applies to `materializeTemplates` in `src/db/quizzes.ts:1`.
- **`quiz_templates` CRUD** — no HTTP route exists anywhere in the documented API surface for
  creating or editing a template (grep-confirmed). `quiz_templates` is read-only from this
  packet's perspective; every route this packet builds operates on one-off, admin-drawn quizzes
  (`template_id IS NULL`). See §5 for the resulting design gap this surfaces (non-blocking).
- **Telegram announcements (TG-1..TG-8)** — Sprint 6 (TELEGRAM). This packet's `cancel` route does
  **not** call `TelegramContract.claimAndSend` or hand off a `CancelledPayload` to any SCHEDULER
  surface, even though `CONTRACTS.md:199-206` describes that wiring conceptually — it's TELEGRAM's
  phase to wire, not this one's. `cancel` here only updates the `quizzes` row.
- **AUTH/BANK's own implementations** — consumed as contracts only (§1, §3); this packet does not
  implement `requireAuth`/`requireRole`/`listUnused`/`claimUnused`/`getByIds` themselves.
- **Admin report export** (`GET /api/admin/quizzes/:id/report`) — `QUIZZING.md §7.1`, Phase 8.
- **The 120-client load test** — `PLAN.md:720` places it in Phase 4, not this creation-only phase.
- **Any admin-console UI** (`web/src/admin/...`) — this packet is backend-only, mirroring Sprint 2's
  own framing (`todos/sprint 2/...:109-112`).

## 5. Open Questions / `<INPUT_REQUIRED>`

`(none)` — every genuine gap the docs left underspecified is resolved in §3 with a concrete,
clearly-flagged, tunable default, following Sprint 2's own precedent for undocumented constants
(that packet's D1 chunk size). None of these block writing or verifying an AC:

- `WINDOW_SLACK_SEC = 300` and the room-code digit format are cosmetic/tuning choices with no
  correctness impact — flagged as `OP` items in §12b for a human to sanity-check against real
  usage, not treated as blockers here.
- **This packet originally surfaced a genuine design gap here and deferred it** — no
  `GET /api/admin/quizzes` list route existed anywhere, so an admin who created a draft and left
  had no way to recover its id later. The project owner resolved it: add the route now, in this
  packet's scope, un-bundled from the (still correctly deferred) recurring-template CRUD routes
  it had been lumped in with (`COUNCIL_FINDINGS.md` #18). `API.md`, `QUIZZING.md` §4, and
  `src/core/api.ts` (`ListQuizzesRequest`/`ListQuizzesResponse`) already reflect this — see §7/§9
  below for this packet's own AC and behavior-spec coverage. No detail route (`GET .../:id`) was
  added — `PATCH`/`cancel` already return the full `QuizAdminSummary`, so a detail-only fetch has
  no caller that needs it yet.

## 6. Pre-flight Checklist

- [ ] Required skill loaded: **`clean-code`** — always.
- [ ] Required skill loaded: **`prod-safety-gate`** — `lock` performs an irreversible D1 write
  (`claimUnused` retires real bank questions with no `release()`, CONTRACTS.md §3) with real
  product consequences (a wasted question is gone from the pool forever); `cancel` is a one-way
  status transition with no "un-cancel."
- [ ] Required skill loaded: **`test-driven-development`** — the short-lock/no-release interaction
  (§9, AC-16/17) and the solver's exact-match-or-fail behavior (AC-4/5) are exactly the kind of
  "looks right, isn't" logic this discipline catches; write the failing test before the
  implementation for both.
- [ ] Required skill loaded: **`vibesec`** — every route here is `requireRole('admin')`-gated
  (no student-facing surface in this packet), but the `PATCH` handler must reject unknown/forbidden
  raw JSON fields the same way BANK's `PATCH /questions/:id` does (`todos/sprint 2/...:425-427`) —
  a raw HTTP client can send fields TypeScript's structural typing won't catch at runtime.
- [ ] Working tree clean; branch up to date with `main`.
- [ ] Confirm whether Phase 1 (AUTH) / Phase 2 (BANK) have landed as code; if not, apply the
  stub-behind-the-same-import approach from §3 rather than blocking.
- [ ] Read before editing: `QUIZZING.md` §1-4, §8-9, §11 (whole sections, `:11-103`, `:256-323`),
  `API.md:106-136`, `CONTRACTS.md:72-106`, `src/core/contracts.ts:9-16, 47-87`,
  `src/core/api.ts:60-84, 203-249`, `migrations/0001_init.sql:40-131, 211-218`,
  `todos/sprint 2/claude-task--001--bank-csv-import-admin-crud.md` (whole file, for the
  conventions this packet mirrors and the exact `BankContract` behavior it depends on).
- [ ] Re-read every AC in §7 before starting; note none are `AC-OPERATOR` except §12b's two `OP`
  constant-sanity-check items — every other AC is implementer-executed and automatable.

## 7. Acceptance Criteria

**Selection algorithm (`core/selection.ts`) — pure, no D1/R2/network import**

- **AC-1.** `core/selection.ts` exports a function accepting a `BankContract`-shaped `listUnused`
  callable and a `SelectionFilters`, returning either
  `{ ok: true, questionIds: string[] }` (ordered — see AC-3) or
  `{ ok: false, reason: 'pool_exhausted' }` — no import of `D1Database`/`R2Bucket`/`fetch` anywhere
  in the file except through the injected `listUnused` parameter's type (grep-verifiable, mirrors
  `core/csv.ts`'s platform-import-free rule, `todos/sprint 2/...:293-294`).
- **AC-2 (the PRD acceptance case, verbatim).** Given a fixed bank (`fixtures/quizzing/selection-bank.csv`)
  and 50 simulated draws (draft-creation-equivalent calls) drawing disjoint pools progressively
  (each draw's claimed ids removed from the "unused" simulation before the next), no question id
  is ever selected twice across the 50 draws and no passage group ever appears split across two
  different draws (`PRD.md:120-121`, `QUIZZING.md §12`).
- **AC-3.** For a successful selection, `questionIds` is ordered such that every passage group's
  members are **contiguous** and internally ordered by their own `groupPosition` (ascending), with
  the overall block order (which group appears where relative to standalones) randomized between
  repeated calls against the same fixture and filters (verified: two calls produce a different
  `questionIds` order in at least 9 of 10 repeated trials — a weak randomness check, not a strict
  one, since exact equality by chance is possible but rare).
- **AC-4.** A passage group whose members span a difficulty **not present at all** in
  `filters.difficultyMix` is never selected — selecting it would add a question the target mix
  doesn't budget for. Verified against `fixtures/quizzing/selection-bank.csv`'s intentionally
  mixed-difficulty groups (§3).
- **AC-5.** When the *fetched* candidate pool (post-padding, §9) cannot satisfy `filters.count`/
  `filters.difficultyMix` with any combination of whole groups + standalones — including the case
  where enough raw questions exist by difficulty count alone but every combination would require
  splitting a group — the function returns `{ ok: false, reason: 'pool_exhausted' }`, never a
  partial result (QUIZZING.md §11's "fail loudly, no partial draw, no silent reuse").
- **AC-6.** `listUnused` is called with a per-difficulty cap of `SELECTION_FETCH_CAP_PER_DIFFICULTY`
  (`core/config.ts`), never with the caller's raw `filters` object mutated in place — the
  `SelectionFilters` passed to `listUnused` is a distinct, padded object; the original `filters`
  argument is never mutated (assertable via reference/deep-equality check post-call).

**Draft creation (`POST /api/admin/quizzes`, `routes/quizzes.ts` + `db/quizzes.ts`)**

- **AC-7.** A valid `CreateQuizDraftRequest` (`title`, `scheduledAt`, `type`, `count`,
  `difficultyMix` summing to `count`) creates one `quizzes` row with `status = 'draft'`,
  `quiz_number IS NULL`, `room_code IS NULL`, every scoring/timing column `NULL`,
  `question_count`/`difficulty_mix` populated from the request's `SelectionFilters`
  (COUNCIL_FINDINGS.md #5), and one `quiz_questions` row per selected question at positions
  `1..questionCount` with no gaps and no duplicate `question_id` for this `quiz_id`
  (enforced further by the schema's own `UNIQUE (quiz_id, question_id)`,
  `migrations/0001_init.sql:216-217`).
- **AC-8.** The response is `CreateQuizDraftResponse` — `questions` is the **flat** `QuestionFull[]`
  from `BankContract.getByIds(questionIds)`, in the same order as `quiz_questions.position`
  (`API.md:116-119` — grouping into passage/standalone shape is a client-side fold, not a
  server-side concern).
- **AC-9.** `difficultyMix` values summing to something other than `count` return `400` before any
  D1 write (§3's added validation).
- **AC-10.** Pool exhaustion (selection.ts's `{ ok: false }`, AC-5) returns `409` with no `quizzes`
  or `quiz_questions` row written at all — verified by asserting row counts in both tables are
  unchanged before/after the call (`API.md:110`, QUIZZING.md §11).
- **AC-11.** A request missing `title` or `scheduledAt` returns `400` — these are the two `NOT NULL`
  columns `CreateQuizDraftRequest` must supply beyond `SelectionFilters` (`API.md:132-133`).
- **AC-12.** The route is mounted behind `requireRole('admin')` — no session or a `student` session
  gets `401`/`403` respectively.

**Reshuffle (`POST /api/admin/quizzes/:id/reshuffle`)**

- **AC-13.** On a `status = 'draft'` quiz: re-runs selection using the **quiz row's own stored**
  `type`/`question_count`/`difficulty_mix` (not any request body — there is none, `API.md:111`),
  deletes every existing `quiz_questions` row for this `quiz_id`, inserts a fresh set at
  `1..questionCount`, and returns `ReshuffleQuizResponse { questions: QuestionFull[] }` in the new
  position order. `quizzes.question_count`/`difficulty_mix` are unchanged by this call.
- **AC-14.** On any `status` other than `'draft'` (`'scheduled'`, `'open'`, `'ended'`,
  `'cancelled'`), returns `409` ("already locked" per `API.md:111`) and writes nothing.
- **AC-15.** A reshuffle that hits pool exhaustion (the bank has been drawn down since the original
  draft) returns `409` and leaves the **prior** `quiz_questions` set untouched (the old composition
  survives a failed reshuffle attempt) — an inferred consistency extension of AC-10's exhaustion
  handling to this route, since `API.md`'s "extra status codes" column for this route only names
  "already locked" but doesn't claim to be an exhaustive list of every conflict this route could
  hit; flagged here explicitly as this packet's own judgment call, not asserted fact from the docs.

**Lock (`POST /api/admin/quizzes/:id/lock`)**

- **AC-16 (the short-return path — the one that must be gotten exactly right).** Given a
  `status = 'draft'` quiz whose stored scoring/timing params are all set (see AC-18) and whose
  currently-referenced `question_id`s include at least one already claimed by a concurrent
  `claimUnused` call (simulated directly against `db/bank.ts` per Sprint 2's own `BankContract`,
  not built here): `lock` calls `claimUnused(questionIds, quizId, quizNumber)`, gets back fewer ids
  than requested, and (a) responds
  `{ locked: false, requestedCount, claimedCount }` (`200`, not an error status —
  `API.md:121-123`'s "a normal, expected outcome... not a failure worth a non-2xx status"), (b)
  leaves `quizzes.status = 'draft'`, `quiz_number`/`room_code` still `NULL` — the row is **not**
  updated to `'scheduled'` on a short return, (c) does **not** attempt to release the questions
  `claimUnused` *did* win — they stay permanently `used_in_quiz_id = thisQuizId` with no un-claim
  call, per CONTRACTS.md §3's explicit acceptance ("no all-or-nothing claim semantics, no
  auto-release on a partial match, no `release()` call" — `CONTRACTS.md:102-105`). This is expected,
  accepted behavior, not a bug this packet works around.
- **AC-17.** Following AC-16's short return, a subsequent `reshuffle` on the same quiz succeeds:
  draws a fresh set (which naturally excludes the now-`used_in_quiz_id`-stamped questions from
  AC-16, since `listUnused` only returns unused rows), replaces `quiz_questions` entirely — and the
  AC-16-claimed questions remain permanently orphaned in BANK's pool (retired to a quiz that will
  never actually run with them), a known, accepted cost of the no-`release()` design
  (`CONTRACTS.md:102-105`). Documented as a Risk-table row (§10), not silently treated as a defect.
- **AC-18.** `lock` on a `status = 'draft'` quiz where any of `timePerQSec`/`windowSec`/`graceSec`/
  `marksCorrect`/`marksWrong`/`maxSpeedBonus`/`lobbyOpensAt`/`endsAt` is still `NULL` (i.e., the
  admin never `PATCH`ed scoring params) is rejected with `409` — the row's own CHECK constraint
  (`migrations/0001_init.sql:113-120`) would reject the `UPDATE` to `'scheduled'` at the DB level if
  this weren't pre-validated in the handler; this AC is what stops that from surfacing as a raw
  constraint-violation `500`. Not called out in `API.md`'s status-code column for this route
  (`API.md:112` lists only 403/404/409-already-locked) — flagged explicitly as this packet's own
  judgment call reusing the `409` conflict status for a second, distinct reason ("not configured"
  vs. "already locked"), distinguished only by the error message.
- **AC-19.** On a fully successful claim (`claimedCount === requestedCount`): assigns the next
  `quiz_number` (§3's `MAX()+1`-with-retry strategy) and a freshly generated `room_code`
  (§3's `QNT-####` format), sets `status = 'scheduled'`, and responds
  `{ locked: true, roomCode, quizNumber }` (`200`).
- **AC-20.** `lock` on any non-`'draft'` status returns `409` ("already locked").
- **AC-21.** `lock` never calls `claimUnused` before AC-18's configuration check passes — verified
  by asserting `claimUnused` is not invoked (no `used_in_quiz_id` stamps occur) when the check
  fails, so an admin's incomplete draft never wastes real bank questions.

**Per-quiz parameters (`PATCH /api/admin/quizzes/:id`)**

- **AC-22.** `graceSec >= timePerQSec` (evaluated against the **effective merged row** — existing DB
  value overlaid with this PATCH's fields, not the PATCH body's fields in isolation) returns `400`
  and writes nothing; `graceSec` compared against a still-`NULL` `timePerQSec` (e.g., a `PATCH`
  setting only `graceSec` before any `timePerQSec` has ever been set) is accepted, matching the
  DB's own null-tolerant CHECK (`migrations/0001_init.sql:121`: "`grace_sec IS NULL OR
  time_per_q_sec IS NULL OR grace_sec < time_per_q_sec`").
- **AC-23.** `marksWrong > 0` (again evaluated on the effective merged row) returns `400` and
  writes nothing (`migrations/0001_init.sql:122`, QUIZZING.md:90-93 re-scoped to `PATCH`-time per
  §3).
- **AC-24.** `seatCap > 120` is **clamped** to `120`, not rejected (QUIZ-9, "clamped server-side to
  120," `QUIZZING.md:58`); `seatCap <= 0` returns `400` (clamping only ever raises a ceiling, never
  fabricates a valid floor); `1 <= seatCap <= 120` is stored as given.
- **AC-25.** A `PATCH` that sets `timePerQSec` without also supplying `windowSec` auto-derives
  `windowSec = questionCount × timePerQSec + WINDOW_SLACK_SEC` (§3) and stores it; a `PATCH` that
  supplies `windowSec` explicitly uses that value as given, rejecting (`400`) any explicit value
  below `questionCount × timePerQSec` (the QUIZ-10 floor, `QUIZZING.md:89-90`).
- **AC-26.** Any `PATCH` that changes the effective `scheduledAt` or `windowSec` (whether
  explicitly supplied or auto-derived per AC-25) recomputes and stores both `lobbyOpensAt`
  (`scheduledAt − 5min`) and `endsAt` (`scheduledAt + windowSec`) in the same write — never left
  stale (`QUIZZING.md:311-313`).
- **AC-27.** `PATCH` on a quiz whose `status` is `'open'`, `'ended'`, or `'cancelled'` returns `409`
  and writes nothing (`API.md:113`, "rejected once the room has opened, so a setting can't change
  under a student already mid-run").
- **AC-28.** A raw request body containing a field not in `UpdateQuizParamsRequest`
  (`src/core/api.ts:232-242`) — e.g. `{"quizNumber": 99}` — returns `400`, not a silently-ignored
  extra field (mirrors BANK's `PATCH /questions/:id` freeze-check pattern,
  `todos/sprint 2/...:425-427`).
- **AC-29.** A successful `PATCH` returns `UpdateQuizParamsResponse = QuizAdminSummary`
  (`src/core/api.ts:60-84`) reflecting every column, including the just-recomputed
  `lobbyOpensAt`/`endsAt`/`windowSec`.

**Cancel (`POST /api/admin/quizzes/:id/cancel`)**

- **AC-30.** Cancel succeeds (sets `status = 'cancelled'`) from `'draft'`, `'scheduled'`, or
  `'open'`; returns `409` from `'ended'` or already-`'cancelled'` (`API.md:114`).
- **AC-31.** Cancel does **not** call `claimUnused`, does not release any already-retired questions
  (there is no `release()`, `CONTRACTS.md:102-105`), and does not call `TelegramContract` or any
  SCHEDULER hand-off (§4) — verified by asserting no calls into either surface.
- **AC-32.** Cancel's response is `CancelQuizResponse = QuizAdminSummary` reflecting the new status.

**Cross-cutting**

- **AC-33.** Every route in `routes/quizzes.ts` is mounted behind `requireRole('admin')` — a
  request with no session, or a `student` session, gets `401`/`403` respectively, on all six
  routes.
- **AC-34.** A request for a non-existent `:id` on `reshuffle`/`lock`/`PATCH`/`cancel` returns
  `404` before any other check (status/config validation) runs.

**List (`GET /api/admin/quizzes`) — added per COUNCIL_FINDINGS.md #18, un-bundled from the
recurring-template deferral**

- **AC-35.** Returns `ListQuizzesResponse = PageResponse<QuizAdminSummary>` covering every quiz
  this admin can act on, across every `status` including `'draft'` — this is the only route that
  returns a `'draft'` quiz's id once the creating session is gone, so it must not filter drafts
  out by default (`API.md`, `src/core/api.ts` `ListQuizzesRequest`/`ListQuizzesResponse`).
- **AC-36.** `status` query param, when given, filters to exactly that status; `limit`/`offset`
  behave identically to the other four `PageResponse<T>` routes in the system (BANK-8, RESULT-8,
  BOARD-8, ADMIN-2) — same convention, not a new one invented for this route.

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not modify `migrations/0001_init.sql` — the schema for this phase is already final (§1).
  `git diff -- migrations/0001_init.sql` must be empty.
- Do not modify `src/core/api.ts` or `src/core/contracts.ts` — this packet consumes
  `CreateQuizDraftRequest`/`Response`, `ReshuffleQuizResponse`, `LockQuizResponse`,
  `UpdateQuizParamsRequest`/`Response`, `CancelQuizResponse`, `QuizAdminSummary`,
  `SelectionFilters`, `BankContract`, `QuestionFull` — it does not change any of them.
- Do not implement `openRoom`, `closeQuiz`, `materializeTemplates`, or `computeWeeklyBoards` in
  `db/quizzes.ts` — explicitly out of scope (§4), even though that file's ownership comment names
  them for a later phase.
- Do not implement `BankContract`'s `listUnused`/`claimUnused`/`getByIds` — consume them as an
  interface only (§1, §3).
- Do not build a `release()` call, an all-or-nothing claim across a short lock, or any
  auto-retirement-reversal — explicitly rejected (`CONTRACTS.md:102-105`, AC-16/17 above).
- Do not add a `GET /api/admin/quizzes` or `GET /api/admin/quizzes/:id` route on this packet's own
  initiative — the gap is real (§5) but resolving it is out of this packet's scope; adding an
  undocumented route here would be scope creep against a doc this packet is supposed to ground
  every claim in, not extend.
- Do not call `TelegramContract.claimAndSend` from the `cancel` handler — Sprint 6's job (§4).
- Do not add an `admin_events`/audit-log table — no doc calls for one at this scale, mirroring
  Sprint 2's own rejection of the same idea (`todos/sprint 2/...:297-298`).

### 8b. Coding / quality principles

- `clean-code`: `core/selection.ts`'s backtracking solver should read as small, named steps
  (`buildPaddedFilters`, `groupIntoItems`, `search`, `assignPositions`) — not one 150-line function
  with nested nine-deep conditionals. This is the highest algorithmic-density file in the packet.
- `prod-safety-gate`: `lock`'s production surface is an **irreversible retirement write** — a bad
  `lockQuiz` either silently double-claims (impossible given the schema's conditional `UPDATE`, but
  worth a defensive assert) or, worse, updates `status`/`quiz_number`/`room_code` on a partial claim
  it should have treated as a short return (AC-16 is the one place "the code looks right" and "the
  code is right" diverge most sharply — get the short-return branch under test before the
  full-success branch).
- `test-driven-development`: write AC-16 (the short-return path) and AC-5 (solver exhaustion) as
  failing tests before writing `lockQuiz`'s claim-and-branch logic and `selectQuestions`'s search
  loop respectively.
- `vibesec`: the `PATCH` handler's forbidden-field rejection (AC-28) must check the **raw parsed
  JSON body**, not the typed `UpdateQuizParamsRequest` object post-parse — TypeScript's structural
  typing silently drops excess properties on a cast, it doesn't reject them at runtime.
- Mirror Sprint 2's conventions throughout (§1) — this is the second module with real logic in this
  repo; don't invent a second chunking/fixture/config convention where Sprint 2 already established
  one.

## 9. Behavior Spec (per file)

### `src/core/config.ts`

- **Current state (line 1):** ownership comment naming exactly this content: "caps, room-code
  format, and phase constants (e.g. seat cap 120)."
- **Required edit:** add named constants: `SEAT_CAP_MAX = 120`, `WINDOW_SLACK_SEC = 300`,
  `ROOM_CODE_PREFIX = 'QNT'`, `ROOM_CODE_DIGIT_COUNT = 4`,
  `SELECTION_FETCH_CAP_PER_DIFFICULTY = 500`, and a `LOBBY_LEAD_SEC = 300` (the T−5min constant,
  §3). Pure, zero-platform-import.
- **Estimated diff:** ~20 LOC.
- **Subtleties:** every numeric literal this packet would otherwise inline (300, 120, 500, 4) lives
  here instead — grep for bare `300`/`120` in other files this packet touches should turn up
  nothing outside test fixtures.

### `src/core/selection.ts`

- **Current state (line 1):** ownership comment, no code.
- **Required edit:** implement per §3/§9's fetch-wide-then-backtrack strategy:
  ```ts
  export type SelectionOutcome =
    | { ok: true; questionIds: string[] }
    | { ok: false; reason: 'pool_exhausted' }

  export async function selectQuestions(
    listUnused: BankContract['listUnused'],
    filters: SelectionFilters
  ): Promise<SelectionOutcome>
  ```
  Steps: (1) build a padded `SelectionFilters` copy — same `type`, each `difficultyMix` key capped
  at `SELECTION_FETCH_CAP_PER_DIFFICULTY` instead of the caller's requested count — call
  `listUnused` once with it; (2) partition the returned `QuestionFull[]` into passage-group items
  (keyed by `passageId`, internally sorted by `groupPosition`) and standalone items; (3) shuffle
  item order (crypto-random), then backtrack: recursively include/exclude each item, pruning
  whenever remaining size or any remaining per-difficulty budget goes negative, or whenever the sum
  of all *not-yet-decided* items' sizes/difficulty-contributions can no longer reach the remaining
  target; (4) on the first exact match (total size `== filters.count`, every difficulty count
  matches exactly), flatten to `questionIds` in the shuffled block order, group members in
  ascending `groupPosition`; (5) if the search exhausts without a match (bound by a node-count
  safety cap — a named constant, not unbounded recursion), return `{ ok: false }`.
- **Estimated diff:** ~170 LOC.
- **Subtleties:** the padded filter object must be a fresh object — never mutate the `filters`
  parameter (AC-6). The search must treat "no passage groups matched at all" (an all-standalone
  bank) as a valid, simple special case, not a solver failure — a pure subset-sum over
  single-difficulty size-1 items is the easy path through the same backtracking code, not a
  separate code path.

### `src/db/quizzes.ts`

- **Current state (line 1):** ownership comment listing exactly this packet's five operations plus
  three later-phase operations (openRoom/closeQuiz/materializeTemplates — not built here, §4/§8a).
- **Required edit:**
  - `createDraft(bank: BankContract, req: CreateQuizDraftRequest, createdBy: string):
    Promise<CreateQuizDraftResponse | { pooExhausted: true }>` — calls `selectQuestions`, on success
    inserts the `quizzes` row (`status='draft'`) and `quiz_questions` rows in one `DB.batch(...)`,
    then calls `bank.getByIds` for the response's `questions` (AC-7/8/9/10/11).
  - `reshuffleDraft(bank, quizId): Promise<ReshuffleQuizResponse | { conflict: 'not_draft' } |
    { poolExhausted: true }>` — reads the quiz row's own stored `type`/`questionCount`/
    `difficultyMix`, re-runs `selectQuestions`, on success replaces `quiz_questions` (delete +
    insert in one `batch()`) (AC-13/14/15).
  - `lockQuiz(bank, quizId): Promise<LockQuizResponse | { conflict: 'not_draft' | 'not_configured' }>`
    — validates AC-18's config-complete check first, resolves current `quiz_questions` ids, computes
    the next `quiz_number` + a fresh `room_code` (§3), calls `bank.claimUnused`, branches short vs.
    full per AC-16/AC-19, only writes `status`/`quiz_number`/`room_code` on the full-success branch
    (AC-16b).
  - `updateParams(quizId, patch: UpdateQuizParamsRequest, currentRow):
    Promise<UpdateQuizParamsResponse | { conflict: 'not_editable' } | { validationError: string }>`
    — merges `patch` onto `currentRow`, runs AC-22/23/24/25/26's validation-and-derivation pipeline,
    writes the merged row.
  - `cancelQuiz(quizId): Promise<CancelQuizResponse | { conflict: 'terminal' }>` — AC-30/31/32.
  - `listQuizzes(req: ListQuizzesRequest): Promise<ListQuizzesResponse>` — a plain paginated
    `SELECT` over `quizzes` (optionally `WHERE status = ?`), ordered newest-first, projected
    through the same `toAdminSummary` used everywhere else — no new response shape invented
    (AC-35/36).
  - A shared `toAdminSummary(row): QuizAdminSummary` projection used by `updateParams`/`cancelQuiz`/
    `listQuizzes`'s responses.
- **Estimated diff:** ~290 LOC. If it grows past ~320 LOC in practice, split the lock/claim logic
  into a sibling file (`db/quizzes-lock.ts`) rather than letting one file absorb everything — a
  judgment call for the implementer, not a hard requirement (mirrors Sprint 2's own note about
  `db/bank.ts`, `todos/sprint 2/...:400-405`).
- **Subtleties:** `lockQuiz`'s ordering matters (AC-21): the config-complete check must run, and
  fail, **before** `claimUnused` is ever called — reversing that order would waste real bank
  questions on a draft that was never going to lock successfully anyway.

### `src/routes/quizzes.ts`

- **Current state (line 1):** ownership comment already naming every route (including `GET
  /api/admin/quizzes`) and its core transition rule precisely — treat it as a correct one-line
  spec, not a placeholder.
- **Required edit:** a Hono sub-app, every route (six, including the list route) behind
  `.use('*', requireRole('admin'))` at the sub-app's mount point (AC-33). Each route thinly
  delegates to the corresponding `db/quizzes.ts` function and maps its result/conflict variants to
  the status codes in `API.md:110-115` and this packet's AC-15/18/28 judgment calls. The `PATCH`
  handler additionally checks the raw parsed body for forbidden keys before constructing the typed
  `UpdateQuizParamsRequest` (AC-28, §8b). `GET /` parses `PageRequest`'s `limit`/`offset` and the
  optional `status` filter from query params, matching the other four `PageResponse<T>` routes'
  existing parsing convention exactly (AC-36) — do not invent a new query-param shape for this one.
- **Estimated diff:** ~165 LOC (was ~140; +25 for the list route and its pagination/filter parsing).
- **Subtleties:** `404` (AC-34) must be checked before any status/config-conflict branch — a
  `db/quizzes.ts` function that receives a nonexistent `quizId` should return a distinguishable
  "not found" outcome the route maps to `404` ahead of every other conflict mapping. The list route
  has no `:id` and no such check — it 403s on role alone (AC-33) and otherwise always succeeds,
  even with zero rows.

### `src/index.ts`

- **Current state (line 1):** ownership comment describing the eventual full app; may already
  have BANK's mounts if Sprint 2 has landed by build time.
- **Required edit:** mount `routes/quizzes.ts` at `/api/admin/quizzes`. Merge additively — do not
  overwrite any existing AUTH/BANK mounts, and do not attempt to wire the cron `scheduled()`
  handler, which belongs to SCHEDULER's own phase.
- **Estimated diff:** ~5 LOC (additive only).
- **Subtleties:** if this file still has only its ownership comment (Phase 1/2 haven't landed
  either), construct the minimal `Hono<{ Bindings }>` app scoped to exactly this packet's mount,
  same as Sprint 2's own `index.ts` behavior spec did for BANK
  (`todos/sprint 2/...:442-455`).

### `src/bindings.ts` (new, only if still missing)

- **Current state:** does not exist (confirmed).
- **Required edit:** if Sprint 1/2 haven't created it by build time, create it with **exactly**
  the shape Sprint 2's own packet specifies (`todos/sprint 2/...:336-343`) — do not invent a
  divergent shape. If it already exists, this packet does not touch it.
- **Estimated diff:** ~15 LOC (0 if already present).

### `fixtures/quizzing/selection-bank.csv` (new)

- **Current state:** does not exist.
- **Required edit:** a CSV fixture (same format as `fixtures/bank/`'s existing files, per BANK's
  CSV shape) sized to exercise the solver: enough standalone questions across `easy`/`medium`/
  `hard` and at least three passage groups (sizes 4 and 5, at least one with **mixed** internal
  difficulty) so AC-2/AC-4/AC-5 run against real fixture data, not only synthetic unit-test
  candidates.
- **Estimated diff:** N/A (fixture data).
- **Subtleties:** this fixture is imported through BANK's own (Sprint 2) import routes in the
  manual QA steps (§12b) — it does not require a new import code path, only new fixture content.

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| A short lock (AC-16) permanently orphans real bank questions to a draft quiz that never actually schedules | Med (any concurrent admin action) | Low-Med — a real, accepted cost of the no-`release()` design, not a silent surprise | AC-16/17 test it explicitly and document it as expected; `CONTRACTS.md:102-105` already accepts this trade-off deployment-wide |
| The backtracking solver's node-count safety cap is set too low, causing false `pool_exhausted` on a genuinely satisfiable but deeply-constrained draw | Low | Med — an admin sees a spurious 409 | AC-5's fixture includes a deliberately awkward mixed-difficulty case to size the cap realistically; the cap is a named, tunable constant, not hardcoded inline |
| `lock`'s config-complete check (AC-18) is skipped or ordered after `claimUnused`, wasting real questions on an unlockable draft | Low | High — real, irreversible bank-pool damage | AC-21 explicitly asserts `claimUnused` is never called before the check passes; TDD per §8b |
| `PATCH`'s effective-merged-row validation (AC-22/23) is implemented against only the request body's fields, silently accepting an invalid `graceSec`/`marksWrong` combination that only becomes invalid once combined with the *existing* stored value | Med | Med — a stored row could violate its own CHECK constraint's intent even if the raw SQL still technically passes (the DB-level CHECK is null-tolerant, precisely to allow partial PATCHes — so a handler-level oversight here wouldn't even 500, it would just silently store a bad combination) | AC-22/23 explicitly specify "effective merged row," not "request body in isolation" |
| `windowSec`'s auto-derivation (AC-25) fires on every `PATCH` regardless of whether `windowSec` was explicitly supplied, silently overwriting an admin's deliberate override | Low | Med | AC-25 explicitly branches on "not also supplied," and this is called out as a named subtlety in §3 |
| Room-code collision retry (§3) loops indefinitely under a bug that always regenerates the same value | Very low | Low | cap retries at a small fixed count (e.g. 10) before failing loudly with a 500 — worth a defensive test, not a documented AC since the docs never anticipated this failure mode at all |

## 11. Rollback / Revert Plan

1. `git revert <sha>` for this packet's commit(s) — no schema migration was added (§1), so there is
   no `migrate:down` step.
2. Redeploy the previous Worker version (`wrangler deploy` from the reverted commit, or Cloudflare's
   dashboard rollback if already deployed).
3. Verification: `curl -X POST .../api/admin/quizzes` (with valid admin auth) returns `404` from
   Hono's default handler post-revert (the route no longer exists), not any of this packet's own
   status codes.
4. **State-dependent fork:** if any real quiz was drafted and/or locked via this module before the
   revert was needed, its `quizzes`/`quiz_questions` rows and any `questions.used_in_quiz_id`
   stamps from a real `claimUnused` call are **not** automatically undone by a code revert — there
   is no `release()` (CONTRACTS.md §3) to call even manually. If a bad quiz genuinely needs
   undoing, the only path is a direct, manual `UPDATE quizzes SET status = 'cancelled' WHERE id =
   ?` (never delete the row or its retired questions — deleting would silently break BANK's
   `used_in_quiz_id` foreign key and this packet's own no-release acceptance).
5. Notify: single-operator deployment (per `COUNCIL_FINDINGS.md`'s repeated framing) — notify the
   project owner directly; no separate ops channel exists yet (TELEGRAM's alert channel is Phase 6).

## 12. Verification + Definition of Done

### 12a. Automated verification

```bash
npm run typecheck        # tsc --noEmit — must pass with zero errors
npm test                 # vitest run — every AC-1..34 test must pass
git diff -- migrations/0001_init.sql   # must be empty (Hard NO)
git diff -- src/core/api.ts            # must be empty (Hard NO)
git diff -- src/core/contracts.ts      # must be empty (Hard NO)
```

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | Draft creation, happy path | `wrangler dev` locally, with BANK's `seed-bank.csv`/`.zip` and this packet's `selection-bank.csv` already imported; `curl -X POST .../api/admin/quizzes` with a valid body as an admin session | `200`, `status: 'draft'`, `questions.length === questionCount`, no `roomCode`/`quizNumber` anywhere in the response | Not Run |
| BE-2 | Reshuffle then compare | `POST .../:id/reshuffle` on the BE-1 draft, twice in a row | Each call 200s with a `questions` array; at least one of the two differs from the original draw (not a hard requirement if the bank happens to be too small to differ, but should hold on the real seed fixture) | Not Run |
| BE-3 | PATCH scoring params, happy path | `PATCH .../:id` with `timePerQSec`, `graceSec`, `marksCorrect`, `marksWrong`, `maxSpeedBonus` (no `windowSec`) | `200`, response's `windowSec` equals `questionCount × timePerQSec + 300`, `lobbyOpensAt`/`endsAt` both non-null and consistent with `scheduledAt` | Not Run |
| BE-4 | PATCH invalid grace/marks | `PATCH .../:id` with `graceSec >= timePerQSec` (using the value already stored from BE-3) | `400`, row unchanged | Not Run |
| BE-5 | Lock, happy path | `POST .../:id/lock` on the BE-3 quiz | `200`, `{locked: true, roomCode, quizNumber}`; a direct DB read shows `status='scheduled'` and every previously-`NULL` column now set | Not Run |
| BE-6 | Lock, already locked | `POST .../:id/lock` again on the same quiz | `409` | Not Run |
| BE-7 | Short lock | Manually pre-claim one of a fresh draft's drawn questions via a direct `claimUnused`-equivalent DB write (simulating a concurrent admin), then `POST .../:id/lock` | `200`, `{locked: false, requestedCount, claimedCount}`; DB shows `status` still `'draft'` | Not Run |
| BE-8 | Reshuffle recovers from a short lock | Following BE-7, `POST .../:id/reshuffle` | `200`, fresh `questions` returned; a DB check confirms the AC-16-claimed question(s) remain permanently `used_in_quiz_id`-stamped even though they're no longer in this quiz's `quiz_questions` | Not Run |
| BE-9 | Cancel | `POST .../:id/cancel` on a `'scheduled'` quiz | `200`, DB shows `status='cancelled'` | Not Run |
| BE-10 | Cancel, terminal state | `POST .../:id/cancel` again | `409` | Not Run |
| BE-11 | Pool exhaustion | `POST /api/admin/quizzes` requesting a `count`/`difficultyMix` the seeded bank cannot satisfy (e.g. more `hard` questions than exist) | `409`, no rows written | Not Run |
| BE-12 | Auth gate | `POST /api/admin/quizzes` with no session, then with a `student` session | `401`, then `403` | Not Run |
| BE-13 | List, draft included | `GET /api/admin/quizzes` right after BE-1's draft creation, before locking | `200`, `items` includes the BE-1 draft with `status: 'draft'` and its `quizId` — this is the only route in the system that can hand that id back after the creating session is gone | Not Run |
| BE-14 | List, status filter | `GET /api/admin/quizzes?status=scheduled` after BE-5's lock | `200`, `items` includes the BE-5 quiz and excludes any still-`'draft'` quiz from BE-1-equivalent fixtures | Not Run |

#### Frontend / UI

N/A — this packet is backend-only (§4). The admin console's quiz-builder UI is a separate
mockup/frontend track. If a frontend consumer is added before this note is updated, add FE cases
here and fail this packet's Definition of Done until they exist.

#### Chrome DevTools / extension verification

N/A — no browser surface ships in this packet (same reasoning as Frontend/UI above).

#### Operator-executed (post-cutover, see AC-OPERATOR)

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| OP-1 | Sanity-check `WINDOW_SLACK_SEC` | A human reviews whether 300 seconds of slack feels right against a real question set's actual reading/navigation overhead, once real students have run a quiz (post Phase 4) | Constant adjusted in `core/config.ts` if the real-world feel is off; not a blocker for this packet | Not Run |
| OP-2 | Sanity-check room code format | A human confirms `QNT-####` (4 digits) reads well next to the real Telegram post copy (`PLAN.md:581`'s example) before Phase 6 ships | Format adjusted if not, still in `core/config.ts` | Not Run |

### 12c. Definition of Done

- [ ] AC-1 through AC-36 satisfied.
- [ ] §12a passes locally (and in CI, once CI exists — no CI config exists in this repo yet;
  flag rather than invent one here, same as Sprint 2's own packet noted).
- [ ] BE-1 through BE-14 have Status ≠ `Not Run` (target: `Pass`).
- [ ] OP-1 through OP-2 completed by the operator, or explicitly waived (record the waiver in §5).
- [ ] No `<INPUT_REQUIRED>` remains in §5 — none do (§5).
- [ ] §8a Hard NO list respected — `git diff` on `migrations/0001_init.sql`, `src/core/api.ts`, and
  `src/core/contracts.ts` is empty.
- [ ] §11 Rollback plan rehearsed mentally.

---

End of Codex Task Packet — `claude-task--001`
