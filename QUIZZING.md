# Quizzer — Quizzing Module

> **Status:** V1 design, not implemented. Revised 2026-09-09.
> **Authority:** [[PRD]] requirements; schema in `migrations/0001_init.sql`; [[DATA_MODEL]],
> [[CONTRACTS]] and [[API]] describe storage and interfaces. Existing `todos/` packets and
> mockups predate this revision and must be revised before implementation; left untouched here.

## 1. Responsibilities

| Sub-area | Backend phase | Owns |
|---|---|---|
| Creation | 3 | Draw, timed-unit composition, allowances, lock/retire, room identity, schedule |
| Run | 4 | Seats, unit delivery, authoritative clocks, batch acceptance, progression and resume |
| Results | 5 | Finalization, marks, ranking, review and reports |
| Boards | 7 | Weekly aggregation and recurring occurrence creation |

BANK owns shared RC/LRDI material and question membership. QUIZZING owns each quiz's ordered
units and time allowances. It resolves question IDs itself, then calls BANK; BANK never reads
quiz runtime tables. SCHEDULER orchestrates opening/closing, never individual unit timers.

## 2. Requirements covered

QUIZ-1..10, ROOM-1..17, SCORE-1..8, RESULT-1..9, BOARD-1..9, ADMIN-1..2.
SCORE-2 is reserved for V2; no speed bonus or scoring grace window exists in V1.

## 3. Invariants

1. Draw from unused content only; lock retires whole groups through BANK. Never reuse on shortage.
2. Serve only the active unit, with no correct answers, tolerances, explanations or running score.
3. Responses can change locally until the unit closes. Accepted final responses never change.
4. A unit has one immutable server start/deadline; Back, Skip, reload and retries never reset it.
5. A closure, its answer rows, totals and progression commit together, once. No partial set saves.
6. A closed unit cannot be reopened. Future units cannot be fetched before progression permits it.
7. Ranking/review publish only after the last possible submission and complete ranking commit.

## 4. Creation (Phase 3)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/quizzes` | Paginated list, including recoverable drafts and their unit definitions |
| POST | `/api/admin/quizzes` | Draw questions and construct ordered timed units in a draft |
| POST | `/api/admin/quizzes/:id/reshuffle` | Redraw unlocked draft and rebuild units |
| PATCH | `/api/admin/quizzes/:id` | Timing policy, unit overrides, marks, admission schedule and cap |
| POST | `/api/admin/quizzes/:id/lock` | Validate complete settings, retire content and assign room identity |
| POST | `/api/admin/quizzes/:id/cancel` | Cancel a draft/scheduled/open quiz; never return content to the pool |

Every complete RC/LRDI group is one timed unit, and every standalone question is one timed unit.
A draw with one four-question RC group and two standalones has six questions and three timed
units. Maintain flat integer `position` for answer identity, `unit_position` for ordering and
`sub_position` within the unit. Display the example as `1.1`..`1.4`, `2`, `3`; never decimal IDs.

The auto-draw request shape is `DrawRequest` (revised 2026-09-12), discriminated by `type`, because
a flat graded-question `count` cannot express "1" meaning "1 set" for a fully-grouped section: a
quant request still asks for an exact standalone `count`/`difficultyMix`. An lr request asks for a
whole-set `setCount` only — lr is always fully grouped, so a count of 1 always means one complete
4–5-question LRDI set, never a single question (the request that used to fail outright, since no
1-question lrdi group exists). A verbal request asks for `setCount` (RC passages) and
`standaloneCount`/`standaloneDifficultyMix` (VA questions) independently — asking for 1 RC passage
can never be silently satisfied by grabbing a lone standalone VA question instead, and vice versa.
`difficultyMix` scopes the standalone portion only; a set's members keep whatever difficulty they
were authored with, since BANK's `passages` carry no difficulty of their own. The persisted request
(`setCount`/`standaloneCount`/`difficultyMix`) is distinct from the actual draw result
(`questionCount`/`unitCount`): a set-based draw's real size varies occurrence to occurrence since
sets are 4–5 questions each, so reshuffle/materialization always recompute the actual totals fresh
from whatever units the redraw lands on, never assume they match the prior draw.

