# Quizzer — Spec Audit

> **Historical record:** findings and resolutions below describe the pre-2026-09-09 design.
> Current V1 timing, batch submission, scoring, schema and API rules live in [[PRD]],
> [[QUIZZING]], [[DATA_MODEL]], [[CONTRACTS]] and [[API]]. Conflicting historical rules are
> superseded by [[V1_CHANGES]]; audit entries are preserved, not silently rewritten.

> **Scope:** a coverage and boundary audit of the five module documents against [[PRD]] and
> [[PLAN]]. Findings only — no decisions are made here. Where the audit resolves an open question,
> it is marked **Proposed** and still needs writing into the owning document.
> **Method:** five independent reviewers, anonymised peer review, synthesis. Contested claims were
> verified against the source files; two were found wrong and are recorded in §7 so they are not
> acted on.
> **Status:** resolved 2026-09-04 — see §11 for decisions. Applied to every document it touches;
> §11 is the changelog, not an outstanding action list.
> **Last updated:** 2026-09-04

---

## 1. Headline

Two goals are **at risk**, two are **partial**, one is **safe**. Five of the seven rows in
[[MODULES]] §"Table ownership" are false as written. The most expensive findings are three
schema defects, because they are the only ones that become unfixable once real student data
exists.

| Severity | Finding | Where |
|---|---|---|
| **Blocking** | Three DDL defects in [[PLAN]]'s data model | §2 |
| **Blocking** | Recurring quizzes (QUIZ-7) materialize with zero questions | §3.2 |
| **High** | [[SCHEDULER]] writes six tables it does not own, with no named interface | §3.1 |
| **High** | The 423 unlock gate is undefined — clock or status | §3.3 |
| **High** | AUTH-5's "immediate" revocation contradicts KV's consistency model | §3.4 |
| **High** | The close job's own cost argument is already false | §3.5 |
| **Medium** | Four requirements with no route in any module | §4 |
| **Medium** | `status='cancelled'` exists in the schema and nobody owns it | §3.6 |
| **Medium** | KV keyspace, R2 serving and the client have no owner | §5 |
| **Low** | [[PRD]] §7 and [[MODULES]] §7 are two different phase tables | §6 |

---

## 2. Schema defects — the only unfixable ones

Verified directly against [[PLAN]] §"Data model (D1)".

**2.1 `answers` timestamps are not nullable.** `chosen_option`, `numeric_value` and `is_correct`
are explicitly marked `NULL`; `served_at_ms`, `answered_at_ms` and `elapsed_ms` are not. But
[[SCHEDULER]] §3.1's close pass must score positions the student never reached, which by
definition have no `served_at`. **The close job cannot insert.** Make all three nullable.

**2.2 `quiz_seats` has no per-user uniqueness.** `PK(quiz_id, seat_no)` alone does not stop one
user winning two seats when [[QUIZZING]] §5.1's conditional `UPDATE` is retried. A leaked seat is
a permanently consumed slot and a false `room full` (ROOM-14) at cap 120 — the exact scenario the
Phase 4 load test is designed to produce. Add `UNIQUE(quiz_id, user_id)`.

**2.3 There is no way to tell "deadline passed" from "board computed."** Add
`quizzes.board_computed_at`. See §3.3 for why.

Plus the already-agreed `import_id` on `questions` and `passages` ([[BANK]] §3.3).

**Do not add a `'closing'` status.** It looks like the fix for a close job that dies mid-way, but
a job that flips to `'closing'` and then dies no longer matches
`status IN ('open','running')` — so the next tick skips it and the quiz never closes at all.
`board_computed_at IS NULL` is the safe predicate; it is a re-entrancy marker, not a state.

---

## 3. Boundary conflicts

### 3.1 SCHEDULER writes six tables it does not own

[[MODULES]] §"Table ownership" lists [[SCHEDULER]] as a *reader* only — and for `quiz_seats`,
`participants` and `answers` the "Read by" column is literally `—`. [[SCHEDULER]] §1 says it
"owns no table of its own." Then:

