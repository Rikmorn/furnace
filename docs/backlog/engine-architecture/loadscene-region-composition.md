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
"prove the round-trip"). The multi-region model is the foundation for the streaming
deliverable — **Epic 4** after the 2026-07-06 renumber (the old "Epic 3 'C'":
open-world streaming / dungeon room generation on demand). Note Epic 3 (Generation
Cockpit) may fire the trigger earlier: Slice 3.3's generator entities expand baked
sockets at load, and a world with several baked+socket regions active approaches
the multi-region case.

**Trigger to revisit:** the moment the dungeon needs more than one generated region
active simultaneously (possibly Epic 3.3), or needs to stream regions in/out as the
player traverses (Epic 4).

**Reference:** Slice 2.1 `loadScene` implementation (`packages/core/src/scene/loader.ts`
— `LoadSceneOptions.world` + `fragment` mode). Epic ladder: AGENTS.md `packages/dungeon`
bullet (Epic 2 seal + Epic 3 opening).
