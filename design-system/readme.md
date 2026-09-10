# Quizzer Design System

**Status: all five batches complete.** Sample marks scheme used in every artifact: `+3` correct, `−1` wrong, up to `+0.5` speed bonus per question — a 20-question quiz is out of 60.

## Product context

Quizzer is a **self-paced timed quiz app for a ~100-student competitive-exam prep group** (Verbal / Quant / Logical Reasoning). Three surfaces must feel like one product:

| Surface | Device | Character |
| --- | --- | --- |
| **Student app** | mobile-first, phones | Home/Upcoming, History, Leaderboards, Profile |
| **Live quiz runner** | mobile, one-thumbed | High-focus, timed, irreversible answers |
| **Admin console** | desktop | Bank & CSV import, quiz builder, schedule, reports, admins |

Behavioural facts the system is designed around:

- Questions render **LaTeX** (inline `$…$` and block) and may carry **one image**.
- **Two clocks run at once**: a per-question limit (~30–60 s, with a grace window paying a speed bonus) and a hard deadline for the whole quiz window. They must never be confusable.
- **Nothing may hint at correctness during a run.** Options have `idle / pressed / selected / submitting / locked` and *no* correct/incorrect state. Correctness exists only in post-deadline review.
- **Answers lock on submit** — no back navigation, no edit.
- **Negative marking** is real, so red appears in content (a −1) as well as in errors.
- Three section identities + a neutral "Overall", which must stay distinguishable when desaturated by glass.
- Timezone **Asia/Kolkata**; English only. Real names and Google profile photos are shown publicly on leaderboards.

## Sources given

- A written brief (art direction + hard product constraints + the five-batch deliverable plan), pasted into chat on 1 Sep 2026.
- **No** codebase, Figma file, screenshots, logo, font files, icon set or existing design system were provided. Nothing brand-specific has been invented or reconstructed: where a logo belongs, the system sets the word **Quizzer** in `--font-ui` at `--fw-semibold`.

## Selected variants

All 69 A/B/C selections across the five artifacts are locked and recorded in
[`guidelines/selections.md`](guidelines/selections.md), together with the eight
composition consequences they imply and the five product questions still blocking
the component build.

## Batch 1 foundations (locked 2 Sep 2026)

| Pick | Choice |
| --- | --- |
| `section-colour-family` | **B — Library** (burgundy `#6E2E36` / pine `#2A5A44` / amber-brown `#8C5A1E` / warm graphite) |
| `ambient-background` | **A — Gradient mesh** (`--amb-a`, warm parchment lobes) |
| `glass-recipe` | **A — Balanced** 62 % / 18px |
| `type-system` | **A — IBM Plex Sans + IBM Plex Mono** |
| `illustration-style` | **B — Soft shade** (`assets/illustrations/shade-*.svg`) |

The section aliases in `tokens/palette.css` are repointed to family B; the glass, ambient and type aliases were already the selected values. Losing families stay in the palette file for reference and can be deleted once you're certain.

## Font substitution — needs your input

No font files were supplied. The type candidates are Google Fonts stand-ins, loaded via `@import` in `tokens/fonts.css`:

- **A (default, recommended)** — IBM Plex Sans + IBM Plex Mono (true tabular numerals for clocks/ranks; best small-size rendering on mid-range Android).
- **B** — Outfit (single geometric family, friendliest, weaker at 12 px).
- **C** — Instrument Sans (tightest density for admin tables).
- Math fallback pre-KaTeX: Source Serif 4 italic (`--font-math`).

**If you have real brand fonts, send the files and I will swap them in and drop the losing families.** Icons are likewise substituted: the system standardises on **Lucide** from CDN (24 px grid, 1.75 px stroke) because no icon set was given.

---

## Content fundamentals

**Voice: a calm invigilator, not a coach.** The product administers timed practice with negative marking; it never cheers, never scolds, never guesses at your feelings.

