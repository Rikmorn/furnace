// The frame: which meshes, which instanced draws, which line batches, in which
// order, under which layer gates. The fourteenth cluster lifted out of
// `createFieldHost`, and the one the closure map called "pure fan-in — the one
// function that has to see everything" (§7.2).
//
// THE PRIVATE NAMES CHANGED AT T4C AND SIBLING PROSE WAS RE-POINTED, recorded
// here because a reader will meet the old ones in dated records under `docs/` and
// they are not typos: `renderScene` → {@link Render.compose} (it stopped being the
// whole frame and became the draw-list build), `renderGhostLines` →
// `ghostLineBatch` and `renderCursorAffordance` → `cursorAffordanceBatch` (both
// stopped drawing and started returning a batch). Every mention in
// `packages/editor/src` and `packages/editor/tests` was re-pointed in the same
// commit — 47 of them across ten files, most of them sibling modules saying which
// function reads their container. `docs/learnings/`, `docs/superpowers/` and
// `docs/reference/field-host-clusters.md`'s dated per-binding tables keep the old
// spelling on purpose: they are measurements of a commit, not descriptions of head.
//
// TWO VERBS OUT OF SIX FUNCTIONS AND TWENTY-NINE DEPS, and the second verb is
// two days old. It was ONE verb — `scene` — until foundations T4c, when the
// agent-facing capture needed the same draw list aimed at an off-screen texture
// and the frame split along the seam it already had: {@link Render.compose}
// BUILDS the lists (and is the whole of the gating, the ordering and the
// arithmetic), {@link Render.scene} SUBMITS them at the swap chain. Four of the
// six functions are still module-private for `field-picking.ts`'s reason —
// `sceneLights`, `ghostState`, `ghostLineBatch` and `cursorAffordanceBatch` are
// called by `compose` and by nothing else — and the inversion the cluster was
// named for is unchanged: it OWNS almost nothing (five bindings — two grid
// batches, their source segments, and two scratch vectors for the ghost cube's
// pose) and it READS almost everything.
//
// WHAT THE SPLIT MUST NOT DO is change a pixel of the live frame, and the shape
// that keeps that true is worth stating: `scene` is now literally
// `compose(c)` followed by the submit it always did, with the SAME gate
// expressions evaluated in the SAME order and the thirteen possible `drawLines`
// passes issued in the same order after `frame.render`. Nothing runs between the
// build and the submit — `frame.render` used
// to sit in the middle of the gate sequence, and it reads no host state and calls
// nothing back, so hoisting every gate above it cannot change what any of them
// answers. The pins that would notice are named at the bottom of this header, and
// the honest reading of them is that there are almost none: this is a change the
// suite cannot check and the Safari gate can.
//
// WHY THE MAP'S ZERO-MUTATION ROW IS THE INTERESTING NUMBER. `render` is one of
// four clusters with no mutation edge in either direction (§5.6), and that is
// what makes a 29-member deps record safe rather than alarming: every entry below
// is a READ. Nothing in this file writes another cluster's state, nothing writes
// this one's, and the only mutation it performs at all is posing the host's own
// ghost cube on the GPU — through a `mesh.setPosition`/`setScale` pair on a
// handle it asks for by call. A record this wide would be a design smell if any
// of it were a write-thunk; as reads it is a photograph of what a frame IS.
//
// THAT ONE MUTATION NOW HAS A SECOND CALLER, and it stays inside `compose`
// deliberately rather than being lifted to the submit side where it would leave
// `compose` pure. Three reasons, in the order they decided it. (1) The ghost's
// pose does not depend on the camera it will be DRAWN from: `ghostState` reaches
// `computeTarget`, which raycasts through the LIVE camera whatever
// `compose`'s caller intends to do with the result, so composing for a capture
// computes the same box the live frame computes and re-posing the cube to it is
// idempotent. (2) A pure `compose` would have to hand the pose back as data and
// let the submit side apply it — and the cube's position in `meshes` is
// load-bearing (it composites against the stamp ghosts by submission order),
// so that means either a second list or an index, both of which restructure the
// live path this task must freeze. (3) Left un-posed on the capture path the cube
// would draw at whatever the last frame that INCLUDED it left behind, which is
// wrong exactly when the gates differ between the two — a gesture disarmed since
// the last live frame is enough. Posing in `compose` makes the capture agree with
// the frame by construction instead of by luck.
//
// AND THE INTERLEAVING IS NOT A HAZARD, because of where the awaits are: the
// capture's `compose` → `renderToTexture` → `drawLinesToTexture` →
// `copyTextureToBuffer` are all SYNCHRONOUS and all submitted before its first
// `await` (`field-capture.ts` states the same fact from its end). So a live
// `tick` can neither land between the capture's pose write and its draws, nor see
// a cube the capture posed and the next frame has not re-posed.
//
// NONE OF THE TWENTY-NINE NAMES HOST STATE ANY MORE, and the arithmetic of
// getting here is the whole argument for how this record is shaped. It was
// ELEVEN such deps until 2026-08-08: `tool` and `camera` took three at T3d Task 4
// (`digRadius`, `isKitFillTool`, `cameraEye`) and `selection` and `entities` took
// the last EIGHT at Task 5 — `boxAnchor`, `selectionBatch`, `anchorBatch`,
// `boxPreviewBatch`, `selectionCellMesh`, `entitySelectionBatch`, `gizmoBatch`
// and `gizmoVisible`.
//
// THE PREDICTION WAS MADE AT TASK 3 AND IS NOW MEASURED TWICE. It said each
// dep's ASSEMBLY-SITE spelling would change from `() => digRadius` to
// `tool.digRadius` and **the shape of this file would not change at all** — no
// signature, no body, no type. Task 4 re-pointed three and this file's whole diff
// was SIX comment sites and zero lines of code; Task 5 re-pointed the other eight
// and the diff is comment sites and zero lines of code again. Eleven deps moved
// house and not one signature here was touched. That is exactly why these are
// eleven NARROW named deps rather than four module records passed whole: a deps
// record that names what it reads survives its neighbours' extractions; one that
// names WHO it reads from has to be rewritten every time somebody else moves.
//
// THE LAW, applied (see `substrate.ts`'s doc header for the argument):
//
//   - `chunkMeshes`, `propMeshes`, `ghostMeshes` and `voidCastMeshes` are `const`
//     containers in the host, mutated through the identity it hands over, so all
//     four ride BY VALUE inside the substrate. Those four ARE the draw list, and
//     sharing them by identity is what stops the modules that fill them and this
//     loop that drains them disagreeing about what is on screen. This module is
//     the reason three of them stayed in the closure when their own clusters
//     left; it is now the extracted module that reads them, which is what that
//     disposition was always waiting for.
//   - The other TWENTY-SIX are CALLS, and the split — counted off the assembly
//     literal in `field-host.ts`, not off this paragraph's memory of it — is
//     **26 / 0 / 0**: every one is a plain ref onto a sibling module's seam,
//     drawn from TEN files (`field-view.ts` 1, `field-materials.ts` 2,
//     `field-analyzer.ts` 2, `field-machine.ts` 4, `field-segment.ts` 3,
//     `field-targeting.ts` 3, `field-tool.ts` 2, `field-camera-rig.ts` 1,
//     `field-selection.ts` 5, `field-entities.ts` 3). 1 substrate + 26 + 2 values
//     = 29. A value copy of ANY of the 26 is the photograph `substrate.ts`
//     describes — and here it would be a photograph re-shown sixty times a
//     second, which is the one place a stale read is guaranteed to be seen.
//
//     The three-way split this bullet used to carry is worth keeping as a
//     TRAJECTORY, because it is the clearest measurement of what the tranche did:
//     15 refs / 8 thunks / 3 host arrows before T3d Task 4, then 18 / 7 / 1 after
//     it, now 26 / 0 / 0. The thunks were never a design choice — each was a host
//     `let` with no owner yet — and the count reaching zero is what "the closure
//     holds no state a frame reads" means as arithmetic.
//   - `selectionColor` and `anchorCrossHalfM` are neither: module-scope `const`s
//     in `field-host.ts`, travelling as plain VALUE deps on `field-segment.ts`'s
//     `anchorCrossHalfM` precedent — which is literally the same constant, handed
//     to a second module the same way. Since T3d Task 5 they have NO host reader
//     at all (both are `field-selection.ts`'s too), so the declaration is a
//     neutral shared point rather than a shared-with-the-host one; the block that
//     declares them in `field-host.ts` argues why they stay there, and choosing an
//     owner among peer modules is left to the prune tranche as a deletion-pass
//     question.
//
// NO SNAPSHOT AT THE TOP OF THE FRAME, and the temptation is real enough that the
// map priced it: `layers()` is read at FOURTEEN sites in `compose`, and two of them
// sit inside `for (const cm of chunkMeshes.values())`, so the true cost is
// **12 + 2 × chunkCount** calls per frame rather than fourteen. Hoisting one
// `const l = deps.layers()` at the top would collapse that to one — and would
// reintroduce, inside a single frame, exactly the fork `substrate.ts` exists to
// prevent. `field-view.ts`'s header declined the hoist when the reads first
// became calls at T3b1 and the reasoning is unchanged by the move: the per-chunk
// term is the price of the CALL, not of the extraction, and it was two property
// reads inside the same loop before either happened.
//
// SUBMISSION ORDER IS BEHAVIOUR, not tidiness, and it is the reason `compose`
// reads as one long function rather than as several. Within `frame.render`'s
// blended group submission order is preserved, so the void cast, the kit-fill
// hologram and the stamp ghosts composite against each other in the order they
// are pushed; the four selection overlays and the two segment previews draw after
// the grid because they are `occlude: false`. Every one of those orderings is
// argued at its own line below. Splitting `compose` into "opaques" and "overlays"
// helpers would read better and would make the two groups' interleaving a thing a
// reader has to reconstruct.
//
// WHICH IS ALSO WHY THE SPLIT THAT DID HAPPEN CUT WHERE IT DID. `compose`/`scene`
// separates the two lists from the two targets, and it leaves every ordering
// decision on one side of the line — the array index of a `LinePass` IS its draw
// order, and each submitter walks the array. A split into opaques/overlays would have
// cut across those arguments; this one cuts along them.
//
// NO UNIT TEST, by the house pattern eleven extractions old: the argument is
// `tests/field-host/field-machine.test.ts`'s header and is not re-made here. The
// host suites passing UNMODIFIED across this move ARE this module's contract.
//
// THE PARKED PRUNE CANDIDATE WAS COLLECTED BY THE SPLIT, which is worth recording
// because it was parked here with a reason and the reason expired rather than was
// overruled. It read: `scene` contains NINE near-identical
// `frame.drawLines(c, { vertices, colors, camera: view, occlude: false })`
// literals, ~54 lines that a helper collapses to ~9 — deferred because folding
// them in the same commit that MOVED the cluster would have made the
// rename-normalized diff that proved the extraction behaviour-neutral impossible
// to read. That diff is long since read. The nine literals are now nine
// `lines.push({ ...batch, occlude })` calls and ONE `frame.drawLines` in `scene`,
// and the collapse came free with a split that had to happen anyway. What is still
// parked for T5: the `Vec3T` / `LineBatch` alias consolidation across the
// directory, and `field-materials.ts`'s `kitMat` / `kitInstanced` pair.
//
// AND THE SUITE PINS THAT THIS FILE RUNS, NOT WHAT IT DRAWS. Measured at the
// extraction, against the whole editor suite (1469/0 at head), and it is the
// single most important thing to know before editing anything below:
//
//   - Making {@link Render.scene} return immediately, so the frame draws
//     NOTHING — no field, no props, no grid, no overlays: **1469/0, fully
//     green.** Not one test in the package notices an empty viewport.
//   - `scene` is nonetheless REACHED — instrumented at the same commit, 33 calls
//     across the suite — so this is not "the render loop never runs under test".
//     It runs, and nothing observes its output.
//   - Throwing mid-frame: **exactly one red, in one file.**
//     `tests/bundle.gpu.test.ts` — "THE PROJECT-FIRST GATE: the bundled consumer
//     graph boots a field host, digs, and draws".
//
// That one test is the whole net, and what it proves is liveness: the frame is
// built and submitted without throwing. Everything this file decides — layer
// gating, submission order within the blended group, which overlay draws over
// which — is verified by eye and by the Safari gate, exactly as it was before the
// extraction. The tests did not get weaker on the way out; they were never here.
// So a change to draw ORDER or a dropped layer gate will pass `bun test` and reach
// the user, and the only defence is reading the argument at each line and looking
// at the screen.
//
// ONE CRACK OF LIGHT SINCE T4C, and it is deliberately not oversold. The capture
// path reads {@link Render.compose}'s output back as PIXELS
// (`tests/field-capture.gpu.test.ts`), so for the first time something in this
// package asserts that a composed frame is lit, is not blank, and has its line
// overlays in it. That suite builds its OWN composition by hand rather than
// driving this module — so it pins the COMPOSITION TYPE's contract and the
// capture that consumes it, not this file's gates. The sentence above stands:
// nothing tests what `compose` decides.
import type * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Context } from "@furnace/core/gpu";
import * as mesh from "@furnace/core/mesh";
import { type Vec4, vec4 } from "@furnace/core/transform";
import { snappedKitBox } from "../shared/field-brush.ts";
import { boxEdges } from "./box-edges.ts";
import {
  boxCorners,
  crossSegments,
  GHOST_COLOR,
  sphereGhostSegments,
} from "./field-ghost.ts";
import type {
  FieldHostShading,
  FieldLayers,
  PendingStamp,
  ViewportGesture,
} from "./field-host.ts";
import type { StampSession } from "./field-stamp.ts";
import { buildGridLines, segmentsToBatch } from "./reference-grid.ts";
import type { HostSubstrate } from "./substrate.ts";
import { cursorAffordance } from "./viewport-cursor.ts";

