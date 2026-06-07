# Lit off-screen passes — `renderToTexture` writes a default (ambient-only) Scene

`renderToTexture` takes no `lights`/`ambient` params. To keep lit materials
*validating* in an off-screen pass (their pipelines bind `@group(0)`'s Scene UBO
when `usesScene` is set), it writes a **default Scene** —
`_writeSceneBuffer(ctx, undefined, undefined)` — which packs the engine's neutral
ambient and **zero lights** (see `packages/core/src/frame/render-to-texture.ts`,
the call near the comment "Off-screen passes carry no lights param"). So a lit
material drawn off-screen renders **ambient-only**: it draws correctly (no
validation failure, no frozen frame) but receives none of the on-screen frame's
lights.

This is deliberate for Stage 3 Phase 2 — the only current `renderToTexture`
consumers are unlit/textured compositing paths, where ambient-only lit draws are
acceptable and the alternative (plumbing a lights param through the off-screen
API) is unused surface. The moment a consumer wants a *lit* off-screen pass —
planar reflections of a lit scene, a lit render-to-texture for a mirror/portal,
a lit thumbnail bake — they need the on-screen lights (or their own light set)
to reach the off-screen Scene UBO.

**Trigger to revisit:** a consumer needs lit off-screen passes (planar
reflections, lit RTT, lit portals) — add a `lights`/`ambient` param to
`RenderToTextureOptions` and thread it into `_writeSceneBuffer` (the
machinery already exists; `render` does exactly this with `opts.lights`).

**Reference:** `packages/core/src/frame/render-to-texture.ts` (the
`_writeSceneBuffer(ctx, undefined, undefined)` default-scene call);
`packages/core/src/frame/render.ts` (`_writeSceneBuffer(ctx, opts.lights,
opts.ambient)` — the lit on-screen path this would mirror).
