# Quizzer — V1 Architecture Plan

> Design only, revised 2026-09-09. Stack is already selected. Product rules: [[PRD]].
> This document supersedes the earlier per-question timing/bonus architecture. Historical audits
> remain in [[AUDIT]] and [[COUNCIL_FINDINGS]]; implementation packets and mockups are not yet revised.

## Context

Quizzer serves a roughly 100-student Telegram competitive-exam group: Verbal, Quant and Logical
Reasoning, including RC passages and LRDI sets. The goal is unattended scheduled practice,
negative marking, a permanently non-repeating question pool, rankings and explanations after
all students can safely finish. Hosting on the chosen free-tier stack is a project constraint.

## Decisions locked

| Area | V1 decision |
|---|---|
| Delivery | Backend boundaries/contracts/specs, backend implementation, then frontend/API integration |
| Quiz format | Admission window plus a full individual duration starting at each student's join |
| Timing unit | One RC/LRDI group or one standalone question |
| Navigation | Free within active set; closed units never reopen |
| Persistence | Browser-local drafts, one atomic database batch when a unit closes |
| Closure | Last unresolved answer/skip closes the unit; expiry freezes edits and allows 5 seconds for batch delivery |
| Scoring | Correct marks, wrong penalty, non-answer zero; no speed bonus in V1 |
| Tie-break | Sum of server-measured reached-unit completion times; reading counts once |
| Secrecy | Only active-unit content during play; no solutions, running score or live board |
| Finish | Own score/count only; rank/review unlock after safe close and committed ranking |
| Selection | Never-used questions only; RC/LRDI groups drawn and retired whole |
| Capacity | 120 seats, retained as a product choice; verify with a load test |
| Identity | Google Sign-In, student/admin/superadmin roles |
| Telegram | Outbound announcements only; six post kinds including cancellation |
| Boards | Participant-only per-quiz top 10 + own row; full weekly section/overall boards |
| Weekly basis | Total score across quizzes taken, no minimum count, IST week attribution |
| History | Retained indefinitely; English, Asia/Kolkata presentation |

## Format: why self-paced

The original lockstep design was replaced on 2026-09-01. A self-paced request/response loop
eliminates the synchronized question clock, WebSocket fan-out, coordinator and Durable Object.
There is no global start transition: admission starts at T, each student starts on joining.

The 2026-09-09 revision changes the working unit. RC/LRDI reading time cannot fit a short clock
on the first question, and allocating reading time to every subquestion is excessive. One shared
set clock lets the student distribute reading/answering time naturally. Completing the unit
advances immediately; no student waits for another. No live/partial leaderboard is offered.

## Tech stack

| Layer | Selected technology |
|---|---|
| Frontend, built after backend | React + Vite + TypeScript, Workers Static Assets |
| API and scheduled handler | TypeScript + Hono on Cloudflare Workers |
| Relational data | D1 / SQLite |
| Images | R2 |
| Shared redacted content, JWKS/roles and boards | Workers KV |
| Scheduling | Cron Triggers |
| Math | Client-side KaTeX |
| Authentication | Google Identity Services, Worker-verified JWT, own session cookie |
| Announcements | Telegram Bot API |

### Platform decision context

The earlier platform survey considered long-lived Go/WebSocket hosting and Supabase. Removing
lockstep removed the socket requirement. Cloudflare was retained for a single deployment with
D1/R2/KV/cron/assets and the intended free-tier usage. TypeScript shares contracts with React;
`core/` has no platform imports. Alternatives and historical pricing comparisons are not current
requirements and do not justify changing the already chosen stack.

D1/KV/R2 integrations still need adapters if the application moves hosts. Shared types and pure
scoring/grading/selection code limit coupling; portability is not a promise of zero migration work.

### Frontend deployment

Build `web/` later and serve `web/dist` from the same Worker/origin as `/api/*`. This keeps session
cookies first-party. The assets block in `wrangler.toml` stays commented until that directory
exists. Infrastructure IDs remain placeholders until provisioning. No deployment is part of this
revision. Design tokens and static mockups exist, but their timing/navigation behavior is stale.

## Architecture

```
React (later)
  -> Hono routes -> AUTH guards
       -> BANK: imports/content/images
       -> QUIZZING: creation, current unit, submit unit, results
Cron handler (SCHEDULER)
  -> QUIZZING: openRoom / closeQuiz / materializeTemplates / computeWeeklyBoards
  -> TELEGRAM: claimAndSend
QUIZZING -> BANK: listUnused / claimUnused / getByIds
```

Each table has one writer, listed in [[MODULES]]. SCHEDULER issues no SQL or KV operations;
effects happen inside module calls. TELEGRAM never drives gameplay. Answers and unit runtime
state live in D1; cache staleness must never determine timing, accepted submissions or seats.

## The quiz run

### Endpoints

The full wire inventory lives in [[API]], with types in `src/core/api.ts`.

- `POST /api/quizzes/:code/join`: claim/resume a seat, return metadata and current play state.
- `GET /api/play/:quizId/current`: resume the active unit or finish state.
- `POST /api/play/:quizId/units/:unitPosition/submit`: one final unit batch and progression.
- `GET /api/play/:quizId/status`: holding data, only after participant finish.

