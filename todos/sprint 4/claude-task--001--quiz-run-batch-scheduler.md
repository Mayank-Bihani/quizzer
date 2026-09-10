# claude-task--001: Implement timed quiz runs and scheduler boundaries

**Sprint:** 4  **Slug:** `quiz-run-batch-scheduler`  **Status:** Draft

> Implements Phase 4 QUIZZING runtime on the accepted AUTH, BANK, and locked-quiz composition
> boundaries, including bounded scheduler discovery, its typed close-call seam, and failure alerts.

---

## 1. Context

Phase 4 is the first executable student run. The product requires an unattended, self-paced quiz in which every participant receives the same ordered timed units, starts a full personal duration on join, navigates only inside the active set, and advances immediately after the set's final atomic answer batch (`PRD.md:20-34`; `PRD.md:121-160`). The authoritative release map assigns all ROOM behavior, marks-on-batch scoring, the 120-client capacity test, submit/advance latency, and reload/resume behavior to this phase; results publication remains Phase 5 (`PRD.md:263-295`).

The wire contract already replaces per-question writes with five run routes. `JoinQuizResponse` and `CurrentUnitResponse` carry a discriminated `PlayState`; `SubmitUnitRequest` carries one submission ID, close reason, and every response in the unit; `PlayStatusResponse` is available only after participant finish (`src/core/api.ts:279-342`; `API.md:152-202`). The module contract fixes the redacted `UnitContent`/`ServedUnit` boundary and the scheduler's `openRoom`/`closeQuiz` calls (`src/core/contracts.ts:83-124`; `src/core/contracts.ts:139-148`).

The D1 baseline already models pre-seeded seats, one participant per user/quiz, immutable per-unit clocks and closure receipts, unique submission IDs, final answer rows, and participant aggregates (`migrations/0001_init.sql:212-300`). It is an unapplied initial schema, so this packet preserves it rather than adding another migration. Browser drafts remain a later frontend concern: the server contract deliberately receives nothing until the unit closes (`QUIZZING.md:124-141`; `MODULES.md:167-185`).

This packet builds on the accepted Sprint 1 guard behavior, Sprint 2 ordered `BankContract.getByIds`/image mapping, and Sprint 3 locked composition and scheduled lifecycle. It must consume those seams without copying them (`todos/sprint 1/claude-task--001--google-auth-roles-guards.md:77-88`; `todos/sprint 2/claude-task--001--bank-import-groups-crud.md:78-85`; `todos/sprint 3/claude-task--001--quiz-creation-units-lock.md:75-91`). The current runtime, grading, scoring, cache, observability, route, and scheduled-entry files are ownership-comment stubs (`src/core/grading.ts:1`; `src/core/scoring.ts:1`; `src/services/cache.ts:1`; `src/services/observability.ts:1`; `src/db/play.ts:1`; `src/routes/play.ts:1`; `src/index.ts:1`).

The scheduler boundary is now explicit. QUIZZING owns bounded `listDuePrepare(now,limit)` and `listDueClose(now,limit)` reads, TELEGRAM owns bounded `listFailedPosts(limit)`, and SCHEDULER uses a limit of 100 while issuing no SQL or KV itself (`src/core/contracts.ts:125-160`; `CONTRACTS.md:157-197`; `SCHEDULER.md:19-33`). Sprint 4 implements request-side per-participant settlement and the scheduler's typed close-call seam. Sprint 5 implements and production-wires `closeQuiz`, keeping whole-quiz unresolved settlement, ranking, and completion publication in one atomic global commit; Sprint 4 must never pre-settle a whole quiz or publish its completion (`CONTRACTS.md:189-197`; `SCHEDULER.md:66-76`). Failure alerts fire three minutes after `safeCloseAt` and use both the private Telegram alert chat and Cloudflare Email Routing; a custom managed domain and verified destination are launch prerequisites (`SCHEDULER.md:81-86`; `MODULES.md:121-153`).

## 2. Objective

After this packet ships, authenticated students can list joinable quizzes, claim or resume one of 120 seats, receive only their complete redacted active unit with immutable server clocks, submit one validated final batch, and advance or finish through a single idempotent atomic write. Correct/wrong marks, non-answer zeroes, per-unit elapsed time, expiry, retries, and finished-only holding data are server authoritative. Room preparation and due-work discovery are bounded, request-side expiry shares a reusable per-participant settlement primitive, the scheduler exposes the typed Sprint 5 close-call seam without pre-settling a quiz, and dual-channel failure alerts follow the fixed three-minute/Email Routing policy. An executable 120-client test proves capacity and median submit-and-advance latency.

## 3. Assumptions

- Sprint 1 AUTH is implemented first and supplies the accepted Hono-compatible `requireAuth`/`currentUser` behavior; play code never parses cookies or roles itself (`todos/sprint 1/claude-task--001--google-auth-roles-guards.md:83-88`).
- Sprint 2 BANK is implemented first. `getByIds` returns exact `QuestionFull` rows in caller order, including nested passage and server-derived image URLs, without QUIZZING reading BANK tables (`src/core/contracts.ts:33-70`; `todos/sprint 2/claude-task--001--bank-import-groups-crud.md:82-85`).
- Sprint 3 creation is implemented first. A runnable quiz is already locked with status `scheduled`, public room identity, complete timing/marks settings, contiguous ordered units/questions, and permanently retired BANK content (`todos/sprint 3/claude-task--001--quiz-creation-units-lock.md:84-90`).
- Runtime uses TypeScript/Hono on Cloudflare Workers, D1 for authoritative clocks/answers/seats, and KV only for shared redacted unit content (`PLAN.md:47-70`; `MODULES.md:81-94`).
- All persisted timestamps and injected `now` values are integer epoch milliseconds. Unit/slack/window settings are seconds and are explicitly multiplied by 1,000 in deadline arithmetic (`DATA_MODEL.md:46-60`; `SCHEDULER.md:112-117`).
- `UNIT_SUBMISSION_TRANSPORT_MS` is exactly 5,000. `deadlineAt` is the editing cutoff and `submitByAt` is the inclusive delivery cutoff; settlement is allowed only when `now > submitByAt`. This is transport allowance, never scoring grace (`src/core/config.ts:1`; `QUIZZING.md:143-168`; `src/core/contracts.ts:104-109`).
- QUIZZING's scheduler discovery limit is exactly 100 candidates per pass. `DueCloseQuiz` contains only `{quizId,safeCloseAt}`, and TELEGRAM's `FailedTelegramPostRef` contains only safe quiz/week identity, kind, and claim time (`src/core/contracts.ts:125-160`; `SCHEDULER.md:19-29`).
- Failure-close alerts become eligible at `safeCloseAt + 180000` milliseconds and repeat on every later minute tick while the quiz remains due. Alert email uses Cloudflare Email Routing through `ALERT_EMAIL`; a custom Cloudflare-managed domain and verified `EMAIL_ALERT_ADDRESS` are production prerequisites (`SCHEDULER.md:81-86`; `wrangler.toml:43-59`).
- The initial migration is the implementation schema. Tests apply it to isolated local D1 databases; no production data migration is part of this packet (`DATA_MODEL.md:1-5`; `migrations/0001_init.sql:181-300`).
- The load test targets a dedicated local/staging database and throwaway authenticated users. It never runs against the production student roster or logs reusable session cookies.

