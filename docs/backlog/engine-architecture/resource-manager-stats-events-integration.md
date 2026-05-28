# RM-4: Resource manager → stats integration via events

*Next tranche candidate after RM-3. Captures stated design direction from RM-3 brainstorm (2026-05-28) so the brainstorming session starts from this baseline rather than from scratch.*

## Current state (post RM-3)

Two parallel registries track allocations:
1. **Resource manager** — per-kind pools (Mesh / Material / Geometry / Effect) tracking slot identity, refcount, lifecycle.
2. **Stats** — `_registerResource(ctx, { kind, bytes? })` / `_unregisterResource(ctx, handle)` calls in every resource module, tracking memory bytes + cumulative counters for the FPS overlay.

Every resource module calls BOTH on alloc and teardown. Documented in `docs/reference/engine-conventions.md` §"Resource manager" → "Stats relationship" as "current transitional state."

## Stated direction (from RM-3 brainstorm)

**Single tracking system: stats.** The resource manager's data is internal; it has APIs for other engine systems to hook into but does not need a separate public consumer-facing introspection API. Information the manager knows (live counts, allocations, destructions) should report to stats via events; consumers query stats.

**Mechanism: event dispatcher.** The engine has an event dispatcher (`@furnace/core/events`) for loose coupling. Manager emits resource-lifecycle events; stats subscribes. Resource modules stop calling stats directly for pool-tracked kinds.

## Design questions to settle during RM-4 brainstorm

1. **Event shape.** One event type with `{ kind, op: "alloc" | "destroy", ... }`? Or four event types (`mesh-allocated`, `mesh-destroyed`, etc.)? Or two (`resource-allocated`, `resource-destroyed`)? What metadata do they carry?

2. **Sub-allocations.** Material's `ownedBuffers` (factory-allocated uniform buffers like unlit's color), geometry's vertex/index buffers, depth textures, camera buffers, post intermediates — these are stats-tracked but NOT pool-tracked. Do they keep direct `_registerResource` calls, or also flow through events?

3. **Public `resources.*` API fate.** `summary` / `list` / `snapshot` / `disposeAll` exist today. After events drive stats, do they:
   - Stay as a thin facade over stats?
   - Become engine-internal (drop from public exports)?
   - Get deleted entirely (consumers query stats directly)?
   `disposeAll` is a manager-cascade trigger, not a stats concern — probably stays regardless.

4. **Stats's `ResourceHandle` opaque token.** Currently the manager passes a stats-issued opaque handle back to resource modules so teardown can call `_unregisterResource`. If events carry enough metadata for stats to identify what's being destroyed, the opaque handle could go away. Simplifies the slot shape.

5. **Test rewiring.** ~10 test sites currently check both registries (assert mesh registered in stats; assert mesh in manager pool). After events drive the flow, what's the assertion shape?

## Predecessor

RM-3 lands the substrate: clean slots (no redundant ctx), unified teardown naming, validateEffects parity, ceiling guards, test coverage. RM-4 builds on this clean foundation.

## Trigger to revisit

**When RM-4 brainstorming session opens.** Read this entry first; the brainstorm starts from a stated design rather than blank slate.

**Reference:** RM-3 brainstorm (2026-05-28) surfaced the stats↔manager double-tracking. User's stated preference: single tracking system, manager reports to stats via events. RM-3 ships N3-A docs-only acknowledgment; RM-4 is the architectural realization.
