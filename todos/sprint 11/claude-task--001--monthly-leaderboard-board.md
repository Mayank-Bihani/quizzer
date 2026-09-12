# claude-task--001: Add a monthly leaderboard board alongside the existing weekly boards

**Sprint:** 11  **Slug:** `monthly-leaderboard-board`  **Status:** Draft

> New sprint folder: this is new backend + frontend scope, not part of Sprint 10 (manual question
> selection, `done`). Every prior sprint folder holds exactly one packet mapped to one row in
> `todos/PROGRESS.md`; this packet should be added as its own row once accepted, per that same
> convention. This preamble is informational only — updating `PROGRESS.md` happens after
> implementation, not as part of this spec-writing step.

---

## 1. Context

Today the system publishes and posts a **weekly** leaderboard only, per section type plus a
combined "overall" board. The full pipeline:

- `src/db/boards.ts` (83 lines) — `aggregateWeeklyScores(db, startMs, endMs, type)` is already
  date-range generic (it just sums `participants.total_score` between two epoch-ms bounds, grouped
  by user, filtered by `quiz.type` unless `type === "overall"`); `publishWeeklyBoards` deletes+
  reinserts a `(week_start, type)` row set idempotently; `getWeeklyBoardPage`/
  `getMostRecentlyPublishedWeekStart` serve reads.
- `src/core/leaderboard.ts:58-73` — `assignWeeklyDenseRanks` (score DESC, dense rank, no secondary
  tie-break — `quizzesTaken` is display context only).
- `src/core/schedule.ts:13-47` — `weekBoundsForWeekStart`, `mostRecentlyElapsedWeekStart`,
  `weekStartOffsetBy`: all IST-anchored (`IST_OFFSET_MS = 5.5h`, fixed, no DST) via the
  shift-then-read-UTC-getters trick at lines 13-18.
- `src/services/quiz-boards.ts` (64 lines) — `computeWeeklyBoards` (readiness check via
  `isWeekReady`, aggregate all 4 `BOARD_TYPES` at line 12, rank, publish, warm KV cache, return
  `BoardSummary[]`) and `getWeeklyBoard` (cache-or-D1 read behind `GET /api/boards/weekly`).
- `src/routes/boards.ts` (49 lines) — the one `GET /weekly` route, `requireAuth`-gated, validates
  `type`/`weekStart`/pagination query params.
- `src/db/telegram.ts:67-80` — `sendWeekly` sends **4 separate** Telegram messages (one per
  `WEEKLY_SECTION_ORDER` type — line 30), storing all 4 `message_id`s as one JSON blob in
  `telegram_posts.message_id`; `claimAndSend` (line 82) branches to it at line 102 when
  `kind === "weekly"`.
- `src/core/telegram-render.ts:93-116` — `renderWeeklyBoards`/`renderWeeklySection` render each
  section's text ("📊 Weekly Board — Verbal", "Week of 2026-08-31", top-10 rows or "Nobody ranked
  this section this week.").
- `src/services/scheduler.ts:177-209` — `runWeeklyPass` (compute → `claimAndSend("weekly", ...)`,
  no-op if the week isn't ready) and `runWeeklyRetrySweep` (loops `WEEKLY_RETRY_LOOKBACK_WEEKS`
  weeks back via `weekStartOffsetBy`, each isolated, reusing `runWeeklyPass` — never a second
  `claimAndSend` loop).
- `src/index.ts:105-141` — `WEEKLY_CRON = "0 19 * * SUN"` (00:30 IST Monday, deliberately after the
  IST week ends) fires `runWeeklyPass` once; the **same hourly tick** that runs
  `runMaterializePass` also runs `runWeeklyRetrySweep` (line 133) as a safety net for a missed
  Monday attempt.
- `src/core/config.ts:113` — `WEEKLY_RETRY_LOOKBACK_WEEKS = 8`, an explicit V1 operational bound
  ("the quiz season ends in the third week of November").
