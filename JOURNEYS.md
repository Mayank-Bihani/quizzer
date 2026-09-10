# Quizzer — User Journeys

> **Scope:** every path a human takes through the app, end to end, per role. This is the input
> to **UI mockups** — one screen inventory, derived from journeys, mapped to [[PRD]]
> requirement IDs.
> **Not in scope:** visual design. Tokens and components live in [[DESIGN_SYSTEM_PROMPT]].
> Requirements in [[PRD]], architecture in [[PLAN]], module boundaries in [[MODULES]].
> **Status:** V1 journeys revised for agreed timing/batching behavior; not implemented.
> **Last updated:** 2026-09-09

---

## 1. Roles, and how you get one

There is **no self-service registration for elevated roles** (AUTH-3, AUTH-4). Everyone who
signs in with Google becomes a `student`. Admins are *promoted* by a superadmin; the first
superadmin is bootstrapped from a deploy secret on their first sign-in and never through the UI.

| Role | Becomes one by | Sees |
|---|---|---|
| **Student** | Signing in with Google (AUTH-1) | Student app only |
| **Admin** | Being promoted by a superadmin (AUTH-5) | Student app **plus** admin console |
| **Superadmin** | `SUPERADMIN_EMAIL` deploy secret (AUTH-4) | Everything, plus Manage Admins |

**Consequence for mockups:** an admin is also a student. Every admin screen needs a way back to
the student app, and admins take quizzes like anyone else. There is no separate "admin login".

---

## 2. Journey index

| ID | Journey | Role | Phase |
|---|---|---|---|
| **SJ-1** | First sign-in | Student | 1 |
| **SJ-2** | Find an upcoming quiz | Student | 3 |
| **SJ-3** | Join a live quiz | Student | 4 |
| **SJ-4** | Take the quiz | Student | 4 |
| **SJ-5** | Interruption, resume, late join | Student | 4 |
| **SJ-6** | Finish → wait → rank | Student | 5 |
| **SJ-7** | Review my answers | Student | 5 |
| **SJ-8** | Browse my history | Student | 5 |
| **SJ-9** | Read the leaderboards | Student | 5, 7 |
| **SJ-10** | Miss a quiz / be turned away | Student | 4 |
| **SJ-11** | Account and sign-out | Student | 1 |
| **AJ-1** | Become an admin | Admin | 1 |
| **AJ-2** | Import questions from CSV | Admin | 2 |
| **AJ-3** | Manage the question bank | Admin | 2 |
| **AJ-4** | Create and schedule a quiz | Admin | 3 |
| **AJ-5** | Set up a recurring quiz | Admin | 7 |
| **AJ-6** | Manage the schedule | Admin | 3 |
| **AJ-7** | Watch a quiz run (deferred) | Admin | 4 |
| **AJ-8** | Read a quiz report and export it | Admin | 5, 8 |
| **AJ-9** | Cancel a quiz | Admin | 5 |
| **XJ-1** | Manage the admin roster | Superadmin | 1 |
| **SYS-1..6** | Time-driven state changes, no user present | — | 4, 6, 7 |

---

## 3. Student journeys

### SJ-1 — First sign-in

1. Lands on the app, signed out. Sees a **sign-in screen** — one Google button, no other method (AUTH-1).
2. Google account chooser.
3. First sign-in creates a durable user record, role `student` (AUTH-2, AUTH-3).
4. Arrives at **student home**.

*Returning:* session persists across quizzes, and must outlast a full quiz window plus a review
session (30-day session; [[AUTH]] §7).
*Failure paths:* auth cancelled, token rejected, session expired mid-quiz.
*Guard:* a signed-out visitor cannot reach any quiz, bank or leaderboard screen — they land here.

### SJ-2 — Find a quiz

Telegram announces at T−2h and T−30m. The app is the independent entry point if Telegram fails.
Show admission times (IST), graded question count, timed-unit count, timing summary, individual
duration and seat cap. Release the room code and join invitation at T, not at T−5m preparation.

### SJ-3 — Join

At T−5m the backend prepares seats and content. The pre-join view can show rules/countdown;
there is no student timer or reserved participant before admission. During
`scheduledAt <= now < endsAt`, joining claims a seat and serves unit 1, starting this student's
full overall duration. Existing participants resume rather than claiming another seat.
A full room rejects the next new participant; practice mode remains deferred.

### SJ-4 — Take the quiz

The server serves a complete active unit: one standalone question or one RC/LRDI set. Display
one subquestion at a time with shared material/image pinned. All students get the same ordering,
but may navigate inside their active set. Units display 1, 2, 3; grouped subquestions 1.1, 1.2,
etc. Show a shared **set timer** (or standalone timer) and a distinct **personal overall timer**.

