# Quizzer — V1 Data Model

> Revised 2026-09-09. Design only. Executable initial schema: `migrations/0001_init.sql`.
> This revises the unshipped baseline; it is not an applied production migration.
> Module ownership is defined in [[MODULES]]. Wire types: [[CONTRACTS]] and [[API]].

## Ownership and relationships

| Owner | Tables | Purpose |
|---|---|---|
| AUTH | users | Google identity, role and durable profile |
| BANK | passages, questions | RC/LRDI shared content, question membership, solution and retirement |
| QUIZZING | quiz_templates, quizzes | Recurrence policy, occurrence settings and lifecycle |
| QUIZZING | quiz_units, quiz_questions | Ordered timed units and their graded questions |
| QUIZZING | quiz_seats, participants | Seat claims and each student's quiz progress/totals |
| QUIZZING | participant_units, answers | Authoritative unit clocks/closure and final batched responses |
| QUIZZING | weekly_boards | Published weekly aggregates |
| TELEGRAM | telegram_posts | Claim/send bookkeeping |

There are 13 tables. SCHEDULER calls module functions; it owns/writes no table.
BANK's existing `passages` name covers both RC text and LRDI shared material. No clock is stored
in the bank. The section determines grouped unit kind: verbal -> rc; quant/lr -> lrdi.
Questions retain stable IDs, section, topic, difficulty, format, solution/tolerance,
explanation, image and one-way retirement. Subtopic and source/provenance are optional. CSV group
membership remains same-file only.

## Quiz composition

`quiz_units(quiz_id, unit_position)` holds kind, optional passage ID and `time_limit_sec`.
`quiz_questions` retains its flat `position` and question ID, adding `unit_position` and
`sub_position`. Both ordering fields are integers. Display labels such as "1.4" are derived.

One standalone = one question with sub-position 1 and no passage; one RC/LRDI unit = every
question in its 4–5-member passage group. Lock validates completeness, ordering, membership,
section agreement and positive allowances. Foreign keys and uniqueness protect identity;
cross-table sums, contiguous positions and exact group completeness need application validation.
`question_count` counts graded questions; `unit_count` counts units. They are not interchangeable.
One quiz contains at most 100 graded questions.

`quiz_number` may be reserved on a `draft` during its first lock attempt because BANK needs the
stable number while retiring content. API draft responses keep a reservation hidden until a room
code is assigned and `scheduled` publication succeeds. Retrying uses the same number and BANK
counts ids already claimed by that quiz/number as confirmed. Gaps from abandoned reservations are
accepted; retired content is never released to close a gap.

## Timing configuration

A quiz/template `timing_policy` is JSON matching `TimingPolicy` (integer seconds by kind).
Each kind used by a draw must have a policy value. A quiz can override individual unit allowances.
Reshuffle rebuilds units using the policy and discards overrides. A template stores no derived
`window_sec`; each materialized quiz calculates it from the actual drawn composition.

- `join_window_sec`: positive admission length, independent of working duration.
- `slack_sec`: non-negative transition allowance.
- `window_sec`: derived `SUM(quiz_units.time_limit_sec) + slack_sec`, not a direct API input.
- `scheduled_at`: admission/code release begins; `ends_at = scheduled_at + join_window_sec*1000`.
- `lobby_opens_at = scheduled_at - 300000`: preparation only, not a student's start.

All timestamps are integer epoch milliseconds. All `_sec` values require multiplication by
1000 in timestamp arithmetic. Weekly `week_start` is the Monday date in Asia/Kolkata.
Drafts may have unset timing; lock requires complete values and freezes membership. Changes to
settings are refused after room preparation changes status to `open`. Cancelled drafts may keep
unset fields; cancellation never un-retires questions.

## Student runtime

`participants.started_at` starts at join. Overall deadline = `started_at + window_sec*1000`.
`current_unit_position` replaces `current_position`; selected subquestion/draft state is local.
Insert `participant_units` before serving each unit, with immutable start, editing deadline and
receipt cutoff. There is at most one active unit per participant. Fields at closure:

| Field | Meaning |
|---|---|
| closed_at | Server time of finalization |
| close_reason | completed or timed_out |
| elapsed_ms | Server completion time capped at the effective unit allowance; full allowance on timeout |
| submission_id | Retry key for a received batch; null on server-only expiry |
| payload_hash | Hash of canonical validated payload; rejects changed retries |

A unit's editing deadline is capped by the overall deadline. In V1,
`submit_by_at = deadline_at + 5,000`: editing freezes at the former and the frozen batch may
arrive through the latter ([[PRD]] §5.4). A retry of an accepted batch stays valid afterward; an
unseen later batch cannot be scored. No new unit starts once overall working time is over.

`total_time_ms` sums reached-unit elapsed values exactly once. Reading counts once per set;
unreached units contribute no elapsed value. The reading/answer split inside a set is unknown.
No per-question timestamps or duration estimates are stored or reported.

## Final answers and atomicity

`answers` holds one final response per participant and graded position, with its unit FK,
`status` (answered/skipped/unanswered), chosen MCQ option or numeric value, correctness and
`marks`. No provisional responses are stored in D1. Correct = configured marks, wrong = penalty,
every non-answer = zero. No `grace_sec`, `max_speed_bonus`, `speed_bonus` or `base_marks` exists
in the V1 model; `marks` is the single awarded value, replacing the earlier bonus/base split.

One unit closure commits its answer rows, closure receipt, participant score/count/time deltas,
and progression/next start atomically. Partial batches never survive. Conditional claims must
also guard every dependent write; zero matched rows alone do not roll back a D1 batch.
Identical accepted retries return the closure plus current state; changed submissions never
replace accepted answers. Runtime and aggregate updates must be safe against concurrent expiry.

Missing answer rows can mean an unsubmitted expired unit OR an unreached unit; use runtime
membership to distinguish them. Accepted timeout batches include unanswered entries. Server-only
expiry may leave all answer rows absent. At participant finish, correct + wrong + skipped +
unanswered counts equal the quiz's graded question count. Only explicit skips increment skipped.

## Results publication

Scores/counts/time accumulate per accepted closure; no active totals are exposed to the student.
At safe quiz close, finalize unresolved runs without regrading committed responses. Rank on score
DESC, total unit elapsed ASC, with exact ties sharing dense ranks. Publish all ranks and
`board_computed_at` in one atomic commit; a claim marker alone must not unlock partial results.
`board_computed_at` is the completion gate, not merely "ranking has started".

Review includes per-question results and a separate per-unit timing collection. Unreached unit
time is null, not zero; room averages include reached finalized units only. Admin reports count
missing responses via participant/question joins so absence cannot drop students from aggregates.
MCQ distribution uses the full participant roster as its denominator; A/B/C/D plus one combined
not-answered bucket account for every participant.

Weekly boards store total score across quizzes taken in the IST week and quiz count for context.
They do not average or normalize scores. Rank by total score descending; exact totals share a
dense rank, with stable row ordering among ties carrying no ranking meaning.

## Cache boundaries

`unit:<quizId>:<unitPosition>` stores redacted `UnitContent` only: shared material, questions,
ordering and configured allowance. Personal timestamps, deadlines, drafts and submission receipts
are D1/browser concerns, never shared cache entries. Board/JWKS/role caches retain their owners.