## 4. Out of Scope

- **Browser UI and local-storage implementation:** frontend follows the verified backend. This packet defines and tests the batch-only server boundary but does not build Back/Next/Skip/Clear controls or storage (`PRD.md:263-268`; `MODULES.md:167-185`).
- **Rank, leaderboard, review, history, admin report, and `board_computed_at` publication:** these are Phase 5 results behavior. Sprint 4 accumulates authoritative totals and finishes participants but does not expose or publish ranks (`PRD.md:270-284`; `QUIZZING.md:206-240`).
- **Telegram student announcements and `telegram_posts` writes:** the six post kinds are Sprint 6 and TELEGRAM remains the sole writer. Sprint 4 implements only TELEGRAM's bounded read-only `listFailedPosts` boundary needed by failure alerts (`PRD.md:270-279`; `MODULES.md:52-65`; `CONTRACTS.md:213-218`).
- **Recurring template materialization and weekly boards:** these are Sprint 7 even though the scheduled handler will eventually orchestrate them (`PRD.md:270-279`; `SCHEDULER.md:77-97`).
- **Quiz creation, reshuffle, settings, locking, cancellation, or content retirement:** Sprint 3 owns those behaviors and this packet consumes their scheduled output.
- **Per-question answer/skip/timeout endpoints or server drafts:** local edits create no API/D1 writes; only the final unit batch crosses the runtime boundary (`API.md:178-189`; `QUIZZING.md:100-112`).
- **Speed bonuses, scoring grace, per-answer timing, live scores, and live boards:** V1 omits them entirely (`PRD.md:162-184`; `PRD.md:303-318`).
- **Anti-cheat enforcement and cross-device/offline draft recovery:** both are accepted V1 limits (`PRD.md:36-43`; `QUIZZING.md:201-204`).

## 5. Open Questions

(none)

The runtime/close handoff, bounded discovery contracts, three-minute alert delay, and Cloudflare Email Routing provider are now explicit in the current authoritative sources (`CONTRACTS.md:157-218`; `SCHEDULER.md:19-33`; `SCHEDULER.md:66-86`).

## 6. Pre-flight Checklist

- [ ] Required skill loaded: **`clean-code`** — required for every implementation packet.
- [ ] Required skill loaded: **`prod-safety-gate`** — seat claims, deadlines, scoring, atomic submissions, and scheduled jobs serve production traffic and mutate durable state.
- [ ] Required skill loaded: **`test-driven-development`** — this packet adds lifecycle/concurrency behavior and mandatory load verification.
- [ ] Required skill loaded: **`vibesec`** — authenticated student input, answer secrecy, numeric input, room codes, session-bearing load clients, and alert credentials are security-sensitive.
- [ ] Confirm the working tree is clean and the branch is up to date with trunk.
- [ ] Confirm Sprint 1–3 implementations and their focused/full test suites pass; do not compensate for a missing prerequisite by duplicating its module.
- [ ] Populate local/test `DB`, `CACHE`, AUTH secrets, `TELEGRAM_ALERT_CHAT_ID`, and the `ALERT_EMAIL` Email Routing binding. Confirm a custom Cloudflare-managed domain and verified `EMAIL_ALERT_ADDRESS`; keep secrets/addresses out of command output (`wrangler.toml:14-30`; `wrangler.toml:43-59`).
- [ ] Read `PRD.md:121-184`, `PLAN.md:96-174`, `MODULES.md:52-94`, `MODULES.md:121-185`, `DATA_MODEL.md:65-106`, `CONTRACTS.md:115-188`, `API.md:152-202`, `QUIZZING.md:98-224`, `QUIZZING.md:272-303`, `SCHEDULER.md:6-75`, and `SCHEDULER.md:99-140` before editing.
- [ ] Read the exact source contracts and DDL at `src/core/contracts.ts:72-148`, `src/core/api.ts:279-342`, and `migrations/0001_init.sql:181-300` before editing.
- [ ] Draw the prepare, join, current/expiry, accepted submit/retry, overall finish, and safe-close handoff state machines. Mark every conditional-write loser and response-loss boundary.
- [ ] Re-read AC-1 through AC-20 and AC-OPERATOR; identify implementer, load-runner, Sprint 5 handoff, and operator steps separately.

## 7. Acceptance Criteria

