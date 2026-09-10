# claude-task--001: Publish final quiz rankings and participant review

**Sprint:** 5  **Slug:** `quiz-results-ranking-review`  **Status:** Draft

> Implements `QUIZZING results — final settlement, atomic ranking publication, participant review and per-unit timings` on the accepted Sprint 4 settlement and scheduler seams.

---

## 1. Context

Sprint 5 owns the result-publication boundary recorded in the active tracker: final settlement, atomic ranking publication, participant review, and per-unit timings (`todos/PROGRESS.md:14-23`). The authoritative release map assigns RESULT-1..9 and the per-quiz BOARD-1..3 behavior to this phase; weekly boards and the admin report remain later work (`PRD.md:263-292`).

The run is already self-paced. A participant can finish before other students, but receives only their own score and answered count until every possible submission has passed and the ranking is fully committed (`PRD.md:186-205`; `PLAN.md:163-174`). Safe close is eligible only when `now > ends_at + window_sec*1000 + 5000`; closing at admission cutoff or when current participants happen to finish early would expose solutions while a late joiner could still submit (`QUIZZING.md:206-224`).

Sprint 4 deliberately stops at a reusable per-participant settlement primitive and a tested scheduler close pass. It forbids whole-quiz pre-settlement, production close wiring, rank writes, and the `ended_at`/`board_computed_at` markers so Sprint 5 can place all of them in one global transaction (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:88-99`; `todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:177-203`). This packet consumes that handoff instead of creating a second expiry or grading path.

The D1 baseline already contains all publication state. `participants` stores accumulated totals, reached-unit time, final counts, and nullable rank; `participant_units` distinguishes reached units from unreached ones; `answers` stores only accepted final responses (`migrations/0001_init.sql:224-301`). `quizzes.status`, `ended_at`, and `board_computed_at` are the lifecycle publication fields, with `board_computed_at` documented as visible only in the commit that publishes every rank (`migrations/0001_init.sql:62-99`). No migration is required.

The exact module contract is already fixed as `closeQuiz(quizId, now): Promise<CloseResult>`. It must finalize unresolved runs, rank stored totals, and publish completion atomically; concurrent callers either observe the committed result or leave the transaction retryable (`src/core/contracts.ts:118-151`; `CONTRACTS.md:157-208`). `CloseResult` contains participant count, top 10 rows, and `boardComputedAt`, and later TELEGRAM code will consume that DTO without changing its shape (`src/core/contracts.ts:119-124`; `CONTRACTS.md:241-251`).

The HTTP wire shapes are also complete. The participant-only leaderboard returns top 10 plus the viewer's own row; review returns per-question rows plus a separate per-unit timing collection; own history uses the shared pagination convention (`src/core/api.ts:344-421`; `API.md:204-244`). The current ranking, result persistence, result route, board cache, and entrypoint files remain one-line ownership stubs (`src/core/leaderboard.ts:1`; `src/db/results.ts:1`; `src/routes/results.ts:1`; `src/services/cache.ts:1`; `src/index.ts:1`).

QUIZZING is the only writer of quiz/runtime/result tables and `board:<quizId>` cache entries. SCHEDULER calls the typed QUIZZING function and performs no SQL or KV access (`MODULES.md:52-76`; `MODULES.md:81-94`). BANK remains the sole content owner; unlocked review resolves quiz question IDs in QUIZZING and calls `BankContract.getByIds` for full authored content (`CONTRACTS.md:72-111`).

## 2. Objective

After this packet ships, every eligible quiz closes through one idempotent global transaction that settles all unfinished participants through Sprint 4's existing rules, assigns dense ranks by score descending and reached-unit time ascending, and atomically publishes every rank with `status='ended'`, `ended_at`, and `board_computed_at`. The minute scheduler and eligible participant result requests invoke the same `closeQuiz` implementation.

Authenticated participants can then read the exact top-10-plus-own leaderboard and their full review, including whole-room MCQ counts and one timing row per unit. Every authenticated user can read only their own paginated quiz history, with active scores hidden and unpublished ranks/counts represented as null.

## 3. Assumptions

- Sprint 1 AUTH is implemented first and supplies route-group authentication plus `currentUser`; result handlers never trust a user ID from a path, query, or body (`src/core/contracts.ts:11-23`; `CONTRACTS.md:46-68`).
- Sprint 3 creation is implemented first and supplies locked quiz composition, immutable flat/unit/sub-positions, derived `window_sec`, admission cutoff, and authored question IDs.
- Sprint 4 is implemented first and supplies one transaction-scoped participant settlement primitive, bounded `listDueClose`, a tested close pass in `src/services/scheduler.ts`, and finished participant aggregates (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:84-92`; `todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:163-203`).
- All injected `now`, `ended_at`, `board_computed_at`, unit clocks, and quiz schedule values are integer epoch milliseconds; `_sec` values are multiplied by 1,000 (`DATA_MODEL.md:46-60`).
- The five-second allowance is transport only. The safe-close comparison is strictly greater than the final `submit_by_at`, never greater-than-or-equal (`QUIZZING.md:218-224`; `migrations/0001_init.sql:245-270`).
- D1 is authoritative for eligibility, rank, participant ownership, review facts, and publication. KV is an optional read accelerator and cannot unlock results or make close success depend on cache availability (`PLAN.md:92-94`; `DATA_MODEL.md:108-130`).
- BANK's `getByIds` returns the full question/solution content required only after the D1 publication gate; QUIZZING continues to resolve and preserve quiz ordering (`src/core/contracts.ts:33-70`; `CONTRACTS.md:84-98`).
- The initial migration remains the executable baseline and is applied to isolated test databases. This packet adds no schema migration (`DATA_MODEL.md:1-5`; `migrations/0001_init.sql:181-301`).
- A quiz has at most 120 participants and 100 graded questions, bounding the close transaction and review collection (`PRD.md:107-116`; `API.md:24-27`).
- History is retained indefinitely and includes every quiz for which the authenticated user has a participant row (`PRD.md:194-202`; `PRD.md:247-260`).

