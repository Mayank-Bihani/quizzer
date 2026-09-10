# Quizzer — Product Requirements Document

> **Scope of this document:** only what is finalised. Architecture, platform reasoning and
> free-tier budgets live in [[PLAN]] — this document deliberately does not repeat them.
> **Status:** V1 requirements revised 2026-09-09; not implemented.
> **Format:** scheduled admission, each student's own overall duration, shared timed RC/LRDI
> units and individually timed standalones. V1 uses marks only; speed bonuses are deferred to V2.
> **Authority:** this revision supersedes conflicting older audit decisions, sprint packets and
> mockups. The latter two are intentionally unchanged pending their separate revision.

---

## 1. Problem

A ~100-student Telegram group preparing for competitive exams (Verbal / Quant / Logical
Reasoning) has no structured practice mechanism. There is no way to run a quiz on a schedule,
no ranking, no record of what a student got wrong, and no managed question bank — so the same
questions get recycled and nobody can see whether they are improving.

## 2. Product goal

A **self-paced timed test that runs on a schedule** — everyone gets the same questions in the same
order during a scheduled admission window, with a full individual duration from joining. It ranks the room and
lets every student review their mistakes afterwards, operated entirely from the Telegram group
the students already live in, at ₹0 forever.

### Goals

- **G1** — Run a scheduled quiz start to finish with **no operator present**.
- **G2** — Give ~100 students an uninterrupted run with **no dead time** — navigation inside a set is local; submitting a completed unit
  serves the next unit immediately, and nobody ever waits on anybody else.
- **G3** — Never serve the same question twice across the life of the bank.
- **G4** — Produce a per-quiz ranking and a running weekly ranking per section.
- **G5** — Let a student see, after the quiz, exactly what they got wrong and why.

### Non-goals

- Not a classroom-games product (the focus is competitive-exam practice; see [[PLAN]] "Context").
- Not **lockstep** — no shared question clock, no synchronised advance, no mid-quiz reveal.
  This was the original format and was deliberately dropped; see [[PLAN]].
- Not an untimed practice tool. Shared set clocks, standalone clocks and negative marking make it timed exam practice.
- Not an anti-cheat system. Trust-based by design.
- Not a Telegram-first UI. The bot announces; the app plays.

## 3. Users and roles

| Role | Who | Can |
|---|---|---|
| **Student** | Group member, Google account | Join a live quiz, answer, see own results and review, see leaderboards and own history |
| **Admin** | Group organiser | Everything a student can, plus: manage the question bank, create/schedule quizzes, view quiz reports |
| **Superadmin** | Owner | Everything an admin can, plus: promote/demote admins |

Superadmin is bootstrapped once from a deploy-time secret. There is no self-service signup for
elevated roles.

## 4. Success metrics

| Metric | Target |
|---|---|
| Quizzes started without operator intervention | 100% |
| Median gap between submitting a unit and receiving the next unit | < 500 ms |
| Students who complete a quiz they joined | > 90% |
| Questions served twice | 0, always |
| Monthly hosting cost | ₹0 |

---

## 5. Functional requirements

### 5.1 Identity and access — `AUTH`

| ID | Requirement |
|---|---|
| AUTH-1 | Students sign in with **Google Sign-In**. No other login method. |
| AUTH-2 | A user record is created on first sign-in and persists across quizzes, so history and weekly ranking follow a real person over time. |
| AUTH-3 | Every user holds exactly one role: `student`, `admin`, or `superadmin`. Default on creation is `student`. |
| AUTH-4 | The first superadmin is established from a deployment secret, not through the UI. |
| AUTH-5 | Superadmins can promote a student to admin and demote an admin, from a Manage Admins screen. |
| AUTH-6 | Telegram is **not** an identity provider. The bot never authenticates anyone. |

**Acceptance:** a signed-out visitor cannot reach any quiz, bank, or leaderboard screen; a
`student` receives 403 on every admin route; demoting an admin revokes access within ~60 seconds
(Workers KV's global consistency window — see [[AUTH]] §3.2 and [[AUDIT]] §3.4 for why this isn't
literally "next request").

### 5.2 Question bank — `BANK`

