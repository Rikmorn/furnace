# @furnace/dungeon

The first-person dungeon-crawler demo — the engine's go-forward consumer app. Vision: an atmospheric, eventually LLM-streamed crawler (see the project memory `project_dungeon_crawler_vision`).

Browser-first; imports core via the workspace symlink; owns `index.html` + `serve.ts`.

**Canonical as-built architecture: `docs/reference/dungeon-architecture.md`** — game loop, traversal/collision, the generator library, the world/bake/load pipeline, invariants, testing posture. Chronological slice seals: `docs/learnings/seal-log.md`. This README carries the package's current-state summary; when a slice seals, update HERE (and the reference docs) — never AGENTS.md.

## Commands (from the repo root)

- `bun run dungeon:dev` — the game in the browser
- `bun run dungeon:editor` — open the editor on the dungeon (or `bun run edit` inside the package)
- `bun test packages/dungeon` — package tests (`.gpu.test.ts` files run real WebGPU via bun-webgpu)

## Current state (Epic 3 · One Field F3a — SEALED 2026-07-23)

Epics 1–2 CLOSED; 3.3 Worlds SEALED 2026-07-13 (W3 met the phase bar, W4 swept the mesh era out). The 3.4+ **recharter is DONE**: the **One Field phase** (charter 2026-07-14; F0–F6) makes the world ONE sparse chunked voxel field in `@furnace/core/field` with everything else as entities. **F0** (hybrid walkability-analyzer corpus probe — zero misses, but the analyzer cannot self-certify F4; surfaced + led to fixing a shipped mover levitation bug), **F1** ("the medium": dig in the editor's Field panel → bake → the game walks the v2 field world), **F2a** ("the material field": per-cell material classes, dig/fill/paint, the kit skinner + collar on the one field — charter premise P4 proven headless — with the dungeon shipping `catalog/materials.json` and walking material'd worlds with instanced kit), **F2b** ("the palette": chassis/masks/smooth/hollow, selection, hall+maze stamps as the first generator entities, layers/slice) and **F3a** ("smart objects": reconfigure/freeze/bake on committed generators, patch op + compaction, stamp rotation + door offsets — core+editor only, dungeon byte-untouched) are sealed and merged. As-built: `docs/reference/dungeon-architecture.md` §7. Next: F3b "the cave & the entities" (the dungeon re-enters: catalog entity half, placement artifact, prop meshes + colliders).

