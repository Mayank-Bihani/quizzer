# Prompt — Quizzer frontend build (React + Vite + TypeScript)

> Paste the block below into a coding agent. The repository itself is the context — the agent
> needs read access to the whole tree, not just this file. Backend is complete (Sprints 1–8,
> `todos/PROGRESS.md`); this prompt is for the frontend-only phase `PLAN.md` calls
> "frontend, built after backend."

---

You are building the **production frontend** for Quizzer, a self-paced timed quiz app for a
~100-student competitive-exam prep group (Verbal / Quant / Logical Reasoning), sitting on a
finished, deployed Cloudflare Workers backend.

## Authoritative sources, in priority order

When two sources disagree, the higher one wins. Do not resolve a conflict by guessing — if it
isn't covered by these, it's a real open question; say so rather than inventing an answer.

1. **`src/core/contracts.ts` and `src/core/api.ts`** — the exact wire types and module contracts.
   Every request/response shape you build must match these DTOs field-for-field. Do not add a
   field the type doesn't have; do not omit one it does.
2. **`API.md`** — the exact route table (29 routes: AUTH 5, BANK 8, QUIZZING 16, one admin
   report), status codes, pagination convention, and the specific resolved defaults for each route
   (e.g. `GET /api/boards/weekly`'s omitted-parameter rules).
3. **`FRONTEND_GAPS.md`** — read this in full before touching any screen it names. It documents
   exactly where the mockups' own assumptions differ from what the backend actually implements
   (pool exhaustion, weekly-board ranking, a weekly-board column with no backing field, the
   admission-window formula, and one new "cancel quiz" affordance the mockups never got to draw).
   Apply every correction in it. Where it flags something as needing product confirmation (item
   analysis), build the safe/minimal version and leave a visible `TODO` comment rather than
   guessing.
4. **`mockups/`** — the frozen, reviewed visual and structural reference. Match it pixel-for-pixel
   wherever `FRONTEND_GAPS.md` doesn't say otherwise: same layout, same components, same copy tone,
   same responsive behavior at the three canonical widths. `mockups/SYSTEM-GAPS.md` records every
   place a mockup screen needed something the design system didn't have and how it was resolved —
   read it for the screens you're building; its resolutions are decisions, not scratch notes.
5. **`JOURNEYS.md`** — the user-journey source the mockups were themselves built against. Use it
   to understand *why* a screen behaves the way it does, especially for states the mockups render
   but don't narrate.
6. **`AUTH.md`, `QUIZZING.md`, `SCHEDULER.md`, `TELEGRAM.md`, `BANK.md`, `DATA_MODEL.md`,
   `PRD.md`, `PLAN.md`, `MODULES.md`** — the same module docs the backend was built against. Read
   the sections relevant to the screen you're on before building it.

`PLAN.md` says it plainly: *"Design tokens and static mockups exist, but their timing/navigation
behavior is stale."* Treat every mockup as correct for **look and structure**, and the contracts
as correct for **behavior, data, and timing**. When a mockup's sample copy states a number, a
default, or a business rule (a marks scheme, a window length, a rank), that number is illustrative
placeholder content, never a value to hardcode.

## Tech stack (already decided — `PLAN.md`, do not re-litigate)

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript |
| Deployment | Workers Static Assets — `web/dist` served from the **same Worker/origin** as `/api/*` (first-party cookies depend on this; do not deploy the frontend to a separate origin/domain) |
| Styling | The existing hand-built design system — `mockups/css/tokens.css` + the extracted `components.css`, **not** Tailwind, not CSS-in-JS, not a component library. Port these files into the app largely verbatim; extend them the same way each mockup sprint did (append new component rules, never redefine a token) |
| Fonts / illustrations | `mockups/assets/fonts/*.woff2` (self-hosted, already-subsetted IBM Plex Sans/Mono + Source Serif 4) and `mockups/assets/illustrations/*.svg` — copy into the app, no external font/CDN requests |
| Math rendering | Client-side **KaTeX** at runtime (mockups render LaTeX as static MathML/HTML as a stand-in — `MOCKUP_PROMPT.md` says so explicitly; substitute real KaTeX here) |
| Auth | Google Identity Services in the browser → obtain a Google ID token → `POST /api/auth/google` → the Worker sets an `HttpOnly; Secure; SameSite=Lax` session cookie (`AUTH.md`). The frontend never stores a token itself and never calls Google's token-info endpoints directly — the cookie is the only client-held session state, and every subsequent request just needs to go same-origin so the cookie rides along |
| Data fetching | Your choice of a thin typed fetch wrapper or a library (e.g. TanStack Query) — either is fine as long as request/response types are drawn directly from `src/core/api.ts`, not re-declared by hand |
| Routing | Your choice (React Router is the natural default for this stack) — pick one, state which, and use it consistently; don't mix routing approaches across the app |

## Design-system reuse rules

- Copy `mockups/css/tokens.css` verbatim. Do not re-pick colors, type, spacing, radii, shadows, or
  motion.
- Copy the component rules already extracted into `mockups/css/components.css` and each
  `mockups/css/screens-sN.css` file. These already encode every judgment call logged in
  `mockups/SYSTEM-GAPS.md` — the neutral (not success-green) answer-lock confirmation, the grace
  mark drawn above the timer fill, the skip-control layout, the rotate-to-portrait overlay, the
  admin mobile drawer, and so on. Rebuilding a component from scratch instead of porting the mockup
  version risks silently reversing one of these decisions.
- If a screen needs something neither file has, that's a new, real gap — extend the design system
  the same way each mockup sprint did (name the component, add the rule, note it), don't invent a
  one-off inline style.
- Reuse the semantic HTML structure mockups already establish (real `<button>`, `<label>`,
  `<input>`, correct heading order, `aria-*` where used) — these are the accessibility contract,
  not incidental markup.

## Screen inventory

Every file under `mockups/student/*.html` and `mockups/admin/*.html` is one real screen/route.
Each file's multiple labeled `<div class="mock-state">` blocks are the same screen's different
*states* (loading, empty, error, edge cases) — build them as conditional renders of one component,
not separate pages. Cross-reference `mockups/PROGRESS.md`'s per-sprint "Picks built" notes for
which design-system variant each screen uses and why, and `JOURNEYS.md` §7 for the full screen
inventory these files implement.

**Student:** sign-in, home, quiz detail, join by code, lobby, room full, profile, errors
(403/404/session-expired) · the three run screens (MCQ/TITA/image) and their edge states (passage
set, reconnecting, resumed, late-join, timeout, rotate overlay) · finish, holding, rank reveal ·
review · history, per-quiz leaderboard, weekly leaderboard, leaderboard-empty, did-not-take.

**Admin:** console home, bank browse/filters, item editor, passage group, CSV import
(upload/preview/commit) · quiz builder (define/draw/params+scoring/schedule/lock) · schedule list
+ templates, report, participants, export, manage admins.

Build the **new** "cancel a quiz" affordance `FRONTEND_GAPS.md` §2.1 describes — it has no mockup
file at all, so design it consistently with the existing admin schedule-list screen and the
existing confirmation-dialog pattern (`mockups/admin/builder-lock.html`'s `.scrim`/`.dlg`/`.sheet`),
including a real, portal-rendered overlay (the mockups only ever fake this inside a bounded demo
container — `mockups/SYSTEM-GAPS.md` #43 — the real app needs the actual viewport-covering
version).

## Hard NO list

- Do not modify anything under `src/` (the backend), `migrations/`, or any of the root module docs
  (`PRD.md`, `PLAN.md`, `MODULES.md`, `DATA_MODEL.md`, `CONTRACTS.md`, `API.md`, `AUTH.md`,
  `BANK.md`, `QUIZZING.md`, `SCHEDULER.md`, `TELEGRAM.md`). If the frontend seems to need a route,
  field, or behavior that isn't in `src/core/api.ts`/`src/core/contracts.ts`/`API.md`, stop and
  report the gap — do not add a backend route yourself and do not fake the data client-side.
- Do not invent a request/response shape. If a screen's data need doesn't map cleanly onto an
  existing DTO, that's a gap to report, not a client-side workaround.
- Do not deploy the frontend to a different origin than the API, and do not read/write the session
  cookie directly from JavaScript (it's `HttpOnly` on purpose).
- Do not build the disclosure ladder loosely. Tier 1 (finish) shows only the student's own score
  and answered count; tier 2 (holding) adds a finisher count and nothing named; tier 3 (rank
  reveal/review/leaderboards) is the **only** tier allowed to show rank, another student's name or
  score, or correctness. No earlier screen may leak any of it — this is a security property, not a
  style choice, and is exhaustively checked in the mockups themselves (`mockups/PROGRESS.md`'s
  per-sprint "Leak check" notes name exactly what must never appear where).
- Do not add a live/partial leaderboard during an active quiz, a global synchronized start clock,
  or a lockstep/socket-based run mechanic — `PLAN.md` is explicit that there is no global start
  transition and no live board.
- Apply every correction in `FRONTEND_GAPS.md` §1 exactly. Do not ship the mockup's pool-exhaustion
  reuse UI, the "average" framing for weekly boards, the unbacked per-row section column, or the
  flat window-length formula.

## Responsiveness (non-negotiable — `MOCKUP_PROMPT.md`'s own rule, carried forward)

Verify every screen at the three canonical widths the mockups were built and measured against:

| Name | Width | Primary for |
|---|---|---|
| Phone | 390px | Students |
| Tablet | 820px (also check 1180px landscape for the passage split) | Students |
| Laptop | 1440px | Admins |

Breakpoints are `min-width` only, at 640/900/1280, matching the mockups exactly. Every tappable
control a student can hit on a phone must clear a 44px touch target — `mockups/SYSTEM-GAPS.md` #8
documents exactly where the design system's own `.btn.sm`/`.seg button`/`.chip` fall short of this
and how each mockup screen worked around it; carry the same fix forward, don't reintroduce the
36px controls on a student-facing screen.

## Acceptance checklist

- [ ] `npm run build` (or the Vite equivalent) produces `web/dist`; uncomment the `[assets]` block
      in `wrangler.toml` once it exists, pointing at that directory (don't touch anything else in
      `wrangler.toml`).
- [ ] `npm run typecheck` (or `tsc --noEmit`) passes with no errors, and every API call's
      request/response type is imported from `src/core/api.ts`, not re-declared.
- [ ] Every screen renders correctly at 390/820/1440 (and 1180 landscape for the passage split)
      with no horizontal overflow — the same measurement discipline `mockups/PROGRESS.md` used
      (`documentElement.scrollWidth === clientWidth` in a real iframe/viewport, not eyeballed).
- [ ] Every screen's data comes from a real backend call against the routes in `API.md` — no
      hardcoded sample numbers left over from the mockup stage.
- [ ] Every correction in `FRONTEND_GAPS.md` is applied; the one open item (§4.1, item analysis) is
      built minimally with a visible TODO, not silently resolved either way.
- [ ] The disclosure-ladder leak check passes by hand: no rank, correctness, other-student data, or
      running score appears before its tier, on any screen, in any state.
- [ ] Sign-in round-trips through the real `POST /api/auth/google` and results in an
      `HttpOnly` session cookie; a signed-out request to any protected route redirects to sign-in
      rather than rendering a broken authenticated screen.
- [ ] Math renders via real KaTeX, not a static stand-in.
- [ ] Report back, in place of silently guessing: any screen where the mockup and the real
      contracts still don't reconcile after applying `FRONTEND_GAPS.md`, and any place a route,
      field, or default is genuinely ambiguous between `API.md` and `src/core/api.ts`.
