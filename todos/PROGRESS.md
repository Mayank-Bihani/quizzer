# Backend spec progress

> Fresh generation after the 2026-09-09 V1 document revision. The replacement packets are
> tracked below. Backend implementation precedes frontend development and API integration.
> Requirements/phases: PRD.md §7. Module ownership: MODULES.md. Exact contracts:
> CONTRACTS.md, API.md, DATA_MODEL.md, src/core/contracts.ts, src/core/api.ts and the initial schema.

Use the repository `quizzer-backend-spec` orchestrator for packet generation. It dispatches the
installed `spec-writer` skill once per sprint, validates each result and keeps this tracker
current. Ground claims in current files and actual repository state. The current project
documents define the product. Check new packets against those sources and each other, never
against the archived generation. Surface missing decisions instead of inventing them.

| Sprint | Backend scope | Depends on | Status | Packet |
|---|---|---|---|---|
| 1 | AUTH — Google sign-in, sessions, roles, guards, superadmin bootstrap and admin-management endpoints | — | done | [claude-task--001--google-auth-roles-guards.md](sprint%201/claude-task--001--google-auth-roles-guards.md) |
| 2 | BANK — CSV import, RC/LRDI groups, questions, images and admin CRUD | 1 | done | [claude-task--001--bank-import-groups-crud.md](sprint%202/claude-task--001--bank-import-groups-crud.md) |
| 3 | QUIZZING creation — whole-group draw, ordered units, allowances, derived duration, lock/retire and admission schedule | 1, 2 | done | [claude-task--001--quiz-creation-units-lock.md](sprint%203/claude-task--001--quiz-creation-units-lock.md) |
| 4 | QUIZZING run + SCHEDULER — unit delivery, local-draft contract, atomic batch closure, marks, timing, prepare/close, failure alerts and 120-client load test | 1, 2, 3 | done | [claude-task--001--quiz-run-batch-scheduler.md](sprint%204/claude-task--001--quiz-run-batch-scheduler.md) |
| 5 | QUIZZING results — final settlement, atomic ranking publication, participant review and per-unit timings | 1, 3, 4 | done | [claude-task--001--quiz-results-ranking-review.md](sprint%205/claude-task--001--quiz-results-ranking-review.md) |
| 6 | TELEGRAM — six post kinds, unit timing summaries and claim-then-send behavior | 4, 5 | done | [claude-task--001--telegram-six-post-kinds.md](sprint%206/claude-task--001--telegram-six-post-kinds.md) |
| 7 | Weekly boards + recurring — IST weeks, complete publication, template draws and derived unit duration | 1, 2, 3, 5, 6 | done | [claude-task--001--weekly-boards-recurring-materialization.md](sprint%207/claude-task--001--weekly-boards-recurring-materialization.md) |
| 8 | Backend hardening and admin report export | 1–7 | done | [claude-task--001--backend-hardening-report-export.md](sprint%208/claude-task--001--backend-hardening-report-export.md) |
| 9 | Recurring template CRUD — admin create/list/view/edit/deactivate of `quiz_templates` (name, type, question count, difficulty mix, per-unit timing policy, slack/join-window seconds, marks, seat cap, rrule), feeding the existing Sprint 7 materializer | 1, 3, 7 | done | [claude-task--001--recurring-template-admin-crud.md](sprint%209/claude-task--001--recurring-template-admin-crud.md) |
| 10 | Manual question selection — `selection_mode` on `quizzes`, `buildManualDraw` whole-unit validation, manual-mode `POST /api/admin/quizzes`/reshuffle-block, bank `passageId` filter, and an admin question-picker UI; recurring templates stay auto-only | 1, 2, 3 | done | [claude-task--001--manual-question-selection.md](sprint%2010/claude-task--001--manual-question-selection.md) |

Statuses: pending → in-progress → written → done. Done means the replacement packet has been
reviewed against the current documents/contracts and the skill's required structure; it does
not mean backend code has been implemented. No review gates carry over from the old generation.

The timeout-delivery decision is settled: editing freezes at the unit deadline and the frozen
batch has a five-second transport window. Fresh gameplay specs must use the exact boundary in
PRD.md §5.4 and must not treat it as additional answering time.

The review-distribution and weekly-board decisions are also settled: MCQ distributions cover the
whole participant room with a combined not-answered bucket, and weekly boards rank total score
instead of average score. The existing reached-unit-only per-quiz tie-break remains intentionally
friendly and unchanged. Question source/provenance and subtopic are optional bank metadata.

Sprint 2 (BANK) OQ-1 and OQ-2 were resolved by the project owner on 2026-09-10 and recorded in
`BANK.md` §7 and `API.md` (search "resolved 2026-09-10" in both): upload fields are `csv`
(required) + `images` (optional ZIP), with `MAX_CSV_BYTES=5MB`, `MAX_ZIP_BYTES=20MB`,
`MAX_ZIP_INFLATED_BYTES=50MB`, `MAX_IMAGE_BYTES=5MB`, JPEG/PNG/WebP only, verified from file bytes
(OQ-1); deleting one member of an unused RC/LRDI group cascades to the whole group + passage,
atomically, and never touches a group with any used member (OQ-2). The packet was revised to bake
both rules into ACs/constants/tests and reviewed on 2026-09-10: validator passes, no
`<INPUT_REQUIRED>` marker remains, and citations were spot-checked against `BANK.md:199-214` and
`API.md:77-101`. `done`.

