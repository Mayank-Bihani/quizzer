# claude-task--001: Admin CRUD for recurring quiz templates

**Sprint:** 9  **Slug:** `recurring-template-admin-crud`  **Status:** Draft

> Implements the four routes QUIZZING.md §4.4 (resolved 2026-09-12) and API.md's "QUIZZING —
> templates" section already specify, so an admin can create/list/view/edit/deactivate
> `quiz_templates` rows instead of the Sprint 7 materializer's rows being seeded directly into D1
> (`SCHEDULER.md:116-118`: "until then, rows are seeded directly into D1 and must already
> conform"). No schema change, no new materializer behavior — this packet is pure CRUD in front of
> the table Sprint 7 already reads.

---

## 1. Context

Sprint 7 shipped `materializeTemplates` (`src/services/quiz-materializer.ts`) and its sole reader
of template rows, `getActiveTemplates` (`src/db/quizzes.ts:596-632`), which selects every column
of `quiz_templates` `WHERE active = 1` and parses `difficulty_mix`/`timing_policy` JSON into
`TemplateRow`. At the time, template CRUD was explicitly deferred: "Template CRUD remains
deferred, with DB configuration accepted until that feature is built" (`SCHEDULER.md:105`) and
"rows are seeded directly into D1 and must already conform" (`SCHEDULER.md:117-118`). That
deferral ended on 2026-09-12: QUIZZING.md §4.4 states "Admin CRUD on `quiz_templates` is in scope:
create, list, view, edit and deactivate" (`QUIZZING.md:100`), and API.md added the exact route
table this packet must implement (`API.md:164-186`):

| Method | Path | Request | Response | Extra status codes |
|---|---|---|---|---|
| `GET` | `/api/admin/templates` | `ListTemplatesRequest` | `ListTemplatesResponse` | 400, 403 |
| `POST` | `/api/admin/templates` | `CreateTemplateRequest` | `CreateTemplateResponse` | 400, 403 |
| `PATCH` | `/api/admin/templates/:id` | `UpdateTemplateRequest` | `UpdateTemplateResponse` | 400, 403, 404 |
| `POST` | `/api/admin/templates/:id/deactivate` | — | `DeactivateTemplateResponse` | 403, 404, 409 |

**Three decisions are already closed and must not be re-opened in this packet** (QUIZZING.md §4.4,
`QUIZZING.md:98-119`; confirmed again in the dispatch brief for this sprint): template CRUD is in
scope; an edit to an active template affects only its future materializations, never the
already-persisted units/questions/timing of quizzes already produced from it, so no versioning or
history table is introduced; and template save never dry-runs the draw against current bank
counts — `materializeTemplates`'s existing hourly `MaterializationFailure`/dual-channel alert path
(`CONTRACTS.md:225-230`; `MODULES.md:155-159`) remains the only pool-exhaustion signal, unchanged
by this sprint. There is also no hard delete: `POST /:id/deactivate` only flips `active` to 0
(`API.md:183-185`), because `quizzes.template_id REFERENCES quiz_templates(id)`
(`migrations/0001_init.sql:65`) would orphan history if a row were ever removed. No reactivate
route exists in the resolved four-route table above — do not add one.

**Fields mirror a manual quiz definition, validated the same way.** QUIZZING.md §4.4 says a
template's fields "mirror a manual quiz definition: `name`, `type`, `questionCount`,
`difficultyMix`, `timingPolicy` (only the unit kinds implied by `type`, matching the same
per-used-kind validation `patchSettings` already applies to manual quizzes), `slackSec`,
`joinWindowSec`, `marksCorrect`, `marksWrong`, `seatCap`, and `rrule`... Reject a body outside
these fields the same way manual creation does" (`QUIZZING.md:105-110`). The two patterns to mirror
already exist and must not be duplicated, only reused as a template:

- **`patchSettings`'s per-used-kind `timingPolicy` validation**
  (`src/services/quiz-creation.ts:157-163`): `const usedKinds = new Set(current.units.map((u) =>
  u.kind)); for (const kind of usedKinds) { const value = patch.timingPolicy[kind]; if (value ===
  undefined || !Number.isInteger(value) || value <= 0) return { kind: "invalid" } }`. A quiz has
  concrete drawn units to read `usedKinds` from; a template has no drawn units — see §9's
  `src/services/templates.ts` entry for how "the unit kinds implied by `type`" is derived instead,
  from the section→group-kind mapping QUIZZING.md §4 already states: "A grouped verbal question
  belongs to an `rc` unit; grouped quant/lr questions to an `lrdi` unit" (`QUIZZING.md:54`).
- **`routes/quizzes.ts`'s allowlisted-body-parsing pattern**
  (`src/routes/quizzes.ts:56-82` for a full-create POST that rejects unknown fields and validates
  every field before calling the service; `src/routes/quizzes.ts:107-156` for a `Partial<...>`
  PATCH body validator that rejects unknown fields, rejects `null`, and validates only the keys
  present).

**The read contract this packet must not disturb.** `getActiveTemplates` returns `TemplateRow[]`
(`src/db/quizzes.ts:580-632`) and `materializeTemplates` consumes it unchanged
(`src/services/quiz-materializer.ts:81-97`); nothing in this packet may alter `TemplateRow`'s
shape, `getActiveTemplates`'s query, or any line of `src/services/quiz-materializer.ts`. New CRUD
reads/writes are additive siblings in `src/db/quizzes.ts`, not edits to that function.

**`rrule` validation reuses the existing parser, never re-implements its grammar.** The minimal
RFC 5545 subset — `FREQ=WEEKLY;BYDAY=<day list>;BYHOUR=<H>;BYMINUTE=<MM>`, no `COUNT`/`UNTIL`/other
part recognized — was resolved 2026-09-10 and is already implemented as `expandRrule` in
`src/core/schedule.ts:58-98` (documented in `SCHEDULER.md:107-118`, not in a `QUIZZING.md §4.2`
section — that section does not exist in the current `QUIZZING.md`; the grammar itself lives in
`SCHEDULER.md` and its parser in `src/core/schedule.ts`, and this packet cites those, not a
nonexistent QUIZZING.md subsection). `SCHEDULER.md:116-117` says it directly: "Template CRUD
(still deferred) is expected to validate this same grammar when it's eventually built" — this
packet is that CRUD, and it must call `expandRrule`, not hand-parse `FREQ`/`BYDAY`/`BYHOUR`/
`BYMINUTE` a second time.

**No wire types exist yet for this route group.** `src/core/api.ts` (467 lines, read in full) has
no `Template*` type at all — only `materializeTemplates` in the `QuizzingSchedulerContract`
(`src/core/contracts.ts:157`) mentions templates, and that is a module-internal call signature, not
an HTTP type. This packet must add the request/response types API.md's prose already specifies
(`API.md:168-185`) before the route file can compile against them.

**No `src/routes/templates.ts` exists.** `src/routes/` currently has 8 files (`admins.ts`,
`auth.ts`, `bank.ts`, `boards.ts`, `images.ts`, `play.ts`, `quizzes.ts`, `reports.ts`,
`results.ts`) and none of them is templates; this is a new file, mounted the same way
`src/routes/quizzes.ts` is mounted at `/api/admin/quizzes` in `src/index.ts:90` — see §9.

## 2. Objective

After this ships, an admin can `POST /api/admin/templates` to create a recurring template,
`GET /api/admin/templates` to page through every template (active and inactive), `PATCH
/api/admin/templates/:id` to edit one (affecting only its future materializations), and `POST
/api/admin/templates/:id/deactivate` to retire one from future materialization without deleting
its row — with the exact validation rigor `patchSettings`/`routes/quizzes.ts` already apply to
manual quizzes, and with zero change to `getActiveTemplates`, `TemplateRow`, or
`quiz-materializer.ts`'s behavior.

## 3. Assumptions

- `wrangler.toml`/`vitest.config.ts` already wire `cloudflare:test` D1 bindings against
  `migrations/0001_init.sql` as applied by every existing test file in `tests/` (e.g.
  `tests/quiz-materializer.test.ts:1-21`); this packet adds no new migration, since every
  `TemplateSummary` field this packet needs already exists as a `quiz_templates` column
  (`migrations/0001_init.sql:41-56`: `id, name, type, question_count, difficulty_mix,
  timing_policy, slack_sec, join_window_sec, marks_correct, marks_wrong, seat_cap, rrule, active,
  created_by`).
- `quiz_templates` has no `created_at`/`updated_at` column (confirmed by reading
  `migrations/0001_init.sql:41-56` in full) and this packet does not add one. `GET
  /api/admin/templates` therefore orders by SQLite's implicit `rowid DESC` (insertion order,
  newest first) rather than a timestamp column — this is a presentation default, not a documented
  requirement, and is safe to change later without touching stored data.
