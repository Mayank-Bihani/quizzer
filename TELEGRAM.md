# Quizzer — Telegram Bot Module

> **Scope:** the `telegram` module only — what it does, what the platform allows, and where it
> will break. Product requirements live in [[PRD]] §5.8; architecture in [[PLAN]] §"Telegram bot
> timeline". This document does not repeat either.
> **Locked:** **plain text, one group, no media, no DMs, no inbound.** Boards are posted as
> **top 10 plus a link**, never in full.
> **Status:** module spec, nothing built. Audited and resolved 2026-09-04 — see [[AUDIT]] §11.
> **Last updated:** 2026-09-09

---

## 1. What this module is

An **outbound announcement channel**. The bot posts into a Telegram supergroup the admins already
run. It is not an identity provider, not a command surface, and not a play surface.

| It does | It does not |
|---|---|
| Post five scheduled kinds plus cancellation | Authenticate anyone (AUTH-6) |
| Format scores, rankings, join links | Accept commands or read group messages |
| Back off under rate limits | Run any part of the quiz |
| Record what it posted, so it never double-posts | DM individual students (deferred — see §9) |

**Consequence:** the module has **no inbound webhook**. Nothing in [[PRD]] requires the bot to
receive an update. `routes/telegram.ts` in [[PLAN]]'s repo structure should be dropped unless a
health endpoint is wanted.

## 2. Requirements covered

TG-1 … TG-7, and BOARD-6 (weekly boards posted to Telegram).

---

## 3. Use cases

The five scheduled posts are cron-triggered; cancellation adds a sixth post kind. The bot has no trigger of its own — it is
called by the `scheduler` module.

| ID | Trigger | Content | Room code? |
|---|---|---|---|
| **TG-1** | T−2h | Quiz name, start time, question count, unit timing summary, individual duration | No |
| **TG-2** | T−30m | "Starting in 30 minutes" | No |
| **TG-3** | Admission begins at T | Join is available, **room code**, seat cap, join link | **Yes** |
| **TG-4** | After safe close and committed ranking | Participant count, **top 10**, participant-only board link | — |
| **TG-5** | Previous IST week complete (Monday cron; delayed if eligible quizzes are unfinished) | **Top 10 by total weekly score** per section + overall, with quizzes taken and a link | — |

**TG-4 fires after safe quiz close and completed ranking, not when the currently joined students finish.** In a self-paced quiz the two
are different moments, and the leaderboard does not exist until admission cutoff + full student
duration + the five-second final delivery window has passed and
the ranking is committed ([[PRD]] BOARD-1). This also means TG-4 has a definite trigger — the
minute-cron pass that successfully closes the quiz.

TG-6 is the rule that gates TG-3: the code is withheld until T so the seat cap is not consumed
hours early. TG-7 is the rule that governs all five: **a failed post must never affect the quiz.**

### 3.1 Message composition

Each use case is a pure template function — input is a plain data object, output is a string. No
network, no DB. Lives in `core/telegram-render.ts` and should be unit-tested against golden strings.

```
renderQuizAnnounce(quiz)          → TG-1
renderStartingSoon(quiz)          → TG-2
renderRoomOpen(quiz, code)        → TG-3
renderQuizResult(quiz, top10)     → TG-4
renderWeeklyBoards(boards)        → TG-5
renderCancelled(payload)          → the 'cancelled' post (§10) — previously in the kind enum and
                                     the schema with no render function at all (COUNCIL_FINDINGS.md #33)
```

Every render function takes **at most 10 rows** and appends a link. None of them is ever handed the
full participant list. Input row limits help bound size, but explicit rendered-length tests
and bounded text are still required (including weekly summaries).
Weekly rows show total score and quizzes taken; they never display or rank by an average.

### 3.2 Bot API methods used

| Method | Used for |
|---|---|
| `sendMessage` | All six post kinds |
| `getMe` | Startup / health check — confirms the token is valid |
| `editMessageText` | *Optional* — updating the T post with a live seat count |
| `pinChatMessage` | *Optional* — pinning the T post; requires bot admin rights |

Nothing else. No `sendPhoto`, no `getUpdates`, no webhook.

---

## 4. Platform limitations

These are Telegram's, not ours. Verify current numbers against the Bot API docs at implementation
time — Telegram has changed them before.

### 4.1 Hard limits

| Limit | Value | Bites us? |
|---|---|---|
| Messages to the **same group** | **~20 per minute** | Not in normal operation — our five posts are hours apart. Bites only if retries or a weekly multi-board post cluster |
| Messages overall | ~30 per second | No |
| Message length | **4096 characters** | **Yes** — see §4.2 |
| Caption length | 1024 characters | No (no media) |
| Bot deletes own message | Within **48 hours** only | Only matters if we ever retract a post |

### 4.2 4096 characters — resolved by posting top 10

