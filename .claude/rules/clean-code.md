---
paths:
  - "**/*.ts"
---

# Clean Code

Applies to **new code** and **substantial edits**. Drive-by changes to legacy files don't trigger restructuring — if you notice a violation in surrounding code you weren't asked to change, mention it but don't silently expand scope. Refactor work happens in dedicated sessions where the task is explicitly "clean up X".

This rule covers structure and readability. For type-system hygiene see `typescript.md`. For naming conventions (camelCase, PascalCase, ALL_CAPS) see CLAUDE.md.

## Functions

- **Short and single-purpose.** Aim for functions that fit on one screen (~30–40 lines) and do one thing. Long functions are usually doing several things — extract them.
- **One level of abstraction per function.** A function calling `await createShipment(...)` shouldn't also be doing `cents * 100 + Math.round(...)` inline — the arithmetic belongs in a named helper at the level below. Mixing levels forces the reader to context-switch mid-function.
- **Extract private helpers freely.** A private helper in the same module is cheap. The cost of one extra named function is almost always less than the cost of the reader holding more context in their head.
- **Few parameters.** More than ~4 positional parameters is a smell. Prefer a typed options object or pull related parameters into a domain type. Boolean flags that change behaviour are a stronger smell — usually two functions in disguise. An options object containing many *cohesive* config fields (e.g. framework construct/builder props) is fine — the test is whether the reader has to hold separate unrelated mental models, not raw field count.
- **Separate commands from queries.** A function that returns data (`getOrder`, `computeRefund`, `isEligible`) must not mutate state. A function that mutates (`recordRefund`, `publishShipmentCreated`) returns `void` or just the new entity's id. Pragmatic exceptions exist (e.g. a `pop()` that returns and removes) — name them so the dual nature is obvious. The function name is a contract.
- **Don't mutate parameters.** Return a new value rather than modifying an argument in place. If you must mutate, it should be `this` on a class method, or an explicit owner the caller passed in for that purpose — and the function name should say so.
- **Declare variables close to their first use.** Don't declare at the top of a function if the variable isn't used until 20 lines down — declare it where it's first needed, so the reader doesn't have to hold its scope across unrelated code.

## Iteration

Prefer functional pipelines (`map`, `filter`, `reduce`, `flatMap`, `Object.entries(…).map(…)`) over imperative `for` loops when transforming or aggregating data. They're declarative, harder to get wrong (off-by-one, accidental mutation), and read top-to-bottom.

A `for...of` loop is the right tool when:
- You're awaiting per-iteration and order matters (`for...of` with `await`, *not* `forEach` with `await`)
- You need early termination mid-iteration that `.find()` / `.some()` / `.every()` can't express
- You're paginating an AWS SDK call that doesn't expose an async iterator
- You've measured a real performance need in a hot path

`forEach` with side effects is almost never the right choice — use `for...of` or a `map`/`reduce` that produces a value.

## Branching

- **Early returns over deep nesting.** Guard clauses at the top of a function are easier to scan than `if (happy) { … } else { error }` wrapped around the whole body.
- **Prefer positive conditions.** `if (!isUnauthorized)` is harder to read than `if (isAuthorized)`, and double negatives compound. If you find yourself writing `!isNotX(...)`, invert the predicate name. Exception: genuinely binary guard checks (`if (!found) return`) where the positive form is awkward.
- **Extract complex conditions into named variables.** A multi-clause boolean inside an `if` forces the reader to parse precedence and reconstruct intent. `if (order.amount > 0 && order.status === 'COMPLETED' && !order.refunded)` becomes `const isEligibleForRefund = ...; if (isEligibleForRefund)`. The variable name carries the meaning the condition is supposed to express.
- **No nested ternaries.** A ternary inside a ternary forces the reader to parse precedence. Pull the inner expression into a named variable, or use an early return.
- **Lookup tables beat long `if/else if` chains.** When dispatching on a discriminator (string, enum), prefer `Record<Discriminator, Handler>` or a `switch` over an `if (x === 'a') … else if (x === 'b') …` chain.
- **Don't paper over nullability with `?.`.** If a value can be null, handle it explicitly with an early return, guard, or default — chaining past it and hoping for the best obscures control flow. See `typescript.md` for the type-system angle.