| ID | Requirement |
|---|---|
| BANK-1 | Questions are imported in bulk from **CSV**, one row per question, via the admin console. |
| BANK-2 | Two question formats are supported: **MCQ** (exactly 4 options, one correct) and **TITA** (numeric entry with an admin-set tolerance). |
| BANK-3 | Question bodies and explanations render **LaTeX** (`$...$`), client-side. |
| BANK-4 | A question may carry one **image**, supplied in a companion ZIP alongside the CSV. |
| BANK-5 | Every question carries section type, topic, difficulty and explanation text. Sub-topic and source/provenance are optional metadata. |
| BANK-6 | **RC passages and LRDI sets** share material with 4–5 attached questions. The existing passage CSV row and `passage_ref` encode either kind; each group is drawn and retired whole. BANK owns membership, not timing. |
| BANK-7 | Import is **validated and previewed before commit**. Malformed rows are reported with line numbers; nothing is written until the admin confirms. A failed import writes nothing at all. |
| BANK-8 | Admins can browse, filter (by type / topic / difficulty / used-unused), edit, and delete questions. |
| BANK-9 | Every question and passage records whether it has been used, and in which quiz. |

**Acceptance:** a CSV mixing valid rows, a missing `correct` column, and an unknown
`passage_ref` produces a preview listing exactly those two errors by line and commits nothing.

### 5.3 Quiz creation and scheduling — `QUIZ`

| ID | Requirement |
|---|---|
| QUIZ-1 | An admin creates a quiz by specifying section type, question count (maximum **100** graded questions), and a difficulty mix. |
| QUIZ-2 | Questions are **auto-picked from the never-used pool only**. Manual override is not required for a normal quiz. |
| QUIZ-3 | Draw groups whole or not at all, alongside standalones. Report graded question count, timed-unit count and actual composition before lock (e.g. one 4-question set + 2 standalone questions = 6 questions, 3 units). |
| QUIZ-4 | The admin can reshuffle and preview the draw before locking. |
| QUIZ-5 | Locking reserves a stable sequential quiz number, retires drawn questions and fully claimed passages through BANK, then assigns room identity and publishes the scheduled state. Same-quiz claims are idempotent so an ambiguous successful claim can be retried. Never lock a partial claim. The accepted single-admin scope has no concurrent-admin all-or-nothing rollback or release feature. |
| QUIZ-6 | Configure correct/wrong marks, timing defaults by unit kind, optional unit allowances, transition slack, admission length and seat cap per quiz. No bonus or scoring grace parameters in V1. |
| QUIZ-7 | Quizzes can be scheduled as **one-offs** or generated from **recurring templates**. |
| QUIZ-8 | Every successfully locked quiz has a human-readable **room code** (e.g. `QNT-8417`) and a sequentially allocated quiz number. A first lock attempt may reserve the number internally; it stays hidden until scheduling succeeds, and abandoned reservations may leave gaps. |
| QUIZ-9 | Seat cap is admin-set, clamped by the platform to a maximum of **120**. |
| QUIZ-10 | Each student gets `window_sec = sum(unit time allowances) + slack_sec` from their own join. Duration is derived from the actual draw. Admission length is separate (`join_window_sec`); `ends_at` stops new joins, not existing runs. |

**Acceptance:** running auto-pick 50 times over a fixed bank never yields the same question in
two quizzes, and never yields a passage group split across quizzes.

### 5.4 Running the quiz — `ROOM`

The admission window and a student's working duration are distinct. Everyone receives the
same units in the same order, with free navigation inside the active set and no return after
closure. An answer or explicit skip resolves a subquestion; resolving the final outstanding
subquestion automatically freezes the draft and submits one batch. No speed bonus applies.

