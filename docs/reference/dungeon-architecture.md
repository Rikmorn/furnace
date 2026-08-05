# Dungeon architecture — as built

The `packages/dungeon` demo as it IS (post Epic 2 closure + Epic 3 through 3.3 and
One Field F0+F1, 2026-07-15). Chronological seal history: `docs/learnings/seals/`. Deferred work:
`docs/backlog/dungeon/`. This doc is current-state; when it disagrees with source, the
source wins — update this doc in the same change.

## 1. Doctrine (Epic 3)

Editor-time generation may use search-class algorithms — a human with reroll, caps, and
curation tools absorbs failure. Runtime generation is restricted to
construction-guaranteed or degrade-never-fail vocabularies via generator entities; the
guarantee class is an explicit, setup-loud field on the (future) socket contract.
The editor cockpit's loop shipped in 3.1: generate → reroll → freeze & bake → walk.

## 2. The game (`main.ts`)

- **The game boots a WORLD (3.3 W1–W3):** `world-loader.ts loadWorld` reads
  `worlds/index.json` → the named world's `manifest.json` → fragment-loads the ONE
  merged `world.scene.json` (cave + bore meshes), creates manifest cuboid bodies,
  re-expands voxel proxies (caves via `caveProxy`, bore connectors via `organicTunnel`
  from their manifest entries) + dressing deterministically, and — since W2 —
  RE-EXPANDS the grid class entirely (each grid region — `hall` or `maze` (W3) —
  rebuilds patch mesh + kit instances + voxel collider via `expandGridRegion`
  dispatched by algorithm; each `corridor` rebuilds its
  tube; neither bakes scene entities). Spawns at the manifest's
  `playerStart`/`playerYaw`. A missing index/manifest is a setup-loud throw (no live
  fallback) — the DEFAULT world ships as committed fixtures (`worlds/default/`, the
  `region-cavern.*` posture): since W3 it IS the PHASE-GATE world — pillar hall
  ↔ stair corridor (+1.5 m) ↔ maze; maze ↔ aperture ↔ box room; maze ↔
  collar-bore ↔ cave. A dev load banner logs
  world name + region seeds (the bake's identity — `bakedAt` is deliberately absent
  for byte-deterministic re-bakes).
- **`loadWorld` is the ONLY boot path.** There is no hand-authored level and no
  live-generation fallback: the game is exactly what the baked world says it is.
- Torch point light, motes, HDR `bloom→tonemap` + exponential fog (density 0.12,
  clear color = fog color).
- Player: Rapier capsule (`kinematicPosition`) driven by the custom `CharacterMover`;
  noclip dev toggle (V); shoving via `shoveDynamicBodies`.

## 3. Traversal & collision

- **`CharacterMover` (`char-move.ts`)** — custom collide-and-slide on core
  `physics.castRay`/`castShape`: horizontal shapecast slide pass, downward-shapecast
  ground pass (rim-riding: rests on the highest support in the capsule footprint — the
  rest sweep's lift is capped at the UPWARD-PROBED free headroom and the body rests
  `REST_GAP` 2 cm above support so no cast ever starts penetrating; fixed 2026-07-15
  after the F0 probe surfaced +0.4 m/frame levitation-while-grounded on
  sub-2.2 m-clearance floors, and the repro exposed a second exact-contact stall class
  on flat voxel floors — `tests/char-move-levitation.gpu.test.ts` guards both),
  explicit step-up, camera eye-height smoothing. Rapier's built-in KCC stays in core,
  unused. `physics.castRay` returns null until `physics.step` populates the broadphase.
- **Collision representation**: generated/organic geometry collides against
  field-derived **voxel proxies** (`proxy.ts` — sign-sampled cell centres, shell-only,
  off-grid neighbours treated as SOLID so the shell follows the isosurface;
  `voxelProxyPosition` seats corner-anchored Rapier voxels so `HALF_VOXEL = 0` aligns
  voxel cell (i,j,k) with its field/render cell). Anisotropic-Y cells
  (`PROXY_VOXEL_Y = 0.25` < `STEP_HEIGHT` 0.4) keep floor quantization below the step
  limit. Voxels are a confirmed BRIDGE around Rapier trimesh ghost collisions; endgame
  = collide the render mesh on Jolt (`docs/backlog/engine-architecture/jolt-backend-swap.md`,
  `docs/learnings/jolt-mesh-collision-spike.md`).
