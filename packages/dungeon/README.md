# @furnace/dungeon

The first-person dungeon-crawler demo — the engine's go-forward consumer app. Vision: an atmospheric, eventually LLM-streamed crawler (see the project memory `project_dungeon_crawler_vision`).

Browser-first; imports core via the workspace symlink; owns `index.html` + `serve.ts`.

**Canonical as-built architecture: `docs/reference/dungeon-architecture.md`** — game loop, traversal/collision, where the generators live, the bake/load pipeline, invariants, testing posture. Chronological slice seals: `docs/learnings/seals/`. This README carries the package's current-state summary; when a slice seals, update HERE (and the reference docs) — never AGENTS.md.

## Commands (from the repo root)

- `bun run dungeon:dev` — the game in the browser
- `bun run dungeon:editor` — open the editor on the dungeon (or `bun run edit` inside the package)
- `bun test packages/dungeon` — package tests (`.gpu.test.ts` files run real WebGPU via bun-webgpu)
- `bun run bake:default` (inside the package) — re-bake the committed default world from its recipe script. Deterministic: a `git status` diff afterwards is a bug, not a re-roll.

## Source layout

`src/` groups by domain, and after the foundations T2 cut there are three groups plus two
entry points:

- **`world/`** — `world-loader.ts` (the one loader, the one owner of `LoadedWorld`),
  `realize.ts` (the `MaterialCache` every draw shares + the `DynamicProp` record),
  `placement-collider.ts` (catalog collision primitive → physics shape), `region.ts` (three
  plain shapes: `Vec3`, `MaterialDescriptor`, `MaterialPosture`).
- **`agent/`** — `char-move.ts`, `fp-controller.ts`, `walkability.ts`, `walk-probe.ts`.
- **`props/`** — `torch.ts`, `motes.ts`.
- `main.ts` and `editor-extensions.ts` stay at the top level — both are entry points, and
  `furnace.config.json` names the latter by path.

Tests live **beside their module** (`src/agent/char-move.test.ts`); `tests/` holds only what
has no single owning module — the three cross-module GPU walk suites, their shared
`_helpers/`, and the bake-script test.

T2 deleted the 3.3-era groups outright: `src/field/` (the CPU SDF/mesher/proxy trio — the
field is `@furnace/core/field` now), `src/substrate/`, `src/themes/`, and the spec/build/
bake/connector/placement half of `world/`.

**Where a new module goes.**

- **A domain group** (`world/`, `agent/`, `props/`) — the default. Most things are domain code.
- **`lib/`** — a logical set of modules abstracting ONE thing, exported from the group, with a
  subfolder per responsibility (e.g. an external-API client: `client`, `errors`, `wrappers`).
  *No tenant today.*
- **`utils/`** — generic shared helpers with NO domain coupling (date/time, logging).
  *No tenant today.* The test is whether the module imports any dungeon type. If it does, it
  is not a util.

Create either directory when something actually earns it, not before.

## Current state (Epic 3 · One Field — F4 landed; foundations T2 cut the second world format, 2026-08-05)

