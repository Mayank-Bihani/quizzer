# Prompt — Quizzer UI Mockups (HTML + CSS only, responsive)

> Paste the block below into Claude, **with two attachments**:
> 1. the finished **design-system HTML** (the tokens are copied from it verbatim), and
> 2. **[[JOURNEYS]]** (the screen inventory and user stories).
> Run it one batch at a time — see §Batching.

---

You are building **static UI mockups** for Quizzer, a self-paced timed quiz app for a
~100-student competitive-exam prep group (Verbal / Quant / Logical Reasoning).

Two inputs are attached and both are **authoritative**:

- **The design system** — the token layer and every component, already decided. Copy the
  `:root` custom properties out of it **verbatim** into a shared stylesheet. Do not re-pick
  colours, type, spacing, radii, shadows or motion. Do not introduce a component that is not
  in the system.
- **JOURNEYS.md** — the journeys and the screen inventory. Every screen listed there gets a
  mockup. Every state noted there gets rendered.

**If a screen needs something the design system does not have, do not invent it silently.**
Build the closest thing from existing components and add it to a "system gaps" list at the end
of the batch, naming the component and the screen that needed it.

## Technical constraints

- **HTML and CSS only.** No framework, no build step, no preprocessor, no npm.
- **No external assets whatsoever** — no CDN, no web fonts, no image URLs, no icon libraries.
  Fonts come from a system font stack. Icons and illustrations are **inline SVG**. Photos are
  inline SVG placeholders.
- **JavaScript is allowed in exactly one place**: the mockup index shell (screen navigation and
  the device-width switcher). **No component behaviour in JS** — no tab logic, no timers
  counting down, no form validation. Every state is a separately rendered piece of markup.
- **Semantic HTML**: real `<button>`, `<label>`, `<table>`, `<nav>`, `<main>`, heading order,
  `alt` text, `aria-*` where a component's meaning depends on it. These mockups are the
  reference the real markup gets built from, so the structure has to be right, not just the pixels.
- One shared `tokens.css` + `components.css`, then one CSS file per batch for screen-level layout.
  A screen file must not redefine a token.
- **Maths:** questions contain LaTeX in the real app (KaTeX at runtime). In the mockups, render
  maths as **inline MathML or styled HTML spans** — never as an image, never as raw `$...$`.
  Add a comment noting the real app substitutes KaTeX here.

## Responsive strategy

Students sit tests on **phones, tablets and laptops**, so responsiveness is a correctness
requirement, not polish. Admins work on laptops.

### Canonical widths

Design and verify every screen at these three, in this order:

| Name | Width | Primary for | Notes |
|---|---|---|---|
| **Phone** | 390px | Students | The default. NFR-5: students play on phones. |
| **Tablet** | 820px | Students | Also test **1180px landscape** — the passage layout changes there. |
| **Laptop** | 1440px | Admins | Student screens use the width they are given. |

Breakpoints: `≥640px` (large phone / small tablet), `≥900px` (tablet / small laptop),
`≥1280px` (laptop). Use `min-width` only — build up, never down. Use container queries for
cards that appear in both a narrow column and a wide grid.

### Device choice is the fairness mechanism — do not equalise

**Every student picks the device that suits the quiz.** Someone sitting a reading-comprehension
paper will choose a laptop; someone on a phone accepts that they will scroll a long passage the
way they would scroll a PDF. That trade is theirs to make, and it is what makes the format fair.

**So: never withhold or compress content to level the devices.**

- A laptop shows **more of a passage without scrolling**. That is the point. Do not cap the
  passage container to a "fair" height or measure.
- A phone scrolls. Long passages scroll naturally, with the question and the actions reachable
  — do not paginate, truncate, or add a "read more" to make it fit.
- Use the width the device gives you. No artificial `max-width` on content containers to keep
  laptops from being "too good".
