# Topology-aware triangle count for stats

Tranche 5's `Geometry.triangleCount` is computed at `createGeometry` time as `(indexCount || vertexCount) / 3`. That formula is correct for `triangle-list` topology, which all tranche-5 materials use. For other topologies, the formula is wrong:

- `triangle-strip` / `triangle-fan`: `indexCount - 2`
- `line-list` / `line-strip` / `point-list`: not triangles at all — should report 0 triangles or surface as a different metric

The fix: re-derive triangle count inside `frame.render` based on `mesh.material.topology` (not on geometry), since topology lives on material. The Geometry's `triangleCount` field then becomes either a default (triangle-list assumption) or just `primitiveCount` (count of primitives regardless of kind, with the caller mapping to triangles via topology).

**Trigger to revisit:** First non-triangle-list material added to core, or first consumer hitting confusing `gpu.triangles` numbers because their material is a strip.

**Reference:** `docs/superpowers/specs/2026-05-24-core-tranche-5-stats-expansion-design.md` § Section 6 — "Per-mesh triangle count".
