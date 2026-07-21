# F3 research — traversable, vertically 3D cave/tunnel generation (precedent survey)

> Run 2026-07-21 at F3 ("smart objects & the cave") design time, feeding the
> cave-generator section of the F3 spec. Sibling lane:
> `2026-07-21-f3-scatter-placement-precedent-research.md`. Verification note: items
> marked **SOURCED** were read this session (fetched page, paper abstract, or actual
> source code). Items marked **INFERRED** are synthesis or widely-repeated community
> knowledge not pinned to a primary source.

## Q1 — Deep Rock Galactic

**Primary sources:** the official dev post "Below Decks at Ghost Ship: Cave generation in
Deep Rock Galactic" (Sep 6 2024) — [Steam news](https://store.steampowered.com/news/app/548430/view/4593196713081471258)
(content retrieved via the [Steam feed endpoint](https://store.steampowered.com/news/posts/?feed=steam_community_announcements&appids=548430&enddate=1726743173));
[PCGamesN interview with Ghost Ship](https://www.pcgamesn.com/deep-rock-galactic/deep-rock-galactic-unreal-engine-4)
(lead programmer Jonas Møller, CTO Henrik Edwards); companion video
["Cave Generation in DRG — Below Decks"](https://www.youtube.com/watch?v=zsyeC2vpVUQ).
There is **no dedicated GDC talk** on DRG cave gen — the only GDC Vault entry is a
live-ops talk ([GDC Vault](https://www.gdcvault.com/play/1028756/Independent-Games-Summit-Developing-a)). SOURCED.

**Room/corridor decomposition (SOURCED):**

- Caves assemble "**like pearls on a string: one room at a time, connected by narrow,
  winding tunnels**." Macro structure = a chain/graph of rooms; tunnels are generated
  connectors, rooms are authored.
- **100+ hand-crafted room templates**, each with "multiple internal 'randomizer'
  variants, so spawning the same template 20 different times would still produce 20
  unique rooms."
- Template markup language: "green and yellow lines determine the general shape of the
  room" (outer boundary / inner limit); "small orange orbs … mark space that might either
  be hollowed out to create extra volume, or filled in with a random protruding rock
  formation"; "medium orange half-spheres … mark potential exit paths for the room." So
  **exit ports are authored affordances on each template**, and the tunnel generator
  connects exits.
- Carving tech: "true mesh-carving" CSG on static meshes — "When you are drilling in the
  terrain, it's the same tech as when we are building the level" (Møller). One
  representation serves generation and runtime digging.
- Biome is applied after structure: "noise" (surface displacement/texturing) + "debris"
  (flora/hazards). Structure first, cosmetic roughness second.

**Verticality and traversability (SOURCED facts, INFERRED synthesis):**

- Verticality is deliberate and *not* smoothed away: "The most spectacular ones are the
  huge, 100 metre drops — when the stuff that we design intersects and creates entirely
  new caves" (PCGamesN). Intersecting authored volumes are allowed to create unplanned
  voids.
- The traversability model is **three-layered**: (1) rooms are walkable because they're
  hand-authored; (2) room-to-room connectivity is guaranteed *by construction* (tunnels
  are dug between exits — a tunnel cannot fail to connect); (3) vertical ascent is
  delegated to **class movement tools** (Scout grapple, Engineer platform gun making
  "almost any vertical surface have chest-high outcrops to climb on", Gunner zipline,
  Driller drills — [TheGamer Engineer guide](https://www.thegamer.com/deep-rock-galactic-complete-engineer-weapons-perks-tactics-tips-guide/),
  [Steam traversal guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2449934695))
  and the **universal fallback: nearly all terrain is pickaxe-destructible**
  ([DRG wiki: Terrain](https://deeprockgalactic.wiki.gg/wiki/Terrain) — only map-boundary
  rock resists; no structural-integrity sim; fully disconnected terrain crumbles).
- **What guarantees traversability: nothing formal.** No evidence of a ramp-synthesis or
  slope-validation pass. DRG's guarantee is "you can always dig a staircase with your
  pickaxe" plus authored room walkability. INFERRED: this is why DRG can tolerate 100 m
  drops that would be generation bugs in a game without digging. **The key negative
  result for furnace: DRG does *not* solve walkable-by-construction — it dissolves the
  problem with player tools.** Mission-select "Cave Complexity/Length" parameters exist
  ([wiki: Missions](https://deeprockgalactic.wiki.gg/wiki/Missions)) but their exact
  mapping to branching is undocumented (INFERRED: complexity ≈ branch count of the room
  graph).

## Q2 — Minecraft, Vintage Story, Valheim

### Minecraft (SOURCED: [minecraft.wiki/w/Cave](https://minecraft.wiki/w/Cave), [Henrik Kniberg, "Minecraft terrain generation in a nutshell"](https://www.youtube.com/watch?v=CSa5O6knuwI))

- **Carver ("worm") caves** (pre-1.18, still present): random-walk tunnels — "a series of
  irregular tunnels branching off and winding in other directions, which may cut through
  to the surface." Systems start from a room, "connected to 1–4 trunks with branches"
  (I/T-shaped variants). Vertical movement comes from the walk's pitch wandering plus
  **ravines** (canyon carvers). Community name: Perlin worms (e.g.
  [Roblox devforum walkthrough](https://devforum.roblox.com/t/perlin-worm-cave-generation/2397478):
  sample noise each step to steer heading, carve a radius per segment).
- **1.18 noise caves**: pure 3D density fields — **cheese** (large threshold blobs: "the
  black part of noise image becomes stone… white part becomes air"), **spaghetti** (air
  where the field is near its zero band: "the edge of black and white part of noise image
  becomes air"), **noodle** (thinner, 1–5 blocks). Spaghetti caves' "main function is to
  connect other caves to the large Cheese Caves"
  ([Sportskeeda summary](https://www.sportskeeda.com/minecraft/noise-caves-minecraft-1-18-update-names-features-spawn-locations));
  aquifers assign local water/lava levels.
- **Vertical connectivity is emergent** (worm pitch, tall cheese caverns, spaghetti
  linking layers). **Walkability is entirely unguaranteed** — sheer cheese-cave cliffs
  and noodle crawls are normal; the game relies on the mine/pillar fallback. Same class
  as DRG: destructible world = no need to guarantee.

### Vintage Story (SOURCED — actual shipped code: [GenCaves.cs in anegostudios/vsessentialsmod](https://github.com/anegostudios/vsessentialsmod/blob/master/Systems/WorldGen/Standard/ChunkGen/3.GenCaves/GenCaves.cs), read this session)

- A **worm carver with explicit anisotropy and explicit shafts**. Per chunk: random
  start, random horizontal heading, initial vertical angle ∈ ±0.125 rad; tunnel variants
  include **wide-flat tunnels** (verticalSize 0.25–0.45 — deliberately floor-friendly
  proportions) and tall narrow ones; `curviness` ∈ {0.035, 0.1, 0.5} steers heading
  drift; ellipsoid stamps (`SetBlocks(horRadius, vertRadius, …)`) carve the volume;
  radius evolves via gain/loss accumulators (bulges and pinches).
- **Branching:** horizontal branches recurse to depth 3, with branch probability tuned
  down near/above sea level (code comment: "Lower chance of branches above sealevel
  because Saraty does not like strongly cut out mountains"). **Vertical connectivity is
  explicit:** `CarveShaft` spawns near-vertical branches (pitch ≈ −π/2 ± 0.1, radius
  tapering to 67%) when the tunnel is wide (horRadius > 3) and high enough (posY > 60),
  1/60 chance per step.
- **Walkability: explicitly not guaranteed, and it shows.** Mods exist specifically to
  fix this: [CaveTweaks](https://mods.vintagestory.at/show/mod/14954) removes "vertical
  pit-falls" and surface pop-outs ("caves bob and weave around eventually reaching the
  surface, popping out, and then 10 blocks later curving back down");
  [All Caves Are Connected](https://mods.vintagestory.at/show/mod/48178) exists because
  vanilla systems aren't connected. VS is the best-documented cautionary tale: **worm
  carvers give you verticality as pitfalls, not as routes.**

### Valheim (SOURCED: [PC Gamer on frost caves](https://www.pcgamer.com/valheims-new-frost-caves-give-vikings-a-reason-to-love-the-mountains/), [GamesRadar](https://www.gamesradar.com/valheim-frost-cave-guide-mountain-biome-update/), [Max Dungeon Rooms mod page quoting decompiled generator](https://thunderstore.io/c/valheim/p/Digitalroot/Max_Dungeon_Rooms/), [Jötunn changelog: DungeonManager/CustomRoom/RoomConfig](https://github.com/Valheim-Modding/Jotunn/blob/dev/CHANGELOG.md))

- Valheim's overworld is a heightmap (no true 3D overhangs), so **all caves/crypts are
  instanced prefab dungeons**: hand-built Room prefabs with **RoomConnection sockets**;
  the generator loops `TryToPlaceOneRoom()` until all *required* rooms are placed and
  min-room-count is exceeded, or max attempts hit (verbatim decompiled loop on the mod
  page); endcap rooms plug open connections, divider rooms seal closed ones.
- Frost caves are "far more vertical" than crypts, with "decorated rooms, altars, and
  winding stairs" — i.e., **verticality is delivered as authored stair rooms**, walkable
  by construction because every piece is hand-made and sockets align. **Guarantee class:
  full construction guarantee via prefab vocabulary.**

## Q3 — Mined/hewn-look procedural spaces: shape grammars

- **Minecraft abandoned mineshafts** (SOURCED: [minecraft.wiki/w/Mineshaft](https://minecraft.wiki/w/Mineshaft))
  — the cleanest shipped "mined-look grammar": a start **parlor** (10×10, 1–4 exits per
  direction), **3×3 corridors** with support-beam frames every 4 blocks and rails,
  **5×5 dual-floor crossings** on wooden columns, and **staircase pieces that are
  diagonal tunnels** (no stair blocks — a 1:1 stepped descent piece). Growth: pieces
  attach to open exits recursively up to **depth 8** from an exit. Crucially it has an
  **interface rule for hitting natural voids**: "corridors generate a bridge of planks
  over empty space, either suspended with iron chains above or supported by log pillars
  below" — the mined grammar *responds* to intersecting organic caves rather than
  avoiding them.
- **Daggerfall** (SOURCED: [UESP: Daggerfall Dungeons](https://en.uesp.net/wiki/Daggerfall:Dungeons),
  [Game Developer: "Bake Your Own 3D Dungeons With Procedural Recipes"](https://www.gamedeveloper.com/design/bake-your-own-3d-dungeons-with-procedural-recipes))
  — dungeons of up to 32 **modular blocks on a 2D grid**, each block exposing two
  connecting passages per cardinal side; modular sets = "corridor, junction, room and end
  cap meshes, using locators to designate entrance/exit points." Notably generated **at
  dev time, then baked**.
- **Warframe** (SOURCED: [Daniel Brewer, "Managing Pacing in Procedural Levels in Warframe", GameAIPro](https://www.gameaipro.com/GameAIProOnlineEdition2021/GameAIProOnlineEdition2021_Chapter07_Managing_Pacing_in_Procedural_Levels_in_Warframe.pdf);
  [GDC 2013 coverage](https://mcvuk.com/development-news/gdc-13-handling-ai-in-procedural-levels/))
  — designer tiles with **size-matched portal sockets** ("a 5x3 portal can only connect
  to another 5x3 portal"), tiles typed by role: **Start / Connector / Intermediate /
  Objective / Exit**. Industrial-corridor aesthetic at scale, connectivity by socket
  construction.
- **DunGen (Unity asset; used by Lethal Company)** (SOURCED: [DunGen docs](https://dungen-docs.aegongames.com/latest/core-concepts/dungeon-generator/),
  [LethalDungeon template](https://github.com/rfsheffer/LethalDungeon)) — prefab Tiles +
  doorways, and a **graph-defined main path start→goal with optional branch paths**:
  main-path-first is the product's core concept.
- **Diablo 1** (SOURCED: [Boris the Brave analysis](https://www.boristhebrave.com/2019/07/14/dungeon-generation-in-diablo-1/))
  — per-tile algorithmic (not chunk prefabs), two stages: a "predungeon" **walkability
  array** first, tiles resolved second. Precedent for "decide walkable space abstractly,
  skin it later."
- **Vintage Story** again: `GenDungeons.cs` + `ModSystemTiledDungeons` in the shipped
  repo (SOURCED, read this session) is a **tiled-prefab dungeon system** (currently gated
  off with the comment "Disabled because unfinished") — even the worm-cave game reaches
  for tiles when it wants hewn spaces.

**Grammar consensus for mined-look:** small vocabulary of cross-section-true pieces —
corridor (straight sweep), junction/crossing, stair/ramp segment, room, endcap — attached
at typed ports, grown from a start piece with a depth budget. Nobody generates the mined
look from noise; everyone sweeps or sockets.

## Q4 — Guaranteeing traversability: construction vs post-hoc

**Construction-guaranteed (dominant among shipped systems):**

- **Spelunky** (SOURCED: [Darius Kazemi's analysis](https://takenapeveryday.wordpress.com/2013/10/21/the-path-ahead/)
  via [Procedural Generation tumblr](https://procedural-generation.tumblr.com/post/112071447898/darius-kazemi-wrote-a-pretty-thorough-look-at-the),
  [GameAsArt explainer](https://gameasart.com/blog/2016/03/11/spelunkys-procedural-level-generation-explained/))
  — generates a **solution path first** through the 4×4 room grid, then picks room
  templates *constrained by the path direction through them*; "the solution path is
  intended to allow the player to reach the exit without the need of bombs or ropes."
  Templates encode traversability (drops always ≤ survivable, climbs always ≤ jump
  height). The canonical "walkable by construction via template contracts" precedent.
- **Brogue** (SOURCED: [Anderoonies' write-up of Brian Walker's algorithm + source](http://anderoonies.github.io/2020/03/17/brogue-generation.html);
  [Walker's Roguelike Celebration talk](https://www.youtube.com/watch?v=Uo9-IcHhq_w)) —
  **room accretion**: each new room is attached where it fits against the existing
  structure; "the structure produced by accretion is inherently traversable (it's
  actually a tree rooted at the starting room), so there's no need to prune inaccessible
  rooms or add hallways." Loops added afterwards as a bonus, not as a repair.
- **Unexplored** (SOURCED: [Boris the Brave](https://www.boristhebrave.com/2021/04/10/dungeon-generation-in-unexplored/))
  — **cyclic graph grammar** (PhantomGrammar, ~5,000 rules): starts from a loop between
  entrance and goal ("the entrance and exit divide the loop into two independent arcs"),
  lock/key soundness maintained through every rewrite via tracked edges; *plus* a runtime
  repair valve — a "Pray For Help" function "determines what's blocking progress and
  automatically corrects issues."
- **Socket/prefab systems** (Valheim, Warframe, Daggerfall, DunGen, DRG's room chain,
  Minecraft mineshaft growth) — connectivity is a non-event: a piece only ever attaches
  at a matching port, so the reachability graph is correct by induction. Walkability
  inside pieces is the author's job.
- **Barotrauma** (SOURCED — shipped code read this session: [Level.cs](https://github.com/FakeFishGames/Barotrauma/blob/master/Barotrauma/BarotraumaShared/SharedSource/Map/Levels/Level.cs))
  — main path is generated **as a node polyline from start to end before any carving**;
  terrain is then removed along it. Connectivity by construction; a
  [generator bug report](https://github.com/FakeFishGames/Barotrauma/issues/12622)
  ("Level generator not removing terrain on paths") shows carve-the-path *is* the ground
  truth, with no validation net behind it.

**Post-hoc validation/repair (rarer, used where construction can't promise):**

- **Caves of Qud** (SOURCED: [GDC 2019 talk](https://gdcvault.com/play/1026263/Math-for-Game-Developers-Tile),
  [Roguelike Celebration talk](https://www.youtube.com/watch?v=fnFj3dOKcIQ),
  [talk notes](https://christianjmills.com/posts/dungeon-generation-via-wavefunctioncollapse-notes/))
  — WFC-generated maps get a connectivity pass; the talk notes: "can use algorithms like
  A* to find broken connectivity (e.g. find places to put doors)." WFC can't promise
  reachability, so they detect-and-carve after.
- **DRG / Minecraft / Vintage Story** — no validation at all; the **destructible-world
  fallback** substitutes for both guarantee and validation.

**Honest bottom line for Q4:** no shipped system found that synthesizes slope-constrained
ramps/stairs through organic 3D caves at generation time. The industry answer to walkable
verticality is binary: *author it* (stair prefabs, staircase grammar pieces, template
contracts) or *hand the player a shovel*. Construction-guarantee via authored vertical
pieces is well-precedented; construction-guarantee via *procedural* grade-clamped carving
exists only in reduced form (Barotrauma's variance-clamped path Y-steps, for submarines
not walkers). The "walkable by construction" requirement is therefore ahead of shipped
precedent in organic 3D — the transferable parts are the mechanisms below, not a whole
system to copy.

## Q5 — Algorithm shapes for "cave network in a bounded region with N boundary mouths"

- **Path-graph-first + carve along it (shipped, strongest match):** Barotrauma (code,
  SOURCED): start/end anchored **parametrically on the level borders**, main-path nodes
  placed at randomized X intervals with each node's Y **clamped to ±(range × variance/2)
  of the previous node** — a literal grade clamp on the route polyline — with
  intersection avoidance against existing tunnels; side tunnels branch off parent
  tunnels; caves are attached along tunnels; `EnlargePath` widens carved Voronoi cells to
  a minimum width. DRG (SOURCED) is the 3D sibling: room graph → authored room volumes
  stamped → winding tunnel carve between exit ports → noise paint.
- **Worm/agent carvers (shipped):** Minecraft carvers, Vintage Story GenCaves (code,
  SOURCED — heading + pitch random walk, curviness, ellipsoid stamps, recursive branches,
  dedicated near-vertical shaft agent). Cheap, organic, zero guarantees.
- **Noise density fields (shipped):** Minecraft 1.18 cheese/spaghetti/noodle (SOURCED) —
  great chamber *interiors* and connective tissue, no control over floors; note spaghetti
  = "near-zero band of a field" trick, which is an SDF-like sweep without an explicit
  path.
- **L-system skeleton → noise-perturbed metaballs → GPU isosurface (academic, closest to
  the furnace stack):** Mark, Berechet, Mahlmann & Togelius, *Procedural Generation of 3D
  Caves for Games on the GPU*, FDG 2015 ([PDF](http://julian.togelius.com/Mark2015Procedural.pdf))
  — "an L-System to emulate the expanded cracks and passages … a noise-perturbed metaball
  approach for virtual 3D carving … isosurface extraction of the modeled voxel data."
  Skeleton-then-stamp onto a voxel field is exactly the brush's shape.
- **Voronoi/Delaunay chamber partitioning (academic + shipped):** Santamaría-Ibirika et
  al., *Procedural Playable Cave Systems based on Voronoi Diagram and Delaunay
  Triangulation* ([IEEE](https://ieeexplore.ieee.org/document/6980738)); Barotrauma is
  the shipped Voronoi-carve instance. Chamber seeding in the academic version places
  sites and opens cells/edges — the nearest thing found to "Poisson chamber seeding";
  **no shipped, documented Poisson-disc chamber seeding for caves found** (INFERRED: it's
  folklore practice in devlogs, not documented precedent).
- **Speleogenesis simulation (academic, for shape realism only):** Boggus & Crawfis,
  *Procedural creation of 3D solution cave models* ([ResearchGate](https://www.researchgate.net/publication/268340693_Procedural_creation_of_3D_solution_cave_models))
  — water-transport approximation over cave patterns; *Procedural generation of 3D karst
  caves with speleothems* ([Computers & Graphics 2021](https://www.sciencedirect.com/science/article/abs/pii/S0097849321002132));
  *Generation of Complex Underground Systems … with Schematic Maps and L-Systems*
  ([Springer](https://link.springer.com/chapter/10.1007/978-3-319-46418-3_1)) — schematic
  graph → L-system growth. None address walkability.
- **Tools:** Watabou's Cave Generator ([itch](https://watabou.itch.io/cave-generator)) —
  design goal worth stealing even though the algorithm is undocumented: "I didn't want my
  caves to look like reskinned regular dungeons — rectangular shapes of rooms and right
  angles of corridors are too easy to spot," while keeping "well-defined caverns and
  tunnels, because clear zoning makes maps interesting."

## What transfers to our design

- **Adopt the universal two-layer split: macro skeleton graph (chambers = nodes, passages
  = edges, mouths = boundary-anchored terminals), then micro carving as SDF stamps onto
  the field.** Every credible system does skeleton-first (DRG rooms+tunnels, Barotrauma
  path nodes, FDG15 L-system+metaballs); nobody gets traversable networks out of pure
  noise. (SOURCED pattern)
- **Route passages as polylines with a clamped grade, Barotrauma-style:** clamp each
  successive node's vertical delta to a fraction of the step interval (Barotrauma's
  `variance` clamp is literally this in 2D), then quantize the carved floor to 0.25 m
  rises so every rise ≤ the 0.4 m step height. The polyline+clamp is SOURCED precedent;
  the floor quantization is our extension (INFERRED — no shipped organic-3D system does
  it).
- **Give the passage a mined cross-section by sweeping a flat-floored profile, not an
  ellipsoid.** VS's wide-flat tunnel variant (verticalSize 0.25–0.45) shows shipped
  precedent for anisotropic, floor-friendly profiles; the mineshaft grammar shows the
  full mined vocabulary: straight corridor, crossing, and **stair segments as first-class
  piece types** (Minecraft's "staircases are diagonal tunnels" = a stepped sweep, exactly
  a 0.25 m-rise passage). (SOURCED)
- **Deliver verticality as explicit route pieces, never as emergent pitch:** VS's
  `CarveShaft` proves worm-emergent verticality produces pitfalls players mod out;
  Valheim's frost caves prove "winding stairs" prefab rooms deliver walkable verticality.
  So: shaft/stair/switchback segment types on graph edges with the grade budget enforced
  per segment; helical ramps around a shaft are a natural extension of Valheim's
  winding-stair rooms (that last step is INFERRED — no shipped generator synthesizes
  helical ramps).
- **Handle the "mined until it hits a natural cave" mix with an explicit interface rule
  at the jurisdiction boundary** — Minecraft mineshafts *bridge* intersecting voids with
  planks+pillars rather than failing; DRG lets authored volumes intersect and celebrates
  the result. Give the mined grammar a "collar/portal" response when its sweep breaches a
  chamber (matches the existing B1 collar pattern). (SOURCED precedent for the rule's
  existence)
- **Chambers: rough walls, protected floor.** DRG applies noise as a biome "paint" pass
  *after* structural generation, with structure authored to survive it; do the same —
  organic displacement on walls/ceiling, floor band terraced/quantized after carving so
  chamber floors stay walkable. (Structure-then-noise SOURCED from DRG; floor-band
  protection INFERRED.)
- **Chamber templates with authored exit ports beat free-form chamber synthesis:** DRG's
  marker system (shape bounds + optional volumes + exit half-spheres) is the shipped way
  to get variety with reliable connection points — a small parametric chamber library
  with port markers, randomizer variants inside. (SOURCED)
- **Guarantee posture: construct, then cheaply verify.** The successful guarantee systems
  (Spelunky, Brogue, Unexplored, socket assemblers, Barotrauma) never *search* for
  traversability — they make it inductively true and at most run a repair/validation
  valve (Qud's A*-and-place-doors, Unexplored's Pray-For-Help). For furnace:
  walkable-by-construction carving + a post-bake headless walk/flood-fill check as a
  regression gate, not as a generation loop. (SOURCED pattern; aligns with the repo's
  existing headless mesh-topology test posture.)
- **Be honest about novelty:** no shipped game guarantees slope-constrained walkability
  through *organic* 3D caves at generation time — they author pieces or rely on digging
  tools. The furnace combination (organic skin, mined grammar, quantized floors, no
  player digging assumed at walk time) is a genuine synthesis, so premise-probe the
  floor-quantization + Surface-Nets interaction early (does a 0.25 m-stepped floor
  survive the mesher and the 47° capsule check?) rather than trusting any precedent to
  have proven it.
