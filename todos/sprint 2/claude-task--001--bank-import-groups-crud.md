# claude-task--001: Implement bank imports, content groups, images, and admin CRUD

**Sprint:** 2  **Slug:** `bank-import-groups-crud`  **Status:** Draft

> This packet implements the BANK module after the Sprint 1 AUTH guard surface is available. It preserves the current CSV, storage, module, and HTTP contracts and leaves quiz composition/timing to later packets.

---

## 1. Context

Quizzer currently has an initial D1 schema, TypeScript contracts, a Cloudflare R2 binding, and ownership-comment stubs, but no executable question-bank backend. Phase 2 covers BANK-1 through BANK-9: validated CSV preview/commit, MCQ/TITA content, RC/LRDI groups, images, browse/filter/edit/delete, and permanent used-content metadata (`PRD.md:86-101`; `PRD.md:263-274`). BANK is the sole writer of `passages` and `questions`; QUIZZING may later request retirement only through BANK's contract (`MODULES.md:52-72`; `migrations/0001_init.sql:106-165`).

The accepted boundary is deliberately narrow. BANK owns shared material, group membership/order, import validation, R2 image storage/serving, and the three `BankContract` calls. It does not select a quiz, create quiz units, assign time, serve gameplay payloads, or read QUIZZING-owned tables (`BANK.md:10-36`; `CONTRACTS.md:72-106`). Grouped verbal content represents RC, grouped quant/lr content represents LRDI, each group contains four or five questions from the same section, and `group_position` follows CSV file order (`BANK.md:25-36`; `BANK.md:67-85`).

The eight fixed HTTP routes and their direct response bodies already exist in the source contract. Seven routes require the accepted Sprint 1 `requireRole('admin')` semantics; `GET /api/images/:key` requires only `requireAuth()` so authenticated students can later load illustrative images (`API.md:66-94`; `src/core/api.ts:141-211`; `todos/sprint 1/claude-task--001--google-auth-roles-guards.md:83-88`). Keep the BANK routes on those common guards rather than reimplementing session or role logic.

The repository does not yet contain an import-ready `fixtures/bank.csv`. It contains a verified CAT 2018 source archive: searchable UTF-8 section text, layout-preserving PDFs, and an answer key covering 200 questions (`fixtures/bank/cat-2018/README.md:1-23`; `fixtures/bank/cat-2018/answer-key.csv:1-35`). Build a representative import fixture from those checked sources, retain their provenance, and do not alter the source archive or its checksums (`fixtures/bank/cat-2018/SHA256SUMS:1-6`). The resulting fixture must exercise MCQ, TITA, LaTeX, an image, a verbal RC group, a quant/lr LRDI group, and standalones because the BANK test plan requires a realistic seed bank (`BANK.md:209-223`).

There is no reusable BANK implementation to mirror. `src/core/csv.ts`, `src/db/bank.ts`, `src/routes/bank.ts`, `src/routes/images.ts`, and `src/services/images.ts` are one-line ownership stubs (`src/core/csv.ts:1`; `src/db/bank.ts:1`; `src/routes/bank.ts:1`; `src/routes/images.ts:1`; `src/services/images.ts:1`). Preserve those declared responsibilities when replacing them.

## 2. Objective

After this packet ships, an admin can preview and atomically commit a valid UTF-8 bank upload, including RC/LRDI shared rows and optional companion images, then browse, inspect, edit, and safely delete bank content through the exact API contract. Authenticated users can retrieve stored images without gaining access to answers. QUIZZING can consume full eligible content and perform one-way question/passage claims exclusively through `BankContract`, while BANK remains independent of quiz runtime and timing.

## 3. Assumptions

- Sprint 1 has shipped the common Hono `requireAuth`, `requireRole('admin')`, `currentUser`, generic error handler, typed `DB`/`CACHE` bindings, and test harness described by the accepted AUTH packet (`todos/sprint 1/claude-task--001--google-auth-roles-guards.md:77-90`; `todos/sprint 1/claude-task--001--google-auth-roles-guards.md:154-185`). If that dependency is absent, implement Sprint 1 first; do not rebuild it here.
- Runtime and deployment remain TypeScript + Hono on Cloudflare Workers, D1 for relational data, R2 for images, and pure platform-independent code under `src/core/` (`PLAN.md:47-70`; `PLAN.md:251-257`).
- The initial migration is an unapplied baseline and already contains every BANK column/index required by this packet. Timestamps use epoch milliseconds; BANK writes only `passages` and `questions` (`migrations/0001_init.sql:1-19`; `migrations/0001_init.sql:106-165`).
- CSV header names and row semantics are exactly those in BANK: `type,topic,subtopic,difficulty,format,passage_ref,body,image,option_a,option_b,option_c,option_d,correct,numeric_answer,tolerance,explanation,source`. Blank `subtopic` and `source` are valid (`BANK.md:44-65`).
- Preview and commit each receive the CSV plus an optional companion ZIP as multipart data; commit reparses and revalidates its own upload rather than trusting preview state. There is no preview token or added JSON request contract (`API.md:86-94`; `src/core/api.ts:144-159`). The CSV file is field `csv` (required); the companion ZIP is field `images` (optional); `MAX_CSV_BYTES = 5 MB`, `MAX_ZIP_BYTES = 20 MB` as uploaded, `MAX_ZIP_INFLATED_BYTES = 50 MB` after unzip, `MAX_IMAGE_BYTES = 5 MB` per image, and only JPEG/PNG/WebP images verified from file bytes are accepted (`BANK.md:199-207`; `API.md:97-101`).
- `passage_ref` is local to one CSV and never resolves an existing database passage. `import_id` is retained permanently as provenance, and duplicate detection is intentionally absent (`BANK.md:192-201`).
- All identifiers remain opaque strings. Generate collision-resistant server IDs; never accept a caller-selected database ID or infer UUID syntax from `TEXT` columns (`migrations/0001_init.sql:110-122`; `migrations/0001_init.sql:128-157`).
- D1 `batch()` is atomic only within a chunk. A commit may need several chunks, so `import_id` cleanup is the accepted cross-chunk compensation mechanism; R2 cannot participate in D1 atomicity (`BANK.md:95-119`).
- The current API contracts are authoritative and remain byte-for-byte unchanged (`src/core/contracts.ts:25-69`; `src/core/api.ts:95-117`; `src/core/api.ts:141-211`).

## 4. Out of Scope

