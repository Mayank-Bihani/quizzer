# Prompt — Quizzer Design System (3 variants per component)

> Paste the block below into Claude. It produces the design system only.
> UI mockups are explicitly out of scope for this prompt.

---

You are designing the **design system** for Quizzer — a self-paced timed quiz app for a
~100-student competitive-exam prep group (Verbal / Quant / Logical Reasoning). It has three
surfaces that must feel like one product: a **student app (mobile-first, phones)**, a
**live quiz runner (mobile, high-focus, timed)**, and an **admin console (desktop)**.

Do **not** design screens or mockups. Design the system: tokens, then components, then states.

## Art direction

- **Light UI only.** No dark mode in this pass, but define every colour as a CSS custom
  property so a dark theme can be layered later without restructuring.
- **Apple-glass influence** — clean, sleek, minimal: translucent surfaces, soft blur,
  hairline borders, generous whitespace, restrained shadow. Glass only reads as glass over a
  non-flat backdrop, so define an **ambient background system** (soft gradient mesh / tinted
  wash) as a foundation token, not as decoration bolted on later.
- **Sans-serif type**, high legibility at small sizes on phones. Numerals must be tabular
  where scores, timers and ranks are shown.
- **Friendly, lightly cartoonish spot graphics** — small mascot/illustration moments for
  empty, waiting, finished, error and "room full" states. Friendly, never childish; the app
  is exam practice with negative marking.
- Serious content, light chrome. Timers and negative marking mean urgency states must be
  unambiguous without becoming alarming.

## Hard constraints from the product

1. **Mobile-first for students.** Live-quiz components are designed at 375px width first and
   must work one-thumbed. 44px minimum touch targets.
2. **Question content renders LaTeX** (`$...$`) inline and as blocks, and a question may carry
   **one image**. Every question-bearing component must accommodate both without breaking.
3. **During a live run, nothing may hint at correctness.** The option component has
   `idle / pressed / selected / submitting / locked` states and **no correct/incorrect state at all**.
   Correct/incorrect styling exists only in the post-deadline review components.
4. **Two clocks run at once** during a quiz: a per-question limit (~30–60s, with a grace
   window that pays a speed bonus) and a hard deadline for the whole window. They must be
   visually distinguishable at a glance and never confusable.
5. **Answers lock on submit.** No back navigation, no edit. The lock must feel deliberate.
6. **Three sections need distinct identity colours** — Verbal, Quant, Logical Reasoning —
   plus a neutral "Overall". They must stay distinguishable when desaturated by glass.
7. **Timer and status must not be colour-only.** Shape, motion or text carries the signal too.
8. Timezone is Asia/Kolkata; language English only.

## Deliverable format

Produce a **self-contained HTML artifact** (inline CSS/JS, no external assets) that is a
browsable, tool-like design-system reference — something I can keep open while building, not a
gallery. **Organisation is a graded part of this deliverable.** A page that renders beautiful
components in an ad-hoc order has failed the brief.

### Page architecture

```
Header       Quizzer Design System · v0.1 · <date> · one-line purpose
Sidebar      sticky, always visible, anchor links mirroring every section below
Body         Foundations → Components → Patterns → Meta
```

- **Sidebar nav** — sticky, scroll-spy highlighting the current section, collapsible groups.
  On a phone it becomes a drawer. It must list every component by name.
- **Exactly four top-level sections**, in this order: **Foundations**, **Components**,
  **Patterns**, **Meta**. Never more. Everything nests under one of them.
- **Version stamp** in the header — `v0.1 · <today's date>`.
- **Click any token swatch or name to copy its CSS variable** to the clipboard, with a
  confirmation toast. Say so with a one-line hint at the top of Foundations.

### The presentation contract

Every token and every component is presented in the **same shape**, every time. Consistency of
presentation is what makes a system browsable; variety of presentation is what makes it noise.

**Every token** renders as: visual swatch/sample · `--variable-name` · resolved value ·
one-line usage note saying where it is used ("question stem is `--type-body-lg`").

**Every component** renders as an identical block, in this order — no field omitted, no field
reordered, no extra fields:

