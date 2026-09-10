# Quizzer — locked A/B/C selections

Recorded 3 Sep 2026 from the pick sheets in each guidelines artifact. Unpicked rows took
the "Recommended" column. This file is the source of truth for what gets built as a real
component; the losing variants stay in the guidelines artifacts as reference only.

## Batch 1 — Foundations

| Pick | Choice |
| --- | --- |
| `section-colour-family` | **B — Library** (burgundy `#6E2E36` / pine `#2A5A44` / amber-brown `#8C5A1E` / warm graphite) |
| `ambient-background` | **A — Gradient mesh** (`--amb-a`) |
| `glass-recipe` | **A — Balanced** 62 % / 18px |
| `type-system` | **A — IBM Plex Sans + IBM Plex Mono** |
| `illustration-style` | **B — Soft shade** (`assets/illustrations/shade-*.svg`) |

## Batch 2a — Primitives & forms

| Component | Pick |
| --- | --- |
| `tita-numeric-input` | **B** — big display + in-app keypad |
| `file-dropzone` | **A** — single zone, two file types |
| `form-field` | **A** — stacked, label above |
| `badge-pill` | **A** — pill, tinted |
| `card-surface` | **A** — glass |

## Batch 2b — Layout, nav, feedback, data

All **A** except `toast`.

| Component | Pick |
| --- | --- |
| `app-shell-student` | **A** — glass bottom bar |
| `app-shell-admin` | **A** — left sidebar |
| `page-header` | **A** — stacked |
| `tabs-segmented` | **A** — segmented filled pill |
| `modal-sheet` | **A** — centred dialog / bottom sheet |
| `destructive-confirm` | **A** — consequence list + weighted buttons |
| `toast` | **C** — top strip, full width |
| `inline-alert` | **A** — tinted block |
| `empty-state` | **A** — illustrated, centred |
| `loading-skeleton` | **A** — shimmer blocks |
| `error-state` | **A** — illustrated block |
| `avatar-name-row` | **A** — avatar + name |
| `data-table` | **A** — dense, sticky header |
| `pagination` | **A** — load more |
| `filter-bar` | **A** — chip row, inline |
| `countdown-timer` | **A** — digits + label |

## Batch 3 — Live quiz run

| Component | Pick |
| --- | --- |
| `join-room-code` | **A** — segmented character slots |
| `lobby-block` | **A** — fact grid + countdown hero |
| `question-card` | **A** — header strip + scrolling body |
| `mcq-option-list` | **A** — full-width rows, letter chip |
| `tita-answer-run` | **A** — keypad, answer above |
| `question-timer` | **B** — linear bar with grace zone |
| `window-deadline` | **A** — dark pill in the header |
| `progress-indicator` | **B** — bar + counter |
| `passage-set-layout` | **A** — split pane |
| `submit-lock-action` | **A** — single button, direct lock |
| `room-full` | **A** — full-screen illustrated block |
| `resumed-after-disconnect` | **B** — resume card, one tap to continue |
| `joined-late` | **A** — reality-check card |
| `deadline-mid-question` | **B** — silent cut to the finish card |

## Batch 4 — Results, review, leaderboards

| Component | Pick |
| --- | --- |
| `finish-card` | **A** — score hero |
| `holding-state` | **B** — waiting-room, illustration-led |
| `rank-reveal` | **B** — rank in context (neighbours) |
| `score-breakdown-tiles` | **B** — reconciling ledger |
| `review-question-card` | **C + A** — collapsed rows as the index, expanding into the annotated option list |
| `answer-distribution` | **A** — mini bars under the options |
| `time-vs-average` | **B** — delta chip |
| `review-navigator` | **A** — sticky bottom bar + grid sheet |
| `history-list-row` | **A** — two-line row |
| `leaderboard-row` | **A** — flat row, medal rule |
| `podium-top3` | **B** — ranked strip (no podium metaphor) |
| `board-switcher` | **A** — segmented sections + week stepper |
| `leaderboard-empty` | **A** — embargo notice |

## Batch 5 — Admin