- **Quiz draw, difficulty allocation, unit construction, timing policy, reshuffle, and lock orchestration:** QUIZZING owns those Phase 3 decisions; BANK only returns unused content and executes requested claims.
- **Student gameplay, local Back/Clear/Skip drafts, batch submission, scoring, results, boards, scheduler jobs, and Telegram:** these belong to later phases and require no BANK implementation.
- **Frontend/admin-console screens and client-side KaTeX rendering:** frontend work follows verified backend phases; BANK stores raw markdown only (`MODULES.md:167-185`; `PRD.md:90-95`).
- **Passage PATCH/DELETE routes or dedicated image replacement routes:** they are absent from the fixed eight-route API inventory, so this packet must not add them (`API.md:66-77`; `API.md:267-272`).
- **Cross-file passage references and duplicate-question detection:** both were explicitly excluded; each import is additive and self-contained (`BANK.md:192-201`).
- **Concurrent-admin all-or-nothing group claims or a claim-release API:** the accepted deployment assumes no overlapping admin lock race; `claimUnused` confirms newly claimed IDs plus same-quiz retries, omits IDs owned by another quiz, and never releases retired content (`src/core/contracts.ts:63-68`; `CONTRACTS.md:100-111`).
- **Deleting or recycling used content on quiz cancellation:** retirement is one way; later cancellation never makes a question available again (`DATA_MODEL.md:52-56`; `BANK.md:182-190`).
- **Schema changes, timing/bonus CSV columns, or new KV keyspaces:** the baseline schema/contracts already encode BANK, and timing belongs to quiz occurrences (`BANK.md:25-36`; `MODULES.md:81-94`).
- **Transforming the entire 200-question CAT archive into production content:** this packet requires a representative, verified import fixture; full editorial conversion is separate content work.

## 5. Open Questions

(none)

The two items that were open when this packet was first drafted are both resolved. Upload field names and size/format limits (field `csv` required, field `images` optional; `MAX_CSV_BYTES = 5 MB`; `MAX_ZIP_BYTES = 20 MB` as uploaded; `MAX_ZIP_INFLATED_BYTES = 50 MB` after unzip; `MAX_IMAGE_BYTES = 5 MB`; JPEG/PNG/WebP verified from file bytes) and the unused-group delete cascade (deleting any unused group member deletes every member plus the shared passage row, atomically, in one request; a used group is still unconditionally protected by the existing 409; a standalone unused question deletes alone) were both settled by the project owner and recorded in `BANK.md:199-214` and `API.md:77-101`. Both rules are now baked directly into AC-3, AC-5 through AC-7, AC-10, and the corresponding tests below rather than tracked as markers. Question-browse pagination is resolved by the global API rule: omitted `limit=50` and `offset=0`; `limit` is an integer from 1 through 100; `offset` is a non-negative integer; malformed, fractional, or out-of-range values return 400 without clamping; and `total` counts the full filtered collection (`API.md:24-46`; `src/core/api.ts:35-54`).

## 6. Pre-flight Checklist

- [ ] Required skill loaded: **`clean-code`** — always required; this packet introduces a complete module with parsing, persistence, storage, and HTTP seams.
- [ ] Required skill loaded: **`prod-safety-gate`** — imports write durable D1/R2 data and CRUD/claim operations can permanently change question availability.
- [ ] Required skill loaded: **`test-driven-development`** — every BANK behavior is new and must begin with a failing behavior test.
- [ ] Required skill loaded: **`vibesec`** — multipart CSV/ZIP uploads, R2 object serving, route parameters, filters, and admin mutation are untrusted/security-sensitive inputs.
- [ ] The resolved upload field names/limits (`BANK.md:199-207`) and the resolved unused-group cascade-delete rule (`BANK.md:209-214`) are understood; both are already baked into AC-3, AC-5 through AC-7, and AC-10 below.
- [ ] Working tree is clean, the implementation branch is up to date with trunk, and the completed Sprint 1 AUTH implementation/tests are green.
- [ ] Local test bindings include isolated D1 and R2 instances; `migrations/0001_init.sql` is applied to the isolated D1 database (`wrangler.toml:14-30`).
- [ ] Production `DB` and `IMAGES` resources are provisioned and bound by the operator; placeholder IDs/names are not mistaken for verified production infrastructure (`wrangler.toml:14-25`).
- [ ] Read before editing: `BANK.md:25-226`, `MODULES.md:23-119`, `DATA_MODEL.md:7-40`, `CONTRACTS.md:72-111`, `API.md:12-111`, `src/core/contracts.ts:25-69`, `src/core/api.ts:95-117`, `src/core/api.ts:141-211`, and `migrations/0001_init.sql:106-179`.
- [ ] Inspect the CAT source README, answer key, searchable text, source PDFs, and checksums before deriving `fixtures/bank.csv`; preserve answer/provenance fidelity (`fixtures/bank/cat-2018/README.md:1-23`; `fixtures/bank/cat-2018/SHA256SUMS:1-6`).
- [ ] Re-read AC-1 through AC-16 and distinguish implementer-run checks from AC-OPERATOR.

## 7. Acceptance Criteria