| [[SCHEDULER]] says | Table | Declared sole writer |
|---|---|---|
| §3.1 "Seed `quiz_seats` 1..cap" | `quiz_seats` | [[QUIZZING]] |
| §3.1 "set `status = 'open'` / `'running'` / `'ended'`" | `quizzes` | [[QUIZZING]] |
| §3.1 "Score unreached positions 0, rank once" | `answers`, `participants` | [[QUIZZING]] |
| §3.2 expand templates into concrete `quizzes` rows | `quizzes` | [[QUIZZING]] |
| §3.3 "write `weekly_boards`" | `weekly_boards` | [[QUIZZING]] |
| §3.1 "Claim in `telegram_posts`, then send" | `telegram_posts` | [[TELEGRAM]] |

[[BANK]] and [[QUIZZING]] got a real seam — `claimUnused` has a signature and defined race
semantics. The [[SCHEDULER]] seam got an arrow in a diagram. [[SCHEDULER]] is also **the only
module document with no "Interfaces" section**, which is the structural tell.

This reads worse than it is. [[SCHEDULER]] §1 does say it "calls into [[QUIZZING]] and
[[TELEGRAM]]" — the defect is an unnamed interface, not a contradicted intent. It is an hour of
work and no schema change.

**Proposed fix — [[QUIZZING]] exposes, [[SCHEDULER]] issues zero SQL:**

```ts
openRoom(quizId, now)            → { seatsSeeded: number; alreadyOpen: boolean }
startQuiz(quizId, now)           → boolean
closeQuiz(quizId, now)           → CloseResult   // { participantCount, top10, boardComputedAt }
materializeTemplates(days, now)  → { quizIds: string[] }
computeWeeklyBoards(weekStart)   → BoardSummary[]
```

and [[TELEGRAM]] exposes the claim, so `telegram_posts` keeps one writer:

```ts
claimAndSend(kind, quizId | weekStart, payload) → { sent: boolean; skipped: boolean }
```

`closeQuiz` returning `top10` also removes [[TELEGRAM]]'s raw read of `participants` for TG-4 —
pass the DTO instead.

**Note the counter-argument, and why it was rejected.** One reviewer argued [[SCHEDULER]] should
be deleted as a module — reduced to `core/schedule.ts` plus a thin cron entrypoint, with open and
close moved inside [[QUIZZING]] where the invariants live. It reaches the same runtime, but the
cron entrypoint still needs the same five functions, and [[SCHEDULER]] §4 (idempotency) and §5
(the UTC/IST cron bug) are among the best-reasoned material in the set. Naming the interface gets
the whole benefit; deleting the document loses the reasoning.

### 3.2 QUIZ-7 recurring quizzes materialize with zero questions

The sharpest finding in the audit, and it is a genuine hole rather than an ambiguity.

[[MODULES]] §"Two things that are easy to get backwards" pins question selection to **quiz
creation**, because locking is what retires questions via `claimUnused` (QUIZ-5). But
[[SCHEDULER]] §3.2 materializes `quiz_templates` into concrete `quizzes` rows **hourly, with no
admin present**. There is no third path. So either:

- the materializer becomes a second caller of `claimUnused` — with no QUIZ-3 composition report
  and no QUIZ-4 preview, both of which assume an admin is looking; or
- recurring quizzes materialize empty and a scheduled quiz opens with no questions in it.

QUIZ-7 currently has no owner for its draw. **Decide before Phase 7**: either give the
materializer an unattended draw (and accept that QUIZ-3/QUIZ-4 do not apply to recurring quizzes,
with pool exhaustion alerting instead), or mark QUIZ-7 explicitly deferred.

### 3.3 The 423 gate is undefined

[[QUIZZING]] §6 says every results endpoint returns 423 "before the deadline" — a **clock**.
[[SCHEDULER]] §3.1 says the close pass computes the ranking, and §6 admits cron "can be late and
it can be skipped entirely."

