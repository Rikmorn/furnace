# @furnace/dungeon

The first-person dungeon-crawler demo — the engine's go-forward consumer app. Vision: an atmospheric, eventually LLM-streamed crawler (see the project memory `project_dungeon_crawler_vision`).

Browser-first; imports core via the workspace symlink; owns `index.html` + `serve.ts`.

**Canonical as-built architecture: `docs/reference/dungeon-architecture.md`** — game loop, traversal/collision, the generator library, the world/bake/load pipeline, invariants, testing posture. Chronological slice seals: `docs/learnings/seals/`. This README carries the package's current-state summary; when a slice seals, update HERE (and the reference docs) — never AGENTS.md.

## Commands (from the repo root)

- `bun run dungeon:dev` — the game in the browser
- `bun run dungeon:editor` — open the editor on the dungeon (or `bun run edit` inside the package)
- `bun test packages/dungeon` — package tests (`.gpu.test.ts` files run real WebGPU via bun-webgpu)

## Source layout

`src/` groups by domain: `world/` (spec, build, bake, load, placement, connectors, region
contract), `field/` (SDF primitives, meshing, voxel proxy), `agent/` (locomotion, controller,
walkability), `props/` (scatter, motes, torch), plus the existing `substrate/` and `themes/`.
`main.ts` and `editor-extensions.ts` stay at the top level — both are entry points, and
`furnace.config.json` names the latter by path.

**Where a new module goes.**

- **A domain group** (`world/`, `field/`, `agent/`, `props/`) — the default. Most things are
  domain code.
- **`lib/`** — a logical set of modules abstracting ONE thing, exported from the group, with a
  subfolder per responsibility (e.g. an external-API client: `client`, `errors`, `wrappers`).
  *No tenant today* — the package's two cohesive abstraction sets, `substrate/` and `themes/`,
  already are this and have better names than `lib/`.
- **`utils/`** — generic shared helpers with NO domain coupling (date/time, logging).
  *No tenant today.* Note the near-miss: `aabb.ts` looks generic and is not — it imports `Aabb`
  and `Vec3` from `world/region.ts`, so it lives in `world/`. The test is whether the module
  imports any dungeon type. If it does, it is not a util.

Create either directory when something actually earns it, not before.

## Current state (Epic 3 · One Field — F3b SEALED 2026-07-25)

Epics 1–2 CLOSED; 3.3 Worlds SEALED 2026-07-13 (W3 met the phase bar, W4 swept the mesh era out). The 3.4+ **recharter is DONE**: the **One Field phase** (charter 2026-07-14; F0–F6) makes the world ONE sparse chunked voxel field in `@furnace/core/field` with everything else as entities. **F0** (hybrid walkability-analyzer corpus probe — zero misses, but the analyzer cannot self-certify F4; surfaced + led to fixing a shipped mover levitation bug), **F1** ("the medium": dig in the editor's Field panel → bake → the game walks the v2 field world), **F2a** ("the material field": per-cell material classes, dig/fill/paint, the kit skinner + collar on the one field — charter premise P4 proven headless — with the dungeon shipping `catalog/materials.json` and walking material'd worlds with instanced kit), **F2b** ("the palette": chassis/masks/smooth/hollow, selection, hall+maze stamps as the first generator entities, layers/slice) and **F3a** ("smart objects": reconfigure/freeze/bake on committed generators, patch op + compaction, stamp rotation + door offsets — core+editor only, dungeon byte-untouched) are sealed and merged. As-built: `docs/reference/dungeon-architecture.md` §7. **F3b** ("the cave & the entities") is **SEALED 2026-07-25** (user-gated Safari, one gate round + fix round): the dungeon re-entered as an ENTITY consumer with `catalog/entities.json` (rock + stalagmite archetypes, served via the `/catalog/*` route, shared across every field world) and the placement half of `field-world.ts` — see the Placements bullet below and `dungeon-architecture.md` §8. **F4** ("seeing") has LANDED on both tranches and is NOT yet sealed — the user gate has not run; see the Walkability advisor bullet below.

