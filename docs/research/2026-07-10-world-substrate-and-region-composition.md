# World substrate & region composition — research pass (2026-07-10)

Pre-decision research for the post-3.2.3 world/region phase (Epic 3 recharter). Three
web-research sweeps run 2026-07-10, distilled from agent reports; load-bearing claims
carry their sources. Labels: **[S]** sourced (page read during the sweep), **[I]**
inference from sourced facts, **[GK]** general knowledge.

## Question

The measured placer envelope caps reliable generation at ~12 rooms
(`COCKPIT_ENVELOPE`, `world.ts`) — a property of free-space rigid placement at room
granularity, not of the graph abstraction. The proposed direction: worlds composed of
regions (each with a native interior algorithm), connected by "carving". Three
substrate candidates for built geometry:

- **S1 — continuous mesh world**: built = manifold solids placed freely (status quo),
  connections via mesh CSG; organic = SDF fields (status quo).
- **S2 — voxel substrate + per-class skinning**: one occupancy/field grid is
  authoritative for composition, carving, and collision; built regions render as
  authored kit pieces selected by grid lookup; organic regions Surface-Nets the same
  substrate (status quo for the cave).
- **S3 — uniform isosurface**: everything meshed from the field.

## Sweep 1 — how shipped games compose and connect regions

Per-game mechanisms (condensed; full table in the sweep report):