// UNEXPORTED on purpose, though both appear in the exported signatures below.
// That is this directory's settled pattern rather than an oversight —
// `field-segment.ts`, `field-machine.ts`, `field-drift.ts` and
// `field-analyzer.ts` each declare the same aliases privately, because a name is
// not part of a structural type's identity and exporting a sixth spelling of
// `{ vertices, colors }` would add surface without adding a contract.
type Vec3T = [number, number, number];
type LineBatch = { vertices: Float32Array; colors: Float32Array };

const CLEAR = vec4.fromValues(0.03, 0.03, 0.045, 1);
// The studio key light: camera-following, warm, and the only light in the scene.
const STUDIO_KEY_COLOR: Vec3T = [1, 0.95, 0.85];
const STUDIO_KEY_INTENSITY = 6;
const STUDIO_KEY_RANGE = 18;
// Hemisphere fill, low enough that the key still shapes the surface. These are the
// dungeon-torch numbers this mode started as: D-F4.5-17 wants them TUNED for form +
// material legibility, and P5 (the slice's own readability check) is what decides
// whether that tuning is needed — untouched until it says so.
const STUDIO_AMBIENT: frame.Ambient = {
  sky: [0.4, 0.42, 0.48],
  ground: [0.16, 0.16, 0.2],
  intensity: 0.28,
};
// The debug mode draws through shader.normalColor, which ignores lights and ambient
// entirely. Full white is what keeps the kit's instanced-lit pieces (no unlit variant
// exists) readable beside it.
const NORMALS_AMBIENT: frame.Ambient = {
  sky: [1, 1, 1],
  ground: [1, 1, 1],
  intensity: 1,
};

