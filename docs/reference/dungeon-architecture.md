# Dungeon architecture — as built

The `packages/dungeon` demo as it IS (post Epic 2 closure, Epic 3 through One Field F4, and
the foundations T2 cut, 2026-08-05). Chronological seal history: `docs/learnings/seals/`.
Deferred work: `docs/backlog/dungeon/`. This doc is current-state; when it disagrees with
source, the source wins — update this doc in the same change.

**There is ONE world format.** The dungeon carried two for the length of the One Field arc:
the 3.3-era *region world* (a graph of generated regions baked to a merged scene document +
`.fmesh` sidecars) and the *field world* (a chunked density store baked to `chunks/` +
`meshes/`). Foundations T2 deleted the first — its generators, its substrate, its spec/build/
bake pipeline, its CPU field/mesher/proxy modules, its 35 test files and its fixtures — so
"v1" and "v2" are no longer distinctions this codebase makes. **A world is a field.** The
only survival of the numbering is the manifest's wire field, which still reads `version: 2`
because bumping a format tag to mean "the only format" would break every committed artifact
for nothing.

## 1. Doctrine (Epic 3)

Editor-time generation may use search-class algorithms — a human with reroll, caps, and
curation tools absorbs failure. Runtime generation is restricted to
construction-guaranteed or degrade-never-fail vocabularies via generator entities; the
guarantee class is an explicit, setup-loud field on the (future) socket contract.
The editor cockpit's loop shipped in 3.1: generate → reroll → freeze & bake → walk.

## 2. The game (`main.ts`) and the one loader

- **`loadWorld` (`src/world/world-loader.ts`) is the ONLY boot path.** There is no
  hand-authored level, no live-generation fallback, and — since T2 — no second format to
  branch on: the game is exactly what the baked world says it is. It reads
  `worlds/index.json` → the named world's `manifest.json` → `isWorldManifest` (the
  `version: 2` + `kind: "field"` pair `field.bakeFieldWorld` writes) → `loadFromManifest`.
  **A manifest that does not match falls through to nothing** — it THROWS `"is not a world
  this runtime understands — re-bake"` rather than trying a second path, which is the
  concrete shape of the one-format rule. `world-loader.ts` is also the one owner of
  `LoadedWorld` (the F1-era `src/field/field-world.ts` merged into it at T2).
- **What loading a world builds**, all from the manifest and its sibling files:
  - the density **store** rebuilt from the per-chunk `chunks/*.bin` files — the authoring
    truth, and what everything else is derived from;
  - one static **shell voxel collider per allocated chunk** via `field.chunkColliders`,
    derived AT LOAD and never serialized (§3);
  - the pre-baked per-class **`.fmesh` render meshes**, each placed at its chunk origin with
    the material its class resolves to out of the manifest's EMBEDDED material table (a
    table-less bake shares one lit `STONE`; a kit BACKING bucket takes the kit's
    `backingColor`);
  - one instanced **kit** draw per kit chunk from `kit/*.json` (unit cube × per-piece
    yaw·box matrix, tinted per piece);
  - the **placements** (props) named by the optional `placements` field — one instanced mesh
    per (archetype, variant) plus one derived static collider per record (§8).
- **Setup-loud throughout.** A missing index or manifest THROWS with a fix-it message; so
  does any manifest-referenced chunk, mesh, kit, placement or catalog artifact that fails to
  fetch. A healthy clone commits a default world, so an absent artifact is a broken checkout
  or a partial bake, not a "nothing baked yet" state.
- **The committed default world** (`worlds/default/`) is baked from a script that is itself
  the spec: `scripts/bake-default-world.ts`, run with `bun run bake:default` (§5).
- Spawn is the manifest's `playerStart` / `playerYaw`, read off the same `LoadedWorld` object
  that carries the draws.
- Torch point light, motes, HDR `bloom→tonemap` + exponential fog (density 0.12,
  clear color = fog color).
