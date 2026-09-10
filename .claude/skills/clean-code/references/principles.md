# Clean-Code Principles — Full Catalog

This is the deep-dive reference for the `clean-code` skill: 35 principles distilled from 27 Laracasts videos (Jeffrey Way, Adam Wathan, Aaron Francis, et al.) covering *10 Techniques for Cleaner Code*, *Simple Rules for Simpler Code*, *Code Reflections*, *Long-form Refactoring Workshops*, and *SOLID Principles in PHP*.

SKILL.md gives the operational summary; consult this catalog when a specific principle needs full motivation, edge cases, or a canonical code example. Examples are PHP unless noted; the rules transfer to any language.

## Categories

- **Naming** — class, method, variable, and constant names; how the words you pick reveal or hide intent.
- **Control flow** — conditionals, branching, indentation depth, early returns, the shape of a method body.
- **Functions and methods** — extraction, inlining, parameter design, return shape, single-responsibility at the method level.
- **Encapsulation and data design** — where state and behavior live; objects vs. primitives; tell-don't-ask; pushing decisions onto the right owner.
- **Abstraction and polymorphism** — interfaces, dependency direction, strategy/factory/template patterns, ISP/OCP/LSP/DIP.
- **Architecture and module shape** — controllers, use cases, services, repositories, file/directory layout, co-location.
- **Refactoring practice** — the discipline: micro-steps, evaluation, reversion, "is it better?".
- **Testing** — what tests buy you, mocking, control cases, behavior-vs-implementation, endpoint-driven testing.

## Principles

### Replace magic numbers with named constants
- **Category:** Naming
- **One-line rule:** Replace any numeric literal whose meaning isn't self-evident with a named constant on the class that owns the concept.
- **Why it matters:** Bare literals carry zero intent — even ones you wrote and remember today will be opaque to a teammate or to you in six months. Familiarity is not documentation; HTTP status codes like `403` are still magic numbers. The constant's name tells the reader what the value *means*, not just what it *is*.
- **How to apply:**
  - Define `SCREAMING_SNAKE_CASE` constants on the model that owns the concept (point amounts on `Experience`, not on `User`).
  - Name the constant after the *action or meaning* that produces the value (`UPGRADE_ACCOUNT`, `COMPLETE_LESSON`), not the value (`TWO_THOUSAND`).
  - Apply this to protocol numbers too — prefer `Response::HTTP_FORBIDDEN` over `403`.
  - Refactor only inputs/arguments that represent domain actions; leave aggregate-value assertions in tests as literals so the test asserts a concrete expected total.
  - Replace one literal at a time and re-run the test suite between swaps.
- **Canonical code example (PHP):**
```php
// Before
$user->earnExperience(2000);
$user->earnExperience(100);

// After
$user->earnExperience(Experience::UPGRADE_ACCOUNT);
$user->earnExperience(Experience::COMPLETE_LESSON);
```
- **Sources:** An Alternative to Magic Numbers [00:33–03:55].

### Don't abbreviate names
- **Category:** Naming
- **One-line rule:** Spell every class, method, and variable name out in full — never abbreviate to save keystrokes.
- **Why it matters:** Modern editors auto-complete; muscle memory makes the full word as fast to type. There is "literally zero benefit" to `Trans` over `Translator` or `UserRepo` over `UserRepository`, and the abbreviation forces every future reader to decode it. Each tiny infraction is harmless; a thousand of them compound into an unreadable codebase.
- **How to apply:**
  - The only universally accepted abbreviation is `id`.
  - Use `x`/`y` only for actual geometric coordinates — never as loop indices.
  - Name loop variables with the singular form of the collection (`person` for `people`), not a single letter.
  - `i` for an index is fine; `h` for a heading is not.
- **Canonical code example (PHP):**
```php
// Before
foreach ($people as $x) { /* ... */ }
class UserRepo { /* ... */ }

// After
foreach ($people as $person) { /* ... */ }
class UserRepository { /* ... */ }
```
- **Sources:** No Abbreviations [00:45–03:04]; Beware the Flying V Complication [15:43] (`h` → `heading`).

### Name methods and classes for the domain meaning, not the implementation
- **Category:** Naming
- **One-line rule:** Choose names that describe what something *means* in the domain, not how it currently works or when it currently runs.
- **Why it matters:** A name like `scopeRecent($date)` reads as "last N days" but if the implementation matches one exact day, every reader will be misled. Names that describe behavior survive refactors; names that describe a current implementation become lies the moment the implementation changes.
- **How to apply:**
  - Rename when the implementation drifts from the name (`scopeRecent` → `scopeSubscribedOn`).
  - Method names should encode their parameter's meaning (`fetchByBillingId`, not `fetch($billingId)`) so the call site is unambiguous without IDE help.
  - Avoid vague verb names like `process` — they signal you don't know what the method does.
  - Watch for method names that lie: `findUserById` that secretly accepts an email is a name lying about its parameters.
- **Canonical code example (PHP):**
```php
// Before
public function scopeRecent($query, $carbon) {
    return $query->where('created_at', $carbon);
}

// After
public function scopeSubscribedOn($query, $date = null) {
    $date = $date ?: Carbon::today()->subWeek();
    return $query->where('created_at', $date);
}
```
- **Sources:** Play With Confidence [08:00–09:00]; Drop Down a Level [13:14]; No Abbreviations [04:43, 07:10].

### Don't repeat the receiver's noun in its own method name
- **Category:** Naming
- **One-line rule:** A method should not restate context the receiving object already supplies.
- **Why it matters:** When a class is wrongly named, every method has to re-state the missing context, producing 3- and 4-word method names like `addWatchLater`, `removeWatchLater`, `isWatchingLater` on a class called `UserProgress`. The verbose method names are diagnostic — the *class* is the real problem. Once you name the class for what it manages (`WatchLaters`), the methods collapse to single verbs (`add`, `remove`, `has`).
- **How to apply:**
  - When method names need 3+ words to be intelligible, rename the *class*, not the methods.
  - On a `Order` class, define `ship()`, not `shipTheOrder()`.
  - On a collection-shaped class, prefer the conventional verb set: `add`, `remove`, `has`, `toggle`, `get`, `flush`.
  - For boolean queries, use `has(...)` on a collection-like class rather than `is...()` constructions.
  - Don't shorten so far that you produce ungrammatical names (`is(...)` alone won't read).
