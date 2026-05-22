# GPU timestamp queries in `stats`

Per-pass GPU timing (vertex stage ms, fragment stage ms, compute ms per dispatch) via WebGPU's `timestamp-query` feature. Surfaced through `stats.snapshot(ctx).gpu` when the device supports it; `null` otherwise.

Real instrumentation work: managing `GPUQuerySet` allocation per frame, writing timestamps into the encoder around render/compute passes, resolving the query buffer at frame end, reading back asynchronously without stalling the frame (timestamp buffer reads are one or two frames behind, which is fine for stats display).

The `timestamp-query` feature is gated on `device.features.has("timestamp-query")` — supported in Chrome and recent Firefox, may require flags in some browsers. The Tier 1 `stats` design has a `gpu?: { renderMs?, computeMs? }` slot specifically so consumers can pre-bind UI to it even before the real implementation lands.

**Trigger to revisit:** First real perf-debugging session against a workload that's hitting frame-time limits — typically when adding physics, post-effects, or large mesh counts and needing to know whether the bottleneck is on the CPU side, the vertex stage, or the fragment stage.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Stats / instrumentation".