## 4. Out of Scope

- **Weekly boards and recurring materialization:** section/overall weekly totals, IST attribution, and recurring draws are Sprint 7 (`PRD.md:270-279`; `QUIZZING.md:242-250`).
- **Telegram result publication:** Sprint 5 returns the existing `CloseResult`, but Sprint 6 owns result-post claiming, rendering, sending, and `telegram_posts` writes (`CONTRACTS.md:241-251`; `MODULES.md:63-64`).
- **Admin report export:** `/api/admin/quizzes/:id/report` and its participant/question/unit aggregates ship in Sprint 8, even though they share the same publication gate (`API.md:248-263`; `todos/PROGRESS.md:21-23`).
- **Frontend screens and browser integration:** backend implementation and verification precede frontend work; this packet adds no `web/`, design-system, or visual artifact (`PLAN.md:256-269`).
- **Quiz creation or active-run behavior:** admission, seats, drafts, unit submission, grading, retry, and request-side expiry belong to Sprints 3–4 and are consumed unchanged.
- **Regrading or answer mutation:** close ranks stored totals and never recalculates committed answer correctness/marks (`QUIZZING.md:206-212`; `DATA_MODEL.md:108-114`).
- **Live, partial, full per-quiz, or all-time boards:** V1 publishes only the final participant-only top 10 plus own row; no board is visible during play (`PRD.md:207-219`).
- **Per-question timing or speed scoring:** review timing appears once per reached unit, and V1 has no speed bonus, grace setting, or per-answer clock (`PRD.md:162-184`; `QUIZZING.md:233-240`).
- **Full item analysis:** Sprint 5 implements only the canonical participant review distribution and unit average required by the result contract.
- **Contract/schema redesign:** `src/core/contracts.ts`, `src/core/api.ts`, and `migrations/0001_init.sql` already encode this phase and must remain unchanged.

## 5. Open Questions

(none)

The safe-close predicate, global transaction boundary, ranking order/ties, publication fields, participant access, history nullability/pagination, MCQ denominator, and unit-timing rules are all explicit in current authoritative sources (`DATA_MODEL.md:108-124`; `API.md:204-244`; `QUIZZING.md:206-250`).

## 6. Pre-flight Checklist

- [ ] Required skill loaded: **`clean-code`** — required for every implementation packet.
- [ ] Required skill loaded: **`prod-safety-gate`** — global D1 settlement, scheduler wiring, result publication, and cache warming affect durable production state and traffic.
- [ ] Required skill loaded: **`test-driven-development`** — close concurrency, rankings, access gates, review aggregation, and history are new behaviors.
- [ ] Required skill loaded: **`vibesec`** — authenticated participant ownership, unpublished solutions, cross-user result data, query pagination, and SQL inputs are security-sensitive.
- [ ] Confirm the working tree is clean for this scope and the branch is current with trunk; preserve unrelated user changes.
- [ ] Confirm Sprint 1, Sprint 3, and Sprint 4 implementations plus their focused/full tests pass before adding result behavior.
- [ ] Confirm local/test `DB`, `CACHE`, and AUTH bindings exist. Use isolated fixtures and never print session cookies, real names/emails, answers, explanations, or solution content.
- [ ] Read `PRD.md:162-219`, `PLAN.md:163-182`, `MODULES.md:52-94`, `DATA_MODEL.md:65-124`, `CONTRACTS.md:72-98`, `CONTRACTS.md:157-208`, `API.md:12-46`, `API.md:204-244`, and `QUIZZING.md:206-303` before editing.
- [ ] Read exact types and DDL at `src/core/contracts.ts:33-70`, `src/core/contracts.ts:117-151`, `src/core/api.ts:344-421`, and `migrations/0001_init.sql:62-99`, `migrations/0001_init.sql:224-301`.
- [ ] Re-read the Sprint 4 handoff at `todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:84-111`, `todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:163-203`, and inspect its implemented settlement primitive before changing it.
- [ ] Write down the transaction statement/order plan and prove that no participant settlement or rank write can commit outside the publication transaction.
- [ ] Re-read AC-1 through AC-18 and AC-OPERATOR; identify implementer, route, scheduler, cache-failure, and operator checks separately.

