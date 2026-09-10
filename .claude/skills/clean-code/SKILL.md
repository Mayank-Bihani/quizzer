---
name: clean-code
description: Refactor or write code in the clean-code style of Jeffrey Way / Adam Wathan / Aaron Francis (Laracasts). Use when the user asks to refactor, clean up, simplify, "improve readability of", or write code "in the clean-code style"; when reviewing code for clarity smells (deep indentation, magic numbers, boolean flags, abbreviated names, fat controllers, primitive obsession); or when designing a new module and needing principled defaults. Examples are PHP-flavored but the rules apply to any language.
---

# Clean Code

## Auto-included companion skill

**Whenever this skill is invoked, also load and apply the `vibesec` skill** (`.claude/skills/vibesec/SKILL.md` in this project). Read that file in full before producing any code or review output, and treat its security guidance as additional, non-overriding constraints layered on top of the clean-code principles below. If a clean-code refactor would weaken a security control from `vibesec`, prefer the security control and explain the tradeoff.

## Overview

This skill encodes 35 clean-code principles distilled from 27 Laracasts tutorials into an operational guide for refactoring existing code and writing new code. It is opinionated: it favors clarity over architectural rules, prefers domain objects over primitives, and treats every refactor as a hypothesis to be tested with the question *"is it better?"*.

## When to use this skill

Trigger this skill when:

- The user asks to "refactor", "clean up", "simplify", "improve", or "tidy" code.
- The user mentions clean-code, code smells, readability, or names a Laracasts-style refactor (e.g. "drop down a level", "tell don't ask", "extract a use case").
- The user asks to review code for clarity issues.
- The user is writing a new module, controller, or class and asks for "the right shape".
- The user invokes `/clean-code` or otherwise asks for this skill explicitly.

Do **not** trigger for: performance tuning, security review, architecture-at-scale debates, or framework migrations — this skill is about the local readability of methods, classes, and modules.

## The meta-principle: "Is it better?"

After every refactor, before keeping the change, answer one question explicitly: **is the new version easier to understand than the old one?**

- If the answer is no — or even *"kind of a wash"* — revert.
- More files is fine. More confusion is not.
- Sunk cost is not a reason to keep a refactor.
- SOLID, DRY, and pattern names are *goals*, not laws — clarity beats every rule.

This is the highest-priority rule in the catalog. The same speakers who teach Strategy, Factory, Template Method, and SOLID also teach: don't extract until you'd reuse, inline single-use helpers, throw the refactor away if it isn't better. The principles are tools, not goals.

## Workflow

### Refactoring existing code

1. **Confirm the safety net first.** If there is no test that would catch a regression, write one before any structural change. Tests prove only what they assert — assert behavior visible to callers, not implementation details.
2. **Read for smells, not solutions.** Walk the code and tag every smell:
   - Bare numeric literals (magic numbers).
   - Abbreviated names (`Trans`, `UserRepo`, `h`).
   - Method names ≥ 3 words, or names containing "And" / "Or".
   - Boolean parameters in public APIs.
   - `else` keywords, especially nested.
   - Methods with > 1 level of indentation (the "Flying V" shape).
   - Comments that explain *what* the code does (vs. *why*).
   - Controllers that talk to multiple models or fields directly.
   - Primitives passed across class boundaries that have to be re-validated downstream.
   - Repeated method-name prefixes on one class (`addWatchLater`, `removeWatchLater`, …) — diagnostic for a missing class.
3. **Fix one smell at a time.** Run the tests between every change. Refactoring is a sequence of mechanical, behavior-preserving moves, not a rewrite.
4. **Evaluate the diff.** Apply "is it better?". If yes, keep. If no, revert hard (`git reset --hard` is fine).
5. **Stop early.** Refactor until the code is good enough for the next task — not until it matches a textbook pattern. Pragmatism over perfection.

### Writing new code

