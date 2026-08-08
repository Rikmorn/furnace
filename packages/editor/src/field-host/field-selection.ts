// The current selection, the Reselect slot beside it, and everything a
// selection LOOKS like: the amber extent outline, the translucent cell cubes,
// the two-click box gesture that builds one and the pending anchor's cross. The
// EIGHTEENTH cluster lifted out of `createFieldHost` (foundations T3d Task 5),
// and the first half of a task the plan paired.
//
// IT LEFT AS ITS OWN MODULE, AND THAT VERDICT IS THE FIRST THING TO RECORD,
// because the plan that scheduled this task predicted otherwise. Its premise was
// that `selection` and `entities` "write each other's capture rungs" and would
// therefore have to travel together the way `stamp` and `move` did (§7.2). They
// do not. All three rungs — `syncBoxAnchorCapture`, `syncSelectionCapture` here
// and `syncSelectedEntityCapture` in `field-entities.ts` — ride on `createRung`
// (`input-router.ts`), and each names only its OWN cluster's state in both
// halves: the liveness predicate and the cancel. Each is called from its own
// cluster's setter and from nowhere else. No cluster writes another's rung, and
// the mechanism that made that true is the router, which T3c put in place.
//
// What the two clusters actually share, measured over every occurrence of all
// **47** of their names in `field-host.ts` at `a07ac5a6` — 9 state + 20 functions
// here, 8 + 10 next door, i.e. both §6 row heads in full — is **ONE directed call
// at ONE site**: `rebuildEntitySelectionBatch` called `selectedBoxOutline`. (This
// read 37 until the Task-5 review: 47 minus `entities`' ten functions, a
// population understated in the one sentence carrying the evidence for the task's
// only open judgment. The sweep itself ran over all 47 and the review re-ran it at
// 47 independently, finding the same single edge and twelve comment-only hits.)
// Zero
// data edges in either direction (§6 says so for both rows and the sweep agrees),
// and nothing here calls into `entities` at all. Compare what the machine's
// "one module, not three" rested on — a BIDIRECTIONAL mutation pair, the
// register's only one (§5.4), a session slot shared three ways and one Esc rung
// that stands while either cluster is live. One directed call on a pure
// colour-bound geometry helper is not that shape, and merging on it would have
// bought a 1,100-line module to avoid a single dep. That call is
// {@link Selection.outline}, and `field-entities.ts` takes it by the same name
// `field-analyzer.ts` already did.
//
// THE ONE ORDERING CONSTRAINT THIS MODULE ADDS, stated here and at both ends in
// `field-host.ts`: `createEntities` must be assembled BELOW `createSelection`,
// because that ref is plain. Everything else about the position was already
// forced — this assembly sits below `createTargeting` (four of its deps are that
// module's) and therefore below `createTool`, which is why
// {@link Selection.spec} reaches `createTool`'s record as an ARROW rather than
// as the plain ref `currentSelectionSpec` used to be. The migration marker at
// that assembly predicted exactly this fork and priced both sides at one line;
// the arrow is the cheap one (one arrow there against four here — `reportError`
// and the three targeting verbs would all have had to reach forward).
//
// THE SEAM IS 20 VERBS OVER A 20-FUNCTION ROW, and the interesting half is which
// twelve went PRIVATE. `setSelection`, `notifySelection`, `refreshSelectionDisplay`
// and `syncSelectionCapture` were all reached from outside the cluster before this
// move, and none of them is on the seam now, because Task 4's rule applies
// cleanly: a private function's outside callers are the seam it needs. The two
// callers were `resetWorld` and the facade's `reselect`, and each wanted a
// STATEMENT GROUP and its ORDER rather than the functions — so they became
// {@link Selection.retireWorld} and {@link Selection.reselect}, one verb each,
// and the four helpers are internal. `selectionAabb` went the same way through
// {@link Selection.box} and {@link Selection.region}: both of its outside readers
// were composed arrows in someone else's deps literal (`cameraRig.selectionBox`,
// `machine.selectionRegion`) that read `selection` AND called `selectionAabb`,
// and §2.7's argument-vs-dependency rule says what a framing verb wants is a box.
// Both collapse to one plain ref, and `SelectionState` never crosses a boundary.
//
// THE CELL LAYER HANDS OVER THE MESH, NOT THE PAIR. `selectionCells` is a
// `{ im, g } | null` written as one unit; the frame wants the instanced mesh and
// the geometry is this module's to free. So {@link Selection.cellMesh} is
// `mesh.InstancedMesh | null` and the `?.im ?? null` the host bridged the gap
// with disappears rather than migrating — `field-render.ts`'s own dep doc named
// that as a REQUIREMENT on this task, on `advisor.markerMesh`'s precedent.
//
// THREE CONSTANTS DID NOT COME, and the argument that kept them in
// `field-host.ts` has changed rather than expired. `SELECTION_COLOR`,
// `SELECTED_COLOR` and `ANCHOR_CROSS_HALF_M` were declared there on a "two
// owners-to-be" argument — a constant shared with a reader still in the closure
// stays where both can see it. After this move NO host function reads any of the
// three, and each has two or three MODULE readers instead
// (`SELECTION_COLOR` here + `field-render.ts`; `ANCHOR_CROSS_HALF_M` here +
// `field-segment.ts` + `field-render.ts`; `SELECTED_COLOR` here +
// `field-materials.ts`). They still travel as plain VALUE deps, now from a
// neutral declaration rather than a shared-with-the-host one, because picking an
// owner among PEERS is a naming decision with no code consequence — and the
// spelling that implements it would make two sibling modules value-import a third
// for a literal, which is a load-order edge where there is none today. The stay is
// declared at source in `field-host.ts`; the choice of an accent-vocabulary owner
// is the prune tranche's, and it is a deletion-pass question, not a threading one.
//
// NO UNIT TEST, by the house pattern eleven extractions old — the argument is
// `tests/field-host/field-machine.test.ts`'s header and is not re-made here. The
// host suites passing UNMODIFIED are this module's contract, and the honest
// statement of which they are is short: **there is no `field-host-selection`
// suite at all.** Grepping every test that drives this seam gives NINE files, and
// only three of them reach a host — `field-host-selection-cells.gpu.test.ts` (the
// cell display and its cap), `field-host-escape.gpu.test.ts` (five of the eight
// Esc rungs, the world-swap capture release, and the PARK-not-clear contract) and
// `field-host-stamp-entry.gpu.test.ts` (the two-click corner machinery and
// {@link Selection.region} through the machine); the rest are chrome. Two more
// reach it sideways: `field-host-camera.gpu.test.ts` frames the cell selection and
// `field-host-pointer.gpu.test.ts` exercises the click arbitration around it.
//
// **THAT IS THINNER THAN THE ROW LOOKS, AND IT IS MEASURED RATHER THAN FEARED.**
// Twelve sabotage probes across this file and `field-entities.ts`, every one
// against the full 2,912-test suite, and the five on this side that came back
// GREEN are named with the exact line that was cut — no "unpinned" below was
// written without deleting the line and running the suite, which is the rule T3d
// Task 4 learned the expensive way.
//
//   - `cellMesh()` forced to `null` — **2912/0**. The cell display's whole GPU
//     handover is unpinned as OUTPUT, and the reason is exact:
//     `field-host-selection-cells.gpu.test.ts` carries 19 `expect(` calls, of which
//     **7 read `selectionCellCount()` and 10 read the `SelectionInfo` payload** —
//     the other two are camera-eye framing assertions — and the instanced MESH is
//     asserted at **ZERO** sites. (An earlier draft said "nineteen sites" for the
//     count and the payload together; nineteen is the file's TOTAL, which is the
//     kind of slip §2.10 is about. The load-bearing half — zero mesh assertions —
//     is unchanged.) The count and the upload are decided by ONE function
//     (`rebuildSelectionCells`): the count settles at its first statement and the
//     upload sits behind the `if (!c || !cellMat) return` guard below it, which is
//     precisely why the count is well pinned and everything past the guard is not.
//     §2.8's "the suite pins that the frame RUNS, not what it DRAWS", measured on
//     the one cluster that has a dedicated GPU suite for its own display.
//   - `refreshSelectionDisplay()` deleted from {@link Selection.retireWorld} —
//     **2912/0**. Gutting that verb ENTIRELY reddens exactly ONE test
//     (`field-host-escape.gpu.test.ts`, "a world swap releases the selection
//     capture the bare clear leaves behind"), so of its five statements only
//     `syncSelectionCapture()` is pinned at all. The five are still one verb for
//     the reason the bare write always owed the Esc stack, not because a test
//     says so.
//   - {@link Selection.reselect}'s manual swap replaced by `setSelection` —
//     **2912/0**. The two differ only when the current selection is already
//     `null`: the swap parks `null` and keeps toggle symmetry, the setter leaves
//     the slot alone. Reachable (clear → Reselect → Reselect) and asserted
//     nowhere.
//   - `setBoxAnchor(null)` deleted from {@link Selection.clear} — **2912/0**.
//     The SAME line inside {@link Selection.boxCorner} reddens THREE tests in
//     `field-host-escape.gpu.test.ts`, so the anchor's clear is pinned on the
//     gesture path and not on the panel's Clear.
//   - {@link Selection.outline} drawn at the amber instead of the accent —
//     **2912/0**. No test asserts a colour anywhere in the overlay, which is the
//     same hole `field-host.ts` records for `SELECTED_COLOR`'s linear-sRGB
//     conversion ("arithmetic plus review").
//
// What IS pinned on this side: the box gesture's anchor clear (3 tests) and the
// Esc stack's world-swap reconcile (1). Both are in one file.
import * as field from "@furnace/core/field";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import type * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import { regionSampleCount, snapSpan } from "../shared/field-brush.ts";
import { SELECTION_UI_BUDGET } from "../shared/field-limits.ts";
import { boxCentre, boxEdges } from "./box-edges.ts";
import { boxCorners, crossSegments } from "./field-ghost.ts";
import type { SelectionInfo, SelectionMode } from "./field-host.ts";
import {
  SELECTION_DISPLAY_CAP,
  selectionDisplayCells,
} from "./field-selection-cells.ts";
import { createRung, type InputRouter } from "./input-router.ts";
import { segmentsToBatch } from "./reference-grid.ts";
import type { HostSubstrate } from "./substrate.ts";
import { createViewChannel } from "./view-channel.ts";