const DEFAULT_GRID: Vec3T = [0.42, 0.42, 0.46];
const GRID_MINOR_DIM = 0.5; // minors dimmed vs majors (two-tone depth cue)

/** This frame's ghost preview state: the brush centre under the last cursor
 *  position plus the snapped lattice box when the active tool is a kit fill.
 *  Computed ONCE per frame and shared by the translucent cube (inside
 *  `frame.render`) and the edge/ring lines (drawn after it). */
type GhostState = {
  center: Vec3T;
  kitBox: ReturnType<typeof snappedKitBox> | null;
};

/** What the frame needs from the rest of the host — twenty-nine entries, the
 *  widest record in the directory after `field-machine.ts`'s thirty-nine, and
 *  every one of them a READ. See this module's header for why that is a
 *  measurement of what a frame is rather than a coupling smell, and for which
 *  eleven of them change spelling (but not shape) as later tranche tasks give
 *  their bindings owners.
 *
 *  **INVARIANT — EVERY MEMBER OF THIS RECORD IS READ-ONLY. Adding a member that
 *  WRITES breaks the module's central argument and must not be done silently.**
 *  Nothing in the type system enforces this: a `setFoo(x: T): void` added below
 *  compiles, and the header would go on claiming a width that is safe because
 *  it is all reads while the module had quietly become a writer. The argument
 *  that a 29-member record is a description of a frame rather than a coupling
 *  smell rests entirely on this one property, and so does `field-host-clusters.md`
 *  §5.6's zero-mutation row. If a frame ever genuinely needs to write, the
 *  honest move is to change both of those claims in the same commit — not to add
 *  the member and leave the prose standing. Grep this file for `INVARIANT` before
 *  extending the record. */