- **The game boots the baked default WORLD** — since W3 the PHASE-GATE world: pillar hall ↔ stair corridor (+1.5 m) ↔ maze; maze ↔ aperture ↔ box room; maze ↔ collar-bore ↔ cave. `world-loader.ts` reads `worlds/index.json` (the World panel's bake can retarget it) → the world's manifest → ONE merged `world.scene.json`, re-expands proxies/dressing deterministically AND the whole grid class (halls/mazes/corridors re-expand render + collision at load via `expandGridRegion`, dispatched by algorithm — zero baked sidecars), spawns at the manifest `playerStart` (setup-loud if missing; `worlds/default/` ships as committed fixtures). The hand-authored level + wing path are fully deleted (W4).
- **The substrate is real (W2)**: `src/substrate/` — coarse 0.5 m architecture grid + fine 0.25 m occupancy (per-region dense, accessor-sealed), per-face instanced kit skin, `prepareCarve` single-source carve/patch/suppression, 2-piece rim collar, fine→voxel-proxy collision. **Two grid vocabularies (W3)** emit the shared `GridStamp` contract (`themes/grid-stamp.ts` — door construction, door-lane validation, anchor scan): `themes/hall.ts` (mesh-trio presets, pillar lattices) and `themes/maze.ts` (growing-tree + braid, integer-only RNG, rubble-only dressing) — the plug-point proof: adding the maze changed nothing downstream of the stamp. `connector-built.ts` implements aperture / stair-corridor / collar-bore (connectors may mutate joined grids; the bore CARVES the built shell; the aperture derives at length 0 = back-to-back shells, first fixtured + walked in W3). Realize also enforces disjoint region volumes (AABB-level, flush passes). Post-mortem rules from the W2 gate (headless mesh-topology tests; new boundary = new premise): `docs/learnings/2026-07-12-w2-render-collision-divergence.md`.
- **Field worlds (One Field F1+F2a)**: `world-loader.ts` branches on manifest **version 2** (`kind:"field"`) → `field-world.ts` — baked per-chunk per-class `.fmesh` render meshes (+ the kit backing surface) + instanced kit pieces from `kit/*.json`, materials from the manifest's **embedded material table** (the artifact is self-contained); collision derived AT LOAD from the shipped chunk density files (`@furnace/core/field chunkColliders` — masonry blocks purely as solid density); v1 region worlds untouched. Authored in the editor's Field panel against `catalog/materials.json` (this package's world-materials contract half); artifact = `worlds/<name>/` manifest v2 + `chunks/` (+ `.mat` siblings) + `oplog.json` + `meshes/` + `kit/`.
- **Placements / props (One Field F3b)**: an optional manifest `placements: "placements.json"` adds the entity half — `buildPlacementInstances` resolves each group's archetype in `catalog/entities.json` (setup-loud if absent), splits records by `variantIndex`, and uploads one instanced mesh per (archetype, variant) via `field.packPlacementMatrices`, joining the field world's instanced draw list beside the F2a kit. Colliders are DERIVED at load and never serialized (`createPlacementColliders` → one static body per record, shaped by the catalog collision primitive: box scaled per-axis, sphere/capsule by max scale axis, magnitudes throughout — exact for scatter's uniform-scale records). Each archetype's `collision` may declare `anchor: "center" | "base"` (F4 · D-F4-14), and bodies are positioned by core's `field.collisionCenter(collision, record)`; `"base"` lifts by the collider's own Y half-extent along the record's local +Y so the collider's bottom sits on the surface point. That is the same function the F4 analyzer's `voxelizePlacements` rasterizes around, so flags describe the bodies the loader creates. The shipped catalog base-anchors the base-origin `stalagmite` and leaves the centre-origin `rock` centred. A props-free world loads exactly as before. **Accepted consequence**: a centre-anchored prop is half-buried, so realistically sized rocks are STEPPED OVER rather than blocking (measured: climbed ≤~0.56 m, blocks ≥~0.77 m) — blocking is an authoring choice (scale, or a base-origin archetype); the engine-side escalation is unbuilt (`docs/backlog/engine-architecture/catalog-collision-escalation.md`). As-built: `dungeon-architecture.md` §8.
- **The walkability advisor's project half (One Field F4)**: this package supplies both halves of what the editor's advisor is parameterized on. `catalog/agent.json` is the **third project→editor catalog contract** (DATA only, beside `materials.json` and `entities.json`, served by the same `/catalog/*` route): the agent capsule + `stepHeight` / `climbCeiling` / `clearance` / `slopeLimitDeg` / `skin` that core's stage-1 passes take, single-sourced through `walkability.ts`'s `AGENT` — the editor fetches and parses it, and a project without one simply leaves the advisor off. `editor-extensions.ts` re-exports **`analyzerVerify`** (`walk-probe.ts`) as **stage 2**: the editor's analyzer worker imports `/engine.js` and drives THIS package's real `CharacterMover` down directed lanes in a locally built physics scene — one static voxel-shell collider per allocated chunk within `neighborhoodChunks` of the flag (the same `field.chunkColliders` derivation the game loads) plus every placement collider reaching that box. Needs no GPU (a headless `PhysicsContext`, one process-wide, a fresh `World` per call destroyed in a `finally`); mutates nothing. Setup-loud before any physics is created — it REFUSES a profile that does not describe the shipped mover, since `char-move.ts` reads its own `stepHeight` and slope limit from `catalog/agent.json` as module constants and a divergent profile would produce verdicts about no real agent. Advisory only: `trapped` means the mover demonstrably stalls, `clear` that it demonstrably walks through, `inconclusive` that neither was shown — a lane with no usable evidence never contributes a clear. As-built: `dungeon-architecture.md` §3 "Stage 2 — the verify probe". The collider `anchor` (D-F4-14) is the other F4 rider and is covered in the Placements bullet above.
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
- **W2 substrate + grid-built halls ✅** (user-gated 2026-07-12, two gate rounds — see `docs/learnings/seals/2026-07-11-epic3-recharter-w1-world-model.md`)
- **W3** maze + World-panel assembly ✅ (the phase gate — met 2026-07-13)
- **W4** clean-cut sweep ✅ (2026-07-13 — mesh generators + free-space placer + mesh connector kit deleted)

**The 3.4+ recharter (2026-07-14): the One Field phase** — `docs/research/2026-07-13-one-field-direction.md` + `docs/research/2026-07-14-field-precedent-research.md`; the flag layer is 3.4-seeing reborn (F4), the brush editor 3.5-curating reborn (F2/F3):

- **F0 analyzer corpus probe ✅** (2026-07-15 — hybrid, zero misses; cannot self-certify F4 unaided)
- **F1 the medium ✅** (2026-07-15, user-gated — dig → bake → walk; `@furnace/core/field` + Field panel + v2 loader)
- **F2a the material field ✅** (2026-07-16, user-gated — materials + paint/fill + kit skin/collar (P4 proven) → bake → walk with materials visible; F2 spec covers F2a+F2b)
- **F2b the palette ✅** (2026-07-21, user-gated — brush chassis + masks/smooth/hollow + selection + hall/maze stamps as the first generator entities + layers/slice)
- **F3a smart objects ✅** (2026-07-23, user-gated — reconfigure/freeze/bake on committed generators, patch op + compaction, stamp rotation + door offsets)
- **F3b the cave & the entities** — **SEALED 2026-07-25** (core cave + scatter generators, placement ops + artifact; this package's catalog + derived-collider half; the editor's scatter authoring, void cast, and segment brush)
- **F4 seeing** — LANDED, unsealed. Root tranche: core's `markUnreachable` + `voxelizePlacements` (D-F4-5/8), the `pit` region detector (D-F4-18) and the amended severity model, `PhysicsContext` + `createHeadlessPhysicsContext` (physics decoupled from the GPU context), `collisionCenter` (D-F4-14) and `GeneratorDef.emits` (D-F4-15); this package's `analyzerVerify` walk-probe + the P-F4-3/3b/4 threshold measurements + the per-archetype collider anchor. Editor tranche: the analyzer worker, the `flags` layer + markers, the Flags panel, Verify end-to-end, and the segment clamp. Awaiting the user gate → **F5** scale → **F6** clean cut + seal; the accumulated gate-UX sets batch into a dedicated UX/polish stage after the feature phases

**3.6 JIT regions** is unchanged (backlogged: `docs/backlog/dungeon/jit-runtime-regions.md`), as is the deep-gen/streaming/LLM **Epic 4**.
