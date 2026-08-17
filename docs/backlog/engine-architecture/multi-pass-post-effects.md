---
summary: what the shipped `createPasses` surface still cannot express — depth/normal/velocity inputs from the scene pass, cross-frame history targets, and compute passes in the chain
---

# Post: multi-pass effects

## Stage 2b status

**Resolved by Stage 2b (T2 / `createPasses` + pool + `bloom`):**

- Multi-pass effects — `post.createPasses({ passes: PassDescriptor[] })` lets each effect declare an arbitrary ordered list of fullscreen passes.
- Multi-input passes — `PassDescriptor.inputs: PassInput[]` supports N `@group(0)` texture inputs per pass (`"scene"`, `"prev"`, `{ intermediate: name }`). Used by `post.bloom`'s upsample passes (two inputs: smaller mip + same-level mip) and the composite pass (scene + bloom).
- Different-sized intermediates — `PassDescriptor.output.scale` multiplies the canvas size; the per-ctx transient pool (`post/pool.ts`) acquires the correctly-sized `GPUTexture` and reuses it across frames.
- Real bloom — built-in COD/Jimenez dual-filter (`post.bloom`) ships as a `createPasses`-authored effect: prefilter + downsample chain + tent-upsample accumulation + composite, all mid-chain pool-backed. Up to 6 mips.

## Remaining / deferred

What the T2 `createPasses` surface **cannot** express today:

- **Scene-side G-buffer inputs** — depth, normals, velocity from the scene pass itself. The scene pass's depth/normal buffers are not yet accessible to post effects (`PassInput` only covers scene-color + named post-chain intermediates). SSAO, SSR, motion blur, and depth-of-field all need this.
- **Cross-frame history** — TAA needs the previous frame's output retained across frames. The pool does not persist across frames; targets on the free list are available but not semantically guaranteed to be "last frame's output."
- **Compute passes** — luminance histogram (auto-exposure), GPU sort/scan, particle simulation. `createPasses` records fragment passes only; the chain evaluator has no compute-pass slot.
- **Separable blur** as a cross-effect building block — the T2 API composes this via two passes in one `createPasses` call; the abstraction gap is that the consumer must wire the intermediate by name, which is fine for now.

These deferred items form the seed of a render-graph entry point. They are tracked in `render-graph.md`.

**Trigger to revisit:** First of the remaining cases lands as a real consumer need:
- SSAO or SSR (scene-side G-buffer inputs).
- TAA (cross-frame history target).
- Auto-exposure (compute pass).

**Reference:** Stage 2b `createPasses` + `bloom` (packages/core/src/post/passes.ts, bloom.ts, pool.ts, evaluate.ts). Deferred remainder → `render-graph.md`.