export type RenderDeps = {
  /** The host's shared state. FOUR members are read, and all four are the draw
   *  list itself: `chunkMeshes` (per-class buckets + the instanced kit),
   *  `propMeshes` (one instanced proxy draw per archetype), `ghostMeshes` (the
   *  stamp preview) and `voidCastMeshes` (the X-ray). */
  substrate: HostSubstrate;
  /** Per-layer render visibility (`field-view.ts`). THE densest read in the
   *  editor — fourteen sites here, two of them inside the per-chunk loop — and
   *  deliberately not hoisted; see this module's header. */
  layers(): Readonly<FieldLayers>;
  /** The shading mode (`field-materials.ts`). Decides the light list and the
   *  ambient term; the per-bucket material choice is the mesher's, not this
   *  loop's. */
  shading(): FieldHostShading;
  /** The ONE unit cube the kit-fill hologram is posed from, or `null` before
   *  GPU init (`field-materials.ts`). */
  ghostCube(): mesh.Mesh | null;
  /** The walkability markers' instanced mesh, or `null`
   *  (`field-analyzer.ts`). The seam hands over the MESH rather than the
   *  `{ im, g }` pair behind it — the geometry is that module's to free and this
   *  loop never wanted it. */
  flagMarkerMesh(): mesh.InstancedMesh | null;
  /** The SELECTED finding's cell outline (`field-analyzer.ts`). */
  flagSelectionBatch(): LineBatch | null;
  /** The armed viewport gesture, or `null` (`field-machine.ts`). Gates the brush
   *  ghost and decides which cursor affordance is drawn. */
  gesture(): ViewportGesture | null;
  /** The live stamp session, or `null` (`field-machine.ts`). The brush is
   *  suspended while one stands (D-F4.5-7), so the ghost is too. */
  session(): StampSession | null;
  /** The armed-but-unopened stamp, or `null` (`field-machine.ts`). */
  pendingStamp(): PendingStamp | null;
  /** The previewed PLACEMENTS' wireframe batch, or `null`
   *  (`field-machine.ts`) — the other half of a stamp ghost. */
  placementGhost(): LineBatch | null;
  /** The segment brush's pending anchor, or `null` (`field-segment.ts`). Read
   *  only as a liveness question, by the cursor affordance. */
  segmentAnchor(): Vec3T | null;
  /** The segment brush's anchor mark (`field-segment.ts`). */
  segmentAnchorBatch(): LineBatch | null;
  /** The segment brush's capsule preview (`field-segment.ts`). */
  segmentPreviewBatch(): LineBatch | null;
  /** The last noted cursor position, or `null` before the pointer has ever been
   *  over the canvas (`field-targeting.ts`). Bound to a local at each of its two
   *  call sites, because narrowing does not survive a call boundary. */
  pointer(): { x: number; y: number } | null;
  /** Cursor → the brush's world centre, or `null` when the ray hits nothing
   *  (`field-targeting.ts`). */
  computeTarget(clientX: number, clientY: number): Vec3T | null;
  /** Cursor → a world point for a two-click gesture's mark, or `null`
   *  (`field-targeting.ts`). Costs one raycast per frame, and only while a
   *  gesture is armed and unanchored. */
  selectionPoint(clientX: number, clientY: number): Vec3T | null;
  /** The brush radius. A call because the wheel, `[`/`]` and the panel slider
   *  all move it. `field-tool.ts`'s `digRadius` since 2026-08-08; it was a thunk
   *  over a host `let` before that, and this line is the whole difference. */
  digRadius(): number;
  /** Whether the armed tool fills kit rather than carving. Decides whether the
   *  ghost is a snapped box or a sphere. `field-tool.ts`'s `isKitFill` — the seam
   *  drops the noun the record already carries, and the dep keeps it. */
  isKitFillTool(): boolean;
  /** The camera's eye position, which the studio key light rides.
   *  `field-camera-rig.ts`'s `eye` since 2026-08-08, which makes
   *  `createCameraRig` a real (if slack) LOWER bound on `createRender` — the
   *  first of the two the assembly block said would settle it. */
  cameraEye(): Vec3T;
  /** The cell-selection display's instanced mesh, or `null`. `field-selection.ts`'
   *  {@link Selection.cellMesh}, handed over as the MESH on the `flagMarkerMesh`
   *  precedent above — which this dep's own migration note asked for and got: the
   *  host bridged the gap with `() => selectionCells?.im ?? null` for two tranches
   *  and that chain disappeared with the closure `let` rather than migrating. */
  selectionCellMesh(): mesh.InstancedMesh | null;
  /** The cell selection's AABB outline. `field-selection.ts`'. */
  selectionBatch(): LineBatch | null;
  /** The pending box-select anchor cross. `field-selection.ts`'. */
  anchorBatch(): LineBatch | null;
  /** The pending region preview. `field-selection.ts`'. */
  boxPreviewBatch(): LineBatch | null;
  /** The pending box corner, or `null`. Read only as a liveness question, by the
   *  cursor affordance. `field-selection.ts`'. */
  boxAnchor(): Vec3T | null;
  /** The selected entity's footprint box. `field-entities.ts`'. */
  entitySelectionBatch(): LineBatch | null;
  /** The translate gizmo's arms. `field-entities.ts`'. */
  gizmoBatch(): LineBatch | null;
  /** Whether the gizmo is drawn at all — a separate question from whether it
   *  exists. What is drawn has to be what `gizmoAxisAt` hit-tests, which is why
   *  `field-entities.ts` publishes one predicate for both.
   *
   *  It was the LAST of the 29 to name a host `const` arrow, and it is the second
   *  of the two deps that give `createRender` a lower bound — `cameraEye` became
   *  the first at T3d Task 4, this one at Task 5, so the "nothing pins this line
   *  from below" note in the assembly block is now fully settled. */
  gizmoVisible(): boolean;
  /** The editor's selection accent, used for the box-anchor cross. A plain VALUE
   *  because it is a module-scope `const` with readers in `selection` too; see
   *  this module's header. */
  selectionColor: [number, number, number, number];
  /** Half-span of the box-anchor cross, in metres. Same disposition as
   *  `selectionColor`, and the same constant `field-segment.ts` already takes. */
  anchorCrossHalfM: number;
};

