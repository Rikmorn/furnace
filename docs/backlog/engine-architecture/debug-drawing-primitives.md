# Debug drawing primitives

Lines, boxes, axes, frustums, arrows — drawn over the rendered scene for diagnostic visualization. Used everywhere in real engines: physics colliders, AI navigation graphs, mesh normals, camera frustums, bone hierarchies, raycast results. Cheap to add once we have one client; useless before then.

Likely a `@furnace/core/debug-draw` module (or `dev/debug-draw`, to signal it's not for production builds). API shape: immediate-mode style (`debug.line(start, end, color)`) accumulated into one batched draw per frame; cleared automatically each frame. Could also support persistent lines (`debug.line(..., { ttlMs: 2000 })`) for diagnostic trails.

Should be tree-shakeable so production builds can drop it; possibly compile-time-gated via a build flag.

**Trigger to revisit:** When there's something specific to debug-draw — typically when physics colliders arrive (visualize the collision shape) or when scene-graph axes become useful for transform debugging.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Tier 2 cross-cutting patterns".
