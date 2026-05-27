# Cookbook render-target demo — gizmoGeom never destroyed

The render-target demo (`packages/cookbook/src/demos/render-target/entry.ts`) allocates an explicit-flow geometry for the orientation gizmo (`const gizmoGeom = mesh.createGeometry(ctx, ...)` around line 270), binds it via `mesh.create({ geometry: gizmoGeom, ... })`, and stores the resulting `gizmoMesh` in `SceneRef`. The geometry handle itself is never stored in `SceneRef`, never destroyed in `disposeScene`, and never guarded in the `buildScene` try/catch arm. It leaks 3 GPU resources on dispose (vertex buffer + index buffer + geometry handle).

Surfaced during Tranche B-1 (2026-05-27) by the code-quality reviewer for Task 6 (render-target migration). Not in B-1 scope — B-1 deletes `mesh.cube` / `mesh.plane` factories and migrates the cube/plane call sites; `gizmoGeom` already used the explicit flow but was missing its own cleanup. Tranche B-1's manual smoke test for the render-target demo will fire `[furnace/gpu] context disposed with resources still registered — leak suspected { remaining: 3 }` on tab close until this is fixed.

## Fix

Add `gizmoGeom: Geometry` to `SceneRef` (alongside `subjectGeo` / `roomGeo` / `monitorGeo`). Lift `const gizmoGeom = mesh.createGeometry(...)` from a `const` inside the construction block to a `let gizmoGeo: Geometry | undefined` declaration alongside the other geometry variables. Carry it through the `return` block. Add `if (gizmoGeo) mesh.destroyGeometry(gizmoGeo);` to the catch arm and `mesh.destroyGeometry(s.gizmoGeo);` to `disposeScene` (same cleanup-order convention: mesh → geometry → material). The fix is mechanical and follows the exact pattern B-1's Task 6 already applied to the other three geometries — it just wasn't in B-1's scope because the spec only listed the `mesh.cube` / `mesh.plane` call sites.

## What to verify when fixing

- `bun run dev:web` → render-target demo → close tab → no leak-suspected warn.
- The fix doesn't touch the gizmo rendering or position-setting code (lines around 423, 427, 535).
- `bun run check && bun run typecheck && bun test` clean.

**Trigger to revisit:** Next session that touches the render-target demo, OR when the Tranche B-1 final verification surfaces the warn as expected.

**Reference:**
- `docs/superpowers/specs/2026-05-27-tranche-b1-mesh-factory-geometry-ownership-design.md` — sibling tranche that fixed the same shape of leak in 7 demos but didn't cover the gizmo allocation.
- `docs/reference/engine-conventions.md` §Resource ownership (added in Tranche B-1) — the rule this fix follows.
