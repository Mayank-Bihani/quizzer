# claude-task--001: Compute weekly boards and materialize recurring quiz templates

**Sprint:** 7  **Slug:** `weekly-boards-recurring-materialization`  **Status:** Draft

> Implements `Weekly boards + recurring — IST weeks, complete publication, template draws and
> derived unit duration` per the active tracker (`todos/PROGRESS.md:22`). Implements QUIZZING's
> `computeWeeklyBoards`/`materializeTemplates` and production-wires all three cron passes,
> including the exact weekly send pass Sprint 6 deliberately left typed-but-unwired
> (`todos/sprint 6/claude-task--001--telegram-six-post-kinds.md:48,110`).

---

## 1. Context

Sprint 7 is Phase 7: `QUIZ-1..10` creation and `BOARD-1,2,3` per-quiz publication already shipped
in Sprints 3 and 5; this sprint delivers the remaining `BOARD-4..9` weekly-ranking requirements
and `QUIZ-7`'s recurring-template auto-draw (`PRD.md:213-219`; `PRD.md:113`; `PRD.md:278`;
`MODULES.md:207`). A weekly ranking is computed on **total score across quizzes taken in that IST
week**, per section type and overall, with no minimum quiz count and exact-total-score ties
sharing a dense rank (`PRD.md:214-219`; `PRD.md:384`). Recurring quizzes materialize unattended —
"unattended auto-draw at materialization" — with no admin preview step
(`PRD.md:335-336`; `SCHEDULER.md:92-100`).

The module contract is already fixed and frozen. `QuizzingSchedulerContract` declares
`materializeTemplates(days: number, now: number): Promise<MaterializeResult>` and
`computeWeeklyBoards(weekStart: string): Promise<BoardSummary[]>`
(`src/core/contracts.ts:156,158`). `MaterializationFailure` contains only `templateId`,
`scheduledAt`, and code `'pool_exhausted' | 'missing_timing_configuration'`, while
`MaterializeResult = { quizIds: string[]; failures: MaterializationFailure[] }`,
`BoardSummary = { type: QuizType | 'overall'; weekStart: string; top10: WeeklyBoardRow[] }`,
`WeeklyBoardRow = { rank, userId, name, totalScore, quizzesTaken }`
(`src/core/contracts.ts:126-143`). `[]` from `computeWeeklyBoards` means the week is not ready to
publish; four summaries (possibly with empty `top10` arrays) mean it is
(`src/core/contracts.ts:157-158`; `SCHEDULER.md:125-130`). Neither this method's signature nor any
other type in `src/core/contracts.ts`/`src/core/api.ts` may change in this packet — the note in
the tracker is explicit that the one contract exception already granted
(`listDueAnnounce`, 2026-09-10) is now baked into the frozen baseline, not a pattern this sprint
repeats.

**Sprint 6 already built the weekly send pass; this sprint's job is to make it real and wire it
in.** Sprint 6's packet built and unit-tested, in `src/services/scheduler.ts`, a pass that calls
`computeWeeklyBoards(weekStart)` and, for each non-empty result, calls
`claimAndSend('weekly', {weekStart}, boards)` — against a **fake** `computeWeeklyBoards`, and
deliberately left it unbound from the production `0 19 * * 0` cron trigger, "exactly as Sprint 4
left `closeQuiz`'s pass unbound for Sprint 5"
(`todos/sprint 6/claude-task--001--telegram-six-post-kinds.md:48,110,183-186`). This packet must
not rewrite that pass function; it must implement the real `computeWeeklyBoards` it calls and then
production-bind the existing pass, reusing it (not duplicating its `claimAndSend` loop) for both
the Monday single-week trigger and this sprint's own bounded retry sweep (§7 AC-13/AC-14).

**The Sprint 4→5 typed-but-unwired handoff pattern is the template for how this sprint must
behave, too.** Sprint 4 built a tested-but-unbound `closeQuiz` call seam and Sprint 5's whole job
was implementing the real body and binding it into production
(`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:198-203`;
`todos/sprint 5/claude-task--001--quiz-results-ranking-review.md:87`). This packet is the mirror
image for the weekly seam: implement `computeWeeklyBoards` for real, then flip Sprint 6's already-
tested pass from unbound to production-bound — never rewrite the pass itself unless its exact
shape cannot express the two distinct call patterns this sprint needs (single target week vs. a
bounded backlog sweep), in which case extend its signature minimally rather than forking it.

**`materializeTemplates` reuses Sprint 3's creation pipeline; it does not duplicate it.** Sprint 3
built the pure whole-group selector (`src/core/selection.ts`), the reserve-number →
`BankContract.claimUnused` → room-code/`scheduled` publication state machine
(`src/services/quiz-creation.ts`), and the derived-duration formula
(`windowSec = SUM(quiz_units.time_limit_sec) + slackSec`)
(`todos/sprint 3/claude-task--001--quiz-creation-units-lock.md:36,58-91,146-152`). SCHEDULER.md
§4.2 describes materialization as running that exact pipeline unattended, once per occurrence, with
no preview/admin step: "it draws whole unused RC/LRDI sets plus standalones, builds units, applies
the template's TimingPolicy and slack, derives duration, and retires through BANK... Pool
exhaustion or missing timing configuration fails that occurrence and alerts; no incomplete quiz is
scheduled" (`SCHEDULER.md:94-102`). `CONTRACTS.md` confirms the retirement call: "`materializeTemplates`
additionally calls `BankContract.claimUnused` internally, once per occurrence it creates"
(`CONTRACTS.md:219-220`), and that "the materializer applies the template's timingPolicy to each
actual whole-group draw and calculates windowSec from unit allowances plus slack; it never copies a
stale derived duration" (`CONTRACTS.md:232-233`). It also fixes the failure handoff: QUIZZING
returns safe per-occurrence metadata and SCHEDULER sends each failure through the private Telegram
alert chat and Cloudflare Email Routing independently (`CONTRACTS.md:225-230`). The DB already
protects retry-safety at the
occurrence level: `CREATE UNIQUE INDEX idx_quizzes_template_scheduled ON quizzes(template_id,
scheduled_at) WHERE template_id IS NOT NULL` (`migrations/0001_init.sql:103-104`).

**Weekly attribution and IST week math.** `weekly_boards.week_start` is "the Monday date in
Asia/Kolkata" (`DATA_MODEL.md:60`), IST has no DST (`SCHEDULER.md:147-150`), and quizzes are
attributed by their `scheduled_at` falling in that IST week, never by when a late Sunday run
happens to finish (`QUIZZING.md:249`; `SCHEDULER.md:122-130`). "A late-Sunday quiz may still accept
a student's final batch after Monday 00:30 IST; therefore do not publish a partial weekly result
just because the calendar week has ended" — `computeWeeklyBoards` returns an empty result "while
any non-cancelled scheduled/open occurrence in that week has not completed ranking"
(`SCHEDULER.md:123-130`). Draft/cancelled quizzes are excluded entirely from both the readiness
gate and the aggregate (`SCHEDULER.md:130`). The hourly pass retries unfinished prior-week
publication within the accepted V1 lookback — `WEEKLY_RETRY_LOOKBACK_WEEKS = 8` — rather than
maintaining an unbounded backlog. The project owner accepted that operational limit because this
quiz season ends in the third week of November; weeks older than the window may require manual
recovery. `wrangler.toml`'s own comment on the hourly cron names both halves of that job:
`"0 * * * *", # materialize recurring templates for the next 7 days + auto-draw
units; retry deferred weekly publication` (`wrangler.toml:39`), distinct from the Monday trigger's
comment, `"0 19 * * 0", # weekly boards — 00:30 IST Monday; defer if eligible runs are unfinished`
(`wrangler.toml:40`).

**Existing scaffolding this packet extends, all currently one-line ownership stubs (confirmed by
reading each file directly — no prior sprint has touched them despite being marked `done` in the
tracker, since `done` means the packet was reviewed, not that code was written):**
- `src/core/schedule.ts:1` — "Recurring-template rrule expansion; UTC storage, Asia/Kolkata is
  presentation only" — the one file assigned both IST week-boundary math and rrule expansion. The
  `rrule` grammar itself is resolved: a minimal RFC 5545 `RRULE` subset,
  `FREQ=WEEKLY;BYDAY=<day list>;BYHOUR=<H>;BYMINUTE=<MM>`, with `BYHOUR`/`BYMINUTE` giving the
  occurrence's IST time-of-day on a 24-hour clock, no `COUNT`/`UNTIL`/other RRULE part recognized in
  V1, and any other `FREQ`/unparseable string/missing required part rejected as invalid
  (`SCHEDULER.md:107-118`).
