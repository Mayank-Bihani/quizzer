---
name: quizzer-sprint
description: Orchestrate the Quizzer mockup sprints — dispatch the next sprint (or a named one, or several in parallel) to subagents, verify their work, and keep PROGRESS.md current. Use when asked to run, continue, or orchestrate the mockup sprints, or when the user names a sprint like S1 or S4.
user-invocable: true
---

# Quizzer mockup orchestrator

You dispatch sprints. **You do not build screens yourself.**

## Every run

```bash
bash mockups/next.sh          # what is done, ready and blocked, + a brief for the next one
bash mockups/next.sh S4       # the brief for a specific ready sprint
```

Then, per sprint you dispatch:

1. **Spawn one subagent**, passing the brief `next.sh` printed, verbatim.
2. When it returns, **run `bash mockups/check.sh` yourself**. A subagent saying "done" is
   not evidence. If it fails, send the failures back to the same agent rather than fixing
   them yourself — the agent that wrote it knows the markup.
3. Confirm it ticked its row in `mockups/PROGRESS.md` and added its screens to
   `mockups/index.html`. Do it yourself if it forgot.
4. Report to the user: sprint, screens built, check result, gaps, what is ready next.

## Parallelism

`next.sh` prints READY. Everything on that line is in a **different chain**, so those sprints
touch disjoint files and may be dispatched **concurrently**. Two sprints in the same chain
must not — the later one reuses components the earlier one defines.

```
S0 ──┬── S1
     ├── S2 → S3
     ├── S4 → S5 → S6
     ├── S7 → S8
     └── S9 → S10
```

**One hard rule: never let two concurrent subagents write `css/components.css`.** If two
in-flight sprints both need a new shared component, dispatch one, let it land, then the other.
When in doubt, run them one at a time — the throughput gain is not worth a merge conflict in
the component layer.

## Review gates

**Stop and hand back to the user after S2.** The live run sets the chrome every remaining
student screen inherits. Do not roll straight on to S3.

(The S0 gate has passed — S0 is built, audited against the design system, and confirmed.)

## Do not

- Build screens yourself. Dispatch them.
- Fix a subagent's failures yourself, beyond a trivial one-liner.
- Start a sprint whose dependency is not `done` in `PROGRESS.md`.
- Weaken a check in `check.sh` to make a sprint pass.
- Gate on your own token usage — subagents have their own context windows, and
  `PROGRESS.md` is the resumption mechanism. Finishing a sprint and stopping is always safe.
