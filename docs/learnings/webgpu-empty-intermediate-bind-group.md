# WebGPU: an unbound *intermediate* bind-group slot fails validation (June 2026)

*Captured from Stage 3 Phase 1 of the Visual Fidelity epic — the binding-frequency split. Fix in commit `33de65f`; surfaced by the Safari visual gate after `732eeab` (the object→`@group(2)` move).*

## Context

Stage 3 Phase 1 reorganized the engine's bind groups by update cadence (`docs/reference/engine-conventions.md` §Binding contract):

- `@group(0)` = per-frame (camera)
- `@group(1)` = per-material params
- `@group(2)` = per-draw object (model matrix)

This moved the per-draw `Object`/model uniform from `@group(0) @binding(1)` to `@group(2) @binding(0)`. It was meant to be a pure, render-identical reorganization. The full headless test suite (`bun test`, 739 pass) stayed green, and the bowling demo rendered correctly. But the hello-world **triangle** demo and the cookbook **render-target** demo died on load with:

```
[furnace/gpu] uncaptured device error  Validation failure.
```

## The bug

The two failing demos share one thing the working ones don't: they render a mesh using the built-in **`normalColor`** shader, which declares **no `@group(1)` bindings** (it outputs the world-space normal as RGB — no material params). 8 demos across the workspace use `normalColor`.

Before the split, `normalColor` used only `@group(0)` (camera + object both lived there). With `layout: "auto"`, its pipeline layout had exactly one bind-group slot, and the engine's draw path bound it. Fine.

After moving object to `@group(2)`, `normalColor` now uses groups **0 and 2, skipping 1**. Under `layout: "auto"`, the pipeline layout's bind-group-layout array is sized to `(highest group index used) + 1` — so it spans **slots 0, 1, 2 with an *empty* layout at slot 1**. The engine's draw loop, which had always skipped binding group 1 when a material has no `@group(1)` (`if (material.group1) …`), now left a *present-but-empty intermediate* slot unbound:

```
setBindGroup(0, camera)   // bound
// slot 1 — empty layout, NOT bound
setBindGroup(2, object)   // bound
```

**WebGPU validates a draw against every slot in the pipeline layout. An intermediate slot (1) that is unbound while a higher slot (2) is bound is invalid** — hence the validation failure. The same move was harmless for `lit`/`unlit`/`textured` (used by bowling) because they *have* a `@group(1)`, so there was no gap.

The key subtlety: before the split, group 1 (material) was the **highest/trailing** group. An unbound *trailing* group is fine — you just don't use it. The split turned group 1 into an **intermediate** group, and the unbound-intermediate-slot rule bit.

## Why the headless suite didn't catch it

`bun-webgpu` (the headless GPU runtime for `*.gpu.test.ts`) **does not enforce** the empty-intermediate-bind-group rule. A GPU test that renders a `normalColor` mesh through `frame.render` inside a `pushErrorScope("validation")` returned `null` (no error) both before and after the fix. The suite was structurally unable to reproduce the bug.

Real implementations (Safari/WebKit **and** Chrome/Dawn) enforce it. This is a textbook instance of the project's standing rule (`[[project_furnace_primary_browser]]`): the headless runtime is more permissive than real browsers, so validation-class bugs hide until the visual gate.

## The fix

Always bind group 1 — the material's bind group if present, else a cached empty bind group built from the pipeline's own `auto` layout — so the `0 → 1 → 2` sequence is always contiguous and fully bound:

```ts
// render.ts — cached per pipeline (the empty layout is pipeline-specific under `auto`)
const emptyGroup1Cache = new WeakMap<GPURenderPipeline, GPUBindGroup>();

function ensureEmptyGroup1(ctx: Context, pipeline: GPURenderPipeline): GPUBindGroup {
  const cached = emptyGroup1Cache.get(pipeline);
  if (cached) return cached;
  const bindGroup = ctx.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(1),
    entries: [],
  });
  emptyGroup1Cache.set(pipeline, bindGroup);
  return bindGroup;
}

// in recordDraw:
pass.setBindGroup(1, material.group1 ?? ensureEmptyGroup1(ctx, pipeline));
```

An empty bind group carries no resources, so output is byte-identical for materials that *have* a `@group(1)`; for material-less shaders it just satisfies the validator. Mirrored in `render-to-texture.ts` (the off-screen draw path) via `_frameRenderInternals._ensureEmptyGroup1`.

## Verifying validation-class fixes without Safari: drive Chrome/Dawn via Playwright

Because the headless suite can't reproduce this, the fix needed an independent strict-WebGPU check before handing the Safari gate to the user. Chrome's WebGPU (Dawn) enforces the same spec rule. Driving it via the Playwright MCP against the live dev servers gave that confirmation:

1. `bun run hello-world:dev` (hello-world, port 8765) and the cookbook dev server (port 8766).
2. `browser_navigate` to each failing demo; `browser_console_messages` scanned for `[furnace/gpu]` device errors.
3. Post-fix, both rendered at 120 fps with a clean console (only an unrelated favicon 404).

Chrome/Dawn is a usable pre-Safari gate for **validation-class** bugs the headless runtime skips. (It is *not* a substitute for the Safari gate on *visual* correctness — Safari remains the primary per `[[project_furnace_primary_browser]]`.)

## The general principle (how to avoid re-learning this)

- **A fixed group-index convention means some groups will be empty for some shaders.** If your highest-numbered group is always used (here: per-draw object at `@group(2)`), any lower group a given shader doesn't use becomes an *empty intermediate slot* that the engine must still bind. Bind an empty bind group for it; don't skip.
- **`if (resource) setBindGroup(...)` is only safe for the trailing group.** Skipping an optional bind group works only when nothing higher is bound. Once a higher group exists, every lower slot must be bound.
- **Adding a binding to an existing group does NOT create this hazard** — only adding a new, higher group index does. (Stage 3 Phase 2 adds a Scene UBO at `@group(0) @binding(1)`, a binding on the existing group 0, so it won't reintroduce a gap.)
- **Headless-green is necessary, not sufficient, for binding changes.** Confirm in a strict implementation (Chrome/Dawn via Playwright, then Safari) before sealing.

## See also

- Commits `732eeab` (the object→`@group(2)` move), `33de65f` (this fix).
- `docs/reference/engine-conventions.md` §Binding contract — the group/cadence scheme.
- `packages/core/src/frame/render.ts` — `ensureCameraGroup0` / `ensureObjectGroup2` / `ensureEmptyGroup1`.
- WebGPU spec: §"Encoder State" draw validation (bind groups must be compatible with every bind-group layout in the pipeline layout).