- Player: Rapier capsule (`kinematicPosition`) driven by the custom `CharacterMover`;
  noclip dev toggle (V); shoving via `shoveDynamicBodies`.
- **Teardown discipline:** `LoadedWorld.destroy()` frees only what the load created on the
  GPU — meshes, geometries, instanced kit and instanced placement meshes. Every static body
  (chunk shells AND per-prop colliders) dies with `physics.destroyWorld`, and the
  `MaterialCache` is the caller's.

## 3. Traversal & collision

- **`CharacterMover` (`char-move.ts`)** — custom collide-and-slide on core
  `physics.castRay`/`castShape`: horizontal shapecast slide pass, downward-shapecast
  ground pass (rim-riding: rests on the highest support in the capsule footprint — the
  rest sweep's lift is capped at the UPWARD-PROBED free headroom and the body rests
  `REST_GAP` 2 cm above support so no cast ever starts penetrating; fixed 2026-07-15
  after the F0 probe surfaced +0.4 m/frame levitation-while-grounded on
  sub-2.2 m-clearance floors, and the repro exposed a second exact-contact stall class
  on flat voxel floors — `src/agent/char-move-levitation.gpu.test.ts` guards both, and at T2
  it was ported onto the field path before the region-world fixtures it used went),
  explicit step-up, camera eye-height smoothing. Rapier's built-in KCC stays in core,
  unused. `physics.castRay` returns null until `physics.step` populates the broadphase.
- **Collision representation**: the world collides as **one static voxel shell collider per
  allocated chunk**, derived at load from the shipped density files by core's
  `field.chunkColliders` (`@furnace/core/field`) — shell-only, because interior rock is
  unreachable. Colliders NEVER serialize: the density is the truth and the shell is a
  function of it, which is what keeps a hand-edited chunk file from disagreeing with the
  bodies the game stands on. Density-only, too — masonry blocks the player because it is
  solid density, with no material-channel involvement. The dungeon's own CPU
  proxy/mesher/SDF trio (`src/field/{field,surface-nets,proxy}.ts`) was the 3.3-era
  equivalent for the region world and was deleted at T2; the cell size is the field's own
  (`manifest.cellSize`, 0.25 m in the committed world — below `STEP_HEIGHT` 0.4, so floor
  quantization stays under the step limit). Props are the exception and carry their own
  colliders (§8). Voxels remain a confirmed BRIDGE around Rapier trimesh ghost collisions;
  endgame = collide the render mesh on Jolt
  (`docs/backlog/engine-architecture/jolt-backend-swap.md`,
  `docs/learnings/jolt-mesh-collision-spike.md`).
- **Walkability is single-sourced** in `src/agent/walkability.ts` — `STEP_HEIGHT` 0.4 (the
  auto-step ceiling; sizes the step-up sweep and the ground-snap reach) and
  `SLOPE_LIMIT_COS` (55°, which normals count as ground), both read out of
  `catalog/agent.json`. `char-move.ts` reads both, and the field's cell size (0.25 m) sits
  below `STEP_HEIGHT`, so the floor quantization a voxel shell imposes is climbable by
  construction (`GROUND_SNAP >= STEP_HEIGHT` is unit-asserted).

### The walkability analyzer — what it must catch, and the numbers it inherits

Stage 1 of the analyzer is `field.analyzeChunk` / `analyzeWorld` in core
(`core-modules.md` §field), parameterized on `catalog/agent.json` through
`walkability.ts`'s `AGENT`, with two whole-world companions — `markUnreachable`
(reachability demotion) and `detectPits` (regions the agent enters and cannot leave,
which is the "voids the capsule enters but cannot leave" class below, at region scale).
All three are ADVISORY: they read the field and report, they never edit and never
block. What follows is the requirements record that used to sit in
`docs/backlog/`, absorbed here at F4.

**Failure classes the analyzer exists to catch** (the known-bad corpus, distilled at the
W4 sweep from the retiring wing-era entries):

- **Carved-rim wedge / lip above step height** — the 2.2.1 rim-riding class plus the
  substrate spike's carved-patch wedge (spike P5): floor-adjacent lips above
  `STEP_HEIGHT` 0.4 that stall the capsule.
