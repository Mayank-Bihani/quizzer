# Quizzer — Scheduler Module

> V1 design, not implemented. Revised 2026-09-10. Cross-cutting backend phases 3–7.
> Requirements: [[PRD]]. Unit behavior: [[QUIZZING]]. Contracts: [[CONTRACTS]].

## 1. Responsibilities

SCHEDULER orchestrates room preparation, due announcements, safe quiz close, recurring draws,
weekly publication and failure alerts. It owns no table, issues no SQL and touches no KV key.
All effects happen inside QUIZZING, TELEGRAM or their service adapters. Telegram sends never
control whether a quiz runs. Individual set clocks are persisted/enforced by QUIZZING request
handlers; no per-unit or per-student cron job is added.

## 2. Requirements covered

G1, ROOM-1/5, QUIZ-7, BOARD-1/7 and TG-1..5. Working deadlines are enforced on requests even
if cron is late; cron completes unattended settlement/publication, not each subquestion advance.

## 3. Interfaces

On QUIZZING: `listDuePrepare(now, limit)`, `listDueClose(now, limit)`,
`openRoom(quizId, now)`, `closeQuiz(quizId, now)`,
`materializeTemplates(days, now)`, `computeWeeklyBoards(weekStart)`.
On TELEGRAM: `listFailedPosts(limit)`, `claimAndSend(kind, target, payload)`.
Exact signatures and DTOs live in `src/core/contracts.ts`.

Discovery calls are bounded read-only operations implemented by the module that owns the data.
The minute tick requests at most 100 candidates per pass. `listDueClose` returns each quiz ID and
its `safeCloseAt`; `listFailedPosts` returns only safe identity metadata, never provider error text.

Each function checks its own eligibility and is safe to retry. Request handlers may call
openRoom/closeQuiz under the same predicates, so a missed tick does not leave a room/results
permanently inaccessible. No startQuiz or global running state exists.

## 4. Cron entries

```toml
[triggers]
crons = ["* * * * *", "0 * * * *", "0 19 * * 0"]
```

### 4.1 Minute tick

| Pass | Eligibility | Module effect |
|---|---|---|
| Prepare | lobby_opens_at <= now and status scheduled | openRoom seeds seats, warms redacted units, marks open/opened_at |
| Announce | Due post kind without a previous claim, discovered via `listDueAnnounce` | claimAndSend |
| Close | status open, safe close point passed, no completed board | closeQuiz |

`listDueAnnounce(now, limit)` (resolved 2026-09-10, [[CONTRACTS]] §5) is what lets SCHEDULER find
which quizzes are due for TG-1/TG-2/TG-3 and get the render payload without querying D1 itself —
the same shape as `listDueClose` for the Close pass.

Preparation at T−5m does **not** admit students or reveal codes. Admission is the request-side
predicate `scheduled_at <= now < ends_at`; TG-3 is due at scheduled_at, not at preparation.
Each student gets `window_sec` from their own join. The full duration is computed by QUIZZING
from actual unit allowances plus slack, independent of join_window_sec.

```
safe_close_at = ends_at + window_sec*1000 + 5000
close is eligible when now > safe_close_at
```

V1 freezes editing at the working deadline and permits five seconds for delivery ([[PRD]] §5.4).
The close job must wait until new submissions are no longer acceptable, using the same inclusive
receipt/exclusive settlement boundary as QUIZZING. No close while a final timeout batch can still
be accepted. Never rank simply at the admission cutoff or merely because all currently joined
students finished early.

`closeQuiz` settles abandoned active units, counts unreached questions as unanswered, finishes
participants and ranks stored totals. It never regrades committed batches. Server-only expiry
need not fabricate answer rows; runtime rows distinguish reached timeouts from unreached units.
Its conditional claim, rank writes, ended status and board_computed_at publish in one atomic
commit. A failed batch leaves results locked and retryable; a concurrent loser reads completed
state rather than publishing partial ranks.

Sprint 4 builds the per-participant settlement primitive used by requests and the scheduler's
typed close-call seam. Sprint 5 implements and wires the production `closeQuiz` call so global
runtime settlement and rank/publication stay in the single atomic commit above. The Sprint 4
minute tick must not pre-settle an entire quiz or publish a completion marker.

Draft/cancelled quizzes cannot match the prepare/close predicates. Each pass proceeds even if
another fails; a Telegram outage must not block opening, closing or weekly computation.

Two failure checks ride on this tick after their related pass: a quiz still unclosed **three minutes**
past safe_close_at, or a telegram_posts row marked failed. Send both Telegram alert-chat and
email notifications. Repeated failure alerts each minute remain the accepted simple behavior.
V1 uses Cloudflare Email Routing through the `ALERT_EMAIL` send-email binding; a custom
Cloudflare-managed domain and verified `EMAIL_ALERT_ADDRESS` are production prerequisites.
The failure-alert delay is not extra student working time.

### 4.2 Hourly materialization