- **Canonical code example (PHP):**
```php
// Before
$user->watchLaters()->addWatchLater($video);
$user->watchLaters()->isWatchingLater($video);

// After  (class renamed UserProgress -> WatchLaters)
$user->watchLaters()->add($video);
$user->watchLaters()->has($video);
```
- **Sources:** Choose Your Class Names Wisely [00:00–06:43]; No Abbreviations [07:38].

### Keep names short — two words is the target
- **Category:** Naming
- **One-line rule:** Aim for ≤ 2-word names; when a name needs more, ask first whether the unit is doing too much.
- **Why it matters:** When you can't describe a method in two words, the method is probably doing too much. The awkward name is a signal to refactor, not a license to invent `prepAndShipAndNotifyUser` or fall back to a vague verb like `process`.
- **How to apply:**
  - Treat the rule as a smell detector, not a hard cap — `fetchByBillingId` is fine.
  - Conjunctions in names ("And", "Or") are red flags for multiple responsibilities.
  - Falling back to `process` or `handle` to dodge the word count is a bigger smell than a long name.
- **Sources:** No Abbreviations [05:43–07:10].

### Avoid boolean flags in public APIs
- **Category:** Functions and methods
- **One-line rule:** Don't expose `bool` parameters that switch behavior — extract a second method whose name encodes the variant.
- **Why it matters:** Six months later a reader sees `mute($kate, false)` and has no idea what `false` means; they have to dig into the method body to recover the meaning. Booleans on public APIs require every caller to remember the convention. A second named method (`muteTemporarily`) self-documents at the call site.
- **How to apply:**
  - Pause before adding any boolean parameter and ask "could a second named method remove the need?"
  - Extract a sibling method whose name encodes the variant (`muteTemporarily`, `cancelImmediately`).
  - When the new method would mostly duplicate the old, have it delegate to the original and pass through what differs (e.g. an `$attributes` array, not another flag).
  - Drive the refactor from the test side: change tests to call the desired API first, then make production code match.
- **Canonical code example (PHP):**
```php
// Before
public function mute(User $muted, $permanent = true) {
    if ($permanent) {
        $this->mutedAccounts()->attach($muted);
    } else {
        $this->mutedAccounts()->attach($muted, ['expires_at' => now()->addWeek()]);
    }
}

// After
public function mute(User $muted, $attributes = []) {
    return $this->mutedAccounts()->attach($muted, $attributes);
}

public function muteTemporarily(User $muted) {
    return $this->mute($muted, ['expires_at' => now()->addWeek()]);
}
```
- **Sources:** Avoid Flags [02:18–05:47]; Coding on the Fly [17:35]; Improve Confusing Code With Small Refactors [08:18].

### Don't use `else`
- **Category:** Control flow
- **One-line rule:** Eliminate the `else` keyword by returning early, throwing, or letting fall-through handle the second case.
- **Why it matters:** Every branch is another path the reader must trace on every read. When the `if` branch already returns, `else` is structural noise. Stacked conditionals force readers to hold every path in their head simultaneously.
- **How to apply:**
  - If the `if` branch ends with `return`, drop the `else` and let the second branch fall through unindented.
  - Order branches as failure-first / happy-path-last: invert predicates (`passes()` → `fails()`) so early returns sit at the top.
  - Convert wrapping `if (good) { ... } else { throw; }` into a leading `if (bad) { throw; }` guard.
  - Keep `if/else` only when the symmetry genuinely aids readability ("if X do this, otherwise do that").
  - Use `abort_if($cond, 403, $msg)` over manual `if ($cond) abort(403)`.
- **Canonical code example (PHP):**
```php
// Before
if (Date::today() != 'Friday') {
    if ($validator->passes()) {
        Post::create($input);
        return Redirect::home();
    } else {
        return Redirect::back()->withInput()->withErrors($validator);
    }
} else {
    throw new Exception('We do not work on Fridays.');
}

// After
if (Date::today() == 'Friday') {
    throw new Exception('We do not work on Fridays.');
}

if ($validator->fails()) {
    return Redirect::back()->withInput()->withErrors($validator);
}

Post::create($input);
return Redirect::home();
```
- **Sources:** Don't Use `else` [00:00–03:42]; Sweat the Small Stuff [05:41]; Coding on the Fly [16:15].

### Cap method bodies at one level of indentation
- **Category:** Control flow
- **One-line rule:** Treat any method with more than one level of indentation as a refactor signal.
- **Why it matters:** Indentation depth is a concrete proxy for complexity. Each `if` inside an `if` doubles the number of execution paths. Visual depth (the "Flying V" — indentation that ramps up and back down) is the strongest signal that code wants to break apart. Decreasing indentation is "nearly always an indication that you're on the right track."
- **How to apply:**
  - Work from the inside out: zone in on the deepest nested block first and extract outward.
  - Collapse `if (A) { if (B) { ... } }` into `if (A && B) { ... }` when the inner block is the only thing the outer guards.
  - Replace nested logic with `array_filter` / `array_map` (or language equivalents) when the loop's intent matches a built-in primitive.
  - Use early-return to flatten guard conditions.
  - Use the squint test: scan the file half-closed and let dense regions pop out as next refactor targets.
- **Canonical code example (PHP):**
```php
// Before
public function filterBy($accountType) {
    $filtered = [];
    foreach ($this->accounts as $account) {
        if ($account->type() === $accountType) {
            if ($account->isActive()) {
                $filtered[] = $account;
            }
        }
    }
    return $filtered;
}

// After
public function filterBy($accountType) {
    return array_filter($this->accounts, function ($account) use ($accountType) {
        return $account->isOfType($accountType);
    });
}
```
- **Sources:** One Level of Indentation [00:06–11:55]; Improve Confusing Code With Small Refactors [05:58, 07:11]; Beware the Flying V Complication [19:08].

