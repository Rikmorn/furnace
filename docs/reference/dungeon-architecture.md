# Dungeon architecture — as built

The `packages/dungeon` demo as it IS (post Epic 2 closure + Epic 3 through 3.3,
2026-07-13). Chronological seal history: `docs/learnings/seal-log.md`. Deferred work:
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
  ground pass (rim-riding: rests on the highest support in the capsule footprint),
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
  seams, carve-union the durable fix (`world-connector-bore-and-overlap.md`; the
  BUILT side is already carve-union by construction, below). `boreAxis` reads the
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