1. **AC-1 — Grade answer formats in pure core code.** MCQ correctness compares the submitted A/B/C/D option with `correctOption`. TITA correctness accepts a finite numeric value exactly when its absolute difference from the finite `numericAnswer` is at most the non-negative finite tolerance. Missing/inconsistent BANK solution fields are internal invariant failures, never client-visible details. Skipped/unanswered entries are not graded as wrong (`src/core/contracts.ts:33-55`; `PRD.md:166-173`).
2. **AC-2 — Apply marks and counts exactly once.** Correct answers earn the quiz's finite positive `marks_correct`; wrong answers earn finite non-positive `marks_wrong`; skipped, unanswered, timed-out, and unreached questions earn zero. A committed unit returns aggregate deltas for score, correct/wrong/skipped/unanswered counts, and one unit elapsed value; it never computes a speed bonus or individual-question elapsed value (`PRD.md:162-184`; `DATA_MODEL.md:89-106`).
3. **AC-3 — Construct and cache an explicit redacted unit allowlist.** `openRoom` loads each ordered unit's question IDs through `BankContract.getByIds`, verifies exact membership/order/format/group invariants against the locked D1 composition, and constructs `UnitContent` field by field. KV key `unit:<quizId>:<unitPosition>` contains only the exact shared `UnitContent`; no `correctOption`, `numericAnswer`, `numericTolerance`, `explanationMd`, source, question ID, participant timestamp, draft, receipt, score, or future unit appears. On cache miss/write failure, serve freshly constructed redacted content directly without read-after-write dependence (`src/core/contracts.ts:83-109`; `CONTRACTS.md:130-152`; `DATA_MODEL.md:126-130`).
4. **AC-4 — Prepare rooms idempotently without opening admission early.** `openRoom(quizId, now)` acts only on a fully locked `scheduled` quiz with `lobby_opens_at <= now`, seeds exactly seats `1..seat_cap` idempotently, verifies the full seat set, warms every unit's redacted cache, then conditionally publishes `status='open'` and one immutable `opened_at`. A failure or crash before all seats/content are prepared leaves the quiz retryable and not partially open. The invocation that successfully publishes the complete room returns `{seatsSeeded:seatCap,alreadyOpen:false}` even when recovering partial seed rows; an invocation observing or losing to an already-open room returns `{seatsSeeded:0,alreadyOpen:true}`. Repeated/concurrent calls never reset a quiz or student clock. Preparation does not reveal a room code or admit a student before `scheduled_at` (`QUIZZING.md:100-123`; `SCHEDULER.md:37-59`; `migrations/0001_init.sql:58-99`; `migrations/0001_init.sql:212-222`).
5. **AC-5 — List only currently joinable quizzes.** `GET /api/quizzes/open` requires authentication and returns the exact unpaginated `{quizzes: OpenQuizSummary[]}`. Include only non-cancelled prepared quizzes satisfying `status='open'` and `scheduled_at <= serverNow < ends_at`, using stable scheduled-time/ID ordering. Never list T−5m prepared rooms early, expired admission, drafts, scheduled-but-unprepared rows, ended/cancelled rows, hidden reservations, or internal settings (`src/core/api.ts:283-294`; `API.md:154-176`).
6. **AC-6 — Claim or resume one seat atomically.** `POST /api/quizzes/:code/join` uses the authenticated `CurrentUser`; if a due room missed preparation, it invokes the same `openRoom` predicate before evaluating admission. A new participant is accepted only when `scheduled_at <= now < ends_at`, atomically owns one empty pre-seeded seat, inserts one participant with `started_at=now`, and inserts unit 1 runtime before any response. Its overall deadline is `started_at + window_sec*1000`; unit deadline is the minimum of unit allowance and overall deadline; `submit_by_at=deadline_at+5000`. A repeated/concurrent/lost-response join returns the existing participant/seat and unchanged clocks, never a second seat. The 121st distinct user gets 409 room full; unknown codes get 404; unavailable/cancelled admission gets generic 409 (`PLAN.md:121-161`; `QUIZZING.md:114-123`; `API.md:156-165`).
7. **AC-7 — Return only the authoritative active or finished state.** Join and `GET /api/play/:quizId/current` return exact `QuizMeta` plus `PlayState`. Active state contains `serverNow` and exactly the current `ServedUnit`; finished state contains only `serverNow`, own `totalScore`, and own `answeredCount`. `current` repeats shared material for resume, attaches immutable D1 clocks, never starts/resets a clock merely because a cache was refreshed, and rejects nonparticipants with 403, unknown quizzes with 404, and cancelled quizzes with 409 (`src/core/api.ts:296-317`; `API.md:162-176`).
8. **AC-8 — Validate and canonicalize the whole unit before mutation.** The submit route accepts only `{submissionId,reason,answers}` with no unknown keys and a bounded non-empty opaque submission ID. Validate a positive integer path unit position, exact current unit, exactly one entry for each unit member, unique/matching positions, exact discriminated keys, MCQ/TITA format agreement, valid A/B/C/D options, finite TITA values, and no response data on skipped/unanswered entries. `complete` permits answered/skipped only; `timeout` permits unanswered but is legal only at/after `deadlineAt`. Produce a deterministic canonical payload ordered by position and a cryptographic payload hash before any write (`src/core/contracts.ts:111-117`; `src/core/api.ts:319-333`; `QUIZZING.md:170-178`).
9. **AC-9 — Enforce the strict edit and inclusive receipt boundaries.** A new complete batch received at or before `submitByAt` is eligible even after `deadlineAt`; elapsed time is capped at the edit deadline. A new timeout batch is invalid before `deadlineAt` and eligible through `submitByAt`. At `now <= submitByAt`, request-side expiry must not settle ahead of an eligible delivery; at `now > submitByAt`, an unseen batch is rejected with 410 after safely settling the open unit as timed out. Receipt lookup occurs before lateness/current-unit checks, so an identical accepted retry remains acknowledged after the cutoff (`PRD.md:148-155`; `QUIZZING.md:160-178`; `API.md:191-198`).
10. **AC-10 — Commit unit closure as one conditional atomic batch.** A winning submission atomically records the submission ID/hash, inserts all final answer rows, grades them, applies participant score/count/elapsed deltas exactly once, closes the unit, and either creates the next `participant_units` row or finishes the participant. Every dependent write is conditioned on ownership of that same receipt; a zero-row conditional claim is handled as a race outcome rather than assumed to roll back. Any statement failure leaves receipt, answers, aggregates, closure, progress, and next start unchanged. No answer row is written before this closure (`QUIZZING.md:170-191`; `DATA_MODEL.md:89-106`; `migrations/0001_init.sql:245-297`).
11. **AC-11 — Make retries and concurrent closures deterministic.** An identical retry must match both saved `submission_id` and canonical `payload_hash`, return the original `closedUnit` receipt plus freshly loaded current authoritative `PlayState`, and never repeat marks/count/time or restart a next-unit clock. A different key or payload for a closed unit returns 409. Concurrent submit/submit and submit/expiry races have one winner; losers observe the committed receipt/current state or the appropriate generic conflict without partial writes (`QUIZZING.md:180-191`; `API.md:184-198`).
12. **AC-12 — Settle expired units without background timers.** `current`, late submit, overall-deadline handling, and the resolved safe-close handoff all use one idempotent closure primitive. After `submitByAt`, an unsubmitted reached unit closes `timed_out`, consumes its full effective allowance, earns zero, and may omit answer rows. If overall time remains, the next unit starts only when it is served on that live request; if the overall deadline is exhausted, no new unit starts and all remaining graded positions are counted unanswered with zero marks and no elapsed contribution. Unreached units have no runtime rows (`QUIZZING.md:193-204`; `DATA_MODEL.md:65-87`; `migrations/0001_init.sql:245-301`).
13. **AC-13 — Finish participants with complete aggregates.** Final-unit closure or overall expiry sets `finished_at` once. At finish, `correct_count + wrong_count + skipped_count + unanswered_count` equals `question_count`; `answeredCount=correct_count+wrong_count`; `total_time_ms` is the sum of reached finalized units once, with timeout consuming its effective allowance and unreached units contributing nothing. Never expose intermediate aggregates while active (`PLAN.md:163-174`; `QUIZZING.md:206-224`; `DATA_MODEL.md:103-114`).
14. **AC-14 — Provide finished-only holding data.** `GET /api/play/:quizId/status` returns exact `PlayStatusResponse` only to that finished participant: own score/answered count, current finished/participant counts, and `estimatedUnlockAt = endsAt + windowSec*1000 + 5000`. It returns 409 while the caller is active, 403 to a nonparticipant, and 404 for an unknown quiz. The estimate does not unlock ranks, solutions, review, or a board (`src/core/api.ts:335-342`; `API.md:200-202`).
15. **AC-15 — Enforce authentication, ownership, and response secrecy on every route.** All five runtime routes inherit Sprint 1 authentication. Participant-only routes check the authenticated user against D1 rather than trusting request IDs. Serialize every response allowlist explicitly and prove that all student gameplay responses and shared KV JSON omit BANK solutions/tolerances/explanations, question IDs, running correctness/marks/count breakdowns, rank/board data, SQL rows, and stack traces. Errors are always `{message:string}` (`API.md:12-23`; `PRD.md:137-143`; `PRD.md:247-258`).
16. **AC-16 — Keep local drafts entirely outside server state.** There are no `/answer`, `/skip`, `/clear`, or per-question timeout routes and no provisional answer table writes. Repeated navigation/resume calls do not mutate answers. The server accepts only one final `SubmitUnitRequest`; resolving the last outstanding response and browser-local persistence/retry are frontend responsibilities implemented later against this exact contract (`QUIZZING.md:100-112`; `CONTRACTS.md:141-152`; `src/routes/play.ts:1`).
17. **AC-17 — Discover and orchestrate scheduler work through exact bounded seams.** QUIZZING implements `listDuePrepare(now,100)` returning at most 100 eligible quiz IDs and `listDueClose(now,100)` returning at most 100 exact `{quizId,safeCloseAt}` DTOs; use stable oldest-due/quiz-ID ordering so later ticks drain overflow. The scheduler prepare pass calls `openRoom` for every discovered ID. Implement and unit-test a close pass that calls the injected contract's `closeQuiz` only for discovered due IDs, but do not production-wire that pass in Sprint 4: Sprint 5 supplies and wires the real atomic `closeQuiz`. Each candidate/pass is isolated so one failure does not block the rest, and SCHEDULER itself issues no SQL/KV. Sprint 4 request-side settlement remains per participant and reusable; it never loops over or pre-settles an entire quiz, ranks, writes `ended_at`, or sets `board_computed_at` (`src/core/contracts.ts:125-151`; `CONTRACTS.md:157-197`; `SCHEDULER.md:19-33`; `SCHEDULER.md:42-79`).
18. **AC-18 — Send both failure alerts without controlling gameplay.** Use `listDueClose(now,100)` and alert for each still-due quiz when `now >= safeCloseAt + 180000`. Implement TELEGRAM's read-only `listFailedPosts(limit)` with bound `limit=100`, stable oldest-claim/safe-identity ordering, and exact `FailedTelegramPostRef` mapping; it never returns stored provider error text. Send every alert independently to `TELEGRAM_ALERT_CHAT_ID` and Cloudflare Email Routing's `ALERT_EMAIL`; one channel's failure never suppresses the other or blocks prepare, join, submission, request-side settlement, or later candidates. Repeat each condition every minute while it remains. Messages contain only safe quiz/week identity, post kind/claim time or safe-close time, stage, and category—never question content, answers, session cookies, bot tokens, email addresses, SQL traces, provider errors, or the student chat ID (`src/core/contracts.ts:154-181`; `CONTRACTS.md:213-218`; `MODULES.md:121-153`; `SCHEDULER.md:81-86`).
19. **AC-19 — Prove the 120-client target with an executable load artifact.** Add a repeatable mixed-unit load scenario with 120 distinct authenticated users joining one prepared 120-seat quiz, resuming/reloading, and submitting every unit concurrently; a 121st distinct user is rejected. Measure unit-submit-to-next-state round trips and require median below 500 ms, zero failed accepted-client requests, exactly 120 unique seats/participants, no duplicate answer/receipt/aggregate writes, and complete final participant counts. Print request counts and D1/KV/write observations needed to update capacity assumptions; never count local subquestion navigation as requests (`PRD.md:247-256`; `PRD.md:294-295`; `PLAN.md:237-252`; `QUIZZING.md:289-303`).
20. **AC-20 — Prove behavior test-first and preserve module ownership.** Before production edits, add failing tests for grading/tolerance edges, redaction, prepare crash recovery, admission boundaries, 120/121 seat races, join retries, immutable clocks, every batch validation error, edit/receipt boundary instants, D1 statement rollback, changed/identical/concurrent retries, request-side expiry, overall finish, status gating, scheduler discovery bounds/order, lateness/concurrency/pass isolation, typed but unwired close calls, and three-minute dual-channel alerts. QUIZZING alone writes runtime tables/unit cache and owns due-quiz discovery; TELEGRAM owns failed-post discovery; SCHEDULER writes no table/KV; BANK is accessed only through `getByIds`; AUTH is consumed through guards. The established migration/API/module contracts remain unchanged (`MODULES.md:52-94`; `src/core/contracts.ts:125-181`; `QUIZZING.md:289-303`).
21. **AC-OPERATOR — Verify provisioned runtime and alerts.** On a dedicated staging deployment with real D1/KV/AUTH bindings, the operator runs one mixed-unit quiz with three real clients, checks T−5m preparation versus T admission, submits/retries/expires units, and confirms finished-only status. Then run the 120-client harness, verify the 121st rejection and median threshold, force both alert conditions, and confirm both private channels receive safe messages. Confirm Sprint 4's production scheduled wiring cannot call `closeQuiz`; retain a typed integration test result for Sprint 5. Record counts/latency/statuses only; do not retain credentials, answer bodies, or student PII (`SCHEDULER.md:73-86`; `wrangler.toml:43-59`; `PRD.md:297-299`).

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not implement production `closeQuiz`, wire the scheduler close pass into `src/index.ts`, pre-settle every participant in a quiz, or commit runtime settlement separately before global close. Sprint 5 must settle unresolved runs, rank, and publish completion together in one atomic transaction.
- Do not implement ranking, leaderboard/review/history/report routes, board cache publication, `rank`, `ended_at`, or `board_computed_at` writes in Sprint 4.
- Do not let SCHEDULER or observability issue SQL, touch KV, or write `telegram_posts`. QUIZZING alone implements `listDuePrepare`/`listDueClose`; the read-only failed-post query lives behind TELEGRAM's `listFailedPosts` implementation.
- Do not send due announce/soon/open/result/weekly/cancelled student posts. Sprint 6 owns `TelegramContract.claimAndSend` and `telegram_posts` writes.
- Do not add per-question answer/skip/clear/timeout routes, server draft storage, per-answer timestamps, display-decimal IDs, or future-unit prefetch.
- Do not expose `QuestionFull` directly to a student or cache it. Explicitly omit correct answers, numeric solutions/tolerances, explanations, source, BANK IDs, and future units.
- Do not trust browser time, elapsed values, correctness, marks, user IDs, unit membership, answer format, or role claims.
- Do not start a student clock at T−5m, at scheduled time, during cache warming, on reload, or for an unseen expired unit. Start only at successful join/serve transitions.
- Do not treat the five-second transport allowance as editing time or add it to elapsed marks/tie-break time.
- Do not write answers before final closure, accept a partial complete batch, overwrite an accepted answer, double-apply aggregates, or assume a zero-row conditional D1 statement rolls back dependent statements.
- Do not use KV for seats, participant clocks, drafts, submission receipts, accepted responses, or timing decisions. KV staleness/failure must not decide gameplay.
- Do not reuse `submissionId` across units/users, accept unknown request keys, interpolate inputs into SQL, log cookies/tokens/answers, or expose internal error details.
- Do not edit BANK/AUTH implementations, Sprint 1–3 packets, fixtures, product documents, mockups, frontend files, or the progress tracker.
- Do not edit `migrations/0001_init.sql`, `src/core/contracts.ts`, or `src/core/api.ts`; the resolved discovery and close-handoff types already exist.

