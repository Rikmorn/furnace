# TSDoc Conventions for `@furnace/core`

How TSDoc is written across the engine's public API surface, and the
authoring rule the `packages/core/scripts/check-tsdoc.ts` script enforces.

For *behavioural* contracts (coords, color, DPR, lifecycle, failure policy,
instrumentation), see `engine-conventions.md`. For the consolidated
textual API reference, see `core-modules.md`. This document covers the
*authoring policy* for the inline TSDoc that drives IDE tooltips and (in
future) any TypeDoc / api-extractor reference generation.

## TSDoc, not JSDoc

We follow [TSDoc](https://tsdoc.org/) — Microsoft's TypeScript-aware
subset of JSDoc. The key differences from classical JSDoc:

- **No type annotations in tags.** Write `@param name - description`,
  never `@param {string} name - description`. The TypeScript signature
  carries the types; restating them in TSDoc is filler that rots.
- **TypeScript-aware tooling support.** TypeDoc, `@microsoft/api-extractor`,
  and VS Code / TS language-server tooltips all parse TSDoc.
- **Structured tags + free prose.** Tags (`@param`, `@returns`, `@throws`,
  `@remarks`, `@deprecated`, `@example`) carry semantic content; prose
  paragraphs cover everything the tags can't express.

## Scope

In scope (enforced by `check-tsdoc.ts`):

- Every public re-export from `packages/core/src/<module>/index.ts`.

Out of scope (not enforced; document at your discretion):

- Internal `_*`-prefixed helpers (e.g. `_frameStart`, `_registerResource`).
- Test files.
- `packages/hello-world`, `packages/cookbook`, `packages/tools`,
  scaffolding templates.

## The floor

Every public export must have at minimum a **one-line summary**.

Deeper prose is **required** when the export has non-obvious behaviour
in any of these dimensions:

- **Throws.** Any `throw new FurnaceError(...)` / `throw new FurnaceGpuError(...)`
  in the body. Document via `@throws ErrorType - reason`.
- **Out-param mutation.** The function mutates a parameter the caller
  passed in (e.g. `projectToScreen`'s `out` argument, math `(out, a, b)`
  helpers). Document the mutation contract in prose.
- **Allocation semantics.** Lazy / eager / per-frame buffer creation
  (e.g. `frame.render`'s lazy depth-texture allocation).
- **Unit conventions.** CSS pixels vs device pixels, radians vs degrees,
  linear vs sRGB color space, world vs screen coordinate space.
- **Edge-case behaviour.** NaN propagation, behind-camera, divide-by-zero,
  disposed-context no-op.
- **Setup-loud vs runtime-quiet failure.** Which policy this function
  follows. See `engine-conventions.md` for the policy itself.

If none of those apply (pure idempotent setter, simple data lookup), the
one-liner is sufficient.

## Format

Use TSDoc tags where they map naturally:

- **`@param name - description`** — only when the parameter carries
  semantic content the type doesn't (units, mutation contract, when-null
  conditions, valid range). Skip when the type signature already says
  it. Never `@param {Type} name`.
- **`@returns description`** — only when the return value carries
  semantics beyond the type. E.g. "true if in front of camera, false if
  behind" on a function typed `: boolean`.
- **`@throws ErrorType - reason`** — for every documented throw. Name
  the class. Brief reason.
- **`@deprecated description`** — when applicable.
- **`@remarks ...`** — optional. "Additional context beyond the summary"
  — the natural home for the "deeper prose when tricky" material. Plain
  paragraphs work too.
- **`@example`** — optional; encouraged for non-obvious usage patterns.

Prose paragraphs cover summary, behaviour overview, design rationale,
cross-references, anything the tags above can't express.

**Never restate the type signature.** If the type says `cam: Camera`,
don't write `@param cam - The camera`. That's filler. Write `@param cam`
only when there's semantic content beyond the type — e.g. "Mutated in
place; only `viewDirty` is flipped."

## Type exports

Types and interfaces get TSDoc on the declaration. Field-level TSDoc is
encouraged where the field name doesn't carry the contract:

- `pixelRatio: number` → benefits from a TSDoc note (CSS vs device,
  default behaviour).
- `width: number` on a `Size` type → the name says it; field TSDoc would
  be filler.

## Reference exemplars

Read these as the target style:

- **Rich:** `packages/core/src/camera/project.ts` (`projectToScreen`) —
  out-param mutation, viewport unit gotcha, runtime-quiet failure note,
  behind-camera semantics. Shows the deeper-prose floor in action.
- **Medium:** `packages/core/src/camera/bind.ts` (`updateForSize`,
  `bindToCanvas`) — failure policy, idempotency, cross-reference to
  the companion tranche.
- **Minimal:** `packages/core/src/camera/common.ts` (`setPosition`) —
  the one-liner floor for a simple idempotent setter (added by this
  tranche).

## Release tags — deferred

TSDoc has `@public` / `@internal` / `@beta` / `@alpha` release tags. We
are not using them yet. When `@furnace/core` opens to external consumers
(or sooner if unstable surface needs flagging), introduce them in a
dedicated tranche.

## What the check enforces

`packages/core/scripts/check-tsdoc.ts` (run via `bun run check:tsdoc`
and chained from `bun run check`):

- Walks every re-export in `packages/core/src/<module>/index.ts`.
- Resolves each re-exported name to its declaration site.
- Reports any declaration lacking a leading TSDoc block (`/** ... */`).
- Skips `_*`-prefixed identifiers.
- Exits non-zero on any violation.

What the check does **not** enforce:

- Content quality (the "deeper prose when tricky" floor is a code-review
  concern, not a tool concern).
- TSDoc tag syntax validity — `@param {string}` would not be flagged by
  the check, but is a convention violation and should be caught at review.
- Stale TSDoc (semantic drift between docs and behaviour).
- Anything outside `@furnace/core`.

## Stale TSDoc is a review concern

The check catches *missing* TSDoc, not *stale* TSDoc. When you change a
public export's behaviour — new throws, new edge cases, changed contract —
update its TSDoc as part of the same change. The AGENTS.md "Keeping docs
current" section restates this; treat it as part of the normal
post-implementation hygiene.

## Cross-references

- **Inline comments in function bodies** follow a different rule. See
  `.claude/rules/clean-code.md` — that rule's "default to no comments"
  guidance applies to *inline* comments explaining what code does, not
  to TSDoc contracts on exports.
- **Behavioural contracts** (coord systems, color spaces, DPR, lifecycle
  policy) live in `engine-conventions.md`. TSDoc references those by
  name rather than restating them.
- **Public API reference** lives in `core-modules.md`. TSDoc is the
  IDE-tooltip surface; `core-modules.md` is the consolidated reference.
  When you change one, update the other.