- **Person.** Address the student as **you**; the product never says "I". Their own data is labelled neutrally — "Your score", "Your rank" — never "My quizzes".
- **Casing.** Sentence case everywhere: buttons, labels, headers, toasts. Title Case only for proper names (section names Verbal, Quant, Logical Reasoning; quiz names as the admin typed them). `ALL CAPS` only via `--type-overline` (11 px, `--ls-caps`) for eyebrows and table column heads.
- **Length.** Buttons 1–3 words ("Submit & lock", "Join quiz", "Re-draw"). Helper text one sentence. Error text one sentence stating what happened plus one action.
- **Numbers.** Always digits, always tabular. Scores can be fractional (38.5). Negative marks are shown signed with a true minus (`−1`, `−0.25`), never "(1)" or "-1" with a hyphen. Times are `m:ss` under an hour, `h:mm:ss` above. Dates are `14 Sep, 9:30 PM IST` — the IST suffix is always printed, since the whole group shares one timezone but screenshots travel.
- **Irreversibility is stated plainly, in the button.** "Submit & lock" not "Continue". "Lock quiz — retires 20 questions" not "Confirm". Destructive confirms name the consequence and the count; they never rely on the word "sure".
- **Waiting copy explains the rule, not the wait.** "Ranks unlock when the window closes at 9:30 PM IST" — because the delay is a secrecy requirement, and a student who understands it stops refreshing.
- **Empty states are instructional.** "No quizzes yet. Your group admin schedules these — you'll see them here." Never "Nothing to see here".
- **No emoji anywhere.** No exclamation marks except in genuinely celebratory *completion* copy ("Answers locked. Nice work." — full stop, still no exclamation preferred).
- **Never comment on performance.** Copy after a run reports facts ("18 of 20 answered"). There is no "Great job!" for a high score and no consolation for a low one.
- **Admin voice is slightly more technical** and speaks in the product's nouns: "row 47: missing `correct_option`", "4-question RC set + 3-question set + 13 standalone", "nothing is written until you commit".

## Visual foundations

**Direction: Apple-glass restraint over an ambient wash — serious content, light chrome.**