The existing bank `passages` structure represents both RC passages and LRDI shared material.
A grouped verbal question belongs to an `rc` unit; grouped quant/lr questions to an `lrdi` unit.
Standalone units have no passage. Groups remain 4–5 questions in V1; keep all members together
and in bank `group_position` order. The units themselves have the same order for all students.

Creation sequence:

1. Store title, scheduled time, section and the `DrawRequest` (set/standalone counts, maximum 100
   each, and a standalone-only difficulty mix) in a draft.
2. Draw whole unused groups and/or standalones to satisfy the request. Fail loudly on insufficient
   supply, impossible composition, or a resulting total over 100 graded questions; no partial draw
   and no reuse.
3. Return full admin question content plus explicit unit definitions/counts for preview.
4. Configure `timingPolicy` (seconds by `standalone`/`rc`/`lrdi`), optional per-unit overrides,
   `slackSec`, `joinWindowSec`, `marksCorrect`, `marksWrong`, and seat cap (maximum 120).
5. Derive duration from the actual units. Reshuffling discards per-unit overrides and reapplies
   the stored policy to the new draw; report the revised duration/composition for review.
6. At lock require contiguous unit/question/subquestion positions, complete group membership,
   one question in each standalone, positive integer allowances, finite marks, positive correct
   marks, non-positive wrong marks, non-negative integer slack and a positive admission length.
7. On the first lock attempt, durably reserve the next sequential quiz number while keeping the
   quiz in `draft`; this supplies the stable number required by `BankContract.claimUnused`.
   Reservations may leave gaps and stay hidden in API draft responses. Call BANK with that same
   quiz id/number on every retry. BANK returns newly claimed ids plus ids already owned by the
   same quiz identity. On a full confirmation, assign a unique room code and move `draft` to
   `scheduled`; a retry after an ambiguous BANK success can therefore finish publication. A true
   short claim prevents lock; no automatic release is built.

A PATCH changing `timingPolicy` reapplies defaults to **all** units, then applies any overrides
in that request. A PATCH with only `unitTimeLimits` changes only listed units. Unknown/repeated
unit positions or missing policies for kinds in the draw are invalid. Recompute derived fields
on every relevant write. Settings may change only in `draft`/`scheduled`; once `open`, return 409.
The single trusted-admin scope remains: cross-admin rollback/release machinery is not added.

```
lobby_opens_at = scheduled_at - 300000
ends_at = scheduled_at + join_window_sec * 1000
window_sec = SUM(quiz_units.time_limit_sec) + slack_sec
student_deadline = participants.started_at + window_sec * 1000
```

`windowSec` is output, never an editable duration override. Admission length is independently
configured; changing set allowances cannot silently change when the join window closes.
A template stores a timing policy, slack and admission length; QUIZZING derives the duration
again from each actual recurring draw. Templates do not store a fixed duration copied blindly
across different set/standalone compositions.

### 4.4 Template CRUD (resolved 2026-09-12)

Admin CRUD on `quiz_templates` is in scope: create, list, view, edit and deactivate. There is no
hard delete — `quizzes.template_id` references a template row indefinitely, so removing one would
orphan history. Deactivation only flips `active = 0`, which `materializeTemplates` already excludes
(`getActiveTemplates` filters `active = 1`); already-materialized quizzes are untouched.

