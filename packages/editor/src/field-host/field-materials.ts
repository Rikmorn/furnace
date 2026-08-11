// Every GPU material the viewport draws with, the two handles that are not
// materials but are built and freed beside them (the kit-fill ghost's cube and
// its geometry), and the shading MODE that decides which of them a chunk bucket
// gets. The thirteenth cluster lifted out of `createFieldHost`.
//
// "MATERIALS" IS A WORD WITH AN OBVIOUS MEANING THIS CLUSTER DOES NOT HAVE, and
// saying so first saves the next reader a wrong guess. There is a
// `field.MaterialTable` in the editor — the project's classes, their colours,
// their kit split — and it is NOT here. It belongs to `catalogs`, it rides the
// substrate as `table()`, and it was declared FACADE-RESIDENT one task ago. There
// is a material SWATCH strip in the chrome, and that is the panel's. What lives
// in this file is the GPU side: fifteen `material.Material` / `binding.Binding` /
// `mesh.Mesh` / `geometry.Geometry` handles plus the `FieldHostShading` mode that
// picks between two of them. The table is an INPUT to two functions below and
// nothing else.
//
// THE SEAM IS BIGGER THAN THE ROW, for the third time in this tranche and by the
// third mechanism. `field-analyzer.ts`'s surplus was its 14 inbound MUTATION
// edges; `field-picking.ts`'s deficit was a pipeline whose stages each had one
// caller. This one's surplus is inbound READS. The map counts 7 functions and 1
// facade member; this module exports FOURTEEN verbs, and the arithmetic is:
//
//   - FIVE of the seven functions are verbs one-for-one ({@link Materials.init},
//     {@link Materials.stampGhost}, {@link Materials.voidCast},
//     {@link Materials.bucket}, {@link Materials.kitInstanced}).
//   - The other TWO are private and were never called as a pair by accident —
//     `buildLitMaterials` and `destroyLitMaterials` fold into
//     {@link Materials.rebuildForTable} and {@link Materials.destroy}, each named
//     for the act its callers were performing.
//   - ONE is the facade member ({@link Materials.setShading}).
//   - ONE is the teardown split the paragraph below argues
//     ({@link Materials.release}).
//   - FIVE are what OTHER clusters read off this one, collapsed onto accessors:
//     {@link Materials.kitMat} (the prop layer's GPU guard),
//     {@link Materials.flagMarker} (the advisor's marker layer),
//     {@link Materials.selectionCell} (the cell-selection display),
//     {@link Materials.ghostCube} and {@link Materials.shading} (the frame).
//
// So a row's function count measures the cluster, and its READ-BY column measures
// the seam just as surely as its MUTATED-BY column did for the advisor.
//
// THE TEARDOWN IS TWO VERBS AND THE SPLIT IS FORCED, not stylistic. The host's
// `dispose` frees GPU objects inside `if (c)` and nulls the slots OUTSIDE it, so
// a host disposed before `init` still forgets its handles. Folding the two into
// one call would have to either null under the context guard (wrong for the
// never-initialized host) or free without one (impossible). `field-analyzer.ts`
// hit the identical shape one task ago and split it the identical way —
// `dispose()` with no context, `destroyMarkers(c)` inside the block — and the
// host's teardown already reads as a sequence of both kinds. So:
// {@link Materials.destroy} sits with `props.destroy(c)` and
// `advisor.destroyMarkers(c)`, and {@link Materials.release} sits after the
// block. Fifteen bare assignments became ONE verb, which is the part that was
// worth doing; making it one verb TOTAL would have been worth breaking.
//
// THE LAW, applied (see `substrate.ts`'s doc header for the argument):
//
//   - `chunkMeshes` and `litByClass` are `const` in the host, mutated through the
//     identity it hands over, so they ride BY VALUE inside the substrate.
//   - `table()` and `ctx()` are host `let`s and ride as SUBSTRATE THUNKS. Both
//     were already declared there; this module adds nothing to the record.
//   - `selectedColor` is neither. It is a module-scope `const` in `field-host.ts`
//     — the editor's `--primary` accent — with a SECOND reader that is not this
//     cluster's: the entity/flag selection outline, which is `selection`'s and
//     since T3d Task 5 is `field-selection.ts`'s {@link Selection.outline}. It
//     travels as a plain VALUE dep, which is `field-segment.ts`'s
//     `anchorCrossHalfM` precedent. The six constants below had no second reader
//     and came with the cluster.
//
//     The argument for the DECLARATION SITE changed at Task 5 and is settled
//     there rather than here: "two owners-to-be" expired (both readers are modules
//     now and no host function reads it), and what replaced it is that a constant
//     read by two PEER modules and by nothing else sits at a neutral point, which
//     is where it already was. Moving it into one of the two would make the other
//     value-import a sibling for a literal. `field-host.ts`'s declaration block
//     carries the whole of it, for this constant and for the two `field-render.ts`
//     takes the same way; choosing an accent-vocabulary owner is a deletion-pass
//     question left to the prune tranche.
//
// AND `litByClass` STAYS IN THE CLOSURE, which is the one disposition here that a
// reader would not predict. It is this cluster's private cache — nothing outside
// these four functions has ever read it — so the `field-view.ts` rule ("state
// that acquires an owner leaves the closure rather than joining the record")
// would send it into this file. It cannot go, because it is ALREADY a
// `HostSubstrate` value member, declared there at T3a ahead of any consumer.
// Removing a member is not the same decision as declining to add one: the
// two-extracted-readers bar governs ADDITIONS (`field-props.ts` says so at
// `archetypeById`), and a removal here would edit a behavioural fixture to pay
// for a tidier record. So it joins `propMeshes`, `ghostMeshes`, `voidCastMeshes`
// and `flagStore` as a SUBSTRATE LEFTOVER — the fifth, and the first whose
// owning cluster reads it and nobody else does.
//
// THE COST WAS MEASURED, NOT REASONED, AND THE MEASUREMENT IS THE INTERESTING
// PART. Deleting the member and running `tsc --noEmit` produces EIGHT errors, of
// which exactly ONE is in a test: `tests/field-host/field-history-feed.test.ts`,
// which passes its literal straight to `createHostSubstrate` and so gets excess-
// property checking. THREE other test files name `litByClass` too —
// `field-view.test.ts`, `field-stats.test.ts`, `substrate.test.ts` — and all
// three build it inside a spread helper (`otherSubstrateMembers()`, `frozen()`),
// which that check does not reach. They would not go red. They would go
// SILENTLY STALE, carrying a member of a type that no longer has one.
//
// That is `substrate.ts`'s own failure class — a value that keeps describing a
// world which has moved — surfacing in the test scaffolding rather than in
// production code, and it is worth knowing before the next tranche decides a
// substrate member is safe to remove because "the tests would catch it". One
// test would. Three would not.
//
// NO UNIT TEST, by the house pattern ten extractions old: the argument is
// `tests/field-host/field-machine.test.ts`'s header and is not re-made here. The
// host suites passing UNMODIFIED across this move ARE this module's contract.
//
// WHAT THE SUITE ACTUALLY PINS HERE IS NARROWER THAN IT LOOKS, and it was
// MEASURED at this extraction rather than assumed. `field-analyzer.ts` set the
// precedent for recording this, and its finding was a COVERAGE gap — one path,
// the density mirror, reachable only from the GPU lane. This one is not the same
// kind of thing and calling it "less comfortable" undersold it: what the second
// probe below found is an ERROR-CONTRACT defect. A complete failure of the
// per-class material cache produces a silently empty viewport plus one
// `console.warn` per chunk, because `remeshOne`'s `try` swallows it — no test
// could catch it, and no user would get an error. That is filed as
// `docs/backlog/editor-and-tooling/field-host-internals.md`
// §"`remeshOne` swallows GPU setup failures"; it needs a
// design decision about which failures a remesh may swallow, which is why it is
// a backlog entry and not an inline fix. Three probes, all against the whole
// editor suite (1469/0 at head):
//
//   - Deleting {@link Materials.setShading}'s re-material loop, so the mode
//     changes and every resident chunk keeps its old material: **1469/0, fully
//     green.** The facade member's GPU half is unpinned. It is an eyeball check.
//   - Making `buildLitMaterials` fill a PRIVATE map instead of
//     `substrate.litByClass` — the exact photograph `substrate.ts` exists to
//     describe — so {@link Materials.bucket} finds neither the class key nor the
//     `c0` fallback and throws: **1469/0, fully green.** The reason is measured,
//     not guessed: `bucket` IS reached (instrumented, 3 sites), but its only
//     production caller is `applyMesh` inside `remeshOne`'s `try`, which swallows
//     the throw into a `console.warn`. A broken per-class cache therefore degrades
//     to "no chunk meshes and one warning per chunk", and nothing asserts either.
//   - Cutting the {@link Materials.voidCast} wire (throw when the material
//     exists): **3 red, and these are the only names this cluster has.**
//     `tests/field-host-void-cast.gpu.test.ts` — "enabling the cast snapshots
//     every allocated chunk and meshes the response" and "a mutation entry point
//     that changes NO cells leaves the cast standing" — plus
//     `tests/field-host-reinit.gpu.test.ts`'s "a re-init re-requests the void cast
//     the layer is still asking for".
//
// So the contract this module is held to is "the X-ray's material arrives", and
// the other thirteen verbs are pinned only through whatever their CALLERS assert.
// All three reds are in the GPU lane, structurally: reaching a material means
// having a device. A green CPU run says nothing about this file at all.
//
// TWO PRUNE CANDIDATES ARE PARKED HERE rather than taken, because this slice is
// behaviour-frozen: {@link Materials.kitInstanced} and {@link Materials.kitMat}
// are two spellings of one handle, inherited from `PropsDeps` and not introduced
// by this extraction; and the `Vec3T` / `LineBatch` alias family is declared
// privately in FIFTEEN and SEVEN modules respectively (re-counted at T3d Task 5,
// which added two of each and removed the host's `LineBatch`). Both belong to the
// T5 prune tranche, beside the alias consolidation `field-analyzer.ts` already
// parks there.
import * as binding from "@furnace/core/binding";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import * as shader from "@furnace/core/shader";
import { GHOST_COLOR } from "./field-ghost.ts";
import type { FieldHostShading } from "./field-host.ts";
import type { HostSubstrate } from "./substrate.ts";

