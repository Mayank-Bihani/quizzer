# Quizzer — API Contracts

> **Scope:** the exact request/response shape of every HTTP route in the system. The route paths
> themselves are owned by each module's own route table ([[QUIZZING]] §4–7, [[BANK]] §5, [[AUTH]]
> §5); this document is the wire-shape companion [[CONTRACTS]] §7 points to. [[SCHEDULER]] and
> [[TELEGRAM]] have no HTTP surface and do not appear below.
> **Status:** request/response types defined, nothing built.
> **Last updated:** 2026-09-09

---

## Conventions

- **Errors:** every error response, at every status code, is `{ message: string }`. Not repeated
  per route below.
- **Success:** the payload directly — no `{ data: ... }` envelope, ever.
- **423** is the one status code the docs specify explicitly: the leaderboard and review routes
  return it on every request until `quizzes.board_computed_at` is set (QUIZZING.md §6) — as does
  the admin report export (QUIZZING.md §7), gated the same way rather than offered a
  live/partial view while a quiz is still running.
- **Every other status code** (401/403/400/404/409, or a 200 with a status field) is derived from
  what each route's own module-doc description implies. Where the docs don't say, it's listed as
  an open question rather than guessed into existence.
- **Pagination:** one convention, applied to every list route whose collection grows without
  bound — see below. Bounded-size lists (a per-quiz leaderboard capped at `seat_cap` ≤ 120, a
  review list capped at `question_count`, the admin user roster, the open-quiz list) are plain
  arrays instead.

```ts
type PageRequest = { limit?: number; offset?: number }
type PageResponse<T> = { items: T[]; total: number; limit: number; offset: number }
```

Omitted pagination means `limit=50` and `offset=0`. `limit` must be an integer from 1 through
100 and `offset` a non-negative integer; malformed, fractional or out-of-range values return
`400 { message }` rather than being clamped. `total` counts the complete filtered collection.

This is a new decision — nothing in the docs defines a pagination shape. Offset/limit was picked
over a cursor because this project has no infrastructure need for cursor stability: D1/SQLite,
single Worker, and collections here (a bank of a few thousand questions, one admin's worth of
report exports, a season of per-student history) are small enough that `total` being exact is more
useful than the added complexity a cursor would buy. Applied identically to all five: BANK's
question browse (BANK-8), student history (RESULT-8), the weekly board (BOARD-8), the admin
report's participant list (ADMIN-2), and the admin quiz list (COUNCIL_FINDINGS.md #18) — every
quiz ever created stays in `quizzes` forever, so this grows without bound the same way the others
do.

---

## AUTH — AUTH.md §5