## 7. Acceptance Criteria

1. **AC-1 — Assign the exact dense ranking in pure core code.** Sort every participant by stored `total_score DESC`, then stored `total_time_ms ASC`. Increment rank only when either value changes; exact score/time ties share the same rank and no name, seat, finish time, answered count, or hidden third tie-break changes it. A deterministic user-ID order may stabilize serialization among exact ties without changing rank (`PRD.md:166-184`; `QUIZZING.md:242-250`).
2. **AC-2 — Enforce the one safe-close predicate.** `closeQuiz(quizId,now)` re-reads authoritative quiz state and can publish only when `status='open'`, `board_computed_at IS NULL`, and `now > ends_at + window_sec*1000 + 5000`. Calls before/equal to the boundary, or for draft/scheduled/cancelled quizzes, change nothing; an already ended/published quiz reconstructs and returns its committed `CloseResult` idempotently (`CONTRACTS.md:168-192`; `QUIZZING.md:218-224`).
3. **AC-3 — Reuse participant settlement inside the global transaction.** For each unfinished participant, invoke Sprint 4's settlement logic through the same transaction-scoped executor. Finalize any reached open unit as timed out using its effective allowance, add its elapsed value once, account for all unreached questions as unanswered, start no later unit, set `finished_at` once, and leave accepted answers/receipts/marks untouched (`QUIZZING.md:193-224`; `DATA_MODEL.md:65-106`).
4. **AC-4 — Make final counts complete before ranking.** At close, every participant satisfies `correct_count + wrong_count + skipped_count + unanswered_count = quizzes.question_count`; finished participants keep their committed aggregates, and unfinished participants receive only the missing timeout/unreached zero-score counts. Missing answer rows are never reclassified by guessing from absence alone (`DATA_MODEL.md:89-120`; `PLAN.md:163-167`).
5. **AC-5 — Publish all result state in one atomic D1 transaction.** Under one serialized transaction and one eligibility recheck, settle all participants, write every participant rank, then set `quizzes.status='ended'`, `ended_at=now`, and `board_computed_at=now`. No settlement, rank, or marker survives any injected statement failure; no reader can observe a marker with null/partial ranks; a concurrent loser reads the winner's committed result (`migrations/0001_init.sql:62-99`; `CONTRACTS.md:189-197`).
6. **AC-6 — Close zero-participant quizzes cleanly.** An eligible room with no participant rows still commits `status='ended'`, `ended_at`, and `board_computed_at`, returns `{participantCount:0,top10:[],boardComputedAt}`, and remains idempotent. It does not synthesize participants or ranks.
7. **AC-7 — Return the exact close DTO and warm cache safely.** A successful or repeated close returns the exact `CloseResult`: full participant count, the first 10 published rows, and committed `boardComputedAt`. After D1 commit, write the QUIZZING-owned `board:<quizId>` cache from the committed board. KV failure is observable but does not roll back/unpublish D1; readers validate the D1 gate and fall back to a fresh D1 projection (`src/core/contracts.ts:118-124`; `MODULES.md:81-94`).
8. **AC-8 — Production-wire the existing scheduler close pass.** Compose the real Sprint 5 `closeQuiz` behind `QuizzingSchedulerContract` and enable Sprint 4's bounded close pass in the minute scheduled entrypoint. SCHEDULER continues to call `listDueClose(now,100)`, isolate candidates, and issue no SQL/KV; delayed, repeated, and concurrent ticks remain safe (`src/core/contracts.ts:140-151`; `todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:198-203`).
9. **AC-9 — Apply lazy close on participant result requests.** For leaderboard and review, authenticate, resolve the quiz, and verify caller participation first. If the D1 board gate is absent and the strict safe-close point has passed, invoke the same `closeQuiz` once and re-read committed state; otherwise return 423. A missed cron cannot strand eligible results, and an early/nonparticipant request cannot reveal or obtain solution-bearing output (`PLAN.md:169-174`; `API.md:204-229`).
10. **AC-10 — Serve the participant-only leaderboard exactly.** `GET /api/quizzes/:quizId/leaderboard` returns 401 signed out, 404 unknown quiz, 403 for a signed-in nonparticipant, and 423 until committed publication. Afterward return `participantCount`, `boardComputedAt`, top 10 rows in ranking order, plus the viewer's row only when outside those 10; set `isOwnRow` exactly and `truncated=true` only when some full-board row is omitted (`src/core/api.ts:348-358`; `API.md:206-223`).
11. **AC-11 — Build review content only after publication.** `GET /api/quizzes/:quizId/review` applies the same 401/404/403/423 ordering, resolves ordered quiz question IDs in QUIZZING, calls BANK `getByIds`, and constructs exact `QuestionReviewRow` fields explicitly. Solutions, numeric tolerance, and explanations exist only in this unlocked response and are never cached or returned by an early/error path (`src/core/api.ts:366-408`; `CONTRACTS.md:84-98`).
12. **AC-12 — Distinguish every personal review outcome.** An answer row maps to correct/wrong/skipped/unanswered and a non-null `yourAnswer`; without an answer row, a finalized reached `participant_units` row maps to unanswered while no runtime row maps to `not_reached`. Preserve null response fields and zero marks exactly; do not infer unseen status from answer absence (`API.md:231-237`; `migrations/0001_init.sql:274-301`).
13. **AC-13 — Use the full joined-participant MCQ denominator.** For each MCQ position, count chosen A/B/C/D final answers across every participant. Set `notAnsweredCount = participantCount - (A+B+C+D)`, thereby combining explicit skips, stored unanswered, served/unsubmitted timeout, and unreached cases. Assert all five buckets sum to participant count. Return `distribution:null` for TITA (`PRD.md:194-202`; `API.md:239-244`).
14. **AC-14 — Return one timing row per quiz unit.** `ReviewResponse.units` is ordered by `unitPosition` and contains exactly one row for every quiz unit. The viewer's `closeReason`/`elapsedMs` are null when unreached; `roomAvgElapsedMs` averages only non-null elapsed values from reached finalized participant-unit rows and is null if nobody reached that unit. Never duplicate set time onto questions (`src/core/api.ts:402-408`; `DATA_MODEL.md:116-120`).
15. **AC-15 — Return only the caller's paginated history.** `GET /api/students/me/history` accepts the shared default `limit=50,offset=0`, rejects fractional/out-of-range inputs with 400, returns exact `HistoryResponse`, and filters by authenticated user only. Order newest `scheduled_at` first with a deterministic quiz-ID tie-break. An active participant has `totalScore:null`; any unpublished board has `rank:null` and `participantCount:null`; a finished score may appear before publication (`API.md:24-46`; `src/core/api.ts:410-421`).
16. **AC-16 — Preserve module ownership and exact response surfaces.** QUIZZING alone writes result tables/cache, SCHEDULER only invokes contracts, BANK supplies authored content through `getByIds`, and AUTH supplies identity. Construct all API/cache DTOs field by field; bind every quiz/user/limit/offset value; errors remain `{message:string}` without SQL, stack, other-user, or solution detail (`MODULES.md:52-94`; `API.md:12-27`).
17. **AC-17 — Prove the behavior test-first.** Before production edits, add failing tests for ranking ties/order, strict boundary instants, unfinished and zero-participant close, every transaction failure point, concurrent/repeated close, cache outage, scheduler production wiring, lazy route close, access/status ordering, top-10-plus-own truncation, all five review outcomes, joined-roster distribution, per-unit averages, and history pagination/nullability. Watch each focused test fail for the missing behavior before making it pass (`PLAN.md:271-278`; `QUIZZING.md:289-303`).
18. **AC-18 — Keep later phases absent.** The implementation adds no weekly-board computation/route behavior, Telegram claim/send/result post, admin report, frontend, migration, contract edit, regrading path, live board, per-question timing, speed bonus, or all-time board. Protected-file checks and mounted-route inventory prove the boundary (`PRD.md:207-235`; `API.md:248-271`).
19. **AC-OPERATOR — Verify final publication on staging.** On an isolated staging deployment with real D1/KV/AUTH, the operator runs one mixed-unit quiz with at least three participants (one early finish, one exact rank tie, one abandoned run), delays the minute tick past safe close, and races a participant leaderboard request with the tick. Record only opaque IDs/counts/timestamps/ranks and verify one atomic publication, participant-only access, exact review distributions/timings, cache-failure fallback, and no later-phase output (`PRD.md:297-299`; `QUIZZING.md:289-303`).

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not settle participants in separate committed transactions before rank publication. The Sprint 4 primitive must accept the outer close transaction/executor.
- Do not publish `board_computed_at`, `ended_at`, or `status='ended'` before every settlement and rank write succeeds.
- Do not regrade, overwrite, delete, or synthesize accepted answer rows; close consumes committed aggregates and uses runtime membership for missing responses.
- Do not close at `ends_at`, at `safeCloseAt`, or merely because all currently joined participants finished. Eligibility is `now > safeCloseAt`.
- Do not add a `closing` status, claim column, result table, rank table, per-question timing column, migration, or new wire field.
- Do not use KV as the board publication gate, source of participant authorization, or transaction coordinator. A cache failure cannot relock a committed D1 board.
- Do not let SCHEDULER query D1/KV or implement settlement/ranking. It calls the existing bounded QUIZZING contract only.
- Do not expose a full per-quiz board. Return top 10 plus the viewer's own row only.
- Do not authorize leaderboard/review by role alone, room code, supplied user ID, or possession of a quiz ID. Require the caller's participant row.
- Do not fetch or serialize full BANK content until participant authorization and D1 publication gating succeed.
- Do not derive distribution by grouping only existing answers; missing rows must remain in the joined-participant denominator.
- Do not count a set's elapsed time per question, use unreached units as zero elapsed, or include unreached rows in room averages.
- Do not leak active totals through history or return unpublished participant count/rank there.
- Do not implement weekly boards, Telegram sends, admin report export, frontend behavior, regrading, full item analysis, speed bonuses, or all-time boards.
- Do not edit `migrations/0001_init.sql`, `src/core/contracts.ts`, `src/core/api.ts`, product documents, prior packets, fixtures, frontend/visual files, or the progress tracker.