```
component-name                                   ← kebab-case, stable, never renamed
One sentence: what it is and what it is for.
Used in:      screen or journey references
Anatomy:      labelled parts of the component

Variant A — <short name>
  Rationale:  what it trades off
  When:       when to reach for it
  [live render]  [state grid: default · hover · focus · active · disabled · loading · empty · error]

Variant B — …   (same shape)
Variant C — …   (same shape)

Tokens:       the CSS variables this component consumes
Rules:        ✓ up to two do's   ✗ up to two don'ts
A11y:         one line — focus, target size, contrast, non-colour signal
```

If a component genuinely has no meaningful third variant, still print the block and state
**why** in one line. Do not pad with a near-duplicate.

### Naming conventions — declare them, then obey them

Open Foundations with a short table of **token prefixes and scales**, so I can predict a name I
have not seen. Suggested shape, adjust if you have better:

```
--c-*      colour        --c-n-50…900 neutrals · --c-sec-verbal|quant|lr|overall
--glass-*  glass recipe  --glass-blur · --glass-bg · --glass-border
--type-*   typography    --type-h1 · --type-body · --type-num
--sp-*     spacing       --sp-1…12 (4px base)
--r-*      radius        --r-xs…full
--sh-*     elevation     --sh-1…4
--dur-* / --ease-*       motion
```

Component names are `kebab-case` and stable across all five artifacts — my A/B/C selections are
recorded against them.

### The Patterns section

Between Components and Meta, a short section on **composition rules** — how the pieces combine.
Not screens; rules. Cover at minimum: page scaffolding (student phone vs. admin desktop), form
layout and validation placement, table vs. card-list at the mobile breakpoint, how the two
simultaneous clocks coexist on one screen, and the density difference between the student app and
the admin console.

### The Meta section

1. **Sources of truth** — where the canonical tokens will live once code exists, and a line
   stating this page is a mirror, not the definition.
2. **Open questions** — anything you had to guess about product behaviour.
3. **Changelog** — one line per version.
4. **Pick Sheet** — a table of every component with A / B / C checkboxes, so I can record my
   selections and hand them back.

### The three-variant rule

For every component marked **[3]** below, show **three variants side by side, labelled A, B and C**,
each with:

- a short variant **name** (e.g. "A — Ring timer"),
- a one-line **rationale** (what design dimension it trades off),
- a one-line **when to use**,
- **all of its states rendered**, not just the default.

Variants must differ on a *meaningful* dimension — layout, information density, affordance,
metaphor. Three shades of the same button is not three variants. All three variants of a
component must be built from the **same token layer** — the tokens are decided once, not
per variant, so a mixed A/B/C selection still composes into one coherent system.

Render every component live in HTML/CSS, at both a phone width and a desktop width where the
component is used on both.

### Batching

This is too large for one response. Produce it as **five sequential artifacts**, in this order,
stopping after each for my go-ahead:

1. Foundations + illustration style
2. Primitives, layout, navigation, feedback
3. Live quiz run (student, mobile)
4. Results, review, leaderboards
5. Admin: bank & import, quiz builder, schedule, reports

Keep the token layer identical across all five.

---

## 1. Foundations + illustration style

- **Colour system:** neutrals ramp, surface/glass ramp, accent, semantic (success / warning /
  danger / info), and the four section colours (Verbal, Quant, LR, Overall). **[3]** — give
  three candidate section-colour families and show each over glass.
- **Ambient background system [3]** — three treatments for the page backdrop that makes glass
  legible (e.g. gradient mesh, tinted wash + noise, soft blobs).
- **Glass recipe [3]** — three combinations of blur / background opacity / border / shadow,
  each shown over a busy backdrop and a plain one, with a legibility note.
- **Typography [3]** — three type systems (family pairing + scale + weights), each shown on:
  a question stem with inline LaTeX, a leaderboard row, a numeric score, and dense admin
  table text.
- **Spacing scale, radii scale, elevation scale, motion tokens** (durations + easings,
  including a `prefers-reduced-motion` fallback) — single canonical set, no variants.
- **Iconography + illustration style [3]** — three spot-graphic styles (e.g. flat geometric,
  soft 3D-ish gradient, hand-drawn line), each drawn as the same four scenes: empty state,
  waiting/holding, finished, error. Inline SVG only.
- **Focus-ring treatment** on glass surfaces, and a contrast audit note for text on translucent
  backgrounds.

