# Quizzer — Question Bank Module

> **Scope:** the `bank` module only. Product requirements in [[PRD]] §5.2; index in [[MODULES]].
> **Status:** module spec, nothing built. Phase 2. Audited and resolved 2026-09-04 — see [[AUDIT]]
> §11.
> **Last updated:** 2026-09-10

---

## 1. What this module is

The permanent store of questions, and the only way questions get into the system. Everything else
in the app consumes it; nothing else writes it.

| It does | It does not |
|---|---|
| Import questions in bulk from CSV, validated and previewed | Choose which questions go in a quiz — that is Quizzing's selection |
| Own `questions` and `passages`, including the never-repeat column | Decide *when* to retire — Quizzing calls in at lock time |
| Store question images in R2 | Render LaTeX — that is client-side KaTeX |
| Serve admin browse / filter / edit / delete | Serve questions to students during a run — Quizzing does that, redacted |

**The bank is permanent; a quiz is ephemeral.** That difference in lifetime is why this is a
separate module from Quizzing rather than a folder inside it.

### RC and LRDI content groups (2026-09-09)

The existing `passages` / `passage_ref` names cover both RC passages and LRDI shared material.
No new CSV format or timing columns are needed. A verbal group represents RC; a quant/lr group
represents LRDI. Every member must match its shared row's section. Keep the existing 4–5-question
validation and whole-group retirement. The UI may call these "sets" without renaming stored IDs.

BANK owns membership and `group_position`, never the unit allowance or student timer. QUIZZING
turns a complete group into one quiz-specific timed unit; a question without `passage_ref` is a
standalone unit. `QuestionFull.passage` returns shared title/body **and imageUrl**, so LRDI
charts and RC illustrations are available in both the runner and review. Timing is assigned on
the quiz, not permanently attached to bank content. See [[DATA_MODEL]].

## 2. Requirements covered

BANK-1 … BANK-9. Feeds QUIZ-2, QUIZ-3, QUIZ-5.

---

## 3. CSV import — the core of this module

One row per question. Parsed by `core/csv.ts`, which is pure: string in, validated structure or a
list of errors out. No network, no DB.

```
type,topic,subtopic,difficulty,format,passage_ref,body,image,
option_a,option_b,option_c,option_d,correct,
numeric_answer,tolerance,explanation,source
```

