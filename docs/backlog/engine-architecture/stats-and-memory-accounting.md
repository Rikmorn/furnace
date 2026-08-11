# Stats and memory accounting

Tracker for `@furnace/core/stats` — **what it does not measure, and where its numbers are
knowingly wrong**. Each section is one previously standalone entry, keeping its Context,
*Trigger to revisit* and *Reference*.

They are merged because each is a stated limit of the same shipped instrument, and because
a reader who trusts a stats number needs all three caveats together rather than scattered:
there is no GPU-side timing at all, the frame boundary can be marked two ways whose
interaction is unspecified, and `memory.textureBytes` undercounts mipmapped textures by
roughly 33%. The undercount is documented in two live reference docs
(`core-modules.md` §stats and `engine-conventions.md` §Stats caveat), which point here for
the fix shape.

## GPU timing in `stats`

Tracker for the two deferred entries about GPU-side timing in the `stats` module.
Both were filed separately (one from the tranche-5 stats design, one from the cookbook
Task 8 doc pass) but describe the same latent capability: the `snap.gpu.renderMs` /
`snap.gpu.computeMs` slots exist on the public `Snapshot` type and are always `null`
until real WebGPU `timestamp-query` instrumentation lands. They share a revisit trigger
(the first real GPU perf-debugging session), so they are merged here.

### GPU timestamp queries in `stats`

**Status update (tranche 5, 2026-05-24):** `snap.gpu.renderMs` and `snap.gpu.computeMs` slots landed in tranche 5 as `null`. Consumers can pre-bind UI to these paths now; fill in real timestamp-query implementation when triggered.

Per-pass GPU timing (vertex stage ms, fragment stage ms, compute ms per dispatch) via WebGPU's `timestamp-query` feature. Surfaced through `stats.snapshot(ctx).gpu` when the device supports it; `null` otherwise.

Real instrumentation work: managing `GPUQuerySet` allocation per frame, writing timestamps into the encoder around render/compute passes, resolving the query buffer at frame end, reading back asynchronously without stalling the frame (timestamp buffer reads are one or two frames behind, which is fine for stats display).

The `timestamp-query` feature is gated on `device.features.has("timestamp-query")` — supported in Chrome and recent Firefox, may require flags in some browsers. The Tier 1 `stats` design has a `gpu?: { renderMs?, computeMs? }` slot specifically so consumers can pre-bind UI to it even before the real implementation lands.

**Trigger to revisit:** First real perf-debugging session against a workload that's hitting frame-time limits — typically when adding physics, post-effects, or large mesh counts and needing to know whether the bottleneck is on the CPU side, the vertex stage, or the fragment stage.

**Reference:** Core architecture design § "Stats / instrumentation".

### `Snapshot.gpu.renderMs` and `computeMs` are always `null`

`packages/core/src/stats/snapshot.ts` declares `gpu.renderMs: number | null` and `gpu.computeMs: number | null` on the public Snapshot type, but both are always set to `null` in `buildSnapshot()` (lines 36–37). The fields are read by `stats.onFrame` subscribers and exposed in cookbook's stats overlay; consumers see them as permanently absent.

Surfaced during cookbook Task 8 (`docs/reference/core-modules.md`) when documenting the `stats.snapshot` public surface. The doc notes the always-null behaviour so consumers aren't surprised.

**Demos impacted today:**
- Cookbook's `stats-overlay.svelte` (Task 5) doesn't currently render these fields — only `fps / ms / draws / tris / mat / geo / mesh / mem / errors`. So no visible artifact.
- Cookbook's `custom-stats` demo (Task 18) reads via `stats.onFrame` for an fps history graph — also doesn't touch renderMs/computeMs.

**Ideal API shape:** Either (a) implement the timing — wire up `device.queue.onSubmittedWorkDone()` or WebGPU timestamp queries to populate `renderMs`/`computeMs` from real GPU work boundaries — or (b) remove the fields until they can be measured. Option (a) is the better long-term answer; WebGPU timestamp queries land via `timestamp-query` feature opt-in (`requestAdapter({ requiredFeatures: ["timestamp-query"] })`).

**Trigger to revisit:** When GPU perf becomes a debugging concern (e.g. a demo's frame budget is tight and the user wants to see GPU-side vs CPU-side time). Or when adding the timestamp-query feature for any other reason.

**Reference:** `packages/core/src/stats/snapshot.ts:36-37`, `docs/reference/core-modules.md` `@furnace/core/stats` table notes.

## `stats.markFrameBoundary` interaction with `frame.loop`

Tranche 5 exposes `stats.markFrameBoundary(ctx)` as a public manual hook for consumers using `frame.encode` directly without `frame.loop` (the standard path). `frame.loop` calls `_frameStart`/`_frameEnd` internally; a consumer who *also* calls `stats.markFrameBoundary` while using `frame.loop` gets extra boundary signals (double FPS counts, premature per-frame counter resets, etc.).

For tranche 5 there's no real consumer mix doing this, so the behavior is "documented; not engine-enforced." If a real conflict arises, the resolution is either:

1. `frame.loop` sets a flag on `ctx._internal.stats` like `engineOwnsBoundary = true`; manual `markFrameBoundary` calls become silent no-ops when set.
2. `stats.markFrameBoundary` checks `ctx._internal.stats.frameStartTime` and only fires if no start has been recorded since the last boundary.
3. Document explicitly that consumers must choose one or the other.

**Trigger to revisit:** When a real consumer mixes `frame.loop` and manual `stats.markFrameBoundary` and reports confusing metric drift.

**Reference:** Core Tranche 5 (stats expansion) design, §5 + §8.

## `memory.textureBytes` undercounts mipmapped textures by ~33%

*Adjacent finding. Surfaced during Visual Fidelity Stage 1, Task 9 (mipmap generation) code-quality review, 2026-06-05.*

`texture.create` records only the **base-level** byte size into stats
(`_recordAlloc(ctx, "texture", width*height*4)`), even when `mipmaps: true`. A full
mip chain adds the geometric-series tail (~1/3 of the base), so `memory.textureBytes`
undercounts every mipmapped texture by roughly 33%.

This is a deliberate, documented simplification in T9 (`texture.ts` has inline
comments: "mip memory accounting is out of scope"). It does **not** break leak
detection: the recorded `byteLength` is symmetric across create and teardown
(create `+X`, destroy `−X`), so the count and bytes still round-trip to baseline
regardless of whether `X` includes mips. The only impact is that the *absolute*
`memory.textureBytes` figure is lower than the real GPU footprint.

### Fix shape
- When `mipmaps` is on, compute the true footprint = `Σ over levels of (w_i * h_i * 4)`
  where `w_i = max(1, width >> i)`, `h_i = max(1, height >> i)` for `i in 0..levels-1`.
- Store that as the slot's `byteLength` so both the alloc record and the teardown
  destroy record use the same (full) value — keep it symmetric.
- Small, self-contained change in `texture.ts` (and only there). The reason it was
  deferred rather than inline-fixed in T9: it nudges the stats byte-accounting
  contract (what `memory.textureBytes` means for multi-level resources) and wasn't in
  T9's stated scope.

### Trigger to revisit
- When textured scenes ship and `memory.textureBytes` is actually used for VRAM
  budgeting / profiling (the bowling scene in Stage 1 T11 uses mipmapped textures, so
  the number is already slightly off there — but no Stage-1 gate depends on the
  absolute value). OR a stats-accuracy pass.

### Reference
- `packages/core/src/texture/texture.ts` (`createFromData`/`createFromSource`, the
  `byteLength` recording), `packages/core/src/texture/mipmap.ts` (`_mipLevelCount`).