## 2. Primitives, layout, navigation, feedback

- **Buttons [3]** — primary, secondary, ghost, destructive, icon-only; states: default, hover,
  active, focus, disabled, loading.
- **Form controls**: text input, **numeric input for TITA answers with mobile-numpad
  affordance [3]**, select, textarea, search, checkbox, radio, toggle, stepper for scoring
  parameters, and a **file dropzone [3]** (CSV + companion ZIP, with idle / drag / uploading /
  error states).
- **Form field anatomy [3]** — label, helper text, error text, required marker, inline unit
  suffix (seconds, marks).
- **Badges & pills [3]** — quiz status (draft, scheduled, open, live, closed), difficulty
  (easy/medium/hard), section, question used/unused, role (student/admin/superadmin).
- **Card / glass surface container [3]** — the workhorse; show nested and non-nested.
- **App shell — student, mobile [3]** — bottom nav vs. alternatives; entries: Home/Upcoming,
  History, Leaderboards, Profile.
- **App shell — admin, desktop [3]** — sidebar vs. topbar vs. hybrid; entries: Bank, Quizzes,
  Schedule, Reports, Admins.
- **Page header [3]** — title, subtitle, status, primary action, back affordance.
- **Tabs / segmented control [3]** — used for section switching on leaderboards.
- **Modal (desktop) + bottom sheet (mobile) [3]** as one responsive component.
- **Destructive confirm dialog [3]** — locking a quiz permanently retires its questions;
  deleting a bank question. Must communicate irreversibility.
- **Toast [3]**, **inline alert/banner [3]** (including a **reconnecting / offline** banner
  that appears during a live run without stealing focus).
- **Empty state [3]**, **loading skeleton [3]**, **error state [3]**, **403 not-authorised**
  and **404** blocks.
- **Avatar + name row [3]** (Google profile photo, real names shown publicly), **account menu**.
- **Data table [3]** — dense admin table with sort, sticky header, row selection, and a
  **mobile card-list fallback** for the same data.
- **Pagination / load-more [3]**, **filter bar [3]** (multi-facet: section, topic, difficulty,
  used/unused), **countdown timer (generic) [3]**.

## 3. Live quiz run — student, mobile-first

This is the highest-stakes surface. Design it at 375px first.

- **Join by room code [3]** — codes look like `QNT-8417`; consider segmented character input.
- **Lobby / pre-start block [3]** — quiz name, section, question count, seconds per question,
  window length, seats remaining, countdown to open.
- **Question card [3]** — stem with inline + block LaTeX, optional image, question index
  ("Q7 of 20"), section chip.
- **MCQ option list [3]** — fixed A/B/C/D order; states: idle, pressed, selected, submitting,
  locked. **No correct/incorrect state.** Options may contain LaTeX.
- **TITA numeric answer input [3]** — numeric entry with tolerance, mobile keypad affordance,
  same states as above.
- **Per-question timer [3]** — e.g. ring, linear bar, digits. Must show the **grace window**
  (full speed bonus) as a distinct zone, and an urgency state in the final seconds that is not
  colour-only.
- **Window deadline indicator [3]** — the second clock; must not be confusable with the
  per-question timer.
- **Progress indicator [3]** — position in the quiz; answered questions are unreachable, so it
  must not look navigable.
- **Passage set layout [3]** — a reading passage pinned on screen across 4–5 questions, with a
  "Q2 of 4 in this set" indicator. Give three approaches (split pane, collapsible sheet,
  tabbed) at phone width.
- **Submit / lock action [3]** — including the locked confirmation moment.
- **Skip action [3]** — advances without answering; scores 0 and is irreversible. Secondary
  weight, and positioned so a thumb never confuses it with submit at 390px. No confirmation step.
- **Rotate-to-portrait overlay [3]** — shown when a phone is turned landscape during a run. The
  clock keeps running behind it; it is a prompt, not a pause.
- **Transitions**: answer-submitted → next question, and time-expired → auto-advance. Specify
  duration and easing; reduced-motion variants.
- **Edge states [3 each]**: room full, resumed-after-disconnect (same question, time
  remaining), joined late (less time to the deadline), hard deadline reached mid-question.

## 4. Results, review, leaderboards