1. **AC-1 — Parse the canonical CSV without platform dependencies.** A pure `src/core/csv.ts` parser accepts UTF-8 text, strips one leading BOM, honors quoted multiline/comma/quote/backslash/LaTeX content, requires every canonical BANK header to appear exactly once, and returns normalized passage/question candidates plus every deterministic `{line,message}` validation error. Additional columns are tolerated and ignored because the current sources require the canonical columns but do not prohibit extras. Missing/duplicate required-header errors are file-level; missing or invalid required cell values are attached to their physical data line. The parser performs no D1, R2, HTTP, filesystem, or Worker call (`BANK.md:44-85`; `PRD.md:251-258`).
2. **AC-2 — Enforce every row and group rule.** Validate all file/row/format rules in `BANK.md:67-85`: required canonical columns; type allowlist; question-only difficulty; nonempty body/explanation; exact MCQ option/answer rules; numeric TITA answer and nonnegative tolerance; unique passage rows; same-file passage resolution; same-section four-to-five-member groups; and optional blank subtopic/source. Assign one-based contiguous `groupPosition` from question file order. A row may emit more than one line-addressed error; ignored additional columns never suppress validation of canonical cells.
3. **AC-3 — Preview without side effects.** `POST /api/bank/import/preview` is admin-only, accepts only multipart field `csv` (required) plus optional field `images`, rejecting any other field name, validates the CSV and ZIP inventory/content against `MAX_CSV_BYTES`/`MAX_ZIP_BYTES`/`MAX_ZIP_INFLATED_BYTES`/`MAX_IMAGE_BYTES` and the JPEG/PNG/WebP byte-verified allowlist, and returns the exact `ImportPreviewResponse`: question/passages counts, question counts by type/MCQ-TITA format, group summaries, and all errors. It writes no D1/R2/KV state on valid or invalid previews (`BANK.md:199-207`; `src/core/api.ts:107-117`; `src/core/api.ts:144-150`).
4. **AC-4 — Reproduce the named acceptance case.** A CSV containing otherwise valid rows, a missing `correct` value on an MCQ line, and an unknown same-file `passage_ref` returns exactly those two errors at their source lines and leaves both BANK tables and R2 unchanged (`PRD.md:100-101`; `BANK.md:87-93`).
5. **AC-5 — Commit a valid upload with durable provenance.** `POST /api/bank/import/commit` independently reparses/revalidates the multipart upload, creates one `importId`, stores passage rows before dependent question rows in bounded D1 batches, records `created_by` from AUTH and epoch-millisecond `created_at`, preserves nullable subtopic/source/title fields, and returns `{importId,counts,errors:[]}` using the exact response type (`migrations/0001_init.sql:110-165`; `src/core/api.ts:152-159`).
6. **AC-6 — Compensate every failed commit.** Any validation error returns `importId:null`, reports line errors, and writes nothing. Any R2/D1 runtime failure returns the shared generic error response after attempting idempotent best-effort compensation: delete every D1 question then passage row bearing the generated import ID and delete its generated R2-prefix objects. A normal injected chunk/upload failure with healthy cleanup leaves no D1 rows or R2 objects for that import. If D1 or R2 cleanup itself fails, do not claim atomic cleanup: emit observable operator repair metadata containing only the opaque import ID, generated R2 prefix, failed cleanup stage, and safe error category, then follow the forward-repair path in §11. An R2 orphan is unreferenced and protected by a high-entropy server-generated key, but a holder of its exact URL/key can still retrieve it through the authenticated image route until deletion (`BANK.md:95-119`; `API.md:12-23`; `API.md:75-90`).
7. **AC-7 — Store and serve images safely.** Preview validates every referenced filename against the ZIP; commit rejects missing, duplicate, unsafe/path-traversing, malformed, over-limit, or disallowed files. Specifically: the ZIP itself must not exceed `MAX_ZIP_BYTES = 20 MB` as uploaded nor inflate past `MAX_ZIP_INFLATED_BYTES = 50 MB`; each individual image must not exceed `MAX_IMAGE_BYTES = 5 MB`; and only JPEG, PNG, or WebP images verified from actual file bytes (magic number) — never trusted from filename extension or client-supplied MIME header — are accepted (`BANK.md:199-207`). Store accepted bytes under server-generated opaque R2 keys without trusting archive paths, persist only those keys, and derive `imageUrl` server-side. `GET /api/images/:key` requires any authenticated user, returns 404 for a missing object, streams the raw body with its verified stored content type and `X-Content-Type-Options: nosniff`, and never reads a QUIZZING table (`BANK.md:63-65`; `API.md:77-84`; `src/core/api.ts:195-211`).
8. **AC-8 — Implement exact admin browse/read contracts.** `GET /api/bank/questions` applies optional type/topic/difficulty/used filters and the global pagination rule: omitted `limit=50`/`offset=0`; integer `limit` from 1 through 100; non-negative integer `offset`; and 400 for malformed, fractional, or out-of-range values with no clamping. It uses stable ordering, sets `total` to the full filtered count before limit/offset, and returns `PageResponse<QuestionFull>` with the effective limit/offset, nested passage content, and server-derived image URLs. `GET /api/bank/questions/:id` returns the exact full DTO or 404. `GET /api/bank/passages` returns the exact unfiltered `{passages: PassageSummary[]}` response (`API.md:24-46`; `API.md:68-76`; `src/core/api.ts:35-54`; `src/core/api.ts:93-103`; `src/core/api.ts:161-172`; `src/core/api.ts:204-205`).
9. **AC-9 — Update only allowlisted question fields.** `PATCH /api/bank/questions/:id` accepts exactly `UpdateQuestionRequest`, returns the updated `QuestionFull`, validates values against the existing question's format, and rejects unknown/structural/solution/image fields with 400. Once used, it additionally rejects `optionA` through `optionD`; `bodyMd`, `explanationMd`, topic, optional metadata, difficulty, and the contract-permitted tolerance remain editable. All failures leave the row unchanged (`src/core/api.ts:174-199`; `migrations/0001_init.sql:167-172`).
10. **AC-10 — Delete only when legal and preserve group integrity.** `DELETE /api/bank/questions/:id` returns 404 when absent and 409 without writes when `used_in_quiz_id` is set on the target question or on any other member of its group — a group with any used member is unconditionally protected and cascade delete never touches it. When `:id` is a standalone (non-grouped) unused question, delete removes only that question. When `:id` is an unused member of a passage group, delete cascades: every member of that group plus the shared passage row is deleted atomically in one request. Either case returns `{success:true}` on success, and best-effort removes now-unreferenced question image objects without turning an R2 cleanup failure into partial relational corruption. If object deletion fails, emit the same safe repair metadata and recognize that an authenticated holder of the exact high-entropy key can retrieve the orphan until operator cleanup (`BANK.md:209-214`; `API.md:68-81`; `BANK.md:185-193`; `src/core/api.ts:201-202`).
11. **AC-11 — Expose the complete BANK contract without choosing quizzes.** Implement `listUnused`, `claimUnused`, and `getByIds` with exact `QuestionFull` mapping. `listUnused` exposes eligible unused standalone questions and only complete unused four-to-five-member groups matching the requested section/filter boundary; selection/order decisions remain in QUIZZING. `getByIds` preserves caller identity/order semantics and never reads `quiz_questions`. `claimUnused` conditionally stamps unclaimed requested questions with the supplied quiz ID/number and returns requested IDs that were newly claimed or already carry that exact `quizId`/`quizNumber`; requested IDs owned by another quiz are omitted. It stamps a passage only when all of its members have been claimed for that quiz (`src/core/contracts.ts:33-69`; `CONTRACTS.md:72-111`; `BANK.md:123-144`).
12. **AC-12 — Preserve whole-group, retry, and no-repeat state.** No list/draw candidate contains a question already marked used, a passage marked used, an incomplete group, or a group with any used member. Claims never clear or overwrite existing `used_in_quiz_id`/`used_in_quiz_number`; there is no release path. Repeating the same requested IDs with the same quiz ID/number returns the same full confirmation, including previously same-owned IDs, so an ambiguous successful call can be retried. Repeating with a different quiz identity omits already owned IDs and produces a true short return that prevents lock (`BANK.md:123-144`; `CONTRACTS.md:108-111`; `PRD.md:107-115`).
13. **AC-13 — Enforce authentication and authorization centrally.** All preview/commit/question/passage routes use Sprint 1 `requireRole('admin')`, admitting admin and superadmin but returning 401/403 for missing/insufficient auth. The image route uses `requireAuth()` only. BANK does not parse cookies, query roles, or duplicate guard logic (`BANK.md:143-168`; `todos/sprint 1/claude-task--001--google-auth-roles-guards.md:83-88`).
14. **AC-14 — Preserve ownership and established types.** BANK is the only writer of `passages`/`questions` and R2 images. It does not read/write quiz units, runtime, results, boards, Telegram, or KV. `migrations/0001_init.sql`, `src/core/contracts.ts`, and `src/core/api.ts` remain byte-for-byte unchanged (`MODULES.md:52-94`; `MODULES.md:112-119`).
15. **AC-15 — Add realistic permanent fixtures.** Commit `fixtures/bank.csv` and its small companion image ZIP, derived and checked against the current CAT source archive, with MCQ, TITA, quoted multiline text, `$...$` LaTeX, optional blank source/subtopic, standalones, one four/five-question verbal group, one four/five-question quant/lr group, and at least one image reference. Record enough adjacent fixture provenance to trace each selected item back to the existing archive and answer key without modifying those sources (`fixtures/bank/cat-2018/README.md:10-23`; `BANK.md:209-223`).
16. **AC-16 — Prove the module test-first.** Before production code, add failing tests for every parser rule, Excel-style/BOM quoting, preview purity, exact counts/errors, ZIP attacks and the `MAX_ZIP_BYTES`/`MAX_ZIP_INFLATED_BYTES`/`MAX_IMAGE_BYTES` limits and JPEG/PNG/WebP type allowlist, valid import, chunk-three rollback, R2 failures/orphans, DTO allowlists, every CRUD status/freeze, cascade deletion of an unused passage group vs. standalone deletion of an unused ungrouped question, pagination defaults/bounds/no-clamping/full filtered total, complete-group eligibility, ordered retrieval, new/same-owner/other-owner claim cases, route guards, generic errors, and the permanent fixture. Watch each test fail for the intended missing behavior before implementing the minimum passing code (`BANK.md:209-226`).
17. **AC-OPERATOR — Provision and smoke-test production storage.** The operator provisions/selects the real D1 database and R2 bucket, replaces placeholder binding identifiers outside application code, applies the initial migration, performs a small real preview and commit through an admin session, verifies one image response, and records import ID/counts without copying question solutions, session cookies, raw uploads, or provider credentials into logs/review artifacts (`wrangler.toml:14-25`; `migrations/0001_init.sql:106-165`).

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not accept multipart field names other than `csv` (the CSV, required) and `images` (the ZIP, optional); do not accept a CSV over `MAX_CSV_BYTES` (5 MB), a ZIP over `MAX_ZIP_BYTES` (20 MB) as uploaded or `MAX_ZIP_INFLATED_BYTES` (50 MB) after unzip, an image over `MAX_IMAGE_BYTES` (5 MB), or an image format outside JPEG/PNG/WebP verified from file bytes.
- Do not cascade-delete a group that has any used member — the existing "already used" 409 always wins first — and do not leave an unused group partially deleted; cascade delete removes every member plus the shared passage row atomically in one request.
- Do not edit `migrations/0001_init.sql`, `src/core/contracts.ts`, or `src/core/api.ts`; do not add routes, response envelopes, request fields, schema columns, or KV keys.
- Do not read, write, join, or import from any QUIZZING-owned table. `claimUnused` receives quiz identity as opaque values; BANK never verifies it by querying `quizzes`.
- Do not select quiz composition, randomize candidates, assign unit/subquestion positions, store time allowances, or add CSV timing/bonus columns.
- Do not expose `QuestionFull`, answers, tolerances, or explanations through the image route or any future student-run response. Admin BANK responses may use the established full DTO only.
- Do not trust multipart filenames, MIME headers, ZIP paths, compression ratios, counts, sizes, extensions, or CSV cells without runtime validation. Reject absolute paths, `..`, NULs, duplicate normalized names, directory/symlink entries, and disallowed active formats.
- Do not clamp, truncate, coerce, or silently default a supplied invalid pagination value. Apply defaults only when a parameter is omitted and return 400 for malformed, fractional, or out-of-range input.
- Do not store original archive paths as public R2 keys, interpolate input into SQL, dynamically splice sort/filter fields, or return raw D1/R2/parser exceptions.
- Do not make preview write to D1/R2/KV, and do not accept a preview token or client-provided parsed result at commit.
- Do not promise one D1 transaction across a large import or R2+D1. Use bounded batches plus the accepted `import_id` compensation path and test forced mid-import failure.
- Do not clear, overwrite, or release `used_in_quiz_id`/`used_in_quiz_number`; do not delete used content.
- Do not add duplicate detection, cross-file passage lookup, passage mutation routes, image replacement routes, or full CAT corpus conversion.
- Do not modify the CAT archive text/PDF/answer-key/checksum files, Sprint 1 packet, product documents, mockups, progress tracking, frontend, or later-module stubs.

