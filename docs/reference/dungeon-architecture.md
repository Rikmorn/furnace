# Dungeon architecture — as built

The `packages/dungeon` demo as it IS (post Epic 2 closure + Epic 3 Slices 3.0–3.1,
2026-07-06). Chronological seal history: `docs/learnings/seal-log.md`. Deferred work:
`docs/backlog/dungeon/`. This doc is current-state; when it disagrees with source, the
source wins — update this doc in the same change.

## 1. Doctrine (Epic 3)

Editor-time generation may use search-class algorithms — a human with reroll, caps, and
curation tools absorbs failure. Runtime generation is restricted to
construction-guaranteed or degrade-never-fail vocabularies via generator entities; the
guarantee class is an explicit, setup-loud field on the (future, 3.3) socket contract.
The cockpit loop shipped in 3.1: generate → reroll → freeze & bake → walk.

## 2. The game (`main.ts`)

- **The game boots a WORLD (3.3 W1):** `world-loader.ts loadWorld` reads
  `worlds/index.json` → the named world's `manifest.json` → fragment-loads the ONE
  merged `world.scene.json`, creates manifest cuboid bodies, re-expands voxel proxies
  (caves via `caveProxy`, the tunnel connector via `organicTunnel` from its manifest
  entry) + dressing deterministically, and spawns the player at the manifest's
  `playerStart`/`playerYaw`. A missing index/manifest is a setup-loud throw (no live
  fallback) — the DEFAULT world ships as committed fixtures (`worlds/default/`, the
  `region-cavern.*` posture). A dev load banner logs world name + region seeds (the
  bake's identity — `bakedAt` is deliberately absent for byte-deterministic re-bakes).
- The hand-authored level (`level.ts`) and the wing path are RETIRED from `main.ts`
  (3.3 W1); their modules and tests remain in-tree until the W4 clean-cut sweep.
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
- **Walkability is single-sourced** in `walkability.ts` (`STEP_HEIGHT` 0.4,
  `STEP_MARGIN`, `SLOPE_LIMIT_RAD`, `RAMP_MOUNT_LIMIT_RAD` 45° — caps `chooseKind`'s
  ramp band below the empirical mount ceiling) — read by `char-move.ts`,
  `themes/box-room.ts`, and the router, so connectors are walkable by construction
  (`GROUND_SNAP >= STEP_HEIGHT` is unit-asserted).

## 4. The generator library (the cockpit consumes it; the game and scripts too)

**Region contract (`region.ts`)** — themes are pure `(RegionParams) → RegionData`:
meshes + colliders + materials + `Connection`s + instanced dressing + `bounds`
(+ optional tight `envelopes` for mostly-air pieces) + provenance. `Connection.kind`:
`door` (built, standardized — the only kind edges/route accept) vs `tunnel-mouth`
(raw organic, pre-collar). Doors standardize at **2.0 × 2.8** and sit at the CENTRE of
their wall's thickness (flush tube ends bury half a wall — sealed by construction).

**Frames convention**: the cave bakes WORLD-frame instance transforms (local scatter
offset by region origin — generated caves use origin `[0,0,0]`, so local ≡ pre-place);
box rooms bake LOCAL transforms. `placePiece` (`connect.ts`) transforms a whole
`RegionData` (meshes/colliders/bounds/connections/instances/placements) by a
`Placement {yaw, translation}`. Custom mesh vertex data stays LOCAL; world pose rides
the mesh/entity transform (the `.fmesh` convention).

**Themes**: `themes/cave.ts` — SDF graph (hub + floor-routed capsule tunnels,
`field.ts` primitives), Surface-Nets meshed, voxel-proxy collided; every raw mouth gets
a masonry **collar** (`built.ts mouthCollar`, embed 0.8 + proud 0.4, no CSG — edges bury
by interpenetration) presenting a door-class portal at collar mid-depth; `capped` bores
are sealed with `mouthCap` plugs. Internals are split for runtime re-derivation:
`caveSkeleton` (rng → graph → field → grid) feeds `cave()` AND the exported
**`caveProxy`** (field-only voxelization, no meshing) + **`caveDressing`** (scatter over
an already-decoded mesh — sound because core `rng.derive(label)` is state-independent).
`themes/box-room.ts` builds `pillarHall`/`greatHall` (walls/doorways/pillars/dais;
`doors: DoorSpec[]`, ≥1, one per cardinal side max).

**Dressing (`scatter.ts`)**: area-weighted surface sampling (mesh triangles or
`rectSurface`), slope/density/keep-out masks, blue-noise spacing, surface-aligned
orientation (ceiling items hang inward), per-instance jitter →
`instanceGroupsFromLayers` bakes GPU-ready `InstanceGroup`s. Postures:
`lit`/`emissive` material (emissive = glow only, NOT a light source) ×
absent/`solid`/`dynamic` collision (primitive colliders only — no trimesh; posture
consumes no RNG). `realize.ts` (`realizeRegion` + `MaterialCache` — NOT
concurrency-safe, realize sequentially) turns `RegionData` into GPU meshes, instanced
draws, static bodies, and shovable `DynamicProp`s with per-frame sync.

**Connectors (`connect.ts`)**: `join(a,b)` mates portal B onto portal A (continuous
yaw + height); `route(from,to)` emits a walkable-by-construction connector — corridor /
ramp / stairs chosen from the height delta (both ends MUST be door-class, setup-loud).
Floors overshoot both portals by `SEAM_OVERLAP`; stair floors emit flat end aprons.
Enclosures are vertical-walled rings quantized along the climb (`RING_RISE` 0.25 <
`CEIL_T` 0.3 → adjacent ring ceilings always overlap — sealed by construction); per-edge
`enclosure: "open"` = guardrails, no ceiling. DESCENDING connectors flatten for
`LANDING_LEN` 2.0 m (≥ `CLEARANCE_SEGMENT`, unit-asserted) before the lower portal so a
normal door works at a descent foot; ascending stays linear. Every end emits a
room-side threshold plate (0.6 deep, 0.015 proud lip) covering the receding floor-jamb
wedge at any join angle. `walkLineAt` single-sources the walk profile for geometry AND
the placer's clearance math (containment is unit-tested: enclosure ⊆ grown clearance).

**Topology (`topology.ts`)**: `generateWorldGraph(anchor, seed, config)` — plan
(sectors/rooms/loops per `TopologyConfig`; loop = cycle-closing edge between open
portals, the placement-hard part) then materialize each node.
**`materializeNode` builds the node's extra generator params ONCE and returns them**
(cave `mouths`/`capped`, pillarHall graph-derived `doors`), recorded as
`WorldNode.themeParams` — the provenance contract that lets bake/load repeat the exact
generator call (a bare `{theme,seed,origin}` re-run produces a DIFFERENT region; found
live at the 3.1 gate as scatter blocking doorways).

**Placer (`layout.ts` + `locus.ts`/`chains.ts`/`occupancy.ts`/`aabb.ts`)**:
deterministic collision-aware incremental graph embedding (Ma/Edgar shape) — pins
first, most-constrained-first order, seeded candidate seatings (`join` at sampled
lengths × yaw offsets), occupancy acceptance (piece envelopes, exact voxel-cell solids
for caves, segmented connector clearance air, portal exemptions), bounded backtracking
+ SA repair for cycles, setup-loud diagnostics on exhaustion. **All search is
`LayoutBudget`-bounded** (`DEFAULT_LAYOUT_BUDGET`; fail-fast — robustness lives in the
outer retry, not search depth).

**Retry orchestration (`world.ts`)**: **`worldAttempts(seed, config?, budget?)`** — a
pull-based iterator, the SINGLE owner of retry policy and `seed:k` derivation; attempt
k regenerates the WHOLE topology from the derived seed (a retry is "roll a new
dungeon", not "search harder"); first success wins. `buildWorld` drains it; the editor
cockpit drains it inside its generation worker (Slice 3.2.3 — `docs/reference/editor-architecture.md`
§13.6), so a search that creaks never blocks the main thread. `COCKPIT_CONFIG` (single
sector, 6 rooms) + `COCKPIT_BUDGET` (tight tier; `deadlineMs: 2000` — search-tier only,
`bakeWing` strips it, see below).

**`LayoutBudget.deadlineMs`** (Slice 3.2.3): an OPTIONAL wall-clock ceiling for one
`layoutWorld` call, default `Number.POSITIVE_INFINITY` (counted budgets only —
byte-identical to pre-slice behavior). The greedy guard sites use `searchExpired`
(counted budget OR deadline); the SA-fallback loops use `deadlineExpired` (deadline
ONLY — the counted budget is greedy's alone, so gating SA on it would starve the SA
rescue that fires precisely after greedy exhausts). Exhaustion is the same setup-loud
throw, now with a distinct `"layout: deadline <n>ms exceeded"` message. **D4 invariant:**
`bakeWing` forces `deadlineMs: Infinity` before calling `buildWorld` — bake replay is
counted-only deterministic, because a deadline is machine-speed-dependent and can only
PREVENT a success, never create one (a previewed success re-runs identically without it).

**`COCKPIT_ENVELOPE`** (`world.ts`): the measured cockpit envelope, one row per knob
value (rooms 2–12: `{rooms, singleShot, attempts, projected}`) — knob bounds,
per-size attempt counts, and the cockpit's reliability line all derive from this table.
Provenance: `scripts/measure-b2c.ts --envelope - - 2000`, run 2026-07-10, n=20
seeds/cell, loop=0.35, `deadlineMs=2000`, sequential cells on an unloaded machine
(rates carry ±~10 pp sampling noise). Per-row `attempts` targets ~95% projected
reliability at the measured single-shot rate, floored at 4, capped by a ~60 s worst
case ÷ the measured give-up p95; rooms 12 is a measured low-yield size (projected
0.693 at the cap — honest, not a bug). Regenerate the table when generator constants
OR `COCKPIT_BUDGET` (esp. `deadlineMs`) change.

## 5. Bake & load (the 3.1 pipeline)

- **`bake.ts bakeWing(seed, config, budget, name?)`** — PURE, returns `{files}`; the seed
  must be the winning derived seed (places on attempt 0). Emits ONE merged render-only
  `wing.scene.json` (ALL regions AND connectors in a single doc; box entities, NO
  rigidBody — the scene rigidBody path ignores `transform.scale`; resource keys are
  piece-prefixed so pieces don't collide), `.fmesh` sidecars for custom meshes (LOCAL
  vertices; world pose on the entity transform), and `manifest.json`: a top-level `scene`
  path + provenance `{seed, config, budget, generatorVersion}`, per-region `{theme, seed,
  placement, cuboid colliders, themeParams}` (NO per-entry `file`) + connector collider
  entries. `manifest.json` is the LAST file written — the crash-safety contract (an
  interrupted bake leaves no manifest, so `loadGeneratedWing` returns null and the game
  falls back to live generation; a torn wing never loads). `name` (default
  `generated-wing`) parameterizes the dir → `regions/<name>/`. Voxel shapes NEVER serialize.
- **Who bakes: THE BROWSER** (it re-generates its own preview exactly and uploads the
  file set to `generation.bake`, which only validates root-containment and writes).
  This is load-bearing, not a convenience: **JSC and V8 diverge on transcendental
  `Math` in placement** (join-yaw transforms + search accept/reject flips), while
  local-frame geometry (mesh bytes, scatter, voxel membership) is cross-engine
  identical — never regenerate PLACEMENT in a different engine than the one that
  previewed it (`docs/learnings/2026-07-06-cross-engine-placement-determinism.md`).
- **`wing-loader.ts loadGeneratedWing`** — manifest present → fragment-load the ONE merged
  doc (`loadScene({world, fragment: true})`), create static bodies from the manifest
  cuboids per piece, regenerate each cave's voxel proxy (`caveProxy` from `themeParams`,
  `placePiece`-seated), re-expand dressing deterministically (`caveDressing` over the
  DECODED baked mesh; box themes re-run with `themeParams`) and realize it; returns the
  same handle shape as `realizeRegion`. 404 → `null` → live path. Stale-bake guard: a
  pre-consolidation manifest (no `scene` field) throws ("re-bake"). This load-time
  re-expansion is deliberately the embryo of 3.3's generator-entity socket.
- **Parity is guarded placement-level** (`tests/bake-dressing-parity.test.ts`): full
  cuboid/proxy/dressing byte-parity live-vs-baked on the 3.1 gate's own seed.
  Count-level assertions are known to lie (they passed while placements differed).
- Baked output (`regions/<name>/`, default `generated-wing/` — wings are nameable) is
  user-generated content. Only the DEFAULT `regions/generated-wing/` is gitignored AND
  biome-ignored (both globs hardcode that name); a non-default `regions/<name>/` is
  user-generated content too but is NOT yet ignore-scoped (the worlds-index landed in W1;
  generalizing the wing globs remains a W4 cleanup). Consolidated in 3.2.1 to a single
  `wing.scene.json` (+ `manifest.json` + `.fmesh` sidecars); a smaller re-bake leaves no
  orphans because the daemon's `generation.bake` `rm -rf`s the previous bake dir
  (`cleanDir`) before writing.

## 5b. Worlds (3.3 W1 — the go-forward model; wings above retire at W4)

- **`world-spec.ts`** — `WorldSpec`: declarative regions (`class` — `field-organic`
  this slice; `algorithm`; exact `params`; `seed`; `placement {translation, yaw}`),
  connectors (`organic-tunnel`, joining `[regionId, portalIndex]` ends), `startRegion`.
  `validateWorldSpec` enforces the charter rule: no region isolated (connectivity over
  the portal graph). `DEFAULT_WORLD` = two caves + one tunnel; regions with a zeroed
  placement that sit at a connector's `b` end get their placement DERIVED from the `a`
  portal via `join` at `DEFAULT_TUNNEL_LENGTH` (search-free; the derived literal bakes).
- **`connector.ts organicTunnel(a, b, seed, opts)`** — the organic↔organic connector
  OWNS its own volume: a lattice-aligned grid around the portal segment, rock except a
  floor-routed capsule bore overshooting both portal planes (burial seals the seams, no
  CSG); grid CLIPPED at the door planes so bore end-caps never voxelize inside cave air
  (locking test). **`TUNNEL_RADIUS = 1.6` MUST match the cave bore** — the W1 probe
  found overlapping air volumes collapse the walkable envelope to their INTERSECTION
  (0.95 tube inside a 1.6 bore = voxel ceiling pinch, wedge); radius-match is the
  mitigation, shared-lattice/carve-union composition is the durable fix
  (`docs/backlog/dungeon/world-connector-bore-and-overlap.md`).
- **`world-build.ts realizeWorldSpec`** — validate → run algorithms → `placePiece` →
  derive placements → build connectors from PLACED portals → compute `playerStart`
  (2 m inward of the start region's portal 0, +1.1 y) — deterministic in the spec.
- **`bake.ts bakeWorld(spec, name?)`** → `BakeFile[]` under `worlds/<name>/`: ONE
  merged `world.scene.json` (region-id-prefixed resource keys) + `.fmesh` sidecars +
  `WorldManifest` LAST (crash-safety, same tested contract as wings). Manifest carries
  per-region `{class, algorithm, params, seed, placement, cuboids}` (the provenance
  contract — voxels never serialize, proxies re-expand) + per-connector re-expansion
  inputs `{a, b, seed, radius, overshoot}` + `playerStart`/`playerYaw`. Byte-
  deterministic re-bake (no `bakedAt`). Browser-bakes rule unchanged (placement bakes;
  only local-frame ops re-expand — the committed fixture is a bun bake, sound under
  the same rule). Parity: `world-loader.gpu.test.ts` guards placement-LEVEL dressing
  parity for the world path (mirroring `bake-dressing-parity.test.ts`).
- **The probe of record:** `tests/world-traversal.gpu.test.ts` walks the real
  `CharacterMover` across the FULL default-world collider set (via `loadWorld` on an
  in-memory bake — never a subset): A→tunnel→B, reverse, wall-hug lanes across both
  seams.
- Editor: the Generation panel drives the WORLD flow (worker `runWorld`/`bakeWorld` —
  deterministic, no attempts machinery; daemon `generation.bake` writes `worlds/<name>/`
  with the same root-contained + `cleanDir` posture). Index-switching is a manual
  `worlds/index.json` edit until W3's assembly UX.

## 6. Testing posture

Pure math and contracts get unit tests; anything that walks, collides, or renders gets
`.gpu.test.ts` (bun-webgpu; tests must RUN, not skip — a skip is a failure); look/feel
is gated visually in Safari AND Chrome (renders-clean GPU tests cannot catch
wrong-output — the shadow-mapping lesson). Traversal repros must use the FULL collider
set and WALK (subset repros hide wedges — the 2.2.1 lesson). Gate artifacts:
`wing-roundtrip.gpu.test.ts` (bake→load→walk), `traversal.gpu.test.ts` (fuzz lanes),
`area-traversal.gpu.test.ts`, `world-seams.test.ts` (no capsule-scale unsupported disc
along any edge walk line).
