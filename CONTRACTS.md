# Quizzer — Data Contracts

> **Scope:** every module-to-module interface, collected in one place. Each module's own
> "Interfaces" section is still the in-context version; this document is the cross-reference and
> the place the full type bodies live. Types themselves live in `src/core/contracts.ts` — this
> document explains them.
> **Status:** contracts defined, nothing built.
> **Last updated:** 2026-09-09

---

## 1. The module graph, with contracts named

[[MODULES]]'s dependency diagram shows *that* an arrow exists. This is the same graph with each
arrow labeled by the actual call. See `CONTRACTS.svg` for the visual version.

```
                                ┌──────────────┐
                                │  SCHEDULER   │
                                └──┬────────┬──┘
     openRoom · closeQuiz ·        │        │  claimAndSend(kind, target, payload)
     materializeTemplates ·        │        │
     computeWeeklyBoards           ▼        ▼
   ┌────────┐  claimUnused   ┌──────────┐   ┌──────────┐
   │  BANK  │◀───────────────│ QUIZZING │╌╌▶│ TELEGRAM │   ╌╌▶ = no call, DTO passed through
   │        │  getByIds       │          │   │          │        SCHEDULER (§6 below)
   │        │  listUnused     │          │   │          │
   └────────┘                └──────────┘   └──────────┘
        ▲                          ▲
        │  requireRole('admin')    │  requireAuth · currentUser
        └────────────┬─────────────┘
                 ┌────────┐
                 │  AUTH  │
                 └────────┘
```