- `ListTemplatesRequest` is a bare `PageRequest` (no `status`/`active`/`type` filter) because
  API.md's own text only says it "follow[s] the same `PageRequest`/`PageResponse<T>` convention as
  `GET /api/admin/quizzes`" (`API.md:173-174`) without naming a filter field the way it explicitly
  does for `ListQuizzesRequest = PageRequest & { status?: QuizStatus }` (`API.md:138`). The list
  includes both active and inactive templates (each row carries `active: boolean`) so an admin can
  still see a deactivated template without a filter param.
- `requireRole('admin')` is sufficient for every route in this group — API.md's table lists no
  route in this group needing `superadmin`, unlike `POST /api/admin/users/:id/role`
  (`API.md:58`; mirrored in `src/routes/admins.ts:29`).
- The existing `MAX_GRADED_QUESTION_COUNT = 100` and `MAX_SEAT_CAP = 120` constants
  (`src/core/config.ts:80-81`) are the correct bounds for `questionCount`/`seatCap` here too — the
  same product limits QUIZ-1/QUIZ-9 impose on a manual quiz (`PRD.md:107,115`), unchanged for a
  template.

## 4. Out of Scope

- **Draw dry-run validation on create/edit** — explicitly resolved out of scope: "Creating or
  editing a template does not dry-run the draw against current bank counts"
  (`QUIZZING.md:117-119`; `API.md:178-180`). Do not call `BankContract` from any file this packet
  touches.
- **Hard delete** — `quizzes.template_id` references a template row indefinitely
  (`migrations/0001_init.sql:65`); QUIZZING.md §4.4 states there is no hard delete, only
  deactivation (`QUIZZING.md:100-103`).
- **Reactivation** — not in the resolved four-route table (`API.md:166-171`); once `active`
  becomes `0`, only a fresh template row (a new `POST`) restores recurrence. If the project owner
  wants reactivation later, that is a new decision for a future packet, not an oversight to patch
  in here.
- **Versioning/history of template edits** — "no versioning or history table is introduced for
  this" (`QUIZZING.md:112-115`); an edited template's already-materialized quizzes keep their own
  already-persisted units/questions/timing untouched.
