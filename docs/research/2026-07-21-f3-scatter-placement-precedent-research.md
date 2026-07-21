# F3 research — scatter/detail-placement brushes & placement artifacts (precedent survey)

> Run 2026-07-21 at F3 ("smart objects & the cave") design time, feeding the scatter-brush
> + catalog-entity-half + placement-artifact sections of the F3 spec. Sibling lane:
> `2026-07-21-f3-traversable-cave-generation-research.md`. Legend: **[SOURCED]** = stated
> in a cited document fetched this session. **[SOURCED-community]** = forum/wiki/community
> docs, not vendor docs. **[INFERRED]** = synthesis from sourced facts, not directly
> verified.

## Q1. Unreal Foliage + Unity terrain painting

### Unreal Foliage Mode (paint tool)

**Interaction model [SOURCED]** — Brush with `Brush Size`, `Point Density` (a *multiplier*
of the per-foliage-type Density), `Erase Density` (target density to erase down to, not
binary delete), `Single Instance Mode` (one instance at cursor), Shift-drag = erase.
Additional tools: `Fill` (flood a whole target surface), `Reapply` ("selectively change
parameters for Foliage Instances already placed in the world" — retroactively re-applies
changed per-type settings to existing instances), plus Select/Lasso/instance-level move
tools. ([Foliage Mode, UE 5.8 docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/foliage-mode-in-unreal-engine))