A template's fields mirror an auto-draw quiz definition: `name`, `type`, `setCount`/
`standaloneCount` (type-conditional `DrawRequest` fields — §4 above — `null` for whichever half
doesn't apply), `difficultyMix` (scopes `standaloneCount` only), `timingPolicy` (only the unit
kinds implied by `type`, matching the same
per-used-kind validation `patchSettings` already applies to manual quizzes), `slackSec`,
`joinWindowSec`, `marksCorrect`, `marksWrong`, `seatCap`, and `rrule` (the same minimal RRULE
subset resolved for Sprint 7 above). Reject a body outside these fields the same way manual
creation does.

Editing an active template changes only future materializations. Each materialized quiz is
already an independent row with its own drawn units/questions/timing snapshot, so an edit has no
retroactive effect on quizzes already produced — no versioning or history table is introduced for
this.

Creating or editing a template does not dry-run the draw against current bank counts. Selection
can still fail at materialization time; the existing hourly `MaterializationFailure` reporting and
alert path (Telegram + email, §7) is the sole failure signal and is unchanged by this sprint.

### 4.5 Manual question selection (resolved 2026-09-12)

`POST /api/admin/quizzes` accepts an optional `mode: 'auto' | 'manual'` (default `'auto'`).
`'auto'` is the `DrawRequest`-driven draw described above (§4). `'manual'` lets the
admin hand-pick exact `questionIds` instead: no `DrawRequest` field is accepted with
`mode: 'manual'`, and `questionIds` is not accepted with `mode: 'auto'` (or omitted). A quiz's
`selection_mode` is fixed at creation and stored on `quizzes` (`DEFAULT 'auto'`); it cannot be
changed after creation, and reshuffling a `'manual'` draft is rejected (409, `manual_locked`) —
there is no auto pool/difficultyMix target to redraw from since the admin picked these exact
questions.

Manual validation reuses `BankContract.listUnused` with `{ easy: 1, medium: 1, hard: 1 }` to fetch
the full fresh unused pool for the quiz's `type` (§1's note: `listUnused` only reads key presence,
never the per-difficulty values), then validates the admin's `questionIds` against it: reject
duplicate ids, reject any id absent from the fresh pool (`unknown_question` — covers a since-used
id going stale between picker load and submit), and reject a partially-selected RC/LRDI group
(`partial_group`) — a group is selected whole or not at all, exactly like the auto draw's own
whole-unit rule. `questionCount`/`difficultyMix` are derived by tallying the validated selection,
never accepted from the client. Units are ordered by the admin's first-pick order (the minimum
index of any of a unit's member ids within `questionIds`), not bank insertion order; each group's
own questions still follow bank `group_position` order.

Recurring templates and `materializeTemplates` are completely unaffected: they have no `mode`
field, no manual code path, and every template-created quiz's `selection_mode` is `'auto'` by
database default (`DraftInsert.selectionMode` is never set on that path). `GET /api/bank/questions`
gained an optional `passageId` filter purely to support the admin question picker's group-aware
selection (checking one member of an RC/LRDI group surfaces the rest of that group).

## 5. Run (Phase 4)