### 8b. Coding / quality principles

- **`clean-code`:** keep HTTP handlers to guard/parse/invoke/respond. Put pure CSV normalization/validation in `src/core/csv.ts`, D1 statements/mapping in `src/db/bank.ts`, and ZIP/R2 work in `src/services/images.ts`. Use explicit domain result types, named size/batch/page constants (`MAX_CSV_BYTES`, `MAX_ZIP_BYTES`, `MAX_ZIP_INFLATED_BYTES`, `MAX_IMAGE_BYTES`, `DEFAULT_PAGE_LIMIT`, `MAX_PAGE_LIMIT`), early returns, and full names.
- **`prod-safety-gate`:** production surfaces are seven admin routes, one authenticated binary route, `passages`/`questions` writes, and R2 objects. Validate on a fresh parse before writes, keep chunks bounded, make cleanup observable, and ensure rollback preserves a usable bank.
- **`vibesec`:** validate multipart shape before allocating large buffers; enforce both compressed and expanded limits; use a Worker-compatible ZIP parser with no filesystem extraction; accept only resolved raster formats verified from bytes; randomize object keys; set `nosniff`; bind every SQL value; allowlist filter/order choices; keep provider errors generic.
- **`test-driven-development`:** write one focused failing test for each AC behavior, verify the expected failure, implement minimally, and run the focused test before the full suite. Adapter mocks may stand in for R2 failures; parser and D1 behavior must exercise real code/data.
- Treat current `src/core/contracts.ts` and `src/core/api.ts` as compile-time imports and runtime allowlists, not suggestions. Construct `QuestionFull`, `PassageContent`, `PassageSummary`, and import responses field by field because TypeScript does not strip extra row properties.
- Keep `src/core/csv.ts` platform independent. ZIP inventory/content validation may be a pure helper fed byte metadata, but Cloudflare request/R2 types stay in route/service adapters.
- Give each validation error a stable, human-readable message and the original one-based physical CSV line. Preserve multiple errors for one line and deterministic ordering by line then rule order.
- Insert passages before questions, clean questions before passages, and isolate each parameterized D1 batch. Cleanup must be idempotent so a retry after partial compensation is safe.
- Resolve `imageUrl` from a central route-safe opaque-key encoder; never duplicate URL construction across database mappers and routes.
- Preserve group membership/order on import and reads. Group completeness is a data invariant, and claims update passage retirement only from database membership, never from caller assertions.

