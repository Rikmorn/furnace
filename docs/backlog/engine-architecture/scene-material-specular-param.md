# Scene `standard` material carries no `specular` param — baked regions render matte

## Context
The core scene `standard` material's param schema is `params: z.strictObject({ color: t.color().optional() })` (`packages/core/src/scene/builtins.ts`, `defineResource("materials", "standard")`). It accepts **only** `color` — there is no `specular` field, even though the `lit` shader has a `specular: vec4f` uniform and the live path sets it: `realize.ts` `MaterialCache.get` calls `binding.set(ctx, bind, { color, specular })`.

Consequence for the Slice 3.1 bake path (`packages/dungeon/src/bake.ts` `regionDoc`): `RegionData.materials` carry both `color` and `specular`, but the baked scene doc can only serialize `color`. `specular` is dropped, so a loaded/baked region's lit material renders with `specular` at its zero-initialised GPU default (matte) — a visible fidelity difference from the live-generated region, which shows the theme's specular highlight. (The 3.0 baker `scripts/bake-generated-wing.ts` already dropped it the same way, so this is a pre-existing convention, not a new regression.)

## Trigger to revisit
When baked regions must render pixel-identically to their live-generated preview (e.g. the cockpit's "the baked world looks like what I curated" acceptance bar tightens), or when any consumer needs per-material specular through the scene loader. Fix is a **core change**: add an optional `specular: t.color().optional()` to the `standard` material's `params` strictObject and thread it through the build (`binding.set(ctx, b, { color, specular })`), then have `bake.ts regionDoc` emit `params: { color, specular }`.

## Reference
- `packages/core/src/scene/builtins.ts` — `defineResource("materials", "standard")` param schema + build.
- `packages/dungeon/src/realize.ts` — `MaterialCache.get` (the live path that sets both color + specular).
- `packages/dungeon/src/bake.ts` — `regionDoc` (drops specular; comment points here).
