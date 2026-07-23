# Resource-manager follow-ons

Tracker for the two resource-manager (RM) follow-ons both filed by RM-4 on landing
(2026-05-28) and both gated on the same trigger: **the first external consumer
(outside `@furnace/core`) files a concrete need.** One is a lifecycle-events channel
RM-4 rejected as speculative; the other is the `list` / `snapshot` introspection
surface RM-4 deleted for having zero call sites. They are merged because they share
that "external-consumer-with-a-concrete-need, not speculative readiness" trigger and
both restore/add cleanly over the manager's existing internals.

## Resource lifecycle events — external consumer trigger

*Filed by RM-4 on landing (2026-05-28). RM-4 considered an events-based decoupling between the manager and stats and rejected it as speculative — both modules are internal-to-core, ship in the same package, and evolve together. The "right transport for right consumer" principle (codified in `engine-conventions.md` §"Stats relationship") says events earn their keep only when an external consumer of those events exists.*

### When to revisit

When an external consumer (outside `@furnace/core`) files a concrete need for resource-lifecycle event subscription. Candidates:
- A telemetry exporter that batches resource creation rates for production monitoring
- A devtool plugin subscribing to live resource creation for a UI inspector
- A performance overlay that reacts to allocation bursts (e.g. detects "more than N meshes allocated per frame")
- A profiler integration concrete enough to specify the events it needs

The trigger is "first external consumer with a concrete need," not speculative readiness.

### What to build when triggered

- Manager emits at `allocSlot` / `destroySlot` (the existing single-writer points)
- Events flow through `@furnace/core/events` Emitter primitive (existing substrate)
- Stats stays on its current direct-call path — events are ADDITIVE, not replacement (stats's tight coupling is fine for an internal-to-internal path)
- Event shape probably: `{ kind, op: "alloc" | "destroy", bytes }` — minimal payload, consumer derives what it needs

The events channel is small to build; the work is gated only by knowing what shape the real consumer wants.

### Reference

- `engine-conventions.md` §"Stats relationship" — codified principle

## Resources introspection restore — `list` / `snapshot`

*Filed by RM-4 on landing (2026-05-28). RM-4 deleted `resources.list` and `resources.snapshot` from the public surface because zero consumer-package call sites existed (verified during spec phase). The manager retains `_iterateLive` internally; restoration is mechanical when needed.*

### What was deleted

- `resources.summary(ctx) → ResourceSummary` — covered by `stats.snapshot(ctx).resources.*`; not restored even on trigger (use stats).
- `resources.list<H>(ctx, kind) → IterableIterator<H>` — deleted; restorable.
- `resources.snapshot(ctx) → ResourceSnapshot` — deleted; restorable.
- Types: `ResourceSummary`, `ResourceSnapshot`.

### When to revisit

When an external consumer needs live-handle iteration or per-kind handle-array snapshot for:
- A dev-tools panel that lists every live resource by kind
- Custom dispose logic that wants to walk a specific kind before scene transition
- A post-mortem dump tool that needs structured handle arrays

The trigger is "first external consumer files a concrete need," not speculative readiness.

### What to do when triggered

- Re-expose `list` and `snapshot` wrappers in `packages/core/src/resources/index.ts` over the existing `_iterateLive<unknown>(ctx, kind)` internal helper.
- Restore `ResourceSummary` / `ResourceSnapshot` type definitions.
- Add test coverage matching the consumer's use case.

Implementation is ~30 LOC; no design questions.

### Reference

- Deleted code: see git history at the RM-4 deletion commit