### Tell, don't ask
- **Category:** Encapsulation and data design
- **One-line rule:** Push predicates and decisions onto the object that owns the data; don't pull state out and decide outside.
- **Why it matters:** When callers ask `type()` and `isActive()` and assemble the answer themselves, the object's fields leak into every consumer. Move the question onto the object (`isOfType($type)`) and the getters can become private — better information hiding, fewer consumers entangled with internal shape. The controller shouldn't decide *how* a user is invited; it should say "team, invite this user" and let the model branch.
- **How to apply:**
  - When two getters always combine to answer a higher-level question, move that question onto the class.
  - Once predicates move onto the class, demote the previously public getters to private.
  - "Drop down a level" — push behavior decisions from controllers down to models.
  - Avoid "helicopter parent" callers that reach into another object's fields and orchestrate its work; ask the object to do it.
- **Canonical code example (PHP):**
```php
// Before — caller assembles the answer
if ($account->type() === 'savings' && $account->isActive()) { /* ... */ }

// After — object answers the question
if ($account->isOfType('savings')) { /* ... */ }
```
- **Sources:** One Level of Indentation [10:13–11:18]; Drop Down a Level [02:36, 03:28]; Refactoring for Clarity [02:31, 05:55].

### Encapsulate raw column updates behind expressive model methods
- **Category:** Encapsulation and data design
- **One-line rule:** Wrap multi-attribute updates in a domain-named method on the model so the call site reads as intent.
- **Why it matters:** `$user->update(['stripe_active' => 1, 'stripe_plan' => 'forever', ...])` in a controller leaks DB schema into the orchestration layer. `$user->upgradeToLifetime()` says what the operation *means*; the column list is contained inside the model where it belongs.
- **How to apply:**
  - Replace inline `$model->update([...])` with verbs from the domain (`redeemedBy($user)`, `upgradeToLifetime()`, `cancelImmediately()`).
  - The method body owns the column list; callers own the intent.
  - Prefer a static finder (`GiftCertificate::byKey($key)`) over scattering `where('key', ...)->firstOrFail()` everywhere.
- **Canonical code example (PHP):**
```php
// Before
$certificate->update(['redeemed' => true, 'redeemer_id' => $user->id]);

// After — method on the model
public function redeemedBy($user) {
    $this->update(['redeemed' => true, 'redeemer_id' => $user->id]);
}
// Call site
$certificate->redeemedBy($user);
```
- **Sources:** Coding on the Fly [14:40, 19:06]; Refactoring for Clarity [02:31].

### Replace primitives with domain objects at method boundaries
- **Category:** Encapsulation and data design
- **One-line rule:** Pass richer types across method boundaries when the callee would otherwise have to re-resolve or branch on a primitive.
- **Why it matters:** A method that accepts an email string and then has to "is this a known user?"-branch every call is doing work that belongs upstream. Pass a `User` instance (real or unsaved) and the method works with one type instead of two.
- **How to apply:**
  - Use `firstOrNew(['key' => $value])` to collapse find-or-construct branches into one expression.
  - Use Eloquent's `exists` property to test "has this been persisted?" rather than null-checking a separately fetched record.
  - Keep call-site simplicity in mind — the goal is a richer type *if* it removes branching, not richness for its own sake.
- **Canonical code example (PHP):**
```php
// Before — callee branches on string-vs-known
public function invite($email) {
    $user = User::where('email', $email)->first();
    if (!$user) { $user = new User(['email' => $email]); }
    // ...
}

// After — caller hands in a User; firstOrNew collapses both paths
public function invite(User $user) { /* one path */ }

$user = User::firstOrNew(['email' => $email]);
$team->invite($user);
```
- **Sources:** Drop Down a Level [03:46–05:18].

### Wrap primitives only when they earn it
- **Category:** Encapsulation and data design
- **One-line rule:** Wrap a primitive only when it brings clarity, has behavior, requires self-validation, or is an important domain concept.
- **Why it matters:** Reflexively wrapping every string and int is "very likely the worst case scenario" — adds complexity without payoff. But a bare `cache($data, 50)` is genuinely ambiguous (hours? minutes? seconds?), and a value like `EmailAddress` that owns its own validation guarantees consistency at the type level.
- **How to apply:**
  - Apply the four-criteria checklist: clarity at the call site, behavior to attach, validation/self-consistency, important domain concept.
  - Make value objects immutable: state-changing methods `return new static(...)` rather than mutating `$this`.
  - For unit-bearing values (seconds, weights), make the constructor `private` and expose `fromX(...)` named constructors per unit; pair with `inX()` accessors.
  - Consider extending the API as an alternative — `workoutForHours($n)` and `workoutForMinutes($n)` may beat introducing a new type.
  - Don't promote incidental scalars (`$name`, simple labels) — leave them as primitives.
- **Canonical code example (PHP):**
```php
class TimeLength {
    private function __construct(protected $seconds) {}

    public static function fromHours($hours) {
        return new static($hours * 3600);
    }
    public static function fromMinutes($minutes) {
        return new static($minutes * 60);
    }
    public function inSeconds() { return $this->seconds; }
}

// Call site is unambiguous about units
$john->workoutFor(TimeLength::fromHours(3));
$john->workoutFor(TimeLength::fromMinutes(45));
```
- **Sources:** Wrap Primitives (Sometimes) [00:00–12:25].

### A method should return one type
- **Category:** Functions and methods
- **One-line rule:** Don't return a union type from a method — pick one and persist the other as a side effect.
- **Why it matters:** A `Team::invite()` that returns either `User` or `Invitation` pushes branching onto every caller. Normalize to one return type; if there's another object to surface, persist it as a side effect or expose it via a separate accessor.
- **How to apply:**
  - When you find yourself returning either `A` or `B`, persist the `B` as a side effect and return `A` (or vice versa).
  - Implementations of an interface must return the same shape — if one returns `array` and another returns `Collection`, normalize inside the implementation (`->toArray()`), not at the call site.
  - `instanceof` / `is_a` on a value returned through an abstraction is a refactor signal.