**Per-archetype settings [SOURCED]** — the `UFoliageType` asset carries, per archetype
([UFoliageType API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Foliage/UFoliageType),
corroborated by [World of Level Design UE5 prop-painting tutorial](https://www.worldofleveldesign.com/categories/ue5/placing-props-foliage-mode.php)):

- `Density` ("instances per 1000x1000 unit area"), `Radius` (min distance between instances)
- `AlignToNormal` + `AlignMaxAngle` (max degrees it may rotate away from vertical to meet
  the surface — normal-alignment is *clamped against gravity*, a blend knob)
- `RandomYaw`, `RandomPitchAngle`
- `GroundSlopeAngle` (valid slope range filter), `Height` (valid altitude range, min/max Z)
- `ZOffset` (range, to sink/float instances relative to pivot), `Scaling` mode +
  `ScaleX/Y/Z` min–max ranges
- `CollisionWithWorld` (overlap test before placing), `LandscapeLayers`/
  `ExclusionLandscapeLayers` + weight thresholds (paint-mask filters)
- Instance settings: `CullDistance`, `Mobility`, cast shadows, collision preset (default
  NoCollision; BlockAll to make props collidable)

**Storage [SOURCED]** — Painted foliage is **explicit stored instances, never
re-scattered**. One `AInstancedFoliageActor` per streaming level holds a `FoliageInfos`
map of `UFoliageType → FFoliageInfo` (per-type per-instance data), with instance-level
APIs (`SetFoliageInstanceTransform`, `DeleteFoliageInstances`)
([AInstancedFoliageActor API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Foliage/AInstancedFoliageActor)).
Rendering groups instances "into batches that are rendered using hardware instancing"
(HISM clusters; UE4 docs cite ~100 instances/cluster default)
([Foliage Tool, UE 4.27 docs](https://dev.epicgames.com/documentation/unreal-engine/foliage-tool?application_version=4.27)).
So: **archetype = shared asset; placement = explicit transform list; clustering is a
renderer concern, not an authoring concern.**

**Recipe counterpart [SOURCED]** — the **Procedural Foliage Spawner** is the recipe-based
tool: foliage types get growth-sim params (Initial Seed Density, Shade/Collision Radius,
Num Steps/generations, spread distance, priority) and a `Resimulate` button. Critically,
**its output is committed as ordinary foliage instances in the level, editable afterwards
with the normal foliage tools** — the docs recommend rebuilding lighting after Resimulate
and hand-tweaking the spawned instances
([Procedural Foliage Tool, UE 5.8 docs](https://dev.epicgames.com/documentation/unreal-engine/procedural-foliage-tool-in-unreal-engine?lang=en-US)).
Recipe lives editor-side; the artifact is instances.

### Unity terrain

**Trees [SOURCED]** — paint with `Brush Size`, `Tree Density` (spacing constraint;
repeated strokes densify), `Tree Height/Width` random ranges (0.01–2×, `Lock Width to
Height` for uniform), `Random Tree Rotation`, `Color Variation`, `Mass Place Trees`
(whole-tile fill with "Keep Existing Trees"), Shift = erase all, Ctrl = erase selected
type only ([Unity Manual: Trees](https://docs.unity3d.com/Manual/terrain-Trees.html)).
Stored as an **explicit `TreeInstance` array in `TerrainData`**: `position` (Vector3
**normalized 0–1 in terrain-local space**), `widthScale`, `heightScale`, `rotation`
(radians on XZ plane), `color`, `lightmapColor`, `prototypeIndex` (**archetype by
index** into `treePrototypes`)
([TreeInstance API](https://docs.unity3d.com/ScriptReference/TreeInstance.html)).
Compact per-instance record + archetype table — a direct model for a placement artifact.

**Details/grass [SOURCED]** — stored completely differently: a **per-layer detail density
map**, "essentially a grayscale image, where each pixel value denotes the number of detail
objects that will be procedurally placed in the corresponding Terrain area"
([TerrainData.GetDetailLayer API](https://docs.unity3d.com/ScriptReference/TerrainData.GetDetailLayer.html)).
Painting writes density values; actual positions are derived procedurally per cell at
render time (**[INFERRED]** the per-cell position derivation is a deterministic hash — the
docs say "procedurally placed" but don't specify the mechanism). Rendered via GPU
instancing ([Unity Manual: Grass/Details](https://docs.unity3d.com/Manual/terrain-Grass.html)).

**The load-bearing contrast [INFERRED from the two sourced storage models]** — Unity draws
the line by *weight class*: trees (collidable, individually placeable/selectable,
gameplay-relevant) = explicit instances; massed micro-detail (grass — no colliders, no
identity) = density field + deterministic re-scatter. The storage model follows from
whether an instance has *identity* (can be individually selected, deleted, collided with).

## Q2. Blender geometry nodes / Houdini — recipe vs instances

**Blender `Distribute Points on Faces` [SOURCED via manual-citing search results; direct
manual fetch was 403]** — inputs: Density (points/m²), Seed (re-randomizes), distribution
method Random vs Poisson Disk (Distance Min for blue-noise), selection/density-factor
field as mask; surface attributes transfer to points; node emits a **stable `id`
attribute** — "used as a stable identifier for each point. When the mesh is deformed or
the density changes the values will be consistent for each remaining point"
([Blender manual](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/point/distribute_points_on_faces.html),
[Poliigon environment-scattering guide](https://www.blog.poliigon.com/blog/environment-scattering-with-geometry-nodes-in-blender)).
Note the design intent: even the *live recipe* invests in per-point identity stability
under input change.

**Recipe→instances boundary in Blender [SOURCED]** — the recipe stays live in the modifier
stack; you materialize via the **`Realize Instances` node / applying the modifier**, which
"makes any instances… into real geometry data, making it possible to affect each instance
individually" ([Realize Instances node, Blender manual](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/instances/realize_instances.html)).
I.e. the trigger for storing instances is **per-instance hand editing**.

**Houdini Scatter SOP [SOURCED]**
([SideFX Scatter docs](https://www.sidefx.com/docs/houdini/nodes/sop/scatter.html)):

- Params: Generate By Density / Count per Primitive / In Texture Space; `Density Scale`;
  **`Density Attribute`** (point/vertex/prim/detail — the mask surface); `Force Total
  Count`; **`Global Seed`**; **`Primitive Seed Attribute`** ("useful for ensuring
  consistent scattering when primitives with lower numbers are added or removed");
  `Relax Iterations` (blue-noise repel).
- Output attributes include **`Prim Num` and `Prim UVW`** — each point remembers *which
  primitive it sits on and where in its parameter space* — surface-anchored provenance.
- **The determinism warning, verbatim posture [SOURCED]:** "If the input to the Scatter
  node changes on each frame, the output point positions and point numbers may change
  randomly from frame to frame." Recommended mitigations: scatter on static *rest*
  geometry and interpolate, or scatter in texture space. Community practice adds:
  lock/cache the node once a layout pleases
  ([CGForge Scatter article](https://www.cgforge.com/blog/scatter-394827),
  [Artivoxa deep-dive](https://www.artivoxa.com/houdini-scatter-sop-deep-dive-density-relaxation-custom-distribution/)).

**When do DCCs store the recipe vs the instances? [INFERRED from the above]** — Recipe
survives only while its input surface is stable or the tool has an anchoring mechanism
(stable IDs, prim UVW, rest geometry). The moment (a) per-instance hand edits happen,
(b) the input can change under the scatter, or (c) the result leaves the tool, everyone
converts to explicit instances. No surveyed DCC re-scatters from params across an
*unstable* substrate and calls it authoritative.

## Q3. Voxel/block-world editors

**Axiom (Minecraft) [SOURCED]** ([Axiom tool docs](https://axiomdocs.moulberry.com/tools/intro.html))
— ships Painter / Noise Painter / Gradient Painter / Biome Painter / Script Brush (brush
shapes sphere/cube/octahedron, mask-based filtering, sliders), plus Stamp (predefined
patterns), Shape, Path, Freehand/Sculpt Draw. All of these **write blocks**; pattern
placement is stamps/schematics, and a History window handles undo. No entity-emitting
scatter brush documented.

**WorldEdit / FAWE [SOURCED-community]** — closest things to a surface-scatter brush in
the block world:

- FAWE **scatter brush** `/br scatter` — "sets a number of blocks randomly on a surface
  each a certain distance apart" (density + spacing params, `-o` places *overlaying* the
  surface — one block above, the "prop on surface" mode)
  ([FAWE commands wiki](https://github.com/boy0001/FastAsyncWorldedit/wiki/Commands))
- WorldEdit 7.3 **splatter brush** — paints "with configurable drop-off/decay. The center
  of the brush will be more solid, and the further from the center the less blocks the
  brush paints" — density falloff across the brush footprint
  ([WorldEdit 7.3 announcement, Maddy Miller](https://madelinemiller.dev/blog/introducing-worldedit-7-3/))
- **forest brush** `/brush forest <shape> [radius] [density] <treetype>` — plants tree
  *structures* at density on surfaces; general brush model = bind to item + `/size` +
  `/mask` ([WorldEdit brushes docs](https://worldedit.enginehub.org/en/latest/usage/tools/brushes/))

Storage in all of these: **destructive block writes + undo history**; the world is the
artifact. Nothing here has instance identity after placement. **[INFERRED]**
Entity-emitting scatter brushes are essentially absent from this editor class — furnace's
design imports a DCC/game-engine mechanism (archetype instances) into a voxel substrate;
the block-world precedent only contributes interaction vocabulary (surface/overlay mode,
spacing, decay falloff, masks).

**Teardown [SOURCED-community]** — the level editor edits a **scene XML**: bodies contain
`vox` shapes referencing MagicaVoxel files, props placed as XML nodes with `pos`/`rot` +
file refs; groups provide property inheritance
([Teardown modding docs](https://teardowngame.com/modding/),
[Level Editor wiki](https://teardown.fandom.com/wiki/Level_Editor)). This is an
**entity-list-with-asset-refs artifact** — the runtime derives rendering + collision from
the referenced voxel shapes. No scatter brush documented **[INFERRED absence]**.

## Q4. Scatter on cave/overhang surfaces specifically

Direct "cave prop brush" precedent in shipped editors is thin; what exists is three
sourced mechanisms plus a domain rule:

1. **UE Foliage on walls/ceilings [SOURCED-community]** — the paint brush works on
   arbitrary mesh surfaces; the gate is `GroundSlopeAngle` (default 45°; "90°+ allows you
   to paint on walls and the like", up to 180° reaches ceilings) combined with
   `AlignToNormal`/`AlignMaxAngle`
   ([WOLD tutorial](https://www.worldofleveldesign.com/categories/ue5/placing-props-foliage-mode.php),
   [Epic forums: walls/ceiling thread](https://forums.unrealengine.com/t/can-i-use-the-foliage-tool-on-the-walls-or-ceiling/362764)).
   Community threads report exactly the failure furnace must avoid: painting inside
   **concave** cave meshes is unreliable because placement raycasts against collision, and
   loose collision hulls break it
   ([foliage won't align thread](https://forums.unrealengine.com/t/foliage-wont-align-to-normal/457698)).
   A Surface-Nets field gives exact surface geometry — furnace dodges this class entirely
   **[INFERRED]**.
2. **UE PCG orientation filters [SOURCED-community]** — `Normal to Density` converts each
   sample's normal·direction into density, then `Density Filter` culls; the standard idiom
   for "floors only" / "ceilings only" archetype filtering
   ([PCG in a Nutshell, Medium](https://medium.com/@deaconline/procedural-content-generation-pcg-b54f4c1959cd),
   [Epic forums tree-placement thread](https://forums.unrealengine.com/t/large-tree-placement-with-pcg/1286759)).
3. **Geo-Scatter's orientation blend [SOURCED]** — per scatter-system choice of aligning
   instance +Z to **surface normal or world Z**, with a **"Vertical Influence"** slider
   that blends normal alignment toward global Z
   ([Geo-Scatter rotation docs](https://www.geoscatter.com/docs-rotation.html)). The
   cleanest shipped statement of the gravity-vs-normal question: a **per-archetype enum +
   blend factor**, not a global.
4. **Domain rule [general knowledge, not session-verified]** — real speleothems are
   gravity-formed: stalactites hang plumb from ceilings, stalagmites grow plumb up from
   floors regardless of local surface slope; small encrusting detail (moss, crystals)
   follows the surface normal. So the archetype contract needs *both* modes:
   `orientation: gravity | normal | blend(t)` plus a **normal-hemisphere filter**
   (`ceiling` = normal·up < −ε, `floor` = normal·up > ε, `wall` = between) — UE's
   `GroundSlopeAngle` generalized to the full sphere **[INFERRED — the generalization;
   each ingredient sourced above]**.

## Q5. Runtime placement artifacts

**Explicit-instance serialization, per engine [SOURCED]:**

- **Unreal**: per-level `AInstancedFoliageActor` → `FoliageInfos: UFoliageType →
  FFoliageInfo` (per-instance transforms + base-component references); render clustering
  (HISM batches) is derived, not stored authoring data
  ([AInstancedFoliageActor API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Foliage/AInstancedFoliageActor)).
- **Unity**: `TerrainData` holds the `TreeInstance[]` (normalized local position, scale
  pair, yaw, color, `prototypeIndex` archetype ref) and separately the detail-density
  rasters ([TreeInstance API](https://docs.unity3d.com/ScriptReference/TreeInstance.html),
  [GetDetailLayer](https://docs.unity3d.com/ScriptReference/TerrainData.GetDetailLayer.html)).
- **Godot `MultiMesh`**: the purest instanced-buffer artifact — a resource whose `buffer`
  is one packed float array (row-major transforms + optional color/custom data), settable
  wholesale via `set_buffer`; buffer size = instance count × per-instance stride
  ([MultiMesh class docs](https://docs.godotengine.org/en/3.5/classes/class_multimesh.html)).
- **Teardown**: entity list (XML) of asset refs + transforms; collision derives from the
  referenced voxel shape at load ([Teardown modding](https://teardowngame.com/modding/)).

**"Placements as compacted state of an edit log" precedent:**

- **Dreams (Media Molecule)** — the strongest precedent for op-log-as-source-of-truth:
  sculpts are stored as **lists of CSG edits** ("Operationally Transformed CSG trees are
  evaluated on-the-fly to high resolution signed distance fields", from which render-ready
  point clouds are generated) — the *authoring* artifact is the log; the *runtime*
  representation is an evaluated cache
  ([Game Developer: How Media Molecule designed Dreams' toolset](https://www.gamedeveloper.com/design/how-media-molecule-designed-a-fun-and-robust-toolset-for-i-dreams-i-),
  [Alex Evans, SIGGRAPH archive](https://history.siggraph.org/person/alex-evans/)).
- **No Man's Sky** — player terrain edits persist as a **bounded op list in the save
  (~15,000 edits)**, replayed over procedurally regenerated terrain; over budget, old
  unprotected edits are **evicted** (terrain "regrows") — a live example of log compaction
  with a protection policy (base-area edits are protected)
  ([Steam guide: Terrain Editing in NMS](https://steamcommunity.com/sharedfiles/filedetails/?id=2526352095),
  community threads) **[SOURCED-community]**.
- **Valheim** — the cautionary tale then the fix: originally every hoe/pickaxe stroke
  spawned a networked `TerrainModifier` object **replayed over default terrain on every
  rebuild**; the 0.150.3 rewrite **compiled the op list into per-chunk current-state
  data** (with `optterrain` migrating old worlds) specifically for load/network
  performance ([PC Gamer](https://www.pcgamer.com/valheim-patch-overhauls-terrain-buffs-hoe/),
  [GamingBolt](https://gamingbolt.com/valheim-patch-introduces-new-terrain-modification-system),
  [BetterTerrain mod README describing the old mechanism](https://github.com/74oshua/BetterTerrain))
  **[SOURCED-community]**.

## What transfers — synthesis

**Interaction surface (converged across Unreal/Unity/Geo-Scatter; adopt wholesale):**

- Brush: size + density-as-multiplier of per-archetype density; erase-to-target-density
  (not binary delete); single-instance mode; per-archetype min-spacing (`Radius`) —
  blue-noise-ish spacing matters more than true Poisson at brush scale **[last clause
  INFERRED]**.
- Per-archetype (the UFoliageType template, trimmed): density, min spacing, scale min–max
  (uniform default, lock-axes option), random yaw, orientation mode
  **gravity | normal | blend(t)** (Geo-Scatter's Vertical Influence), normal-hemisphere
  filter **floor | wall | ceiling** with angle thresholds (UE GroundSlopeAngle
  generalized), sink/float Z-offset range, overlap test against existing placements
  (UE `CollisionWithWorld`).
- Two UE features worth stealing that are easy to miss: **Reapply** (retroactively push
  changed archetype settings onto existing placements — trivial when ops are replayable)
  and **Erase Density** semantics.

**Recipe vs instances — recommendation for the op-log system:**

Every surveyed system that lets the substrate change out from under a scatter either
(a) stores explicit instances (UE paint, Unity trees, Blender realize, Teardown),
(b) commits recipe output *to* explicit instances at a button press (UE Procedural
Foliage Spawner — the exact shape of furnace's "smart object holding params+seed"), or
(c) keeps the recipe live only with explicit anchoring machinery (Houdini
prim-UVW/rest geometry, Blender stable IDs) and still warns about instability. Nobody
replays scatter-from-params over a mutated surface as the authoritative store.

Concretely for furnace **[INFERRED — recommendation]**:

- **Brush ops emit explicit instance records.** A scatter stroke serializes as one op
  carrying the emitted placements: `[{archetypeRef, position, orientation (or yaw +
  normal-blend inputs), scale, variantSeed}]`, not brush params. Rationale: earlier ops in
  the log are editable, and the Surface-Nets surface moves when the field changes —
  params-replay would silently float/embed every downstream prop (the Houdini warning,
  materialized). This also matches the existing jurisdiction rule: props aren't field, so
  their ops shouldn't be functions *of* field state at replay time.
- **Optionally carry anchor provenance, not as truth but as a repair hint**: per instance,
  the surface anchor (cell + local offset + normal at placement time — the analog of
  Houdini's `Prim Num`/`Prim UVW`). It buys a "re-project props onto changed surface"
  *tool* (explicit user action) without making replay surface-dependent. Skip in v1 if F3
  scope is tight; the op shape can grow it additively.
- **Smart-object generators keep params+seed as the entity (the existing pattern) and
  commit *placements* like the UE spawner**: re-evaluating the recipe in-editor replaces
  its committed instance set; the runtime artifact only ever sees instances.
- **Runtime artifact = compacted current state of the log** (the Valheim-rewrite /
  Dreams-evaluated-cache position, not the NMS replay position): an archetype table
  (mesh/material/collision-primitive refs) + per-archetype packed instance buffers (Unity
  `TreeInstance` / Godot `MultiMesh.buffer` shape — position, quat (bake the
  gravity/normal blend at bake time), uniform-or-xyz scale, variant index). Colliders
  derive from the archetype's collision primitive per instance at load (Teardown/Unity
  model) — no per-instance collider data in the artifact. Render clustering/chunking is
  the runtime's derived concern, never stored (UE's HISM lesson).
- One deliberate divergence from Unity: don't add a density-map/"grass" tier now — that
  model exists for identityless massed micro-detail, and these props (rocks, stalagmites)
  are collidable entities with identity. If an identityless moss/crystal-crust tier
  appears later, that's when the density-field + deterministic-re-scatter model earns its
  place **[INFERRED]**.