- Answer/Next saves the current response locally and advances.
- Skip clears any answer, records an explicit local skip and advances; it scores zero.
- Back and the unit navigator revisit questions; saved responses/skips remain editable.
- Clear makes a response unresolved again.
- The final outstanding answer/skip automatically freezes and submits the whole unit in one
  batch. Label it "Answer & finish set" / "Skip & finish set". No extra confirmation step.
- Wait for acknowledgement before advancing into the next unit. Retain the pending batch and
  retry key; prevent further edits to a frozen submission.
- A closed unit never reopens, even if it had unused time. A standalone closes on its only response.

Timing never resets on local navigation. Reading and answering share the same set allowance.
No per-question bonus/grace band or correct/incorrect feedback exists. There is no running
score, explanation, rank or live board. Marks are correct/wrong/zero only.

When the editing timer expires, freeze and submit the local draft with unresolved responses
marked unanswered. Show a submitting state during the five-second delivery window; do not allow
further edits. Acceptance follows [[PRD]] §5.4. The interface must not claim success until the
server acknowledges it. The overall deadline stops all editing and prevents a new unit starting.

### SJ-5 — Interruption, resume, late join

Same-browser reload restores local draft/selected subquestion for the server's current unit,
with its original start/deadline. If the unit already closed, discard its editable draft and
use server state. An accepted batch with a lost response can be retried without double scoring.
Another device or cleared browser storage cannot recover unsent local responses. A frozen batch
that misses the five-second server receipt cutoff cannot be scored; show that outcome honestly.
Late joining during admission gives the full individual duration, not a shortened shared cutoff.

### SJ-6 — Finish → wait → rank

On last-unit closure or overall expiry, show own total score and committed answered count only.
The holding screen shows how many participants finished and an estimated unlock time. Rank and
review remain locked until safe quiz close and committed board completion, even if the estimate
has passed. No intermediate set score or correctness breakdown appears while still playing.

### SJ-7 — Review answers

After board completion, participants can navigate every question across all units. Show final
response, correct answer, marks, explanation and MCQ distribution across all participants.
A/B/C/D plus `not answered` cover the whole room; the latter includes skips, unanswered
timeouts/unsubmitted responses and unreached questions. Show **unit completion time versus the
room average once per unit**, including reading; individual subquestion time is unknown.
Outcomes distinguish correct, wrong, explicit skip, unanswered in an expired/partial unit, and
an unreached unit. No accepted answer row does not by itself prove the question was unseen.

### SJ-8 — Browse my history

Every quiz the student has taken, with score and access to each review (RESULT-8). History is
retained indefinitely (NFR-9). Entry point back into SJ-7 for any past quiz.

### SJ-9 — Read the leaderboards

- **Per quiz** — computed once after safe close and committed ranking, visible **to participants of that
  quiz only**. There is **no live or partial leaderboard** at any point during a quiz (BOARD-2).
- **Weekly** — ranked on **total score across quizzes taken in the week** (BOARD-4), no minimum
  quiz count (BOARD-5), produced **per section (Verbal, Quant, LR) and combined** (BOARD-6).
  Visible to **every
  signed-in student**, participant or not — a weekly board aggregates the whole group.

**There is no all-time leaderboard.** Weekly boards are the only standing ranking. *(Decided
2026-09-03.)*

Real Google names appear within the board's access scope. Per-quiz ties break on total reached-unit
completion time; exact ties share a dense rank. The per-quiz web board shows top 10 plus the
viewer's own row. Weekly web boards are full/paginated; Telegram carries top 10 plus links.
Exact weekly total-score ties share a dense rank; quiz count is context, not a divisor or
secondary tie-break.

### SJ-10 — Miss a quiz, or be turned away

No practice mode in v1 ([[PRD]] §8). The student sees the quiz in history as not-attempted, or
nothing at all.

**A non-participant sees neither the review nor the per-quiz leaderboard for a quiz they missed.**
Both are participant-only. They still see the **weekly boards**, which aggregate the group.
*(Decided 2026-09-03.)*

**Consequence for the UI:** a "you did not take this quiz" state on both the review and the
per-quiz leaderboard, reached from history or from a shared link. It should not read as an error
— it is a normal outcome of missing a quiz.

### SJ-11 — Account and sign-out

Profile (Google name and photo), sign out, and — for admins — the switch into the admin console.
A student who reaches an admin URL gets a **403**, not a redirect loop (AUTH acceptance).

---

## 4. Admin journeys

### AJ-1 — Become an admin

Not a registration. The student signs in normally (SJ-1) and a superadmin promotes them (XJ-1).
On their next request they gain the admin console. Demotion revokes access on the next request —
so an admin can lose the console mid-session and must land somewhere sane, not on a broken screen.