- **Walkability is single-sourced** in `walkability.ts` — `STEP_HEIGHT` 0.4 (the
  auto-step ceiling; sizes the step-up sweep and the ground-snap reach) and
  `SLOPE_LIMIT_COS` (55°, which normals count as ground). `char-move.ts` reads both;
  the voxel grids size their anisotropic Y cell below `STEP_HEIGHT`, and the built
  stair rise (0.25) sits under it, so climbable-by-construction holds
  (`GROUND_SNAP >= STEP_HEIGHT` is unit-asserted).

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

**Empirical constants.** These were single-sourced in `walkability.ts`; W4 deleted the
orphaned exports when their readers died with the mesh connector kit, so for those rows
this table is the only record outside git history.

| Constant | Value | Provenance |
|---|---|---|
| Ramp mount success (GPU-traced) | **47.2°** | slice 2.2.5b-B1 GPU traces |
| Ramp stall (GPU-traced) | **49.64°** | slice 2.2.5b-B1 GPU traces |
| `RAMP_MOUNT_LIMIT_RAD` (deleted at W4) | **45°** | safety margin below the 47.2° known-good mount |
| `STEP_MARGIN` (deleted at W4) | **0.05 m** | kept generated step rises strictly below `STEP_HEIGHT` |
| `stepCount(rise)` (deleted at W4) | `ceil(rise / (STEP_HEIGHT − STEP_MARGIN))` = `ceil(rise / 0.35)` | — |
| `STEP_HEIGHT` | **0.4 m** | live: `walkability.ts`, derived from `catalog/agent.json` |
| Slope stand-on limit | **55°** | live: `walkability.ts` `SLOPE_LIMIT_COS`, from `agent.slopeLimitDeg` |
| `STAIR_RISE` | one FINE cell (**0.25 m**) | live: `connector-built.ts` (`FINE` in `substrate/grid.ts`) |
| Voxel proxy Y-cell | **0.25 m** | live: `PROXY_VOXEL_Y` in `connector.ts` + `themes/cave.ts`; chosen below `STEP_HEIGHT` |

The deleted `RAMP_MOUNT_LIMIT_RAD` TSDoc's rationale, verbatim: *"the steepest ramp the
CharacterMover can climb onto from a FLAT approach … a ramp steeper than the mount limit
is a one-way slope in a walk-verb world (descending arrivals put a flat landing at every
ramp foot, so every ramp gets mounted from flat when walked back up). SLOPE_LIMIT_RAD
(55°) remains the physical stand-on/slide limit only."*

### Stage 2 — the verify probe (`walk-probe.ts`), as-built at F4

`analyzerVerify(opts)` in `src/walk-probe.ts` is stage 2 of the advisor (D-F4-10): for
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
suites remain the authoritative walkability gate. Tests: `tests/walk-probe.test.ts` —
plain `bun:test`, no GPU fixture, which is itself the headless-context payoff.

## 4. The generator library (the cockpit consumes it; the game and scripts too)

**Region contract (`region.ts`)** — themes are pure `(RegionParams) → RegionData`:
meshes + colliders + materials + `Connection`s + instanced dressing + `bounds`
(+ optional tight `envelopes` for mostly-air pieces) + provenance. `Connection.kind`:
`door` (built, standardized — the only kind a world connector joins) vs `tunnel-mouth`
(raw organic, pre-collar). A door sits at the CENTRE of its wall's thickness (flush tube
ends bury half a wall — sealed by construction). Two door sizes are live: the grid class
presents **2.0 × 3.0** (the grid standard below), the organic collar **2.0 × 2.8**
(`themes/cave.ts DOOR_OPENING` — the legacy opening; the bore passes both).

**Placement (`placement.ts`)** — rigid yaw-about-Y + translation `Placement`s and the
three operations the world pipeline runs on them: `join(a,b)` (the placement that seats
portal B onto portal A — continuous yaw + height), `placeConnection` (transform one
portal), `placePiece` (transform a whole `RegionData`:
meshes/colliders/bounds/connections/instances/placements).

**Frames convention**: the cave bakes WORLD-frame instance transforms (local scatter
offset by region origin — generated caves use origin `[0,0,0]`, so local ≡ pre-place).
Custom mesh vertex data stays LOCAL; world pose rides the mesh/entity transform (the
`.fmesh` convention). Grid content bakes no transforms at all — it re-expands at load.