QUIZZING expands active template recurrence rules for the next seven days. For each occurrence,
it draws whole unused RC/LRDI sets plus standalones, builds units, applies the template's
TimingPolicy and slack, derives duration, and retires through BANK. No preview/admin is present.
Pool exhaustion or missing timing configuration fails only that occurrence; no incomplete quiz is
scheduled. `materializeTemplates` returns a safe failure DTO containing only template ID,
candidate scheduled time and failure code. After the materialization call, SCHEDULER sends each
failure through both existing private alert channels (Telegram alert chat and Cloudflare Email
Routing). One alert-channel failure does not block the other, later occurrences or later cron
passes. Retrying the failed occurrence may repeat the hourly alert until the cause is corrected.
Unique `(template_id,scheduled_at)` prevents duplicate occurrences on retries.
SCHEDULER calls the materializer; it does not call BANK directly or write unit definitions.
Template CRUD remains deferred, with DB configuration accepted until that feature is built.

**`quiz_templates.rrule` grammar** (resolved 2026-09-10, project owner — closing the Sprint 7
packet's OQ-1): a minimal RFC 5545 `RRULE` subset, `FREQ=WEEKLY;BYDAY=<day list>` (e.g.
`FREQ=WEEKLY;BYDAY=TU,TH`), with no `COUNT`/`UNTIL`/other RRULE parts recognized in V1 — a
template recurs indefinitely until deactivated. RRULE itself has no time-of-day component, so the
occurrence time is a separate `HH:mm` IST time-of-day encoded as the same string's trailing
segment: `FREQ=WEEKLY;BYDAY=<day list>;BYHOUR=<H>;BYMINUTE=<MM>` (both integers, 24-hour IST
clock — `BYHOUR`/`BYMINUTE` are themselves standard RRULE parts, so this stays a strict RRULE
subset rather than a bespoke suffix). `src/core/schedule.ts`'s expansion function parses only
`FREQ=WEEKLY`, `BYDAY`, `BYHOUR`, and `BYMINUTE`; any other `FREQ` value, an unparseable string, or
a missing required part is rejected as invalid rather than guessed. Template CRUD (still deferred)
is expected to validate this same grammar when it's eventually built; until then, rows are seeded
directly into D1 and must already conform.

### 4.3 Weekly boards

The weekly trigger requests boards for the previous IST week. Attribute quizzes by scheduled_at
in that week. A late-Sunday quiz may still accept a student's final batch after Monday 00:30 IST;
therefore **do not publish a partial weekly result** just because the calendar week has ended.
`computeWeeklyBoards` returns an empty result while any non-cancelled scheduled/open occurrence
in that week has not completed ranking. SCHEDULER sends no weekly post for that empty result.
The hourly pass retries unfinished prior-week publication, including missed weeks, until those
quizzes have closed. Once complete, return four summaries (empty top10 arrays are valid),
upsert boards ranked by total score across quizzes taken, and claim the weekly post. Quiz count
is context only; exact total-score ties share a dense rank. Draft/cancelled quizzes are excluded.

## 5. Idempotency

| Job | Protection |
|---|---|
| Prepare | Guarded status, idempotent seat seeding; safe content cache warming |
| Close | Conditional claim and all settlement/rank/completion writes in one atomic commit |
| Materialize | Unique template occurrence; failed/incomplete draws return safe dual-alert metadata |
| Weekly | Recompute complete aggregates by PK; send once via week_start post claim |
| Post | Unique quiz/kind or week/kind pending claim before external send |

No independent set submission effects belong here. Participant submission and timeout races
are handled by QUIZZING's one unit-closure transaction.

## 6. Timezones

Persist epoch milliseconds, with explicit `*1000` conversion for second durations. Cron runs
in UTC. `0 19 * * 0` is Monday 00:30 Asia/Kolkata; weekly keys are the Monday date of the
completed IST week. Rendering uses IST, not stored local timestamps. India has no DST.
The weekly readiness check is required even after midnight because individual runs may cross it.

## 7. Limits

Cron may be late, skipped or concurrent: use eligibility predicates, bounded work per invocation,
and retries. Unit batch writes/extra runtime rows invalidate the old per-question capacity
estimate; phase 4 measures requests, CPU and row writes. Import stays chunked; ranking should
use SQL ordering and bounded batched updates rather than repeated per-answer JS recomputation.
No deployment or vendor limit change is introduced by this document revision.

## 8. Retained decisions

Zero-participant quizzes still close and emit the no-participants result message. A late open
post is sent normally; no custom lateness-adjusted wording is required. Lookahead stays seven
days. Cancellation excludes a quiz from every scheduling pass and never releases retired content.
Observability lands with backend phase 4; frontend polish follows backend completion.

## 9. Verification at implementation

Test delayed/double cron, lazy prepare/close, code release at admission rather than preparation,
full duration for late joins, batch receipt versus close boundary, unresolved-unit settlement,
atomic ranking visibility, and zero participants. Check 00:30 IST Monday exactly, plus a late
Sunday run crossing that time and delayed weekly publication/retry. Template draws with different
set/standalone mixes must derive different durations from the same policy without stale copies.
