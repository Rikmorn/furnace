# Render-to-texture learnings (May 2026)

*Captured from the UI Foundation milestone — see [`docs/superpowers/specs/2026-05-17-ui-foundation-design.md`](../docs/superpowers/specs/2026-05-17-ui-foundation-design.md) and commit `7249001` (the WGSL UI plane proof, kept in git history; reverted from the working tree).*

## Context

The UI Foundation milestone built a depth-tested WGSL textured-plane primitive (Phase 2) as the path for in-scene UI rendering. The proof worked: per-pixel depth interleave with the triangle, FPS text sourced from a 2D canvas. The architecture was sound.

We then chose a different approach for the common cases (Svelte + screen-space projection — see the BACKLOG entry on the projection helper), keeping the WGSL primitive in mind only for the rare cases where 3D geometry must occlude UI per-pixel. The WGSL code was reverted from the working tree, but the proof and these notes remain so we don't relearn the lessons next time.

## The render-to-texture pipeline (what we built)

1. **CPU rasterization source.** An `HTMLCanvasElement` (NOT `OffscreenCanvas` — see below) at the desired texture resolution. Content painted via the 2D Canvas API (`fillRect`, `fillText`, etc.).
2. **GPU texture.** `device.createTexture({ size, format: "rgba8unorm", usage: TEXTURE_BINDING | COPY_DST })` at the same resolution.
3. **Upload.** On state change: pull pixel data with `ctx.getImageData(0, 0, w, h)` and upload via `device.queue.writeTexture({ texture }, imageData.data, { bytesPerRow: w*4, rowsPerImage: h }, [w, h, 1])`. **Do NOT use `device.queue.copyExternalImageToTexture` — see below.**
4. **Sample.** WGSL fragment binds the texture + a linear sampler, calls `textureSample(tex, samp, uv)`. Quad geometry with UVs (0,0)→(1,1) maps the full texture.

## The bug: `copyExternalImageToTexture` silently no-ops

The WebGPU spec's canonical canvas→texture path is `device.queue.copyExternalImageToTexture`. On macOS (Safari WebGPU + `wry` WebView26 on Tahoe), this API silently no-oped in execution:

- The source canvas painted correctly (verified visually by attaching the canvas to the DOM).
- `update()` was called every tick (verified via `console.log`).
- `copyExternalImageToTexture` did not throw and did not emit any validation error (verified with `pushErrorScope` and by inspecting the console for uncaptured errors).
- The destination GPU texture stayed at zeros — the WGSL fragment sampled (0, 0, 0, 0) every frame, so the plane rendered as fully transparent (visible only by its depth-occlusion of the triangle, not by its own color).

We tried both `OffscreenCanvas` and `HTMLCanvasElement` as source elements; both failed identically. The bug is in `copyExternalImageToTexture` itself in this WebGPU implementation, not in the source-element type.

## The fix: `writeTexture` + `getImageData`

Switching to `device.queue.writeTexture` with raw `ImageData` bytes from `ctx.getImageData(...)` fixed it immediately:

```ts
const imageData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
device.queue.writeTexture(
  { texture },
  imageData.data,
  { bytesPerRow: WIDTH * 4, rowsPerImage: HEIGHT },
  [WIDTH, HEIGHT, 1],
);
```

This path is:

- **Synchronous.** No `await` needed in `update`.
- **CPU↔GPU sync per call.** Slightly slower than a GPU-native `copyExternalImageToTexture` would be — irrelevant at 1Hz, would matter at 60Hz with large textures.
- **Universally supported.** `writeTexture` is the lowest-common-denominator WebGPU upload path; if it doesn't work, nothing will.

Cost in practice: ~4 bytes per pixel × resolution × tick frequency. At 512×128 RGBA8 and 1Hz, ~250KB/s — trivial. At 1024×1024 RGBA8 and 60Hz, ~250MB/s — would need revisiting if it ever became a hot path.

## When to revisit `copyExternalImageToTexture`

Worth re-testing periodically — e.g., when Safari WebGPU promotes from experimental to stable, or when Bun's WebView host bumps a version. If the API starts working reliably, switching back gives marginally better performance for higher-frequency uploads. For 1Hz updates the choice doesn't matter.

## What the WGSL UI primitive proof established

Beyond the texture-upload bug, the broader engineering proved out:

- Depth-tested WGSL pipelines coexist cleanly in a single render pass with the existing triangle pipeline.
- Per-pixel depth interleave works as expected — primitives at different Z values occlude each other correctly without any extra work beyond standard `depthStencil` state and a shared `depthStencilAttachment`.
- Vertex/index buffer + bind-group plumbing for a textured quad is small and self-contained (~80 lines of TS + ~25 lines of WGSL).
- The cost of adding the primitive to the existing render pass was minimal.

When the time comes to revisit (the trigger: "first concrete need for in-scene UI that 3D geometry must occlude per-pixel"), the proof of concept at commit `7249001` is the starting point.

## See also

- Commit `7249001` — the WGSL UI plane proof of concept (preserved in git history, not the working tree).
- Spec: [`docs/superpowers/specs/2026-05-17-ui-foundation-design.md`](../docs/superpowers/specs/2026-05-17-ui-foundation-design.md), particularly the "Research write-up" section.
- BACKLOG entries: "In-scene UI primitive — for occluded cases only (γ)" and "Screen-space projection helper for world-tracked Svelte UI".