- **Sub-capsule pockets** — voids the capsule (r 0.3, half-height 0.6) enters but cannot
  leave (the class slice 2.2.1's shapecast-ground fix closed).
- **Tight-corner capsule catch** — enclosure inner corners and short dogleg turns at
  oblique joins, catching the capsule mid-turn (3.1 gate observation).
- **Interior centerline-obstacle stall** — an obstacle on the natural door→far-side
  walking lane; door-lane guards cover the door band only, not mid-room paths
  (pillarHall centerline finding, 2.2.2).
- **Vertical-transition sills** — voxel-quantized floors (0.25 steps) meeting built sills
  at organic thresholds; the worst walk-feel class at the 3.1 gate.
- **Lintel clip at walled low portals** — climbing arrivals into a WALLED low portal clip
  the lintel; walledness is the discriminator, not climb direction (an ascending low end
  is a free-floor departure — landings there create wedges, verified 2.2.5b-B1).

This is the requirement set, not a claim about today's mover. Four of the six are
capsule-TRAP classes, and the F0 corpus probe (2026-07-15) measured each against
`char-move.ts`: two of the four could not be reproduced — the sub-step-height two-contact
wedge (always climbed by the step-up pass) and sub-capsule pockets (closed by slice
2.2.1) — so the probe corpus substitutes above-step-height and supra-capsule geometry
that does trap, and the mover's real climb ceiling measured well above `STEP_HEIGHT`.
`docs/learnings/2026-07-15-analyzer-corpus-probe.md` is the authority on all of that.

**Empirical constants.** Two are live in `src/agent/walkability.ts`; the rest were measured
against generated content whose generators no longer exist here (W4 deleted the mesh
connector kit, foundations T2 the rest of the region world), so for those rows **this table
is the only record outside git history**. They are kept because the MEASUREMENTS describe
the shipped `CharacterMover`, which is unchanged — a future generator that emits ramps or
stairs inherits these numbers, whatever emits them.

| Constant | Value | Provenance |
|---|---|---|
| Ramp mount success (GPU-traced) | **47.2°** | slice 2.2.5b-B1 GPU traces |
| Ramp stall (GPU-traced) | **49.64°** | slice 2.2.5b-B1 GPU traces |
| `RAMP_MOUNT_LIMIT_RAD` (deleted at W4) | **45°** | safety margin below the 47.2° known-good mount |
| `STEP_MARGIN` (deleted at W4) | **0.05 m** | kept generated step rises strictly below `STEP_HEIGHT` |
| `stepCount(rise)` (deleted at W4) | `ceil(rise / (STEP_HEIGHT − STEP_MARGIN))` = `ceil(rise / 0.35)` | — |
| `STEP_HEIGHT` | **0.4 m** | live: `src/agent/walkability.ts`, derived from `catalog/agent.json` |
| Slope stand-on limit | **55°** | live: `src/agent/walkability.ts` `SLOPE_LIMIT_COS`, from `agent.slopeLimitDeg` |
| `STAIR_RISE` (deleted at T2 with the built connectors) | one FINE cell (**0.25 m**) | traversal-proven against `STEP_HEIGHT` 0.4 |
| Collision cell Y | **0.25 m** | live: the field's own `manifest.cellSize`; chosen below `STEP_HEIGHT` |

The deleted `RAMP_MOUNT_LIMIT_RAD` TSDoc's rationale, verbatim: *"the steepest ramp the
CharacterMover can climb onto from a FLAT approach … a ramp steeper than the mount limit
is a one-way slope in a walk-verb world (descending arrivals put a flat landing at every
ramp foot, so every ramp gets mounted from flat when walked back up). SLOPE_LIMIT_RAD
(55°) remains the physical stand-on/slide limit only."*

### Stage 2 — the verify probe (`walk-probe.ts`), as-built at F4

`analyzerVerify(opts)` in `src/agent/walk-probe.ts` is stage 2 of the advisor (D-F4-10): for
ONE stage-1 flag it builds a LOCAL headless physics scene — chunk shell colliders in a
bounded neighborhood via `field.chunkColliders` plus placement colliders via
`placement-collider.ts`, the SAME derivations the game loads with, on a
`physics.createHeadlessPhysicsContext()` — and drives the REAL `CharacterMover` at the
flag from the four cardinals. Test the code, not the data: a verdict is a statement
about the shipped controller, never a model of it.

Verdicts are `trapped | clear | inconclusive` under F0's carried invariants:
trap-precedence (a trap in any lane outvotes clears in others — the ordering IS the
miss-safety), the levitation guard, and an asymmetric error posture — a false CLEAR is
a MISS and every rule biases against it (a flag with no usable evidence is
`inconclusive`, never `clear`); a false TRAP is only noise. Budgets are semantics, not
tuning: a wall-clock ceiling and lane caps, with exhaustion → `inconclusive`
(`reason: "budget"`). Spawn poses are enumerated (0.9–2.0 m approach band, half-cell
lateral nudges — larger nudges could route AROUND the hazard and manufacture a false
clear) and VALIDATED before driving, closing F0's spawn-in-geometry false-trap class.

The editor's analyzer worker calls it through the `editor-extensions.ts` seam via
`/engine.js`. Pit flags are NOT verifiable — they are region-level (spec A1); walk
them. And per D-F4-1 the probe is a per-flag FILTER, never certification: the GPU walk
suites remain the authoritative walkability gate. Tests: `src/agent/walk-probe.test.ts` —
plain `bun:test`, no GPU fixture, which is itself the headless-context payoff.

## 4. Where the generators live — core, not here

The dungeon **owns no generators**. Every procedural vocabulary it uses is
`@furnace/core/field` surface (`core-modules.md` §field), evaluated in the editor or in a
bake script and committed to the world as ops:

- **Generator entities** — `hall`, `maze`, `cave`, `scatter`, registered in
  `field/registry.ts` and reached by `field.generatorById(id)`. Each declares its params as
  one zod schema, so the runtime validator and the JSON `paramSchema` the editor's form
  renders cannot drift.
- **Brush ops** — dig / fill / paint / smooth over box / sphere / capsule shapes, with masks.
- **`field.commitGenerator` / `field.logApply`** — the ONLY mutation path. An op log is the
  recipe; the density store is its evaluated state; a bake is a derived artifact of both.

The dungeon's whole remaining `src/` is a *consumer* of that surface — three domain groups
plus two top-level entry points:

- **`world/`** — `world-loader.ts` (§2), `realize.ts` (the descriptor-keyed `MaterialCache`
  every draw shares, plus the `DynamicProp` record), `placement-collider.ts` (the catalog
  collision primitive → physics shape mapping, deliberately its own module so the headless
  walk probe can use it without pulling the renderer in), and `region.ts` — down to three
  plain shapes (`Vec3`, `MaterialDescriptor`, `MaterialPosture`) after T2 took the region
  vocabulary that gave it its name.
- **`agent/`** — `char-move.ts` (the mover, §3), `fp-controller.ts`, `walkability.ts` (the
  single source of `AGENT` / `STEP_HEIGHT` / `SLOPE_LIMIT_COS`, parsed from
  `catalog/agent.json`), `walk-probe.ts` (advisor stage 2, §3).
- **`props/`** — `torch.ts`, `motes.ts`. (The 3.3-era `scatter.ts` was deleted at T2; scatter
  is a core generator now.)
- **`main.ts`** (the game) and **`editor-extensions.ts`** (the project→editor seam:
  `defineService("analyzerVerify", …)` at import time — Branch A — plus re-exports that keep
  proving the agent/analyzer import graph is browser-bundlable from the dungeon root). Both
  stay at the top level because both are entry points, and `furnace.config.json` names the
  latter by path.

**Three DATA catalogs** are the project's contract with the editor, all served by `serve.ts`'s
`/catalog/*` route and all parsed setup-loud: `materials.json` (the world-material classes and
the kit style), `entities.json` (prop archetypes — meshes, lit colour, collision primitive,
bake-time scatter config), `agent.json` (the capsule + `stepHeight` / `climbCeiling` /
`clearance` / `slopeLimitDeg` / `skin`). They are data, never code: a project without one
simply leaves that feature off.

## 5. The committed default world — a recipe, not a fixture

`worlds/default/` is the world the game boots, and it is produced by
**`scripts/bake-default-world.ts`** (`bun run bake:default` from `packages/dungeon`). The
script IS the spec: every value is seeded or params-determined, nothing reads the clock,
`Math.random` or the environment, so **a re-bake writes byte-identical files** — a `git
status` diff after a re-bake is a determinism bug, not a re-roll.

The recipe, in the one order that makes it well-formed (the cave commits under `replace`,
which overwrites its whole region, so the tunnel through its south face must be dug AFTER it,
and the moss painted after that):

1. a **pillared masonry hall** — the `hall` generator, 10×6×10 coarse cells, `colonnade`
   pillars, one north doorway;
2. a **freestanding masonry slab** across the west aisle — a `fill` op in the masonry class,
   lattice-aligned on every face because `assertOpValid` requires that of a kit-class write
   and the skinner needs it to emit whole panels;
3. an **organic cave** — the `cave` generator, 3 chambers, south mouth. **Seed 8 is picked,
   not arbitrary:** the mouth passage angles toward whichever chamber is nearest, and some
   seeds put a rock nose square in front of the tunnel. Seed 8 was chosen by driving the real
   `CharacterMover` north out of the spawn on each candidate; re-roll it only against that
   same measurement;
4. a **tunnel** joining hall to cave — one `dig` op on the hall's own door lane, derived from
   the generated hall footprint rather than a literal;
5. a **mossed patch** at the cave mouth — a `paint` sphere. Paint touches SOLID cells only, so
   it re-materials rock without moving a surface, and it is sized to stop short of the hall's
   kit-masonry north face (painting an organic class over kit would silently un-skin it).

The player spawn is derived, not authored: the hall's generated footprint gives the lane and
the floor plane, and `AGENT.capsule` gives the rest height (`radius + halfHeight`, plus a
0.1 m settle rise so the first frame settles rather than resolving a penetration).

**The bake is budgeted and the budget is enforced in the script.** `MAX_BAKED_BYTES` is
1 MiB and the script throws over it — *"shrink the recipe's regions, not the budget"*. Today's
world is **38 files / 539 174 bytes**: 10 density chunks, 16 per-class `.fmesh` buckets
(including kit BACKING buckets), 6 `.mat` siblings, 4 kit instance files, the manifest and the
op log. Region bounds ARE the size budget — the bake writes one ~4 KB density file per touched
chunk. The script also `rm -rf`s the world dir before writing, because the emitted file SET
shifts whenever the recipe's chunk or bucket set does and a blind write would leave the
difference behind as tracked, never-fetched dead bytes.

**Coverage is the point.** The world is deliberately small AND deliberately complete: it
exercises density chunks, multi-class meshing, the kit skinner and its backing surface,
indexed materials, kit instancing, and the op log the editor's world list classifies on. It is
what `worlds/index.json` names by default, and the editor's world drawer can retarget that.

**Who bakes, in the editor path: THE BROWSER.** It re-generates its own preview exactly and
uploads the file set to `generation.bake`, which only validates root-containment and writes.
This is load-bearing, not a convenience: **JSC and V8 diverge on transcendental `Math`**, while
local-frame geometry (mesh bytes, scatter, voxel membership) is cross-engine identical
(`docs/learnings/2026-07-06-cross-engine-placement-determinism.md`). The committed default
world is a `bun` bake and is sound because the field path is integer/lattice work — the class
of divergence that rule guards against was placement transcendentals in the retired region
world.

## 6. Testing posture

Pure math and contracts get unit tests; anything that walks, collides, or renders gets
`.gpu.test.ts` (bun-webgpu; tests must RUN, not skip — a skip is a failure); look/feel
is gated visually in Safari AND Chrome (renders-clean GPU tests cannot catch
wrong-output — the shadow-mapping lesson). Traversal repros must use the FULL collider
set and WALK (subset repros hide wedges — the 2.2.1 lesson).

**Probes of record** — the four GPU suites that stand after T2 retired the region world's 35
test files, each a bake→load→walk end-to-end through the REAL loader rather than a subset:

- `tests/field-world.gpu.test.ts` — two cases: dig a tunnel in memory, `bakeFieldWorld`, load
  through `loadWorld` and walk it; and the masonry wall probe (through the gap, blocked by
  the wall — collision is density, not material).
- `tests/field-cave-walk.gpu.test.ts` — the `cave` generator's output, walked.
- `tests/field-placements.gpu.test.ts` — props: the rock's measured 0.56/0.77 m climb
  thresholds and the base-anchored stalagmite blocking at scale 2 (§8).
- `src/agent/char-move-*.gpu.test.ts` — the locomotion probes (ground, step, slide, shove,
  levitation), the levitation one ported onto the field path at T2.

`tests/_helpers/field-walk.ts` is the shared field-walk harness those suites build on, split
out of the retiring region-world fixture before it went.

## 7. One Field (the 3.4+ recharter) — F1 "the medium" + F2a "the material field", as-built

- **Charter (2026-07-14, One Field F0–F6):** the world becomes ONE sparse chunked voxel
  field in `@furnace/core/field`; everything else is entities; two tool contracts
  (immediate brushes vs staged region-scoped generators that commit as reconfigurable
  entities); ops are the only mutation path — coordinate-keyed, bounded influence, the
  runtime NEVER replays (it loads a derived bake); mega-world invariants day one
  (chunk-local integer coords, no whole-world-in-memory assumption, pay-only-for-dirty).
  Grounded in `docs/research/2026-07-13-one-field-direction.md` +
  `docs/research/2026-07-14-field-precedent-research.md` (the five-lane precedent sweep
  that REFUTED the pure static walkability analyzer pre-commitment). De-bias rule: no
  design cites "we already have X" — existing code is donor material.
- **F0 (hybrid analyzer corpus probe, 2026-07-15):** zero false-negative misses on the
  validity-proven trap corpus, but the premise was disconfirmed in richer ways — 2 of 4
  specified classes don't reproduce against the current mover (the real climb ceiling is
  ~0.7 m, not `STEP_HEIGHT` 0.4), and the known-good false-positive load is unaffordable
  as-is: the analyzer CANNOT self-certify (needs capsule-aware navigability on top).
  F4 then closed that gap the advisor's way: `detectPits` supplies the minimal
  fall-aware navigability (the A1 pit-semantics ruling, after P-F4-3 refuted local
  thresholds at 323/1485 candidates on walkable ground), stage 2 ships as the per-flag
  `walk-probe.ts` filter (§3), and self-certification stays deliberately OUT of scope —
  the walk suites remain the gate (D-F4-1).
  Report: `docs/learnings/2026-07-15-analyzer-corpus-probe.md`; the requirements + the
  measured constants live in §3 "The walkability analyzer" (absorbed from
  `docs/backlog/` at F4). Surfaced the shipped mover levitation bug — fixed pre-gate (§3).
  (The probe harness that lived at `scripts/analyzer-probe/` was deleted at T2 with the
  region-world fixtures it generated its corpus from; the report is the record.)
