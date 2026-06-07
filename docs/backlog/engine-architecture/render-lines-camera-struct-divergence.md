# `render-lines.ts` hand-declares a diverged 64-byte `Camera` struct

`packages/core/src/frame/render-lines.ts` contains its own inline WGSL:

```wgsl
struct Camera { viewProjection: mat4x4<f32> };
```

This is a 64-byte struct (one `mat4x4<f32>`), independent of the centralised
`_cameraBinding` fragment in `packages/core/src/shader/preamble.ts`.

In Stage 3 Phase 2 (commit `a257650`), `_cameraBinding` was grown to 80 bytes
(`viewProjection` mat4x4 + `position` vec4) to support Blinn-Phong specular.
`render-lines.ts` was intentionally left unchanged — line overlay shaders don't
need eye world-position — but the result is a silent divergence: the bound
camera buffer (allocated at 80 bytes by `_ensureCameraBuffer`) is now larger
than the 64-byte layout declared in this shader.

This is **harmless today**: WebGPU permits binding a buffer whose byte size
exceeds the layout's `minBindingSize`, so `drawLines` continues to validate and
render correctly. The oversized-binding path is also exercised by
`packages/core/tests/frame/draw-lines.gpu.test.ts`.

The real concern is maintainability: `render-lines.ts` is now a second
hand-rolled Camera struct that won't pick up future `_cameraBinding` extensions
(e.g. if a `view` matrix or more per-frame data is added) without a manual
update, and its divergence from the single source of truth is invisible at a
glance.

## Preferred fix

Replace the inline `struct Camera` declaration in `render-lines.ts` with a
composition of `_cameraBinding`, exactly as the built-in mesh shaders do (e.g.
`UNLIT_SRC` in `packages/core/src/shader/builtins.ts`). The WGSL body already
accesses `camera.viewProjection`, so the change is purely mechanical — rename
and compose.

## Trigger to revisit

- When line overlay shaders need camera world-position (e.g. specular or
  eye-relative line effects) — at that point the composition is a prerequisite,
  not optional cleanup.
- As a low-risk cleanup when next touching `render-lines.ts` for any reason.

## Reference

- Centralised fragment: `packages/core/src/shader/preamble.ts` (`_cameraBinding`)
- Diverged struct: `packages/core/src/frame/render-lines.ts` line 21
- Commit that grew `_cameraBinding` to 80 bytes: `a257650`
  (`feat(camera): grow Camera UBO to { viewProjection, position } for specular [stage-3]`)