A row like `12. Priyanka Sharma — 84.5` is ~30 characters. A full board of ~100 students lands at
3,000–4,000 characters: technically under the limit, but one long name away from a 400, and
unreadable on a phone. TG-5 posting four full boards would blow past it outright.

Every board post is top 10 plus a link. Per-quiz links require participation and show top 10
plus the viewer's row; weekly links lead to full paginated boards. Retain the existing weekly presentation: one
message per section and overall (four messages), orchestrated under the existing weekly claim.
Each rendered message must stay within the length limit, including names and surrounding text.

### 4.3 Behavioural limits

- **A bot cannot start a conversation.** It can only DM a user who has messaged it first. This is
  the blocker on the deferred "DM personal results" feature ([[PRD]] §8) — it needs an explicit
  student-side opt-in flow, not just `users.telegram_id`.
- **Privacy mode.** By default a bot in a group sees only messages addressed to it. Irrelevant to
  us — we read nothing — but it means the bot needs no elevated group permissions to *post*.
- **Group → supergroup migration changes `chat_id`.** If the admins ever convert or upgrade the
  group, the stored chat ID silently stops working (403). Telegram signals the new ID via
  `migrate_to_chat_id` on the error, but only if we look for it.
- **Obtaining `chat_id` is manual.** It is a negative number (e.g. `-1001234567890`) and there is no
  API to look it up by group name. It has to be captured once and stored as config.
- **Markdown is a footgun.** `MarkdownV2` requires escaping `_*[]()~`>#+-=|{}.!` — which includes the
  `.` in a score of `5.44`, the `-` in `−1.00`, and anything in a student's Google display name.
  **Use `parse_mode: "HTML"` and escape only `&`, `<`, `>`.** Far fewer ways to produce a 400.
- **No delivery guarantee or read receipt.** A 200 means Telegram accepted it, nothing more.
- **Ordering is not guaranteed under retry.** A retried TG-1 could land after TG-2.

### 4.4 Our own platform limits

- **Cloudflare cron granularity is 1 minute**, and firing is best-effort — it can be late. TG-3 is
  scheduled at T; a delayed post must not delay admission, which is independently available in the app.
- **Worker subrequest limit is 50 per invocation on the free plan.** Our normal weekly case (four
  board messages, plus retries) is nowhere near, but a future per-student DM loop would blow straight
  through it.
- **`fetch` to `api.telegram.org` works normally from Workers.** No proxy, no special handling.

---

## 5. Failure modes

| Status | Meaning | Response |
|---|---|---|
| **429** | Flood control | Read `parameters.retry_after`, sleep, retry once. Do not retry in a tight loop |
| **400** | Malformed request — usually bad HTML escaping or over 4096 chars | Do **not** retry. Log with the rendered body. This is a bug, not a transient |
| **401** | Bad or revoked token | Do not retry. Alert |
| **403** | Bot removed from group, or `chat_id` migrated | Do not retry. Alert. Check for `migrate_to_chat_id` |
| **5xx / timeout** | Telegram side | Retry with backoff, max 3 attempts, then give up |

**TG-7 in practice:** every send is wrapped so that no failure propagates. A quiz that cannot be
announced still opens, still runs, still scores. The scheduler must never `await` a Telegram call
in a way that can delay a room opening.

### 5.1 The TG-3 / TG-7 contradiction — resolved

TG-7 says a failed post never affects the quiz. But TG-6 withholds the room code until TG-3, and
TG-3 was originally the only place it was published — so a failed T post meant **no student could
join and the quiz silently did not happen.**

**Resolved by [[PRD]] TG-8:** the web app lists open quizzes to any signed-in student once admission begins. The room code is now a convenience for people arriving from Telegram, not the gate. One
endpoint, and the single point of failure is gone.

Until that endpoint ships in Phase 4, TG-3 must be treated as quiz-critical and alerted on, not
fire-and-forget.

---

## 6. Interfaces

**Exposes to [[SCHEDULER]]** — the only caller, and the reason `telegram_posts` stays at one
writer ([[AUDIT]] §3.1):

```ts
claimAndSend(kind, quizId | weekStart, payload) → { sent: boolean; skipped: boolean }
```

`payload` for TG-4 is the `top10` DTO returned directly by [[QUIZZING]]'s `closeQuiz`; for the
`'cancelled'` kind it's a `CancelledPayload` forwarded by [[SCHEDULER]] from the admin cancel
route (§10) — this module never reads `participants` itself, and never calls [[QUIZZING]].

## 7. Idempotency and state

Cron can fire twice. A retry after a timeout can double-post. Without state, students see
"Starting in 30 minutes" three times.

The module needs one small D1 table:

