# claude-task--001: Harden the completed backend and ship admin report export

**Sprint:** 8  **Slug:** `backend-hardening-report-export`  **Status:** Draft

> Final backend packet. It consumes the completed Sprint 1–7 interfaces, adds the one remaining
> HTTP route, and produces the security, capacity, configuration, and end-to-end evidence needed
> by the launch gate.

---

## 1. Context

Sprint 8 owns the final tracker item: backend hardening and admin report export after Sprints 1–7
have implemented the complete module graph (`todos/PROGRESS.md:14-23`). The product requires an
admin report and a finished-system rerun of the 120-client workload; launch also requires a manual
CSV-to-results journey (`PRD.md:237-259`; `PRD.md:263-299`). Mobile-first UI is a later frontend
deliverable, so this packet creates no UI or mockup work (`MODULES.md:167-185`).

The report wire contract is already final. `GET /api/admin/quizzes/:id/report` takes
`AdminReportRequest`, returns JSON `AdminReportResponse`, requires admin access, and returns 423
until `board_computed_at` exists (`API.md:268-283`; `src/core/api.ts:432-466`). Its aggregates must
include participants with missing answer rows by joining the participant roster to quiz membership,
rather than grouping only stored answers (`QUIZZING.md:242-256`; `DATA_MODEL.md:108-120`). Sprint 5
reserved the report query in QUIZZING's `src/db/results.ts` and explicitly deferred the route to
Sprint 8 (`todos/sprint 5/claude-task--001--quiz-results-ranking-review.md:145-177`).

Hardening is a verification and targeted-fix pass over the assembled backend. The boundaries remain
binding: AUTH owns `users`; BANK owns question/passage/R2 writes; QUIZZING owns quiz/runtime/result
tables and board KV; TELEGRAM owns `telegram_posts`; SCHEDULER issues no SQL or KV (`MODULES.md:52-94`).
The active-unit payload and cache must remain structurally free of solutions, scores, and future
units (`src/core/contracts.ts:83-109`; `CONTRACTS.md:130-152`). Operational alerts have three
targeted sources: the two minute-tick checks (unclosed quiz and failed Telegram post) plus every safe
`MaterializationFailure` returned by the hourly materialization pass. Each alert is attempted
independently through the private Telegram chat and Cloudflare Email Routing; no other email provider
enters V1 (`MODULES.md:121-168`; `SCHEDULER.md:82-102`).

## 2. Objective

After this packet ships, an authenticated admin can fetch the exact paginated JSON report for a
completed quiz, while students and pre-publication callers cannot access it. The assembled backend
has executable route-guard, secrecy, error-redaction, configuration, end-to-end, and finished-system
capacity checks. A redacted launch-evidence record demonstrates the 120-client threshold and the
manual staging journey without storing credentials, answers, or private student data.

## 3. Assumptions

- Sprints 1–7 are implemented first; this packet consumes their mounted routes, D1 repositories,
  scheduler passes, Telegram adapter, and test fixtures rather than rebuilding them
  (`todos/PROGRESS.md:16-23`).
- The runtime is TypeScript/Hono on Cloudflare Workers with D1, R2, KV, Cron Triggers, Google
  authentication, and Telegram; core code stays platform-independent (`PLAN.md:47-70`).
- The initial schema is sufficient. Participants already store score/count/time/rank, answers store
  final outcomes, and participant-unit rows store close reason and elapsed time
  (`migrations/0001_init.sql:224-301`). No migration or derived report table is needed.
- Report pagination uses the shared defaults and validation: `limit=50`, `offset=0`, integer limit
  1..100, non-negative integer offset, 400 on invalid input, and exact filtered `total`
  (`API.md:24-46`; `src/core/api.ts:35-54`).
- Production binding IDs, a custom Cloudflare-managed domain, and verified destination addresses
  are environment-specific operator inputs supplied during staging/launch configuration. Their
  values are never committed to source or evidence (`wrangler.toml:14-30`; `wrangler.toml:43-59`).