- **Changing `quiz-materializer.ts` or `getActiveTemplates`'s query/shape** — both are the frozen
  consumer this packet feeds; see §8a.
- **Frontend admin screens for template management** — this is Phase 3's backend-first delivery
  order (`PLAN.md`/`MODULES.md §7`); no `web/` file is touched by this packet.
- **A `superadmin`-only mutation split** — unlike `POST /api/admin/users/:id/role`, no template
  route is named as superadmin-only anywhere in QUIZZING.md/API.md; all four stay under the
  ordinary `admin` role gate.

## 5. Open Questions / `<INPUT_REQUIRED>`

(none) — every scope question the orchestrator flagged as pre-resolved (CRUD in scope,
future-only edits, no dry-run, deactivate-only lifecycle) is settled in QUIZZING.md §4.4 as of
2026-09-12, and the remaining implementation-level choices in §3 (list ordering key, absence of a
list filter param, role gate) are conservative defaults directly inferable from API.md's own
wording rather than genuine gaps — none of them changes scope, reversibility, data correctness, or
access control in a way that would justify blocking on an answer.

## 6. Pre-flight Checklist

- [ ] Required skill loaded: **`clean-code`** — Always.
- [ ] Required skill loaded: **`test-driven-development`** — four new HTTP routes plus new service
      validation logic are new behavior; write the failing test first for each AC below.
- [ ] Required skill loaded: **`prod-safety-gate`** — this feeds `quiz_templates`, read every hour
      by the unattended `materializeTemplates` cron pass (`SCHEDULER.md §4.2`); a validation bug
      here can silently produce templates that fail every future materialization.
- [ ] Required skill loaded: **`vibesec`** — four new admin-gated HTTP routes accepting untrusted
      JSON bodies from the network.
- [ ] Working tree clean (`git status`).
- [ ] Branch up to date with `master`.
- [ ] Read before editing: `src/db/quizzes.ts:1-97,580-651` (existing `TemplateRow`/
      `getActiveTemplates`, and the row/summary-building helpers to mirror); `src/services/
      quiz-creation.ts:130-222` (`patchSettings`, the validation pattern to mirror);
      `src/routes/quizzes.ts` in full (191 lines — the exact request-parsing/mounting pattern to
      mirror); `src/core/api.ts:60-95` (`QuizAdminSummary`, the admin-facing-type style to match
      for `TemplateSummary`); `src/core/schedule.ts:49-98` (`expandRrule`, reused not re-parsed);
      `src/index.ts:62-96` (route mounting order and per-group middleware); `src/middleware/
      auth.ts` (confirm `requireRole` signature before wiring it); `tests/quiz-materializer.
      test.ts:92-123` (`insertTemplate` test helper — the exact column set this packet's writers
      must stay consistent with).
- [ ] Re-read AC-1 through AC-15 below; every one is implementer-executed (BE + automated tests)
      except the manual-QA table entries explicitly marked operator-executed in §12b.

## 7. Acceptance Criteria

**Wire types (`src/core/api.ts`)**

- **AC-1.** `TemplateSummary`, `CreateTemplateRequest`, `CreateTemplateResponse`,
  `ListTemplatesRequest`, `ListTemplatesResponse`, `UpdateTemplateRequest`,
  `UpdateTemplateResponse`, `DeactivateTemplateResponse` exist in `src/core/api.ts`, built only from
  columns already in `quiz_templates` (`migrations/0001_init.sql:41-56`) plus the shared
  `PageRequest`/`PageResponse<T>` types already defined there (`src/core/api.ts:44-54`).
  `TemplateSummary` includes `active: boolean` and excludes `createdBy` (there is no
  `createdAt`/`createdBy`-in-admin-summary parallel needed — `QuizAdminSummary` has no
  `createdBy` field either, `src/core/api.ts:67-93`).
- **AC-2.** `CreateTemplateRequest` requires every field named in QUIZZING.md §4.4 (`name`, `type`,
  `questionCount`, `difficultyMix`, `timingPolicy`, `slackSec`, `joinWindowSec`, `marksCorrect`,
  `marksWrong`, `seatCap`, `rrule`) — it is a full record, not a `Partial`, because every one of
  those columns is `NOT NULL` on `quiz_templates` (`migrations/0001_init.sql:41-56`).
  `UpdateTemplateRequest` is `Partial` over the identical field set, mirroring
  `UpdateQuizParamsRequest`'s shape (`src/core/api.ts:258-269`).

**Validation, shared by create and patch (`src/services/templates.ts`, new)**

- **AC-3.** `name` must be a non-empty string after `.trim()`; `type` must be one of `'verbal' |
  'quant' | 'lr'`; `questionCount` must be an integer in `[1, MAX_GRADED_QUESTION_COUNT]`
  (`src/core/config.ts:80`); `difficultyMix` keys must all be valid `Difficulty` values and its
  values non-negative integers summing to exactly `questionCount` — the identical rule
  `src/routes/quizzes.ts:72-82` already enforces for `CreateQuizDraftRequest`.
- **AC-4.** `slackSec` must be a non-negative integer; `joinWindowSec` a positive integer;
  `marksCorrect` a finite number `> 0`; `marksWrong` a finite number `<= 0`; `seatCap` an integer in
  `[1, MAX_SEAT_CAP]` (`src/core/config.ts:81`) — the same field-by-field checks `patchSettings`
  already applies to `joinWindowSec`/`slackSec`/`marksCorrect`/`marksWrong`/`seatCap`
  (`src/services/quiz-creation.ts:145-155`).