### 8b. Coding / quality principles

- **`clean-code`:** keep Hono handlers to authenticate/parse/invoke/respond. Put dense ranking in pure core code, transactional result persistence in QUIZZING DB code, and orchestration/content assembly in one cohesive use case. Use names ending in `Ms`/`Sec` where units matter, early returns, and explicit domain outcomes.
- **`prod-safety-gate`:** the dangerous surface is the one-way result publication transaction. Test eligibility under the write lock, every statement rollback, concurrent winner/loser behavior, cache failure, missed cron fallback, zero participants, and a staging race before rollout.
- **`test-driven-development`:** add the pure rank tests first, then global D1 transaction tests, route/security/aggregation tests, and scheduler composition tests. Each must fail for the expected missing behavior before production edits.
- **`vibesec`:** authenticate first, verify participant ownership in D1, validate bounded IDs/pagination, bind SQL, construct allowlisted response/cache objects, and redact logs/tests. Solution-bearing BANK rows must never reach an early, nonparticipant, or error response.
- Preserve exact stored numeric scores/times for tie comparison. Do not introduce epsilon equality or rounded display values into ranking.
- Use one injected integer `now` throughout an invocation for eligibility, participant finish, `ended_at`, `board_computed_at`, DTOs, and tests.
- Reuse Sprint 4's settlement code through a transaction-scoped interface; extracting a shared statement planner/executor is acceptable when it keeps request and global-close semantics identical.
- Acquire/enter the serialized D1 transaction before the final eligibility recheck. Treat zero-row conditional outcomes as races, then read the committed board; do not assume they automatically roll back dependent writes.
- Query distribution from the participant roster crossed with quiz questions and left-joined answers, or an equivalently complete bounded projection. Assert the conservation equation in code/tests.
- Construct review/leaderboard/history objects explicitly. TypeScript structural typing does not remove secret or internal fields at runtime (`CONTRACTS.md:135-139`).
- Warm `board:<quizId>` only from committed D1 data. Cache reads require D1 publication/ownership checks and must fall back without changing result availability.
- Keep deterministic ordering separate from rank meaning: exact ties retain one rank even if user ID stabilizes row order.