- `src/core/leaderboard.ts:1-3` — already anticipates this sprint: "Weekly boards rank total score
  across quizzes taken; exact totals share dense rank and quizzesTaken is display context only."
- `src/db/boards.ts:1` — "computeWeeklyBoards — avg score per type + overall" is a **stale**
  comment left over from an earlier design; the current authoritative decision is total score, not
  average (`PRD.md:214`; `DATA_MODEL.md:122-124`; `CONTRACTS.md:280-282`). Do not implement the
  comment; implement the current documents. This stale text is exactly why the file's own comment
  is not itself authoritative — treat it as a placeholder to be replaced.
- `src/db/quizzes.ts:1` — "materialize" is already named as this file's future responsibility
  alongside quiz creation.
- `src/routes/boards.ts:1` — the single `GET /api/boards/weekly` route.
- `src/index.ts:1` — already names "hourly materialization and deferred weekly retry, Monday-IST
  weekly publication" among its future responsibilities.

QUIZZING remains the sole writer of `quiz_templates`, `quizzes`, `quiz_units`, `quiz_questions`,
`weekly_boards`, and the `board:<weekStart>` KV key; SCHEDULER issues no SQL/KV of its own and
calls only the two named contract methods (`MODULES.md:56-94`).

## 2. Objective

After this packet ships: every hour, QUIZZING expands each active template's recurrence rule for
the next seven days and unattendedly drafts, draws, times, retires, and publishes each new
occurrence as a fully `scheduled` quiz, exactly like an admin-locked quiz in every other respect.
Pool exhaustion or incomplete timing configuration fails only the affected occurrence; QUIZZING
returns the exact safe typed failure metadata and SCHEDULER independently attempts both existing
private alert channels for every returned failure. Every Monday at 00:30 IST, and again defensively
on every hourly tick within the accepted eight-week lookback, QUIZZING
computes the four weekly board summaries (verbal, quant, lr, overall) for the IST week(s) whose
publication is still outstanding, publishing only once every non-cancelled quiz scheduled in that
week has reached `ended`, ranking by total score with exact ties sharing a dense rank. A
successful publish atomically upserts the full ranked `weekly_boards` rows, warms the
`board:<weekStart>` cache, and — through the exact pass Sprint 6 already built and tested — sends
the weekly Telegram post. Every authenticated student can page through any published weekly board
by section or overall through `GET /api/boards/weekly`.

## 3. Assumptions

- Sprints 1, 2, 3, 5, and 6 are implemented first, per the tracker's stated dependency
  (`todos/PROGRESS.md:22`). This packet consumes Sprint 3's selection/creation primitives, Sprint
  5's dense-rank pattern in `src/core/leaderboard.ts`, and Sprint 6's typed-but-unwired weekly send
  pass in `src/services/scheduler.ts` without duplicating any of them.
- All persisted timestamps and injected `now` values are integer epoch milliseconds; `_sec` fields
  are explicitly multiplied by 1,000 (`DATA_MODEL.md:59`).
- `Asia/Kolkata` is UTC+5:30 with no daylight-saving adjustment, confirmed by both `PRD.md` NFR-8
  and `SCHEDULER.md:147-150`. `week_start` is always the Monday date of the IST week in
  `YYYY-MM-DD` form (`DATA_MODEL.md:60`; `migrations/0001_init.sql:308-309`).
- A materialized quiz's `created_by` is its template's `created_by`
  (`migrations/0001_init.sql:55,84`) — the only value that satisfies the `NOT NULL` foreign key
  with no admin present at materialization time, and the natural owner of a template's own
  occurrences. A materialized quiz's `title` is its template's `name` verbatim
  (`migrations/0001_init.sql:43,66`) — no document specifies a different generated title, and
  inventing per-occurrence title formatting (e.g. appending a date) is out of scope absent a
  stated rule.
- The hourly retry sweep uses the named constant `WEEKLY_RETRY_LOOKBACK_WEEKS = 8` in
  `src/core/config.ts`. The project owner explicitly accepted this bounded V1 operational limitation
  because the quiz season ends in the third week of November. It covers only the current week and
  seven preceding weeks; it does not promise automatic recovery for an unpublished week after that
  week ages out, and this packet adds no backlog-discovery contract.
- Materialization failures cross the existing typed module boundary exactly as
  `MaterializationFailure = { templateId: string; scheduledAt: number; code:
  'pool_exhausted' | 'missing_timing_configuration' }` and `MaterializeResult = { quizIds: string[];
  failures: MaterializationFailure[] }` (`src/core/contracts.ts:126-131`). After the hourly call,
  SCHEDULER attempts an alert for each returned failure through both the private Telegram alert chat
  and Cloudflare Email Routing. Every occurrence, failure, channel attempt, and later cron pass is
  isolated; retries may therefore repeat the alert hourly (`SCHEDULER.md:97-102`;
  `MODULES.md:130-158`).
- No migration is required. `quiz_templates`, `weekly_boards`, and the unique
  `(template_id, scheduled_at)` index already exist in the unapplied initial schema
  (`migrations/0001_init.sql:41-56,103-104,303-316`).
- **`quiz_templates.rrule`'s grammar is a minimal RFC 5545 `RRULE` subset, resolved and no longer
  open.** `FREQ=WEEKLY;BYDAY=<day list>;BYHOUR=<H>;BYMINUTE=<MM>` (e.g.
  `FREQ=WEEKLY;BYDAY=TU,TH;BYHOUR=18;BYMINUTE=0`), with `BYHOUR`/`BYMINUTE` giving the occurrence's
  IST time-of-day on a 24-hour clock. No `COUNT`/`UNTIL`/other RRULE parts are recognized in V1 — a
  template recurs indefinitely until deactivated. `src/core/schedule.ts`'s expansion function parses
  only `FREQ=WEEKLY`, `BYDAY`, `BYHOUR`, and `BYMINUTE`; any other `FREQ` value, an unparseable
  string, or a missing required part is rejected as invalid rather than guessed
  (`SCHEDULER.md:107-118`).
- **`GET /api/boards/weekly`'s omitted-parameter defaults are resolved and no longer open.** An
  omitted `type` defaults to `'overall'`; an omitted `weekStart` defaults to the most recently
  *published* week (`MAX(week_start)` present in `weekly_boards`), never the calendar week
  containing `now`, since a just-elapsed week may not be published yet (§7 AC-8). If no week has
  ever been published, the response is the same empty `PageResponse` (`total: 0`) any other
  not-yet-published `weekStart` would return — there is still no 404 path for this route
  (`API.md:232-238`).

## 4. Out of Scope

- **Recurring template CRUD (create/edit/deactivate a `quiz_templates` row):** explicitly deferred
  in every authoritative source — "Template CRUD remains deferred, with DB configuration accepted
  until that feature is built" (`SCHEDULER.md:105`; `QUIZZING.md:96`; `PLAN.md:282-283`). This
  packet reads existing `quiz_templates` rows seeded directly into D1; it adds no admin route for
  creating, editing, or deactivating one.
- **General per-job logging and a run-history report:** broad job observability remains deferred;
  this packet reuses the existing dual-channel alert sender only for targeted safe materialization
  failures (`MODULES.md:154-168`).
- **Unbounded weekly-board backlog discovery:** V1 deliberately scans only the current and prior
  seven weeks. The owner accepted manual recovery for an unpublished week that ages out because the
  quiz season ends in the third week of November; no new QUIZZING discovery contract is added.
- **Admin report export and backend hardening:** Phase 8 (`PRD.md:279`; `MODULES.md:208`).
- **Frontend, mockups, and design-system files:** backend precedes frontend integration
  (`PLAN.md:256-269`); no `web/` or visual file is touched.
- **Any change to `src/core/contracts.ts`, `src/core/api.ts`, `migrations/0001_init.sql`, or
  `wrangler.toml`:** the weekly/template contracts, schema, and cron expressions are already
  correct and frozen for this sprint. `wrangler.toml`'s cron list already contains all three
  expressions this packet needs (`wrangler.toml:36-41`); only `src/index.ts`'s dispatch logic
  changes.
- **Per-quiz leaderboard, review, history, or `closeQuiz`:** Sprint 5 owns and already ships these;
  this packet only reads `participants.total_score` as already-committed input, never regrades or
  re-ranks a per-quiz board.