- **F1 field worlds** — the format that became THE format. Render = baked per-chunk
  `.fmesh` meshes (`decodeMeshBlob` → geometry/mesh placed at chunk origins; positions stay
  chunk-local). Collision = per-chunk shell voxel colliders derived AT LOAD from the shipped
  `chunks/*.bin` density files via `field.chunkColliders` — colliders never serialize. Spawn
  = manifest `playerStart`/`playerYaw` (initially the bake-time editor camera pose; the
  committed world derives it, §5). Gate walked 2026-07-15 (dig → bake → spawn inside → walk,
  Safari). It landed as a second path that `world-loader.ts` branched into before the region
  world's compatibility check; T2 deleted the other branch and merged this one's module
  (`src/field/field-world.ts`) into `world-loader.ts`, so there is one loader with one owner
  of `LoadedWorld` (§2).
- **The artifact** (`worlds/<name>/`): `manifest.json` + `chunks/` (Int8 density, the
  authoring truth) + `oplog.json` + `meshes/*.fmesh` + `materials/*.mat` + `kit/*.json`
  (all derived). `bakeFieldWorld` in core is PURE and shared by the editor's export, the
  committed world's bake script (§5) and the headless GPU walk test. The editor authoring
  surface is the overlay cockpit (`editor-architecture.md` §11–§18).