- Gate on `now >= ends_at` → students unlock a leaderboard where `participants.rank` is still NULL.
- Gate on `status = 'ended'` → one skipped tick locks every student out of their results
  indefinitely.

NFR-4 calls secrecy "a structural guarantee." As written it depends on a best-effort cron owned by
a different module.

**Proposed:** gate on `board_computed_at IS NOT NULL` (§2.3), and have the results endpoint run
`closeQuiz` **inline** when `now >= ends_at AND board_computed_at IS NULL`. Cron becomes an
optimisation rather than a dependency.

The same trick applies at the other end: let `join` open the room lazily using the same predicate
as the open pass. Today cron is the *only* thing that seeds `quiz_seats`, so a skipped open tick
does not present as "not open yet" — it presents as **120 students hitting `room full`**
(ROOM-14), because there are no seats to claim. A few lines at each end delete the cron single
point of failure for G1.

### 3.4 AUTH-5's "immediate" revocation is not immediate

[[AUTH]] §3.2:

> write D1, delete KV key ← revocation is immediate

[[QUIZZING]] §9:

> KV is eventually consistent — up to ~60 seconds globally. **Never** use it where a write must be
> visible to the next request.

A KV *delete* propagates on the same eventually-consistent path as a write. AUTH-5's acceptance
criterion — "demoting an admin revokes access on their **next** request" — cannot be met by this
mechanism, and [[AUTH]] §8's revocation test cannot pass. The two documents describe the same
mechanism and reach opposite conclusions.

**Proposed:** keep the KV role cache for student-path reads, but **read the role from D1 on admin
and superadmin routes**. Those are low-volume; correctness matters more than a cached read.

Two related points nobody had costed: per-request role reads add roughly 4,500 KV reads per quiz
against [[PLAN]]'s estimate of ~2,600 and a 100k/day free-tier cap, so KV joins Worker requests as
a binding constraint on NFR-1. And [[AUTH]] open question 3 (admin demoted mid-quiz) has a sharper
edge than it looks: nothing stops an admin holding a seat in a quiz whose answers they can fetch
through the bank's admin routes. [[QUIZZING]] invariant 2 protects `ServedQuestion` only, so
NFR-4's structural guarantee holds for students, not admins.

### 3.5 The close job's cost argument is already false

[[SCHEDULER]] §6 argues the close job stays inside a cron invocation's budget because scoring
happens at answer-write time, "leaving the close job to SUM and rank," and adds: "If that ever
moves, this job needs chunking."

It already moved. §3.1 requires scoring unreached positions 0, which means **inserting** `answers`
rows for every position no student reached — up to 120 × 20 = **2,400 writes** in one invocation,
against D1 batch limits and the 50-subrequest cap. This is the Phase 5 job, running live.

**Proposed:** do not materialize zero rows. `participants` already carries `skipped_count`,
`total_score` and `current_position`; the **absence** of an `answers` row is what "not reached"
means. The review screen (RESULT-4) renders a missing row as unattempted. This also makes §2.1
moot for the close path, though the nullable columns are still worth having.

### 3.6 `status='cancelled'` is owned by nobody

[[PLAN]]'s `quizzes` DDL includes `'cancelled'` in the status enum. No requirement in [[PRD]], no
route in any module, and no job ever sets it. [[QUIZZING]] open question 4 (abort/void a quiz) and
[[TELEGRAM]] open question 3 (does a cancelled quiz get a post) both defer to a [[PRD]] §9 decision
that was never made.

**There is currently no way to stop a broken live quiz.** For a system whose G1 is "no operator
present," the missing escape hatch matters more than usual.

### 3.7 BANK's `getForQuiz` inverts the dependency arrow

[[MODULES]] states "nothing points back up" and that [[BANK]] "knows nothing about quizzes beyond
an id it is handed." But [[BANK]] §5 exposes `getForQuiz(quizId)`, which can only be implemented by
reading [[QUIZZING]]'s `quiz_questions` table to learn which questions and what order.

Minor, and easily fixed: have [[QUIZZING]] resolve `quizId → questionIds` itself and call
`getByIds(questionIds)`. The arrow stays pointing down.