### 8b. Coding / quality principles

- **`clean-code`:** keep Hono handlers to guard/parse/invoke/respond. Separate pure validation/grading/marks from D1 persistence, isolate prepare/join from unit closure, use names with explicit units (`Ms`, `Sec`), early returns, and shallow state-machine helpers.
- **`prod-safety-gate`:** the dangerous surfaces are seat races, D1 conditional closure, receipt-cutoff comparisons, next-unit clock creation, and the staged Sprint 4/Sprint 5 close handoff. Test every crash, timeout, retry, concurrent loser, discovery bound, delayed scheduler boundary, and absence of production close wiring before rollout.
- **`vibesec`:** runtime-validate exact request discriminants, reject nonfinite numbers/extra fields, bind all SQL, build redacted DTOs from allowlists, cap identifiers/payload sizes, use cryptographic payload hashes, compare retry hashes safely, and redact all logs/alerts/load output.
- **`test-driven-development`:** begin with pure grading/submission tests, then database race/rollback tests, mounted route tests, bounded scheduler/alert contract tests, and finally the 120-client load artifact. Watch every focused test fail for missing behavior before implementation.
- Model runtime operations as explicit outcomes (`joined`, `resumed`, `full`, `active`, `finished`, `accepted`, `identical_retry`, `conflict`, `expired`) and map them to the existing API/status contract in one place.
- Construct cache and API objects field by field. TypeScript structural typing cannot redact an object at runtime (`PLAN.md:112-119`; `CONTRACTS.md:135-139`).
- Use one injected clock at the use-case boundary and pass the same integer `now` through eligibility, elapsed, receipt, response `serverNow`, and tests. Never call the clock repeatedly inside one operation.
- Keep D1 batches bounded. Chunk seat inserts/cache preparation idempotently, verify completeness, and publish `open` only last. In closure batches, condition every dependent write on the same submission ownership predicate.
- Treat a KV write as optional acceleration: on a miss or write error, use the newly redacted value already in memory. D1 remains authoritative.
- Preserve the accepted API directly: success payloads have no envelope and errors contain only `message` (`API.md:12-23`).

