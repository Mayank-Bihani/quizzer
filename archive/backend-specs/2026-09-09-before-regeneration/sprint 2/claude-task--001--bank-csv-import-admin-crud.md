# claude-task--001: Build the BANK module — CSV import, passages, questions, R2 images, admin CRUD

**Sprint:** 2  **Slug:** `bank-csv-import-admin-crud`  **Status:** Draft

> Phase 2 per `PROGRESS.md`'s packet table (depends on Phase 1 / AUTH). Every module doc this
> packet cites (`BANK.md`, `CONTRACTS.md` §3, `API.md`'s BANK section, `src/core/contracts.ts`,
> `migrations/0001_init.sql`) is marked resolved/final — see `AUDIT.md` §11 and
> `COUNCIL_FINDINGS.md`'s 2026-09-05 resolution log. This packet does not re-open any of those
> decisions; it only turns them into code.

---

## 1. Context

The bank is "the permanent store of questions, and the only way questions get into the system"
(`BANK.md:12`). Nothing in `src/` implements it yet — every file this packet touches is currently a
single-line ownership comment, not code:

- `src/core/csv.ts:1` — "CSV parse + validate, pure ... BANK.md §3"
- `src/db/bank.ts:1` — "passages, questions tables; BankContract ... BANK.md §3-5; CONTRACTS.md §3"
- `src/routes/bank.ts:1` — the six admin routes, with the PATCH freeze rule already named in the
  comment
- `src/routes/images.ts:1` / `src/services/images.ts:1` — the image-serving route and the R2
  wrapper

The schema these files must target is **already final** — `migrations/0001_init.sql:136-205`
(`passages`, `questions`) already has `title` nullable (`:140-141`), `import_id` on both tables
(`:146`, `:181`), the no-repeat `used_in_quiz_id` machinery, and the freeze comment on
`correct_option`/`option_a..d` (`:193-198`). **No new migration is needed for this packet** —
confirmed by reading the full file; every column BANK.md's design calls for already exists.

The module boundary this packet must respect: `passages`/`questions` have exactly one writer
(BANK — `migrations/0001_init.sql:9`), and BANK's own `getByIds` replacement for the old
`getForQuiz` exists specifically so BANK never reads QUIZZING's `quiz_questions` table
(`BANK.md:133-136`, `CONTRACTS.md:88-93`, `COUNCIL_FINDINGS.md` #9). Keep that arrow one-directional
in every function this packet adds.

**Sequencing assumption:** `PROGRESS.md`'s dependency column lists this phase as depending on
Phase 1 (AUTH). This packet is written against `AuthContract` (`src/core/contracts.ts:30-40`) as a
**contract**, not against implemented code — `src/routes/auth.ts`, `src/db/users.ts`, and
`src/services/jwt.ts` are equally single-line stubs today. See §3.

**Reusable pattern to mirror:** none yet exists in this repo (Phase 2 is the first module with real
logic). Where this packet must invent a convention (Hono `Bindings` type, chunk size, ZIP library),
it says so explicitly rather than pretending a precedent exists.

## 2. Objective

After this ships: an admin can upload a CSV (plus an optional companion ZIP of images) to
`POST /api/bank/import/preview`, see exactly what would be created and every validation error by
line number, change nothing on disk; then `POST /api/bank/import/commit` the same file pair and
have every question/passage/image land atomically — a mid-import failure leaves the bank
byte-identical to before, with no partial rows and no orphaned-but-referenced images. Admins can
then browse, filter, edit (within the freeze rules), and delete questions and browse passages
through `/api/bank/*`. `BankContract` (`listUnused`/`claimUnused`/`getByIds`) is implemented and
callable in-process by a future QUIZZING module, with no HTTP route of its own. `GET
/api/images/:key` serves a stored image to any signed-in user, per BANK.md's stated (not
admin-gated) exception.

## 3. Assumptions