1. **Name first.** Pick the class name *before* the method names. If methods need 3+ words to be intelligible (`addWatchLater`, `removeWatchLater`), the *class* is the real problem — rename it (`WatchLaters`) and the methods collapse to single verbs (`add`, `remove`, `has`).
2. **Design the public API before the implementation.** Write the call site you wish you had, then make the implementation match.
3. **Default to tell-don't-ask.** Predicates and decisions belong on the object that owns the data. Controllers and other clients ask the model to *do* something, not for fields they then operate on.
4. **Pass objects, not primitives, across boundaries.** A `User`, not a `$userId`. An `EmailAddress`, not a validated string. A `Subscription` instance, not a `'monthly'` discriminator.
5. **Write the simplest version that works.** Defer abstraction (dependency injection, observers, events, repositories-behind-interfaces) until the simple version actually hurts.

### Reviewing code

Walk the per-category checklists below. Flag issues; for each, propose the smallest refactor that resolves the smell, not a sweeping redesign.

## Category checklists

The full motivation, rationale, "how to apply" guidance, and canonical code examples for every principle are in `references/principles.md`. The checklists below are the operational summary — load the references file when a specific principle needs depth.

### Naming
- Spell every name out in full. The only universally-accepted abbreviation is `id`.
- Use the singular form of the collection for loop variables (`person` for `people`), never single letters except `i` (loop index) or `x`/`y` (geometric coordinates).
- Replace numeric literals with `SCREAMING_SNAKE_CASE` constants on the class that owns the concept. HTTP status codes (`403`, `200`) are still magic numbers — use `Response::HTTP_FORBIDDEN`.
- Name methods and classes for what they *mean*, not for the current implementation. `scopeRecent($carbon)` is a lie if "recent" is one specific day; rename to `scopeSubscribedOn`.
- Encode the parameter's meaning in the method name (`fetchByBillingId(123)`, not `fetch(123)`).
- Aim for ≤ 2-word method names. When you can't, the method is probably doing too much. Conjunctions ("And", "Or") in names are red flags.
- Don't repeat the receiver's noun in its method names. On `Order` define `ship()`, not `shipTheOrder()`. Repeated prefixes across methods (`addX`, `removeX`, `hasX`) signal a missing class.

### Control flow
- Don't use `else`. Invert the predicate, use early-return / guard clauses, or throw at the top.
- Cap method bodies at one level of indentation. Nested blocks are the strongest "extract me" signal.
- Collapse `if (A) { if (B) { ... } }` to `if (A && B) { ... }` when the inner block is the only thing the outer guards.
- Use built-in primitives (`array_filter`, `array_map`) over hand-written loops where intent matches.
- Use `abort_if($cond, 403, $msg)` over manual `if ($cond) abort(403)`.

### Functions and methods
- Don't expose `bool` parameters that switch behavior. Extract a sibling method (`muteTemporarily`) or accept a structured parameter (`$attributes` array).
- A method should return one type. If it sometimes returns a value and sometimes throws or returns null, decide which.
- Inline single-use locals and helpers. Extracting a one-liner with a name no clearer than the body is noise.
- Don't extract until you'd actually reuse it. Extracting a service class as the first refactor is overreach.
- Comments are a flashlight, not a structural tool. Replace them by making the code self-describing — extract a method whose name says what the comment said.

### Encapsulation and data design
- **Tell, don't ask.** Push predicates and decisions onto the object that owns the data. `if ($user->isAdmin())` is fine; `if ($user->role == 'admin' && $user->permissions->contains('edit'))` belongs on `$user`.
- Encapsulate raw column updates behind expressive model methods (`$user->upgradeToPro()`, not `$user->update(['plan' => 'pro', 'upgraded_at' => now()])`).
- Replace primitives with domain objects at method boundaries (`User`, not `$userId`; `Money`, not `(int $amount, string $currency)`).
- Wrap primitives only when they earn it: a value with non-trivial validation, formatting, or behavior. Don't wrap `int $age` for the sake of it.
- Limit instance variables (collaborators) per class. ~5 is the upper bound. More usually means missing extractions or the class is doing too much.

### Abstraction and polymorphism
- Apply SOLID as goals, not laws:
  - **SRP** — one reason to change per class. *Reason*, not *thing*.
  - **OCP** — extend, don't modify. New behaviors plug in via new types.
  - **LSP** — subclasses must honor the parent's contract (preconditions ≤, postconditions ≥). A subclass that throws or no-ops where the parent succeeds is a Liskov violation.
  - **ISP** — many small interfaces beat one fat one. If implementers leave methods empty, split the interface.
  - **DIP** — depend on abstractions, not concretions. Modules at the same level of policy shouldn't depend on each other directly.
