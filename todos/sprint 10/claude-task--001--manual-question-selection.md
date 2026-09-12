# claude-task--001: Add manual question selection as an alternative to auto-draw quiz creation

**Sprint:** 10  **Slug:** `manual-question-selection`  **Status:** Draft

> New sprint folder: this is a new backend/frontend scope, not part of Sprint 9 (recurring
> template CRUD, `done`). Every prior sprint folder holds exactly one packet mapped to one row in
> `todos/PROGRESS.md`; this packet should be added as its own row once accepted, per that same
> convention (see `todos/PROGRESS.md`'s table and the "Statuses" paragraph immediately below it).
> This preamble is informational only — updating `PROGRESS.md` itself happens after implementation
> per repo convention, not as part of this spec-writing step.

---

## 1. Context

Today, `POST /api/admin/quizzes` always auto-draws questions: `src/routes/quizzes.ts:49-95` validates
`title/scheduledAt/type/difficultyMix/count` (allowlist at `src/routes/quizzes.ts:58`) and calls
`createDraft` (`src/services/quiz-creation.ts:66-96`), which fetches unused candidates via
`deps.bank.listUnused` (`src/services/quiz-creation.ts:67`) and runs the exact-composition
backtracking search `selectExactDraw` (`src/core/selection.ts:111-149`). There is currently no way
for an admin to hand-pick which questions go into a quiz.

The request is to add a **manual** selection mode as an alternative to the existing **auto** draw,
selectable when creating a quiz, while **recurring/scheduled quizzes (templates) keep auto-draw
only** — no manual option there, ever.

Key existing facts this design leans on:

- `BankContract.listUnused` (`src/db/bank-contract.ts:25-53`) filters only by `type` and by the
  **presence of keys** in `difficultyMix` (`src/db/bank-contract.ts:26`); the per-difficulty
  **values** and the `count` field are never read inside `listUnused`. Calling it with
  `{ easy: 1, medium: 1, hard: 1 }` therefore returns the *entire* unused candidate pool for a
  type — every unused standalone question plus every unused whole RC/LRDI group — regardless of
  what numbers are passed. This lets manual-mode validation reuse `listUnused` completely as-is,
  with no `BankContract` change.
- `BankContract.getByIds` (`src/core/contracts.ts:70`, impl `src/db/bank-contract.ts:113-133`)
  already exists but is insufficient alone for manual mode: it returns only the rows the caller
  asks for, so it cannot tell whether a picked RC/LRDI question's siblings were left out. This is
  why manual validation needs the *pool* view (`listUnused`), not just `getByIds`.
- `selectExactDraw` groups candidates into whole units via a private helper, `buildUnitCandidates`
  (`src/core/selection.ts:26-48`) — a passage is never split, and a group's flat sub-positions
  follow bank `group_position` order (`src/core/selection.ts:41`). Manual mode needs the same
  whole-group grouping and the same flat-position assembly logic (`src/core/selection.ts:129-146`).
- `src/core/contracts.ts` is treated as frozen module-to-module contract in this codebase: its own
  header says "V1 contracts, revised 2026-09-09" and every actual exception to that (e.g. Sprint
  6's `listDueAnnounce` addition) was called out explicitly and logged in `todos/PROGRESS.md` as "a
  deliberate, reviewed exception." This packet's design **avoids touching `contracts.ts` entirely**
  (no `BankContract`, `SelectionFilters`, or `QuizUnitDefinition` changes) — everything needed
  already exists there or can be added additively in `src/core/api.ts` (HTTP-surface types, which
  Sprint 9's template CRUD already extended freely — `src/core/api.ts:302-324`).
- Templates are already structurally incapable of manual mode: `src/services/templates.ts` and
  `src/db/quizzes.ts:580-632` (`TemplateRow`/`getActiveTemplates`) have no selection-mode concept,
  and `src/services/quiz-materializer.ts:22-79` hardcodes `listUnused` + `selectExactDraw` with no
  branch point. Sprint 9's own header comment (`src/services/templates.ts:1-4`) already states this
  file must "never edit `quiz-materializer.ts`, `getActiveTemplates` or `TemplateRow`" — this
  packet obeys the same rule (see §4 Out of Scope, §8a Hard NO list).
- Storage is selection-method-agnostic: `quiz_units`/`quiz_questions` (`src/db/quizzes.ts:127-172`
  `insertDraft`) accept any `QuizUnitDefinition[]`/`questionIds[]` built by any process. No
  migration is needed for `quiz_units`/`quiz_questions` themselves.
- Frontend today has no question picker at all. `QuizBuilderPage`'s define step
  (`web/src/features/admin/AdminPages.tsx:1017-1073`) only submits
  title/type/count/difficultyMix/scheduledAt. `BankPage` (`web/src/features/admin/AdminPages.tsx:129-385`)
  is a filterable/paginated browse table (type/difficulty/used/topic —
  `web/src/features/admin/AdminPages.tsx:135-146`, reusing `GET /api/bank/questions` via
  `api.questions()`, `web/src/api/client.ts:158-159`) but has no checkboxes, no selection state, and
  no group-aware selection.

Resolved product decisions from the pre-spec interview (recorded here so they aren't
re-litigated):

1. **Reshuffle is removed entirely for manual drafts.** A manual draft cannot be reshuffled — the
   admin explicitly picked these exact questions; there is no auto pool/difficultyMix target to
   redraw from. This requires the backend to know which mode a draft was created in, hence a new
   `selection_mode` column (§9, `migrations/`).
2. **Count and difficulty mix are derived from the admin's picks, not entered upfront.** In manual
   mode the define step does not ask for `count`/`difficultyMix` at all; both are computed from
   whatever the admin ends up selecting and stored as the source of truth on the `quizzes` row,
   exactly like the auto path already stores its own computed `question_count`/`difficulty_mix`
   (`src/db/quizzes.ts:140-142`).

## 2. Objective

After this ships, an admin creating a quiz can choose **Auto draw** (unchanged existing behavior)
or **Select manually** (hand-pick exact questions from the bank, with whole RC/LRDI groups always
selected/deselected together) in the quiz builder's define step. A manually-built draft cannot be
reshuffled. Recurring templates and their unattended materialization are completely unaffected —
they have no manual option in the UI, no manual code path, and every template-created quiz's
`selection_mode` is `'auto'` by database default.

## 3. Assumptions

- The system is still in active pre-launch development, not fully live: `TELEGRAM_ENABLED = "false"`
  and the production email-alert binding is still commented out pending a custom domain
  (`wrangler.toml:49,58-60`, "a production launch prerequisite"). This does **not** mean zero
  deployed environment — the frontend asset binding (`wrangler.toml:10-12`) is already live, so a
  real D1 database plausibly already exists with real admin-entered content. Treat any migration
  as touching a real, if pre-launch, database — no "just wipe and recreate" assumption.
- `wrangler d1 migrations apply` (`package.json:14-15`) tracks applied migrations by filename per
  database, not by content hash — so this packet adds a **new** migration file rather than editing
  `migrations/0001_init.sql` in place, even though that file is currently the only one on disk.
  See `<INPUT_REQUIRED>` OQ-1 in §5 if the team's actual practice differs.
- `vitest.config.ts` and the existing `tests/*.test.ts` / `web/src/**/*.test.ts` suites are the only
  test runners in scope; no new test framework is introduced.
- The existing single-trusted-admin concurrency scope holds (`src/core/contracts.ts:68`'s comment
  on `claimUnused`): no new cross-admin locking is added for the picker.

## 4. Out of Scope

- **Editing `src/services/templates.ts`, `src/services/quiz-materializer.ts`, `TemplateRow`, or
  `getActiveTemplates` (`src/db/quizzes.ts:580-632`)** — recurring quizzes stay auto-only by
  construction; adding a mode to templates is explicitly not wanted per the original request.
- **Editing `src/core/contracts.ts`** (`BankContract`, `SelectionFilters`, `QuizUnitDefinition`) —
  everything needed is already exposed or is added additively in `src/core/api.ts` instead; this
  keeps the packet inside the codebase's established frozen-contracts convention.
- **Exposing `selection_mode` on `QuizAdminSummary`** (`src/core/api.ts:67-90`) or on the drafts
  list (`GET /api/admin/quizzes`) — the only consumer that needs to know the mode is the in-progress
  builder session itself, which already carries mode client-side for the duration of the flow
  (`web/src/features/admin/AdminPages.tsx:826-832`). Surfacing mode in the general admin quiz list
  is a plausible future nicety, not required here.
- **Editing an existing quiz's mode after creation**, or converting an auto draft to manual or vice
  versa — mode is fixed at creation time.
- **Cross-admin concurrency guarantees for the picker** (e.g. two admins racing to pick the same
  question) — out of scope per the existing single-trusted-admin design; `lockQuiz`'s existing
  fresh-BANK re-check (`src/services/quiz-creation.ts:314-327`) is the only safety net, unchanged.
- **A dedicated "browse all members of a group" UI outside the picker** — the new `passageId`
  filter (§9) is added to the existing bank browse route purely to support the picker's
  group-auto-select behavior, not as a new standalone admin feature.

## 5. Open Questions / `<INPUT_REQUIRED>`

- **OQ-1 (blocks nothing, but confirm before merging the migration):** Has
  `wrangler d1 migrations apply` ever actually been run against a real local or remote D1 for this
  project, or has `migrations/0001_init.sql` only ever been applied by wiping and recreating the
  database each time during pre-launch development? If the latter, the team may prefer this packet
  edit `0001_init.sql` in place (adding `selection_mode` to the existing `CREATE TABLE quizzes`)
  instead of adding a new `0002_*.sql` file, to keep a single-file schema convention. §9 specs the
  new-file approach (the technically correct `wrangler d1 migrations` pattern, safe under either
  history) as the default; switch to editing `0001_init.sql` in place if the project owner
  confirms no migration has ever actually been recorded against a live database.

## 6. Pre-flight Checklist

- [ ] Required skill loaded: **`clean-code`** — Always.
- [ ] Required skill loaded: **`prod-safety-gate`** — this touches the admin quiz-creation write
      path and a schema migration; miswiring the mode branch could corrupt a live quiz's unit
      composition or silently let a template acquire manual mode.
- [ ] Required skill loaded: **`test-driven-development`** — this is a behavior change to
      `createDraft`/`reshuffleDraft` with concrete new branches; write the failing test for each
      new branch (§7) before implementing it.
- [ ] Working tree clean; branch up to date with `master`.
- [ ] Read before editing: `src/services/quiz-creation.ts:1-126` (create/reshuffle),
      `src/core/selection.ts` (whole file, 149 lines), `src/db/quizzes.ts:112-172,234-292`
      (draft insert/reshuffle read), `src/db/bank-contract.ts:25-53` (`listUnused`),
      `src/routes/quizzes.ts:49-105`, `src/db/bank-crud.ts` (whole file, 64 lines),
      `src/routes/bank.ts:246-283`, `src/core/api.ts:161-249`,
      `web/src/features/admin/AdminPages.tsx:825-1283`, `web/src/features/admin/builder-state.ts`.
- [ ] Re-read each AC in §7 before starting its implementation; note which are automatable (all of
      them here — there is no `AC-OPERATOR` in this packet, see §12b).

## 7. Acceptance Criteria

**Backend — schema and core selection**

- **AC-1.** A new migration adds `selection_mode TEXT NOT NULL DEFAULT 'auto' CHECK (selection_mode IN ('auto', 'manual'))`
  to `quizzes`. Every existing/materializer-created row and every row inserted without passing
  `selectionMode` gets `'auto'` with no application-layer default logic required.
- **AC-2.** `src/core/selection.ts` gains an exported `buildManualDraw(candidates, questionIds)`
  that: rejects duplicate ids in `questionIds`; rejects any id absent from `candidates`; for every
  RC/LRDI group touched by the selection, requires *all* of that group's members (per `candidates`)
  to be present in `questionIds`, rejecting otherwise; and on success returns
  `{ ok: true, units, questions }` with the same shape `selectExactDraw` returns — flat
  `unitPosition`/`questionPositions` assigned by iterating units in the order the admin first
  picked a member of each unit, and each group's own questions ordered by `group_position`
  (mirroring `src/core/selection.ts:129-146`'s existing assembly).
- **AC-3.** `createDraft` (`src/services/quiz-creation.ts:66-96`) accepts `mode: 'auto' | 'manual'`.
  In `'manual'` mode it calls `deps.bank.listUnused({ type, difficultyMix: { easy: 1, medium: 1, hard: 1 }, count: questionIds.length })`
  to fetch the full candidate pool, passes it to `buildManualDraw`, and on success computes
  `difficultyMix`/`questionCount` by tallying the returned `questions[]` by difficulty before
  calling `insertDraft` — the admin never supplies `difficultyMix`/`count` in this mode.
- **AC-4.** `createDraft` in `'manual'` mode returns a new `{ kind: "invalid_selection", reason }`
  outcome (reasons: `unknown_question`, `duplicate_question`, `partial_group`, `empty_selection`)
  when `buildManualDraw` fails or `questionIds` is empty — distinct from `pool_exhausted`, which
  remains auto-mode-only.
- **AC-5.** `insertDraft` (`src/db/quizzes.ts:127-172`) persists `selection_mode` from a new
  optional `DraftInsert.selectionMode` field, defaulting to `'auto'` when omitted — so
  `src/services/quiz-materializer.ts:41-54`'s existing call (which never sets this field) is unchanged and still
  produces `'auto'` rows.
- **AC-6.** `reshuffleDraft` (`src/services/quiz-creation.ts:108-126`) reads the draft's
  `selection_mode` (via an extended `getDraftForReshuffle`, `src/db/quizzes.ts:243-257`) and
  returns a new `{ kind: "manual_locked" }` outcome — never calling `selectExactDraw` or writing
  anything — when the draft is `'manual'`.
- **AC-7.** `POST /api/admin/quizzes` (`src/routes/quizzes.ts:49-95`) accepts an optional `mode`
  field (default `'auto'`) and, only in `'manual'` mode, a required non-empty `questionIds: string[]`
  (max length `MAX_GRADED_QUESTION_COUNT`, `src/core/config.ts:80`); it returns 400 if `mode` is
  neither `'auto'`/`'manual'`, if `difficultyMix`/`count` are sent together with `mode: 'manual'`,
  if `questionIds` is sent with `mode: 'auto'` (or omitted), or if `questionIds` fails the shape
  check above. On `invalid_selection` it returns 400 with a reason-specific message; on
  `pool_exhausted` it keeps the existing 409.
- **AC-8.** `POST /api/admin/quizzes/:id/reshuffle` (`src/routes/quizzes.ts:97-105`) returns 409
  with a message stating manual drafts cannot be reshuffled when `reshuffleDraft` returns
  `manual_locked`.
- **AC-9 (regression).** Every existing auto-mode behavior — request shape, `pool_exhausted`
  handling, reshuffle, lock, cancel, patch — is unchanged for requests that omit `mode` or send
  `mode: 'auto'`.
- **AC-10 (regression).** `materializeTemplates` (`src/services/quiz-materializer.ts:81-100`) and
  `createTemplate`/`patchTemplate` (`src/services/templates.ts:87-157`) are untouched by this
  packet; a template create/patch request carrying a `mode` or `questionIds` field is rejected the
  same way any other unknown field already is (verifies the "templates never gain manual mode"
  guard as an executable test, not just an absence of code).

**Backend — bank browse (group-aware picker support)**

- **AC-11.** `GET /api/bank/questions` (`src/routes/bank.ts:249-283`) accepts an optional
  `passageId` query filter; `QuestionFilters`/`buildFilterClause` (`src/db/bank-crud.ts:14-40`) and
  `ListQuestionsRequest` (`src/core/api.ts:161-166`) are extended additively. Filtering by an
  existing group's `passageId` returns exactly that group's questions, ordered the same as today
  (`created_at ASC, id ASC` — `src/db/bank-crud.ts:57`; the frontend re-sorts by `groupPosition`
  for display/selection order per AC-14).

**Frontend — quiz builder**

- **AC-12.** The define step (`web/src/features/admin/AdminPages.tsx:1017-1073`) gains a mode
  toggle (`Auto draw` default / `Select manually`). In manual mode the count/difficulty-mix inputs
  are hidden and not submitted; submitting navigates to a new `pick` step instead of calling
  `api.createQuiz` immediately (manual mode has nothing to create yet — no questions are chosen).
- **AC-13.** The new `pick` step lists unused questions of the chosen `type` (reusing
  `api.questions({ type, used: false, ... })`, the same call `BankPage` already makes) with a
  checkbox per row, a running "N selected" count, and a live per-difficulty tally computed from the
  actual `QuestionFull.difficulty` of everything selected so far.
- **AC-14.** Checking a question whose `passageId !== null` fetches that passage's full group via
  `api.questions({ type, passageId })` (AC-11) and adds every member to the selection at once,
  sorted by `groupPosition`; unchecking any member removes the whole group. A standalone question
  toggles independently.
- **AC-15.** The pick step's submit button is disabled at 0 selections and enabled otherwise (no
  upfront target to match, per the resolved "derive from picks" decision); submitting calls
  `api.createQuiz({ title, type, scheduledAt, mode: 'manual', questionIds })` and, on success,
  behaves like the existing post-create flow (merges the response into the builder session,
  navigates to `draw`).
- **AC-16.** The `draw` step (`web/src/features/admin/AdminPages.tsx:1074-1118`) hides the
  "Reshuffle" button when the builder session's mode is `'manual'`.
- **AC-17.** `BuilderSteps` (`web/src/features/admin/AdminPages.tsx:1272-1283`) shows a `pick` step
  between `define` and `draw` only when the session is in manual mode.

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not edit `src/services/templates.ts`, `src/services/quiz-materializer.ts`, or
  `TemplateRow`/`getActiveTemplates` (`src/db/quizzes.ts:580-632`) — `git diff` on these must be
  empty.
- Do not add `mode`, `questionIds`, or any selection-mode concept to `CreateTemplateRequest`,
  `UpdateTemplateRequest`, or `TemplateSummary` (`src/core/api.ts:286-324`).
- Do not edit `src/core/contracts.ts`. If a step in this packet seems to need a `BankContract` or
  `SelectionFilters` change, stop and re-read §1's `listUnused`-reuse trick — it exists specifically
  to avoid this.
- Do not add `selection_mode` to `QuizAdminSummary` or to `GET /api/admin/quizzes`'s response — out
  of scope per §4.
- Do not let `buildManualDraw` (AC-2) accept a partially-selected RC/LRDI group under any
  circumstance, including when the admin's `questionIds` order interleaves group members with
  unrelated standalones — group wholeness is checked against full group membership, not against
  contiguity in the request.
- Do not remove or weaken `lockQuiz`'s existing fresh-BANK re-validation
  (`src/services/quiz-creation.ts:314-327`) — it remains the last line of defense for both auto and
  manual drafts and needs no changes, but must not be "simplified away" while touching this file.

### 8b. Coding / quality principles

- `clean-code`: `buildManualDraw` should read as a short, linear sequence of guard clauses (reject
  duplicates → reject unknowns → reject partial groups → assemble), mirroring the existing
  `selectExactDraw`'s style in the same file rather than introducing a different idiom.
- `prod-safety-gate`: the production surface is `POST /api/admin/quizzes` (the only admin
  quiz-creation write path) and a schema migration on `quizzes`. A miswired mode branch that lets
  `difficultyMix`/`count` leak into a manual draft's stored row (or vice versa) would desync
  `QuizAdminSummary.questionCount`/`difficultyMix` from what was actually locked — verify AC-3's
  tally happens against the *validated* `questions[]`, never against client-supplied counts.
- `test-driven-development`: write the failing test for AC-2 (`buildManualDraw` unit tests in
  `tests/selection.test.ts`) before implementing it; same for AC-6/AC-8 (`reshuffleDraft`'s new
  `manual_locked` branch) before wiring the route.
- Mirror existing patterns exactly: the manual branch's flat-position assembly in
  `buildManualDraw` should reuse the same loop shape as `src/core/selection.ts:132-146`, not a
  reinvented version.
- `web/src/features/admin/builder-state.ts` is the existing home for pure, testable builder logic
  (`derivedWindowSeconds`, `mixTotal`); add the new tally-from-selection and group-toggle helpers
  there rather than inlining them in `AdminPages.tsx`, so `builder-state.test.ts` can cover them
  without rendering React.

## 9. Behavior Spec (per file)

### `migrations/0002_manual_selection_mode.sql` (new file)

- **Current state:** does not exist; `migrations/0001_init.sql:62-99` defines `quizzes` with no
  selection-mode column.
- **Required edit:** `ALTER TABLE quizzes ADD COLUMN selection_mode TEXT NOT NULL DEFAULT 'auto' CHECK (selection_mode IN ('auto', 'manual'));`
- **Estimated diff:** ~3 LOC (new file).
- **Subtleties:** see OQ-1 (§5) if the project's actual convention turns out to be editing
  `0001_init.sql` in place instead.

### `src/core/selection.ts`

- **Current state (lines 1-149):** exports only `selectExactDraw`; `buildUnitCandidates` (lines
  26-48) is a private grouping helper.
- **Required edit:** add an exported `buildManualDraw(candidates: QuestionFull[], questionIds: string[]): ManualDrawOutcome`
  in the same file, reusing the existing private `buildUnitCandidates` (no need to export it
  separately). Define `ManualDrawOutcome` next to `SelectionOutcome` (line 17-19).
- **Estimated diff:** ~45 LOC.
- **Subtleties:** unit ordering must follow the admin's first-pick order per unit (not bank
  insertion order, not a random shuffle like `selectExactDraw` uses) — sort selected units by the
  minimum index of their member ids within the original `questionIds` array.

### `src/services/quiz-creation.ts`

- **Current state:** `CreateInput` (lines 57-63) is a single auto-only shape; `createDraft`
  (66-96) always calls `selectExactDraw`; `CreateOutcome` (64) has two kinds;
  `reshuffleDraft`/`ReshuffleOutcome` (102-126) always calls `selectExactDraw` again.
- **Required edit:** widen `CreateInput` to a discriminated union on `mode`; branch `createDraft`
  on `input.mode`; add `invalid_selection` to `CreateOutcome`; add `manual_locked` to
  `ReshuffleOutcome` and check `draft.selectionMode` before drawing in `reshuffleDraft`.
- **Estimated diff:** ~40 LOC.
- **Subtleties:** `reserveClaimAndPublish`/`lockQuiz` (lines 275-335) need **no** changes — they
  already operate on whatever `questionIds`/units are stored, regardless of how they got there;
  resist the urge to add mode-awareness there.

### `src/db/quizzes.ts`

- **Current state:** `DraftInsert` (112-125) has no selection-mode field; `insertDraft` (127-172)
  builds a fixed column list; `DraftForReshuffle` (234-241) and `getDraftForReshuffle` (243-257)
  select a fixed set of columns.
- **Required edit:** add optional `selectionMode?: 'auto' | 'manual'` to `DraftInsert`, bind
  `draft.selectionMode ?? 'auto'` into a new `selection_mode` column in the `INSERT INTO quizzes`
  statement (alongside the existing `seat_cap` default pattern at line 145); add `selectionMode` to
  `DraftForReshuffle` and to `getDraftForReshuffle`'s `SELECT`/return object.
- **Estimated diff:** ~10 LOC.
- **Subtleties:** none beyond keeping the column list and placeholder count in sync in the
  `INSERT` statement.

### `src/routes/quizzes.ts`

- **Current state:** `allowedFields` (line 58) and the validation block (61-90) assume auto mode
  unconditionally; `reshuffleDraft`'s outcome mapping (97-105) handles three kinds.
- **Required edit:** extend `allowedFields` with `mode`/`questionIds`; branch validation per §7
  AC-7; map the new `invalid_selection`/`manual_locked` outcomes per AC-7/AC-8.
- **Estimated diff:** ~35 LOC.
- **Subtleties:** keep the existing auto-mode validation block byte-for-byte where it isn't
  branching, so AC-9's regression coverage has a clean diff to review against.

### `src/db/bank-crud.ts`

- **Current state:** `QuestionFilters` (14-19) has `type/topic/difficulty/used`;
  `buildFilterClause` (21-40) builds a `WHERE` clause from them.
- **Required edit:** add `passageId?: string` to `QuestionFilters`, add
  `q.passage_id = ?`/param push to `buildFilterClause`.
- **Estimated diff:** ~5 LOC.
- **Subtleties:** none — `listQuestionsPage`'s signature and query shape are otherwise unchanged.

### `src/routes/bank.ts`

- **Current state:** `GET /questions` (249-283) parses `type/topic/difficulty/used` query params.
- **Required edit:** parse an optional `passageId` query param (no format validation needed beyond
  "is a string" — an unknown/garbage id simply matches zero rows) and pass it through to
  `listQuestionsPage`.
- **Estimated diff:** ~4 LOC.

### `src/core/api.ts`

- **Current state:** `CreateQuizDraftRequest = SelectionFilters & { title, scheduledAt }` (229-232);
  `ListQuestionsRequest` (161-166) has no `passageId`.
- **Required edit:** redefine `CreateQuizDraftRequest` as a discriminated union — the existing
  `SelectionFilters & { title; scheduledAt; mode?: 'auto' }` branch, plus a new
  `{ title: string; scheduledAt: number; type: QuizType; mode: 'manual'; questionIds: string[] }`
  branch (reusing `QuizType`, already imported at line 12 — never redefining a field that exists in
  `contracts.ts`, per this file's own header rule at line 4); add `passageId?: string` to
  `ListQuestionsRequest`.
- **Estimated diff:** ~10 LOC.

### `web/src/api/client.ts`

- **Current state:** `questions`/`createQuiz` (158-159, 178-183) already take
  `ListQuestionsRequest`/`CreateQuizDraftRequest` generically via `withQuery`/`send`.
- **Required edit:** none — both new fields flow through the existing generic query/body building
  with no client.ts change.
- **Estimated diff:** 0 LOC.
- **Subtleties:** confirm this at implementation time by checking `QueryValue`
  (`web/src/api/client.ts:60`) actually accepts a bare string for `passageId` — it does, since
  `topic`/`type` are already plain strings passed the same way.

### `web/src/features/admin/builder-state.ts`

- **Current state (19 lines):** exports `derivedWindowSeconds`, `mixTotal`.
- **Required edit:** add a pure `tallyByDifficulty(questions: QuestionFull[]): Partial<Record<Difficulty, number>>`
  and a pure group-toggle helper (e.g. `toggleSelection(selected: QuestionFull[], group: QuestionFull[]): QuestionFull[]`
  that adds-all/removes-all by shared `passageId`, or is a no-op add/remove for a standalone).
- **Estimated diff:** ~25 LOC.
- **Subtleties:** keep these pure (no `fetch`, no React state) so `builder-state.test.ts` can cover
  them directly, matching the existing file's own convention.

### `web/src/features/admin/AdminPages.tsx`

- **Current state:** `BuilderSession` (825-832); `QuizBuilderPage` (847-1270) with `define`
  (1017-1073), `draw` (1074-1118), `scoring`/`schedule`/`lock` steps; `BuilderSteps` (1272-1283).
- **Required edit:** extend `BuilderSession` with `mode: 'auto' | 'manual'` and an optional
  pre-creation `selectedIds?: string[]`; add the mode toggle to the define step; add a new `pick`
  step per AC-13/14/15; hide the Reshuffle button in `draw` per AC-16; make `BuilderSteps` mode-aware
  per AC-17.
- **Estimated diff:** ~110 LOC (largest single-file change in this packet — if it grows
  meaningfully past this while implementing, extract the `pick` step into its own component
  function in the same file rather than letting `QuizBuilderPage` balloon further).
- **Subtleties:** the early-return guard at line 897 (`if (step !== "define" && !builder)`) must
  also allow `step === "pick"` with a builder that has no `quizId` yet (manual mode's pre-creation
  state) — don't relax it further than that, or a stale/missing builder session on `draw`/`scoring`
  would silently render broken.

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Templates/materializer silently gain a manual path via a future careless edit | Low | High | `selection_mode` DB default is `'auto'`; AC-10 adds a regression test asserting template requests reject `mode`/`questionIds` as unknown fields; §8a Hard NO list names the exact files. |
| A locked quiz ends up with a split RC/LRDI group via manual mode | Low | High | `buildManualDraw` (AC-2) rejects partial groups at creation; `lockQuiz`'s existing fresh-BANK re-check (`src/services/quiz-creation.ts:314-327`) independently re-validates group/type integrity at lock time, unchanged. |
| Admin's picked `questionIds` become stale between picker load and submit (another admin/process claims one) | Low (single-trusted-admin scope) | Medium | `createDraft`'s `buildManualDraw` re-fetches `listUnused` fresh at submit time (AC-3), so a since-claimed id fails as `unknown_question`; the admin re-picks. Matches the accepted concurrency scope in `src/core/contracts.ts:68`. |
| New migration file conflicts with the team's actual (undocumented) practice of hand-editing `0001_init.sql` | Low | Medium (a possibly-live D1 database, §3) | Flagged as OQ-1 (§5) with a concrete fallback instruction. |
| `AdminPages.tsx`'s single-file `QuizBuilderPage` grows unreadable with the new `pick` step | Medium | Low | §9's guardrail: extract `pick` into its own component function in the same file if the diff estimate is exceeded. |
| Doc drift: `QUIZZING.md` §4 / `API.md`'s quiz-creation route table don't describe manual mode | Medium | Low | Add doc updates to the Definition of Done (§12c) mirroring how Sprint 9 updated `QUIZZING.md` §4.4 / `API.md` as part of its own packet. |

## 11. Rollback / Revert Plan

1. `git revert <sha>` for the implementation commit(s).
2. If `migrations/0002_manual_selection_mode.sql` was applied to any environment, run
   `wrangler d1 execute quizzer-db --local --command "ALTER TABLE quizzes DROP COLUMN selection_mode"`
   (and `--remote` if applied there) — SQLite/D1 supports `DROP COLUMN` for a plain additive column
   with no dependent index/trigger, which this is.
3. No process restart is required (Cloudflare Workers deploy is the only "restart"; redeploying the
   reverted code is sufficient).
4. Verification: `curl -s -X POST .../api/admin/quizzes -d '{"mode":"manual",...}'` should return
   400 "Unknown field" (mirroring pre-change behavior) once the revert is deployed; confirm via
   `wrangler d1 execute ... "SELECT sql FROM sqlite_master WHERE name='quizzes'"` that
   `selection_mode` is gone if the column drop (step 2) was also run.
5. Notification: `TELEGRAM_ENABLED = "false"` and email alerting is not yet wired
   (`wrangler.toml:49,58-60`, §3), so there is no automated student-facing channel to notify either
   way — tell the project owner directly and note the revert in the sprint's tracking
   (`todos/PROGRESS.md`) so the
   next attempt doesn't re-diverge from what actually shipped.

## 12. Verification + Definition of Done

### 12a. Automated verification

```bash
npm test -- tests/selection.test.ts tests/quiz-creation.test.ts tests/quizzes.routes.test.ts \
  tests/bank.test.ts tests/templates.test.ts tests/templates.routes.test.ts tests/quiz-materializer.test.ts
npm test
git diff --stat -- src/services/templates.ts src/services/quiz-materializer.ts   # must be empty
git diff --stat -- src/core/contracts.ts                                        # must be empty
(cd web && npm test -- builder-state.test.ts)
(cd web && npm run build)
```

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | Manual create, whole standalone + whole group | `POST /api/admin/quizzes` with `mode:"manual"`, `questionIds` = 2 standalones + one full 4-question RC group | 200; response `questionCount=6`, `unitCount=3`; stored `selection_mode='manual'` | Not Run |
| BE-2 | Manual create, partial group rejected | Same as BE-1 but omit one id from the RC group | 400, `invalid_selection`/`partial_group` message; no row written | Not Run |
| BE-3 | Manual create, duplicate id rejected | `questionIds` contains the same id twice | 400 | Not Run |
| BE-4 | Manual create, already-used id rejected | Include an id whose `used_in_quiz_id` is already set | 400 (`unknown_question` — not in the fresh unused pool) | Not Run |
| BE-5 | Manual + auto fields together rejected | `mode:"manual"` with `difficultyMix` also present | 400 | Not Run |
| BE-6 | Reshuffle blocked for manual draft | `POST /:id/reshuffle` on a draft created via BE-1 | 409, message states manual drafts cannot be reshuffled; no DB change | Not Run |
| BE-7 | Auto mode regression | `POST /api/admin/quizzes` with no `mode` field, valid `difficultyMix`/`count` | 200, identical to pre-change behavior; `selection_mode='auto'` | Not Run |
| BE-8 | Auto reshuffle still works | `POST /:id/reshuffle` on an auto draft | 200, redraws as before | Not Run |
| BE-9 | Template unaffected | `POST /api/admin/templates` with an extra `mode` or `questionIds` field | 400 "Unknown field" | Not Run |
| BE-10 | Materializer default | Trigger `materializeTemplates` (existing scheduled path/test harness) and inspect the produced quiz row | `selection_mode='auto'` | Not Run |
| BE-11 | Bank passageId filter | `GET /api/bank/questions?passageId=<id>` for a known 4-question group | 200, exactly those 4 questions, none from other groups | Not Run |

#### Frontend / UI

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| FE-1 | Mode toggle default | Open `/admin/quizzes/new/define` | "Auto draw" selected by default; form looks unchanged from before this change | Not Run |
| FE-2 | Switch to manual hides auto fields | Select "Select manually" | Count/difficulty-mix inputs disappear; submitting navigates to the pick step, no `createQuiz` call fires yet | Not Run |
| FE-3 | Group auto-select | On the pick step, check one question belonging to a 4-question RC group | All 4 group members become selected/shown; running count increases by 4 | Not Run |
| FE-4 | Group auto-deselect | Uncheck any one member of the now-selected group | All 4 members become deselected together | Not Run |
| FE-5 | Standalone independent toggle | Check/uncheck a standalone question | Only that one question's selection state changes | Not Run |
| FE-6 | Running tally accuracy | Select a mix of easy/medium/hard questions | Displayed per-difficulty counts match the actual selection exactly | Not Run |
| FE-7 | Submit disabled at zero | With nothing selected | "Create quiz" (or equivalent) button is disabled | Not Run |
| FE-8 | Manual draw step hides Reshuffle | Complete a manual pick and reach the `draw` step | No "Reshuffle" button is rendered | Not Run |
| FE-9 | Auto draw step regression | Complete an auto-mode create and reach `draw` | "Reshuffle" button still present and functional | Not Run |
| FE-10 | Full manual happy path | Manual pick → scoring → schedule → lock | Quiz locks successfully end to end, matching the existing auto-mode lock flow | Not Run |

#### Chrome DevTools / extension verification

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| CHROME-1 | Manual create request payload | DevTools Network tab, trigger FE-2→FE-7's submit | `POST /api/admin/quizzes` body has `mode:"manual"`, `questionIds` array, and **no** `difficultyMix`/`count` keys | Not Run |
| CHROME-2 | Group-select network call | Network tab, perform FE-3 | A `GET /api/bank/questions?...passageId=...` request fires and its response contains exactly the 4 group members | Not Run |
| CHROME-3 | No console errors across the manual flow | Console tab open throughout FE-1 through FE-10 | No uncaught errors/warnings introduced by this change | Not Run |

#### Operator-executed (post-cutover, see AC-OPERATOR)

N/A — this is a self-contained code + migration change with no third-party configuration, secret
rotation, or external service step. The migration itself is exercised by BE-1/BE-10 above, not by
a separate operator action.

### 12c. Definition of Done

- [ ] AC-1 through AC-17 satisfied.
- [ ] §12a passes locally (and in CI, once CI exists — this repo currently has none wired for
      `npm test`, per pre-flight; run it as the local automated gate).
- [ ] BE-1..11 / FE-1..10 / CHROME-1..3 in §12b have Status ≠ `Not Run` (target: `Pass`).
- [ ] Operator table intentionally N/A (see above) — no waiver needed.
- [ ] No `<INPUT_REQUIRED>` remains in §5 (OQ-1 resolved one way or the other).
- [ ] §8a Hard NO list respected — `git diff` on each forbidden file/type is empty.
- [ ] `QUIZZING.md` §4 and `API.md`'s `POST /api/admin/quizzes` row are updated to document the
      `mode`/manual path, mirroring how Sprint 9 documented template CRUD.
- [ ] §11 Rollback plan rehearsed mentally.

---

End of Codex Task Packet — `claude-task--001`
