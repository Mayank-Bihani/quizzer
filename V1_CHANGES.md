# V1 revision — timed units and batch submission

> 2026-09-09. Records the project owner's decisions from this discussion and their document impact.
> Design/contracts/schema only. No route/service implementation, migration application or deployment.

## Confirmed product decisions

| Previous description | Current V1 |
|---|---|
| Uniform question clock | Shared RC/LRDI set clock; standalone question clock |
| Reading charged to first subquestion | Reading and all answers share the set allowance |
| Flat display sequence | Unit numbers and hierarchical subquestion labels, backed by integer positions |
| Correct marks plus speed bonus | Correct/wrong/zero marks only; speed bonuses deferred to V2 |
| No Back, answer/skip locks immediately | Local editing and Back within active set; closed units stay closed |
| Individual answer DB writes | One final unit batch when every question is answered/explicitly skipped |
| Separate proposed Submit set action | Automatic closure on final outstanding answer/skip; no extra confirmation |
| Per-question server timing | Server-measured reached-unit completion time; reading counted once |
| Per-question time comparisons | Separate per-unit timings in review/reports |
| Frontend/backend built together | Backend boundaries/contracts/specs, backend implementation, then frontend/API integration |

Each student still gets the full individual duration from joining; this was already the accepted
newer timing decision and is now applied consistently. T−5m is preparation; admission/code
release at T is the newer timing model, replacing stale shared-start/early-code descriptions.

## Contract and model consequences

- BANK keeps RC/LRDI content and group membership; QUIZZING owns timing/quiz units/runtime.
- Serve a complete redacted active unit to enable local navigation; future units stay unavailable.
- `quiz_units` and `participant_units` add explicit quiz composition and persistent personal clocks.
- `quiz_questions` retains flat identity and adds unit/sub-position; display labels are not decimal IDs.
- `questionCount` and `unitCount` are distinct. Group-size validation remains 4–5 questions.
- Timing policy defaults are keyed by standalone/rc/lrdi, with per-unit overrides on a quiz.
  Reshuffle discards overrides. Total working duration is derived from actual allowances + slack.
- Admission length is represented separately so duration changes cannot alter the join cutoff.
- Remove V1 bonus/grace fields, per-answer timestamps and the base/bonus/total scoring split.
  Each accepted answer stores one `marks` value; unit runtime stores completion time once.
- A final batch, closure receipt, score/count/time deltas and next start commit atomically.
  Save a retry key/hash; identical accepted retries return current state, changed retries cannot edit.
- Retain browser-local drafts/pending batches for same-browser recovery; no cross-device guarantee.
- Separate explicit skips from unanswered/timeouts; missing answer rows are interpreted with unit state.
- Active scores stay hidden from status/history as well as direct gameplay responses.
- Ranking completion must publish atomically with rank rows. Claiming work is not publishing a board.
- Weekly publication waits for late-Sunday individual runs to finish; hourly retries recover deferred
  weekly publication. This follows from the full individual-duration rule, not a new leaderboard type.

## Five-second batch-delivery window

Resolved by the project owner on 2026-09-09: editing freezes at `deadlineAt`, and the exact frozen
batch may reach the server through `submitByAt = deadlineAt + 5,000 ms`. The server caps elapsed
time at `deadlineAt`; this is transport time, not extra working time. Settlement and final quiz
publication wait through the window. Identical accepted retries remain valid afterward; a new
late batch cannot score. The server cannot verify that a custom client froze its answers, so the
small five-second opportunity for a crafted client is accepted under V1's trust-based approach.

## Follow-up leaderboard and review decisions

Resolved by the project owner on 2026-09-09:

- Keep the existing friendly per-quiz tie-break: only reached-unit elapsed time contributes;
  unreached units add no synthetic penalty.
- MCQ review distributions use the full participant room as denominator. A/B/C/D counts plus a
  combined not-answered count cover every participant; the client derives percentages.
- Weekly boards rank total score across quizzes taken in the IST week, not average score. Quiz
  count is shown for context and does not divide the total or break ties. Exact totals share a
  dense rank.
- Question `source` is optional provenance metadata (for example `CAT 2018 Slot 1` or
  `Original/internal`); subtopic remains optional as modeled. Blank values are accepted.

## Updated files and authority

Current requirements: PRD.md. Architecture/boundaries: PLAN.md, MODULES.md, BANK.md,
QUIZZING.md, SCHEDULER.md, TELEGRAM.md. User behavior: JOURNEYS.md.
Storage: DATA_MODEL.md, migrations/0001_init.sql, SCHEMA.svg.
Contracts: CONTRACTS.md, API.md, src/core/contracts.ts, src/core/api.ts, CONTRACTS.svg.
Affected one-line source ownership comments and wrangler timing comments are aligned, without
implementing handlers. AUDIT.md and COUNCIL_FINDINGS.md retain their historical text under an
explicit superseded-design notice. Unrelated authentication behavior remains unchanged.

Existing `todos/` spec packets, progress tracker, fixtures, design-system assets/guidelines,
mockup screens and design/mockup generation prompts are intentionally untouched. They may still
reference the previous behavior and must not override the revised documents.

## Next revision, separate work

Update BANK/creation/run spec packets and then write remaining backend packets against these
contracts. Before frontend implementation revise builder, runner/navigation/timeout, review/report
mockups and remove bonus controls/curves/grace bands. No implementation packet is declared current
or completed by this documentation revision.

## Validation performed

- Strict TypeScript checking of both contract files passed using the locally cached compiler.
- The initial DDL creates 13 tables in in-memory SQLite with clean foreign keys. Constraint
  checks covered unit membership, one active unit, invalid allowances, skip marks and elapsed
  caps. A failed transaction left no partial answers; a four-question sample scored 5 with its
  eight-minute set time counted once. These are schema checks, not implemented D1 handler tests.
- Both SVGs parse as XML; schema diagram columns are generated from the DDL.
- Route type references and document links resolve; no unresolved edit placeholders remain.
- Archived packet hashes preserve the previous specs byte-for-byte. Mockup and design-system
  files remain unchanged; the active progress tracker records this newly resolved decision.
  No application behavior or deployment was tested because handlers remain stubs.