Sprint 6 (TELEGRAM) OQ-1 was resolved by the project owner on 2026-09-10: `QuizzingSchedulerContract`
in `src/core/contracts.ts` gained `listDueAnnounce(now, limit): Promise<DueAnnounceQuiz[]>` (a
deliberate, reviewed exception to the "contracts frozen" rule other sprints enforce), documented in
`CONTRACTS.md` §5 and `SCHEDULER.md` §4.1. The packet was revised to implement and production-bind
the Announce pass (TG-1/TG-2/TG-3 discovery) against it and reviewed on 2026-09-10: validator
passes, no `<INPUT_REQUIRED>` marker remains, and citations were spot-checked against
`src/core/contracts.ts:143-175`, `CONTRACTS.md:176-193`, and `SCHEDULER.md:44-52`. The weekly send
pass correctly remains typed-but-unwired, pending Sprint 7's `computeWeeklyBoards`. `done`.

Sprint 7 (weekly boards + recurring) OQ-1 and OQ-2 were resolved by the project owner on
2026-09-10, going with the packet's own proposed recommendations, and recorded in `SCHEDULER.md`
§4.2 and `API.md` (search "resolved 2026-09-10" in both): `quiz_templates.rrule` is a minimal RFC
5545 `RRULE` subset (`FREQ=WEEKLY;BYDAY=<day list>;BYHOUR=<H>;BYMINUTE=<MM>`, no `COUNT`/`UNTIL`,
recurs indefinitely until deactivated) (OQ-1); `GET /api/boards/weekly` defaults `type` to
`'overall'` and `weekStart` to the most recently *published* week, `MAX(week_start)` in
`weekly_boards` (OQ-2). The packet was revised to bake both rules into ACs/tests and reviewed on
2026-09-10: validator passes, no `<INPUT_REQUIRED>` marker remains, and citations were spot-checked
against `SCHEDULER.md:102-113` and `API.md:232-238`.

The final corpus review's Sprint 7 alert issue was resolved by the project owner on 2026-09-10.
Hourly recurring materialization now returns safe `MaterializationFailure` entries for pool
exhaustion and missing timing configuration, and SCHEDULER independently attempts the Telegram
alert chat and Cloudflare Email Routing for every entry. One occurrence or channel failure cannot
block sibling alerts or the rest of the hourly pass. The authoritative documents/contracts and the
Sprint 7 packet were reconciled and validated. The owner accepted the packet's eight-week weekly
board retry lookback as a V1 limitation because the quiz season ends in the third week of November;
V1 does not promise backlog discovery or indefinite recovery beyond that window. Sprint 8 was also
reconciled against the same alert contract and revalidated. `done`.

Sprint 9 (recurring template CRUD) reverses Sprint 7's "template CRUD remains deferred" scoping
decision, resolved by the project owner on 2026-09-12: edits to an active template affect only its
future materializations, never the already-persisted units/questions/timing of quizzes already
materialized from it (no versioning/history table); and template save never dry-runs the draw
against current bank counts, so pool exhaustion is still only surfaced by the existing hourly
`materializeTemplates` failure/alert path. Both are recorded in `QUIZZING.md` §4.4 and the new
"QUIZZING — templates" route table in `API.md`. The packet does not touch `getActiveTemplates`,
`TemplateRow`, or `quiz-materializer.ts` — it is pure CRUD in front of the table Sprint 7 already
reads. No frontend admin screen is in scope; that is a future packet. Reviewed on 2026-09-12:
validator passes, no `<INPUT_REQUIRED>` marker remains, and citations were spot-checked against
`src/db/quizzes.ts:596-632`, `src/core/api.ts:44-54`, `src/core/schedule.ts:58-98`, and
`migrations/0001_init.sql:41-56`. `done`.

Sprint 10 (manual question selection) implements the packet's default answer to its only
`<INPUT_REQUIRED>` (OQ-1): a new `migrations/0002_manual_selection_mode.sql` adds `selection_mode`
to `quizzes` rather than editing `migrations/0001_init.sql` in place — `migrations/` held only that
one file with no other evidence of the project's actual `wrangler d1 migrations apply` history at
implementation time, so the packet's stated default (the technically correct pattern, safe under
either history) was taken as-is; flag to the project owner if the team's real practice turns out to
be single-file hand-editing instead. `selection_mode TEXT NOT NULL DEFAULT 'auto'` is fixed at
creation and never exposed on `QuizAdminSummary`/the drafts list. `src/core/selection.ts` gained
`buildManualDraw` (whole-unit validation, ordered by the admin's first-pick position, reusing the
existing private `buildUnitCandidates`); `createDraft`/`reshuffleDraft` branch on mode without
touching `reserveClaimAndPublish`/`lockQuiz`; `POST /api/admin/quizzes` and its reshuffle route
gained the `mode`/`questionIds` validation and `invalid_selection`/`manual_locked` outcomes.
`GET /api/bank/questions` gained an additive `passageId` filter for the new admin question-picker
UI (`web/src/features/admin/AdminPages.tsx`'s `pick` step, `builder-state.ts`'s `tallyByDifficulty`/
`toggleSelection`). Recorded in `QUIZZING.md` §4.5 and `API.md`'s QUIZZING/BANK route notes. The
Hard NO list held: `git diff` on `src/services/templates.ts`, `src/services/quiz-materializer.ts`,
and `src/core/contracts.ts` is empty for this packet's changes. `done`.

Old packets and their original tracker are preserved in
[the historical archive](../archive/backend-specs/2026-09-09-before-regeneration/README.md).
They are excluded from the active generation's sources.