- **AC-5.** `timingPolicy` must contain a positive integer number of seconds for **exactly** the
  two unit kinds implied by the *effective* `type` — `standalone`, and `rc` if `type === 'verbal'`
  else `lrdi` (per `QUIZZING.md:54`'s section→group-kind mapping) — and no other kind key. This is
  the template-shaped analogue of `patchSettings`'s per-used-kind check
  (`src/services/quiz-creation.ts:157-163`): a quiz reads `usedKinds` off its actual drawn units,
  but a template has no drawn units yet, and every future draw for that `type` can produce either a
  standalone unit or a group unit of that type's implied kind, so both must always carry a policy
  value or `materializeTemplates`'s `computeUnitTimeLimits`
  (`src/services/quiz-materializer.ts:13-20`) will reject that occurrence with
  `missing_timing_configuration` the moment a draw happens to need the missing kind.
- **AC-6.** `rrule` is validated by calling the existing parser, not a new one:
  `expandRrule(rrule, now, now).ok === true` (`src/core/schedule.ts:58`) — the grammar check inside
  `expandRrule` runs before any window-expansion loop, so a degenerate zero-width `[now, now)`
  window is sufficient to validate structure alone; discard the returned (empty) `timestampsMs`.
  An invalid `FREQ`, a missing `BYDAY`/`BYHOUR`/`BYMINUTE`, an unrecognized weekday code, or an
  out-of-range hour/minute all surface as `expandRrule`'s existing `{ ok: false }`.
- **AC-7.** On `PATCH`, when either `type` or `timingPolicy` appears in the request body, validate
  AC-5's rule against the **effective** pair: the patched value if present, else the value already
  stored on the row. A patch that changes only `type` (leaving `timingPolicy` untouched) must still
  be rejected with 400 if the *stored* `timingPolicy` lacks a positive integer value for the new
  type's implied group kind — otherwise a `type` edit alone could silently create a template that
  is guaranteed to fail every future materialization for its new type. A patch touching neither
  field never re-validates the already-stored (already-validated-at-write-time) combination.

**Routes (`src/routes/templates.ts`, new; mounted in `src/index.ts`)**

- **AC-8.** All four routes (`GET /`, `POST /`, `PATCH /:id`, `POST /:id/deactivate`) are mounted
  under `/api/admin/templates` and gated by `requireRole('admin')` on the whole group, mirroring
  `src/routes/quizzes.ts:15-16`'s `quizzes.use("*", requireRole("admin"))`. A signed-out request
  gets 401; a `student`-role request gets 403 — verified against the existing `requireRole`
  middleware, not reimplemented.
- **AC-9.** `POST /` rejects any body key outside `CreateTemplateRequest`'s field set with `400
  {message: "Unknown field"}`, mirroring `src/routes/quizzes.ts:58-59`. On success it inserts one
  `quiz_templates` row with `active = 1` and returns `201`-or-`200` (match the existing convention:
  every other creating/mutating route in this codebase returns `200`, e.g. `CreateQuizDraftResponse`
  at `src/routes/quizzes.ts:94` — use `200`, not `201`, for consistency) with the new
  `TemplateSummary`.
- **AC-10.** `GET /` validates `limit`/`offset` exactly like `src/routes/quizzes.ts:22-47` (integer
  `limit` in `[1, MAX_PAGE_LIMIT]`, non-negative integer `offset`, 400 on anything else) and
  returns `PageResponse<TemplateSummary>` ordered per §3's `rowid DESC` default, including both
  active and inactive rows.
- **AC-11.** `PATCH /:id` rejects unknown fields and `null` values exactly like
  `src/routes/quizzes.ts:123-156`'s `validatePatchBody`, applies AC-3/AC-4/AC-5/AC-7 only to the keys
  present in the body (partial semantics — a field omitted from the request is left unchanged on
  the row), returns `404` if no template with that id exists, and returns the updated
  `TemplateSummary` on success.
- **AC-12.** `POST /:id/deactivate` conditionally updates `active = 0` only `WHERE id = ? AND
  active = 1` (mirroring the conditional-update-then-recheck pattern in `cancelQuiz`,
  `src/db/quizzes.ts:453-461`), returning `200` with the updated `TemplateSummary` on success,
  `404` if the id does not exist, and `409` if it is already inactive.

**Cross-cutting**

- **AC-13.** Deactivating a template never touches any row in `quizzes`, `quiz_units`, or
  `quiz_questions` — verified by a test that materializes an occurrence from a template, then
  deactivates the template, then asserts the previously-materialized `quizzes` row is unchanged and
  a subsequent `materializeTemplates` call produces no *new* occurrence for that (now inactive)
  template, because `getActiveTemplates`'s `WHERE active = 1` filter
  (`src/db/quizzes.ts:596-601`) already excludes it.
- **AC-14.** No file this packet adds or edits imports `BankContract` or calls any of
  `listUnused`/`claimUnused`/`getByIds` — grep-verifiable: `git diff --name-only` intersected with
  `grep -l BankContract` on the touched files must be empty.
- **AC-15.** `npx tsc --noEmit` (via `npm run typecheck`) passes with the new types wired through
  `src/routes/templates.ts` — no `any`/type-assertion escape hatches introduced to paper over a
  request/response shape mismatch.

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not edit `migrations/0001_init.sql` — every field this packet needs already exists as a
  column; no migration is required or permitted by this packet's scope.
- Do not edit `src/services/quiz-materializer.ts` — `git diff -- src/services/quiz-materializer.ts`
  must be empty. This is the frozen consumer AC-13 protects.
- Do not edit `getActiveTemplates` or `TemplateRow`'s field set in `src/db/quizzes.ts:580-632` —
  add new, separate functions/types for the CRUD reads and writes this packet needs (e.g. a
  distinct row/summary type for the admin view that includes `active`) rather than widening the
  materializer's existing read type.
- Do not add a reactivate route, a hard-delete route, or a template-edit history/versioning table —
  all three are explicitly out of scope (§4).
- Do not call `BankContract` anywhere in this packet's new/edited files (AC-14) — no draw dry-run.
- Do not edit `PRD.md`, `PLAN.md`, `MODULES.md`, `DATA_MODEL.md`, `CONTRACTS.md`, `API.md`,
  `QUIZZING.md`, `SCHEDULER.md`, or `todos/PROGRESS.md` — all are authoritative inputs to this
  packet, not outputs of it.
- Do not edit `src/routes/quizzes.ts`, `src/services/quiz-creation.ts`'s existing exported
  functions, or any other sprint's route/service file beyond reading them for pattern-mirroring —
  `git diff -- src/routes/quizzes.ts src/services/quiz-creation.ts` must be empty.
- Do not re-implement RRULE grammar parsing anywhere in this packet's new code — call
  `expandRrule` (`src/core/schedule.ts:58`); do not hand-roll a second `FREQ`/`BYDAY` parser.
- Do not add a `status`/`active`/`type` query filter to `ListTemplatesRequest` beyond
  `PageRequest`'s `limit`/`offset` — §3 records this as a deliberate, literal reading of API.md's
  text, not an oversight to "helpfully" extend.

### 8b. Coding / quality principles

- **`clean-code`**: keep `src/services/templates.ts`'s validators as small named functions (one
  per field group, mirroring `patchSettings`'s per-field `if` blocks rather than one large
  branching function) with early returns on the first invalid field; no magic numbers — reuse
  `MAX_GRADED_QUESTION_COUNT`/`MAX_SEAT_CAP` from `src/core/config.ts:80-81`, never re-literal
  `100`/`120`.
- **`prod-safety-gate`**: `quiz_templates` is read every hour by the unattended
  `materializeTemplates` cron pass (`SCHEDULER.md §4.2`) with no human in the loop and no preview
  step; a validation gap here (e.g. accepting a `timingPolicy` missing the implied group kind)
  surfaces only as a silent-until-alerted `missing_timing_configuration` failure hours later, not
  as an immediate 400 to the admin who made the mistake. AC-5/AC-7 exist specifically to catch that
  class of error at write time instead.
- **`vibesec`**: every route in `src/routes/templates.ts` is `requireRole('admin')`-gated
  (AC-8) and every JSON body is fully allowlist-validated before it reaches `src/db/quizzes.ts`
  (AC-9/AC-11) — no field silently passes through un-typed into a SQL statement; all D1 writes use
  bound parameters (`?` placeholders), mirroring every existing writer in `src/db/quizzes.ts`,
  never string-concatenated SQL.
- **`test-driven-development`**: write the failing test for AC-5 (per-used-kind `timingPolicy`
  validation, the packet's trickiest rule) and AC-13 (deactivation leaves `getActiveTemplates`
  correctly excluding the row, verified through a real `materializeTemplates` call) before writing
  their implementations — both are the two places a plausible-looking but wrong implementation
  would still pass a shallow "does it compile and return 200" check.
- Mirror existing patterns exactly: `src/routes/quizzes.ts`'s allowlist-then-validate body parsing
  (`src/routes/quizzes.ts:56-95,107-173`) and `src/services/quiz-creation.ts:138-222`'s
  `patchSettings` partial-update field-by-field validation are the two canonical examples; do not
  invent a third validation style for this packet.

## 9. Behavior Spec (per file)

### `src/core/api.ts`

- **Current state:** 467 lines; no `Template*` type exists anywhere in the file (confirmed via
  grep). The nearest sibling pattern is `QuizAdminSummary` (`src/core/api.ts:67-93`) for the
  admin-facing summary shape and `UpdateQuizParamsRequest`/`UpdateQuizParamsResponse`
  (`src/core/api.ts:258-274`) for the create-vs-patch request-shape split.
- **Required edit:** add, in a new section header comment (`// QUIZZING — templates
  (QUIZZING.md §4.4)`, matching the file's existing per-module section-comment convention), the
  eight types named in AC-1/AC-2. Import `Difficulty`, `QuizType`, `TimingPolicy` from
  `./contracts` (already imported patterns exist at the top of the file, `src/core/api.ts:11-27`);
  add no new import of `BankContract` or anything Telegram-shaped.
- **Estimated diff:** ~55 LOC (eight type declarations plus doc comments matching the file's
  existing density).
- **Subtleties:** `TemplateSummary.difficultyMix`/`timingPolicy` types must match
  `QuizAdminSummary`'s exact same field types (`Partial<Record<Difficulty, number>> | null` vs.
  `TimingPolicy | null` — but note a template's `difficultyMix`/`timingPolicy` are `NOT NULL`
  columns, unlike a draft quiz's nullable ones, so `TemplateSummary` should type them as
  non-nullable `Partial<Record<Difficulty, number>>`/`TimingPolicy`, not reuse `QuizAdminSummary`'s
  nullable variants verbatim).

### `src/db/quizzes.ts`

- **Current state (lines 580-632):** `TemplateRow` (materializer-only fields, no `active`) and
  `getActiveTemplates` (`WHERE active = 1`, no id/pagination parameter) already exist and must not
  change. `parseJsonColumn` (`src/db/quizzes.ts:39-46`) is the existing JSON-column helper to reuse
  for `difficulty_mix`/`timing_policy`, exactly as `getActiveTemplates` already does
  (`src/db/quizzes.ts:622-623`).
- **Required edit:** add sibling functions for the CRUD surface: `insertTemplate` (full-row
  insert, `active` defaulted to `1`), `listTemplatesPage(db, limit, offset)` (→ `{items:
  TemplateSummary[]; total: number}`, ordered `rowid DESC` per §3), `getTemplateById(db, id)` (→ a
  row type including `active`, used by both the PATCH pre-read and the deactivate pre-read),
  `updateTemplate(db, id, fields)` (column-driven `UPDATE ... SET` over only the provided fields,
  mirroring `applySettingsUpdate`'s `SETTINGS_COLUMN_BY_FIELD` map pattern,
  `src/db/quizzes.ts:336-369`), and `deactivateTemplate(db, id)` (conditional `UPDATE ... SET
  active = 0 WHERE id = ? AND active = 1`, mirroring `cancelQuiz`'s conditional-update-then-recheck
  shape, `src/db/quizzes.ts:453-461`).
- **Estimated diff:** ~95 LOC.
- **Subtleties:** do not widen `TemplateRow` itself to add `active` — define a separate row/summary
  type for the admin-facing reads (e.g. reuse the same field list but as a new type, since
  `TemplateRow`'s existing shape is what `materializeTemplates` depends on and must stay
  byte-for-byte the same per AC-13/§8a). All new SQL uses bound `?` parameters, matching every
  existing statement in this file.

### `src/services/templates.ts` (new)

- **Current state:** does not exist. Mirrors `src/services/quiz-creation.ts`'s role for quizzes —
  the validation and orchestration layer between the route file and `src/db/quizzes.ts`.
- **Required edit:** implement `createTemplate`, `listTemplates`, `patchTemplate`,
  `deactivateTemplate` service functions per AC-3 through AC-7 and AC-12, each returning a
  discriminated outcome type (`{kind: "ok"; ...} | {kind: "invalid"} | {kind: "not_found"} |
  {kind: "conflict"}`, mirroring `PatchOutcome`/`CancelOutcome` in
  `src/services/quiz-creation.ts:132-136,341`) rather than throwing on a validation failure — the
  route layer maps outcome kinds to HTTP status codes, exactly as `routes/quizzes.ts` already does
  for the quiz equivalents.
- **Estimated diff:** ~130 LOC. This is larger than the packet's usual single-file guidance because
  it is a genuinely new four-operation CRUD service, comparable in scope to
  `quiz-creation.ts`'s existing `patchSettings`+`lockQuiz` pair; if it grows meaningfully past this
  estimate, extract the AC-5/AC-7 `timingPolicy`-per-type validator into its own small named
  function within the same file rather than splitting into a second file — the four operations
  share one cohesive validation vocabulary and should not be scattered.
- **Subtleties:** never import `BankContract` (AC-14). The AC-7 "effective type/timingPolicy" check
  needs the template's *current* stored `type`/`timingPolicy` when only one of the two is in the
  patch body — read it via `getTemplateById` before validating, the same "read current state, then
  validate against the patched-in-context values" shape `patchSettings` already uses
  (`src/services/quiz-creation.ts:139-141` reads `current` before any field check runs).

### `src/routes/templates.ts` (new)

- **Current state:** does not exist.
- **Required edit:** a `Hono<Env>` sub-app named `templates`, `templates.use("*",
  requireRole("admin"))` (mirroring `src/routes/quizzes.ts:15-16`), with `GET /`, `POST /`, `PATCH
  /:id`, `POST /:id/deactivate` handlers per AC-8 through AC-12. Body parsing/validation at the
  edge follows `src/routes/quizzes.ts:49-95`'s full-create pattern for `POST /` and
  `src/routes/quizzes.ts:107-173`'s partial-patch pattern for `PATCH /:id`; call into
  `src/services/templates.ts` for all business validation (AC-3 through AC-7) — the route file only
  does structural/type checks (is this a string, is this an object, are the keys allowlisted), not
  the numeric-range/cross-field checks the service layer owns.
- **Estimated diff:** ~150 LOC (comparable to `src/routes/quizzes.ts`'s own 191 lines, since this
  file covers an equivalent four-route CRUD surface).
- **Subtleties:** export the sub-app as default, matching `src/routes/quizzes.ts:190`'s `export
  default quizzes`, so `src/index.ts`'s mount line matches the existing `app.route("/api/admin/
  quizzes", quizzes)` (`src/index.ts:90`) shape exactly.

### `src/index.ts`

- **Current state (lines 13,90):** imports `quizzes from "./routes/quizzes"` and mounts it via
  `app.route("/api/admin/quizzes", quizzes)`.
- **Required edit:** import the new `templates` default export and add
  `app.route("/api/admin/templates", templates)` alongside the existing admin-quiz mount — no
  `withBankContract` middleware needed for this route group (AC-14: this route group never touches
  `BankContract`), unlike `/api/admin/quizzes/*` (`src/index.ts:72`).
- **Estimated diff:** ~3 LOC.
- **Subtleties:** do not add this route group to `app.use("/api/admin/quizzes/*",
  withBankContract)`'s path pattern or any other existing middleware `.use()` call — it is its own
  mount, gated only by `requireRole('admin')` inside the sub-app itself, exactly like
  `src/routes/quizzes.ts`'s own self-contained gate.

### `tests/templates.test.ts` (new)

- **Current state:** does not exist.
- **Required edit:** unit-level tests for `src/services/templates.ts`'s four operations and every
  validation branch in AC-3 through AC-7, following `tests/quiz-creation.test.ts`'s fixture style
  (`insertAdmin`, D1 `beforeEach` cleanup including `DELETE FROM quiz_templates`).
- **Estimated diff:** ~180 LOC.
- **Subtleties:** must include a case proving AC-7's cross-field re-validation (patch `type` alone
  against a stored `timingPolicy` that lacks the new type's implied kind → `invalid`), and a case
  proving AC-13 end-to-end using the real `materializeTemplates` (not a mock), per `tests/
  quiz-materializer.test.ts`'s existing `insertTemplate` shape (`tests/quiz-materializer.
  test.ts:92-123`) as the fixture to compare against, not duplicate.

### `tests/templates.routes.test.ts` (new)

- **Current state:** does not exist.
- **Required edit:** HTTP-level tests for all four routes through `app.request(...)` against the
  full `src/index.ts` app, following `tests/quizzes.routes.test.ts`'s sign-in-as-role fixture
  pattern (`extractCookie`/`signInAs`, `tests/quizzes.routes.test.ts:14-30`) for AC-8's role gate
  and AC-9 through AC-12's status-code contracts.
- **Estimated diff:** ~160 LOC.
- **Subtleties:** cover the 401 (no session), 403 (`student` role), 404 (`PATCH`/`deactivate` on an
  unknown id), and 409 (`deactivate` twice) cases explicitly — each is its own test, not folded into
  a single "happy path" test.

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A template saved with an incomplete `timingPolicy` for its type silently guarantees future `missing_timing_configuration` materialization failures | Med | Med | AC-5/AC-7 validate the per-type-implied-kind rule at write time, both on create and on any patch touching `type`/`timingPolicy`, not just at materialization time. |
| `PATCH` widens `TemplateRow`'s shape or edits `getActiveTemplates`, breaking Sprint 7's materializer silently (compiles fine, wrong behavior at 3am cron) | Low | High | AC-14/§8a Hard NO plus a `git diff -- src/services/quiz-materializer.ts` emptiness check in §12a; `tests/quiz-materializer.test.ts`'s existing suite must still pass unmodified. |
| A hand-rolled second RRULE parser in the route/service layer drifts from `expandRrule`'s grammar over time | Low | Med | AC-6 mandates calling `expandRrule` directly for validation; no duplicate parser is written. |
| Deactivating a template is implemented as a full row update (not a conditional `WHERE active=1`), racing a concurrent second deactivate into a false "success" instead of 409 | Low | Low | AC-12 specifies the conditional-update-then-recheck shape mirroring `cancelQuiz`; a test asserts the second deactivate call returns 409. |
| New admin routes miss the `requireRole('admin')` gate on one HTTP verb (e.g. `PATCH` mounted outside the group's `.use("*", ...)`) | Low | High | AC-8's role-gate test suite exercises all four routes, not just `GET`/`POST`, against both an unauthenticated and a `student` session. |
| Test isolation: a leftover `quiz_templates` row from a prior test (e.g. `tests/quiz-materializer.test.ts`) leaks into a later assertion in this packet's new test file | Med | Low | Every new test file's `beforeEach` includes `DELETE FROM quiz_templates` before its own fixtures, matching the existing convention already used in `tests/quiz-materializer.test.ts:9-19` (the only current suite that seeds `quiz_templates` rows). |
| `TemplateSummary`'s field types silently diverge from `QuizAdminSummary`'s nullable conventions, causing a downstream type error only a future template-consuming screen would surface | Low | Low | AC-1/AC-15 require `tsc --noEmit` to pass with no `any`/assertion escape hatches; the Behavior Spec entry for `src/core/api.ts` explicitly calls out the non-nullable vs. nullable field-type distinction to get right the first time. |

## 11. Rollback / Revert Plan

1. `git revert <sha>` of this packet's commit(s) — since no migration was added (§3), this is a
   pure code revert with no `db:migrate` step to undo.
2. Confirm `git diff -- migrations/0001_init.sql src/services/quiz-materializer.ts
   src/db/quizzes.ts` (limited to `getActiveTemplates`/`TemplateRow`) is empty after the revert —
   i.e., the revert fully restores the pre-packet state of the materializer's read path.
3. Redeploy: `npm run deploy` (Cloudflare Worker; no D1 migration to reapply since none was added).
4. Verification: `curl -X POST https://<worker-host>/api/admin/templates` (with a valid admin
   session cookie) returns `404` (route no longer mounted) rather than a stale/partial response;
   `npx vitest run tests/quiz-materializer.test.ts` still passes, confirming the materializer's
   read path is unaffected by either the original change or its rollback.
5. Notification: post in the project's existing operator channel (the same Telegram alert chat
   used for materialization failures, `TELEGRAM_ALERT_CHAT_ID` — `src/core/config.ts:19`) that
   template CRUD routes were rolled back and any admin-created templates since the deploy are
   still present in `quiz_templates` (rollback removes the routes, not the data) and will resume
   materializing normally since `getActiveTemplates`/`materializeTemplates` were never touched.