| ID | Requirement |
|---|---|
| ROOM-1 | Automatically prepare seats/content at T−5m. Admission and room-code release begin at the scheduled time T. Each student starts by joining; no shared start transition or operator action. |
| ROOM-2 | Self-paced by timed unit. Navigation within the active set is local; submitting its final batch immediately serves the next unit. Students never wait for one another. |
| ROOM-3 | Everyone receives the same ordered units and questions. Students can revisit subquestions within their active set. |
| ROOM-4 | Each RC/LRDI set shares one timer including reading; each standalone has its own timer. The editing deadline closes the unit. Saved drafts are submitted under the delivery policy below; unanswered or unaccepted responses score zero. |
| ROOM-5 | Each student has a hard working deadline measured from their own join. At that deadline editing stops and no new unit starts. Unreached questions score zero; final delivery follows the same bounded policy as unit expiry. |
| ROOM-6 | Answers and skips are editable locally while their set is open. Back revisits earlier subquestions. Once all questions are answered or explicitly skipped, the set automatically submits and closes permanently; there is no separate confirmation step. |
| ROOM-7 | One immutable accepted final response per question per student. Persist all responses in a unit batch atomically at closure; validate positions/formats and receipt deadline server-side. Retries never overwrite answers or double-score. |
| ROOM-8 | Options are presented in a **fixed A/B/C/D order, identical for every student**. No per-student shuffling. |
| ROOM-9 | Deliver the complete **active timed unit**, including its questions and shared material. Future units remain unavailable; the UI can display one subquestion at a time with local navigation. |
| ROOM-10 | The correct answer is **never transmitted to any client during the run** — not for the current question, and not for questions already answered. |
| ROOM-11 | No correctness, explanation, running score, rank or leaderboard during play. Advance only after server acknowledgement of unit closure; own total appears after the whole run finishes. |
| ROOM-12 | Pin the RC passage or LRDI shared material throughout its unit. Number units 1, 2, 3 and grouped questions 1.1, 1.2, etc.; standalone labels use the unit number. Keep internal IDs/positions as integers. |
| ROOM-13 | Resume the active unit with its original server clock. Same-browser storage preserves draft responses and selected subquestion. Confirmed batches survive retries; unsent drafts are not available cross-device or after local storage loss. |
| ROOM-14 | When the room is at its seat cap, further joiners are cleanly rejected with a "room full" state. |
| ROOM-15 | A late joiner receives the full sequence and full derived duration starting at their own join, as long as admission is still open. |
| ROOM-16 | MCQ and TITA use their containing unit allowance; answer format does not create a separate clock inside a set. |
| ROOM-17 | Skip clears the response, records an explicit local skip and advances without negative marks. It can be changed while the set is active. The final outstanding answer/skip closes the set; a standalone closes on its sole answer/skip. |

**Delivery decision:** the editing timer remains strict, but V1 provides a **5-second transport
window**. At `deadlineAt` the browser freezes the unit and can no longer change any response;
the frozen batch may reach the server through `submitByAt = deadlineAt + 5,000 ms`. The server
accepts the complete frozen batch during that window, caps elapsed time at `deadlineAt`, and
never treats those five seconds as working time. An identical retry of an accepted batch remains
valid after `submitByAt`; a previously unseen batch arriving later is rejected and the unsubmitted
unit scores zero. Because the server cannot prove when a custom client stopped editing, V1 accepts
the small possibility that a crafted client uses the transport window to change an answer.

**Acceptance:** navigating Back and changing a response performs no answer writes; the final
outstanding answer/skip commits the complete unit once and returns the next unit. Reload keeps
the original clock; an accepted retry never repeats marks or restarts the next unit. Future-unit
requests fail. Complete a mixed-unit run without receiving solutions or a running score.

### 5.5 Scoring — `SCORE`

| ID | Requirement |
|---|---|
| SCORE-1 | A correct accepted answer earns exactly `marks_correct`. |
| SCORE-2 | **Deferred to V2:** speed bonuses. V1 has no bonus computation, grace window, settings, storage fields or breakdown. |
| SCORE-3 | A wrong accepted answer earns `marks_wrong` (zero or negative). |
| SCORE-4 | A question that is skipped, timed out, or never reached scores **0** — never negatively marked. |
| SCORE-5 | Correct/wrong marks are configurable per quiz. Example values are illustrative, not defaults. |
| SCORE-6 | Correctness is determined **server-side only**. |
| SCORE-7 | Measure completion time **per reached timed unit** on the server, from its start to accepted batch receipt, capped at its effective allowance. Timeout consumes that allowance. Reading time counts once; individual question timings are not collected. |
| SCORE-8 | Rank by total marks descending, then sum of reached-unit completion times ascending. Exact ties share a dense rank. Unreached units add no elapsed time. |

```
correct -> marks_correct
wrong -> marks_wrong
skipped / unanswered / unreached -> 0
quiz score -> sum of final accepted question marks
ranking -> score DESC, total reached-unit elapsed ASC
```

**Acceptance:** identical accepted final answers earn identical marks regardless of speed. A set taking
8 minutes contributes 8 minutes once to the tie-break, not 8 minutes per subquestion.

### 5.6 Results and review — `RESULT`

The split below is a **secrecy requirement, not a UX preference**. Because students finish at
different times, anything released before safe quiz close reaches a student while others are
still answering the same questions.

