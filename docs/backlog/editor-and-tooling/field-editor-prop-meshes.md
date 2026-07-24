# Editor props render as collision PROXIES, not the archetype's actual meshes

**Context.** F3b Task 10 gave the field editor its placed-prop layer: after a scatter
commits, `FieldHost` rebuilds one instanced draw per archetype from the op log's
`PlacementOp` records (`rebuildProps` → `groupPlacements` → `packPlacementMatrices`). What
each instance DRAWS is a unit primitive sized from the catalog's **collision** block — a
cube for `box`, a sphere for `sphere`, a cylinder for `capsule` — tinted with the
archetype's `material.litColor`. The stamp ghost does the same thing in wireframe.

The dungeon does not: its field-world loader fetches each archetype's `.fmesh` variants
and instances the real geometry (`buildArchetypeGroups` in `packages/dungeon/src/field-world.ts`).
So the editor shows you correct COUNT, POSE, SCALE and rough VOLUME of every prop, but not
its silhouette — a stalagmite reads as a capped cylinder, a rock as a box.

That was the honest v0 call rather than an oversight: mesh-accurate props need a `.fmesh`
fetch + decode path inside the editor (the chrome cannot value-import core, and the host
has no asset transport of its own today — the material and entity catalogs both arrive as
parsed JSON from a chrome-side `fetch`), a per-(archetype, variant) geometry cache with a
teardown story, and a decision about what happens when a variant mesh 404s mid-session.
Proxies cost none of that and are never WRONG about the thing the editor is actually for
at this stage: where the props are and whether they collide with the walk-gate.

Note the shading constraint any replacement inherits: the prop layer shares the kit's
`litInstanced` material, whose no-inverse-transpose normal shortcut survives the proxies'
non-uniform scale only because each primitive's normals are eigenvectors of its scale (see
`proxyRecords`' TSDoc). An arbitrary `.fmesh` under a non-uniform scale would skew normals
with no test to catch it — real meshes must either keep uniform scale or get a material
that supplies proper normals.

**Trigger to revisit:** the F4 "seeing & the cockpit pass" (where prop appearance is the
point), OR the first time a silhouette mismatch actually misleads a placement decision —
e.g. props read as well-spaced in the editor and visibly interpenetrate in the game.

**Reference:** `packages/editor/src/viewport-host/field-placements.ts` (the proxy
mapping + the shading constraint); `packages/editor/src/viewport-host/field-host.ts`
(`rebuildProps`, `proxyGeometry`); `packages/editor/src/frontend/lib/catalog.ts`
(`parseEntityCatalog` — deliberately does not carry the catalog's `meshes` paths);
`packages/dungeon/src/field-world.ts` (`buildArchetypeGroups` — the mesh-accurate loader
this would converge on); `docs/reference/dungeon-architecture.md` (the placement artifact).