## 12. Verification + Definition of Done

### 12a. Automated verification

```bash
npm run typecheck
npx vitest run tests/templates.test.ts tests/templates.routes.test.ts
npx vitest run tests/quiz-materializer.test.ts tests/quiz-creation.test.ts   # frozen-consumer regression check
npm test                                                                     # full suite
git diff -- migrations/0001_init.sql src/services/quiz-materializer.ts      # must be empty
git diff -- src/routes/quizzes.ts src/services/quiz-creation.ts            # must be empty
```

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
|---|---|---|---|---|
| BE-1 | Create a valid template | `POST /api/admin/templates` as admin with a complete, valid body (`type: 'quant'`, `timingPolicy: {standalone: 60, lrdi: 180}`, valid `rrule`) | `200` with a `TemplateSummary` whose `active` is `true` and every field echoes the request | Pass (`tests/templates.routes.test.ts` "creates a valid template") |
| BE-2 | Reject incomplete `timingPolicy` | `POST` with `type: 'verbal'` and `timingPolicy: {standalone: 60}` (missing `rc`) | `400` | Pass (`tests/templates.routes.test.ts` "rejects an incomplete timingPolicy for the type") |
| BE-3 | Reject invalid `rrule` | `POST` with `rrule: "FREQ=DAILY"` | `400` | Pass (`tests/templates.routes.test.ts` "rejects an invalid rrule") |
| BE-4 | List includes inactive rows | Create a template, deactivate it, then `GET /api/admin/templates` | Response `items` includes the row with `active: false` | Pass (`tests/templates.routes.test.ts` "lists created templates including inactive ones") |
| BE-5 | Partial patch leaves other fields untouched | `PATCH /:id` with only `{seatCap: 90}` | Response shows `seatCap: 90` and every other field unchanged from before the patch | Pass (`tests/templates.test.ts` "applies a partial patch, leaving other fields untouched") |
| BE-6 | Patch `type` alone against an incompatible stored `timingPolicy` | Create a `quant` template with `timingPolicy: {standalone: 60, lrdi: 180}`, then `PATCH {type: 'verbal'}` | `400` (stored policy lacks `rc`) | Pass (`tests/templates.routes.test.ts` "rejects a type-only patch incompatible with the stored timingPolicy") |
| BE-7 | Deactivate twice | `POST /:id/deactivate` twice in a row | First call `200`; second call `409` | Pass (`tests/templates.routes.test.ts` "deactivates once, then returns 409 on a second call") |
| BE-8 | Deactivate unknown id | `POST /api/admin/templates/does-not-exist/deactivate` | `404` | Pass (`tests/templates.routes.test.ts` "returns 404 for an unknown id") |
| BE-9 | Materializer excludes a deactivated template | Create a template with a pool of matching questions seeded, deactivate it, call `materializeTemplates` directly | No new `quizzes` row is created for that template | Pass (`tests/templates.test.ts` "never touches an already-materialized quiz, and excludes the template from future materialization") |
| BE-10 | Role gate | Call all four routes as a signed-in `student` | Every route returns `403` | Pass (`tests/templates.routes.test.ts` "rejects a student with 403 on every route") |

