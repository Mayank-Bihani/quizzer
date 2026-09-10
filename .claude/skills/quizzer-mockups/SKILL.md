---
name: quizzer-mockups
description: Build or edit the Quizzer UI mockups in mockups/ — static HTML+CSS screens for the student app, live quiz run and admin console. Use whenever working on any file under mockups/, adding a screen or state, or continuing a mockup batch. Loads the screen inventory, the token rules and the constraints that must not be re-derived.
---

# Quizzer mockups

Static HTML + CSS mockups of every Quizzer screen, built as **11 sprints**.

**Read `mockups/PROGRESS.md` first** — it is the to-do list and the resumption point. Work on
exactly one sprint, finish it, verify it, tick it off, stop. Never start a second sprint in the
same run.

`MOCKUP_PROMPT.md` §"How the work is organised" holds the sprint table and the dependency graph;
§"Running this with agents" covers orchestration if you are spawning subagents.

## The three source documents — read before building

| File | What it is | When to read |
|---|---|---|
| `design-system/guidelines/selections.md` | **The locked A/B/C picks**, their documented consequences, and the resolved product questions. Source of truth for which variant gets built | Always — before writing any component |
| `design-system/guidelines/*.html` | The six guidelines artifacts. Each holds one `<style>` block mixing real component CSS with catalogue chrome, and all three variants | When extracting a component |
| `design-system/tokens/*.css` | The canonical token layer `mockups/css/tokens.css` was copied from | If a token looks wrong |
| `MOCKUP_PROMPT.md` | The full brief: responsive strategy, file structure, content rules, batches, acceptance checklist | Starting a batch |
| `JOURNEYS.md` | Every user journey and the screen inventory (§7). The definitive list of screens and states | Starting a batch, or when unsure a state exists |
| `PRD.md` | Requirements. Cited by ID throughout the other two | When a screen's behaviour is unclear |

Do not re-derive decisions from these — they are settled. `JOURNEYS.md` §9 is the decisions log.

## Non-negotiables

These are the ones that get broken by a fresh session. Check every one before handing over.

0. **Build the picked variant only.** `design-system/guidelines/selections.md` records the
   winner for every component. Losing variants stay in the guidelines as reference and must
   never reach `mockups/`. Where selections mandates two variants for one component (mobile
   fallbacks below 640px: `data-table` C, `filter-bar` C, `question-row` C), build both.
1. **Tokens are law.** `mockups/css/tokens.css` is copied verbatim from the design system.
   **Never edit it. Never redefine a token in a screen stylesheet. Never hardcode a colour,
   size, radius or shadow** — if a value is missing, add it to the system-gaps list instead.
2. **Zero external requests.** No CDN, no web fonts, no image URLs, no icon libraries. Icons and
   illustrations are inline SVG. Every page must render from `file://` with the network off.
3. **HTML and CSS only.** JS lives in `mockups/index.html` alone, for screen navigation and the
   width switcher. No component behaviour in JS — every state is separate static markup.
   Timers do not count down; they are rendered at a fixed value.
4. **Do not equalise devices.** No artificial `max-width` cap on content. A laptop showing more
   of a passage is intended — fairness comes from students choosing their own device. Phones
   scroll long passages like a PDF.
5. **Nothing on a run screen may reveal correctness**, rank, score, or another student. No
   correct/incorrect styling anywhere in batch 2 (ROOM-10, ROOM-11).
6. **Both clocks on every run screen** — per-question timer and window deadline — visually
   distinct and never confusable.
7. **Skip sits well clear of submit** (ROOM-17). Secondary weight, no confirmation, and
   unmistakable at 390px. A mis-tapped skip costs the question outright.
8. **Phones are portrait-locked during a run.** Ship the rotate-prompt overlay fallback —
   `@media (orientation: landscape) and (max-width: 899px)` — because iOS Safari does not
   support the orientation lock API.
9. **Maths is inline MathML or styled spans.** Never an image, never raw `$...$`. KaTeX
   substitutes at runtime in the real app.
10. **Semantic HTML.** Real `<button>`, `<label>`, `<table>`, `<nav>`; correct heading order;
    `alt` text; visible focus rings. This markup is the reference the real app is built from.

## Widths

Verify every screen at **390** (phone, student default), **820** (tablet) and **1440**
(laptop, admin default). `min-width` queries only. Breakpoints 640 / 900 / 1280.
No horizontal scrollbar at any width except inside a table that declares `overflow-x: auto`.

Eight screens genuinely **relayout** rather than reflow — passage sets, both navigations, the
bank list, report tables, quiz builder, leaderboard and review. See `MOCKUP_PROMPT.md`
§"Reflow vs. relayout" for the per-screen table.

## Content

Realistic fixtures only, never lorem ipsum. Plausible CAT-style questions, Indian names
including one long enough to truncate, IST times (`2 Sep 2026, 9:00 PM`), room codes like
`QNT-8417`, scores with speed-bonus decimals (`54.4`). Include the awkward cases: a wrapping
option, 87th place, a zero-participant board, a 200-row import with 6 errors.

## Finishing a sprint

In this order, every time:

1. `bash mockups/check.sh` — mechanical verification. It must exit 0. Do not hand over with
   failures, and do not weaken a check to make it pass.
2. Work through the acceptance checklist at the end of `MOCKUP_PROMPT.md` for the states this
   sprint added — it covers what the script cannot see (layout at three widths, keyboard order).
3. Build the sprint's responsive proof page: its key screens in iframes at 390 / 820 / 1440.
4. Append anything the design system lacked to `mockups/SYSTEM-GAPS.md`.
5. Tick the sprint off in `mockups/PROGRESS.md` and add a handover note for the next sprint.

**S0 is the contract.** It defines `components.css` and the reference screen. Every later sprint
reads both before writing, and copies their conventions — class naming, markup structure, how a
card nests, how a state is labelled. A later sprint needing a new shared component **appends to
`components.css`**; screen stylesheets hold layout only.

If you are a subagent, keep your report to **15 lines**: files created, components added,
`check.sh` result, system gaps, what the next sprint needs.
