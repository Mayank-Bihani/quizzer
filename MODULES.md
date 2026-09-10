# Quizzer — Module Map

> **Scope:** the index. Which modules exist, what each owns, and where the boundaries are.
> Requirements live in [[PRD]]; architecture in [[PLAN]].
> **Status:** boundaries agreed, nothing built. Audited and resolved 2026-09-04 — see [[AUDIT]] §11.
> **Last updated:** 2026-09-09

---

## The five modules

| Module | Owns | Phase |
|---|---|---|
| **[[AUTH]]** | Google sign-in, roles, sessions, route guards, superadmin bootstrap | 1 |
| **[[BANK]]** | CSV import, questions, passages, images, admin CRUD | 2 |
| **[[QUIZZING]]** | Creation & selection · the run · scoring & results · leaderboards | 3, 4, 5, 7 |
| **[[SCHEDULER]]** | Everything time-driven: open, announce, close, tally, recur | cross-cutting |
| **[[TELEGRAM]]** | Six outbound post kinds, one group, plain text | 6 |

Plus two cross-cutting concerns that are not modules but need an owner: **storage** and
**observability** (§5, §6).

## Dependency direction

```
                      ┌──────────────┐
                      │  SCHEDULER   │   no user in front of it
                      └──┬────────┬──┘
              opens/closes│        │triggers posts
                          ▼        ▼
   ┌────────┐  claims  ┌──────────┐   ┌──────────┐
   │  BANK  │◀─────────│ QUIZZING │   │ TELEGRAM │
   └────────┘  reads   └──────────┘   └──────────┘
        ▲                    ▲              
        └────────┬───────────┘              
                 │ gates every request      
            ┌────────┐                      
            │  AUTH  │                      
            └────────┘                      
```

**Nothing points back up.** [[TELEGRAM]] never calls into [[QUIZZING]]; [[SCHEDULER]] calls both and
neither calls it. [[BANK]] knows nothing about quizzes beyond an id it is handed.

**Every arrow above is a named call** — full signatures, DTOs, and the one data-only relationship
(`CloseResult`/`BoardSummary` reaching [[TELEGRAM]] with no function call attached) live in
[[CONTRACTS]], with the types themselves in `src/core/contracts.ts`. Each module's own
"Interfaces" section is still accurate; [[CONTRACTS]] is the cross-reference.

---

## Table ownership — one writer each

The boundary check that matters. If two modules write the same table, the boundary is wrong.

| Table | Sole writer | Read by |
|---|---|---|
| `users` | [[AUTH]] | everyone |
| `passages`, `questions` | [[BANK]] | [[QUIZZING]] (reads; retires **via** `claimUnused`) |
| `quizzes`, `quiz_templates`, `quiz_units`, `quiz_questions` | [[QUIZZING]] | SCHEDULER receives metadata through calls; TELEGRAM receives DTOs |
| `quiz_seats` | [[QUIZZING]] | — |
| `participants`, `participant_units`, `answers` | [[QUIZZING]] | — |
| `weekly_boards` | [[QUIZZING]] | TELEGRAM receives BoardSummary payloads |
| `telegram_posts` | [[TELEGRAM]] | SCHEDULER failure checks via the service adapter |

**The one shared boundary, made explicit:** [[QUIZZING]] decides *which* questions to retire, but the
write happens inside [[BANK]] through a single function, so every write to `questions` lives in one
module.

```ts
claimUnused(questionIds, quizId, quizNumber) → string[]   // newly or already confirmed for this same quiz identity
```

**[[SCHEDULER]] is a caller, not a writer.** It appears nowhere as a sole writer above because it
issues zero SQL of its own — every table it triggers a change to (`quiz_seats`, `quizzes`,
`participants`, `participant_units`, `answers`, `weekly_boards`, `telegram_posts`) is written by calling a named
function on [[QUIZZING]] or [[TELEGRAM]]. See each module's own "Interfaces" section for the four
QUIZZING signatures. This used to be an unnamed arrow in the diagram below; [[AUDIT]] §3.1 is why it now has
a signature.

### KV keyspace ownership

The same one-writer discipline as the table above, applied to the cache. KV had no ownership row
at all before [[AUDIT]] §5 — this is that row.

