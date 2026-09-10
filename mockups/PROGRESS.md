# Mockup progress

The to-do list. Screen inventory is [[JOURNEYS]] §7; the brief and the sprint table are in
[[MOCKUP_PROMPT]]. Invoke the `quizzer-mockups` skill before working on any sprint.

**Rules:** one sprint at a time · `bash mockups/check.sh` must pass before a sprint is ticked ·
two sprints may run concurrently only if they are in different chains.

## Sprints

| # | Sprint | Depends on | States | Status |
|---|---|---|---|---|
| — | `css/tokens.css` copied verbatim from the design system | — | — | **done** |
| **S0** | Foundations & shell — extract `components.css` from the guidelines, `index.html` harness, both app shells, page header, reference screen (student home) | — | 5 | **done** 4 Sep |
| **S1** | Auth & entry — sign-in, quiz detail, join by code, lobby, room full, profile, 403, 404, session expired | S0 | 9 | **done** 4 Sep |
| **S2** | Run: core — MCQ, TITA, image question, selected, locked, skip idle, just-skipped, both clocks, progress | S0 | 9 | **done** 4 Sep |
| **S3** | Run: edges — passage first, passage mid-set, resumed, late join, reconnecting, timeout advance, deadline mid-question, rotate overlay | S2 | 8 | **done** 4 Sep |
| **S4** | Results — finish, holding, rank reveal, score breakdown | S0 | 4 | **done** 4 Sep |
| **S5** | Review — 5 outcomes, distribution, time-vs-average, navigator | S4 | 8 | **done** 4 Sep |
| **S6** | History & boards — history, history empty, per-quiz board, weekly board + tabs + week picker, board empty, did-not-take | S5 | 6 | **done** 4 Sep |
| **S7** | Admin: bank — console home, browse + filters, bank empty, editor MCQ, editor TITA, passage group | S0 | 6 | **done** 4 Sep |
| **S8** | Admin: import — upload, validation preview, commit confirm, import failed | S7 | 4 | **done** 4 Sep |
| **S9** | Admin: builder — define, draw + composition, params + bonus curve, schedule, lock confirm | S0 | 5 | **done** 4 Sep |
| **S10** | Admin: schedule & reports — schedule list, templates, report, participants, export, manage admins, promote/demote | S9 | 7 | **done** 4 Sep |

**Chains** (serial within, parallel across): `{S1}` · `{S2→S3}` · `{S4→S5→S6}` · `{S7→S8}` · `{S9→S10}`

**Review gates:** stop for human review after **S0** and after **S2**.

## S0 scope, measured

The design system lives at `design-system/`. It ships **no `components.css`** — every component
exists only as CSS + markup inside six guidelines HTML files, mixed with catalogue chrome and
all three variants. Measured across those files:

- **202 distinct class rules**, of which **32 are defined differently in more than one file** —
  including `.card`, `.btn`, `.inp`, `.state`, `.math`. `.card` genuinely diverges: opaque
  `--surface-raised` in `admin.html`, glass in `foundations.html`. Each conflict needs one
  deliberate resolution.
- **Catalogue chrome to strip**, not app components: `.vlabel` `.vmeta` `.vname` `.vbadge`
  `.vh` `.wrap` `.lede` `.trio`.
- `_ds_manifest.json` lists `components: 0` — there is no structured registry to read from, so
  extraction is by hand.

S0 turns that into one `components.css` holding the **picked** variant of each component, under
app-shaped names, with the 32 conflicts resolved once.

## S0 audit vs the design system — 4 Sep

Every rule in `components.css` was diffed against `design-system/guidelines/*.html`.
117 rules: 31 byte-identical, 51 new (shells, utilities, harness), 35 differing.
Of the 35, six were unjustified drift and were **corrected**:

| Rule | Was | Had become | Fixed |
|---|---|---|---|
| `.btn:active` | `background:var(--action-primary-bg-active)` + scale | scale only | restored |
| `.btn.sec:hover` | + `border-color:var(--border-strong-c)` | dropped | restored |
| `.b-closed` | transparent + border — deliberately quieter than `b-draft` | filled neutral, identical to draft | restored |
| `.state` | `padding:var(--sp-7)` | `var(--sp-9) var(--sp-7)` | restored |
| `.state p` | `max-width:34ch` | `38ch` | restored |
| `.alert` | `padding:var(--sp-4) var(--sp-5)` | `var(--sp-5)` | restored |

The remaining differences are the **documented** resolutions (`.card` glass, `.av` 36px,
shells rebuilt from demo frames, white literals tokenised) plus property reordering.

`check.sh` gained a comment-aware colour scan, so a literal quoted in a `/* */` note is
documentation rather than a violation. Verified it still catches a real one.

**Picks built in S0, all matching `selections.md`:** `card-surface` A · `badge-pill` A ·
`form-field` A · `tabs-segmented` A · `app-shell-student` A · `app-shell-admin` A ·
`page-header` A · `empty-state` A · `error-state` A · `loading-skeleton` A · `inline-alert` A ·
`avatar-name-row` A · `filter-bar` A (chips) · plus all five Batch-1 foundations.

**Shared components deliberately not built yet** — appended by the first sprint that needs one:
`toast` C, `modal-sheet` A, `destructive-confirm` A, `data-table` A, `pagination` A,
`countdown-timer` A.

## Resolved 4 Sep

- **CSV schema — not a blocker after all.** `selections.md` calls the Batch 5 schema invented,
  and it is: the guidelines mock `stem, section, correct_option`. The **real** schema is in
  [[BANK]] §3 and S8 must be built against it —
  `type, topic, subtopic, difficulty, format, passage_ref, body, image, option_a..d, correct,
  numeric_answer, tolerance, explanation, source` — with the twelve validation rules in
  [[BANK]] §3.1, every one reported by line number.
- **`inline-alert` — not a contradiction.** The guidelines say variant C is "the only correct
  pattern for connection state during a run"; A is for forms and admin flows. Both ship.
  A is `.alert` (built in S0); **C is `.strip`, to be added in S3.**
- **Fonts self-hosted.** `css/fonts.css` + `assets/fonts/` vendor the latin woff2 subsets of
  IBM Plex Sans, IBM Plex Mono and Source Serif 4 — 336 KB, no external requests. The mockups
  now render in production type. Losing candidates (Outfit, Manrope, Instrument Sans) omitted.
- **Width:** student pages fill the viewport; `.quiz-grid` adds columns as it grows rather than
  centring a phone-width column. Confirmed 4 Sep.
- **`.card` glass / `.card--solid` for dense admin tables.** Confirmed 4 Sep.
- **Shared components on demand** — appended by the first sprint that needs one. Confirmed 4 Sep.

## Blocking

Nothing. All S0-era blockers are resolved.

- **Difficulty = {easy, medium, hard}**, confirmed 4 Sep and written into [[BANK]] §3.1 and
  [[PLAN]]'s `questions` schema. Three levels, so `difficulty-mix-control` A (three steppers
  + running total) is correct as picked.

## S1 scope, built — 4 Sep

Seven screen files, twenty-one labelled states. `bash mockups/check.sh` passes.

| File | States |
|---|---|
| `student/signin.html` | idle · signing in · cancelled · rejected |
| `student/quiz-detail.html` | upcoming (code withheld) · room open (code released) · window closed |
| `student/join.html` | idle · typing · invalid code · joining |
| `student/lobby.html` | pre-open countdown · window open · no negative marking · last seats |
| `student/room-full.html` | room full · window already closed · seat held on another device |
| `student/profile.html` | student · admin · long name · signing out |
| `student/errors.html` | 403 · 404 · session expired · session expired mid-quiz |

Plus `css/screens-s1.css` (layout only) and `proof-s1.html` (all seven at 390 / 820 / 1440).

**Picks built, all matching `selections.md`:** `join-room-code` A · `lobby-block` A ·
`countdown-timer` A · `room-code-display` A · `room-full` A · `avatar-name-row` A +
account-menu · `error-state` A for 403 / 404 / expired · `inline-alert` A throughout.
No losing variant reached `mockups/` — `room-full` B (inline on the join screen) and
`join-room-code` B/C were deliberately not built, even though the join screen is where they
would have fitted.

**Appended to `components.css` (§18–26):** `.sr-only` · `.h2` / `.h3` ·
`.codefield` / `.codeslots` / `.slot` / `.dash` · `.codebox` (+ `--pending`) ·
`.cd` / `.cd-digits` / `.pill-clock` (+ `.urgent`) · `.facts` / `.fact` ·
`.namerow` (+ `.you`) · `.menu` · `.spin`.

## Fix after S1 review — 4 Sep

`student/profile.html` scrolled horizontally at 390 (scrollWidth 541 against a 390 viewport,
151px of overflow). `.profile` is a single-column grid below 900px; grid items default to
`min-width:auto`, whose floor is min-content, and `.profile__name` is `white-space:nowrap` —
so a long unbroken name ("Lakshminarayanan Venkataraghavan") set a 525px column floor and the
ellipsis never engaged. The >=900 rule already clamped this with `minmax(0,1.4fr)`; the base
rule did not. Fixed with `.profile > *{min-width:0}` in `css/screens-s1.css`, plus `truncate`
added to the two `.profile__id` email lines that lacked it. Re-measured: every S1 screen is
scrollWidth == viewport at 390 / 820 / 1440. check.sh still PASS.

Measuring note for later sprints: this headless Chrome ignores `--window-size` and renders at
500px, so probing a page directly hides phone-width overflow. Load the screen in a 390px-wide
iframe from a wrapper page, run with `--allow-file-access-from-files`, and read the iframe's
`documentElement.scrollWidth`. That is how this was caught.

## Verification — S1

- `check.sh` PASS, 8 screen files.
- Rendered every screen in a 390 / 820 / 1440 iframe in headless Chrome. **No horizontal
  scrollbar at any width on any screen.** Direct headless screenshots crop rather than resize
  the viewport, so they are useless for this — measure through an iframe or `proof-s1.html`.
- Breakpoints confirmed live: fact grid 2→4 columns at 640; the room-code block steps
  fs-38→fs-48 at 640; the bottom tab bar becomes the top nav at 900; quiz detail and profile
  split into main + aside at 900.
- Touch targets: every control a student taps on a phone is a full 44px `.btn`, `.menu` row or
  nav item. No `.btn.sm` survives in S1 — see SYSTEM-GAPS #8.
- Keyboard: real `<button>` / `<a>` / `<input>` / `<label>` throughout, correct heading order
  inside each state, `:focus-visible` ring everywhere, and `.codefield:focus-within` for the
  room-code slots.

## S2 scope, built — 4 Sep

Three screen files, eleven labelled states, covering the sprint's nine. `bash mockups/check.sh`
passes with 11 screen files.

| File | States |
|---|---|
| `student/run-mcq.html` | MCQ served (skip idle · both clocks · progress) · answer selected · submitting · answer locked · just-skipped · **both clocks, every zone** · **progress indicator** |
| `student/run-tita.html` | TITA served · answer entered · answer locked |
| `student/run-image.html` | question with an image (3-line stem, wrapping option) · final seconds with the window closing |

Plus `css/screens-s2.css` (harness only — how run states stack), `proof-s2.html`, and
`assets/illustrations/q-circle-tangents.svg`, the geometry figure for the image question.

**Picks built, all matching `selections.md`:** `question-card` A · `mcq-option-list` A ·
`tita-answer-run` A over `tita-numeric-input` B · `question-timer` B · `window-deadline` A ·
`progress-indicator` B · `submit-lock-action` A. No losing variant reached `mockups/` — in
particular `mcq-option-list` C (2×2 grid) and `question-card` C (split stem/answer pane) were
*not* used at 1440 even though both would have solved the wide-option-row problem.

**Appended to `components.css` (§27–36):** `.qcard` (+`__hdr` `__idrow` `__body` `__foot`) ·
`.qidx` · `.clock-win` (+`--final` `--closing`, `__note`) · `.qtimer` (+`__row` `__zone`) ·
`.tbar` (+`__grace` `__mark` `__fill`, `--grace` `--final` `--expired`) · `.clock-q`
(+`--urgent`) · `.progress` / `.pbar` / `.pbar__fill` · `.opts` / `.opt` (+`.k` `__txt`
`__lock`, selected / submitting / locked / dimmed) · `.answerbox` (+`--filled` `--locked`,
`__unit`) · `.keypad` · `.btn.lg` · `.qact` (+`__skip` `__note`) · `.lockcard` / `.lockring` ·
`.qfig` · and one fix to S0's `.mathblock` (`overflow-x:auto`, so a display equation scrolls on
its own axis instead of widening the page).