```sql
telegram_posts   quiz_id NULL,          -- NULL for weekly posts
                 kind,                  -- 'announce'|'soon'|'open'|'result'|'weekly'|'cancelled'
                 week_start NULL,       -- set for 'weekly'
                 status,                -- 'pending'|'sent'|'failed'
                 message_id NULL,       -- Telegram's — only known after a send succeeds
                 error NULL,            -- set when status='failed'
                 claimed_at,            -- when this row was inserted (the claim)
                 sent_at NULL           -- only known after a send succeeds
                 UNIQUE(quiz_id, kind), UNIQUE(week_start, kind)
```

Rule: **claim the row first, then send.** But the claim itself is now two steps, not one insert
(COUNCIL_FINDINGS.md #1): `message_id` and `sent_at` cannot be known at claim time — the Bot API
hasn't been called yet — so they can't be `NOT NULL` the way an earlier version of this table had
them. Insert with `status = 'pending'` first; if the insert conflicts on the unique constraint,
someone already claimed this post — skip. Then call the Bot API: on success, `UPDATE` to
`status = 'sent'` with `message_id`/`sent_at`; on a permanent failure (§5's non-retryable statuses),
`UPDATE` to `status = 'failed'` with `error` set, so the failure is alerted rather than silently
retried forever, and a stuck `'pending'` row (a crash mid-send) is distinguishable from either
outcome.

This table is also what makes `editMessageText` (live seat count on the TG-3 post) possible later.

---

## 8. Configuration

| Key | Type | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Worker **secret** | Never in `wrangler.toml`. Separate token for staging |
| `TELEGRAM_CHAT_ID` | Worker var | The supergroup, negative integer. Separate group for staging |
| `TELEGRAM_ALERT_CHAT_ID` | Worker var; required in production | Where `observability` sends failure alerts — must **not** be the student group |
| `TELEGRAM_ENABLED` | Worker var | Kill switch. Off in local dev so `wrangler dev` never posts to a real group |

A real bot token in a local `.dev.vars` pointed at the real group is the most likely way to spam
100 students during development. The kill switch defaults to off.

---

## 9. Deferred

- **Per-student DMs of results.** Blocked on §4.3 — needs a student-initiated opt-in (deep link
  `t.me/<bot>?start=<token>`), not just a stored `telegram_id`.
- **Live seat count** on the TG-3 post via `editMessageText`.
- **Pinning** the T post. Needs the bot promoted to admin with `can_pin_messages`.
- **Inline join button** (`reply_markup` URL button) instead of a bare link.

## 10. Open questions

| # | Question | Status |
|---|---|---|
| 1 | TG-5 format | **Resolved** — top 10 per board, one message per section (§4.2) |
| 2 | Is the open-quiz list in the web app built, so TG-3 stops being a single point of failure? | **Resolved** — yes, [[PRD]] TG-8. Still needs building in Phase 4 |
| 3 | Does TG-4 fire if zero students joined? | **Resolved 2026-09-05** — yes, with a one-line "nobody played" variant, so silence always means a bug ([[SCHEDULER]] §8) |

**Resolved 2026-09-04** (see [[AUDIT]] §11) — **#3, cancelled quiz post:** yes, if TG-3 (room open)
already posted, a cancellation notifies the group; if it never went live, cancelling is silent —
nobody was told to expect it. **Routed through [[SCHEDULER]], not a direct call from
[[QUIZZING]]** (COUNCIL_FINDINGS.md #33 — an earlier version of this note had the admin cancel
route calling `claimAndSend` directly, contradicting §6's "SCHEDULER is the only caller"). The
cancel route hands a `CancelledPayload` to [[SCHEDULER]], which forwards it into `claimAndSend`
the same way `closeQuiz`'s result is forwarded for TG-4 — keeping [[MODULES]]'s "nothing points
back up" true for this kind too.

## 11. Testing

- **Unit** — the five render functions against golden strings, including a student name containing
  `<`, `&`, and an em dash; and a 100-row weekly board asserting the output stays under 4096.
- **Integration** — a throwaway bot token and a private test group of one. Assert idempotency by
  invoking the same cron twice and checking only one message lands.
- **Failure injection** — stub the API to return 429 with `retry_after`, then 403, and assert the
  quiz proceeds untouched in both cases.
- **Never** point a dev environment at the real student group.

## 12. Timed-unit revision (2026-09-09)

Preparation still runs at T−5m, but no room code or join invitation is published until admission
begins at T. `QuizAnnouncePayload` supplies scheduledAt/endsAt, graded questionCount, unitCount,
windowSec and timingSummary (kind, count, minTimeSec, maxTimeSec). Format these values; do not
read bank/quiz tables to calculate timings. There are no bonus, scoring-grace or uniform
per-question timing fields. Labels distinguish admission closing from each student's duration.

Result posts wait for the safe close boundary and committed board. Weekly posts wait for all
non-cancelled eligible quizzes in the completed IST week to publish results, even when an
individual run crosses midnight. The scheduler handles retries; Telegram only claims/sends.
Golden-message tests must cover mixed unit allowances and the absence of V1 bonus wording.