## 9. Behavior Spec (per file)

### `src/core/config.ts`

- **Current state (line 1):** the stub already names the 120-seat cap and `UNIT_SUBMISSION_TRANSPORT_MS=5000` (`src/core/config.ts:1`).
- **Required edit:** export the named 5,000 ms transport constant and merge named runtime bounds for submission ID/body size and seat-preparation chunk size without duplicating Sprint 1–3 constants.
- **Estimated diff:** ~12 LOC.
- **Subtleties:** bounds are implementation protection, not new product limits. Do not add speed/grace scoring settings; the only five-second constant is transport delivery.

### `src/core/grading.ts`

- **Current state (line 1):** one comment assigns pure MCQ/TITA correctness here (`src/core/grading.ts:1`).
- **Required edit:** implement typed pure functions for AC-1 that validate solution invariants and return correctness/failure without platform imports.
- **Estimated diff:** ~45 LOC.
- **Subtleties:** tolerance comparison is inclusive; reject NaN/infinity and inconsistent format/solution shapes. Skipped/unanswered bypass this function.

### `src/core/scoring.ts`

- **Current state (line 1):** one comment assigns marks-only V1 scoring here (`src/core/scoring.ts:1`).
- **Required edit:** map graded/non-answer outcomes to exact marks and count deltas, and combine a finalized unit's bounded elapsed value once.
- **Estimated diff:** ~45 LOC.
- **Subtleties:** preserve real-valued configured marks without floating equality assumptions in tests. No rank, bonus, grace, or per-question time belongs here.

### `src/core/unit-submission.ts` (new)

- **Current state:** no pure runtime validation/canonicalization file exists; the request union is defined only in `src/core/api.ts:319-333`.
- **Required edit:** parse/validate exact `SubmitUnitRequest`/`UnitAnswer` discriminants against an expected active-unit manifest, normalize answers by integer position, and produce stable canonical bytes for an injected cryptographic hasher.
- **Estimated diff:** ~80 LOC.
- **Subtleties:** include close reason and every typed value in the canonical form; normalize `-0` deliberately and reject every nonfinite numeric value/extra key. Do not accept question IDs or client timing.

### `src/services/cache.ts`

- **Current state (line 1):** the stub owns shared keyspaces and explicitly restricts unit cache entries to redacted `UnitContent` (`src/services/cache.ts:1`).
- **Required edit:** add QUIZZING-owned get/put helpers for `unit:<quizId>:<unitPosition>` with runtime shape validation and miss/write-failure outcomes that let callers use fresh content directly.
- **Estimated diff:** ~55 LOC.
- **Subtleties:** preserve AUTH key helpers added in Sprint 1. Never cache `ServedUnit`, full BANK rows, personal clocks, receipts, drafts, or scores.

### `src/db/play.ts`

- **Current state (line 1):** the stub owns all QUIZZING runtime persistence and lifecycle operations (`src/db/play.ts:1`).
- **Required edit:** expose a small runtime repository facade and explicit row mappers for quiz/meta/open-list reads, participant/current/finished reads, receipt lookup, status counts, stable bounded `listDuePrepare(now,limit)`/`listDueClose(now,limit)` queries, and calls into the two cohesive write helpers below.
- **Estimated diff:** ~85 LOC.
- **Subtleties:** use fixed query branches and bind all values. Enforce `limit=100` at the service boundary and return only quiz IDs or `{quizId,safeCloseAt}` in oldest-due/ID order. Never join/expose BANK solution columns; retrieve authored content through `BankContract` only. Keep Sprint 3 creation persistence untouched.

### `src/db/play-seats.ts` (new)

- **Current state:** seat preparation and join are declared only by schema/comments (`migrations/0001_init.sql:212-249`; `src/db/play.ts:1`).
- **Required edit:** implement idempotent bounded seat seeding/completeness verification/conditional open and the conditional empty-seat claim plus participant/unit-1 creation state machine.
- **Estimated diff:** ~95 LOC.
- **Subtleties:** partial seat chunks may exist after a crash, but `status` cannot become open until all `1..seat_cap` rows exist. Derive participant/unit timestamps from one injected `now`; recover uniqueness races as resume.

### `src/db/play-units.ts` (new)

- **Current state:** closure/receipt constraints exist only in the initial DDL (`migrations/0001_init.sql:245-300`).
- **Required edit:** implement receipt-first lookup, atomic conditional submit closure, server-only timeout settlement, aggregate/final-count updates, and next-unit runtime creation/finish with typed outcomes.
- **Estimated diff:** ~100 LOC per cohesive closure component; split receipt/read and atomic-write helpers if the implementation would substantially exceed this.
- **Subtleties:** a zero-row update is not a transaction failure. Every answer insert, aggregate delta, close, progression, and next start must prove ownership of the same receipt/expiry claim; errors roll back the entire batch.

### `src/services/quiz-run.ts` (new)

- **Current state:** no run use-case layer exists; route and repository are one-line stubs (`src/routes/play.ts:1`; `src/db/play.ts:1`).
- **Required edit:** coordinate AUTH identity, injected clock, runtime repository, BANK `getByIds`, redacted cache, pure validation/grading/scoring, and hashing for list/join/current/submit/status/openRoom plus the exact QUIZZING scheduler discovery methods. Map domain outcomes without HTTP/framework types.
- **Estimated diff:** ~100 LOC per cohesive use-case component; split preparation/content from participant progression if needed.
- **Subtleties:** receipt lookup precedes active/lateness rejection. Re-fetch/validate content when grading; BANK freezes used solutions. Return current state after accepted retry, not cached response state.

### `src/routes/play.ts`

- **Current state (line 1):** the stub lists the exact five run routes and excludes per-question write routes (`src/routes/play.ts:1`).
- **Required edit:** implement/mount exact Hono handlers, apply Sprint 1 `requireAuth`, strictly parse bounded opaque code/quiz/submission IDs and integer unit positions/JSON, invoke quiz-run use cases, serialize exact DTOs, and map documented 400/401/403/404/409/410 outcomes to generic errors.
- **Estimated diff:** ~90 LOC.
- **Subtleties:** open/join route placement must not create an unguarded alias. A late new submit can settle expiry and still return 410; identical receipts are checked first.

### `src/services/scheduler.ts` (new)