type Vec3T = [number, number, number];
type Box = { min: Vec3T; max: Vec3T };
type Rgba = [number, number, number, number];

/** A prebuilt drawLines batch (vertices + per-vertex colors). */
type LineBatch = { vertices: Float32Array; colors: Float32Array };

/** The host's stored selection: the replayable spec + its click-time
 *  materialization. The materialization feeds UI info + the overlay ONLY —
 *  a selection-masked op embeds the SPEC and core re-materializes it against
 *  pre-op state at each application (replay-safe by construction).
 *
 *  Private to this module and it stays that way: the two readers that used to
 *  need it (`cameraRig.selectionBox`, `machine.selectionRegion`) take a BOX and a
 *  region-plus-truncation instead, so nothing outside this file names the shape.
 *  `field-machine.ts` records the same fact from the other side. */
type SelectionState = {
  spec: field.SelectionSpec;
  materialized: field.MaterializedSelection;
};

/** What the selection needs from the rest of the host.
 *
 *  TEN members: the substrate, the Esc router, one material accessor, three
 *  cursor verbs off `field-targeting.ts`, one error reporter off
 *  `field-tool.ts`, and three constants by value. Four of the ten are plain refs
 *  onto sibling module seams and are the reason this assembly sits where it does;
 *  see this module's header for the fork that decided it. */