- **Canonical code example (PHP):**
```php
// Before — caller has to branch
$result = $team->invite($user); // User OR Invitation

// After — always returns User; Invitation is a side effect
public function invite(User $user) {
    if (!$user->exists) {
        Invitation::create(['email' => $user->email, 'team_id' => $this->id]);
    }
    return $user;
}
```
- **Sources:** Drop Down a Level [22:13]; Liskov Substitution [05:15–08:50].

### Inline single-use locals and helpers
- **Category:** Functions and methods
- **One-line rule:** When a temporary variable or wrapper method is used exactly once and adds no name, inline it.
- **Why it matters:** A variable named once and used once immediately after is a name the reader has to track for no benefit. A private method that just delegates one line restates the call site. Drop the indirection — but not militantly: a temp variable that names a long expression earns its keep.
- **How to apply:**
  - Inline a temporary unless the inlined line becomes unreadably long.
  - If a private method has shrunk to one line that restates the call site, inline it.
  - Read the method body aloud — if a wrapper name and its body say the same thing, drop the wrapper.
  - Don't be militant: when an expression is dense, a named local is the readable choice.
- **Sources:** Sweat the Small Stuff [02:41]; Refactoring for Clarity [07:00, 09:40]; Improve Confusing Code With Small Refactors [41:02].

### Don't extract until you'd reuse it
- **Category:** Refactoring practice
- **One-line rule:** Promote inline code to a named helper, scope, or class only when reuse is real, not anticipated.
- **Why it matters:** Auto-extracting a query scope every time you see a `where`, or making a method "for clarity" that's used once, "litters" the file with one-off names. The noise compounds. Extract when the same shape appears in two real callers, or when the name genuinely encodes a chunk of logic.
- **How to apply:**
  - When swapping in a newly extracted helper, first delete the inline code and confirm tests go red, then swap and watch them go green — proves the assertion exercises that path.
  - Generalize a helper (e.g. `scopeOnPlan($plan)` from `scopeOnMonthly`) only when the rigid version's repetition is real.
  - Single-use methods are still fine when they *name* a chunk of logic — judgment, not a count threshold.
  - Defer abstraction until the simple version actually hurts.
- **Sources:** Play With Confidence [05:35, 05:03]; Be Strict With Your Controllers [14:40]; Is It Better? [17:15].

### Comments are a flashlight; remove them by making code self-describing
- **Category:** Naming
- **One-line rule:** A comment that points at unclear code is a TODO to rename or extract — once you do, delete the comment.
- **Why it matters:** Comments in a spike phase are flashlights — they point at code that wasn't clear when written. The fix is to make the next line self-describing (extract a function, rename a variable) and then remove the comment. A comment that just paraphrases the next line of code adds noise without value, and stale comments actively mislead.
- **How to apply:**
  - When tempted to add a comment explaining what a condition means, lift the condition into a well-named method whose name encodes the comment.
  - Keep comments that frame *intent* (the "why"); drop ones that restate *what* the next line does.
  - Stale comments are common in real projects — delete them rather than letting them lie.
  - When refactoring a spike, treat the existing comments as a TODO list of names to invent.
- **Canonical code example (PHP):**
```php
// Before — comment explains a compound condition
// Make sure the account is the right type and active
if ($account->type() === $type && $account->isActive()) { /* ... */ }

// After — extracted method name says what the comment said
if ($account->isOfType($type)) { /* ... */ }
```
- **Sources:** One Level of Indentation [06:25, 07:25]; Beware the Flying V Complication [16:11, 17:54]; Refactoring Insurance [11:10].

### Cover code with tests before refactoring
- **Category:** Testing
- **One-line rule:** Refactor only behind a green test suite.
- **Why it matters:** "Without those tests, it's simply too risky." Without a safety net, developers leave working-but-ugly code untouched indefinitely ("tucking the code away"). Tests buy you the right to play — every refactor becomes a click-of-a-button experiment.
- **How to apply:**
  - Run the full suite before starting any refactor; treat green as the precondition, not a goal.
  - Re-run after every micro-change; never batch unverified edits.
  - When a change goes red, revert to green before retrying — don't pile fixes onto a broken baseline.
  - Never begin a *new* refactor while existing tests are red — fix the red baseline first.
  - When the safety net isn't tests (e.g. live animation), refactor in tiny steps and verify in the browser between each step.
- **Sources:** Refactoring Insurance [00:00–12:22]; Play With Confidence [00:00–17:09]; Improve Confusing Code With Small Refactors [01:07–34:25]; Drop Down a Level [17:51]; Is It Better? [02:09]; Beware the Flying V Complication.

### Tests prove only what they assert
- **Category:** Testing
- **One-line rule:** Tighten assertions on the parts that matter — replace `Mockery::any()` and broad matchers with specific argument expectations.
- **Why it matters:** A test mocking `createCoupon` with `Mockery::any()` will pass even if the discount is silently changed from 10% to 99%. The test only proves what it asserts; loose matchers let behavioral regressions slip through.
- **How to apply:**
  - Use `Mockery::on(fn ($arg) => ...)` to assert argument shape; avoid `Mockery::any()` for values that matter.
  - Add control fixtures who should NOT receive the side effect (a user from a different month, or on a different plan); asymmetric tests catch over-broad queries.
  - Always pair a positive fixture with at least one negative.
  - Always pass an explicit count to `Mail::assertSent(..., n)` so over-sending fails too.
  - Prove a test has teeth by deliberately commenting out the production code and watching it fail.
- **Sources:** Play With Confidence [00:13–00:56]; Refactoring Insurance [10:02–12:07]; Coding on the Fly [20:29].