| Method | Path | Request | Response | Extra status codes |
|---|---|---|---|---|
| `POST` | `/api/auth/google` | `GoogleSignInRequest` | `GoogleSignInResponse` | 401 (bad/expired ID token) |
| `POST` | `/api/auth/logout` | — (no body) | `LogoutResponse` | — |
| `GET` | `/api/auth/me` | — (no body) | `GetMeResponse` | 401 |
| `GET` | `/api/admin/users` | — (no body; roster isn't one of the four paginated routes) | `AdminListUsersResponse` | 403 |
| `POST` | `/api/admin/users/:id/role` | `SetUserRoleRequest` | `SetUserRoleResponse` | 403, 404, 409 (demoting the last superadmin — AUTH.md §3.5) |

`GoogleSignInResponse` is `CurrentUser` directly; the session itself is set as an `HttpOnly`
cookie, a side effect, not a body field (AUTH.md §3.1). `AdminUserSummary` extends `CurrentUser`
with `email`/`createdAt` — fields a self-view never needs but a roster view does.

---

## BANK — BANK.md §5

| Method | Path | Request | Response | Extra status codes |
|---|---|---|---|---|
| `POST` | `/api/bank/import/preview` | — (multipart CSV+ZIP, not JSON — see note) | `ImportPreviewResponse` | 403 |
| `POST` | `/api/bank/import/commit` | — (multipart CSV+ZIP, not JSON) | `ImportCommitResponse` | 403 |
| `GET` | `/api/bank/questions` | `ListQuestionsRequest` | `ListQuestionsResponse` | 400, 403 |
| `GET` | `/api/bank/questions/:id` | — (no body) | `GetQuestionResponse` | 403, 404 |
| `PATCH` | `/api/bank/questions/:id` | `UpdateQuestionRequest` | `UpdateQuestionResponse` | 400 (a frozen field was sent), 403, 404 |
| `DELETE` | `/api/bank/questions/:id` | — (no body) | `DeleteQuestionResponse` | 403, 404, 409 (already used — forbidden outright, no exceptions, BANK.md §6) |

**Deleting an unused RC/LRDI group member cascades to the whole group** (BANK.md §7, resolved
2026-09-10): if `:id` is an unused member of a passage group, the delete removes every member of
that group plus the shared passage row, atomically. The existing 409 (already used) still protects
any group with a used member — cascade delete never touches one. A standalone unused question
deletes alone, unchanged.
| `GET` | `/api/bank/passages` | — (no filters documented) | `ListPassagesResponse` | 403 |
| `GET` | `/api/images/:key` | — (binary passthrough, no JSON contract) | — (raw R2 object body) | 401, 404 |

**`GET /api/images/:key` is not admin-gated**, unlike every other row in this table — it's
`requireAuth()` only (401, not 403), no per-question scoping. Students load question images
mid-quiz, so this route can't sit behind BANK's admin-only route group. Deliberately left
unscoped: enforcing "only once served" would need this route reading QUIZZING-owned tables to
check a student's progress, violating BANK's isolation, to stop something that reveals nothing —
these are illustrative images, not answers (COUNCIL_FINDINGS.md #11, reconsidered).

**Import routes carry no JSON request type** — the body is `multipart/form-data` (the CSV plus an
optional companion ZIP), which isn't expressible as a request payload type the way every other
route is. Both are grouped with the "no meaningful body" skips in the final count, but for a
different reason: not bodyless, just not JSON.

**Multipart field names and size/format limits** (BANK.md §7, resolved 2026-09-10): the CSV file
is field `csv` (required); the companion ZIP is field `images` (optional). `MAX_CSV_BYTES = 5 MB`;
`MAX_ZIP_BYTES = 20 MB` as uploaded, `MAX_ZIP_INFLATED_BYTES = 50 MB` after unzip; `MAX_IMAGE_BYTES
= 5 MB` per image; allowed image formats are JPEG, PNG, WebP, verified from file bytes rather than
filename or client-supplied MIME type.

**`import/commit`'s atomicity (BANK-7)** is modeled by `importId: string | null` rather than a
non-200 status: if `errors` is non-empty nothing was written (`importId` is `null`), matching
"a failed import writes nothing at all" (BANK.md §3.3). A structural upload problem (not a
CSV/ZIP at all) is the one case that should 400 with the generic error shape instead.

**`ListQuestionsRequest.passageId`** (Sprint 10, additive) filters to exactly one RC/LRDI group's
questions, ordered the same as any other browse result (`created_at ASC, id ASC` — the caller
re-sorts by `groupPosition` for display/selection order). Added purely to support the admin quiz
builder's manual question picker (QUIZZING.md §4.5): checking one group member surfaces the rest
of that group so it can be selected as a whole unit.

**`ListQuestionsResponse` embeds `QuestionFull`** — including `correctOption` and
`explanationMd` — deliberately. This is the one route where that's not a leak: AUDIT.md §11
decision 17 settled that admin-role holders already authored the question and know the answer,
so extending the run-time secrecy guarantee to admin routes was rejected as unnecessary.
`QuestionFull.source` and `subtopic` are nullable admin metadata; blank CSV values are valid.
`PassageSummary.source` is nullable for the same reason.

**`UpdateQuestionRequest`** may edit optional `source` and `subtopic`. It excludes
`correctOption`, `numericAnswer`, and the used-question
identity fields — BANK.md §6's freeze, resolved 2026-09-04. It also excludes `type`, `format`,
`passageId`, and `groupPosition` as structural identity fixed at import, and `imageUrl` (derived
server-side from `image_key`, never accepted as input — COUNCIL_FINDINGS.md #27). The type still
*permits* `optionA`..`optionD` (editable pre-use, e.g. fixing a typo), but the handler must reject
an edit to any of them once the question is used, freezing alongside `correctOption` rather than
only at import — a frozen correct answer paired with edited option text was the exact bug this
closes (COUNCIL_FINDINGS.md #20).

---

## QUIZZING — creation (QUIZZING.md §4)

| Method | Path | Request | Response | Extra status codes |
|---|---|---|---|---|
| `GET` | `/api/admin/quizzes` | `ListQuizzesRequest` | `ListQuizzesResponse` | 400, 403 |
| `POST` | `/api/admin/quizzes` | `CreateQuizDraftRequest` | `CreateQuizDraftResponse` | 400 (also `invalid_selection` in manual mode — unknown/duplicate/partial-group/empty questionIds, QUIZZING.md §4.5), 403, 409 (pool exhaustion, auto mode only — fail loudly, no partial draw, no silent reuse, QUIZZING.md §11) |
| `POST` | `/api/admin/quizzes/:id/reshuffle` | — (no body; same stored parameters) | `ReshuffleQuizResponse` | 403, 404, 409 (already locked, or a manual draft — manual drafts can never be reshuffled, QUIZZING.md §4.5) |
| `POST` | `/api/admin/quizzes/:id/lock` | — (no body) | `LockQuizResponse` | 403, 404, 409 (already locked) |
| `PATCH` | `/api/admin/quizzes/:id` | `UpdateQuizParamsRequest` | `UpdateQuizParamsResponse` | 400, 403, 404, 409 (legal only while `status` is `'draft'`/`'scheduled'` — rejected once the room has opened, so a setting can't change under a student already mid-run, QUIZZING.md §11) |
| `POST` | `/api/admin/quizzes/:id/cancel` | — (no body) | `CancelQuizResponse` | 403, 404, 409 (already ended/cancelled) |

**`GET /api/admin/quizzes` is paginated** (`ListQuizzesRequest = PageRequest & { status?: QuizStatus }`,
`ListQuizzesResponse = PageResponse<QuizAdminSummary>`) — the route this admin console actually
needs to recover a draft's id after leaving and coming back, since nothing else returns
`QuizAdminSummary` except `PATCH` and `cancel`, both of which require already knowing the id
(COUNCIL_FINDINGS.md #18, un-bundled from the recurring-template deferral).

Creation returns flat `QuestionFull[]` for admin inspection **and** `QuizUnitDefinition[]`
with unit position, kind, member question positions and allowance. Report `questionCount` and
`unitCount` separately. The admin list includes definitions so a draft can be resumed.

`CreateQuizDraftRequest` remains selection filters plus title/scheduledAt and accepts at most 100
graded questions. Its response is draft state, quizId, counts, questions and units. The first lock
attempt durably reserves the sequential quiz number needed by BANK, but draft responses continue
to expose `quizNumber: null` until a room code is assigned and scheduling succeeds. Sequence gaps
from abandoned reservations are accepted. `claimUnused` is idempotent for content already owned
by the same quiz/number, so a retry after an ambiguous successful claim can finish publication.
A true short retirement claim returns `{locked:false,requestedCount,claimedCount}`.

**Manual selection mode (Sprint 10, resolved 2026-09-12, QUIZZING.md §4.5):**
`CreateQuizDraftRequest` is now a discriminated union on an optional `mode: 'auto' | 'manual'`
(default `'auto'`, the unchanged existing shape). `mode: 'manual'` instead takes
`{ title, scheduledAt, type, questionIds: string[] }` — no `difficultyMix`/`count` — and the route
rejects a request that mixes fields from the wrong branch (e.g. `difficultyMix` sent alongside
`mode: 'manual'`, or `questionIds` sent with `mode: 'auto'`/omitted). `questionCount`/`difficultyMix`
on the resulting `quizzes` row are derived server-side from the validated selection, never accepted
from the client. `selection_mode` is stored on `quizzes` (`DEFAULT 'auto'`), fixed at creation, and
never exposed on `QuizAdminSummary`/the drafts list — only the in-progress builder session needs it.
Recurring templates gained no equivalent field; a template request carrying `mode`/`questionIds` is
rejected the same way any other unknown field already is.

`UpdateQuizParamsRequest` accepts title, scheduledAt, joinWindowSec, timingPolicy, unitTimeLimits,
slackSec, marksCorrect, marksWrong and seatCap. It no longer accepts timePerQSec, windowSec,
graceSec or maxSpeedBonus. `windowSec` is derived from actual unit allowances plus slack.
Changing timingPolicy reapplies defaults to all units before request overrides. Reshuffle
rebuilds units using the policy, discards overrides and returns the new duration/counts.
Validate positive integer allowances/admission length, non-negative slack, correct marks >0,
wrong marks <=0, finite numeric values and cap <=120. Settings freeze once status becomes open.

## QUIZZING — templates (QUIZZING.md §4.4)

| Method | Path | Request | Response | Extra status codes |
|---|---|---|---|---|
| `GET` | `/api/admin/templates` | `ListTemplatesRequest` | `ListTemplatesResponse` | 400, 403 |
| `POST` | `/api/admin/templates` | `CreateTemplateRequest` | `CreateTemplateResponse` | 400, 403 |
| `PATCH` | `/api/admin/templates/:id` | `UpdateTemplateRequest` | `UpdateTemplateResponse` | 400, 403, 404 |
| `POST` | `/api/admin/templates/:id/deactivate` | — (no body) | `DeactivateTemplateResponse` | 403, 404, 409 (already inactive) |

`ListTemplatesRequest`/`Response` follow the same `PageRequest`/`PageResponse<T>` convention as
`GET /api/admin/quizzes`. `CreateTemplateRequest`/`UpdateTemplateRequest` accept `name`, `type`,
`questionCount`, `difficultyMix`, `timingPolicy` (only the unit kinds implied by `type` — validate
with the same per-used-kind rule `PATCH /api/admin/quizzes/:id` already applies), `slackSec`,
`joinWindowSec`, `marksCorrect`, `marksWrong`, `seatCap` and `rrule` (the minimal RRULE subset
resolved for Sprint 7, QUIZZING.md §4.2 — no `COUNT`/`UNTIL`). Reject any other field. There is no
draw dry-run against current bank counts on create or edit (QUIZZING.md §4.4); pool exhaustion is
still only surfaced by the existing hourly `materializeTemplates` failure/alert path, unchanged.

An edit to an active template affects only its future materializations — quizzes already produced
from it keep their own already-persisted units/questions/timing and are never rewritten. There is
no hard delete: `POST /:id/deactivate` only flips `active` to 0, which `getActiveTemplates` already
excludes from materialization; `quizzes.template_id` continues to reference the row.

## QUIZZING — the run (QUIZZING.md §5)

| Method | Path | Request | Response | Extra status codes |
|---|---|---|---|---|
| GET | `/api/quizzes/open` | — | `ListOpenQuizzesResponse` | 401 |
| POST | `/api/quizzes/:code/join` | — | `JoinQuizResponse` | 401, 404, 409 (admission not open/full/cancelled) |
| GET | `/api/play/:quizId/current` | — | `CurrentUnitResponse` | 401, 403 (not a participant), 404, 409 (cancelled) |
| POST | `/api/play/:quizId/units/:unitPosition/submit` | `SubmitUnitRequest` | `SubmitUnitResponse` | 400 (invalid batch), 401, 403, 404, 409 (wrong/closed unit or changed retry), 410 (new batch past receipt cutoff) |
| GET | `/api/play/:quizId/status` | — | `PlayStatusResponse` | 401, 403, 404, 409 (participant still playing) |

All play routes enforce authentication and ownership. New joins require
`scheduledAt <= serverNow < endsAt`; existing participants resume after admission closes.
Preparation at T−5m does not start a clock or reveal a room code. Join creates the participant
and first runtime unit before serving content; replaying a join never restarts either clock.

`QuizMeta` includes questionCount, unitCount, admission cutoff, full individual duration,
student startedAt and overall deadlineAt. `PlayState` is discriminated:

- `active`: serverNow and `ServedUnit` (content, immutable unit start, editing/receipt deadlines).
- `finished`: serverNow, own totalScore and answeredCount.

`ServedUnit` contains every redacted question in the current unit and shared material/image.
`position` remains flat answer identity; `subPosition` and `unitPosition` produce display labels.
No personal clocks are placed in the shared `UnitContent` cache. No future unit is exposed.
`current` returns the shared material again so resume never depends on an earlier HTTP response.

`SubmitUnitRequest = {submissionId, reason: 'complete'|'timeout', answers: UnitAnswer[]}`.
Exactly one entry per member is required. Each entry is answered MCQ with chosenOption, answered
TITA with numericValue, explicit skipped, or unanswered (timeout only). Reject foreign/duplicate
positions, mismatched format, nonfinite numeric values, or an incomplete normal-completion batch.
SubmissionId is a client-generated retry key; canonical payload hash prevents changed retries.

Back, Clear and Skip edit browser-local drafts; they have no HTTP write endpoints. Resolving
the final outstanding question automatically submits once; no extra confirmation step.
Accepted rows, closure, marks/count/time totals and next start commit atomically. The response
contains `closedUnit` (position/reason) and authoritative current `state`; it never includes a
unit score during play. Identical accepted retries acknowledge the same closure with refreshed
current state; they do not replay a stale next-unit timer. Different payload/key returns 409.

Receipt policy: [[PRD]] §5.4; `submitByAt = deadlineAt + 5,000 ms`. At `deadlineAt` the client
freezes its payload and sends it; the server accepts a new batch through `submitByAt`, while
elapsed time remains capped at `deadlineAt`. A new batch beyond `submitByAt` returns 410 and, if
still active, the server finalizes the unit as timed out without accepting its responses. The
client then fetches current state. Receipt lookup happens before late rejection so an accepted
retry survives expiry. `current` settles expired units after the transport window and returns
next/finished state. At `serverNow <= submitByAt`, it must not settle a timeout ahead of a
still-eligible submission; expiry settlement requires `serverNow > submitByAt`.

`PlayStatusResponse` is only for finished participants: own score/answered count, finished and
participant counts, and estimatedUnlockAt. The estimate is a hint; results still gate on the
committed board marker. History must not expose active scores either.

## QUIZZING — results (QUIZZING.md §6)

| Method | Path | Request | Response | Extra status codes |
|---|---|---|---|---|
| `GET` | `/api/quizzes/:quizId/leaderboard` | — (no body; top 10 plus the viewer's own row if outside it — never the full board, so not paginated) | `LeaderboardResponse` | **423** (before `board_computed_at`), 403 (non-participant), 404 |
| `GET` | `/api/quizzes/:quizId/review` | — (no body; bounded by `question_count`, not paginated) | `ReviewResponse` | **423**, 403, 404 |
| `GET` | `/api/students/me/history` | `HistoryRequest` | `HistoryResponse` | 400, 401 |
| `GET` | `/api/boards/weekly` | `WeeklyBoardRequest` | `WeeklyBoardResponse` | 400, 401 |

**423 is scoped to exactly these two routes**, per QUIZZING.md §6's own wording ("every results
endpoint... returns 423" refers to the two rows the section actually tables — leaderboard and
review). History and the weekly board are not marked 423 anywhere in the docs, so they aren't
gated here either; a student's history entry for a quiz whose board isn't computed yet is modeled
with `rank: null` / `participantCount: null` instead of blocking the whole list.
An active participant also has `totalScore: null`; expose that score only after finish.

**`GET /api/boards/weekly`'s omitted-parameter defaults** (resolved 2026-09-10, project owner —
closing the Sprint 7 packet's OQ-2): an omitted `type` defaults to `'overall'`; an omitted
`weekStart` defaults to the most recently *published* week — `MAX(week_start)` present in
`weekly_boards` — not the calendar week containing `now`, since a just-elapsed week may not be
published yet (SCHEDULER.md §4.3). If no week has ever been published, the response is the same
empty `PageResponse` (`total: 0`) any other not-yet-published `weekStart` would return; there is
still no 404 path for this route.

**`LeaderboardResponse.rows` is `LeaderboardRowView[]`, never the full board.** `isOwnRow` marks
the viewer's own entry so the client can render it distinctly, and `truncated` is `true` whenever
the board has more entries than `rows` contains — resolving an earlier contradiction between
"full per-quiz board" and the later top-10-plus-own-row product decision (COUNCIL_FINDINGS.md #34).

**`ReviewResponse` is the only run-adjacent response carrying `correctOption`/`explanationMd`/
`numericAnswer`** — `QuestionFull`'s redacted-during-a-run fields. That's correct here specifically
*because* this route fires exclusively after `board_computed_at` is set (QUIZZING.md §6); the same
fields on `ServedQuestion` earlier in the run are structurally absent, not merely omitted by this
handler.

`QuestionReviewRow` includes unitPosition, subPosition and an explicit outcome (correct/wrong/
skipped/unanswered/not_reached). A null `yourAnswer` means no final answer row, which can also
mean a served but unsubmitted unit expired. Determine the distinction from participant_units.

`ReviewResponse.units` contains one timing record per unit: closeReason, elapsedMs and
roomAvgElapsedMs. Unreached time is null; averages include reached finalized units. There is no
per-question elapsed time, and set reading time is never multiplied by its question count.

**`distribution: null` for `tita`** — there's no A–D split to show for a numeric-answer question.
For MCQ, the server returns canonical counts rather than rounded percentages:
`participantCount`, A/B/C/D `optionCounts`, and `notAnsweredCount`. The counts must sum to
`participantCount`. The client derives percentages using that full-room denominator.
`notAnsweredCount` includes explicit skips, unanswered timeout/unsubmitted responses and
unreached questions.

---

## QUIZZING — admin report export (QUIZZING.md §7)

| Method | Path | Request | Response | Extra status codes |
|---|---|---|---|---|
| `GET` | `/api/admin/quizzes/:id/report` | `AdminReportRequest` | `AdminReportResponse` | 400, **423** (before `board_computed_at` is set — same gate as the student-facing leaderboard/review routes), 403, 404 |

**Gated the same way as `/leaderboard` and `/review`** — 423 until `board_computed_at` is set, no
partial/live view while a quiz is still running. Resolved this way rather than letting admins peek
early: consistent with every other results route in the system, and simpler than adding a second,
partial-data code path just for this one screen.

**`AdminReportResponse.questions`** is a per-question aggregate (`correctCount`/`wrongCount`/
`skippedCount`/`unansweredCount`), computed over participant/question membership with left-joined final answers — a derived value, not a stored
column. This is deliberately *not* the full "item analysis" feature — resolved as **not built for
now** (QUIZZING.md §11); it's the minimum "per-question breakdown" ADMIN-2 names, built only from
aggregates the schema can already produce.

---

## Route inventory and revision

33 routes: AUTH 5, BANK 8, QUIZZING 20 (creation 6, templates 4, run 5, results 4, report 1).
This revision removes per-question answer/skip/timeout routes and adds one unit-submit route.
The source of exact type bodies is `src/core/api.ts`; module types are `src/core/contracts.ts`.
Existing sprint packet route/type references are stale and intentionally not edited yet.
Template CRUD (QUIZZING.md §4.4) was resolved and added to this inventory on 2026-09-12.

Admin report unit aggregates provide completedCount, timedOutCount and avgElapsedMs per unit.
Participant rows include unansweredCount and server-measured total unit time.