- **The game boots the baked default WORLD** — since W3 the PHASE-GATE world: pillar hall ↔ stair corridor (+1.5 m) ↔ maze; maze ↔ aperture ↔ box room; maze ↔ collar-bore ↔ cave. `world-loader.ts` reads `worlds/index.json` (the World panel's bake can retarget it) → the world's manifest → ONE merged `world.scene.json`, re-expands proxies/dressing deterministically AND the whole grid class (halls/mazes/corridors re-expand render + collision at load via `expandGridRegion`, dispatched by algorithm — zero baked sidecars), spawns at the manifest `playerStart` (setup-loud if missing; `worlds/default/` ships as committed fixtures). The hand-authored level + wing path are fully deleted (W4).
- **The substrate is real (W2)**: `src/substrate/` — coarse 0.5 m architecture grid + fine 0.25 m occupancy (per-region dense, accessor-sealed), per-face instanced kit skin, `prepareCarve` single-source carve/patch/suppression, 2-piece rim collar, fine→voxel-proxy collision. **Two grid vocabularies (W3)** emit the shared `GridStamp` contract (`themes/grid-stamp.ts` — door construction, door-lane validation, anchor scan): `themes/hall.ts` (mesh-trio presets, pillar lattices) and `themes/maze.ts` (growing-tree + braid, integer-only RNG, rubble-only dressing) — the plug-point proof: adding the maze changed nothing downstream of the stamp. `connector-built.ts` implements aperture / stair-corridor / collar-bore (connectors may mutate joined grids; the bore CARVES the built shell; the aperture derives at length 0 = back-to-back shells, first fixtured + walked in W3). Realize also enforces disjoint region volumes (AABB-level, flush passes). Post-mortem rules from the W2 gate (headless mesh-topology tests; new boundary = new premise): `docs/learnings/2026-07-12-w2-render-collision-divergence.md`.
- **Field worlds (One Field F1+F2a)**: `world-loader.ts` branches on manifest **version 2** (`kind:"field"`) → `field-world.ts` — baked per-chunk per-class `.fmesh` render meshes (+ the kit backing surface) + instanced kit pieces from `kit/*.json`, materials from the manifest's **embedded material table** (the artifact is self-contained); collision derived AT LOAD from the shipped chunk density files (`@furnace/core/field chunkColliders` — masonry blocks purely as solid density); v1 region worlds untouched. Authored in the editor's Field panel against `catalog/materials.json` (this package's world-materials contract half); artifact = `worlds/<name>/` manifest v2 + `chunks/` (+ `.mat` siblings) + `oplog.json` + `meshes/` + `kit/`.
- **Player**: a Rapier capsule driven by the custom `CharacterMover` (collide-and-slide on core casts; since 2026-07-15 the ground pass probes free headroom and rests `REST_GAP` above support — no levitation, no flat-voxel-floor stalls); generated/organic geometry collides against field-derived VOXEL PROXIES — the confirmed ghost-free bridge; Jolt endgame in backlog (`docs/backlog/engine-architecture/jolt-backend-swap.md`).
- **Rendering**: HDR `bloom→tonemap` + exponential fog + torch + instanced scatter dressing.

## The generator library (pure; the editor cockpit consumes it)

- **Worlds (3.3, go-forward)**: `world-spec.ts` (`WorldSpec` — declarative regions with class/algorithm/params/seed/placement, connectors, `startRegion`; connectivity validation) → `world-build.ts realizeWorldSpec` (deterministic, search-free — join-derived placements) → `connector.ts organicTunnel` (the connector OWNS its volume; `TUNNEL_RADIUS` must match the cave bore — see `docs/backlog/dungeon/world-connector-bore-and-overlap.md`) → `bake.ts bakeWorld` → `worlds/<name>/` (ONE merged `world.scene.json` + `.fmesh` sidecars + `world.json` manifest written LAST — crash-safety; provenance per region AND connector; voxels never serialize, proxies re-expand).
- **Cross-engine rule (load-bearing)**: **the BROWSER bakes and uploads** — JSC vs V8 diverge on placement transcendentals; NEVER regenerate placement cross-engine (`docs/learnings/2026-07-06-cross-engine-placement-determinism.md`). Committed fixtures are sound: placement BAKES; only local-frame ops (mesh/scatter/voxel/rng) re-expand.
- **Grid standards** (door 2.0 × 3.0 m, wall 0.5 m, stair rise 0.25 m, 0.5 m placement lattice): `docs/reference/dungeon-architecture.md` §5.

## Epic 3 doctrine

Editor-time generation may use search-class algorithms — a human with reroll, caps, and curation tools absorbs failure. Runtime generation is restricted to construction-guaranteed or degrade-never-fail vocabularies via generator entities; the guarantee class is an explicit setup-loud field on the socket contract.

## Ladder (recharted 2026-07-11)

3.0–3.2.3 ✅ → **3.3 Worlds** — worlds = graphs of REGIONS (per-class native interior algorithms: grid-built on the validated two-resolution voxel substrate, field-organic) + CONNECTORS ("open a passage", implemented per class-pair; substrate evidence: `docs/research/2026-07-11-voxel-substrate-spike-findings.md`):

- **W1 world model ✅** (field-only, user-gated 2026-07-11)
- **W2 substrate + grid-built halls ✅** (user-gated 2026-07-12, two gate rounds — see seal-log)
- **W3** maze + World-panel assembly ✅ (the phase gate — met 2026-07-13)
- **W4** clean-cut sweep ✅ (2026-07-13 — mesh generators + free-space placer + mesh connector kit deleted)

**The 3.4+ recharter (2026-07-14): the One Field phase** — `docs/research/2026-07-13-one-field-direction.md` + `docs/research/2026-07-14-field-precedent-research.md`; the flag layer is 3.4-seeing reborn (F4), the brush editor 3.5-curating reborn (F2/F3):

- **F0 analyzer corpus probe ✅** (2026-07-15 — hybrid, zero misses; cannot self-certify F4 unaided)
- **F1 the medium ✅** (2026-07-15, user-gated — dig → bake → walk; `@furnace/core/field` + Field panel + v2 loader)
- **F2a the material field ✅** (2026-07-16, user-gated — materials + paint/fill + kit skin/collar (P4 proven) → bake → walk with materials visible; F2 spec covers F2a+F2b)
- **F2b the palette** (brush chassis + selection + stamp generators + views) → **F3** smart objects & the cave → **F4** seeing → **F5** scale → **F6** clean cut + seal

**3.6 JIT regions** is unchanged (backlogged: `docs/backlog/dungeon/jit-runtime-regions.md`), as is the deep-gen/streaming/LLM **Epic 4**.