- **Backgrounds.** Never flat white. A fixed, viewport-anchored **ambient background** (`--ambient`, default `--amb-a`) of three soft radial lobes drawn from the section hues over a cool `#F4F7FC` base, plus a 3.5 %-opacity SVG grain (`--amb-noise`) to kill banding. It is a foundation token, not decoration — glass only reads as glass over a non-flat backdrop. Variants: `--amb-b` flat tinted wash (admin, dense data), `--amb-c` higher-chroma blobs (lobby, reveal, podium). Ambient lobes **never animate**; motion behind a timer reads as a state change. No photography, no illustration wallpaper, no full-bleed imagery — the only imagery in the product is a question's own attached image.
- **Transparency & blur.** Used for **chrome only**: nav bars, floating timer, chips, sheets, headers. Default recipe `--glass-*` = 62 % white / 18 px blur / 180 % saturate / white hairline / `--elev-2` + a 1 px inset dark ring. Anything that must be *read* — question stems, options, explanations, error copy, tables — sits on `--glass-bg-strong` (90 %) or an opaque surface. Where `backdrop-filter` is unsupported, glass degrades to `--glass-bg-strong`; layout never depends on seeing through.
- **Colour vibe.** Cool, low-chroma neutrals; one confident accent blue (`--accent-500` `#2F6BFF`) that is deliberately not a section colour, so "pressable" never reads as "section". Semantic ramps are muted (danger `#DB3A3F`, not fire-engine) because red is also a *content* colour under negative marking. Status is always tint + hairline border + dark ink, never a saturated fill, and always paired with a glyph — **no status is colour-only**.
- **Type.** Sans only, 12 px floor, 16 px/1.6 question stems at 375 px. Tabular lining numerals (`--numeric-features`) on every number that can change — scores, ranks, timers, tolerances — so digits never jitter. Display sizes are semibold, never bold-black; letter-spacing tightens (`--ls-tight`) only above 30 px.
- **Spacing & layout.** 4 px base with 2/6 px optical half-steps. 16 px phone gutter, 24 px desktop. Touch targets ≥ 44 px (`--tap-min`), live-run primaries 52 px (`--tap-comfortable`). Fixed elements in the live runner: the two clocks pinned top, the submit action pinned bottom — the question scrolls between them so a long stem plus an image never pushes the primary action off-screen.
- **Corners.** `--r-lg` 16 px cards, `--r-md` 12 px inner panels and buttons, `--r-sm` 8 px chips-in-panels, `--r-2xl` 28 px sheet tops, `--r-pill` for chips, badges and room-code segments. **Nesting rule:** an inner surface is exactly one step below its parent, so concentric corners never look wrong.
- **Cards.** Glass fill + 1 px white top-highlight border + 1 px inset dark ring + `--elev-2`. On glass, elevation is carried mostly by the inset ring; a heavy shadow under a translucent panel makes it read as plastic. Shadows are two-part (tight contact + wide ambient), never tinted with the accent, and never larger than `--elev-4` (modals only). No colored-left-border cards, no gradient-filled cards.
- **Borders.** Hairlines are alpha-black (`rgba(16,24,40,.08)`), not grey, so they hold up over the ambient wash. `--border-strong` 1.5 px only for a selected option; `--border-focus` 2 px only for focus.
- **Hover / press / disabled.** Hover darkens by one ramp step (`--accent-500` → `--accent-600`); ghost hover fills with `--accent-50`. Never opacity-based hover — opacity over glass looks broken. Press = `--press-scale` 0.98 scale in 80 ms plus the next darker step; no ripple. Disabled = `--action-disabled-bg/fg` (flat grey, no shadow), and a disabled primary always has adjacent text saying why. Focus = 2 px white spacer + 2 px accent ring outside the box (`box-shadow`, never `outline`), darkened to `--accent-600` on glass.
- **Motion.** Fast and unfussy: 80 ms press, 180 ms select, 260 ms question advance, 420 ms lock. One easing does most of the work (`--ease-standard`); `--ease-out` for entrances, `--ease-in` for exits. **`--ease-emphasis` is the system's only overshoot and is spent on exactly one moment — the answer-lock confirmation.** Timers use `--ease-linear`, driven by real remaining time, never a CSS animation that can drift. `prefers-reduced-motion` zeroes every duration and flattens the overshoot; timers keep their value-driven fill (it is information) but stop pulsing, and urgency falls back to digit weight plus a "5s left" label.
- **Protection.** Where content scrolls under fixed glass chrome, the chrome is a blurred capsule with a hairline, not a gradient scrim. The only scrim in the system is `--scrim` (36 % near-black + 6 px blur) behind modals and bottom sheets.

## Iconography

- **Set:** Lucide, from CDN — **substituted**, since no icon set was supplied. 24 × 24 grid, 1.75 px stroke, round caps/joins, `currentColor`. Stroke-only; no filled or duotone variants, no icon font, no PNG icons.
- **Sizes:** 16 px inline with 13 px text, 20 px in rows and chips, 24 px in nav and toolbars, 44 px minimum *target* regardless of glyph size.
- **Meaning:** status glyphs are mandatory and fixed — clock (per-question timer), hourglass (window deadline), lock (answers locked), shuffle (re-draw), upload (CSV import), trophy (leaderboard), users (participants), triangle-alert (error), wifi-off (reconnecting). A status colour never travels without its glyph.
- **Emoji:** never used in product UI. **Unicode as icons:** only the true minus (−), the multiplication sign in math content, and arrows in review navigation; no ✓/✗ as text — those are Lucide glyphs so stroke weight stays consistent.
- **Illustrations:** SVG files in `assets/illustrations/`, 160 × 120 box, ≤ 2 KB each, built on one object vocabulary — a stack of question cards, an hourglass, a completed card with a ribbon, a torn card — drawn as four scenes (empty, waiting, finished, error; "room full" reuses error) in three styles: `paper-*` (cut paper), **`shade-*` (soft shade — selected)**, `ink-*` (ink line). No faces anywhere. Illustrations never comment on performance: celebration is for *completion*, never for *results*.

---

## Index