### Test behavior, not implementation
- **Category:** Testing
- **One-line rule:** Drive feature tests through HTTP endpoints and assert observable outcomes; don't assert "calling X sets property Y."
- **Why it matters:** Behavior tests survive refactors — you can extract a service class later and the tests stay green without modification. Implementation-coupled tests force you to update the test every time you reshape the code, defeating the safety-net purpose. Browser-driver form tests cost more than they pay back; POSTing to the endpoint is faster and tests the same thing.
- **How to apply:**
  - Hit the endpoint with `$this->post(...)`, then assert with `assertDatabaseHas`, `Mail::assertQueued`, attribute checks after redirection.
  - Mock collaborators sparingly — they couple tests to implementation; legitimate refactors then break tests for the wrong reasons.
  - Use spies (`Mockery::spy` + `$this->swap`) when you need to assert exact interactions, but ask first whether asserting the outcome would do.
  - Mock external services (Stripe, Mail) by default to keep tests fast; only a small minority should hit real APIs.
- **Canonical code example (PHP):**
```php
public function it_generates_a_gift_certificate_upon_payment() {
    $this->post('/gift-certificates', [
        'stripeToken' => $this->createStripeToken(),
        'stripeEmail' => 'foo@example.com'
    ]);

    $this->assertDatabaseHas('gift_certificates', [
        'purchaser_id'    => User::latest()->value('id'),
        'amount_received' => '25000'
    ]);
}
```
- **Sources:** Coding on the Fly [21:55–23:00]; Refactoring Insurance [04:04, 09:00]; Play With Confidence [00:56].

### Be strict with your controllers
- **Category:** Architecture and module shape
- **One-line rule:** Stick to the seven RESTful actions; when a non-RESTful verb tempts you, extract a new controller.
- **Why it matters:** Compound action names like `storeMember`, `leaveTeam`, `inviteMember` are the symptom of a second resource hiding inside the controller. Splitting into `TeamMembersController` returns each action to a single-word RESTful verb (`store`, `destroy`, `invite`) and keeps every controller's surface small and predictable.
- **How to apply:**
  - The rule is: don't abandon `index`, `show`, `create`, `store`, `edit`, `update`, `destroy`.
  - Prefer a new controller over a service class as the first refactor move; service-class extraction is the next rung.
  - When a verb doesn't fit CRUD, name the new controller `<Subject><Verb>sController` (e.g. `GiftCertificateRedemptionsController`).
  - Don't fear an Eloquent query in a controller — extract only when the query repeats; promote to a static method on the model when it does.
  - Single-use methods are still fine when they name a chunk of logic.
- **Canonical code example (PHP):**
```php
// Before — compound actions
class TeamsController {
    public function storeMember()   { /* ... */ }
    public function destroyMember() { /* ... */ }
    public function inviteMember()  { /* ... */ }
}

// After — second controller; verbs collapse
class TeamMembersController {
    public function store()   { /* ... */ }
    public function destroy() { /* ... */ }
    public function invite()  { /* ... */ }
}
```
- **Sources:** Be Strict With Your Controllers [02:31–14:40]; Coding on the Fly [01:30].

### Sweat the small stuff
- **Category:** Refactoring practice
- **One-line rule:** Tiny tweaks compound — scan for what visually pops, take the cheap wins, then go deeper.
- **Why it matters:** No single small change matters; the cumulative effect defines the architecture and the shape of every future PR. Likened to credit card debt: no single purchase sinks you, the compound effect does. Don't plan one big refactor — stack many small ones, each cheap and reversible.
- **How to apply:**
  - First pass: scan for obvious — overly long lines, formatting inconsistencies, a comment over unclear code, a function inside a function for no reason.
  - Pick a convention (PSR-2, brace style) and follow it; consistency outweighs which convention you pick.
  - Use auto-formatters to enforce indentation/brace consistency.
  - Prefer the framework's newer/shorter API (`request('name')` over `$request->input('name')`, `$request->validate(...)` over `$this->validate(...)`).
  - Default to importing classes via `use` rather than inlining fully-qualified names.
  - Queue work the user shouldn't wait on (`Mail::queue` over `Mail::send`).
  - Move repeated literal values into config files rather than duplicating.
- **Sources:** Sweat the Small Stuff [00:00–12:37]; Improve Confusing Code With Small Refactors [34:25]; Refactoring for Clarity [09:49].

### Repeated method prefixes signal a missing class
- **Category:** Architecture and module shape
- **One-line rule:** When several methods on one class share a prefix, the prefix is the real method name and each suffix is its own class.
- **Why it matters:** `registerTeam`, `registerSubscriber`, `registerGuest` on a controller is a `if/else` ladder waiting to happen. Promote `register` to the method, turn each suffix into a strategy class implementing a shared contract, and the controller's `store` method collapses to: get strategy → call `handle()`.
- **How to apply:**
  - Name strategy classes verb + noun (`RegistersTeam`, `RegistersSubscriber`); never reuse the bare entity name (`Team`, `Subscriber`) — collides with models.
  - Strategies expose a single method, conventionally `handle` (matching framework idiom).
  - Define a shared interface (`RegistersUser`) so all strategies implement the same contract explicitly.
  - Hide selection behind a factory method (`getRegistrationStrategy`) — one place that maps input to concrete class.
  - Place strategies in a layer between controller and model — registration touches request, DB, mail, jobs.
- **Canonical code example (PHP):**
```php
// Before
class RegistrationsController {
    public function store() {
        if ($type === 'team')       { return $this->registerTeam(); }
        if ($type === 'subscriber') { return $this->registerSubscriber(); }
        if ($type === 'guest')      { return $this->registerGuest(); }
    }
}

// After — strategy + factory
interface RegistersUser {
    public function handle();
}
class RegistersTeam implements RegistersUser { public function handle() { /* ... */ } }

class RegistrationsController {
    public function store() {
        return $this->getRegistrationStrategy(request('type'))->handle();
    }
}
```
- **Sources:** The Strategy and Factory Patterns [02:00–07:18]; Don't Use `else` [05:29–08:35].

