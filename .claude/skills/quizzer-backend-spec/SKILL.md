---
name: quizzer-backend-spec
description: Orchestrate fresh Quizzer backend implementation packets by dispatching the spec-writer skill once per tracked sprint, validating citations and module boundaries, and updating todos/PROGRESS.md. Use when asked to create, continue, review, or regenerate Quizzer backend specs. Do not use to implement packet contents or revise product requirements.
---

# Quizzer backend spec orchestrator

Create the backend task packets tracked in `todos/PROGRESS.md`. Dispatch a fresh agent with the
`spec-writer` skill for each packet. The orchestrator coordinates, validates and records progress;
it does not draft packets or implement application code itself.

## Authority and exclusions

Read these before dispatching anything:

1. `todos/PROGRESS.md` for packet scope, dependencies and status.
2. `PRD.md` for product requirements and accepted tradeoffs.
3. `PLAN.md` and `MODULES.md` for architecture, ownership and build order.
4. `DATA_MODEL.md`, `CONTRACTS.md`, `API.md`, `src/core/contracts.ts`, `src/core/api.ts` and
   `migrations/0001_init.sql` for exact storage and wire boundaries.
5. The owning module documents named in the packet plan below.

The current documents and repository state are authoritative. Apply these exclusions:

- Never read or cite `archive/backend-specs/**` while generating or reviewing a new packet.
  Those files prove history only. They are not re-spec inputs or comparison material.
- Do not use `AUDIT.md` or `COUNCIL_FINDINGS.md` as requirements. They are historical records;
  follow a current document's explicit citation to them only when the reasoning is needed.
- Mockups predate the current timing model. They may inform later frontend work, but cannot
  override backend requirements or contracts.
- Do not invent defaults, routes, fields or product behavior to fill a gap. A production-critical
  gap becomes `<INPUT_REQUIRED>` under the `spec-writer` rules and is surfaced to the user.

## Normal run

1. Read `todos/PROGRESS.md` and identify the requested sprint, the next `pending` sprint, or all
   remaining sprints when the user says to continue or finish the specs.
2. Work in numeric sprint order. Run one packet agent at a time so each later packet can be
   checked against already accepted module interfaces. A specifically requested sprint may be
   generated directly from current authoritative sources even if an earlier packet is pending.
3. Before dispatch, set that tracker row to `in-progress`. Create `todos/sprint N/` when absent.
4. Dispatch a fresh subagent with the exact brief template below. Require it to invoke
   `spec-writer`; do not substitute a home-grown packet format.
5. When the agent returns, set the row to `written`, run the validator, and perform the semantic
   review below. Return failures to the same agent for correction.
6. Set the row to `done` and record its relative packet path only after every validation passes.
7. For an all-remaining run, continue with the next numeric sprint. `todos/PROGRESS.md` is the
   resumption state if the orchestration session ends between packets.

No inherited human review gates apply. Stop only for a real `<INPUT_REQUIRED>` decision, a failed
validation the packet agent cannot repair, or an explicit user request to review before continuing.

## Packet plan

Every packet also reads the global sources listed under Authority and exclusions.

| Sprint | Packet scope | Owning sources |
|---|---|---|
| 1 | AUTH: Google sign-in, 30-day stateless session, roles, guards, bootstrap and admin roster endpoints | `AUTH.md`; `API.md` AUTH; `CONTRACTS.md` §2; `users` schema |
| 2 | BANK: CSV preview/commit, optional source/subtopic, RC/LRDI groups, questions, R2 images and admin CRUD | `BANK.md`; `API.md` BANK; `CONTRACTS.md` §3; `passages`/`questions` schema; bank fixture |
| 3 | QUIZZING creation: whole-group draw, ordered units, timing policy/overrides, derived duration, reshuffle, lock/retire and admission schedule | `QUIZZING.md` §1–4 and §8–12; `API.md` creation; `quiz_templates`/`quizzes`/`quiz_units`/`quiz_questions` schema |
| 4 | QUIZZING run plus SCHEDULER: join/seats, active-unit delivery, local drafts, Back/Clear/Skip, automatic atomic batch closure, five-second receipt window, progression, timeout, prepare/safe-close eligibility, alerts and 120-client load test; ranking publication remains Sprint 5 | `QUIZZING.md` §5 and §10–12; `SCHEDULER.md` §1–4.1 and §5–9; `API.md` run; `CONTRACTS.md` §4–5; runtime schema |
| 5 | QUIZZING results: final settlement at safe close, marks, atomic dense ranking publication, holding/status, participant review, full-room MCQ distribution and per-unit timing | `QUIZZING.md` §6–7 and §10–12; `API.md` results; `CONTRACTS.md` §5; result/runtime schema |
| 6 | TELEGRAM: six post kinds, timing summaries, total-score payload consumers and claim-then-send behavior | `TELEGRAM.md`; `CONTRACTS.md` §6; `telegram_posts` schema |
| 7 | Weekly boards and recurring: total weekly score, IST attribution, dense ties, publication completeness, template materialization and derived unit duration | `QUIZZING.md` §7; `SCHEDULER.md` §4.2–4.3 and §5–9; weekly/template contracts and schema |
| 8 | Backend hardening and admin report export: security/secrecy sweep, capacity rerun, report route, operational configuration and launch evidence | `PRD.md` §6–7; `MODULES.md` cross-cutting sections; `QUIZZING.md` §7 and §12; `SCHEDULER.md` alerts; `API.md` report |

