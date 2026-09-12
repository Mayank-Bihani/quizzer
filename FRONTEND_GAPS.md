# Frontend gaps — mockups vs. the implemented backend

The mockups (`mockups/`) were built and frozen on 2026-09-04, against `JOURNEYS.md` and the
design system as they stood that day. The backend was then specified and implemented across
Sprints 1–8 (`todos/PROGRESS.md`), and several product questions were resolved — some before the
mockups were built, several after. This file is the reconciliation: where the mockups' own
assumptions diverge from what the backend actually implements, so a frontend build does not
silently ship the mockup's guess instead of the real, resolved behavior.

`mockups/SYSTEM-GAPS.md` is a separate, already-complete document tracking *design-system*
gaps — missing components, tokens, touch-target fixes. It is not duplicated here. This file is
about *product* decisions: places where the mockup's own judgment call and the backend's actual,
implemented behavior are not the same thing.

Wire types are `src/core/api.ts` (DTOs) and `src/core/contracts.ts` (module boundaries); the exact
route table is `API.md`. Those three are authoritative over anything a mockup shows. Where this
file says a mockup is wrong, the backend is right — build against the backend.

## 1. Direct contradictions — fix these before/while building the screen

### 1.1 Pool exhaustion: mockup shows reuse; backend fails loudly

`mockups/admin/builder-draw.html`'s "pool exhaustion, resolved by reuse" state draws two
previously-used questions into the mix, each badged `Reused`, with a warning strip explaining the
shortfall. This was logged in `mockups/SYSTEM-GAPS.md` #45 as *"a judgement call, not a resolved
product decision."*

**Resolved 2026-09-05 the other way:** pool exhaustion **fails loudly** — no partial draw, no
silent reuse (`PRD.md`, `QUIZZING.md` §4, `CONTRACTS.md`). `POST /api/admin/quizzes` returns
**409** with nothing written (`API.md`). There is no "reuse" success path anywhere in the real API.