- **F2a materials (2026-07-16, user-gated):** the field carries a per-cell material
  class (charter §2.1 made real — see `core-modules.md` §field). The dungeon supplies
  the catalog's world-materials half as DATA: `catalog/materials.json` (rock/dirt/
  moss-stone organic + masonry kit). The loader reads the manifest's **embedded material
  table** (artifact self-containment — the game never reads the editor catalog): per-class
  organic sub-meshes + the kit **backing** surface get per-class materials, and kit
  pieces (panels/tiles/posts/collar) load from per-chunk `kit/*.json` instance lists
  into ONE instanced draw per chunk (the `realize.ts` `MaterialCache` pattern; tint = piece
  color × variant jitter). A table-less bake still loads on the single-`STONE` path — the
  optional-field contract, not a legacy branch. **Collision is untouched**: masonry blocks
  the player purely because it is solid density (walk probe: through the gap, blocked
  by the wall — `tests/field-world.gpu.test.ts`). Kit writes are lattice-disciplined
  at the op layer (`assertOpValid`: box shapes on the 0.5 m lattice only — charter P4's
  grid-locked-kit posture, enforced setup-loud and re-checked on replay).

## 8. F3b — placements (props): loading + catalog + derived colliders, as-built

The dungeon re-enters the One Field arc as an ENTITY consumer: the cave/scatter generators
are pure `@furnace/core/field` surface (`core-modules.md` §field), and the dungeon's half is
the catalog + the placement-artifact half of `world-loader.ts`. The jurisdiction rule is
"if you can dig it, it's field; else it's an entity that carries its OWN collider" — props
render as instanced meshes and collide via per-record bodies, independent of the field's
density-derived shells.