| ID | Requirement |
|---|---|
| RESULT-1 | **On finishing**, a student immediately sees their **own total score** and how many they answered. Nothing else. |
| RESULT-2 | After finishing, show own score, how many students have finished and an estimated unlock time. Actual unlock depends on committed board completion, never the estimate alone. |
| RESULT-3 | After safe quiz close and completed ranking, show rank and participant count. |
| RESULT-4 | After board completion, provide per-question review: content, correct answer, final student response, marks and explanation. |
| RESULT-5 | The review screen shows the **answer distribution** across the whole participant room. For MCQ, A/B/C/D counts plus a `not answered` count cover every participant; percentages use the full participant count as denominator. `not answered` combines explicit skips, timed-out/unsubmitted responses and unreached questions. |
| RESULT-6 | Show student completion time against the room average **once per timed unit**, with reading included. No invented per-question timing. Unreached unit time is null; averages include reached finalized units. |
| RESULT-7 | Withhold correct answers, explanations, rank and board until the last possible submission has passed and all ranks are committed (`board_computed_at`), including for early finishers. |
| RESULT-8 | Each student has a **history** of every quiz they have taken, with scores and access to each review. |
| RESULT-9 | The per-quiz leaderboard and the answer review are **participant-only**. A student who did not take a quiz sees neither, at any time. Weekly boards remain visible to every signed-in student. |

**Acceptance:** a student who finishes 10 minutes early cannot obtain any correct answer,
explanation, rank, or leaderboard row from any endpoint until the safe close point passes and ranking is committed.

### 5.7 Leaderboards — `BOARD`

| ID | Requirement |
|---|---|
| BOARD-1 | Compute the final ranking once after the last possible submission and publish it atomically; per-quiz web boards are participant-only. |
| BOARD-2 | There is **no live or partial leaderboard** during a quiz. Ranking students on incomplete runs is meaningless and is not offered. |
| BOARD-3 | Use real Google names on published boards. Per-quiz web access is participant-only; weekly boards are visible to all signed-in students and top-10 posts go to the Telegram group. |
| BOARD-4 | A **weekly** ranking is computed on **total score across quizzes taken in that IST week**. Giving more quizzes can increase the total; `quizzes_taken` is shown for context but is not a divisor or secondary tie-break. |
| BOARD-5 | There is **no minimum quiz count** to appear on a weekly board. |
| BOARD-6 | Weekly boards are produced **per section type and overall** — separate Verbal, Quant, LR, and combined boards. |
| BOARD-7 | Weekly boards are computed automatically on a schedule and posted to Telegram. |
| BOARD-8 | The per-quiz web board shows top 10 plus the viewer’s own row if outside it. Weekly web boards are paginated full boards. Telegram carries top 10 and links. |
| BOARD-9 | There is **no all-time leaderboard**. Weekly boards are the only standing ranking. |

### 5.8 Telegram announcements — `TG`

The bot posts **plain text into one group** — the one the admins already run. It handles no
identity, accepts no commands, and sends no media or DMs. Full module spec in [[TELEGRAM]].

| ID | When | Content |
|---|---|---|
| TG-1 | T−2 hours | Quiz name, admission times, graded question/unit counts, unit timing summary and individual duration. **No room code.** |
| TG-2 | T−30 minutes | "Starting in 30 minutes." **No room code.** |
| TG-3 | Scheduled admission time T | Join is available: **room code**, seat cap and join link. |
| TG-4 | After safe close and committed ranking | Participant count, **top 10**, participant-only board link. |
| TG-5 | Weekly | Top 10 per section type and overall, each with a link. |
| TG-6 | — | Withhold the room code until admission begins at T. T−5m is preparation only. |
| TG-7 | — | The bot degrades gracefully under API rate limits; a failed post never affects the quiz. |
| TG-8 | — | The room code is **not the only way in**: a signed-in student can see and join any open quiz from the web app, so a failed TG-3 cannot silently cancel a quiz. |

### 5.9 Admin operations — `ADMIN`

| ID | Requirement |
|---|---|
| ADMIN-1 | Admin console covers: question bank, quiz builder, schedule, and quiz reports. |
| ADMIN-2 | Admins can export a quiz report. |
| ADMIN-3 | Superadmins manage the admin roster from the UI. |

---

