# claude-task--001: Build QUIZZING run + SCHEDULER open/close — join, seat claim, answer-and-advance, self-paced timing, resume, 120-client load test

**Sprint:** 4  **Slug:** `quizzing-run-scheduler-open-close`  **Status:** Draft

> Phase 4 per `todos/PROGRESS.md`'s packet table (depends on Phase 1/AUTH, Phase 2/BANK, Phase
> 3/QUIZZING-creation — all tracked `done` as **specs**, none built as code yet: every file this
> packet touches is still a single-line ownership comment, confirmed by reading each one directly).
> Every doc this packet cites (`QUIZZING.md` §5, §10, §12; `SCHEDULER.md` §3–4.1 and its "Failure
> alerts" subsection; `API.md`'s QUIZZING-run section; `CONTRACTS.md` §4–5; `src/core/contracts.ts`;
> `src/core/api.ts`; `migrations/0001_init.sql`) is marked resolved/final — see `AUDIT.md` §11 and
> `COUNCIL_FINDINGS.md`'s 2026-09-05 resolution log. This packet does not re-open any of those
> decisions; it only turns them into code. **QUIZZING.md §6 (Results — scoring tally at close,
> ranking, leaderboard/review routes) is explicitly Sprint 5's scope, not this packet's** — see §4
> for exactly where this packet's `closeQuiz` stops.

---

## 1. Context

QUIZZING's four sub-areas map one-to-one onto release phases (`QUIZZING.md:16-21`): Creation
(Phase 3, done as a spec — `todos/sprint 3/claude-task--001--quizzing-creation-draft-lock-reshuffle.md`),
**Run (Phase 4, this packet)**, Results (Phase 5), Boards (Phase 7). SCHEDULER "lands across Phases
3–7" (`SCHEDULER.md:5`) and is cross-cutting; this packet takes only its **Open** and **Close**
minute-tick passes (`SCHEDULER.md:100-104`) plus the "Failure alerts" subsection riding the same
tick (`SCHEDULER.md:125-139`) — **not** the hourly materialize pass (§4.2) or the weekly board cron
(§4.3), both Sprint 7's scope per `todos/PROGRESS.md`'s row 7.

**Nothing in `src/` implements this yet** — confirmed by reading every file this packet touches:

- `src/routes/play.ts:1` — names all seven run routes plus the open-quiz list, already accurately
  as a one-line spec: idempotent join, discriminated answer with retry-replay, deadline vs.
  `ends_at` distinction, `estimatedUnlockAt` as a UI hint.
- `src/db/play.ts:1` — `quiz_seats` table, the conditional seat-claim write, and `openRoom`
  (seeds seats, warms `question:<quizId>` KV as `ServedQuestion`).
- `src/db/results.ts:1` — `participants`/`answers` tables, answer-and-advance with retry-replay,
  scoring at write time with the `elapsed_ms` clamp, and **`closeQuiz` only ranks the
  already-maintained `total_score` … after winning the `board_computed_at` claim** — this file's
  own stub comment already draws the exact line this packet stops at (§4 below).
- `src/db/quizzes.ts:1` — already has real code from Sprint 3 (`createDraft`/`reshuffleDraft`/
  `lockQuiz`/`updateParams`/`cancelQuiz`/`listQuizzes`), plus its own ownership comment naming
  `openRoom, closeQuiz (claims board_computed_at atomically before ranking), materializeTemplates`
  as later-phase content sharing the file. This packet adds `closeQuiz`'s **claim mechanism only**
  here — additively, without touching Sprint 3's existing exports (§8a).
- `src/core/scoring.ts:1` / `src/core/grading.ts:1` — one-line stubs naming exactly this content
  ("base marks plus linear-decay speed bonus," "MCQ compare, TITA tolerance").
- `src/services/cache.ts:1` — KV wrapper stub naming `question:<quizId>` typed as `ServedQuestion`,
  never `QuestionFull`, and the KV-eventual-consistency rule this packet must respect.
- `src/services/observability.ts:1` — SCHEDULER-owned dual-channel alert sender stub.
- `src/index.ts:1` — "Hono app + route mounting + `scheduled()` cron handler" stub; today mounts
  nothing (or, if Sprint 1–3 have landed by build time, mounts their routes only — no cron handler
  exists yet either way).
- `src/bindings.ts` — **does not exist** (confirmed, same gap Sprint 3's packet found and
  conditionally filled).