- **The entity catalog** (`catalog/entities.json`) — a `{ version, archetypes }` file
  served at `/catalog/entities.json` (the `serve.ts` `/catalog/*` route), OUTSIDE any world
  dir: placements name archetype ids, so ONE catalog is shared across every field world. Per
  archetype: `id`/`name`, an ordered list of variant `.fmesh` mesh paths (package-relative,
  fetched as a leading-slash URL), a lit `material.litColor`, a `collision` primitive
  (`box` `halfExtents` \| `sphere` `radius` \| `capsule` `halfHeight`+`radius`), and a
  bake-time `scatter` config (density/minSpacing/scaleRange/orientation/hemisphere/variants —
  authoring input, consumed at BAKE, not load). The loader types only the fields it consumes
  (id, meshes, `material.litColor`, `collision`) and fetches setup-loud (a file the process
  did not write). Ships two archetypes today: `rock` (box collider, 3 variants) and
  `stalagmite` (capsule collider, 2 variants).
- **Placement loading** (`world-loader.ts buildPlacementInstances`) — when the manifest
  carries the optional `placements: "placements.json"` field, fetch it, `field.parsePlacements`
  → per-archetype `PlacementGroup`s, resolve each group's archetype in the catalog (setup-loud
  if absent — a stale/foreign world). Per (archetype, VARIANT): split the group's records by
  `variantIndex`, load that variant's `.fmesh` geometry, and `field.packPlacementMatrices` the
  records into ONE bulk `setInstanceMatrices` upload → one instanced mesh per (archetype,
  variant). All variants of an archetype share ONE `litInstanced` material tinted by the catalog
  `litColor` (the arbitrary placement quat shades correctly under the shader's uniform-scale
  path — see `packPlacementMatrices`' caveat). The placement instanced meshes join the field
  world's `instanced` draw list alongside the F2a instanced kit. Absent `manifest.placements`
  (a props-free world) → no placement instances; the F1/F2a shape still loads unchanged (the
  loader must not require the field).
- **Derived colliders at load (D-F3-10)** — colliders are DERIVED from the catalog collision
  primitive at load and NEVER serialized (the same posture as the chunk shell voxels). `createPlacementColliders` makes one STATIC body per record at the record's baked
  world pose (`quat`, plus the anchored position below), shaped by
  `placementCollider(collision, scale)`:
  - `box` → a `cuboid` scaled PER-AXIS (`halfExtents · |scale|`) — exact for an axis-aligned cuboid.
  - `sphere` → a `ball` of `radius × max(|scale| axis)`.
  - `capsule` → a `capsule { halfHeight, radius }` with BOTH scaled by `max(|scale| axis)`.

  The sphere/capsule max-axis rule is EXACT for scatter's uniform-scale records (`sx=sy=sz`), a
  conservative over-approximation only if a future non-uniform placement source appears. Every
  extent takes MAGNITUDES: a negative scale axis is a mirror, which moves no surface, and a signed
  extent would be a negative Rapier radius. A prop's static collider is what the player capsule
  (`PLAYER_CAPSULE_HALF_HEIGHT 0.6` / `RADIUS 0.3`) collide-and-slides against via the
  `CharacterMover` contract in §3.
- **Collider anchoring (F4 · D-F4-14)** — the catalog `collision` carries an optional
  `anchor: "center" | "base"`, and the loader positions each body with core's
  `field.collisionCenter(collision, record)`. `"center"` (the default, and every pre-F4 catalog's
  implicit meaning) returns the record's position unchanged. `"base"` lifts it by the collider's
  own Y half-extent (`field.collisionExtentY`) along the record's LOCAL +Y, so the collider's
  BOTTOM lands on the record position — the surface point scatter projected. That is the SAME
  function the F4 analyzer's `voxelizePlacements` rasterizes around (not a matching recipe), so
  the walkability flags describe the bodies this loader creates. The shipped catalog base-anchors
  the `stalagmite` (base-origin mesh, y∈[0,1]) and leaves the `rock` centred (centre-origin mesh).
- **Teardown** — the returned `destroy()` frees
  only THIS world's owned GPU resources (meshes + geometries + instanced kit + instanced
  placement meshes); every static body — chunk shell voxels AND per-prop placement colliders —
  dies with `physics.destroyWorld`, never freed here.
- **Small props are walkable-over (accepted, F4)** — a CENTRE-anchored prop sits half-buried at
  its surface-projection point, so its above-floor extent is small. Measured against the real
  mover, a rock box is CLIMBED at ≤~0.56 m and reliably BLOCKS at ≥~0.77 m above the floor (§3's
  `STEP_HEIGHT` 0.4 step-up + the rim-ride); scatter's authored rock sizes give 0.21–0.56 m
  above-floor, so the realistic range is stepped over. D-F4-14 answered the ANCHORING half of this
  (per-archetype `anchor`, above) and left the sizing half as an authoring choice: to make a prop
  block, scale it up or give it a base-origin mesh with `anchor: "base"`. An engine-side override
  (a `mesh` collision kind, or forced blocking) is the escalation path, unbuilt —
  `docs/backlog/engine-architecture/catalog-collision-escalation.md`. Walk-gate coverage:
  `tests/field-placements.gpu.test.ts` (the rock test records the 0.56/0.77 climb thresholds; the
  stalagmite test blocks at scale 2, and a ray probe pins its base-anchored top).