## 9. Behavior Spec (per file)

### `src/core/leaderboard.ts`

- **Current state (line 1):** the one-line stub assigns pure per-quiz score/time ordering and dense ties here (`src/core/leaderboard.ts:1`).
- **Required edit:** implement typed, platform-independent dense-rank assignment and top-10-plus-own selection helpers used by close and route projections.
- **Estimated diff:** ~60 LOC.
- **Subtleties:** compare stored score first and integer total time second; exact ties share rank. A stable user-ID order affects serialization only.

### `src/db/play-units.ts`

- **Current state:** Sprint 4 creates this file as the single conditional unit settlement path, including server-only timeout and participant finish (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:177-182`).
- **Required edit:** expose its settlement statements/operation against an injected transaction-scoped executor so `closeQuiz` can finalize every unfinished participant without any nested/early commit.
- **Estimated diff:** ~35 LOC.
- **Subtleties:** preserve request-side receipt-first and expiry behavior. Global close starts no next unit, never fabricates accepted answers, and accounts for unreached questions only at finish.

### `src/db/results.ts`

- **Current state (line 1):** the stub assigns final settlement, atomic rank publication, review, history, and report queries to QUIZZING (`src/db/results.ts:1`).
- **Required edit:** implement the serialized `closeQuiz` transaction/reconstruction path; participant/board-gated reads; top/full board projections; joined-roster MCQ counts; per-unit viewer/average timing; and own paginated history queries.
- **Estimated diff:** ~100 LOC per cohesive component; split close writes from read projections if either exceeds that size.
- **Subtleties:** condition eligibility inside the transaction; include zero participants; bind fixed query branches; keep review joins complete when answer rows are absent; do not implement admin report queries yet.

### `src/services/cache.ts`

- **Current state (line 1):** the shared cache stub reserves `board:<quizId|weekStart>` for QUIZZING while keeping D1 authoritative (`src/services/cache.ts:1`).
- **Required edit:** add validated get/put helpers for committed per-quiz board projections and explicit miss/write-failure outcomes.
- **Estimated diff:** ~35 LOC.
- **Subtleties:** preserve AUTH/unit helpers from earlier sprints. Never cache solution-bearing review rows, personal history, ownership, or a pre-publication marker.

### `src/services/quiz-results.ts` (new)

- **Current state:** no result use-case layer exists; persistence and routes are one-line stubs (`src/db/results.ts:1`; `src/routes/results.ts:1`).
- **Required edit:** implement `closeQuiz` as the scheduler contract adapter, coordinate committed board caching, lazy participant result close, BANK `getByIds`, and explicit leaderboard/review/history DTO assembly.
- **Estimated diff:** ~100 LOC; split close orchestration from read assembly if needed.
- **Subtleties:** authorize and gate before BANK content reads; re-read after lazy close/concurrent loss; cache failure never changes D1 success; return exact existing types.

### `src/routes/results.ts`

- **Current state (line 1):** the stub assigns participant-only leaderboard/review and own history to this route adapter (`src/routes/results.ts:1`).
- **Required edit:** mount the three Sprint 5 GET routes, apply Sprint 1 authentication, parse bounded quiz IDs and exact pagination, invoke result use cases, serialize allowlisted DTOs, and map 400/401/403/404/423 to generic errors.
- **Estimated diff:** ~75 LOC.
- **Subtleties:** participant checks precede solution fetches. Do not mount weekly-board or admin-report behavior through this file.

### `src/index.ts`

- **Current state (line 1):** the entrypoint stub owns Hono mounting and scheduled orchestration (`src/index.ts:1`); Sprint 4 explicitly leaves its tested close pass unbound (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:226-231`).
- **Required edit:** preserve prior mounts, compose the result repository/cache/BANK use case, mount the three result routes, bind real `closeQuiz` into `QuizzingSchedulerContract`, and enable the existing bounded close pass in the minute tick.
- **Estimated diff:** ~30 LOC.
- **Subtleties:** request and cron paths share one service instance/predicate. Do not wire Telegram result sends, hourly materialization, weekly computation, or report export.