Epics 1–2 CLOSED; 3.3 Worlds SEALED 2026-07-13 (W3 met the phase bar, W4 swept the mesh era out). The 3.4+ **recharter is DONE**: the **One Field phase** (charter 2026-07-14; F0–F6) makes the world ONE sparse chunked voxel field in `@furnace/core/field` with everything else as entities. **F0** (hybrid walkability-analyzer corpus probe — zero misses, but the analyzer cannot self-certify F4; surfaced + led to fixing a shipped mover levitation bug), **F1** ("the medium": dig in the editor → bake → the game walks the field world), **F2a** ("the material field": per-cell material classes, dig/fill/paint, the kit skinner + collar on the one field — charter premise P4 proven headless — with the dungeon shipping `catalog/materials.json` and walking material'd worlds with instanced kit), **F2b** ("the palette": chassis/masks/smooth/hollow, selection, hall+maze stamps as the first generator entities, layers/slice) and **F3a** ("smart objects": reconfigure/freeze/bake on committed generators, patch op + compaction, stamp rotation + door offsets — core+editor only, dungeon byte-untouched) are sealed and merged. **F3b** ("the cave & the entities") is **SEALED 2026-07-25**: the dungeon re-entered as an ENTITY consumer with `catalog/entities.json` (rock + stalagmite archetypes, served via the `/catalog/*` route, shared across every world). **F4** ("seeing") has LANDED on both tranches and is not yet sealed. As-built: `docs/reference/dungeon-architecture.md`.

**Foundations T2 (2026-08-05) retired the 3.3 region world.** Deleted: `src/themes/`, `src/substrate/`, the spec/build/bake/connector/placement half of `src/world/`, the CPU `src/field/` trio, `src/props/scatter.ts`, 35 test files, and the `regions/` fixtures + route. `field-world.ts` merged into `world-loader.ts` (one owner of `LoadedWorld`), `isFieldManifest` became `isWorldManifest`, and `loadWorld` now THROWS on an unrecognized manifest instead of falling through to a second path. **The v1/v2 vocabulary died with the code — there is just "the world format"** (the manifest's wire field still reads `version: 2`, because renumbering a tag that now means "the only format" would break every committed artifact for nothing).

- **The game boots the baked default WORLD, through ONE loader.** `world-loader.ts loadWorld` reads `worlds/index.json` (the editor's world drawer can retarget it) → the world's `manifest.json` → `isWorldManifest` → rebuild the density store from `chunks/*.bin`, derive one shell voxel collider per chunk, draw the per-class `.fmesh` buckets with the manifest's embedded material table, instance the kit from `kit/*.json`, and load the placements. Setup-loud on a missing index/manifest or any unfetchable artifact. Spawn is the manifest's `playerStart`/`playerYaw`. There is no hand-authored level and no live-generation fallback.
- **The committed default world is a RECIPE, not a fixture.** `scripts/bake-default-world.ts` (`bun run bake:default`) is the spec: a pillared masonry hall (the `hall` generator) + a freestanding masonry slab + an organic cave (`cave`, seed 8 — picked by walking the real `CharacterMover` out of the spawn on each candidate) + a dug tunnel joining them + a painted moss patch at the mouth. Everything is seeded or params-determined, so a re-bake is byte-identical and a `git status` diff afterwards is a determinism bug. **38 files / 539 174 bytes**, against a 1 MiB ceiling the script itself enforces ("shrink the recipe's regions, not the budget"). It is deliberately small AND deliberately complete: density chunks, multi-class meshing, the kit skinner and its backing surface, indexed `.mat` materials, kit instancing, and the op log the editor's world list classifies on. A human walked it at the T2 gate. As-built: `dungeon-architecture.md` §5.
- **Worlds (One Field F1+F2a)**: baked per-chunk per-class `.fmesh` render meshes (+ the kit backing surface) + instanced kit pieces from `kit/*.json`, materials from the manifest's **embedded material table** (the artifact is self-contained — the game never reads the editor catalog); collision derived AT LOAD from the shipped chunk density files (`@furnace/core/field chunkColliders` — masonry blocks purely as solid density). Authored in the editor's overlay cockpit against `catalog/materials.json` (this package's world-materials contract half); artifact = `worlds/<name>/` manifest + `chunks/` + `materials/` + `oplog.json` + `meshes/` + `kit/` (+ optional `placements.json`).
- **Placements / props (One Field F3b)**: an optional manifest `placements: "placements.json"` adds the entity half — `buildPlacementInstances` resolves each group's archetype in `catalog/entities.json` (setup-loud if absent), splits records by `variantIndex`, and uploads one instanced mesh per (archetype, variant) via `field.packPlacementMatrices`, joining the world's instanced draw list beside the F2a kit. Colliders are DERIVED at load and never serialized (`createPlacementColliders` → one static body per record, shaped by the catalog collision primitive: box scaled per-axis, sphere/capsule by max scale axis, magnitudes throughout — exact for scatter's uniform-scale records). Each archetype's `collision` may declare `anchor: "center" | "base"` (F4 · D-F4-14), and bodies are positioned by core's `field.collisionCenter(collision, record)`; `"base"` lifts by the collider's own Y half-extent along the record's local +Y so the collider's bottom sits on the surface point. That is the same function the F4 analyzer's `voxelizePlacements` rasterizes around, so flags describe the bodies the loader creates. The shipped catalog base-anchors the base-origin `stalagmite` and leaves the centre-origin `rock` centred. A props-free world loads unchanged. **Accepted consequence**: a centre-anchored prop is half-buried, so realistically sized rocks are STEPPED OVER rather than blocking (measured: climbed ≤~0.56 m, blocks ≥~0.77 m) — blocking is an authoring choice (scale, or a base-origin archetype); the engine-side escalation is unbuilt (`docs/backlog/engine-architecture/catalog-collision-schema.md` §Catalog collision escalation). As-built: `dungeon-architecture.md` §8.
- **The walkability advisor's project half (One Field F4)**: this package supplies both halves of what the editor's advisor is parameterized on. `catalog/agent.json` is the **third project→editor catalog contract** (DATA only, beside `materials.json` and `entities.json`, served by the same `/catalog/*` route): the agent capsule + `stepHeight` / `climbCeiling` / `clearance` / `slopeLimitDeg` / `skin` that core's stage-1 passes take, single-sourced through `walkability.ts`'s `AGENT` — the editor fetches and parses it, and a project without one simply leaves the advisor off. `editor-extensions.ts` registers **`analyzerVerify`** (`agent/walk-probe.ts`) as a named service (`defineService`, `@furnace/core/registry` — T1b; the plain re-export also remains) as **stage 2**: the editor's analyzer worker imports `/engine.js`, resolves the service via `getService`, and drives THIS package's real `CharacterMover` down directed lanes in a locally built physics scene — one static voxel-shell collider per allocated chunk within `neighborhoodChunks` of the flag (the same `field.chunkColliders` derivation the game loads) plus every placement collider reaching that box. Needs no GPU (a headless `PhysicsContext`, one process-wide, a fresh `World` per call destroyed in a `finally`); mutates nothing. Setup-loud before any physics is created — it REFUSES a profile that does not describe the shipped mover, since `char-move.ts` reads its own `stepHeight` and slope limit from `catalog/agent.json` as module constants and a divergent profile would produce verdicts about no real agent. Advisory only: `trapped` means the mover demonstrably stalls, `clear` that it demonstrably walks through, `inconclusive` that neither was shown — a lane with no usable evidence never contributes a clear. As-built: `dungeon-architecture.md` §3 "Stage 2 — the verify probe".
- **Player**: a Rapier capsule driven by the custom `CharacterMover` (collide-and-slide on core casts; since 2026-07-15 the ground pass probes free headroom and rests `REST_GAP` above support — no levitation, no flat-voxel-floor stalls); the world collides as per-chunk voxel shells — the confirmed ghost-free bridge around Rapier trimesh ghosts; Jolt endgame in backlog (`docs/backlog/engine-architecture/jolt-backend-swap.md`).
- **Rendering**: HDR `bloom→tonemap` + exponential fog + torch + instanced kit and prop draws.

## The generators live in core, not here

This package **owns no generators**. `hall`, `maze`, `cave` and `scatter` are `@furnace/core/field` generator entities, reached by `field.generatorById(id)` and committed through `field.commitGenerator`; brushes (dig/fill/paint/smooth) go through `field.logApply`. The dungeon consumes that surface in three places: the editor cockpit (interactive authoring), `scripts/bake-default-world.ts` (the committed world), and `world-loader.ts` (which consumes only the BAKE, never a generator).

- **Cross-engine rule (load-bearing)**: **the BROWSER bakes and uploads** — JSC vs V8 diverge on transcendental `Math`; never regenerate placement cross-engine (`docs/learnings/2026-07-06-cross-engine-placement-determinism.md`). The committed default world is a `bun` bake and is sound: the field path is integer/lattice work, and the divergence class that rule guards against was placement transcendentals in the retired region world.
- **Three DATA catalogs** are this package's contract with the editor, all under `catalog/` and all served by `serve.ts`'s `/catalog/*` route: `materials.json`, `entities.json`, `agent.json`. Data, never code — a project without one simply leaves that feature off.

## What the catalog ships

All three are short, complete lists, not partial examples. Today:

**Material classes** (`catalog/materials.json`):

| id | name | kind | notes |
| --- | --- | --- | --- |
| 0 | rock | organic | |
| 1 | dirt | organic | |
| 2 | moss-stone | organic | |
| 3 | masonry | kit | carries a kit-piece color set (panel/floor/trim/collar) for the kit skinner |

**Prop archetypes** (`catalog/entities.json`):

| id | name | meshes | scatters onto |
| --- | --- | --- | --- |
| rock | Rock | 3 | floor |
| stalagmite | Stalagmite | 2 | floor |

Mesh counts verified via `bun -e 'for (const a of (await Bun.file("packages/dungeon/catalog/entities.json").json()).archetypes) console.log(a.id + " " + a.meshes.length)'` (from the repo root) → `rock 3`, `stalagmite 2`.

**Agent profile** (`catalog/agent.json`) — one object, not a list: capsule `radius` 0.3 m / `halfHeight` 0.6 m, `stepHeight` 0.4, `climbCeiling` 0.7, `clearance` 1.8, `slopeLimitDeg` 55, `skin` 0.08. Everything the advisor and the mover are parameterized on comes from here, single-sourced through `walkability.ts`'s `AGENT`. The one derived number worth naming: the `narrow` flag's bar is free width below `2·radius + skin` = **0.68 m** — verified via `bun -e 'const a = await Bun.file("packages/dungeon/catalog/agent.json").json(); console.log((2 * a.capsule.radius + a.skin).toFixed(2))'` (from the repo root) → `0.68`. Widen the capsule and every corner in every world is re-judged.

An archetype's mesh count is the ceiling on a scatter's variant count: asking `scatter` for more variants than the archetype has meshes bakes a world that throws when the game loads it. Detail: `docs/backlog/engine-architecture/scatter-variants-not-bound-to-archetype.md`.

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
- **F1 the medium ✅** (2026-07-15, user-gated — dig → bake → walk; `@furnace/core/field` + the Field panel + the field loader, at the time a second path beside the region world's)
- **F2a the material field ✅** (2026-07-16, user-gated — materials + paint/fill + kit skin/collar (P4 proven) → bake → walk with materials visible; F2 spec covers F2a+F2b)
- **F2b the palette ✅** (2026-07-21, user-gated — brush chassis + masks/smooth/hollow + selection + hall/maze stamps as the first generator entities + layers/slice)
- **F3a smart objects ✅** (2026-07-23, user-gated — reconfigure/freeze/bake on committed generators, patch op + compaction, stamp rotation + door offsets)
- **F3b the cave & the entities** — **SEALED 2026-07-25** (core cave + scatter generators, placement ops + artifact; this package's catalog + derived-collider half; the editor's scatter authoring, void cast, and segment brush)
- **F4 seeing** — LANDED, unsealed. Root tranche: core's `markUnreachable` + `voxelizePlacements` (D-F4-5/8), the `pit` region detector (D-F4-18) and the amended severity model, `PhysicsContext` + `createHeadlessPhysicsContext` (physics decoupled from the GPU context), `collisionCenter` (D-F4-14) and `GeneratorDef.emits` (D-F4-15); this package's `analyzerVerify` walk-probe + the P-F4-3/3b/4 threshold measurements + the per-archetype collider anchor. Editor tranche: the analyzer worker, the `flags` layer + markers, the Flags panel, Verify end-to-end, and the segment clamp. Awaiting the user gate → **F5** scale → **F6** clean cut + seal; the accumulated gate-UX sets batch into a dedicated UX/polish stage after the feature phases

**F6's clean cut came early, from the side.** The foundations program's T2 tranche (2026-08-05) deleted the region world, `@furnace/core/scene` and the editor daemon's scene half — the deletion F6 was chartered to do, executed as foundations work because the second format was blocking the foundations, not the features. F6 keeps its seal, not its cut.

**3.6 JIT regions** is unchanged (backlogged: `docs/backlog/dungeon/jit-runtime-regions.md`), as is the deep-gen/streaming/LLM **Epic 4**.
