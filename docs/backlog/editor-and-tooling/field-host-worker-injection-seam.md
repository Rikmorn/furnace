# FieldHost's worker seam exists now — what host coverage still cannot reach is a stamp session

**Status: mostly CLOSED by F3b Task 12.** `createFieldHost({ spawnWorker })` now takes the
seam (`packages/editor/src/viewport-host/field-host.ts`), threaded into
`FieldWorkerClient`'s existing `spawn` argument, and
`packages/editor/tests/field-host-void-cast.gpu.test.ts` uses it to drive the whole loop —
request → the real protocol handler in-process → response → `applyVoidCast` against a
bun-webgpu device. Now pinned: the request the host BUILDS (chunk set, cellSize), the
density COPY contract (the fake worker detaches transferred buffers exactly as a real one
does, so sending the store's live buffers fails the next cast), the response path, the
in-flight refusal, and the empty-dirty-set guard that spec review found missing.

Two corrections to what this entry first claimed, both worth remembering:

- **DI was never the whole answer.** `requestVoidCast` returns at its `!ctx` guard BEFORE
  it sends anything, so the binding constraint on host-side coverage is the **GPU
  context** — and that harness already existed (`core/tests/_helpers/gpu-fixture.ts` +
  `installMockResizeObserver` + rAF/canvas shims), already used by the sibling
  `preview-host.gpu.test.ts` in the same directory. The first revision of this entry
  blamed the seam for an uncovered `markDirtyWithNeighbors` guard; wrong diagnosis, and
  that guard is now covered.
- **What forced the seam anyway** was process hygiene, not observability: a real `Worker`
  for the browser's `/field-worker.js` never settles under `bun test`, and **terminating
  one panics the Bun runtime**, so `host.dispose()` in a GPU test crashed the process until
  the worker was injected.

**What is still out of reach.** Anything behind a stamp SESSION: `startStamp` needs a
selection, which needs pointer gestures on a canvas whose listeners the GPU fixture stubs
out. So `commitStamp`, `applyReconfigure`, and the preview coalescer's latch remain gated
on review plus the Safari gate — and with them the one void-cast case a test still cannot
reach: a cast surviving a REAL scatter commit, rather than the empty-dirty-set entry point
(`undo` with nothing to undo) that stands in for it today.

**Trigger to revisit:** the first task that needs to assert on a stamp session end to end.
That needs synthetic pointer events or a host-level gesture seam — a bigger design call
than this one turned out to be.

**Reference:** `packages/editor/tests/field-host-void-cast.gpu.test.ts` (the harness, and
its comments on why the worker is injected); `packages/editor/src/viewport-host/field-host.ts`
(`createFieldHost`'s `deps` parameter); `packages/editor/tests/preview-host.gpu.test.ts`
(prior art for the GPU fixture).