No server call for individual selections, Back, Clear or Skip. The browser stores drafts and the
selected subquestion locally. The final unresolved answer/skip freezes the batch automatically;
there is no extra review/submit-set screen. The response returns the next timed unit or final
own-score summary. Standalones are one-question units and therefore submit immediately.

### Active-unit shape and answer secrecy

`ServedUnit` = `UnitContent` plus participant-specific start/editing/receipt deadlines.
`UnitContent` contains one unit's complete redacted questions and shared passage/image.
`ServedQuestion` carries flat `position`, integer `subPosition`, format/body/image/options.
Display `unitPosition.subPosition` for grouped questions, or just unit position for a standalone.
No solutions/tolerances/explanations occur in run payloads. Construct allowlisted DTOs explicitly;
TypeScript structural typing alone does not strip extra fields. Test serialized responses and KV.

### Timing, without client-reported clocks

```
ends_at = scheduled_at + join_window_sec*1000
window_sec = SUM(unit.time_limit_sec) + slack_sec
student_deadline = participant.started_at + window_sec*1000
unit_deadline = MIN(unit.started_at + unit.time_limit_sec*1000, student_deadline)
```

Prepare seats/content at T−5m. Admit and release code from T until `ends_at` (exclusive).
Returners with seats can resume after admission closes. Start and persist each unit's clock
before serving it; never reset on navigation/reload/retry. Unused unit time cannot be transferred.
Individual question timings are unknown because the browser sends one final batch.

At closure, record elapsed once per reached unit, capped at the effective allowance; timeout
uses the full effective allowance. The total supports the existing time tie-break. The
5-second receipt window and timeout delivery policy are specified in [[PRD]] §5.4 and
[[QUIZZING]] §5.3. It changes transport acceptance, never the elapsed-time cap or working timer.
Next-unit work starts only when that unit is served, subject to remaining overall time.

### Atomic submission and resume

Validate exactly one response per member of the active unit and correct answer format. Complete
submissions contain answered/skipped states only; timeout batches may contain unanswered states.
Use one idempotent atomic closure for answer inserts, marks/count/time deltas, unit receipt and
next-unit start/participant finish. A failed batch changes none of them. Detect changed retries
using a submission ID and canonical payload hash. Identical accepted retries return the original
closure receipt and current state, never stale next-unit clocks or duplicate score increments.

No per-student timer wakes up in the backend. Requests and final close settle expired units.
Local drafts can survive same-browser reload but are not server-backed or cross-device. At an
editing deadline the browser freezes and sends the batch; it has five seconds to reach the
server. If it misses that receipt cutoff, the server cannot recover or grade the local draft.
A server-only timeout closes the reached unit with zero marks; unseen later units remain unreached
until served, or score zero when overall working time ends.

### Seat claim, without a coordinator

Pre-seed up to 120 seats. Conditional empty-seat updates and `UNIQUE(quiz_id,user_id)` enforce
capacity and idempotent join. Persist participant/unit start consistently with the claim so a
lost response cannot consume a second seat or reset timing. No WebSocket/coordinator is needed.

### Ending the quiz

Final-unit closure or overall expiry finishes each participant. Correct/wrong/skipped/unanswered
counts must then account for all graded questions. Unreached units have no runtime rows and no
elapsed contribution. Only own total/count is exposed; active totals must not leak via history.

Safe quiz close is eligible strictly after admission cutoff + full derived duration + the
5-second final delivery window.
QUIZZING finalizes abandoned runs, ranks stored totals, and publishes rank rows and
`board_computed_at` in the same atomic commit. A claim must not publish a completion marker before
rank writes finish. Cron and lazy results requests use the same predicate and idempotent job.
After board completion, participant review/leaderboard and admin reports become available.

## Scoring

Pure scoring maps correct -> `marks_correct`, wrong -> `marks_wrong`, non-answer -> 0.
All figures are per quiz; examples are not defaults. With illustrative +3/-1, a four-question
set with two correct, one wrong and one skipped scores **5**, regardless of time taken.
Rank on total score descending, then sum of reached-unit elapsed time ascending. Exact ties
share dense ranks. There is no speed-bonus formula, grace setting or bonus storage in V1.
Speed bonuses are a V2 feature requiring a new explicit design, not hidden disabled V1 fields.

## Data model (D1)

The authoritative DDL is `migrations/0001_init.sql`; narrative details and constraints are in
[[DATA_MODEL]]. New `quiz_units` defines occurrence membership/timing and `participant_units`
persists personal starts and closure receipts. Existing `quiz_questions` adds unit/sub-position
while retaining flat graded-question identity. `answers` stores final batch responses and one
`marks` value; per-question timestamps and bonus/base fields are removed.

The bank still owns `passages` and `questions`; the shared material may be RC or LRDI. Timing is
quiz-specific, never stored on bank content. Templates carry a policy by unit kind; each actual
draw yields its own unit count and derived working duration. Admission length stays independent.

### The no-repeat guarantee

