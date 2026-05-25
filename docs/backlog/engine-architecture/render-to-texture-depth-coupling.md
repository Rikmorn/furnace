# `frame.renderToTexture` silently fails when `depthTexture` is omitted with depth-declaring materials

`packages/core/src/frame/render-to-texture.ts` types `depthTexture?: GPUTexture` as optional. `docs/reference/core-modules.md` line 80 reinforces this: `"depthTexture is optional — omit to skip depth."`

The framing is misleading. All standard materials shipped by `@furnace/core` (`material.normalColor`, `material.unlit`) build their pipelines with a `depthStencil` block (`material/material.ts:80-84`). WebGPU requires a render pass have a `depthStencilAttachment` whenever the bound pipeline declares depth-stencil state. Omitting `depthTexture` therefore causes the entire render pass to fail validation **silently** at submit time — the color texture is never written and consumers see the previous frame's contents (a "frozen" output).

Note: `packages/core/src/post/` already builds its fullscreen-quad pipelines without `depthStencil` — that path works because both the pipeline and the pass agree to skip depth. The issue is only with the `material.create` path, which always declares depth.

## Fix

Add a `depthEnabled?: boolean = true` field to `MaterialDescriptor`. When `false`, `material.create` omits the `depthStencil` block from the pipeline descriptor entirely. Bubble the new option through `UnlitOptions` and `NormalColorOptions`. `frame.renderToTexture` and `frame.render` validate that the pass's depth-attachment presence matches the bound pipeline's depth-stencil declaration; throw on mismatch.

Existing `depthWrite` / `depthCompare` fields stay as shortcuts for the depth-enabled case (no migration). Setting `depthEnabled: false` makes those fields ignored (their values cease to matter when no depth-stencil block is built).

This enables genuine depth-less rendering for custom materials (2D overlays, sprites, screen-space effects, gizmos that today fake it via `depthCompare: "always"` + `depthWrite: false` because they have to declare depth) and resolves the silent-failure mode by failing loudly at the validation level.

## What to verify when fixing

- `material.unlit({ color, depthEnabled: false })` builds a pipeline without depthStencil; its `Material.depthEnabled === false`.
- `frame.renderToTexture` with `depthTexture: undefined` throws when any drawn material has `depthEnabled === true`.
- `frame.render` (which always allocates a depth attachment) works for both `depthEnabled: true` and `depthEnabled: false` materials in the same draw list — WebGPU permits a depth-enabled pass to bind a depth-less pipeline.
- The existing `material.normalColor(ctx)` and `material.unlit(ctx, { color })` defaults (no `depthEnabled` passed) behave exactly as today: `depthEnabled` defaults to `true`, materials still declare depth, `renderToTexture` still requires a `depthTexture`.
- `docs/reference/core-modules.md` updated: `depthTexture is optional — omit only if every drawn material was created with depthEnabled: false`.

**Trigger to revisit:** Next engine hardening session, OR before a consumer needs genuine depth-less off-screen rendering.

**Reference:** Surfaced in cookbook/render-target session 2026-05-25 while attempting a `pipDepth` toggle. The toggle was dropped from that demo because the engine surface couldn't deliver the intended lesson.