Three result screens are a **secrecy requirement**, not a UX preference — nothing may leak
before the hard deadline.

- **Finish card [3]** — own total score and count answered. **Nothing else** — no rank, no
  correctness, no leaderboard.
- **Holding state [3]** — own score, how many students have finished, countdown to unlock.
  Must feel like a reward-in-waiting, not a dead end.
- **Rank reveal [3]** — rank and participant count, post-deadline.
- **Score breakdown tiles [3]** — attempted, correct, wrong, skipped, speed bonus, total time.
- **Review question card [3]** — the question, my answer, the correct answer, the admin's
  explanation (LaTeX), optional image. Include correct / wrong / **skipped** / timed-out /
  not-reached variants. Skipped and timed-out score identically but must be distinguishable.
- **Answer distribution [3]** — what percentage of the room chose each option; must sit inside
  the review card without dominating it.
- **Time-vs-room-average indicator [3]**.
- **Review navigator [3]** — prev/next plus a question-index grid coloured by outcome.
- **History list row [3]** — one past quiz: name, date, score, rank, link to review.
- **Leaderboard row [3]** — rank, avatar, real name, score, tie-break time; with an
  emphasised **"this is you"** state, and rank 1–3 treatment.
- **Podium / top-3 header [3]**.
- **Board switcher [3]** — section tabs (Verbal / Quant / LR / Combined) plus a week picker.
  **Weekly boards only — there is no all-time board.**
- **Restricted state [3]** — "you did not take this quiz", shown in place of a participant-only
  per-quiz leaderboard or review. Reads as a normal outcome, not an error.
- **Leaderboard empty / too-early state [3]**.

## 5. Admin — bank, builder, schedule, reports

- **CSV import flow components:** dropzone (from §2), **validation preview table [3]** showing
  valid rows alongside errors reported **by line number**, an **error summary [3]**, and a
  **commit bar [3]** making clear nothing is written until confirmed.
- **Question row [3]** — table row and mobile card: stem preview with LaTeX, section, topic,
  difficulty, used/unused, image indicator.
- **Question editor [3]** — MCQ (4 options, one correct) and TITA (answer + tolerance),
  explanation field with **live LaTeX preview**, image attach.
- **Passage group card [3]** — the passage plus its 4–5 child questions as one indivisible unit.
- **Quiz builder wizard [3]** — the step pattern: define → draw → review → schedule → lock.
- **Difficulty mix control [3]** — distributing N questions across easy/medium/hard.
- **Composition report [3]** — e.g. "4-question RC set + 3-question set + 13 standalone",
  shown before locking.
- **Draw preview + reshuffle [3]** — the picked questions, with a re-draw affordance.
- **Scoring parameter panel [3]** — six per-quiz numbers: seconds per question, grace window,
  marks correct, marks wrong (negative), max speed bonus, seat cap. Include a **live preview of
  the speed-bonus decay curve** as part of at least one variant.
- **Schedule picker [3]** — date + time in IST, window length, plus a **recurrence editor [3]**
  for recurring templates.
- **Room code display [3]** — large, readable, copyable; withheld until T−5 minutes.
- **Quiz card in a schedule list [3]** — across states: draft, scheduled, open, live, closed.
- **Report summary tiles [3]**, **participants table [3]**, **per-question item analysis
  row [3]** (which questions the room got wrong), **export action [3]**.
- **Manage Admins roster row [3]** — promote / demote, with role badge and a confirm step.
- *Optional, mark clearly as speculative:* a **live quiz monitor tile [3]** (joined, in
  progress, finished) and an **abort/void quiz** control.

---

## Rules for your output

- Name every component in `kebab-case` and keep names stable across all five artifacts — my
  A/B/C selections will be recorded against these names.
- Show **states**, not just happy paths. A component without its loading, empty, error and
  disabled states is incomplete.
- Annotate each component with the **tokens it consumes**.
- Do not invent product behaviour. If a component seems to require a product decision that
  hasn't been made, render your best guess and flag it in a short "open questions" list at
  the end of that artifact.
- Accessibility is part of the deliverable, not a footnote: visible focus on glass, contrast
  ratios called out where translucency threatens them, 44px targets, non-colour-only status,
  and reduced-motion behaviour for the timers and transitions.
- **No screen mockups.** Components and their compositional rules only.
