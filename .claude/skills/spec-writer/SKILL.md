---
name: spec-writer
description: Produce a 13-section implementation spec ("task packet") that another Claude session can ship from. Triggers on `/spec`, "write a spec", "scope this", "spec this out", "task packet", "claude-task". Auto-detects sprint folder, task number, and slug; runs a hybrid pre-spec interview (max 3 production-critical questions, otherwise marks gaps as `<INPUT_REQUIRED>`); grounds every claim in `path:line` citations from the actual code; mandates Manual QA tables (BE / FE / Chrome DevTools / Operator). Always pairs with `clean-code`; pulls in `prod-safety-gate` for production paths, `test-driven-development` for behavior changes, and `vibesec` for security-sensitive code.
---

# spec-writer — 13-section task-packet generator

You are producing **one spec file** that another Claude session (or human implementer) can ship from end-to-end. The output is a `claude-task--NNN--<slug>.md` packet inside `todos/sprint N/` of the **target codebase**, structured as 13 sections.

**Do not implement the spec.** This skill produces the packet; implementation happens in a separate session.

---

## 1. When to fire

**Fire on:**
- Explicit invocation: `/spec`, `/spec-writer`.
- Semantic phrases: "write a spec", "scope this", "spec this out", "write a task packet", "draft a claude-task", "turn this into a packet".

**Do not fire on:** routine code edits, generic discussion of a feature, vague "what do you think about X" exploration. The user is asking for a written, file-on-disk packet — don't invent a spec when they just want to chat.

---

## 2. Capture inputs

You need three things:

1. **Target codebase root** — default to:
   ```bash
   git rev-parse --show-toplevel 2>/dev/null || pwd
   ```
   If the user named a different path in their invocation, use that.

2. **The requirement** — the thing being spec'd. Accept any of:
   - Inline text in the invocation.
   - One or more file paths to existing notes / runbooks / feedback docs.
   - A reference to a prior `claude-task--NNN`-style packet (re-spec scenario).

   If none was provided, ask exactly once: *"What should I spec? Paste the requirement, or give me a file path / prior packet number."*

