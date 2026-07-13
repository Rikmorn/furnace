# Direction note: one field — the world as a single voxel medium, algorithms as brushes

> Status: **direction note, not a decision.** Captured 2026-07-13 from the post-W3-seal
> discussion (the 3.3 phase bar was met that day; W4 remains). This feeds the
> post-W4 charter brainstorm, which will re-evaluate 3.4 Seeing / 3.5 Curating as
> chartered (2026-07-11) against this direction and replan if adopted. Owner of the
> proposal: the user; assessment + premises: the planning session.

## 1. The proposal

Invert figure and ground in the world model. Today (3.3): regions OWN geometry
(per-region grids/fields) and connectors negotiate boundaries between them. Proposed:

- **The world is ONE authoritative voxel field** (chunked, sparse). There is no
  geometric composition step — everything composes by editing the same medium.
- **Interior algorithms become excavators/moulds/brushes.** A square room = dig a
  box; a cave = dig a cave; a maze = stamp its carve plan; open sky = remove
  everything that blocks it. Connecting two features = digging between them with
  whatever tool fits — the connector taxonomy dissolves into "dig".
- **Regions survive as semantic OVERLAYS**, not geometry owners: theming, dressing
  policy, spawn logic, subdivision/streaming metadata. (The user named this
  explicitly: regions "are still valid as an organisation and subdivision unit.")
- **The editor becomes direct manipulation of the field**: a brush palette + an
  inspector for the ACTIVE brush's parameters, applied in-viewport at any scale,
  with continuous feedback — replacing the two-plane split (generation panel vs
  viewport) and the batch loop (configure blind → generate → error/preview at the
  end) that produced all of W3's gate friction.