| System | Macro | Connection mechanism |
|---|---|---|
| Deep Rock Galactic | room graph ("pearls on a string") from seed | rooms = authored carve-primitive templates (spheres/planes) subtracted from one solid via custom mesh-carving; tunnels attach at authored exit-dome markers; overlapping carves merge by construction ([dev blog](https://steamcommunity.com/games/DeepRockGalactic/announcements/detail/4593196713081471259), [PCGamesN interview](https://www.pcgamesn.com/deep-rock-galactic/deep-rock-galactic-unreal-engine-4)) |
| Minecraft structures | jigsaw recursion | named/oriented socket blocks face-to-face + AABB reject; piece↔terrain via `terrain_adaptation` (bury/encapsulate/beard — the field yields) ([wiki](https://minecraft.wiki/w/Jigsaw_structure)) |
| Diablo 1/3, PoE, Warframe | per-level algorithms / tilesets | tiles snap to grid, connect at standardized doorways/portals ([Diablo 1 teardown](https://www.boristhebrave.com/2019/07/14/dungeon-generation-in-diablo-1/), [Warframe tile sets](https://wiki.warframe.com/w/Tile_Sets)) |
| Unexplored | cyclic graph grammar | graph is *born embedded* on a 5×5→50×50 grid resolution ladder — no separate embedding step to fail; built + cellular-automata-cave styles render into one homogeneous tilemap ([teardown](https://www.boristhebrave.com/2021/04/10/dungeon-generation-in-unexplored/)) |
| Lethal Company (DunGen) | main path + branches | doorway sockets + AABB reject + whole-generation retry; navmesh per-tile prebake + runtime links ([DunGen docs](https://dungen-docs.aegongames.com/latest/core-concepts/dungeon-generator/)) |
| Valheim | zone system | dungeon interiors instanced in the sky; entrance = teleport ("portal-decoupling") ([Jotunn zone docs](https://valheim-modding.github.io/Jotunn/tutorials/zones.html)) |
| NMS / Astroneer | continuous field | voxel density field, per-chunk re-polygonization; rigid POIs buried/overlaid on the field ([GDC 2017](https://www.gdcvault.com/play/1024265/Continuous-World-Generation-in-No), [Astroneer blog](https://blog.astroneer.space/p/going-faster/)) |
| UE World Partition | grid cells (streaming only) | no seams — geometry never cut; cells are a memory partition ([Epic docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine)) |

**Synthesis.** Connection models that ship, by prevalence: (1) portal/socket
standardization — dominant for hand-authored pieces; (2) single-representation
carving — dominant for organic/destructible; (3) burial/field-yields — the standard
rigid↔field boundary; (4) portal-decoupling. **True heterogeneous mesh CSG at region
seams: no shipped example found** [I — absence after a broad sweep]. Runtime mutation
ships only as field carving within one medium — no shipped game re-topologizes a room
graph with geometry+collision rebuild around the player.

## Sweep 2 — mesh booleans in the browser (S1's enabling tech)

**Verdict: viable.** [Manifold](https://github.com/elalish/manifold) (npm
`manifold-3d`, Apache-2.0) is the engine OpenSCAD now defaults to
([announcement](https://fosstodon.org/@OpenSCAD/113256867413539398)), ships in Blender
4.5's boolean modifier
([release notes](https://developer.blender.org/docs/release_notes/4.5/modeling/)), and
backs Babylon.js CSG2
([docs](https://doc.babylonjs.com/typedoc/classes/BABYLON.CSG2)). wasm ≈ 204 KB gzip
(measured in-sweep). Est. ~10–300 ms/boolean at 10k–200k tris in serial wasm [I].

- **The piece-soup constraint dissolves by construction**: each kit box enters as its
  own manifold solid; n-ary `Manifold.union` of interpenetrating solids is the defined
  winding-number operation; coplanar/buried faces are handled by symbolic perturbation
  ([wiki](https://github.com/elalish/manifold/wiki/Manifold-Library)). What must never
  happen: feeding a pre-merged triangle-soup buffer (→ `NotManifold`,
  [discussion](https://github.com/elalish/manifold/discussions/549)).
- Costs: cut-face attribute policy (normal rebuild, UV strategy); thin-feature/grazing-cut
  design rules; manual wasm memory management; **collision does not follow the carve**
  (box colliders don't survive holes) — the open engineering question of S1.
- wasm float arithmetic is IEEE-deterministic across JS engines [GK] — the Pr-2
  JSC≠V8 failure class structurally can't recur through this path (cheap spike to confirm).
- Alternatives dominated: three-bvh-csg (non-manifold *output* poisons carve chains,
  [IMPLEMENTATION.md](https://github.com/gkjohnson/three-bvh-csg/blob/main/IMPLEMENTATION.md));
  CGAL-wasm (hangs, [emscripten #21580](https://github.com/emscripten-core/emscripten/issues/21580)).
- **S3 killed**: plain Surface Nets cannot represent sharp creases (door frames fillet
  at ~voxel radius); Dual Contouring's fixes have documented spike/self-intersection
  failure modes on large flat surfaces — still called open by practitioners
  ([Keeter 2026-07-03](https://www.mattkeeter.com/blog/2026-07-03-meshing/),
  [BorisTheBrave DC tutorial](https://www.boristhebrave.com/2018/04/15/dual-contouring-tutorial/)).
  Don't round-trip authored architecture through a field.

## Sweep 3 — voxel substrate + kit skinning + isosurface organic (S2)

**As one complete system: not shipped anywhere found. Its three legs are individually
proven; one corner is genuinely novel.**

1. **Grid-authoritative composition + kit skinning — proven twice.** Legend of
   Grimrock: 3 m cells, per-cell floor/wall/pillar panel kit, wall-set theming,
   grid-native traversal; Grimrock 2's outdoors stayed grid-authoritative (per-tile
   painted heightmap) ([Building the Dungeon](http://www.grimrock.net/2011/09/08/building-the-dungeon/),
   [outdoor guide](https://www.grimrock.net/modding/outdoor-environments-and-water/)).
   Townscaper/Bad North: boolean **corner-occupancy indexes authored tiles** — exactly
   the proposed lookup — with tiles authored as corner segments and deformed into
   irregular cells ([How Townscaper Works](https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making),
   [Sylves tutorial](https://boristhebrave.com/docs/sylves/1/articles/tutorials/townscaper.html)).
   Caveat: Grimrock's *collision* is square-to-square party movement, not our free
   capsule — its precedent covers composition/rendering, not traversal [I].
2. **Sub-meter structural voxels + authored shapes + smooth terrain in one world —
   shipped.** 7 Days to Die: 1 m grid, ~1200 authored block shapes, terrain-class
   voxels rendered smoothed in the same grid; the kit↔terrain seam is a known-ugly
   problem (community seam-fix mod exists)
   ([Block wiki](https://7daystodie.wiki.gg/wiki/Block),
   [seam mod](https://www.nexusmods.com/7daystodie/mods/2893)). Space Engineers: 0.5 m
   blocks + voxel planets with intersection rules; **SE2 unifies on one 25 cm placement
   grid with block sizes any multiple** — the datapoint that coarse-kit-over-fine-grid
   layering coheres ([SE2 unified grid](https://spaceengineers2.wiki.gg/wiki/Unified_Grid_System)).
   Asteroids persist as seed+edits — matches our deterministic re-expansion posture
   ([Marek Rosa](https://blog.marekrosa.org/2014/12/space-engineers-super-large-worlds_17/)).
3. **Crisp authored + rough at the cut — proven, at cost.** Rainbow Six Siege:
   fully-procedural material-based cutting of authored walls, explicitly "vastly more
   complex than pre-fragmented" ([GDC 2016](https://www.gdcvault.com/play/1023003/The-Art-of-Destruction-in),
   [PCGamesN](https://www.pcgamesn.com/plaster-blaster-rainbow-six-siege-s-fully-procedural-destruction-system-explained)).
   The Finals chose pre-authored Houdini fracture seams instead
   ([SideFX](https://www.sidefx.com/community/making-the-procedural-buildings-of-the-finals-using-houdini/)).
4. **The novel corner (no precedent found):** carve → locally re-run Surface Nets over
   the carved occupancy inside otherwise kit-skinned architecture, blended at the
   case-table boundary. Each half is proven; the fusion is not. Probe territory.

**Case-table arithmetic** ([Landow, built & measured](https://www.landow.dev/tech/wfc-02-advanced-wfc/),
[BorisTheBrave classification](https://www.boristhebrave.com/2021/11/14/classification-of-tilesets/)):
3D corner-occupancy 256 configs → **53 unique under yaw+mirror** (gravity forbids full
rotation-group reduction; two-sided authored walls forbid marching-cubes'
complementation to 15) → **~26 modeled micro-pieces** via octant decomposition.
Townscaper-class full reskin ≈ 500 tiles; Bad North 300+ — but those are *hand-sculpted
art* budgets; furnace's kit baseline is procedurally generated (`built.ts`), so the
floor cost is code, with authored variants additive later [I]. Trim/door-frame
distinctions push corner-only toward blob-class (47 in 2D) — the case-count explosion
risk to watch.

**Two-resolution scheme (design correction).** Shipped kit cells are person-scale
(Grimrock 3 m, 7DTD 1 m, SE 0.5 m) — nobody skins a 0.25 m grid (instance counts +
trim-scale case authoring explode). The precedent-consistent shape: a **coarse
architecture grid (≈1–3 m) for kit selection**, layered over the **fine 0.25 m
occupancy for carve/collision**, kit placement writing its footprint into the fine
grid. [I, anchored by SE2]

**Seam handling patterns that ship:** portal separation; substrate-coexistence rules;
dual-skinning with visible seam (7DTD — the cautionary tale); **authored transition
tiles** (Bad North's beach cases) — the precedented answer, and it matches the
existing B1 collar doctrine.

**Memory napkin [I]:** 200×200×30 m @ 0.25 m = 76.8 M cells; ≤77 MB dense byte array,
single-digit MB chunked+palette. Chunked arrays over octrees at this scale
([0fps analysis](https://0fps.net/2012/01/14/an-analysis-of-minecraft-like-engines/)).
Non-issue.

## Implications for furnace

- The macro direction (region graph + native interior algorithms + standardized
  boundaries) is uniformly supported; the room-count ceiling is a free-space-embedding
  property, and every shipped analogue avoids that embedding (grids, carve media,
  sockets + cheap rejection, or graphs born embedded).
- S3 is dead. S1 and S2 are both viable; S2 additionally dissolves S1's two hardest
  open items (per-class-pair seam implementations; collision follow-through after
  carves) at the cost of a built-vocabulary rewrite, the 90°-family constraint on kit
  masonry, and two under-evidenced fusion points.
- Whichever substrate wins, the connector's *contract* can be uniform ("carve") with
  per-class implementation — the shipped pattern in every mixed system.

## Probe register (predates any plan commitment — working-standards §Planning)

- **P0 (napkin):** existing kit dimensions (door 2.0×2.8, wall thicknesses, corridor
  widths, RING_RISE 0.25) vs candidate coarse-grid sizes; pick the architecture-grid
  resolution on paper.
- **P1 (demand):** stamp `pillarHall` onto the two-level grid, render raw boxes — does
  the structure read at the chosen resolution?
- **P2 (capability, the decider):** minimal procedural skin kit (~26 octant
  micro-pieces: wall/floor/ceiling/frame) over P1's grid, side-by-side with today's
  mesh version; then carve a breach (local Surface-Nets patch) and walk it on the
  voxel collider. Tests both under-evidenced fusion points at once.
- **Shelf (only if S1 re-enters):** Manifold capability spike on an actual
  `pillarHall` piece list + cross-engine wasm-determinism check.