### Encapsulate user actions as use cases
- **Category:** Architecture and module shape
- **One-line rule:** Model each user action as a single class whose body is the ordered list of steps required to complete it.
- **Why it matters:** Spreading one logical action across model events and listeners "gets very indirect." A use case keeps the steps colocated and readable — one class, one navigable place that documents the whole flow.
- **How to apply:**
  - Use cases live in `app/UseCases/` and are named for the action verb + noun (`RegistersTeam`, `PurchaseVideo`).
  - Single public entry point named `handle` that lists the action's steps in order.
  - Each step is a private method named for what it does (`createUser`, `recordPayment`, `sendWelcomeEmail`).
  - Don't bake pattern names into method names — `getRegistrationStrategy` is implementation; `determineRegistrationMethod` is intent.
  - Steps can be chained as a fluent API when each returns `$this`.
  - Prefer one encapsulated use case over event/listener chains for a single logical action.
- **Canonical code example (PHP):**
```php
class RegistersTeam {
    public function handle($attributes) {
        return $this
            ->createUser($attributes)
            ->createTeam()
            ->recordPayment()
            ->sendWelcomeEmail();
    }
    private function createUser($attributes) { /* ... */ return $this; }
    private function createTeam()             { /* ... */ return $this; }
    private function recordPayment()          { /* ... */ return $this; }
    private function sendWelcomeEmail()       { /* ... */ return $this; }
}
```
- **Sources:** Encapsulated UseCases [00:26–05:18]; Refactoring for Clarity [11:35].