### 5.1 Routes and admission

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/quizzes/open` | Authenticated list of quizzes accepting new joins |
| POST | `/api/quizzes/:code/join` | Idempotent seat claim and first unit, or existing participant state |
| GET | `/api/play/:quizId/current` | Resume authoritative current unit or finish state |
| POST | `/api/play/:quizId/units/:unitPosition/submit` | Submit one complete unit batch and advance |
| GET | `/api/play/:quizId/status` | Finished student's score and holding-screen information |

The old `/answer`, `/skip`, and `/timeout` per-question write routes are removed from V1.
Back, answer selection, Clear and Skip are browser-local operations. The one batch endpoint
handles both normal completion and timeout submissions.

`openRoom` prepares seats/content and sets `status='open'` at T−5m. Admission and public room-code
release start at `scheduled_at`, not T−5m. New joins require `scheduled_at <= now < ends_at`.
Preparation alone must never start a student's timer. There is no `running` status or start job.
A late joiner gets the full duration from their own join. Existing participants can resume after
admission closes; returning to a cancelled quiz yields 409.

Pre-seed seats 1..cap. Claim using a conditional update of an empty seat and enforce
`UNIQUE(quiz_id,user_id)`. Retrying a join must recover the existing participant, not claim
another seat or restart their clock. Persist the participant and unit-1 start before serving it.

### 5.2 Active-unit content and local editing

Serve `ServedUnit`: the complete redacted active unit, including shared text/image, every
subquestion, unit count, question count and server timing. Cache only `UnitContent`; attach each
student's immutable timestamps from D1. Never cache personal clocks or drafts in shared KV.

The UI displays one subquestion at a time with the shared material pinned. Back/Next/navigation
may revisit any subquestion in the active unit. Choosing an answer and advancing saves a local
`answered` response; Skip stores an explicit `skipped` response and clears any selected answer.
Clear makes a question unresolved again. The current subquestion and draft responses persist
in browser storage keyed by user, quiz and unit. No answer writes reach D1 during this editing.

The action that resolves the final outstanding question **automatically freezes and submits the
entire unit**; there is no separate review-all or confirmation step. "Last" means the final
unresolved question, not necessarily the highest-numbered question. Label that action
"Answer & finish set" or "Skip & finish set". A standalone closes on its sole answer/skip.
A pending submission cannot be edited; retain its exact payload and retry key until acknowledged.
Closed units stay inaccessible during the run even if their original timer had time left.

### 5.3 Authoritative clocks and delivery

```
unit_deadline = MIN(unit_started_at + time_limit_sec*1000, student_deadline)
elapsed_ms = MIN(MAX(received_at - unit_started_at, 0), unit_deadline - unit_started_at)
```

At normal closure use the server's batch-receipt time, never browser answer timestamps.
For timeout closure use the full effective allowance (`unit_deadline - unit_started_at`).
Read passage time counts once. Sum finalized reached-unit elapsed values into `total_time_ms`;
never copy a set duration into every answer or infer individual question timing.
Unused unit allowance is not transferred to another unit. Navigation and reconnect cannot pause
or extend a unit. Overall slack accommodates transitions; it does not increase unit allowances.
The next unit starts when the server first serves it as part of successful progression, capped
by the student's overall deadline. No future-unit clock starts solely because an offline unit
expired: unseen units are not silently run through while the student is disconnected.

**V1 delivery policy:** `submitByAt = deadlineAt + 5,000 ms`. `deadlineAt` ends editing; the
client freezes its exact payload and submission ID at that instant. The five seconds through
`submitByAt` are for delivery only. The server accepts the frozen batch during that interval and
caps elapsed time at the editing deadline. Settlement is eligible only when
`serverNow > submitByAt`, so it cannot race a still-acceptable final batch. A new batch after
`submitByAt` cannot score; an identical retry of a previously accepted batch is still
acknowledged. Browser timestamps are never trusted. At expiry the frozen timeout batch includes
unresolved positions as `unanswered`. A custom client could modify answers during this small
window because the server cannot verify the freeze; V1 accepts that under its trust-based model.

### 5.4 Atomic acceptance, retries and expiry

Validate the entire payload before any mutation: authenticated participant, current unit,
unique submission ID, exactly one entry per unit question, unique/matching positions, MCQ/TITA
format matching bank content, finite numeric values and no extra answer fields on skips.
`reason='complete'` requires every entry to be answered/skipped; `reason='timeout'` may include
unanswered entries and is legal at/after the editing deadline. A normal completion sent before
the deadline but received during the transport window is also accepted. Any previously unseen
batch received after `submitByAt` is rejected; accepted retries remain valid.

In one atomic D1 transaction/batch: conditionally claim the still-open unit, insert validated
final answer rows, grade them, update participant counts/score/time, close the unit, then create
the next unit runtime row or finish the participant. A losing conditional update is **not an
SQL error**: all dependent writes must be conditioned on ownership of that same submission,
with aggregate deltas applied exactly once. Any statement failure rolls back the entire batch.
No claim-only commit may precede answers/totals. Small sets (4–5 questions) keep this bounded.

The saved `submission_id` and canonical `payload_hash` identify an accepted batch. Identical
retries return its closure receipt plus **current** authoritative play state (not stale next-unit
timestamps). A different payload or submission key for a closed unit returns 409. Check accepted
receipts before rejecting a retry as late. Concurrent submissions, expiry and resume must share
the same conditional closure rule; only one can advance/update totals.

There is no background timer per student. Once its receipt window has ended, `current`, a late
submission, or final quiz close can expire the active unit with zero marks if no batch arrived.
Server-only expiry need not fabricate answer rows. Record the unit timeout and unanswered count,
then serve the next unit on the next live request if overall time remains. At the overall
deadline stop editing and never start another unit; wait through its five-second receipt window
before finalizing the run, while still acknowledging previously accepted retries.
Unreached units score zero, have no runtime/answer rows, and contribute no elapsed time.

Same-browser reload can restore local drafts while that unit is active. Another device, cleared
storage, or a browser that never sends its draft cannot recover those answers from the server.
Preserve confirmed batches, recover current state after lost responses, and clearly distinguish
local saved responses from server-accepted ones. V1 does not promise lossless offline submission.

## 6. Scoring and results (Phase 5)

Correct = `marks_correct`; wrong = `marks_wrong`; skipped/unanswered/unreached = 0.
No V1 bonus, grace window, bonus settings, per-answer timing or bonus breakdown.
Grading stays server-side (MCQ compare, TITA tolerance). Score a unit's answers only on accepted
batch closure; `closeQuiz` finalizes unresolved units and ranks the stored totals, never regrades
already committed answers. `answeredCount = correct_count + wrong_count` counts committed answers.

Finish occurs on final-unit closure or overall expiry. Until then `/status` returns 409 and
history hides the active run's intermediate score. After finish return own score/answered count,
then holding information only. No correctness/count breakdown, rank or solutions before unlock.

The last safe close point is `ends_at + window_sec*1000 + 5,000`; close only when `now >` that
point so a final batch from the latest possible participant remains acceptable.
Never close merely at `ends_at`, or when the currently joined students happen to finish early.
Quiz close must finalize abandoned active units, account for unreached questions, rank, and set
`board_computed_at`/`status='ended'`/`ended_at` in one atomic publication. The conditional claim
and rank writes must commit together: do not expose `board_computed_at` while ranks are partial.
Concurrent callers read the committed result or remain locked; a failed transaction is retryable.

| Method | Path | Access |
|---|---|---|
| GET | `/api/quizzes/:quizId/leaderboard` | Participant only; 423 until board completion |
| GET | `/api/quizzes/:quizId/review` | Participant only; 423 until board completion |
| GET | `/api/students/me/history` | Own history; active score is null, unfinished rank is null |
| GET | `/api/boards/weekly` | Every authenticated student |

Results handlers call `closeQuiz` lazily after the safe close point if cron has not done so.
The per-quiz board is top 10 plus the viewer's own row, not the full board. Review provides each
question, final answer, marks, explanation and MCQ distribution. Distribution counts use every
participant as the denominator: A/B/C/D plus a not-answered bucket that includes skips,
timeouts/unsubmitted responses and unreached questions. Unit timings and room averages appear
**once per set/standalone**, never as invented per-question timings. An absent
answer row alone no longer means "never reached": consult `participant_units` to distinguish a
served but unsubmitted timeout from an unreached unit. Explicit skips stay distinct from both.

## 7. Boards and reports

Per-quiz order: score descending, `total_time_ms` ascending; exact ties share a dense rank.
`total_time_ms` is the sum of reached-unit completion times, including reading once per unit.
Weekly rankings use total score across quizzes taken in the IST week, with no minimum
participation, for section and overall boards. `quizzes_taken` is displayed for context but does
not divide the score or break ties. Exact total-score ties share a dense rank; any stable
name/user-id ordering among tied rows is presentational only. Attribute quizzes by scheduled
time. No all-time, partial, or live leaderboard.

`GET /api/admin/quizzes/:id/report` requires admin and completed board (423 otherwise). Export
participant scores, correct/wrong/skipped/unanswered counts, total unit time and rank; per-question
counts remain available, plus unit timing aggregates. Missing answer rows must be included as
unanswered via roster/question joins, not omitted by grouping only existing answers. Full item
analysis and live monitoring remain deferred. Weekly template CRUD is specified in §4.4.

## 8. Data owned

`quiz_templates`, `quizzes`, `quiz_units`, `quiz_questions`, `quiz_seats`, `participants`,
`participant_units`, `answers`, `weekly_boards`. Schema details: [[DATA_MODEL]].
BANK alone writes `questions`/`passages`; access is through its contract. TELEGRAM owns post rows.

## 9. Interfaces

`openRoom(quizId, now)`, `closeQuiz(quizId, now)`, `materializeTemplates(days, now)`,
`computeWeeklyBoards(weekStart)` retain their named contract in `src/core/contracts.ts`.
QUIZZING performs all D1/KV effects; SCHEDULER performs none. Redacted content uses
`unit:<quizId>:<unitPosition>` keys. On a KV miss, use the freshly constructed content directly,
not a read-after-write through eventually consistent KV. Participant state always comes from D1.

## 10. Limits and accepted tradeoffs

- Batch submission reduces gameplay requests to roughly one per unit but adds persisted unit
  starts/closures. Re-measure CPU, writes and payload size; old per-question budgets are obsolete.
- Local-only drafts cannot be recovered cross-device or scored after the delivery cutoff.
- Network latency affects server completion-time tie-breaks, not marks bonuses.
- No return to closed units and no pause between active units; final outstanding response closes
  immediately. Students must revisit earlier questions before resolving the last one.
- Existing trusted-admin claim scope, immutable retirement, and same-origin deployment remain.

## 11. Revision status

2026-09-09 replaces the previous per-question-only timing, immediate immutable answer writes,
no-Back rule, speed-bonus formula and per-question time comparisons. Backend implementation
precedes frontend integration. Existing sprint packets and mockups are intentionally unchanged
and are not authoritative for these revised behaviors. See [[V1_CHANGES]] for revision scope.

2026-09-12: template CRUD (§4.4) was resolved by the project owner and is no longer deferred.
Edits to an active template affect only future materializations, never quizzes already produced
from it. Template save does not dry-run the draw against current bank counts; materialization
failure and its existing alert path remain the only pool-exhaustion signal.

## 12. Verification required at implementation

- Mixed standalone/RC/LRDI draws: counts, whole groups, numbered units, defaults/overrides,
  reshuffle invalidation and derived duration all agree.
- Back/Skip/Clear preserve the unit start; drafts produce no answer writes before closure.
- Completing the final unresolved question submits once; changed earlier choices are the ones graded.
- Atomic batch failure saves nothing; duplicate/concurrent requests never double-score or advance.
- Submitted answer formats/positions must match the active unit; future/closed units are refused.
- Timeout, lost response, expired retry, reload, another device and browser-storage loss have
  explicit outcomes under the receipt policy. Unit reading time counts once, never per subquestion.
- No solutions/score during play; no rank/review before atomic board publication; no active-score
  leakage through history or status. Test wire names `correctOption`, `numericAnswer`,
  `numericTolerance`, `explanationMd` across every student gameplay response.
- 120 concurrent seats and mixed-unit runs, 121st rejected, median unit-submit/advance <500ms.
- Late joins receive full duration; request fallback and cron close after the same safe boundary.
