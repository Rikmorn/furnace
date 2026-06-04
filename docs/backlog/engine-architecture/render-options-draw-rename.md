# Rename `RenderOptions.draw` → `mesh` / `meshes`

`frame.render({ draw: Mesh[], camera, ... })` names the mesh list `draw` — a
verb used as a noun. The other `RenderOptions` fields (`camera`, `clearColor`,
`clearDepth`, `effects`) are all nouns; `draw` is the odd one out. Surfaced
during Stage 4B naming of `frame.drawLines` (where `draw` is correctly a verb):
the overload is mild but real (`draw` the noun-field vs `draw` the verb; cf.
`stats.recordDraw`).

`mesh`/`meshes` would tie the descriptor's fields together cleanly and free
`draw` for its verb role.

**Why deferred:** it's a breaking change to the `frame.render` contract — every
call site (hello-world, cookbook, tests) and `core-modules.md`/`api-posture.md`
must change atomically. Not worth a contract break on its own.

**Revisit trigger:** the next time a `frame.render` contract break is already
acceptable (e.g. a broader render-API revision), fold this rename in.

**Reference:** `docs/superpowers/specs/2026-06-04-stage-4b-physics-dx-design.md` §13.
