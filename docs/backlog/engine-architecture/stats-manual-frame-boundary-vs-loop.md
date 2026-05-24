# `stats.frameBoundary` interaction with `frame.loop`

Tranche 5 exposes `stats.frameBoundary(ctx)` as a public manual hook for consumers using `frame.encode` directly without `frame.loop` (the standard path). `frame.loop` calls `_frameStart`/`_frameEnd` internally; a consumer who *also* calls `stats.frameBoundary` while using `frame.loop` gets extra boundary signals (double FPS counts, premature per-frame counter resets, etc.).

For tranche 5 there's no real consumer mix doing this, so the behavior is "documented; not engine-enforced." If a real conflict arises, the resolution is either:

1. `frame.loop` sets a flag on `ctx._internal.stats` like `engineOwnsBoundary = true`; manual `frameBoundary` calls become silent no-ops when set.
2. `stats.frameBoundary` checks `ctx._internal.stats.frameStartTime` and only fires if no start has been recorded since the last boundary.
3. Document explicitly that consumers must choose one or the other.

**Trigger to revisit:** When a real consumer mixes `frame.loop` and manual `stats.frameBoundary` and reports confusing metric drift.

**Reference:** `docs/superpowers/specs/2026-05-24-core-tranche-5-stats-expansion-design.md` § Section 5 + § Section 8.