- **Premade meshes place INTO the field**: underground, the placer digs the cavity
  (the prefab's volume stamped to AIR + keep-out); overground, it needs support
  (flatten/feather the footprint). A castle, a tree, a vehicle — render stays the
  mesh; the field makes space for it.

Optimization target (the user's words): **creativity** — the editor as a tool you
shape with, not a form you compile.

## 2. Why the evidence favors it

- **Shipped precedent (general knowledge, consistent with
  `2026-07-10-world-substrate-and-region-composition.md`):** this is the shape
  voxel games actually ship. Minecraft = one field + structures stamped in
  (jigsaw); **7 Days to Die is the closest analogue to the prefab case** — POIs
  stamped into voxel terrain, cavity dug, "terrain filler" flattening the support;
  Enshrouded = sculpted voxel world + placed assets; Astroneer/NMS carve the field
  at runtime. Editor-side: WorldEdit/WorldPainter, and Unreal's Voxel Plugin whose
  architecture is literally brushes-over-a-field. Our own research sweep already
  concluded heterogeneous mesh-CSG at seams ships nowhere and carve media
  dominate; a single carve medium is the purest form of that finding.
- **W2/W3 built the hard mechanisms without naming them.** `prepareCarve` IS a dig
  tool; `collarBoreCarve` IS a cylinder dig; the hall/maze stampers emit coarse
  cell patterns — applying them into a shared field instead of a private array is
  a coordinate-offset change (the `GridStamp` contract ≈ a stamp-brush API). The
  collar/patch/suppression seam is the boundary treatment between skin classes.
- **The render dichotomy does NOT dissolve — it becomes per-cell material.** A
  room brush writes masonry cells (kit-skinned, crisp); a cave brush writes rock
  (Surface Nets). The field carries material/class per cell; the skinner
  dispatches per class; the W2 collar/patch machinery is the boundary treatment
  between classes. This is the already-working seam, generalized.
- **The bake model unifies with the editor's document session.** Hand-brushing is
  data, not derivation → bake becomes a **brush-op edit log** (+ snapshots for
  compaction). Strokes/stamps as replayable commands = the document session's
  existing transactional model — the ephemeral-generation-session wart
  (editor-architecture §13.4: generation not undoable, beside the session)
  dissolves. The Pr-2 rule survives unchanged: the browser replays/bakes;
  stamp math stays integer/lattice where it matters.
- **The LLM angle** ([[project_dungeon_crawler_vision]]): a brush-op stream is a
  far better generation target than region graphs — small, composable,
  per-op validatable.

## 3. The Jolt re-position (the discussion's main outcome)

Original assessment: free-form digging pulls the Jolt swap onto the critical path
(the carved-rim wedge class — 2.2.1, spike P5). **Revised after pushback, and the
pushback wins**: the wedge class is a STATIC GEOMETRY PROPERTY (floor-adjacent lips
above step height, sub-capsule pockets, capsule-scale curvature), so it is
detectable without running the mover:

- **A walkability analyzer over the field** — walkable-column analysis using the
  single-sourced `walkability.ts` constants (step 0.4, slope limits, capsule
  clearance) — flags lips/pinches/headroom live as you brush. This is the founding
  Epic-3 doctrine applied to physics: editor-time failure absorbed by a human with
  tools. The flag layer IS the rebirth of "3.4 Seeing".
- **Flag-and-fix loop**: jump to flag → see it → dig the fix. Hand-fixes are
  additive edit-log ops over procgen output; a reroll underneath a fix simply
  re-flags whatever the new state violates (the analyzer makes hand-fixes safe
  against rerolls).
- **Prefab collision = the prefab's VOXELIZATION** (render mesh, collide field) —
  the same operation as making space for it. Keeps Rapier + the proven proxy path
  everywhere. Cost is feel, not function: curved/sloped prefab surfaces walk like
  0.25 m stairs (the tolerated organic-interior class).
- **Jolt's trigger redefined**: from "a free-form carve verb exists" to (a) voxel
  step-FEEL becomes the limiting factor, (b) runtime-JIT generation without a
  curator (where analyzer + auto-fix — automatic lip-shaving, trivial in a field —
  is the likelier guarantee mechanism anyway), or (c) prefab traversal quality.
  Jolt remains the quality endgame ([[docs/learnings/jolt-mesh-collision-spike.md]],
  `docs/backlog/engine-architecture/jolt-backend-swap.md`); it is no longer the
  price of admission.

## 4. Genuinely new costs (where the work actually is)

1. **World-scale storage + remeshing**: chunked sparse field (the substrate's
   accessor seam was built for exactly this — palette/RLE deferred behind it),
   dirty-chunk async remeshing, **remesh budgets day one** (working-standards:
   budgets ship with the loop, not as hardening). This is Epic-4 streaming
   infrastructure pulled forward.
2. **The brush editor** — palette + active-brush inspector + in-viewport
   application + the flag layer. Retires the form-based World panel (built as the
   W3 gate vehicle; its six gate-UX findings mostly dissolve with the form —
   `docs/backlog/editor-and-tooling/world-panel-w3-gate-ux-findings.md`
   re-targets here).
3. **Edit-log bake** — op schema, replay, snapshot compaction, document-session
   integration.
4. **Sky/outdoors is the sleeper epic** — flipping the default (air above ground)
   quietly brings terrain materials at scale, sun lighting, draw distance, LOD.
   Sequence AFTER indoor field unification proves itself; the field model must
   merely not preclude it (default-solid vs default-air is a per-chunk bit —
   reserve it, don't build it).

Not oversold: "palette instead of numbers" means the batch-compile loop dies, not
that parameters vanish — parameterized brushes (braid, pillar spacing, prefab pick)
keep a compact parameter surface, inspected in context (every precedent lands here).

## 5. Premises to probe BEFORE chartering (both cheap, no spike branch needed)

| Premise | Evidence today | Probe | Stop condition |
|---|---|---|---|
| The walkability analyzer detects the wedge class statically (low false-negatives) | wedge class characterized (2.2.1 + spike P5); constants single-sourced in `walkability.ts` | **corpus probe**: run the analyzer over KNOWN-BAD geometry (the spike's wedging carved patch, 2.2.1 repro shapes) and KNOWN-GOOD (every W2/W3 walked lane); must flag the former, stay quiet on the latter; GPU fuzz-walk stays the backstop | misses a known wedge → flag-and-fix is unsafe → Jolt returns to the critical path |
| Chunked-field memory/remesh viable at target world size | per-region dense arrays measured fine at gate scale; napkin only beyond | napkin math at the charter's named world size (cells × palette/RLE ratio × chunk overhead; remesh cost per dirty chunk) | numbers demand LOD/streaming beyond appetite → shrink the target world or stage it |

## 6. What survives from 3.3 / impact on the ladder

- **Survives wholesale**: the substrate (grid/skin/carve/collar/collider — this
  direction VALIDATES the substrate bet), the stampers (→ stamp brushes), the
  carve machinery (→ dig tools), walkability constants, the bake/upload/daemon
  pipeline (payload shape changes; the transport + root-containment don't), the
  worlds-index, the standards (door 2.0×3.0, wall 0.5, rise 0.25 — carried into
  brushes).
- **Retires at the FIELD phase's own clean cut, NOT at W4**: world-graph
  realize/derivation glue, the connector taxonomy as first-class entities, the
  form-based World panel + `world-draft.ts`. (Charter deletion-timing rule:
  retirement lands in the slice that replaces the consumer.)
- **W4 is structurally unchanged** (its deletions are dead under both futures);
  its charter-§6 backlog dispositions re-target HERE where noted (traversal-quality
  items → analyzer requirements; `disjoint-region-check-is-aabb-conservative`
  likely dies with one-field; `third-grid-vocabulary-costs-five-edit-sites` →
  brushes change the plug-point shape; gate-UX findings → this charter). W4's doc
  rewrite stays deletion-driven (describe what IS — the region model — without
  new narrative investment).
- **3.4/3.5 as chartered are superseded-pending-recharter**: re-evaluate between
  3.3's close (W4 seal) and the next phase; the flag layer is 3.4-seeing reborn,
  the brush editor is 3.5-curating reborn.

## 7. Open questions for the charter brainstorm

Material-class set + per-cell storage (how many classes, palette encoding); the
brush-op schema and its document-session integration (undo granularity for large
brushes); snapshot/compaction policy; lattice-snap discipline inside stamp brushes
vs free brushes; prefab pipeline timing (glTF epic — [[project_gltf_asset_epic]] —
becomes load-bearing for the castle case); vertical/multi-storey authoring; the
target world size (feeds premise 2); how flags surface in the editor (the palette's
sibling); whether hand-authored WorldSpec files keep a migration path (probably:
a spec is replayable as a brush-op sequence).

Pending user input: further editor-direction topics were deferred to after 3.3
completes — fold them into the same brainstorm.