## 9. Behavior Spec (per file)

### `package.json` and generated lockfile

- **Current state (lines 6-24):** scripts include typecheck/test and the Worker test packages, while runtime dependencies contain only Hono (`package.json:6-24`). Sprint 1 may already have added its JWT dependency/lockfile.
- **Required edit:** add one maintained Worker-compatible RFC 4180-style CSV parser and one maintained in-memory ZIP parser, with types where needed; commit the package-manager lockfile. Record the exact selected libraries in this subsection when implementing and isolate their APIs behind `src/core/csv.ts`/`src/services/images.ts`.
- **Estimated diff:** ~2-4 LOC in `package.json`; generated lockfile size determined by npm.
- **Subtleties:** confirm the CSV library preserves physical source-line locations for quoted multiline records or add a tested line-mapping layer. Confirm the ZIP library exposes entries as bytes without filesystem or Node-only APIs and supports enforcing the `MAX_ZIP_BYTES`/`MAX_ZIP_INFLATED_BYTES` limits before/bounded during inflation.

### `src/core/config.ts`

- **Current state (line 1):** the stub reserves shared constants; Sprint 1 is expected to replace it with typed Worker/Hono bindings and AUTH constants (`src/core/config.ts:1`; `todos/sprint 1/claude-task--001--google-auth-roles-guards.md:133-138`).
- **Required edit:** extend the existing binding type with `IMAGES: R2Bucket` and add named BANK constants for the upload policy — `MAX_CSV_BYTES` (5 MB), `MAX_ZIP_BYTES` (20 MB, as uploaded), `MAX_ZIP_INFLATED_BYTES` (50 MB, after unzip), `MAX_IMAGE_BYTES` (5 MB per image) — plus fixed `DEFAULT_PAGE_LIMIT = 50`, `MAX_PAGE_LIMIT = 100`, D1 batch sizing, and image route prefix (`BANK.md:199-207`). Keep units in names (`*_BYTES`, row/statement counts).
- **Estimated diff:** ~20 LOC.
- **Subtleties:** merge with Sprint 1 definitions; do not replace auth bindings/constants. Never use Worker memory or undocumented vendor request limits as an implicit application policy.

### `src/core/csv.ts`

- **Current state (line 1):** the file promises a pure CSV parser/validator returning validated structure or line errors (`src/core/csv.ts:1`).
- **Required edit:** define internal normalized passage/question/import result types and implement BOM-aware parsing, required-header presence/uniqueness validation, tolerance of ignored additional columns, scalar/format validation, passage-reference resolution, same-section group validation, image-reference inventory validation, deterministic counts/errors, and one-based group-position assignment. Keep raw image bytes and platform APIs out.
- **Estimated diff:** ~95 LOC across small cohesive parser/validator helpers.
- **Subtleties:** quoted embedded newlines make record number different from physical line; preserve the source record's starting line. A passage row is counted in `passages`, never in `questions` or `byFormat`. Optional blank strings map to `null`; required strings are trimmed only according to an explicit tested normalization rule without damaging authored markdown/LaTeX.

### `src/services/images.ts`

- **Current state (line 1):** the stub assigns R2 write/read behavior for question and passage images to BANK (`src/services/images.ts:1`).
- **Required edit:** parse the optional ZIP in memory under the `MAX_ZIP_BYTES`/`MAX_ZIP_INFLATED_BYTES` limits, normalize and validate its inventory, verify accepted image bytes are under `MAX_IMAGE_BYTES` and match the JPEG/PNG/WebP magic-number allowlist (never filename extension or client MIME header), expose metadata to the pure CSV validator, upload referenced images under generated import-keyed opaque keys with verified `httpMetadata.contentType`, retrieve/stream objects, and best-effort delete an import prefix or individual unused-question image.
- **Estimated diff:** ~95 LOC.
- **Subtleties:** never extract paths to disk or use caller paths as object keys. Reject duplicate normalized entries and unreferenced unsafe entries before commit. Make upload/delete idempotency explicit. When cleanup succeeds, no R2 object remains for the failed import. When R2 deletion itself fails, record the exact generated prefix for operator repair; the resulting object is unreferenced but remains retrievable by an authenticated holder of its high-entropy exact key until deletion.

### `src/db/bank.ts`

- **Current state (line 1):** the stub owns `passages`, `questions`, `BankContract`, and admin CRUD (`src/db/bank.ts:1`).
- **Required edit:** implement explicit row mappers; bounded import batches and import-ID compensation; paginated filtered question browse; question/passage reads; allowlisted conditional PATCH; cascade-aware DELETE; and `listUnused`/`claimUnused`/`getByIds` using parameterized D1 statements. Join/load passages only inside BANK and derive nested `PassageContent` plus image URLs.
- **Estimated diff:** ~100 LOC per cohesive repository/import component; split this file into adjacent BANK-owned persistence files if a clear unit would exceed that size, while keeping one exported BANK facade.
- **Subtleties:** avoid SQL variable-limit overflow by chunking ID lists. Keep caller order in `getByIds`, report missing IDs distinctly to the caller, and avoid N+1 passage reads. List filters/order expressions must come from fixed branches, not input interpolation. `claimUnused` is intentionally not an all-or-nothing concurrent group transaction; its conditional write/read must treat an exact same quiz ID/number as confirmed, omit a different owner, and stamp a passage only after proving every stored member belongs to the supplied quiz identity. DELETE first checks `used_in_quiz_id` on the target row and, if it belongs to a group, on every sibling row sharing the same `passage_id` — any used member (target or sibling) triggers the 409 with no writes. If the target is a standalone unused question, delete only that row. If it is an unused group member, delete every question row sharing that `passage_id` plus the passage row itself inside one bounded D1 `batch()` so the whole cascade is atomic; then best-effort clean up the now-unreferenced image objects (`BANK.md:209-214`).

