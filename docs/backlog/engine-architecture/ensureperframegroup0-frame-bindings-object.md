# `ensurePerFrameGroup0` — fold per-frame bindings into a `FrameBindings` value object

*(Adjacent finding surfaced during Stage 4 / shadows execution.)*

Stage 4 grew `ensurePerFrameGroup0` (`packages/core/src/frame/render.ts`) to **6
params** as the shadow array + sampler bindings were threaded through:

```ts
ensurePerFrameGroup0(ctx, pipeline, cameraBuffer, sceneBuffer, usesScene, usesShadows)
```

The `sceneBuffer` / `usesScene` / `usesShadows` triple is per-frame Scene-side
binding state that has accreted onto the signature one capability at a time
(Scene UBO in Stage 3, shadows in Stage 4). Each new `@group(0)` binding capability
adds another param, and the boolean tail has the same flag-argument smell as
`_createShader`.

The fix is a `FrameBindings` value object grouping the Scene-side per-frame state
(`sceneBuffer`, `usesScene`, `usesShadows`, and the future shadow/cookie bindings),
passed as one argument alongside `ctx` / `pipeline` / `cameraBuffer`. `ensurePerFrameGroup0`
is module-internal, so this is a non-breaking refactor.

**Trigger to revisit:** any further per-frame binding param lands on
`ensurePerFrameGroup0` (e.g. a cookie/projected-texture binding, a per-frame env
map) — introduce the `FrameBindings` object at that point.

**Reference:** `packages/core/src/frame/render.ts` (`ensurePerFrameGroup0`).
