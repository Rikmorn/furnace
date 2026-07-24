# The editor's prop layer rebuilds unconditionally, and re-creates proxy geometry every time

**Context.** `rebuildProps` in `packages/editor/src/viewport-host/field-host.ts` tears the
whole placed-prop layer down and rebuilds it from the op log on every path that could have
changed it — commit, reconfigure apply, ⌘Z/⇧⌘Z, world new/load, `setEntityCatalog`. Two
costs ride along, and they are one fix:

1. **No change detection.** The rebuild runs whether or not any placement op moved. In a
   world with props, undoing an ordinary brush stroke destroys and recreates every
   archetype's geometry and instanced buffers for a step that touched no placement at all.
2. **No geometry cache.** `proxyGeometry` creates a fresh `geometry.cube` / `sphere` /
   `cylinder` per archetype per rebuild, though there are at most THREE distinct primitives
   in the whole system (the three `EntityCollision` kinds), and their sizes are fixed unit
   constants — nothing about them varies per archetype or per record.

Neither is a live problem. Undo is user-paced, the layer is small at F3b scale, and instance
counts are fixed at creation so *some* rebuild is required whenever the record set changes.
The unconditional shape was also the honest first version: it has no cache to invalidate and
no signature to get wrong, which is what a first slice should optimise for.

The fix is one change with two halves: a `Record<ProxyPrimitive, Geometry>` cache created at
`init` and destroyed at `dispose` (the three unit primitives never vary, so they never need
rebuilding), plus a grouping-signature check at the top of `rebuildProps` that returns early
when the per-archetype record set is unchanged. The signature has to cover record CONTENT,
not just counts — a scatter re-cook can return the same number of records at different poses
(`propInstanceCounts` alone would not see that), so it needs the placement op ids, which the
log already carries.

**Trigger to revisit:** before F5 streaming scale (where a world holds far more props than
one region's worth and a full teardown per undo stops being free), OR the first time the
prop layer lands on a per-frame path — e.g. slice-clipping the props
(`field-props-not-slice-clipped.md`), whose most likely implementation rebuilds the layer on
every slice-slider tick, which is a drag, which is a hot path.

**Reference:** `packages/editor/src/viewport-host/field-host.ts` (`rebuildProps`,
`proxyGeometry`, `destroyProps`, and the seven call sites);
`packages/editor/src/viewport-host/field-placements.ts` (`groupPlacements` — the grouping a
signature would be taken over; `PROXY_PRIMITIVE` — the three-primitive ceiling);
`docs/backlog/editor-and-tooling/field-props-not-slice-clipped.md` (the sibling that would
make this a hot path).