/** One `frame.drawLines` call's worth of overlay, as DATA: a batch plus the depth
 *  mode it draws in. The array index inside a {@link FrameComposition} is the draw
 *  order — see this module's header on why that is behaviour rather than tidiness. */
export type LinePass = LineBatch & {
  /** `true` = depth-tested (the grid); `false` = always-on-top (every other
   *  overlay). Passed straight through to `frame.drawLines`' own `occlude`, whose
   *  default is `true` — spelled explicitly on every pass here because half of them
   *  want the non-default. */
  occlude: boolean;
};

/** One frame's draw lists, aimed at NO TARGET — which is the whole point of the
 *  type. {@link Render.scene} submits it at the swap chain; `field-capture.ts`
 *  submits the same record at an off-screen texture through
 *  `frame.renderToTexture` + `frame.drawLinesToTexture`, so the agent's photograph
 *  and the human's viewport are the same composition rather than two that have to
 *  be kept in step.
 *
 *  THE CAMERA IS ABSENT, and that is what makes the borrowing honest rather than
 *  approximate: nothing in the build reads the camera it will be drawn from (the
 *  one thing that looks like it does — the brush ghost's world centre — raycasts
 *  through the LIVE camera by way of `field-targeting.ts`, at compose time, for
 *  both callers). So a composition is a description of what is in the scene, and
 *  the caller supplies where it is looked at from.
 *
 *  BORROWED, NOT OWNED. Every array and every mesh handle in here belongs to the
 *  host — `meshes`/`instanced` hold live GPU resources, `lines` holds batches that
 *  other clusters prebuilt and may rebuild on the next selection change, and
 *  `clearColor` is a module `const`. It is valid for the synchronous stretch that
 *  follows the `compose` that produced it and no longer; nothing may retain one. */
export type FrameComposition = {
  /** Individually-transformed draws: the field's per-class surfaces, the void
   *  cast, the kit-fill hologram cube and the stamp ghosts, in submission order. */
  meshes: mesh.Mesh[];
  /** One instanced draw per group: the chunk kit, each prop archetype, the
   *  walkability markers, the cell-selection display. Recorded after `meshes`. */
  instanced: mesh.InstancedMesh[];
  /** Every line overlay this frame draws, IN ORDER, after the mesh pass. */
  lines: LinePass[];
  /** The scene's lights — one camera-following key in `studio`, none in `normals`. */
  lights: frame.Light[];
  /** The hemisphere fill that goes with `lights`. */
  ambient: frame.Ambient;
  /** The background the pass clears to. */
  clearColor: Vec4;
};

/** The frame's two verbs — build, and submit what was built.
 *
 *  The four functions behind them — the light list, this frame's ghost state, the
 *  ghost's lines and the cursor affordance — are module-private because each has
 *  exactly one caller: {@link Render.compose}. See this module's header. */
export type Render = {
  /** Build and submit one frame's draw lists at the swap chain. Called once per
   *  `tick`, under a proven context and camera.
   *
   *  Its whole body is `compose(c)` and then the submit — no third thing — and holding
   *  it to that is what keeps the capture honest: the moment the live path grows a step
   *  the composition does not carry, the agent's photograph stops being the human's
   *  viewport. */
  scene(c: Context, view: camera.Camera): void;
  /** Build this frame's draw lists without submitting anything.
   *
   *  MUTATES ONE THING — it poses the host's ghost cube on the GPU when a kit-fill
   *  preview is live. That is the single mutation the cluster has ever performed and
   *  it stays here on purpose; the three reasons are argued in this module's header,
   *  and the short one is that the pose is camera-independent, so composing for a
   *  capture computes the same box the frame does and writing it again is idempotent.
   *
   *  The returned record is BORROWED — see {@link FrameComposition}. */
  compose(c: Context): FrameComposition;
};