### `tests/leaderboard.test.ts` (new)

- **Current state:** ranking has only a core ownership comment and design requirements (`src/core/leaderboard.ts:1`; `PRD.md:173-184`).
- **Required edit:** table-test empty/single boards, score precedence, time precedence, negative/fractional scores, exact dense ties, stable serialization, rank gaps, and top-10-plus-own/truncation selection.
- **Estimated diff:** ~75 LOC.
- **Subtleties:** expected ranks must be explicit fixtures, not calculated by copying the production algorithm.

### `tests/quiz-results.test.ts` (new)

- **Current state:** result D1 behavior has no executable tests; only schema/contracts and the Sprint 4 handoff exist (`migrations/0001_init.sql:224-301`; `src/db/results.ts:1`).
- **Required edit:** use isolated migrated D1 plus Sprint 4 settlement fixtures to test strict eligibility, abandoned/mixed finished runs, count/time invariants, zero participants, exact ranks, every forced transaction failure, concurrent/repeated close, and cache outage/fallback.
- **Estimated diff:** ~100 LOC per close/read suite.
- **Subtleties:** inspect raw rows after every failure/race. Assert no accepted answer changed, no new unit started, and markers/ranks are all-or-none.

### `tests/results.routes.test.ts` (new)

- **Current state:** exact HTTP shapes exist, but the result route is still a one-line stub (`API.md:204-244`; `src/routes/results.ts:1`).
- **Required edit:** exercise all three mounted routes for auth/ownership/status ordering, early/equal/late lazy close, top-10-plus-own, every review outcome, full-room distributions, timing rows/averages, history pagination/order/nullability, and raw response key allowlists.
- **Estimated diff:** ~100 LOC per cohesive route/aggregation suite.
- **Subtleties:** use another participant and a nonparticipant. Prove no BANK solution fetch occurs before authorization/publication and no active other-user data appears.

### `tests/scheduler-minute.test.ts`

