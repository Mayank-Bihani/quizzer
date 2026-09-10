# claude-task--001: Implement the Telegram module — six post kinds, claim-then-send

**Sprint:** 6  **Slug:** `telegram-six-post-kinds`  **Status:** Draft

> Implements `TELEGRAM — six post kinds, unit timing summaries and claim-then-send behavior` per the active tracker (`todos/PROGRESS.md:14`). Consumes Sprint 4's `listFailedPosts` boundary, Sprint 5's committed `CloseResult`, and the newly landed `listDueAnnounce` discovery method (`src/core/contracts.ts:145-146,174-175`; `CONTRACTS.md:176-193`; `SCHEDULER.md:47,50-52`) that resolves this packet's original OQ-1, and hands Sprint 7 a typed-but-unwired weekly send pass, mirroring the Sprint 4→5 close-pass handoff.

---

## 1. Context

Sprint 6 owns the module the active tracker names: the six outbound post kinds, unit timing summaries in the render layer, and claim-then-send idempotency (`todos/PROGRESS.md:14`). The requirement/phase mapping assigns TG-1..8 to Phase 6 (`PRD.md:221-235`, `PRD.md:277`), and `MODULES.md` scopes Phase 6 to exactly "the six post kinds, idempotent" (`MODULES.md:206`).

TELEGRAM is an **outbound-only announcement channel** with no inbound webhook, no command surface, and no play logic (`TELEGRAM.md:13-27`). It is called by exactly one caller — SCHEDULER — through one function, keeping `telegram_posts` at one writer (`CONTRACTS.md:233-246`; `MODULES.md:64`, `MODULES.md:100-103`). "Nothing points back up": TELEGRAM never calls QUIZZING, and QUIZZING never calls TELEGRAM directly (`MODULES.md:42-43`).

**Idempotency is two-step, not one insert.** `message_id`/`sent_at` are unknown until after the Bot API call succeeds, so the schema makes them nullable and the module claims first (`status='pending'`), then updates to `'sent'`/`'failed'` after calling the Bot API (`TELEGRAM.md:186-216`; `migrations/0001_init.sql:322-339`). The `telegram_posts` table has **no synthetic primary key** — its two `UNIQUE` constraints, `(quiz_id, kind)` and `(week_start, kind)`, are the only identity, and because SQL `NULL` is never equal to `NULL`, each constraint is only load-bearing for the rows where its own column is populated: `(quiz_id, kind)` dedups per-quiz posts (`week_start` is always `NULL` there), and `(week_start, kind)` dedups the weekly post (`quiz_id` is always `NULL` there) (`migrations/0001_init.sql:326-339`).

**The weekly post is one claim row producing four messages.** `TELEGRAM.md:105-114` requires "one message per section and overall (four messages), orchestrated under the existing weekly claim" — i.e. a single `telegram_posts` row (`kind='weekly'`, one `week_start`) gates four separate `sendMessage` calls, not four rows. The `message_id` `TEXT` column must therefore hold something other than one Telegram message ID for this kind; §9 below specifies a keyed JSON encoding, since the schema is otherwise silent on this (`migrations/0001_init.sql:333`).

**Six render functions, pure.** `renderQuizAnnounce`/`renderStartingSoon`/`renderRoomOpen`/`renderQuizResult`/`renderWeeklyBoards`/`renderCancelled` take a plain data object and return text, no network/DB, unit-tested against golden strings (`TELEGRAM.md:57-75`, `TELEGRAM.md:258-266`). `QuizAnnouncePayload` already carries `scheduledAt`, `endsAt`, `questionCount`, `unitCount`, `windowSec`, a `timingSummary` array (`kind`, `count`, `minTimeSec`, `maxTimeSec`), and optional `roomCode` (`src/core/contracts.ts:164-172`; `CONTRACTS.md:256-259`). There is no uniform per-question time, no bonus, and no scoring-grace field left in this payload (`TELEGRAM.md:268-279`).

**The indirect-payload contract.** `CloseResult` (TG-4), `BoardSummary[]` (TG-5) and `CancelledPayload` (cancelled) are all produced by QUIZZING and forwarded by SCHEDULER — never called or read from TELEGRAM (`CONTRACTS.md:261-271`). Both `CloseResult` (`src/core/contracts.ts:120-124`) and `BoardSummary`/`WeeklyBoardRow` (`src/core/contracts.ts:127-138`) already exist and are unchanged by this packet.

**Cancellation's silent/notify split lives on TELEGRAM's own data.** `TELEGRAM.md:249-256` resolves: if TG-3 ("open") already posted for a quiz, a cancellation notifies the group; if it never went live, cancelling is silent. That fact — whether an `'open'` row for this `quiz_id` reached `status='sent'` — is entirely inside `telegram_posts`, which only TELEGRAM reads/writes (`MODULES.md:64`), so this check needs no new cross-module call. The same resolution says the cancel route hands `CancelledPayload` to SCHEDULER "the same way `closeQuiz`'s result is forwarded for TG-4," explicitly *not* a direct QUIZZING→TELEGRAM call.

**TG-4's trigger is "the minute-cron pass that successfully closes the quiz"** (`TELEGRAM.md:48-51`), but Sprint 5 also wires a **lazy** close from participant result requests under the identical predicate, specifically "so a missed cron cannot strand eligible results" (`todos/sprint 5/claude-task--001--quiz-results-ranking-review.md:88`). `CONTRACTS.md:203-207` states the SCHEDULER↔QUIZZING calls are "not cron-exclusive... The contract is the predicate, not the caller." Applying that same principle here: TG-4 must fire off of a genuinely fresh atomic close regardless of which caller (cron or lazy route) performed it, or a quiz whose results only got requested lazily would never announce on Telegram.

