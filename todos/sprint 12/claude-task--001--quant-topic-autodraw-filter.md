# claude-task--001: Let admins restrict Quant auto-draw to specific topics

**Sprint:** 12  **Slug:** `quant-topic-autodraw-filter`  **Status:** Implemented

> New sprint folder, following Sprint 11's own convention (its packet's preamble: "Every prior
> sprint folder holds exactly one packet mapped to one row in `todos/PROGRESS.md`"). This packet
> adds a new, independent capability — it does not extend Sprint 11's monthly-boards scope.

---

## 1. Context

Today a Quant auto-draw (`DrawRequest{type:'quant', count, difficultyMix}`) pulls candidates by
`type`/`difficulty` only — there is no way to scope a draw to specific topics (e.g. only
"Arithmetic" and "Functions and Graphs", the two topics actually present in
`fixtures/bank.csv`). The admin asked for exactly this: a way to configure which Quant topics an
auto-draw pulls from, for one-off quizzes, reshuffles, and recurring templates alike.

**Resolved product decisions from the pre-spec interview** (recorded here so they aren't
re-litigated):

1. **Topic picker is a dropdown fed by a new backend endpoint**, not free text. `questions.topic`
   is free text with no canonical list anywhere in the system today — the only existing topic
   filter (`web/src/features/admin/AdminPages.tsx:218-224`, question-bank browse page) is a plain
   text input doing an exact match (`src/db/bank-crud.ts:29-31`, `q.topic = ?`). A free-text
   multi-value version would carry a silent-typo risk (a mistyped topic string yields fewer/zero
   draw candidates with no warning). The admin chose the dropdown, accepting a new `GET
   /api/bank/topics?type=<QuizType>` endpoint as the added cost.
2. **In scope for recurring templates too**, not just one-off creation. This mirrors this
   codebase's own established convention: commit `101c358` ("Fix LRDI/VARC auto-draw treating set
   counts as raw question counts") threaded its new `setCount`/`standaloneCount` split through
   one-off creation, reshuffle, template CRUD, *and* the materializer uniformly — never leaving one
   surface behind. `topics` follows the same four-surface path.
3. **Quant only, not verbal's VA portion or lr.** The admin's request was specifically about Quant.
   `difficultyMix`/`standaloneDifficultyMix` already establishes precedent for a filter that scopes
   only part of a `DrawRequest` (the standalone portion) — `topics` follows that precedent but
   scopes tighter still, to quant's standalone draw alone. Verbal's VA questions and lr's LRDI sets
   get no topic picker in this packet (§4).

**Current auto-draw pipeline** (read before editing every file below):

- `src/core/contracts.ts:62-66` — `SelectionFilters{type, difficultyMix, count}`, the bank-query
  shape `listUnused` consumes. `:74-82` — `DrawRequest`, discriminated by `type`; the quant arm is
  `{type:'quant', count, difficultyMix}`.
- `src/core/selection.ts:319-323` — `toBankFilters(request)`: quant branch returns
  `{type:'quant', difficultyMix: request.difficultyMix, count: request.count}`.