- `format=mcq` → fill `option_a..d` + `correct` (A–D); leave numeric columns blank
- `format=tita` → leave options + `correct` blank; fill `numeric_answer` and `tolerance`
- `format=passage` → a **passage row**: passage text in `body`, an id in `passage_ref`,
  options/answer blank. There is deliberately no title column — `passages.title` is nullable and a
  passage without one just displays without a title (COUNCIL_FINDINGS.md #31). `difficulty` is
  validated on question rows only (§3.1) — passages carry no difficulty of their own.
- Question rows sharing that `passage_ref` attach to it, in file order. Blank = standalone
- `body` and `explanation` accept `$...$` LaTeX, rendered client-side with KaTeX
- `image` names a file in a companion ZIP → stored in R2
- `subtopic` and `source` are optional. `source` is provenance such as `CAT 2018 Slot 1` or
  `Original/internal`; a blank value is valid.

### 3.1 Validation rules

Every rule reports **by line number** (BANK-7). A row can produce more than one error.

| Rule | Applies to |
|---|---|
| All required columns present | file |
| `type` ∈ {verbal, quant, lr} | every row |
| `difficulty` ∈ {easy, medium, hard} | question rows only — `passages` has no difficulty column (COUNCIL_FINDINGS.md #31) |
| `format` ∈ {mcq, tita, passage} | every row |
| `body` non-empty | every row |
| `explanation` non-empty | every question row (BANK-5) |
| `subtopic` and `source` may be blank | every row |
| Exactly 4 non-empty options, `correct` ∈ A–D, numeric columns blank | `mcq` |
| `numeric_answer` parses as a number, `tolerance` ≥ 0, options blank | `tita` |
| `passage_ref` set and unique in the file, options/answer blank | `passage` |
| A question's `passage_ref` resolves to a passage row **in the same file** | question rows |
| Each RC/LRDI group has **4–5** questions (BANK-6), all matching the shared row’s section | groups |
| `image` names a file present in the companion ZIP | rows with an image |

### 3.2 Preview, then commit

Nothing is written until the admin confirms. The preview shows the parsed counts (questions by
type/format, passage groups and their sizes), and every error by line.

**Acceptance ([[PRD]] §5.2):** a CSV mixing valid rows, a missing `correct` column, and an unknown
`passage_ref` produces a preview listing exactly those two errors by line and commits nothing.

### 3.3 "A failed import writes nothing at all" — how, without transactions

BANK-7 asks for atomicity. Two things make that harder than it sounds:

1. **D1 has no interactive transactions.** `batch()` is atomic, but it has statement and size
   limits — a 500-row CSV will not fit in one batch and must be chunked, which breaks atomicity.
2. **R2 is not in the transaction at all.** Images are written outside any D1 guarantee.

**Proposed mechanism — an `import_id`:**

```sql
-- schema addition to both tables
questions.import_id   TEXT NULL
passages.import_id    TEXT NULL
```

- Generate an `import_id` per commit.
- Upload images to R2 under a prefix keyed by that id.
- Insert rows in chunked batches, every row stamped with the id.
- On any chunk failure: `DELETE FROM questions WHERE import_id = ?` and the same for `passages`.
  The import is undone.
- Orphaned R2 objects from a failed import are harmless (10 GB free, zero egress) and can be swept
  later by prefix.

`import_id` is already part of the initial schema and remains unchanged by the timing revision.

---

## 4. Data owned

`passages`, `questions` — sole writer, including `used_in_quiz_id`.

**Boundary note:** Quizzing decides *which* questions to retire, but the write happens here, through
a single exposed function, so that every write to `questions` lives in one module:

```ts
// called by Quizzing inside the quiz-lock flow
claimUnused(questionIds: string[], quizId: string, quizNumber: number): Promise<string[]>
```

It performs the conditional claim ([[PLAN]] §"The no-repeat guarantee") and returns the ids it
confirms for this quiz: newly claimed ids plus ids already carrying the same `quizId` and
`quizNumber`. This same-owner behavior makes a retry idempotent after the first response or the
following QUIZZING publication step is lost. An id owned by another quiz is omitted, so a true
short return still prevents lock. It also derives
each claimed question's `passage_id` and stamps `passages.used_in_quiz_id` in the same call, so a
fully-retired passage is correctly excluded from `listUnused`'s pool — that column previously had
no writer at all (COUNCIL_FINDINGS.md #4). This is single-admin bookkeeping, not concurrency
handling: there's no all-or-nothing claim across a passage group and no `release()` for a partial
match, since concurrent admins locking overlapping quizzes doesn't happen in this deployment.

## 5. Interfaces

**Exposes:** `listUnused(filters)` · `claimUnused(...)` · `getByIds(questionIds)` (full rows,
answers included — server/admin use, never student gameplay) · admin CRUD.

`getByIds` replaces what used to be `getForQuiz(quizId)` — that signature required this module to
read [[QUIZZING]]'s `quiz_questions` table to resolve which questions belong to a quiz, inverting
the dependency arrow ([[AUDIT]] §3.7). [[QUIZZING]] now resolves `quizId → questionIds` itself and
just hands this module the ids.

**Consumes:** Auth (`requireRole('admin')` for every route below except `GET /api/images/:key`),
R2 (images), D1.

**Routes:** `POST /api/bank/import/preview` · `POST /api/bank/import/commit` ·
`GET /api/bank/questions` (filter by type / topic / difficulty / used-unused) ·
`GET|PATCH|DELETE /api/bank/questions/:id` · `GET /api/bank/passages` ·
`GET /api/images/:key` — serves an R2 object by key (BANK-4). This module owns R2 end to end,
import and serving; the route had no owner before ([[AUDIT]] §5). **This one route is not
admin-gated** — students load question images mid-quiz, so it's `requireAuth()` only (any
signed-in user, no per-question scoping). Deliberately not scoped further: enforcing "only once
served" would mean this module reading QUIZZING-owned tables (`quiz_questions`, `participants`) to
know a student's progress — a real violation of "BANK never reads QUIZZING's tables" — to prevent
a threat that isn't one: these are illustrative images, not answers, and guessing another
question's key gets a curious student a picture, nothing that helps them cheat
(COUNCIL_FINDINGS.md #11, reconsidered — same call as #25/#44: don't defend against a threat this
deployment doesn't have).

---

## 6. Limitations and hard parts

- **CSV is a hostile format for this content.** Passages are multi-line and must be quoted; LaTeX
  contains commas and backslashes; Excel silently mangles leading zeros, long numbers, and
  encodings. **Require UTF-8, strip a BOM if present, and test against a file Excel actually
  produced** — not one written by hand.
- **Worker memory is 128 MB.** A large companion ZIP is unzipped in memory. Cap the ZIP size and
  reject early with a clear message rather than dying mid-import.
- **Request body size** limits apply to the upload. A very large bank should be imported in several
  files, which is fine — imports are additive.
- **D1 batch limits** force chunking; see §3.3 for why that needs `import_id`.
- **`used_in_quiz_id` is a one-way door.** Once stamped, a question never returns to the pool.
  `correct_option`, `numeric_answer`, `option_a..d`, and `used_in_quiz_id` itself are frozen from
  that point on; `body_md`/`explanation_md` stay editable so a typo can still be fixed (resolved
  2026-09-04, §7). Options freeze alongside `correct_option` — not just at import — because a
  frozen correct answer paired with edited option text is a real bug a review screen could show
  (COUNCIL_FINDINGS.md #20); the freeze is enforced by the PATCH handler checking
  `used_in_quiz_id IS NULL`, not by the database. Deleting a used question would corrupt past
  results and review screens — **forbidden outright** (resolved 2026-09-05, §7).

## 7. Open questions

None remain — see the resolutions below.

**Resolved 2026-09-10** (project owner) — **upload field names and size/format limits for CSV
import**, previously unspecified (the Sprint 2 packet's OQ-1):
- Multipart field names: `csv` (the CSV file, required) and `images` (the companion ZIP,
  optional).
- `MAX_CSV_BYTES = 5 MB`, `MAX_ZIP_BYTES = 20 MB` (as uploaded), `MAX_ZIP_INFLATED_BYTES = 50 MB`
  (after unzip — this is the zip-bomb guard called for in §6).
- `MAX_IMAGE_BYTES = 5 MB` per image.
- Allowed image formats: JPEG, PNG, WebP — verified from the actual file bytes (magic number),
  never trusted from the filename extension or a client-supplied MIME header.

**Resolved 2026-09-10** (project owner) — **deleting one question from an unused RC/LRDI group**
(the Sprint 2 packet's OQ-2): cascade — deleting any one member of an unused passage group deletes
every member of that group plus the shared passage row, atomically, in one request. This only
applies while the group is unused; a group with any used member is still unconditionally protected
by the existing "already used" 409 (§6, resolved 2026-09-05) — cascade delete never touches a used
group. A standalone (non-grouped) unused question deletes alone, unchanged.

**Resolved 2026-09-05** (project owner, see [[PRD]] §9): duplicate detection on import — not
built; **deleting a used question** — forbidden outright, no exceptions; **`passage_ref`** —
same-file only, confirmed as the permanent rule (every passage always uploads bundled with its own
questions in one file — no CSV import ever references a passage already in the database);
**`import_id`** — kept forever as provenance; nothing reads it after a successful commit, so
clearing it would cost nothing either way, but there's no reason to actively scrub it.

**Resolved 2026-09-04** (see [[AUDIT]] §11) — **editing a used question:** `correct_option`,
`numeric_answer` and `used_in_quiz_id` freeze forever the moment a question is used (reuse in
another quiz was already permanently blocked — not in question). `body_md` and `explanation_md`
stay editable after use, because the only live concern was a typo surfacing forever on that quiz's
review screen, not re-grading anything already scored.

## 8. Testing

- **Unit, `core/csv.ts`** — the acceptance case from [[PRD]] §5.2 exactly; plus every rule in §3.1
  with a fixture that violates it; plus a passage group of 3 and of 6 (both rejected); plus a row
  with a `$LaTeX$` body containing commas and quotes.
- **A file exported from Excel**, not hand-written, as a permanent fixture.
- **Atomicity** — force a failure on the third chunk of a five-chunk import and assert the bank is
  byte-identical to before.
- **`claimUnused` over overlapping ids** — a single call for a set of ids that includes some
  already-claimed ones returns only the ids it actually won (a short return), and stamps
  `passages.used_in_quiz_id` for any passage whose questions were fully claimed. (Cross-request
  concurrency is not exercised here — concurrent admins locking overlapping quizzes doesn't
  happen in this deployment, COUNCIL_FINDINGS.md #4.)
- **A realistic seed bank** — MCQ, TITA, LaTeX, images, and passage groups — committed to the repo
  as a fixture. Every phase after this one is blocked without it.