---

## 4. Requirements with no route in any module

[[QUIZZING]] §2 claims QUIZ-1..10, ROOM-1..16, SCORE-1..8, RESULT-1..8, BOARD-1..8, ADMIN-1 and
ADMIN-2 — but §5's route table covers **only the run**. There is no route anywhere in the five
documents for:

| Missing | Requirement | Consequence |
|---|---|---|
| `GET /api/quizzes/open` | **TG-8** | The named fix for the TG-3 single point of failure ([[TELEGRAM]] §5.1) exists in no route table. A failed T−5m post silently cancels the quiz until it ships |
| `GET /api/images/:key` | **BANK-4** | R2 is "cross-cutting… needs an owner" ([[MODULES]] §5) and no owner is named. Phase 2 imports images it cannot display |
| Review, distribution, own-time-vs-average | **RESULT-4, 5, 6** | All of G5 |
| Per-quiz and weekly board | **BOARD-3, BOARD-8** | TG-4 and TG-5 link to a page nobody owns |
| Student history | **RESULT-8** | — |
| Quiz create / reshuffle / lock | **QUIZ-1..5** | All of Phase 3 has no route table |
| Report export | **ADMIN-2** | Phase 8 in [[PRD]] §7 |

Also claimed in a §2 but absent from the body: **ROOM-15** (a late joiner gets the full sequence
but only the remaining time — `join` is documented as returning "quiz meta + question 1" and
nothing about a shortened window), **ROOM-16**, and **QUIZ-9**'s clamp of the seat cap to 120.

---

## 5. Non-table boundaries with no owner

- **KV has no ownership row at all.** [[AUTH]] writes `role:<uid>` and the JWKS cache,
  [[SCHEDULER]] warms the question cache at room open and the board cache at close, [[QUIZZING]]
  reads both. R2 at least got [[MODULES]] §5; KV got nothing — and it is the site of the §3.4
  contradiction and an uncosted ~4,500 reads/quiz.
- **R2 serving.** [[MODULES]] §5 says storage is "big enough to need an owner" and then names none.
  [[BANK]] §5's route list has no serving route.
- **The client has no module.** [[BANK]] disclaims LaTeX ("that is client-side KaTeX") and nobody
  claims it, so **BANK-3** is homeless. So are **NFR-5** (mobile-first) and [[AUTH]] open question 2
  (silent session refresh). [[MODULES]] §7 says "frontend and backend move together inside a phase,"
  which is a scheduling statement, not an ownership one.
- **Observability**, already self-declared unowned in [[MODULES]] §6. Related: **[[PRD]] §4's
  success metrics have no owner** — "questions served twice: 0", "100% of quizzes started without
  intervention", ">90% completion", "<500 ms median". Nothing measures any of them, which means the
  question "are we meeting our goals" is currently unanswerable by construction.

---

## 6. Two phase tables that disagree

[[PRD]] §7 and [[MODULES]] §7 are different tables. [[PRD]] puts BOARD-1,2 in Phase 5 and TG-1..8
in Phase 6; [[MODULES]] puts [[TELEGRAM]] at 6 and boards + recurring at 7. Separately, **ADMIN-1
and BOARD-3 appear in no phase at all**, NFR-1/4/7/8/9 appear in no phase, and **no module's §2
claims a single NFR**. Reconcile into one table and make it the only one.

One live consequence: [[TELEGRAM]] §5.1 and §9 both say the TG-8 open-quiz endpoint "needs
building in Phase 4," while [[PRD]] §7 phases TG-1..8 at 6. Until it ships, [[TELEGRAM]] §5.1's own
instruction stands — TG-3 is quiz-critical and must be alerted on, not fire-and-forget.

---

## 7. Claims checked and rejected

Recorded so they are not acted on later.

