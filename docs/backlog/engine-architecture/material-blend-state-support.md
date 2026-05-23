# Material blend state support

`MaterialDescriptor` has no way to opt into alpha blending — `material.ts`'s `buildPipelineDescriptor` always emits `targets: [{ format: ctx.format }]` with no `blend` field, so every pipeline writes opaque. Consequence: any fragment that outputs alpha < 1 still renders opaque, so fades-to-transparent (glow rims, smoke, UI overlays) produce a hard edge against whatever near-black color the shader returns at alpha=0.

Likely shape:
- Add `blend?: GPUBlendState` to `MaterialDescriptor`. Thread into `buildPipelineDescriptor` (target gets `{ format, blend }`) and fold into `hashKey` so blended/opaque variants of the same WGSL don't collide in the pipeline cache.
- Call sites that want transparency pass premultiplied-alpha factors (`one` / `one-minus-src-alpha`) and `depthWrite: false`, and emit `vec4(rgb * a, a)` from the shader.

Open design questions:
- Raw `GPUBlendState` (flexible, per-call-site) vs a curated `transparent?: boolean` shorthand matching the `unlit` / `normalColor` preset idiom. A boolean can't express both premultiplied and straight alpha — would need to pick one canonical default.
- Should opting into blend imply `depthWrite: false`, or stay orthogonal? Today they're independent fields; coupling them is friendlier but more magical.
- Draw-order story for transparent meshes — currently the consumer arranges the `draw:` array manually. Fine for one transparent thing; less fine once there are several. Likely converges with the `draw-sort-by-pipeline.md` entry.

**Trigger to revisit:** Next demo or built-in that needs transparency — glow/halo fading into a backdrop, a fade-out effect, smoke/particles, UI quads over the scene.

**Reference:** [[material-uniform-setters]] (adjacent material API gap), [[draw-sort-by-pipeline]] (transparent draw ordering).