- **Current state:** scheduler orchestration exists only as the `src/index.ts:1` ownership comment and the four-call interface (`src/core/contracts.ts:139-148`).
- **Required edit:** implement separate bounded prepare, typed close, and failure-check passes. Call `listDuePrepare(now,100)` then `openRoom`; implement the close pass against `listDueClose(now,100)`/`closeQuiz`; use `listDueClose` safe timestamps and `listFailedPosts(100)` for alerts. Inject the exact module contracts, alert sender, and one `now`; isolate errors per candidate/pass.
- **Estimated diff:** ~85 LOC.
- **Subtleties:** export and test the close pass, but do not bind it into the production scheduled entrypoint until Sprint 5 supplies atomic `closeQuiz`. Do not pre-settle a quiz as a substitute. Due student posts, hourly materialization, and weekly computation remain later phases. SCHEDULER performs no SQL/KV and never makes gameplay depend on alerts.

### `src/services/observability.ts`

- **Current state (line 1):** the stub assigns dual Telegram-alert-chat/email sending to SCHEDULER (`src/services/observability.ts:1`).
- **Required edit:** implement a narrow dual-channel failure-alert sender and safe message renderer using `TELEGRAM_ALERT_CHAT_ID` plus the Cloudflare `ALERT_EMAIL` send-email binding; return per-channel outcomes so one failure does not suppress the other.
- **Estimated diff:** ~70 LOC.
- **Subtleties:** close alerts begin exactly at `safeCloseAt + 180000`; repeated conditions send every later minute by current policy. Redact secrets, PII, content, responses, stored/raw provider errors, and student-group identifiers. No third-party email fallback exists in V1.

### `src/db/telegram.ts`

- **Current state (line 1):** the TELEGRAM persistence stub names `telegram_posts` and future `claimAndSend` bookkeeping but has no failed-post read (`src/db/telegram.ts:1`).
- **Required edit:** add only the bounded read-only `listFailedPosts(limit)` implementation, selecting failed rows in stable oldest-`claimed_at` order with a deterministic safe-identity tie-break and mapping exact `FailedTelegramPostRef` fields.
- **Estimated diff:** ~35 LOC.
- **Subtleties:** bind and cap the caller-supplied limit at 100. Do not return the stored `error`, message ID, destination, or any extra column; do not implement pending claims, sends, status updates, rendering, or due student-post discovery in this sprint.

### `wrangler.toml`

- **Current state (lines 43-59):** alert chat/email variables exist and the commented `ALERT_EMAIL` block now fixes Cloudflare Email Routing as V1's sole email transport, pending the production domain/destination setup (`wrangler.toml:43-59`).
- **Required edit:** keep the committed placeholder secret-free. The operator activates `ALERT_EMAIL` in production deployment configuration only after attaching the custom Cloudflare-managed domain and verifying the destination; secrets remain provisioned outside version control.
- **Estimated diff:** ~5 LOC.
- **Subtleties:** never commit addresses, bot tokens, or real binding IDs. Do not add a third-party provider or alter the three accepted cron expressions (`wrangler.toml:32-41`).

### `src/index.ts`

- **Current state (line 1):** the stub owns Hono mounting and all scheduled-handler orchestration (`src/index.ts:1`).
- **Required edit:** preserve Sprint 1–3 mounts, mount the five runtime routes at their exact paths, compose QUIZZING runtime dependencies, and production-wire bounded prepare plus both failure checks using QUIZZING discovery, TELEGRAM's Sprint 4 read-only `listFailedPosts`, and observability. Leave the typed close pass unbound until Sprint 5 provides the real atomic `closeQuiz`.
- **Estimated diff:** ~30 LOC.
- **Subtleties:** keep request and scheduled entrypoints thin. The staged wiring must be explicit and tested: no placeholder/no-op close may make production appear complete. Failed-post reads are real and read-only; due student sends remain absent. Do not implement hourly/weekly or student announcements.

### `tests/grading-scoring.test.ts` (new)

- **Current state:** no executable grading/marks tests exist; only core stubs and design requirements exist (`src/core/grading.ts:1`; `src/core/scoring.ts:1`; `QUIZZING.md:289-303`).
- **Required edit:** table-test MCQ/TITA/tolerance/nonfinite/invariant cases, configured real marks, every non-answer zero, count deltas, and one elapsed contribution per unit.
- **Estimated diff:** ~80 LOC.
- **Subtleties:** use boundary values and property tests around tolerance; do not mirror production calculations as the oracle.

### `tests/quiz-run.test.ts` (new)

- **Current state:** runtime D1 behavior has no tests; the schema is definition-only (`migrations/0001_init.sql:212-300`).
- **Required edit:** against isolated migrated D1 with fake BANK/KV/clock/hash ports, test prepare crashes/retries, exact seat races, join recovery, immutable clocks, redaction/cache failure, every validation error, boundary instants, forced statement failures, accepted/changed/concurrent retries, server expiry, overall finish, and aggregate invariants.
- **Estimated diff:** ~100 LOC per cohesive test file; split prepare/join and closure/expiry suites if needed.
- **Subtleties:** inspect raw D1 and raw serialized cache values after every failure/race. Force failures at each statement boundary, not only before the use case begins.

### `tests/play.routes.test.ts` (new)

- **Current state:** the route surface exists only in contracts and a one-line stub (`API.md:152-202`; `src/routes/play.ts:1`).
- **Required edit:** exercise the mounted Worker for all five endpoints, exact auth/participant/status codes, malformed and extra fields, open/admission boundaries, direct response shapes, late 410 behavior, and exhaustive run-response solution/score leakage checks.
- **Estimated diff:** ~95 LOC.
- **Subtleties:** inspect raw JSON keys and confirm no per-question write alias exists. Include same-user and different-user access attempts.

### `tests/scheduler-minute.test.ts` (new)

- **Current state:** the scheduled entrypoint has no executable behavior (`src/index.ts:1`; `SCHEDULER.md:30-75`).
- **Required edit:** test exact limit-100 calls, deterministic discovery order/overflow, delayed/double/concurrent prepare, the typed close pass with a fake `closeQuiz`, absence of production close wiring, per-pass/candidate isolation, no direct storage access, failed-post safe DTOs, the `safeCloseAt+180000` boundary, repeated alerts, and independent Telegram/Email Routing outcomes.
- **Estimated diff:** ~90 LOC.
- **Subtleties:** use injected ports/spies to prove call order and independence. Do not pre-settle participants in close tests or expect student announcements, rank publication, hourly work, or weekly work from this sprint.

### `tests/load/quiz-run.load.test.ts` (new)