export type SelectionDeps = {
  /** The host's shared state. Two members are read: `store` (cell size, the
   *  flood seed's material class, and the materialization itself) and `ctx()`
   *  (the cell layer's uploads, which no-op before init and after dispose). */
  substrate: HostSubstrate;
  /** The Esc capture stack. Two rungs are registered on it — the pending box
   *  anchor and the live cell selection — and they stay router-mediated rather
   *  than becoming a seam of their own; `field-segment.ts` states the argument. */
  router: InputRouter;
  /** The cell-selection cubes' material, or `null` before GPU init and after
   *  dispose. `field-materials.ts`' — built by one `init` and freed by one
   *  `dispose` alongside every other material, while the instanced mesh over it
   *  is rebuilt per selection change and belongs here. */
  selectionCellMat(): material.Material | null;
  /** The world point under the cursor a selection corner snaps from, or `null`
   *  when the ray hits nothing. `field-targeting.ts`'. */
  selectionPoint(clientX: number, clientY: number): Vec3T | null;
  /** The solid voxel under the cursor, for a material flood's seed. */
  materialSeedVoxel(clientX: number, clientY: number): Vec3T | null;
  /** The empty voxel under the cursor, for a void flood's seed. */
  voidSeedVoxel(clientX: number, clientY: number): Vec3T | null;
  /** Report a refusal to the user. `field-tool.ts`' — a selection that fails to
   *  materialize and a flood that matches nothing both go out this way. */
  reportToolError(message: string): void;
  /** The host's `SELECTION_COLOR`: the amber every part of the selection overlay
   *  is drawn in. A plain VALUE with sibling-module readers; see the header. */
  selectionColor: Rgba;
  /** The host's `SELECTED_COLOR`: the editor's `--primary` accent, the colour of
   *  {@link Selection.outline} and of nothing else in this file. */
  selectedColor: Rgba;
  /** The host's `ANCHOR_CROSS_HALF_M`: half-length of each axis stroke in the
   *  pending box anchor's cross (m). The same constant `field-segment.ts` takes,
   *  handed to a second module the same way. */
  anchorCrossHalfM: number;
};

