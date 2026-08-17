---
summary: most cookbook demos still default to `shader.normalColor` where `shader.lit` would read form and motion better — an optional per-demo sweep, each swap needing a colour binding and a mid-tone colour
---

# Cookbook: broader `normalColor` → `lit` sweep

**Filed 2026-06-04** (Stage 4A — "Playable Core"). Stage 4A added the `shader.lit` built-in and swapped the cookbook **animation** demo to it (Task 10). The other cookbook demos still default to `shader.normalColor` — this entry tracks the optional follow-up sweep.

## Context

`shader.lit` (half-Lambert directional + hemisphere ambient, reusing `unlit`'s `{ color: "vec4f" }` `@group(1)` layout) reads form/motion more legibly than `normalColor`'s rainbow-normal debug shading for demos whose lesson is NOT about normals. Stage 4A swapped only the `animation` demo (its lesson is interpolation, and stable directional lighting reads rotation better).

Other cookbook demos still using `normalColor` (verify the current set before sweeping; ~6 at filing time, e.g. geometry/primitives, camera, render-target where colour isn't the lesson). Each candidate swap is the Task-10 pattern:
- `shader.lit(ctx)` REQUIRES a colour binding (`binding.create` + `binding.set({ color })`) — `material.create` throws on a layout-bearing shader with no binding. The bare shader-swap is NOT sufficient (this bit Task 10).
- Use a MID-TONE colour — `lit`'s combined directional+hemisphere term peaks ~1.6×, so bright/near-white base colours clip and lose the shading gradient.
- Track + destroy the binding for leak-free teardown if the demo destroys its material (the binding owns its buffer; `material.destroy` does not free it).

**Not a blanket swap:** `normalColor` is KEPT as the debug shader. Demos whose lesson IS normals/debugging should stay on it. The `shader` demo is a `shader.load` showcase, not a normalColor showcase — out of scope. Only swap demos where lit genuinely reads better and loses no teaching value.

## Trigger to revisit

A cookbook-polish pass, OR when a specific demo's legibility is observed to suffer under `normalColor` (faces indistinguishable, rotation invisible). Low priority — purely cosmetic/teaching-clarity, no functional gap.

## Reference

- Pattern: `packages/cookbook/src/demos/animation/entry.ts` (the Task-10 swap), `packages/cookbook/src/demos/blend/entry.ts` `createUnlit` (the binding pattern)
- API: `docs/reference/core-modules.md` `@furnace/core/shader` (`lit`), `@furnace/core/binding`
- Sibling debt against the same one-demo-per-Tier-1-feature convention:
  `docs/backlog/engine-architecture/tier-1-names-with-no-demo-decision.md` and
  `docs/backlog/engine-architecture/cookbook-demo-for-diagnostics.md`.