## 6. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | **Target cost: ₹0/month on the selected free-tier stack.** Validate actual resource use before launch; this is a project constraint, not a guarantee that vendor terms never change. |
| NFR-2 | **Capacity:** 120 students running concurrently in one window, verified by load test before launch. |
| NFR-3 | Median unit-submit-and-advance round trip below 500 ms under full load. Subquestion navigation is local. |
| NFR-4 | Construct redacted active-unit payloads server-side, including shared KV content; verify no solutions or active scores leak through any student route. |
| NFR-5 | **Mobile-first.** Students play on phones. |
| NFR-6 | Reload preserves server clocks and confirmed submissions. Local drafts persist in the same browser where storage is available; no guarantee of recovery after storage loss, device change or failure to submit by the receipt cutoff. |
| NFR-7 | **Portability:** core logic (scoring, selection, CSV, leaderboard, contracts) carries zero platform dependencies. Leaving the host is estimated at ~a week, not a rewrite. |
| NFR-8 | Language: **English only.** Timezone: **Asia/Kolkata**. |
| NFR-9 | History is retained indefinitely. |

---

## 7. Release plan

Delivery order: agree module boundaries, stack, schema and contracts; write implementation
specs; implement and verify the backend in dependency order; then build the frontend and connect
its APIs. The phases below organize backend dependencies, not simultaneous UI delivery. Existing
spec packets and mockups require a later revision before they can guide implementation.

| Phase | Delivers | Covers |
|---|---|---|
| 1 | Foundation | AUTH-1..6, ADMIN-3 |
| 2 | Question bank | BANK-1..9 |
| 3 | Quiz creation | QUIZ-1..10 |
| 4 | Unit run + marks on batch commit | ROOM-1..17, SCORE-1,3..8, NFR-2, NFR-3, NFR-6 |
| 5 | Results publication | RESULT-1..9, BOARD-1,2,3; SCORE-1,3..8 scoring already needed by phase 4 |
| 6 | Telegram bot | TG-1..8 |
| 7 | Weekly & recurring | BOARD-4..8, QUIZ-7 |
| 8 | Hardening | NFR-2, NFR-5, ADMIN-2 |

This is now the **single authoritative requirement↔phase mapping** — [[MODULES]] §7 points here
rather than keeping a second table; the two had drifted apart ([[AUDIT]] §6).

**SCORE-2 is V2, excluded from V1 delivery.** Frontend screens for all phases are built after the backend is verified.

**ADMIN-1 has no single phase.** "Admin console covers bank, quiz builder, schedule, reports" is
cumulative — its pieces ship progressively as BANK's admin CRUD (Phase 2), QUIZ's creation endpoints
(Phase 3) and the report export (Phase 8, ADMIN-2) land. **BOARD-3** (public real names) ships
alongside BOARD-1,2 in Phase 5, the same moment a per-quiz board first exists. **NFR-1, NFR-4,
NFR-7, NFR-8, NFR-9** are structural and cross-cutting rather than phase-gated — they hold from
Phase 1 onward and are verified continuously, not delivered at a single point (unlike NFR-2/3/5/6,
which are testable artifacts anchored to specific phases above).

**Load test moves early.** A 120-client run against Phase 4 confirms NFR-2 and NFR-3 while the
run loop is still cheap to change; Phase 8 re-runs it against the finished system.

**Launch gate:** the load test passing NFR-2 and NFR-3, plus a manual end-to-end run —
CSV import → quiz created → scheduled → bot posts to a test group → three real phones join →
quiz runs unattended → deadline passes → leaderboard and review unlock and are verified by hand.

---

## 8. Out of scope

**Deferred:**

- Speed bonuses and any related grace settings, schema or UI — V2, not dormant V1 fields.

- Linking a Telegram account so the bot can DM personal results — blocked on a student-initiated
  opt-in, not just a stored id; see [[TELEGRAM]] §4.3
- Ungraded practice mode for students who miss a quiz or are turned away at the cap
- Per-topic weakness analytics
- Scheduled database export as a portability safety net
- A live leaderboard of students who have already finished — cheap to add later if asked for
  (see [[PLAN]] §"Format: why self-paced"), deliberately not in v1

**Explicitly not building:** lockstep play, Telegram-based play, any anti-cheat instrumentation
(tab tracking, proctoring), per-student option shuffling, any mid-quiz feedback or leaderboard.

---

## 9. Open questions

None block Phase 1. Every item that blocked Phase 3 or Phase 4–5 is now resolved — see
2026-09-05 below.

**Decide anytime:** none remain — see 2026-09-05 below.

**Resolved 2026-09-03:** no all-time board (BOARD-9); per-quiz leaderboard and review are
participant-only (RESULT-9); students may skip a question (ROOM-17).