// Shared specular for every lit bucket / kit material (color-only variation).
const LIT_SPECULAR: [number, number, number, number] = [0.06, 0.06, 0.06, 16];

// Kit-fill ghost cube opacity: translucent enough to read the field through
// the hologram volume, solid enough to make "fill writes this whole box"
// unmistakable (the fill-tool-solid-volume-surprise fix).
const GHOST_CUBE_ALPHA = 0.25;

// Stamp-ghost surface opacity — a touch denser than the kit-fill cube: the
// ghost is a real surface mesh (walls occlude walls), so it needs presence to
// read as "this is what commit builds" while the field stays visible through it.
const STAMP_GHOST_ALPHA = 0.35;

// Void-cast X-ray (D-F3-15) — a dim CYAN, deliberately off the hologram-blue
// GHOST_COLOR: the cast is ambient context (what the air already is), never a
// preview of a pending action. Dimmer than either ghost because it can cover
// the whole viewport.
const VOID_CAST_COLOR: [number, number, number] = [0.25, 0.85, 0.75];
const VOID_CAST_ALPHA = 0.3;

// How opaque one selected CELL cube is. Low on purpose: the display's job is to
// show a flood's SHAPE from inside it, and cells stack six deep along any view
// ray through a solid blob — at a readable single-cube alpha the far side of a
// room would be an opaque wall of blue. 0.18 keeps a single cell visible against
// rock while a thick stack still reads through.
const SELECTION_CELL_ALPHA = 0.18;