| Claim | Verdict |
|---|---|
| "`served_at(n) = answers[n−1].answered_at` breaks when a student abandons a question" | **Wrong.** Row n−1 always exists — it is what served question n. Resume is correct as specified, and invariant 4 holds |
| "NFR-6 contradicts [[QUIZZING]] §5.4 on whether a disconnect costs the student" | **Overstated.** NFR-6 protects "their place or their answers," not elapsed time. ROOM-13's "with the time remaining on it" is explicit that the clock runs |
| "[[MODULES]] §Table ownership is factually false" | **Overstated.** [[SCHEDULER]] §1 does say it calls into [[QUIZZING]] and [[TELEGRAM]]. The defect is an unnamed interface (§3.1), not a contradicted intent |
| "TG-8 is a Phase 4 requirement" | **Wrong per [[PRD]] §7**, which phases TG-1..8 at 6. [[TELEGRAM]] is what disagrees with the [[PRD]] — see §6 |
| Add a `'closing'` quiz status | **Rejected.** Creates a state no predicate matches; see §2 |

---

## 8. Goal-by-goal verdict

| Goal | Verdict | Reason |
|---|---|---|
| **G1** — runs with no operator present | **At risk** | Depends entirely on a cron with no named interface (§3.1), no run record, no manual close ([[SCHEDULER]] OQ4), and no alerting owner. A skipped tick is invisible at open (§3.3) and unrecoverable at close |
| **G2** — no dead time for ~100 students | **Safe** | The one-round-trip design ([[QUIZZING]] §5) is structural, budgeted, and load-tested in Phase 4. Only defect: seats can leak (§2.2) |
| **G3** — never serve the same question twice | **Partial** | `claimUnused` plus the one-way `used_in_quiz_id` is the strongest work in the set. The hole is QUIZ-7 (§3.2), plus open questions on pool exhaustion and editing a used question |
| **G4** — per-quiz and weekly ranking | **Partial** | Rankings are computed and posted to Telegram, but **nothing serves a board** (§4). TG-4 and TG-5 link to a page no module owns |
| **G5** — see what you got wrong and why | **At risk** | No route for RESULT-4/5/6/8 or BANK-4 image serving, and BANK-3 (LaTeX) is disclaimed by [[BANK]] and claimed by nobody. All of G5 renders in a client with no module (§5) |

---

## 9. Recommended order

Fix the schema, name the interfaces, add the missing routes, then build. Nothing here is a
rewrite.

**Before Phase 1 — unfixable later:**

1. `migrations/0001_init.sql` with §2's corrections: nullable `answers` timestamps,
   `UNIQUE(quiz_id, user_id)` on `quiz_seats`, `quizzes.board_computed_at`, `import_id` on
   `questions` and `passages`.
2. Resolve [[BANK]] open question 1 as **hard-lock the key, editable body**: freeze
   `correct_option`, `numeric_answer` and `used_in_quiz_id`; permit `body_md` and `explanation_md`
   edits, so a typo in an explanation stays fixable under NFR-9 and RESULT-4 at zero schema cost.
3. Fix [[AUTH]] §3.2 (§3.4) — it is a Phase 1 module and the contradiction is in its core mechanism.

**Before Phase 4:**

4. Add [[SCHEDULER]] §5 with the five signatures; [[SCHEDULER]] issues no SQL (§3.1).
5. Lazy open on `join`, lazy close on the results endpoint (§3.3).
6. Add the missing routes to the [[QUIZZING]] and [[BANK]] route tables (§4).
7. Decide the abort/void escape hatch, or delete `'cancelled'` from the enum (§3.6).
8. Give KV, R2 serving and the client an owner (§5).

**Before Phase 7:**

9. Resolve QUIZ-7's draw, or mark it deferred (§3.2).

**Explicitly rejected as scope creep** at this scale — one developer, ~100 students, zero budget:
restructuring [[SCHEDULER]] out of existence; question versioning; a `recordItemStats` capture
path; a `job_runs` table (a run record is derivable from `quizzes.ended_at`, `board_computed_at`
and a participant count — ship the failure alert to `TELEGRAM_ALERT_CHAT_ID` instead); a bank
inventory endpoint (a `GROUP BY` on the existing BANK-8 browse screen, not a new capability).

