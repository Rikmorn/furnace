# Scene schema can't encode cross-field / one-of / exclusivity constraints

The scene registry (`defineComponent` / `defineResource` in `packages/core/src/scene/registry.ts`) takes a **`ZodRawShape`** — a flat `{ field: ZodType }` object. A flat raw shape cannot express:

- **mutual exclusivity** (set exactly one of A/B)
- **discriminated unions** (fields valid only for a given `type`)
- **cross-field `.refine()` / `.superRefine()`** constraints

So every real engine constraint of those shapes gets pushed into an **imperative throw inside `build()`**, where the schema (and therefore `introspect()` and the reflection-driven inspector) can't see it. The schema is strictly *weaker* than the engine's actual constraints. This is the root of the M1-slices visual-gate observation: *"almost like we don't really know our own constraints."*

**Confirmed instances (`packages/core/src/scene/builtins.ts`):**

1. **`materials/standard`** — schema carries *both* `texture?` and `params.color?` as independent optionals; the "exactly one" rule is a build-time throw (`builtins.ts:526-530`, `"material has both a texture and a color param (mutually exclusive)"`). The inspector shows both fields as settable; setting both produces a form the loader rejects on apply.
2. **`rigidBody.shape`** — schema is `z.strictObject({ cuboid?, ball?, cylinder? })`, permitting 0/2/3; the "exactly one" rule is the `toShape()` throw (`builtins.ts:249-264`). Same failure mode.
3. **`light`** — the engine `Light` is a discriminated union (directional/point/spot), but the component schema is a flat `type` enum + all-optional fields (`builtins.ts:335-363`). `innerAngle`/`outerAngle` are silently ignored on a directional light; `range` is ignored on directional; the schema can't say "these fields only apply to spot." (This was **M1-slices decision #3** — flat objects chosen deliberately to fit the `ZodRawShape` registry + the M5A reflection inspector. The cost recorded here is the constraint we traded away.)

This is **structural, not a per-builtin bug**: any future component/resource with a union, exclusivity, or cross-field rule inherits the same gap. The reflection inspector reads `introspect()` (JSON Schema derived from the zod schema via `t.ts`), so it renders all fields independently and *cannot* enforce or even surface these constraints — it can only show the loader's error after a failed apply.

**Options to weigh when picking this up (not yet decided):**

- **Richer registry input** — accept a `ZodObject` (with `.refine()` / discriminated union / `z.union`) instead of only `ZodRawShape`; teach `introspect()` to emit `oneOf`/`anyOf` and the inspector to render unions + disable mutually-exclusive fields. Biggest change, most correct, single source of truth (the schema *is* the constraint). Couples to the editor-interaction-model redesign.
- **Declarative `constraints` metadata** — a per-component/resource side-channel (xor groups, oneOf groups) the inspector reads. Lighter, but a *second* source of truth alongside the build-time throw (parallel-paths smell — see working-standards "single source of truth").
- **Surface build errors pre-commit** — keep the throws, but have the inspector run a dry build / validate and show the error before commit. Doesn't prevent the invalid form, but kills the silent/confusing failure. Cheapest, weakest.

**Trigger to revisit:** the editor interaction-model redesign (`editor-interaction-model-redesign.md` — the inspector is the consumer this hurts), **or** the next component/resource that needs a union/exclusivity/cross-field constraint (whichever comes first). Bundle the decision with that work; don't solve it speculatively.

**Reference:** `packages/core/src/scene/builtins.ts` (sites: `:249-264` toShape, `:335-363` light, `:512-572` standard material), `packages/core/src/scene/registry.ts` (`ZodRawShape` contract on `defineComponent`/`defineResource`), `packages/core/src/scene/t.ts` (`introspect`), M1-slices spec §9 decision #3, sibling `component-schemas.md`, `editor-interaction-model-redesign.md`.