/** What the material layer needs from the rest of the host.
 *
 *  TWO entries, which makes this the narrowest deps record in the directory
 *  after `field-history-feed.ts`'s. The cluster is fifteen GPU handles the host
 *  builds once and frees once; almost nothing outside it decides anything about
 *  them. What coupling it has runs the other way — six clusters READ these
 *  handles — and that is the seam below, not this record. */
export type MaterialsDeps = {
  /** The host's shared state. Four members are read: `table()` (the project's
   *  classes, which decide how many per-class lit materials there are and what
   *  colour each is), `ctx()` (the GPU guard on the one verb that can be called
   *  before `init`), `chunkMeshes` (re-materialized in place by
   *  {@link Materials.setShading}) and `litByClass` — the per-class cache this
   *  module fills, reads and clears, which stays on the record for the reason
   *  this module's header gives. */
  substrate: HostSubstrate;
  /** The editor's `--primary` accent, premultiplied here into the cell-selection
   *  material. A plain VALUE rather than a call because it is a module-scope
   *  `const` in `field-host.ts` that nothing reassigns, and it stays THERE rather
   *  than moving here because `selection`'s outline reads the same constant —
   *  see this module's header. */
  selectedColor: [number, number, number, number];
};

/** The material layer's four lifecycle verbs, its shading pair, and the eight
 *  accessors other clusters draw through.
 *
 *  4 + 2 + 8 = 14, and the middle number of that partition is the one worth
 *  reading twice: the eight accessors cover SEVEN distinct handles, because
 *  {@link Materials.kitInstanced} and {@link Materials.kitMat} are two spellings
 *  of one — a throwing getter and a nullable read of the same material, kept
 *  apart because the prop layer needs the question answered and the chunk kit
 *  draws need it thrown. This module's own header breaks the fourteen down by
 *  ORIGIN instead (which verb came from which function, mutation or read); this
 *  one is by KIND.
 *
 *  No state is exposed. Every handle below is behind a call because the host
 *  builds them at `init` and nulls them at `dispose`, so a value copy would be
 *  `null` for the life of the process or would outlive the device — the failure
 *  `substrate.ts`'s doc header exists to describe, in its GPU-handle form. */