### `src/routes/bank.ts`

- **Current state (line 1):** the stub names the seven admin BANK routes and PATCH freeze behavior (`src/routes/bank.ts:1`).
- **Required edit:** export a Hono sub-app/handlers for preview, commit, paginated browse, detail, PATCH, DELETE, and passage list. Parse only the exact contract fields; invoke CSV/image/database use cases; map validation/not-found/used conflicts to documented results/statuses; serialize direct response DTOs and generic errors.
- **Estimated diff:** ~95 LOC.
- **Subtleties:** the two imports are multipart rather than JSON. Preview must not share a side-effecting helper with commit. Reject extra multipart/body fields and malformed numeric/boolean query values. Treat question IDs as bounded nonempty opaque strings and bind unchanged; do not impose UUID syntax.

### `src/routes/images.ts`

- **Current state (line 1):** the stub assigns `GET /api/images/:key` to BANK and explicitly requires authenticated rather than admin access (`src/routes/images.ts:1`).
- **Required edit:** validate/decode one opaque route key, fetch through the image service, return 404 when absent, and stream the stored object body with its verified content type, entity metadata where safe, and `X-Content-Type-Options: nosniff`.
- **Estimated diff:** ~35 LOC.
- **Subtleties:** generated keys should avoid slash/wildcard ambiguity in the fixed `:key` route. Do not turn the endpoint into an arbitrary R2 prefix/listing proxy, disclose bucket errors, attach solutions, or query participant progress.

### `src/index.ts`

- **Current state (line 1):** the entrypoint stub assigns Hono mounting and future scheduler orchestration (`src/index.ts:1`); Sprint 1 is expected to establish the app and generic error handling.
- **Required edit:** mount the BANK sub-app at `/api/bank` behind the shared admin guard and mount `/api/images/:key` behind the shared authenticated guard. Preserve AUTH mounts/error handling and the future scheduled-handler seam.
- **Estimated diff:** ~12 LOC.
- **Subtleties:** guard placement must cover every BANK route without accidentally applying admin scope to images. Do not mount aliases or expose an unguarded copy through route-order mistakes.

### `fixtures/bank.csv` and `fixtures/bank-images.zip` (new)

- **Current state:** no import-ready BANK CSV/ZIP exists. The source archive supplies checked text/PDF content and a 200-row answer key (`fixtures/bank/cat-2018/README.md:1-23`; `fixtures/bank/cat-2018/answer-key.csv:1-35`).
- **Required edit:** create the realistic representative seed described in AC-15, including provenance and companion raster image, using the canonical BANK header/row format. Add a small adjacent README only if needed to map selected fixture rows/images to source slot/section/question locations.
- **Estimated diff:** data-dependent; keep it representative and reviewable rather than converting all 200 questions.
- **Subtleties:** do not edit/re-encode source PDFs/text/answer key/checksums. Verify answer letters/numeric values against the answer key and diagram/layout against the source PDF. Respect the resolved image policy (`MAX_IMAGE_BYTES = 5 MB`; JPEG/PNG/WebP only; `BANK.md:199-207`) and repository licensing/provenance conventions.

### `tests/csv.test.ts` (new)

- **Current state:** no BANK parser tests exist; BANK requires every validation rule, real Excel output, atomicity, and realistic fixture coverage (`BANK.md:209-223`).
- **Required edit:** drive AC-1/2/4/15/16 with table tests for every CSV rule, each missing/duplicate canonical header as a file-level error, tolerated ignored additional columns, missing required cells as line-level errors, multiple errors per line, exact physical line reporting, BOM/CRLF/quoted multiline content, commas/quotes/backslashes/LaTeX, valid RC/LRDI groups, and parsing the permanent seed fixture.
- **Estimated diff:** ~100 LOC plus compact test-case data.
- **Subtleties:** assert exact errors/counts, include valid control rows so overly broad validators fail, and do not reimplement the parser in test helpers.

### `tests/bank.test.ts` (new)

- **Current state:** no BANK persistence/API tests exist; exact route and DTO contracts are definitions only (`API.md:66-111`; `src/core/api.ts:141-205`).
- **Required edit:** exercise the mounted Worker against isolated migrated D1/R2. Cover preview purity, commit success, forced third-chunk and R2 failure compensation, exact response allowlists, browse filters plus default/valid/invalid pagination and full filtered totals, detail/passage list, all PATCH fields/freeze rules, cascade deletion of an unused passage group (every member plus the passage row removed atomically) versus standalone deletion of an unused ungrouped question versus 409-with-no-writes when any member is used, all 401/403/404/409 paths, `listUnused`, ordered `getByIds`, new/same-owner/other-owner `claimUnused` behavior, passage retirement, and no QUIZZING/KV access.
- **Estimated diff:** ~100 LOC per focused suite; split import, CRUD, and contract tests into separate BANK test files when clearer.
- **Subtleties:** snapshot D1 BANK rows and R2 keys before forced failure and compare afterward. With healthy compensation they must match exactly. When cleanup itself is injected to fail, assert a generic request failure plus safe repair metadata and the precise residual D1/R2 state; an unreferenced R2 object remains retrievable by exact key until repaired. Assert serialized objects have no snake_case/internal columns.

### `tests/images.test.ts` (new)