Four call surfaces, one data-flow-only relationship. `startQuiz` is gone (COUNCIL_FINDINGS.md
#6): this is a self-paced quiz with no shared start time, so there is nothing for a global
"start" call to transition — each student's own clock begins at their own join. That's the whole
graph — no module calls back up, and [[TELEGRAM]] and [[SCHEDULER]] own nothing the others write
to (see [[MODULES]] "Table ownership" and "KV keyspace ownership" for why that's true at the
storage layer too).

---

## 2. AUTH → QUIZZING, BANK

```ts
requireAuth(): void
requireRole(role: 'admin' | 'superadmin'): void
currentUser(ctx: unknown): CurrentUser
getUserById(id: string): Promise<CurrentUser | null>
```

`requireAuth`/`requireRole` are mounted per route group, not per handler — an unguarded route is
a route-group requirement verified by tests ([[AUTH]] §3.3), except for one deliberate
split: `POST /api/admin/users/:id/role` needs `requireRole('superadmin')` while the rest of
`/api/admin/*` needs only `requireRole('admin')`, so that one route is its own mount point
(COUNCIL_FINDINGS.md #8).

**`requireRole` and `currentUser` both read the KV-cached role, falling back to D1 on a miss.**
[[AUDIT]] §3.4 originally flagged the ~60-second KV propagation window as a revocation risk, but
the admin list is fixed and never changes in practice for this deployment — there's no demotion
to guard against, so a single shared mechanism replaced the earlier plan for a separate
D1-direct read on admin routes (COUNCIL_FINDINGS.md #12).

`CurrentUser` deliberately carries no session/token fields — a route handler never needs to know
*how* someone was authenticated, only who they are.

---

## 3. BANK → QUIZZING

```ts
listUnused(filters: SelectionFilters): Promise<QuestionFull[]>
claimUnused(questionIds: string[], quizId: string, quizNumber: number): Promise<string[]>
getByIds(questionIds: string[]): Promise<QuestionFull[]>
```

Three calls, three different moments in a question's life:

| Call | When | Who calls it |
|---|---|---|
| `listUnused` | Composing a draft draw (QUIZ-1..4) | An admin previewing a quiz, or the recurring materializer |
| `claimUnused` | Locking a quiz (QUIZ-5) | [[QUIZZING]] creation or its materializer, invoked by SCHEDULER |
| `getByIds` | Serving a live quiz, rendering a review screen | [[QUIZZING]]'s run and results code |

**`getByIds` replaces what used to be `getForQuiz(quizId)`.** The old signature required [[BANK]]
to read [[QUIZZING]]'s `quiz_questions` table to resolve which questions belong to a quiz —
[[AUDIT]] §3.7 called this out as the one place the dependency arrow pointed backwards.
[[QUIZZING]] now resolves `quizId → questionIds` itself and hands [[BANK]] the ids; [[BANK]]
still knows nothing about quizzes beyond the ids it's given, which is [[MODULES]]'s stated
invariant.

`QuestionFull` carries solutions and is permitted in admin responses and unlocked participant
reviews. It is never a student gameplay payload. `PassageContent` includes nullable title,
bodyMd and imageUrl for RC text or LRDI shared material. BANK owns content and group order;
QUIZZING owns quiz-unit ordering/allowances and resolves IDs before calling getByIds.

**`claimUnused` also retires the passage.** It derives each claimed question's `passage_id` and
stamps `passages.used_in_quiz_id` in the same call, so a fully-retired passage is correctly
excluded from `listUnused`'s pool — the column existed before but had no writer
(COUNCIL_FINDINGS.md #4). This is accepted only in its non-concurrent form: no all-or-nothing
claim semantics, no auto-release on a partial match, no `release()` call — concurrent admin
actions locking overlapping quizzes don't happen in this deployment, so that machinery was
rejected as unnecessary. The bookkeeping fix stands on its own regardless of concurrency.

The return is idempotent for one quiz identity. It includes requested ids newly claimed by
`quizId`/`quizNumber` and requested ids already stamped with that same pair; ids owned by another
quiz are omitted. QUIZZING can therefore retry publication after an ambiguous successful BANK
call without releasing or double-claiming content. A short return still means lock cannot publish.

---

## 4. QUIZZING → client — timed units

Exact definitions live in `src/core/contracts.ts`, HTTP request/response types in `src/core/api.ts`.

| Type | Responsibility |
|---|---|
| `UnitKind` | standalone, rc or lrdi |
| `TimingPolicy` | Positive integer seconds by kind; every kind in a draw requires a value |
| `QuizUnitDefinition` | Admin composition: unitPosition, kind, passageId, questionPositions, timeLimitSec |
| `ServedQuestion` | Redacted question with flat position, subPosition, format, body, image and options |
| `UnitContent` | Shared redacted active-unit content, including all its questions and shared material |
| `ServedUnit` | UnitContent plus personal startedAt, deadlineAt and submitByAt |
| `UnitAnswer` | Discriminated answered MCQ/TITA, skipped, or unanswered (timeout only) response |
| `UnitCloseReason` | completed or timed_out |

The change from question delivery to **unit delivery** is intentional. Students may navigate
inside the active RC/LRDI set, but cannot fetch later units or reopen a closed one. Unit and
subquestion positions are integers; "1.2" is presentation, never an ID or numeric database key.
Question count measures graded items, not the number of clocks.

`UnitContent` is the only payload stored under `unit:<quizId>:<unitPosition>` in shared KV.
It has no personal deadlines, drafts, correctOption, numericAnswer, numericTolerance or
explanationMd. Attach immutable participant timing from D1 to form ServedUnit. Explicitly
construct allowlisted serialized objects: TypeScript structural typing does not itself remove
extra properties from full database objects. Test all student runtime payloads and cache JSON.

The browser owns editable drafts, Back/Skip/Clear and selected subquestion. One final set batch
crosses the API only when the final unresolved answer/skip closes it, or on timer expiry. Atomic
acceptance stores final answers, totals and unit timing together. There is no per-answer server
elapsed value, no speed-bonus field and no scoring-grace parameter in V1.

`deadlineAt` is the editing cutoff; `submitByAt = deadlineAt + 5,000 ms` is the inclusive
transport cutoff. The browser freezes the payload at `deadlineAt`; the server caps elapsed time
there and settles an unsubmitted unit only after `submitByAt`. Accepted retries remain valid.

A submission ID plus canonical payload hash identifies retries. The same accepted payload can
be retried after its original receipt deadline; respond with its closure receipt and current
play state. Reject changed retries. The server never trusts local answer timestamps.
Review timing is a separate per-unit collection, rather than a duplicated value per subquestion.

---

## 5. SCHEDULER → QUIZZING

```ts
listDuePrepare(now: number, limit: number): Promise<string[]>
listDueClose(now: number, limit: number): Promise<DueCloseQuiz[]>
listDueAnnounce(now: number, limit: number): Promise<DueAnnounceQuiz[]>
openRoom(quizId: string, now: number): Promise<OpenResult>
closeQuiz(quizId: string, now: number): Promise<CloseResult>
materializeTemplates(days: number, now: number): Promise<MaterializeResult>
computeWeeklyBoards(weekStart: string): Promise<BoardSummary[]>
```

The three list calls are bounded, read-only QUIZZING operations. `DueCloseQuiz` contains only
`quizId` and `safeCloseAt`; SCHEDULER uses a limit of 100 and never queries D1 itself. No
`startQuiz`: individual clocks start on joining. `openRoom` prepares seats and unit content
at T−5m, but admission/code release require `scheduled_at <= now < ends_at`. The admission cutoff
is independent of full working duration. `closeQuiz` waits for admission cutoff + derived
individual duration plus the five-second final delivery window (see PRD §5.4). Cron does not run unit timers.

**`listDueAnnounce`** (resolved 2026-09-10, closing the Sprint 6 packet's OQ-1): SCHEDULER's
Announce pass ([[SCHEDULER]] §4.1 — "due post kind without a previous claim → claimAndSend") needs
a way to discover which quizzes are due for the T−2h/T−30m/T Telegram reminders and to obtain the
render payload, since SCHEDULER issues no SQL of its own. `listDueAnnounce(now, limit)` returns
`DueAnnounceQuiz[]`, one entry per quiz with a currently-due, not-yet-claimed announce kind:

```ts
type DueAnnounceQuiz = {
  quizId: string
  kind: 'announce' | 'soon' | 'open'   // which of TG-1/TG-2/TG-3 is due
} & QuizAnnouncePayload
```

"Due" and "not yet claimed" are both QUIZZING-side predicate checks internal to this call, mirroring
`listDueClose`'s pattern — SCHEDULER just iterates the result and calls `claimAndSend(kind,
{quizId}, payload)` per entry; TELEGRAM's own claim-first insert (§6 below) is still what makes a
repeated or overlapping call harmless. `roomCode` on the embedded `QuizAnnouncePayload` is present
only once `scheduledAt <= now`, consistent with TG-3's withholding rule ([[TELEGRAM]] §3, TG-6).

The named interface that closes [[AUDIT]] §3.1 — [[SCHEDULER]] issues **zero SQL and touches no
KV key directly**. Every write, including cache warming, happens inside one of these four calls.
Each does its own predicate check internally (`status = 'scheduled'`, `board_computed_at IS
NULL`, etc.) and is a no-op if the predicate doesn't match — that's what makes cron-firing-twice
harmless ([[SCHEDULER]] §5) without [[SCHEDULER]] itself tracking any state. `openRoom`'s
predicate also excludes `status = 'draft'` — a quiz that was never locked has no retired
questions and cron must never open a room over it (COUNCIL_FINDINGS.md #2/#3).

**These same four calls are not cron-exclusive.** `join` calls `openRoom` under the identical
predicate if the room hasn't opened yet; the results endpoints call `closeQuiz` under the
identical predicate if a request arrives before cron does. This is the actual fix for [[AUDIT]]
§3.3 — cron is an optimization that usually gets there first, not a dependency anything is gated
on. The contract is the predicate, not the caller.

**Atomic close and publication:** finalize unresolved runs, rank stored totals and set
board_computed_at/status/ended_at in one transaction. The conditional claim and dependent writes
must commit together; no reader may see a completion marker before all rank writes are committed.
Concurrent calls return the committed result or remain locked; rollback permits retry.

Sprint 4 implements the request-side runtime settlement primitive and the scheduler's typed
close-call seam. The production `closeQuiz` implementation and its binding into the minute tick
land in Sprint 5 so unresolved-run settlement and ranking/publication remain one atomic commit.
Sprint 4 must not pre-settle the whole quiz in a separate transaction.

`materializeTemplates` additionally calls `BankContract.claimUnused` internally, once per
occurrence it creates — the unattended auto-draw decided in [[AUDIT]] §11 (#16). Its own
idempotency claim ("one occurrence per template per slot") is now a real `UNIQUE
(template_id, scheduled_at)` constraint on `quizzes`, not just asserted prose
(COUNCIL_FINDINGS.md #9).

`MaterializeResult` returns both successfully published `quizIds` and safe per-occurrence
`failures`. A failure contains only `templateId`, candidate `scheduledAt`, and code
`'pool_exhausted' | 'missing_timing_configuration'`; it contains no question, answer, SQL,
provider or student data. SCHEDULER sends each returned failure through the existing independent
Telegram-alert-chat and Cloudflare Email Routing channels. A failed occurrence never blocks a
sibling occurrence, and an alert-channel failure never changes materialization state.

The materializer applies the template's timingPolicy to each actual whole-group draw and
calculates windowSec from unit allowances plus slack; it never copies a stale derived duration.

`closeQuiz`'s `CloseResult.top10` is the one piece of [[QUIZZING]]-owned data that leaves the
module without a direct call — see §6.

---

## 6. SCHEDULER → TELEGRAM

In addition to `claimAndSend`, TELEGRAM exposes the bounded read-only
`listFailedPosts(limit): Promise<FailedTelegramPostRef[]>`. The DTO contains only quiz/week
identity, kind and claimed time; it never exposes stored provider error text. SCHEDULER uses it
for failure alerts and never reads `telegram_posts` directly.

```ts
claimAndSend(
  kind: TelegramPostKind,
  target: { quizId: string } | { weekStart: string },
  payload: TelegramPayload
): Promise<ClaimAndSendResult>
```

One call, keeping `telegram_posts` at one writer. `claim the row first, then send` is the whole
idempotency guarantee — but the claim itself is now two steps, not one insert
(COUNCIL_FINDINGS.md #1): insert with `status = 'pending'` (before calling the Bot API — `sent_at`
and `message_id` aren't known yet, so both are nullable), then `UPDATE` to `status = 'sent'` with
`message_id`/`sent_at` on success, or `status = 'failed'` with `error` set on a permanent failure.
The unique constraint on `(quiz_id, kind)` / `(week_start, kind)` still makes a double-fire a
no-op at the initial insert — that part is unchanged.

`QuizAnnouncePayload` carries scheduledAt, endsAt, graded questionCount, unitCount, windowSec and
a timingSummary grouped by kind (count and min/max unit allowances). roomCode is included only
when admission begins. No uniform timePerQSec, bonus or grace fields remain. Telegram formats
these supplied values; it does not derive timing by reading quiz tables.

**The indirect contract.** `payload` for a `'result'` post is `CloseResult`; for `'weekly'` it's
`BoardSummary[]`; for `'cancelled'` it's `CancelledPayload` (COUNCIL_FINDINGS.md #33 — previously
in the `kind` enum and the schema with no payload type or render function). All three are
produced by [[QUIZZING]], not [[TELEGRAM]] or [[SCHEDULER]] — and are passed by SCHEDULER from the corresponding QUIZZING results. [[SCHEDULER]] receives `CloseResult` back from its own `closeQuiz` call
(§5) and forwards it untouched into `claimAndSend`; the cancel route similarly hands
`CancelledPayload` to [[SCHEDULER]] rather than calling [[TELEGRAM]] directly, keeping
[[MODULES]]'s "nothing points back up" literally true for this kind too. TypeScript enforces the
call sites; it doesn't enforce that `core/telegram-render.ts`'s golden-string tests still mean
the same thing after a shape change. **Whoever changes `CloseResult` or `BoardSummary` owns
checking TELEGRAM's render functions** — this is the one contract in the system where compiling
clean isn't sufficient evidence that nothing broke.

`WeeklyBoardRow.totalScore` is the sum of the student's quiz scores in that IST week.
`quizzesTaken` is display context only; it neither divides the score nor breaks ties. Exact
total-score ties share a dense rank.

---

## 7. What's deliberately not in this document

- **The full HTTP route surface** (paths, methods) — that lives in each module's own route table
  ([[QUIZZING]] §4–7, [[BANK]] §5, [[AUTH]] §5), since routes are consumed by the client, not by
  another backend module. This document is module-to-module only.
- **Request/response wire shapes for those routes** — that's [[API]], not here. `core/api.ts` is
  the type file; this document stays scoped to the five call surfaces in §1.
- **KV and D1 as contracts** — they're storage, not an interface with a signature. Ownership is
  [[MODULES]] "Table ownership" and "KV keyspace ownership"; nothing calls a table.
- **Versioning.** There's one deployment, no external consumers, and no built code yet — a
  breaking change to a type in `src/core/contracts.ts` is caught by the TypeScript compiler at
  every call site the moment it's made. No contract version numbers are needed unless that
  changes (e.g., a second client ships against an older API).

---

## 8. Field naming convention

Every type here is camelCase, matching `ServedQuestion`'s existing style in [[PLAN]]. Every
column in `migrations/0001_init.sql` is snake_case, standard SQL style. The boundary between the
two is always inside a module's own db-access code — no snake_case ever appears in a contract
type, and no camelCase ever appears in the DDL.