**Themes**: `themes/cave.ts` — SDF graph (hub + floor-routed capsule tunnels,
`field.ts` primitives), Surface-Nets meshed, voxel-proxy collided; every raw mouth gets
a masonry **collar** (`built.ts mouthCollar`, embed 0.8 + proud 0.4, no CSG — edges bury
by interpenetration) presenting a door-class portal at collar mid-depth; `capped` bores
are sealed with `mouthCap` plugs. Internals are split for runtime re-derivation:
`caveSkeleton` (rng → graph → field → grid) feeds `cave()` AND the exported
**`caveProxy`** (field-only voxelization, no meshing) + **`caveDressing`** (scatter over
an already-decoded mesh — sound because core `rng.derive(label)` is state-independent).
The grid vocabularies (`themes/hall.ts`, `themes/maze.ts`) are described in §5.

**Dressing (`scatter.ts`)**: area-weighted surface sampling (mesh triangles or
`rectSurface`), slope/density/keep-out masks, blue-noise spacing, surface-aligned
orientation (ceiling items hang inward), per-instance jitter →
`instanceGroupsFromLayers` bakes GPU-ready `InstanceGroup`s. Postures:
`lit`/`emissive` material (emissive = glow only, NOT a light source) ×
absent/`solid`/`dynamic` collision (primitive colliders only — no trimesh; posture
consumes no RNG). `realize.ts` (`realizeRegion` + `MaterialCache` — NOT
concurrency-safe, realize sequentially) turns `RegionData` into GPU meshes, instanced
draws, static bodies, and shovable `DynamicProp`s with per-frame sync.

## 5. Worlds (3.3 — the world model)

- **`world-spec.ts`** — `WorldSpec`: declarative regions as a discriminated union
  (`{class:"field-organic", algorithm:"cave"}` | `{class:"grid-built",
  algorithm:"hall"}` | `{class:"grid-built", algorithm:"maze"}` (W3), each with
  exact `params`, `seed`, `placement {translation, yaw}`), connectors (`organic-tunnel | corridor | aperture | collar-bore`, joining
  `[regionId, portalIndex]` ends, optional `params {length, deltaY}`), `startRegion`.
  `validateWorldSpec`: no region isolated (portal-graph connectivity), no portal
  double-claim, and grid-built placements EXACT on the lattice —
  `snapGridPlacement` snaps 0.5-multiples + quarter-yaws within dust tolerance
  (1e-6) and throws beyond it. `DEFAULT_WORLD` = the W3 PHASE-GATE world (pillar
  hall ↔ stair corridor ↔ maze, + aperture box room + collar-bored cave off the
  maze); zero-placement `b`-end regions get their
  placement DERIVED from the `a` portal via `join` (search-free; the derived
  literal bakes; grid-built derivations snap). Derivation lengths: corridors read
  their `params`; an APERTURE derives at length 0 — adjacency, back-to-back
  shells (W3 fixed the 8 m-default gap that made derived apertures impossible);
  bores at the 8 m default.
- **`substrate/` (W2 — the two-resolution voxel substrate, spike mechanisms as
  production):** `grid.ts` coarse 0.5 m AIR/MASONRY cells → `rasterize` → fine
  0.25 m occupancy (`SUB=2`), dense per-region arrays behind accessors (the region
  IS the chunk; palette/RLE deferred behind the seam); `pieces.ts` procedural kit
  box catalog + seeded FNV variant hash; `skin.ts` per-face kit skin → cube-
  primitive `InstanceGroup`s with baked TRS mat4s (panels 0.06 proud + reveals;
  door frames from door METADATA, never occupancy); `carve.ts prepareCarve` — the
  single carve source: ONE call returns {carved fine grid, carved set, Surface-Nets
  patch + the box it meshed (`SUB+2` margin)}, consumed by suppression AND collider
  so render/collision cannot diverge; `CarveVolume` = capsule | FLAT-ended cylinder
  (wall openings use the cylinder + threshold Y-clip — a capsule's spherical end
  sweeps `radius` into rooms); the patch field reads off-grid-INSIDE-a-carve as
  air (a carve exiting the grid edge continues as the bore — else SN manufactures
  a lid: the W2 gate round-1 bug); `suppress.ts` E1 face-layer suppression;
  `collar.ts` 2-piece rim collar at suppressed↔kept junctions (incl. floor-rim);
  `collider.ts` fine occupancy → voxel-proxy shell (off-grid-as-solid rule).