- **Current state:** Sprint 4 creates a tested close pass but requires production composition to omit it until this sprint (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:254-259`).
- **Required edit:** replace the absence assertion with real production binding coverage; test limit 100, delayed/duplicate/concurrent close, per-candidate isolation, committed `CloseResult` return, and continued zero SQL/KV inside SCHEDULER.
- **Estimated diff:** ~35 LOC.
- **Subtleties:** retain all Sprint 4 prepare/alert tests. Do not expect Telegram result posts; those remain Sprint 6.

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Close runs at/equal to the receipt boundary and rejects a still-valid final batch | Med | High | AC-2 strict `now > safeCloseAt` tests at -1/equal/+1. |
| Whole-quiz settlement commits before ranking/publication | Med | High | AC-3/5 outer transaction and forced-failure tests. |
| Nested Sprint 4 settlement commits defeat global rollback | Med | High | Transaction-scoped executor in AC-3 and `src/db/play-units.ts` guardrail. |
| Concurrent cron/lazy calls publish partial or conflicting ranks | High | High | Serialized eligibility recheck, conditional loser recovery, and AC-5 races. |
| Zero-row conditional write is mistaken for rollback | Med | High | Explicit race outcome and committed-result re-read in AC-5. |
| Abandoned runs retain incomplete counts or start unseen units | Med | High | AC-3/4 participant aggregate conservation checks. |
| Close accidentally regrades or overwrites accepted answers | Low | High | Stored-total ranking, raw before/after assertions, and hard NO list. |
| Floating display rounding changes exact rank ties | Med | High | AC-1 ranks raw stored values with no epsilon/rounding. |
| KV failure leaves a committed board inaccessible | Med | High | D1 gate/fallback and post-commit cache handling in AC-7. |
| Stale KV exposes a board before D1 publication | Low | High | D1 ownership/publication check precedes every cache read. |
| Nonparticipant triggers solution fetch or reads another student's results | Med | High | AC-9/10/11 D1 participant check and call-order tests. |
| Distribution omits skipped/missing/unreached participants | High | High | Joined roster and conservation equation in AC-13. |
| Missing answer row is mislabeled `not_reached` | Med | High | AC-12 consults `participant_units`. |
| Set timing is multiplied per question or unreached rows lower averages | Med | High | AC-14 one-row-per-unit and reached-only aggregate tests. |
| History leaks an active score or unpublished participant count | Med | High | AC-15 nullability and cross-user route tests. |
| Scheduler crosses module ownership or one failure blocks later candidates | Low | High | Reuse Sprint 4 pass and AC-8 contract-only isolation tests. |
| Result changes break later `CloseResult` consumers | Med | Med | Keep `src/core/contracts.ts` unchanged and test exact DTO shape. |
| Test isolation leaves published rows/cache between cases | Med | Med | Fresh migrated D1/KV fixtures and injected clock per test. |
| Type/lint drift or invented scripts hide regressions | Low | Med | Existing package scripts only, focused tests, typecheck, full suite. |
| Operator validates with real student PII or solution logs | Low | High | Isolated staging fixtures and redacted AC-OPERATOR evidence. |
| Later weekly/Telegram/report work enters this sprint | Med | Med | AC-18 protected diffs and route inventory checks. |

## 11. Rollback / Revert Plan

1. Stop/route away new result and scheduled-close traffic while preserving active submission traffic; do not cancel quizzes, delete participants, or mutate accepted answers.
2. Record only opaque affected quiz IDs, D1 `status`, marker presence, participant/rank counts, and safe timestamps. Do not export names, emails, cookies, answers, explanations, or solution content.
3. If a quiz has `board_computed_at IS NULL`, leave it locked for a corrected idempotent forward retry. Never manually pre-settle participants or write ranks/markers separately (`DATA_MODEL.md:108-120`).
4. If a quiz has `board_computed_at IS NOT NULL`, treat its D1 publication as committed. Do not clear markers/ranks or reopen it; preserve history and use a reviewed forward repair if invariant checks reveal corruption.
5. Run `git revert <sha>` for the Sprint 5 implementation and redeploy/restart the prior Worker request and scheduled entrypoints. The reverted build restores Sprint 4's close pass to unbound production state (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:226-231`).
6. Keep `migrations/0001_init.sql` and all accepted runtime rows; this packet adds no migration. Remove/ignore stale `board:<quizId>` cache entries only through the existing scoped cache helper, never with a broad namespace delete.
7. Verify reverted leaderboard/review/history routes are absent or return the previous generic response, the minute tick no longer calls production `closeQuiz`, and Sprint 1–4 focused/full tests still pass.
8. Read D1 to confirm active quiz submissions remain acceptable, unpublished quizzes still have null ranks/markers, and already published quizzes retain complete ranks with `status='ended'` (`migrations/0001_init.sql:62-99`; `migrations/0001_init.sql:226-243`).
9. Notify the project owner through the configured private incident channels with opaque IDs, rollback time, whether each quiz was unpublished or already committed, and the forward-repair owner.
10. After stability, retry only unpublished eligible quizzes with the fixed atomic path. Never restore availability by setting `board_computed_at` manually or serving solution data from cache alone.

## 12. Verification + Definition of Done

### 12a. Automated verification

```bash
npm ci
npm run typecheck
npm test -- tests/leaderboard.test.ts
npm test -- tests/quiz-results.test.ts
npm test -- tests/results.routes.test.ts
npm test -- tests/scheduler-minute.test.ts
npm test

git diff --exit-code -- migrations/0001_init.sql src/core/contracts.ts src/core/api.ts
git diff --exit-code -- PRD.md PLAN.md MODULES.md DATA_MODEL.md CONTRACTS.md API.md QUIZZING.md SCHEDULER.md
git diff --exit-code -- src/db/users.ts src/db/bank.ts src/db/quizzes.ts src/db/boards.ts src/db/telegram.ts
git diff --exit-code -- src/routes/auth.ts src/routes/admins.ts src/routes/bank.ts src/routes/images.ts src/routes/quizzes.ts src/routes/play.ts src/routes/boards.ts src/routes/reports.ts
git diff --exit-code -- src/services/telegram.ts wrangler.toml

! rg -n "computeWeeklyBoards|claimAndSend|AdminReportResponse|speedBonus|perQuestionElapsed" \
  src/core/leaderboard.ts src/db/results.ts src/services/quiz-results.ts src/routes/results.ts
```