| Key pattern | Written by | Read by |
|---|---|---|
| `jwks:*` | [[AUTH]] | [[AUTH]] |
| `role:<uid>` | [[AUTH]] | [[AUTH]] (session guards, `currentUser`) |
| `unit:<quizId>:<unitPosition>` | [[QUIZZING]] inside `openRoom` | Redacted `UnitContent` only: one whole unit, with no solutions, student timestamps or drafts. Personal clocks always come from D1. |
| `board:<quizId>` / `board:<weekStart>` | [[QUIZZING]] — inside `closeQuiz` / `computeWeeklyBoards`, called by [[SCHEDULER]] | [[QUIZZING]] (leaderboard routes) |

[[SCHEDULER]] never touches KV directly, for the same reason it never touches D1 directly — the
warming happens inside the [[QUIZZING]] function it calls.

---

## Two things that are easy to get backwards

**1. The Telegram bot triggers nothing.** [[SCHEDULER]] fires the announcement and the room opening
independently. If the bot were in the chain, a Telegram outage would cancel a quiz — which
contradicts TG-7.

**2. Questions are picked at quiz creation, not at T−5 minutes.** Locking a quiz is what retires
its questions (QUIZ-5). At T−5m the room only *opens*: seed the seats, warm the cache, flip the
status. Picking late would mean the admin never previews their own quiz (QUIZ-4), the composition
report has nothing to report (QUIZ-3), and pool exhaustion would fail five minutes before a quiz
with a hundred students waiting.

---

## 5. Storage (cross-cutting)

