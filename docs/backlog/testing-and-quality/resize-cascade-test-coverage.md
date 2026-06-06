# Resize + cascade interaction has no regression test

Tranche B's cascade callbacks for `frame.render`'s depth texture and `post.intermediate`'s ping-pong textures both read the *current* per-ctx entry at dispose time, not a closure-captured entry from first allocation. This is correct — the reallocation path inside each `_ensure*` function destroys the previous entry inline, so the cascade only ever sees the live entry.

Verified by code inspection of:

- `packages/core/src/frame/render.ts` — `_disposeDepth(ctx)` calls `depthByCtx.get(ctx)` at cascade time; `_ensureDepthTexture` registers `_onDispose(ctx, () => _disposeDepth(ctx))` only on first allocation (guarded by `existing === undefined`).
- `packages/core/src/post/pool.ts` — the live post-side ctx-bound state since the A/B intermediate allocator was removed (2026-06-06). `_disposePool(ctx)` reads `poolByCtx.get(ctx)` at cascade time; `ensurePool` registers `_onDispose(ctx, () => _disposePool(ctx))` only on first touch (same once-registered guard). Resize mechanics differ from the depth texture: rather than reallocate-on-ensure, `_poolBeginFrame` destroys the stale free list at the next frame boundary when the canvas size changes, so a resize-between-renders-then-dispose test would exercise trim + dispose here.

But there's no regression test for the specific scenario "canvas resizes between renders, then dispose". The scenario exercises:

1. First render → cascade callback registered, depth/intermediate entry A created.
2. Canvas resizes → next render reallocates → entry A destroyed inline, entry B created.
3. Dispose → cascade callback fires, reads B from the WeakMap, destroys B.

If a future refactor accidentally captured entry A in the cascade closure (e.g. `_onDispose(ctx, () => destroyEntry(ctx, entry))` instead of `_onDispose(ctx, () => _disposeDepth(ctx))`), the cascade would double-destroy A (already destroyed) and leak B. No existing test catches this.

**Proposed test shape** (lives in `packages/core/tests/stats/resource-leak-warning.gpu.test.ts` or a new `frame-render-resize-dispose.gpu.test.ts`):

```ts
test.skipIf(!bunWebGpuAvailable())(
  "gpu.dispose: no leak warn after canvas resize between renders",
  async () => {
    const canvas = await makeOffscreenCanvas(640, 480);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    // ... setup mesh + cam + first render ...
    frame.render(ctx, { draw: [m], camera: cam });

    // Simulate resize: the engine sizes canvas.width/height from clientWidth/clientHeight
    // and the bun-webgpu mock honors these. Bump them, then fire `gpu.onResize`
    // (or rely on the next render's _ensureDepthTexture size-check to reallocate).
    canvas.width = 1280;
    canvas.height = 960;
    frame.render(ctx, { draw: [m], camera: cam });

    mesh.destroy(m); /* ... destroy others ... */
    const entries = captureSink(() => gpu.dispose(ctx));
    expect(entries.length).toBe(0);
  },
);
```

The fixture work to simulate resize under `bun-webgpu` may be non-trivial (the mock's `getCurrentTexture` is wired to the canvas dimensions at config time). If the fixture cost is high, a unit test that directly invokes `_ensureDepthTexture` twice with different `ctx.canvas.width` is a cheaper proxy.

**Risk level:** Low. The current implementation is correct and the cascade pattern is shared across both modules, so a regression would have to break both call sites identically. But the post effects ping-pong test added in Tranche B does NOT exercise this path (it doesn't resize). Worth a regression guard.

**Trigger to revisit:** next time we touch the resize path (e.g. when consumer-facing camera resize ergonomics get a second pass, or `engine-cascade-teardown` re-emerges with new ctx-bound state). Also worth lifting if a real bug ever exposes the gap.

**Reference:** surfaced during Tranche B final review (2026-05-27).
