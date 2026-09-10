---
name: prod-safety-gate
description: Review implementation plans and changes that affect production traffic, persistent data, scheduled jobs, external services, migrations, or deployment configuration. Use to make rollout, failure detection, rollback, and operator steps concrete; do not invoke for isolated documentation or local-only edits.
---

# Production safety gate

Apply this skill to a production-facing implementation spec or change before declaring it ready.
Keep the review proportional to Quizzer's small single-group deployment while protecting data,
quiz availability and secret-bearing integrations.

## Gate

Identify the exact production surfaces involved: HTTP routes, D1 tables/migrations, KV/R2 keys,
cron handlers, Telegram/email calls, Worker bindings and secrets. For each applicable surface:

1. State the precondition that must hold before rollout.
2. Define an observable verification that proves the new path works.
3. Define how failure is detected without relying on a student's report.
4. Give a reversible rollback step. If persistent data changes cannot be reversed safely, use a
   forward repair and state that constraint plainly.
5. Separate implementer-run checks from operator actions involving live accounts or provider UIs.

For D1 changes, specify migration ordering, compatibility with the currently deployed code,
transaction or batch boundaries, retry/idempotency behavior and rollback/forward-repair handling.
For cron or external sends, prove duplicate invocation is safe and that an external outage cannot
block quiz state transitions. For auth or secrets, pair with `vibesec` and keep secret values out
of commands, fixtures and logs.

Do not require deployment approval while drafting or validating a spec. Ask for authorization
only immediately before an actual live mutation that is not already authorized.

## Ready condition

A production-facing packet or change is ready when its acceptance criteria cover the normal path
and one meaningful failure path, its verification commands exist, its operator-only actions are
clearly labeled, and its rollback plan restores a usable system without exposing secrets or
publishing partial quiz results.