---

## 10. The one thing to do first

Write `migrations/0001_init.sql`, having first settled [[BANK]] open question 1. Every defect in
§2 is unfixable once real student data exists. Nothing else in this audit is.

---

## 11. Resolutions — decided 2026-09-04

Every finding above, resolved one at a time and then applied across [[PLAN]], [[MODULES]],
[[SCHEDULER]], [[QUIZZING]], [[AUTH]], [[BANK]], [[TELEGRAM]] and [[PRD]]. Decisions with a real
product trade-off were made by the project owner; the rest were mechanical fixes with no
reasonable alternative and were applied directly.

### Schema and mechanical fixes — applied as proposed, no live decision needed

| # | Finding | Resolution | Applied to |
|---|---|---|---|
| 1 | §2.1 `answers` timestamps not nullable | Made `served_at_ms`, `answered_at_ms`, `elapsed_ms` nullable | [[PLAN]] DDL |
| 2 | §2.2 `quiz_seats` no per-user uniqueness | Added `UNIQUE(quiz_id, user_id)` | [[PLAN]] DDL |
| 3 | §2.3 no way to tell "deadline passed" from "board computed" | Added `quizzes.board_computed_at` | [[PLAN]] DDL |
| 4 | [[BANK]] §3.3 `import_id` for atomicity | Added `import_id NULL` to `questions`, `passages` | [[PLAN]] DDL |
| 5 | Tempting `'closing'` status | **Rejected**, as originally argued — `board_computed_at IS NULL` is the re-entrancy marker | No change |
| 6 | §3.1 [[SCHEDULER]] writes six tables with no named interface | Named the interface — [[QUIZZING]] exposes `openRoom`, `startQuiz`, `closeQuiz`, `materializeTemplates`, `computeWeeklyBoards`; [[TELEGRAM]] exposes `claimAndSend`. [[SCHEDULER]] issues zero SQL | [[SCHEDULER]], [[QUIZZING]], [[TELEGRAM]] |
| 7 | §3.3 the 423 gate is undefined | Gate on `board_computed_at IS NOT NULL`. Results endpoint runs `closeQuiz` inline when overdue; `join` opens the room lazily on the same predicate as the cron open pass. Cron becomes an optimisation, not a dependency | [[QUIZZING]], [[SCHEDULER]] |
| 8 | §3.5 close job inserts up to 2,400 `answers` rows per invocation | Do not materialize zero rows. Absence of an `answers` row **is** "not reached"; `participants` already carries the aggregates; the review screen renders a missing row as unattempted | [[QUIZZING]], [[SCHEDULER]] |
| 9 | §3.7 [[BANK]]'s `getForQuiz` reads [[QUIZZING]]'s table | [[QUIZZING]] resolves `quizId → questionIds` itself and calls [[BANK]]'s `getByIds(questionIds)` instead | [[BANK]], [[QUIZZING]] |
| 10 | §4 requirements with no route | Added routes for TG-8, BANK-4, RESULT-4/5/6/8, BOARD-8, QUIZ-1..5, ADMIN-2; annotated ROOM-15/16 and the QUIZ-9 clamp where they already live | [[QUIZZING]], [[BANK]] |
| 11 | §5 KV has no ownership row | Added a KV keyspace ownership table (same shape as the D1 table-ownership one): `jwks:*`/`role:<uid>` → [[AUTH]]; `question:<quizId>`/`board:<quizId\|weekStart>` → [[QUIZZING]] (written inside `openRoom`/`closeQuiz`/`computeWeeklyBoards`) | [[MODULES]] |
| 12 | §5 R2 serving has no owner | [[BANK]] owns it end-to-end — import **and** serving. Added `GET /api/images/:key` | [[BANK]], [[MODULES]] |
| 13 | §6 [[PRD]] §7 and [[MODULES]] §7 are two different phase tables | [[PRD]] §7 is now the single authoritative req↔phase table; [[MODULES]] §7 points to it instead of duplicating. Added the orphaned ADMIN-1 (cumulative, no single phase) and BOARD-3 (Phase 5, alongside BOARD-1/2); NFR-1/4/7/8/9 noted as cross-cutting rather than phase-gated | [[PRD]], [[MODULES]] |