#### Frontend / UI

N/A — no `web/` file is touched by this packet (§4); admin template-management screens are a
future frontend packet per Phase 3's backend-first delivery order (`MODULES.md §7`). If a future
packet adds a frontend for this surface, add FE cases there.

#### Chrome DevTools / extension verification

N/A — this packet ships no browser-observable behavior; there is no page to load or network tab to
inspect beyond the BE cases already covered via `curl`/`vitest`. If a frontend screen is added
later, add Chrome cases there.

#### Operator-executed (post-cutover, see AC-OPERATOR)

| # | Case | Steps | Expected | Status |
|---|---|---|---|---|
| OP-1 | Confirm production deploy exposes the new routes | After deploy, `curl -i -X GET https://<worker-host>/api/admin/templates` with a real admin session cookie | `200` (not `404`) confirming `src/index.ts`'s new mount line shipped | Not Run |
| OP-2 | Confirm no unintended materializer behavior change post-deploy | Watch the next hourly `materializeTemplates` cron tick's alert channels (Telegram alert chat + email, `MODULES.md §6`) for any new/changed failure pattern versus the pre-deploy baseline | No new failure codes or volume change attributable to this deploy | Not Run |

### 12c. Definition of Done

- [x] AC-1 through AC-15 satisfied.
- [x] §12a passes locally (and in CI, if configured).
- [x] BE-1 through BE-10 in §12b have Status ≠ `Not Run` (target: `Pass`).
- [ ] OP-1/OP-2 completed by the operator after the next deploy (or explicitly waived in §5 — none
      currently waived).
- [x] No `<INPUT_REQUIRED>` remains in §5 (there is none by design — see §5's reasoning).
- [x] §8a Hard NO list respected — `git diff` on each forbidden file/path is empty.
- [x] §11 Rollback plan rehearsed mentally (no migration to undo; pure code revert).

**Implementation note (2026-09-12):** Shipped per this packet exactly. One addition beyond its
original scope was required and applied: `tests/backend-security.test.ts`'s AC-6 route inventory
hard-codes every mounted route and failed once the four template routes were mounted; it now lists
them (guard: `admin`) and the documented count is 33, matching this packet's own API.md citation.
Full suite: 482 passed, 3 pre-existing failures unrelated to this packet (`tests/results.routes
.test.ts`, `tests/scheduler-minute.test.ts`, `tests/scheduler-weekly.test.ts` — reproduced
identically on `master` before this packet's changes were applied, via `git stash`).

---

End of Codex Task Packet — `claude-task--001`
