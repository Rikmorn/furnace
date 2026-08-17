---
summary: no cookbook page teaches the `@furnace/core/log` sink or the typed GPU diagnostic emitters (`onUncapturedError`, `onDeviceLost`); Tranche C shipped both and deferred the demo to stay bounded
---

# Cookbook demo for diagnostics (log sink + GPU emitters)

Tranche C shipped `@furnace/core/log` (formal sink) and the typed GPU diagnostic emitters (`onUncapturedError`, `onDeviceLost`) but explicitly deferred the cookbook demo to keep the Tranche C scope bounded. The cookbook convention is "every public surface demoed" — this is a debt entry.

**Shape (sketch):** a single-page cookbook demo that:

1. Installs a custom log sink that appends formatted entries to a DOM overlay (`<pre>` element scrolling), alongside the default `consoleSink` for DevTools visibility.
2. Subscribes to `gpu.onUncapturedError(ctx, fn)` and `gpu.onDeviceLost(ctx, fn)` and writes the events into the same overlay.
3. Includes a button that deliberately triggers an uncaptured error (e.g. by creating an invalid pipeline) so the user can see the diagnostic appear in real time.
4. Teaches the sink-composition pattern (`setSink(e => { consoleSink(e); domSink(e); })`).

**Trigger to revisit:** Next cookbook session, OR when a consumer (outside hello-world) asks how to integrate furnace diagnostics with their telemetry. Whichever comes first.

**Reference:** `packages/cookbook/src/post/` is the closest existing demo shape (single-page setup + dispose); the diagnostics demo can borrow the page structure. Sibling debt against the same one-demo-per-Tier-1-feature convention: `docs/backlog/engine-architecture/tier-1-names-with-no-demo-decision.md` and `docs/backlog/engine-architecture/cookbook-normalcolor-to-lit-sweep.md`.
