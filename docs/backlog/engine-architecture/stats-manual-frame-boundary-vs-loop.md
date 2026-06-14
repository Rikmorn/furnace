# `stats.markFrameBoundary` interaction with `frame.loop`

Tranche 5 exposes `stats.markFrameBoundary(ctx)` as a public manual hook for consumers using `frame.encode` directly without `frame.loop` (the standard path). `frame.loop` calls `_frameStart`/`_frameEnd` internally; a consumer who *also* calls `stats.markFrameBoundary` while using `frame.loop` gets extra boundary signals (double FPS counts, premature per-frame counter resets, etc.).

For tranche 5 there's no real consumer mix doing this, so the behavior is "documented; not engine-enforced." If a real conflict arises, the resolution is either:

1. `frame.loop` sets a flag on `ctx._internal.stats` like `engineOwnsBoundary = true`; manual `markFrameBoundary` calls become silent no-ops when set.
2. `stats.markFrameBoundary` checks `ctx._internal.stats.frameStartTime` and only fires if no start has been recorded since the last boundary.
3. Document explicitly that consumers must choose one or the other.

**Trigger to revisit:** When a real consumer mixes `frame.loop` and manual `stats.markFrameBoundary` and reports confusing metric drift.

**Reference:** Core Tranche 5 (stats expansion) design, §5 + §8.