**Existing scaffolding this packet extends, all currently one-line ownership stubs:**
- `src/core/telegram-render.ts:1` — render functions land here.
- `src/db/telegram.ts:1` — already assigned `claimAndSend`'s two-step shape; Sprint 4 implemented only the bounded, read-only `listFailedPosts(limit)` half (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:215`), which this packet must not change.
- `src/services/telegram.ts:1` — Bot API client (`sendMessage`, `getMe`, deferred `editMessageText`/`pinChatMessage`) lands here (`TELEGRAM.md:77-86`).
- `src/services/quiz-results.ts` (Sprint 5, new) — `closeQuiz` orchestration and the lazy-close call site both live here (`todos/sprint 5/claude-task--001--quiz-results-ranking-review.md:165-170`); this is the one place both close paths converge, so it is where a Telegram-forwarding hook must be injected.
- `src/services/quiz-creation.ts` (Sprint 3, new) — owns the cancel use case (`todos/sprint 3/claude-task--001--quiz-creation-units-lock.md:147-150`, AC-15 at line 89); this is where a cancellation-forwarding hook must be injected.
- `src/services/scheduler.ts` (Sprint 4, new) — owns the prepare/close passes and is where SCHEDULER-side Telegram composition/wiring belongs (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:198-203`).
- `wrangler.toml:43-48` already declares `TELEGRAM_CHAT_ID`, `TELEGRAM_ALERT_CHAT_ID`, `TELEGRAM_ENABLED` as non-secret vars; `TELEGRAM_BOT_TOKEN` is a Worker secret never written to `wrangler.toml` (`TELEGRAM.md:219-229`). No `wrangler.toml` edit is required.

**TG-1/TG-2/TG-3 discovery is now a resolved contract, not a gap.** `SCHEDULER.md:44-49` names an "Announce" pass ("Due post kind without a previous claim, discovered via `listDueAnnounce` → claimAndSend") in the same minute tick as Prepare/Close. Drafting this packet originally found `QuizzingSchedulerContract` had no method that could discover which quizzes are due for T−2h/T−30m/T announcements or supply `QuizAnnouncePayload`'s fields, since `listDuePrepare` is bounded to the T−5m *lobby* predicate and returns bare quiz IDs, no metadata (`src/core/contracts.ts:143`; `SCHEDULER.md:46`) — that gap was flagged as OQ-1 and resolved by the project owner on 2026-09-10, closing it before this revision. `QuizzingSchedulerContract` now has a seventh method:

```ts
listDueAnnounce(now: number, limit: number): Promise<DueAnnounceQuiz[]>
```

with `DueAnnounceQuiz = { quizId: string; kind: 'announce' | 'soon' | 'open' } & QuizAnnouncePayload` declared beside `QuizAnnouncePayload` (`src/core/contracts.ts:145-146`, `:174-175`). "Due" and "not yet claimed" are QUIZZING-side predicate checks internal to the call, mirroring `listDueClose`'s existing `{quizId, safeCloseAt}` shape; SCHEDULER still issues zero SQL of its own, and `roomCode` is present on the embedded `QuizAnnouncePayload` only once `scheduledAt <= now`, consistent with TG-6's withholding rule (`CONTRACTS.md:176-193`; `TELEGRAM.md:54`). This packet now implements and production-binds the full Announce pass (§7 AC-15) exactly as Sprint 5 bound the close pass, rather than deferring it.

QUIZZING remains the sole writer of `quizzes`/runtime tables; TELEGRAM remains the sole writer of `telegram_posts`; AUTH is not touched by this packet at all (Telegram has no HTTP surface — `API.md:6`).

## 2. Objective

After this packet ships, TELEGRAM can render all six post kinds as pure, golden-string-tested functions with correct HTML escaping, unit-timing-summary formatting, and no V1 bonus/grace wording; claim and send any kind idempotently through one two-step D1 write, including the weekly kind's single-claim/four-message shape and the cancelled kind's self-contained silent/notify check; and classify every documented Bot API failure mode without ever affecting quiz correctness. A successful atomic quiz close (cron or lazy) and a successful quiz cancellation each synchronously forward their payload into `claimAndSend` through an injected hook owned by SCHEDULER's composition layer, never by a direct QUIZZING→TELEGRAM call. The T−2h/T−30m/T Announce pass is production-bound in the minute tick, calling the now-resolved `listDueAnnounce(now, 100)` and forwarding each due candidate into `claimAndSend`, exactly as the Close pass is already bound. A typed-but-unwired weekly send pass exists for Sprint 7 to production-wire once `computeWeeklyBoards` is implemented, exactly as Sprint 4 left `closeQuiz`'s scheduler seam for Sprint 5 — that remains the one piece of production wiring this packet deliberately leaves for later, since only the weekly path still depends on an unimplemented QUIZZING method.

## 3. Assumptions

- Sprint 1 (AUTH) is implemented first, though this packet mounts no HTTP route and needs no `AuthContract` call — TELEGRAM has no HTTP surface (`API.md:6`).
- Sprint 3 (creation) is implemented first and supplies the cancel use case in `src/services/quiz-creation.ts`, transitioning `draft`/`scheduled`/`open` to `cancelled` and returning `QuizAdminSummary`, with no request body to carry a cancellation `reason` (`src/core/api.ts:276-277`; `todos/sprint 3/claude-task--001--quiz-creation-units-lock.md:89`).
- Sprint 4 (run + scheduler) is implemented first and supplies `src/services/scheduler.ts`'s prepare pass, the typed close-call seam, and TELEGRAM's own `listFailedPosts` read (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:198-215`).
- Sprint 5 (results) is implemented first and supplies the production-wired atomic `closeQuiz`, its lazy-close call site, and `src/services/quiz-results.ts` as the single place both close paths converge (`todos/sprint 5/claude-task--001--quiz-results-ranking-review.md:81-99`, `:165-170`).
- `QuizzingSchedulerContract.listDueAnnounce(now, limit): Promise<DueAnnounceQuiz[]>` already exists in `src/core/contracts.ts:145-146` with `DueAnnounceQuiz` declared at `:174-175`, resolving this packet's original OQ-1 (`CONTRACTS.md:176-193`; `SCHEDULER.md:47`, `:50-52`). This packet consumes it as given and does not further extend `QuizzingSchedulerContract` or `TelegramContract`.
- All persisted timestamps and injected `now` values are integer epoch milliseconds; `_sec` fields are explicitly multiplied by 1,000 (`DATA_MODEL.md:59-60`).
- `TELEGRAM_BOT_TOKEN` is a Worker secret (never in `wrangler.toml`); `TELEGRAM_CHAT_ID`, `TELEGRAM_ALERT_CHAT_ID`, `TELEGRAM_ENABLED` are non-secret vars already declared (`wrangler.toml:43-48`; `TELEGRAM.md:219-229`). `TELEGRAM_ALERT_CHAT_ID` and its dual-channel alert sender are Sprint 4/`observability.ts` territory, unchanged here (`MODULES.md:121-153`).
- Telegram's documented platform numbers (≈20 msgs/min to one group, 4096-char message limit, 48-hour self-delete window) must be re-verified against the Bot API docs at implementation time — they are Telegram's, not ours, and have changed before (`TELEGRAM.md:90-103`).
- `fetch` to `api.telegram.org` works normally from Workers with no proxy; the weekly kind's four sequential sends plus retries stay far under the 50-subrequest-per-invocation free-tier limit (`TELEGRAM.md:138-141`).
- `parse_mode: "HTML"` is used for every send, escaping only `&`, `<`, `>` — `MarkdownV2`'s escaping surface is rejected as a footgun (`TELEGRAM.md:128-130`).
- The migration baseline (`migrations/0001_init.sql:326-339`) already contains `telegram_posts` with the exact shape TELEGRAM.md describes; this packet adds no migration.

## 4. Out of Scope