- **AUTH's Phase-1 packet lands first** (or its interfaces are stubbed compatibly). This packet
  imports `requireAuth()`/`requireRole('admin')`/`currentUser(ctx)` from wherever Phase 1 places
  them (`src/db/users.ts` per that file's own ownership comment) and does not reimplement them.
  If Phase 1 hasn't landed when this is implemented, stub `AuthContract` locally behind the same
  import path so this packet's own tests aren't blocked — replace the stub, don't fork the
  interface, once Phase 1 lands.
- **No `Bindings`/`Env` type exists yet.** `wrangler.toml:16-29` declares `DB` (D1Database),
  `IMAGES` (R2Bucket), `CACHE` (KVNamespace). This packet adds a minimal `type Bindings` (new file,
  `src/bindings.ts` — deliberately outside `core/`, since `D1Database`/`R2Bucket` are
  `@cloudflare/workers-types`, not portable types, and `core/` is zero-platform-imports by design,
  `PLAN.md:673`).
- **D1 supports `RETURNING`** on `UPDATE`/`INSERT` (SQLite ≥ 3.35; D1 runs on SQLite). Used by
  `claimUnused`'s conditional claim.
- **A ZIP library is needed and none is installed.** `package.json`'s only dependency is `hono`.
  This packet adds exactly one new dependency: **`fflate`** (pure JS, no Node `fs`/`Buffer`
  requirement, small, Workers-safe). Do not add a Node-`fs`-oriented library (e.g. `jszip`'s
  streaming APIs, `adm-zip`) — `nodejs_compat` is on (`wrangler.toml:4`) but heavier polyfill
  surface is an avoidable risk for a one-function need (`unzipSync`).
- **D1 `batch()`'s exact statement/size limits are not pinned in any project doc** — `BANK.md:83-85`
  only asserts "a 500-row CSV will not fit in one batch." This packet picks a conservative,
  tunable default (§9, `db/bank.ts`) rather than blocking on an exact vendor number: **25 question
  rows per chunk** (≈2 statements/row worst case — one `questions` insert, one `passages` insert
  for the rare first-row-of-a-group case — comfortably under any published D1 batch ceiling).
  Implementer should confirm against current Cloudflare docs at build time and adjust the constant
  if needed; this is a tuning knob, not a design gap.
- **`vitest.config.ts` does not exist yet** (confirmed — no file in the repo root or `src/`).
  `package.json:9` already declares `"test": "vitest run"` and depends on
  `@cloudflare/vitest-pool-workers`, so this packet adds the minimal pool-workers config needed to
  run any test at all, since BANK.md §8 requires real unit tests and there is currently no runner
  wired up.
- **No test directory convention exists yet.** This packet establishes one: `*.test.ts` co-located
  next to the source file it tests (`src/core/csv.test.ts`, `src/db/bank.test.ts`), and a new
  `fixtures/bank/` directory at the repo root for the CSV/ZIP fixtures BANK.md §8 requires as
  permanent, committed artifacts.
- **`migrations/seed.sql`** (referenced by `package.json`'s `db:seed:*` scripts) is a different
  concern — a raw-SQL dev-environment seed (almost certainly AUTH's superadmin bootstrap row,
  `PLAN.md:711`). This packet does not touch it; the realistic seed bank fixture BANK.md §8
  requires is a CSV+ZIP pair exercised through the real import routes, not a SQL seed.

## 4. Out of Scope

- **Any schema change to `migrations/0001_init.sql`** — already final for this module (§1); adding
  a second migration file is not needed and not wanted.
- **`core/selection.ts`** (auto-pick / difficulty-mix / whole-passage-group solving) — that's
  QUIZZING's Phase-3 concern (`PLAN.md:715-716`); `listUnused` here returns raw candidates only,
  per-difficulty-bucket, with no composition logic (`CONTRACTS.md:84` explicitly separates
  "composing a draft draw" from `listUnused` itself).
- **The admin console's question-bank UI** (`web/src/admin/...`) — this packet is backend-only;
  `PLAN.md`'s "frontend and backend move together inside a phase" note applies to the mockup
  sprints' own track (`todos/sprint 1..8` under the mockup skill), not this backend-spec track,
  which per `PROGRESS.md`'s own framing produces API packets only.
- **`wrangler.toml`'s `[[migrations]]` tracking block / moving off raw `d1 execute`**
  (`COUNCIL_FINDINGS.md` #22, accepted-as-hygiene) — a cross-cutting infra fix, not BANK-specific;
  whichever packet first runs `db:migrate:local` for real should pick it up.
- **R2 orphan sweeping for a failed import's uploaded images** — BANK.md:100-101 explicitly says
  this is "harmless (10 GB free, zero egress)" and can be "swept later by prefix"; no sweep job is
  built now.
- **Duplicate detection on CSV import** — resolved not-built (`BANK.md:176-177`, `PRD.md:329`).
- **Any `release()` / all-or-nothing claim across a passage group in `claimUnused`** — resolved,
  single-admin bookkeeping only, no concurrency machinery (`BANK.md:124-126`,
  `CONTRACTS.md:102-105`, `COUNCIL_FINDINGS.md` #4).
- **Editing/deleting a used question beyond the stated freeze** — resolved: `option_a..d` and
  `correct_option`/`numeric_answer`/`used_in_quiz_id` freeze on use; deleting a used question is
  forbidden outright, no exceptions (`BANK.md:163-170`, §7).
- **Zip-slip / zip-bomb / stored-XSS hardening against the uploaded CSV/ZIP as an adversarial
  surface** — `COUNCIL_FINDINGS.md` #25 explicitly rejected building this: single trusted admin
  uploading their own content, not a public upload surface. This packet still caps decompressed
  ZIP size as ordinary crash-prevention hygiene (§9, not a security control) because a fat-fingered
  large file should 400 with a clear message rather than OOM the Worker (`BANK.md:158-159`), but no
  path-traversal/entry-name sanitization is added beyond treating the entry name as an opaque R2
  key suffix.

## 5. Open Questions / `<INPUT_REQUIRED>`

`(none)`. This packet originally flagged `GET /api/images/:key`'s per-student "served" scoping as
open (it would have required this module to read QUIZZING-owned tables, `quiz_questions` /
`participants`, violating "BANK never reads QUIZZING's tables" — `COUNCIL_FINDINGS.md` #9). The
project owner resolved it: no per-student scoping at all — `requireAuth()` only, any signed-in
user. These are illustrative images (charts, diagrams), not answer text; guessing another
question's key would require deliberately probing the URL pattern for no payoff worth the effort,
and enforcing scoping would mean violating a clean module boundary to prevent a threat that isn't
one — the same call already made on #25 and #44 (`COUNCIL_FINDINGS.md` #11, reconsidered). §9's
`routes/images.ts` behavior spec reflects this: `requireAuth()`, then stream the R2 object, no
join against QUIZZING's tables.

No other open question survives — every other ambiguity the task brief warned about (passages
title, freeze-on-use, `claimUnused`'s passage stamping, image-URL derivation, the images route's
route-group placement) is resolved fact per BANK.md/COUNCIL_FINDINGS.md and is treated as such
throughout this packet.

## 6. Pre-flight Checklist

- [ ] Required skill loaded: **`clean-code`** — always.
- [ ] Required skill loaded: **`prod-safety-gate`** — every file here is a production D1/R2 write
  path (import commit, question edit/delete) with no undo beyond "redo the import" (§4).
- [ ] Required skill loaded: **`test-driven-development`** — BANK-7's atomicity and every §3.1
  validation rule are behavior specified by acceptance criteria before code; write the failing
  test first for each AC below.
- [ ] Required skill loaded: **`vibesec`** — this module parses admin-supplied file uploads
  (CSV+ZIP), derives R2 keys from user-controlled filenames, and hosts the one route in the system
  that isn't admin-gated (`GET /api/images/:key`). Treat the ZIP entry-name → R2-key mapping as the
  security-relevant surface even though adversarial-upload hardening itself is out of scope (§4);
  the images route itself is `requireAuth()` with no further scoping (§5), so there's no access
  logic left there to get wrong.
- [ ] Working tree clean; branch up to date with `main`.
- [ ] Read before editing: `BANK.md` (whole doc), `CONTRACTS.md:72-105`, `API.md:60-101`,
  `src/core/contracts.ts:47-87`, `src/core/api.ts:97-201`, `migrations/0001_init.sql:136-205`,
  `wrangler.toml` (bindings block), `PLAN.md:665-702` (repo structure / zero-platform-imports
  rule), `PLAN.md:730-751` (verification conventions).
- [ ] Confirm whether Phase 1 (AUTH) has landed; if not, apply the stub-behind-the-same-import
  approach from §3 rather than blocking.
- [ ] Re-read every AC in §7 before starting; note that none are `AC-OPERATOR` except the
  Excel-fixture item in §12b — every other AC is implementer-executed and automatable.

## 7. Acceptance Criteria

**CSV parsing / validation (`core/csv.ts`) — pure, no D1/R2/network import**

- **AC-1.** `core/csv.ts` exports a pure function accepting CSV text and a `Set<string>` of
  companion-ZIP entry names, returning parsed rows, `ImportCounts`, `PassageGroupSummary[]`, and
  `ImportRowError[]` — no import of `D1Database`, `R2Bucket`, or `fetch` anywhere in the file
  (grep-verifiable).
- **AC-2 (the PRD acceptance case, verbatim).** A CSV mixing valid rows, a row missing `correct`
  (an `mcq` row with an empty `correct` column), and a question row whose `passage_ref` doesn't
  resolve to any passage row in the same file produces a result with `errors` containing **exactly
  those two** line-numbered errors, and zero DB/R2 writes occur downstream (`PRD.md:102-103`,
  `BANK.md:76-77`).
- **AC-3.** Every rule in `BANK.md`'s §3.1 table has at least one fixture that violates only that
  rule and produces exactly one error citing the violating line number: required-columns-present,
  `type` enum, `difficulty` enum (question rows only — passage rows are exempt,
  `BANK.md:60`/`migrations/0001_init.sql:159-163`), `format` enum, non-empty `body`, non-empty
  `explanation` on question rows, exactly-4-non-empty-options + `correct` ∈ A–D + numeric-blank for
  `mcq`, numeric-parses + `tolerance` ≥ 0 + options-blank for `tita`, `passage_ref` set+unique for
  `passage` rows, same-file `passage_ref` resolution, image name present in the ZIP manifest.
- **AC-4.** A passage group of exactly 3 questions and a group of exactly 6 questions both produce
  a "group size" error (`BANK.md:68`, "4–5"); groups of 4 and 5 produce none.
- **AC-5.** A `body`/`explanation` field containing `$LaTeX$` with embedded commas and double
  quotes round-trips through CSV parsing unchanged (tests the RFC-4180 quoting BANK.md:154 warns
  about, not a rendering test — KaTeX rendering is client-side, out of scope here).
- **AC-6.** A file exported from a real spreadsheet application (not hand-written — BANK.md:156-157)
  parses correctly, including any BOM and CRLF line endings; UTF-8 with a leading BOM is accepted
  and the BOM is stripped before parsing.

**Import commit atomicity (`db/bank.ts`, `routes/bank.ts`) — BANK-7**

- **AC-7.** `POST /api/bank/import/preview` never writes to D1 or R2, for both a fully valid file
  and a file with errors — verified by asserting row counts in both tables are unchanged
  before/after the call.
- **AC-8.** `POST /api/bank/import/commit` on a fully valid file: generates one `import_id`,
  uploads every referenced image to R2 first, then inserts every `passages`/`questions` row
  chunked per §3's chunk-size assumption, every inserted row stamped with that `import_id`
  (`BANK.md:87-97`); response's `importId` is non-null and matches what was stamped.
- **AC-9.** `POST /api/bank/import/commit` on a file with any validation error: writes nothing,
  `importId` is `null` in the response, matching `API.md:83-86`'s modeling of atomicity via
  `importId` rather than a non-200 status.
- **AC-10 (the forced-failure atomicity test, BANK.md §8).** Given a 5-chunk import, force the 3rd
  chunk's `batch()` call to throw; assert (a) every row already inserted by chunks 1–2, stamped
  with that `import_id`, is deleted (`DELETE FROM questions/passages WHERE import_id = ?`), and (b)
  the bank's row count and content are byte-identical to before the import started. Uploaded R2
  images from this failed attempt are allowed to remain (§4) — assert only that they are not
  referenced by any surviving `questions`/`passages` row.
- **AC-11.** A ZIP whose decompressed size exceeds a stated cap (implementer picks a concrete
  number, e.g. 100 MB, comfortably under the 128 MB Worker memory ceiling — `BANK.md:158-159`)
  fails the request with a clear, distinct error message before attempting to unzip in full, not a
  generic crash.

**Admin CRUD + browse (`routes/bank.ts`, `db/bank.ts`) — BANK-8**

- **AC-12.** `GET /api/bank/questions` filters by `type`/`topic`/`difficulty`/`used` (boolean via
  `used_in_quiz_id IS [NOT] NULL`) per `ListQuestionsRequest` (`src/core/api.ts:151-156`), returns
  `PageResponse<QuestionFull>` including `correctOption`/`explanationMd` unredacted (this is the
  one route where that's correct — `API.md:88-91`, `AUDIT.md` §11 decision 17).
- **AC-13.** `GET /api/bank/questions/:id` returns `QuestionFull` including its `passage` field
  (`{title, bodyMd}` or `null`) when `passage_id` is set.
  and 404 when the id doesn't exist.
- **AC-14.** `PATCH /api/bank/questions/:id` accepts only the fields in `UpdateQuestionRequest`
  (`src/core/api.ts:164-178`); a request body containing `correctOption`, `numericAnswer`,
  `imageUrl`, `type`, `format`, `passageId`, or `groupPosition` 400s regardless of the question's
  used state (`API.md:93-96`, `COUNCIL_FINDINGS.md` #27).
- **AC-15.** `PATCH /api/bank/questions/:id` with `optionA`..`optionD` present succeeds when
  `used_in_quiz_id IS NULL`, and 400s when it is not (`BANK.md:167-169`,
  `COUNCIL_FINDINGS.md` #20) — checked in the handler against the DB row, not the database schema
  (no DB-level enforcement exists or is added — `migrations/0001_init.sql:196-198`).
- **AC-16.** `DELETE /api/bank/questions/:id` succeeds when unused, and returns 409 ("already used
  — forbidden outright, no exceptions") when `used_in_quiz_id IS NOT NULL`
  (`API.md:69`, `BANK.md:170`, PRD.md:337-338).
- **AC-17.** `GET /api/bank/passages` returns every passage as `PassageSummary`
  (`src/core/api.ts:86-95`), with `imageUrl` derived server-side from `image_key` — never a raw
  stored URL (same derivation rule as `QuestionFull.imageUrl`, `COUNCIL_FINDINGS.md` #27).
- **AC-18.** Every route in `routes/bank.ts` is mounted behind `requireRole('admin')` — a request
  with no session, or a session with `role='student'`, gets 401/403 respectively, on all seven
  routes.

**`BankContract` (`db/bank.ts`) — CONTRACTS.md §3**

- **AC-19.** `claimUnused(questionIds, quizId, quizNumber)` performs a conditional
  `UPDATE ... WHERE id IN (?) AND used_in_quiz_id IS NULL RETURNING id`; given a mixed set of ids
  where some are already used, returns only the ids it actually won (a "short return"), and does
  not error.
- **AC-20.** After a `claimUnused` call, for every `passage_id` touched by a just-claimed question:
  if every question with that `passage_id` now has `used_in_quiz_id IS NOT NULL` (this claim or an
  earlier one), `passages.used_in_quiz_id` is stamped with this call's `quizId`; a passage with
  even one still-unclaimed question in its group is left untouched (`BANK.md:120-126`,
  `migrations/0001_init.sql:145`, `COUNCIL_FINDINGS.md` #4).
- **AC-21.** `listUnused(filters)` returns only rows with `used_in_quiz_id IS NULL`, matching
  `filters.type` and, per key of `filters.difficultyMix`, up to that many rows of that difficulty
  (uses `idx_questions_unused`, `migrations/0001_init.sql:188-190`); never mutates any row.
- **AC-22.** `getByIds(questionIds)` returns full `QuestionFull` rows (including `correctOption`,
  `explanationMd`) for exactly the given ids, each with its `passage` field populated when
  applicable; called with an id the bank doesn't have simply omits it (no throw) — the caller
  (future QUIZZING) is responsible for reconciling counts.

**Images (`routes/images.ts`, `services/images.ts`)**

- **AC-23.** `GET /api/images/:key` is mounted with `requireAuth()` only (not `requireRole`) — a
  request with a valid session and `role='student'` reaches the handler and gets the object; an
  unauthenticated request gets 401.
- **AC-24.** No per-question scoping: any signed-in session (student or admin) fetching any
  stored key succeeds, regardless of whether that student's own quiz has reached that question
  (COUNCIL_FINDINGS.md #11, reconsidered — §5).
- **AC-25.** A `:key` with no matching R2 object 404s with the standard error shape.

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not modify `migrations/0001_init.sql` — the schema for this module is already final (§1).
  `git diff -- migrations/0001_init.sql` must be empty.
- Do not add `correctOption`, `numericAnswer`, `usedInQuizId`, `usedInQuizNumber`, `type`,
  `format`, `passageId`, `groupPosition`, or `imageUrl` to `UpdateQuestionRequest` in
  `src/core/api.ts` — that type is already correct; this packet consumes it, it does not change it.
- Do not import `D1Database`, `R2Bucket`, or `KVNamespace` (or any `@cloudflare/workers-types`
  symbol) into `src/core/csv.ts` — it must stay platform-import-free (`PLAN.md:673`).
- Do not build a `release()` call, an all-or-nothing passage claim, or any cross-request lock for
  `claimUnused` — explicitly rejected (`COUNCIL_FINDINGS.md` #4, §4 above).
- Do not add `updated_at`/`updated_by` audit columns or an `admin_events` table — explicitly
  rejected at this scale (`COUNCIL_FINDINGS.md` #20, #23).
- Do not add a second npm dependency beyond `fflate` without flagging it back to the spec — the
  Worker's `nodejs_compat` flag and 128 MB memory ceiling (`AUDIT.md` #21/#22, `BANK.md:158`) make
  dependency weight a real cost here, not a style preference.
- Do not build duplicate-detection on import, an `imports` provenance table, or a
  `DELETE /api/bank/imports/:importId` undo route — all explicitly rejected
  (`COUNCIL_FINDINGS.md` #19, `BANK.md:176-177`).

### 8b. Coding / quality principles

- `clean-code`: `core/csv.ts`'s validator should read as one rule per function
  (`validateType(row)`, `validateFormat(row)`, ...), composed, not one 200-line function with
  nested `if`s — this file has the highest rule-density in the module and will be the hardest to
  review if it isn't broken up this way.
- `prod-safety-gate`: the production surface here is a **destructive, hard-to-reverse write path**
  — a bad `commitImport` either silently corrupts the bank (wrong rows written) or, worse, silently
  half-writes it if the chunk-then-rollback logic (AC-10) has a bug. Get the rollback path under
  test *before* the happy path, per `test-driven-development` below.
- `test-driven-development`: write AC-10 (forced mid-import failure) as a failing test before
  writing `commitImport`'s chunking loop — this is the one AC where "the code looks right" and
  "the code is right" diverge most, and it's cheap to get backwards (e.g. deleting by `import_id`
  *before* confirming which chunk actually failed).
- `vibesec`: the ZIP entry name → R2 key mapping (`services/images.ts`) must not pass a
  user-controlled string straight into an R2 `put()` key without at minimum stripping directory
  components (`../`, absolute paths) — not because this project defends against adversarial
  uploads (§4 explicitly declines that), but because a key like `../../other-question/img.png`
  colliding with an unrelated stored key is a correctness bug regardless of trust model, not just a
  security one. The images route itself has no scoping logic to get wrong (§5) — `requireAuth()`
  and stream the object, nothing more.
- Mirror nothing — this is the first module with real logic in this repo (§1). Where this packet
  establishes a convention (chunking, fixture layout, `Bindings` type), later phases should mirror
  *this* packet, not the other way around.

## 9. Behavior Spec (per file)

### `src/bindings.ts` (new)

- **Current state:** does not exist.
- **Required edit:** export `type Bindings = { DB: D1Database; IMAGES: R2Bucket; CACHE:
  KVNamespace; TELEGRAM_BOT_TOKEN?: string; SUPERADMIN_EMAIL?: string; SESSION_SECRET?: string }`
  matching `wrangler.toml`'s declared bindings (`:16-29`) plus the secrets referenced in its
  comments (`:43-44`). Deliberately outside `core/` (see §3).
- **Estimated diff:** ~15 LOC.
- **Subtleties:** every route/db/service file this packet touches needs `Bindings` for its Hono
  generic (`Hono<{ Bindings: Bindings }>`) or its D1/R2 parameter types — get this file right first,
  everything else imports it.

### `src/core/csv.ts`

- **Current state (line 1):** a single ownership comment, no code.
- **Required edit:** implement the pure parser + validator described in BANK.md §3/§3.1
  (`BANK.md:36-70`). Suggested shape:
  ```ts
  export type ParsedRow = { line: number; /* raw + typed fields per BANK.md's column list */ }
  export function parseAndValidate(
    csvText: string,
    imageFileNames: Set<string>
  ): { rows: ParsedRow[]; counts: ImportCounts; passageGroups: PassageGroupSummary[]; errors: ImportRowError[] }
  ```
  Strip a UTF-8 BOM if present before parsing (`BANK.md:155-156`). Each rule in §3.1's table
  becomes one small validator function; a row can accumulate more than one error
  (`BANK.md:54`). Passage rows and question rows are validated against disjoint rule sets
  (`difficulty` only on question rows, `BANK.md:60`).
- **Estimated diff:** ~180 LOC (parser + one function per §3.1 rule + row/counts assembly).
- **Subtleties:** this file receives `imageFileNames: Set<string>`, not ZIP bytes — the impure ZIP
  decompression happens in `routes/bank.ts` (below), keeping this file free of any platform import
  per the Hard NO list. Do not let "convenient" shortcuts (e.g. importing `fflate` here to also
  extract names) leak a dependency into `core/` that PLAN.md's repo-structure diagram promises
  isn't there.

### `src/services/images.ts`

- **Current state (line 1):** ownership comment only.
- **Required edit:** `uploadImage(env: Pick<Bindings,'IMAGES'>, key: string, bytes: Uint8Array,
  contentType: string): Promise<void>` (R2 `put`), `getImage(env, key): Promise<R2ObjectBody |
  null>` (R2 `get`), and a pure-ish `toSafeR2Key(entryName: string, importId: string): string`
  helper that strips path traversal segments before building the stored key (§8b's vibesec note).
- **Estimated diff:** ~40 LOC.
- **Subtleties:** key scheme should be derivable back to the `import_id` prefix BANK.md:96 assumes
  ("Orphaned R2 objects from a failed import ... swept later by prefix") — e.g.
  `bank/${importId}/${safeEntryName}` — even though the sweep itself is out of scope (§4), the key
  shape is load-bearing for that future feature.

### `src/db/bank.ts`

- **Current state (line 1):** ownership comment listing exactly the four contract functions plus
  admin CRUD — already an accurate table of contents for this file.
- **Required edit:**
  - `BankContract` implementation: `listUnused`, `claimUnused`, `getByIds` per
    `src/core/contracts.ts:77-87` and AC-19–22 above. `listUnused` issues one query per
    `difficultyMix` key against `idx_questions_unused` (`migrations/0001_init.sql:188-190`);
    `claimUnused` does the `UPDATE ... RETURNING` claim, then a follow-up per-passage completion
    check + stamp (AC-20); `getByIds` is a single `SELECT ... WHERE id IN (?)` joined to `passages`.
  - Admin CRUD helpers backing `routes/bank.ts`: `listQuestions(filters, page)`, `getQuestion(id)`,
    `updateQuestion(id, patch, currentRow)` (freeze-rule enforcement — AC-14/15), `deleteQuestion(id)`
    (409 guard — AC-16), `listPassages()`.
  - `commitImport(parsed, imageBytesByName, createdBy)`: generate `import_id`
    (`crypto.randomUUID()`), upload every referenced image via `services/images.ts` first, then
    insert `passages` then `questions` in chunks of 25 rows (§3's assumption) via `DB.batch(...)`,
    every row stamped `import_id`; on any chunk throwing, run
    `DELETE FROM questions WHERE import_id = ?` and the same for `passages`, then rethrow/return
    the failure shape (`importId: null`).
- **Estimated diff:** ~260 LOC. This is the largest single file in the packet — if it grows past
  ~300 LOC in practice, split `commitImport` and its rollback into a sibling file
  (`db/bank-import.ts`) rather than letting one file absorb both the contract and the import
  pipeline; note this as a judgment call for the implementer, not a hard requirement, since
  `PROGRESS.md`'s own design already fixes "one packet per phase" (§1) and re-splitting mid-phase
  has its own cost.
- **Subtleties:** the per-passage completion check in `claimUnused` (AC-20) must query *all*
  questions for a touched `passage_id`, not just the ones in this call's `questionIds` — a passage
  group claimed across two separate `claimUnused` calls (unlikely given single-admin usage, but not
  forbidden by the contract) must still get stamped correctly on whichever call completes it.

### `src/routes/bank.ts`

- **Current state (line 1):** ownership comment already naming the PATCH freeze behavior
  precisely — treat that comment as a correct one-line spec, not just a placeholder.
- **Required edit:** a Hono sub-app, every route behind `requireRole('admin')`
  (`.use('*', requireRole('admin'))` at the sub-app's mount point). `import/preview` and
  `import/commit` read `c.req.formData()`, pull the CSV `File` and optional ZIP `File`, unzip the
  ZIP with `fflate.unzipSync` into a `Record<string, Uint8Array>`, pass `new
  Set(Object.keys(...))` to `core/csv.ts`'s `parseAndValidate`, and — for `commit` only, and only
  when `errors.length === 0` — call `db/bank.ts`'s `commitImport` with the unzipped bytes map.
  `GET /questions`, `GET /questions/:id`, `PATCH /questions/:id`, `DELETE /questions/:id`,
  `GET /passages` each thinly delegate to the corresponding `db/bank.ts` function and map its
  result/errors to the response/status codes in `API.md:62-71`.
- **Estimated diff:** ~150 LOC.
- **Subtleties:** the `PATCH` handler must reject on **any** forbidden key present in the raw
  parsed JSON body, not just silently ignore unknown fields — TypeScript's structural typing
  won't catch a raw HTTP client sending `{ "correctOption": "B" }` at runtime (AC-14).

### `src/routes/images.ts`

- **Current state (line 1):** ownership comment already stating the `requireAuth()`-only rule,
  no per-question scoping.
- **Required edit:** mount `GET /:key` behind `requireAuth()` only — no role check, no scoping
  query. `getImage` from `services/images.ts` streams the R2 body with its stored content type;
  404 if the R2 object doesn't exist.
- **Estimated diff:** ~15 LOC.
- **Subtleties:** none — this is the simplest route in the module precisely because the scoping
  question (§5) was resolved as "don't," not "resolve it cleverly." Do not add a `quiz_questions`/
  `participants` join here; that was considered and explicitly rejected (§5, `COUNCIL_FINDINGS.md`
  #11 reconsidered) as a real violation of "BANK never reads QUIZZING's tables" for no real benefit.

### `src/index.ts`

- **Current state (line 1):** ownership comment describing the eventual full app (cron handler,
  every route group) — none of it built.
- **Required edit:** scope this packet's edit to exactly what BANK needs: construct the Hono app
  typed with `Bindings`, mount `routes/bank.ts` at `/api/bank`, mount `routes/images.ts` at
  `/api/images`. Do not attempt to wire AUTH's own routes, QUIZZING's routes, or the cron
  `scheduled()` handler here — those belong to their own phases and this file's stub comment
  already reserves room for them.
- **Estimated diff:** ~20 LOC (additive only — do not delete the ownership comment describing
  future scope; keep it above the code as a header).
- **Subtleties:** if Phase 1 has already landed by the time this is implemented, this file may
  already have AUTH's mounts in it — merge additively, don't overwrite.

### `vitest.config.ts` (new, repo root)

- **Current state:** does not exist.
- **Required edit:** minimal `@cloudflare/vitest-pool-workers` config pointing at
  `wrangler.toml`'s bindings, so `npm test` can exercise `core/csv.ts` and `db/bank.ts` against a
  real (test) D1 instance and R2 bucket.
- **Estimated diff:** ~25 LOC (mostly boilerplate from `@cloudflare/vitest-pool-workers`'s own
  documented setup).
- **Subtleties:** if AUTH's Phase 1 already added this file, do not duplicate it — extend it if
  BANK's tests need anything AUTH's didn't already configure.

### `package.json`

- **Current state:** `dependencies: { hono }` only (`:12-14`).
- **Required edit:** add `"fflate": "^0.8.0"` (or current stable) to `dependencies`.
- **Estimated diff:** 1 LOC.
- **Subtleties:** do not add it to `devDependencies` — it's used at request-time in
  `routes/bank.ts`, not just in tests.

### `fixtures/bank/` (new directory)

- **Current state:** does not exist.
- **Required edit:** commit the fixtures BANK.md §8 requires: `valid-mixed.csv` (the AC-2
  acceptance case), one small CSV per §3.1 rule violation (AC-3), `passage-group-3.csv` /
  `passage-group-6.csv` (AC-4), `latex-quoting.csv` (AC-5), `excel-export.csv` +
  `excel-export-images.zip` (AC-6 — produced by actually exporting from a spreadsheet application;
  see §12b's `AC-OPERATOR` note if that's not available in the implementer's environment), and
  `seed-bank.csv` + `seed-bank-images.zip` (BANK.md:202-203's "realistic seed bank... every phase
  after this one is blocked without it" — MCQ, TITA, LaTeX, images, and at least two passage
  groups).
- **Estimated diff:** N/A (fixture data, not LOC-measured code).
- **Subtleties:** `seed-bank.csv`/`.zip` is a hard dependency for every later phase's own tests and
  manual QA (QUIZZING creation needs a real unused pool to draw from) — treat it as the
  highest-priority fixture in this packet, not an afterthought.

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Chunk-failure rollback deletes the wrong rows (e.g. by a stale/reused `import_id`, or deletes before confirming which chunk actually failed) | Med | High — silently corrupts or half-writes the bank | AC-10's forced-failure test, written first per §8b's TDD note |
| D1's actual batch/size ceiling is lower than the 25-row chunk assumption (§3), causing chunk-level failures on ordinary imports, not just the forced-failure test | Med | Med | Implementer confirms current D1 limits before shipping; chunk size is a named constant, trivially tunable |
| `claimUnused`'s per-passage completion check (AC-20) only looks at the ids passed in this call, missing a group completed across two separate calls | Low | Med — a fully-claimed passage silently stays in `listUnused`'s pool forever | AC-20 explicitly requires querying all of a touched passage's questions, not just the just-claimed subset (see §9 subtlety) |
| ZIP decompression of a large companion file exceeds the 128 MB Worker memory ceiling before the size cap (AC-11) is checked | Low | Med — Worker crashes mid-request instead of a clean 400 | Check compressed *and* estimated decompressed size before calling `unzipSync`, not after |
| No test runner existed before this packet — `vitest.config.ts` misconfigured blocks every AC from being verified at all | Med | High (blocks this whole packet's own DoD) | Verify `npm test` runs a trivial passing test before writing any BANK-specific test |
| `fixtures/bank/excel-export.csv` is hand-crafted to *look* Excel-like rather than genuinely exported, silently defeating the point of AC-6 | Med | Med — a whole class of real-world CSV bugs (BOM, CRLF, mangled encodings) ships untested | Flagged as `AC-OPERATOR` in §12b — a human must confirm this file came from a real spreadsheet export, not a hand-written stand-in |

## 11. Rollback / Revert Plan

1. `git revert <sha>` for this packet's commit(s) — no schema migration was added (§1), so there is
   no `migrate:down` step.
2. If `fflate` was added to `package.json` and the revert leaves it installed but unused, run
   `npm install` after the revert to reconcile `package-lock.json` (or equivalent) back to
   pre-packet state.
3. Redeploy the previous Worker version (`wrangler deploy` from the reverted commit, or Cloudflare's
   dashboard rollback if already deployed).
4. Verification: `curl -X POST .../api/bank/import/preview` (no auth) returns 401/403 as before this
   packet existed (i.e., the route no longer exists — a 404 from Hono's default handler is the
   correct post-revert state, not a 401, since the whole route group is gone).
5. If any real data was committed to D1/R2 via this module before the revert was needed (e.g. a bad
   import already ran in production), that data is **not** automatically cleaned up by a code
   revert — separately run `DELETE FROM questions/passages WHERE import_id = ?` for the specific
   bad import, and manually delete its R2 objects by the `bank/${importId}/` prefix (BANK.md:100-101
   already treats this as an acceptable manual/deferred cleanup path).
6. Notify: since this is a single-operator deployment (`COUNCIL_FINDINGS.md`'s repeated framing),
   notify the project owner directly (no separate ops channel exists yet — TELEGRAM's alert
   channel is Phase 6, not built).

## 12. Verification + Definition of Done

### 12a. Automated verification

```bash
npm run typecheck        # tsc --noEmit — must pass with zero errors
npm test                 # vitest run — every AC-1..25 test must pass
git diff -- migrations/0001_init.sql   # must be empty (Hard NO)
git diff -- src/core/api.ts            # must be empty (Hard NO — this packet consumes, doesn't edit, the request/response types)
```

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | Preview a valid CSV+ZIP | `wrangler dev` locally; `curl -F csv=@seed-bank.csv -F zip=@seed-bank-images.zip http://localhost:8787/api/bank/import/preview` as an admin session | 200, `counts`/`passageGroups` match the fixture's known composition, `errors: []` | Not Run |
| BE-2 | Preview the AC-2 acceptance fixture | Same as BE-1 with `valid-mixed.csv` (no ZIP) | 200, `errors` has exactly 2 entries, correct line numbers | Not Run |
| BE-3 | Commit then re-query | `POST /api/bank/import/commit` with `seed-bank.csv`/`.zip`, then `GET /api/bank/questions?limit=50` | `importId` non-null; questions/passages appear with correct `import_id` | Not Run |
| BE-4 | Forced mid-import failure | Run the AC-10 test harness (or manually corrupt one row of a 5-chunk fixture to throw on chunk 3) | D1 row counts before/after are identical; no orphaned rows carry that `import_id` | Not Run |
| BE-5 | PATCH a frozen field | `claimUnused` a seeded question via a direct DB write (simulating QUIZZING, not built yet) setting `used_in_quiz_id`, then `PATCH .../questions/:id` with `{correctOption:"B"}` | 400 | Not Run |
| BE-6 | DELETE a used question | Same setup as BE-5, `DELETE .../questions/:id` | 409 | Not Run |
| BE-7 | `claimUnused` short-return + passage stamp | Claim a set of ids where one question of a 4-question passage group is pre-marked used elsewhere; claim the other 3 | Returns only the 3 newly-won ids; `passages.used_in_quiz_id` gets stamped once all 4 are used | Not Run |
| BE-8 | Images route, admin | `GET /api/images/:key` as an admin session for any stored key | 200, correct content-type, R2 bytes match what was uploaded | Not Run |
| BE-9 | Images route, unauthenticated | `GET /api/images/:key` with no session cookie | 401 | Not Run |

#### Frontend / UI

N/A — this packet is backend-only (§4); the admin console's bank UI is a separate mockup/frontend
track. If a frontend consumer is added before this note is updated, add FE cases here and fail this
packet's Definition of Done until they exist.

#### Chrome DevTools / extension verification

N/A — no browser surface ships in this packet (same reasoning as Frontend/UI above).

#### Operator-executed (post-cutover, see AC-OPERATOR)

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| OP-1 (AC-OPERATOR) | Real Excel-exported CSV fixture | A human exports `excel-export.csv` from an actual spreadsheet application (Excel, Numbers, or LibreOffice Calc saving as "CSV UTF-8"), not a hand-written stand-in, and commits it to `fixtures/bank/` | The file's BOM/CRLF/quoting behavior is whatever that real tool produces; AC-6's test passes against it unmodified | Not Run |
| OP-2 | Confirm current D1 batch limits | A human checks Cloudflare's current D1 `batch()` documentation against this packet's 25-row chunk assumption (§3) | Chunk-size constant adjusted if the real limit differs materially | Not Run |

### 12c. Definition of Done

- [ ] AC-1 through AC-25 satisfied.
- [ ] §12a passes locally (and in CI, once CI exists — no CI config exists in this repo yet;
  flag rather than invent one here).
- [ ] BE-1 through BE-9 have Status ≠ `Not Run` (target: `Pass`).
- [ ] OP-1 through OP-2 completed by the operator, or explicitly waived (record the waiver in §5).
- [ ] No `<INPUT_REQUIRED>` remains in §5 — none do; the one this packet originally raised was
  resolved by the project owner (§5).
- [ ] §8a Hard NO list respected — `git diff` on `migrations/0001_init.sql` and `src/core/api.ts`
  is empty.
- [ ] §11 Rollback plan rehearsed mentally.

---

End of Codex Task Packet — `claude-task--001`