export type Materials = {
  /** Build every material, binding, ghost mesh and per-class lit entry. Called
   *  once per `FieldHost.init`, and `await`ed there because shader and material
   *  creation are async. */
  init(c: Context): Promise<void>;
  /** Rebuild the per-class lit cache for a NEW material table: free the old
   *  entries, then build from `table()`. One verb rather than the destroy/build
   *  pair it replaced, because a table swap that freed the old materials and did
   *  not build the new ones would leave every chunk drawing from an empty cache.
   *  Yields — the caller's `dispose` may land inside it, which is why
   *  `setMaterialTable` re-checks `disposed` after awaiting. */
  rebuildForTable(c: Context): Promise<void>;
  /** Free every GPU object this module owns. The context half of the teardown,
   *  called from inside `dispose`'s `if (c)` block beside `props.destroy(c)` and
   *  `advisor.destroyMarkers(c)`, and BEFORE `gpu.dispose`.
   *
   *  **MUST be followed by {@link Materials.release}.** This verb frees the GPU
   *  objects and does NOT clear the slots that point at them, so between the two
   *  calls every accessor below returns a handle whose GPU object is already
   *  destroyed — `kitInstanced()` does not throw, `ghostCube()` is not `null`,
   *  and using either is undefined behaviour on a dead device. The pair cannot
   *  be folded into one verb (see this module's header: the two halves run under
   *  different guards, and merging them would move the fifteen slot clears before
   *  `gpu.dispose`), and no type can enforce the ordering, because `release` must
   *  stay callable ALONE for a host disposed before it ever initialized. So this
   *  sentence is the whole defence — and it matters more than it looks, because
   *  at T3d Task 6 `lifecycle` leaves and the sole caller will no longer live in
   *  the file that argues the split. */
  destroy(c: Context): void;
  /** Forget every handle, so the module reads exactly as it did before `init`
   *  and a re-init rebuilds. The context-free half of the teardown, called
   *  unconditionally — a host disposed before it ever initialized runs this and
   *  not {@link Materials.destroy}. */
  release(): void;
  /** The current shading mode. Read by `field-render.ts` for the key light and
   *  the ambient term. */
  shading(): FieldHostShading;
  /** The seam behind `FieldHost.setShading`: adopt the mode, then re-material
   *  every resident chunk mesh in place. No remesh — the buckets are unchanged,
   *  only what each one draws with. Silent no-op before GPU init; the mode still
   *  sticks, so the first `init` renders in it. */
  setShading(mode: FieldHostShading): void;
  /** The material for one surface/backing bucket under the current mode. The
   *  `normals` debug mode collapses every class onto one unlit material; `studio`
   *  looks the class up, falling back to class-0 surface. Called per bucket by
   *  the mesher's apply and by every {@link Materials.setShading}. */
  bucket(classId: number, backing: boolean): material.Material;
  /** The ONE instanced-lit material every kit piece and every placed prop draws
   *  with. THROWS before `init` — its two callers (`buildKit`, the prop layer)
   *  have each already proved a context. */
  kitInstanced(): material.Material;
  /** The same material as {@link Materials.kitInstanced}, nullable. The prop
   *  layer's GPU guard reads THIS one: it refuses to upload without it, so it
   *  needs the question answered rather than thrown. */
  kitMat(): material.Material | null;
  /** The translucent hologram-blue every stamp-preview bucket draws with.
   *  THROWS before `init` — the machine only previews under a live context. */
  stampGhost(): material.Material;
  /** The X-ray's translucent cyan. THROWS before `init`, for the same reason. */
  voidCast(): material.Material;
  /** The walkability markers' unlit instanced material, or `null` before `init`.
   *  Nullable because the advisor's marker rebuild is the one caller that can
   *  legitimately run without a GPU (findings arrive before the device does). */
  flagMarker(): material.Material | null;
  /** The cell-selection cubes' translucent `--primary` material, or `null` before
   *  `init`. Nullable for {@link Materials.flagMarker}'s reason and its twin:
   *  a selection survives a dispose, so its rebuild runs without a device too. */
  selectionCell(): material.Material | null;
  /** The ONE unit cube the kit-fill ghost is posed and scaled from each frame,
   *  or `null` before `init`. */
  ghostCube(): mesh.Mesh | null;
};