- The Sprint 4 load harness is the canonical workload artifact and is extended in place for the
  finished backend; it already defines 120 authenticated clients, a 121st rejection, p50
  submit-and-advance measurement, invariant queries, and redacted output
  (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:261-266`).
- Sprint 7 implements the frozen `MaterializeResult = {quizIds, failures}` boundary. Each failure is
  exactly `{templateId, scheduledAt, code}` where `code` is `'pool_exhausted'` or
  `'missing_timing_configuration'`; no unsafe diagnostic field may be added
  (`src/core/contracts.ts:126-131`; `CONTRACTS.md:225-230`).
- The hourly weekly-publication recovery sweep remains bounded to the owner-accepted
  `WEEKLY_RETRY_LOOKBACK_WEEKS = 8`. Sprint 8 tests that limitation and does not add backlog
  discovery or indefinite recovery
  (`todos/sprint 7/claude-task--001--weekly-boards-recurring-materialization.md:162-174`).

## 4. Out of Scope

- **Frontend, mobile layout, and mockups:** NFR-5 is delivered after backend verification; this
  packet only proves API behavior and records the later UI obligation (`PRD.md:255`; `PRD.md:284`).
- **CSV, PDF, spreadsheet, or downloadable-file report formats:** the accepted export is the JSON
  `AdminReportRequest`/`AdminReportResponse` route; changing it would create an unapproved contract.
- **Full item analysis or live monitoring:** V1 includes the stated count aggregates only and gates
  the report on completed ranking (`API.md:274-283`; `QUIZZING.md:252-256`).
- **New observability systems:** request error-rate alerting, structured job-run records, and a
  dedicated monitoring service remain deferred; preserve the three targeted alert sources already
  defined across the minute and hourly passes (`MODULES.md:142-168`).
- **Unbounded weekly backlog recovery:** V1 retains Sprint 7's eight-week retry lookback; this packet
  does not add backlog discovery, indefinite catch-up, or new persistence for recovery state.
- **A third-party email service:** V1 uses only Cloudflare Email Routing's `ALERT_EMAIL` binding
  (`SCHEDULER.md:85-90`; `wrangler.toml:51-59`).
- **Schema, public contract, scoring, timing, ranking, or module-boundary revisions:** this is a
  consumer and hardening pass over accepted behavior, not a product redesign.
- **Production deployment itself:** the packet prepares and verifies a concrete candidate; an
  operator performs provider configuration and the live staging checks in AC-OPERATOR.

## 5. Open Questions / `<INPUT_REQUIRED>`

(none)

The report shape, access/publication gate, load threshold, launch journey, three targeted alert
sources, materialization failure DTO/codes, eight-week retry limitation, and alert transport are all
explicit in current authoritative sources. Account-specific IDs/addresses are operator inputs, not
unresolved product decisions.

## 6. Pre-flight Checklist

- [ ] Required skill loaded: **`clean-code`** — always required; keep report and hardening code small
      and explicit.
- [ ] Required skill loaded: **`prod-safety-gate`** — this packet touches a production admin route,
      every mounted route through security checks, external alerts, and launch configuration.
- [ ] Required skill loaded: **`test-driven-development`** — write each report/hardening regression
      test first and observe the intended failure.
- [ ] Required skill loaded: **`vibesec`** — the work covers session-gated/admin HTTP input, secrets,
      solution secrecy, logs, and provider bindings.
- [ ] Working tree is clean and the branch is current with trunk; retain the exact starting SHA in
      the launch-evidence record.
- [ ] Run `npm ci`, `npm run typecheck`, and `npm test`; repair no pre-existing failure under this
      packet without first proving it belongs to Sprint 8.
- [ ] Read `API.md:12-46`, `API.md:268-295`, `QUIZZING.md:242-270`,
      `MODULES.md:52-165`, `SCHEDULER.md:82-90`, `src/core/api.ts:432-466`, and
      `migrations/0001_init.sql:224-301` before editing.
- [ ] Inspect the implemented Sprint 1–7 app composition and tests. Confirm the report repository
      seam reserved by Sprint 5 and the load artifact created by Sprint 4 before extending either.
- [ ] Create an isolated local/staging dataset only. Never use a production question bank, real
      session cookies, bot token, email address, or answer content as a committed fixture.
- [ ] Re-read AC-1 through AC-18 and AC-OPERATOR; distinguish implementer-run checks from provider
      console and real-device operator checks.

## 7. Acceptance Criteria

1. **AC-1 — Query the participant report completely and deterministically.** For a quiz whose board
   is published, return one row per participant with exact `userId`, name, seat number, total score,
   correct/wrong/skipped/unanswered counts, summed reached-unit time, and rank. Page by stable
   rank/seat/user ordering, apply the shared pagination rules, and return an exact full participant
   total. Do not derive counts again from answers when the atomically finalized participant totals
   already own them (`src/core/api.ts:436-447`; `migrations/0001_init.sql:226-243`).
2. **AC-2 — Derive every question aggregate over the full room.** Return every quiz question in
   flat position/unit/subposition order with correct, wrong, skipped, and unanswered counts. Build
   from `participants × quiz_questions` and left-join final answers so explicit `unanswered`, absent
   timeout rows, and unreached questions all land in `unansweredCount`; for every question the four
   counts sum to the report participant count (`src/core/api.ts:449-458`;
   `DATA_MODEL.md:116-120`; `migrations/0001_init.sql:274-301`).
3. **AC-3 — Derive unit aggregates once per timed unit.** Return every quiz unit in unit-position
   order with `completedCount`, `timedOutCount`, and `avgElapsedMs`. Counts include reached finalized
   participant-unit rows only, never unreached participants; the average is over reached finalized
   rows and is null when none exist (`src/core/api.ts:460-466`; `DATA_MODEL.md:116-118`).
4. **AC-4 — Serve the exact report route and contract.** Mount `GET
   /api/admin/quizzes/:id/report` under the shared admin guard. Parse only `AdminReportRequest`,
   reject invalid pagination with 400, return 404 for an unknown quiz, 423 until
   `board_computed_at` is set, and serialize exactly `AdminReportResponse` without an envelope.
   A student or signed-out caller receives the established generic 403/401 response and no report
   data (`API.md:12-23`; `API.md:268-277`; `src/core/api.ts:460-466`).
5. **AC-5 — Keep report reads in QUIZZING ownership.** Implement report SQL beside existing result
   reads in `src/db/results.ts`; the thin route validates, authorizes, invokes the use case/repository,
   and serializes. SCHEDULER, AUTH, BANK, and TELEGRAM neither query nor write report data. Use only
   parameterized values and fixed allowlisted ordering branches (`MODULES.md:56-77`;
   `QUIZZING.md:258-270`).
6. **AC-6 — Prove route authorization across the complete 29-route inventory.** Add a table-driven
   test that enumerates every documented route/method and asserts its signed-out, student, admin,
   superadmin, participant/nonparticipant boundary as applicable. The mounted route inventory must
   contain exactly the documented 29 routes, including one report route, with no unguarded aliases
   or debug/test endpoints (`API.md:50-58`; `API.md:66-83`; `API.md:127-172`;
   `API.md:216-223`; `API.md:287-292`).
7. **AC-7 — Prove unpublished solution and score secrecy globally.** Exercise every student-visible
   run/status/history/results route and inspect raw response JSON plus `unit:*` cache JSON. Before
   `board_computed_at`, no response/cache/log contains correct options, numeric solutions/tolerance,
   explanations, answer correctness/marks, active totals, rank, board data, future-unit content, or
   database row spill. After publication, solution fields appear only on the participant-only review
   route; a nonparticipant still gets 403 (`PRD.md:186-205`; `CONTRACTS.md:135-152`;
   `src/core/api.ts:344-408`).
8. **AC-8 — Harden API response and failure handling.** All `/api/*` responses set
   `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; the same-origin Worker does not
   emit a permissive wildcard credentialed CORS policy. Unexpected errors return only
   `{message:string}` with no stack, SQL/provider detail, environment value, token, cookie, answer,
   or email/chat identifier. Preserve the existing binary image content type and `nosniff`
   requirement (`PLAN.md:72-77`; `API.md:12-23`; `API.md:83-90`).
9. **AC-9 — Validate configuration without logging secrets.** Centralize a fail-closed production
   configuration check for required D1/KV/R2 bindings, Google client ID, session-signing secret,
   superadmin email, enabled Telegram token/student chat/private alert chat, and the
   `ALERT_EMAIL` send-email binding plus verified alert destination. Empty placeholders are rejected
   before a request/job performs business writes or sends. Errors name only the missing binding/var,
   never its value (`wrangler.toml:14-30`; `wrangler.toml:43-59`; `MODULES.md:130-140`).
10. **AC-10 — Preserve all three targeted alert sources across both private channels.** The
    hardening suite forces (a) an unclosed quiz at `safeCloseAt + 180000`, (b) a failed Telegram post,
    and (c) hourly recurring occurrences that return each exact materialization failure code. For
    every `MaterializationFailure`, SCHEDULER attempts Telegram-alert-chat and Cloudflare
    `ALERT_EMAIL` delivery independently using only `templateId`, `scheduledAt`, and code
    `'pool_exhausted' | 'missing_timing_configuration'`. One channel, failed occurrence, healthy
    sibling, or weekly-retry pass failure cannot block the others; materialization state never
    depends on alert success; a later hourly retry may alert again. The two minute-tick sources may
    likewise repeat each minute while eligible (`src/core/contracts.ts:126-131`;
    `SCHEDULER.md:85-102`; `MODULES.md:130-158`).
11. **AC-11 — Audit external-input and persistence boundaries.** Regression tests cover exact-body
    allowlists, malformed/fractional/out-of-range query/path values, upload byte/type limits, forged
    sessions, changed submission retries, and unsupported recurrence syntax. Static checks and review
    confirm every SQL value is bound, R2 keys are generated/validated, and no module writes a table or
    KV key owned by another module (`MODULES.md:52-94`; `src/core/contracts.ts:18-23`;
    `src/core/contracts.ts:63-69`; `src/core/contracts.ts:140-180`).
12. **AC-12 — Re-run the 120-client workload against the finished backend.** Extend the Sprint 4
    harness to run with all Sprint 1–7 routes and scheduled composition enabled: 120 distinct
    authenticated users join one 120-seat mixed-unit quiz, resume/retry, submit all units, cross safe
    close, then read leaderboard/review and one admin report; a 121st distinct user is rejected.
    Require median unit-submit-and-advance round trip below 500 ms, zero failed accepted-client
    requests, unique seats/receipts, exact participant/count/rank/report invariants, and no partial
    board visibility (`PRD.md:247-258`; `QUIZZING.md:289-303`).
13. **AC-13 — Measure the finished workload honestly.** Exclude fixture creation and browser-local
    navigation from latency, but include authentication, join, current/resume, unit submission,
    safe close, and result/report requests in request/resource totals. Emit a machine-readable,
    redacted summary containing commit SHA, environment label, client/unit/question counts, request
    counts, p50 submit latency, error counts, D1 write/read observations, KV/R2 observations, and
    threshold pass/fail; exit nonzero on any failed threshold/invariant. Store no cookie, token,
    answer, question body, name, email, or chat ID (`PLAN.md:239-254`; `PRD.md:294-299`).
14. **AC-14 — Add an API-driven backend launch journey.** In an isolated environment, automate CSV
    preview/commit, mixed-unit draft/create/configure/lock, scheduled preparation and announcements,
    three authenticated participant runs including skip/timeout/retry, safe close, atomic result
    unlock, weekly computation, recurring materialization, and admin report retrieval. Force one
    pool-exhausted and one missing-timing occurrence and assert their exact safe result entries and
    independent dual-channel alert attempts without blocking healthy siblings or the weekly retry
    pass. Assert exact route/contracts and the retained eight-week weekly lookback; use fake
    Telegram/email adapters in automated runs, leaving real delivery to AC-OPERATOR
    (`PLAN.md:228-238`; `PRD.md:297-299`).
15. **AC-15 — Make deploy configuration reviewable.** Replace provisioned D1/KV placeholder IDs in
    the deploy target, populate non-secret production vars, enable the `ALERT_EMAIL` binding only
    after the custom domain/destination prerequisite is met, and keep all secret values in Wrangler
    secrets. `wrangler deploy --dry-run` must resolve every binding and all three cron expressions;
    no secret literal or environment-specific credential enters the repository
    (`wrangler.toml:14-59`; `SCHEDULER.md:35-40`).
16. **AC-16 — Record redacted launch evidence.** Add a concise evidence document with date, commit,
    environment, automated commands/results, the load summary path, manual journey checklist,
    provider/binding checks, all three alert-source checks, both materialization failure codes,
    failure/isolation checks, the retained eight-week recovery limitation, and remaining limitations.
    Link opaque artifact paths or IDs only; never paste API bodies containing content, participant
    identities, session material, or provider credentials (`PRD.md:294-299`;
    `MODULES.md:126-158`).
17. **AC-17 — Prove behavior test-first and keep accepted contracts frozen.** Observe focused RED
    failures before report/hardening production edits, then make the smallest changes that pass. The
    implementation does not modify `migrations/0001_init.sql`, `src/core/contracts.ts`, or
    `src/core/api.ts`; does not add a report format; and preserves every Sprint 1–7 focused test.
18. **AC-18 — Keep frontend work absent.** No `web/`, `mockups/`, `design-system/`, UI asset, or
    browser implementation changes enter the diff. Backend Chrome/UI QA remains N/A until the later
    frontend integration (`PRD.md:263-284`; `MODULES.md:167-185`).
19. **AC-OPERATOR — Complete the staging launch gate.** On the provisioned custom-domain staging
    Worker, an operator configures D1/KV/R2, required Wrangler secrets, Telegram student/private
    chats, and Cloudflare Email Routing; runs the finished 120-client harness; then performs the
    documented CSV → scheduled quiz → test-group bot posts → three real phones → unattended run →
    deadline → leaderboard/review/admin-report journey. Force one Telegram failure and one delayed
    close plus both materialization failure codes to prove all three alert sources and both private
    channels, including per-channel/per-occurrence isolation and allowed repeated hourly alerts.
    Record only redacted counts, timings, statuses, commit/environment identifiers, and pass/fail
    evidence (`PRD.md:294-299`; `src/core/contracts.ts:126-131`; `wrangler.toml:43-59`).

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not edit `migrations/0001_init.sql`, `src/core/contracts.ts`, `src/core/api.ts`, or any current
  requirement/module document; the schema and wire contracts are frozen for this packet.
- Do not add CSV/PDF/spreadsheet output, report persistence, a report cache, live/partial admin
  results, full item analysis, or a new endpoint.
- Do not expose the report to student-role callers or to any admin before `board_computed_at`; an
  authorized admin need not be a quiz participant. Do not weaken the shared admin route guard for
  convenience in tests.
- Do not compute question aggregates by grouping `answers` alone. Missing rows must remain visible
  through participant/question membership.
- Do not log or commit tokens, cookies, email/chat identifiers, answer values, question/solution
  content, full provider errors, SQL text with bound values, or real student identities.
- Do not introduce a third-party email dependency or make either alert channel control quiz state.
- Do not add fields/codes to `MaterializationFailure`, edit `MaterializeResult`, persist alert dedup
  state, or suppress an otherwise eligible repeated hourly materialization-failure alert.
- Do not widen the accepted eight-week weekly retry lookback or add backlog discovery/indefinite
  recovery in this hardening packet.
- Do not let SCHEDULER issue SQL/KV, let the report route reach across module repositories, or move
  table/key ownership.
- Do not change timing, scoring, dense ranking, weekly totals, the five-second transport window, or
  the 120-seat product cap while tuning the harness.
- Do not edit any frontend, mockup, design-system, or historical packet file.

### 8b. Coding / quality principles

- **`clean-code`:** keep the route thin; give participant/question/unit report queries separate
  expressive functions; use named limits/header constants and early-return validation; do not add a
  generic reporting framework for this one route.
- **`prod-safety-gate`:** the production surfaces are the admin route, D1 aggregate reads, global
  middleware, three alert sources across minute/hourly cron wiring, Worker bindings, and load run.
  Each needs a visible success check, failure signal, and reversible deploy step before launch.
- **`test-driven-development`:** begin with report gate/aggregate failures and security-boundary
  tests, observe each intended RED, implement minimally, then run every prior sprint test before the
  staging workload.
- **`vibesec`:** authorize before database reads; allowlist request/response fields; bind all SQL
  values; reject malformed input; fail closed on absent configuration; redact errors/evidence; scan
  raw serialized payloads rather than relying on TypeScript types to strip extra keys.
- Mirror the existing direct-payload/error conventions exactly (`API.md:12-23`) and map database
  snake_case to the accepted camelCase DTO only inside QUIZZING persistence (`CONTRACTS.md:295-300`).
- Treat D1 as authoritative. Report correctness and release gates cannot depend on eventually
  consistent KV (`PLAN.md:92-94`).

## 9. Behavior Spec (per file)

### `src/db/results.ts`

- **Current state (line 1 and Sprint 5 handoff):** the stub assigns report queries to QUIZZING, while
  Sprint 5 implements result settlement/review/history and intentionally leaves admin report queries
  for this packet (`src/db/results.ts:1`;
  `todos/sprint 5/claude-task--001--quiz-results-ranking-review.md:145-156`).
- **Required edit:** add a publication-gated report read that loads the paginated participant page
  and exact total, all question aggregates, and all unit aggregates per AC-1–AC-3 using bound quiz ID
  and pagination values.
- **Estimated diff:** ~85 LOC across three focused query/mapping helpers.
- **Subtleties:** read the completed snapshot consistently; use roster/membership left joins for
  absent answers; no writes, regrading, cache, or N+1 per participant/question query.

### `src/routes/reports.ts`

- **Current state (line 1):** the route is an ownership comment naming the accepted report fields and
  excluding bonuses/per-question durations (`src/routes/reports.ts:1`).
- **Required edit:** implement the single Hono GET handler per AC-4 with exact pagination parsing,
  admin authorization, 404/423 gates, QUIZZING report invocation, direct DTO serialization, and
  generic errors.
- **Estimated diff:** ~45 LOC.
- **Subtleties:** check authorization before returning quiz/report state; do not reuse participant-only
  review authorization or expose a pre-publication partial result.

### `src/middleware/security.ts` (new)

- **Current state:** no shared API hardening middleware exists in the repository; Sprint 1 provides
  the generic error handler and route guards through `src/index.ts`
  (`todos/sprint 1/claude-task--001--google-auth-roles-guards.md:181-187`).
- **Required edit:** add small middleware/helpers for AC-8's API response headers and redacted
  unexpected-error mapping, composed with the existing AUTH/error path rather than replacing it.
- **Estimated diff:** ~35 LOC.
- **Subtleties:** preserve binary image responses and ordinary status codes; do not add wildcard
  credentialed CORS or a browser CSP policy before the frontend exists.

### `src/core/config.ts`

- **Current state (line 1):** earlier packets extend this shared file with Worker bindings and named
  limits; the repository stub records the V1 runtime constants (`src/core/config.ts:1`).
- **Required edit:** add a pure, testable production-configuration assertion used by composition,
  covering AC-9 without returning or logging values. Preserve every existing binding and constant.
- **Estimated diff:** ~35 LOC.
- **Subtleties:** distinguish disabled Telegram in local tests from enabled production requirements;
  never add a fallback signing key, email provider, destination, chat ID, or account identifier.

### `src/index.ts`

- **Current state (line 1):** this file owns all Hono mounting and scheduled orchestration
  (`src/index.ts:1`); Sprints 1–7 populate those seams.
- **Required edit:** mount the report route at exactly `/api/admin/quizzes/:id/report`, compose the
  security middleware/config assertion, and preserve all existing routes, cron dispatch, and module
  injections.
- **Estimated diff:** ~20 LOC.
- **Subtleties:** broad admin middleware must cover the report exactly once; the config check must not
  break injected local test environments or run after a business write has begun. Preserve Sprint
  7's hourly materialization-result handoff to the existing dual-channel alert sender and its
  independent weekly-retry pass.

### `src/services/scheduler.ts`

- **Current state:** Sprint 7 consumes `MaterializeResult.failures` after the hourly materialization
  call and independently attempts both alert channels for every returned failure
  (`todos/sprint 7/claude-task--001--weekly-boards-recurring-materialization.md:644-660`).
- **Required edit:** no redesign is planned. During hardening, preserve the exact frozen DTO/codes,
  per-failure/per-channel isolation, healthy-sibling and weekly-pass isolation, and allowed hourly
  repetition from AC-10; make only the smallest test-proven correction if the implemented handoff
  violates one of those invariants.
- **Estimated diff:** 0 LOC expected; bounded corrective diff only if a RED regression test proves a
  mismatch.
- **Subtleties:** do not query storage, reconstruct failures from logs/exceptions, add dedup state, or
  change the eight-week weekly retry horizon. `materializeTemplates` returns the safe DTO; SCHEDULER
  only forwards its allowlisted fields to the alert sender.

### `wrangler.toml`

- **Current state (lines 14–59):** D1/KV identifiers and production vars are placeholders and the
  Cloudflare `ALERT_EMAIL` binding is commented pending a custom domain and verified destination
  (`wrangler.toml:14-59`).
- **Required edit:** complete the selected deployment target's non-secret binding identifiers/vars
  and enable the Cloudflare send-email binding after operator provisioning. Keep tokens and signing
  material in Wrangler secrets and preserve the three existing cron expressions.
- **Estimated diff:** ~8 LOC, using account-specific non-secret identifiers supplied at rollout.
- **Subtleties:** do not commit secret values or select another email transport. If the repository is
  intended to retain placeholders as its reusable template, place provisioned values in a Wrangler
  environment-specific config ignored by version control and document the exact operator command;
  the checked-in template must still pass static shape validation.

### `tests/reports.routes.test.ts` (new)

- **Current state:** no report implementation test exists; the route is reserved by its stub and wire
  types (`src/routes/reports.ts:1`; `src/core/api.ts:432-466`).
- **Required edit:** test AC-1–AC-5 through the mounted Worker using isolated migrated D1: auth/role,
  404/423, pagination defaults/bounds, deterministic pages, zero participants, missing-answer and
  unreached cases, count conservation, timing averages, direct exact response keys, and no writes.
- **Estimated diff:** ~120 LOC plus focused fixture helpers.
- **Subtleties:** seed controls that would fail an answers-only aggregate; assert raw JSON and D1
  query invariants, not repository mocks.

### `tests/backend-security.test.ts` (new)

- **Current state:** earlier sprint tests cover their own guards/secrecy; no final cross-route audit
  exists (`PLAN.md:271-278`).
- **Required edit:** implement AC-6–AC-11 as table-driven mounted-Worker tests and static ownership /
  forbidden-pattern checks, including raw cache/HTTP/log artifact scans and all three alert sources.
  Cover both exact materialization codes, three-field allowlisting, per-channel/per-occurrence/sibling/
  weekly-pass isolation, and allowed repetition on a later hourly retry.
- **Estimated diff:** ~140 LOC split into route-matrix, secrecy, error/header, config, and ownership
  describes.
- **Subtleties:** use adversarial fixtures and injected edge adapters; never make Google, Telegram, or
  email network calls or record their secrets.

### `tests/load/quiz-run.load.test.ts`

- **Current state:** Sprint 4 creates the canonical 120-client mixed-unit harness and machine-readable
  summary (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:261-266`).
- **Required edit:** extend it for AC-12–AC-13 so it runs against all completed modules, closes and
  publishes results, verifies participant/review/report invariants, and emits the redacted finished
  system summary with a nonzero failure exit.
- **Estimated diff:** ~70 LOC plus small shared fixture updates.
- **Subtleties:** keep the same p50 definition for comparison with Phase 4; do not lower the threshold,
  omit failed requests, or put setup time into the measured submission sample.

### `tests/e2e/backend-launch.test.ts` (new)

- **Current state:** the architecture requires API-driven end-to-end backend journeys before frontend
  integration, but no final cross-module journey artifact exists (`PLAN.md:271-278`).
- **Required edit:** implement AC-14 with isolated D1/KV/R2 and fake Google/Telegram/email edges,
  including both materialization failure codes, healthy sibling continuation, weekly-pass
  continuation, failure/retry branches, the eight-week lookback boundary, and exact response
  snapshots free of secrets/solutions before publication.
- **Estimated diff:** ~120 LOC plus reusable non-production fixture builders.
- **Subtleties:** drive public APIs and scheduled entrypoints; use direct storage reads only to prove
  atomicity/ownership, never as a substitute for a route assertion.

### `tests/scheduler-materialize-weekly.test.ts`

- **Current state:** Sprint 7 creates this suite for hourly materialization, weekly dispatch, and the
  materialization-failure alert handoff
  (`todos/sprint 7/claude-task--001--weekly-boards-recurring-materialization.md:685-695`).
- **Required edit:** retain its focused tests and add any missing composed-scheduler cases needed by
  AC-10: exact `{templateId,scheduledAt,code}` for both codes; independent Telegram/email attempts;
  one channel/occurrence/sibling/weekly-pass failure not blocking any other; and allowed repeat alerts
  on a later hourly run. Keep the weekly retry sweep capped at eight weeks.
- **Estimated diff:** ~35 LOC if Sprint 7's implementation does not already cover every case.
- **Subtleties:** fake the alert edges; never call real providers, infer unsafe detail from thrown
  errors, or test implementation-private loop structure.

### `docs/launch-evidence.md` (new)

- **Current state:** the launch gate is defined in the PRD, but the repository has no evidence record
  for the finished backend (`PRD.md:294-299`).
- **Required edit:** add AC-16's concise checklist/result template and fill implementer-run fields;
  leave provider/real-phone rows explicitly pending until AC-OPERATOR runs them.
- **Estimated diff:** ~60 LOC.
- **Subtleties:** link redacted artifacts; record failures honestly; do not paste request/response
  bodies or environment values. This is evidence, not a second requirements document.

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Answers-only grouping undercounts timeout/unreached responses | Med | High | AC-2 roster/question left joins plus conservation tests. |
| A broad admin mount leaves report unguarded or lets students read it | Low | High | AC-4/AC-6 mounted route matrix. |
| Report leaks partial results before atomic publication | Med | High | AC-4 exact 423 gate and pre/post-publication tests. |
| Hardening middleware changes binary images or valid error statuses | Med | Med | AC-8 image and status regression cases. |
| A raw database object leaks solutions/secrets through JSON or logs | Med | High | AC-7/AC-8 raw-key scans and explicit DTO construction. |
| Config fallback allows a deploy with blank IDs or weak secrets | Med | High | AC-9 fail-closed assertion and dry-run/operator checks. |
| Alert email silently changes provider or one channel suppresses another | Low | High | AC-10 exact Cloudflare binding and independent-failure tests across all three sources. |
| Hourly materialization drops a failure, maps the wrong code, or leaks exception details | Med | High | AC-10 exact frozen DTO/codes, allowlisted alert content, and focused scheduler/e2e tests. |
| One failed alert/occurrence blocks a healthy sibling or the weekly retry pass | Med | High | AC-10/AC-14 force per-channel/per-occurrence/pass isolation. |
| Hardening adds dedup/backlog state or widens the owner-accepted eight-week recovery horizon | Low | Med | Explicit assumption/out-of-scope/Hard NO plus scheduler boundary tests. |
| Security sweep violates one-writer module ownership | Low | High | AC-5/AC-11 static import/write checks and hard NOs. |
| Finished load test passes by excluding errors or changing latency semantics | Med | High | AC-12/AC-13 fixed workload, invariant checks, machine-readable nonzero exit. |
| Load/e2e fixtures retain PII, answers, or credentials | Med | High | Synthetic users/content, redacted artifacts, and forbidden-string scan. |
| Test state or cron work leaks between cases | Med | Med | Fresh migrated D1/KV/R2 fixtures and deterministic injected clocks. |
| Provider/domain configuration is incomplete at launch | Med | High | AC-15 plus AC-OPERATOR provider and dual-channel checks. |
| A later UI task is accidentally pulled into backend hardening | Low | Med | AC-18 protected-path checks and N/A frontend QA. |
| Evidence says “pass” while operator-only checks remain pending | Med | High | AC-16 explicit status per row and DoD requires AC-OPERATOR completion/waiver. |

## 11. Rollback / Revert Plan

1. If the report or hardening path harms production, stop the candidate deploy and run
   `git revert <sha>` for this packet, then redeploy the last known-good Sprint 7 Worker. This packet
   changes no schema and its report path performs reads only (`migrations/0001_init.sql:224-339`).
2. Restore the previous Worker binding configuration for D1/KV/R2/cron. If `ALERT_EMAIL` was newly
   enabled, leave Cloudflare Email Routing configured but detach the Worker binding only if it causes
   the failure; keep Telegram private alerts active when healthy (`wrangler.toml:14-59`).
3. Restart/redeploy the Worker and scheduled handler, then run the prior Sprint 1–7 focused suites
   and a read-only smoke check of authentication, one open quiz, one result route, one weekly board,
   the minute tick, and one hourly materialization call returning a safe failure.
4. Verify `GET /api/admin/quizzes/:id/report` is absent or back to its pre-Sprint-8 stub behavior,
   while leaderboard/review/weekly endpoints and all cron passes retain their previously shipped
   behavior. Confirm no data cleanup or rank recomputation occurred.
5. Preserve load/evidence artifacts as redacted incident evidence; mark the failed run invalid rather
   than editing it into a pass. Delete any accidentally captured secret/PII artifact immediately and
   rotate the affected credential through its provider.
6. Notify the project owner through the configured private channel with commit/environment, failure
   stage, opaque quiz/template ID, candidate scheduled time, safe failure code, affected routes/jobs,
   and rollback result. Include no student identity, content, token, chat/email value, or provider
   error body.
7. Fix forward in staging, rerun focused/full tests, the 120-client harness, configuration dry run,
   and the complete operator journey before deploying the report/hardening commit again.

## 12. Verification + Definition of Done

### 12a. Automated verification

```bash
npm ci
npm run typecheck
npm test -- tests/reports.routes.test.ts
npm test -- tests/backend-security.test.ts
npm test -- tests/scheduler-materialize-weekly.test.ts
npm test -- tests/e2e/backend-launch.test.ts
npm test -- tests/load/quiz-run.load.test.ts
npm test
npx wrangler deploy --dry-run

python3 .claude/skills/quizzer-backend-spec/scripts/validate_packets.py

git diff --exit-code -- migrations/0001_init.sql src/core/contracts.ts src/core/api.ts
git diff --exit-code -- PRD.md PLAN.md MODULES.md DATA_MODEL.md CONTRACTS.md API.md QUIZZING.md SCHEDULER.md TELEGRAM.md
git diff --exit-code -- web mockups design-system

! rg -n "correctOption|numericAnswer|numericTolerance|explanationMd|Set-Cookie|Authorization" \
  tests/artifacts/unpublished-runtime-http.json tests/artifacts/unit-cache.json tests/artifacts/finished-system-load.json
! rg -n "totalScore|rank" \
  tests/artifacts/unpublished-runtime-http.json tests/artifacts/unit-cache.json
! rg -n "TELEGRAM_BOT_TOKEN|SESSION_SIGNING_KEY|BEGIN (RSA |EC )?PRIVATE KEY|Bearer [A-Za-z0-9._-]+" \
  tests/artifacts docs/launch-evidence.md
```

All commands must succeed. The load test exits nonzero unless AC-12/AC-13 pass. Generate the named
redacted artifacts as part of the relevant tests so the negative scans never succeed vacuously.
`wrangler deploy --dry-run` uses the selected non-production/production target without printing
secret values.

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | Report access and gate | Call the report signed out, as student, admin before publication, and admin after publication. | 401, 403, 423, then exact 200 JSON; no partial data. | Not Run |
| BE-2 | Participant pagination | Seed more than 50 ranked participants; request defaults, page 2, and invalid bounds. | Stable pages, exact total/limit/offset; invalid input is 400 without clamping. | Not Run |
| BE-3 | Question conservation | Seed answered, skipped, server-expired-without-answer-row, and unreached cases. | Every question's four counts equal participant count; nobody disappears. | Not Run |
| BE-4 | Unit aggregates | Seed completed, timed-out, and unreached unit membership. | Counts/average include reached finalized rows only; empty unit average is null. | Not Run |
| BE-5 | Route guard inventory | Run the 29-route role/participant matrix. | Every documented route exists once and has its exact guard; no debug alias exists. | Not Run |
| BE-6 | Secrecy and redaction | Exercise run/status/history/results before/after publication; inspect raw HTTP/cache/log artifacts. | No early solution/score/rank leak; review unlocks only for participants after publication. | Not Run |
| BE-7 | Error/header hardening | Force validation, D1, KV, R2, Telegram, and email failures. | Generic JSON errors and API no-store/nosniff headers; no secret/provider/SQL spill. | Not Run |
| BE-8 | Configuration failure | Remove each required production binding/var in isolation. | Startup/composition fails before writes/sends and names only the missing key. | Not Run |
| BE-9 | Finished 120-client run | Run the extended harness including safe close, review, and report. | 120 succeed, 121st rejected, p50 <500 ms, all final invariants pass. | Not Run |
| BE-10 | API-driven launch journey | Run the isolated CSV-through-report scenario with fake provider edges. | Every cross-module step completes unattended and exact contracts remain intact. | Not Run |
| BE-11 | Materialization alert contract | Return healthy occurrences plus both failure codes; fail each alert channel/occurrence and the weekly pass in turn; rerun hourly. | Exact three-field failures; both channels attempted independently; siblings/passes continue; repeat alerts are allowed. | Not Run |

#### Frontend / UI

N/A — this backend packet creates no frontend or visual files. If a `web/`, mockup, design-system,
or UI asset change enters the implementation, fail the packet and add UI acceptance/QA first.

#### Chrome DevTools / extension verification

N/A — there is no browser client in this packet. HTTP headers and wire payloads are verified through
mounted-Worker tests and curl/operator checks; browser DevTools work belongs to frontend integration.

#### Operator-executed (post-cutover, see AC-OPERATOR)

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| OP-1 | Binding and secret readiness | Provision staging D1/KV/R2/custom domain, secrets, Telegram chats, verified Email Routing destination; run dry-run/config checks. | Every required binding resolves; no placeholder/secret is committed or printed. | Not Run |
| OP-2 | Real dual-channel alerts | Force delayed close, failed-post, pool-exhausted, and missing-timing conditions, including one-channel/occurrence failures and a repeated hourly run. | All three alert sources reach both private channels with safe content; each attempt is isolated; healthy siblings, weekly retry, and gameplay/close continue. | Not Run |
| OP-3 | Staging capacity rerun | Execute the finished-system harness against staging. | 120-client invariants and p50 threshold pass; 121st is rejected. | Not Run |
| OP-4 | Three-phone launch journey | Perform CSV → quiz → test-group posts → three phones → unattended close → leaderboard/review/report. | The full launch gate passes with correct secrecy and publication timing. | Not Run |
| OP-5 | Evidence review | Review and sign `docs/launch-evidence.md` against generated artifacts and the deployed commit. | Every row is Pass or explicitly waived with reason; no sensitive data is present. | Not Run |

### 12c. Definition of Done

- [ ] AC-1 through AC-18 are satisfied.
- [ ] AC-OPERATOR is completed or explicitly waived and recorded in §5 and launch evidence.
- [ ] No `<INPUT_REQUIRED>` remains in §5.
- [ ] Focused RED failures were observed before production edits; §12a and the full Sprint 1–8 test
      corpus pass locally and in CI.
- [ ] BE-1 through BE-11 have Status other than `Not Run` (target: `Pass`).
- [ ] Frontend and Chrome remain correctly N/A with no frontend/visual diff.
- [ ] OP-1 through OP-5 have Status other than `Not Run` (target: `Pass`) or an explicit recorded
      operator waiver.
- [ ] Finished-system load output proves 120 clients, 121st rejection, p50 <500 ms, zero accepted
      request failures, exact final aggregates/ranks/report, and no partial publication.
- [ ] Both `MaterializationFailure` codes are returned with exactly `templateId`, `scheduledAt`, and
      `code`; every failure gets independent Telegram/Cloudflare alert attempts; channel/occurrence/
      sibling/weekly-pass isolation and allowed hourly repetition are proven.
- [ ] The weekly retry sweep remains capped at the accepted eight-week lookback; no backlog discovery,
      indefinite recovery, or new dedup persistence was added.
- [ ] `docs/launch-evidence.md` identifies the tested commit/environment and contains no secret, PII,
      question, solution, or answer material.
- [ ] The schema/current contract types and every product/module document remain byte-for-byte
      unchanged; no new route/report format/module writer was introduced.
- [ ] The Hard NO list is respected and §11 rollback has been rehearsed for route, middleware,
      binding, alert, capacity, and evidence failures.

---

End of Codex Task Packet — `claude-task--001`