- **Rewriting Sprint 6's `claimAndSend`/render functions or the weekly pass's own loop body:** this
  packet implements the contract method the pass calls and flips production binding; it does not
  touch `src/core/telegram-render.ts`, `src/db/telegram.ts`, or `src/services/telegram.ts`.
- **`rrule` editor UI or validation tooling:** out of scope regardless of the resolved grammar
  (`SCHEDULER.md:107-118`) — this packet only needs to *read and expand* an already-seeded `rrule`
  string, not author or validate one interactively.

## 5. Open Questions / `<INPUT_REQUIRED>`

**(none).** All decisions are resolved by the project owner as of 2026-09-10:

- **OQ-1 (`quiz_templates.rrule` grammar):** a minimal RFC 5545 `RRULE` subset,
  `FREQ=WEEKLY;BYDAY=<day list>;BYHOUR=<H>;BYMINUTE=<MM>` (e.g.
  `FREQ=WEEKLY;BYDAY=TU,TH;BYHOUR=18;BYMINUTE=0`), with no `COUNT`/`UNTIL`/other RRULE parts
  recognized in V1 (a template recurs indefinitely until deactivated) and `BYHOUR`/`BYMINUTE`
  giving the occurrence's IST time-of-day on a 24-hour clock — both are themselves standard RRULE
  parts, so this stays a strict RRULE subset rather than a bespoke suffix. Any other `FREQ` value,
  an unparseable string, or a missing required part is rejected as invalid (`SCHEDULER.md:107-118`).
- **OQ-2 (`GET /api/boards/weekly` omitted-parameter defaults):** omitted `type` defaults to
  `'overall'`; omitted `weekStart` defaults to the most recently *published* week (`MAX(week_start)`
  present in `weekly_boards`), not the calendar week containing `now`; if no week has ever been
  published, the response is the same empty `PageResponse` (`total: 0`) any other not-yet-published
  `weekStart` would return — there is still no 404 path for this route (`API.md:232-238`).
- **Materialization failure handling:** QUIZZING returns the exact safe `MaterializationFailure[]`
  metadata already defined in `MaterializeResult`; SCHEDULER alerts every failure through both
  existing private channels independently (`src/core/contracts.ts:126-131`; `SCHEDULER.md:97-102`).
- **Weekly retry horizon:** retain `WEEKLY_RETRY_LOOKBACK_WEEKS = 8` as an accepted bounded V1
  operational limitation because the quiz season ends in the third week of November. Automatic
  recovery after a week ages out of that window is not promised.

These rules are now baked directly into §3's assumptions and the acceptance criteria below, rather
than tracked as markers.

## 6. Pre-flight Checklist

- [ ] Required skill loaded: **`clean-code`** — required for every implementation packet.
- [ ] Required skill loaded: **`prod-safety-gate`** — this packet wires two more cron passes into
      production, one of which (materialization) unattendedly creates and schedules real quizzes
      with no admin in the loop, and the other of which is the point at which student names/scores
      first go out to the whole group on a schedule.
- [ ] Required skill loaded: **`test-driven-development`** — IST week-boundary math, rrule
      expansion, dense weekly ranking, publication completeness, and occurrence-level materialize
      isolation are all new behavior.
- [ ] Required skill loaded: **`vibesec`** — unattended cron-triggered quiz creation from
      admin-supplied but machine-parsed `rrule`/JSON policy input, and public student-facing
      pagination/query-param input on `GET /api/boards/weekly`, both need runtime validation and
      bounded work.
- [ ] Confirm the working tree is clean for this scope and the branch is current with trunk;
      preserve unrelated user changes.
- [ ] Confirm Sprint 1, 2, 3, 5, and 6 implementations plus their focused/full tests pass before
      adding weekly/recurring behavior.
- [ ] Confirm Sprint 4's private alert sender resolves both `TELEGRAM_ALERT_CHAT_ID` and Cloudflare
      Email Routing's `ALERT_EMAIL` binding in staging; a custom Cloudflare-managed domain and
      verified `EMAIL_ALERT_ADDRESS` remain production prerequisites (`MODULES.md:130-140`).
- [ ] The resolved `rrule` grammar (`FREQ=WEEKLY;BYDAY=<day list>;BYHOUR=<H>;BYMINUTE=<MM>`,
      `SCHEDULER.md:107-118`) and the resolved `GET /api/boards/weekly` omitted-parameter defaults
      (`type` → `'overall'`, `weekStart` → `MAX(week_start)` in `weekly_boards`, `API.md:232-238`)
      are understood before starting `src/core/schedule.ts`'s expansion function or the route's
      default-resolution logic; both are already baked into §3 and AC-2, AC-3, AC-15 below.
- [ ] Read `PRD.md:107-119`, `PRD.md:207-235`, `PRD.md:263-300`, `PRD.md:322-384`, `PLAN.md:14-45`,
      `PLAN.md:176-254`, `MODULES.md:52-108`, `MODULES.md:121-165`, `MODULES.md:199-237`,
      `DATA_MODEL.md:39-63`, `DATA_MODEL.md:108-130`, `CONTRACTS.md:157-275`, `API.md:126-165`,
      `API.md:216-260`, `QUIZZING.md:36-96`, `QUIZZING.md:242-303`, `SCHEDULER.md:92-155` before
      editing.
- [ ] Read exact types/DDL at `src/core/contracts.ts:41-56,71-81,118-158`,
      `src/core/api.ts:423-430`, `migrations/0001_init.sql:41-104,303-317` before editing.
- [ ] Re-read Sprint 3's creation/lock state machine (`todos/sprint 3/claude-task--001--quiz-creation-units-lock.md:58-91,146-152`)
      and Sprint 6's weekly-pass handoff (`todos/sprint 6/claude-task--001--telegram-six-post-kinds.md:48,110,183-186`)
      before writing `src/services/quiz-materializer.ts` or touching `src/services/scheduler.ts`.
- [ ] Draw the materialize-per-occurrence crash/retry state machine and the weekly readiness →
      aggregate → rank → publish → cache-warm → send sequence before writing production code.
- [ ] Re-read AC-1 through AC-17 and AC-OPERATOR; identify implementer, scheduler-composition, and
      operator checks separately.

## 7. Acceptance Criteria

1. **AC-1 — Compute IST week boundaries in pure core code.** `src/core/schedule.ts` exposes a pure
   function that, given a `week_start` string in `YYYY-MM-DD` form, returns the inclusive-start /
   exclusive-end epoch-ms bounds of that Monday-to-Monday IST week (`[Monday 00:00 IST, next
   Monday 00:00 IST)`), and a pure function that, given an epoch-ms `now`, returns the `week_start`
   string of the most recently fully-elapsed IST week. Both use the fixed UTC+5:30 offset with no
   DST branch (`SCHEDULER.md:147-150`; `DATA_MODEL.md:60`). No Worker/D1/KV/global-clock dependency
   exists in this file.
2. **AC-2 — Expand a template's `rrule` into candidate occurrence timestamps.** `src/core/schedule.ts`
   exposes a pure function that parses the resolved minimal RFC 5545 `RRULE` subset —
   `FREQ=WEEKLY;BYDAY=<day list>;BYHOUR=<H>;BYMINUTE=<MM>` (e.g.
   `FREQ=WEEKLY;BYDAY=TU,TH;BYHOUR=18;BYMINUTE=0`), where `BYHOUR`/`BYMINUTE` give the occurrence's
   IST time-of-day on a 24-hour clock and no `COUNT`/`UNTIL`/other RRULE part is recognized
   (`SCHEDULER.md:107-118`) — and, given a template's `rrule` string and a `[fromMs, toMs)` window,
   returns every occurrence's `scheduled_at` epoch-ms timestamp computed from the `BYDAY`/`BYHOUR`/
   `BYMINUTE` values within that window, in ascending order, with no duplicate timestamps. Any
   `FREQ` value other than `WEEKLY`, an unparseable string, or a missing required part (`BYDAY`,
   `BYHOUR`, or `BYMINUTE`) is rejected as invalid rather than guessed. It is bounded: a malformed
   or pathological `rrule` never produces an unbounded or near-infinite list — reject/return-empty
   for a rule that cannot be safely expanded rather than throwing an uncaught exception that would
   abort the whole materialize pass.
3. **AC-3 — Discover due, not-yet-materialized occurrences.** `materializeTemplates(days, now)`
   loads every `quiz_templates` row with `active = 1`, expands each one's `rrule` over
   `[now, now + days*86400000)` using AC-2, and — for each candidate `scheduled_at` — skips it if a
   `quizzes` row already exists for that exact `(template_id, scheduled_at)` pair (a cheap read
   check backed by the existing unique index as the authoritative retry-safety backstop,
   `migrations/0001_init.sql:103-104`). `days` is always called with `7` in production
   (`SCHEDULER.md:94`), but the function itself accepts the parameter as given by the frozen
   contract (`src/core/contracts.ts:156`).