| Path | What it is |
| --- | --- |
| `styles.css` | Global entry point — `@import` list only. Consumers link this. |
| `tokens/fonts.css` | Google Fonts `@import`s (substituted families). |
| `tokens/palette.css` | Neutral, accent, semantic ramps; all three section-colour families + active aliases. |
| `tokens/typography.css` | Families, size scale, weights, type roles, numeral features. |
| `tokens/space.css` | Spacing, gutters, touch targets, radii, border widths. |
| `tokens/effects.css` | Elevation, the three glass recipes, the three ambient backdrops, grain, focus rings, scrim. |
| `tokens/motion.css` | Durations, easings, named transitions, `prefers-reduced-motion` overrides. |
| `tokens/semantic.css` | Aliases: text, surfaces, actions, status, quiz-run tokens, review-only correctness tokens, rank. |
| `guidelines/foundations.html` | **Batch 1** — browsable reference: sticky TOC, all A/B/C variants, canonical scales, illustrations, a11y notes, pick sheet, open questions. |
| `guidelines/primitives-forms.html` | **Batch 2a** — button, form controls, `tita-numeric-input`, `file-dropzone`, `form-field`, `badge-pill`, `card-surface`. |
| `guidelines/layout-feedback.html` | **Batch 2b** — app shells (student/admin), `page-header`, `tabs-segmented`, `modal-sheet`, `destructive-confirm`, `toast`, `inline-alert`, `empty-state`, `loading-skeleton`, `error-state` + 403/404, `avatar-name-row`, `account-menu`, `data-table`, `pagination`, `filter-bar`, `countdown-timer`. |
| `guidelines/live-run.html` | **Batch 3** — `join-room-code`, `lobby-block`, `question-card`, `mcq-option-list`, `tita-answer-run`, `question-timer`, `window-deadline`, `progress-indicator`, `passage-set-layout`, `submit-lock-action`, transitions spec, and the four edge states (`room-full`, `resumed-after-disconnect`, `joined-late`, `deadline-mid-question`). |
| `guidelines/results-review.html` | **Batch 4** — `finish-card`, `holding-state`, `rank-reveal`, `score-breakdown-tiles`, `review-question-card`, `answer-distribution`, `time-vs-average`, `review-navigator`, `history-list-row`, `leaderboard-row`, `podium-top3`, `board-switcher`, `leaderboard-empty`, plus the three-tier disclosure ladder. |
| `guidelines/admin.html` | **Batch 5** — `csv-validation-preview`, `import-error-summary`, `import-commit-bar`, `question-row`, `question-editor`, `passage-group-card`, `quiz-builder-wizard`, `difficulty-mix-control`, `composition-report`, `draw-preview`, `scoring-parameter-panel` (with live bonus-decay curve), `schedule-picker`, `recurrence-editor`, `room-code-display`, `quiz-card-schedule`, `report-summary-tiles`, `participants-table`, `item-analysis-row`, `export-action`, `manage-admins-row`, `live-quiz-monitor` (speculative). |
| `SKILL.md` | Agent-Skills entry point, for using this system outside the project. |
| `assets/illustrations/*.svg` | 12 spot graphics — 3 styles × 4 scenes (`shade-*` selected). |
| `guidelines/cards/*.html` | 23 foundation specimen cards feeding the Design System tab (groups: Colors, Type, Spacing, Brand). |
| `thumbnail.html` | Project tile. |
| `readme.md` | This file. |

**Not built yet** (awaiting picks): `components/*` primitives, live-run components, results/leaderboard components, admin components, UI kits, `SKILL.md`. Component names will be kebab-case and stable across all five batches, matching the pick-sheet rows.

## How to choose the A/B/C picks

Every variant in all five batches is built from **this** token layer. Picks repoint alias variables only:

```css
/* section family */
--sec-verbal: var(--sec-verbal-b);  /* …etc */
/* glass recipe */
--glass-bg: var(--glass-b-bg); --glass-blur: var(--glass-b-blur); /* …etc */
/* ambient */
--ambient: var(--amb-c);
```

So a mixed selection (e.g. sections A + glass B + illustration C) still composes into one coherent system with no restructuring.