/** The selection cluster's seam: what is selected, what the frame draws for it,
 *  what a click does to it, and the four lifecycle points that own its GPU half.
 *
 *  Nothing here hands out {@link SelectionState}. The two questions other
 *  clusters actually ask — "what box is selected" and "what region would a stamp
 *  open on" — are {@link box} and {@link region}, each one call where the closure
 *  made two reads. */
export type Selection = {
  /** The current selection's replayable spec, or `null`. `field-tool.ts`'s
   *  selection mask reads this on every apply — the stored spec is never mutated
   *  in place (selections replace wholesale), so embedding it into ops without a
   *  copy is aliasing-safe. */
  spec(): field.SelectionSpec | null;
  /** The current selection's metre AABB, or `null` for no selection and for a
   *  flood that matched no cells. ONE answer where `frameTargetBox` used to read
   *  the slot and then call the AABB helper: the two nulls are indistinguishable
   *  to a framing verb. */
  box(): Box | null;
  /** The two facts a stamp needs off the CURRENT selection, as one call. `null`
   *  covers both "nothing selected" and "selected, but no bounds" — `startStamp`
   *  arms region-draw for either, so one null says what two branches used to. */
  region(): { aabb: Box; truncated: boolean } | null;
  /** THE selected-thing outline: the 12-edge AABB batch at the editor's accent.
   *  Two callers and they are deliberately the two overlays that must never drift
   *  apart — the selected ENTITY's footprint box (`field-entities.ts`) and the
   *  selected FINDING's cell (`field-analyzer.ts`). One function is what makes
   *  "both wear `--primary`" a fact rather than two call sites that happen to name
   *  the same constant. It is also the ONLY thing `field-entities.ts` takes from
   *  this module. */
  outline(aabb: Box): LineBatch;
  /** The pending box-select anchor: the first click's world point, or `null`.
   *  Read as a liveness question by the cursor affordance and by the pointer
   *  chain's arbitration. */
  boxAnchor(): Vec3T | null;
  /** Set (or clear) the pending box anchor, rebuilding its cross and dropping
   *  the pending-region preview with it. The Esc rung reconciles inside. */
  setBoxAnchor(p: Vec3T | null): void;
  /** One click of the two-click BOX corner machinery, shared by the cell-select
   *  box gesture and the pending stamp's region draw (D-F4.5-7). The first click
   *  anchors and answers `null`; the second closes and answers the snapped region
   *  the pair spans. A cursor that resolves to no surface point answers `null` and
   *  changes nothing. */
  boxCorner(clientX: number, clientY: number): field.SelectionSpec | null;
  /** Rebuild the live box preview — the amber AABB of the SNAPPED region the
   *  second click would commit. Called on pointer MOVE while an anchor is
   *  pending, never per frame. */
  updateBoxPreview(clientX: number, clientY: number): void;
  /** One LMB click while a selection mode is armed (applyTool is bypassed). The
   *  mode is a PARAMETER, not a read of the armed gesture: the segment gesture
   *  shares that slot, and a bare else-fallthrough would have silently
   *  flood-selected void for it. */
  click(mode: SelectionMode, clientX: number, clientY: number): void;
  /** {@link FieldHost.clearSelection}: drop the pending anchor AND park the
   *  current selection in the Reselect slot. Both halves through one verb, so no
   *  path can clear one and leave the other standing. */
  clear(): void;
  /** {@link FieldHost.reselect}: swap the current selection with the Reselect
   *  slot. A manual swap rather than {@link clear}'s setter, because the setter
   *  would overwrite the slot being restored — and the bypass is about the SLOT,
   *  not about the Esc stack, which captures here like any other selection going
   *  live. */
  reselect(): void;
  /** Everything a WORLD SWAP does to the selection: clear both slots without
   *  parking, reconcile the Esc stack, refresh both display halves and push the
   *  null. Not {@link clear} — a Reselect across a world swap would restore cells
   *  describing the field that just went away. `field-analyzer.ts`'s
   *  `retireWorld` is the same act on the other cluster and the name is shared on
   *  purpose. */
  retireWorld(): void;
  /** {@link FieldHost.subscribeSelection}. Snapshots on subscribe (the remount
   *  rule: a surface arriving while a selection exists must not render "no
   *  selection" beside a visible amber overlay). */
  subscribe(cb: (info: SelectionInfo | null) => void): () => void;
  /** How many cell cubes the display settled on. `0` for a region selection by
   *  design — a region draws a box, not cubes. */
  cellCount(): number;
  /** The cell-selection display's instanced mesh, or `null`. The MESH alone: the
   *  geometry beside it is this module's to free and the frame never wanted it
   *  (`advisor.markerMesh`'s precedent). */
  cellMesh(): mesh.InstancedMesh | null;
  /** The current selection's extent outline, or `null`. */
  batch(): LineBatch | null;
  /** The pending anchor's cross, or `null`. */
  anchorBatch(): LineBatch | null;
  /** The pending region's preview box, or `null`. */
  previewBatch(): LineBatch | null;
  /** Rebuild the cell cubes. Called from `ret.init` as well as from every
   *  selection change: the selection survives a dispose (it is CPU state), so a
   *  re-init — the AA switch, which never touches the selection — would otherwise
   *  come back with the outline and no cubes. */
  rebuildCells(): void;
  /** Free the cell layer's GPU handles. `ret.dispose`'s, beside every other
   *  destroy in that context block. */
  destroyCells(c: Context): void;
};