4. **AC-4 — Draw, build units, and derive duration exactly like Sprint 3's creation pipeline.** For
   each newly-discovered occurrence, call `BankContract.listUnused` with the template's `type`,
   `difficulty_mix`, and `question_count`, reuse Sprint 3's pure whole-group selector
   (`src/core/selection.ts`) unchanged to build ordered `QuizUnitDefinition`s, apply the template's
   `timing_policy` (every kind present in the draw must have a positive integer value, exactly as
   at admin lock — `QUIZZING.md:69-70`), and derive
   `windowSec = SUM(quiz_units.time_limit_sec) + slackSec` from the template's `slack_sec`
   (`DATA_MODEL.md:50-51`; `CONTRACTS.md:232-233`). Never copy a stale duration from the template or
   from a prior occurrence of the same template.
5. **AC-5 — Reserve, retire, and publish each occurrence atomically, without duplicating Sprint 3's
   state machine.** Reuse (via an exported, non-duplicated primitive from Sprint 3's creation
   service/repository) the exact reserve-next-quiz-number → `BankContract.claimUnused(questionIds,
   quizId, quizNumber)` → assign-room-code → `status='scheduled'` sequence Sprint 3 already built
   for admin lock, with the same same-owner-confirmed-claim retry safety
   (`todos/sprint 3/claude-task--001--quiz-creation-units-lock.md:87`; `CONTRACTS.md:100-111`). A
   materialized occurrence skips the draft/preview HTTP round trip entirely — one
   `materializeTemplates` invocation both composes and fully publishes the occurrence to
   `scheduled` with `created_by`/`title` per §3's assumption — but never bypasses or shortcuts the
   underlying atomicity/retry guarantees that pipeline already provides. A crash at any point
   before full BANK confirmation and room-code publication leaves nothing scheduled; a retried pass
   recovers via the same `(template_id, scheduled_at)` occurrence identity.
6. **AC-6 — Isolate occurrence failures; never schedule an incomplete quiz.** Pool exhaustion or an
   impossible exact whole-group/difficulty combination maps to `code: 'pool_exhausted'`; a missing
   or non-positive timing-policy value for a drawn kind maps to
   `code: 'missing_timing_configuration'`. Either condition fails only that occurrence: it writes
   nothing (no draft, partial `quiz_units`/`quiz_questions`, or BANK claim), does not appear in
   `quizIds`, and contributes exactly one `{templateId, scheduledAt, code}` entry to `failures`
   (`src/core/contracts.ts:126-131`; `SCHEDULER.md:97-102`). A failed occurrence never aborts or
   rolls back another committed occurrence and never prevents a sibling occurrence from being
   attempted.
7. **AC-7 — Return the exact complete `MaterializeResult`.** `MaterializeResult.quizIds` contains only
   the quiz IDs newly created and published to `scheduled` by this invocation — never
   already-existing occurrences skipped by AC-3's dedup check, and never a failed occurrence from
   AC-6. `MaterializeResult.failures` contains only the safe failure entries produced by this
   invocation, with no question, answer, SQL, provider, or student data. Re-invoking with the same
   `now`/`days` after a partial prior run returns only IDs created and failures encountered in
   *this* call (`CONTRACTS.md:225-230`).
8. **AC-8 — Enforce the one weekly readiness predicate.** `computeWeeklyBoards(weekStart)` computes
   `[startMs, endMs)` for `weekStart` via AC-1, and returns `[]` (published nothing, sent nothing)
   whenever any `quizzes` row with `scheduled_at` in that range and `status IN ('scheduled',
   'open')` exists — an eligible occurrence for that week has not yet reached a terminal state.
   Rows with `status IN ('draft', 'cancelled')` never block readiness and are excluded from both
   this check and AC-9's aggregate (`SCHEDULER.md:122-130`). This function must be safely callable
   many times for the same not-yet-ready week with no side effect beyond the read.
9. **AC-9 — Aggregate total score per user, per type and overall, from `status='ended'` quizzes
   only.** Once ready, for every `quizzes` row with `scheduled_at` in `[startMs, endMs)` and
   `status='ended'`, sum each participant's committed `participants.total_score` grouped by
   `(user_id, quizzes.type)` for the three section boards and by `(user_id)` alone for `overall`;
   `quizzes_taken` is the corresponding count of such quizzes per grouping. A user with zero
   qualifying quizzes in a given grouping does not appear in that board at all — there is no
   minimum-participation floor and no synthetic zero-score row (`PRD.md:215`; `DATA_MODEL.md:122`).
   `total_score`/`quizzes_taken` are read only from already-committed Sprint 5 aggregates; this
   function never regrades, re-sums per-answer rows, or reopens a per-quiz board.
10. **AC-10 — Rank weekly boards by total score alone, exact ties sharing a dense rank.** Extend
    `src/core/leaderboard.ts` with a pure single-key dense-rank helper (score DESC only — no
    secondary tie-break exists for weekly boards, unlike the per-quiz score/time ranker Sprint 5
    already built there) and use it for all four boards. `quizzesTaken` never participates in
    ordering; it is display context only (`PRD.md:214`; `CONTRACTS.md:280-282`).
11. **AC-11 — Publish all four boards atomically and warm the cache from committed data only.**
    Under one transaction/batch, upsert every ranked row into `weekly_boards` for `weekStart` across
    all four `type` values (`PRIMARY KEY (week_start, type, user_id)`,
    `migrations/0001_init.sql:308-315`), replacing any prior computation for that exact
    `(weekStart, type)` pair so a re-run recomputes cleanly rather than appending duplicates or
    stale ranks. After the D1 commit, warm `board:<weekStart>` in KV from the committed rows; a KV
    write failure is observable but never blocks or rolls back the D1 publish, and `GET
    /api/boards/weekly` must fall back to a fresh D1 read on a cache miss or failure
    (`MODULES.md:91`).
12. **AC-12 — Return the exact `BoardSummary[]` contract shape.** On success, return exactly four
    entries in fixed order `verbal, quant, lr, overall`, each `{type, weekStart, top10}` with
    `top10` the first ten ranked rows of that board (an empty array is valid and distinct from the
    not-ready `[]` top-level return — the not-ready case returns zero entries, not four entries
    with empty `top10`) (`src/core/contracts.ts:132-143,157-158`; `SCHEDULER.md:125-130`).
13. **AC-13 — Production-bind the Monday single-week publish, reusing Sprint 6's existing pass.**
    `src/index.ts`'s scheduled-handler dispatch routes the `"0 19 * * 0"` cron
    (`wrangler.toml:40`) to a call, in `src/services/scheduler.ts`, of the exact weekly send pass
    Sprint 6 built — invoked for exactly the single `weekStart` AC-1's "most recently elapsed IST
    week" function returns for that `now`. Bind the real `computeWeeklyBoards` implementation into
    `QuizzingSchedulerContract` for this call, matching how Sprint 5 bound the real `closeQuiz`
    (`todos/sprint 5/claude-task--001--quiz-results-ranking-review.md:181-184`). If that week is not
    yet ready, the pass observes `[]` and sends nothing this tick — this is the normal "defer" case
    from `wrangler.toml:40`'s own comment, not an error.