- **Current state:** no ZIP/R2 or binary route tests exist; image upload/serving currently has only ownership stubs (`src/services/images.ts:1`; `src/routes/images.ts:1`).
- **Required edit:** cover valid JPEG/PNG/WebP images, missing references, duplicate names, traversal/absolute/NUL names, forged MIME/extensions, malformed archives/images, each of the `MAX_ZIP_BYTES`/`MAX_ZIP_INFLATED_BYTES`/`MAX_IMAGE_BYTES` boundaries, disallowed image formats, generated opaque keys, content type/`nosniff`, missing objects, authenticated student access, and signed-out rejection.
- **Estimated diff:** ~90 LOC.
- **Subtleties:** build malicious ZIP bytes in-memory with tiny fixtures; do not commit huge bomb files. Assert rejection happens before D1/R2 writes and, where measurable, before inflation exceeds the configured budget.

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| CSV parser misreports lines after quoted multiline fields | Med | Med | AC-1/2 and Excel/BOM/physical-line tests in `tests/csv.test.ts`. |
| A malformed/oversized ZIP exhausts Worker memory or serves active content | Med | High | Resolved `MAX_ZIP_BYTES`/`MAX_ZIP_INFLATED_BYTES`/`MAX_IMAGE_BYTES` limits and the JPEG/PNG/WebP byte-verified allowlist (`BANK.md:199-207`), AC-7, byte/type verification, bounded inflation, and malicious archive tests. |
| Preview accidentally uploads or inserts data | Low | High | Separate pure preview path, AC-3/4, and before/after D1/R2 assertions. |
| A later D1 chunk fails after earlier chunks commit, and compensation may also fail | Med | High | Import-ID compensation, question-before-passage cleanup order, healthy-cleanup zero-row test, safe repair metadata, and §11 operator forward repair. |
| R2 and D1 diverge during failure or deletion; an exact-key holder can still fetch an orphan | Med | Med | High-entropy generated import prefixes, best-effort idempotent cleanup, explicit access limitation, repair metadata, and operator enumeration/deletion. |
| Group deletion creates an invalid three-question set | Med | High | Resolved cascade-delete rule (`BANK.md:209-214`): deleting any unused group member atomically deletes every member plus the shared passage row in one request, still gated by the existing used-group 409, so a partial group can never remain. AC-10 and BE-7 assert this behavior. |
| Used questions/options are modified or deleted, corrupting past review | Low | High | Conditional write checks at the repository boundary plus AC-9/10 race and freeze tests. |
| `listUnused` exposes a used/incomplete group, a claim overwrites retirement, or a same-quiz retry returns short | Low | High | AC-11/12 database-backed group/no-repeat and new/same-owner/other-owner retry tests with one BANK writer. |
| Browse filters/order permit SQL injection, silently clamp bad input, or run an unbounded page | Med | High | Parameter binding, fixed sort/filter branches, 50/100 constants, exact integer validation, 400 boundary tests, and full filtered-count assertions. |
| Full database rows leak internal fields or answers outside admin scope | Low | High | Explicit DTO construction, common guards, image-only binary response, and serialized response tests. |
| Sprint 2 duplicates or weakens Sprint 1 auth logic | Low | High | Depend on accepted guard exports, route-matrix tests, and Hard NO against cookie/role handling in BANK. |
| Dependency/test setup works in Node but fails in Workers | Med | Med | Worker-compatible library preflight and the existing Workers Vitest pool, exercised through the exported app. |
| Operator points production at placeholder D1/R2 resources | Low | High | AC-OPERATOR and binding/migration smoke tests before live content import. |
| Fixture drifts from source answers/provenance | Med | Med | AC-15 verification against README/answer key/PDF and preservation of checksums. |
| Later contracts or docs drift from implementation | Med | Med | Compile against existing core types; byte-diff guard on source contracts/schema; route inventory tests. |

## 11. Rollback / Revert Plan

1. Stop new BANK import/CRUD traffic at the deployment/routing layer if continuing requests could add or mutate content; existing quiz runtime remains independent because BANK does not own its tables (`MODULES.md:52-68`).
2. Record the affected `import_id`, question IDs, passage IDs, and generated R2 key prefix from operational metadata without copying question solutions or user/session data.
3. Run `git revert <sha>` for the Sprint 2 implementation and deploy the rebuilt prior Worker. Do not revert the Sprint 1 AUTH foundation or the initial schema, which predates this packet (`migrations/0001_init.sql:1-19`).
4. No migrate-down is required because this packet changes no migration. Restart/redeploy the Worker so the reverted route table is active; clear no KV keys because BANK owns none (`MODULES.md:81-94`).
5. If a failed import left D1 rows, execute a reviewed forward repair that deletes `questions` for the recorded `import_id` before `passages`, then verify both counts are zero. Never delete by an unbounded/wildcard predicate (`BANK.md:103-119`; `migrations/0001_init.sql:120-126`; `migrations/0001_init.sql:153-165`).
6. Enumerate R2 objects matching the exact recorded generated import prefix and delete only those that are not referenced by surviving BANK rows. If R2 is unavailable, record the repair as pending and retry cleanup later. These objects are unreferenced and have high-entropy server keys, but an authenticated holder of the exact key/URL can still fetch one until deletion; do not delete a valid D1 row to make storage cleanup appear complete (`BANK.md:111-119`; `API.md:75-80`).
7. Verify the reverted deployment returns 404 for a Sprint 2 route (or the preexisting behavior expected at that revision), AUTH `/api/auth/me` still works, D1 contains no partial target import, and unrelated table counts are unchanged.
8. Notify the project owner/operator with the reverted commit, affected import ID/counts, exact residual-state category, whether unreferenced R2 objects remain retrievable by exact key, and the follow-up repair/test result in the project's deployment channel.

## 12. Verification + Definition of Done

### 12a. Automated verification

Run after Sprint 1 dependencies are incorporated:

```bash
npm ci
npm run typecheck
npm test -- tests/csv.test.ts
npm test -- tests/bank.test.ts
npm test -- tests/images.test.ts
npm test
python3 .claude/skills/quizzer-backend-spec/scripts/validate_packets.py \
  "todos/sprint 2/claude-task--001--bank-import-groups-crud.md"
```

Confirm protected contracts/schema/source fixtures did not change and no forbidden cross-module SQL/key access appeared:

```bash
git diff --exit-code -- migrations/0001_init.sql src/core/contracts.ts src/core/api.ts
git diff --exit-code -- fixtures/bank/cat-2018
git diff --exit-code -- src/db/boards.ts src/db/play.ts src/db/quizzes.ts src/db/results.ts src/db/telegram.ts src/db/users.ts
git diff --exit-code -- src/routes/admins.ts src/routes/auth.ts src/routes/boards.ts src/routes/play.ts src/routes/quizzes.ts src/routes/reports.ts src/routes/results.ts
git diff --exit-code -- src/services/cache.ts src/services/jwt.ts src/services/observability.ts src/services/telegram.ts
rg -n "quiz_units|quiz_questions|quiz_seats|participants|participant_units|answers|weekly_boards|telegram_posts" \
  src/core/csv.ts src/db/bank.ts src/routes/bank.ts src/routes/images.ts src/services/images.ts
rg -n "correctOption|numericAnswer|numericTolerance|explanationMd" src/routes/images.ts src/services/images.ts
```