**The run, in the module's own words** (`QUIZZING.md:107-183`): one round trip per question — "The
response that accepts an answer *is* the response that carries the next question." `join` claims a
seat and returns quiz meta + question 1, lazily opening the room via `openRoom` first if
`lobby_opens_at <= now` and cron hasn't ticked yet (`QUIZZING.md:115`); it is idempotent — a retry
by a seat-holder returns their existing seat and current question, not an error
(`QUIZZING.md:115`, COUNCIL_FINDINGS.md #14). `answer` accepts a `SubmitAnswerRequest` discriminated
on the question's own `format` and replays the original result on a duplicate at the same position
(`QUIZZING.md:117`, COUNCIL_FINDINGS.md #35). `skip`/`timeout` are the same shape as `answer` minus
grading. `status` exposes `estimatedUnlockAt` as a UI hint only — the client still gates on
`board_computed_at`/423 (`QUIZZING.md:120`, COUNCIL_FINDINGS.md #42) — **that gate itself is a
Results-route concern (§6), not built here** (§4).

**This is a self-paced quiz at the window level, not just per-question** (`QUIZZING.md:122-130`).
`scheduled_at`/`lobby_opens_at` is when the room opens for joining; `ends_at` is when it stops
accepting *new* joins. A student's own deadline is their own
`participants.started_at + quizzes.window_sec` — a late joiner gets the full duration starting from
their own join. There is no `startQuiz()` and no `'running'` status (`QUIZZING.md:127-130`,
`src/core/contracts.ts:9-13`).

**Seat claim** (`QUIZZING.md:132-145`, `migrations/0001_init.sql:220-230`): D1 has no interactive
transactions, so seats are pre-seeded `1..seat_cap` at room open and claimed with one conditional
`UPDATE … WHERE seat_no = ? AND user_id IS NULL RETURNING seat_no`. Zero rows means try another
seat. `quiz_seats.UNIQUE(quiz_id, user_id)` stops a retried claim from ever winning a second seat
for the same user — a constraint hit here is "already joined," not an error
(`migrations/0001_init.sql:226-229`, COUNCIL_FINDINGS.md #14).

**Timing** (`QUIZZING.md:147-161`, `migrations/0001_init.sql:264-270`): `elapsed = answered_at −
served_at`, both server-measured. `served_at` costs no extra write — question *n*'s `served_at` is
question *n−1*'s `answered_at`, already stored; `served_at(1) = participants.started_at`.
`elapsed_ms` is clamped to `[0, limitMs]` before it feeds `core/scoring.ts`, so an
abandoned-then-resumed question can't inflate the speed bonus or the tie-break
(COUNCIL_FINDINGS.md #38).

**Rules enforced on every request** (`QUIZZING.md:163-176`): only the position a student is on may
be answered (`n+1`/`n−1` both refused, except the one documented replay exception, AC-40 below);
rejection applies past the question's own `limitMs` *or* this student's own
`started_at + window_sec` deadline — never a shared `ends_at`; options are fixed A/B/C/D order; no
feedback in any response; a passage is sent once per group with a structured `groupIndex: {index,
size}` (`src/core/contracts.ts:103-106`), not a rendered string, so it can't collide with
`QuestionFull.groupPosition`; TITA carries the same `limitMs` as MCQ; `SubmitAnswerRequest` is
discriminated on format so a submission can't omit the field it needs
(`src/core/api.ts:292-294`).

**No server-side per-student timer** (`QUIZZING.md:178-183`): nothing wakes up when a clock expires.
A student who closes the tab leaves no trace until they return or `closeQuiz` scores unreached
positions as 0 — **`closeQuiz` itself is Sprint 5's scoring-tally job (§6), not this packet's.**

**SCHEDULER's Open pass** (`SCHEDULER.md:100-107`): `lobby_opens_at <= now AND status = 'scheduled'`
→ `openRoom(quizId, now)`. **The Close pass's predicate** (`SCHEDULER.md:104,109-113`):
`ends_at + window_sec <= now AND status = 'open' AND board_computed_at IS NULL` → `closeQuiz(quizId,
now)` — waits for the *last possible finish*, not the join window closing, because a late joiner
still has a full `window_sec` running. **Failure alerts** (`SCHEDULER.md:125-139`) ride the same
tick: a quiz past its safe-close point by more than a grace window with `board_computed_at` still
`NULL` (a close attempt has genuinely not happened), and any `telegram_posts` row at
`status = 'failed'` — both send the same dual-channel alert (Telegram alert chat + email) via
`src/services/observability.ts`, owned by SCHEDULER, not a separate module (`MODULES.md §6`).

**Where this packet draws the `closeQuiz` line, precisely** — the one design decision this packet
makes that isn't dictated verbatim by a single doc line (§3 elaborates further): `SCHEDULER.md`
§4.1's Close pass is unambiguously this packet's scope (it rides the same minute tick as the Open
pass, and its predicate/wiring is SCHEDULER-owned code this packet must write). But `closeQuiz`'s
*ranking* — "compute the ranking once via `core/leaderboard`… write `participants.rank`… cache the
board to KV… fire TG-4" (`PLAN.md:337-345`) — is verbatim QUIZZING §6 Results content, which this
packet's own citation scope explicitly excludes ("results is Sprint 5"). This packet therefore
implements `closeQuiz`'s **atomic claim on `board_computed_at`** (the one piece COUNCIL_FINDINGS.md
#7 treats as a correctness-critical mechanism independent of ranking) and the terminal
`status = 'ended'`/`ended_at` write, wired to the cron predicate — but returns a `CloseResult` with
`top10: []` and a real `participantCount`, explicitly commented as a seam Sprint 5 fills in with
`core/leaderboard.ts`. No caller built in *this* packet's shipped surface ever reads `top10` (the
results routes and TELEGRAM's `claimAndSend` are both later phases), so shipping the placeholder
now costs nothing and lets Sprint 5 land the ranking without ever having to re-derive or retrofit
the claim-then-rank race protection.

**Schema is already final for this phase** — `migrations/0001_init.sql:220-278` (`quiz_seats`,
`participants`, `answers`); `:104-112` (`quizzes.board_computed_at`/`opened_at`/`ended_at`). No new
migration is needed; every column this packet writes already exists.

**Module boundary this packet must respect:** the run resolves `quizId → questionIds` via
`quiz_questions` and calls `BankContract.getByIds` (consumed as a contract only, per Sprint 3's own
precedent — `todos/sprint 3/...:52-56`) to build the KV-cached `ServedQuestion[]`; it never asks
BANK to read `quiz_questions` itself.

**Reusable pattern to mirror:** Sprint 3's packet is "the second module with real logic in this
repo" and explicitly built the `Bindings` type (`src/bindings.ts`) and `vitest.config.ts` if still
missing, following Sprint 2's precedent. Both are **still missing** as of this writing (confirmed).
This packet applies the identical rule: create them with Sprint 2's exact spec'd shape if absent by
build time, merge additively if present.

## 2. Objective

After this ships: a student can discover open quizzes (`GET /api/quizzes/open`), join one by room
code and get their seat plus question 1 in one response — idempotently, even across a dropped
connection or a retried request — resume mid-run on reload with their clock intact, answer or skip
or time out each question and always get the next one (or a finish summary) in the same round trip,
with every answer scored server-side at write time using a clamped `elapsed_ms`. A room opens
automatically at `lobby_opens_at` via cron, or lazily the instant the first student tries to join a
missed tick. The minute cron's Close pass reaches every quiz past its safe-close point
(`ends_at + window_sec`) and atomically claims it exactly once, with the ranking itself left as an
explicit, documented seam for Sprint 5. A failure-alert check on the same tick fires when a close
attempt has genuinely not happened. A 120-concurrent-client load test proves the seat claim races
correctly, per-answer scoring matches a locally recomputed expectation, and the median
answer-and-advance round trip stays under budget.

## 3. Assumptions

- **`closeQuiz`'s scope split (§1's last subsection) is this packet's own judgment call**, not a
  literal doc instruction — flagged here explicitly rather than buried. The alternative (build full
  ranking now) would duplicate Sprint 5's stated scope (`todos/PROGRESS.md` row 5: "close job,
  claim-first ranking, score-on-finish, deadline-gated review") and risk Sprint 5 having to *rewrite*
  rather than *extend* this packet's work. The alternative-alternative (don't wire the Close pass at
  all) would leave `SCHEDULER.md` §4.1's Close predicate — which this packet is explicitly told to
  ground — unimplemented. The claim-only stub is the seam that satisfies both constraints at once.
- **`limitMs = timePerQSec × 1000`.** `grace_sec` is a threshold *inside* the same clock that
  determines the speed-bonus curve (`PLAN.md:359-368`: "`t ≤ grace → bonus = max_bonus`"), not
  additional time on top of `time_per_q_sec` — there is no separate "grace period extends the
  clock" concept anywhere in the docs, and `QUIZZING.md:173` states TITA carries "the same `limitMs`
  as MCQ," consistent with `limitMs` being a single per-quiz-question constant.
- **The KV question cache stores `ServedQuestion[]` indexed by position (1-based), with
  `serverSentAt` as a `0` placeholder in every cached entry.** `serverSentAt` is inherently
  per-student (it's `served_at`, computed from *this* participant's own progress —
  `PLAN.md:296-299`), so it cannot be baked into a quiz-wide cache entry. Every route that serves a
  question copies the cached static entry and overwrites `serverSentAt` with the real,
  per-participant value before responding. This is the concrete mechanism behind "typed and stored
  as `ServedQuestion`, never `QuestionFull`" (`CONTRACTS.md:127-128`) — the type is satisfied
  exactly, the one dynamic field is patched in per request, never cached per-student.
- **`estimatedUnlockAt = ends_at + windowSec×1000 + ESTIMATED_UNLOCK_BUFFER_MS`.** No formula is
  given anywhere in the docs beyond "a UI hint" (`QUIZZING.md:200`, COUNCIL_FINDINGS.md #42); this
  packet reuses the same safe-close point SCHEDULER computes (`ends_at + window_sec`) plus a small
  named buffer (`core/config.ts`) for perceived cron lag. Since the client never gates on this value
  (§1, AC-55), the exact number has zero correctness impact — flagged as an `OP` sanity-check item
  in §12b, not a blocker.
- **`FAILURE_ALERT_GRACE_MS`, matching "more than a couple of minutes" (`SCHEDULER.md:130-133`).**
  No exact number is given. This packet picks 2 minutes as a named constant in `core/config.ts`,
  flagged the same way as Sprint 3's own undocumented-constant precedent (`WINDOW_SLACK_SEC`).
- **`SEAT_CLAIM_MAX_RETRIES = 5`.** Not specified anywhere — the docs only say "pick another and
  retry" (`QUIZZING.md:143`) with no bound. A small fixed retry cap before genuinely exhausting the
  seat list (as opposed to giving up after one lost race) mirrors Sprint 3's own room-code-collision
  retry-cap precedent (`todos/sprint 3/...:626`).
- **`skip` and `timeout` write identically-shaped `answers` rows** — `migrations/0001_init.sql:257-278`
  has no column distinguishing "student clicked skip" from "client detected timeout," and no doc
  claims one exists. This packet treats them as the same DB write (chosen_option/numeric_value both
  NULL, all marks 0) triggered by two different client-side callers, both ending in the identical
  `recordUnanswered` path server-side. Not a blocker — the schema genuinely has no room for the
  distinction, and no requirement (ROOM-17 or otherwise) asks the *server* to remember which one it
  was, only that the client can send either.
- **Join's "not currently joinable" cases collapse to a single `404`.** `API.md:153` documents only
  `404` (bad code) and `409` (room full) as this route's extra status codes. A room that hasn't
  opened yet (`status='scheduled'` and `lobby_opens_at > now`, i.e. more than 5 minutes before
  `scheduled_at`), or one that's `'ended'`/`'cancelled'`, has no separate documented code — this
  packet folds all "this room code doesn't currently resolve to a joinable room" cases into `404`,
  distinguished only by the error message, mirroring Sprint 3's own precedent for reusing a status
  code across distinct reasons (`todos/sprint 3/...:355-363`, AC-18).
- **The load-test script authenticates 120 distinct test users by minting session cookies directly**,
  the same HMAC-SHA256-over-JSON-payload construction AUTH's own Sprint 1 packet specifies
  (`todos/sprint 1/claude-task--001--google-auth-roles-guards.md:348`), using a `SESSION_SECRET`
  supplied to the script via environment variable — not by driving 120 real Google OAuth flows,
  which has no automatable equivalent. This requires 120 pre-seeded `users` rows (a one-time
  `wrangler d1 execute` fixture insert) and the deployed/local Worker's real `SESSION_SECRET`. Both
  are called out as `AC-OPERATOR` items in §12b, since running this against "a deployed staging
  environment" (`PLAN.md:740`) is inherently an operator action requiring real secrets, not
  something the automated test suite can prove in CI.
- **The KV cache write (`question:<quizId>`) carries no explicit TTL.** Nothing in the docs calls
  for one, and the value is small and stops mattering once the quiz ends; omitting `expirationTtl`
  is simpler than picking an arbitrary lifetime with no stated requirement behind it.
- **`AUTH`/`BANK`/`QUIZZING`-creation are contracts, not code, as of this writing** — this packet
  is written against `AuthContract`, `BankContract`, and Sprint 3's already-real `db/quizzes.ts`
  exports (`createDraft`/`lockQuiz`/etc., which *are* real code) as given interfaces. If Phase 1/2
  haven't landed as code by build time, stub `requireAuth`/`currentUser` and
  `listUnused`/`claimUnused`/`getByIds` behind the same import paths Sprint 3's packet used, rather
  than forking the interface.

## 4. Out of Scope

- **QUIZZING §6 Results — `closeQuiz`'s ranking, `core/leaderboard.ts`, `participants.rank`,
  the `board:<quizId>` KV cache, TG-4 firing** (`QUIZZING.md §6`, `PLAN.md:337-345`) — Sprint 5, per
  `todos/PROGRESS.md` row 5 and this packet's own citation scope ("results is Sprint 5," see §1's
  last subsection for exactly what this packet's `closeQuiz` *does* implement instead).
- **The results HTTP routes** — `GET /api/quizzes/:quizId/leaderboard`, `/review`,
  `GET /api/students/me/history`, the 423 gate itself (`QUIZZING.md §6`, `API.md:184-217`) — Sprint
  5. `src/routes/results.ts` is untouched by this packet.
- **`materializeTemplates`, recurring templates, `computeWeeklyBoards`, the weekly board cron**
  (`SCHEDULER.md §4.2-4.3`) — Sprint 7, explicitly excluded from this packet's SCHEDULER citation
  scope.
- **`TelegramContract.claimAndSend`, TG-1…TG-8, `src/db/telegram.ts`, `src/services/telegram.ts`**
  (Sprint 6) — the failure-alert sender (§9) makes its own raw Telegram Bot API call for the alert
  chat, deliberately **not** routed through `claimAndSend`/`telegram_posts` — alerts aren't part of
  the `telegram_posts`-tracked announcement system (`MODULES.md §6`: "owned by SCHEDULER, not a
  separate module").
- **The admin report export** (`GET /api/admin/quizzes/:id/report`, `QUIZZING.md §7.1`) — Phase 8.
- **Any student-facing UI** (`web/src/...`) — this packet is backend-only, mirroring Sprint 2/3's
  own framing.
- **`AUTH`/`BANK`/QUIZZING-creation's own implementations** — consumed as contracts/already-real
  code only (§1, §3); this packet does not modify `src/routes/quizzes.ts`, `src/routes/auth.ts`,
  `src/routes/bank.ts`, or any of Sprint 1–3's `db/*.ts` exports.
- **Distinguishing skip from timeout at the data layer** (§3) — the schema has no column for it and
  no requirement asks for one; both produce the same `recordUnanswered` write.

## 5. Open Questions / `<INPUT_REQUIRED>`

`(none)` — every genuine gap is resolved in §3 with a concrete, tunable default, flagged as this
packet's own judgment call where the docs don't state a formula or a bound. None block writing or
verifying an AC:

- `ESTIMATED_UNLOCK_BUFFER_MS`, `FAILURE_ALERT_GRACE_MS`, `SEAT_CLAIM_MAX_RETRIES` are tuning
  constants with no correctness impact — `OP` sanity-check items in §12b.
- **The `closeQuiz` scope line (§1, §3)** is this packet's own design decision, not a re-litigation
  of a settled doc question — flagged prominently rather than silently assumed, precisely because
  it's the one place this packet had to choose between two defensible readings of "ground in
  SCHEDULER's open/close passes" vs. "results is Sprint 5." Sprint 5's own packet must read this
  section before extending `closeQuiz` — it should replace the `top10: []`/ranking placeholder
  in-place, never touch the claim `UPDATE` this packet writes.
- **Load-test auth bypass (§3)** requires the real `SESSION_SECRET` and 120 pre-seeded users on
  whatever environment it runs against — `AC-OPERATOR` in §12b, not a blocker for the rest of this
  packet's automated ACs.

## 6. Pre-flight Checklist

- [ ] Required skill loaded: **`clean-code`** — always.
- [ ] Required skill loaded: **`prod-safety-gate`** — this packet's production surface is the live
  quiz run itself: a bug in the seat-claim retry, the position-enforcement check, or the
  retry-replay branch either strands a real student mid-quiz or corrupts a real score with no
  operator present to intervene (`SCHEDULER.md §1`: "no user in front of it").
- [ ] Required skill loaded: **`test-driven-development`** — the retry-replay branch (AC-40), the
  seat-claim race (AC-32/62), and the `closeQuiz` atomic-claim race (AC-18) are exactly the
  "looks right, isn't" concurrency logic this discipline catches; write the failing concurrent test
  before the implementation for all three.
- [ ] Required skill loaded: **`vibesec`** — every route in this packet is student-reachable,
  unauthenticated-by-default input (`SubmitAnswerRequest`'s discriminant, path params) reaching a
  scoring/write path; the secrecy test (AC-48) is the single test in this whole codebase that must
  never regress (`QUIZZING.md §12`).
- [ ] Working tree clean; branch up to date with `main`.
- [ ] Confirm whether Phase 1/2/3 have landed as code; if not, apply the stub-behind-the-same-import
  approach from §3 rather than blocking. Confirm Sprint 3's `db/quizzes.ts` real exports
  (`createDraft`/`lockQuiz`/etc.) are present and untouched before adding `closeQuiz` to the same
  file.
- [ ] Read before editing: `QUIZZING.md` §5, §10, §12 (`:107-183, 287-302, 327-353`), `SCHEDULER.md`
  §1, §3-4.1, §5 (`:10-30, 39-78, 93-139, 163-176`), `API.md:148-181`, `CONTRACTS.md:109-178`,
  `src/core/contracts.ts:95-165`, `src/core/api.ts:259-324`, `migrations/0001_init.sql:104-112,
  220-278`, `PLAN.md:243-390` (the quiz run + scoring, whole sections),
  `todos/sprint 3/claude-task--001--quizzing-creation-draft-lock-reshuffle.md` (whole file — the
  conventions this packet mirrors, and the exact `db/quizzes.ts` state this packet adds to).
- [ ] Re-read every AC in §7 before starting; note none are `AC-OPERATOR` except §12b's three `OP`
  constant-sanity-check items and the load-test's staging-auth items — every other AC is
  implementer-executed and automatable.

## 7. Acceptance Criteria

**Scoring / grading (`core/scoring.ts`, `core/grading.ts`) — pure, no D1/R2/network import**

- **AC-1.** `core/grading.ts` exports `isCorrectMcq(chosenOption: 'A'|'B'|'C'|'D', correctOption:
  'A'|'B'|'C'|'D'): boolean` — exact string match.
- **AC-2.** `core/grading.ts` exports `isCorrectTita(numericValue: number, correctAnswer: number,
  tolerance: number): boolean` — `Math.abs(numericValue - correctAnswer) <= tolerance`.
- **AC-3.** `core/scoring.ts`'s worked example (`PLAN.md:373-382`, `limit=30s, grace=5s,
  correct=+4, max_bonus=+2, wrong=-1`) is reproduced exactly by a unit test: answered at 4s → 6.00,
  12s → 5.44, 25s → 4.40, 29s → 4.08 (correct); any time, wrong → −1.00; skipped → 0.00.
- **AC-4.** `elapsed_ms` is clamped to `[0, limitMs]` **before** it is passed into the bonus formula
  — a caller passing a negative or over-limit raw value never produces a bonus outside
  `[0, max_bonus]` (clamping happens inside `core/scoring.ts`'s own function, not left to every
  caller to remember, per COUNCIL_FINDINGS.md #38).
- **AC-5.** Skipped/timed-out input (no `chosenOption`/`numericValue`) always scores `0` total,
  regardless of `marksWrong` — no negative marking for a non-attempt (`PLAN.md:370`).
- **AC-6.** A wrong answer scores exactly `marksWrong` (which the schema requires `<= 0`,
  `migrations/0001_init.sql:271-273` via `quizzes.marks_wrong`'s CHECK) with `speed_bonus = 0` —
  never combined with a positive speed bonus.

**KV question cache (`src/services/cache.ts`)**

- **AC-7.** The cached value under `question:<quizId>` is typed and constructed as
  `ServedQuestion[]` (one entry per position, 1-indexed) — a JSON-serialization test asserts the
  cached payload never contains the keys `correctOption`, `numericAnswer`, or `explanationMd`
  (the camelCase wire names, not DB column spellings, COUNCIL_FINDINGS.md #29), extending the
  secrecy test's coverage to the cache layer itself (CONTRACTS.md:127-128).
- **AC-8.** Every cached entry's `serverSentAt` is a `0` placeholder — verified never read directly
  by a route handler; every route that serves a question overwrites it with the real, per-request
  `served_at` before responding (§3).
- **AC-9 (the KV eventual-consistency rule).** When `join` lazily triggers `openRoom` (a missed
  cron Open tick), the response's `question` field is built from `openRoom`'s own **return value**
  — never from a fresh KV read of the key `openRoom` just warmed in the same request
  (`QUIZZING.md:293-295`, COUNCIL_FINDINGS.md #13). Verified: a test that makes the KV binding's
  `get` throw/return stale-null immediately after a `put` in the same test still produces a correct
  `JoinQuizResponse`.

**`openRoom` (`src/db/play.ts`)**

- **AC-10.** `openRoom(quizId, now)` is a no-op (`{ seatsSeeded: 0, alreadyOpen: true }`) when
  `status !== 'scheduled'` or `lobby_opens_at > now` — the predicate is checked *inside* the call,
  never assumed by the caller (`SCHEDULER.md:95-97, 106-107`).
- **AC-11.** On a matching predicate: seeds `quiz_seats` rows `1..seat_cap` via `INSERT OR IGNORE`
  — idempotent under a second invocation (a repeat call inserts zero new seat rows and reports
  `seatsSeeded: 0`, `alreadyOpen: true`, per `SCHEDULER.md §5`'s idempotency table).
- **AC-12.** Builds the full `ServedQuestion[]` (all positions, `serverSentAt: 0` placeholders) from
  `quiz_questions` + `BankContract.getByIds`, and warms `question:<quizId>` with it via
  `services/cache.ts`.
- **AC-13.** Sets `quizzes.status = 'open'`, `opened_at = now` in the **same batched write** as the
  seat seed (one `DB.batch(...)`, not two separate round trips).
- **AC-14.** Two concurrent `openRoom` calls for the same quiz never double-seed or double-flip —
  guarded by the predicate check plus `INSERT OR IGNORE`'s own idempotency (a concurrency test
  issuing both calls via `Promise.all` asserts `quiz_seats` ends with exactly `seat_cap` rows and
  `opened_at` set once).
- **AC-15.** `openRoom`'s return value (not a subsequent KV read) is what `join` uses to build
  question 1's payload when it triggers `openRoom` lazily (AC-9's concrete mechanism).

**Cron wiring — the minute tick (`src/index.ts`'s `scheduled()`)**

- **AC-16.** The Open pass queries `quizzes WHERE status = 'scheduled' AND lobby_opens_at <= now`
  and calls `openRoom(quizId, now)` for every match.
- **AC-17.** The Close pass queries `quizzes WHERE status = 'open' AND board_computed_at IS NULL
  AND ends_at + window_sec*1000 <= now` and calls `closeQuiz(quizId, now)` for every match
  (`SCHEDULER.md:104, 109-113`).
- **AC-18 (the atomic claim — the one piece of `closeQuiz` this packet fully implements).**
  `closeQuiz` runs `UPDATE quizzes SET board_computed_at = ?, status = 'ended', ended_at = ? WHERE
  id = ? AND board_computed_at IS NULL RETURNING id` as its first and only unconditional write.
  Two concurrent invocations for the same `quizId` (simulated via `Promise.all`) result in exactly
  one row transition — the loser's `UPDATE` affects zero rows (COUNCIL_FINDINGS.md #7).
- **AC-19.** On a winning claim: `CloseResult.participantCount` is a real `COUNT(*) FROM
  participants WHERE quiz_id = ?`; `CloseResult.top10` is `[]`, with an inline comment
  `// TODO(Sprint 5): replace with real ranking via core/leaderboard.ts — see claude-task--001
  (Sprint 4) §1/§3`; `boardComputedAt` is the claimed timestamp.
- **AC-20.** On a losing/duplicate claim (a second concurrent call, or any call after the quiz is
  already `'ended'`): re-reads and returns the same `CloseResult` shape (`participantCount`
  recomputed fresh, `top10` still `[]`) rather than erroring — "every other caller just reads the
  result" (`SCHEDULER.md:171`).
- **AC-21.** The Open/Close predicates structurally exclude `status = 'draft'` and
  `status = 'cancelled'` — a fixture with one quiz in each status, run through both passes,
  produces zero calls to `openRoom`/`closeQuiz` for either.

**Failure alerts (`src/services/observability.ts`, wired from `scheduled()`)**

- **AC-22.** After the Open/Close passes run, a check queries `quizzes WHERE board_computed_at IS
  NULL AND status = 'open' AND ends_at + window_sec*1000 + FAILURE_ALERT_GRACE_MS <= now` and calls
  `sendFailureAlert` once per match — this only fires when a close attempt has genuinely not
  happened, not merely the instant the deadline passes (`SCHEDULER.md:130-133`).
- **AC-23.** A second check queries `telegram_posts WHERE status = 'failed'` and calls
  `sendFailureAlert` once per row — runs without error against the table even though nothing writes
  to it yet in this packet's shipped surface (Sprint 6 is the writer); verified with an empty-table
  fixture producing zero alerts, not an error.
- **AC-24.** `sendFailureAlert` attempts **both** channels independently — a raw Telegram Bot API
  call to `TELEGRAM_ALERT_CHAT_ID` using `TELEGRAM_BOT_TOKEN`, and an email via the optional
  `ALERT_EMAIL` `send_email` binding if attached (`wrangler.toml:51-59`) — one channel being
  unavailable (unbound `ALERT_EMAIL`, or `TELEGRAM_ENABLED='false'`) does not skip attempting the
  other (verified with each channel individually disabled).
- **AC-25.** No dedup across ticks — invoking the same failing-quiz check twice in a row (two
  simulated ticks with the condition still true) sends the alert twice, not silently suppressed
  after the first (`SCHEDULER.md:135-136`: "keeps alerting every minute until someone fixes it").

**Join (`POST /api/quizzes/:code/join`, `src/routes/play.ts` + `src/db/play.ts`)**

- **AC-26.** Happy path: a valid `room_code`, `status = 'open'`, no existing `participants` row for
  this user — claims a seat via the conditional `UPDATE`, inserts a `participants` row
  (`started_at = now`, `current_position = 1`, all counters zeroed), and returns
  `JoinQuizResponse { meta, question }` where `question` is position 1 with `serverSentAt = now`
  and `limitMs = timePerQSec × 1000`.
- **AC-27 (idempotent join, the one COUNCIL_FINDINGS.md #14 names explicitly).** Repeating the
  identical join call for a user who already holds a `participants` row returns their **existing**
  `seat_no` (no re-claim attempted — no second `quiz_seats` write at all) and their **current**
  question via the same logic `/current` uses — `200`, not an error — verified across 5 repeated
  calls producing byte-identical `JoinQuizResponse.meta` each time.
- **AC-28.** A `UNIQUE(quiz_id, user_id)` constraint hit during a genuine concurrent double-join
  race (two simultaneous requests for a user with no prior seat, racing each other, not a
  sequential retry) is caught and handled as "already joined" — re-reads the now-existing
  `participants` row and returns it, never surfacing as a raw `500`.
- **AC-29.** Seat exhaustion (every `seat_no` already claimed by other users) returns `409` ("room
  full") — verified with a fixture pre-seeded to `seat_cap` capacity, all claimed.
- **AC-30.** A `room_code` matching no quiz, or matching a quiz not currently joinable (`'draft'`,
  `'cancelled'`, `'ended'`, or `'scheduled'` with `lobby_opens_at > now`, or past `ends_at`) returns
  `404` — this packet's own collapsed-status-code judgment call (§3).
- **AC-31.** A join on a `status = 'scheduled'` quiz whose `lobby_opens_at <= now` (a missed cron
  Open tick) lazily calls `openRoom` first, then proceeds to claim a seat in the **same request** —
  verified with a fixture where no cron tick has run.
- **AC-32.** The seat-claim retry loop tries a **different** unclaimed `seat_no` on each lost race,
  up to `SEAT_CLAIM_MAX_RETRIES` attempts, and only returns "room full" after genuinely exhausting
  every unclaimed seat — not merely after losing the first race (verified by forcing the first N-1
  picked seats to already be claimed by the time the write executes).
- **AC-33.** `POST /api/quizzes/:code/join` is mounted behind `requireAuth()` only — any signed-in
  role (student/admin/superadmin) may join; a request with no session gets `401`.

**Resume (`GET /api/play/:quizId/current`)**

- **AC-34.** For an existing, unfinished participant: returns `CurrentQuestionResponse { question,
  remainingMs }` where `question.position = participants.current_position`, and
  `remainingMs = max(0, limitMs - (now - servedAt))` — `servedAt` is
  `participants.started_at` for position 1, or `answers[current_position-1].answered_at_ms`
  for position > 1 — **never** `now` itself.
- **AC-35 (invariant 4 — reloading cannot reset the clock).** Two calls to `/current` several
  seconds apart show `remainingMs` decreasing by real wall-clock elapsed time between the two
  calls, and identical `question.serverSentAt`... no — identical underlying `servedAt` baseline;
  reloading never resets it (`QUIZZING.md invariant 4`).
- **AC-36.** `/current` for a user with no `participants` row for this `quizId` returns `404`.
- **AC-37.** `/current` for a participant whose `finished_at IS NOT NULL` returns `409` (already
  finished).

**Answer-and-advance (`POST /api/play/:quizId/answer`)**

- **AC-38.** `SubmitAnswerRequest` is discriminated on the *served question's own* `format` — an
  `mcq` position submitted without `chosenOption` (or with `numericValue` instead), or a `tita`
  position submitted without `numericValue`, is rejected `400` before any write
  (`src/core/api.ts:292-294`).
- **AC-39.** For a normal (non-replay) write, `request.position` must equal
  `participants.current_position` exactly — any other value is `400`, except the AC-40 replay case.
- **AC-40 (retry-replay — the one COUNCIL_FINDINGS.md #35 names explicitly, and the packet's
  single most important AC).** A request whose `position === current_position - 1` **and** for
  which an `answers` row already exists at `(quiz_id, user_id, position)` replays the
  **already-stored** result: the newly submitted `chosenOption`/`numericValue` in the retried
  request body is ignored entirely (the stored row is authoritative — invariant 3, "no changing
  it"); the reconstructed `AdvanceResult` (the next `ServedQuestion`, or `finished`) is identical to
  what the original successful call produced, returned `200`, never `409`.
- **AC-41.** `elapsed_ms = answered_at(now) − served_at`, clamped to `[0, limitMs]`
  (`core/scoring.ts`'s own clamp, AC-4), is what's written to `answers.elapsed_ms` and fed into
  `base_marks`/`speed_bonus` — a request answered well past `limitMs` (but still within the
  student's own window deadline) still clamps to `limitMs`, never an inflated raw value.
- **AC-42.** An answer submitted past **this student's own** `started_at + window_sec*1000`
  deadline is rejected `400` — evaluated against the participant's own row, never against
  `quizzes.ends_at` (`QUIZZING.md:166-167`, COUNCIL_FINDINGS.md #6).
- **AC-43.** An answer submitted past the *current question's own* `limitMs`
  (`served_at + limitMs < now`) is rejected `400` — enforced server-side independent of whether the
  client already auto-timed-out.
- **AC-44.** On a valid, non-replay write: `grading.ts` determines `is_correct`, `scoring.ts`
  computes `base_marks`/`speed_bonus`/`total_marks`, and exactly one `answers` row is inserted. A
  genuinely stale duplicate that is **not** the AC-40 replay case (i.e. `position <
  current_position - 1`) is rejected `400` by the position check (AC-39) before any `INSERT` is
  attempted — the `answers` PK is never relied on to catch this via a raw constraint-violation
  `500`.
- **AC-45.** `participants.total_score`/`correct_count`/`wrong_count`/`current_position`/
  `total_time_ms` are updated in the **same D1 batch** as the `answers` insert; `current_position`
  advances by exactly 1.
- **AC-46.** Answering the **last** position (`position === total`) sets
  `participants.finished_at = now` and returns `{ status: 'finished', totalScore, answeredCount }`
  — no `question` field, no leaked redacted data.
- **AC-47.** Answering any non-last position returns `{ status: 'next', question: ServedQuestion }`
  for `position + 1`, built by copying the warmed KV cache entry and overwriting `serverSentAt`
  with this write's real `answered_at` — never a fresh `QuestionFull` read that could leak a
  redacted field by mistake.
- **AC-48 (the secrecy test — QUIZZING.md §12, "must never regress").** Driving a full run through
  `join`/`answer`/`skip`/`timeout`/`current`/`status` and asserting **no response body at any point**
  contains the camelCase keys `correctOption`, `numericAnswer`, or `explanationMd` — coverage
  extends across `ServedQuestion`, `AdvanceResult`, `JoinQuizResponse`, `CurrentQuestionResponse`,
  `PlayStatusResponse` (COUNCIL_FINDINGS.md #29).

**Skip (`POST /api/play/:quizId/skip`)**

- **AC-49.** Writes an `answers` row with `chosen_option = NULL`, `numeric_value = NULL`,
  `is_correct = NULL`, `base_marks = speed_bonus = total_marks = 0`; same position/deadline/replay
  rules as `answer` (AC-38 minus the format-discriminant check, AC-39, AC-41-45 apply identically);
  returns an `AdvanceResult` shaped identically to `answer`'s.
- **AC-50.** Retry-replay-safe identically to AC-40.

**Timeout (`POST /api/play/:quizId/timeout`)**

- **AC-51.** Produces the identical stored row shape to `skip` (§3's documented "no server-side
  distinction" reading of the schema) — both call the same internal `recordUnanswered` path.
- **AC-52.** Retry-replay-safe identically to AC-40.
- **AC-53.** A `skip`/`timeout` request for a position other than `current_position` (or the AC-40
  one-behind replay case) is rejected `400`, mirroring AC-39.

**Status (`GET /api/play/:quizId/status`)**

- **AC-54.** `PlayStatusResponse.totalScore`/`answeredCount` reflect the caller's own
  `participants` row; `finishedCount = COUNT(*) WHERE finished_at IS NOT NULL`; `participantCount =
  COUNT(*)` total, both scoped to `quizId`.
- **AC-55.** `estimatedUnlockAt = ends_at + window_sec*1000 + ESTIMATED_UNLOCK_BUFFER_MS` (§3) — no
  route or client-facing behavior built in this packet gates on this value; it is returned as data
  only (COUNCIL_FINDINGS.md #42 — the actual 423 gate is Sprint 5's).
- **AC-56.** `/status` for a user with no `participants` row for this `quizId` returns `404`.

**List open quizzes (`GET /api/quizzes/open`)**

- **AC-57.** Returns every quiz with `status = 'open'`, plus any `status = 'scheduled'` quiz whose
  `lobby_opens_at <= now` (a missed-tick quiz not yet lazily opened by any join attempt) — as
  `OpenQuizSummary[]` — a pure read with no write side effect (the lazy `openRoom` write only
  happens from `join`, never from this list route).
- **AC-58.** Excludes `'draft'`, `'cancelled'`, `'ended'`, and any `'scheduled'` quiz whose
  `lobby_opens_at` is still in the future.

**Cross-cutting**

- **AC-59.** Every route in `routes/play.ts` (all 7 run routes + the open-quiz list) is mounted
  behind `requireAuth()` — not `requireRole('admin')` — a request with no session gets `401` on
  every one.
- **AC-60.** `services/cache.ts`'s question-cache read/write functions are generically typed to
  accept/return only `ServedQuestion[]` — grep/type-level verification that no call site anywhere
  in this packet passes a `QuestionFull`-shaped value into the cache write path.

**Load test (`scripts/load-test.ts`, plus a CI-runnable concurrency test)**

- **AC-61.** `scripts/load-test.ts` drives 120 concurrent simulated clients through a full quiz
  (join → answer every question at randomized delays → verify finished) against a configurable
  target URL, and reports: (a) median answer-and-advance round-trip time (target: under 500ms,
  logged as pass/fail, not a hard CI gate — network-dependent); (b) all 120 final
  `participants.total_score` values match a locally recomputed expectation, computed by the script
  itself from the same `core/scoring.ts` formula given the randomized answers/timings it chose; (c)
  exactly 120 distinct `seat_no` values claimed, no duplicates; (d) total request count for the run
  logged against the ~4,500/quiz budget (`PLAN.md:617-632`).
- **AC-62 (CI-runnable concurrency test, distinct from the Node script).** 120 simulated joins
  issued concurrently (`Promise.all` against an in-process/local test harness, not real network
  load) claim 120 distinct seats; none win a second seat when their own claim is retried; the 121st
  join attempt in the same batch gets `409` (room full) — mirrors `QUIZZING.md §12`'s own
  "Concurrency" bullet, runnable in CI without any deployed staging environment.

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not modify `migrations/0001_init.sql` — the schema for this phase is already final (§1).
  `git diff -- migrations/0001_init.sql` must be empty.
- Do not modify `src/core/api.ts` or `src/core/contracts.ts` — this packet consumes
  `ServedQuestion`, `SubmitAnswerRequest`, `AdvanceResult`, `JoinQuizResponse`,
  `CurrentQuestionResponse`, `PlayStatusResponse`, `SkipQuestionRequest/Response`,
  `TimeoutRequest/Response`, `QuizzingSchedulerContract`, `OpenResult`, `CloseResult`,
  `BankContract` — it does not change any of them.
- Do not modify Sprint 3's existing exports in `src/db/quizzes.ts`
  (`createDraft`/`reshuffleDraft`/`lockQuiz`/`updateParams`/`cancelQuiz`/`listQuizzes`/
  `toAdminSummary`) or `src/routes/quizzes.ts` — this packet only **adds** `closeQuiz`'s claim stub
  to `db/quizzes.ts` (§9). `git diff` on both files must show only additions, never a changed line
  inside an existing function.
- Do not implement `materializeTemplates`, `computeWeeklyBoards`, or the weekly/hourly cron entries
  — explicitly out of scope (§4), even though `src/db/quizzes.ts:1`'s ownership comment names the
  first for a later phase.
- Do not implement `core/leaderboard.ts`, the results HTTP routes, or `participants.rank` writes —
  Sprint 5's scope (§1, §3, §4). `closeQuiz`'s `top10` stays `[]` with the documented TODO comment.
- Do not route failure alerts through `TelegramContract.claimAndSend` or `telegram_posts` — alerts
  make their own raw Bot API call, deliberately outside that system (§4).
- Do not implement `BankContract`'s own functions or `AuthContract`'s own functions — consumed as
  interfaces only (§1, §3).
- Do not add a skip-vs-timeout distinguishing column or flag anywhere — explicitly rejected (§3).
- Do not build a real-Google-OAuth-driven load test — the session-minting approach (§3) is the only
  automatable option; do not invent a mock OAuth server as an alternative without discussing it,
  since it would be strictly more code for no additional coverage.

### 8b. Coding / quality principles

- `clean-code`: the answer/skip/timeout write path shares one internal `recordAnswer(quizId,
  userId, position, gradedInput | null)` helper in `db/results.ts` rather than three near-duplicate
  functions — `answer` supplies a graded input, `skip`/`timeout` supply `null` (all-zero marks).
  Short, named steps: `validatePosition`, `computeElapsedMs`, `gradeIfApplicable`, `writeAnswerRow`,
  `advanceParticipant`, `buildNextResult`.
- `prod-safety-gate`: the seat-claim retry loop and the `closeQuiz` atomic claim are this packet's
  two production-critical concurrency mechanisms — a bug in either either strands a real student out
  of a seat they should have won, or corrupts `board_computed_at` into a state where two callers
  both think they own the ranking. Get both under a concurrent test (`Promise.all`) before anything
  else in the file.
- `test-driven-development`: write AC-18 (`closeQuiz` claim race), AC-28/32 (join race), and AC-40
  (retry-replay) as failing concurrent tests before writing the corresponding implementation.
- `vibesec`: `SubmitAnswerRequest`'s discriminant (AC-38) must be validated against the **served
  question's own stored `format`**, read from D1/the KV cache — never trust a `format` field the
  client might include in its own request body, since `SubmitAnswerRequest`'s type doesn't even
  carry one (`src/core/api.ts:292-294` — the discriminant is implicit in which field is present,
  resolved server-side against the question the student is actually on).
- Mirror Sprint 2/3's conventions throughout — third module with real logic in this repo; reuse the
  chunking/fixture/config/vitest-pool-workers conventions already established rather than inventing
  new ones.

## 9. Behavior Spec (per file)

### `src/core/config.ts`

- **Current state:** already has Sprint 3's constants (`SEAT_CAP_MAX`, `WINDOW_SLACK_SEC`,
  `ROOM_CODE_PREFIX`, `ROOM_CODE_DIGIT_COUNT`, `SELECTION_FETCH_CAP_PER_DIFFICULTY`,
  `LOBBY_LEAD_SEC`).
- **Required edit:** add, additively: `SEAT_CLAIM_MAX_RETRIES = 5`, `FAILURE_ALERT_GRACE_MS = 2 *
  60 * 1000`, `ESTIMATED_UNLOCK_BUFFER_MS = 2 * 60 * 1000`.
- **Estimated diff:** ~10 LOC.
- **Subtleties:** do not touch Sprint 3's existing constants.

### `src/core/grading.ts`

- **Current state (line 1):** ownership comment only.
- **Required edit:** implement `isCorrectMcq`/`isCorrectTita` per AC-1/2. Zero platform imports.
- **Estimated diff:** ~25 LOC.

### `src/core/scoring.ts`

- **Current state (line 1):** ownership comment only.
- **Required edit:** implement `computeMarks({ isCorrect: boolean | null, elapsedMs: number,
  limitMs: number, graceSec: number, marksCorrect: number, marksWrong: number, maxSpeedBonus:
  number }): { baseMarks: number; speedBonus: number; totalMarks: number }` per `PLAN.md:359-371`'s
  formula, clamping `elapsedMs` to `[0, limitMs]` internally first. `isCorrect: null` (skipped/timed
  out) short-circuits to all-zero. Zero platform imports.
- **Estimated diff:** ~45 LOC.
- **Subtleties:** the clamp must happen *inside* this function (AC-4) — do not rely on every caller
  remembering to clamp before calling it.

### `src/services/cache.ts`

- **Current state (line 1):** ownership comment naming `question:<quizId>`/`board:<quizId|
  weekStart>` keyspace and the typing rule.
- **Required edit:** `getServedQuestions(env, quizId): Promise<ServedQuestion[] | null>`,
  `putServedQuestions(env, quizId, questions: ServedQuestion[]): Promise<void>` — thin KV
  get/put wrapped with `JSON.parse`/`JSON.stringify`, typed at the function boundary so no caller
  can pass a `QuestionFull[]` (AC-60). Board-cache functions (`board:<key>`) are **not** added here
  — Sprint 5's scope; leave the ownership comment's board-cache line as a forward pointer, not
  implemented code.
- **Estimated diff:** ~40 LOC.
- **Subtleties:** no `expirationTtl` set (§3).

### `src/db/play.ts`

- **Current state (line 1):** ownership comment naming `quiz_seats`, the conditional seat claim,
  and `openRoom`.
- **Required edit:**
  - `claimSeat(db, quizId, userId, now): Promise<{ seatNo: number } | { conflict: 'full' }>` — the
    conditional-`UPDATE`-with-retry loop (AC-32), capped at `SEAT_CLAIM_MAX_RETRIES`.
  - `openRoom(env, quizId, now): Promise<OpenResult>` — AC-10-15: predicate check, `INSERT OR
    IGNORE` seat seed, build+warm the KV `ServedQuestion[]` (via `bank.getByIds` +
    `services/cache.ts`), flip `status`/`opened_at` in one `batch()`.
  - `joinQuiz(env, roomCode, userId, now): Promise<JoinQuizResponse | { conflict: 'not_found' } |
    { conflict: 'full' }>` — the orchestrating function AC-26-31 describe: idempotency check first
    (read `participants`), lazy `openRoom` call if needed, `claimSeat`, insert `participants` (via a
    `db/results.ts` helper, §9 below), build the response from `openRoom`'s/the cache's data.
- **Estimated diff:** ~230 LOC.
- **Subtleties:** `joinQuiz` living here (not `db/results.ts`) is this packet's own file-boundary
  choice, since it's seat-claim-centric and this file already owns `quiz_seats` — flagged
  explicitly, not asserted as doc fact. The idempotency check (AC-27) must run **before** any seat
  claim is attempted, not as a fallback after a failed claim.

### `src/db/results.ts`

- **Current state (line 1):** ownership comment naming `participants`/`answers`, answer-and-advance
  with retry-replay, scoring at write time, and drawing the exact `closeQuiz`-ranking boundary this
  packet respects (§1).
- **Required edit:**
  - `createParticipant(db, quizId, userId, seatNo, now): Promise<void>` — called by `db/play.ts`'s
    `joinQuiz`.
  - `getCurrentQuestion(env, quizId, userId, now): Promise<CurrentQuestionResponse |
    { conflict: 'not_found' | 'finished' }>` — AC-34-37.
  - `recordAnswer(env, quizId, userId, position, input: GradedInput | null, now): Promise<AdvanceResult
    | { conflict: 'bad_position' | 'bad_deadline' | 'bad_limit' | 'bad_format' }>` — the shared
    internal path `answer`/`skip`/`timeout` all call (§8b); `input: null` means skip/timeout,
    `input: { chosenOption } | { numericValue }` means a real answer. Implements AC-38-53 (minus
    format validation, which is route-layer, §9's `routes/play.ts` entry below) including the AC-40
    replay branch as its own clearly-separated early return, checked before any write.
  - `getPlayStatus(db, quizId, userId, now): Promise<PlayStatusResponse | { conflict: 'not_found'
    }>` — AC-54-56.
- **Estimated diff:** ~280 LOC. If it grows past ~320 LOC, split the replay-detection branch into a
  sibling file (`db/results-replay.ts`) rather than one file absorbing everything, mirroring Sprint
  3's own note about `db/quizzes.ts` splitting if needed.
- **Subtleties:** the replay branch (AC-40) must be checked **before** the normal-position check
  (AC-39) — a position that's one-behind-with-an-existing-row is a *different* code path from
  "current position, write it," not a fallthrough of the same write logic with a duplicate-key
  catch.

### `src/db/quizzes.ts`

- **Current state:** Sprint 3's real code (`createDraft`/`reshuffleDraft`/`lockQuiz`/
  `updateParams`/`cancelQuiz`/`listQuizzes`/`toAdminSummary`) — do not touch any of it (§8a).
- **Required edit:** add, additively, `closeQuiz(db, quizId, now): Promise<CloseResult>` — AC-18-20:
  the atomic claim `UPDATE`, and on a win, a `COUNT(*)` for `participantCount` plus the
  `top10: []`/TODO-comment placeholder (§1's documented seam); on a loss, a fresh read of the same
  shape.
- **Estimated diff:** ~40 LOC (purely additive).
- **Subtleties:** this is the one function in this file that Sprint 5 will extend — the comment
  pointing at this packet (§9 above) is what tells that packet's implementer where to look, so
  don't omit it or reword it away.

### `src/routes/play.ts`

- **Current state (line 1):** ownership comment already naming every route and its core behavior
  precisely.
- **Required edit:** a Hono sub-app defining full paths (`/api/quizzes/open`,
  `/api/quizzes/:code/join`, `/api/play/:quizId/current`, `/api/play/:quizId/answer`,
  `/api/play/:quizId/skip`, `/api/play/:quizId/timeout`, `/api/play/:quizId/status`) — this file
  spans two path prefixes because they're one feature area (§9's own judgment call, documented
  inline as a comment at the top of the file). All eight routes behind `.use('*',
  requireAuth())` (AC-33/59). The `answer` handler resolves the served question's own `format`
  from D1/cache (never trusting a client-sent `format`, §8b) before validating the discriminated
  request body. Each route thinly delegates to `db/play.ts`/`db/results.ts` and maps conflict
  variants to status codes per `API.md:148-181` and this packet's §3 judgment calls (AC-30).
- **Estimated diff:** ~190 LOC.
- **Subtleties:** `GET /api/quizzes/open` has no `:quizId`/`:code` param and no auth-role branching
  beyond `requireAuth()` — always succeeds, even with zero rows (mirrors Sprint 3's list-route
  pattern).

### `src/index.ts`

- **Current state (line 1):** ownership comment describing the eventual full app + `scheduled()`
  cron handler; may already have Sprint 1-3's route mounts if they've landed by build time.
- **Required edit:** mount `routes/play.ts`'s app at `/` (since it defines full paths itself, §9).
  Implement `scheduled(event, env, ctx)`: on the `"* * * * *"` trigger, run the Open pass (AC-16),
  the Close pass (AC-17), then the two failure-alert checks (AC-22-23) — in that order, so a
  failure alert never fires for a quiz the same tick just closed. Do **not** wire the `"0 * * *
  *"` or `"0 19 * * 0"` triggers' actual work (§4) — branch on `event.cron` and no-op (or log) for
  those two, since their real implementations are Sprint 7's.
- **Estimated diff:** ~75 LOC (additive).
- **Subtleties:** merge additively — do not overwrite Sprint 1-3's existing mounts.

### `src/services/observability.ts`

- **Current state (line 1):** ownership comment describing the dual-channel alert sender.
- **Required edit:** `sendFailureAlert(env, message: string): Promise<void>` — AC-24: a raw `fetch`
  to `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage` targeting
  `env.TELEGRAM_ALERT_CHAT_ID` (skip silently, logged, if `TELEGRAM_ENABLED !== 'true'` or the
  token/chat id vars are empty — matching `wrangler.toml`'s current placeholder values), and a
  best-effort email attempt via `env.ALERT_EMAIL?.send(...)` if that optional binding exists (it's
  commented out in `wrangler.toml:57-59` today — feature-detect, don't assume it's bound). Each
  channel's failure is caught and logged independently; one failing never skips the other (AC-24).
- **Estimated diff:** ~50 LOC.
- **Subtleties:** do not import or call anything from `src/services/telegram.ts` — that's TELEGRAM's
  higher-level Bot API client (Sprint 6), and per `MODULES.md §6` alerts are explicitly SCHEDULER's
  own, separate send path.

### `src/bindings.ts` (new, only if still missing)

- **Current state:** does not exist (confirmed).
- **Required edit:** identical to Sprint 3's own conditional behavior spec — create with Sprint 2's
  exact shape if still absent by build time; do not touch if already present.
- **Estimated diff:** ~15 LOC (0 if already present).

### `vitest.config.ts` (repo root, only if still missing)

- **Current state:** does not exist (confirmed).
- **Required edit:** identical to Sprint 2's own spec'd minimal `@cloudflare/vitest-pool-workers`
  config; do not touch if already present by build time.
- **Estimated diff:** ~25 LOC (0 if already present).

### `scripts/load-test.ts` (new)

- **Current state:** does not exist.
- **Required edit:** a standalone Node script (not under `src/`, no zero-platform-import
  constraint) implementing AC-61: mints 120 session cookies (§3), drives a full quiz via `fetch`
  against a `LOAD_TEST_TARGET_URL` env var, times each answer-and-advance round trip, recomputes
  expected scores locally using `core/scoring.ts`/`core/grading.ts` (imported directly — these are
  zero-platform-import, safe for a Node script to import), and prints a pass/fail summary per
  AC-61(a)-(d).
- **Estimated diff:** ~160 LOC.
- **Subtleties:** requires `120` pre-seeded `users` rows and the real `SESSION_SECRET` on whatever
  target it runs against — an `AC-OPERATOR` precondition (§12b), not something this script can
  set up itself against a real deployment.

### `tsconfig.scripts.json` (new, repo root)

- **Current state:** does not exist. The root `tsconfig.json` targets `@cloudflare/workers-types`
  only and excludes anything outside `src/**/*.ts` — `scripts/load-test.ts` needs Node globals
  (`process.env`, `fetch` is global in Node 18+) which conflict with `workers-types` in one shared
  config.
- **Required edit:** a second, separate `tsconfig.json` extending the root one but overriding
  `"types": ["node"]` and `"include": ["scripts/**/*.ts"]`, so `scripts/` is type-checked
  independently and never pollutes `src/`'s Workers-typed globals.
- **Estimated diff:** ~15 LOC.

### `package.json`

- **Current state:** `hono` only dependency; no test-runner-adjacent script for the load test.
- **Required edit:** add `devDependencies`: `tsx` (run the load-test script directly), `@types/node`
  (for `tsconfig.scripts.json`). Add scripts: `"load-test": "tsx scripts/load-test.ts"`,
  `"typecheck:scripts": "tsc --noEmit -p tsconfig.scripts.json"`.
- **Estimated diff:** ~6 LOC (additive only).

### `fixtures/` — none new required

- This packet's tests seed `quizzes`/`quiz_questions`/`participants`/`answers` rows **directly via
  SQL in test setup**, bypassing BANK's CSV import and QUIZZING's creation flow entirely — this
  packet's own scope assumption is "a locked quiz with `quiz_questions` already populated" (the
  parent task's framing), so its unit/integration tests don't need a real import pipeline to
  produce that state, only a `db.batch()` of `INSERT` statements matching the schema. No new CSV/ZIP
  fixture is added.

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| The `closeQuiz` claim-only stub (§1/§3) is misread by whoever implements Sprint 5 as "already correct, nothing to extend," and the `top10: []` placeholder ships to production unranked | Med | High — students never see a real leaderboard | The inline `TODO(Sprint 5)` comment (AC-19) names this packet and section explicitly; §5 flags the seam prominently, not buried |
| The retry-replay branch (AC-40) is implemented as "catch the PK constraint violation" instead of "check first, then branch," silently swallowing a genuinely-stale duplicate (`position < current_position - 1`) as if it were a valid replay | Med | Med — a stale retry could re-surface an old question out of order | AC-39/AC-40 explicitly separate the two checks; TDD per §8b; AC-44 requires the position check to run *before* any INSERT is attempted |
| The seat-claim retry loop (AC-32) gives up after one lost race instead of exhausting all unclaimed seats, causing spurious `room full` under real concurrent load | Med (only visible under real concurrency, easy to miss in single-client manual testing) | Med — a real quiz launch turns away students it shouldn't | AC-32's fixture explicitly forces multiple consecutive lost races before genuine exhaustion; AC-62's 120-client concurrency test is the real-world check |
| `elapsed_ms` clamping (AC-4/41) is implemented at the call site instead of inside `core/scoring.ts` itself, and one call site (e.g. `skip`/`timeout`'s zero-marks path) forgets it, letting an unclamped value reach `answers.elapsed_ms` even though it never affects the score in that branch — still corrupts the SCORE-8 tie-break data | Med | Med — a wrong tie-break input with no visible symptom until two students tie | AC-4 requires the clamp inside `scoring.ts`'s own function; `elapsed_ms` is written from the same clamped value regardless of branch, verified by a shared test helper across all three routes |
| The KV eventual-consistency rule (AC-9) is violated by a future refactor that "simplifies" `join` to always read `question:<quizId>` fresh from KV after calling `openRoom`, silently reintroducing the stale-read bug the whole mechanism exists to prevent | Low now, Med over time | Med — an intermittent, hard-to-reproduce bug (only visible when KV hasn't propagated yet) | AC-9's test forces a stale/throwing KV read in the same request to make the regression fail loudly and immediately, not silently pass most of the time |
| The failure-alert email path silently no-ops forever because `ALERT_EMAIL` is never actually bound (requires a custom domain, `wrangler.toml:52-56`), and nobody notices because the Telegram channel alone still fires | Med | Low-Med — one of two intended channels is dark, reducing but not eliminating alert coverage | AC-24 tests both channels independently; `OP` item in §12b calls for a human to confirm the real deployed environment has both channels actually wired before relying on them |
| Two admins/students racing `closeQuiz` and `openRoom` respectively for adjacent quizzes exceed the 50-subrequest-per-invocation cron limit (`SCHEDULER.md:222-224`) if a single tick has many quizzes to process | Low (single-operator, ~1 quiz/day deployment, `PLAN.md:626`) | Low at this scale, High if usage ever grows | Not mitigated with a batching cap in this packet — flagged here rather than silently ignored, since `SCHEDULER.md` itself says "cap the work per tick and let the next one continue" without giving a number; out of scope to invent one without a real multi-quiz-per-tick scenario to size it against |

## 11. Rollback / Revert Plan

1. `git revert <sha>` for this packet's commit(s) — no schema migration was added (§1), so there is
   no `migrate:down` step.
2. Redeploy the previous Worker version (`wrangler deploy` from the reverted commit, or Cloudflare's
   dashboard rollback if already deployed).
3. Verification: `curl -X POST .../api/quizzes/QNT-0000/join` (with valid auth) returns `404` from
   Hono's default handler post-revert (the route no longer exists), not any of this packet's own
   status codes; `curl .../api/quizzes/open` likewise 404s.
4. **State-dependent fork:** any real `participants`/`answers`/`quiz_seats` rows written by this
   packet's code before the revert was needed are **not** automatically undone — a code revert
   doesn't delete data. If a bad quiz run genuinely needs undoing (e.g. a scoring bug wrote wrong
   `total_score` values), the only path is a direct, manual `UPDATE`/`DELETE` against the affected
   rows — there is no automated "re-run the quiz" tool. If `closeQuiz`'s atomic claim already fired
   (rare, given this packet's own `top10: []` stub produces nothing worth keeping), a manual
   `UPDATE quizzes SET board_computed_at = NULL, status = 'open' WHERE id = ?` re-opens the claim
   for a corrected retry — only ever do this if Sprint 5's real ranking hasn't already been layered
   on top and depended on the claimed state.
5. Notify: single-operator deployment — notify the project owner directly; no separate ops channel
   exists yet (TELEGRAM's alert channel is Sprint 6's own build, though this packet's own
   `sendFailureAlert` (§9) may already be live and usable for this exact purpose if it shipped
   before the incident).

## 12. Verification + Definition of Done

### 12a. Automated verification

```bash
npm run typecheck            # tsc --noEmit — must pass with zero errors
npm run typecheck:scripts    # tsc --noEmit -p tsconfig.scripts.json
npm test                     # vitest run — every AC-1..60, AC-62 test must pass
git diff -- migrations/0001_init.sql   # must be empty (Hard NO)
git diff -- src/core/api.ts            # must be empty (Hard NO)
git diff -- src/core/contracts.ts      # must be empty (Hard NO)
git diff -- src/routes/quizzes.ts      # must be empty (Hard NO)
```

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | Join, happy path | `wrangler dev` locally, with a quiz seeded directly to `status='open'` via `db:seed:local`; `curl -X POST .../api/quizzes/QNT-####/join` as a student session | `200`, `JoinQuizResponse` with `meta` + question 1, no redacted fields anywhere | Not Run |
| BE-2 | Join, idempotent retry | Repeat BE-1's exact call 3 more times | Every call `200`s with the identical `meta`/current question — no new seat claimed, no error | Not Run |
| BE-3 | Join, room full | Pre-claim all `seat_cap` seats via direct DB writes for other users, then join as a new user | `409` | Not Run |
| BE-4 | Join, bad code | `POST .../api/quizzes/QNT-9999/join` (nonexistent code) | `404` | Not Run |
| BE-5 | Lazy open on join | Seed a quiz `status='scheduled'` with `lobby_opens_at` in the past (simulating a missed cron tick), then join | `200`; a direct DB read shows `status='open'`, `opened_at` set, `quiz_seats` seeded | Not Run |
| BE-6 | Resume / current | `GET .../api/play/:quizId/current` after BE-1's join, wait 5s, call again | Both `200`; `remainingMs` decreases by ~5000ms between calls, question unchanged | Not Run |
| BE-7 | Answer, happy path | `POST .../api/play/:quizId/answer` with a valid `chosenOption` for position 1 | `200`, `{status:'next', question}` for position 2 (or `finished` if `total===1`); DB shows `answers` row with correct `base_marks`/`speed_bonus` | Not Run |
| BE-8 | Answer, retry-replay | Repeat BE-7's exact call again (same position, already advanced) | `200`, identical `AdvanceResult` to BE-7's — not `409` | Not Run |
| BE-9 | Answer, wrong position | `POST .../answer` with `position` two ahead of `current_position` | `400` | Not Run |
| BE-10 | Answer, discriminant mismatch | `POST .../answer` for an `mcq` position with `numericValue` instead of `chosenOption` | `400` | Not Run |
| BE-11 | Answer, past own deadline | Seed a participant whose `started_at + window_sec*1000` is already past, then answer | `400` | Not Run |
| BE-12 | Skip / timeout | `POST .../skip` then (on a fresh position) `POST .../timeout` | Both `200`, `answers` rows with all marks 0, `chosen_option`/`numeric_value` both `NULL` | Not Run |
| BE-13 | Finish | Answer through the last position | `200`, `{status:'finished', totalScore, answeredCount}`; DB shows `finished_at` set | Not Run |
| BE-14 | Status | `GET .../status` after BE-13 | `200`, `totalScore`/`answeredCount` match DB, `estimatedUnlockAt` present and in the future | Not Run |
| BE-15 | Secrecy test | Drive a full BE-1→BE-13 run, grep every response body for `correctOption`/`numericAnswer`/`explanationMd` | Zero matches at any point | Not Run |
| BE-16 | Auth gate | Any run route with no session | `401` | Not Run |
| BE-17 | Cron Open pass | Seed a `status='scheduled'` quiz with `lobby_opens_at` in the past, invoke `scheduled()` via `wrangler dev`'s test-scheduled endpoint | `status='open'` afterward, seats seeded | Not Run |
| BE-18 | Cron Close pass claim | Seed a `status='open'` quiz past `ends_at+window_sec`, invoke `scheduled()` twice in a row | First call sets `board_computed_at`/`status='ended'`; second call is a no-op (same result, no error) | Not Run |
| BE-19 | Failure alert fires | Seed a quiz past `ends_at+window_sec+FAILURE_ALERT_GRACE_MS` with `board_computed_at` still NULL (simulate a broken close), invoke `scheduled()` | `sendFailureAlert` invoked (verify via a test double or console log) | Not Run |
| BE-20 | 120-client concurrency (AC-62) | Run the Vitest concurrency test | All 120 seats claimed, no duplicates, 121st gets `409` | Not Run |

#### Frontend / UI

N/A — this packet is backend-only (§4). If a frontend consumer is added before this note is
updated, add FE cases here and fail this packet's Definition of Done until they exist.

#### Chrome DevTools / extension verification

N/A — no browser surface ships in this packet (same reasoning as Frontend/UI above).

#### Operator-executed (post-cutover, see AC-OPERATOR)

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| OP-1 | 120-client load test against staging | Seed 120 real test users into the deployed staging D1, mint session cookies with the real `SESSION_SECRET`, run `npm run load-test -- --target=<staging-url>` (AC-61) | Median round trip under 500ms, all 120 scores match, request count logged against budget | Not Run |
| OP-2 | Sanity-check `FAILURE_ALERT_GRACE_MS`/`ESTIMATED_UNLOCK_BUFFER_MS` | A human reviews whether 2 minutes feels right against real cron-tick timing once quizzes have run for real | Constants adjusted in `core/config.ts` if off; not a blocker for this packet | Not Run |
| OP-3 | Confirm both alert channels actually deliver | Trigger a real failure-alert condition against staging (or a manual test call) and confirm both the Telegram alert chat and the alert email actually arrive | Both channels confirmed working, or the gap (e.g. no custom domain attached yet) is explicitly acknowledged and tracked | Not Run |

### 12c. Definition of Done

- [ ] AC-1 through AC-62 satisfied.
- [ ] §12a passes locally (and in CI, once CI exists — no CI config exists in this repo yet; flag
  rather than invent one, same as Sprint 2/3's own packets noted).
- [ ] BE-1 through BE-20 have Status ≠ `Not Run` (target: `Pass`).
- [ ] OP-1 through OP-3 completed by the operator, or explicitly waived (record the waiver in §5).
- [ ] No `<INPUT_REQUIRED>` remains in §5 — none do (§5).
- [ ] §8a Hard NO list respected — `git diff` on `migrations/0001_init.sql`, `src/core/api.ts`,
  `src/core/contracts.ts`, and `src/routes/quizzes.ts` is empty; `git diff` on `src/db/quizzes.ts`
  shows only additions.
- [ ] §11 Rollback plan rehearsed mentally.

---

End of Codex Task Packet — `claude-task--001`
