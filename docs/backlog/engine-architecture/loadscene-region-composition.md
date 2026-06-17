# loadScene region composition — streaming many regions into a managed world

Slice 2.1 landed a single `loadScene({ world, fragment: true })` seam: one world is
created by the game loop, and one region fragment is loaded into it. This is sufficient
for a single baked room dropped into a live world.

What is **not** there yet:

- **Multi-region composition**: loading N baked region scenes into one managed world
  with a shared camera, streaming in as the player moves, streaming out (and freeing
  GPU / physics resources) when far away.
- **A managed-world abstraction**: something that owns the live `World`, the set of
  currently-loaded region `LoadedScene`s, the spatial index that decides which regions
  are in range, and the stream-in / stream-out policy.
- **Streaming lifecycle**: load → active → queued-for-unload → unload, with the destroy
  handshake (a `LoadedScene.destroy()` removes its bodies from the injected world and
  frees its GPU geometry).
- **Concurrent loading**: `loadScene` is `async` (fetches `.fmesh` + decodes); multiple
  regions should be able to load in parallel without blocking the game loop.

The current single-seam design is intentionally minimal (Slice 2.1 scope was
"prove the round-trip"). The multi-region model is the foundation for Epic 3's "C"
deliverable (open-world streaming / dungeon room generation on demand).

**Trigger to revisit:** Epic 3 "C" — the moment the dungeon needs more than one
generated region active simultaneously, or needs to stream regions in/out as the
player traverses.

**Reference:** Slice 2.1 `loadScene` implementation (`packages/core/src/scene/loader.ts`
— `LoadSceneOptions.world` + `fragment` mode). Epic 3 design notes (memory
`project_dungeon_epic2_procgen.md`, the slice ladder beyond 2.1).