The two `rg` commands must return no matches. Review new adjacent BANK persistence files too if `src/db/bank.ts` was split.

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | Guard matrix | Call preview, commit, question browse/detail/PATCH/DELETE, and passage list signed out, as student, admin, and superadmin; call one existing image as the same identities. | BANK routes: 401 signed out, 403 student, success admin/superadmin. Image: 401 signed out and success for every authenticated role. | Not Run |
| BE-2 | Acceptance preview | Upload the permanent valid fixture modified so one MCQ lacks `correct` and one row uses an unknown `passage_ref`. | Preview reports exactly the two physical source lines, correct partial counts/group summaries, and D1/R2 are unchanged. | Not Run |
| BE-3 | Valid preview and commit | Preview then commit `fixtures/bank.csv` with its companion ZIP and inspect the responses/tables/objects. | Preview is side-effect free; commit returns non-null import ID, exact counts, correct nullable metadata/group order, and every referenced image resolves. | Not Run |
| BE-4 | Runtime failure and compensation | Inject failure on chunk three of a five-chunk import with healthy cleanup; then separately inject D1 cleanup failure and R2 deletion failure. | Healthy cleanup leaves no import D1 rows/R2 objects. Cleanup failure returns a generic error, emits safe exact repair metadata, and reports/asserts residual state without promising atomicity; an R2 orphan remains retrievable to an authenticated exact-key holder until operator deletion. | Not Run |
| BE-5 | Browse and DTO shape | Exercise all filters with omitted pagination, limits 1/50/100, offsets 0/positive, and malformed/fractional/zero/negative/over-100 values; fetch a grouped item and passage list and inspect raw JSON. | Omitted values produce 50/0; valid values echo exactly; invalid values return 400 without clamping; `total` is the full filtered count; nested content/image URLs are correct and no internal columns leak. | Not Run |
| BE-6 | PATCH freeze | Edit every allowed field before use; claim the question, then retry body/explanation/metadata edits, options, and forbidden solution/identity/image fields. | Contract-allowed edits behave exactly as AC-9; forbidden/frozen fields return 400 and leave the row unchanged. | Not Run |
| BE-7 | DELETE integrity | Delete absent, used, standalone-unused, and grouped-unused questions; for the grouped-unused case confirm the cascade removes every sibling member plus the shared passage row atomically in the same request, and confirm a group with any used member still 409s with no writes. | 404/409 are exact; successful cases return `{success:true}`; no invalid/orphaned visible group or relational partial state remains. | Not Run |
| BE-8 | BankContract boundary | List a pool containing standalones, complete/incomplete/partly used groups; retrieve shuffled IDs; claim IDs, retry with the same quiz ID/number, then retry overlapping IDs with a different quiz identity. | Only eligible content lists; retrieval follows caller order; same-owner retry returns all requested same-owned IDs; other-owner IDs are omitted without overwrite; only the true conflict produces a short return; fully claimed passages retire once. | Not Run |
| BE-9 | Hostile uploads | Submit wrong multipart field names/types, malformed UTF-8/CSV/ZIP, traversal/duplicate ZIP entries, forged images, images outside JPEG/PNG/WebP, and each `MAX_CSV_BYTES`/`MAX_ZIP_BYTES`/`MAX_ZIP_INFLATED_BYTES`/`MAX_IMAGE_BYTES` size boundary. | Each request fails deterministically with generic transport errors or line errors as specified, before visible D1/R2 writes and without stack/provider details. | Not Run |

#### Frontend / UI

N/A — this is a backend-only packet and no `web/` or mockup file may change. If frontend work enters the diff, fail implementation review and add FE cases in a separate packet.

#### Chrome DevTools / extension verification

N/A — no frontend surface is implemented in Sprint 2. Browser network/UI inspection belongs to later frontend integration; API behavior is covered through Worker requests above.

#### Operator-executed (post-cutover, see AC-OPERATOR)

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| OP-1 | Bindings and migration | Verify the deployed Worker points to intended `DB`/`IMAGES` resources, apply the initial migration, and inspect table presence without printing credentials. | `passages`/`questions` and indexes exist; the R2 binding responds; no placeholder production resource remains. | Not Run |
| OP-2 | Live preview/commit | Through a real admin session, preview and commit a small reviewed copy of the permanent fixture once. Record only import ID/counts. | Preview writes nothing; commit succeeds exactly once with matching counts and rows tied to the operator user/import ID. | Not Run |
| OP-3 | Live image and guard check | Fetch a committed image as an authenticated student and signed out; inspect response headers and application logs. | Student gets correct bytes/type plus `nosniff`; signed out gets 401; logs contain no cookie, solution, upload bytes, SQL/provider trace, or secret. | Not Run |
| OP-4 | Cleanup readiness | Enumerate objects for the test import's exact prefix and rehearse the reviewed import-ID D1 count queries without deleting the successful import. | Operator can identify precisely scoped D1/R2 state and no wildcard/unbounded cleanup command is required. | Not Run |

### 12c. Definition of Done

- [ ] The resolved upload field names/limits and the resolved unused-group cascade-delete rule (`BANK.md:199-214`) are reflected in ACs, constants, tests, and manual QA.
- [ ] AC-1 through AC-16 are satisfied.
- [ ] §12a passes locally and in CI if CI exists.
- [ ] BE-* in §12b have Status other than `Not Run` (target: `Pass`).
- [ ] FE and CHROME remain correctly N/A because no frontend surface changed.
- [ ] OP-* is completed by the operator or explicitly waived and recorded in §5.
- [ ] No `<INPUT_REQUIRED>` marker remains.
- [ ] §8a Hard NO list is respected; all protected-file `git diff --exit-code` checks are empty.
- [ ] Exactly eight BANK routes exist with the current paths/guards/status/response shapes; no extra route or body field was introduced.
- [ ] Question browse defaults to 50/0, rejects every invalid supplied pagination value with 400 without clamping, and reports the full filtered `total`.
- [ ] `claimUnused` confirms newly claimed plus exact same-quiz-owned IDs, omits other-quiz-owned IDs, and passes an ambiguous-success retry test.
- [ ] Permanent fixture parses and commits under the same production parser; source archive and checksums are unchanged.
- [ ] No BANK code reads/writes later-module tables or KV, and no other module writes BANK tables/R2.
- [ ] Rollback/forward-repair plan in §11 has been reviewed against one injected partial-import failure.

---

End of Codex Task Packet — `claude-task--001`