- The one thing that stays constant is **what is available**: same questions, same order, same
  actions, same information. Only the amount visible at once differs, and that follows from the
  device the student chose.

*(Typographic line length is a separate concern from fairness — if a stem at full 1440px width
reads badly, fix it with layout and type size, not by shrinking the container.)*

### Orientation

**Phones are locked to portrait during a run** (below the `900px` breakpoint). Tablets and
laptops are unrestricted — a tablet in landscape is a legitimate way to sit a passage paper.

Implementation note for the real app, to be reflected in the mockups: the Screen Orientation
Lock API only works inside fullscreen and **is unsupported on iOS Safari**, so the lock cannot
be relied on alone. Build the fallback and mock it: a **"rotate your device" overlay** shown via
`@media (orientation: landscape) and (max-width: 899px)`, covering the run screens only. The
quiz clock keeps running behind it — the overlay is a prompt, not a pause. Mock this overlay as
one of the run states.

### Reflow vs. relayout

Most screens just **reflow** — one column becomes two, padding grows, the measure caps. A few
must genuinely **relayout**, and those are where mockups earn their keep:

| Screen | Phone | Tablet / Laptop |
|---|---|---|
| **Passage question set** | Passage scrolls in a pinned pane above the question, PDF-style | **Split pane** — passage left at full available height, question right |
| **Student navigation** | Bottom tab bar | Sidebar or top nav; bottom bar disappears |
| **Admin navigation** | Drawer (rare, but must not break) | Persistent sidebar |
| **Question bank list** | Card list | Dense sortable table |
| **Participants / report tables** | Card list, key columns only | Full table, all columns |
| **Quiz builder** | Stacked steps, one per screen | Two-column: form left, live draw preview right |
| **Leaderboard** | Rank + name + score | Adds tie-break time, section, quizzes-counted |
| **Review question** | Stacked: question → answers → distribution → explanation | Question and explanation side by side |

### Rules that apply everywhere

1. **Fluid, not fixed.** No fixed pixel widths on containers, and no artificial `max-width`
   caps on content — see "do not equalise" above.
2. **Touch targets stay 44px at every width.** A laptop user may have a touchscreen; a tablet
   user definitely does.
3. **Same content and same actions at every width** — same questions, same order, same controls.
   How much is visible at once is allowed to differ; what is available is not.
4. **Phones are portrait-locked during a run**, with a rotate-prompt overlay as the fallback.
5. **Safe areas**: respect `env(safe-area-inset-*)` on the bottom bar and any fixed footer.
6. **Sticky elements are load-bearing during a run** — the timer, the question position and the
   submit action must never scroll out of reach on a long question.
7. **No horizontal scrolling** at any width, except inside a table that explicitly declares
   `overflow-x: auto`.
8. **Respect `prefers-reduced-motion`** on every transition you style.

### Prove it

Each batch ends with a **responsive proof page**: the batch's key screens rendered in `<iframe>`s
at 390 / 820 / 1440 side by side, so all three are visible in one screenshot.

## File structure

```
/mockups
  index.html            screen directory + device-width switcher (the only JS)
  css/tokens.css        copied verbatim from the design system
  css/components.css    the component layer
  css/screens-*.css     per-batch layout
  student/*.html        one file per screen
  admin/*.html          one file per screen
  proof-*.html          responsive proof pages
```

One screen per file. Where a screen has multiple states (empty, loading, error, full), render
them as clearly labelled sections **stacked in the same file**, each with a caption strip
naming the state — not as separate files, so a reviewer sees them together.

## Content rules

Mockups reviewed with lorem ipsum tell you nothing. Use realistic fixtures throughout:

- **Real questions.** Plausible CAT-style items: a Quant problem with an equation, a Verbal RC
  passage of ~250 words with 4 attached questions, a Logical Reasoning arrangement. One question
  with an image. One TITA question with a numeric answer.
- **Real names** — Indian names, varied lengths, including one long enough to test truncation
  in a leaderboard row.