- **`themes/grid-stamp.ts` (W3)** — the shared grid-vocabulary contract: the
  `GridStamp` shape every grid stamper emits (sealed coarse shell + door-portal
  metadata + doorSpecs + dressable anchors + optional stamp-owned
  `dressingLayers`), plus the extracted door construction (`doorAt`), door-lane
  validation, and floor-anchor scan — ONE implementation consumed by hall AND
  maze.
- **`themes/hall.ts`** — the hall stamper (mesh-trio presets):
  sealed shell + AIR interior + pillar lattice (`none|grid|colonnade`), flat floor,
  door-class portals on the OUTER shell plane with EXACT cardinal facings (portals
  are metadata — a connector opens the cells on consume), dressing anchors
  (interior minus pillar surrounds minus door lanes → `rectsSurface` scatter), and
  **door-lane validation**: a door whose centre walk lane is blocked by a pillar
  throws at stamp time (traversability by construction — the W2 gate found a
  pillar dead on a door axis, masked until then by an over-carving bug).
- **`themes/maze.ts` (W3)** — the second grid vocabulary, THE plug-point proof
  (one spec variant + dispatch arms; zero changes downstream of the stamp):
  growing-tree perfect maze + probabilistic braid (per-ORIGINAL-dead-end draw;
  braid 1 ⇒ zero dead ends) over an mx×mz cell lattice; passages 2.0 m, internal
  walls 0.5 m, height 3.0 m (pitch 5 coarse cells); door offsets in MAZE-CELL
  units index passage columns only, so the door-lane validation holds by
  construction; rubble-only dressing via stamp-owned `dressingLayers` (no
  shovable crates in 2.0 m passages). INTEGER-ONLY RNG (FNV-1a → `Math.imul`
  mixer + exact power-of-two division) — the grid class stays grep-auditably
  transcendental-free.
- **`connector.ts organicTunnel(a, b, seed, opts)`** — a bore connector OWNS its
  own volume: lattice-aligned grid, rock except a floor-routed capsule bore
  overshooting both portal planes (burial seals organic seams, no CSG); grid
  CLIPPED at the door planes so end-caps never voxelize inside cave air (locking
  test). `opts.extendA` (W2) extends the GRID past the A-end plane INTO the built
  shell band — collar-bores set exactly the 0.5 wall so the tube renders THROUGH
  the band and buries into the carve patch (interpenetration seals the seam ring;
  capped by test — further would put tunnel rock in room air). **`TUNNEL_RADIUS =
  1.6` MUST match the cave bore** — the W1 probe: overlapping air volumes collapse
  walkable space to their INTERSECTION; radius-match is the mitigation on organic
  seams, carve-union the durable fix (the BUILT side is already carve-union by
  construction, below). `boreAxis` reads the
  DOMINANT facing component (join float-dust safe).
- **`connector-built.ts` (W2)** — connectors may MUTATE joined regions' grids:
  `aperture` (door AIR through two abutting shells — pure mutation; first
  fixtured + walked in W3); `corridor`
  (own world-frame kit-skinned tube; portal ΔY ≠ 0 derives a fine-grid staircase —
  0.25 rise per 0.5 run + tread render capping the collision fill, riser-fit
  validated); `collarBore` (the W1 bore + `collarBoreCarve`: a flat cylinder carve
  through the built shell — ONE authoritative fine grid on the built side, the
  overlap-pinch class impossible there by construction; the collar frames the cut,
  no door stamp). `carveToLocal` single-sources world→local carve transforms
  (exact quarter-turns, Y-clip included) for bake AND load.
- **`world-build.ts realizeWorldSpec` — TWO-PHASE (W2):** (1) stamp + place
  (algorithms emit stamps/fields + portals; placements resolve, grid ones snap);
  (2) connect + finalize (connectors build volumes + register mutations; each grid
  region then rasterizes → carves → skins → collars → patches → collides via
  **`expandGridRegion` — the SHARED bake/load seam** — and places). Field regions
  keep the W1 single-step path. `playerStart` = 2 m inward of the start region's
  portal 0, +1.1 y. Deterministic in the spec (byte-identical runs, tested).
  **`assertDisjointRegionVolumes` (W3, charter §2.2):** placed region AABB
  interiors must be disjoint (flush faces — the aperture pair — pass; overlap
  past 1e-6 dust on all three axes throws naming the pair; connector volumes
  exempt, they interpenetrate by design). AABB-level is deliberately
  conservative (`disjoint-region-check-is-aabb-conservative.md`).