### AJ-2 — Import questions from CSV

The most error-prone admin path, and the one with the strictest rule: **nothing is written until
the admin confirms, and a failed import writes nothing at all** (BANK-7).

1. Uploads a **CSV**, optionally with a **companion ZIP** of question images (BANK-1, BANK-4).
2. The system validates and produces a **preview**: valid rows, and malformed rows reported
   **with line numbers** and what is wrong (e.g. a missing `correct` column, an unknown `passage_ref`).
3. Admin reads the preview, fixes the file or proceeds.
4. **Commit** — an explicit, unambiguous step. Only now is anything written.

Each question row carries section type, topic, difficulty and explanation; sub-topic and
source/provenance are optional (BANK-5). It is either **MCQ** (4 options, one correct) or
**TITA** (numeric with tolerance) (BANK-2). A **passage**
is itself a row, referenced by the 4–5 questions attached to it (BANK-6). Bodies and explanations
render **LaTeX** (BANK-3).

*Failure paths:* malformed CSV, ZIP/CSV image mismatch, duplicate questions (open question #8),
partial upload.

### AJ-3 — Manage the question bank

Browse, **filter by type / topic / difficulty / used-unused**, edit, delete (BANK-8). Every question
and passage shows whether it has been used and in which quiz (BANK-9). Passage groups are shown
and handled as one indivisible unit.

Used questions cannot be deleted. Solution/option identity freezes after retirement; body and
explanation typos remain editable under BANK's existing rules. Shared RC/LRDI content is one group.

### AJ-4 — Create and schedule a quiz

1. Define section, graded question count and difficulty mix.
2. Draw whole unused groups plus standalones; fail loudly if the requested composition is impossible.
3. Preview explicit timed units and graded questions. Example: one four-question set plus two
   standalones = six questions and three units. Reshuffle before lock if needed.
4. Configure default allowances by unit kind, optionally override individual units, set correct
   and wrong marks, transition slack and seat cap. No bonus/grace settings.
5. Schedule admission time and length; preview derived personal duration (sum of unit allowances
   plus slack). Admission length is independent. Reshuffle clears unit overrides and recomputes.
6. Lock: validate all units/settings, retire content through BANK, assign room code/quiz number
   and schedule. Retirement is irreversible; partial claims must not lock a quiz.

The code becomes public only when admission begins. All settings freeze once room preparation
sets status open. Pool exhaustion does not draw fewer questions or reuse older questions.

### AJ-5 — Recurring quizzes

Templates store selection filters, recurrence, timing defaults by kind, slack, admission length,
marks and cap. Each occurrence derives its duration from its actual draw. Template CRUD UI is
still deferred; backend template configuration can be managed through D1 until that feature ships.

### AJ-6 — Manage the schedule

States: draft → scheduled → open → ended; cancelled is an admin exit from draft/scheduled/open.
Open includes preparation and does not itself imply admission has begun. Show admission interval,
individual duration and unit/question counts. Reports are available only after board completion.

### AJ-7 — Live monitor (deferred)

Not in V1. No operator is required to run a scheduled quiz.

### AJ-8 — Report and export

After board completion: participant marks/ranks, correct/wrong/skipped/unanswered counts,
per-question outcome counts, total unit time and per-unit timing aggregates. Export these results;
full item analysis remains deferred. There are no per-question timing estimates or bonus totals.

### AJ-9 — Cancel a quiz

An admin can cancel a draft, scheduled or open quiz. Reject further gameplay; scheduler passes
exclude it and a cancellation notification is routed through scheduler orchestration. Retired
questions never return to the pool. No regrading or result-recompute UI is added.

---

## 5. Superadmin journey

### XJ-1 — Manage the admin roster

Promote a student to admin, demote an admin (AUTH-5, ADMIN-3). Demotion takes effect on the
target within the role cache's approximately 60-second propagation window. The superadmin themselves cannot be demoted through the UI, and the first
superadmin never appears as a promotion — they arrive via the deploy secret (AUTH-4).

---

## 6. System journeys — no user present

These change what a user sees **without anyone acting**. Mockups must cover the states either
side of each transition.

| ID | When | What changes on screen |
|---|---|---|
| **SYS-1** | T−2h, T−30m | Telegram posts only. No app-side change. |
| **SYS-2** | T−5m | Backend prepares seats and content; no code/admission or student clock yet. |
| **SYS-3** | Scheduled admission time | Code released, new joins allowed; each join starts an individual clock and unit 1. |
| **SYS-4** | Individual unit/overall deadline | Editing freezes; final delivery/expiry follows PRD. No new unit after overall deadline. |
| **SYS-5** | Safe quiz close and completed ranking | Rank/review unlock; result post is sent. |
| **SYS-6** | Completed IST week, all eligible quizzes finalized | Weekly boards computed/published; delayed runs postpone publication. |

Telegram is **not a UI surface** — the bot posts plain text into one group, accepts no commands,
handles no identity, sends no DMs. No screens come from [[TELEGRAM]].

---

## 7. Screen inventory

Target screen inventory for later frontend work. Existing mockup HTML and design-system
examples intentionally remain unchanged and must be reconciled with these journeys before use.
Backend phase references indicate API dependencies, not a requirement to build UI in that phase.

### Student

| Screen | Journeys | Phase |
|---|---|---|
| Sign-in | SJ-1 | 1 |
| Home — open, upcoming, recent | SJ-2 | 3 |
| Quiz detail (pre-join) | SJ-2 | 3 |
| Join by room code | SJ-3 | 4 |
| Lobby / countdown | SJ-3 | 4 |
| Room full | SJ-3, SJ-10 | 4 |
| **Question — MCQ** | SJ-4 | 4 |
| **Question — TITA** | SJ-4 | 4 |
| **RC/LRDI set** (pinned material, Back/Skip, shared timer, batch close) | SJ-4 | 4 |
| Resumed / late-join entry | SJ-5 | 4 |
| Finish — own score only | SJ-6 | 5 |
| Holding — waiting for the deadline | SJ-6 | 5 |
| Rank reveal | SJ-6 | 5 |
| Review — per question | SJ-7 | 5 |
| History list | SJ-8 | 5 |
| Leaderboard — per quiz | SJ-9 | 5 |
| Review / leaderboard — "you did not take this quiz" | SJ-10 | 5 |
| Leaderboard — weekly, by section + combined | SJ-9 | 7 |
| Profile / account | SJ-11 | 1 |
| 403 / 404 / session expired | SJ-11 | 1 |

### Admin

| Screen | Journeys | Phase |
|---|---|---|
| Console home | AJ-1 | 1 |
| Bank — browse and filter | AJ-3 | 2 |
| Question editor (MCQ / TITA) | AJ-3 | 2 |
| Passage group detail | AJ-3 | 2 |
| Import — upload | AJ-2 | 2 |
| Import — validation preview with line errors | AJ-2 | 2 |
| Import — commit confirmation | AJ-2 | 2 |
| Quiz builder — define | AJ-4 | 3 |
| Quiz builder — draw, composition report, reshuffle | AJ-4 | 3 |
| Quiz builder — scoring parameters | AJ-4 | 3 |
| Quiz builder — schedule | AJ-4 | 3 |
| Quiz builder — lock confirmation (irreversible) | AJ-4 | 3 |
| Schedule list (draft → closed) | AJ-6 | 3 |
| Recurring template management UI (deferred) | AJ-5 | — |
| Quiz report + export | AJ-8 | 5, 8 |
| Live monitor (deferred) | AJ-7 | — |
| Manage admins | XJ-1 | 1 |

### Cross-cutting, every screen

Empty · loading / skeleton · error · offline-reconnecting · toast · destructive confirm ·
403 · 404. Student screens are **phone-first** (NFR-5); admin screens are desktop-first.

---

## 8. Open questions that block mockups

None remain.

**Resolved 2026-09-09** (see [[AUDIT]] §11): abort/void a quiz — build it, yes, new admin route
(AJ-9); editing a used question — hard-locked key, editable body (AJ-3).

**Resolved 2026-09-05** (project owner, see [[PRD]] §9): admin live monitor — not built (AJ-7);
item analysis in the report — not built (AJ-8); pool exhaustion — fail loudly (AJ-4); window
length — auto-derived (AJ-4); pre-join content — countdown/rules; actual participation begins at admission;
holding-screen content — kept as originally specified, nothing added; score precision — `5.44`;
board length on web — top 10 plus the viewing student's own row (SJ-3, SJ-6, SJ-9).

## 9. Decisions log

| Date | Decision |
|---|---|
| 2026-09-03 | **No all-time leaderboard.** Weekly boards only. |
| 2026-09-03 | **Per-quiz leaderboard and review are participant-only.** Weekly boards are open to every signed-in student. |
| 2026-09-03 | **Skip is added to the run.** A student may advance without answering; scores 0. Historical immediate-lock behavior was superseded on 2026-09-09. |
| 2026-09-03 | **No device-equalising.** Screens use the full width available; students choose the device that suits the quiz. Fairness comes from free device choice, not from constraining laptops. |
| 2026-09-03 | **Phones are locked to portrait during a run**, removing the landscape edge case. |

| 2026-09-09 | Shared set clocks, editable local drafts/Back/Skip, automatic batched unit closure, no V1 speed bonus, unit-time tie-break; backend first. |