- **Real times** — IST, `2 Sep 2026, 9:00 PM`. Real room codes: `QNT-8417`.
- **Realistic numbers** — 20 questions, 45s each, 87 participants, scores with the speed bonus
  producing decimals like `54.4`.
- **Include the awkward cases**: a 3-line question stem, an option that wraps to two lines, a
  student in 1st place and a student in 87th, a zero-participant leaderboard, a bank with 1,400
  questions, a CSV import with 6 errors across 200 rows.

## How the work is organised — sprints

The work is a **to-do list of 11 sprints**, tracked in `mockups/PROGRESS.md`. A sprint is a few
**connected** screens — ones that share a layout and a set of components, so building them
together is what keeps them consistent.

**Never work on more than one sprint at a time.** Finish it, verify it, update `PROGRESS.md`,
stop.

### The dependency graph

`S0` unblocks everything. After it, five chains are independent of each other, and **serial
inside themselves**:

```
S0  foundations & shell   ← everything waits on this
      │
      ├── S1  auth & entry
      ├── S2  run: core        →  S3  run: edges
      ├── S4  results          →  S5  review        →  S6  history & boards
      ├── S7  admin: bank      →  S8  admin: import
      └── S9  admin: builder   →  S10 admin: schedule & reports
```

Two sprints in **different chains** may run in parallel — they touch disjoint files. Two sprints
in the **same chain** must not: the later one reuses components the earlier one defines.

### The sprints

| # | Sprint | Screens and states | Depends on |
|---|---|---|---|
| **S0** | **Foundations & shell** | `index.html` (screen directory + width switcher — the only JS) · `css/components.css` · student app shell (bottom nav) · admin app shell (sidebar) · page header · **one reference screen: student home**, built to the standard every later sprint copies | — |
| **S1** | Auth & entry | Sign-in · Quiz detail pre-join · Join by room code · Lobby with countdown · Room full · Profile · 403 · 404 · Session expired | S0 |
| **S2** | Run: core | Question MCQ · Question TITA · Question with image · Answer-selected · Answer-locked · **Skip idle** · **Just-skipped** · Both clocks · Progress indicator | S0 |
| **S3** | Run: edges | Passage set first question · Passage set mid-set ("Q2 of 4") · Resumed-after-disconnect · Late-join · Reconnecting banner · Time-expired auto-advance · Deadline mid-question · **Rotate-to-portrait overlay** | S2 |
| **S4** | Results | Finish (own score only) · Holding screen · Rank reveal · Score breakdown incl. skipped count | S0 |
| **S5** | Review | Review card × 5 outcomes (correct, wrong, skipped, timed out, not reached) · Answer distribution · Time-vs-room-average · Review navigator | S4 |
| **S6** | History & leaderboards | History list · History empty · Per-quiz leaderboard · Weekly leaderboard + section tabs + week picker · Leaderboard empty · **"You did not take this quiz"** | S5 |
| **S7** | Admin: bank | Console home · Bank browse with filters · Bank empty · Question editor MCQ · Question editor TITA · Passage group detail | S0 |
| **S8** | Admin: import | Import upload · Validation preview with per-line errors · Commit confirmation · Import failed | S7 |
| **S9** | Admin: builder | Define · Draw with composition report · Scoring parameters incl. bonus-decay curve · Schedule · Lock confirmation (irreversible) | S0 |
| **S10** | Admin: schedule & reports | Schedule list across all states · Recurring templates · Quiz report · Participants table · Export · Manage admins · Promote/demote confirm | S9 |

**S2 and S3 are the ones to build most carefully** — the live run is where a mistake costs a
student marks.

### S0 is the contract

S0 is not just the first sprint, it is the **reference implementation**. Every later sprint
reads `css/components.css` and the reference screen **before writing anything**, and copies
their conventions: class naming, markup structure, how a card nests, how a state is labelled.