- **`bake.ts bakeWorld(spec, name?)`** → `BakeFile[]` under `worlds/<name>/`: ONE
  merged `world.scene.json` + `.fmesh` sidecars + `WorldManifest` LAST (crash-
  safety). GRID content bakes NO scene entities and NO sidecars — it re-expands at
  load (the dressing posture). Manifest: per-region `{class, algorithm, params,
  seed, placement, cuboids}` + per-connector entries as a kind union — bore kinds
  carry `{a, b, seed, radius, overshoot, extendA}` (recorded, never re-derived
  from constants) and ALL kinds carry `aRef`/`bRef` so the loader groups mutations
  by region. Byte-deterministic re-bake (no `bakedAt`); browser-bakes rule
  unchanged (grid re-expansion is integer/lattice + sqrt-only — the Pr-2 class is
  structurally absent; the committed fixture is a bun bake, sound).
- **Who bakes: THE BROWSER** (it re-generates its own preview exactly and uploads
  the file set to `generation.bake`, which only validates root-containment and
  writes). This is load-bearing, not a convenience: **JSC and V8 diverge on
  transcendental `Math` in placement** (join-yaw transforms), while local-frame
  geometry (mesh bytes, scatter, voxel membership) is cross-engine identical —
  never regenerate PLACEMENT in a different engine than the one that previewed it
  (`docs/learnings/2026-07-06-cross-engine-placement-determinism.md`).
- **Live-vs-baked parity is guarded placement-level** (`world-loader.gpu.test.ts`):
  a baked world's re-derived dressing must reproduce the live world exactly.
  Count-level assertions are known to lie (they passed while placements differed).
- **Probes of record (FULL collider set via `loadWorld` on in-memory bakes, never
  subsets):** `world-traversal.gpu.test.ts` (the PHASE-GATE world end-to-end,
  7 lanes since W3: stairs up/down, bore both ways, aperture both ways, and a
  BFS-solved maze-interior passage path walked leg by leg — the
  maze-walkability probe), `hall-walk.gpu.test.ts` (interior: aisle, cross-aisle,
  pillar stop, sealed-door stop), `stair-corridor.gpu.test.ts` (up/down + flat
  control, teeth-verified), `collar-bore.gpu.test.ts` (THE W2 premise: the
  carve↔bore seam, both directions + off-centre; off-axis lanes stop short of the
  cave interior — the pre-existing organic-KCC class,
  `organic-cave-mouth-offaxis-rimride.md`). Mesh-TOPOLOGY regressions are
  headless geometric tests (sightline probe in `substrate-carve.test.ts`; shell-
  band overlap in `connector-built.test.ts`; aperture doorway sightlines +
  flush-plane in `aperture-seam.test.ts` (W3) — its lanes are CELL-CENTRE-derived
  because the skin's grout gaps swallow any lattice-aligned lane, and even door
  widths centre doors ON cell boundaries; maze structure/braid/door units in
  `maze.test.ts`) — see
  `docs/learnings/2026-07-12-w2-render-collision-divergence.md`.
- Editor (W3): the **World panel** (`docs/reference/editor-architecture.md`
  §13.4) assembles a draft world (attach-on-add tree; connectors own doors),
  previews via worker `runWorld`, freeze-bakes a full-spec snapshot via
  `bakeWorld` + `generation.bake` (`cleanDir`), and optionally retargets
  `worlds/index.json` with a second cleanDir-free upload ("make this the game's
  world") — the manual index edit is gone. The engine seam is unchanged
  (extensions bundle; zero dungeon imports by value in the editor).

### Grid standards (decided at the 3.3 charter, recorded at W4)

Built content targets grid-friendly dimensions on the two-resolution substrate
(coarse 0.5 m cells on the global world lattice; fine 0.25 m occupancy —
`substrate/grid.ts` `CELL` / `FINE` / `SUB`):

- **Door opening: 2.0 w × 3.0 h m** (4 × 6 coarse cells — `themes/grid-stamp.ts`
  `DOOR_W_CELLS` / `DOOR_H_CELLS`) — the door-class portal every BUILT connector
  joins. (The organic collar still presents the legacy 2.0 × 2.8 opening.)
- **Wall thickness: 0.5 m** (1 coarse cell) — the hall/maze shell band and the
  maze's internal walls.
- **Pillar section: 0.5 m** (1 coarse cell — the only section the hall stamper
  emits; the lattice admits 1.0 m, nothing builds it today).
- **Stair rise: 0.25 m** (= one fine cell — `connector-built.ts` `STAIR_RISE =
  FINE`, per 0.5 m of run; the traversal-proven rise against `walkability.ts`
  `STEP_HEIGHT` 0.4).
- **Grid placements** snap translations to the 0.5 lattice and yaw to exact
  quarter-turns (`world-spec.ts snapGridPlacement`, setup-loud beyond 1e-6 dust).

Rationale (charter): a finer coarse grid to preserve the legacy 2.8 m door buys
nothing perceptible and costs case-table resolution everywhere.

## 6. Testing posture

Pure math and contracts get unit tests; anything that walks, collides, or renders gets
`.gpu.test.ts` (bun-webgpu; tests must RUN, not skip — a skip is a failure); look/feel
is gated visually in Safari AND Chrome (renders-clean GPU tests cannot catch
wrong-output — the shadow-mapping lesson). Traversal repros must use the FULL collider
set and WALK (subset repros hide wedges — the 2.2.1 lesson). Gate artifacts: the
probes of record in §5 (`world-traversal.gpu.test.ts` is the bake→load→walk end-to-end
over the world the player boots) plus `cave-entrance.gpu.test.ts` and the
`char-move-*.gpu.test.ts` locomotion probes.

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
  `docs/backlog/` at F4); harness kept at `scripts/analyzer-probe/` (seeds F4). Surfaced
  the shipped mover levitation bug — fixed pre-gate (§3).