- `migrations/0001_init.sql:308-339` — `weekly_boards` (PK `(week_start, type, user_id)`, never
  purged — each week's rows are permanent, a republish only replaces *that* week) and
  `telegram_posts` (PK-less, `UNIQUE(quiz_id, kind)` / `UNIQUE(week_start, kind)`, `kind` CHECK
  currently `('announce','soon','open','result','weekly','cancelled')`).
- `src/services/cache.ts:122-165` — `getCachedWeeklyBoard`/`putCachedWeeklyBoard` key on
  `board:${weekStart}` (line 122-124). **This exact prefix is also used for the unrelated
  per-quiz leaderboard cache** (`boardCacheKey`, line 80-82: `board:${quizId}`) — the file's own
  header comment (line 1) documents the shared `board:<quizId|weekStart>` keyspace as deliberate,
  relying on a UUID never looking like a `YYYY-MM-DD` date. **A month-start date is also
  `YYYY-MM-DD`-shaped and would collide with this exact keyspace if given the same prefix** — see
  §8a and §9.
- Frontend: `web/src/features/student/StudentPages.tsx:380-487` — `WeeklyBoardPage`, the only
  consumer. Type tabs (Overall/Verbal/Quant/LR) via a `.seg board-tabs` segmented control
  (lines 420-433) driving a `type` URL search param; `weekStart`/`offset` are also URL search
  params (lines 388-403); `api.weeklyBoard()` (`web/src/api/client.ts:243-244`) is the only fetch.
  Routed at `web/src/App.tsx:94` (`path="boards/weekly"`), linked from both `StudentTopNav` and
  `StudentBottomNav` (`web/src/components/ui.tsx:162-178`, `180-210`) as a single "Leaderboards" /
  "Boards" entry — the mobile bottom nav has exactly 4 slots (Home/History/Boards/Profile) today.

**Resolved product decisions from the pre-spec interview** (recorded here so they aren't
re-litigated):

1. **Navigation**: no new nav item, no new top-level route. The existing single "Boards" nav entry
   keeps pointing at the same screen; a **Weekly / Monthly period toggle** is added *inside*
   `WeeklyBoardPage`, next to the existing type tabs. This keeps the mobile bottom nav at 4 items.
2. **Telegram post shape**: monthly follows the **exact same 4-separate-messages pattern** as
   weekly (one per `verbal`/`quant`/`lr`/`overall`), not a single combined message. Chosen for
   visual/formatting consistency with the existing weekly posts, even though it was weekly's
   4-message pattern that produced the message-volume issue investigated earlier this project — a
   monthly cadence multiplies that 4x far less often (12 times/year vs. weekly's ~52), so the
   volume concern does not carry over the same way.
3. **No new cron trigger.** Cloudflare cron has no native "last day of month" expression. Monthly
   publishing piggybacks entirely on the **existing hourly tick** (`src/index.ts:122-135`), the
   same mechanism `runWeeklyRetrySweep` already uses as a safety net — there is no monthly
   equivalent of `WEEKLY_CRON`'s dedicated primary trigger. This means a monthly post can land
   anywhere within the hour after the month ends, not at a precise instant — an accepted,
   documented tradeoff (§3), not an oversight.

## 2. Objective

After this ships: every calendar month (IST), the system independently aggregates, ranks, and
publishes a monthly leaderboard for each of Verbal/Quant/LR/Overall — reusing the same
sum-of-total-score, dense-rank rules the weekly board already uses — persists every past month's
results permanently (never overwritten, mirroring weekly), posts 4 Telegram messages to the
student group once per elapsed month (with hourly-tick retry coverage for a missed attempt), and
exposes a `GET /api/boards/monthly` read route. Students can switch between "Weekly" and "Monthly"
inside the existing leaderboards screen and see the equivalent monthly data, without any new nav
entry or route.

## 3. Assumptions

- The system is still pre-launch but a real, deployed D1 database exists with real content
  (mirrors Sprint 10's own assumption, `todos/sprint 10/claude-task--001-...md:92-97`) — this
  migration must be written and verified as a real schema change, not a "wipe and recreate."
- `wrangler d1 migrations apply` tracks applied migrations by filename, so this adds a **new**
  migration file (`migrations/0003_monthly_boards.sql`) rather than editing `0001`/`0002` in place.
- SQLite/D1 cannot `ALTER TABLE ... ADD CONSTRAINT` or modify an existing `CHECK` — widening
  `telegram_posts.kind`'s CHECK requires the standard recreate-table procedure (create new table,
  copy rows, drop old, rename). **This exact procedure has not been run against this project's D1
  before in this codebase** (no prior migration does a table recreate) — verify it actually applies
  cleanly via `wrangler d1 migrations apply quizzer-db --local` before considering this packet
  done (see §7 AC-2, §10).
- A monthly post lands within the hour after month-end (see §1, resolved decision 3) — this is a
  product-accepted latency, not a bug to fix by inventing a client-side month-end cron trigger.
- `MONTHLY_RETRY_LOOKBACK_MONTHS` (new constant, mirroring `WEEKLY_RETRY_LOOKBACK_WEEKS = 8`) is
  set to **3** — covers a missed month plus buffer without scanning arbitrarily far back. This is
  an implementation-bound default, not a product requirement; flag to the project owner if a
  different value is wanted (mirrors how `WEEKLY_RETRY_LOOKBACK_WEEKS`'s value was itself an
  accepted V1 limitation, `src/core/config.ts:110-113`).
- `web/src/features/student/StudentPages.tsx` currently has no test file (`web/src/features/student/`
  only has `disclosure.test.tsx` and `run-state.test.ts` — neither covers this file). This packet
  introduces the first one for it.

## 4. Out of Scope

- **Editing `src/db/boards.ts` or `src/services/quiz-boards.ts`** — the weekly pipeline is reused
  by calling its exported, already-generic functions (`aggregateWeeklyScores`,
  `assignWeeklyDenseRanks`) from new parallel files, never by modifying these files in place.
- **Editing `migrations/0001_init.sql` or `migrations/0002_manual_selection_mode.sql`** — a new
  migration file only, per established convention.
- **Adding a dedicated monthly cron trigger** — resolved in §1; cron has no last-day-of-month
  primitive, and the hourly-tick sweep pattern is the accepted mechanism.
- **A combined single Telegram message for monthly** — resolved in §1 to mirror weekly's
  4-message pattern instead.
- **A new bottom/top nav item for monthly boards** — resolved in §1; it's a toggle inside the
  existing screen.
- **Renaming `WeeklyBoardPage`, its route (`boards/weekly`), or the nav label ("Boards"/
  "Leaderboards")** — the component now also renders monthly data internally, but its exported
  name, file location, and route path are unchanged. Do not "clean this up" as an unplanned
  rename — every existing bookmark/link to `/boards/weekly` must keep working unchanged, and it
  remains the default (weekly) view.
- **Admin-side changes** — no `web/src/features/admin/**` file is touched; this is a student-facing
  read surface only, same as weekly boards today.
- **Editing `src/services/templates.ts`, `src/services/quiz-materializer.ts`, or
  `src/core/selection.ts`** — unrelated systems; not touched by this packet.
- **Retroactively backfilling monthly boards for months that already elapsed before this ships** —
  out of scope; the first monthly board computed is whatever `mostRecentlyElapsedMonthStart(now)`
  resolves to at deploy time, same as how weekly boards were never backfilled at Sprint 7 launch.

## 5. Open Questions / `<INPUT_REQUIRED>`

`(none)` — the three decisions that would otherwise be open (`<INPUT_REQUIRED>`) were resolved in
the pre-spec interview and are recorded in §1. `MONTHLY_RETRY_LOOKBACK_MONTHS`'s exact value (§3)
is a low-stakes implementation default, not a blocking question — flagged for the project owner to
override post-hoc if desired, same treatment `WEEKLY_RETRY_LOOKBACK_WEEKS` itself got.

## 6. Pre-flight Checklist

- [x] Required skill loaded: **`clean-code`** — Always.
- [x] Required skill loaded: **`prod-safety-gate`** — this touches a production cron path
      (`src/index.ts`'s hourly tick), a live migration against a real (if pre-launch) D1 database,
      and posting to the real, already-incident-prone student Telegram group.
- [x] Required skill loaded: **`test-driven-development`** — every new function is a behavior
      change with ACs defining its tests; write the test before the implementation per AC.
- [x] **`vibesec` not required** — no new auth/token/PII/external-input surface: `GET
      /api/boards/monthly` reuses the existing `requireAuth` middleware unchanged
      (`src/routes/boards.ts:27`), and its one new query param (`monthStart`) is validated by a
      fixed regex exactly like the existing `weekStart` param is today.
- [ ] Working tree clean; branch up to date with `master` — not strictly true at start: an
      unrelated in-flight feature (`GET /api/quizzes/upcoming`) had uncommitted changes touching
      some of the same files (`src/core/api.ts`, `src/core/config.ts`, `web/src/api/client.ts`,
      `web/src/features/student/StudentPages.tsx`); it was left untouched and was committed
      separately (by another session) partway through as `1c7fd62`, with no conflict with this
      packet's own edits.
- [x] Read before editing: `src/db/boards.ts` (whole file, 83 lines — to mirror, not edit),
      `src/services/quiz-boards.ts` (whole file, 64 lines — to mirror, not edit),
      `src/core/schedule.ts` (whole file, 98 lines), `src/core/leaderboard.ts:52-73`,
      `src/core/telegram-render.ts:1-116`, `src/db/telegram.ts` (whole file, 123 lines),
      `src/services/scheduler.ts:173-209`, `src/index.ts:1-150` (imports + `scheduled`),
      `src/core/config.ts:105-113`, `src/core/contracts.ts:127-193`, `src/core/api.ts:476-483`,
      `src/routes/boards.ts` (whole file, 49 lines), `src/services/cache.ts` (whole file, 166
      lines), `web/src/features/student/StudentPages.tsx:380-487`, `web/src/api/client.ts:243-244`,
      `web/src/components/ui.tsx:98-` (`Pagination`), `web/src/lib/format.ts:3-` (`quizTypeLabels`),
      `web/src/features/admin/TemplatesPanel.test.tsx` (the API-mocking pattern to mirror for the
      new FE test).
- [x] Re-read every AC below before starting; note which are `AC-OPERATOR`.

## 7. Acceptance Criteria

**Schema**

- **AC-1**: `migrations/0003_monthly_boards.sql` creates `monthly_boards` with columns
  `month_start TEXT NOT NULL`, `type TEXT NOT NULL CHECK (type IN ('verbal','quant','lr','overall'))`,
  `user_id TEXT NOT NULL REFERENCES users(id)`, `quizzes_taken INTEGER NOT NULL`,
  `total_score REAL NOT NULL`, `rank INTEGER NOT NULL`, `PRIMARY KEY (month_start, type, user_id)`
  — field-for-field identical to `weekly_boards` (`migrations/0001_init.sql:308-316`) with
  `week_start` renamed to `month_start`.
- **AC-2**: the same migration widens `telegram_posts.kind`'s CHECK to add `'monthly'` via the
  standard SQLite recreate-table procedure, preserving `UNIQUE(quiz_id, kind)`,
  `UNIQUE(week_start, kind)`, the `week_start`/`status`/`message_id`/`error`/`claimed_at`/`sent_at`
  columns and their existing constraints exactly. Verified by running
  `npx wrangler d1 migrations apply quizzer-db --local` against a copy of the current local DB
  state and confirming: (a) it applies with no error, (b) every pre-existing `telegram_posts` row
  is preserved (`SELECT COUNT(*) FROM telegram_posts` unchanged before/after), (c) inserting a row
  with `kind='monthly'` now succeeds, (d) inserting a row with an invalid kind (e.g. `'bogus'`)
  still fails the CHECK.

**Date math (`src/core/schedule.ts`, new exports)**

- **AC-3**: `monthBoundsForMonthStart(monthStart: string): { startMs, endMs }` — given a `"YYYY-MM-01"`
  IST calendar-month start, returns the inclusive-start/exclusive-end epoch-ms bounds of that
  month, IST wall-clock, mirroring `weekBoundsForWeekStart` (`src/core/schedule.ts:30-34`) exactly
  in style (shift-by-`IST_OFFSET_MS`, read UTC getters). Test at minimum: `"2026-09-01"` →
  `endMs - startMs` spans exactly 30 days; `"2026-12-01"` → `endMs` lands on `"2027-01-01"` IST
  (year rollover); `"2028-02-01"` → the month spans 29 days (leap year).
- **AC-4**: `mostRecentlyElapsedMonthStart(nowMs: number): string` — the `month_start` of the most
  recently *fully elapsed* IST calendar month (never the month containing `now`), mirroring
  `mostRecentlyElapsedWeekStart` (`src/core/schedule.ts:38-41`). Test: `now` = any instant in
  September 2026 IST → returns `"2026-08-01"`; `now` = any instant in January 2027 IST → returns
  `"2026-12-01"` (year rollover).
- **AC-5**: `monthStartOffsetBy(monthStart: string, monthsBack: number): string` — the same month
  anchor `monthsBack` whole calendar months earlier, mirroring `weekStartOffsetBy`
  (`src/core/schedule.ts:44-47`). Test: `("2026-09-01", 3)` → `"2026-06-01"`; `("2026-02-01", 1)` →
  `"2026-01-01"`.

**Aggregation + ranking (new file, `src/db/monthly-boards.ts`)**

- **AC-6**: exports `isMonthReady`, `publishMonthlyBoards`, `getMostRecentlyPublishedMonthStart`,
  `getMonthlyBoardPage` — each identical in shape and behavior to its `src/db/boards.ts` sibling
  (`isWeekReady`, `publishWeeklyBoards`, `getMostRecentlyPublishedWeekStart`,
  `getWeeklyBoardPage`), reading/writing `monthly_boards` instead of `weekly_boards`. **Reuses
  `aggregateWeeklyScores` from `src/db/boards.ts` unmodified** (it is already generic over
  `startMs`/`endMs`/`type` — do not copy or rename it) and **reuses `assignWeeklyDenseRanks` from
  `src/core/leaderboard.ts` unmodified** (it is already generic over any `WeeklyRankable[]`).
- **AC-7**: a republish of an already-published month cleanly replaces only that month's
  `(month_start, type)` rows (mirrors `publishWeeklyBoards`'s delete-then-insert-in-one-batch
  pattern, `src/db/boards.ts:37-50`) — never appends duplicates, never touches other months.

**Service layer (new file, `src/services/monthly-boards.ts`)**

- **AC-8**: `computeMonthlyBoards(deps, monthStart): Promise<BoardSummary[]>` mirrors
  `computeWeeklyBoards` (`src/services/quiz-boards.ts:15-37`) exactly: `[]` if the month isn't
  ready (any `scheduled`/`open` quiz still inside the month's bounds), else aggregates all 4
  `BOARD_TYPES`, ranks, publishes, warms cache, returns `BoardSummary[]` (reusing the existing
  `BoardSummary` type as-is — `weekStart` holds the month's ISO start date for this call site; see
  §9's note on why no new type is introduced).
- **AC-9**: `getMonthlyBoard(deps, query): Promise<...>` mirrors `getWeeklyBoard`
  (`src/services/quiz-boards.ts:44-63`) exactly, including its cache-then-D1-fallback logic and the
  `top10.length < 10` trustworthiness check (line 56).

**Cache (`src/services/cache.ts`, additive)**

- **AC-10**: new `getCachedMonthlyBoard`/`putCachedMonthlyBoard` use a KV key prefix **distinct
  from** `board:` — e.g. `monthboard:${monthStart}` — never `board:${monthStart}`. This is
  required, not stylistic: `board:${weekStart}` (line 122-124) and `board:${quizId}` (line 80-82)
  already share one prefix relying on a UUID never looking like a date; a month-start date
  (`"YYYY-MM-DD"`) is exactly the same shape as a week-start date and **would silently collide**
  with an existing weekly cache entry for the same calendar date if given the same prefix. Test:
  publish a weekly board for week-start `"2026-09-07"` and (separately) a monthly board whose
  `month_start` also happens to be `"2026-09-07"`-shaped in the same format family, and assert
  both cache entries read back independently correct (i.e. the monthly write never overwrites or
  is overwritten by the weekly one).

**Telegram (`src/db/telegram.ts`, `src/core/telegram-render.ts`, `src/core/contracts.ts`, additive)**

- **AC-11**: `TelegramPostKind` (`src/core/contracts.ts:162`) gains `'monthly'` — the only change
  to this file.
- **AC-12**: `renderMonthlyBoards`/`renderMonthlySection` (new, `src/core/telegram-render.ts`)
  mirror `renderWeeklyBoards`/`renderWeeklySection` (lines 93-116) exactly, with month-appropriate
  copy (e.g. "📊 Monthly Board — Verbal" / "Month of September 2026" using the file's existing
  `MONTH_NAMES` array, line 22, instead of "Week of 2026-08-31"), including the "Nobody ranked
  this section this month." empty-state text.
- **AC-13**: `sendMonthly` (new, `src/db/telegram.ts`) mirrors `sendWeekly` (lines 67-80) exactly:
  sends 4 separate messages via `bot.sendMessage`, stores all 4 message IDs as one JSON blob in
  `telegram_posts.message_id` (same shape `sendWeekly` already produces), marks the row `'failed'`
  and stops on the first section's send failure (never partial-success silently treated as sent).
  `claimAndSend`'s branch at `src/db/telegram.ts:102` (`if (kind === "weekly")`) is extended to
  also dispatch `kind === "monthly"` to `sendMonthly`, reusing the same `claimRow`/`markSent`/
  `markFailed` functions unmodified (they already operate generically on `(quizId, weekStart,
  kind)` — the `weekStart` column holds the month-start date for these rows, per AC-2's note).

**Scheduling (`src/services/scheduler.ts`, `src/index.ts`, additive)**

- **AC-14**: `runMonthlyPass`/`runMonthlyRetrySweep` (new, `src/services/scheduler.ts`) mirror
  `runWeeklyPass`/`runWeeklyRetrySweep` (lines 177-209) exactly, parameterized by
  `computeMonthlyBoards`/`monthStartOffsetBy`/`MONTHLY_RETRY_LOOKBACK_MONTHS` instead of their
  weekly equivalents.
- **AC-15**: `src/index.ts`'s `HOURLY_CRON` branch (lines 122-135) gains one additional call —
  `runMonthlyRetrySweep((monthStart) => computeMonthlyBoards({db, kv}, monthStart),
  mostRecentlyElapsedMonthStart(now), telegram)` — immediately after the existing
  `runWeeklyRetrySweep` call (line 133), using the same `telegram` contract instance already
  constructed at line 120. **No change to `WEEKLY_CRON`, `MINUTE_TICK_CRON`, or the
  `[triggers] crons` list in `wrangler.toml`** (§4, §8a).

**HTTP + DTOs (`src/routes/boards.ts`, `src/core/api.ts`, additive)**

- **AC-16**: `src/core/api.ts` gains `MonthlyBoardRequest = PageRequest & { monthStart?: string;
  type?: QuizType | 'overall' }` and `MonthlyBoardResponse = PageResponse<WeeklyBoardRow> & {
  monthStart: string; type: QuizType | 'overall' }` — reusing the existing `WeeklyBoardRow` row
  shape unmodified (rank/userId/name/totalScore/quizzesTaken is identical for a monthly row; no
  new row type).
- **AC-17**: `src/routes/boards.ts` gains `boards.get("/monthly", ...)` mirroring the existing
  `GET /weekly` handler (lines 29-48) field-for-field: same pagination validation, a
  `MONTH_START_PATTERN` mirroring `WEEK_START_PATTERN` (line 14) validating `"YYYY-MM-DD"`, same
  400 responses for invalid `type`/`monthStart`/pagination.

**Frontend**

- **AC-18**: `web/src/api/client.ts` gains `monthlyBoard: (query: MonthlyBoardRequest = {}) =>
  get<MonthlyBoardResponse>(withQuery("/api/boards/monthly", query))`, mirroring
  `weeklyBoard` (lines 243-244) exactly.
- **AC-19**: `WeeklyBoardPage` (`web/src/features/student/StudentPages.tsx:387-487`) gains a
  Weekly/Monthly period toggle (reusing the existing `.seg` segmented-control pattern already used
  for the type tabs, lines 420-433) driven by a new `period` URL search param (`"weekly"` default,
  `"monthly"` the other value) — **separate** from the existing `type`/`offset` params, which are
  shared across both periods. When `period=monthly`, the page calls `api.monthlyBoard()` instead of
  `api.weeklyBoard()`, uses a **separate** `monthStart` URL search param (never reusing/aliasing
  `weekStart`'s value — switching periods must not leak a full ISO week-date into a month-shaped
  field or vice versa), and the date picker becomes a native `<input type="month">` instead of
  `<input type="date">`, with its label reading "Published month starting" instead of "Published
  week starting". Everything else (the ranklist rendering, empty state, pagination) is shared,
  not duplicated — extract the shared rendering into a helper rather than writing two near-
  identical ~100-line components.
- **AC-20**: default view (no `period` param in the URL) is unchanged from today — weekly, same as
  every existing bookmark/link to `/boards/weekly` already expects (§4).

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not edit `src/db/boards.ts` or `src/services/quiz-boards.ts` — reuse their exports from new
  parallel files (`src/db/monthly-boards.ts`, `src/services/monthly-boards.ts`); `git diff` on
  both must be empty.
- Do not edit `migrations/0001_init.sql` or `migrations/0002_manual_selection_mode.sql` — a new
  migration file only.
- Do not add a new cron expression to `wrangler.toml`'s `[triggers] crons` list, and do not modify
  `WEEKLY_CRON` or `MINUTE_TICK_CRON`'s existing behavior in `src/index.ts` — `git diff` on
  `wrangler.toml`'s `[triggers]` block must be empty.
- Do not touch `src/services/templates.ts`, `src/services/quiz-materializer.ts`, or
  `src/core/selection.ts` — unrelated systems.
- Do not modify the existing `GET /weekly` handler's logic in `src/routes/boards.ts` — only add a
  sibling `GET /monthly` handler in the same file.
- Do not give the monthly KV cache the `board:` prefix (AC-10) — this is a correctness bug
  (silent collision with the existing weekly/per-quiz cache keyspace), not a style choice.
- Do not rename `WeeklyBoardPage`, its file, its route path, or the "Boards"/"Leaderboards" nav
  label (§4).
- Do not touch any `web/src/features/admin/**` file.
- Do not add a `MonthlyBoardRow` type or any other duplicate of `WeeklyBoardRow` — reuse it as-is
  (AC-16).

### 8b. Coding / quality principles

- `clean-code`: every new function mirrors an existing sibling's exact shape and naming
  convention (`computeMonthlyBoards` next to `computeWeeklyBoards`, etc.) — no invented
  abstraction layer, no premature "unify weekly+monthly into one generic period system" refactor.
  Three near-identical files (boards.ts/monthly-boards.ts, quiz-boards.ts/monthly-boards.ts) is the
  established pattern in this codebase (mirrors how `src/services/templates.ts` is a full parallel
  file to `quiz-creation.ts`, not a shared abstraction) — do not deviate from it here.
- `prod-safety-gate`: the migration (AC-2) is the highest-risk single piece of this packet — a
  recreate of a live, already-populated table. Verify it locally (AC-2's verification steps)
  before ever running it against `--remote`. The hourly-tick wiring (AC-15) runs unconditionally
  in production every hour; a bug in `isMonthReady`/`mostRecentlyElapsedMonthStart` that never
  returns "ready" fails silently (no board ever publishes) rather than throwing — cover this with
  an explicit AC-6/AC-8 test asserting a genuinely-elapsed, fully-closed month **is** detected as
  ready.
- `test-driven-development`: write the test for each AC before the implementation satisfying it —
  in particular AC-3/AC-4/AC-5's date-rollover edge cases (Dec→Jan, leap year) are exactly the kind
  of arithmetic bug that's invisible without a test and easy to get subtly wrong by hand.
- Mirror `tests/quiz-boards.test.ts`, `tests/boards.routes.test.ts`, `tests/telegram.test.ts`,
  `tests/telegram-render.test.ts`, `tests/scheduler-materialize-weekly.test.ts` for backend test
  structure; mirror `web/src/features/admin/TemplatesPanel.test.tsx`'s `vi.mock("../../api/client",
  ...)` pattern for the new frontend test file.

## 9. Behavior Spec (per file)

### `migrations/0003_monthly_boards.sql` (NEW)

- **Current state:** does not exist.
- **Required edit:** `CREATE TABLE monthly_boards` (AC-1) plus the `telegram_posts` recreate
  (AC-2), in one migration file.
- **Estimated diff:** ~45 LOC (new file).
- **Subtleties:** the recreate must preserve every existing row and constraint exactly — copy the
  full column list from `migrations/0001_init.sql:326-339` verbatim except the widened `kind`
  CHECK. Run with `PRAGMA foreign_keys=OFF` around the recreate (the `quiz_id` FK) and back `ON`
  after, inside the same migration file.

### `src/core/schedule.ts` (EDIT, additive)

- **Current state (lines 13-47):** `istWeekStartMsContaining`, `weekBoundsForWeekStart`,
  `mostRecentlyElapsedWeekStart`, `weekStartOffsetBy` — all week-anchored.
- **Required edit:** add `monthBoundsForMonthStart`, `mostRecentlyElapsedMonthStart`,
  `monthStartOffsetBy` (AC-3/4/5) — a parallel `istMonthStartMsContaining` internal helper is
  expected but not required to be named that exactly.
- **Estimated diff:** ~35 LOC.
- **Subtleties:** month lengths vary (28-31 days) unlike weeks — do not reuse `WEEK_MS`-style
  fixed-duration arithmetic; compute month boundaries from calendar year/month fields
  (`Date.UTC(year, month, 1)`), same technique `formatIstDate`/`weekBoundsForWeekStart` already
  use for day-level fields.

### `src/core/config.ts` (EDIT, additive)

- **Current state (line 113):** `export const WEEKLY_RETRY_LOOKBACK_WEEKS = 8`.
- **Required edit:** add `export const MONTHLY_RETRY_LOOKBACK_MONTHS = 3` (§3) next to it, with a
  comment mirroring line 110-112's "implementation bound, not a product setting" framing.
- **Estimated diff:** ~4 LOC.

### `src/db/monthly-boards.ts` (NEW)

- **Current state:** does not exist.
- **Required edit:** mirror `src/db/boards.ts` (83 lines) exactly, substituting `monthly_boards`/
  `month_start` for `weekly_boards`/`week_start`, importing (not copying) `aggregateWeeklyScores`.
- **Estimated diff:** ~75 LOC (new file).
- **Subtleties:** `import { aggregateWeeklyScores } from "./boards"` — the function name stays
  `aggregateWeeklyScores` even though it's now called from a monthly context; do not rename it
  (that would touch the untouchable `src/db/boards.ts`, §8a) and do not copy its body into a new
  `aggregateMonthlyScores` (duplicate logic the skill's own quality bar forbids when the original
  is already generic).

### `src/services/monthly-boards.ts` (NEW)

- **Current state:** does not exist.
- **Required edit:** mirror `src/services/quiz-boards.ts` (64 lines) exactly (AC-8/9), importing
  `assignWeeklyDenseRanks` from `src/core/leaderboard.ts` unmodified and the new
  `getCachedMonthlyBoard`/`putCachedMonthlyBoard` from `src/services/cache.ts`.
- **Estimated diff:** ~60 LOC (new file).

### `src/services/cache.ts` (EDIT, additive)

- **Current state (lines 122-165):** `weeklyBoardCacheKey`/`getCachedWeeklyBoard`/
  `putCachedWeeklyBoard`, prefix `board:`.
- **Required edit:** add `monthlyBoardCacheKey`/`getCachedMonthlyBoard`/`putCachedMonthlyBoard`
  (AC-10), prefix `monthboard:` (not `board:`), field-rebuild pattern identical to
  `putCachedWeeklyBoard` (lines 154-165) — never spread the input, rebuild field by field.
- **Estimated diff:** ~30 LOC.
- **Subtleties:** update the file's own header comment (line 1, `"KV: jwks:*, role:<uid>, ..."`) to
  list the new `monthboard:<monthStart>` key alongside the existing ones — this comment is the
  only place the whole KV keyspace is documented in one spot.

### `src/core/contracts.ts` (EDIT — single line)

- **Current state (line 162):** `export type TelegramPostKind = 'announce' | 'soon' | 'open' |
  'result' | 'weekly' | 'cancelled'`.
- **Required edit:** add `| 'monthly'` to the union (AC-11). This is the only change to this file
  in the entire packet — a deliberate, minimal, additive exception to the "contracts.ts is frozen"
  convention, exactly like Sprint 6's `listDueAnnounce` addition was (cited in Sprint 10's own
  packet as precedent for this kind of change).
- **Estimated diff:** 1 LOC.

### `src/core/telegram-render.ts` (EDIT, additive)

- **Current state (lines 93-116):** `WEEKLY_SECTION_ORDER`, `SECTION_LABEL`,
  `renderWeeklySection`, `renderWeeklyBoards`.
- **Required edit:** add `renderMonthlySection`/`renderMonthlyBoards` (AC-12), reusing
  `WEEKLY_SECTION_ORDER`/`SECTION_LABEL`/`MAX_BOARD_ROWS`/`escapeHtml`/`MONTH_NAMES` (line 22)
  unmodified — only the header emoji/text and the "this month" vs. "this week" copy differ.
- **Estimated diff:** ~20 LOC.

### `src/db/telegram.ts` (EDIT, additive)

- **Current state (lines 67-80, 82-115):** `sendWeekly`, `claimAndSend`'s `kind === "weekly"`
  branch (line 102).
- **Required edit:** add `sendMonthly` (AC-13) mirroring `sendWeekly` exactly (substitute
  `renderMonthlyBoards`, `'monthly'` kind literal); extend the `claimAndSend` branch at line 102 to
  `if (kind === "weekly" || kind === "monthly")`, dispatching to whichever `send*` function matches
  `kind`.
- **Estimated diff:** ~20 LOC.

### `src/services/scheduler.ts` (EDIT, additive)

- **Current state (lines 173-209):** `runWeeklyPass`, `runWeeklyRetrySweep`.
- **Required edit:** add `runMonthlyPass`/`runMonthlyRetrySweep` (AC-14), importing
  `MONTHLY_RETRY_LOOKBACK_MONTHS` and `monthStartOffsetBy` alongside the existing weekly imports
  (line 18-19).
- **Estimated diff:** ~30 LOC.

### `src/index.ts` (EDIT, additive)

- **Current state (lines 105-141):** cron constants, `scheduled` handler, `HOURLY_CRON` branch
  (122-135) calling `runMaterializePass` then `runWeeklyRetrySweep`.
- **Required edit:** import `runMonthlyRetrySweep`, `computeMonthlyBoards`,
  `mostRecentlyElapsedMonthStart`; add one call after line 133 (AC-15).
- **Estimated diff:** ~6 LOC.

### `src/core/api.ts` (EDIT, additive)

- **Current state (lines 476-483):** `WeeklyBoardRequest`/`WeeklyBoardResponse`.
- **Required edit:** add `MonthlyBoardRequest`/`MonthlyBoardResponse` (AC-16) directly below them.
- **Estimated diff:** ~8 LOC.

### `src/routes/boards.ts` (EDIT, additive)

- **Current state:** whole file, 49 lines, one `GET /weekly` handler.
- **Required edit:** add `GET /monthly` (AC-17); update the file's header comment (line 1) to
  mention both routes.
- **Estimated diff:** ~25 LOC.

### `web/src/api/client.ts` (EDIT, additive)

- **Current state (lines 243-244):** `weeklyBoard`.
- **Required edit:** add `monthlyBoard` (AC-18); import `MonthlyBoardRequest`/`MonthlyBoardResponse`
  from `src/core/api.ts` alongside the existing weekly imports.
- **Estimated diff:** ~4 LOC.

### `web/src/features/student/StudentPages.tsx` (EDIT)

- **Current state (lines 380-487):** `WeeklyBoardPage`, fully described in §1.
- **Required edit:** add the period toggle and `period`/`monthStart` URL-param handling (AC-19/20);
  extract the shared ranklist/pagination/empty-state JSX into a helper used by both periods rather
  than duplicating it.
- **Estimated diff:** ~70 LOC (net growth — this is the single largest file touched; if the actual
  diff meaningfully exceeds this, that's a signal the shared-helper extraction (AC-19) isn't
  happening and the component is being duplicated instead — stop and reconsider).
- **Subtleties:** `boardTypes`/`quizTypeLabels` (lines 380-385, imported from
  `web/src/lib/format.ts:3`) are shared by both periods unchanged — do not duplicate them.

### `web/src/features/student/StudentPages.test.tsx` (NEW)

- **Current state:** does not exist for this file.
- **Required edit:** new test file, mirroring `web/src/features/admin/TemplatesPanel.test.tsx`'s
  `vi.mock("../../api/client", ...)` pattern, covering §12b's FE cases.
- **Estimated diff:** ~80 LOC (new file).

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| `telegram_posts` recreate-table migration (AC-2) fails or silently drops rows against real D1 | Low | High | AC-2's explicit local-verification steps (row-count check before/after) before ever running `--remote`; `prod-safety-gate` guardrail (§8b) |
| KV cache key collision between monthly and existing weekly/per-quiz `board:` prefix | Medium (easy to miss without the §1/AC-10 callout) | Medium — silently serves stale/wrong-period data, no error thrown | AC-10's dedicated `monthboard:` prefix + explicit collision test |
| Hand-written month-boundary arithmetic (Dec→Jan rollover, leap years) has an off-by-one | Medium | Medium — a wrong month's data published/posted | AC-3/4/5's explicit rollover + leap-year test cases, TDD-first per §8b |
| `isMonthReady`'s "any blocking quiz in range" check never returns true (bug) → board never publishes, fails silently every hour forever | Low | Medium — a real product-facing gap that produces no error/alert | §8b's explicit AC-6/AC-8 "genuinely ready" test; the existing hourly materialize-failure alert path is unaffected/unchanged, so this specific silent failure has no automatic alert — flagged here rather than papered over |
| `sendMonthly`'s 4-message send partially succeeds then the process is interrupted before `markFailed`/`markSent` | Low | Low | Mirrors `sendWeekly`'s existing, already-accepted behavior exactly (AC-13) — not a new risk this packet introduces, the same acceptance already applies to weekly today |
| Frontend duplicates `WeeklyBoardPage` into two near-identical components instead of sharing rendering | Medium (easy shortcut under time pressure) | Low (maintainability, not correctness) | AC-19's explicit "extract, don't duplicate" requirement + §9's diff-size tripwire |
| A future reader mistakes the reused `telegram_posts.week_start` column as *always* meaning a week | Low | Low (confusion, not a bug) | AC-2/AC-13's explicit code comments documenting the dual meaning at the point of use |

## 11. Rollback / Revert Plan

1. `git revert <sha>` for the implementation commit(s).
2. If `migrations/0003_monthly_boards.sql` was already applied to the local/remote D1 (`wrangler d1
   migrations apply quizzer-db --local|--remote`), there is no `migrate:down` in this project's
   tooling (`package.json:14-15` only has `apply`) — write and apply a compensating migration
   `0004_revert_monthly_boards.sql` that: drops `monthly_boards`, and re-runs the
   `telegram_posts` recreate procedure with the CHECK narrowed back to the pre-`0003` kind list
   (verify first that no `kind='monthly'` row exists, or the narrower CHECK will reject the
   recreate's own `INSERT ... SELECT` — if any exist, decide with the project owner whether to
   delete those rows or keep the widened CHECK permanently rather than force a revert).
3. Redeploy: `npm run build && npx wrangler deploy` (same as every prior deploy in this project).
4. Verification: `curl <deployed-url>/api/boards/monthly` returns 404 (route gone) or the revert is
   otherwise confirmed complete; `GET /api/boards/weekly` still behaves exactly as before this
   packet (unaffected by the whole revert, since it was never touched — §8a).
5. Notification: tell the project owner (same channel used throughout this project's session) that
   the monthly board was reverted and why, and confirm whether any already-sent monthly Telegram
   messages in the group need manual cleanup (same manual/reply-based process already established
   for the student group — no new tooling for this).

## 12. Verification + Definition of Done

### 12a. Automated verification

```bash
# Backend
npx vitest run

# Frontend
cd web && npx vitest run && cd ..

# Typecheck (both)
npx tsc --noEmit
npx tsc --project web/tsconfig.json --noEmit

# Frontend build (must succeed before any deploy)
npm run build

# Hard NO list — each must produce no output
git diff -- src/db/boards.ts
git diff -- src/services/quiz-boards.ts
git diff -- migrations/0001_init.sql
git diff -- migrations/0002_manual_selection_mode.sql
git diff -- src/services/templates.ts src/services/quiz-materializer.ts src/core/selection.ts
git diff -- web/src/features/admin

# Migration verification (local only — never run --remote until this passes)
npx wrangler d1 migrations apply quizzer-db --local
```

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | Monthly board computes and publishes | Seed two `ended` quizzes for one user spanning one full IST calendar month, then call `computeMonthlyBoards` for that `month_start` | Returns 4 `BoardSummary` entries (verbal/quant/lr/overall), `monthly_boards` has the corresponding rows, KV has `monthboard:<month_start>` populated | Pass |
| BE-2 | Month not ready | A `scheduled` quiz still sits inside the target month | `computeMonthlyBoards` returns `[]`, nothing written to `monthly_boards` or KV | Pass |
| BE-3 | Republish replaces only that month | Call `computeMonthlyBoards` twice for the same `month_start` after data changes | Row count for that `(month_start, type)` unchanged in shape but values updated; an unrelated month's rows are untouched | Pass |
| BE-4 | `GET /api/boards/monthly` happy path | Request with a published `monthStart` and `type=overall` | 200, paginated rows matching `monthly_boards`, `total` correct | Pass |
| BE-5 | `GET /api/boards/monthly` invalid `monthStart` | Request with `monthStart=2026-13-01` (malformed) | 400 | Pass |
| BE-6 | Telegram `monthly` kind sends 4 messages | Trigger `claimAndSend("monthly", {weekStart: monthStart}, boards)` against a stubbed bot client | 4 `sendMessage` calls, one per section; `telegram_posts` row for `(week_start=monthStart, kind='monthly')` marked `'sent'` with a 4-key JSON `message_id` | Pass |
| BE-7 | Telegram `monthly` claim idempotency | Call the same `claimAndSend("monthly", ...)` twice for the same month | Second call is `{sent:false, skipped:true}`; only 4 messages total sent, not 8 | Pass |
| BE-8 | Hourly tick wires the monthly sweep | Fire `app.scheduled` with `cron: "0 * * * *"` against a DB with one genuinely-elapsed, fully-ended month | No throw; `monthly_boards` populated for that month; Telegram stub received 4 sends for it | Pass |
| BE-9 | Migration round-trip | `npx wrangler d1 migrations apply quizzer-db --local` | Applies cleanly; `telegram_posts` row count unchanged; a `kind='monthly'` insert now succeeds; a `kind='bogus'` insert still fails | Pass |
| BE-10 | Month-boundary edge cases | Unit tests for `monthBoundsForMonthStart`/`mostRecentlyElapsedMonthStart`/`monthStartOffsetBy` covering Dec→Jan rollover and a leap-year February | All pass per AC-3/4/5's exact expected values | Pass |

#### Frontend / UI

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| FE-1 | Default view unchanged | Navigate to `/boards/weekly` with no query params | Weekly view renders exactly as before this packet, period toggle shows "Weekly" selected | Pass |
| FE-2 | Switch to monthly | Click the "Monthly" toggle | URL gains `?period=monthly`; `api.monthlyBoard()` is called instead of `api.weeklyBoard()`; the date picker becomes `<input type="month">` | Pass |
| FE-3 | Type tabs still work under monthly | With `period=monthly`, click "Verbal" | `type=verbal` applied to the monthly request; monthly Verbal rows render | Pass |
| FE-4 | Empty monthly board | Select a `monthStart` with no published monthly board | Empty state renders ("No published entries" or equivalent), no crash | Pass |
| FE-5 | Pagination under monthly | A monthly board with >50 rows (or mocked as such) | `Pagination` component works identically to the weekly path | Pass |
| FE-6 | Switching periods doesn't leak stale date | Set a `weekStart` under Weekly, then switch to Monthly | `monthStart` starts unset/default, not derived from the prior `weekStart` value | Pass |

#### Chrome DevTools / extension verification

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| CHROME-1 | Monthly request payload | Network tab, trigger FE-2 | Request goes to `GET /api/boards/monthly` with `type`/`monthStart`/`offset` query params, never `weekStart` | Not Run — requires a running app + real Google sign-in; not exercised in this implementation session. Equivalent coverage: CHROME-1 is subsumed by the "never returns a weekStart field"/FE-6 assertions on the exact request shape; CHROME-2 is subsumed by the component test suite's pristine (no console error) run. |
| CHROME-2 | No console errors across the period toggle | Console tab open through FE-1→FE-6 | No uncaught errors/warnings introduced by this change | Not Run — requires a running app + real Google sign-in; not exercised in this implementation session. Equivalent coverage: CHROME-1 is subsumed by the "never returns a weekStart field"/FE-6 assertions on the exact request shape; CHROME-2 is subsumed by the component test suite's pristine (no console error) run. |

#### Operator-executed (post-cutover, see AC-OPERATOR)

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| OP-1 | Migration applied to production D1 | `npx wrangler d1 migrations apply quizzer-db --remote`, only after AC-2/BE-9 pass locally | Applies cleanly against the real database; spot-check `SELECT COUNT(*) FROM telegram_posts` matches the pre-migration count | Not Run |
| OP-2 | First real monthly post, end of a real month | Wait for the next genuine IST month-end, observe the hourly tick | Exactly 4 new messages appear in the student Telegram group within an hour of month-end, matching the weekly post's visual format | Not Run |

**Mandatory rules:** every case above must reach a Status other than `Not Run` before this packet
is considered done; the implementer fills BE/FE/Chrome, the operator fills OP. No case here is
waived — all four tables are populated and applicable (this packet has both backend and frontend
surfaces, per the original request).

### 12c. Definition of Done

- [x] AC-1 through AC-20 satisfied.
- [x] §12a passes locally (561 backend + 51 frontend tests pass; both `tsc --noEmit` clean;
      `npm run build` succeeds; migration applied and verified locally).
- [ ] BE-1..10 / FE-1..6 / CHROME-1..2 in §12b have Status ≠ `Not Run` (target: `Pass`) — BE and FE
      all `Pass`; **CHROME-1/CHROME-2 remain `Not Run`**, honestly: they require a live browser
      session signed in via real Google OAuth, which this implementation session could not exercise
      (no dev-only auth bypass exists, and adding one is out of this packet's scope). Left for an
      operator/future session with real browser + credentials access; not fabricated as passing.
- [ ] OP-1..2 completed by the operator (or explicitly waived in §5 — none are currently waived).
- [x] No `<INPUT_REQUIRED>` remains in §5.
- [x] §8a Hard NO list respected — every listed `git diff` is empty (verified).
- [x] §11 Rollback plan rehearsed mentally.

---

End of Codex Task Packet — `claude-task--001`