3. **Sprint, task number, slug** — auto-detect, then confirm in the summary (don't block on it).

---

## 3. Auto-detect sprint, task number, slug

Run from the target root:

```bash
# Latest sprint folder by N (handles "sprint 10" > "sprint 9" correctly)
ls -d todos/sprint\ * 2>/dev/null | awk -F'sprint ' '{print $2"\t"$0}' | sort -n | tail -1

# Highest existing task number in that sprint
ls "todos/sprint N/claude-task--"*.{md,txt} 2>/dev/null | \
  sed -E 's/.*claude-task--([0-9]+)--.*/\1/' | sort -n | tail -1
```

- **Sprint**: the highest-numbered `todos/sprint N/` folder. If none exists, ask the user.
- **Task number**: highest existing `claude-task--NNN--*` in that sprint, plus 1, zero-padded to 3 digits. If none exists, start at `001`.
- **Slug**: derive a 3–5 word kebab-case slug from the requirement's first sentence or core noun phrase. State the proposed slug to the user once at summary time; let them override if they want.

Final filename: `todos/sprint N/claude-task--NNN--<slug>.md`.

**File extension:** `.md` (matches the canonical sample `claude-task--007`). Earlier packets in the same sprint may be `.txt` — that's fine, do not rename them; new packets ship as `.md` unless the user tells you otherwise.

---

## 4. Pre-spec interview (hybrid, max 3 questions)

Before writing, ask **at most 3** questions. Use `AskUserQuestion` when there are 2–4 clear options; free-form otherwise.

**Ask only if the answer materially changes one of:**
- **Scope / blast radius** — which surfaces / endpoints / users this touches.
- **Reversibility / rollback** — whether the change is one-way (data migration, schema drop, env-var removal).
- **Data correctness** — whether the change touches user data, money, or analytics fixtures.
- **Files / systems touched** — when the requirement is ambiguous about which service / module owns it.
- **Security / permissions / access control** — auth, tokens, PII, external input, admin paths.

**Do not ask** about: cosmetic preferences, naming, formatting, anything inferable from existing code. If you don't have one of the five triggers above, skip the question and write the spec with `<INPUT_REQUIRED>` markers in §5 (Open Questions).

If you ask 3 and still have unknowns, stop asking — write the spec and put the rest in §5.

---

## 5. Ground every claim in real `path:line` citations

Before drafting, read the code you're going to cite. **Never fabricate a line number.** If the requirement names a file, open it. If it names a function, grep for the actual definition. If a section says "see `Foo.php:123`", `Read` lines 120–130 of that file to confirm the citation is accurate.

Cite `path:line` (or `path:start-end`) inline in §1 Context, §7 Acceptance Criteria, §9 Behavior Spec, §11 Rollback. The reader should be able to click each citation and land on the code being described.

If a referenced file/function does not exist (the requirement was wrong about the code), surface that immediately to the user and either correct or mark it as a `<INPUT_REQUIRED>` blocker — do not paper over it.

---

## 6. Determine required skills

Apply this matrix (it drives §6 Pre-flight Checklist and §8 Implementation Guardrails):

| Skill | When to require |
| ----- | --------------- |
| `clean-code` | **Always.** Every spec mandates it. |
| `prod-safety-gate` | Default for any production code path (controllers, services, jobs, migrations, CI / deploy config, anything serving real traffic). |
| `test-driven-development` | When the change is a behavior change, bug fix, or specifies new tests as ACs. |
| `vibesec` | When the change touches auth, tokens, secrets, PII, user input, external input (HTTP/webhook/API), admin endpoints, or any security-sensitive code. |

When in doubt, include the skill — over-inclusion is cheap; missing `vibesec` on a token-handling change is not.

---

## 7. Draft the 13-section spec

Header block (counts as section 0 / packet metadata):

```md
# claude-task--NNN: <one-line title — verb phrase, no ambiguity>

**Sprint:** N  **Slug:** `<slug>`  **Status:** Draft

> Optional 1–3 line preamble: links to source notes, related packets, why
> this packet exists if non-obvious. Skip if the title and §1 cover it.

---
```

Then exactly these 12 numbered sections, in this order:

### 1. Context
What is this, why now, what's the existing state. Cite `path:line` for every code claim. Include:
- Why this packet exists (the trigger — incident, deadline, refactor, prior packet).
- Existing fixtures / prior work that must NOT be touched (link them).
- Reusable patterns to mirror exactly (cite the canonical example).
- Any user-confirmed scope decisions from the interview.

### 2. Objective
2–4 sentences. After this ships, what is true that wasn't before. Phrased as observable end-state, not implementation steps.

### 3. Assumptions
Bullet list. Runtime versions, env vars expected to exist, fixtures, data shapes. Anything the implementer can take as given. If an assumption is unverified, mark it `<INPUT_REQUIRED>` rather than asserting.

### 4. Out of Scope
Explicit non-goals. Each item names the thing AND a one-line reason it's excluded. This section earns its weight by preventing scope creep, not by being short.

### 5. Open Questions / `<INPUT_REQUIRED>`
Every gap the interview did not close. Each item: the question, why the answer matters, who can answer. If there are no open questions, write `(none)` and one line explaining the absence is intentional (so future readers don't think you forgot).

### 6. Pre-flight Checklist
What the implementer ticks before writing a line of code. Always include the required-skills section first:
```md
- [ ] Required skill loaded: **`clean-code`** — Always.
- [ ] Required skill loaded: **`<other>`** — <one-line reason from §6 matrix>.
- [ ] ...
```
Then environment / branch / read-before-write items:
- Working tree clean.
- Branch up to date with the trunk (`master` / `main`).
- Local `.env` (or equivalent) populated per §3.
- Read the cited files before editing them — list each by `path:lines`.
- Re-read each AC; understand which are operator-executed vs implementer-executed.

### 7. Acceptance Criteria
Numbered `AC-1`, `AC-2`, … Each AC is independently verifiable, ideally automatable. Use `AC-OPERATOR` for any human / external step the implementer cannot do (partner-shares, manual config in third-party UIs, capturing live curl output). Inline code snippets or pseudocode where they remove ambiguity.

### 8. Implementation Guardrails

#### 8a. Hard NO list
Bulleted. Things the implementer must not do. File paths that must not be modified (`git diff` empty). Patterns to avoid (`do not add public getters that exist only for tests`). Be specific — "don't break things" is not a guardrail.

#### 8b. Coding / quality principles
Bulleted. Apply the required skills concretely:
- `clean-code` — short methods, expressive names, no deep indentation, no magic numbers, early returns.
- `prod-safety-gate` — name the production surface and what miswiring would silently break.
- `vibesec` — name the security-sensitive surface (token, env-read, user-input handler).
- `test-driven-development` — name the AC where the test must be written first.
- Mirror existing patterns; cite the canonical example by `path:line`.

### 9. Behavior Spec (per file)
For each file the implementer will touch, a subsection:
```md
### `path/to/file.ext`

- **Current state (lines X-Y):** <what's there now, cite>.
- **Required edit:** <what changes, in plain prose>.
- **Estimated diff:** ~N LOC.
- **Subtleties:** <gotchas, downstream consumers, why a "while you're there" change would be wrong>.
```
The estimated-diff number disciplines the spec — if it's >100 LOC for one file, the spec is probably too coarse; split into more files or sub-tasks.

### 10. Risk / Failure Modes
A markdown table:
```md
| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| ...  | Low/Med/High | Low/Med/High | <which AC or guardrail addresses it> |
```
Cover at least: silent regressions, test isolation issues, lint drift, downstream consumer surprises, operator misconfig, sequencing bugs, doc drift. If a row's mitigation is "none", that's a `<INPUT_REQUIRED>` for §5.

### 11. Rollback / Revert Plan
Numbered steps to undo the change if it ships and breaks production. Include:
1. `git revert <sha>`.
2. Rebuild / migrate-down / config:clear / cache:clear as applicable.
3. Restart the affected processes.
4. Verification curl / command that confirms the revert took effect.
5. Notification — who to tell, on which channel.

If rollback has a state-dependent fork (e.g., "if env var was already removed, also restore it"), spell out the branch.

### 12. Verification + Definition of Done

#### 12a. Automated verification
Concrete shell block(s) the implementer can paste. Lint, unit tests, full suite, any byte-equality checks that enforce §8a Hard NOs (e.g. `git diff -- <forbidden-file>` must produce no output).

#### 12b. Manual QA cases (MANDATORY)
Per the target repo's verification protocol (typically `CLAUDE.md`): BE first, then FE.

Four tables, each with columns: `# | Case | Steps | Expected | Status`. Status values: `Pass` / `Fail` / `Blocked` / `Not Run`.

```md
#### Backend / API
| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| BE-1 | <case> | <command/curl/artisan> | <observable> | Not Run |

#### Frontend / UI
| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| FE-1 | <case> | <user gesture sequence> | <DOM/visual outcome> | Not Run |

#### Chrome DevTools / extension verification
| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| CHROME-1 | <case> | <DevTools panel + steps> | <network/console/DOM observable> | Not Run |

#### Operator-executed (post-cutover, see AC-OPERATOR)
| # | Case | Steps | Expected | Status |
| - | ---- | ----- | -------- | ------ |
| OP-1 | <case> | <operator action> | <observable> | Not Run |
```

**Mandatory rules:**
- A spec is **not complete** unless every applicable table has at least one case populated. If a surface genuinely doesn't apply (BE-only change → no FE / Chrome cases), mark the table `N/A` with a one-line reason (e.g. "N/A — no FE files touched. If this changes, fail the implementation and add cases.").
- An implementation is **not complete** unless every applicable case has Status ≠ `Not Run`. The implementer fills BE / FE / Chrome statuses as they execute; the operator fills OP statuses. The user may explicitly waive cases — when waived, record the waiver in §5.

#### 12c. Definition of Done
A bulleted checklist that closes the packet:
```md
- [ ] AC-1 through AC-N satisfied.
- [ ] §12a passes locally (and in CI).
- [ ] BE-* / FE-* / CHROME-* in §12b have Status ≠ `Not Run` (target: `Pass`).
- [ ] OP-* completed by the operator (or explicitly waived in §5).
- [ ] No `<INPUT_REQUIRED>` remains in §5.
- [ ] §8a Hard NO list respected — `git diff` on each forbidden file is empty.
- [ ] §11 Rollback plan rehearsed mentally.
```

End the file with:
```md
---

End of Codex Task Packet — `claude-task--NNN`
```

---

## 8. After writing — show, don't dump

Once the file is on disk:

1. Print a short summary the user can scan in 5 seconds:
   ```
   Wrote: <abs-path>/todos/sprint N/claude-task--NNN--<slug>.md
   Sections: 12 + header
   ACs: <count>
   Open questions: <count>  ← if non-zero, list each one-liner
   Required skills: clean-code, <others>
   Manual QA tables: BE (<n>), FE (<n>|N/A), Chrome (<n>|N/A), Operator (<n>|N/A)
   ```
2. If §5 has `<INPUT_REQUIRED>` markers, list them as bullets. The user can answer inline; you patch the spec in place.
3. Do **not** print the full spec back into the chat. The file on disk is the artifact.
4. Do **not** start implementing. The handoff is: `Implement <abs-path>` in a fresh Claude session.

---

## 9. Anti-patterns (hard don'ts)

- **No vague specs.** Every AC is independently verifiable. "Improve performance" is not an AC; "p95 latency on `/api/v1/foo` drops below 200ms measured via …" is.
- **No fake citations.** Every `path:line` reference must point to real code you read. Wrong line numbers are worse than no line numbers — they erode trust in the whole packet.
- **No silent business assumptions.** If you assume "the operator wants X behavior" and didn't confirm, that's an `<INPUT_REQUIRED>` in §5, not a buried sentence in §1.
- **No implementation before review.** This skill produces the packet only. Don't write the code in the same session.
- **No under-specified tests.** Every behavior change has at least one BE manual case AND at least one automated test in §7. UI changes additionally have an FE case. Auth / token / external-input changes additionally have a vibesec-justified test.
- **No skipping rollback / risk thinking.** If §10 has fewer than 3 rows or §11 has fewer than 4 steps, you haven't thought hard enough.
- **No re-spec-ing without checking the prior packet.** If the user references a prior `claude-task--NNN`, `Read` it first; mirror its scope decisions; don't re-litigate resolved questions.

---

## 10. Constraints and edge cases

- **Manually invoked or semantically triggered.** Don't fire on routine edits.
- **Skill does not implement.** It produces the file and stops.
- **Skill does not modify the repo outside `todos/sprint N/`.** No edits to source code, config, or other docs as a side-effect of writing the spec.
- **Re-spec scenario.** If the user names a prior packet (`re-spec --006`, `upgrade --004 to 13-section format`), `Read` the prior file, preserve its scope decisions, restate the requirement in the new structure, and add a 1–3 line preamble in the header explaining "either packet is sufficient to ship — pick one."
- **Multi-file / multi-sprint changes.** If the requirement spans two sprints or feels like 2+ separate packets, surface that to the user and ask whether to split. Don't write a 600-line super-packet.
- **No CI / no test runner in target repo.** Note it in §6 Pre-flight; weaken §12a to whatever the repo actually supports; do not invent test commands.
- **Generic vs. project-specific.** This skill is the generic version (lives at `~/.claude/skills/spec-writer/`). Project-specific conventions (tooling commands, repo-specific section ordering, custom AC prefixes) belong in the target repo's `CLAUDE.md` or a project-level `.claude/skills/project-spec-writer/SKILL.md` that overrides this one.