- **F1 field worlds:** `src/field-world.ts` loads manifest **version 2**
  (`kind: "field"`) — `world-loader.ts` branches BEFORE `assertCompatible`, leaving the
  v1 region-world path byte-identical. Render = baked per-chunk `.fmesh` meshes
  (`decodeMeshBlob` → geometry/mesh placed at chunk origins; positions stay
  chunk-local). Collision = per-chunk shell voxel colliders derived AT LOAD from the
  shipped `chunks/*.bin` density files via `field.chunkColliders` — colliders never
  serialize, the same posture as the v1 proxies. Spawn = manifest
  `playerStart`/`playerYaw` (v0: the bake-time editor camera pose). Gate walked
  2026-07-15 (dig → bake → spawn inside → walk, Safari).
- **The artifact** (`worlds/<name>/`): `manifest.json` (v2) + `chunks/` (Int8 density,
  authoring truth) + `oplog.json` + `meshes/*.fmesh` (derived bake). `bakeFieldWorld`
  in core is PURE and shared by the editor's export and the headless GPU walk test
  (`tests/field-world.gpu.test.ts` — dig a tunnel in memory, bake, load through the
  real loader, walk through it). The editor authoring surface is the Field panel
  (`editor-architecture.md` §15).
- **F2a materials (2026-07-16, user-gated):** the field carries a per-cell material
  class (charter §2.1 made real — see `core-modules.md` §field). The dungeon supplies
  the catalog's world-materials half as DATA: `catalog/materials.json` (rock/dirt/
  moss-stone organic + masonry kit, the kit style ported out of `substrate/pieces.ts`
  constants). `field-world.ts` reads the manifest's **embedded material table**
  (artifact self-containment — the game never reads the editor catalog): per-class
  organic sub-meshes + the kit **backing** surface get per-class materials, and kit
  pieces (panels/tiles/posts/collar) load from per-chunk `kit/*.json` instance lists
  into ONE instanced draw per chunk (the realize.ts instancing pattern; tint = piece
  color × variant jitter). F1-shape manifests (no material fields) still load on the
  single-STONE path — back-compat tested. **Collision is untouched**: masonry blocks
  the player purely because it is solid density (walk probe: through the gap, blocked
  by the wall — `tests/field-world.gpu.test.ts`). Kit writes are lattice-disciplined
  at the op layer (`assertOpValid`: box shapes on the 0.5 m lattice only — charter P4's
  grid-locked-kit posture, enforced setup-loud and re-checked on replay).

## 8. F3b — placements (props): loading + catalog + derived colliders, as-built

The dungeon re-enters the One Field arc as an ENTITY consumer: the cave/scatter generators
are pure `@furnace/core/field` surface (`core-modules.md` §field), and the dungeon's half is
the catalog + the placement-artifact loader in `field-world.ts`. The jurisdiction rule is
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
- **Placement loading** (`field-world.ts buildPlacementInstances`) — when the v2 manifest
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
  primitive at load and NEVER serialized (the same posture as the chunk shell voxels and the v1
  proxies). `createPlacementColliders` makes one STATIC body per record at the record's baked
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
- **Teardown** — mirrors the v1 loader and the F1 field world: the returned `destroy()` frees
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