- **Current state:** the required Phase 4 120-client test does not exist (`PRD.md:294-295`; `QUIZZING.md:302-303`).
- **Required edit:** provide the repeatable AC-19 workload, isolated fixture setup/cleanup, p50 submit-and-advance measurement, invariant queries, machine-readable summary, configurable local/staging target, and a nonzero exit on any threshold/invariant failure.
- **Estimated diff:** ~100 LOC plus a compact fixture helper if needed.
- **Subtleties:** authenticate through the real accepted session semantics, use 120 distinct users, synchronize load barriers deliberately, exclude setup/local navigation from submit latency, and redact all cookies/answers from output.

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Partial seat preparation exposes a room with fewer than `seat_cap` claimable seats | Med | High | AC-4 publishes `open` only after idempotent completeness verification and crash tests. |
| Concurrent/retried join consumes two seats or resets personal clocks | Med | High | Schema uniqueness, AC-6 conditional ownership, and 120/121 race tests. |
| Full BANK rows or cached content leak solutions during play | Med | High | AC-3/15 explicit allowlists plus raw cache/HTTP negative-key assertions. |
| Cache staleness decides timing or makes a cache write required for play | Med | High | D1-authoritative clocks and fresh-value fallback in AC-3/7. |
| A partial/invalid batch writes some answers or marks | Med | High | Validate before mutation, one conditional D1 batch, and forced-statement rollback tests in AC-8/10. |
| Zero-row conditional update is mistaken for transaction failure and dependent writes run | Med | High | AC-10 conditions every dependent statement on receipt ownership and tests losing races. |
| Duplicate/concurrent/late submissions double-score or overwrite answers | High | High | AC-9/11 receipt-first lookup, canonical hash, single-winner state tests. |
| Timeout settlement races an on-time final transport batch | Med | High | Exact inclusive receipt/exclusive settlement comparisons in AC-9/12. |
| Reload/retry starts a new clock or returns stale next-unit timestamps | Med | High | Immutable runtime rows and freshly loaded state in AC-6/7/11. |
| Overall expiry starts unseen units or miscounts final unanswered positions | Med | High | AC-12/13 runtime-membership and aggregate invariant tests. |
| Sprint 4 pre-settles a whole quiz or publishes ranks before Sprint 5's atomic close | Med | High | AC-17, the explicit no-ranking/pre-settlement guardrail, and production-wiring absence tests preserve the accepted handoff. |
| SCHEDULER violates one-writer ownership to enumerate due/failed rows | Med | High | Exact `listDuePrepare`/`listDueClose`/`listFailedPosts` ports and no-direct-storage tests in AC-17/18. |
| More than 100 due rows starve or run in unstable order | Med | Med | AC-17 fixes limit 100, oldest-due/ID ordering, and multi-tick overflow tests. |
| A close alert fires before the fixed three-minute delay | Med | Med | AC-18 tests just before/at/after `safeCloseAt+180000`; the delay never changes working time. |
| Telegram or Email Routing failure suppresses the other alert channel | Med | High | Independent per-channel attempts/outcomes and operator forced-failure checks in AC-18. |
| Production lacks a custom Cloudflare domain or verified email destination | Med | High | Pre-flight, AC-OPERATOR, and OP-1 make Email Routing readiness a launch prerequisite. |
| One scheduler/alert failure blocks room preparation or gameplay | Med | High | AC-17/18 isolate passes and make alerts non-gating. |
| 120-client test passes locally but production latency/capacity fails | Med | High | Repeatable local plus dedicated staging execution, raw p50/failure/invariant output, and Phase 8 rerun. |
| Test data/session material leaks or touches real students | Low | High | Dedicated fixtures, redacted output, no production roster, and `vibesec` pre-flight. |
| Lint/type drift or shared test state hides failures | Med | Med | Focused isolated D1 suites followed by typecheck/full suite and deterministic injected time. |
| Contracts/docs drift as scheduler gaps are patched ad hoc | High | High | §5 resolution must explicitly update packet/contracts before code; protected-file checks catch silent drift. |

## 11. Rollback / Revert Plan

1. Disable new admission at the edge or roll back traffic before data inspection; do not cancel or delete quizzes automatically, because scheduled identity/content retirement is permanent and cancellation is outside this runtime packet (`PRD.md:111-115`; `todos/sprint 3/claude-task--001--quiz-creation-units-lock.md:87-90`).
2. Record only affected opaque quiz IDs, statuses, seat/participant/unit/answer counts, earliest/latest server timestamps, and safe error categories. Do not export question bodies, answers, cookies, tokens, names, or emails.
3. Run `git revert <sha>` for the Sprint 4 implementation and redeploy the prior Worker. Keep the initial schema and Sprint 1–3 implementations; this packet adds no migration (`DATA_MODEL.md:1-5`; `migrations/0001_init.sql:181-300`).
4. Restore/restart the prior Worker request and scheduled entrypoints. Leave the `ALERT_EMAIL` binding and verified destination intact during the first rollback; removing a binding before the old Worker is active can compound the outage.
5. Preserve all accepted `participants`, `participant_units`, and `answers` rows. Never delete, replay, regrade, overwrite, or manually edit an accepted batch. A forward repair must use the same receipt/current-state invariants because accepted responses are immutable (`QUIZZING.md:170-204`; `DATA_MODEL.md:89-106`).
6. For a quiz only partially prepared, leave idempotent seat rows and redacted cache keys in place; they contain no participant answer state. Do not expose/admit it unless a reviewed forward fix verifies the full seat range/content and applies the authoritative predicate (`QUIZZING.md:114-123`; `MODULES.md:86-94`).
7. For active participants, preserve clocks and mark the incident for a reviewed forward settlement after the five-second receipt boundary. Never extend/restart deadlines, fabricate submitted answers, or run a whole-quiz pre-settlement repair. Sprint 5's atomic `closeQuiz` must consume committed runtime state and settle remaining runs in its global transaction (`CONTRACTS.md:189-197`; `QUIZZING.md:143-224`).
8. Verify the reverted API rejects or lacks Sprint 4 routes as expected, Sprint 1–3 AUTH/BANK/admin creation smoke checks still pass, no new runtime rows are appearing, and scheduled ticks no longer invoke Sprint 4 services. Confirm no production close pass or fake TELEGRAM discovery adapter survived the revert. Use read-only D1 counts and generic HTTP checks.
9. Notify the project owner through both configured private failure-alert channels with affected opaque IDs, rollback time, preserved-state summary, and next repair step (`MODULES.md:121-153`).
10. After stability, rotate any alert/session credential only if logs or artifacts exposed it; otherwise avoid unnecessary rotation. Keep Cloudflare Email Routing as the selected V1 transport; remove a deployment binding only after confirming no deployed Worker references it.

## 12. Verification + Definition of Done

### 12a. Automated verification

```bash
npm ci
npm run typecheck
npm test -- tests/grading-scoring.test.ts
npm test -- tests/quiz-run.test.ts
npm test -- tests/play.routes.test.ts
npm test -- tests/scheduler-minute.test.ts
npm test -- tests/load/quiz-run.load.test.ts
npm test

git diff --exit-code -- migrations/0001_init.sql src/core/contracts.ts src/core/api.ts
git diff --exit-code -- PRD.md PLAN.md MODULES.md DATA_MODEL.md CONTRACTS.md API.md QUIZZING.md SCHEDULER.md
git diff --exit-code -- src/routes/auth.ts src/routes/admins.ts src/routes/bank.ts src/routes/images.ts src/routes/quizzes.ts
git diff --exit-code -- src/db/users.ts src/db/bank.ts src/db/quizzes.ts src/db/results.ts src/db/boards.ts
git diff --exit-code -- src/routes/results.ts src/routes/boards.ts src/routes/reports.ts src/services/telegram.ts

! rg -n "correctOption|numericAnswer|numericTolerance|explanationMd|totalScore|rank" \
  tests/artifacts/runtime-http.json tests/artifacts/unit-cache.json
! rg -n "timePerQ|speedBonus|maxSpeedBonus|baseMarks|answerTimestamp|perQuestion" \
  src/core/grading.ts src/core/scoring.ts src/core/unit-submission.ts src/db/play*.ts \
  src/services/quiz-run.ts src/routes/play.ts src/services/scheduler.ts
```