A later sprint that needs a component S0 did not build **adds it to `components.css`** — it does
not define a one-off in its own screen stylesheet. Screen stylesheets hold layout only.

### Finishing a sprint

In this order, every time:

1. Run `bash mockups/check.sh` — it mechanically verifies the rules that are checkable.
2. Fix anything it reports. Do not hand over with failures.
3. Work through the acceptance checklist below for the states this sprint added.
4. Append anything missing to `mockups/SYSTEM-GAPS.md`.
5. Tick the sprint off in `mockups/PROGRESS.md` and note anything the next sprint needs to know.

## Acceptance checklist — run this before you hand over each batch

- [ ] Every screen in the batch renders correctly at 390, 820 and 1440
- [ ] No horizontal scrollbar at any width
- [ ] Zero hardcoded colours, sizes or radii — every value is a token
- [ ] Zero external requests; the page works offline from `file://`
- [ ] Every state from JOURNEYS.md is rendered and labelled
- [ ] Skip is present on every run screen, unmistakable from submit at 390px
- [ ] No content is capped or compressed to equalise devices
- [ ] Nothing in a live-run screen reveals correctness, rank, score or another student
- [ ] Both clocks are present and visually distinct on every run screen
- [ ] Touch targets ≥44px at all three widths
- [ ] Headings nest correctly; every control is reachable by keyboard with a visible focus ring
- [ ] The "system gaps" list is included, or explicitly empty

---

## Running this with agents

### The orchestrator's job

You are the orchestrator. You do **not** build screens yourself. You:

1. Read `mockups/PROGRESS.md` to find the next unblocked sprint.
2. Spawn **one subagent per sprint**, giving it: the sprint row, the paths to
   `MOCKUP_PROMPT.md` / `JOURNEYS.md` / `mockups/css/tokens.css`, and the instruction to invoke
   the `quizzer-mockups` skill.
3. When it returns, run `bash mockups/check.sh` **yourself**. Do not trust the report.
4. Update `PROGRESS.md`, then move on.

**Build S0 yourself, in the main session, before spawning anything.** S0 defines
`components.css` and the reference screen — the conventions every later sprint copies. Delegating
it means delegating the contract.

### Parallelism

Two sprints may run **at the same time only if they are in different chains** (see the dependency
graph). They then touch disjoint files. Two sprints in the same chain must run in order, because
the later one reuses components the earlier one defined.

Safe to run concurrently after S0: one sprint drawn from each of `{S1}`, `{S2→S3}`,
`{S4→S5→S6}`, `{S7→S8}`, `{S9→S10}`.

**Never let two concurrent subagents write `css/components.css`.** If a sprint needs a new shared
component, it appends to `components.css` — so either run that sprint alone, or have the subagent
report the component back and add it yourself.

### Subagent reports must be short

A subagent has **its own context window**; yours is only charged for what it reports back. So cap
the report at **15 lines**: files created, components added to `components.css`, `check.sh`
result, system gaps, anything the next sprint needs. No code, no screen-by-screen narration.

### On stopping for token limits

Do not gate on your own token count — spawning subagents barely moves it, and a percentage of
your window tells you nothing about whether a *subagent* had room to finish.

Gate on this instead:

- **Size sprints so one subagent finishes comfortably in a fresh window.** That is why sprints
  are capped at ~8 rendered states. If a subagent reports it ran short, split that sprint in
  `PROGRESS.md` rather than raising the cap.
- **`PROGRESS.md` is the resumption mechanism.** Every sprint ends with it updated, so a fresh
  session picks up exactly where the last one stopped. Running out of context becomes a pause,
  not a loss.
- If you must stop mid-run, finish the current sprint, update `PROGRESS.md`, and say which
  sprint is next.

### Review cadence

**Stop for human review after S0, and again after S2.** Those two set the conventions and the
run chrome; every other sprint inherits from them. A mistake found at S0 costs one fix — the same
mistake found at S10 costs eleven.