/** Build the frame over one host's dependencies. One per host; it holds that
 *  host's reference-grid batches (world-static, built once here) and two scratch
 *  vectors for the ghost cube's pose. */
export function createRender(deps: RenderDeps): Render {
  // Reference grid — world-static, so both batches are built once and reused.
  const gridSegments = buildGridLines();
  const gridMinor = segmentsToBatch(gridSegments.minorSegments, [
    DEFAULT_GRID[0] * GRID_MINOR_DIM,
    DEFAULT_GRID[1] * GRID_MINOR_DIM,
    DEFAULT_GRID[2] * GRID_MINOR_DIM,
    1,
  ]);
  const gridMajor = segmentsToBatch(gridSegments.majorSegments, [
    DEFAULT_GRID[0],
    DEFAULT_GRID[1],
    DEFAULT_GRID[2],
    1,
  ]);

  // Scratch vectors for the ghost cube's per-frame pose (setPosition/setScale
  // copy, so reuse is safe — no per-frame allocation).
  const ghostPos = new Float32Array(3);
  const ghostScale = new Float32Array(3);

  // The studio key light rides the eye, so a surface the user turns toward is a
  // surface that lights up. `normals` needs no lights at all (normalColor ignores
  // them), and an empty list is what says that to frame.render.
  const sceneLights = (): frame.Light[] =>
    deps.shading() === "studio"
      ? [
          {
            type: "point",
            position: deps.cameraEye(),
            color: STUDIO_KEY_COLOR,
            intensity: STUDIO_KEY_INTENSITY,
            range: STUDIO_KEY_RANGE,
          },
        ]
      : [];

  const ghostState = (): GhostState | null => {
    // Bound to a local, like every other read of a thunk over a `let`: the guard
    // and the two coordinate reads are one synchronous expression over one
    // binding, and narrowing does not survive a call boundary.
    const last = deps.pointer();
    if (last === null) return null;
    const center = deps.computeTarget(last.x, last.y);
    if (!center) return null;
    const kitBox = deps.isKitFillTool()
      ? snappedKitBox(center, deps.digRadius())
      : null;
    return { center, kitBox };
  };

  // The ghost preview lines, drawn occlude:false so they read through solid
  // rock: a kit fill previews its snapped box's 12 edges; every sphere tool
  // previews the two brush rings. Corner/ring math lives in field-ghost.ts.
  const ghostLineBatch = (g: GhostState): LineBatch =>
    g.kitBox
      ? boxEdges(boxCorners(g.kitBox.center, g.kitBox.halfExtents), GHOST_COLOR)
      : segmentsToBatch(
          sphereGhostSegments(g.center, deps.digRadius()),
          GHOST_COLOR,
        );

  // The cursor mark a two-click gesture shows before its first click. Built per
  // FRAME rather than stored per pointer-move, because it has to track the
  // camera as well as the cursor — a right-drag with the pointer still moves the
  // world point under it. That costs one `selectionPoint` raycast per frame, the
  // same cost the brush ghost has always paid on the frames it draws, and only
  // while a two-click gesture is armed and unanchored.
  //
  // Colour follows the shape, because each mark previews a specific thing: the
  // amber cross is the box/region ANCHOR the click will leave (`setBoxAnchor`),
  // and the hologram ring is the segment's own radius (`setSegmentAnchor` is
  // hologram too). Neither changes colour when the click lands.
  const cursorAffordanceBatch = (): LineBatch | null => {
    const shape = cursorAffordance({
      gesture: deps.gesture(),
      pendingStamp: deps.pendingStamp() !== null,
      anchored: deps.boxAnchor() !== null || deps.segmentAnchor() !== null,
    });
    // Split rather than folded into one `||`, to keep the short-circuit the
    // closure's `if (shape === null || !lastPointer)` had: with no gesture armed
    // — the common frame — the cursor is not asked for at all.
    if (shape === null) return null;
    const last = deps.pointer();
    if (last === null) return null;
    const p = deps.selectionPoint(last.x, last.y);
    if (!p) return null;
    return shape === "ring"
      ? segmentsToBatch(sphereGhostSegments(p, deps.digRadius()), GHOST_COLOR)
      : segmentsToBatch(
          crossSegments(p, deps.anchorCrossHalfM),
          deps.selectionColor,
        );
  };

  const compose = (c: Context): FrameComposition => {
    // Layer gating happens HERE, at draw-list build time: the host has no
    // per-mesh visibility flag — it reconstructs the frame.render lists (and
    // issues the drawLines calls) every frame, so a hidden layer is simply
    // never pushed/drawn. GPU chunk state stays resident either way.
    const meshes: mesh.Mesh[] = [];
    const instanced: mesh.InstancedMesh[] = [];
    for (const cm of deps.substrate.chunkMeshes.values()) {
      if (deps.layers().field) for (const e of cm.entries) meshes.push(e.m);
      if (deps.layers().kit && cm.kit) instanced.push(cm.kit);
    }
    // Committed placed props: proxy primitives on the shared instanced-lit
    // material, their own layer gate (they are entities, not field — the "if you
    // can dig it, it's field" jurisdiction line drawn in the layer strip).
    if (deps.layers().props)
      for (const p of deps.substrate.propMeshes) instanced.push(p.im);
    // The walkability advisor's markers: ONE opaque unlit instanced draw covering
    // every visible finding. Their own gate — the findings keep arriving while it
    // is off (the analyzer is not a display layer), this only stops drawing them.
    // Bound to a local because narrowing does not survive a call boundary: the
    // gate and the push are two reads of `field-analyzer.ts`'s layer slot.
    const flagMarkerMesh = deps.flagMarkerMesh();
    if (deps.layers().flags && flagMarkerMesh) instanced.push(flagMarkerMesh);
    // The cell-level selection display, under the `selection` layer with the
    // outlines below (hiding the layer hides the DISPLAY; the selection itself
    // stays live and keeps masking ops). Premultiplied and depth-write-free, so
    // it sorts into frame.render's blended group with the ghosts.
    //
    // DISCLOSED AS UNPINNED (see `rebuildFlagSelection` in `field-analyzer.ts`
    // for its two siblings): THIS GATE is unobservable. The only window onto the
    // layer is `selectionCellCount()`, which reports what the rebuild DECIDED and
    // not what the frame drew — by design, since it is the marker-count twin and
    // settles before the context guard. So switching `selection` off while a
    // flood is selected is an eyeball check, not a test. A `drawnSelectionCells()`
    // accessor would be a second count whose only consumer is one assertion, and
    // two counts that can disagree is worse than one that is honest about its
    // scope.
    const selectionCellMesh = deps.selectionCellMesh();
    if (deps.layers().selection && selectionCellMesh)
      instanced.push(selectionCellMesh);
    // The void cast goes in FIRST of the three translucents on purpose. All
    // three sort after every opaque (frame.render's blended group), so this
    // position decides nothing against the field — but within the blended group
    // submission order is preserved, and that is what decides how the three
    // compose against EACH OTHER. The cast ignores depth outright
    // (compare: "always"), so submitted last it would wash cyan over every ghost
    // in the frame; submitted first, the two ghosts keep their hologram-blue and
    // read on top of it. Right priority: a ghost is the action the user is
    // steering right now, the cast is the room around it.
    if (deps.layers().voidCast)
      for (const entries of deps.substrate.voidCastMeshes.values())
        for (const e of entries) meshes.push(e.m);
    // Filled kit ghost (the fill-tool-solid-volume-surprise fix): pose the ONE
    // translucent unit cube at the snapped box and push it into the mesh list.
    // When there is no kit-fill ghost this frame the mesh is simply not drawn.
    // Its position in this list no longer decides compositing against OPAQUES:
    // frame.render records every blended draw after every opaque one, so the
    // hologram (no depth write) survives the field AND the instanced kit
    // pieces. Order still matters WITHIN the blended group — submission order
    // is preserved there — so this cube's position relative to the stamp
    // ghosts below (also premultiplied, also no depth write) is what decides
    // how those two translucents composite against each other.
    // THREE independent ghost gates: the LAYER flag is user intent; the gesture
    // suppression and the session suppression are both mode coherence — nothing
    // on screen may promise a stroke the next click will not make.
    //  - while ANY gesture is armed LMB doesn't stroke, so a sphere/box brush
    //    preview would promise an action that won't happen. `segment` is
    //    included: its click anchors or sweeps a capsule, never stamps the
    //    sphere this ghost draws (its own affordances are the cursor ring below
    //    and, once anchored, the capsule preview). `pointer` being the DEFAULT
    //    gesture is why a freshly opened world shows no brush ghost at all until
    //    a brush is armed.
    //  - while a SESSION stands the brush is suspended (D-F4.5-7 — see
    //    the machine's pointerDown), so the same promise would be false with no
    //    gesture armed at all.
    const ghost =
      deps.layers().ghost && deps.gesture() === null && deps.session() === null
        ? ghostState()
        : null;
    // Asked immediately before its guard, not once at the top of the frame: the
    // handle is nulled at `dispose`, and this is the `flagMarkerMesh` shape three
    // pushes above rather than the hoisted snapshot this module's header refuses.
    const ghostCube = deps.ghostCube();
    if (ghost?.kitBox && ghostCube) {
      ghostPos.set(ghost.kitBox.center);
      ghostScale[0] = ghost.kitBox.halfExtents[0] * 2;
      ghostScale[1] = ghost.kitBox.halfExtents[1] * 2;
      ghostScale[2] = ghost.kitBox.halfExtents[2] * 2;
      mesh.setPosition(c, ghostCube, ghostPos);
      mesh.setScale(c, ghostCube, ghostScale);
      meshes.push(ghostCube);
    }
    // Stamp ghosts share the ghost LAYER gate only (no selection-mode
    // suppression — the session, not LMB, owns their promise) and draw after
    // the opaque field like the kit-fill cube (premultiplied, no depth write).
    if (deps.layers().ghost)
      for (const entries of deps.substrate.ghostMeshes.values())
        for (const e of entries) meshes.push(e.m);
    // EVERY LINE OVERLAY BELOW IS PUSHED, NOT DRAWN, and the array's order is the
    // draw order — {@link Render.scene} walks it with one `frame.drawLines` call,
    // and `field-capture.ts` walks the same array with `drawLinesToTexture`. The gates,
    // the locals bound before them and the arguments written above each are
    // unchanged from when this block issued the calls itself; what moved is only
    // where the pass is aimed, which is now the caller's decision.
    const lines: LinePass[] = [];
    // Depth-tested grid (occlude:true): solid geometry hides it. Minors, then majors.
    if (deps.layers().grid) {
      lines.push({ ...gridMinor, occlude: true });
      lines.push({ ...gridMajor, occlude: true });
    }
    // Selection overlay: the amber cell-selection AABB + pending box-select
    // anchor cross + the pending-region preview, and the SELECTED ENTITY's
    // footprint box in the chrome's primary blue — all occlude:false so a
    // selection reads through rock. Batches are prebuilt on selection change
    // (the box preview on pointer move) — nothing is materialized per frame.
    // Hiding the layer hides the DISPLAY only: both selections stay live (the
    // cell one keeps masking ops, the entity one keeps feeding its seam).
    if (deps.layers().selection) {
      const selectionBatch = deps.selectionBatch();
      if (selectionBatch) lines.push({ ...selectionBatch, occlude: false });
      const anchorBatch = deps.anchorBatch();
      if (anchorBatch) lines.push({ ...anchorBatch, occlude: false });
      const boxPreviewBatch = deps.boxPreviewBatch();
      if (boxPreviewBatch) lines.push({ ...boxPreviewBatch, occlude: false });
      const entitySelectionBatch = deps.entitySelectionBatch();
      if (entitySelectionBatch)
        lines.push({ ...entitySelectionBatch, occlude: false });
      // The translate gizmo, LAST of the selection overlays and occlude:false
      // like them: a handle behind the box it moves must still be grabbable, and
      // what the user sees has to be what `gizmoAxisAt` hit-tests.
      const gizmoBatch = deps.gizmoBatch();
      if (gizmoBatch && deps.gizmoVisible())
        lines.push({ ...gizmoBatch, occlude: false });
    }
    // The selected FINDING's cell outline, in the same primary blue as the entity
    // box above (D-F4.5-15's "reuse --primary, no new hue") — but under the FLAGS
    // gate, not the selection one, because it is an emphasis on a marker rather
    // than a selection overlay of its own. With `flags` off there are no markers,
    // so an outline here would box empty air; the pick is gated the same way, so
    // a flag selection cannot even be made while the layer is hidden.
    // occlude:false like every other selection overlay: a finding inside rock is
    // exactly the kind the advisor is for. A local for the same reason the marker
    // layer above takes one — three reads of one slot behind a call.
    const flagSelectionBatch = deps.flagSelectionBatch();
    if (deps.layers().flags && flagSelectionBatch)
      lines.push({ ...flagSelectionBatch, occlude: false });
    // The stamp's PLACEMENT proxies — one merged batch of oriented wireframe
    // boxes, occlude:false like every other ghost overlay so props previewed
    // inside a cave read through its walls. Under the ghost layer gate with the
    // hologram meshes: they are two halves of one preview.
    const placements = deps.placementGhost();
    if (deps.layers().ghost && placements)
      lines.push({ ...placements, occlude: false });
    // The segment brush's pending anchor + capsule preview. Under the GHOST
    // layer, not `selection`: they preview a brush op the next click commits.
    if (deps.layers().ghost) {
      const anchorLines = deps.segmentAnchorBatch();
      if (anchorLines) lines.push({ ...anchorLines, occlude: false });
      const previewLines = deps.segmentPreviewBatch();
      if (previewLines) lines.push({ ...previewLines, occlude: false });
    }
    // Ghost target preview last so it draws over the scene + grid (occlude:false).
    if (ghost) lines.push({ ...ghostLineBatch(ghost), occlude: false });
    // The armed-but-unanchored cursor affordance (f2b item 10 / D-F4.5-7): what
    // a two-click gesture shows BEFORE its first click, so arming one is not a
    // mode with no affordance at all. Which mark to draw is `cursorAffordance`'s
    // decision, pinned in the pure module; here is only the pushing.
    //
    // The layer gate stays OUTSIDE the call exactly as it was: `cursorAffordance`
    // and the `selectionPoint` raycast behind it cost a frame's work, and with the
    // ghost layer hidden neither is asked for.
    if (deps.layers().ghost) {
      const cursorBatch = cursorAffordanceBatch();
      if (cursorBatch) lines.push({ ...cursorBatch, occlude: false });
    }
    // Kit instances always render with the lit-instanced material, even in the
    // `normals` debug mode — there is no normal-coloured instanced variant, and
    // NORMALS_AMBIENT (full white) is what keeps them readable there. A deliberate
    // v0 choice.
    return {
      meshes,
      instanced,
      lines,
      lights: sceneLights(),
      ambient: deps.shading() === "studio" ? STUDIO_AMBIENT : NORMALS_AMBIENT,
      clearColor: CLEAR,
    };
  };

  const scene = (c: Context, view: camera.Camera): void => {
    const composition = compose(c);
    // `effects: []` is the editor's whole post chain, and it is what keeps the
    // capture's off-screen pass a faithful copy: `frame.renderToTexture` runs no
    // chain at all, so a viewport that grew one would silently stop matching its
    // own photograph. (It is also what makes `drawLines` safe here at any sample
    // count — see that function's MSAA + post-chain skip.)
    frame.render(c, {
      meshes: composition.meshes,
      instanced: composition.instanced,
      camera: view,
      clearColor: composition.clearColor,
      lights: composition.lights,
      ambient: composition.ambient,
      effects: [],
    });
    for (const pass of composition.lines) {
      frame.drawLines(c, {
        vertices: pass.vertices,
        colors: pass.colors,
        camera: view,
        occlude: pass.occlude,
      });
    }
  };

  return { scene, compose };
}