All commands must succeed. The resolved scheduler contracts already exist, so protected files remain unchanged. Runtime HTTP/cache artifact generation must be part of the focused tests, and the two negative-key scans must find no matches. The load test must exit nonzero unless all AC-19 thresholds and data invariants pass.

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | T−5m prepare versus admission | Run the minute tick at just before/equal/after `lobbyOpensAt`, then list/join just before/equal `scheduledAt`. | Seats/content prepare idempotently; no code/list/join before T; admission begins exactly at T with no student clock started earlier. | Not Run |
| BE-2 | Join/resume/full race | Fire concurrent first/retry joins for 120 distinct users plus a 121st, including one lost response. | Exactly 120 unique seats/participants; retries preserve one seat and clocks; 121st gets generic 409. | Not Run |
| BE-3 | Redacted mixed unit | Join a quiz containing standalone, RC and LRDI units; inspect raw join/current responses and KV JSON. | Only the active complete unit appears; shared material/options/order/timestamps are exact; no solution, explanation, score, IDs, drafts, or future unit leaks. | Not Run |
| BE-4 | Local-draft boundary | Call current repeatedly while changing a simulated browser draft without submit; inspect answers/runtime. | No answer write or clock change occurs; only the final batch can close/progress. | Not Run |
| BE-5 | Complete batch validation | Send missing/duplicate/foreign positions, wrong formats, extra fields, nonfinite TITA values, unanswered with complete, and then one valid changed-answer/skip batch. | Invalid batches are 400 with zero mutation; the exact final local choices commit once and return next state. | Not Run |
| BE-6 | Receipt boundary | Submit at `deadlineAt-1`, `deadlineAt`, during transport, `submitByAt`, and `submitByAt+1`; race current/submit at the cutoff. | Acceptance/410/timeout behavior follows AC-9 exactly; elapsed never exceeds edit allowance; no race double-closes. | Not Run |
| BE-7 | Retry and rollback | Lose an accepted response, retry identical after cutoff, retry changed key/payload, race duplicate submits, and inject a failure at each D1 closure statement. | Identical retry returns current state with no duplicate effect; changed retries are 409; each forced failure leaves the entire closure unchanged. | Not Run |
| BE-8 | Expiry and finish | Let an active unit expire with and without later units; let overall duration expire with units unreached; call current/status. | Reached timeout and unreached outcomes/counts/time are distinct and exact; no unseen clock starts; status is blocked until participant finish. | Not Run |
| BE-9 | Authorization/ownership/errors | Exercise all five routes signed out, as another student, and with malformed IDs/body; force BANK/KV/D1 errors. | 401/403/400/404/409/410 mapping is exact and generic; no cross-user state or internal detail leaks. | Not Run |
| BE-10 | Scheduler discovery and staged close | Seed 105 due prepares/closes, run missed/delayed/duplicate/concurrent ticks with one failing candidate, and exercise the typed close pass with a fake implementation. Inspect production composition. | Each call requests 100 in stable oldest-due/ID order and later ticks drain overflow; failures are isolated; SCHEDULER performs no storage; production has no `closeQuiz` binding or whole-quiz pre-settlement. | Not Run |
| BE-11 | Failure alerts | Check a due close immediately before/at/after `safeCloseAt+180000`; return a safe `FailedTelegramPostRef`; break Telegram and Email Routing separately; repeat the tick. | Alerts begin exactly at three minutes, use only safe DTO fields, attempt both channels independently, repeat each minute, and never gate gameplay/other candidates. | Not Run |
| BE-12 | Full-load run | Execute the committed load artifact against dedicated staging with 120 users and one extra user. | All accepted clients finish with exact rows/totals, 121st is rejected, zero invariant failures, and median submit/advance is below 500 ms. | Not Run |

#### Frontend / UI

N/A — this is a backend-only packet. Browser-local draft/navigation UI is intentionally implemented after backend verification. If any `web/`, mockup, or design-system file enters the implementation diff, fail the implementation and add frontend cases first.

#### Chrome DevTools / extension verification

N/A — no frontend is implemented in Sprint 4. Raw API/cache payload inspection is covered by BE-3/BE-9. If a browser surface is added, fail the implementation and add Network/Console/Application-storage cases.

#### Operator-executed (post-cutover, see AC-OPERATOR)

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| OP-1 | Binding readiness | Confirm real `DB`/`CACHE`, AUTH, private `TELEGRAM_ALERT_CHAT_ID`, a custom Cloudflare-managed domain, verified `EMAIL_ALERT_ADDRESS`, and the `ALERT_EMAIL` binding without printing secret values. | Every required binding resolves and a safe test alert reaches both private destinations; no third-party mail provider is configured. | Not Run |
| OP-2 | Three-client timed run | Run one mixed quiz on three real clients from prepare through answer/skip, reload, timeout, retry, and finish. | Admission and personal clocks are exact; active content is redacted; batches progress once; only own score/count appears at finish. | Not Run |
| OP-3 | 120-client capacity gate | Run the committed load command against dedicated staging and retain its redacted summary. | 120 clients succeed, 121st is full, p50 submit/advance <500 ms, and all D1/KV invariants pass. | Not Run |
| OP-4 | Delayed close/alert handoff | Delay/duplicate the minute tick, force both alert conditions, and inspect production scheduled wiring. | The typed close seam is testable but unbound until Sprint 5; no global pre-settlement/rank marker appears; both private alerts fire independently at the fixed three-minute boundary. | Not Run |

### 12c. Definition of Done

- [ ] AC-1 through AC-20 are satisfied.
- [ ] AC-OPERATOR is completed by the operator or explicitly waived and recorded in §5.
- [ ] §5 remains `(none)`; no resolved boundary is reopened or contradicted.
- [ ] §12a passes locally and in CI; the load artifact exits successfully with its redacted summary.
- [ ] BE-1 through BE-12 have Status other than `Not Run` (target: `Pass`).
- [ ] Frontend and Chrome remain correctly N/A, with no frontend/mockup/design-system diff.
- [ ] OP-1 through OP-4 are completed or explicitly waived and recorded in §5.
- [ ] Raw runtime HTTP and KV artifacts contain no solution, explanation, active-score, rank, participant-clock-cache, or future-unit leakage.
- [ ] Exactly 120 distinct clients can run; the 121st is rejected; measured median unit-submit/advance is below 500 ms.
- [ ] SCHEDULER always passes limit 100, performs no SQL/KV, and consumes only exact safe discovery DTOs.
- [ ] The typed close pass is tested but absent from Sprint 4 production wiring; no whole-quiz pre-settlement, rank, `ended_at`, or `board_computed_at` write is present.
- [ ] Close alerts begin at `safeCloseAt+180000`; Telegram alert-chat and Cloudflare `ALERT_EMAIL` are attempted independently; no third-party email fallback exists.
- [ ] The §8a Hard NO list and protected-file diff checks are satisfied.
- [ ] §11 rollback has been rehearsed mentally for partial preparation, active participants, accepted receipts, either alert-channel failure, and the staged Sprint 5 close handoff.

---

End of Codex Task Packet — `claude-task--001`