Use `todos/PROGRESS.md` as the live statement of scope if it changes later. Update this table when
the tracker gains, removes or splits a sprint; do not let the two silently diverge.

## Exact dispatch brief

Fill the placeholders without paraphrasing the scope or source paths:

```text
Invoke the spec-writer skill to produce one implementation task packet for Quizzer backend
Sprint <N>.

Requirement: <copy the Backend scope cell from todos/PROGRESS.md exactly>.

Output: todos/sprint <N>/claude-task--001--<3-5-word-slug>.md. This is the only file you may
create or edit. Do not implement application code and do not edit project documents or the
progress tracker.

Read the current authoritative sources before drafting:
- PRD.md
- PLAN.md
- MODULES.md
- DATA_MODEL.md
- CONTRACTS.md
- API.md
- src/core/contracts.ts
- src/core/api.ts
- migrations/0001_init.sql
- <owning sources for Sprint N>

The current documents and repository state are authoritative. Do not open, compare with, or cite
archive/backend-specs/**. Do not treat AUDIT.md, COUNCIL_FINDINGS.md or stale mockups as current
requirements. Do not re-litigate decisions explicitly resolved in current sources.

Follow spec-writer's complete packet workflow, citation rules, skill matrix and mandatory QA
tables. Ask only production-critical questions allowed by that skill. Mark a genuinely missing
decision as <INPUT_REQUIRED>; never guess it. Return only the short post-write summary required
by spec-writer.
```

## Validation after each packet

Run the deterministic check from the repository root:

```bash
python3 .claude/skills/quizzer-backend-spec/scripts/validate_packets.py \
  "todos/sprint N/claude-task--001--<slug>.md"
```

Then review what a structural script cannot decide:

1. Confirm the packet covers exactly its tracker scope and explicitly excludes later phases.
2. Inspect every `<INPUT_REQUIRED>`. Return questions already answered by current documents to
   the packet agent; surface only a genuinely absent product/data/security decision to the user.
3. Spot-check at least three cited locations, including one contract/type and one schema or module
   boundary. The validator checks existence and line bounds, not whether a cited line proves the
   sentence.
4. Check table ownership against `MODULES.md`: SCHEDULER issues no SQL, BANK owns bank writes,
   AUTH owns users, TELEGRAM owns post bookkeeping, and QUIZZING owns quiz/runtime/result tables.
5. Check cross-packet interfaces against current `src/core/contracts.ts` and `src/core/api.ts`.
   Current contracts override an earlier packet if drift is found; send the later packet back for
   correction and revalidate.
6. Check the V1 invariants relevant to the packet: timed RC/LRDI units, timed standalone units,
   local navigation within the active unit, one final atomic batch, five-second transport only,
   no speed bonus, no reopening closed units, weekly total score, and solution secrecy.
7. Confirm §12 commands exist in this repository. Missing installed dependencies may be a stated
   pre-flight condition; invented scripts or CI commands are a failure.

## Final corpus review

After all requested packets are `done`—and always after all eight are complete—run the validator
without a path so it checks the entire active corpus:

```bash
python3 .claude/skills/quizzer-backend-spec/scripts/validate_packets.py
```

Then build a compact coverage matrix from every packet's §9: routes, tables written, contract
types consumed/produced and scheduled jobs. Check it against `MODULES.md`, `API.md`,
`src/core/contracts.ts`, `src/core/api.ts` and `migrations/0001_init.sql`. Every V1 route/table/job
must have one implementation owner; no two packets may independently implement the same write or
redefine the same wire type. Return a collision or uncovered requirement to the responsible
packet writer, rerun its checks, and revalidate the full corpus. Do not use archived packets in
this review.

## Progress updates and stopping

Use tracker statuses exactly: `pending → in-progress → written → done`. A packet containing an
unresolved `<INPUT_REQUIRED>` remains `written`; include its path and the concise question in the
tracker. Do not mark implementation complete—the tracker measures packet readiness only.

Report each completed packet with its path, validator result, open-question count and next sprint.
Do not paste the packet into chat. Do not begin implementation after spec generation.

## Hard rules

- One `spec-writer` invocation produces one packet.
- Never copy, diff or summarize archived packets for the writer.
- Never generate several modules as one oversized packet merely to reduce file count.
- Never silently edit a packet yourself after dispatch; send corrections to its writer and then
  validate independently.
- Never ask the user to decide an implementation detail already fixed by the authoritative docs.
- Never let packet generation modify source, schema, configuration, product docs or mockups.