| Component | Pick |
| --- | --- |
| `csv-validation-preview` | **B** — errors first, valid collapsed |
| `import-error-summary` | **A** — grouped by cause |
| `import-commit-bar` | **A** — sticky footer bar |
| `question-row` | **A** — dense table row (+ mobile card fallback) |
| `question-editor` | **A** — two-pane, edit left / preview right |
| `passage-group-card` | **A** — header + child rows |
| `quiz-builder-wizard` | **A** — horizontal stepper |
| `difficulty-mix-control` | **A** — three steppers + running total |
| `composition-report` | **A** — sentence + breakdown table |
| `draw-preview` | **A** — list with per-row swap |
| `scoring-parameter-panel` | **A** — field list + live decay curve |
| `schedule-picker` | **A** — date + time + duration |
| `recurrence-editor` | **A** — weekday chips + end rule |
| `room-code-display` | **A** — dark code block |
| `quiz-card-schedule` | **A** — card with status header |
| `report-summary-tiles` | **B** — tiles + score histogram |
| `participants-table` | **A** — dense sortable table |
| `item-analysis-row` | **A** — row with % correct bar |
| `export-action` | **A** — button with format menu |
| `manage-admins-row` | **B** — grouped by role |
| `live-quiz-monitor` | **A** — counter tile *(speculative)* |

---

## Consequences of these picks — decisions the build must honour

1. **`toast` C is barred from the live run.** The top strip occupies the same edge as the two
   clocks. Connection state during a run uses `inline-alert` C (sticky status strip) instead.
   Two components, two surfaces — not one component doing both.
2. **`destructive-confirm` A is used for the quiz lock.** A single dialog now guards an action
   that permanently retires ~20 questions. The consequence list must therefore state the exact
   count and the word "permanently", and the confirm button must read "Lock quiz" — never "OK".
   *(Flagged: B, type-to-confirm, was recommended for this one action.)*
3. **`difficulty-mix-control` A allows an invalid total.** Three independent steppers can sum
   to ≠ N, so the build adds a blocking validation on the total and disables Continue until it
   reconciles.
4. **`deadline-mid-question` B gives no T−10s warning.** A student mid-tap at the close loses
   that answer silently. Accepted as un-gameable; the finish card must therefore state plainly
   which question was not submitted.
5. **`podium-top3` B means the product has no podium.** Boards are ranked strips throughout,
   including for closed weekly boards.
6. **`progress-indicator` B (bar + counter)** removes the per-question dot track, so the run
   shows position as "Q7 of 20 · 35%" only. Neutral fill, never accent — accent belongs to the
   question timer.
7. **Mobile fallbacks stay mandatory,** not optional: `data-table` C, `filter-bar` C and
   `question-row` C below 640px.
8. **`review-question-card` C + A compose** — C is the index, A is the expanded detail. The
   explanation and image load on expand.

## Resolved — confirmed 3 Sep 2026

- **Time-expired scores 0** (unanswered), never the wrong-answer penalty.
- **Grace window is leading** — the opening seconds pay the full speed bonus, decaying to 0
  at the question limit.
- **Draw happens at build time**, visible to the admin, re-drawable until lock.
- **The per-question clock keeps running during a disconnect** (server-authoritative), so a
  student returns to the same question with less time.
- **Scoring is per-quiz, set by the admin at build time** — all six values in
  `scoring-parameter-panel` (seconds per question, grace window, marks correct, marks wrong,
  max speed bonus, seat cap) are quiz data, not system constants.

### What per-quiz scoring means for the components

9. **No marks scheme may be hardcoded in copy.** Every place a sample artifact prints
   "+3 / −1" — the lobby rules strip, the negative-marking alert, review outcome badges, the
   breakdown ledger, the max-score line — reads its numbers from the quiz. The `+3 / −1 /
   +0.5` seen throughout the guidelines is sample data only.
10. **Negative marking can be zero.** The "No negative" preset is legitimate, so the lobby
    warning and any copy mentioning a penalty are conditional: with `marks_wrong = 0` the
    strip reads "No negative marking" instead of being hidden, because its absence is itself
    worth stating.
11. **The grace window is a per-quiz duration, so the timer's zone width is data-driven.**
    `question-timer` B renders the grace band from `grace ÷ seconds_per_question`; a quiz with
    `grace = 0` renders no band at all and the component must not break or leave a stub.
12. **Max score is derived, never stored as a label** —
    `questions × marks_correct` (+ `questions × max_bonus` shown separately). The finish card,
    breakdown and reports all compute it, so a 20-question quiz is "out of 60" only for the
    sample scheme.

## Still blocking the component build

- **Real CSV header row** — the schema in Batch 5 is invented; every validation message
  depends on it.