All commands must succeed. Focused tests must generate raw D1/HTTP/cache assertions in memory or redacted temporary artifacts, and the full suite must preserve Sprint 1–4 behavior. Protected-file diffs must be empty.

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | Safe-close boundary | Seed an open quiz and call close/result at `safeCloseAt-1`, equal, and +1. | First two change nothing/return 423; +1 publishes once. | Not Run |
| BE-2 | Atomic abandoned settlement | Mix finished, reached-timeout, and unreached participants; inject failures at each close statement. | Every failure leaves all settlement/rank/marker state unchanged; success completes all counts/times/ranks. | Not Run |
| BE-3 | Concurrent/idempotent close | Race two ticks and one participant result request, then repeat all calls. | One atomic winner; every caller observes the same committed `CloseResult`; no duplicate effects. | Not Run |
| BE-4 | Dense ranking | Seed score/time precedence, exact ties, negative/fractional scores, and more than 10 rows. | Dense ranks follow score DESC/time ASC; exact ties share rank; top 10/own projection is exact. | Not Run |
| BE-5 | Zero participants and cache outage | Close an empty eligible room with KV writes/reads failing. | Empty D1 board publishes; committed result remains readable by authoritative fallback where access applies. | Not Run |
| BE-6 | Access and publication gates | Request leaderboard/review signed out, as nonparticipant, as participant before/equal/after safe close, and for unknown quiz. | 401/403/423/404 mapping is generic; no solution fetch/body occurs before allowed publication. | Not Run |
| BE-7 | Review outcomes/distribution | Seed correct, wrong, skipped, stored unanswered, served-unsubmitted, and unreached cases across MCQ/TITA. | Personal outcomes are distinct; A/B/C/D/not-answered cover the full roster; TITA distribution is null. | Not Run |
| BE-8 | Unit timing | Seed mixed units with completed/timed-out/unreached participants and one never-reached unit. | Exactly one ordered row per unit; viewer nulls and reached-only averages are exact. | Not Run |
| BE-9 | Own history | Seed active, finished-unpublished, published, and cancelled participation; vary valid/invalid pagination. | Only caller's rows appear newest-first; score/rank/count nullability and 400 rules are exact. | Not Run |
| BE-10 | Scheduler production wiring | Run delayed/repeated minute ticks over 105 due candidates with one failure. | Calls remain bounded/ordered/isolated; real close is wired; SCHEDULER performs no SQL/KV. | Not Run |

#### Frontend / UI

N/A — this is a backend-only packet and frontend implementation follows backend verification. If any frontend or visual file enters the diff, fail the implementation and add UI cases first.

#### Chrome DevTools / extension verification

N/A — no browser client is implemented in Sprint 5. Raw mounted-Worker response/cache inspection is covered by BE-5 through BE-9. If a browser surface is added, fail the implementation and add Network/Console/Application cases.

#### Operator-executed (post-cutover, see AC-OPERATOR)

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| OP-1 | Three-participant final close | Run a mixed-unit staging quiz with early, tied, and abandoned participants; wait through the strict safe boundary. | One atomic publication finishes all participants and writes every rank plus all three quiz markers. | Not Run |
| OP-2 | Tick/request race | Delay cron, then race the minute tick with an eligible participant leaderboard request. | Both paths converge on one committed board and identical visible result. | Not Run |
| OP-3 | Participant secrecy | Before and after publication, request results as a participant and a signed-in nonparticipant. | No early solution/rank leak; post-close participant succeeds; nonparticipant remains 403. | Not Run |
| OP-4 | Review and history evidence | Inspect the participant's review/history and compare redacted aggregate evidence with D1 counts. | Full-room MCQ buckets conserve participant count, one timing row appears per unit, and history nullability/order is correct. | Not Run |
| OP-5 | KV degradation | Disable/fail the scoped board cache on staging after a committed close and repeat allowed reads. | D1-backed results remain available; no marker/rank changes and no sensitive log output occur. | Not Run |

### 12c. Definition of Done

- [ ] AC-1 through AC-18 are satisfied.
- [ ] AC-OPERATOR is completed or explicitly waived in §5.
- [ ] §5 remains `(none)` with no unresolved decision markers.
- [ ] §12a passes locally and in CI; focused RED failures were observed before production implementation.
- [ ] BE-1 through BE-10 have Status other than `Not Run` (target: `Pass`).
- [ ] Frontend and Chrome remain correctly N/A, with no frontend/visual diff.
- [ ] OP-1 through OP-5 are completed or explicitly waived in §5.
- [ ] Raw D1 invariants prove settlement/ranks/markers are all-or-none across failures and races.
- [ ] Every published participant has a non-null dense rank and complete final counts; zero-participant publication is valid.
- [ ] Leaderboard/review require caller participation and committed D1 publication; no early BANK solution fetch occurs.
- [ ] MCQ buckets sum to the full participant count and each review has exactly one timing row per quiz unit.
- [ ] History is caller-only, paginated, and hides active score plus unpublished rank/count.
- [ ] The minute tick production-wires real `closeQuiz` while SCHEDULER still performs no SQL/KV.
- [ ] KV failure cannot publish, hide, or corrupt an authoritative D1 result.
- [ ] No weekly board, Telegram send, admin report, frontend, migration, contract edit, regrading, speed bonus, or per-question timing entered the diff.
- [ ] §8a Hard NO list and all protected-file checks are satisfied.
- [ ] §11 rollback was rehearsed for unpublished versus already committed quizzes.

---

End of Codex Task Packet — `claude-task--001`