/** Build the selection over one host's dependencies. One per host; it holds that
 *  host's current selection, its Reselect slot, the box gesture's anchor and the
 *  four batches the frame draws, for the host's lifetime. */
export function createSelection(deps: SelectionDeps): Selection {
  const { substrate } = deps;

  // Pending box-select anchor: the first click's world point (null = none).
  let boxAnchor: Vec3T | null = null;
  let selection: SelectionState | null = null;
  // The Reselect slot: the one previous selection (clear/replace park it here).
  let lastSelection: SelectionState | null = null;
  // Overlay line batches, rebuilt on selection/anchor CHANGE — never per frame
  // (materializeSelection cost lives on the click; the overlay is stored). The
  // box preview below is the one exception to "on change": it rebuilds on
  // pointer MOVE while a box anchor is pending — still never per frame.
  let selectionBatch: LineBatch | null = null;
  let anchorBatch: LineBatch | null = null;
  // The snapped-region AABB the pending anchor + cursor would commit, rebuilt on
  // pointer MOVE (never per frame). Null unless a box anchor is pending; cleared
  // with the anchor (setBoxAnchor(null)).
  let boxPreviewBatch: LineBatch | null = null;
  // The cell-level selection display (f2b gate item 1): ONE translucent instanced
  // cube per drawn cell of a `cells` selection, so a flood the camera is standing
  // inside reads as a shape rather than as an AABB outline the user cannot see
  // from within. Null for a region selection, for no selection, and before GPU
  // init. `selectionCellsCount` is the twin of the advisor marker layer's own
  // count (`field-analyzer.ts`) — decided by every rebuild, uploaded only when a
  // context exists.
  let selectionCells: { im: mesh.InstancedMesh; g: geometry.Geometry } | null =
    null;
  let selectionCellsCount = 0;

  // Metre AABB of a stored selection: a region's own bounds; a flood's cell
  // bounds expanded to enclose whole voxel volumes (sample i spans
  // [i·h, (i+1)·h) — bounds×h alone would give a single cell zero volume).
  const selectionAabb = (s: SelectionState): Box | null => {
    if (s.materialized.kind === "region")
      return { min: [...s.materialized.min], max: [...s.materialized.max] };
    const b = s.materialized.bounds;
    if (b === null) return null;
    const h = substrate.store.cellSize;
    return {
      min: [b.min[0] * h, b.min[1] * h, b.min[2] * h],
      max: [(b.max[0] + 1) * h, (b.max[1] + 1) * h, (b.max[2] + 1) * h],
    };
  };

  // Clone a spec so the panel (via SelectionInfo) never holds references into
  // host selection state.
  const cloneSelectionSpec = (s: field.SelectionSpec): field.SelectionSpec => {
    if (s.kind === "region")
      return { kind: "region", min: [...s.min], max: [...s.max] };
    if (s.kind === "flood-material")
      return {
        kind: "flood-material",
        seed: [...s.seed],
        classId: s.classId,
        budget: s.budget,
      };
    return { kind: "flood-void", seed: [...s.seed], budget: s.budget };
  };

  const selectionInfo = (s: SelectionState): SelectionInfo => {
    const count =
      s.materialized.kind === "cells"
        ? s.materialized.count
        : regionSampleCount(
            s.materialized.min,
            s.materialized.max,
            substrate.store.cellSize,
          );
    return {
      spec: cloneSelectionSpec(s.spec),
      count,
      truncated: s.materialized.kind === "cells" && s.materialized.truncated,
      aabb: selectionAabb(s),
      // Present only when the display is PARTIAL. A region's `selectionCellsCount`
      // is 0 by design (it draws a box, not cubes) and reporting that as
      // "displaying 0 of 400" would be a truthful number describing the wrong
      // thing, so the test is against the cell layer's own domain.
      ...(s.materialized.kind === "cells" && selectionCellsCount < count
        ? { displayed: selectionCellsCount }
        : {}),
    };
  };

  // The snapshot is the (re)mount rule: a surface arriving while a selection
  // exists must not render "no selection" next to a visible amber overlay. It
  // spells out the same expression `notifySelection` publishes — one clone per
  // arrival, exactly as the single-slot subscribe body did.
  const selectionChannel = createViewChannel<[SelectionInfo | null]>({
    snapshot: () => [selection === null ? null : selectionInfo(selection)],
  });

  // ONE payload per publish, shared by every subscriber: the clone is at the
  // PUBLISH boundary, not per delivery, so a pushed value is shared across
  // subscribers and must be treated as immutable by all of them.
  const notifySelection = (): void => {
    selectionChannel.publish(
      selection === null ? null : selectionInfo(selection),
    );
  };

  // The 12-edge line batch of a metre AABB — the cell-selection overlay and the
  // selected entity's footprint box share it.
  const aabbEdgeBatch = (aabb: Box, color: Rgba): LineBatch => {
    const center = boxCentre(aabb);
    const half: Vec3T = [
      (aabb.max[0] - aabb.min[0]) / 2,
      (aabb.max[1] - aabb.min[1]) / 2,
      (aabb.max[2] - aabb.min[2]) / 2,
    ];
    return boxEdges(boxCorners(center, half), color);
  };

  const rebuildSelectionBatch = (): void => {
    const aabb = selection === null ? null : selectionAabb(selection);
    selectionBatch =
      aabb === null ? null : aabbEdgeBatch(aabb, deps.selectionColor);
  };

  const destroySelectionCells = (c: Context): void => {
    if (!selectionCells) return;
    mesh.destroyInstanced(c, selectionCells.im);
    geometry.destroy(c, selectionCells.g);
    selectionCells = null;
  };

  // Rebuild the cell-level selection display: ONE translucent instanced cube per
  // drawn cell, shell first, capped (see field-selection-cells.ts). Runs on
  // selection COMMIT and never per frame — the enumeration is O(selected cells)
  // and the cells cannot change without a new selection.
  //
  // `cells` materializations ONLY. A REGION keeps the honest AABB outline it has
  // always had: a region IS its box, so filling it with cubes would draw the same
  // information at 65 000× the cost. The outline stays for floods too — it is the
  // extent, and the cubes are the shape.
  const rebuildSelectionCells = (): void => {
    const materialized = selection?.materialized;
    const plan =
      materialized === undefined || materialized.kind !== "cells"
        ? null
        : selectionDisplayCells(materialized.chunks, SELECTION_DISPLAY_CAP);
    // The count settles FIRST and unconditionally (`rebuildFlagMarkers`' rule,
    // now in `field-analyzer.ts`): it is what the layer IS, and a host with no
    // context has still decided it.
    selectionCellsCount = plan?.displayed ?? 0;
    const c = substrate.ctx();
    // Bound to a local because the material is a CALL now (`field-materials.ts`):
    // the guard and the upload are two reads of one slot, and narrowing does not
    // survive a call boundary.
    const cellMat = deps.selectionCellMat();
    if (!c || !cellMat) return;
    destroySelectionCells(c);
    if (plan === null || plan.displayed === 0) return;
    const g = geometry.cube(c, { size: 1 });
    const im = mesh.createInstanced(c, {
      geometry: g,
      material: cellMat,
      count: plan.displayed,
    });
    // One cell cube per instance, the flag-marker matrix layout: uniform scale on
    // the diagonal, position in the last column, no rotation. A cell spans
    // `[i·h, (i+1)·h)` so its CENTRE is half a cell past its sample corner —
    // the same offset `selectionAabb` applies when it expands a flood's cell
    // bounds to whole voxel volumes.
    const h = substrate.store.cellSize;
    const matrices = new Float32Array(16 * plan.displayed);
    for (let i = 0; i < plan.displayed; i++) {
      const o = i * 16;
      matrices[o] = h;
      matrices[o + 5] = h;
      matrices[o + 10] = h;
      matrices[o + 12] = ((plan.cells[i * 3] as number) + 0.5) * h;
      matrices[o + 13] = ((plan.cells[i * 3 + 1] as number) + 0.5) * h;
      matrices[o + 14] = ((plan.cells[i * 3 + 2] as number) + 0.5) * h;
      matrices[o + 15] = 1;
    }
    mesh.setInstanceMatrices(c, im, matrices);
    // No per-instance tint: `createInstanced` seeds every slot WHITE and the
    // material's premultiplied `--primary` is the colour, so 65 000 setInstanceTint
    // calls would each write the same four floats they already hold.
    selectionCells = { im, g };
  };

  // A half-drawn box: the anchor the next click would close. Its own Esc entry,
  // and the segment anchor's is its own too — the old rung 1 cleared BOTH in one
  // press, but the arming rules make the pair unreachable (`setGesture` drops
  // both on any switch, a stamp arm drops both), so the dual clear was guarding a
  // state that cannot happen and one entry each says the same thing honestly.
  const syncBoxAnchorCapture = createRung(
    deps.router,
    "box anchor",
    () => boxAnchor !== null,
    () => setBoxAnchor(null),
  );

  const setBoxAnchor = (p: Vec3T | null): void => {
    boxAnchor = p;
    if (p === null) {
      anchorBatch = null;
      boxPreviewBatch = null; // the pending-region preview dies with its anchor
    } else {
      anchorBatch = segmentsToBatch(
        crossSegments(p, deps.anchorCrossHalfM),
        deps.selectionColor,
      );
    }
    syncBoxAnchorCapture();
  };

  // Install a new current selection (null = clear): park the displaced one in
  // the Reselect slot, rebuild the overlay, notify the panel.
  // Both halves of what a selection LOOKS like — the extent outline and the cell
  // cubes — through one call, so no path can refresh one and forget the other.
  // It exists because a path did: `reselect` does its own swap (setSelection
  // would overwrite the slot it is restoring) and so had its own pair of rebuild
  // calls, which is precisely how the cell layer came back empty from a Reselect
  // while the outline came back correct.
  //
  // Always BEFORE a `notifySelection`, because `selectionInfo` reports how many
  // cells the display settled on (the `publishFlags` ordering rule, now stated in
  // `field-analyzer.ts`: no subscriber may read a payload whose overlay is still
  // the previous selection's).
  const refreshSelectionDisplay = (): void => {
    rebuildSelectionBatch();
    rebuildSelectionCells();
  };

  // The cell selection's Esc entry (old rung 4). Its cancel is the SETTER's null,
  // not a bespoke clear, so Esc parks the selection in the Reselect slot exactly
  // as the panel's Clear does — an Esc that went one rung too far has the same way
  // back a Clear has.
  //
  // TWO paths write `selection` without this setter (`retireWorld`'s teardown and
  // `reselect`'s swap, each for its own documented reason), and both call this
  // reconcile in the same breath. A REPLACE keeps the entry's position by
  // construction — the slot is still full, so nothing is pushed.
  const syncSelectionCapture = createRung(
    deps.router,
    "cell selection",
    () => selection !== null,
    () => setSelection(null),
  );

  const setSelection = (next: SelectionState | null): void => {
    if (selection !== null) lastSelection = selection;
    selection = next;
    syncSelectionCapture();
    refreshSelectionDisplay();
    notifySelection();
  };

  // The outward-0.5 lattice snap lives in field-brush.ts (snapSpan) — shared
  // with the stamp session's selection→region derivation.
  const boxRegionSpec = (a: Vec3T, b: Vec3T): field.SelectionSpec => {
    const [x0, x1] = snapSpan(a[0], b[0]);
    const [y0, y1] = snapSpan(a[1], b[1]);
    const [z0, z1] = snapSpan(a[2], b[2]);
    return { kind: "region", min: [x0, y0, z0], max: [x1, y1, z1] };
  };

  // Materialize a gesture-built spec into the current selection. Runs on the
  // CLICK only (never per frame — full-budget floods cost ~60-80ms). A flood
  // can legitimately come up empty (nothing matched); that reports instead of
  // silently displacing the current selection.
  const commitSelectionSpec = (spec: field.SelectionSpec): void => {
    let materialized: field.MaterializedSelection;
    try {
      materialized = field.materializeSelection(substrate.store, spec);
    } catch (err) {
      // Setup-loud spec validation (integer seeds, budget range) — gesture-
      // built specs shouldn't trip it; swallow so a bug can't escape the
      // pointer handler.
      const message = err instanceof Error ? err.message : String(err);
      deps.reportToolError(`selection failed: ${message}`);
      return;
    }
    if (materialized.kind === "cells" && materialized.count === 0) {
      deps.reportToolError(
        "selection found no matching cells at the click point",
      );
      return;
    }
    setSelection({ spec, materialized });
  };

  const boxCorner = (
    clientX: number,
    clientY: number,
  ): field.SelectionSpec | null => {
    const p = deps.selectionPoint(clientX, clientY);
    if (!p) return null;
    if (boxAnchor === null) {
      setBoxAnchor(p); // first corner — the amber cross previews it
      return null;
    }
    const spec = boxRegionSpec(boxAnchor, p);
    setBoxAnchor(null);
    return spec;
  };

  return {
    spec: () => selection?.spec ?? null,
    box: () => (selection === null ? null : selectionAabb(selection)),
    region: () => {
      const sel = selection;
      if (sel === null) return null;
      const aabb = selectionAabb(sel);
      if (aabb === null) return null;
      return {
        aabb,
        truncated:
          sel.materialized.kind === "cells" && sel.materialized.truncated,
      };
    },
    outline: (aabb) => aabbEdgeBatch(aabb, deps.selectedColor),
    boxAnchor: () => boxAnchor,
    setBoxAnchor,
    boxCorner,
    // Box-select live preview: the amber AABB of the SNAPPED region the second
    // click would commit (boxRegionSpec of anchor→cursor), rebuilt on pointer
    // MOVE while a box anchor is pending. A region spec's min/max ARE its metre
    // AABB, so build the edge batch directly (no materializeSelection). A cursor
    // that resolves to no surface point leaves the last preview untouched — a
    // transient miss must not flicker the box off.
    updateBoxPreview(clientX, clientY) {
      if (boxAnchor === null) return;
      const p = deps.selectionPoint(clientX, clientY);
      if (!p) return;
      const spec = boxRegionSpec(boxAnchor, p);
      // boxRegionSpec only ever builds a region; this kind check narrows the
      // field.SelectionSpec union so min/max are accessible (cf. cloneSelectionSpec).
      if (spec.kind !== "region") return;
      // spec.min/max are fresh tuples nothing else aliases, and aabbEdgeBatch
      // reads them without retaining a reference — pass them directly (no copy).
      boxPreviewBatch = aabbEdgeBatch(
        { min: spec.min, max: spec.max },
        deps.selectionColor,
      );
    },
    click(mode, clientX, clientY) {
      if (mode === "box") {
        const spec = boxCorner(clientX, clientY);
        if (spec !== null) commitSelectionSpec(spec);
        return;
      }
      if (mode === "material") {
        const seed = deps.materialSeedVoxel(clientX, clientY);
        if (!seed) return;
        const store = substrate.store;
        commitSelectionSpec({
          kind: "flood-material",
          seed,
          classId: field.getMaterial(store, seed[0], seed[1], seed[2]),
          budget: SELECTION_UI_BUDGET,
        });
        return;
      }
      const seed = deps.voidSeedVoxel(clientX, clientY);
      if (!seed) return;
      commitSelectionSpec({
        kind: "flood-void",
        seed,
        budget: SELECTION_UI_BUDGET,
      });
    },
    clear() {
      setBoxAnchor(null);
      setSelection(null); // parks the current selection in the Reselect slot
    },
    reselect() {
      if (lastSelection === null) return;
      // Manual swap — setSelection would overwrite the slot being restored.
      const restored = lastSelection;
      lastSelection = selection; // may be null: the swap keeps toggle symmetry
      selection = restored;
      // The bypass is about `lastSelection`, NOT about the Esc stack: this is a
      // selection going live, so it captures like any other. Restoring one that
      // Esc had cleared pushes a fresh entry at the top, which is right — the
      // Reselect IS the most recent intent; a swap while one already stands keeps
      // the position it had, which is the plain REPLACE rule.
      syncSelectionCapture();
      refreshSelectionDisplay();
      notifySelection();
    },
    retireWorld() {
      // Not `setSelection(null)`: that PARKS the outgoing selection in the
      // Reselect slot, and a Reselect across a world swap would restore cells
      // that describe the field that just went away — so this path clears both
      // slots itself. The reconcile is what the bare write owes the Esc stack;
      // without it the capture outlives the selection and the next Esc is spent
      // cancelling nothing.
      selection = null;
      lastSelection = null;
      syncSelectionCapture();
      // Both display halves through the shared refresh, so the outline and the
      // cell layer cannot survive a world swap independently of each other.
      refreshSelectionDisplay();
      notifySelection(); // null — the panel must not show a stale selection
    },
    subscribe: (cb) => selectionChannel.subscribe(cb),
    cellCount: () => selectionCellsCount,
    cellMesh: () => selectionCells?.im ?? null,
    batch: () => selectionBatch,
    anchorBatch: () => anchorBatch,
    previewBatch: () => boxPreviewBatch,
    rebuildCells: rebuildSelectionCells,
    destroyCells: destroySelectionCells,
  };
}