### Product decisions — made by the project owner

| # | Finding | Options considered | Decision | Reasoning |
|---|---|---|---|---|
| 14 | [[BANK]] open question 1 — editing a used question | Version it / hard-lock everything / hard-lock key, editable body | **Hard-lock key, editable body** | Reuse in another quiz was already permanently blocked by `used_in_quiz_id` — not in question. The only live concern is a typo in `body_md`/`explanation_md` surfacing forever on that quiz's review screen (history is retained indefinitely). `correct_option`, `numeric_answer`, `used_in_quiz_id` freeze forever regardless; the display text stays fixable |
| 15 | §3.6 `status='cancelled'` has no owner | Add an abort/void route / delete the enum value | **Add an abort/void escape hatch** | G1 promises no operator present, which makes the *absence* of a way to stop a broken live quiz worse than usual. New admin route sets `status='cancelled'`; every [[SCHEDULER]] pass already excludes it structurally since none of its predicates match `'cancelled'` |
| 16 | §3.2 QUIZ-7 recurring quizzes materialize with zero questions | Unattended auto-draw / admin locks each occurrence | **Unattended auto-draw** | Consistent with G1 and with why recurring templates exist at all. The materializer becomes a second caller of `claimUnused`, using the template's saved settings. Accepted trade-off: QUIZ-3's composition report and QUIZ-4's reshuffle don't apply to recurring quizzes; pool exhaustion alerts rather than blocks |
| 17 | §3.4 admin back-door around NFR-4 via [[BANK]]'s admin routes | Extend the secrecy guarantee to admins / leave as-is | **Leave as-is, no fix** | Admin-role holders are trusted teachers who authored the question and already know the answer — there is no student-facing exposure to close. Recorded so it isn't re-raised as a live gap |
| 18 | §3.4 AUTH-5's "immediate" revocation isn't immediate (KV delete propagates in up to ~60s) | Split reads — D1 on admin-gated routes, KV elsewhere / shorten the KV TTL globally / accept eventual consistency and reword AUTH-5 | **Accept eventual consistency, reword AUTH-5** | Low-stakes single-operator project; a superadmin will rarely if ever demote someone, and a ~60s window is not worth a route-level D1/KV split today. AUTH-5's acceptance criterion changes from "next request" to "within ~60 seconds." The route-split fix is recorded as a deferred future improvement, not built | [[AUTH]], [[PRD]] |
| 19 | §5 "the client has no module" — BANK-3, NFR-5, [[AUTH]] open question 2 are homeless | New §6.5 cross-cutting block in [[MODULES]] / full `CLIENT.md` / distribute into [[BANK]]/[[AUTH]] | **New §6.5 cross-cutting block, scoped narrowly** | Mirrors how Storage and Observability are already handled — no new document for three thin concerns. NFR-5 (mobile-first) is dropped from the block: the mockups already settle it as a design deliverable, so it needs no module-ownership note. §6.5 covers only KaTeX rendering (BANK-3) and silent session refresh ([[AUTH]] OQ2) | [[MODULES]] |
| 20 | §6 observability graduating to its own doc | Write `OBSERVABILITY.md` now / leave the [[MODULES]] §6 stub | **Leave the stub** | The minimum-viable version in [[MODULES]] §6 is already concrete and actionable. A full doc today would mean inventing log schemas and alert thresholds against zero real traffic — [[MODULES]] §7 already schedules the real doc for right before Phase 4, which stands | No change |

### What this leaves genuinely open

Unaffected by this pass, still tracked in each module's own §"Open questions": pool exhaustion
policy, window-length derivation, the seat cap's value, idle-abandonment handling, admin live
monitor, item analysis, duplicate detection on import, session TTL length, silent-refresh
strategy, and whether a demoted mid-quiz admin gets ejected. None of these block Phase 1.