R2, for question images only. Small enough not to warrant its own document, big enough to need an
owner: key scheme, companion-ZIP unpack on import, and serving. **[[BANK]] owns it end to end** —
written on import, and served via its own `GET /api/images/:key` route ([[AUDIT]] §5 flagged
serving as unowned; it is now [[BANK]]'s, the same module that already owns the key scheme).

Free tier is 10 GB with zero egress, which this app will not approach.

## 6. Observability (cross-cutting, owned by [[SCHEDULER]])

**Resolved (project owner):** owned by [[SCHEDULER]], not a sixth module — it's a handful of
checks riding on the minute tick [[SCHEDULER]] already runs, not a separate architectural layer.
Same pattern as Storage (§5, owned by [[BANK]] because [[BANK]] already does the related work).
[[PRD]] G1 is "runs with no operator present," which is the reason this exists at all: an
unattended 9pm quiz that breaks needs someone told, not silently discovered by a student
complaining the next morning.

**Dual-channel alerting** — every alert fires on **both** channels, neither replacing the other,
since either platform having its own outage shouldn't mean silence:

- **Telegram** — a separate alert chat, not the student group ([[TELEGRAM]] §8's
  `TELEGRAM_ALERT_CHAT_ID`)
- **Email** — the project owner's personal address, via Cloudflare's own Email Routing
  (`send_email` binding) rather than a third-party API — no new account or secret to manage,
  same "just a binding" pattern as D1/KV/R2. **Prerequisite: this requires the Worker to be on a
  real Cloudflare zone/domain, not the default `*.workers.dev` subdomain** — Email Routing can't
  send from a `workers.dev` address. V1 standardizes on this binding; attaching the domain and
  verifying the destination are launch prerequisites rather than selecting a second provider.

**Minimum viable version — two checks on [[SCHEDULER]]'s existing minute tick (§4.1 there), plus
one failure result from the hourly materialization pass:**

- **A quiz reached the safe close point (admission cutoff + full individual duration + the
  five-second delivery window) and is still not closed a
  three minutes later.** Checked after the tick's own Close pass would have handled it, with a
  fixed three-minute alert delay so this doesn't fire on ordinary same-minute timing — only on a close
  attempt that genuinely didn't happen.
- **A Telegram post is sitting at `status = 'failed'`** (COUNCIL_FINDINGS.md #1) — checked right
  after the tick's Announce pass. No dedup between ticks for now: a failed post keeps alerting
  every minute until someone fixes it, which is arguably the point at this scale rather than a
  bug to fix.
- **A recurring occurrence fails because the pool is exhausted or its timing configuration is
  missing.** QUIZZING returns only the template ID, candidate scheduled time and safe failure code;
  SCHEDULER sends that result through both private channels after the hourly materialization call.
  A failed occurrence or alert does not block healthy sibling occurrences. The alert may repeat on
  later hourly retries until the cause is fixed.

**Descoped for now, not forgotten:** alerting on an auth/D1 error-rate spike needs request-level
error tracking across every route, not a cron-tick check — that's a materially bigger piece of
work (closer to the "real module" this section explicitly isn't) than the targeted checks above.
Revisit if it's ever actually needed.

**Also descoped:** general structured per-job logging and a dedicated run-record report. The columns
that would back a run record already exist (`opened_at`/`ended_at`/`board_computed_at` on
`quizzes`, COUNCIL_FINDINGS.md #17) — nothing currently reads them into a report, and nothing
requires that it should, given the targeted alerts above are what actually matter.

Observability remains a cross-cutting SCHEDULER responsibility and lands in backend phase 4.

## 6.5 Client (cross-cutting)

The React app in `web/`. Not a module with routes or table ownership — the home for the handful of
concerns that belong to no backend module ([[AUDIT]] §5):

- **LaTeX rendering** (BANK-3) — [[BANK]] stores `body_md`/`explanation_md` as raw markdown; the
  client renders `$...$` with KaTeX. [[BANK]] disclaims this by design; nobody else claimed it
  until now.
- **Silent session refresh** — resolved as **not built** ([[AUTH]] §7): the 30-day session TTL is
  generous enough that re-login on lapse (one click via Google) is an acceptable UX, so there's no
  client-side refresh flow to build here.
- Unit and overall countdowns against the authoritative deadlines returned by QUIZZING.
- Navigation, answer/skip/clear state and persistent browser-local drafts within the active unit.
- Freeze and batch-submit on the final outstanding response or timer expiry; preserve the exact
  pending batch until acknowledgement and handle retries without unlocking edits.
- Restore local drafts only for the matching current unit; no cross-device draft guarantee.

Mobile-first layout (NFR-5) is deliberately **not** listed here — it's a design deliverable, not a
module-ownership gap, and the existing mockups require timing/navigation updates before frontend implementation.

---

## 7. Build order

Backend first: settle ownership/contracts, write specs, implement and verify backend phases,
then build the frontend and integrate the APIs. Existing `todos/` packets are intentionally
unchanged by the 2026-09-09 revision and require a separate update before implementation.

**[[PRD]] §7 is the single authoritative requirement↔phase mapping** — it lists exact req IDs per
phase. The table below adds the shipped-artifact description that [[PRD]] §7 doesn't carry; it is
not a second source of truth ([[AUDIT]] §6 found the two tables had drifted apart).

| Phase | Module | Delivers |
|---|---|---|
| 1 | [[AUTH]] | Sign-in, roles and admin-management endpoints |
| 2 | [[BANK]] | CSV import, passages, images, admin CRUD |
| 3 | [[QUIZZING]] creation | Auto-pick, composition report, lock + retire, scheduling |
| 4 | [[QUIZZING]] run + [[SCHEDULER]] open/close | Unit delivery, batch closure, marks, timers — **plus the 120-client load test** |
| 5 | [[QUIZZING]] results | Close job, ranking, score-on-finish, deadline-gated review |
| 6 | [[TELEGRAM]] | The six post kinds, idempotent |
| 7 | [[QUIZZING]] boards + [[SCHEDULER]] recurring | Weekly boards, recurring templates |
| 8 | — | Backend hardening and report export; mobile polish after frontend integration |

**Observability lands in Phase 4**, not Phase 8. It is what tells you the load test — and the first
real quiz — actually behaved.

## 8. Open questions by module

Each module document carries its own list. The ones that change a schema, and so want deciding
early:

None remain.

**Resolved 2026-09-04** (see [[AUDIT]] §11): editing a used question — body/explanation stay
editable, the key freezes forever; `import_id` — confirmed, in the migration.

**Resolved 2026-09-05** (project owner, see [[PRD]] §9): pool exhaustion — fail loudly; window
length — auto-derived; seat cap — kept at 120; session TTL — 30 days, no silent refresh
([[AUTH]] §7).

## 9. Timed-unit boundary (2026-09-09)

BANK owns shared RC/LRDI material, question membership/order, import validation and retirement.
It stores no quiz timing or student drafts. QUIZZING creates ordered `quiz_units` from that
content, assigns occurrence allowances, persists `participant_units` clocks/closure receipts,
and grades one final answer batch per unit. The browser owns provisional responses and selected
subquestion; local Back/Skip never writes D1. SCHEDULER starts no individual unit timer.

The cached content boundary is `UnitContent`, not a full bank row or a `ServedUnit` carrying
personal deadlines. Results expose unit timing once and per-question marks separately.
See [[DATA_MODEL]] for all 13 tables and [[CONTRACTS]] for exact types.