### Co-locate everything a feature needs
- **Category:** Architecture and module shape
- **One-line rule:** A feature's dependencies, configuration, and wiring should live in a single file or directory — not threaded through five.
- **Why it matters:** The pain isn't file count; it's fragmentation. When you can't answer "where is X configured?" with one location, the architecture is wrong regardless of how clean each individual file looks. A project-wide search for the feature name should hit one or two files, not five.
- **How to apply:**
  - Each feature is one class file in a dedicated directory; the file declares its dependencies and contributions.
  - Components return data; the framework decides what to do with it (don't mutate a passed-in config from inside the component).
  - Make optional hooks actually optional — implement only what the feature needs.
  - Provide an escape hatch (`webpackConfig(config)`) for the rare case a feature must mutate the host directly.
  - Validate refactors with a project-wide search for the feature name — if it still hits more than ~2 files, co-location hasn't been met.
  - Expose the same internal extension API to users (`mix.extend('foo', new FooComponent())`) — eat your own dog food.
- **Sources:** Component Refactor Reflections [00:37–11:25].

### Design the API before writing the implementation
- **Category:** Refactoring practice
- **One-line rule:** Sketch how a consumer will *call* the thing first; only then build to satisfy that interface.
- **Why it matters:** Skipping this step ships features that work but feel wrong to use, and by then it's too expensive to redesign. Designing object APIs by writing the call site first is also a key TDD/BDD benefit — redundancy and awkwardness get caught at the call site, not hidden in the class.
- **How to apply:**
  - Write the desired call site first; let it dictate the method name, parameters, and shape.
  - When refactoring a test API, change the test to call the desired API, watch it fail, then update production code to match.
  - "If you don't like writing the test, the code probably isn't well-designed."
- **Sources:** Component Refactor Reflections [04:39]; No Abbreviations [08:09]; Avoid Flags [03:20].

### Single Responsibility — one reason to change per class
- **Category:** Abstraction and polymorphism
- **One-line rule:** Each class should have exactly one reason to change.
- **Why it matters:** A class with multiple reasons to change is fragile and hard to maintain. A reporting class that does authorization, persistence, *and* HTML formatting will be edited every time any of those concerns changes. Extract each concern into its own class so that, e.g., a switch from MySQL to MongoDB only touches the repository.
- **How to apply:**
  - Heuristic: if you can name multiple distinct callers/concerns that would each force this class to change (persistence, formatting, auth), extract each.
  - Authorization is not a domain concern — keep `Auth::`-style calls out of reporting/domain classes; push them up to the controller.
  - Persistence belongs in a repository, injected via the constructor.
  - Don't bake output formatting into a domain class; either return raw data or accept a formatter.
  - Avoid generic `*Service` names — `RegisterUser` makes SRP violations obvious; `UserService` invites them.
- **Canonical code example (PHP):**
```php
class SalesReporter {
    public function __construct(SalesRepository $repo) {
        $this->repo = $repo;
    }
    public function between($start, $end, SalesOutputInterface $formatter) {
        $sales = $this->repo->between($start, $end);
        return $formatter->output($sales);
    }
}
```
- **Sources:** Single Responsibility [02:40–12:00]; Limit Your Instance Variables [04:36]; Is It Better? [15:01].

### Open/Closed — extend, don't modify
- **Category:** Abstraction and polymorphism
- **One-line rule:** Open entities for extension, closed for modification — adding a new variant should not require editing the consumer.
- **Why it matters:** Editing the same code repeatedly causes code rot and risks breaking working code. `instanceof` chains inside a calculator are a "dead ringer" you're modifying instead of extending. Extract the varying behavior to an interface, make concretes implement it, and have the consumer depend only on the interface — adding a triangle is a new class, not an edit.
- **How to apply:**
  - Type-checking branches (`instanceof`, `is_a`) inside a consumer are the canonical OCP smell.
  - Extract the varying behavior to an interface; have each concrete implement it.
  - Have the consumer depend on the interface and call one polymorphic method (`$shape->area()`).
  - Treat OCP as a goal, not an absolute rule — strive for it pragmatically.
- **Canonical code example (PHP):**
```php
// Before
public function calculate($shapes) {
    foreach ($shapes as $shape) {
        if ($shape instanceof Square) { $area[] = $shape->width * $shape->height; }
        elseif ($shape instanceof Circle) { $area[] = M_PI * $shape->radius ** 2; }
    }
    return array_sum($area);
}

// After
public function calculate($shapes) {
    foreach ($shapes as $shape) {
        $area[] = $shape->area();
    }
    return array_sum($area);
}
```
- **Sources:** Open-Closed [00:07–13:23]; Interface Segregation [05:00].

### Liskov Substitution — subclasses must honor the parent's contract
- **Category:** Abstraction and polymorphism
- **One-line rule:** A subclass cannot tighten preconditions or change the return shape of a method it overrides.
- **Why it matters:** That's the whole point of polymorphism — the consumer wrote against the parent's contract, and substitution is what makes "code to an interface" pay off. A subclass that throws on inputs the parent accepted, or returns a `Collection` where the interface promised `array`, silently breaks every consumer.
- **How to apply:**
  - Subclass overrides specialize behavior; never narrow inputs.
  - Implementations must produce the same return shape as the interface declares — normalize inside the implementation (`->toArray()`), not at the call site.
  - When the language can't enforce return types, use `@return` docblocks and hold implementers to them.
  - `instanceof` / `is_a` on a value returned through an abstraction is a refactor signal — fix the implementations, don't branch in the consumer.
- **Canonical code example (PHP):**
```php
interface LessonRepositoryInterface {
    /** @return array */
    public function getAll();
}

// Bad — returns Collection, breaks LSP
class DbLessonRepository implements LessonRepositoryInterface {
    public function getAll() { return Lesson::all(); }
}

// Good — normalizes to the contract's shape
class DbLessonRepository implements LessonRepositoryInterface {
    public function getAll() { return Lesson::all()->toArray(); }
}
```
- **Sources:** Liskov Substitution [01:09–09:38].

### Interface Segregation — many small interfaces beat one fat one
- **Category:** Abstraction and polymorphism
- **One-line rule:** Clients should never be forced to implement methods they don't use.
- **Why it matters:** Forcing an `AndroidWorker` to stub a `sleep()` method (returning `null`) is a code smell that signals the interface is doing too much. Fat interfaces violate SRP at the contract level. Many narrow single-method interfaces are explicitly preferred — and a class is allowed to implement several at once.
- **How to apply:**
  - Name interfaces by capability with `-able` + `Interface` suffixes (`WorkableInterface`, `SleepableInterface`).
  - Prefer single-method interfaces; even one is fine.
  - When a client must vary behavior across types, push the variation into the types via a new interface method (`beManaged()`); don't branch on type in the client.
  - Read every type hint as a coupling claim — ask "does this method actually need everything that type can do?"
- **Canonical code example (PHP):**
```php
interface WorkableInterface  { public function work(); }
interface SleepableInterface { public function sleep(); }
interface ManageableInterface { public function beManaged(); }

class HumanWorker implements WorkableInterface, SleepableInterface, ManageableInterface {
    public function work()  { /* ... */ }
    public function sleep() { /* ... */ }
    public function beManaged() { $this->work(); $this->sleep(); }
}

class AndroidWorker implements WorkableInterface, ManageableInterface {
    public function work()      { /* ... */ }
    public function beManaged() { $this->work(); } // no sleep() stub forced
}
```
- **Sources:** Interface Segregation [00:13–08:34].

### Dependency Inversion — depend on abstractions, not concretions
- **Category:** Abstraction and polymorphism
- **One-line rule:** Type-hint the abstraction the consumer needs, not the concrete class — and let the consumer own the abstraction.
- **Why it matters:** Dependency injection ≠ dependency inversion. Injecting a concrete `MySQLConnection` through a constructor still couples your `PasswordReminder` to MySQL. Both the high-level module and the low-level module should point at the same interface in the middle. The interface should be owned by the consumer (the outlet analogy: the house defines the outlet shape; the TV conforms).
- **How to apply:**
  - Type-hint constructor parameters with the abstraction (interface), never the concrete class.
  - Define the interface as the smallest contract the consumer actually needs.
  - Frame design questions as "knowledge": does this class actually need to *know* this detail?
  - Type-hinting a concrete class drags in transitive dependencies (`User extends Eloquent` means depending on `User` quietly depends on the entire ORM).
- **Canonical code example (PHP):**
```php
interface ConnectionInterface { public function connect(); }

class DbConnection implements ConnectionInterface {
    public function connect() { /* ... */ }
}

class PasswordReminder {
    public function __construct(private ConnectionInterface $connection) {}
}
```
- **Sources:** Dependency Inversion [00:11–08:14]; Interface Segregation [07:03–08:34]; Open-Closed [12:53].

### Limit instance variables (collaborators) per class
- **Category:** Encapsulation and data design
- **One-line rule:** Cap injected collaborators at around four; treat five+ as a smell that demands investigation.
- **Why it matters:** A constructor with seven dependencies is the canonical god-object signature — every collaborator was reasonable in isolation, the cumulative result is tangled responsibilities. Three specific class names are bloat magnets: `User`, `UsersController`, `UserService`.
- **How to apply:**
  - Count only object-typed properties (collaborators) — scalar fields don't count.
  - Funnel repository access through a service; controllers shouldn't talk to repositories directly when a service exists.
  - Split controllers along cohesive concerns (`AuthController` for register/cancel) rather than packing all user-adjacent actions into `UsersController`.
  - Replace cross-cutting collaborators (mailer, logger) with domain events + listeners when the work is a side effect.
  - Treat the cap as a smell, not a law — the rule's job is to make you look.
- **Sources:** Limit Your Instance Variables [00:14–09:19].

### Template Method — skeleton in the parent, hooks in the children
- **Category:** Abstraction and polymorphism
- **One-line rule:** When sibling classes share most of an algorithm, lift the skeleton to an abstract parent and declare the differing steps as `protected abstract` hooks.
- **Why it matters:** Copy-pasting between siblings and tweaking a few lines is the diagnostic signal. The shared algorithm wants to live in one place. `protected abstract` turns "subclass must implement" into a compile-time guarantee; making the template method `final` prevents subclasses from reshaping the workflow they're supposed to fill in.
- **How to apply:**
  - Refactor in two passes: first lift identical methods to the parent (plain inheritance), then lift the algorithm itself and convert the differing step into an abstract hook.
  - Name abstract hooks by their *role* in the algorithm, not by a specific subclass's value (`addPrimaryToppings`, not `addTurkey`).
  - Mark the public template method `final` once stable.
  - Build fluent step methods that `return $this` so the template reads as a chain.
- **Canonical code example (PHP):**
```php
abstract class Sub {
    final public function make() {
        return $this->layBread()->addLettuce()->addPrimaryToppings()->addSauces();
    }
    protected abstract function addPrimaryToppings();
    // shared steps live here
}

class TurkeySub extends Sub {
    protected function addPrimaryToppings() { /* turkey */ return $this; }
}
```
- **Sources:** The Template Method Pattern [00:07–13:18].

### Replace setTimeout pyramids with promises and async/await
- **Category:** Control flow
- **One-line rule:** Wrap a single `pause(ms)` Promise helper, mark callers `async`, and replace nested timers with sequential `await`s.
- **Why it matters:** Repeatedly reaching for `setTimeout`/`setInterval` causes increasing indentation and callback chaining. The mental model: a Promise is "call me when you're ready to come home." A while-loop with `await` flattens recursive timer chains into linear, readable code.
- **How to apply:**
  - Wrap `setTimeout` once in a Promise helper; never reach for it directly in app code.
  - Replace recursive timer chains with `while (cond) { await step(); }`.
  - Move sequencing methods onto the class that owns the data they operate on.
  - Don't double-wrap: `async` already returns a Promise — adding `new Promise(async (resolve) => ...)` around a body is noise.
- **Canonical code example (JavaScript):**
```js
function pause(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function swap() {
    await pause(2000);
    await heading.clear();
    await heading.type(choices[current - 1]);
    return swap();
}
```
- **Sources:** Beware the Flying V Complication [33:18–48:13].

### Be willing to revert
- **Category:** Refactoring practice
- **One-line rule:** Always ask "is it better?" — and if the answer is no, throw the refactor away.
- **Why it matters:** Refactoring can *feel* good (more files, more "patterns") while making the codebase harder to understand. SRP and OCP are not free — splitting into many tiny files where two inline closures used to be can hurt readability. Don't keep a refactor just because you spent time on it; sunk cost is not a reason to ship complexity. A `nah` alias (`git reset --hard && git clean -df`) makes reverting cheap.
- **How to apply:**
  - After any refactor, evaluate it explicitly against the simpler original: is it now better? More files is fine; more confusion is not.
  - Validate refactors objectively (search results, file count, "easier to reason about" check).
  - When introducing an abstraction (constructor injection, observers, events) is "kind of a wash," revert.
  - Defer abstraction until the simple version actually hurts — a couple of inline closures in `boot()` are fine until they aren't.
  - Treat SRP/OCP as goals, not automatic wins.
- **Sources:** Is It Better? [00:00–17:15]; Component Refactor Reflections [10:27–11:01]; Sweat the Small Stuff [09:46]; Play With Confidence [11:46]; Improve Confusing Code With Small Refactors [19:00].

### Pragmatism over perfection
- **Category:** Refactoring practice
- **One-line rule:** Ask "does it matter?" before optimizing structure — clean architecture is a spectrum, not a rule.
- **Why it matters:** When code is one-shot and rarely modified, mixing responsibilities, hard-coding a price, or catching a broad exception can be acceptable. Repository-behind-an-interface for every query "sounds great on paper" but if you've shipped without issue for five months, the abstraction wasn't needed. Over-engineering throwaway code is its own waste. Clarity beats architectural rules — when refactors collide with rules like SRP, pick the version that reads more clearly.
- **How to apply:**
  - Measure how often the code will change before extracting.
  - Validating an HTTP request in the controller is fine — push back on "models should validate themselves."
  - Hard-coding values is fine when *you* own the system and there's no campaign tooling; not fine when business users need to configure.
  - Don't reach for events + listeners for what is effectively four lines of code.
  - "There aren't any rules" — judgment beats dogma.
- **Sources:** Coding on the Fly [05:55–13:00]; Refactoring for Clarity [05:55, 11:35]; Avoid Flags [04:47]; Wrap Primitives (Sometimes) [00:00].

## Cross-cutting themes

- **Constants beat literals** — the magic-numbers principle, the "wrap primitives sometimes" principle, and the "don't pass booleans" principle are all the same idea: a value the reader has to decode at the call site is worse than a name. Replace numbers with named constants, ambiguous units with named constructors, and boolean flags with second-named methods.
- **Objects beat primitives at boundaries** — passing a `User` instead of an email string, an `EmailAddress` instead of a validated string, a `Subscription` instance instead of a `'monthly'`/`'forever'` discriminator. Each replaces branching at the call site with polymorphism on the type.
- **The right owner runs the show** — most refactors come down to moving a decision to where the data lives: tell-don't-ask (predicates onto the model), drop-down-a-level (controllers delegate to models), encapsulated use cases (a single class owns the action), helicopter-parent avoidance (the model invites, the controller doesn't orchestrate fields).
- **Tests are the safety net that buys all of this** — every speaker treats refactoring without a green suite as off-limits. Tests prove what they assert (so tighten matchers and add control fixtures), tests should describe behavior (so endpoint-test, don't implementation-test), and a green suite is the precondition for "play."
- **Indirection has a cost** — the same speakers who teach Strategy, Factory, Template Method, and SOLID also teach: don't extract until you'd reuse, inline single-use helpers, throw the refactor away if it isn't better. The principles are tools, not goals; "is it better?" is the only real test.
- **Names are the front door of clarity** — bad class names cascade into bad method names; long method names hint at over-stuffed methods; comments-as-flashlights point at code that wants a name; don't repeat the receiver's noun. Almost every refactor in this corpus passes through renaming as a step.
