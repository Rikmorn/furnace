---
summary: `Snapshot.gpu.renderMs` and `computeMs` are declared on the public type and always set to `null` in `buildSnapshot`, so consumers see permanently absent fields — implement the timing or remove them
---

# `Snapshot.gpu.renderMs` and `computeMs` are always `null`

`packages/core/src/stats/snapshot.ts` declares `gpu.renderMs: number | null` and `gpu.computeMs: number | null` on the public Snapshot type, but both are always set to `null` in `buildSnapshot()` (lines 36–37). The fields are read by `stats.onFrame` subscribers and exposed in cookbook's stats overlay; consumers see them as permanently absent.

Surfaced during cookbook Task 8 (`docs/reference/core-modules.md`) when documenting the `stats.snapshot` public surface. The doc notes the always-null behaviour so consumers aren't surprised.

**Demos impacted today:**
- Cookbook's `stats-overlay.svelte` (Task 5) doesn't currently render these fields — only `fps / ms / draws / tris / mat / geo / mesh / mem / errors`. So no visible artifact.
- Cookbook's `custom-stats` demo (Task 18) reads via `stats.onFrame` for an fps history graph — also doesn't touch renderMs/computeMs.

**Ideal API shape:** Either (a) implement the timing — wire up `device.queue.onSubmittedWorkDone()` or WebGPU timestamp queries to populate `renderMs`/`computeMs` from real GPU work boundaries — or (b) remove the fields until they can be measured. Option (a) is the better long-term answer; WebGPU timestamp queries land via `timestamp-query` feature opt-in (`requestAdapter({ requiredFeatures: ["timestamp-query"] })`).

**Trigger to revisit:** When GPU perf becomes a debugging concern (e.g. a demo's frame budget is tight and the user wants to see GPU-side vs CPU-side time). Or when adding the timestamp-query feature for any other reason.

**Reference:** the `renderMs: null` / `computeMs: null` lanes in `buildSnapshot` (`packages/core/src/stats/snapshot.ts`), `docs/reference/core-modules.md` `@furnace/core/stats` table notes.
