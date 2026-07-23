# GPU timing in `stats`

Tracker for the two deferred entries about GPU-side timing in the `stats` module.
Both were filed separately (one from the tranche-5 stats design, one from the cookbook
Task 8 doc pass) but describe the same latent capability: the `snap.gpu.renderMs` /
`snap.gpu.computeMs` slots exist on the public `Snapshot` type and are always `null`
until real WebGPU `timestamp-query` instrumentation lands. They share a revisit trigger
(the first real GPU perf-debugging session), so they are merged here.

## GPU timestamp queries in `stats`

**Status update (tranche 5, 2026-05-24):** `snap.gpu.renderMs` and `snap.gpu.computeMs` slots landed in tranche 5 as `null`. Consumers can pre-bind UI to these paths now; fill in real timestamp-query implementation when triggered.

Per-pass GPU timing (vertex stage ms, fragment stage ms, compute ms per dispatch) via WebGPU's `timestamp-query` feature. Surfaced through `stats.snapshot(ctx).gpu` when the device supports it; `null` otherwise.

Real instrumentation work: managing `GPUQuerySet` allocation per frame, writing timestamps into the encoder around render/compute passes, resolving the query buffer at frame end, reading back asynchronously without stalling the frame (timestamp buffer reads are one or two frames behind, which is fine for stats display).

The `timestamp-query` feature is gated on `device.features.has("timestamp-query")` — supported in Chrome and recent Firefox, may require flags in some browsers. The Tier 1 `stats` design has a `gpu?: { renderMs?, computeMs? }` slot specifically so consumers can pre-bind UI to it even before the real implementation lands.

**Trigger to revisit:** First real perf-debugging session against a workload that's hitting frame-time limits — typically when adding physics, post-effects, or large mesh counts and needing to know whether the bottleneck is on the CPU side, the vertex stage, or the fragment stage.

**Reference:** Core architecture design § "Stats / instrumentation".

## `Snapshot.gpu.renderMs` and `computeMs` are always `null`

`packages/core/src/stats/snapshot.ts` declares `gpu.renderMs: number | null` and `gpu.computeMs: number | null` on the public Snapshot type, but both are always set to `null` in `buildSnapshot()` (lines 36–37). The fields are read by `stats.onFrame` subscribers and exposed in cookbook's stats overlay; consumers see them as permanently absent.

Surfaced during cookbook Task 8 (`docs/reference/core-modules.md`) when documenting the `stats.snapshot` public surface. The doc notes the always-null behaviour so consumers aren't surprised.

**Demos impacted today:**
- Cookbook's `stats-overlay.svelte` (Task 5) doesn't currently render these fields — only `fps / ms / draws / tris / mat / geo / mesh / mem / errors`. So no visible artifact.
- Cookbook's `custom-stats` demo (Task 18) reads via `stats.onFrame` for an fps history graph — also doesn't touch renderMs/computeMs.

**Ideal API shape:** Either (a) implement the timing — wire up `device.queue.onSubmittedWorkDone()` or WebGPU timestamp queries to populate `renderMs`/`computeMs` from real GPU work boundaries — or (b) remove the fields until they can be measured. Option (a) is the better long-term answer; WebGPU timestamp queries land via `timestamp-query` feature opt-in (`requestAdapter({ requiredFeatures: ["timestamp-query"] })`).

**Trigger to revisit:** When GPU perf becomes a debugging concern (e.g. a demo's frame budget is tight and the user wants to see GPU-side vs CPU-side time). Or when adding the timestamp-query feature for any other reason.

**Reference:** `packages/core/src/stats/snapshot.ts:36-37`, `docs/reference/core-modules.md` `@furnace/core/stats` table notes.