- `src/core/selection.ts:325-350` — `StoredDrawRequest{setCount, standaloneCount, difficultyMix}`
  plus `toStoredDrawRequest`/`fromStoredDrawRequest`, the round-trip a `quizzes`/`quiz_templates`
  row persists as and reconstructs from (used by reshuffle and materialization to redraw against
  the *original* request, never the prior draw's actual result).
- `src/db/bank-contract.ts:26-64` — `listUnused`: the standalone-question query (`:37-47`) filters
  `q.type`/`q.difficulty` only; the whole-group query (`:51-61`) is unfiltered by topic/difficulty
  by design (a group's difficulty is per-member, not filterable — BANK.md). Quant never produces
  groups in this codebase (confirmed: `fixtures/bank/cat-2018/slot-{1,2}-qa.txt` are all
  standalone; grouped DI material is `type='lr'`, not `type='quant'`) — so a quant topic filter
  only ever needs to touch the standalone query.
- `src/routes/quizzes.ts:143-153` — quant's request-body validation branch inside `POST
  /api/admin/quizzes`; `:93-105` — the route's `allowedFields` allow-list.
- `src/services/quiz-creation.ts:84-127` (`createAutoDraft`) and `:97-114`'s `insertDraft(...)`
  call — passes `stored.setCount/standaloneCount/difficultyMix` through untouched; reused as-is by
  `toBankFilters`/`selectDraw`, so only the one `insertDraft(...)` call site needs a new field.
- `src/services/templates.ts:34-80` (`isValidCoreFields`) — the same
  `wantsSetCount`/`wantsStandaloneCount` type-conditional pattern `topics` will mirror as
  `wantsTopics = input.type === 'quant'`.
- `src/routes/templates.ts:56-69` (`TEMPLATE_FIELDS`, all keys required present at create — `:94`)
  and `:38-45` (`checkDifficultyMix`, the validator shape to mirror for `checkTopics`).
- `src/services/quiz-materializer.ts:29-33` (`fromStoredDrawRequest` call) and `:61-63`
  (`insertDraft` call) — both currently omit any topics-shaped field, matching today's absence.
- `src/db/quizzes.ts` — `QuizRow` (`:8-36`), `toAdminSummary` (`:70-100`), `DraftInsert`/
  `insertDraft` (`:116-158`), `DraftForReshuffle`/`getDraftForReshuffle` (`:244-277`), `TemplateRow`/
  `getActiveTemplates` (`:603-658`), `TemplateColumnRow`/`toTemplateSummary`/`TemplateInsert`/
  `insertTemplateRow` (`:666-742`), `TemplateFieldUpdate`/`TEMPLATE_COLUMN_BY_FIELD`/
  `updateTemplateRow` (`:758-794`) — every one of these already threads `setCount`/
  `standaloneCount`/`difficultyMix` field-for-field; `topics` joins the same threading everywhere.
  `getQuizAdminSummary`/`listQuizzesPage`/`getLockSnapshot`/`getTemplateSummaryById`/
  `listTemplatesPage` all use `SELECT *` (`:185, :206, :411, :745, :752`) — a new column is
  automatically included in every row read; only the row-shaping functions above need edits.
- `web/src/features/admin/AdminPages.tsx:866-980` (`QuizBuilderPage`'s `create` handler) and
  `:1237-1261` (quant's define-step fields); `web/src/features/admin/TemplatesPanel.tsx:62-149`
  (`TemplateForm`'s `submit`) and `:220-233` (quant's fields); `web/src/features/admin/
  builder-state.ts` (74 lines, pure helpers — `mixTotal`, no multi-select reader yet).
- Docs updated by the precedent commit and due for the same treatment here: `QUIZZING.md:36-113`
  (§4, the `DrawRequest` narrative and creation sequence), `API.md:66-83` (BANK route table) and
  its QUIZZING creation/templates tables, `BANK.md:159-161` (§5 route list, "seven admin BANK
  routes" → eight), `src/routes/bank.ts:1` (route-count comment).

## 2. Objective

After this ships: creating or reshuffling a one-off Quant quiz, or creating/editing a recurring
Quant template, accepts an optional `topics: string[]` alongside the existing
`count`/`difficultyMix` — when non-empty, every standalone candidate the draw pulls from has
`topic` in that list; when empty/omitted, behavior is unchanged (draws from any topic, exactly as
today). The admin picks topics from a dropdown populated by a new `GET
/api/bank/topics?type=quant` endpoint (built generically over any `QuizType`, wired into the UI for
Quant only) rather than typing free text. Recurring Quant templates carry the same `topics` field
through to every materialized occurrence. Verbal and lr auto-draws are entirely unaffected — no
topic picker appears for them, and their stored `topics` is always `[]`.

## 3. Assumptions

- The system is pre-launch but a real, deployed D1 database exists with real content (same standing
  assumption Sprint 10/11 packets made) — the migration is written and verified as a real additive
  schema change.
- `topics TEXT NOT NULL DEFAULT '[]'` needs no backfill `UPDATE` and no recreate-table procedure:
  unlike Sprint 11's `telegram_posts` CHECK-widening (`migrations/0003_monthly_boards.sql`), a
  plain `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT '[]'` is directly supported by SQLite/D1
  and self-populates every existing row — the lowest-risk kind of migration available here.
- `MAX_TOPICS_PER_DRAW = 20` (new constant, `src/core/config.ts`) is a sanity bound on the request
  array, not a product requirement — mirrors how `ID_CHUNK_SIZE = 50`
  (`src/db/bank-contract.ts:13`) exists purely to keep D1 bound-parameter counts sane, not because
  20 or 50 is meaningful on its own. Realistic Quant topic cardinality (Arithmetic, Algebra,
  Geometry, Number Systems, Time-Speed-Distance, Percentages, ... ) is comfortably under this.
- `GET /api/bank/topics` is built generically over `type: QuizType` (any of verbal/quant/lr can be
  queried) even though only Quant gets a UI picker in this packet — this avoids hard-coding "quant"
  into an otherwise generic BANK read endpoint, at negligible extra cost (the query itself is one
  `SELECT DISTINCT` regardless of type).
- The topics list is computed over **all** questions of the given type, used and unused alike —
  mirroring the existing bank-browse topic filter's independence from the `used` filter
  (`src/db/bank-crud.ts:22-45`: `topic` and `used` are separate, uncombined conditions). A topic
  that currently has zero *unused* candidates still appears in the dropdown; selecting it and
  drawing surfaces the existing `pool_exhausted` 409 at draw time, the same class of feedback an
  over-large `count` already produces today — not a new failure mode.
- `AdminPages.tsx`'s `QuizBuilderPage` (2411-line file) has no existing test file of any kind
  (confirmed: only `builder-state.test.ts`, `rrule-builder.test.ts`, `TemplatesPanel.test.tsx` exist
  under `web/src/features/admin/`). Standing up a first RTL suite for that entire file is a
  separate, larger undertaking than this packet's scope — out of scope, §4.

## 4. Out of Scope

- **Verbal (VA standalone) and lr topic filtering** — resolved in §1; the admin's request and this
  packet are Quant-only. `standaloneDifficultyMix`/`setCount` for verbal, and `setCount` for lr,
  are untouched.
- **Editing `src/db/bank-contract.ts`'s whole-group query** (`:51-61`) — groups are never
  topic-filtered (§1); only the standalone query changes.
- **A topic picker for verbal/lr in the admin UI** — the new `GET /api/bank/topics` endpoint is
  generic, but only `QuizBuilderPage`'s and `TemplateForm`'s **quant** branches call it.
- **Standing up `web/src/features/admin/AdminPages.test.tsx`** — no such file exists today for this
  2411-line component; creating a first test harness for the whole file is out of scope (§3). The
  new quant topic-picker behavior in `QuizBuilderPage` is covered by manual/Chrome QA cases (§12b)
  instead, same honesty standard Sprint 11's packet applied to its own untestable Chrome cases.
- **Retroactively re-validating already-created quizzes/templates** — existing rows get
  `topics = '[]'` via the column default (§3); no re-draw, no re-validation, no admin notification.
- **A "topic" field on the manual-selection (`mode: 'manual'`) quiz-creation path** — manual mode
  hand-picks exact `questionIds` (Sprint 10) and never carries a `DrawRequest`/`topics` at all
  (`src/routes/quizzes.ts:117-125` already rejects any draw-request field, `topics` included, for
  `mode: 'manual'` once this ships).
- **Changing `PATCH /api/admin/quizzes/:id`** — draw-request fields (`setCount`, `standaloneCount`,
  `difficultyMix`, and now `topics`) are immutable after a draft is created, same as today; not
  part of `PATCH_ALLOWED_FIELDS` (`src/routes/quizzes.ts:216-226`) and this packet does not add
  them there. Changing topics after creation means a fresh draft or (for auto mode) reshuffle,
  which already re-reads the stored request including the new `topics` column.
- **A max-topics UI affordance beyond native `<select multiple>` behavior** — no custom "you've
  selected N of 20" counter widget; `MAX_TOPICS_PER_DRAW` is enforced server-side only (§7).

## 5. Open Questions / `<INPUT_REQUIRED>`

`(none)` — the two decisions that would otherwise be open (dropdown vs. free text; one-off-only vs.
also-templates) were resolved in the pre-spec interview and are recorded in §1.
`MAX_TOPICS_PER_DRAW`'s exact value (§3) is a low-stakes implementation default in the same spirit
as `WEEKLY_RETRY_LOOKBACK_WEEKS`/`MONTHLY_RETRY_LOOKBACK_MONTHS` — flagged for the project owner to
override post-hoc if desired, not a blocking question.

## 6. Pre-flight Checklist

- [ ] Required skill loaded: **`clean-code`** — Always.
- [ ] Required skill loaded: **`prod-safety-gate`** — this touches a production migration against a
      real (if pre-launch) D1 database, and the unattended hourly materializer path
      (`src/services/quiz-materializer.ts`) that runs in production every hour.
- [ ] Required skill loaded: **`test-driven-development`** — every new/changed function is a
      behavior change with ACs defining its tests; write each test before its implementation.
- [ ] **`vibesec` not required** — no new auth/token/PII surface. The new `GET /api/bank/topics`
      route sits behind BANK's existing `requireRole("admin")` guard unchanged
      (`src/routes/bank.ts:49`), and its one input (`type` query param) is validated against the
      same fixed `VALID_TYPES` enum every other BANK route already uses (`src/routes/bank.ts:246`).
- [ ] Working tree clean; branch up to date with `master`.
- [ ] Read before editing: `src/core/contracts.ts:1-92`, `src/core/selection.ts` (whole file, 351
      lines), `src/db/bank-contract.ts` (whole file, 153 lines), `src/db/bank-crud.ts` (whole file,
      180 lines), `src/db/bank.ts` (barrel, 25 lines), `src/routes/bank.ts:1-60, 240-300`,
      `src/routes/quizzes.ts` (whole file, 296 lines), `src/routes/templates.ts` (whole file, 203
      lines), `src/services/quiz-creation.ts:66-180`, `src/services/templates.ts` (whole file, 213
      lines), `src/services/quiz-materializer.ts` (whole file, 119 lines), `src/db/quizzes.ts`
      (whole file — read fully once, it is the single most-touched file in this packet),
      `src/core/api.ts:57-97, 225-340`, `src/core/config.ts:60-90`,
      `web/src/features/admin/AdminPages.tsx:840-980, 1140-1265`,
      `web/src/features/admin/TemplatesPanel.tsx` (whole file, 600 lines),
      `web/src/features/admin/builder-state.ts` (whole file, 74 lines),
      `web/src/api/client.ts:1-60, 155-230`, `QUIZZING.md:36-113`, `API.md:66-83`, `BANK.md:146-175`.
- [ ] Re-read every AC below before starting; note which are `AC-OPERATOR`.

## 7. Acceptance Criteria

**Schema**

- **AC-1**: `migrations/0005_quant_topic_filter.sql` adds `topics TEXT NOT NULL DEFAULT '[]'` to
  both `quizzes` and `quiz_templates` via plain `ALTER TABLE ... ADD COLUMN` (no CHECK — topic
  strings are freeform, matching `questions.topic`'s own lack of a CHECK). No data migration/UPDATE
  needed; the `DEFAULT '[]'` self-populates every existing row. Verified by
  `npx wrangler d1 migrations apply quizzer-db --local`: applies cleanly, every pre-existing
  `quizzes`/`quiz_templates` row now reads `topics = '[]'`, and a fresh insert can set a non-empty
  JSON array.

**Config**

- **AC-2**: `src/core/config.ts` gains `export const MAX_TOPICS_PER_DRAW = 20` next to
  `MAX_SEAT_CAP` (line 81), with a comment mirroring the existing "implementation bound, not a
  product setting" framing used for `WEEKLY_RETRY_LOOKBACK_WEEKS`.

**Contracts + pure selection (`src/core/contracts.ts`, `src/core/selection.ts`)**

- **AC-3**: `SelectionFilters` (`contracts.ts:62-66`) gains `topics: string[]` — always present
  (never optional), `[]` meaning "no topic filter", mirroring how `difficultyMix`/`count` are
  always present and empty/zero mean "no constraint".
- **AC-4**: `DrawRequest`'s quant variant (`contracts.ts:75`) gains `topics: string[]`:
  `{ type: 'quant'; count: number; difficultyMix: ...; topics: string[] }`. The `lr` and `verbal`
  variants are unchanged — `topics` does not exist on them at the type level, not just "always
  empty", so a caller can never accidentally set it there.
- **AC-5**: `toBankFilters` (`selection.ts:319-323`) — quant branch adds `topics: request.topics`;
  `lr`/`verbal` branches add `topics: []` explicitly (required by AC-3's non-optional field).
- **AC-6**: `StoredDrawRequest` (`selection.ts:325-329`) gains `topics: string[]`.
  `toStoredDrawRequest` (`:333-337`): quant → `topics: request.topics`; lr/verbal → `topics: []`.
  `fromStoredDrawRequest` (`:341-350`): quant → `topics: stored.topics`; lr/verbal unchanged (their
  reconstructed `DrawRequest` variants have no `topics` field per AC-4).
- **AC-7**: `selectExactDraw`/`selectSetCountDraw`/`selectVerbalDraw`/`search`/`buildUnitCandidates`
  are **unmodified** — topic filtering happens entirely at the BANK query layer (AC-8), never in
  the selector; the selector already receives a pre-filtered candidate pool for every other filter
  dimension (type, difficulty) and topics follows that exact precedent.

**BANK query + new topics-list endpoint**

- **AC-8**: `listUnused` (`src/db/bank-contract.ts:26-64`) — when `filters.topics.length > 0`, the
  standalone query (`:37-47`) gains `AND q.topic IN (${placeholders(filters.topics.length)})` with
  the topic values bound after the existing difficulty placeholders; empty `topics` adds no clause
  (identical SQL to today). The whole-group query (`:51-61`) is **byte-for-byte unchanged** — no
  topic predicate is added there (§1, §4).
- **AC-9**: new `listDistinctTopics(db: D1Database, type: QuizType): Promise<string[]>` in
  `src/db/bank-crud.ts`, exported via `src/db/bank.ts`'s barrel: `SELECT DISTINCT topic FROM
  questions WHERE type = ? ORDER BY topic ASC`. Returns `[]` for a type with zero questions
  imported, never throws.
- **AC-10**: `src/core/api.ts` gains `ListTopicsRequest = { type: QuizType }` and
  `ListTopicsResponse = { topics: string[] }`, placed beside `ListQuestionsRequest`/
  `ListQuestionsResponse` (`api.ts:164-173`).
- **AC-11**: `src/routes/bank.ts` gains `bank.get("/topics", ...)`: requires `type` query param,
  400 if missing or not one of `VALID_TYPES` (`bank.ts:246`, mirroring the existing `type` filter
  validation at `:261-263`); calls `listDistinctTopics`; returns `ListTopicsResponse`. Update the
  file's header comment (`:1`, "seven admin BANK routes") to eight.

**Quiz creation — one-off + reshuffle (`src/routes/quizzes.ts`, `src/services/quiz-creation.ts`)**

- **AC-12**: `allowedFields` (`quizzes.ts:93-105`) gains `"topics"`.
- **AC-13**: the quant branch (`quizzes.ts:143-153`) accepts an optional `topics` field:
  `b.topics === undefined` → `topics = []`; if present, must be a `string[]`, each element a
  non-empty string after trim, no duplicates, length `<= MAX_TOPICS_PER_DRAW` — else 400 `"Invalid
  topics"`. Valid `topics` (including `[]`) flows into `input.topics` on the constructed
  `CreateInput`.
- **AC-14**: the `lr` branch (`:154-160`) and `verbal` branch (`:161-186`) both reject a request
  that includes `topics`, extending their existing "wrong-branch field" 400 exactly like they
  already reject `count`/`difficultyMix` (lr) or `count`/`difficultyMix` (verbal) — new message:
  `"topics is only accepted for type quant"`.
- **AC-15**: `createAutoDraft` (`src/services/quiz-creation.ts:84-127`) is otherwise unchanged
  (`toBankFilters`/`selectDraw` already thread `topics` per AC-5); its `insertDraft(...)` call
  (`:97-114`) gains `topics: stored.topics`.
- **AC-16**: reshuffle (`reshuffleDraft`, `quiz-creation.ts:192-221`) needs **no code change** — it
  already reconstructs the full `DrawRequest` via `fromStoredDrawRequest(draft.type, {...})`
  (`:198-202`); once `getDraftForReshuffle` returns `topics` (AC-19) and `fromStoredDrawRequest`
  threads it (AC-6), the existing call sites automatically redraw within the same topics
  constraint. Covered by BE-6 (§12b) as a behavior verification, not a code-diff AC.

**Template CRUD (`src/routes/templates.ts`, `src/services/templates.ts`)**

- **AC-17**: `TEMPLATE_FIELDS` (`templates.ts:56-69`) gains `"topics"` — required present at create
  (`validateCreateBody`, `:90-111`), like every other field.
- **AC-18**: new `checkTopics(value: unknown): string | null` in `src/routes/templates.ts`,
  mirroring `checkDifficultyMix` (`:38-45`): must be an array of non-empty trimmed strings, no
  duplicates, length `<= MAX_TOPICS_PER_DRAW`. Called from both `validateCreateBody` (require
  `"topics" in body`, unlike `setCount`/`standaloneCount` which may be `null` — `topics` is never
  `null`, always `string[]`, empty array is how "not applicable"/"no filter" is expressed for every
  type) and `validatePatchBody` (`:143-177`, only `if ("topics" in body)`).
- **AC-19**: `isValidCoreFields` (`src/services/templates.ts:34-80`) gains `wantsTopics = input.type
  === 'quant'` alongside `wantsSetCount`/`wantsStandaloneCount`. If `!wantsTopics`, `topics` must be
  `[]` (mirrors how lr's `difficultyMix` must sum to 0, `:78`) — a verbal/lr template with a
  non-empty `topics` is rejected 400. Quant may send `[]` or a non-empty validated array.
- **AC-20**: `patchTemplate` (`templates.ts:145-200`)'s `touchesCoreFields` check (`:149-154`) adds
  `patch.topics !== undefined`; the effective-value reconstruction (`:156-165`) adds `topics:
  patch.topics ?? current.topics` before re-validating via `isValidCoreFields`.
- **AC-21**: `src/core/api.ts`'s `TemplateSummary`/`CreateTemplateRequest`
  (`api.ts:299-329`) both gain `topics: string[]`; `UpdateTemplateRequest = Partial<
  CreateTemplateRequest>` (`:338`) picks it up automatically — no separate edit needed there.

**Persistence (`src/db/quizzes.ts`) — additive threading only, mirrors `difficulty_mix` exactly**

- **AC-22**: `QuizRow` (`:8-36`) gains `topics: string`; `toAdminSummary` (`:70-100`) parses it via
  `parseJsonColumn<string[]>(row.topics) ?? []` and assigns `topics` on the returned
  `QuizAdminSummary` (new field, `src/core/api.ts:68-96`, added after `difficultyMix` at line 77).
- **AC-23**: `DraftInsert` (`:116-132`) gains `topics: string[]`; `insertDraft`'s SQL (`:134-158`)
  adds a `topics` column to the `INSERT` list and binds `JSON.stringify(draft.topics)`.
- **AC-24**: `DraftForReshuffle` (`:244-253`) gains `topics: string[]`; `getDraftForReshuffle`
  (`:255-277`) selects the new column and parses it (`?? []`).
- **AC-25**: `TemplateRow` (`:603-618`, the materializer-facing read type) gains `topics: string[]`;
  `getActiveTemplates` (`:620-658`) selects and parses it.
- **AC-26**: `TemplateColumnRow`/`toTemplateSummary`/`TemplateInsert`/`insertTemplateRow`
  (`:666-742`) all gain `topics` field-for-field, same JSON-stringify/parse pattern as
  `difficultyMix`.
- **AC-27**: `TemplateFieldUpdate` (`:758-771`) gains `topics?: string[]`;
  `TEMPLATE_COLUMN_BY_FIELD` (`:773-786`) gains `topics: "topics"`; `updateTemplateRow`'s
  stringify-branch (`:792`) adds `field === "topics"` alongside `"difficultyMix"`/`"timingPolicy"`.

**Materializer (`src/services/quiz-materializer.ts`)**

- **AC-28**: `materializeOccurrence` (`:23-95`) — the `fromStoredDrawRequest` call (`:29-33`) adds
  `topics: template.topics`; the `insertDraft` call (`:53-70`) adds `topics: template.topics`. No
  other line in this file changes — `selectDraw`/`toBankFilters` already thread topics generically
  per AC-5/AC-6, so a materialized occurrence for a topic-scoped Quant template automatically draws
  only from those topics with zero additional logic.

**Frontend**

- **AC-29**: `web/src/api/client.ts` gains `topics: (type: QuizType) => get<ListTopicsResponse>(
  withQuery("/api/bank/topics", { type }))`, placed beside `questions` (`:162-163`); import
  `ListTopicsRequest`/`ListTopicsResponse` (unused-type-only import for the response) alongside the
  existing `ListQuestionsRequest`/`ListQuestionsResponse` import block (`client.ts:24-25`).
- **AC-30**: new `readMultiSelect(form: FormData, name: string): string[]` in
  `web/src/features/admin/builder-state.ts`, reading every selected `<option>` value for a given
  field name from a submitted `FormData` (a native multi-`<select>` submits one `FormData` entry
  per selected option under the same key — `form.getAll(name).map(String)`), mirroring `mixTotal`'s
  existing pure-helper style in the same file.
- **AC-31**: `QuizBuilderPage` (`AdminPages.tsx:866-980`) — when `defineType === "quant"` and
  `defineMode === "auto"`, fetches `api.topics("quant")` once (via `useResource` or an inline
  effect, mirroring the file's existing `useResource` usage elsewhere e.g. `:151-154`) and renders
  a `<select multiple>` of the returned topics inside the existing quant fields block
  (`:1237-1261`), alongside `count` and the difficulty fields. On submit (`create`, `:883-972`),
  the quant branch (`:942-951`) reads `readMultiSelect(form, "topics")` and includes `topics` in
  the constructed `draw` object. lr/verbal branches are untouched and never send `topics`.
- **AC-32**: `TemplateForm` (`TemplatesPanel.tsx:62-149`) — same pattern: a topics `<select
  multiple>` rendered only in the `type === "quant"` fields block (`:220-233`), pre-selected from
  `initial?.topics` on edit (mirroring `defaultValue={initial?.standaloneCount ?? undefined}` at
  `:229`, adapted for a multi-select's `defaultValue={initial?.topics}` prop), read via
  `readMultiSelect(form, "topics")` in `submit` (`:80-149`) and included in the `onSubmit(...)`
  payload (`:131-148`) as `topics` — `[]` when `type !== "quant"`, matching how `setCount`/
  `standaloneCount` are already forced to the type-appropriate value in that same function.
- **AC-33**: `describeDraw` (`TemplatesPanel.tsx:44-53`) — the quant branch appends the topic list
  when non-empty, e.g. `"20 questions (Arithmetic, Percentages)"` vs. today's `"20 questions"` when
  `topics` is `[]`.

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not add a topic predicate to `bank-contract.ts`'s whole-group query (`:51-61`) — `git diff`
  on that specific query block must show only the standalone query changed.
- Do not add a topic picker to verbal's VA fields or lr's fields in either `AdminPages.tsx` or
  `TemplatesPanel.tsx` — `topics` UI is quant-only (§1, §4).
- Do not touch `src/core/selection.ts`'s selector functions (`selectExactDraw`,
  `selectSetCountDraw`, `selectVerbalDraw`, `search`, `buildUnitCandidates`, `assemble`,
  `buildManualDraw`) — topic filtering is entirely a BANK-query-layer concern (AC-7).
- Do not add `topics` to `PATCH_ALLOWED_FIELDS`/`PATCH /api/admin/quizzes/:id` — draw-request
  fields stay immutable post-creation (§4).
- Do not create `web/src/features/admin/AdminPages.test.tsx` — out of scope (§3, §4); do not treat
  its absence as something this packet must fix.
- Do not touch `src/services/quiz-creation.ts`'s `createManualDraft`, `lockQuiz`,
  `reserveClaimAndPublish`, or `cancel` — manual mode has no `DrawRequest` at all (§4), and lock/
  reserve/cancel operate on already-drawn content, never the original request.
- Do not widen `GET /api/bank/topics` to accept multiple `type` values in one call or to filter by
  `used` — a single required `type`, full stop (AC-11); this is a small lookup endpoint, not a
  second `GET /api/bank/questions`.

### 8b. Coding / quality principles

- `clean-code`: every new function mirrors an existing sibling's exact shape (`checkTopics` next to
  `checkDifficultyMix`; `listDistinctTopics` next to `listQuestionsPage` in the same file) — no
  invented "generic DrawRequest field" abstraction layer collapsing `setCount`/`standaloneCount`/
  `difficultyMix`/`topics` into one config object; this codebase already chose explicit parallel
  fields over that, twice (Sprint 9's template CRUD, then commit `101c358`'s set/standalone split).
- `prod-safety-gate`: the materializer change (AC-28) runs unattended in production every hour
  (`src/index.ts`'s `HOURLY_CRON` branch) — a bug in the `fromStoredDrawRequest`/`insertDraft` topic
  threading would either silently ignore a configured topic filter (draws from everywhere, quietly
  wrong) or over-constrain it (spurious `pool_exhausted` failures for previously-fine templates).
  Cover both directions explicitly in BE-9/BE-10 (§12b), not just a happy path. The migration
  (AC-1) is low-risk by construction (§3) but still verify locally before `--remote` (§12a).
- `test-driven-development`: write the test for each AC before its implementation — in particular
  AC-13/AC-14's route-validation branches and AC-19's type-conditional `isValidCoreFields` check
  are exactly the kind of boolean-logic edge case (right constraint, wrong type) that's easy to get
  backwards without a test written first.
- Mirror `tests/selection.test.ts`, `tests/bank.test.ts`, `tests/quizzes.routes.test.ts`,
  `tests/templates.test.ts`, `tests/templates.routes.test.ts`, `tests/quiz-materializer.test.ts`
  for backend test structure; mirror `web/src/features/admin/TemplatesPanel.test.tsx`'s
  `vi.mock("../../api/client", ...)` pattern for the new template-form topics test case, and
  `web/src/features/admin/builder-state.test.ts`'s plain-function-test style for `readMultiSelect`.

## 9. Behavior Spec (per file)

### `migrations/0005_quant_topic_filter.sql` (NEW)

- **Current state:** does not exist.
- **Required edit:** two `ALTER TABLE ... ADD COLUMN topics TEXT NOT NULL DEFAULT '[]'` statements
  (AC-1).
- **Estimated diff:** ~15 LOC (new file, mostly comment).
- **Subtleties:** no `PRAGMA foreign_keys` dance needed (unlike `0003`'s table recreate) — a plain
  `ADD COLUMN` with a default is the simplest migration shape in this codebase so far.

### `src/core/config.ts` (EDIT, additive)

- **Current state (line 81):** `export const MAX_SEAT_CAP = 120`.
- **Required edit:** add `MAX_TOPICS_PER_DRAW = 20` (AC-2).
- **Estimated diff:** ~3 LOC.

### `src/core/contracts.ts` (EDIT, additive)

- **Current state (`:62-66`, `:74-82`):** `SelectionFilters`, `DrawRequest`.
- **Required edit:** AC-3, AC-4.
- **Estimated diff:** ~4 LOC.

### `src/core/selection.ts` (EDIT, additive)

- **Current state:** `toBankFilters` (`:319-323`), `StoredDrawRequest`/`toStoredDrawRequest`/
  `fromStoredDrawRequest` (`:325-350`).
- **Required edit:** AC-5, AC-6.
- **Estimated diff:** ~10 LOC.

### `src/db/bank-contract.ts` (EDIT)

- **Current state (`:26-64`):** `listUnused`, standalone query at `:37-47`.
- **Required edit:** AC-8 — extend the standalone query's `WHERE` and bind list.
- **Estimated diff:** ~8 LOC.
- **Subtleties:** bind order matters — difficulty placeholders (`...difficulties`) already precede
  the topic placeholders in the existing pattern; append topics after, matching
  `claimUnused`/`getByIds`'s existing `placeholders()` helper (`:16-18`) rather than hand-rolling a
  new one.

### `src/db/bank-crud.ts` (EDIT, additive)

- **Current state:** `listQuestionsPage`, `getQuestionById`, `listPassages`, `updateQuestion`,
  `deleteQuestionCascade`.
- **Required edit:** add `listDistinctTopics` (AC-9).
- **Estimated diff:** ~8 LOC.

### `src/db/bank.ts` (EDIT — barrel, one line)

- **Current state (`:13-22`):** re-exports from `bank-crud.ts`.
- **Required edit:** add `listDistinctTopics` to the export list.
- **Estimated diff:** 1 LOC.

### `src/core/api.ts` (EDIT, additive)

- **Current state:** `ListQuestionsRequest`/`Response` (`:164-173`), `QuizAdminSummary` (`:68-96`),
  `TemplateSummary`/`CreateTemplateRequest` (`:299-329`).
- **Required edit:** AC-10, AC-21, and `QuizAdminSummary.topics: string[] | null` (mirroring
  `difficultyMix`'s nullability at `:77` — `null` only for a row with no `question_count` yet,
  i.e. never actually reached for a persisted draft since `insertDraft` always sets it; kept
  nullable purely for type-shape parity with its siblings).
- **Estimated diff:** ~12 LOC.

### `src/routes/bank.ts` (EDIT, additive)

- **Current state:** whole file, `bank.get("/questions", ...)` at `:249-285`.
- **Required edit:** AC-11.
- **Estimated diff:** ~15 LOC.

### `src/routes/quizzes.ts` (EDIT)

- **Current state:** `allowedFields` (`:93-105`), quant/lr/verbal branches (`:143-186`).
- **Required edit:** AC-12, AC-13, AC-14.
- **Estimated diff:** ~20 LOC.

### `src/services/quiz-creation.ts` (EDIT — one call site)

- **Current state (`:97-114`):** `insertDraft(...)` call inside `createAutoDraft`.
- **Required edit:** AC-15 — add `topics: stored.topics`.
- **Estimated diff:** 1 LOC.
- **Subtleties:** this is the *only* line in this file that changes. `reshuffleDraft` needs zero
  edits (AC-16) — resist the urge to "also touch it for clarity"; that would violate the "no
  changes beyond what's needed" principle for a function that's already correctly generic.

### `src/routes/templates.ts` (EDIT)

- **Current state:** `TEMPLATE_FIELDS` (`:56-69`), `checkDifficultyMix` (`:38-45`),
  `validateCreateBody`/`validatePatchBody` (`:90-177`).
- **Required edit:** AC-17, AC-18.
- **Estimated diff:** ~20 LOC.

### `src/services/templates.ts` (EDIT)

- **Current state:** `isValidCoreFields` (`:34-80`), `patchTemplate` (`:145-200`).
- **Required edit:** AC-19, AC-20.
- **Estimated diff:** ~12 LOC.

### `src/db/quizzes.ts` (EDIT — the largest single-file diff in this packet)

- **Current state:** described exhaustively in §1; every type/function listed there already
  threads `setCount`/`standaloneCount`/`difficultyMix` field-for-field.
- **Required edit:** AC-22 through AC-27 — add `topics` to each, same JSON-stringify/parse pattern
  as `difficultyMix` throughout.
- **Estimated diff:** ~35 LOC (many small additions across a ~800-line file — if the actual diff
  meaningfully exceeds this, check for an accidental behavior change to an untouched sibling
  field, not more topics-specific logic than these ACs describe).

### `src/services/quiz-materializer.ts` (EDIT — two call sites)

- **Current state (`:29-33`, `:53-70`):** `fromStoredDrawRequest` and `insertDraft` calls inside
  `materializeOccurrence`.
- **Required edit:** AC-28.
- **Estimated diff:** ~2 LOC.

### `web/src/api/client.ts` (EDIT, additive)

- **Current state (`:162-163`):** `questions`.
- **Required edit:** AC-29.
- **Estimated diff:** ~5 LOC.

### `web/src/features/admin/builder-state.ts` (EDIT, additive)

- **Current state:** whole file, 74 lines, pure helpers only.
- **Required edit:** AC-30.
- **Estimated diff:** ~5 LOC.

### `web/src/features/admin/builder-state.test.ts` (EDIT, additive)

- **Current state:** whole file, 146 lines, tests the existing pure helpers.
- **Required edit:** test `readMultiSelect` against a `FormData` with zero/one/multiple selected
  options for the same field name.
- **Estimated diff:** ~15 LOC.

### `web/src/features/admin/AdminPages.tsx` (EDIT)

- **Current state:** `QuizBuilderPage` (`:866-980` for `create`, `:1237-1261` for quant fields).
- **Required edit:** AC-31.
- **Estimated diff:** ~30 LOC.
- **Subtleties:** the topics fetch must be gated on `defineType === "quant"` — do not fetch on
  every builder-page render regardless of section, matching how the difficulty/count fields
  already only render conditionally (`:1237` `defineMode === "auto" && defineType === "quant"`).

### `web/src/features/admin/TemplatesPanel.tsx` (EDIT)

- **Current state:** `TemplateForm` (`:62-149` for `submit`, `:220-233` for quant fields),
  `describeDraw` (`:44-53`).
- **Required edit:** AC-32, AC-33.
- **Estimated diff:** ~30 LOC.

### `web/src/features/admin/TemplatesPanel.test.tsx` (EDIT, additive)

- **Current state:** whole file, 381 lines, RTL tests over `TemplateForm`/`TemplatesPanel` against
  a mocked `api` client.
- **Required edit:** a case asserting the quant topics `<select multiple>` renders, submits
  selected values as `topics`, and is absent for lr/verbal types.
- **Estimated diff:** ~25 LOC.

### `QUIZZING.md`, `API.md`, `BANK.md` (EDIT, docs)

- **Current state:** `QUIZZING.md:36-113` (§4's `DrawRequest` narrative), `API.md:66-83` (BANK
  route table) plus its QUIZZING creation/templates tables, `BANK.md:159-161` (§5 route list).
- **Required edit:** document `topics` on the quant `DrawRequest` variant, the new `GET
  /api/bank/topics` route, and bump BANK's route count (seven → eight), following exactly the
  documentation-alongside-code pattern commit `101c358` already established for this same area.
- **Estimated diff:** ~20 LOC across three files.

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Materializer silently drops the topic filter on a recurring template (threading bug in `fromStoredDrawRequest`/`insertDraft`) — draws from all topics instead of the configured subset | Low | Medium — wrong-but-plausible-looking quizzes generated unattended, hourly, with no error | AC-28's explicit two-call-site edit + BE-9/BE-10 (§12b) testing both "topic honored" and "topic over-constrains" directions |
| Materializer over-constrains instead: a previously-fine template starts failing `pool_exhausted` every occurrence because `topics` was set too narrowly relative to the bank's actual content | Low | Medium — recurring quizzes silently stop being created; existing hourly-tick failure-alert path (Telegram + email, unchanged) is the only signal | Same BE-9/BE-10 coverage; §1's dropdown-not-free-text decision already reduces (but doesn't eliminate) the chance of an admin picking a topic string that doesn't match any bank content |
| `listDistinctTopics` / `GET /api/bank/topics` becomes stale relative to a CSV import that just added a new topic, if the admin UI caches the dropdown across a session | Low | Low — admin can't select a brand-new topic until they reload; no data corruption | Fetch topics fresh per `QuizBuilderPage`/`TemplateForm` mount (AC-31/AC-32), never cache across the admin session client-side |
| Whole-group query accidentally gains a topic predicate during implementation (easy copy-paste mistake from the standalone query right above it) | Low | Medium — would silently start excluding valid RC/LRDI groups from every verbal/lr draw, an unrelated regression | AC-8's explicit "byte-for-byte unchanged" requirement + `git diff` review specifically isolating that query block |
| `db/quizzes.ts`'s many small threading edits (AC-22–27) miss one read/write path, leaving `topics` silently dropped on one of the six touched row-shapes | Medium (breadth, not depth, is the risk here) | Medium | §9's per-function enumeration is exhaustive against the current file; BE-1..BE-10 (§12b) exercise create, reshuffle, template create/patch, and materialize as independent paths, so a missed threading point fails at least one test |
| `readMultiSelect`'s `FormData.getAll` behavior differs from assumption in a way that silently submits `topics: []` even when options are selected | Low | Medium — quant draws would silently ignore the admin's topic selection | AC-30's dedicated unit test (builder-state.test.ts) plus FE-2/FE-3 (§12b) exercising the real `<select multiple>` submit path |

## 11. Rollback / Revert Plan

1. `git revert <sha>` for the implementation commit(s).
2. If `migrations/0005_quant_topic_filter.sql` was already applied (local or `--remote`), there is
   no `migrate:down` tooling in this project (`package.json:14-15` only has `apply`) — write and
   apply a compensating `0006_revert_quant_topic_filter.sql` with `ALTER TABLE quizzes DROP COLUMN
   topics;` and `ALTER TABLE quiz_templates DROP COLUMN topics;` (D1/SQLite supports `DROP COLUMN`
   directly, confirmed already in use for `quiz_templates.question_count` in
   `migrations/0004_lrdi_varc_set_count.sql:41` — no recreate-table procedure needed here either).
3. Redeploy: `npm run build && npx wrangler deploy`.
4. Verification: `curl <deployed-url>/api/bank/topics?type=quant` returns 404 (route gone) or the
   revert is otherwise confirmed complete; `POST /api/admin/quizzes` with a quant body still
   behaves exactly as before this packet (no `topics` field accepted or required).
5. Notification: tell the project owner the topic filter was reverted and why; confirm whether any
   already-created quizzes/templates that used a non-empty `topics` need manual review (their rows
   simply lose the column — no cascading data loss, since `topics` was purely a draw-time filter
   input, never referenced by scoring, results, or boards).

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

# Hard NO list — verify only the intended query changed
git diff -- src/db/bank-contract.ts   # confirm only the standalone query's WHERE/bind changed
git diff -- src/routes/quizzes.ts     # PATCH_ALLOWED_FIELDS block must show no change
git diff -- web/src/features/admin/AdminPages.tsx | grep -c "topic" # sanity: verbal/lr blocks untouched

# Migration verification (local only — never run --remote until this passes)
npx wrangler d1 migrations apply quizzer-db --local
```

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | `GET /api/bank/topics?type=quant` happy path | Seed quant questions across 2 topics, request | 200, `{topics: [...]}` sorted, matches distinct topics in the bank | Pass (`tests/bank.test.ts` "GET /api/bank/topics") |
| BE-2 | `GET /api/bank/topics` missing/invalid type | Omit `type`, or pass `type=bogus` | 400 | Pass (`tests/bank.test.ts` "GET /api/bank/topics") |
| BE-3 | `listUnused` topic filter | Seed quant questions in topics A and B; call with `topics: ["A"]` | Only topic-A standalone candidates returned; whole-group candidates (unaffected type) still returned unfiltered | Pass (`tests/bank.test.ts` "listUnused filters the standalone query by topic...") |
| BE-4 | `POST /api/admin/quizzes` quant with topics | `type: 'quant', count, difficultyMix, topics: ["A"]` where only 1 matching question exists but count=5 | 409 `pool_exhausted` (not enough candidates in the constrained topic) | Pass (`tests/quizzes.routes.test.ts` "BE-4: draws only from the given topics...") |
| BE-5 | `POST /api/admin/quizzes` lr/verbal rejects topics | Send `topics` with `type: 'lr'` or `type: 'verbal'` | 400 | Pass (`tests/quizzes.routes.test.ts` "BE-5: rejects topics sent with type lr or verbal") |
| BE-6 | Reshuffle honors stored topics | Create a quant draft with `topics: ["A"]`, reshuffle | Redraw only pulls topic-A candidates again, with no code path having been told about topics explicitly at the route layer | Pass (`tests/quizzes.routes.test.ts` "BE-6: reshuffle redraws only within the topics stored on the draft") |
| BE-7 | Template create/patch topics validation | Create quant template with `topics: ["A","A"]` (duplicate) | 400; create with valid `topics` succeeds; PATCH a verbal template with non-empty `topics` | 400 | Pass (`tests/templates.routes.test.ts` "BE-7:..." cases; `tests/templates.test.ts` core-fields cases) |
| BE-8 | Template create requires `topics` key present | POST template body omitting `topics` entirely | 400 "Missing field" | Pass (`tests/templates.routes.test.ts` "BE-8: rejects a body that omits the topics key entirely") |
| BE-9 | Materializer honors template topics | Active quant template with `topics: ["A"]`, run `materializeTemplates` | Materialized quiz's questions are all topic A | Pass (`tests/quiz-materializer.test.ts` "BE-9: honors a template's configured topics...") |
| BE-10 | Materializer over-constrained topics fails cleanly | Template `topics` matching zero unused questions | Materialization reports `pool_exhausted` failure for that occurrence, no partial draft left behind | Pass (`tests/quiz-materializer.test.ts` "BE-10: reports pool_exhausted...") |
| BE-11 | Migration round-trip | `npx wrangler d1 migrations apply quizzer-db --local` | Applies cleanly; every pre-existing row reads `topics = '[]'`; a new insert with a non-empty topics array round-trips correctly | Pass (applied cleanly during implementation; round-trip exercised by every backend test that creates a quiz/template row) |

#### Frontend / UI

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| FE-1 | Topics picker appears only for quant | In the quiz builder, switch section between verbal/quant/lr | Topics `<select multiple>` renders only when quant + auto mode is selected | Pass (`TemplatesPanel.test.tsx` "FE-1: shows a topics picker only for quant..."; `AdminPages.tsx`'s quant-only render has no dedicated test file per §3/§4 scope, covered by this equivalent template-form case using the same conditional-render pattern) |
| FE-2 | Selecting topics submits them | Select 2 topics, submit the define step | `api.createQuiz` called with `topics: [the 2 selected values]` | Pass (`TemplatesPanel.test.tsx` "FE-2: submits the selected topics for a quant template"; `AdminPages.tsx`'s analogous `create` handler change is the same `readMultiSelect` call, not independently unit-tested per §3/§4 scope) |
| FE-3 | Template form topics round-trip | Create a quant template with 1 topic selected, then open it for edit | The topic appears pre-selected on the edit form | Pass (`TemplatesPanel.test.tsx` "FE-3: pre-selects the template's stored topics on edit") |
| FE-4 | `describeDraw` shows topics when set | View a template list with a quant template that has non-empty `topics` | Summary text includes the topic names; a template with `topics: []` shows the count-only text unchanged | Pass (`TemplatesPanel.test.tsx` "FE-4: describeDraw appends selected topics..." and "does not append a topics suffix...") |
| FE-5 | `readMultiSelect` unit coverage | Unit test with 0/1/many selected options for the same field name | Returns `[]`, `[value]`, `[value1, value2]` respectively | Pass (`builder-state.test.ts` "readMultiSelect" describe block) |

#### Chrome DevTools / extension verification

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| CHROME-1 | Quant create request payload | Network tab, perform FE-2 in a real signed-in admin session | `POST /api/admin/quizzes` body includes `topics: [...]`; other types' requests never include the key | Not Run — requires a running app + real Google sign-in, not exercised in this implementation session (same limitation Sprint 11's packet documented for its own Chrome cases). Equivalent coverage: FE-2's mocked-`api` assertion on the exact request body. |
| CHROME-2 | No console errors across the topics picker flow | Console tab open through FE-1→FE-4 | No uncaught errors/warnings introduced | Not Run — same limitation as CHROME-1; equivalent coverage: the FE test suite's pristine (no console error) run. |

#### Operator-executed (post-cutover, see AC-OPERATOR)

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| OP-1 | Migration applied to production D1 | `npx wrangler d1 migrations apply quizzer-db --remote`, only after AC-1/BE-11 pass locally | Applies cleanly; spot-check a few existing `quizzes`/`quiz_templates` rows read `topics = '[]'` | Not Run |
| OP-2 | First real topic-scoped Quant template | Configure one real recurring Quant template with a non-empty `topics`, wait for (or trigger via `POST /materialize-now`) the next occurrence | The materialized quiz's questions are all from the configured topic(s) | Not Run |

**Mandatory rules:** every case above must reach a Status other than `Not Run` before this packet
is considered done; the implementer fills BE/FE/Chrome, the operator fills OP. No case is waived —
all four tables are populated and applicable (this packet has backend, frontend, and operator
surfaces).

### 12c. Definition of Done

- [x] AC-1 through AC-33 satisfied.
- [x] §12a passes locally (backend + frontend test suites, both `tsc --noEmit`, `npm run build`,
      local migration apply).
- [x] BE-1..11 / FE-1..5 in §12b have Status ≠ `Not Run` (target: `Pass`); CHROME-1/CHROME-2
      honestly left `Not Run` with their equivalent-coverage note if no live browser session with
      real Google sign-in is available during implementation — not fabricated as passing.
- [ ] OP-1..2 completed by the operator (or explicitly waived in §5 — none are currently waived).
- [x] No `<INPUT_REQUIRED>` remains in §5.
- [x] §8a Hard NO list respected — every listed `git diff` matches its expected narrow scope.
- [x] §11 Rollback plan rehearsed mentally.

---

End of Codex Task Packet — `claude-task--001`