- Strategy / Factory / Template Method are reachable when you see specific shapes; don't reach for them as a default. See `references/principles.md` for the diagnostic signals and refactor recipes.

### Architecture and module shape
- **Be strict with controllers.** A controller's job is the request lifecycle (validate, invoke, respond), nothing else. Push business logic into models or use cases. Validating an HTTP request *in* the controller is fine — that's request-shape work.
- **Encapsulate user actions as use cases.** When a controller orchestrates 4–6 steps to fulfill one user action, extract those steps into a single class named for the action (`PublishPost`, `RefundOrder`).
- **Co-locate everything a feature needs.** Module-by-feature beats module-by-layer when files of one feature are fighting across half a dozen directories.
- Don't reach for events + listeners for what is effectively four lines of code.

### Refactoring practice
- **Cover code with tests before refactoring.** Without tests, refactoring is rewriting.
- **Test behavior, not implementation.** Endpoint tests survive refactors; tests that mock a query builder break the moment you switch from Eloquent to a query.
- **Make every step mechanical and reversible.** A failing test is information; a 200-line uncommitted diff is panic.
- **"Is it better?"** is the only real test of a refactor. If yes, keep. If no — including "kind of a wash" — revert.
- **Sweat the small stuff.** Tiny consistent improvements (use `abort_if`, use `optional()->method()`, prefer `[]` over `array()`) compound. Each one is harmless; ignoring them all corrodes a codebase.

### Testing
- Tests prove only what they assert. If a refactor passes tests but you don't trust the result, the tests are too loose. Tighten the matchers; add control fixtures (a row that *shouldn't* match) so a too-broad query fails the test.
- Prefer endpoint / behavior tests at the seam where the user touches the system. Cover the implementation through behavior, not parallel to it.
- Mocks are for adapters at the edge of the system (mail, HTTP, queue), not for the system under test.

## Anti-patterns to refuse

These are the reflexes the speakers consistently push back on. When the user asks for one of these *as a default*, suggest the simpler version first.

- Extracting a query scope for every `where(...)`.
- Extracting a Form Request reflexively when 2 lines of validation in the controller would do.
- Repository-behind-an-interface for every model query.
- A service class as the *first* refactor for any controller method.
- Events + listeners for four lines of synchronous code.
- Wrapping every primitive in a value object.
- Mocking the database in tests.
- Splitting one cohesive function into N files because "SRP".
- Writing comments instead of better names.
- Naming abstract hooks after a specific subclass's value (`addTurkey` instead of `addPrimaryToppings`).

## Cross-cutting themes

Four themes thread through the entire catalog — when in doubt, return to these:

1. **Constants beat literals.** Magic numbers, ambiguous units, boolean flags — all the same problem. A value the reader has to decode at the call site is worse than a name. Replace with named constants, named constructors, or named methods.
2. **Objects beat primitives at boundaries.** Pass a `User`, not an email string. An `EmailAddress`, not a validated string. A `Subscription`, not a `'monthly'`/`'forever'` discriminator. Each replaces branching at the call site with polymorphism on the type.
3. **The right owner runs the show.** Most refactors come down to moving a decision to where the data lives — tell-don't-ask, drop-down-a-level, encapsulated use cases. Controllers invite, models orchestrate the fields they own.
4. **Tests are the safety net that buys all of this.** A green suite is the precondition for "play". Refactoring without tests is rewriting.

## Reference files

- `references/principles.md` — the full 35-principle catalog with motivation, "how to apply", canonical PHP examples, and source citations. Load this when a specific principle needs depth, when justifying an unusual refactor, or when the user asks for the rationale behind a rule.

## Notes on PHP examples

Examples in `references/principles.md` use PHP and Laravel idioms (`Eloquent`, `abort_if`, `Response::HTTP_FORBIDDEN`, model factories). When applying this skill in another language, treat the PHP as illustration of the *shape* of the refactor — translate the idiom (`abort_if` → an idiomatic guard clause; `Response::HTTP_FORBIDDEN` → the language's named HTTP constant; `protected abstract` → the language's abstract-method mechanism). The principles do not change.
