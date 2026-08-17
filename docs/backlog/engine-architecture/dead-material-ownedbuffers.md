---
summary: `MaterialSlot.ownedBuffers` and its teardown loop have had no writer since `material.unlit` was retired; deleting them turns on whether binding-ownership is the permanent model for material-owned GPU memory
---

# Remove the now-dead `MaterialSlot.ownedBuffers` machinery

**Surfaced 2026-05-31 during Tranche E-B Task 7** (retire `material.unlit`). Captured per the AGENTS.md bulk-work rule (engine-side finding outside the task's literal scope; needs a design call, so backlog rather than silently expand the atomic commit).

## Context

`MaterialSlot` carries `ownedBuffers: GPUBuffer[]` + `ownedBufferBytes: number[]`, and `materialTeardown` (`packages/core/src/material/material.ts`) loops them to `buffer.destroy()` + `_recordDestroy(ctx, "buffer", bytes)`. This existed for **factory-allocated uniform buffers freed by the slot's teardown** — its only writer was `material.unlit`, which pushed its 16-byte colour buffer onto the slot.

E-B retired `material.unlit` (Task 7, commit `7be9e46`). Now **no factory pushes to `ownedBuffers`** — every material slot is constructed with `ownedBuffers: []`, the teardown loop never iterates a non-empty array, and the typed `Binding` path (the binding owns its `GPUBuffer`, `material.destroy` does not free it) permanently obsoletes the mechanism. The raw `bindings: GPUBindGroupEntry[]` path is consumer-owned too — material never owns those buffers either.

The TSDoc on `material.create` was updated in Task 7 to say the machinery is currently unused; the machinery itself was left in place.

## Why deferred (not done inline)

Removing `ownedBuffers`/`ownedBufferBytes` + the teardown loop touches `material.ts` internals + `material/types.ts` (the `MaterialSlot` shape) and may touch material-stats tests that assert the slot shape. That is a structural change with a design question — "is any future material factory ever going to own a buffer the slot must free, or is binding-ownership the permanent model?" — so it warranted a deliberate call rather than expanding the Task 7 atomic commit.

## The design question

Is binding-ownership (`Binding` owns the `@group(1)` buffer; consumer owns raw `bindings` resources) the **permanent** model for material-owned GPU memory, such that a material slot will *never* own a buffer it must free? If yes (likely — the bridge is the SSOT for `@group(1)` data), delete the machinery. If a future built-in factory might allocate+own a buffer, keep it.

## Trigger to revisit

- Next tranche that touches `material/material.ts` or `material/types.ts` internals (fold the removal in), **or**
- A design pass on `MaterialSlot` shape / a `material-stats` test refactor, **or**
- A "dead-code sweep" hygiene tranche.

If kept long-term, the "currently unused" TSDoc note must not rot — re-confirm it each time material.ts is touched.

## Reference

- `packages/core/src/material/material.ts` — `materialTeardown`, the `ownedBuffers`/`ownedBufferBytes` fields, the `create` TSDoc note.
- `packages/core/src/material/types.ts` — `MaterialSlot` shape.
- Tranche E-B Task 7 (commit `7be9e46`) — the deletion that orphaned this.
- `resource-lifetime-ownership-and-tracking.md` §Consumer-owned uniform buffers (sibling — the broader ownership-model question).