- **Production wiring of the weekly cron pass (`0 19 * * 0`) and `computeWeeklyBoards` itself:** `computeWeeklyBoards` is Sprint 7's QUIZZING deliverable (`PRD.md:277-278`; `MODULES.md:207`). This packet builds and unit-tests a typed-but-unwired weekly send pass against a fake `computeWeeklyBoards`, matching how Sprint 4 left `closeQuiz`'s pass unbound for Sprint 5 (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:198-203`).
- **Hourly recurring-template materialization (`0 * * * *`):** entirely Sprint 7 (`SCHEDULER.md:92-100`).
- **`editMessageText` (live seat count) and `pinChatMessage`:** explicitly deferred, needs bot admin rights not assumed here (`TELEGRAM.md:233-239`).
- **Per-student DMs of results:** blocked on a student-initiated opt-in flow that doesn't exist; out of scope for all of V1 (`TELEGRAM.md:235-236`; `PRD.md:309-310`).
- **Inline join buttons / `reply_markup`:** deferred (`TELEGRAM.md:239`).
- **Dual-channel failure alerting (`TELEGRAM_ALERT_CHAT_ID`, Email Routing):** already Sprint 4/`src/services/observability.ts`'s territory and unchanged here (`MODULES.md:121-153`).
- **Automatic recovery of a stuck `'pending'` `telegram_posts` row** (a crash between claim and send): distinguishable in the data per `TELEGRAM.md:210-213`, but no automatic re-alert or auto-retry path is built — see the Risk table (§10) for why this is an accepted gap, not a blocking one.
- **Automatic partial-resend for a `'failed'` weekly claim:** if any of the four weekly messages fails, the whole claim is marked `'failed'` and alerted; resuming the remaining sections is a manual, out-of-band operator action, not code this packet builds (§7 AC-6).
- **Frontend, migrations, and any edit to `migrations/0001_init.sql`, `src/core/contracts.ts`, or `src/core/api.ts`.**

## 5. Open Questions / `<INPUT_REQUIRED>`

**(none).** The one open question this packet originally carried — OQ-1, whether/how SCHEDULER can discover due TG-1/TG-2/TG-3 candidates without a `src/core/contracts.ts` edit — was resolved by the project owner on 2026-09-10: `QuizzingSchedulerContract.listDueAnnounce(now, limit): Promise<DueAnnounceQuiz[]>` now exists (`src/core/contracts.ts:145-146`, `:174-175`; `CONTRACTS.md:176-193`; `SCHEDULER.md:47`, `:50-52`), and §7 AC-15 implements and production-binds the Announce pass against it. Every other item in this packet's scope — the weekly single-claim/four-message shape, the cancelled silent/notify check, the failure-mode/retry table, and the `TELEGRAM_ENABLED` kill switch — is explicit or directly inferable from `TELEGRAM.md`, `CONTRACTS.md` §6, and `migrations/0001_init.sql`'s actual schema (cited throughout §1 and §7 below), and nothing in this revision introduced a new gap.

## 6. Pre-flight Checklist

- [ ] Required skill loaded: **`clean-code`** — required for every implementation packet.
- [ ] Required skill loaded: **`prod-safety-gate`** — this packet composes the real Bot API client, wires a production kill switch, and adds side-effecting hooks into two already-production-wired transactions (quiz close, quiz cancel) that must never be allowed to fail or roll back because of a Telegram error.
- [ ] Required skill loaded: **`test-driven-development`** — claim-then-send idempotency, the weekly four-message shape, the cancelled silent/notify check, and the Bot API retry/backoff table are all new behavior.
- [ ] Required skill loaded: **`vibesec`** — this packet makes outbound HTTP calls carrying a bot token secret to a third-party API, handles unescaped student/admin-authored text (names, quiz titles) inside HTML-mode messages, and must never leak provider error text or the token into logs, `FailedTelegramPostRef`, or alert messages.
- [ ] Confirm the working tree is clean for this scope and the branch is current with trunk; preserve unrelated user changes.
- [ ] Confirm Sprint 1, Sprint 3, Sprint 4, and Sprint 5 implementations plus their focused/full tests pass before adding Telegram behavior.
- [ ] Confirm local/test `DB` and `TELEGRAM_ENABLED=false` are set; never point a dev/test run at a real bot token or the real student `TELEGRAM_CHAT_ID` (`TELEGRAM.md:228-229`).
- [ ] Read `TELEGRAM.md` in full (it is the owning source for this sprint), `CONTRACTS.md:157-275` (§5 SCHEDULER→QUIZZING including `listDueAnnounce`, and §6 SCHEDULER→TELEGRAM), `MODULES.md:42-44`, `MODULES.md:56-65`, `MODULES.md:100-108`, `SCHEDULER.md:42-62`, `SCHEDULER.md:77-122`, `PRD.md:221-235`, and `PLAN.md:221-227` before editing.
- [ ] Read exact types at `src/core/contracts.ts:141-182` (`QuizzingSchedulerContract` including `listDueAnnounce`/`DueAnnounceQuiz`, plus the full Telegram surface) and the DDL at `migrations/0001_init.sql:322-339` before editing `src/db/telegram.ts`.
- [ ] Re-read the Sprint 3 cancel AC-15 (`todos/sprint 3/claude-task--001--quiz-creation-units-lock.md:89`) and the Sprint 5 close/lazy-close ACs (`todos/sprint 5/claude-task--001--quiz-results-ranking-review.md:81-99`) before adding hooks to either service.
- [ ] Confirm `listDueAnnounce`'s exact shape — `DueAnnounceQuiz = {quizId, kind} & QuizAnnouncePayload` (`src/core/contracts.ts:174-175`) — before writing the Announce pass, and how it mirrors `listDueClose`'s already-bound pattern (`SCHEDULER.md:47`, `:50-52`).
- [ ] Re-read AC-1 through AC-18 and AC-OPERATOR; identify implementer, scheduler-composition, and operator checks separately.

## 7. Acceptance Criteria

1. **AC-1 — Render the three admission-window kinds as pure functions.** `renderQuizAnnounce(payload: QuizAnnouncePayload)` (TG-1), `renderStartingSoon(payload)` (TG-2, no room code even if present on the payload) and `renderRoomOpen(payload)` (TG-3) live in `src/core/telegram-render.ts`, take no network/DB dependency, and return plain HTML-mode text. Each formats `title`, `scheduledAt`/`endsAt` (admission window), graded `questionCount`, `unitCount`, the individual `windowSec` duration, and `timingSummary` (grouped by `UnitKind`, showing count and min/max seconds per kind) exactly from the supplied fields — never by reading bank/quiz tables (`TELEGRAM.md:271-274`; `CONTRACTS.md:236-239`). `renderRoomOpen` includes `roomCode` only when present on the payload (TG-6, `TELEGRAM.md:54`); `renderQuizAnnounce`/`renderStartingSoon` never include a room code even if one is present, per TG-1/TG-2's "No room code" requirement (`PRD.md:228-229`). No bonus, grace, or uniform per-question timing text appears anywhere (`TELEGRAM.md:271-272`). These are exactly the three payload shapes `listDueAnnounce` discovery (AC-15) hands to `claimAndSend`: `DueAnnounceQuiz` is `{quizId, kind} & QuizAnnouncePayload` (`src/core/contracts.ts:174-175`), so a discovered candidate's embedded `QuizAnnouncePayload` fields pass straight into the matching render function with no remapping.
2. **AC-2 — Render the result kind, including the nobody-played variant.** `renderQuizResult(payload: CloseResult)` (TG-4) formats `participantCount` and the first ten `top10` rows plus a participant-only board link placeholder; when `participantCount === 0`, it renders the one-line "nobody played" variant instead of an empty list, so silence always signals a bug rather than being ambiguous with a genuinely empty room (`PRD.md:355-356`; `SCHEDULER.md:144`).
3. **AC-3 — Render the weekly kind as four fixed-order messages.** `renderWeeklyBoards(boards: BoardSummary[])` (TG-5) returns four `{ type: QuizType | 'overall'; text: string }` entries in the fixed order `verbal, quant, lr, overall`, one board summary per message, each with its own top-10 rows plus a link (`TELEGRAM.md:105-114`). Each row shows `totalScore` and `quizzesTaken` for context only — never averaged, divided by, or ranked by `quizzesTaken` (`TELEGRAM.md:75`; `CONTRACTS.md:273-275`). An empty `top10` array renders a valid "nobody ranked this section" message, not an error — `computeWeeklyBoards` returning empty top10 arrays is itself valid per `SCHEDULER.md:110`.
4. **AC-4 — Render the cancelled kind's notify text only.** `renderCancelled(payload: CancelledPayload)` renders the notify-path message (title, `scheduledAt`, optional `reason`) only. It has no "silent" branch — the silent case (§7 AC-7) never calls render or send at all, matching "cancelling is silent — nobody was told to expect it" (`TELEGRAM.md:250-251`) literally: no message, no trace.
5. **AC-5 — Every render function stays inside Telegram's message-length limit and escapes only `&`, `<`, `>`.** All six functions escape solely those three characters — never full `MarkdownV2` escaping (`TELEGRAM.md:128-130`) — and every function takes at most 10 rows plus a link, so no function is ever handed a full participant/roster list (`TELEGRAM.md:72-74`). Golden tests assert output stays under Telegram's 4096-character message limit for a worst-case 100-participant weekly board and a worst-case long-name TG-4 result (`TELEGRAM.md:258-260`).
6. **AC-6 — Implement `claimAndSend`'s two-step claim-then-send in `src/db/telegram.ts`.** For `target: {quizId}`, insert `(quiz_id=quizId, kind, week_start=NULL, status='pending', claimed_at=now)`; for `target: {weekStart}`, insert `(quiz_id=NULL, kind='weekly', week_start=weekStart, status='pending', claimed_at=now)` — using an insert that silently no-ops on either `UNIQUE` constraint conflict rather than throwing (`migrations/0001_init.sql:326-339`). If the row was not newly claimed (another call already owns this exact `quiz_id`/`week_start` + `kind`), return `{sent:false, skipped:true}` immediately with no Bot API call — this is the module's whole double-fire protection (`TELEGRAM.md:186-190`). If newly claimed, call the injected Bot API client; on success `UPDATE` to `status='sent', message_id, sent_at=now` and return `{sent:true, skipped:false}`; on a permanent failure (§7 AC-9's non-retryable statuses, or retries exhausted) `UPDATE` to `status='failed', error` and return `{sent:false, skipped:false}` (`TELEGRAM.md:207-213`). Preserve Sprint 4's `listFailedPosts(limit)` implementation unchanged (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:215`).
7. **AC-7 — Implement the weekly kind's single-claim/four-message send and the cancelled kind's silent/notify check inside `claimAndSend`, without new cross-module calls.** For `kind='weekly'`: after claiming the one row, send the four `renderWeeklyBoards` messages sequentially in the fixed `verbal, quant, lr, overall` order; abort on the first failure without sending the remaining sections; on full success, `UPDATE` `message_id` to a JSON object keyed by section type (e.g. `{"verbal":"123","quant":"124","lr":"125","overall":"126"}`) and set `status='sent'`; on any failure, `UPDATE` to `status='failed'` with an `error` string identifying which section failed, and do not retry the already-sent sections automatically (§4's accepted limitation). For `kind='cancelled'`: before claiming anything, `SELECT` whether a `quiz_id`-scoped `kind='open'` row with `status='sent'` exists; if not, return `{sent:false, skipped:true}` with **no insert and no Bot API call** (the silent case, `TELEGRAM.md:250-251`); if it exists, proceed through the normal single-message claim-then-send path from AC-6.
8. **AC-8 — Implement the Bot API client in `src/services/telegram.ts`.** `sendMessage(chatId, text)` posts to `https://api.telegram.org/bot<token>/sendMessage` with `parse_mode: "HTML"` and the pre-escaped text from `core/telegram-render.ts`; `getMe()` confirms the token is valid, exposed for operator/startup verification, not called on every request (`TELEGRAM.md:82`). `editMessageText`/`pinChatMessage` are not implemented (§4). No `sendPhoto`, no `getUpdates`, no webhook registration anywhere in this packet (`TELEGRAM.md:86`).
9. **AC-9 — Classify every documented failure mode exactly.** `429`: read `parameters.retry_after`, wait, retry once, never loop tightly (`TELEGRAM.md:149`). `400`: do not retry; treat as a bug, log with the rendered body (redacted per AC-16) (`TELEGRAM.md:150`). `401`: do not retry; classify as a permanent failure for alerting (`TELEGRAM.md:151`). `403`: do not retry; check the response for `migrate_to_chat_id` and surface it distinctly in the failure classification so an operator can act on a group migration (`TELEGRAM.md:123-125`, `:152`). `5xx`/timeout: retry with increasing backoff, maximum 3 attempts total, then give up as a permanent failure (`TELEGRAM.md:153`). Every classification maps to exactly one of "retryable" (429, 5xx/timeout within budget) or "permanent" (400, 401, 403, 5xx/timeout exhausted), and `src/db/telegram.ts`'s AC-6 update step uses that classification, never a raw HTTP status check of its own.
10. **AC-10 — Gate all network calls behind `TELEGRAM_ENABLED` at composition time, not inside `claimAndSend`.** `src/index.ts` composes either the real HTTP-backed Bot API client or a no-op client (never calls `fetch`, returns a deterministic successful stub result) based on `env.TELEGRAM_ENABLED === "true"`; `src/db/telegram.ts`'s claim/update logic is unaware of the flag and runs identically either way, so local/test runs can still exercise full claim-then-send idempotency without ever reaching `api.telegram.org` (`TELEGRAM.md:226-229`). A test asserts zero `fetch` calls occur when the disabled client is composed.
11. **AC-11 — Fire TG-4 from a fresh atomic close, from either caller, without ever affecting the close transaction.** `src/services/quiz-results.ts`'s close implementation accepts an injected `onQuizClosed(quizId, result: CloseResult): Promise<void>` callback, invoked exactly once per invocation that performed a genuinely fresh atomic close (not on an idempotent re-read of an already-published board), using the exact committed `CloseResult` (`todos/sprint 5/claude-task--001--quiz-results-ranking-review.md:86`). The callback fires identically whether the close came from the minute-tick pass or the lazy participant-result path (`CONTRACTS.md:183-187`, extended by analogy: the predicate, not the caller, decides). The call happens strictly **after** the D1 commit, wrapped so any callback error (network, D1-write-inside-the-callback, anything) is caught and never rethrown into the close code path — a failed Telegram post must never affect the quiz (TG-7, `TELEGRAM.md:55`, `:155-157`).
12. **AC-12 — Fire the cancelled kind from a successful cancellation, without ever affecting the cancel transaction.** `src/services/quiz-creation.ts`'s cancel use case accepts an injected `onQuizCancelled(quizId, payload: CancelledPayload): Promise<void>` callback, invoked exactly once per successful `cancelled` transition, built from the same row data already read for `QuizAdminSummary` (title, `scheduledAt`); `reason` stays `undefined` since the cancel route accepts no body (`src/core/api.ts:276-277`). The call happens strictly after the D1 commit and is wrapped identically to AC-11 so a Telegram failure cannot roll back or block a cancellation.
13. **AC-13 — Compose the real hooks and the Announce pass only in SCHEDULER-owned files.** `src/services/scheduler.ts`/`src/index.ts` are the only files that import `TelegramContract`, `src/db/telegram.ts`, or `src/services/telegram.ts`. They implement the real bodies of `onQuizClosed`/`onQuizCancelled`, calling `claimAndSend('result', {quizId}, result)` and `claimAndSend('cancelled', {quizId}, payload)` respectively, and the `listDueAnnounce`-driven Announce pass (AC-15). `src/services/quiz-results.ts` and `src/services/quiz-creation.ts` depend only on the two locally-typed callback signatures from AC-11/AC-12 and must not import anything Telegram-shaped — this is what makes "routed through SCHEDULER, not a direct call from QUIZZING" (`TELEGRAM.md:250-252`) and "nothing points back up" (`MODULES.md:42-43`) literally true at the file level, not just narratively true.
14. **AC-14 — Build a typed-but-unwired weekly send pass, matching the Sprint 4→5 handoff shape.** Implement and unit-test a weekly pass in `src/services/scheduler.ts` that calls the existing `computeWeeklyBoards(weekStart)` contract method, and for each of the (possibly empty, per `SCHEDULER.md:107-108`) non-empty results, calls `claimAndSend('weekly', {weekStart}, boards)`. Test it against a fake `computeWeeklyBoards`. Do **not** bind it into the production weekly cron trigger in `src/index.ts` — leave that trigger's handler absent/no-op with a comment marking it for Sprint 7, exactly as Sprint 4 left the close pass unbound for Sprint 5 (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:198-203`, `:231`). Unlike the Announce pass (AC-15), the weekly pass stays unbound because its own contract dependency, `computeWeeklyBoards`, is still unimplemented — Sprint 6 does not have the same OQ-1-style gap here, it has a genuine cross-sprint dependency.
15. **AC-15 — Discover and production-bind the Announce pass.** `src/services/scheduler.ts` implements an Announce pass that calls `listDueAnnounce(now, 100)` (`src/core/contracts.ts:145-146`), mirroring the Close pass's `listDueClose(now, 100)` bound in Sprint 5. For each returned `DueAnnounceQuiz` entry, destructure `quizId`/`kind` off and pass the remaining `QuizAnnouncePayload` fields as `payload` into `claimAndSend(entry.kind, {quizId: entry.quizId}, payload)` — constructing that payload explicitly, not by forwarding the wider `DueAnnounceQuiz` object, since it carries two extra fields `TelegramPayload` doesn't have (`CONTRACTS.md:135-139`'s explicit-construction principle, already cited in §8b, applies identically here). Each candidate is isolated (a `try`/`catch` per entry) so one failing `claimAndSend` call never blocks the rest of the batch or the pass itself, matching how Sprint 4 isolated `listDueClose` candidates (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:88`). Bind this pass into `src/index.ts`'s production minute tick alongside the already-bound Prepare/Close passes (`SCHEDULER.md:44-48`) — unlike the weekly pass (AC-14), the Announce pass has no unresolved upstream dependency left, so it ships production-wired in this packet, not typed-but-unwired.
16. **AC-16 — Preserve module ownership and never leak provider detail.** TELEGRAM alone writes `telegram_posts`; construct every `ClaimAndSendResult`/`FailedTelegramPostRef` field explicitly (`src/core/contracts.ts:155-161`) — `FailedTelegramPostRef` never carries stored provider error text (`CONTRACTS.md:216-218`). Logs, thrown errors, and the AC-9 failure classification never contain the bot token, a rendered message body verbatim in a shared/alert-visible channel, or another student's data; the failed-post/error path in `telegram_posts.error` may hold provider text since only TELEGRAM reads that column directly (`MODULES.md:64`).
17. **AC-17 — Prove the behavior test-first, with the exact golden cases TELEGRAM.md names.** Before production edits, add failing tests for: a student name containing `<`, `&`, and an em dash rendering safely escaped (`TELEGRAM.md:259-260`); a 100-row weekly board whose top-10 output stays under 4096 characters (`TELEGRAM.md:260`); mixed unit-kind timing summaries in TG-1 (e.g. one `rc` unit and two `standalone` units with different `minTimeSec`/`maxTimeSec`) with no invented uniform per-question time; the explicit absence of V1 bonus/grace wording anywhere (`TELEGRAM.md:271-272`, `:279`); the nobody-played TG-4 variant; the weekly kind's four-message send order and partial-failure abort; the cancelled kind's silent-vs-notify branch, including that the silent branch performs zero D1 writes and zero Bot API calls; idempotency under a doubled call for every kind (`TELEGRAM.md:262-264`); failure injection returning 429-with-`retry_after`, then 403, asserting the close/cancel flow that triggered the post proceeds untouched in both cases (`TELEGRAM.md:264-265`); and the Announce pass's `listDueAnnounce(now,100)` iteration, per-candidate isolation on a forced failure, and its production binding in `src/index.ts` (AC-15).
18. **AC-18 — Keep later/other-sprint scope out of the diff.** No weekly cron production wiring (that stays Sprint 7's, per AC-14), no `editMessageText`/`pinChatMessage`, no per-student DM/opt-in flow, no frontend file, no migration, and no edit to `src/core/contracts.ts`, `src/core/api.ts`, `wrangler.toml`, `src/services/observability.ts`, or any product document enters the diff. Protected-file checks (§12a) prove this.
19. **AC-OPERATOR — Verify claim-then-send idempotency, the Announce pass, and the kill switch on staging.** Using a throwaway bot token and a private test group of one — never the real student group (`TELEGRAM.md:266`) — the operator: confirms `TELEGRAM_ENABLED=false` locally never calls `fetch` (AC-10); confirms `getMe()` validates a real token in staging (AC-8); schedules a quiz close enough to T that the Announce pass's T−2h/T−30m/T windows can be observed within the verification session (or forces `now` in a controlled staging invocation) and confirms TG-1/TG-2/TG-3 fire once each at their respective due points (AC-15); invokes the same close (or cancel, or weekly pass, or a repeated Announce-pass tick) twice and confirms only one message lands per kind/target (`TELEGRAM.md:263-264`); forces a 429 and a 403 from a stub and confirms the triggering quiz flow (close/cancel/announce) is unaffected in both cases. Record only opaque quiz IDs, kinds, and pass/fail outcomes; never copy a real bot token, a real student's name, or a raw Telegram API response into deployment logs.

## 8. Implementation Guardrails

### 8a. Hard NO list

- Do not edit `migrations/0001_init.sql`, `src/core/contracts.ts`, `src/core/api.ts`, `wrangler.toml`, product documents, prior packets, fixtures, frontend/visual files, or the progress tracker. `listDueAnnounce`/`DueAnnounceQuiz` already landed in `src/core/contracts.ts` before this revision — consume them exactly as declared; do not add any further method to `QuizzingSchedulerContract` or `TelegramContract`.
- Do not bind the weekly send pass into the production `0 19 * * 0` cron trigger, and do not implement `computeWeeklyBoards` itself — that is QUIZZING/Sprint 7's deliverable. (The Announce pass is different — AC-15 requires binding it now.)
- Do not let `src/services/quiz-results.ts` or `src/services/quiz-creation.ts` import `TelegramContract`, `src/db/telegram.ts`, or `src/services/telegram.ts`. They depend only on the injected `onQuizClosed`/`onQuizCancelled` callback types; the real Telegram-calling bodies live in `src/services/scheduler.ts`/`src/index.ts`.
- Do not let a Telegram failure — network error, 4xx/5xx, thrown exception from the callback body — propagate into or roll back the close or cancel D1 transaction. Catch and swallow (log only, redacted) at the callback boundary.
- Do not use full `MarkdownV2` escaping or any parse mode other than `HTML`. Do not escape characters beyond `&`, `<`, `>`.
- Do not hand any render function a full participant or weekly roster; every function takes at most 10 rows plus a link.
- Do not write a `'sent'` status before a Bot API call actually succeeds, or write `message_id`/`sent_at` before that success. Do not skip the initial `'pending'` claim insert for any kind.
- Do not retry a `400`/`401`/`403` failure, and do not retry `429`/`5xx`/timeout beyond the documented once/three-attempt caps in a tight loop.
- Do not send the weekly kind's remaining sections after one has failed, and do not build an automatic resend path for a `'failed'` weekly or per-quiz claim.
- Do not call `sendMessage` for the cancelled kind, or write any `telegram_posts` row for it, when no `'open'` row for that quiz has `status='sent'`.
- Do not read `participants`, `answers`, or any QUIZZING-owned table directly from TELEGRAM code — TELEGRAM never calls QUIZZING and never reads its tables (`TELEGRAM.md:181-184`, `MODULES.md:42-43`).
- Do not implement `editMessageText`, `pinChatMessage`, `sendPhoto`, `getUpdates`, or any inbound webhook route.
- Do not point any test or local `wrangler dev` run at a real bot token or the real student `TELEGRAM_CHAT_ID`.

### 8b. Coding / quality principles

- **`clean-code`:** keep each render function a small, single-purpose pure function with early returns for the nobody-played/silent-cancel branches; extract shared HTML-escape and row-formatting helpers rather than repeating them per kind; name retry/backoff constants (`FLOOD_CONTROL_MAX_RETRIES`, `SERVER_ERROR_MAX_ATTEMPTS`) instead of using bare numbers.
- **`prod-safety-gate`:** the dangerous surfaces are (1) the real outbound HTTP call carrying a production bot token, and (2) the two injected hooks sitting inside already-production-wired close/cancel transactions. Test every callback failure mode (throw, timeout, malformed response) in isolation from the transaction it's attached to, and test the `TELEGRAM_ENABLED` composition boundary explicitly, before rollout.
- **`test-driven-development`:** start with the pure render golden-string tests (fastest feedback, no D1/network), then the `claimAndSend` D1 tests (isolated migrated D1, injected fake Bot API client), then the Bot API client's mocked-`fetch` retry/backoff tests, then the hook-wiring tests against `quiz-results.ts`/`quiz-creation.ts`. Watch each fail for the missing behavior before implementing.
- **`vibesec`:** never log a raw Bot API response, the bot token, or a rendered message body outside the `telegram_posts.error` column (which only TELEGRAM reads). Validate `quizId`/`weekStart` targets are the exact strings the caller supplied — no string interpolation building SQL. Treat every render input (title, student name inside a weekly/result row) as untrusted text requiring the AC-5 escaping, since names and titles are user-authored.
- Construct `ClaimAndSendResult` and `FailedTelegramPostRef` explicitly, field by field — TypeScript structural typing does not strip extra fields at runtime (`CONTRACTS.md:135-139` states the same principle for a different DTO; it applies identically here).
- Keep the weekly kind's four-message loop and the cancelled kind's self-check as small, separately testable functions inside `src/db/telegram.ts`, not inlined into one large `claimAndSend` body.

## 9. Behavior Spec (per file)

### `src/core/telegram-render.ts`

- **Current state (line 1):** ownership stub naming all six kinds, unit timing summaries, no bonus text, and code-at-admission (`src/core/telegram-render.ts:1`).
- **Required edit:** implement `renderQuizAnnounce`, `renderStartingSoon`, `renderRoomOpen`, `renderQuizResult`, `renderWeeklyBoards`, `renderCancelled` plus shared HTML-escape/row-format helpers.
- **Estimated diff:** ~90 LOC.
- **Subtleties:** `renderWeeklyBoards` returns an array of 4, not a single string — every other function returns one string. Keep the nobody-played and silent-cancel special cases explicit, not inferred from empty arrays elsewhere.

### `src/db/telegram.ts`

- **Current state (line 1):** ownership stub for the two-step claim/send shape (`src/db/telegram.ts:1`); Sprint 4 already implemented `listFailedPosts(limit)` here (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:215`).
- **Required edit:** implement `claimAndSend` per AC-6/AC-7 — the shared single-message claim/update path, the weekly four-message loop, and the cancelled silent-check — against an injected Bot API client interface. Leave `listFailedPosts` untouched.
- **Estimated diff:** ~110 LOC; split the weekly loop into its own file-local helper if this exceeds that.
- **Subtleties:** use an insert that no-ops on a `UNIQUE` conflict rather than throwing, and check whether a row was actually newly inserted to distinguish "claimed" from "already claimed" (`skipped:true`). The cancelled kind's silent path performs zero writes — do not insert a row just to immediately mark it something inert.

### `src/services/telegram.ts`

- **Current state (line 1):** ownership stub naming `sendMessage`, `getMe`, `editMessageText`, `pinChatMessage` (`src/services/telegram.ts:1`).
- **Required edit:** implement `sendMessage` and `getMe` against the real Bot API, plus the AC-9 failure classification/retry logic and a no-op stub implementation for the `TELEGRAM_ENABLED=false` composition path.
- **Estimated diff:** ~90 LOC.
- **Subtleties:** the retry/backoff logic belongs here, not in `src/db/telegram.ts` — the db layer only needs a final retryable/permanent classification and, on success, a message ID (or array of IDs for the weekly loop's per-call use). Do not implement `editMessageText`/`pinChatMessage` bodies.

### `src/services/quiz-results.ts`

- **Current state:** Sprint 5 creates this file to orchestrate `closeQuiz` and the lazy-close call site (`todos/sprint 5/claude-task--001--quiz-results-ranking-review.md:165-170`).
- **Required edit:** add an `onQuizClosed` callback parameter to its composition, invoked once per fresh atomic close per AC-11, from both the scheduler-pass and lazy-close entry points.
- **Estimated diff:** ~25 LOC.
- **Subtleties:** the callback must not be awaited in a way that can delay or fail the HTTP/cron response; wrap it so its own errors are caught locally. Do not import anything Telegram-shaped into this file (AC-13).

### `src/services/quiz-creation.ts`

- **Current state:** Sprint 3 creates this file to own the cancel use case (`todos/sprint 3/claude-task--001--quiz-creation-units-lock.md:147-150`).
- **Required edit:** add an `onQuizCancelled` callback parameter, invoked once per successful cancellation per AC-12.
- **Estimated diff:** ~20 LOC.
- **Subtleties:** build `CancelledPayload` from data already read for `QuizAdminSummary`; `reason` stays `undefined` (no request body exists to carry one). Do not import anything Telegram-shaped into this file (AC-13).

### `src/services/scheduler.ts`

- **Current state:** Sprint 4 creates this file with the prepare pass and the typed-but-unwired close-call seam (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:198-203`).
- **Required edit:** implement the real bodies of `onQuizClosed`/`onQuizCancelled` (calling `claimAndSend('result', ...)` / `claimAndSend('cancelled', ...)`), add the typed-but-unwired weekly send pass per AC-14, and add the Announce pass per AC-15: call `listDueAnnounce(now, 100)`, iterate results, destructure `quizId`/`kind` off each `DueAnnounceQuiz` to build the `QuizAnnouncePayload` argument, call `claimAndSend(kind, {quizId}, payload)` per candidate with per-candidate error isolation.
- **Estimated diff:** ~90 LOC.
- **Subtleties:** this file (with `src/index.ts`) is the only place `TelegramContract` may be imported per AC-13. The Announce pass mirrors the already-bound Close pass's shape (bounded limit 100, per-candidate isolation); the weekly pass stays deliberately unbound (AC-14) since its own upstream dependency isn't ready yet.

### `src/index.ts`

- **Current state (line 1):** entrypoint stub owning Hono mounting and all scheduler orchestration, naming "minute prepare/posts/safe close/alerts" among its responsibilities (`src/index.ts:1`).
- **Required edit:** compose the real or no-op Bot API client based on `TELEGRAM_ENABLED` (AC-10), wire `onQuizClosed`/`onQuizCancelled` into the Sprint 5/Sprint 3 services, bind the new Announce pass into the production minute tick alongside the already-bound Prepare/Close passes (AC-15), and leave the weekly cron trigger's handler absent/no-op with a comment marking Sprint 7's job.
- **Estimated diff:** ~35 LOC.
- **Subtleties:** preserve every prior mount and the already-production-wired prepare/close passes exactly. The Announce pass binds now; the weekly pass still does not (AC-14).

### `tests/telegram-render.test.ts` (new)

- **Current state:** rendering has only the ownership comment and TELEGRAM.md's prose requirements (`src/core/telegram-render.ts:1`; `TELEGRAM.md:57-75`, `:258-266`).
- **Required edit:** golden-string tests for all six kinds per AC-17, including escaping, mixed timing summaries, no-bonus-text assertions, nobody-played, weekly four-message order/content, and the 4096-char 100-row bound.
- **Estimated diff:** ~120 LOC.
- **Subtleties:** assert exact rendered strings (or precise substring/structure checks), not just "doesn't throw." Build the 100-row fixture with deliberately long names to stress the bound honestly.

### `tests/telegram.test.ts` (new)

- **Current state:** `src/db/telegram.ts` has no executable behavior beyond Sprint 4's `listFailedPosts` tests.
- **Required edit:** isolated migrated-D1 tests for claim-then-send idempotency (single and doubled calls), the weekly single-claim/four-message shape including partial-failure abort, and the cancelled silent/notify branch including zero-write assertions on the silent path.
- **Estimated diff:** ~100 LOC.
- **Subtleties:** use a fake/injected Bot API client per test, not real HTTP. Assert raw row state (`status`, `message_id`, `error`) after every case, not just the returned `ClaimAndSendResult`.

### `tests/telegram-bot-client.test.ts` (new)

- **Current state:** `src/services/telegram.ts` has no executable behavior.
- **Required edit:** mocked-`fetch` tests for every AC-9 status class (429 with `retry_after`, 400, 401, 403 with and without `migrate_to_chat_id`, 5xx/timeout exhausting 3 attempts), plus the `TELEGRAM_ENABLED=false` no-op client asserting zero `fetch` calls.
- **Estimated diff:** ~80 LOC.
- **Subtleties:** assert the exact number of `fetch` calls per case (once for 429's single retry, up to three for 5xx, exactly one for every non-retryable status).

### `tests/quiz-results-telegram.test.ts` (new)

- **Current state:** Sprint 5's close/lazy-close tests exist without any Telegram hook (`todos/sprint 5/claude-task--001--quiz-results-ranking-review.md:193-198`).
- **Required edit:** test that `onQuizClosed` fires exactly once for a fresh close from each caller (cron pass, lazy route), fires with the exact committed `CloseResult`, and that a throwing/failing callback never affects the committed close state or the caller's response.
- **Estimated diff:** ~50 LOC.
- **Subtleties:** use a spy/fake callback; do not require a real D1/Telegram integration here — that belongs to `tests/telegram.test.ts` and AC-OPERATOR.

### `tests/quiz-creation-telegram.test.ts` (new)

- **Current state:** Sprint 3's cancel tests exist without any Telegram hook (`todos/sprint 3/claude-task--001--quiz-creation-units-lock.md:175-180`).
- **Required edit:** test that `onQuizCancelled` fires exactly once for a successful cancellation with the exact `CancelledPayload`, and that a throwing/failing callback never affects the committed cancellation or the route's response.
- **Estimated diff:** ~40 LOC.
- **Subtleties:** cover cancelling from `draft`, `scheduled`, and `open` — the payload shape is identical in all three; whether the *eventual* SCHEDULER-level send is silent or notifies is entirely `src/db/telegram.ts`'s concern (AC-7), not this hook's.

### `tests/scheduler-weekly.test.ts` (new)

- **Current state:** no weekly pass exists yet anywhere (`SCHEDULER.md:98-108` describes the requirement; nothing implements it).
- **Required edit:** unit-test the typed-but-unwired weekly pass from AC-14 against a fake `computeWeeklyBoards` (empty-result skip, four-summary send, claim-then-send delegated to a fake `TelegramContract`), and assert it is not bound into `src/index.ts`'s production weekly cron handler.
- **Estimated diff:** ~40 LOC.
- **Subtleties:** mirror `tests/scheduler-minute.test.ts`'s style of asserting the pass is exported/testable but absent from production composition (`todos/sprint 4/claude-task--001--quiz-run-batch-scheduler.md:254-259`).

### `tests/scheduler-announce.test.ts` (new)

- **Current state:** no Announce pass exists yet anywhere; `listDueAnnounce` is a new, unconsumed contract method (`src/core/contracts.ts:145-146`).
- **Required edit:** test `listDueAnnounce(now,100)` iteration against a fake `QuizzingSchedulerContract`, correct payload construction (`quizId`/`kind` stripped, remaining `QuizAnnouncePayload` fields forwarded unchanged) into `claimAndSend`, per-candidate isolation when one candidate's `claimAndSend` call throws, and — unlike `tests/scheduler-weekly.test.ts` — that the pass **is** bound into `src/index.ts`'s production minute-tick composition.
- **Estimated diff:** ~50 LOC.
- **Subtleties:** mirror `tests/scheduler-minute.test.ts`'s existing close-pass production-binding assertions, but for the Announce pass instead of the still-deliberately-unbound weekly pass.

## 10. Risk / Failure Modes

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| A quiz close or cancellation is delayed/blocked by a slow or failing Telegram call | Med | High | AC-11/AC-12 strictly post-commit, caught-and-swallowed callback boundary; dedicated failure-injection tests. |
| Double-posting on a doubled cron/lazy trigger | Med | High | AC-6's claim-first insert with no-op-on-conflict; AC-17 doubled-call tests for every kind. |
| Weekly partial send leaves 1-3 sections posted and the 4th missing, with no automatic recovery | Med | Med | AC-7 abort-on-first-failure, explicit `'failed'` status/error, documented as an accepted V1 limitation in §4 rather than silently retried into duplicates. |
| A crash between claim (`'pending'`) and send permanently blocks all future attempts for that kind/target, invisibly to the existing `'failed'`-only alert check | Low | Med | Documented in §4 as an explicitly accepted, out-of-scope gap; `TELEGRAM.md:210-213`'s "distinguishable" property is preserved in the data for manual diagnosis even though no new alert is built. |
| `MarkdownV2`-style over-escaping or under-escaping produces a 400 or a garbled message | Med | Med | AC-5/AC-9 fixed `HTML`-mode, escape-only-`&<>` rule; golden tests with `<`, `&`, em dash. |
| A render function is accidentally handed a full roster instead of top 10 | Low | High | AC-5's "at most 10 rows" rule enforced at the function signature/type level and by golden tests. |
| The cancelled kind fires a notify message when TG-3 never actually posted (or vice versa) | Med | Med | AC-7's own-table `status='sent'` check, tested explicitly for `draft`/`scheduled`/pre-`T` `open` cancellations. |
| `TELEGRAM_ENABLED=false` accidentally still reaches `fetch` in dev, spamming the real group | Low | High | AC-10's composition-time client swap plus an explicit zero-`fetch` assertion test. |
| 429/5xx retry logic loops tightly or retries a non-retryable status | Med | Med | AC-9's exact classification table and mocked-`fetch` call-count assertions. |
| A narrow due window (e.g. TG-2's single T−30m minute) is missed entirely by a delayed or skipped cron tick, silently dropping that kind | Med | Med | `listDueAnnounce` re-evaluates "due, not yet claimed" on every tick rather than a one-shot timer, so a late tick still finds and claims the candidate on its next run; AC-15/BE-10 test a delayed-tick recovery case. |
| Overlapping/concurrent Announce-pass ticks race to claim the same candidate, double-sending | Low | Med | `claimAndSend`'s AC-6 claim-first insert is the same idempotency mechanism the Prepare/Close passes already rely on; AC-17's doubled-call tests cover it for every kind including the three Announce kinds. |
| The Announce pass's payload-construction step accidentally forwards `quizId`/`kind` as extra fields into `TelegramPayload`, or silently drops a `QuizAnnouncePayload` field | Med | Med | AC-15's explicit destructure-then-construct requirement plus a dedicated payload-shape assertion in `tests/scheduler-announce.test.ts`. |
| Provider error text or the bot token leaks into a log, alert, or `FailedTelegramPostRef` | Low | High | AC-16's explicit allowlist construction and the negative-key scan in §12a. |
| `onQuizClosed`/`onQuizCancelled` wiring accidentally imports Telegram types into QUIZZING service files, reintroducing a "points back up" dependency | Med | Med | AC-13's file-boundary rule plus the import-scan in §12a. |
| Test isolation leaves claimed `telegram_posts` rows between test cases, masking a real double-post bug | Med | Med | Fresh migrated D1 fixtures per test, per the pattern established in `tests/quiz-results.test.ts`. |

## 11. Rollback / Revert Plan

1. Stop routing new Telegram sends by disabling `TELEGRAM_ENABLED` (or reverting the deploy) while leaving quiz close/cancel traffic untouched — those transactions must keep committing regardless of Telegram's state (TG-7).
2. Record only opaque quiz/week identity, `kind`, `status`, and `claimed_at`/`sent_at` from `telegram_posts`. Do not export rendered message bodies, the bot token, or student names into an incident record.
3. If a row is `'pending'` (a crash mid-send), leave it — do not manually flip it to `'sent'`/`'failed'`. A future retry mechanism, if built, must observe this state honestly; do not fabricate a `message_id`.
4. If a row is `'failed'` for the weekly kind with some sections already sent, do not attempt an automated resend; this is an accepted manual, out-of-band operator action (§4). Do not re-run `claimAndSend` for that exact `week_start`/`kind` expecting it to retry — the claim already exists.
5. Run `git revert <sha>` for this packet's implementation and redeploy the prior Worker build; confirm the reverted build restores the pre-Sprint-6 behavior of `src/services/quiz-results.ts` and `src/services/quiz-creation.ts` (no `onQuizClosed`/`onQuizCancelled` invocation) and that `src/index.ts`'s minute tick no longer calls the Announce pass — `listDueAnnounce` itself stays in `src/core/contracts.ts` untouched (this packet only added a consumer, not the method).
6. Keep `migrations/0001_init.sql` and all existing `telegram_posts` rows; this packet adds no migration and deletes no data.
7. Verify the reverted build no longer calls the real Bot API, that Sprint 1/3/4/5 focused/full tests still pass, and that quiz close/cancel continue to succeed with no Telegram side effect at all.
8. Confirm via D1 that no `telegram_posts` row was left in an inconsistent state by the rollback itself (a row claimed just before rollback either completed its send before the revert took effect or remains a diagnosable `'pending'`/`'failed'` row).
9. Notify the project owner through the configured private channels with opaque quiz/week IDs, rollback time, and whether any group message was actually sent before rollback (since Telegram sends, once delivered, cannot be un-sent by this system — `TELEGRAM.md:104` bot-deletes-own-message-within-48-hours is a manual operator action, not code this packet builds).
10. After stability, re-enable `TELEGRAM_ENABLED` only after confirming the fix in staging against a throwaway bot token and test group (AC-OPERATOR), never directly against the real student group.

## 12. Verification + Definition of Done

### 12a. Automated verification

```bash
npm ci
npm run typecheck
npm test -- tests/telegram-render.test.ts
npm test -- tests/telegram.test.ts
npm test -- tests/telegram-bot-client.test.ts
npm test -- tests/quiz-results-telegram.test.ts
npm test -- tests/quiz-creation-telegram.test.ts
npm test -- tests/scheduler-weekly.test.ts
npm test -- tests/scheduler-announce.test.ts
npm test

git diff --exit-code -- migrations/0001_init.sql src/core/contracts.ts src/core/api.ts wrangler.toml
git diff --exit-code -- PRD.md PLAN.md MODULES.md DATA_MODEL.md CONTRACTS.md API.md QUIZZING.md SCHEDULER.md TELEGRAM.md
git diff --exit-code -- src/services/observability.ts
git diff --exit-code -- "todos/sprint 1" "todos/sprint 2" "todos/sprint 3" "todos/sprint 4" "todos/sprint 5" "todos/sprint 7" "todos/sprint 8" todos/PROGRESS.md

! rg -n "from ['\"].*(services/telegram|db/telegram)" src/services/quiz-results.ts src/services/quiz-creation.ts
! rg -n "TELEGRAM_BOT_TOKEN|retry_after" src/services/observability.ts
rg -n "listDueAnnounce" src/services/scheduler.ts src/index.ts
```

All commands must succeed: the `git diff --exit-code` and `!`-prefixed `rg` lines must find no match; the final positive `rg -n "listDueAnnounce"` line must find at least one match, confirming the Announce pass is actually wired, not merely left as an unconsumed contract method. Focused tests must generate raw D1/mocked-fetch assertions in memory or redacted temporary artifacts, and the full suite must preserve Sprint 1–5 behavior.

### 12b. Manual QA cases (MANDATORY)

#### Backend / API

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | Golden render escaping and length | Render TG-1..5/cancelled with a name containing `<`, `&`, an em dash, and a 100-row weekly fixture. | Only `&`/`</>` are escaped; every output stays under 4096 characters; weekly returns 4 messages in fixed order. | Not Run |
| BE-2 | No bonus/grace text, mixed timing summary | Render TG-1 with a payload mixing `rc` and `standalone` `timingSummary` entries. | Output shows per-kind count/min/max seconds; no bonus/grace/uniform-per-question wording appears. | Not Run |
| BE-3 | Claim-then-send idempotency | Call `claimAndSend` twice for the same `quizId`/`kind` (and again for `weekStart`/`'weekly'`) against an injected fake client. | First call claims and sends once; second returns `{sent:false,skipped:true}` with no second Bot API call. | Not Run |
| BE-4 | Weekly partial failure | Force the 3rd of 4 weekly sends to fail. | Sections 1-2 sent, 3-4 not attempted; row is `status='failed'` with an error naming the failed section; no automatic resend occurs on a repeated call. | Not Run |
| BE-5 | Cancelled silent vs notify | Cancel a quiz with no `'open'` row sent; cancel another with a sent `'open'` row. | First: zero `telegram_posts` writes, zero Bot API calls. Second: one `'cancelled'` row claimed and sent. | Not Run |
| BE-6 | Bot API failure classification | Mock `fetch` to return 429 (with `retry_after`), 400, 401, 403 (with `migrate_to_chat_id`), and a 5xx three times. | 429 retries once then succeeds/fails per stub; 400/401/403 never retry; 5xx retries up to 3 attempts then gives up; `telegram_posts.status` lands on `'sent'`/`'failed'` correctly in each case. | Not Run |
| BE-7 | Close/cancel isolation from Telegram failure | Force `onQuizClosed`/`onQuizCancelled` to throw. | The underlying close/cancel transaction and its own response are unaffected; the thrown error is caught and does not propagate. | Not Run |
| BE-8 | `TELEGRAM_ENABLED` kill switch | Compose the service with `TELEGRAM_ENABLED=false` and run a claim-then-send. | Zero `fetch` calls occur; `claimAndSend` still completes its D1 claim/update cycle with a deterministic stub result. | Not Run |
| BE-9 | Module boundary scan | Run the `rg` import-scan from §12a against `src/services/quiz-results.ts` and `src/services/quiz-creation.ts`. | No match — neither file imports anything Telegram-shaped. | Not Run |
| BE-10 | Announce-pass discovery and binding | Seed due/not-due/already-claimed fixtures for all three kinds against a fake `listDueAnnounce`; run the pass with one candidate's `claimAndSend` forced to throw; inspect `src/index.ts`'s production composition. | Every due, not-yet-claimed candidate is claimed/sent once; the throwing candidate doesn't block the rest; the pass is bound into the production minute tick alongside Prepare/Close. | Not Run |

#### Frontend / UI

N/A — this is a backend-only packet; TELEGRAM has no HTTP surface (`API.md:6`) and no frontend/visual file is touched. If any frontend or visual file enters the diff, fail the implementation and add UI cases first.

#### Chrome DevTools / extension verification

N/A — no browser client is implemented or exercised by this packet. If a browser surface is added, fail the implementation and add Network/Console cases.

#### Operator-executed (post-cutover, see AC-OPERATOR)

| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| OP-1 | Real token validation | On staging, with a throwaway bot token and a private one-person test group, call `getMe()`. | Confirms the token is valid; no error. | Not Run |
| OP-2 | Idempotent close/cancel/announce/weekly-pass firing | Trigger the same quiz close (or cancel, or a live/forced-`now` Announce-pass tick, or a manually-invoked weekly pass) twice against the test group. | Exactly one message lands per kind/target on the test group, not two — including each of TG-1/TG-2/TG-3 firing once at its own due point. | Not Run |
| OP-3 | Kill switch verified locally | Run `wrangler dev` locally with `TELEGRAM_ENABLED=false` and trigger a close/cancel. | No request reaches `api.telegram.org`; local logs/network confirm zero outbound Telegram calls. | Not Run |
| OP-4 | Forced failure does not affect gameplay | Force a 429 then a 403 from a stub in front of the test group, triggered by a real close/cancel. | The quiz's close/cancel data is committed and correct regardless; only the Telegram send is affected. | Not Run |

### 12c. Definition of Done

- [ ] AC-1 through AC-18 are satisfied.
- [ ] AC-OPERATOR is completed or explicitly waived in §5.
- [ ] §5 has no open items — OQ-1 was resolved before this revision and nothing new was introduced.
- [ ] §12a passes locally and in CI; focused RED failures were observed before production implementation.
- [ ] BE-1 through BE-10 have Status other than `Not Run` (target: `Pass`).
- [ ] Frontend and Chrome remain correctly N/A, with no frontend/visual diff.
- [ ] OP-1 through OP-4 are completed or explicitly waived in §5.
- [ ] Every render function stays under 4096 characters and escapes only `&`, `<`, `>`.
- [ ] `claimAndSend` is idempotent for every kind, including the weekly single-claim/four-message shape and the cancelled silent/notify check.
- [ ] `onQuizClosed`/`onQuizCancelled` fire exactly once per fresh commit and can never affect the transaction they're attached to.
- [ ] `src/services/quiz-results.ts` and `src/services/quiz-creation.ts` import nothing Telegram-shaped.
- [ ] `TELEGRAM_ENABLED=false` makes zero real network calls.
- [ ] The Announce pass is discovered via `listDueAnnounce` and production-bound into `src/index.ts`'s minute tick, with per-candidate isolation (AC-15).
- [ ] No weekly cron production wiring, deferred Bot API method, or later-sprint scope entered the diff.
- [ ] §8a Hard NO list and all protected-file/boundary-scan checks are satisfied.
- [ ] §11 rollback was rehearsed mentally, including the weekly-partial-send, stuck-pending-row, and Announce-pass-unbind branches.

---

End of Codex Task Packet — `claude-task--001`
