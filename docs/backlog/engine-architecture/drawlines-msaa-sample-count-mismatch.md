# drawLines under MSAA — sample-count mismatch

`frame.drawLines` builds its line pipeline single-sample (no `multisample` block,
defaults to `count: 1`) and renders against the engine scene depth texture via
`_ensureDepthTexture`. Under `sampleCount: 4` that depth texture is allocated 4×
(`render.ts` `_ensureDepthTexture` passes `ctx._internal.sampleCount` to
`createTexture`). A single-sample pipeline drawing against a 4× depth attachment
is a WebGPU validation error, so the collider overlay (`debugControls.showColliders`)
breaks whenever MSAA is on.

**Surfaced by:** Stage 2b task 2b-8 (bowling MSAA toggle + HDR post chain). The
bowling demo defaults to MSAA-on; `showColliders` defaults off, so the default
render path is unaffected. The break only manifests when a user turns colliders
ON while MSAA is ON. Flagged for the 2b-11 Safari gate.

**Surfaced again by:** Epic 2 Slice 2.1.1 (traversal foundation). The dungeon —
which uses `gpu.requestContext(..., { sampleCount: 4 })` — added a ground-normal
debug-draw via `drawLines` and it **never rendered**: the single-sample line pass
against the dungeon's 4× scene depth texture is the same validation error as the
bowling collider overlay. The debug-draw was subsequently removed. Before 2.1.1
`drawLines` had only ever been exercised in single-sample contexts (bowling Slice
4B), so the MSAA path stayed latent — confirming this is a real gap whenever a
debug/gizmo overlay is wanted in an MSAA context (the editor viewport is the next
likely caller).

**Note on the color side:** the color attachment is fine. `drawLines` targets the
swap chain (`gpu.getCurrentTextureView`, single-sample, `ctx.format`) with
`loadOp: "load"`, and the post chain's final pass already wrote the tonemapped
LDR image there — so under HDR+post the lines composite correctly on the
swapchain. Only the *depth* attachment sample-count mismatches under MSAA.

**Fix candidates (design decision — pick one):**
1. Give `drawLines` an MSAA variant: when `ctx._internal.sampleCount > 1`, build
   a 4× line pipeline rendering into the MSAA scene color + 4× depth, resolving
   into the swap chain. But by the time `drawLines` runs after a post chain, the
   MSAA scene target has been released back to the pool and the swap chain holds
   the resolved LDR image — there is no MSAA color to load into. So this path
   needs its own MSAA color allocation or a different sequencing.
2. Use a separate single-sample depth texture for the line pass (the lines test
   depth for occlusion against the meshes — but a single-sample depth has no
   relationship to the 4× scene depth, so occlusion would be wrong/absent).
3. Drop the depth test for the line pass under MSAA (lines always-on-top), losing
   collider occlusion behind solid meshes when MSAA is on.
4. Resolve the scene depth to a single-sample texture so the line pass can read
   it (extra resolve cost; depth resolve is not a core WebGPU resolve target).

The clean answer likely couples to the broader debug-draw module
(`debug-drawing-primitives.md`) and/or the render-graph work — `drawLines` is
currently an immediate one-off pass that doesn't participate in the MSAA/HDR
target lifecycle that `frame.render` manages.

**Trigger to revisit:** Safari gate confirms the MSAA+colliders break, OR the
debug-draw module work (`debug-drawing-primitives.md`) is promoted — fold the
MSAA-aware line pass into that design rather than patching `drawLines` in
isolation.

**Reference:** `packages/core/src/frame/render-lines.ts` (pipeline +
`drawLines`), `packages/core/src/frame/render.ts` `_ensureDepthTexture`,
`docs/reference/engine-conventions.md §MSAA` (the multisampled-depth contract),
`packages/hello-world/src/demos/bowling/scene.ts` (`renderFrame` collider overlay).