**Resolved 2026-09-04** (full audit and resolution log in [[AUDIT]] §11): editing a used question —
`body_md`/`explanation_md` stay editable, `correct_option`/`numeric_answer`/`used_in_quiz_id`
freeze forever ([[BANK]] §7); abort/void a quiz — new admin route sets `status='cancelled'`
([[QUIZZING]] §4); QUIZ-7's recurring-quiz draw — unattended auto-draw at materialization
([[SCHEDULER]] §4.2); AUTH-5's revocation window — reworded to "~60 seconds" to match the actual
KV-based mechanism rather than promising "next request" (§5.1 above, [[AUTH]] §3.2).

**Resolved 2026-09-05** (project owner): **pool exhaustion** — fail loudly, no partial draw, no
silent reuse; recurring-materialization pool/timing failures return safe metadata to SCHEDULER and
alert through both private channels (confirmed 2026-09-10); **window length** — auto-derived, not a direct override (the formula was revised for units on 2026-09-09); **seat cap** — kept at 120 for now as a product default, no technical justification
needed ([[PLAN]] "Decisions locked"); **admin live monitor** — not built for now;
revisit only if it turns out to be near-free extra surface over data the app already has;
**item analysis report** — not built; **duplicate detection on CSV import** — not built;
**idle abandonment** — no separate abandoned status. The 2026-09-09 model records reached-unit
timeouts and distinguishes them from unreached units; absent answer rows alone no longer tell
which case occurred ([[QUIZZING]] §5.4).

**Resolved 2026-09-05, round 2** (project owner) — every remaining open question in every module
doc, closed out in one pass: **session TTL** — 30 days, no silent refresh ([[AUTH]] §7);
**demoted mid-quiz admin** — no special handling needed, falls out of the existing cached role
check ([[AUTH]] §7); **logout** — nothing to clean up beyond the cookie ([[AUTH]] §7); **deleting
a used question** — forbidden outright ([[BANK]] §7); **`passage_ref`** — same-file only,
permanent rule, no cross-file linking ([[BANK]] §7); **`import_id`** — kept forever ([[BANK]] §7);
**a very late cron tick** — post TG-3 unadjusted, no lateness-detection logic ([[SCHEDULER]] §8);
**zero-participant quiz** — still closes, posts a "nobody played" TG-4 ([[SCHEDULER]] §8,
[[TELEGRAM]] §10); **recurring template lookahead** — kept at 7 days ([[SCHEDULER]] §8); **pre-join
screen** — countdown and rules recap; preparation no longer implies student seats or starts; **holding screen** — kept as originally
specified, nothing added; **score display** — `5.44`; **tie-break** — exact ties share a rank,
no further break; **leaderboard rows on web** — top 10 plus the viewing student's own row;
**timezone/history retention/language** — confirmed `Asia/Kolkata`/forever/English-only. Full
reasoning for each lives in the named module doc's own resolution note.

---

**Resolved 2026-09-09 (project owner):** timed RC/LRDI units, standalone clocks,
hierarchical display numbering, editable answers and skips within the active set, automatic
closure on the last outstanding answer/skip, one final answer batch per unit, no return to
closed units, no V1 speed bonus, and server-measured per-unit completion time for tie-breaking.
Backend-first delivery is authoritative. See [[V1_CHANGES]] for the revision and affected files.

## 10. Accepted tradeoffs and limits

| Consequence | V1 handling |
|---|---|
| Final outstanding response closes the set immediately | Revisit earlier choices before that action; label the closing action explicitly. |
| Unsent drafts are browser-local | Persist locally and retain pending batches through retries; cross-device/cleared-storage recovery is unavailable. |
| Five-second transport window | Freeze edits at the working deadline; accept the frozen batch for five seconds. The server cannot prove that a crafted client stopped editing, which is accepted under the trust-based V1. |
| Network latency affects timing | Server receipt is used for the completion-time tie-break; no speed-based marks. |
| Unreached units add no tie-break time | Retained intentionally for the friendly V1 quiz; no synthetic time penalty is added for abandonment. |
| No option shuffling or anti-cheat detection | Trusted study-group deployment; solutions remain withheld until safe publication. |
| Early finishers wait | Own score only until every possible run/submission has ended and ranking is committed. |
| Public real names | Within the access scopes in BOARD-3; retained for the study group. |
| Weekly total-score ranking | More completed quizzes can increase a student's weekly total; quiz count is displayed for context and there is no minimum participation. Exact total-score ties share a dense rank. |
| MCQ/TITA share a set clock | No separate typing clock or per-subquestion allowance. |