### Three judgement calls, all logged in SYSTEM-GAPS

- **The skip control does not exist in the design system** (#14). ROOM-17 requires it; Batch 3
  ships `submit-lock-action` with three variants and no second action. Designed here: secondary
  weight, its own row above Submit & lock, and the consequence line occupying the gap between
  them. That gap is the mitigation — do not put anything else in it.
- **The lock confirmation was built neutral, not success-green** (#15). The guidelines specify
  `--success-50/500/700`; a green ring the instant an answer locks reads as "correct" on the one
  screen where correctness may never appear.
- **The grace mark was moved above the fill** (#16). As drawn in the guidelines it is occluded
  by the fill for the first three-quarters of every question, which is exactly when the grace
  boundary is the thing the student needs to see.

## Verification — S2

- `check.sh` **PASS**, 11 screen files.
- **Measured, not eyeballed.** Every screen loaded in a 390 / 820 / 1440 iframe from a wrapper
  page (Chrome `--headless=new --allow-file-access-from-files`), reading the iframe's
  `documentElement.scrollWidth`. All 33 measurements equal the viewport exactly:
  `run-mcq` 390/820/1440, `run-tita` 390/820/1440, `run-image` 390/820/1440 — and the eight S1
  screens re-measured unchanged. A second pass scanned every element for `scrollWidth >
  clientWidth` without a declared `overflow-x`: the only hits are the `.sr-only` clip boxes,
  which are 1px and contained. Probe files live in the scratchpad; none were left in `mockups/`.
- **Tap targets:** every enabled control measured at all three widths; nothing under 44px. The
  option rows are 44px minimum, keypad keys are `--tap-comfortable`, Submit & lock is `.btn.lg`.
- **Keyboard:** focus order inside a question is the four radios, then Skip, then Submit & lock;
  one `<h1>` per `.qcard`; `:focus-visible` ring on the option rows via
  `.opts input:focus-visible+.opt`.
- **Leak check, by hand as well as by script:** no correctness colour, no running score, no
  rank, no participant count, no other student, and no marks scheme anywhere on a run screen.
  The only numbers are position (Q7 of 20, 30%), the two clocks, and the tolerance on a TITA
  answer. Locked is neutral grey; selected is accent — those are the only two option colours.
- **Both clocks on every state**, and they differ in form (bar vs. digit pill), colour
  (`--q-timer-*` vs. `--q-deadline-fill`), units (m:ss vs. h:mm:ss), glyph (◷ vs. ⌛), motion and
  escalation. Rendered side by side as a labelled reference in `run-mcq.html`.
- Breakpoints confirmed live: the action foot goes stacked → one row at 640; the header
  collapses 3 rows → 2 at 900 with identity and the window clock grouped left; the stem steps
  fs-16 → fs-18 → fs-20 at 900 and 1280 instead of the container being capped.

## Handover notes

Anything a later sprint needs to know goes here.

- **S0 built the shared layer only** — reset, ambient background, type/layout utilities,
  `.card` (+`--solid`, `.panel`), `.btn`, `.badge`/`.b-*`/`.chip-sec`, `.chip`, `.field`/`.inp`,
  `.seg`, `.av`, both app shells, `.phdr`, `.state`/`.skel`, `.alert`. Sprint-specific
  components (option list, timers, passage layout, review card, import preview) belong to their
  own sprints and get **appended to `components.css`**.
- **`.mock-state`** is harness-only: the caption strip that labels a stacked state inside a
  screen file. Use it for every extra state a screen renders.
- **Conflicts resolved in S0** (documented in the `components.css` header): `.card` is glass per
  `card-surface` A, with `.card--solid` for dense admin tables; `.av` follows layout-feedback
  (36px, section gradient); `.phone` and `.adm` demo frames were dropped and the shells rebuilt
  full-height.
- **Student main is not width-capped.** `.quiz-grid` adds columns as the viewport grows rather
  than centring a narrow column — per the "do not equalise" rule.
- `css/tokens.css` drops the two Google Fonts `@import` rules — no external requests allowed.
  Every `--font-*` stack carries a system fallback. Logged in `SYSTEM-GAPS.md`.

### From S1, for S2 and later

- **`.pill-clock` is the generic countdown, not a run clock.** S2 needs `window-deadline` A
  (dark pill, `--q-deadline-fill`) and `question-timer` B (linear bar with a grace band) as
  *separate* components. Do not reuse `.cd-digits` or `.pill-clock` for either — they are
  `countdown-timer` A, and the brief requires the two run clocks to be unconfusable.
- ~~**`.codeslots` / `.slot` is already the TITA digit display.**~~ **WRONG — corrected by S2,
  4 Sep.** Slot-rendering of the answer is `tita-numeric-input` **C**, a losing variant.
  `tita-answer-run` A is a single large display over a keypad, and the picked
  `tita-numeric-input` B agrees. S2 built `.answerbox` (a real `<input>`, so it carries the
  label, paste, autofill and `inputmode="decimal"`) plus `.keypad`. `.codeslots` was not
  touched and remains the room-code component only. See SYSTEM-GAPS #18.
- **The lobby is where the marks scheme is stated, and it is the last place it is stated.**
  Nothing in the run repeats it. S1 renders three schemes (`+3/−1/+0.5`, `+2/0/+0.4`, and an
  explicit "no negative marking") so nobody can copy a screen with the numbers baked in.
- **`.facts` is a `<dl>`.** Reuse it for the finish card's breakdown in S4 rather than
  inventing a tile.
- **Signed-out pages own their own centring** (`.auth-page` / `.deadend` in `screens-s1.css`) —
  there is no shell to hang them on. S3's rotate overlay and S4's holding screen are inside
  the shell and should not copy that.
- **`inline-alert` C (`.strip`) is still unbuilt** and is S3's to add, per the S0 note.
  S1 used `.alert` (variant A) only; nothing in S1 is a connection state.
- **Two measures are capped, deliberately:** `.auth-col` and `.join` at a `ch` measure, because
  a sign-in form and an eight-character code field are chrome, not quiz content. Every screen
  carrying quiz content stays uncapped — do not extend the cap into S2 or S3.

### From S2, for S3 and later

- **`.qcard` is the run screen, not a card in a shell.** There is no app shell during a run —
  no bottom bar, no back, nowhere to go — so `.qcard` is the whole document: sticky header,
  scrolling body, sticky foot, `min-height:100dvh`. S3's passage layouts and the rotate overlay
  belong *inside* it. `screens-s2.css` holds only the stacking harness (`.runpage`, `.runref`).
- **The skip control and its consequence line are one unit.** `.qact` puts skip above Submit &
  lock with the note between them; that vertical gap is the entire defence against a mis-tap
  (PRD §"mis-tapped skip"). Every S3 run state must carry the same foot — skip is an acceptance
  item on *every* run screen, including the resumed and late-join ones.
- **The two clocks are `.clock-win` (§28) and `.clock-q` + `.tbar` (§29).** `.pill-clock` and
  `.cd-digits` (§21) remain the lobby countdown and are still not to be reused here. S3's
  deadline-mid-question is `window-deadline` A escalating to `.clock-win--closing`, then
  `deadline-mid-question` B — a silent cut, with **no T−10s warning** (consequence 4).
- **`inline-alert` C (`.strip`) is still unbuilt** and is S3's, for the reconnecting state. S2
  used `.alert` (variant A) once, for the just-skipped notice, which is a flow statement rather
  than a connection state. Note `toast` C is barred from the run entirely (consequence 1).
- **Nothing in the run states the marks scheme.** Not the bonus value, not `marks_wrong`, not
  the max score — the lobby is the last place any of it appears (S1's note, honoured here). The
  timer says "Grace — full speed bonus" and "Speed bonus decaying" with no numbers, and the skip
  note says "Scores 0" because that is the rule for the action, not the quiz's scheme.
- **The grace band is data.** `.tbar__grace` and `.tbar__mark` take their width/left from
  `grace ÷ seconds_per_question` (22% for the 45s/10s sample). A quiz with `grace = 0` renders
  neither element and nothing else changes — do not add a stub.
- **`.opt` is a radio group, not a list of buttons.** `<input class="sr-only" type="radio">`
  immediately followed by `<label class="opt">`, so `:checked + .opt` carries the selected
  state with no JS. Anything that needs to beat `:checked` must match its specificity — that is
  why `.opt.locked` is written `.opt.locked,.opts input:checked+.opt.locked`.
- **Wide widths are not capped and must stay uncapped.** At 1440 an option row is the full
  content width. That is deliberate: `mcq-option-list` C (2×2) and `question-card` C (split
  pane) would both tidy it and both lost. The stem grows by type size instead. S3's passage
  layout is the one screen that genuinely relayouts at 900 — `passage-set-layout` A, split pane.
- **S2 is a review gate.** `MOCKUP_PROMPT` §"Review cadence" stops for human review after S0 and
  after S2; S3 should not start until the run has been looked at.

## S3 scope, built — 4 Sep

Four screen files, eight labelled states (plus two component-reference blocks), covering the
sprint's eight. `bash mockups/check.sh` passes with 15 screen files.

| File | States |
|---|---|
| `student/run-passage.html` | Passage set, first question (Q1 of 4) · passage set, mid-set (Q3 of 4) — same passage both times, only the right-hand question changes |
| `student/run-interrupt.html` | Reconnecting banner over a live, still-answerable question (+ connection-strip family reference) · resumed after disconnect · joined late |
| `student/run-deadline.html` | Time-expired auto-advance (the 900ms hold, then the next question with a notice) · deadline mid-question (silent cut) |
| `student/run-rotate.html` | Rotate-to-portrait overlay, forced open for review, plus the real `@media` trigger attached to a live question |

Plus `css/screens-s3.css` (layout only — the full-screen run interstitial wrapper `.runstate`,
reused for resumed/late-join/deadline-cut) and `proof-s3.html`.

**Picks built, all matching `selections.md`:** `passage-set-layout` A (split pane) ·
`resumed-after-disconnect` B (resume card, one tap to continue) · `joined-late` A
(reality-check card) · `deadline-mid-question` B (silent cut to the finish card) ·
`inline-alert` C (`.strip`, reconnecting/offline/reconnected). No losing variant reached
`mockups/` — in particular `deadline-mid-question` A (the countdown takeover with a T−10s
warning) was *not* built, even though it is friendlier, because selections.md picked B.
Time-expired auto-advance is not a variant to pick at all — the guidelines' Transitions table
is canonical with no A/B/C — so it was built directly from that spec, reusing S2's
`.tbar--expired` / `.opt.dimmed` / `.lockcard` / `.alert` with no new component.

**Appended to `components.css` (§37–40):** `.pset` / `.pset__passage` / `.pset__passage-text` /
`.pset__q` (passage-set-layout A) · `.strip` + `.strip .dot` (inline-alert C, the connection
state reserved since S0) · `.rotate-lock` (+ `--demo`, `__icon`, `__t`, `__p`) — a component the
design system does not have at all, built from the MOCKUP_PROMPT "Orientation" spec. `resumed`
and `late-join` reuse `.state` as-is; `deadline-mid-question` reuses `.lockcard` with the
hourglass icon already established by S2's timeout styling. All three logged in SYSTEM-GAPS
(#19–21).

## Verification — S3

- `check.sh` **PASS**, 15 screen files.
- **Measured, not eyeballed.** All four new screens loaded in 390/820/1440 iframes (Chrome
  `--headless=new --allow-file-access-from-files`), reading `documentElement.scrollWidth`: 12/12
  measurements equal the viewport exactly. Separately confirmed the passage split live: at 820px
  `.pset` is still one column (`grid-template-columns` reports a single track) and the passage
  pane is capped at `228px` (`38vh` in the test viewport); at 1440px it reports two `680px`
  tracks and the passage cap computes to `none` — the `min-width:900px` breakpoint firing exactly
  where `selections.md` and MOCKUP_PROMPT's reflow table say it should, and nowhere earlier.
- **Rotate overlay:** the real trigger (`@media (orientation:landscape) and (max-width:899px)`)
  cannot be shown by a portrait screenshot at any of the three canonical widths — this is stated
  in-page on `run-rotate.html` and on `proof-s3.html` rather than left implicit. The
  forced-open `.rotate-lock--demo` copy carries the reviewable markup instead.
  Rendering is otherwise sane, but this line was recorded rather than photographed
  and inherits the risk of any unverified CSS: if the real app's fullscreen orientation-lock
  path or the fallback media query drift apart, this file will not catch it.
- **Leak check:** no correctness colour, no rank, no score, no other student anywhere in the four
  files — `check.sh`'s run-screen scan covers them (filenames match `run`) and passed. The
  deadline-mid-question card states a plain fact ("17 of 20 answered") with no scheme attached,
  matching consequence 4's requirement that the student is told what was not submitted.
- **Both clocks** stay present and distinct through every edge case that keeps a question on
  screen — passage set (both clocks in the header, unchanged from S2), reconnecting (both clocks
  keep running visibly), time-expired (the question clock reads 0:00 and the window clock is
  untouched). The two interstitials that replace the whole screen (resumed, late-join,
  deadline-cut) correctly show *no* clock — there is no question open to time.
- **Skip** is present, in its S2 position, on every screen where a question is actually open
  (passage set, reconnecting) and correctly absent from the four full-screen interstitials, which
  have no question to skip.
- **Touch targets:** "Continue Q11", "Start anyway", "Back to Home" are all `.btn`/`.btn.ghost`
  — 44px by inheritance, nothing new to check.
- **Keyboard:** every stacked demo state that stands alone (resumed, late-join,
  deadline-mid-question, the rotate demo) gets its own `<h1>`, following the precedent
  `room-full.html` set in S1 for stacking dead-end pages in one file; states nested inside an
  already-headed `.qcard` keep using `<p>` for `.lockcard__t`, exactly as S2 did.

## Handover notes — from S3, for S4 and later

- **The passage pane is not re-fetched or re-rendered between questions in a set** — S3's two
  `run-passage.html` states use byte-identical passage markup on purpose, only the `.pset__q`
  side differs. Any later screen that touches a passage set should preserve that, not treat each
  question as an independent fetch.
- **`.runstate` is the new full-screen interstitial wrapper**, parallel to S1's `.deadend` but
  deliberately not shared with it — each sprint's screen CSS stays self-contained per the S0/S1/S2
  convention. If S4's holding screen or finish card also needs a full-bleed centred `.state`, it
  should define its own `.runstate`-shaped rule in `screens-s4.css` rather than importing S3's.
- **`deadline-mid-question` ends silently, mid-lockcard, with no link forward** — by design (B is
  the silent-cut pick), the screen just says "Continuing to your results…". S4's finish card is
  the actual next screen a real student would see; nothing in S3 links to it because S4 doesn't
  exist yet. When S4 is built, check whether that transition deserves an explicit note there
  ("some of your answers came from a session that hit the deadline").
- **`.strip` and `.alert` share their status-colour classes on purpose** (`a-info`/`a-warn`/
  `a-dgr`/`a-ok`) — one palette, two surfaces. Do not give `.strip` its own colour set later; add
  a new shared status class instead if a fifth tone is ever needed.
- **The rotate overlay is unverified by screenshot, by construction.** Its real trigger is an
  orientation media query that a fixed-width headless browser cannot satisfy. If a future sprint
  gets real device/emulator access, re-check `run-rotate.html`'s live trigger (the "real trigger"
  reference block) by actually rotating a sub-900px viewport to landscape.
- **No S3 screen needed a new size/spacing token** — everything came from tokens already in
  `tokens.css` or spacing already established in components.css §17's `--size-*` gap (SYSTEM-GAPS
  #17 still stands, unchanged by this sprint).
- **S4 (Results) depends on S0 only, not S3** — per PROGRESS's dependency table it can start
  immediately; it does not need anything built here beyond `.facts` (already noted by S2) and the
  general convention of stacking labelled states in one file per screen.

## S4 scope, built — 4 Sep

Three screen files, six labelled states, covering the sprint's four (finish, holding, rank
reveal, score breakdown — the last two compose into one screen, since post-deadline they unlock
together). `bash mockups/check.sh` passes with 18 screen files.

| File | States |
|---|---|
| `student/finish.html` | Normal finish (score + answered count only) · arrived via S3's deadline-mid-question silent cut (states which question was not submitted, per selections.md consequence 4) |
| `student/holding.html` | Mid-wait (finisher count, countdown, own score) · final two minutes (countdown escalated) |
| `student/rank-reveal.html` | Rank in context (neighbours) + score breakdown (reconciling ledger) — one page, both unlock at the hard deadline |

Plus `css/screens-s4.css` (layout only — `.resultpage` for the two captive interstitials,
`.resultsview` for the post-deadline page) and `proof-s4.html`.

**Picks built, all matching `selections.md`:** `finish-card` A (score hero) · `holding-state` B
(waiting-room, illustration-led) · `rank-reveal` B (rank in context, neighbours) ·
`score-breakdown-tiles` B (reconciling ledger). No losing variant reached `mockups/` — in
particular `rank-reveal` C (staged reveal animation) and `finish-card` C (sealed envelope) were
not built even though both are more "eventful," because selections.md picked otherwise.

**The disclosure ladder drove every layout decision.** Tier 1 (`finish.html`) shows exactly two
numbers and nothing else — no rank, no correctness, no comparison. Tier 2 (`holding.html`) adds
one social fact, a finisher count, never names or scores. Tier 3 (`rank-reveal.html`) is the
first screen anywhere in the product allowed to show a rank, a named neighbour, another
student's score, or `--rv-*` correctness colour — confirmed by hand that no earlier sprint's run
or interstitial screens carry any of it.

**Appended to `components.css` (§41–43):** `.wlabel` (neutral overline caption, distinct from
`.eyebrow`'s accent colour) · `.hero` / `.numhero` / `.numhero__value` (shared "big number, small
caption above it" pattern for finish score, rank number, holding's score recap) · `.rankrow` (+
`.you`, `__pos`, `__score`) — reuses S1's `avatar-name-row A` (`.namerow`, `.namerow.you`) rather
than a second avatar-row shape · `.ledger` (+ `__row`, `__row--total`, `__val`, `__ok`, `__no`) —
new, score-breakdown-tiles B's reconciling ledger. Three judgement calls logged in SYSTEM-GAPS
(#22–24), the most consequential being #22: `.rankrow` and S6's upcoming `leaderboard-row` A are
visually similar avatar rows built independently — S6 should extend `.rankrow`/`.namerow` rather
than invent a third shape.

## Verification — S4

- `check.sh` **PASS**, 18 screen files.
- **Measured, not eyeballed.** All three screens loaded in 390/820/1440 iframes (Chrome
  `--headless=new --allow-file-access-from-files`), reading `documentElement.scrollWidth`: 9/9
  measurements equal the viewport exactly. A second pass scanned every element in each screen for
  `scrollWidth > clientWidth` with `overflow-x` still `visible`: zero offenders at 390 or 820.
  Probe files live in the scratchpad; none were left in `mockups/`.
- **Leak check, by hand.** `finish.html` and `holding.html` carry no rank, no correctness colour,
  no other student, no leaderboard, no "you beat N" comparison — confirmed by reading both files
  end to end, not just by `check.sh`'s run-screen scan (these filenames don't match `run|question
  |passage`, so that scan doesn't even fire on them; the discipline here is entirely manual,
  which is why it's recorded explicitly). `rank-reveal.html` is correctly the first screen to show
  any of it, and only because it is tier 3, post-deadline.
- **Numbers reconcile end to end.** The same attempt (Weekly Quant Sprint #27, 20 questions, 14
  correct / 4 wrong / 2 skipped, +0.5 bonus, 38.5 of 60, 18 of 20 answered) is used unchanged
  across `finish.html`, both states of `holding.html`, and the rank-reveal + ledger in
  `rank-reveal.html` — a reviewer can check the ledger's arithmetic against the finish card's
  headline number. The deadline-cut variant of `finish.html` reuses S3's exact figures (17 of 20
  answered, Q18 not submitted) so the two sprints read as one continuous story.
- **Touch targets:** every button is `.btn` (44px) or `.btn.ghost`/`.btn.sec` at full size; nothing
  in this sprint used `.btn.sm` for a student-facing action.
- **Keyboard / structure:** each stacked state in `finish.html` and `holding.html` gets its own
  `<h1>`, per the room-full.html / run-interrupt.html precedent for independent stacked states;
  `rank-reveal.html` is a single page with correct `<h1>` → `<h2>` order. All links are real `<a>`,
  focus rings inherited from `.btn`/`:focus-visible`.

## Handover notes — from S4, for S5 and later

- **`--rv-correct-fg` / `--rv-wrong-fg` are now in use** (`.ledger__ok` / `.ledger__no`) for the
  first time in `mockups/`. S5's `review-question-card`, `answer-distribution` and
  `time-vs-average` will want the same two tokens extensively — reuse `.ledger__ok`/`.ledger__no`
  for any plain coloured-text case rather than redefining the colours a third time; the
  `--rv-correct-bg`/`--rv-wrong-bg` tinted-row treatment (for the annotated option list) is still
  unbuilt and is S5's to add.
- **`.rankrow` vs. S6's `leaderboard-row` A** (SYSTEM-GAPS #22) is an open decision, not a done
  one. Read it before starting S6 — building a second avatar-row component independently would
  leave two similar-but-different rows in the same product.
- **`.resultpage` (screens-s4.css) is the captive-interstitial wrapper for this sprint only**,
  parallel to S1's `.deadend` and S3's `.runstate` — same shape, deliberately not imported, per
  the running S0–S3 convention that each sprint's screen CSS is self-contained. S5's review
  screen is *not* captive (free navigation, per JOURNEYS §SJ-7) and should use the app shell like
  `rank-reveal.html` does, not `.resultpage`.
- **`rank-reveal.html` lives inside `.app`**, not `.resultpage` — tier 3 restores normal
  navigation (Home, History, review, leaderboard are all live choices again), unlike finish and
  holding which have nowhere else to go. S5's review screen and S6's history/board screens should
  default to the app shell too, reserving `.resultpage`-style captive wrappers for states with
  genuinely no navigation.
- **"Review answers" and "See leaderboard" on `rank-reveal.html` link to `home.html`** as
  placeholders, matching the established convention (e.g. S0's `quiz-detail.html` → `lobby.html`
  link) for pointing at a destination that doesn't exist yet. S5 should retarget "Review answers"
  to its own review screen once built; S6 should retarget "See leaderboard".
- **No new size/spacing token was needed.** `--fs-64` (the hero number) and `--fs-48` (rank
  inline) both already existed in `tokens.css`, unused until now — SYSTEM-GAPS #17's `--size-*`
  gap stands unchanged.

## S5 scope, built — 4 Sep

One screen file, eight labelled states, covering the sprint's four components (review card
across five outcomes, answer distribution, time-vs-average, review navigator).
`bash mockups/check.sh` passes with 19 screen files.

| File | States |
|---|---|
| `student/review.html` | Correct · Wrong (MathML trap question) · Skipped (wrapping option) · Timed out · Not reached · collapsed index with one row expanded in place · distribution/time-vs-average edge cases (even split, heavy majority, TITA numeric buckets) · review navigator (sticky bar + grid sheet) |

Plus `css/screens-s5.css` (layout only) and `proof-s5.html`.

**Picks built, all matching `selections.md`:** `review-question-card` **C + A composed** (the
collapsed index expands in place into the full annotated-option-list card — states 1–3 show A
directly, state 6 shows the actual C→A composition) · `answer-distribution` A (mini bars under
the options) · `time-vs-average` B (delta chip) · `review-navigator` A (sticky bottom bar + grid
sheet). No losing variant reached `mockups/`.

**Five outcomes, not four — the main departure from the guidelines.** JOURNEYS §SJ-7 and
MOCKUP_PROMPT both require correct / wrong / skipped / **timed out** / not reached as distinct
outcomes, but the guidelines' own review sample conflates skip and timeout under one `b-skip`
badge. Built `.b-timeout` (SYSTEM-GAPS #25), reusing `--rv-skipped-*` (both score 0, no penalty)
with a dashed border and its own glyph/word so the two are never confused. The reviewing
student's own attempt (14 correct / 4 wrong / 2 skipped / 0 not reached, reconciled with
`rank-reveal.html`'s ledger) has no timed-out or not-reached questions, so those two states
deliberately reuse a **different** student's session — Q14 and Q19 from S3's
`run-deadline.html` / S4's `finish.html` deadline-cut state — rather than inventing new numbers
or forcing a fifth bucket into an already-shipped, already-reconciled ledger. Each card says so
explicitly and links back to its source screen.

**Appended to `components.css` (§44–51):** `.rcard` (+ `__hdr`, `__idx`, `__main`, `__aside`,
relayouts to two columns at 900px — one of the eight screens that genuinely relayouts per
MOCKUP_PROMPT) · outcome badges `.b-ok`/`.b-no`/`.b-skip`/`.b-timeout`/`.b-nr` · `.ropt` (+
`__k`, `__txt`, `__tag`, `.correct`/`.wrong`/`.muted`) · `.dist`/`.dist__row`/`.dist__opt`/
`.dist__bar`/`.dist__fill` · `.badge.tva-fast`/`.tva-same`/`.tva-slow` · `.rnav`/`.rnav__pos`/
`.rgrid`/`.rcell`/`.rlegend` (5 columns on a phone so every cell clears 44px, 10 from 640px) ·
`.rrow` (the collapsed index button). Three judgement calls logged in SYSTEM-GAPS (#25–27), the
most consequential being #25's second half: `review-navigator` A's sticky bottom bar collides
with `app-shell-student` A's persistent bottom tab bar on a phone, and the guidelines never
reconcile the two. Resolved by suppressing `.navbar` on `review.html` entirely and letting the
navigator take that edge, with the page-header back-link as the way out.

## Verification — S5

- `check.sh` **PASS**, 19 screen files.
- **Measured, not eyeballed.** `review.html` loaded in 390/820/900/1440 iframes (Chrome
  `--headless=new --allow-file-access-from-files`), reading `documentElement.scrollWidth`: all
  four equal the viewport exactly, and a full-element scan for `scrollWidth > clientWidth` with
  `overflow-x` still `visible` found zero offenders at any width. Probe files live in the
  scratchpad; none were left in `mockups/`.
- **The relayout fires exactly at 900px and nowhere earlier.** `.rcard`'s computed
  `grid-template-columns` is a single track below 900 (`324px` at 390, `738px` at 820) and two
  tracks at 900 and up (`498px 300px` at 900, `1038px 300px` at 1440) — confirming state → answer
  → distribution → explanation stacks on phone/tablet and splits into question-left,
  explanation-right on laptop, per MOCKUP_PROMPT's reflow/relayout table.
- **`.rgrid` touch targets measured, not assumed.** 5 columns below 640px, 10 from 640 up;
  computed cell size at every breakpoint: 60px (390), 109.8px (639, just before the switch),
  51.4px (640, just after), 131.4px (1440) — every cell clears 44px, including the narrowest
  case right at the breakpoint. The guidelines' own fixed 10-column grid would not have (SYSTEM-
  GAPS #25).
- **Leak check, by hand.** `review.html` doesn't match `check.sh`'s run-screen filename scan
  (`run|question|passage`), so — as with S4 — the discipline here is manual: confirmed
  correctness colour, the correct answer, distributions and time comparisons appear **only** on
  this tier-3 screen, and that every number reconciles with `rank-reveal.html` (14/4/2/0, 38.5 of
  60) for the states drawn from that attempt.
- **Wrong-answer maths checked by hand.** The guidelines' own worked example for the quadratic
  question (`x³ − 8 = 27 − 8 = 19 ⇒ 21`) doesn't reconcile — 27 − 8 is 19, not 21. Rebuilt with
  correct value B and a genuinely wrong distractor C so the explanation and the marked correct
  option agree.
- **Touch targets:** every `.rrow`, `.rcell` and `.rnav__pos` is a real `<button>` at or above
  44px (checked above for `.rcell`, the tightest case); `.rrow` reaches 44px through padding.
- **Keyboard / structure:** each of the 8 states is independently headed (`<h1>`/`<h2>` via
  `.rcard__idx`'s wrapping `aria-labelledby` or an explicit heading), following the
  room-full.html/finish.html precedent for stacked independent demo states in one file; every
  interactive element is a real `<button>` or `<a>`, focus rings inherited from existing
  component rules.

## Handover notes — from S5, for S6 and later

- **`.rankrow`/`leaderboard-row` A (SYSTEM-GAPS #22) is still open** — S5 didn't touch it, and it
  remains S6's decision before building the per-quiz and weekly boards.
- **`.rnav`/`.rgrid`/`.rcell` are review-only** and deliberately not reused for anything
  leaderboard-shaped — they navigate *questions within one student's attempt*, which is a
  different axis from a leaderboard's *rows of other students*. Don't reach for `.rcell` when
  building `podium-top3` or `board-switcher`.
- **`review.html` has no bottom tab bar, by design** (SYSTEM-GAPS #25) — `review-navigator` A's
  sticky bar took that edge instead. S6's history and leaderboard screens do **not** have this
  problem (neither component wants the bottom edge) and should keep the normal `.navbar`/`.
  topnav` shell like `rank-reveal.html` does — this is a one-screen exception, not a new pattern.
- **`.dist`/`.dist__row` now has a documented TITA/numeric adaptation** (SYSTEM-GAPS #26, the
  "Within ±1" bucket reading) — reuse that shape rather than reinventing a histogram if a later
  sprint's admin item-analysis (S10) needs a numeric-question distribution too.
- **The "5 outcomes" ledger tension is now on record** (SYSTEM-GAPS #25): a single attempt's
  breakdown (`.ledger` in `rank-reveal.html`) has no line for "timed out" separate from
  "skipped" — both fall under the guidelines' scoring bucket (SCORE-4) but JOURNEYS names them
  separately for review purposes. S6's history list should decide whether a past attempt's
  summary needs a fifth count too, or whether "skipped" stays a combined bucket everywhere except
  the per-question review card.
- **"Review answers" on `rank-reveal.html` now points at `review.html`** — S4's handover asked
  S5 to do this once the real screen existed; done as part of this sprint (one line in an S4
  file, otherwise untouched). "See leaderboard" still points at `home.html`, correctly, since
  that is S6's screen to build.
- **No new size/spacing token was needed.** The `--sp-10` (40px) token stands in for the
  guidelines' literal 42px percentage column in `.dist__row`, the same kind of approximation
  SYSTEM-GAPS #17 already flags for `.av`/`.slot` — still worth a real `--size-*` scale upstream.

## S6 scope, built — 4 Sep

Five screen files, covering the sprint's six named states (history, history empty, per-quiz
board, weekly board + tabs + week picker, board empty, did-not-take — board empty and did-not-take
each render as multiple labelled sub-states, per the S4 precedent of building more granular states
than the count implies). `bash mockups/check.sh` passes with 24 screen files.

| File | States |
|---|---|
| `student/history.html` | Populated (attempted · results-held · not-attempted rows, in one list) · empty (new student) |
| `student/leaderboard-quiz.html` | Per-quiz board for Weekly Quant Sprint #27 — ranks 1–5, a mid-table tie broken by time, the negative-score last-place case (81–83 of 83) |
| `student/leaderboard-weekly.html` | Overall · week 37 (current, "next" disabled) · Quant · week 37 (a genuinely different ranking) · Overall · week 36 (previous week, both arrows enabled) |
| `student/leaderboard-empty.html` | Too early (embargo) · no entries (zero-participant board) · no quiz this section this week — all three "nothings" the guideline distinguishes, one component shape |
| `student/did-not-take.html` | Reached from History's "not attempted" row · reached from a shared link to a quiz you weren't in |

Plus `css/screens-s6.css` (layout only), `proof-s6.html`, and index.html/PROGRESS.md updates.

**Picks built, all matching `selections.md`:** `history-list-row` A (two-line row) ·
`leaderboard-row` A (flat row, medal rule) · `podium-top3` **B** (ranked strip — consequence 5:
no podium metaphor anywhere, so top-3 is just the medal-rule treatment on the ordinary row, not a
separate component) · `board-switcher` A (segmented sections + week stepper) · `leaderboard-empty`
A (embargo notice, reused for all three "nothings" rather than switching to C's shape for two of
them). No losing variant reached `mockups/`.

**The `.rankrow` vs. `leaderboard-row A` question (SYSTEM-GAPS #22, held open since S4, explicitly
flagged again in the S5 handover) is resolved: extend, don't replace.** `.rankrow` already had the
exact shape leaderboard-row A needs — rank, avatar, name, score. This sprint appended opt-in
pieces rather than a second component: `.rankrow--list` (its own surface + border, for a long
standalone board list — the 3-row context list in `rank-reveal.html` never gets this modifier and
stays pixel-identical to what S4 shipped), `.r1`/`.r2`/`.r3` medal classes (colour on the numeral
and a rule on the row, never on name/score text — the guideline's own contrast rule), a shared
`.badge.b-you` tag, and `.rankrow__tb`/`__sec`/`__count` — three cells hidden below 900px and
revealed above it, which is this sprint's one genuine relayout per MOCKUP_PROMPT's reflow/relayout
table ("Leaderboard: phone rank+name+score; tablet/laptop adds tie-break time, section,
quizzes-counted"), confirmed to fire exactly at 900px and nowhere earlier. `.rcell`/`.rgrid` (S5's
review navigator) were correctly left untouched, as the S5 handover asked — a leaderboard row
(one row per *other* student) is a different axis from a review cell (one cell per *this*
student's own question), and nothing here reached for that shape.

**Appended to `components.css` (§52–55):** the `.rankrow` extensions above · `.weekpick` (the
week-stepper half of board-switcher A; the section-tab half reuses `.seg` as-is, unchanged) ·
`.hrow` (+ `__name`, `__meta`, `__aside`, `__score`, `--muted`, `--held`) — history-list-row A,
a real `<a>` when there's a review to open, a plain `<div>` for the two states with nowhere to go
yet · `.chip-sec.b-overall`. Four judgement calls logged in SYSTEM-GAPS (#28–31): #28 is the
`.rankrow` resolution above in gap-log form, #29 is a missing 3px border-width token (used
`--border-focus`, 2px, the widest available), #30 is `pagination A` still being unbuilt (both
boards use a truncated list + "⋯ N more ⋯" text divider + a plain `#`-anchor jump-to-me link
instead — real and working, but not the sticky sticky-on-scroll mini-row the guideline describes,
which needs scroll-position JS a static mockup can't fake), and #31 is an unspecified product
question (what a per-row "section" column means on the *combined* weekly board).

## Verification — S6

- `check.sh` **PASS**, 24 screen files.
- **Measured, not eyeballed.** All five screens loaded in 390/820/1440 iframes (Chrome
  `--headless=new --allow-file-access-from-files`), reading `documentElement.scrollWidth`: 15/15
  measurements equal the viewport exactly, and a full-element scan for `scrollWidth > clientWidth`
  with `overflow-x` still `visible` found zero offenders at any width on any screen.
- **The relayout fires exactly at 900px and nowhere earlier.** `.rankrow__tb`'s computed `display`
  is `none` at 390 and 899, and switches (to the flex-item-blockified `flex`, confirming it's
  actually shown) at exactly 900 and stays that way at 1440 — checked live, not assumed from the
  media query text.
- **Touch targets, measured and fixed, not assumed.** The first pass found two real violations:
  `.rankrow--list` rows at 42px (added `min-height:var(--tap-min)`) and the "Jump to my rank" link
  built as `.btn.sec.sm` (36px — SYSTEM-GAPS #8 explicitly bars `.btn.sm` from anything a student
  taps on a phone; changed to full-size `.btn.sec`). Re-measured after the fix: every `.weekpick`
  button, `.hrow`, `.rankrow--list` and `.btn` on all three new interactive screens is ≥44px at
  390px, with zero exceptions.
- **Leak check — the opposite direction from every earlier sprint.** `check.sh`'s run-screen scan
  doesn't fire here (filenames don't match `run|question|passage`), and correctly so: these are
  tier-3, participant-only or public-by-design screens where rank, score and other students'
  names are supposed to appear (BOARD-1, BOARD-3). Confirmed by hand instead that the *non*-public
  boundary holds: `leaderboard-empty.html` and `did-not-take.html` show no rank, no name, no score
  for the quiz in question — exactly SJ-10's rule that a non-participant sees neither the review
  nor the per-quiz leaderboard for a quiz they missed.
- **Numbers reconcile end to end, across sprints.** `leaderboard-quiz.html`'s ranks 3/4/5 (Meera
  Pillai 39.0, You 38.5, Devansh Oberoi 37.5) are byte-identical to `rank-reveal.html`'s (S4)
  neighbour rows, and `history.html`'s Sprint #27 row (2 Sep, rank 4 of 83, 38.5) matches both.
  `history.html`'s other rows (#26 at 54.4/rank 7 of 87, Para Jumbles at 38.0/rank 23 of 74) are
  copied unchanged from `home.html`'s (S0) own "recent quizzes" section rather than invented fresh
  — a real date-continuity bug was caught and fixed here: an early draft dated Sprint #27 "14 Sep"
  from the guideline's own sample, which contradicted `home.html`'s established "today is
  Wednesday, 2 September" and its Sprint #27 card being "Open now, closes 9:55 PM" the same day.
- **Fixed two dead placeholder links from earlier sprints**, now that real targets exist:
  `rank-reveal.html`'s "See leaderboard" → `leaderboard-quiz.html` (S4's handover asked for this)
  and every `home.html`/`profile.html`/`join.html`/`lobby.html`/`quiz-detail.html`/`review.html`
  topnav+navbar "History"/"Leaderboards"/"Boards" link, which pointed at `home.html` as a
  placeholder since S0. Also fixed `home.html` and `rank-reveal.html`'s navbar "Profile" link,
  which pointed at `home.html` instead of the `profile.html` S1 built — a pre-existing miss, not
  introduced here, caught while touching the same lines.
- **Keyboard / structure:** every stacked demo state gets its own heading (`<h1>` for `history.html`
  and `did-not-take.html`'s independent states, `<h2>`/`.wlabel` sections for the two board
  screens), following the room-full.html/finish.html precedent; every interactive element is a
  real `<a>` or `<button>`, focus rings inherited from existing component rules; the "Jump to my
  rank" control is a genuine same-page `#`-anchor, so it works with no JS and is keyboard-reachable.

## Handover notes — from S6, for S7 and later

- **S6 was the last sprint in the `{S4→S5→S6}` chain.** The three remaining chains — `{S7→S8}`
  admin: bank/import and `{S9→S10}` admin: builder/schedule — are both still fully open and both
  depend only on S0, so either (or both, run concurrently — they touch disjoint files) can start
  next.
- **`.rankrow` is now a three-context component**: bare (rank-reveal's short in-card list),
  `.rankrow--list` (a long standalone board). Any future admin screen that needs a ranked list
  (e.g. a report's top performers) should extend this the same way rather than starting a fourth
  avatar-row shape — check here first.
- **`pagination A` is still unbuilt** (SYSTEM-GAPS #30) — three sprints now have wanted it
  (S1's implied long lists, S6's history and both boards) and none has built it. Whichever admin
  sprint first needs a genuinely long list (S7's bank browse, at "1,400 questions", is the likely
  candidate) should build it properly instead of improvising a fourth truncation pattern.
- **No 3px border-width token exists** (SYSTEM-GAPS #29) — `--border-focus` (2px) stood in for
  the medal rule. Same family as #17's missing `--size-*` scale; worth fixing both at once
  upstream rather than one token at a time per sprint.
- **Weekly-board "section" semantics (SYSTEM-GAPS #31) are a genuine open product question**, not
  just a mockup gap — BOARD-6 specifies per-section and overall boards but never says what a
  per-row section label means on the combined one. Flag it if S10's reports ever need the same
  "which section does this aggregate row belong to" answer.

## S7 scope, built — 4 Sep

Four screen files, covering the sprint's six named states (console home; bank browse + filters
and bank empty; editor MCQ and TITA, plus a bonus validation-error state; passage group, plus a
bonus validation-error state). `bash mockups/check.sh` passes with 28 screen files.

**First sprint to exercise the admin shell for real.** S0 built `.adm`/`.adm__bar`/`.adm__side`/
`.adm__main` as bare CSS with no screen ever loading it, so this sprint is where its gaps
surfaced — most importantly, S0 shipped no mobile story at all (SYSTEM-GAPS #32).

| File | States |
|---|---|
| `admin/console-home.html` | Needs-attention alerts (draw shortfall, import errors) + quick-link cards into Bank/Quizzes/Schedule/Reports/Admins |
| `admin/bank.html` | Browse — all questions (diverse rows: MCQ w/ LaTeX, vocabulary, LR, retired, TITA, passage-linked, image) · Browse — filtered (Quant/Medium/Unused, count reconciles with console-home's warning) · Empty (no CSV imported yet) |
| `admin/item-editor.html` | MCQ (Weekly Quant Sprint #27's Q7, corrected to the right answer) · TITA (S2's milk-mixture question, locked at 25.6) · validation error (bonus — unclosed math delimiter, Save disabled) |
| `admin/passage-group.html` | Passage group (S3's Reading Comprehension Set 12 passage, same 2 of 4 questions the run showed) · validation error (bonus — a group of 2, BANK-6 requires 4–5) |

Plus `css/screens-s7.css` (layout only) and `proof-s7.html`.

**Renamed on the way in:** the JOURNEYS.md screen is "Question editor", but `check.sh`'s
run-screen leak scan matches any filename containing `question` or `passage` (aimed at
`run-*.html`, not admin CRUD) — `question-editor.html` would have false-failed on the word
"Explanation", which an admin editor is supposed to show. Renamed to `item-editor.html` rather
than weakening the check; `passage-group.html` currently passes clean but carries the same risk
for a future edit.

**Picks built, all matching `selections.md`:** `data-table` A (dense, sticky header) + C (mobile
card, mandatory <640px) · `pagination` A (load more — the first sprint to build it for real,
per S6's handover) · `filter-bar` A (chips) + C (sheet, mandatory <640px) · `question-row` A + C
· `question-editor` A (two-pane) · `passage-group-card` A (header + child rows). No losing
variant reached `mockups/`.

**Appended to `components.css` (§56–62):** `.admdrawer` (admin mobile nav — not in the design
system at all, built from MOCKUP_PROMPT's reflow table) · `.tablewrap`/`table.dt`/badge classes
(`.b-easy`/`.b-med`/`.b-hard`/`.b-unused`/`.b-used`/`.b-retired`) + `.selectbar` (data-table A) ·
`.bankcard`/`.bankcard__check` (question-row C) · `.pager` (pagination A) · `.filtersheet`
(filter-bar C) · `.editor`/`.editor__form`/`.editor__preview`/`.optedit` (question-editor A) ·
`.pgroup`/`.pgroup__head`/`.pgroup__toprow`/`.pgroup__title`/`.pgroup__child` (passage-group-card
A). Seven judgement calls logged in SYSTEM-GAPS (#32–38).

**Two real, zero-JS `<details>` disclosures**, a first for this build: the admin drawer nav and
the mobile filter sheet. No JS anywhere, natively keyboard-operable, and — unlike the rest of the
codebase's convention of *describing* an interaction with static alternate states — these two
actually work when opened by a reviewer, because "does the admin console have a mobile nav at
all" (SYSTEM-GAPS #32) needed a real answer, not just a rendered snapshot of one.

**Cross-sprint continuity, deliberate:** the MCQ editor holds the same Q7 quadratic
`review.html` (S5) already shows wrong and fixed (19, not the guideline's broken 21) — the bank
record now agrees with the run and the review. The TITA editor holds `run-tita.html`'s (S2)
milk-mixture question, locked at the same 25.6. The passage group holds `run-passage.html`'s
(S3) exact tank-irrigation passage and two of its four questions. Console home's "88 unused this
week" and "41 unused Medium" warning both reconcile with bank.html's filtered-state count.

## Verification — S7

- `check.sh` **PASS**, 28 screen files.
- **Measured, not eyeballed — and the measurement technique itself needed a second pass.** All
  four screens loaded in 390/820/900/1440 iframes (Chrome `--headless=new
  --allow-file-access-from-files`), gated on `document.fonts.ready` (admin text is dense enough
  that a fallback-font race is not academic — see below). `body.scrollWidth === clientWidth`
  exactly at all 16 width/file combinations. `document.documentElement.scrollWidth` disagreed
  with `body.scrollWidth` at two of them (bank at 820 and 900, where the dense table's own
  `overflow-x:auto` legitimately scrolls) — confirmed by direct `--window-size` screenshot that
  this is a measurement artifact of `documentElement.scrollWidth` picking up a nested
  auto-overflow container's content width, not a real page-level scrollbar: the screenshot shows
  a clean 820px-wide page with the table correctly clipped at its own edge.
- **A `--screenshot` CLI rendering artifact was caught and ruled out, not shipped.** Direct
  screenshots of the admin header appeared to cut off "Rohan Sethi" past the viewport edge at
  every width tried, including with `--virtual-time-budget=5000`. Cross-checked with the
  `fonts.ready`-gated DOM measurement: `.tiny.truncate`'s own `getBoundingClientRect()` sits
  entirely inside the 390px viewport (`right=374`), `.truncate`'s ellipsis is engaging correctly,
  and `document.fonts.status` reports `loaded`. The screenshot flag's own rendering pipeline is
  the unreliable instrument here, not the page — recorded so a future sprint doesn't waste time
  re-chasing the same phantom.
- **Two real grid/flex blowout bugs found and fixed at the source**, not patched around — see
  SYSTEM-GAPS #34. `.tablewrap` (bank.html, a grid item of `.bankhead`) and `.pgroup__head`
  (passage-group.html, itself `display:grid`) both grew to their content's min-content width
  before the fix; both are now capped and re-measured clean.
- **Touch targets, measured and fixed, not assumed.** The dense desktop table's checkbox stays
  native-sized (~16–18px) — an accepted trade already documented by `data-table` A's own "36px
  rows" note, and desktop is mouse-driven. The mobile card fallback's checkbox — plausibly a
  touch target, since that is exactly why the fallback exists — was wrapped in a new
  `.bankcard__check` label and measured at 44×44px. The mobile filter-sheet trigger and the admin
  drawer trigger were both built at 44×44px from the start (not `.btn.sm`), per SYSTEM-GAPS #8's
  standing rule for anything tapped on a phone.
- **Leak check, the admin direction.** Unlike every student sprint, this one is *supposed* to
  show correct answers, explanations and usage history — that is the entire point of a bank
  editor. Confirmed by hand that nothing in S1–S6's tier-1/tier-2 student screens (finish,
  holding, the run) gained a new leak path via any shared component S7 touched (`.badge`,
  `.chip`, `.panel` were reused as-is, not modified).
- **Keyboard / structure:** every interactive control is a real `<button>`/`<a>`/`<input>`/
  `<select>`/`<label>`/`<details><summary>`; radios and their letter labels are `for`/`id`
  associated; `:focus-visible` is inherited from the global rule (no per-element opt-in needed,
  confirmed it fires on `<summary>` too). Heading order: each file carries one `<h1>` for the
  screen, with stacked minor states (browse/filtered, MCQ/TITA/error) treated as variations of
  that one screen rather than independently-headed pages, matching `run-mcq.html`'s precedent;
  bank-empty's `<h5>` (inside `.state`) is the one place a second heading was warranted, matching
  every earlier empty-state's own pattern.

## Handover notes — from S7, for S8 and later

- **The admin shell now has a real mobile story.** `.admdrawer` (§56) is the pattern for any
  future admin screen below 900px — reuse it rather than re-deriving a drawer, and reuse `.menu`
  for its link list rather than inventing a second dropdown shape.
- **`.tablewrap`'s show/hide-by-breakpoint is the shared contract for every future `data-table`
  screen** (SYSTEM-GAPS #33) — S10's participants-table picked the same A variant and should
  reuse `.tablewrap`/`table.dt` as-is rather than rebuilding the mobile-fallback toggle.
- **Grid/flex blowout (SYSTEM-GAPS #34) will happen again if it isn't watched for.** Any new
  `display:grid` or nowrap `display:flex` container holding text — not just tables — needs
  `min-width:0` on its children checked explicitly; it will not show up by eye, only by
  measurement (`body.scrollWidth` vs `clientWidth`), and it will not show up in `check.sh` at
  all. S9's quiz-builder-wizard (two-column, form left / draw preview right) and S10's
  participants-table and report tiles are the next screens dense enough to be at risk.
- **`document.documentElement.scrollWidth` is the wrong metric once a screen has a legitimate
  internal horizontal-scroll container** (a table, in this sprint). Measure `body.scrollWidth`
  instead, or confirm with a direct `--window-size` screenshot — `documentElement`'s figure can
  disagree with the page's actual rendered width once something like `.tablewrap` is in play.
- **The `--screenshot` CLI flag is not trustworthy for text near a viewport edge** (S7
  verification, above) — cross-check anything that looks cut off against a `fonts.ready`-gated
  DOM measurement before treating it as a real bug. This cost real time this sprint; a future
  sprint hitting the same appearance should check the DOM first.
- **Filenames matter to `check.sh`'s run-screen leak scan** (`run|question|passage`), not just to
  humans. Any future admin screen whose natural name would contain "question", "passage" or
  "run" should be renamed the way `item-editor.html` was, rather than the scan being weakened or
  the screen being left to false-fail.
- **`.bankcard__check` is the pattern for a touch-sized checkbox hit area** — any future mobile
  card fallback with a selectable row (participants, report rows) should reuse this rather than
  shipping a bare native checkbox at phone widths.
- **The bank's real CSV schema (BANK.md §3) is what S8 must validate against** — `type, topic,
  subtopic, difficulty, format, passage_ref, body, image, option_a..d, correct, numeric_answer,
  tolerance, explanation, source` — not the guideline's invented `stem, section, correct_option`
  (SYSTEM-GAPS #6, still open, now S8's to close).
- **Every "Import CSV" link in this sprint points at `console-home.html` as a placeholder**
  (`bank.html`'s two instances, console-home's own needs-attention link) — S8 should retarget all
  three to its real upload screen once built, per the established S4→S5/S5→S6 handover
  convention for placeholder links.
- **`{S9→S10}` remains the other open chain**, unaffected by anything in this sprint — S9 (quiz
  builder) can start immediately and in parallel with S8, since the two chains touch disjoint
  files.

## S9 scope, built — 4 Sep

Five screen files, covering the sprint's five named states (define; draw with composition report
and reshuffle; scoring parameters incl. bonus-decay curve; schedule; lock confirmation).
`bash mockups/check.sh` passes with 36 screen files.

| File | States |
|---|---|
| `admin/builder-define.html` | Valid difficulty mix (6/10/4 = 20, Continue enabled) &middot; invalid mix (21 &ne; 20, Continue blocked) |
| `admin/builder-draw.html` | Drawn, all standalone (draw-preview A + composition-report A, the sprint's one relayout) &middot; composition with a passage set (bonus, a Verbal quiz) &middot; pool exhaustion resolved by reuse (bonus, a different quiz) |
| `admin/builder-scoring.html` | Parameters set with the live bonus-decay curve &middot; seat cap clamped to 120 (QUIZ-9) |
| `admin/builder-schedule.html` | One-off, valid window &middot; recurring (recurrence-editor A) &middot; window too short (QUIZ-10, not in any guideline variant) |
| `admin/builder-lock.html` | Confirm, not yet typed (Lock quiz disabled) &middot; typed correctly (enabled) &middot; locked (room code assigned, still withheld) |

Plus `css/screens-s9.css` (layout only) and `proof-s9.html`.

**One flagship quiz carries the whole wizard**, the same discipline S3/S4/S7 used: **Weekly
Quant Sprint #28** — 20 standalone Quant questions, 6/10/4 easy/medium/hard, 45s/question,
+3/&minus;1/+0.5, seat cap 120, opens 9 Sep 2026 9:30 PM IST, window 25 minutes, closes 9:55 PM
IST, room code `QNT-9103` assigned at lock. It reconciles with `console-home.html`'s (S7)
needs-attention alert (rewritten this sprint — see below) and with `bank.html`'s (S7) "41 unused
Medium" filtered count. Two bonus states use different quizzes where the flagship can't
demonstrate the point: a passage-set composition (Quant carries none) and pool exhaustion (the
flagship never runs short).

**Picks built, all matching `selections.md`:** `quiz-builder-wizard` A (horizontal stepper,
relabelled Define/Draw/Scoring/Schedule/Lock to match this sprint's five screens rather than the
guideline's own Define/Draw/Review/Schedule/Lock, since the guideline's "Review" step content is
described as "draw preview and composition report" — the same content as this build's Draw step)
&middot; `difficulty-mix-control` A &middot; `composition-report` A &middot; `draw-preview` A
&middot; `scoring-parameter-panel` A &middot; `schedule-picker` A &middot; `recurrence-editor` A
&middot; `destructive-confirm` **B** (type-to-confirm, for the lock, per consequence 2) built on
`modal-sheet` **A**. No losing variant reached `mockups/`.

**First sprint to build `modal-sheet` and `destructive-confirm`**, both deferred since S0's
"deliberately not built yet" list. Neither guideline artifact models the real fixed-to-viewport
overlay — both only ever show `.scrim`/`.dlg`/`.sheet` boxed inside a catalogue `.stage`. Building
the literal `position:fixed` version broke the "stack every state in one file" convention (two
fixed dialogs from different states fight over the same viewport); matched the guideline's own
`.stage`-scoped choice instead — logged as SYSTEM-GAPS #43.

**Appended to `components.css` (§66–72):** `.steps`/`.step` (quiz-builder-wizard A) &middot;
`.mix`/`.mixrow`/`.mixbar`/`.mixtotal` (difficulty-mix-control A) &middot; `table.spec`
(composition-report A's breakdown table, distinct from `table.dt`) &middot; `.drawrow` (+
`--swapped`, `--group`) (draw-preview A) &middot; `.scrim`/`.dlg`/`.sheet`/`.grabber` (modal-sheet
A) &middot; `.confirmbody` (destructive-confirm B) &middot; `.dlg--demo`/`.sheet--demo` (forces one
shell visible, reusing S3's `--demo` technique). Six judgement calls logged in SYSTEM-GAPS
(#43–48), continuing the numbering from S8.

**Two admin CSV/nav fixes made on the way in**, following the S6/S7/S8 precedent of retargeting
placeholder links once their real screen exists: every "Quizzes" nav link across all seven
existing S7/S8 admin files (`console-home.html`, `bank.html`, `item-editor.html`,
`passage-group.html`, `import-upload.html`, `import-preview.html`, `import-commit.html`) now
points at `builder-define.html` instead of `console-home.html`. `console-home.html`'s own
needs-attention alert and Quizzes dashcard were rewritten: the alert now attributes the "62
unused Medium" figure to the recurring template's cumulative demand across its next 6 occurrences
(reconciled with `builder-schedule.html`'s recurrence-editor state) rather than to a single
quiz's draw, which the original S7 copy asserted but never actually added up (a single 20-question
quiz's exam-like mix wants 10 Medium, not 62) — this was a latent inconsistency in S7's own
fixture, not something S9 introduced, caught and fixed while wiring the link.

### Two judgement calls beyond the component picks

- **PRD open question 1 (pool exhaustion)** resolved as reuse-with-an-explicit-warning-flag, not a
  hard failure or a silent fallback — SYSTEM-GAPS #45. Not a product decision, a mockup judgement
  call; confirm before implementation.
- **QUIZ-10's window-length minimum** (`count × time_per_q`, plus slack) has no guideline variant
  at all; built directly from the requirement as a new `schedule-picker` state — SYSTEM-GAPS #46.

## Verification — S9

- `check.sh` **PASS**, 36 screen files.
- **Measured, not eyeballed.** All five screens driven through the real Chrome DevTools Protocol
  (headless Chrome, `Emulation.setDeviceMetricsOverride`) at 390/820/1440 — `document.body.
  scrollWidth` equals `clientWidth` exactly at all 15 width/file combinations, and a full-element
  scan for `scrollWidth > clientWidth` with `overflow-x` still `visible` found zero offenders
  anywhere. `console-home.html` and `bank.html` were re-measured after their nav/copy edits and
  are still exact at all three widths. Probe scripts live in the scratchpad; none were left in
  `mockups/`.
- **The relayouts fire exactly where specified and nowhere earlier.** `builder-draw.html`'s
  `.drawgrid` (MOCKUP_PROMPT: "quiz builder — stacked on phone, form-left/live-draw-preview-right
  on tablet/laptop") reports a single track at 390 and 820 (358px, 772px) and two tracks at 1440
  (360px / 776px) — the `min-width:900px` breakpoint firing exactly there, not at 820.
  `builder-scoring.html`'s `.scoregrid` (fields beside the curve, a narrower threshold since six
  short fields and a compact chart fit well before 900px) is single-column at 390 and two columns
  (402px/300px) at both 820 and 1440, matching its own `min-width:640px` rule.
- **`modal-sheet` A's dialog/sheet toggle confirmed firing at exactly 640px, not approximately.**
  Measured `.dlg`/`.sheet` computed `display` at 390, 639, 640, 820 and 1440: `sheet` shows below
  640, `dlg` shows at 640 and above, with no width in between showing both or neither.
- **Touch targets, measured and fixed, not assumed — two real violations found.** The lock
  dialog's Cancel/Lock quiz buttons were originally `.btn.sm` (36px, copied from the guideline's
  own `destructive-confirm` B markup) — measured, then every `.sm` modifier was stripped from all
  five files' primary actions (Back/Continue on every step, Re-draw all, the per-question swap
  buttons, Cancel/Lock quiz, View in Schedule/Done): 44px everywhere afterward, re-measured clean.
  Separately, `builder-schedule.html`'s one-off/recurring `.seg` toggle measured 36px — `.seg
  button`'s standing 36px height (SYSTEM-GAPS #8) reaching, for the first time, a screen where it
  is the step's primary always-tappable control rather than a secondary desktop-only one — fixed
  locally with a token-based inline `min-height:var(--tap-min)` rather than editing the shared
  `.seg` rule (SYSTEM-GAPS #48).
- **Numbers reconcile end to end, across sprints.** Sprint #28's 20-question, 6/10/4, 45s/+3/
  &minus;1/+0.5, seat-cap-120, 9:30–9:55 PM window figures are byte-identical across all five
  builder files; the recurring-template "62 Medium across 6 occurrences" figure now matches
  between `console-home.html`'s alert (rewritten) and `builder-schedule.html`'s recurrence state;
  `builder-draw.html`'s "41 unused Medium" note matches `bank.html`'s (S7) filtered-state count
  unchanged.
- **Leak check — not applicable in the run sense.** These are admin-only screens with no student
  ever reaching them; `check.sh`'s run-screen scan correctly doesn't fire on any of the five
  filenames (none contain `run`, `question` or `passage`).
- **Keyboard / structure:** one `<h1>` per screen (the quiz name or step name), `<h2>` per stacked
  form state following the `item-editor.html`/`run-mcq.html` precedent; every difficulty-mix
  stepper, window-length and weekday choice is inside a `role="group"` with `aria-labelledby`;
  the lock dialog is `role="dialog" aria-modal="true" aria-labelledby`; the two zero-JS `<details>`
  disclosures (admin drawer, "show 12 more drawn questions") are natively keyboard-operable,
  matching S7/S8's precedent; `:focus-visible` inherited from the global rule throughout.

## Handover notes — from S9, for S10 and later

- **S10 (schedule list, templates, report, participants, export, manage admins) is the last
  sprint.** It depends on S9 (this one) and touches `console-home.html`'s "Schedule"/"Reports"/
  "Admins" nav links, all still pointing at `console-home.html` as placeholders — retarget them
  once the real screens exist, per the established handover convention.
- **`table.spec` (§68) is a new, quieter sibling of `table.dt` (§57)** — no sticky header, no row
  hover, no sort, built for composition-report's read-only key/value rows. S10's report-summary
  panel is the likely next consumer; reuse it rather than reaching for `table.dt` or inventing a
  third table shape.
- **`.steps`/`.step` (§66) is the only stepper in the build.** If S10's schedule list ever wants a
  progress indicator of its own (e.g. for a recurring-template's generation state), it is a
  different axis (a status, not a sequence of steps to complete) — don't reach for `.steps` there
  without checking the shape actually fits.
- **`.scrim`/`.dlg`/`.sheet` (§70) are `position:absolute`, scoped to `.stage`, not
  `position:fixed`** — SYSTEM-GAPS #43. Any future screen needing a real confirmation dialog
  (S10's promote/demote confirm is explicitly in scope) should reuse this exact pattern: wrap the
  dialog's demo rendering in its own `.stage`-shaped container per state, rather than assuming a
  viewport-fixed dialog can safely stack twice in one file.
- **`destructive-confirm` A (consequence list + weighted buttons, for a low-stakes delete) is
  still unbuilt** — this sprint only needed B (type-to-confirm, for the lock). If S10 or a later
  fix to S7's bank ever needs "delete this question" with A's lighter-weight confirmation, build
  it as a sibling of `.confirmbody` rather than reusing B's type-to-confirm input for a
  single-click-reversible-risk action.
- **`.seg button`'s 36px height (SYSTEM-GAPS #8, extended by #48) is still not fixed upstream** —
  S9 worked around its one instance locally. Any S10 screen reusing `.seg` as a primary,
  always-visible control (not a secondary desktop-only toggle) should check its measured height
  before assuming 44px.
- **Two PRD open questions were given mockup-only answers, not product decisions**: pool
  exhaustion (SYSTEM-GAPS #45, resolved as reuse-with-a-warning) and the window-length minimum
  (SYSTEM-GAPS #46, built from QUIZ-10 directly). Both should be confirmed with a real product
  decision before implementation; S10's report/schedule screens should not treat either as settled.
- **Room code `QNT-9103` (Sprint #28) and quiz number 28 are new fixture data**, distinct from
  every earlier sprint's `QNT-8417` (Sprint #27). S10's schedule list should show Sprint #28
  alongside #27 (and whichever other quizzes it invents) as a genuinely different quiz, not a
  restatement of the same one.

## S8 scope, built — 4 Sep

Three screen files, covering the sprint's four named states (upload; validation preview with
per-line errors; commit confirmation; import failed — commit confirm and import failed share one
file, following the S7 `item-editor.html` precedent of bundling a component's related states
rather than one file per state). `bash mockups/check.sh` passes with 31 screen files.

| File | States |
|---|---|
| `admin/import-upload.html` | Idle (nothing chosen) · drag-over · uploading (CSV done, ZIP in progress) · upload failed (ZIP over the size limit, before any parsing) |
| `admin/import-preview.html` | Mixed — 200 rows, 6 errors across 6 causes, 194 valid, "Show 194 valid rows" a real `<details>` disclosure · all valid (a second, smaller batch) · nothing importable (rejected legacy header) |
| `admin/import-commit.html` | Commit confirm (nothing written yet) · committing (chunked progress) · success (194 added) · import failed (a mid-commit chunk failure, whole import rolled back) |

Plus `css/screens-s8.css` (layout only) and `proof-s8.html`.

**Picks built, all matching `selections.md`:** `file-dropzone` A (single zone, two file types) ·
`csv-validation-preview` **B** (errors first, valid collapsed) · `import-error-summary` A (grouped
by cause) · `import-commit-bar` A (sticky footer bar). No losing variant reached `mockups/`. Note
`csv-validation-preview` B is `selections.md`'s locked pick even though `admin.html`'s own in-page
catalogue commentary (a different, non-authoritative list) says A — `selections.md` is the source
of truth per the skill's standing instruction, so B was built.

**The real CSV schema, not the guideline's invented one — the blocker `selections.md` flagged as
"still blocking the component build" is now closed.** Every column name, error message and the
rejected-header comparison in this sprint quotes `[[BANK]] §3`'s real header row — `type, topic,
subtopic, difficulty, format, passage_ref, body, image, option_a..d, correct, numeric_answer,
tolerance, explanation, source` — and validates against its twelve rules in §3.1. The guideline's
own invented schema (`stem, section, correct_option`) appears exactly once, deliberately, as the
legacy file rejected in `import-preview.html`'s "nothing importable" state.

**Six errors across 200 rows, matching the content brief's own required fixture, and matching S7
exactly.** `admin/console-home.html`'s "needs attention" alert already stated "committed 194 of
200 rows — 6 errors were skipped" before this sprint started; S8 built the preview and commit
screens to reconcile with those exact numbers rather than inventing new ones. The six causes are
one line each — `difficulty` empty (line 14), a TITA row missing `tolerance` (line 47), an
unresolved `passage_ref` "RC-9" (line 88), `correct` = "E" (line 112), `type` = "quantitative"
(line 140), and an `image` missing from the companion ZIP (line 156) — chosen to exercise six of
BANK.md's twelve validation rules without cascading (each skips exactly one row, so 200 − 6 = 194
holds arithmetically end to end across all three files).

**Appended to `components.css` (§63–65):** `.dz` (+ `--drag`, `--up`, `--err`, `__icon`) and
`.filerow` (+ `__nm`, `__sz`) for file-dropzone A · `.b-err` (a plain danger pill — genuinely new,
since `.b-hard` is difficulty-scoped and `.b-live` is a reserved filled solid) · `.commitbar`
(+ `--ok`, `--err`, `__msg`) for import-commit-bar A. Deliberately reused rather than duplicated:
`.pbar`/`.pbar__fill` (S2) for both the upload and commit progress bars, `.facts`/`.fact` (S1) for
the commit-confirm write summary, `.panel` (S0) for both the error-cause rows and the collapsed
valid-row list, and `.chip`/`.chip.on` (S0) for the count chips. Four judgement calls logged in
SYSTEM-GAPS (#39–42), continuing the numbering from S7.

**One deliberate width cap, flagged rather than silently applied.** `.dzwrap`/`.commitwrap`
(`screens-s8.css`) cap the dropzone and the commit confirmation at 640px on a 1440px admin screen
— S7 explicitly rejected a content-width cap for the bank's tables and dashboard, but a drag
target or a confirmation dialog is chrome, not content, the same reasoning S1 used for
`.auth-col`/`.join`. Flagged here rather than left implicit in case a later sprint reads this as a
precedent for capping admin content generally, which it is not.

## Verification — S8

- `check.sh` **PASS**, 31 screen files.
- **Measured, not eyeballed.** All three screens loaded in 390/820/1440 iframes (Chrome
  `--headless=new --allow-file-access-from-files`), reading `body.scrollWidth` against
  `documentElement.clientWidth`: 9/9 measurements equal the viewport exactly. **Every `<details>`
  disclosure was forced open before measuring**, not just the default-closed state — this caught
  a real bug (below).
- **One real grid/flex blowout, found and fixed at the source, not patched around.** With the
  "Show 194 valid rows" disclosure open, `import-preview.html` overflowed to 405px at a 390px
  viewport. The cause was `.errgroup`'s grid items (`.panel` rows) and their own flex children
  defaulting `min-width` to `auto` — the exact SYSTEM-GAPS #34 pattern S7 already logged twice.
  Fixed with explicit `min-width:0` at every level (`.errgroup`, `.errgroup .panel`, `.errgroup
  .panel>*`) in `screens-s8.css`; re-measured at 390/820/1440 with the disclosure open, all three
  exact. This would not have been caught by measuring only the closed, default state.
- **Touch targets, measured and fixed, not assumed.** The first pass found three violations
  copied straight from the design-system guideline's own `.btn.sec.sm`/`.btn.ghost.sm` markup
  (Cancel, Try again, Continue with CSV only, all 36px) — the same class of mistake S6 already
  caught and fixed once ("Jump to my rank"). Removed every `.sm` modifier from all three files
  (eleven buttons/links in total); re-measured with every disclosure open at 390/820/1440 — zero
  controls under 44px anywhere in the sprint.
- **Leak check — not applicable in the run sense, but checked anyway.** These are admin screens
  that legitimately show CSV contents, error diagnostics and bank-write outcomes; `check.sh`'s
  run-screen scan correctly doesn't fire on these filenames. Confirmed by hand that nothing here
  touches a student-facing shared component (`.badge`, `.chip`, `.panel`, `.pbar` were reused
  as-is, not modified in a way that could leak into the run).
- **Numbers reconcile end to end, across sprints.** 200 rows / 194 valid / 6 errors is
  byte-identical between `console-home.html` (S7, written before this sprint existed),
  `import-preview.html`'s mixed state, and all four states of `import-commit.html`. The 192
  questions + 2 passages breakdown in the commit-confirm facts grid sums to 194; 192 + 2 + 6 = 200.
- **Keyboard / structure:** one `<h1>` per screen file, following the `item-editor.html`/
  `run-mcq.html` precedent of treating stacked sub-states as variations of one screen rather than
  independently-headed pages. The two disclosures (`import-preview.html`'s valid-rows reveal,
  reusing the admin drawer's zero-JS `<details>` technique from S7) are natively keyboard-operable
  with no JS, and `:focus-visible` is inherited from the global rule with no per-element opt-in.
  All buttons are real `<button>`; the two screen-to-screen actions that navigate are real `<a>`.

## Handover notes — from S8, for S9 and later

- **The last open chain is `{S9→S10}`.** Both admin chains are now complete or in progress; S9
  (quiz builder: define, draw, composition report, scoring parameters, schedule, lock) can start
  immediately — it depends on S0 only, not on S7 or S8, and touches entirely disjoint files.
- **`.commitbar` is the shape for any future sticky-confirmation-style bar** (S9's lock
  confirmation is a `destructive-confirm` A dialog instead, per `selections.md` consequence 2 —
  different component, don't reach for `.commitbar` there) — but S10's export or schedule actions
  might want the same "states a count, three tones, reachable while scrolling" shape again.
- **`.b-err` is now the one plain danger badge in the system.** Reuse it for any future
  validation-style pass/fail row status (S9's composition-report or draw-preview might want it for
  "questions the draw could not fill") rather than reaching for `.b-hard` (difficulty-scoped) or
  `.b-live` (reserved for a running quiz).
- **The `.dzwrap`/`.commitwrap` width cap is a one-off, not a new precedent.** S9's quiz-builder
  screens hold real content (the draw preview, the composition report, the scoring curve) and
  should stay uncapped, matching S7's explicit rejection of admin content caps — the S8 cap applies
  only to chrome-shaped confirmation screens, the same category S1's `.auth-col`/`.join` were.
- **SYSTEM-GAPS #6 (invented CSV schema) is now closed** (see #39) — no future sprint needs to
  re-derive BANK.md §3's real header row; it is fully quoted in `import-preview.html`'s page
  subhead and in every error message across the three files.
- **No new size/spacing token was needed** beyond the ones already flagged in #17/#29/#38 — `.dz`,
  `.filerow` and `.commitbar` all compose from existing `--sp-*`/`--r-*` values; the one literal
  (`.dz__icon` at 80px via `--sp-13`) is the same already-logged illustration-sizing gap as
  `.state img`, not a new one.

## S10 scope, built — 4 Sep

Three screen files, covering all seven named states (schedule list; recurring templates;
report; participants; export; manage admins; promote/demote). Last sprint of the build.
`bash mockups/check.sh` passes with 39 screen files.

| File | States |
|---|---|
| `admin/schedule.html` | Quizzes view — draft · scheduled ×2 (locked, nothing to do) · live · closed ×2 (entry into the report) &middot; Templates view — recurring, active (needs more Medium questions) · recurring, paused (bonus) |
| `admin/report.html` | Weekly Quant Sprint #26 (closed 31 Aug, 87 participants) — summary tiles + histogram, participants table (+ mobile card fallback), item analysis, export |
| `admin/manage-admins.html` | Roster viewed as an admin (read-only) · roster viewed as a superadmin (live) · promote confirm · demote confirm |

Plus `css/screens-s10.css` (layout only), `proof-s10.html`, and this handover.

**Picks built, all matching `selections.md`:** `quiz-card-schedule` A (card with status header) ·
`report-summary-tiles` B (tiles + score histogram) · `participants-table` A (dense sortable) +
data-table's own mandatory &lt;640px card fallback · `item-analysis-row` A (row with % correct
bar) · `export-action` A (button + format menu) · `manage-admins-row` B (grouped by role) ·
`destructive-confirm` A (consequence list + weighted buttons) on `modal-sheet` A. No losing
variant reached `mockups/`. `destructive-confirm` A is the sibling S9 explicitly left unbuilt
(its own B, type-to-confirm, is reserved for the irreversible quiz lock) — promote/demote is
reversible, so a consequence list plus a same-click weighted button is the proportionate choice.

**Two scope decisions, deliberately not resolved silently:** no "Monitor" or "Void quiz" control
appears on any schedule card, unlike the design system's own `quiz-card-schedule` sample —
live-quiz-monitor (AJ-7, PRD open Q5) and quiz-void (AJ-9, PRD open Q6) are both explicitly
undecided and were not part of this sprint's named scope. Item analysis (PRD open Q7) *was*
built, since `selections.md` already locked a variant for it — resolved as a mockup judgement
call, not a product decision (SYSTEM-GAPS #49–50).

**Retargeted 73 placeholder links across all 12 existing admin files** (`console-home.html`
through `builder-lock.html`) that pointed "Schedule"/"Reports"/"Admins" at `console-home.html`
as a stand-in since S7 — now point at `schedule.html`/`report.html`/`manage-admins.html`
respectively, per the standing handover convention (S6→S9 all did the same for their own new
screens). Also fixed `console-home.html`'s three dashcard links and `builder-lock.html`'s
"View in Schedule" link, and rewrote console-home's "1 promotion pending review" copy to "1
promotion under consideration" to match the Ananya Krishnamurthy promote state built here.

**Cross-sprint continuity, deliberate, not new fixture invention:** *Weekly Quant Sprint*
(recurring template, active) now visibly generates all three quizzes already in the build —
#26 (closed 31 Aug, this sprint's flagship report), #27 (live, room `QNT-8417`, S1–S6) and #28
(scheduled, room `QNT-9103`, locked in S9) — reconciling the "62 unused Medium across 6
occurrences" figure `console-home.html` and `builder-schedule.html` already stated. *Friday
Drill* (recurring template, paused — the bonus state) reconciles S1's `quiz-detail.html`, which
already showed this quiz both as a closed 28 Aug occurrence (64 participants) and an upcoming
scheduled 4 Sep one, without any prior sprint explaining why the same title appeared twice.
Ananya Krishnamurthy (the signed-in student throughout every S0–S6 student screen) is the
promote candidate; her report row (rank 7, 54.4) matches `history.html` (S6) exactly. Priya
Menon is introduced as the superadmin, established from the deploy secret (AUTH-4, XJ-1) —
never a promotion, and explicitly labelled as such.

**Appended to `components.css` (§73–77):** `.schedcard` (+ `__hdr`/`__title`/`__facts`/`__foot`,
status border modifiers) built on S0's `.card--solid` rather than a new surface · `.b-rec` (a
new badge semantic for "recurring template," visually identical to but deliberately not reusing
`.b-unused`) · `.tiles`/`.tile` and `.histogram`/`.histogram__bars`/`.histogram__bar` (+
`--peak`) for report-summary-tiles B · `.itemrow`/`.itembar`/`.itembar__fill` (+
`--danger`/`--warning`/`--success`) and `.pct-danger`/`.pct-warning`/`.pct-success` for
item-analysis-row A · `.confirmlist` (destructive-confirm A's consequence bullets, sibling of
S9's `.confirmbody`) · `.row-muted` (a generic de-emphasis helper). Manage-admins-row B needed
**no new identity-row component** — it extends S4/S6's `.namerow`/`.av` (avatar + name row)
exactly the way S6 extended it for `leaderboard-row` A, per the running "extend, don't invent a
fourth avatar-row shape" precedent (SYSTEM-GAPS #22/#28).

## Verification — S10

- `check.sh` **PASS**, 39 screen files.
- **Measured via the Chrome DevTools Protocol directly (headless Chrome, a raw WebSocket to
  `--remote-debugging-port`, no puppeteer available in this environment)** — `Emulation.
  setDeviceMetricsOverride` at 390/820/1440 (plus 639/640/900 boundary spot-checks), reading
  `document.body.scrollWidth` against `document.documentElement.clientWidth`. All three new
  screens measured exact at every width. A full 39-file × 3-width regression sweep (117 combos)
  after the fix below confirms zero overflow anywhere in the build, including the 73 retargeted
  links.
- **One real grid/flex blowout, found and fixed at the source — the fifth independent instance
  of SYSTEM-GAPS #34** (after S1, S7×2, S8). `.rolegroup` (`display:grid`, single implicit
  column) let a `.rowflex-between` row's own content — an untruncated email address, one
  unbreakable run — set the shared grid track's width, which widened the *entire page* including
  the sticky header 76px past the 390px viewport, even though the header's own markup was
  untouched. Root-caused with a leaf-level `getBoundingClientRect()` scan (a plain
  scrollWidth-vs-clientWidth pass on ancestors was misleading here: elements with `overflow-x:
  visible` report `scrollWidth === clientWidth` themselves and only the viewport-level `<html>`/
  `<body>` showed the true 76px, so the actual offending leaf had to be found by width, not by
  overflow diff). Fixed with `.rolegroup>*{min-width:0}` and `.rolegroup .stack>*{min-width:0}`
  (screens-s10.css) plus `.truncate` on the two untruncated email lines; re-measured clean.
  SYSTEM-GAPS #52 recommends this stop being rediscovered per-sprint.
- **`.seg` reused as a primary control a third time** (`schedule.html`'s Quizzes/Templates
  toggle) — measured at 36px before the fix, same as S9's #48. Fixed the same way: local
  `style="min-height:var(--tap-min)"` on both pairs of buttons, `.seg`'s shared rule untouched.
- **Touch targets, scripted, not assumed.** Every `<button>`/`<a class="btn">`/`.seg button`/
  `.menu` item across all three new screens measured at 390px: zero controls under 44px.
- **Breakpoints confirmed live, not from reading the CSS.** `report.html`'s `.tiles` computed
  `grid-template-columns` is two tracks at 390/639 and four at 640/1440 exactly; `.tablewrap`/
  `.ptcards` (data-table A's table/card-fallback pair, reused verbatim from S7) toggle `display:
  none`↔`block`/`grid` exactly at 640 with no width showing both or neither; `manage-admins.
  html`'s `.dlg`/`.sheet` (modal-sheet A, reused verbatim from S9) toggle exactly at 640, matching
  S9's own confirmed boundary.
- **Numbers reconcile end to end, across sprints.** Weekly Quant Sprint #26/#27/#28 room codes,
  dates and the "62 Medium across 6 occurrences" figure all match their originating S1/S6/S7/S9
  files; Ananya Krishnamurthy's report row (54.4, rank 7 of 87) matches `history.html` exactly;
  Arrangements & Puzzles — Friday Drill's two occurrences (28 Aug closed, 4 Sep scheduled) match
  the dates and section already stated in S1's `quiz-detail.html`.
- **Leak check — not applicable in the run sense.** These are admin-only screens; `check.sh`'s
  run-screen scan correctly doesn't fire on any of the three filenames. Confirmed by hand that
  nothing here touches a student-facing shared component in a way that could leak into the run
  (`.badge`, `.namerow`, `.av`, `.panel` reused as-is).
- **Keyboard / structure:** one `<h1>` per screen; `report.html`'s three sections are real
  `<section aria-labelledby>` landmarks pointing at `<h2>` ids; `manage-admins.html`'s role
  groups use the same `aria-labelledby`-to-`.wlabel` pattern S4/S5 established for a
  visually-styled label that isn't a heading; the promote/demote dialogs are `role="dialog"
  aria-modal="true" aria-labelledby`, matching `builder-lock.html`'s exact precedent; every
  interactive element is a real `<button>`/`<a>`; `:focus-visible` inherited throughout with no
  per-element opt-in.

## Handover notes — from S10, for whoever picks up next

- **This was the last sprint (S0–S10) — all named in JOURNEYS §7 are built.** See the final
  audit below.
- **Two PRD open questions were touched, not resolved**, matching S9's own standing caveat about
  pool exhaustion and window length: item analysis (Q7, built) and live-monitor/void (Q5/Q6,
  deliberately omitted) both still need a real product decision before implementation —
  SYSTEM-GAPS #49–50.
- **SYSTEM-GAPS #34's grid/flex blowout pattern has now recurred five times** (S1, S7×2, S8,
  S10) with an identical root cause and an identical fix each time. If this design system is
  ever revisited, the single highest-leverage change is stating "grid/flex children default
  `min-width` to their own content" once in the S0 contract, or better, giving `.card`, `.panel`
  and every grid/flex utility a `min-width:0` default the way `.grow` already has.
- **`.seg button`'s 36px height (#8/#48/#53) has now needed the same local one-line fix three
  times** across two sprints. Worth raising the shared rule's floor to 44px if a future pass
  touches `components.css` §9 at all — every existing `.seg` consumer would only gain height,
  never lose correctness.
- **No further sprint depends on anything here** — S10 was a leaf in the dependency graph
  (`{S9→S10}`, now fully closed) and nothing in JOURNEYS §7 remains unbuilt.

## Final audit — all sprints S0–S10, 4 Sep

- **Every sprint S0 through S10 is ticked "done"** in the table above.
- **`mockups/check.sh` passes on the full build**: 39 screen files, zero external requests, zero
  hardcoded colours, tokens defined only in `tokens.css`, JS confined to `index.html`, no raw
  `$...$` LaTeX, every screen links `tokens.css` and carries a viewport meta and `html lang`,
  every `<img>` has `alt`, `prefers-reduced-motion` handled, and the run-screen leak scan is
  clean.
- **Every screen in JOURNEYS.md §7's inventory exists.** Student: sign-in (`signin.html`), home
  (`home.html`), quiz detail (`quiz-detail.html`), join by code (`join.html`), lobby
  (`lobby.html`), room full (`room-full.html`), MCQ/TITA/passage-set questions (`run-mcq.html`,
  `run-tita.html`, `run-image.html`, `run-passage.html`), resumed/late-join
  (`run-interrupt.html`), finish (`finish.html`), holding (`holding.html`), rank reveal
  (`rank-reveal.html`), review (`review.html`), history (`history.html`), per-quiz leaderboard
  (`leaderboard-quiz.html`), did-not-take (`did-not-take.html`), weekly leaderboard
  (`leaderboard-weekly.html`), profile (`profile.html`), 403/404/session-expired
  (`errors.html`). Admin: console home (`console-home.html`), bank browse
  (`bank.html`), question editor (`item-editor.html`), passage group (`passage-group.html`),
  import upload/preview/commit (`import-upload.html`, `import-preview.html`,
  `import-commit.html`), builder define/draw/scoring/schedule/lock (`builder-define.html`
  through `builder-lock.html`), schedule list + recurring templates (`schedule.html`), quiz
  report (`report.html`), manage admins (`manage-admins.html`). The two inventory rows marked
  *(undecided)* in JOURNEYS §4 (AJ-7 live monitor, AJ-9 void) were never built, by design —
  SYSTEM-GAPS #50 and the S9/S10 handovers both record why.
- **`mockups/index.html`'s directory lists every one of the screens above**, plus all ten
  responsive proof pages (`proof-s1.html` through `proof-s10.html`) and the reference links to
  `PROGRESS.md`, `SYSTEM-GAPS.md` and the locked selections. No `.todo` placeholder remains in
  the directory.
- **`mockups/SYSTEM-GAPS.md` carries 54 logged entries** across all ten build sprints, several
  explicitly marked resolved (e.g. #6/#39, the CSV schema) and several explicitly still open
  upstream asks (e.g. #8/#48/#53's `.seg` height, #17/#29/#35/#38/#44's missing `--size-*` scale,
  #34/#52's recurring grid/flex blowout). None of these block using the mockups as a build
  reference; they are the punch list for anyone who revisits the design system itself.