**What to build instead:** a straightforward failure state — the draw request fails, the admin
sees why (which difficulty/count couldn't be satisfied) and is invited to adjust the mix or count,
not a retried draw with substitutions. Remove the `Reused` badge treatment and the reuse-warning
copy entirely; they have no backing behavior.

### 1.2 Weekly boards: mockup ranks by average; backend ranks by total

The mockup's own build note (`mockups/PROGRESS.md`, S6) says *"BOARD-4/5/6: ranked on average
score per quiz."*

**Resolved:** weekly boards rank by **total score summed across quizzes taken that week** — never
an average (`PRD.md`, `DATA_MODEL.md`, `SCHEDULER.md` §4.3, implemented in `src/core/leaderboard.ts`'s
`assignWeeklyDenseRanks` and `src/db/boards.ts`). `WeeklyBoardRow.totalScore` is a sum;
`quizzesTaken` is a separate, non-ranking display count.

**What to build instead:** every weekly-board screen (`leaderboard-weekly.html` and its states)
must present the number as a total, and must not divide it by `quizzesTaken` anywhere in copy or
computation.

### 1.3 Weekly board's per-row "section" column has no backing field

`mockups/SYSTEM-GAPS.md` #31: the Overall tab's `.rankrow__sec` cell shows a student's
"most-attempted section that week" — invented because the product docs never specified what a
per-row section column on a cross-section board should mean.

**As implemented:** `WeeklyBoardRow = { rank, userId, name, totalScore, quizzesTaken }`
(`src/core/api.ts`). There is **no per-row section field in the contract at all** — not "most
attempted," not any other derivation. The API cannot serve this cell as designed.

**What to build instead:** drop the section cell on the Overall tab, or raise it as a product
question before implementing. Do not compute a client-side "most attempted section" as a
substitute — it would be inventing data the backend doesn't track per row.

### 1.4 Admission-window validation assumes the wrong formula

`mockups/admin/builder-schedule.html`'s window-too-short state validates against a flat
*"count × seconds-per-question"* rule (`mockups/SYSTEM-GAPS.md` #46).

**As implemented:** `windowSec = SUM(quiz_units.time_limit_sec) + slackSec`
(`DATA_MODEL.md`, `QUIZZING.md` §4, `src/services/quiz-creation.ts`). Each **unit** carries its own
time limit from the quiz's `TimingPolicy`, keyed by unit **kind** (`standalone`/`rc`/`lrdi`), which
can differ — an RC/LRDI unit's allowance is not `count × one flat per-question value`. Slack is a
separate, explicit field, not folded into "plus slack" hand-waving.

**What to build instead:** validate and render the real per-unit-kind sum, not a flat multiply.
The error copy needs to name the actual short-by amount computed from the drawn units' real time
limits, not an invented "N questions × Ns" arithmetic string.

## 2. New affordances the mockups never got to show

### 2.1 Cancel/void a quiz — resolved to ship, after the mockups were frozen

S10 deliberately omitted a "Void quiz" action from `schedule.html`'s open/live cards because
AJ-7 and AJ-9 were both explicitly undecided at build time (`mockups/SYSTEM-GAPS.md` #50) — a
correct decision *not* to silently resolve an open product question by building an affordance for
it.

**Resolved 2026-09-09** (see `JOURNEYS.md`, `AUDIT.md` §11): **build it** — a new admin route,
`POST /api/admin/quizzes/:id/cancel`, implemented since Sprint 3. Cancelling notifies students
(TELEGRAM's `cancelled` post kind, `TELEGRAM.md`).

**What to build:** a "Cancel quiz" action on the admin schedule list (and/or quiz detail) with a
confirmation step, wired to the real route, plus whatever student-facing state a cancelled quiz
needs (the mockups have no "this quiz was cancelled" screen at all — closest analog is
`did-not-take.html`, which is a different case and should not be silently repurposed).

## 3. Validated judgment calls — mockup guessed right, no rework needed

These are listed so a frontend build doesn't second-guess or "fix" something that was already
correctly resolved by the mockup's own judgment call.

- **Admin live monitor (AJ-7).** Mockups correctly omit it. Resolved 2026-09-05: not built for
  now. No screen needed.
- **Five review outcomes.** `review.html` (S5) splits "timed out" from "not reached" into distinct
  badges (`.b-timeout` / `.b-nr`) ahead of the backend formally distinguishing the two
  (2026-09-09: reached-unit timeouts are now recorded separately from unreached units in
  `participant_units`). Build the review screen exactly as mocked here — the five-outcome model is
  correct and matches `QuestionReviewRow`'s outcome field in `src/core/api.ts`.

## 4. Worth one more confirmation before building

### 4.1 Item analysis — mockup ships it; the named feature is still "not built"

`report.html` (S10) builds a full sorted-worst-first, %-correct item-analysis section
(`item-analysis-row A`), flagged in `mockups/SYSTEM-GAPS.md` #49 as *"a mockup judgement call, not
a product decision."* Resolved 2026-09-05: the full **item analysis feature is not built**
(`PRD.md`, `JOURNEYS.md` AJ-8) — as a named, separately-branded admin capability, it does not ship.

**What actually exists:** `AdminReportResponse.questions` (Sprint 8, `GET
/api/admin/quizzes/:id/report`) returns per-question `correctCount`/`wrongCount`/`skippedCount`/
`unansweredCount` — the raw aggregate data the mockup's bars would need. So a screen shaped like
the mockup's *could* be built from real data; whether it should ship in that form, under that
framing, is a product call this document cannot make. Confirm before building `report.html`'s item
analysis section as pictured — it is the one place in this list where "match the mockup" and "this
was resolved as not-built" are in direct tension, not a simple correction.

## 5. Backend surface the mockups were built before it existed

Not contradictions — just places where the mockup necessarily guessed at a shape that is now a
real, frozen contract. Reconcile the mockup's sample data/labels against these before wiring:

- **`GET /api/admin/quizzes/:id/report`** (Sprint 8) — exact shape is
  `{ quizId, participants: PageResponse<AdminReportParticipantRow>, questions:
  AdminReportQuestionRow[], units: {...}[] }` (`src/core/api.ts`). `report.html`'s sample numbers
  predate this route existing at all.
- **`GET /api/boards/weekly` defaults** (Sprint 7) — omitted `type` defaults to `'overall'`;
  omitted `weekStart` defaults to the most recently *published* week (`MAX(week_start)`), never
  the calendar week containing "now." No 404 path exists; an unpublished week/type returns an
  empty `PageResponse`. Map `leaderboard-weekly.html`'s week-picker/tab defaults to this exact
  rule.
- **Pagination is one shared convention** everywhere it applies (`API.md`): `limit=50, offset=0`
  defaults, integer `limit` 1..100, non-negative integer `offset`, 400 on invalid input, never
  silently clamped. `history.html` and both leaderboard screens currently fake pagination with a
  "Load more" button and a static "⋯ N more ⋯" divider (`mockups/SYSTEM-GAPS.md` #30) — the real
  screens should use the real paginated reads.
