# A registry's `ZodRawShape` can't encode cross-field / one-of / exclusivity constraints

`@furnace/core/registry`'s definers take a **`ZodRawShape`** — a flat `{ field: ZodType }`
object — and `toJsonSchema` reflects exactly that. A flat raw shape cannot express:

- **cross-field `.refine()` / `.superRefine()`** constraints (field A must relate to field B)
- **mutual exclusivity** (set exactly one of A/B)
- **discriminated unions** (fields valid only for a given `type`)

So every real constraint of those shapes gets pushed into an **imperative throw inside
`evaluate`**, where the schema — and therefore the emitted `paramSchema`, and therefore the
editor's reflection-driven form — cannot see it. The schema is strictly *weaker* than what
the generator actually accepts, and the user learns the difference by having a commit
rejected from inside a preview worker, one round trip after the gesture.

> **Re-filed 2026-08-05 (foundations T2).** This entry was written against
> `@furnace/core/scene`'s `defineComponent`/`defineResource` and its three built-in
> offenders (`materials/standard`'s texture-xor-color, `rigidBody.shape`'s exactly-one, the
> flat `light` type enum). That module is deleted. The **gap is structural, not
> scene-specific** — it belongs to the raw-shape registry contract, which `field`'s generator
> registry inherited verbatim — so the entry is restated against the instance set that
> actually exists today rather than deleted with its old examples.

## The instance set today — `field`'s generator registry

`defineGenerator` (`packages/core/src/field/registry.ts`) builds `z.object(decl.params)` from
a raw shape, emits `paramSchema` via `toJsonSchema`, and wraps `evaluate` in `parseOrThrow`.
Its own TSDoc states the split out loud: *"`evaluate` receives PARSED params — per-field
validation is the wrapper's job; cross-field rules stay plain code inside evaluate."* The
confirmed cases:

1. **`scatter.scaleMin` / `scaleMax`** (`field/scatter.ts`, in `evaluate`) — the schema admits
   each bound independently; the PAIR is checked imperatively, with a comment saying so
   verbatim (*"Cross-field: the schema ranges admit each scale alone; the PAIR is checked
   here"*). A reversed pair throws rather than being silently swapped — correct behaviour,
   invisible to the form.
2. **Door offsets vs. wall extent** (`field/generators.ts`, the hall/maze stampers) — a door's
   `offset` is only legal in `0..maxOffset`, and `maxOffset` is a function of *other* params
   (the wall's own cell count). The schema can bound the offset but cannot bound it *by
   another field*, so the fit check is a throw naming the legal range.
3. **Door lane clearance** (`field/generators.ts`) — a door whose walk lane is blocked by the
   interior the same params generated throws at stamp time. Not expressible in any per-field
   schema: the constraint is over the generator's OUTPUT, not its input.
4. **Kit-class availability** (`field/generators.ts` `kitClassId`) — stamp generators require
   a `kind: "kit"` class in the material table. That is a constraint between the params and a
   *context object*, which the schema never sees at all.

Cases 3 and 4 are arguably out of reach for any schema and belong in the "surface build errors
pre-commit" bucket below. Cases 1 and 2 are the ones a richer registry input could actually
express.

## Options to weigh when picking this up (not yet decided)

- **Richer registry input** — accept a `ZodObject` (with `.refine()` / discriminated unions)
  instead of only `ZodRawShape`; teach `toJsonSchema` to emit `oneOf`/`anyOf` and the editor's
  `SchemaForm` to render unions and cross-field refusals. Biggest change, most correct, single
  source of truth (the schema *is* the constraint). Note the constraint that killed the easy
  version: zod's `.refine()` produces a `ZodEffects`, and `z.toJSONSchema` does not encode a
  refinement's predicate — so this needs a declared, reflectable form, not just a wider input
  type.
- **Declarative `constraints` metadata** — a per-generator side-channel (xor groups, ordered
  pairs) the form reads. Lighter, but a *second* source of truth alongside the imperative
  throw (parallel-paths smell — see working-standards "single source of truth").
- **Surface evaluate errors pre-commit** — keep the throws, but have the session card run a
  dry evaluate and show the error before the commit verb enables. Doesn't prevent the invalid
  form, but kills the silent/confusing failure. Cheapest, weakest — and partly built already:
  D-25's `onInvalid` slot already turns a *per-field* refusal into the commit verb's disabled
  reason, so this option is "extend the existing slot to cross-field", not new machinery.

**Trigger to revisit:** the next generator (or the next registry owner) that needs a
union/exclusivity/cross-field constraint, **or** a user-visible report of a param form that
accepts values the generator then rejects. Bundle the decision with that work; don't solve it
speculatively. The old trigger — "a scene-authoring surface returns" — can never fire and is
deliberately dropped.

**Reference:** `packages/core/src/registry/registry.ts` (`toJsonSchema`, `parseOrThrow`),
`packages/core/src/field/registry.ts` (the `ZodRawShape` contract on `defineGenerator` + the
per-field/cross-field split in its TSDoc), `packages/core/src/field/scatter.ts` (the
`scaleMin`/`scaleMax` pair), `packages/core/src/field/generators.ts` (door offset fit, door
lane clearance, `kitClassId`), `docs/reference/editor-architecture.md` §9.3/§9.5 (what the
form can and cannot render), sibling `component-schemas.md`.
