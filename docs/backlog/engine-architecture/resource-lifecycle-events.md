---
summary: RM-4 rejected a resource-manager-to-stats events channel as speculative scaffolding; an `allocSlot`/`destroySlot` emitter over `@furnace/core/events` is small to build the day an external consumer files a concrete need
---

# Resource lifecycle events — external consumer trigger

*Filed by RM-4 on landing (2026-05-28). RM-4 considered an events-based decoupling between the manager and stats and rejected it as speculative — both modules are internal-to-core, ship in the same package, and evolve together. The "right transport for right consumer" principle (codified in `engine-conventions.md` §"Stats relationship") says events earn their keep only when an external consumer of those events exists.*

## When to revisit

When an external consumer (outside `@furnace/core`) files a concrete need for resource-lifecycle event subscription. Candidates:
- A telemetry exporter that batches resource creation rates for production monitoring
- A devtool plugin subscribing to live resource creation for a UI inspector
- A performance overlay that reacts to allocation bursts (e.g. detects "more than N meshes allocated per frame")
- A profiler integration concrete enough to specify the events it needs

The trigger is "first external consumer with a concrete need," not speculative readiness.

## What to build when triggered

- Manager emits at `allocSlot` / `destroySlot` (the existing single-writer points)
- Events flow through `@furnace/core/events` Emitter primitive (existing substrate)
- Stats stays on its current direct-call path — events are ADDITIVE, not replacement (stats's tight coupling is fine for an internal-to-internal path)
- Event shape probably: `{ kind, op: "alloc" | "destroy", bytes }` — minimal payload, consumer derives what it needs

The events channel is small to build; the work is gated only by knowing what shape the real consumer wants.

## Reference

- `engine-conventions.md` §"Stats relationship" — codified principle