## Constants and Literals

**No magic literals in logic.** A numeric or string literal inside a conditional, comparison, or arithmetic should be a named constant whose name explains its purpose: `if (attempts >= MAX_RETRY_ATTEMPTS)` not `if (attempts >= 3)`. The values `0`, `1`, `-1`, and empty strings are usually fine as-is. Test fixtures, schema bounds (e.g. Zod `.min()` / `.max()`), and framework config values are exempt — there the literal *is* the spec.

## Comments

Default to none. Well-named identifiers explain *what*. A good comment explains *why*: a constraint that isn't visible in the code, a workaround for a specific bug (link the issue), behaviour that would surprise a reader.

Don't:
- Restate the code (`// increment counter`)
- Reference the current PR, ticket, or "added for X" — that belongs in the commit message and rots in the source
- Leave commented-out code — delete it; git has the history

**TSDoc contracts on public API are a different thing** — this rule does not apply to them. Every public re-export from `packages/core/src/<module>/index.ts` MUST have a leading TSDoc block (`/** ... */`) per the convention at `docs/reference/tsdoc-conventions.md`, enforced by `bun run check:tsdoc`. The "default to none" guidance covers inline `//` comments inside function bodies, not contract documentation on exports.

## Cognitive Load

Watch for these signals that something has grown too big and warrants an extraction:

- A file approaching ~400 lines, especially mixing unrelated concerns (e.g. handler + business logic + DB access + HTTP serialisation)
- A function approaching ~50 lines or 4+ levels of indentation
- A module that exports more than ~5 unrelated things
- A type/interface with 20+ fields that aren't a coherent domain object (often a sign of accidental coupling)

The fix is almost always: extract a private helper, split a file by concern, or introduce a domain type that names the bundle of related fields. Line-count alone isn't the issue — the issue is usually *tangled* concerns (expression building mixed with iteration mixed with error handling) in a single function. A 100-line function that is a clean linear sequence of named steps is fine; a 60-line function with three concerns interleaved is not.

**Tolerate duplication until the third occurrence.** Two similar code blocks are fine; on the third, extract a helper. Don't abstract on the first duplication — the wrong abstraction is harder to undo than the duplication. If you find yourself reaching for an abstraction with only two call sites, prefer waiting for a third to confirm the shape.

## Exemptions

These don't trigger the rules above:

- **Declarative code.** Schema definitions (Zod, io-ts, etc.), framework construct props (CDK, etc.), and type/interface definitions — line count and "single purpose" don't apply. The function-size rule is about *function bodies*, not structural declarations.
- **Fluent / builder APIs.** Methods that return `this` (or the same builder type) to enable chaining are intentional and don't violate single-responsibility. Keep each method short and focused on one step of the chain.
- **Guard-clause prefixes.** A handler that opens with 5–10 early-return guards (metadata checks, missing field checks, "not applicable to this caller") is filtering, not over-nesting. That's the pattern we want, not a smell.

## What Counts as "Substantial Edit"

For the purposes of this rule:
- **New file, new function, new type** → apply in full.
- **Materially rewriting an existing function** (>50% of body changes, or changing its contract) → bring it up to standard while you're there.
- **Adding a few lines, fixing a typo, narrow bug fix** → match surrounding style; don't restructure.
- **Touching a file the project marks as legacy/deprecated/frozen** → don't restructure regardless of edit size. Project-specific legacy boundaries live in the project's CLAUDE.md or conventions rule. Exception: if you're materially rewriting a *specific function* inside a legacy file (e.g. a bug fix that needs a real rewrite), the rewrite itself should meet standards — don't replicate the surrounding legacy patterns into the new code.