14. **AC-14 — Production-bind hourly materialization and a bounded weekly-retry sweep.**
    `src/index.ts` routes the `"0 * * * *"` cron to two passes in `src/services/scheduler.ts`: (a)
    `materializeTemplates(7, now)` and (b) a retry sweep that, for each of the `now`-relative
    current week back through `WEEKLY_RETRY_LOOKBACK_WEEKS - 1` prior weeks (§3), invokes the same
    Sprint 6 weekly send pass reused by AC-13 for that candidate `weekStart`. Each of the two
    sub-passes, and each candidate week within the sweep, is isolated (a failure in one template,
    occurrence, or candidate week never blocks the rest), mirroring the per-candidate isolation
    Sprint 4 established for `listDueClose`
    (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:88`). After materialization,
    iterate every returned `failures` entry and pass only its `templateId`, `scheduledAt`, and
    `code` to Sprint 4's existing private alert sender. Attempt the Telegram alert chat and
    Cloudflare Email Routing independently for each entry: one occurrence failure, sibling
    occurrence, alert-channel failure, weekly candidate, or later cron pass never blocks another.
    A retry may emit the same safe alert again on a later hourly pass (`SCHEDULER.md:97-102`;
    `MODULES.md:154-158`). The fixed eight-week sweep is an accepted V1 limit and does not discover
    or retry weeks after they age out.
15. **AC-15 — Serve `GET /api/boards/weekly` exactly.** Requires authentication (401 signed out).
    Validate `type` is one of `'verbal'|'quant'|'lr'|'overall'` when supplied and `weekStart`
    matches `YYYY-MM-DD` when supplied, else 400; apply the shared pagination convention
    (`limit=50,offset=0` defaults, integer `limit` 1..100, non-negative integer `offset`, 400
    without clamping otherwise — `API.md:29-36`). There is no 404 path for this route
    (`API.md:223`): an unpublished or nonexistent week/type combination returns an empty
    `PageResponse` with `total:0`, never an error. An omitted `type` defaults to `'overall'`; an
    omitted `weekStart` defaults to the most recently *published* week (`MAX(week_start)` present in
    `weekly_boards`), never the calendar week containing `now`; if no week has ever been published,
    return the same empty `PageResponse` (`total: 0`) described above (`API.md:232-238`). Return
    exactly `WeeklyBoardResponse` (`items`, `total`, `limit`, `offset`, `weekStart`, `type`)
    (`src/core/api.ts:427-430`).
16. **AC-16 — Preserve module ownership and protected files.** QUIZZING alone writes
    `quiz_templates` reads and `quizzes`/`quiz_units`/`quiz_questions`/`weekly_boards` writes and
    the `board:<weekStart>` KV key; SCHEDULER calls only the two named contract methods and issues
    no SQL/KV of its own. `migrations/0001_init.sql`, `src/core/contracts.ts`, `src/core/api.ts`,
    and `wrangler.toml` remain byte-for-byte unchanged. `src/core/telegram-render.ts`,
    `src/db/telegram.ts`, `src/services/telegram.ts`, and `src/services/observability.ts` remain
    untouched — this packet consumes Sprint 4's existing alert sender and calls Sprint 6's
    `claimAndSend` indirectly through its existing weekly pass function.
17. **AC-17 — Prove behavior test-first.** Before production edits, add failing tests for: IST week
    boundary math across a DST-free year boundary and a late-Sunday-crossing-Monday-00:30 case;
    rrule expansion against the resolved `FREQ=WEEKLY;BYDAY=<day list>;BYHOUR=<H>;BYMINUTE=<MM>`
    grammar (bounded output, no duplicate timestamps, rejection of any other `FREQ`, an unparseable
    string, a missing required part, or a pathological rule); materialize dedup/idempotent
    re-invocation; every occurrence-level
    pool-exhaustion/incomplete-policy failure mapping and its isolation from sibling occurrences;
    exact safe `MaterializeResult` construction; one dual-channel alert attempt per returned
    failure; independent failures of either alert channel; multiple failure entries; repeated
    hourly alerts on retry; isolation from sibling occurrences, the weekly sweep, and later passes;
    every materialize crash/retry boundary mirroring Sprint 3's reserve/claim/publish tests; weekly
    readiness with a still-open quiz in-week, a cancelled quiz in-week (must not block), and a
    draft quiz in-week (must not block); dense ties at the weekly level; zero-participation
    exclusion; idempotent republish overwriting stale ranks cleanly; the exact fixed-order
    `BoardSummary[]` shape and the not-ready `[]` case; production binding of both new cron passes
    with per-candidate isolation; and the resolved `GET /api/boards/weekly` default/validation
    matrix. Watch each focused test fail for the intended missing behavior before implementing.
18. **AC-OPERATOR — Verify materialization and weekly publication on staging.** With at least one
    seeded `quiz_templates` row and a controlled `now`, the operator: runs the hourly pass and
    confirms exactly the expected occurrences appear as `scheduled` quizzes with correct
    room codes, retired BANK content, and derived duration; forces one occurrence to fail (e.g. an
    exhausted pool) and confirms only that occurrence is absent while siblings still materialize,
    with matching safe alerts received through both the private Telegram alert chat and Cloudflare
    Email Routing; breaks each alert channel separately and confirms the other still receives its
    alert and healthy siblings still complete; runs the weekly pass before and after all in-week quizzes reach
    `ended` and confirms no premature publish; confirms the Telegram weekly post (already verified
    functionally in Sprint 6) fires exactly once per week via the reused pass; and pages
    `GET /api/boards/weekly` with and without query params against the resolved default
    (`type` → `'overall'`, `weekStart` → most recently published week, `API.md:232-238`).
    Record only opaque template/quiz IDs, counts, and pass/fail outcomes — never question content,
    solutions, or student PII beyond what the product already exposes on a public weekly board.

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not edit `migrations/0001_init.sql`, `src/core/contracts.ts`, `src/core/api.ts`, or
  `wrangler.toml`. The frozen `materializeTemplates`/`computeWeeklyBoards` signatures, the
  `(template_id, scheduled_at)` unique index, and all three cron expressions already exist and are
  correct as-is.
- Do not implement `avg`/mean-score weekly ranking. `src/db/boards.ts`'s current one-line comment
  says "avg score" and is stale; the authoritative decision is total score
  (`PRD.md:214`; `DATA_MODEL.md:122-124`).
- Do not add a new admin route, request type, or D1 write path for creating/editing/deactivating a
  `quiz_templates` row. Template CRUD is deferred; this packet only reads existing rows.
- Do not duplicate Sprint 3's whole-group selector or reserve/claim/publish state machine in a
  second implementation for materialization. Import and reuse the exported primitives; do not
  hand-roll a second BANK-claim/room-code/publish sequence.
- Do not let a materialization occurrence failure roll back, skip, or corrupt a sibling occurrence
  already committed in the same pass. Do not discard or broaden its safe failure DTO, and do not
  omit either existing private alert-channel attempt. One channel failure must never suppress the
  other channel, other failures, sibling occurrences, weekly work, or a later cron pass.
- Do not publish a weekly board, upsert `weekly_boards`, warm `board:<weekStart>`, or call the
  Sprint 6 weekly send pass while any non-cancelled `scheduled`/`open` quiz remains in that IST
  week. Do not use `ends_at` or "all currently joined participants finished" as a readiness proxy.
- Do not attribute a quiz to a week by anything other than `scheduled_at` (never `created_at`,
  `opened_at`, or `ended_at`).
- Do not add a secondary tie-break to weekly ranking. Exact total-score ties share one dense rank;
  `quizzesTaken` never breaks a tie or divides the score.
- Do not implement a 404 response for `GET /api/boards/weekly`, and do not use any default other
  than the ratified rule: omitted `type` → `'overall'`; omitted `weekStart` → the most recently
  published week (`MAX(week_start)` in `weekly_boards`), never the calendar week containing `now`
  (`API.md:232-238`).
- Do not let SCHEDULER issue SQL or touch KV directly, or let it call anything beyond
  `materializeTemplates`/`computeWeeklyBoards` and the already-existing `TelegramContract` surface
  Sprint 6 wired plus Sprint 4's existing private alert sender.
- Do not add a pending-week discovery contract or claim that the eight-week sweep guarantees
  indefinite recovery. `WEEKLY_RETRY_LOOKBACK_WEEKS = 8` is the accepted V1 boundary.
- Do not touch `src/core/telegram-render.ts`, `src/db/telegram.ts`, `src/services/telegram.ts`,
  `src/services/observability.ts`, Sprint 1–6 route/service files outside the ones named in §9, or
  any product document/prior packet/fixture/the progress tracker.

### 8b. Coding / quality principles

- **`clean-code`:** keep the materialize-per-occurrence pipeline and the weekly
  readiness→aggregate→rank→publish pipeline as small, named, independently testable steps rather
  than one large function each; name the lookback/lookahead bounds (`MATERIALIZE_LOOKAHEAD_DAYS`,
  `WEEKLY_RETRY_LOOKBACK_WEEKS`) instead of bare numbers.
- **`prod-safety-gate`:** the dangerous surfaces are (1) unattended, cron-triggered creation of
  real scheduled quizzes with no human review, and (2) the first point at which weekly rankings and
  real names reach the whole group without a per-request gate, and (3) failure alerts whose silent
  loss would leave an unattended materialization problem undiscovered. Test every occurrence crash
  boundary, both independent alert-channel failures, and every readiness-boundary instant before
  rollout, the same rigor Sprint 3 applied to admin lock and Sprint 5 applied to `closeQuiz`.
- **`vibesec`:** validate `rrule` input defensively — a malformed or adversarially large recurrence
  rule must never produce unbounded occurrence output or an unhandled exception that aborts the
  whole hourly tick; validate `GET /api/boards/weekly`'s query params against exact allowlists; bind
  all SQL; construct `MaterializationFailure` from the three-field allowlist and never expose
  question content, solutions, provider errors, secrets, or student data in alerts.
- **`test-driven-development`:** start with the pure `src/core/schedule.ts` tests (fastest
  feedback, no D1), then materialize's D1/BANK-fake tests, then weekly aggregation/ranking D1
  tests, then route tests, then scheduler-composition tests. Watch each fail for the missing
  behavior before implementing.
- Construct every `BoardSummary`/`WeeklyBoardRow`/`WeeklyBoardResponse` field explicitly — the same
  principle CONTRACTS.md states for other DTOs applies here (`CONTRACTS.md:135-139`).
- Reuse `src/core/leaderboard.ts`'s existing dense-rank pattern rather than reimplementing tie
  logic from scratch; keep the single-key weekly variant clearly separate from the two-key
  per-quiz variant.
- Use one injected integer `now` throughout each invocation (materialize's discovery window,
  weekly's readiness check, both scheduler passes) and pass the same value through to tests.

## 9. Behavior Spec (per file)

### `src/core/config.ts`

- **Current state:** already names seat cap, room-code format, and `UNIT_SUBMISSION_TRANSPORT_MS`
  (`src/core/config.ts:1`).
- **Required edit:** merge, without replacing earlier constants, `MATERIALIZE_LOOKAHEAD_DAYS = 7`
  and `WEEKLY_RETRY_LOOKBACK_WEEKS = 8`.
- **Estimated diff:** ~6 LOC.
- **Subtleties:** these are implementation bounds, not product settings; do not expose either as an
  API input.

### `src/core/schedule.ts`

- **Current state (line 1):** stub naming both IST week-boundary math and rrule expansion as this
  file's job.
- **Required edit:** implement AC-1's pure week-boundary functions and AC-2's rrule expansion
  against the resolved grammar — a minimal RFC 5545 `RRULE` subset,
  `FREQ=WEEKLY;BYDAY=<day list>;BYHOUR=<H>;BYMINUTE=<MM>`, with `BYHOUR`/`BYMINUTE` giving the
  occurrence's IST time-of-day on a 24-hour clock, no `COUNT`/`UNTIL`/other RRULE part recognized,
  and any other `FREQ`/unparseable string/missing required part rejected as invalid
  (`SCHEDULER.md:107-118`).
- **Estimated diff:** ~70 LOC.
- **Subtleties:** no Worker/D1/KV import; UTC+5:30 fixed offset, no DST branch; bound rrule
  expansion defensively so a bad rule cannot hang or overflow the caller.

### `src/core/leaderboard.ts`

- **Current state:** Sprint 5 already implements the two-key per-quiz dense-rank helper here; the
  file's own header comment already names the weekly single-key variant as pending work
  (`src/core/leaderboard.ts:1-3`).
- **Required edit:** add a pure single-key (score DESC only) dense-rank helper for weekly boards.
- **Estimated diff:** ~25 LOC.
- **Subtleties:** do not let the new helper affect or duplicate the existing per-quiz ranker; both
  must remain independently tested.

### `src/db/quizzes.ts`

- **Current state (line 1):** already names "materialize" as part of this file's ownership
  alongside creation-time tables.
- **Required edit:** expose the occurrence-dedup read (AC-3), and the reusable
  reserve/claim/publish primitive(s) already built for Sprint 3's admin lock, either by exporting
  what already exists or by factoring a shared internal helper if Sprint 3's implementation
  inlined that sequence into a single non-reusable function.
- **Estimated diff:** ~40 LOC (mostly the occurrence-dedup query and any factoring needed for
  reuse).
- **Subtleties:** never write a second implementation of the reserve-number/claim/publish sequence
  here; if reuse requires refactoring Sprint 3's existing code, keep behavior identical for the
  admin-lock path and add regression tests proving it.

### `src/services/quiz-materializer.ts` (new)

- **Current state:** no materialization orchestration layer exists yet.
- **Required edit:** implement `materializeTemplates(days, now)` per AC-3 through AC-7: load active
  templates, expand occurrences, dedup, draw/build/derive per occurrence via Sprint 3's selector
  and reused publish primitive, isolate failures, and return exactly `{quizIds, failures}` using
  the safe `MaterializationFailure` discriminants (`src/core/contracts.ts:126-131`).
- **Estimated diff:** ~95 LOC.
- **Subtleties:** depends on `src/core/schedule.ts` (AC-2), `src/core/selection.ts` (unchanged),
  `BankContract`, and `src/db/quizzes.ts`'s reused publish primitive. Never import anything
  Telegram-shaped.

### `src/db/boards.ts`

- **Current state (line 1):** stub with a stale "avg score" comment (§1); this file owns
  `weekly_boards` reads/writes.
- **Required edit:** implement the readiness check (AC-8), the per-`(type,user)` aggregation query
  (AC-9), the atomic upsert (AC-11), and the paginated read used by `GET /api/boards/weekly`
  (AC-15).
- **Estimated diff:** ~90 LOC.
- **Subtleties:** replace the stale header comment; bind all query parameters; the upsert must
  cleanly replace a prior computation for the same `(weekStart, type)`, not append.

### `src/services/cache.ts`

- **Current state (line 1):** already reserves `board:<quizId|weekStart>` for QUIZZING while
  keeping D1 authoritative.
- **Required edit:** add validated get/put helpers for a committed weekly-board KV projection
  keyed `board:<weekStart>`.
- **Estimated diff:** ~25 LOC.
- **Subtleties:** never treat a KV write failure as a publish failure; `GET /api/boards/weekly`
  must fall back to fresh D1 reads on miss/failure.

### `src/services/quiz-boards.ts` (new)

- **Current state:** no weekly-board use-case layer exists.
- **Required edit:** implement `computeWeeklyBoards(weekStart)` (AC-8 through AC-12) coordinating
  `src/core/schedule.ts`, `src/db/boards.ts`, `src/core/leaderboard.ts`'s new weekly helper, and
  the KV cache; implement the read-path service backing `GET /api/boards/weekly` (AC-15), including
  the resolved default resolution — omitted `type` → `'overall'`, omitted `weekStart` → the most
  recently published week (`MAX(week_start)` in `weekly_boards`) — per `API.md:232-238`.
- **Estimated diff:** ~85 LOC.
- **Subtleties:** the not-ready `[]` and the four-entries-with-possibly-empty-`top10` cases must be
  structurally distinct in the return type, never conflated.

### `src/routes/boards.ts`

- **Current state (line 1):** stub naming the single `GET /api/boards/weekly` route.
- **Required edit:** mount the route, apply Sprint 1 authentication, parse/validate query params
  per AC-15, invoke `src/services/quiz-boards.ts`, and serialize exactly `WeeklyBoardResponse`.
- **Estimated diff:** ~35 LOC.
- **Subtleties:** no 404 path exists for this route; malformed input is 400, everything else is a
  direct 200 payload.

### `src/services/scheduler.ts`

- **Current state:** Sprint 4 created this file with the prepare pass and the close-call seam;
  Sprint 6 added the Announce pass (production-bound) and the weekly send pass
  (typed-but-unwired) (`todos/sprint 6/claude-task--001--telegram-six-post-kinds.md:183-186`).
- **Required edit:** add the materialize pass (calls `materializeTemplates(7, now)`) and the
  bounded weekly-retry sweep (AC-14), reusing — not duplicating — Sprint 6's existing weekly send
  pass function for both the Monday single-target call (AC-13) and each candidate week in the
  sweep (AC-14). After materialization returns, independently send each safe `failures` entry through
  both channels using Sprint 4's injected alert sender. Extend the weekly pass's signature minimally
  if needed to accept an explicit target `weekStart` for both call sites.
- **Estimated diff:** ~70 LOC.
- **Subtleties:** preserve every already-bound prepare/announce/close pass exactly; isolate
  every occurrence/failure/channel attempt, the Monday publish, and every sweep candidate from one
  another. Repeated hourly alerts are intentional while a failed occurrence remains retryable; do
  not persist a new dedup marker. The alert sender receives only `templateId`, `scheduledAt`, and
  `code` and never controls materialization state.

### `src/index.ts`

- **Current state (line 1):** stub already naming "hourly materialization and deferred weekly
  retry, Monday-IST weekly publication" as pending responsibilities.
- **Required edit:** bind the real `materializeTemplates`/`computeWeeklyBoards` into
  `QuizzingSchedulerContract`; mount `GET /api/boards/weekly`; extend the scheduled-handler
  dispatch so `event.cron === "0 * * * *"` runs materialize + the weekly-retry sweep and
  `event.cron === "0 19 * * 0"` runs the single-week Monday publish, alongside the already-bound
  `"* * * * *"` minute tick.
- **Estimated diff:** ~30 LOC.
- **Subtleties:** dispatch on `event.cron`, not on wall-clock guesswork; preserve every prior mount
  and binding exactly.

### `tests/schedule.test.ts` (new)

- **Current state:** no executable tests exist for IST week math or rrule expansion.
- **Required edit:** table-test AC-1's boundary math (including a late-Sunday-into-Monday-00:30
  case) and AC-2's expansion against the resolved `FREQ=WEEKLY;BYDAY=<day list>;BYHOUR=<H>;
  BYMINUTE=<MM>` grammar (bounded output, duplicate rejection, rejection of any other `FREQ`/
  unparseable string/missing required part, pathological-rule handling).
- **Estimated diff:** ~60 LOC.
- **Subtleties:** use explicit fixture timestamps, not calculated-by-copying-production values.

### `tests/quiz-materializer.test.ts` (new)

- **Current state:** no executable materialize tests exist.
- **Required edit:** against isolated migrated D1 with a fake `BankContract`, test dedup/idempotent
  re-invocation, exact draw/unit/duration derivation, every occurrence crash/retry boundary
  mirroring Sprint 3's lock tests, pool-exhaustion/incomplete-policy isolation from sibling
  occurrences, their exact two failure-code mappings, and the complete `{quizIds, failures}` return
  contract with no unsafe fields.
- **Estimated diff:** ~100 LOC.
- **Subtleties:** force failures at each step for one occurrence while asserting siblings in the
  same call still succeed.

### `tests/quiz-boards.test.ts` (new)

- **Current state:** no executable weekly-aggregation tests exist.
- **Required edit:** test readiness with open/cancelled/draft in-week quizzes, aggregation
  correctness per type and overall, dense ties, zero-participation exclusion, idempotent
  republish/overwrite, the exact fixed-order `BoardSummary[]` shape, and the not-ready `[]` case.
- **Estimated diff:** ~90 LOC.
- **Subtleties:** assert raw `weekly_boards` rows after every case, not just the returned DTO.

### `tests/boards.routes.test.ts` (new)

- **Current state:** the route exists only as a stub and in contract types.
- **Required edit:** exercise the mounted route for auth, validation, pagination boundaries, and
  the resolved default behavior (omitted `type` → `'overall'`, omitted `weekStart` → the most
  recently published week, never-published → empty `PageResponse`, `API.md:232-238`).
- **Estimated diff:** ~50 LOC.

### `tests/scheduler-materialize-weekly.test.ts` (new)

- **Current state:** no tests exist for either new pass; `tests/scheduler-weekly.test.ts` from
  Sprint 6 currently asserts the weekly pass is *not* bound into production.
- **Required edit:** test the materialize pass's production binding and per-occurrence isolation,
  exact forwarding of every safe failure to the existing alert sender, independent Telegram/email
  outcomes, repeated alerts on a later hourly retry, isolation from sibling failures/occurrences and
  weekly work, the weekly-retry sweep's bounded lookback and per-candidate isolation, and — replacing
  Sprint 6's not-bound assertion — that the Monday cron and hourly cron now correctly dispatch to
  their real passes.
- **Estimated diff:** ~90 LOC.
- **Subtleties:** update (do not silently leave contradictory) Sprint 6's now-superseded
  not-bound assertion for the weekly pass; keep its Announce/Close/Prepare pass assertions intact.

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Implementation parses a wider RRULE surface than the resolved subset (e.g. honors `COUNT`/`UNTIL`), drifting from `SCHEDULER.md:107-118` and silently accepting seeded templates it shouldn't | Med | High | AC-2's explicit parse-only-`FREQ=WEEKLY`/`BYDAY`/`BYHOUR`/`BYMINUTE` requirement and rejection tests in `tests/schedule.test.ts`. |
| A malformed/adversarial `rrule` produces unbounded occurrence output and hangs the hourly tick | Low | High | AC-2's bounded-expansion requirement and defensive rejection; `vibesec` pre-flight. |
| One occurrence's failure blocks or corrupts sibling occurrences in the same materialize pass | Med | High | AC-6 isolation and forced-failure tests in `tests/quiz-materializer.test.ts`. |
| Materialization duplicates Sprint 3's claim/publish logic, drifting from admin-lock behavior over time | Med | Med | AC-5's explicit reuse requirement and the Hard NO against a second implementation. |
| Weekly board publishes before a late-Sunday quiz's final batch settles | Med | High | AC-8's strict readiness predicate and boundary-instant tests. |
| Weekly ranking silently reverts to average score because of the stale `src/db/boards.ts` comment | Low | High | §1/§8a explicitly flag and forbid it; AC-9/AC-10 specify total score and single-key dense rank. |
| An unpublished weekly board ages beyond the eight-week automatic retry window | Low | Med | Accepted V1 operational limitation because the quiz season ends in the third week of November; AC-14 tests the exact bound and never claims indefinite recovery. Manual forward recovery remains possible. |
| Weekly republish appends duplicate/stale rows instead of cleanly overwriting a prior computation | Med | High | AC-11's upsert-replaces-by-PK requirement and idempotent-republish tests. |
| Implementation silently changes the ratified `GET /api/boards/weekly` default (e.g. defaults `weekStart` to the calendar week containing `now` instead of `MAX(week_start)`) | Med | Med | AC-15's explicit default rule and `tests/boards.routes.test.ts`'s default-behavior cases (`API.md:232-238`). |
| A materialization failure is dropped, mapped to the wrong safe code, or leaks unsafe detail | Med | High | AC-6/AC-7 exact allowlisted DTO mapping plus materializer tests for both failure codes and forbidden fields. |
| One private alert channel fails and suppresses the other or blocks healthy scheduler work | Med | High | AC-14 requires independent per-failure/per-channel attempts; scheduler tests and BE-4/OP-2 force each channel failure separately. |
| Sprint 6's weekly pass function is rewritten instead of reused, diverging from its own tests | Low | Med | §1/§4/AC-13 explicit reuse requirement; `tests/scheduler-materialize-weekly.test.ts` asserts the same function is called. |
| Test isolation leaves published `weekly_boards`/materialized `quizzes` rows between cases | Med | Med | Fresh migrated D1 fixtures per test, per the pattern in prior sprints' test suites. |

## 11. Rollback / Revert Plan

1. Stop new materialization and weekly-publish cron work by reverting the deploy or disabling the
   two newly-dispatched cron branches at the edge; the already-shipped minute tick (prepare,
   announce, close, alerts) must keep running unaffected.
2. Record only opaque template/quiz IDs, `weekStart` values, statuses, and counts. Never export
   question content, solutions, student names, or session data into an incident record.
3. Any `quizzes` row already materialized to `scheduled` (or further) is real, retired content and
   is never deleted or un-retired — the same one-way retirement rule Sprint 3 established applies
   identically to materialized occurrences (`todos/sprint 3/claude-task--001--quiz-creation-units-lock.md:213-219`).
4. Any `weekly_boards` rows already published are real published rankings; do not delete them. If a
   computation is later found incorrect, a reviewed forward fix re-runs `computeWeeklyBoards` for
   that exact `weekStart` to overwrite by primary key (AC-11), never a manual row edit.
5. Run `git revert <sha>` for this packet's implementation and redeploy the prior Worker build;
   confirm the reverted build no longer dispatches the hourly/weekly cron branches to the new
   passes and that `GET /api/boards/weekly` reverts to its pre-Sprint-7 (stub) behavior.
6. Keep `migrations/0001_init.sql` and all existing rows; this packet adds no migration and deletes
   no data.
7. Verify via read-only D1 queries that no partially-materialized occurrence (a draft/claim with no
   published `scheduled` row) was left behind by the rollback itself, and that Sprint 1–6 focused
   and full test suites still pass.
8. Notify the project owner through the configured private channels with affected opaque
   template/quiz/week identifiers, rollback time, and whether any weekly Telegram post or
   materialized quiz was already visible to students before rollback (both are one-way once
   delivered/retired, the same acknowledgement Sprint 6 already recorded for Telegram sends).
9. After stability, re-enable the two cron branches only after confirming the fix in staging
   against seeded, non-production template fixtures (AC-OPERATOR), never directly against
   production templates.

## 12. Verification + Definition of Done

### 12a. Automated verification

```bash
npm ci
npm run typecheck
npm test -- tests/schedule.test.ts
npm test -- tests/quiz-materializer.test.ts
npm test -- tests/quiz-boards.test.ts
npm test -- tests/boards.routes.test.ts
npm test -- tests/scheduler-materialize-weekly.test.ts
npm test

git diff --exit-code -- migrations/0001_init.sql src/core/contracts.ts src/core/api.ts wrangler.toml
git diff --exit-code -- PRD.md PLAN.md MODULES.md DATA_MODEL.md CONTRACTS.md API.md QUIZZING.md SCHEDULER.md TELEGRAM.md
git diff --exit-code -- src/core/telegram-render.ts src/db/telegram.ts src/services/telegram.ts src/services/observability.ts
git diff --exit-code -- src/routes/auth.ts src/routes/admins.ts src/routes/bank.ts src/routes/images.ts src/routes/play.ts src/routes/results.ts src/routes/reports.ts
git diff --exit-code -- "todos/sprint 1" "todos/sprint 2" "todos/sprint 3" "todos/sprint 4" "todos/sprint 5" "todos/sprint 6" "todos/sprint 8" todos/PROGRESS.md

! rg -n "avg\(|AVG\(|average" src/db/boards.ts src/services/quiz-boards.ts
! rg -n "from ['\"].*(services/telegram|db/telegram|core/telegram-render)" src/services/quiz-materializer.ts src/services/quiz-boards.ts
rg -n "materializeTemplates|computeWeeklyBoards" src/services/scheduler.ts src/index.ts
rg -n "failures|TELEGRAM_ALERT_CHAT_ID|ALERT_EMAIL" src/services/scheduler.ts src/index.ts
```

All commands must succeed. The `git diff --exit-code` and `!`-prefixed `rg` lines must find no
match; the final positive `rg` line must find matches in both files, confirming both new contract
methods are actually production-bound, not merely implemented and left unconsumed.

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | IST week boundary math | Compute bounds for a week crossing a year boundary and for `now` values just before/at/after Monday 00:30 IST. | Bounds are exact Monday-to-Monday IST, no DST drift, no off-by-one at the boundary. | Not Run |
| BE-2 | Occurrence expansion (resolved grammar) | Expand a seeded template's `rrule` (`FREQ=WEEKLY;BYDAY=<day list>;BYHOUR=<H>;BYMINUTE=<MM>`) over 7 days, including a malformed rule and one with an unsupported `FREQ`/`COUNT`/`UNTIL`. | Correct timestamps in range; malformed or out-of-grammar rules reject safely with no hang/unbounded output. | Not Run |
| BE-3 | Materialize dedup and crash recovery | Run materialize twice over the same window; force a crash before/after BANK claim/publication for one occurrence. | Second run creates nothing new for already-materialized slots; crash boundaries leave no partial content, recoverable on retry. | Not Run |
| BE-4 | Occurrence isolation and safe result | Seed pool exhaustion and missing timing configuration alongside healthy occurrences in one window. | Healthy occurrences materialize; each failure is absent from `quizIds` and appears once in `failures` with its exact safe code and three fields only. | Not Run |
| BE-5 | Weekly readiness | Seed a week with an `open` quiz, then a `cancelled` quiz, then a `draft` quiz, then only `ended` quizzes. | Only the `open` case blocks publication; cancelled/draft never block; the all-`ended` case publishes. | Not Run |
| BE-6 | Weekly aggregation and dense ties | Seed varied per-type/overall scores including exact ties and a zero-quiz user. | Totals/`quizzesTaken` are exact; ties share one dense rank; the zero-quiz user never appears. | Not Run |
| BE-7 | Idempotent republish | Publish a week, mutate underlying data, republish. | `weekly_boards` rows for that `(weekStart,type)` are cleanly replaced, not duplicated or stale. | Not Run |
| BE-8 | `BoardSummary[]` shape | Call `computeWeeklyBoards` before and after readiness. | Not-ready returns `[]`; ready returns exactly 4 fixed-order entries, empty `top10` valid. | Not Run |
| BE-9 | Weekly board route | Query with valid/invalid `type`, valid/invalid `weekStart`, pagination boundaries, and omitted params. | 400s are exact; omitted `type` defaults to `'overall'` and omitted `weekStart` defaults to `MAX(week_start)` in `weekly_boards`; no 404 path exists. | Not Run |
| BE-10 | Cron dispatch and reuse | Trigger both new cron branches; inspect that the same Sprint 6 pass function handles both the Monday call and each sweep candidate. | Materialize and both weekly call sites run correctly; no second/duplicate `claimAndSend` loop implementation exists. | Not Run |
| BE-11 | Materialization dual alerts | Return multiple safe materialization failures; break Telegram, then Email Routing, and rerun the hourly pass. | Every failure independently attempts both private channels; one channel/failure does not block another, healthy occurrences, weekly work, or later passes; a retry may alert again. | Not Run |

#### Frontend / UI

N/A — this is a backend-only packet; no `web/`, mockup, or design-system file is touched. If any
frontend or visual file enters the diff, fail the implementation and add UI cases first.

#### Chrome DevTools / extension verification

N/A — no browser client is implemented or exercised by this packet. If a browser surface is added,
fail the implementation and add Network/Console cases.

#### Operator-executed (post-cutover, see AC-OPERATOR)

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| OP-1 | Staging materialize run | Seed a non-production template, run the hourly pass with a controlled `now`. | Correct occurrences appear as fully scheduled quizzes with retired content and derived duration. | Not Run |
| OP-2 | Forced occurrence failure | Exhaust one template's pool and remove timing for another alongside a healthy occurrence; rerun, then disable each alert channel separately. | Failed occurrences return the exact safe codes; both private channels receive each alert when healthy, either remaining channel still receives it alone, healthy materialization and weekly work continue, and a later retry may alert again. | Not Run |
| OP-3 | Weekly publish timing | Run the weekly pass before and after all in-week quizzes reach `ended`. | No premature publish; publish occurs once ready; the reused Sprint 6 pass sends exactly one Telegram post. | Not Run |
| OP-4 | Weekly board route | Page `GET /api/boards/weekly` with and without query params. | Results match the resolved defaults (`type` → `'overall'`, `weekStart` → most recently published week) and pagination behavior. | Not Run |

### 12c. Definition of Done

- [ ] AC-1 through AC-17 are satisfied.
- [ ] AC-OPERATOR is completed or explicitly waived and recorded in §5.
- [ ] No `<INPUT_REQUIRED>` remains; §5's two resolved items (rrule grammar, weekly-board defaults)
      are correctly baked into AC-2, AC-3, AC-15, AC-17 and their implementation.
- [ ] §12a passes locally and in CI; focused RED failures were observed before production
      implementation.
- [ ] BE-1 through BE-11 have Status other than `Not Run` (target: `Pass`).
- [ ] Frontend and Chrome remain correctly N/A, with no frontend/visual diff.
- [ ] OP-1 through OP-4 are completed or explicitly waived and recorded in §5.
- [ ] Weekly ranking is total score, single-key dense rank, never average and never a secondary
      tie-break.
- [ ] `computeWeeklyBoards` never publishes while any non-cancelled scheduled/open quiz remains in
      that IST week.
- [ ] `materializeTemplates` reuses Sprint 3's selector and claim/publish primitives with no second
      implementation, returns the exact safe `{quizIds, failures}` contract, and isolates every
      occurrence-level failure.
- [ ] SCHEDULER independently attempts both existing private alert channels for every returned
      materialization failure; one channel/failure never blocks another, sibling occurrences,
      weekly work, or later passes, and repeated hourly retry alerts remain allowed.
- [ ] The weekly retry sweep is exactly eight weeks; the accepted November-season limitation is
      documented without adding backlog discovery or promising recovery after a week ages out.
- [ ] Sprint 6's weekly send pass is reused unchanged in shape (or minimally extended) for both the
      Monday trigger and the hourly retry sweep — never reimplemented.
- [ ] Both new cron branches are actually dispatched in `src/index.ts`, confirmed by the positive
      `rg` check in §12a.
- [ ] §8a Hard NO list and all protected-file/boundary-scan checks are satisfied.
- [ ] §11 rollback was rehearsed mentally for both already-materialized occurrences and already-
      published weekly boards.

---

End of Codex Task Packet — `claude-task--001`
