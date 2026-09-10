# Backend spec progress

> Tracks one `claude-task--001--<slug>.md` packet per phase, produced by `spec-writer` and
> dispatched by the `quizzer-backend-spec` orchestrator (`.claude/skills/quizzer-backend-spec/`).
> Phase numbering and scope match `MODULES.md` §7's build order exactly — this file doesn't
> re-derive it, just tracks packet status against it.
>
> Unlike the mockup sprints, spec packets share no files with each other (each is a new file in
> its own `todos/sprint N/`), so there is **no write-conflict chain** — any ready sprint can be
> dispatched in parallel with any other. The "Depends on" column tracks *logical* dependency
> (does this phase's spec need to reference an earlier phase's resolved interface?), not a
> file-conflict constraint like the mockups' chain does.

| Sprint | Phase | Scope | Depends on | Status | Packet |
|---|---|---|---|---|---|
| 1 | 1 | AUTH — sign-in, roles, sessions, route guards, superadmin bootstrap | — | done | `todos/sprint 1/claude-task--001--google-auth-roles-guards.md` |
| 2 | 2 | BANK — CSV import, passages, questions, images, admin CRUD | 1 | done | `todos/sprint 2/claude-task--001--bank-csv-import-admin-crud.md` |
| 3 | 3 | QUIZZING creation — auto-pick, composition report, lock + retire, draft state, room code | 1, 2 | done | `todos/sprint 3/claude-task--001--quizzing-creation-draft-lock-reshuffle.md` |
| 4 | 4 | QUIZZING run + SCHEDULER open/close — join, seat claim, answer-and-advance, self-paced timing, 120-client load test | 1, 2, 3 | in-progress | — |
| 5 | 5 | QUIZZING results — close job, claim-first ranking, score-on-finish, deadline-gated review | 1, 3, 4 | pending | — |
| 6 | 6 | TELEGRAM — the six posts, claim-then-send idempotency | 4, 5 | pending | — |
| 7 | 7 | QUIZZING boards + SCHEDULER recurring — weekly boards (IST-anchored), recurring templates | 1, 2, 3, 5 | pending | — |
| 8 | 8 | Hardening — mobile polish, admin report export, SCHEDULER-owned failure alerts (Telegram + email) | 1–7 | pending | — |

**Status values:** `pending` (not yet dispatched) → `in-progress` (subagent dispatched, not
returned) → `written` (packet on disk, not yet verified) → `done` (verified: 13 sections present,
citations spot-checked, no `<INPUT_REQUIRED>` left unflagged in the summary).

**Review gate: passed.** Sprints 1–2 landed, were verified (citations spot-checked, both `done`),
and one real design gap Sprint 2 surfaced (`GET /api/images/:key`'s per-student scoping vs. "BANK
never reads QUIZZING's tables") was resolved by the project owner — no per-question scoping,
`requireAuth()` only (`COUNCIL_FINDINGS.md` #11, reconsidered; `BANK.md`/`API.md`/`AUTH.md`
updated to match). Sprints 3–8 are clear to dispatch.