/** Build the material layer over one host's dependencies. One per host; it holds
 *  that host's GPU handles for its lifetime, and every one of them is null
 *  before `init` and after `dispose`. */
export function createMaterials(deps: MaterialsDeps): Materials {
  // ONE material for the `normals` debug mode (normalColor): every class looks
  // identical under it — the v0 coarseness is deliberate (structure legibility over
  // class colour, which is what `studio` is for).
  let normalsMat: material.Material | null = null;
  // ONE instanced-lit material for all kit pieces (white base; per-instance tint
  // carries the piece colour).
  let kitMat: material.Material | null = null;
  let kitBind: binding.Binding | null = null;
  // Filled kit-fill ghost: ONE unit cube + ONE translucent hologram-blue
  // material, positioned + scaled to the snapped box per frame (mesh.setScale
  // exists — no per-size rebuild needed) and pushed into the render list only
  // while a kit-fill ghost is live.
  let ghostMat: material.Material | null = null;
  let ghostBind: binding.Binding | null = null;
  let ghostCube: mesh.Mesh | null = null;
  let ghostCubeGeo: geometry.Geometry | null = null;
  let stampGhostMat: material.Material | null = null;
  let stampGhostBind: binding.Binding | null = null;
  let voidCastMat: material.Material | null = null;
  let voidCastBind: binding.Binding | null = null;
  // The marker layer's material and binding. The LAYER itself — the instanced
  // mesh, its count and the selected finding's outline — is `field-analyzer.ts`'s;
  // these two are the material cluster's, built here and freed here alongside
  // every other material, and the advisor reads the material through a
  // single-consumer dep and never sees the bind.
  let flagMarkerMat: material.Material | null = null;
  let flagMarkerBind: binding.Binding | null = null;
  // The cell-level selection display's material and binding (f2b gate item 1).
  // Same split as the markers above: the instanced MESH is `selection`'s, these
  // two are this cluster's.
  let selectionCellMat: material.Material | null = null;
  let selectionCellBind: binding.Binding | null = null;
  // Studio is the state of seeing (D-F4.5-17), so it is what a host with no chrome
  // attached already renders — the chrome pushing its own default is agreement, not
  // the thing that turns the lights on.
  let shading: FieldHostShading = "studio";

  // Build the per-class lit material cache from `table`: a surface material per
  // class (its colour) plus a backing material per kit class (its backingColor).
  const buildLitMaterials = async (c: Context): Promise<void> => {
    const litShd = await shader.lit(c);
    for (const cls of deps.substrate.table().classes) {
      const surfBind = binding.create(c, litShd);
      binding.set(c, surfBind, { color: cls.color, specular: LIT_SPECULAR });
      const surfMat = await material.create(c, {
        shader: litShd,
        binding: surfBind,
      });
      deps.substrate.litByClass.set(`c${cls.id}`, {
        mat: surfMat,
        bind: surfBind,
      });
      if (cls.kind === "kit") {
        const backBind = binding.create(c, litShd);
        binding.set(c, backBind, {
          color: cls.kit.backingColor,
          specular: LIT_SPECULAR,
        });
        const backMat = await material.create(c, {
          shader: litShd,
          binding: backBind,
        });
        deps.substrate.litByClass.set(`b${cls.id}`, {
          mat: backMat,
          bind: backBind,
        });
      }
    }
  };

  const destroyLitMaterials = (c: Context): void => {
    for (const [, e] of deps.substrate.litByClass) {
      material.destroy(c, e.mat);
      binding.destroy(c, e.bind);
    }
    deps.substrate.litByClass.clear();
  };

  const initMaterials = async (c: Context): Promise<void> => {
    const normalsShd = await shader.normalColor(c); // unlit, normal-distinct faces
    normalsMat = await material.create(c, { shader: normalsShd });
    const kitShd = await shader.litInstanced(c);
    kitBind = binding.create(c, kitShd);
    // White base color — per-instance tint carries the piece colour.
    binding.set(c, kitBind, { color: [1, 1, 1, 1], specular: LIT_SPECULAR });
    kitMat = await material.create(c, { shader: kitShd, binding: kitBind });
    // Kit-fill ghost cube: GHOST_COLOR's hologram-blue as a premultiplied
    // translucent volume (unlit; color = rgb·a so blend.premultiplied
    // composes correctly), depth write OFF so it never occludes the field.
    const ghostShd = await shader.unlit(c);
    ghostBind = binding.create(c, ghostShd);
    binding.set(c, ghostBind, {
      color: [
        GHOST_COLOR[0] * GHOST_CUBE_ALPHA,
        GHOST_COLOR[1] * GHOST_CUBE_ALPHA,
        GHOST_COLOR[2] * GHOST_CUBE_ALPHA,
        GHOST_CUBE_ALPHA,
      ],
    });
    ghostMat = await material.create(c, {
      shader: ghostShd,
      binding: ghostBind,
      blend: material.blend.premultiplied,
      depth: { write: false },
    });
    ghostCubeGeo = geometry.cube(c, { size: 1 });
    ghostCube = mesh.create(c, { geometry: ghostCubeGeo, material: ghostMat });
    // Stamp-ghost material: the same premultiplied hologram-blue recipe as the
    // kit-fill cube, denser (STAMP_GHOST_ALPHA), shared by ALL ghost buckets —
    // the ghost shows the stamp's SHAPE; classes/kit appear on commit.
    stampGhostBind = binding.create(c, ghostShd);
    binding.set(c, stampGhostBind, {
      color: [
        GHOST_COLOR[0] * STAMP_GHOST_ALPHA,
        GHOST_COLOR[1] * STAMP_GHOST_ALPHA,
        GHOST_COLOR[2] * STAMP_GHOST_ALPHA,
        STAMP_GHOST_ALPHA,
      ],
    });
    stampGhostMat = await material.create(c, {
      shader: ghostShd,
      binding: stampGhostBind,
      blend: material.blend.premultiplied,
      depth: { write: false },
    });
    // Void-cast material: the stamp-ghost recipe with two deliberate changes.
    // The tint is cyan (context, not a pending action), and depth COMPARES
    // ALWAYS — the load-bearing one, because an X-ray that respects depth is
    // not an X-ray. Under the default `less`, ANY front-facing opaque surface
    // between eye and cast hides it: a ground/terrain top surface (front-facing
    // from above, and it writes depth) buries every cave beneath it, and so do
    // a nearer cavity's far wall, kit pieces, and placed props — which is
    // exactly the "see the network from outside" case the tool exists for.
    //
    // NOT for z-fighting: the cast's triangles ARE the field's, same diagonal
    // wound backwards (mesher.ts), so with the engine's default `cullMode:
    // "back"` exactly one of any coincident pair survives culling and the two
    // never contend for a pixel. And NOT `depth: false`, which builds a
    // depth-LESS pipeline — invalid in frame.render's depth-having pass
    // (engine-conventions §Depth buffer).
    voidCastBind = binding.create(c, ghostShd);
    binding.set(c, voidCastBind, {
      color: [
        VOID_CAST_COLOR[0] * VOID_CAST_ALPHA,
        VOID_CAST_COLOR[1] * VOID_CAST_ALPHA,
        VOID_CAST_COLOR[2] * VOID_CAST_ALPHA,
        VOID_CAST_ALPHA,
      ],
    });
    voidCastMat = await material.create(c, {
      shader: ghostShd,
      binding: voidCastBind,
      blend: material.blend.premultiplied,
      depth: { write: false, compare: "always" },
    });
    // Walkability markers: UNLIT instanced, white base, so the per-instance
    // severity tint is the pixel and nothing else. Deliberately not the kit's
    // litInstanced material — a marker that dims when the studio key light looks
    // away is a marker that stops doing its job in the mode the editor lives in.
    const markerShd = await shader.unlitInstanced(c);
    flagMarkerBind = binding.create(c, markerShd);
    binding.set(c, flagMarkerBind, { color: [1, 1, 1, 1] });
    flagMarkerMat = await material.create(c, {
      shader: markerShd,
      binding: flagMarkerBind,
    });
    // Selection cells: the same UNLIT instanced shader, premultiplied and
    // depth-write-free like the ghosts — a selection has to read from inside the
    // volume it encloses, which is the whole point (f2b item 1), and a
    // depth-writing translucent would hide the cells behind it. The colour is the
    // material's, not the instances': every cube is the same `--primary` and
    // `createInstanced` already seeds each tint slot white.
    selectionCellBind = binding.create(c, markerShd);
    binding.set(c, selectionCellBind, {
      color: [
        deps.selectedColor[0] * SELECTION_CELL_ALPHA,
        deps.selectedColor[1] * SELECTION_CELL_ALPHA,
        deps.selectedColor[2] * SELECTION_CELL_ALPHA,
        SELECTION_CELL_ALPHA,
      ],
    });
    selectionCellMat = await material.create(c, {
      shader: markerShd,
      binding: selectionCellBind,
      blend: material.blend.premultiplied,
      depth: { write: false },
    });
    await buildLitMaterials(c);
  };

  const bucketMaterial = (
    classId: number,
    backing: boolean,
  ): material.Material => {
    if (shading === "normals") {
      if (!normalsMat) throw new Error("field-host: materials not initialized");
      return normalsMat;
    }
    const key = (backing ? "b" : "c") + classId;
    const hit =
      deps.substrate.litByClass.get(key) ?? deps.substrate.litByClass.get("c0");
    if (!hit) throw new Error("field-host: lit materials not initialized");
    return hit.mat;
  };

  return {
    init: initMaterials,
    rebuildForTable: async (c) => {
      destroyLitMaterials(c);
      await buildLitMaterials(c);
    },
    destroy: (c) => {
      if (normalsMat) material.destroy(c, normalsMat);
      destroyLitMaterials(c);
      if (kitMat) material.destroy(c, kitMat);
      if (kitBind) binding.destroy(c, kitBind);
      if (ghostCube) mesh.destroy(c, ghostCube);
      if (ghostCubeGeo) geometry.destroy(c, ghostCubeGeo);
      if (ghostMat) material.destroy(c, ghostMat);
      if (ghostBind) binding.destroy(c, ghostBind);
      if (stampGhostMat) material.destroy(c, stampGhostMat);
      if (stampGhostBind) binding.destroy(c, stampGhostBind);
      if (voidCastMat) material.destroy(c, voidCastMat);
      if (voidCastBind) binding.destroy(c, voidCastBind);
      if (flagMarkerMat) material.destroy(c, flagMarkerMat);
      if (flagMarkerBind) binding.destroy(c, flagMarkerBind);
      if (selectionCellMat) material.destroy(c, selectionCellMat);
      if (selectionCellBind) binding.destroy(c, selectionCellBind);
    },
    release: () => {
      normalsMat = null;
      kitMat = null;
      kitBind = null;
      ghostCube = null;
      ghostCubeGeo = null;
      ghostMat = null;
      ghostBind = null;
      stampGhostMat = null;
      stampGhostBind = null;
      voidCastMat = null;
      voidCastBind = null;
      flagMarkerMat = null;
      flagMarkerBind = null;
      selectionCellMat = null;
      selectionCellBind = null;
    },
    shading: () => shading,
    setShading: (mode) => {
      shading = mode;
      const c = deps.substrate.ctx();
      if (!c) return;
      for (const cm of deps.substrate.chunkMeshes.values())
        for (const e of cm.entries)
          mesh.setMaterial(c, e.m, bucketMaterial(e.classId, e.backing));
    },
    bucket: bucketMaterial,
    kitInstanced: () => {
      if (!kitMat) throw new Error("field-host: kit material not initialized");
      return kitMat;
    },
    kitMat: () => kitMat,
    stampGhost: () => {
      if (!stampGhostMat)
        throw new Error("field-host: stamp ghost material not initialized");
      return stampGhostMat;
    },
    voidCast: () => {
      if (!voidCastMat)
        throw new Error("field-host: void cast material not initialized");
      return voidCastMat;
    },
    flagMarker: () => flagMarkerMat,
    selectionCell: () => selectionCellMat,
    ghostCube: () => ghostCube,
  };
}
