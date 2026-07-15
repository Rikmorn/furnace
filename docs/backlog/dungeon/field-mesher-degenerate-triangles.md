# Field mesher emits degenerate triangles on symmetric surfaces

**Context.** `@furnace/core/field`'s chunked Surface Nets mesher (`packages/core/src/field/mesher.ts`, F1 Task 3) uses plain-centroid vertex placement (mean of edge crossings). On surfaces that lie on a symmetry axis under the coarse int8 density (`DENSITY_SCALE = 32`, ~0.25 m cells), coincident cell minimizers produce **zero-area triangles and non-manifold edges** (edge-count histogram shows count-4/6/10 edges, ~60 self-edges on an axis-centered sphere). Independently confirmed at F1 T3 review: the anomaly is present in a **single seamless chunk**, so it is a property of the vertex-placement scheme, NOT the chunk seams (which are watertight — zero count-1 holes verified at the 8-chunk corner). Offsetting the surface off the symmetry axes reduces but does not eliminate it.

**Why it's harmless today.** Zero-area triangles draw nothing; the render mesh is visually watertight in the browser (F1's gate). No action needed for rendering.

**Why it may bite later.** The field→mesh→collide-on-Jolt endgame ([[dungeon-collision-architecture-jolt-proof]]) feeds this mesh (or a derived one) to a physics trimesh. Degenerate triangles and non-manifold edges can destabilize collision-mesh cooking / internal-edge handling. A QEF / dual-contouring vertex solve (or a degenerate-triangle cull pass) would fix both mesh quality and collision robustness.

**Trigger to revisit.** When the field system's collision path moves off per-chunk shell voxels (F1 T6) onto a cooked trimesh — i.e. the Jolt-backend epic, or any slice that collides the field mesh directly.

**Reference.** `packages/core/src/field/mesher.ts`, F1 Task 3 review (2026-07-15), `docs/reference/dungeon-architecture.md` (collision), the Jolt-proof memory.
