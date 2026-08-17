---
summary: the general immediate-mode gizmo API (`debug.line`/`box`/`sphere`/`axes`) above the shipped `frame.drawLines` plus `physics.getDebugLines` line substrate, and contact/AABB/joint visualization with it
---

# Debug drawing primitives

> **Partially shipped (Stage 4B, 2026-06-04):** the line substrate exists —
> `frame.drawLines` (immediate `line-list` overlay) + `physics.getDebugLines`
> (Rapier collider wireframe pass-through). STILL DEFERRED: the general
> immediate-mode gizmo system (`debug.line/box/sphere/axes` accumulation API),
> non-physics clients (mesh normals, camera frustums, scene-graph axes), and
> contact-point / AABB / joint visualization (furnace's `CollisionEvent` carries
> no contact data; Rapier's `debugRender` default draws collider shapes only).
> **Revisit trigger:** a 2nd+ non-line debug client, OR a need to debug contacts.

Lines, boxes, axes, frustums, arrows — drawn over the rendered scene for diagnostic visualization. Used everywhere in real engines: physics colliders, AI navigation graphs, mesh normals, camera frustums, bone hierarchies, raycast results. Cheap to add once we have one client; useless before then.

Likely a `@furnace/core/debug-draw` module (or `dev/debug-draw`, to signal it's not for production builds). API shape: immediate-mode style (`debug.line(start, end, color)`) accumulated into one batched draw per frame; cleared automatically each frame. Could also support persistent lines (`debug.line(..., { ttlMs: 2000 })`) for diagnostic trails.

Should be tree-shakeable so production builds can drop it; possibly compile-time-gated via a build flag.

**Trigger to revisit:** See the banner's **Revisit trigger** above. The original trigger — physics-collider visualization — fired in Stage 4B (which shipped the line substrate); remaining future needs include scene-graph axes for transform debugging, mesh normals, or another non-line gizmo client.

**Reference:** Core architecture design § "Tier 2 cross-cutting patterns".
