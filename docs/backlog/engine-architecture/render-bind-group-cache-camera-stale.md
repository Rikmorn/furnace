# Render bind-group cache holds stale `cameraBuffer` when camera switches between frames

`packages/core/src/frame/render.ts` caches scene-pass group-0 bind groups in `group0Cache: WeakMap<Mesh, Map<GPURenderPipeline, GPUBindGroup>>` (around line 112). The cache key is `(mesh, pipeline)`. The `cameraBuffer` is captured at bind-group creation time but is **not** part of the key.

`_ensureCameraBuffer(ctx, cam)` allocates one `GPUBuffer` per `(ctx, cam)` pair and writes the current `viewProjection` only for the camera passed in. So when a frame switches to a different camera, only the new camera's buffer is updated each frame — the previous camera's buffer freezes at its last value. Cached bind groups created during the previous camera's frames keep pointing at that frozen buffer.

## Repro (cookbook hello-cube)

Demo creates one perspective + one orthographic camera plus a cube and a backdrop plane, with material/camera switches via the controls panel. The behaviour matrix:

| Camera       | Material      | Observed                                |
| ------------ | ------------- | --------------------------------------- |
| perspective  | unlit         | both rotate                             |
| perspective  | normalColor   | plane rotates, cube doesn't             |
| orthographic | unlit         | neither rotates                         |
| orthographic | normalColor   | cube rotates, plane doesn't             |

Whichever camera was active when `(mesh, pipeline)` was first rendered captures that camera's `GPUBuffer` forever. Mesh appears to "rotate" only when that same camera is active again.

## Likely fix

Add `cameraBuffer` to the cache key. Minimal shape:

```ts
const group0Cache = new WeakMap<
  Mesh,
  Map<GPURenderPipeline, Map<GPUBuffer, GPUBindGroup>>
>();
```

Or: invalidate all cached group-0 bind groups for a mesh when its referenced cameraBuffer changes. The first is simpler and avoids extra plumbing.

This also unblocks correct behaviour for the deferred multi-camera-passes work below — that entry's open design question *"multi-uniform-buffer vs one giant frame uniform with per-pass slices"* assumes the cache layer can already handle multiple buffers, which today it cannot.

## What to verify when fixing

- The cookbook hello-cube matrix above all reads "rotates" after the fix.
- `packages/core/tests/frame/render.gpu.test.ts` gains a case that renders the same mesh with two cameras across two frames and asserts the bind group on frame 2 differs from frame 1 (or at minimum that the rendered output reflects the second camera).
- No regression in single-camera demos — pipeline cache still hits for the common case.

**Trigger to revisit:** Next dedicated bug-fix session, OR before shipping the multi-camera API — whichever comes first.

**Reference:** [`multi-camera-passes.md`](./multi-camera-passes.md) — architectural follow-up that depends on this fix. Bug surfaced live in `packages/cookbook/src/demos/hello-cube/` during a session 2026-05-25.