QUIZZING draws only unused questions through BANK, groups whole or not at all. At lock BANK's
`claimUnused` retires questions and fully claimed passages. The first lock attempt reserves the
sequential quiz number BANK needs; same-quiz claims count as confirmed on retry, so publication
can recover after an ambiguous success. The number remains hidden until scheduling completes,
and abandoned reservations may leave gaps. A true short claim prevents locking.
No recycling on pool exhaustion/cancellation, no partial draw, no release API. The accepted
single-admin scope does not introduce cross-admin all-or-nothing claim rollback machinery.

### Passage groups and CSV

See [[BANK]] for the existing UTF-8 CSV format, preview/commit validation and companion ZIP.
`format=passage` and `passage_ref` cover RC/LRDI shared material. Keep 4–5 questions per group,
matching the section and same import file; do not add timing/bonus fields to bank rows.

### Where explanations surface

Admin bank views can show authored solutions. Student solutions unlock only after committed
board completion. Review shows each final response and MCQ distribution over all participants,
including a not-answered bucket; unit timings/room averages appear once per set, never guessed
per subquestion. Missing answer rows alone do not
prove a question was unseen; consult whether the unit was served.

## Telegram bot timeline

T−2h announce, T−30m reminder, T admission/code release, result after safe close, weekly boards,
and cancellation. No code at T−5m preparation. Show question/unit counts, timing summary and each
student's full duration. No bonus/grace text. Posts are claimed in D1 before send; Telegram
failure never blocks gameplay. Details and retries: [[TELEGRAM]].

## Cron triggers

- `* * * * *`: discover up to 100 candidates per pass, prepare rooms, send due posts, close
  eligible quizzes and check failure alerts. Sprint 4 builds runtime settlement and this close
  seam; Sprint 5 wires the atomic global settlement/ranking `closeQuiz` implementation.
- `0 * * * *`: materialize seven days of recurring occurrences using whole-group draws and
  policies; send safe pool/timing failure results through both private alert channels.
- `0 19 * * 0`: weekly boards at 00:30 IST Monday; delay publication for eligible still-open quizzes.

See [[SCHEDULER]] for safe close, late jobs, IST week attribution and publication completeness.
No cron is added for individual questions or sets.

## Free-tier budget

The previous ~4,500-request / ~2,700-write estimate assumed individual answer submissions and is
obsolete. Re-measure in phase 4 against the chosen account's actual limits; no new vendor limits
are asserted by this document revision.

For N students, U units and Q graded questions, baseline gameplay is approximately N joins + N×U
unit submissions, plus retries/resume/holding/results requests. For 120 students, 20 questions
arranged as five sets, this is about **720 gameplay requests** before those additional requests.
Do not count subquestion navigation as API traffic. Standalone-only quizzes retain Q=U.

Accepted answers still require up to N×Q rows, plus N×U runtime rows/start/closure writes,
participant aggregates, seats and indexes. Batching reduces round trips, not all row writes.
Measure CPU/batch limits for whole-unit submissions and final ranking, and budget browser assets,
images, auth, imports and cron separately. Keep imports chunked and close work bounded.
The free-tier target and 120-seat cap remain; they are not a capacity guarantee before testing.

## Repo structure

`src/core/` holds platform-independent types and pure logic; `src/routes/` HTTP adapters;
`src/db/` module-owned persistence; `src/services/` cache/JWT/images/Telegram/observability adapters;
`src/index.ts` Hono mounting and cron orchestration. Most files remain ownership-comment stubs.
`web/` will be built later with active-set navigation, browser-local drafts, a unit timer and an
individual overall timer. `mockups/` and `design-system/` are visual references awaiting revision.

## Build sequence

Agree boundaries -> schema/contracts -> spec packets -> backend phases -> frontend integration.
Backend dependency phases: AUTH; BANK; creation; run/scoring/open-close/load test; results;
Telegram; weekly/recurring; hardening/report export. [[PRD]] §7 maps requirement IDs.
Existing spec packets are intentionally untouched by this revision and need a separate review.

## Verification

Validate schema/types now. At implementation: pure marks/grading tests; whole-group selection;
atomic batch rollback and retry races; active-unit-only content; timeout/delivery boundary;
server clocks across reload; local storage loss; 120-seat/load test; secret-free run responses;
late-join duration; safe close and atomic board visibility; unit-time averages and exact ties.
Finish backend verification with API-driven end-to-end journeys. After frontend integration,
run real-phone/manual flows from CSV import through quiz, holding screen, ranking and review.

## Deliberately deferred

Speed bonuses (V2), cross-device draft sync, return to closed units, live boards/monitoring,
full item analysis, regrading UI, recurring-template CRUD UI, practice mode, Telegram identity/DMs,
all-time boards, per-topic analytics and scheduled database exports. Other accepted limitations
remain recorded in the module docs and the historical audit decisions.

## Revision and source precedence

2026-09-09 rules in [[PRD]], [[QUIZZING]], [[DATA_MODEL]], [[CONTRACTS]] and [[API]] take precedence
over historical per-question descriptions. [[V1_CHANGES]] records what was changed and what was
intentionally left for later. This revision does not implement handlers, deploy infrastructure,
rewrite implementation packets or update mockup screens.
