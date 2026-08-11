// The session + gesture machine: the stamp session, the reconfigure session, the
// move that rides one, the armed-gesture slot and the pending-stamp arm — the
// whole interactive middle of the field host, lifted out of `createFieldHost` as
// ONE module that owns its state privately.
//
// It is ONE module and not four because the four are one state machine. The
// closure map (`docs/reference/field-host-clusters.md` §7.2, §7.5) measured that
// directly and said so: `stamp` and `move` "share one slot — the move session IS
// a stamp session with `moving: true`", so any boundary drawn between them cuts a
// state machine in half; `gesture` and the arm above it are the other half of the
// same click, since a pending arm SHADOWS the armed gesture rather than replacing
// it and the two have to be read together to know what LMB does. §7.5 ranked this
// cluster the WORST available extraction (13 partner clusters, 45 cross-cluster
// edges) and named the two facts that would bite: it cannot go without `move`,
// and `cancelStampSession` is reached from 14 regions across 7 clusters. Both
// held. What changed since that measurement is what makes the move affordable
// now rather than then, and it is exactly what §7.3 predicted: `HostSubstrate`
// exists (T3a/T3b1), so the shared reads are one record instead of sixteen
// arguments, and the Esc stack is a capture STACK rather than a ladder, so a
// cluster can own its own cancellable state without the host holding a list.
//
// STATEFUL, like `field-segment.ts` and unlike the pure siblings
// (`field-stamp.ts`, `field-move.ts`, `field-ghost.ts`): those are transitions
// and arithmetic over data handed in, and they were extractable because they
// remember nothing. THIS is the memory — which session is live, which generation
// of it, which params the user has spoken about, what the cursor is dragging, and
// what the next click will do. A factory returning an object, on
// `createSegmentBrush`'s precedent, because a set of free functions would have to
// be handed that memory on every call.
//
// IT ALSO ARBITRATES THE POINTER (T3c). The four pointer listeners' CHAINS live
// here — see the pointer chain at the bottom of this file — because every test
// in them reads state this module owns and nothing else does. The listeners
// themselves, the keyboard three and the wheel stay on the host: `attachListeners`
// is the canvas element's, the momentary pins are closure-private keydown state,
// and the wheel is half camera. What that split buys is stated where the chain
// is; the one-line summary is that the machine arbitrates and the tools act.
//
// EVERY CROSS-CLUSTER DEPENDENCY ARRIVES IN {@link MachineDeps}, and the
// reassignable ones arrive as FUNCTIONS rather than as values — the discipline
// `field-segment.ts`'s header states and `substrate.ts` generalises. Two members
// here are `let`s in the host (`archetypes`, and the selection behind
// `selectionRegion`), and either one snapshotted at construction would give this
// module a private copy the host's own writes never reach: a stamp opened after
// `setEntityCatalog` would seed from the catalog the project no longer has, and
// `startStamp` would arm region-draw over a selection the user made an hour ago.
//
// WHAT IT DELIBERATELY DOES NOT OWN, both decided by re-reading the as-built
// rather than by the shape of the names:
//   - `boxAnchor` and its two overlay batches. The plan sketched the anchor as
//     gesture state, and by name it is; by EDGES it is the selection cluster's,
//     owned jointly with `anchorBatch`, `boxPreviewBatch`, `updateBoxPreview`,
//     `boxCorner` and `selectionClick`. Taking it would have dragged the whole
//     box-select overlay across the line for the sake of two calls, so the two
//     calls arrive as deps instead ({@link MachineDeps.setBoxAnchor},
//     {@link MachineDeps.boxCorner}) — the `armMaskDropReport` precedent. **That
//     judgement was checked by events**: all six of those names left together for
//     `field-selection.ts` at T3d Task 5, which is what "owned jointly" predicted,
//     and the four deps here were re-pointed at that module without a signature
//     changing.
//   - `commitToolOp`. It is a BRUSH verb wearing a commit's name: it applies one
//     op through `field.logApply` with the active tool's mask and pushes the
//     history feed, and it is already a `field-segment.ts` dep. (It is
//     `field-tool.ts`'s `commitOp` since 2026-08-08, which is the same answer
//     from the other side: it went with the brush, not with the session.) The two verbs
//     that DID move are the session's terminal pair (`commitStampSession`,
//     `applyReconfigureSession`), and they moved because leaving them behind
//     would have meant exporting `setStamp`, `destroyGhosts`, `notifyStamp`,
//     `endMove` and `reportEmptyPreview` from this module purely to serve two
//     callers — five private-state verbs promoted to public surface, which is the
//     opposite of what a module owning its state privately means.
//
// THE 2-D MODEL THIS STATE NAMES (and the one the facade type still does not).
// What LMB does is really TWO independent facts: an EFFECT (dig / fill / smooth /
// paint — the tool's, and the tool cluster's to hold) and a GESTURE (stroke /
// two-click box / two-click segment / pointer — this module's `gesture` slot).
// The composition is the product of the two, and today's `ViewportGesture` is a
// 1-D projection of it: `segment` is a brush EFFECT wearing a gesture's costume,
// which is why arming it has to reach into the tool and why the suspension check
// below needs a branch of its own. Naming the model in the STATE is what this
// extraction can honestly do; `ViewportGesture` stays the 1-D CONTRACT because
// changing it is a presentation decision with chrome consequences, and that half
// stays filed (`docs/backlog/editor-and-tooling/field-tool-follow-ons.md`, §"Segment
// reads as a fifth brush, but it is a modifier on the other four").
import * as field from "@furnace/core/field";
import * as geometry from "@furnace/core/geometry";
import type * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import type { EntityArchetype } from "../shared/catalog.ts";
import { nudgeRegion, snapSpan, spanCells } from "../shared/field-brush.ts";
import { openBlockedReason } from "../shared/field-entity.ts";
import { GHOST_COLOR } from "./field-ghost.ts";
// TYPE-ONLY, so it is erased and there is no import cycle at runtime — the same
// arrangement `field-segment.ts` uses for `SegmentHud`. Both payload types stay
// with the rest of the host's public surface because their TSDoc links into
// `FieldHost`, and a type that named its consumer from across the directory would
// be a link this side could not resolve.
import type {
  PendingStamp,
  SelectionMode,
  ViewportGesture,
} from "./field-host.ts";
import {
  advanceMove,
  type MoveDrag,
  movePoint,
  reanchored,
  resolveMapping,
  sameRegion,
  startMove,
  unanchored,
} from "./field-move.ts";
import {
  ARCHETYPE_PARAM,
  placementGhostBatch,
  placesProps,
  seedArchetypeParams,
  touchedParamKeys,
} from "./field-placements.ts";
import type { WireBucket } from "./field-protocol.ts";
import { deriveSizeDefaults } from "./field-size.ts";
import {
  createPreviewCoalescer,
  previewIsEmpty,
  type StampSession,
  startReconfigureSession,
  startSession,
  toPreviewing,
  withoutMoving,
  withParams,
  withPreviewError,
  withPreviewResult,
  withRegion,
} from "./field-stamp.ts";
import type { Axis } from "./gizmo.ts";
import { createRung, type InputRouter } from "./input-router.ts";
import type { HostSubstrate } from "./substrate.ts";
import { createViewChannel } from "./view-channel.ts";

type Vec3T = [number, number, number];

/** A prebuilt drawLines batch (vertices + per-vertex colors). */
type LineBatch = { vertices: Float32Array; colors: Float32Array };

/** A metre-space AABB. */
type Aabb = { min: Vec3T; max: Vec3T };

/** A press on the ALREADY-SELECTED entity, waiting to see whether the cursor
 *  travels far enough to mean "move" ({@link DRAG_THRESHOLD_PX}) — the press
 *  itself changes nothing, so a plain click on what is already selected stays the
 *  no-op it has always been. The intention and the threshold that spends it are
 *  both this module's since T3c; the `pointerId` is carried because the crossing
 *  takes pointer capture on the press's pointer, not on the move's. */
export type PendingMovePress = {
  entityId: number;
  x: number;
  y: number;
  pointerId: number;
};

// Cursor travel (px) before a press on the SELECTED entity stops being a click
// and becomes a move. Below it a hand tremor between mousedown and mouseup must
// not open a session, let alone splice the log.
//
// MODULE SCOPE here rather than a dep, unlike `strokeMinMs` beside it, and the
// difference is who else reads it: the stroke throttle is shared with the
// segment brush (one button, one feel) and is exported from `field-host.ts` for
// a suite that advances a clock by it, so it has to travel from there. This one
// has exactly one reader — the crossing in `pointerMove` — and it came here with
// it.
const DRAG_THRESHOLD_PX = 4;

// The schema key the quarter-turn cycles. Core spells it the same way (its own
// `ROTATION_KEY`), and both hall and maze carry it; cave and scatter do not.
const ROTATION_PARAM = "rotation";

/** A fresh small random seed for a stamp session, a re-roll or a duplicate
 *  (uint16 keeps it readable in the panel's seed field).
 *
 *  MODULE SCOPE, not a {@link FieldMachine} member, and the distinction is the
 *  module's whole organising rule: this machine's surface is the session state
 *  and the verbs over it, and a wrapper round `crypto.getRandomValues` is neither
 *  — it reads nothing and remembers nothing. It lives here because two of its
 *  three callers are the session opens just below; the third is the host's
 *  `duplicateEntity`, which rolls a fresh arrangement for a copied generator that
 *  reads its seed. */
export function randomStampSeed(): number {
  const u = new Uint16Array(1);
  crypto.getRandomValues(u);
  return u[0] ?? 0;
}

/** The generator's JSON-Schema `properties` map, narrowed off the loosely-typed
 *  `paramSchema` — the clamp-bound source {@link deriveSizeDefaults} reads. A
 *  schema without a properties object yields `{}`, not a throw: a size-less
 *  generator derives nothing, so the empty map flows to deriveSizeDefaults'
 *  no-op branch untouched (setup-loud stays with `boundOf`, which fires only for
 *  a generator that DOES derive but is missing a specific numeric bound). */
function generatorSchemaProperties(
  def: field.GeneratorDef,
): Record<string, unknown> {
  const props = def.paramSchema["properties"];
  if (typeof props !== "object" || props === null) return {};
  // Boundary cast: GeneratorDef.paramSchema is typed Record<string, unknown>;
  // the runtime check above proves `properties` is a non-null object, which is
  // always index-readable as Record<string, unknown> (values stay unknown).
  return props as Record<string, unknown>;
}

/** What the session + gesture machine needs from the rest of the host.
 *
 *  The split between the record, the thunks and the plain function refs is not
 *  stylistic — it is `substrate.ts`'s rule read at one more boundary. The
 *  substrate carries everything the host can REPLACE behind a call already, so it
 *  arrives whole. The two members BESIDE it that are also `let`s in the host
 *  (`archetypes`, and the selection `selectionRegion` reads) are thunks for the
 *  same reason and no other. Everything else is a `const` arrow in the host — a
 *  binding that cannot move is the one kind of dependency a value copy cannot
 *  fork — so those travel as plain refs. */
export type MachineDeps = {
  /** The shared substrate: the store, the log, the worker, the material table,
   *  the entity catalog index, the GPU context, the disposed latch, and the
   *  `ghostMeshes` map this module fills and `field-render.ts`'s `compose`
   *  draws from. That map stays a substrate VALUE member rather than moving
   *  here, on the
   *  `voidCastMeshes` precedent: the meshes this module builds and the loop that
   *  draws them are one Map shared by identity, not two copies that could
   *  disagree about what is on screen. */
  substrate: HostSubstrate;
  /** The host's Esc capture stack. THE OBJECT, not a pair of capture/release
   *  callbacks, and that is `field-segment.ts`'s rule read at a bigger cluster:
   *  this module owns three pieces of cancellable state, so it owns the
   *  acquire/release discipline over each of them too.
   *
   *  The MECHANISM is not this module's — {@link createRung} lives beside the
   *  stack in `input-router.ts`, shared with the host's three rungs and the
   *  segment brush's one. Owning the rung means deciding the label, what counts
   *  as live and what a cancel does; it does not mean keeping a private copy of a
   *  handle slot that seven rungs have to agree about. */
  router: InputRouter;
  /** The project's entity catalog in AUTHORED ORDER (empty until
   *  `setEntityCatalog`). A call, not an array, because the host REBUILDS it on
   *  every catalog install — a snapshot would seed archetype hints from a catalog
   *  the project no longer has. Order matters: the archetype seeding falls back to
   *  "the catalog's first", which a Map's iteration order gives but reads worse. */
  archetypes(): readonly EntityArchetype[];
  /** The CURRENT selection as a stamp region: its metre AABB plus whether the
   *  flood that produced it hit the UI budget (an under-covering region the
   *  session must record). Null when there is no selection at all, and equally
   *  when there is one with no bounds — `startStamp` treats the two identically
   *  (it arms region-draw), so one null says what two branches used to.
   *
   *  ONE dep rather than a `selection()` thunk plus `selectionAabb`, and the
   *  reason is a type: `SelectionState` is private to `field-selection.ts` (it was
   *  private to `field-host.ts` when this was written, and travelled), and a
   *  cluster boundary is not worth publishing a host-private shape for. This
   *  narrows to exactly the two facts the session needs — and since T3d Task 5 the
   *  host side of it is a plain ref onto that module's `region`, because the
   *  composition this dep names now lives where the state does. */
  selectionRegion(): { aabb: Aabb; truncated: boolean } | null;
  /** Report a refusal to the user (console + the panel subscriber). Nine callers
   *  here — every session verb that can be asked for something impossible. */
  reportToolError(msg: string): void;
  /** Mark chunks (and their 26-neighbours) for remesh. Both terminal verbs hand
   *  core's dirty set straight to it. */
  markDirtyWithNeighbors(changed: Set<string>): void;
  /** The stamp-preview snapshot: density COPIES + cloned materials of every
   *  allocated chunk in the region's chunk box grown by one. Stays in the host
   *  because it is the analyzer mirror's sibling and shares `chunkCopy` with it. */
  snapshotChunks(region: Aabb): {
    key: string;
    density: ArrayBuffer;
    materials: field.ChunkMaterials | null;
  }[];
  /** A chunk's world origin, for posing the ghost meshes built at chunk-local
   *  coordinates. */
  chunkOrigin(cx: number, cy: number, cz: number): Float32Array;
  /** The ONE translucent material every ghost bucket draws with
   *  (`field-materials.ts`). Setup-loud: it throws before GPU init, which is why
   *  the ghost build guards on the context first. */
  stampGhostMaterial(): material.Material;
  /** Cursor → world ray, for the move's screen→world mapping. Null when there is
   *  no camera or the view is singular. Narrower here than the host's own return
   *  (which also carries the eye-in-rock probe): a move maps a ray, it does not
   *  raycast the field. */
  cursorRay(
    clientX: number,
    clientY: number,
  ): { origin: Vec3T; dir: Vec3T } | null;
  /** One click of the two-click BOX corner machinery, SHARED with the cell-select
   *  box gesture — which is why it stays in the host with the rest of the box
   *  overlay. The first click anchors and answers null; the second closes and
   *  answers the snapped region the pair spans. Sharing it is what stops the
   *  stamp's corners snapping differently from the selection's. */
  boxCorner(clientX: number, clientY: number): field.SelectionSpec | null;
  /** Arm or drop the box-select anchor (and, with it, its cross and the pending
   *  region preview). A boundary WRITE, and the reason it is a call rather than
   *  state that moved: the anchor is the selection cluster's, owned jointly with
   *  two overlay batches and `boxCorner` above. See this module's header. */
  setBoxAnchor(p: Vec3T | null): void;
  /** Arm or drop the SEGMENT anchor — `field-segment.ts`'s own setter, reached
   *  through the host. A gesture change and a stamp arm each drop it, for the
   *  reason each of those call sites states. */
  setSegmentAnchor(p: Vec3T | null): void;
  /** A committed entity's recorded provenance, or null if the log no longer
   *  carries it. */
  entityRecord(entityId: number): field.GeneratorEntity | null;
  /** Every committed entity's footprint box, memoized against the log. What a
   *  move maps its drag against, and what a grab's first anchor is taken from. */
  entityFootprints(): Map<number, Aabb>;
  /** Rebuild the selected entity's outline + gizmo batch. Called when a move
   *  narrows the gizmo's arms to the axis it is constrained to. */
  rebuildEntitySelectionBatch(): void;
  /** Re-check the entity selection against the log and rebuild what it draws.
   *  A reconfigure can move the footprint the outline hangs on. */
  revalidateEntitySelection(): void;
  /** Rebuild the committed prop layer from the op log. Both terminal verbs call
   *  it: a commit's placement ops are new prop content, and a reconfigure
   *  re-splices the log the layer is derived from. */
  rebuildProps(): void;
  /** The entity-list tick. */
  notifyEntities(): void;
  /** Record how long the last landed reconfigure took, for the op-cost meter.
   *  An ARROW at the assembly rather than a plain ref, because `field-stats.ts`
   *  is constructed ~530 lines below this module. */
  noteReconfigureMs(ms: number): void;
  /** Install the last reconfigure's drift report (null = the apply was clean).
   *
   *  `field-drift.ts`'s own verb since foundations T3d, arriving through the
   *  host's deps record. It used to be a write-thunk over a closure `let`, on the
   *  reasoning that the slot had to stay where its several writers could reach it;
   *  the extraction inverted that — the slot's two READERS both went with it, and
   *  the other three writers (`stepHistory`, `resetWorld`, the panel's dismiss)
   *  call this same verb from where they are.
   *
   *  Separate from {@link notifyDrift} because the apply's ordering is
   *  load-bearing: every piece of host state settles first, and the three
   *  notifications go last. **That is the half `field-drift.ts` cites this
   *  docblock for, and the move did not touch it** — the pair stayed two calls
   *  precisely so this ordering survived the boundary. */
  setDrift(next: field.DriftFinding[] | null): void;
  /** Push the drift report to the panel. See {@link setDrift} for why the pair
   *  is two calls. */
  notifyDrift(): void;

  // --- the pointer chain's deps (T3c) --------------------------------------
  //
  // Everything below this line arrived with the four pointer handlers, and the
  // shape of the list is the extraction's claim restated as a type: thirteen
  // VERBS the chain dispatches to, three LIVENESS reads, and one constant.
  //
  // No state, and that is the load-bearing part. MOST of what the chain branches
  // on is this module's own slots (`moveDrag`, `pendingStamp`, `gesture`,
  // `digging`), which is why the chain is here; every OUTCOME belongs to some
  // other cluster, which is why the verbs are deps. The three liveness reads are
  // the seam between those two sentences — a look drag, a box corner and a
  // segment anchor are each state a branch TESTS but an overlay elsewhere OWNS,
  // so this module asks and never holds. "Most", not "every": read as an absolute
  // the rule sends `pointerMove`'s first branch back to the host. See the pointer
  // chain's header.

  /** The host's `STROKE_MIN_MS`: the minimum gap between two applications of a
   *  held stroke. A VALUE and not a call, because it is a module `const` — a
   *  binding that cannot move is the one kind a copy cannot fork — which is the
   *  same reason `field-segment.ts` takes the identical constant the identical
   *  way. Shared with that brush deliberately: two throttles tuned apart would
   *  be two feels for one button. */
  strokeMinMs: number;
  /** Route the pointer's events to the canvas until it is released (the DOM's
   *  `setPointerCapture`), behind the element this module has no handle on —
   *  `canvasEl` is the host's and every attach/detach reassigns it. Three callers
   *  here: the stroke, the RMB look, and the drag threshold crossing. Nothing to
   *  do with the Esc capture STACK, which is `router` above; the two words
   *  collide and mean unrelated things (`input-router.ts` says so at the top). */
  capturePointer(pointerId: number): void;
  /** The other half, called UNCONDITIONALLY on every pointerup — releasing a
   *  capture nobody holds is a no-op, and the alternative (remembering per
   *  gesture whether one was taken) is how a stroke that threw its way out of a
   *  press ends up latched on with the button up. See `commitToolOp`. */
  releasePointer(pointerId: number): void;
  /** Is an RMB look drag live? The camera has the pointer, and everything about
   *  that drag — `orbitState`, `aimCamera`, `applyOrbit`, `orbitPivot` — is the
   *  camera cluster's (`field-camera-rig.ts` since 2026-08-08; the host closure
   *  before that), so the chain asks rather than knows. The three verbs below are
   *  that module's now, and this record did not change when they moved. */
  looking(): boolean;
  /** Start one: latch the drag's pivot and its last cursor point. */
  beginLook(clientX: number, clientY: number): void;
  /** One look-drag event's worth of turn. */
  lookDrag(clientX: number, clientY: number): void;
  /** End one. Unconditional on pointerup, like the capture release. */
  endLook(): void;
  /** Alt-click's material sample. Never strokes, which is why it sits ABOVE the
   *  session's suspension guard in the chain. */
  eyedropper(clientX: number, clientY: number): void;
  /** Apply the active tool at a cursor position — the plain brush's whole
   *  outcome, on the press and on every throttled move after it. */
  applyTool(clientX: number, clientY: number): void;
  /** Re-arm the once-per-stroke "selection mask but no selection" report. The
   *  `maskDropReported` latch lives with the report that reads it — the host
   *  closure until 2026-08-08, `field-tool.ts` since; the segment brush re-arms
   *  the same latch through the same verb, per commit rather than per press. */
  armMaskDropReport(): void;
  /** One LMB press with `pointer` armed: gizmo handle, already-selected entity,
   *  or a plain pick. It STAYS in the host though two of its three outcomes are
   *  this module's state, because of what it BRANCHES on — the gizmo hit-test,
   *  `selectedEntityId` and a raycast pick, three host clusters and none of this
   *  module's slots. It reaches the machine the way every other host verb does,
   *  through {@link FieldMachine.beginMove} and
   *  {@link FieldMachine.setPendingMove}. See the pointer chain's header. */
  pointerPress(e: PointerEvent): void;
  /** One click of a CELL-selection gesture (the three {@link SelectionMode}s).
   *  The gesture slot is this module's; everything it commits is the selection
   *  cluster's. */
  selectionClick(mode: SelectionMode, clientX: number, clientY: number): void;
  /** The segment brush's click — its first point, or the capsule its second
   *  sweeps. Gated on the session suspension in the chain, and it needs its own
   *  gate because it reaches the store through the gesture branch rather than
   *  through the stroke below it. */
  segmentClick(clientX: number, clientY: number): void;
  /** Is a segment point down? Its liveness, for the branch that previews the
   *  capsule the second click would sweep. */
  segmentAnchor(): Vec3T | null;
  /** Redraw that preview at the cursor. */
  segmentUpdatePreview(clientX: number, clientY: number): void;
  /** Is a box corner down? Read for LIVENESS only, and the WRITE half is
   *  {@link setBoxAnchor} above — the anchor is the selection cluster's, jointly
   *  owned with the two overlay batches, so this module tests it and never holds
   *  it. Both the box gesture and a pending stamp arm draw through it. */
  boxAnchor(): Vec3T | null;
  /** Redraw the amber region the second corner would close. */
  updateBoxPreview(clientX: number, clientY: number): void;
};

/** The session + gesture machine's live state, the verbs over it, and the four
 *  pointer handlers that arbitrate between them.
 *
 *  The five readers exist because the host still draws and reports: `compose`
 *  needs the placement ghost and both suppression facts, `cursorAffordanceBatch`
 *  and `syncCursor` need what is armed, and the gizmo and the cursor both need to
 *  know what a drag is doing. They are calls rather than fields for the same
 *  reason every substrate thunk is: the values move. There were SIX until T3c
 *  moved the pointer chain in — `pendingMove` had exactly one reader and it was
 *  the threshold test, which is now on this side of the line. Four verbs went the
 *  same way and for the same reason (`stampRegionClick`, `updateMove`,
 *  `dropMove`, `suspendedByStamp`): a member whose only caller moved inside is
 *  not surface, it is a leftover. */
export type FieldMachine = {
  /** The live session (null = none). Stamp, reconfigure and move are all ONE
   *  slot — see {@link StampSession}'s `mode` and `moving`.
   *
   *  BY REFERENCE, and READ-ONLY by contract: this is the machine's own object,
   *  not a copy. The publish seam clones ({@link subscribeStamp}) because it
   *  crosses into the chrome, which holds what it is given; this reader does not,
   *  because it is called from `compose`, `syncCursor` and the pointer
   *  handlers — per-frame and per-event paths where a `structuredClone` of a
   *  params record would be real cost for a caller that only ever asks whether a
   *  session exists and what phase it is in. Mutating what comes back would move
   *  the session behind {@link setStamp}'s capture reconcile and behind the
   *  supersession run counter; no caller does, and none may. */
  session(): StampSession | null;
  /** What LMB does: a selection gesture, the two-click `segment` brush,
   *  `pointer`, or null for a plain brush stroke. */
  gesture(): ViewportGesture | null;
  /** The generator armed for REGION-DRAW (null = none). SHADOWS
   *  {@link gesture} rather than occupying its slot. */
  pendingStamp(): PendingStamp | null;
  /** The live move's cursor mapping (null = none). Its SESSION is
   *  {@link session}; this is only the mapping over it. */
  moveDrag(): MoveDrag | null;
  /** The previewed PLACEMENTS' wireframe proxies as ONE merged line batch, or
   *  null when the preview placed nothing. The surface half of the ghost lives
   *  in `substrate.ghostMeshes`, which the host draws directly. */
  placementGhost(): LineBatch | null;

  /** Arm a gesture (null = the plain brush stroke). Drops the pending stamp arm,
   *  any move in flight and both pending anchors. */
  setGesture(next: ViewportGesture | null): void;
  /** Arm or drop region-draw for a generator. Disarming takes the box corner
   *  with it. */
  setPendingStamp(next: PendingStamp | null): void;
  /** The ONE way the sub-threshold press moves — `setStamp`'s law, one slot
   *  over. */
  setPendingMove(next: PendingMovePress | null): void;

  /** {@link FieldHost.startStamp}: open a session on the current selection, or
   *  ARM region-draw when there is nothing selected to stamp into. */
  startStamp(generator: string): void;
  /** {@link FieldHost.updateStamp}: re-parameterize the live session and
   *  re-preview. */
  updateStamp(
    params: Record<string, unknown>,
    seed: number,
    policy: field.MergePolicy,
  ): void;
  /** Move the session's region by whole lattice steps and re-preview — the ONE
   *  path behind the arrow keys, the session card's d-pad and a move's own
   *  cursor mapping. */
  nudgeStamp(steps: Vec3T): void;
  /** {@link FieldHost.rotateStamp}: the live session's next quarter turn. */
  rotateStamp(): void;
  /** {@link FieldHost.rerollStamp}: re-preview under a fresh random seed. */
  rerollStamp(): void;
  /** {@link FieldHost.commitStamp}: commit the previewed STAMP session. */
  commitStamp(): void;
  /** {@link FieldHost.confirmSession}: what ⏎ means — drop a live move, else end
   *  the session by its mode. */
  confirmSession(): void;
  /** Discard the session, its ghost and any move riding it. THE teardown every
   *  discard path runs (Esc, a world reset, a table swap, freeze/bake/delete, a
   *  re-open, dispose). */
  cancelSession(): void;
  /** {@link FieldHost.openEntity}: open a reconfigure session on a committed
   *  entity. */
  openEntity(entityId: number): void;
  /** {@link FieldHost.applyReconfigure}: apply the live reconfigure session. */
  applyReconfigure(): void;

  /** Start a move on a committed entity: the reconfigure session plus the cursor
   *  mapping that will drive its region. Returns whether it started (every
   *  refusal is the session open's, already reported). */
  beginMove(
    entityId: number,
    axis: Axis | null,
    grabbed: boolean,
    press: { x: number; y: number } | null,
  ): boolean;
  /** A camera change mid-move retires the drag's anchor. */
  reaimMove(): void;
  /** Abandon a move WITHOUT committing it (pointercancel, focus loss, arming
   *  another gesture). Cancels the session too when the session is the move's. */
  cancelMoveInFlight(): void;

  /** WHO GETS THIS PRESS — the seven-way arbitration behind the host's
   *  `pointerdown` listener. See the pointer chain's header for the rule that
   *  decided which half of each branch lives here. */
  pointerDown(e: PointerEvent): void;
  /** The six-way one behind `pointermove`. */
  pointerMove(e: PointerEvent): void;
  /** What ends a pointer gesture: a dropped move, a cleared press, the stroke
   *  flag, the look drag and the capture. */
  pointerUp(e: PointerEvent): void;
  /** `pointercancel` — {@link pointerUp} with the move DISCARDED rather than
   *  dropped, because the system voided the gesture. */
  pointerCancel(e: PointerEvent): void;

  /** Tear down BOTH halves of the stamp ghost. Public for `dispose`, which frees
   *  the GPU side before it drops the context. */
  destroyGhosts(): void;

  /** The stamp-session seam behind `FieldHost.subscribeStamp` — multicast, with
   *  the current session CLONED to each arriving subscriber. */
  subscribeStamp(cb: (s: StampSession | null) => void): () => void;
  /** The pending-arm seam behind `FieldHost.subscribePendingStamp` — multicast,
   *  pushing on CHANGE only. */
  subscribePendingStamp(cb: (p: PendingStamp | null) => void): () => void;
};

/** Build the session + gesture machine over one host's dependencies. One per
 *  host; it holds the interactive middle's state for that host's lifetime. */
export function createFieldMachine(deps: MachineDeps): FieldMachine {
  const { substrate } = deps;

  // --- the armed slot + the arm that shadows it ----------------------------
  //
  // POINTER is the default (D-F4.5-7): a host opens ready to SELECT, not ready
  // to dig, so the first click on a world can never be a destructive one. Two
  // existing behaviours fall out of that with no new rule — the brush ghost
  // hides (compose draws it only while `gesture === null`) and LMB bypasses
  // applyTool (this module's own arbitration) — which is exactly right: nothing
  // on screen promises a stroke that will not happen. Arming a brush effect is
  // what the chrome does to get back to `null`.
  let gesture: ViewportGesture | null = "pointer";
  // The generator picked with nothing selected: LMB spans a region for it, and
  // that region opens the session. See the PendingStamp type for why it is NOT
  // a `gesture` member — it SHADOWS the armed gesture rather than replacing it,
  // so ending it restores what LMB did with nothing to put back.
  let pendingStamp: PendingStamp | null = null;
  // Snapshot for the subscribeStamp reason: a rail arriving while a stamp is
  // armed must not read as idle beside a viewport asking for a region. Copied
  // at the boundary — the chrome never holds host state.
  const pendingStampChannel = createViewChannel<[PendingStamp | null]>({
    snapshot: () => [pendingStamp === null ? null : { ...pendingStamp }],
  });
  // Once-per-SESSION guard for the brush-suspension report (`suspendedByStamp`).
  // Re-armed where a session opens rather than where one ends, so the unit is
  // the session the user is looking at: one sentence per session, however many
  // times they click into it.
  let suspendReported = false;

  // --- the stroke ----------------------------------------------------------
  //
  // LMB-is-down for the PLAIN brush (the `gesture === null` fallthrough at the
  // bottom of the pointerdown chain), and the timestamp its throttle measures
  // from. They came with the chain in T3c and they had to: nothing outside the
  // four pointer handlers ever read either one — not `compose`, not the
  // cursor, not the facade — so they were host state only in the sense that they
  // were declared there.
  //
  // NO canonical setter and NO Esc rung, unlike `stamp` and `pendingMove`, and
  // the asymmetry is honest rather than an omission: a stroke's cancel is
  // letting go of the button, and the DOM pointer capture it takes is released
  // unconditionally on pointerup whatever this flag says. There is no state here
  // that an Esc could be about.
  let digging = false;
  let lastStroke = 0;

  // --- stamp session (ghost preview → commit) -----------------------------
  let stamp: StampSession | null = null;
  // Session generation: the pure module's run counter restarts at 0 on every
  // startSession, so run alone cannot tell a stale PREVIOUS session's response
  // from the current session's run-0 job. Bumped on every session open; preview
  // handlers drop responses whose captured generation is stale.
  let stampGen = 0;
  // Which of the LIVE session's params the user has spoken about, accumulated over its
  // updates. Session-scoped (cleared wherever a session opens), because it is a claim
  // about THIS conversation: an edit made to the stamp before last says nothing about
  // the one on screen now. Its one reader is the archetype re-seed below.
  let stampTouched: ReadonlySet<string> = new Set();
  // Panel mirror for stamp-session changes (Task 15). Snapshot for the
  // remount rule: a surface arriving mid-session must not render "no stamp"
  // beside a visible ghost. CLONED, like every push on this seam.
  const stampChannel = createViewChannel<[StampSession | null]>({
    snapshot: () => [stamp === null ? null : structuredClone(stamp)],
  });
  // The previewed PLACEMENTS' wireframe proxies, as ONE merged line batch
  // (hologram-blue, occlude:false) — rebuilt with the ghost meshes on every
  // preview response, cleared with them. Null = the preview placed nothing.
  //
  // The SURFACE half of the ghost lives in `substrate.ghostMeshes` (one entry per
  // previewed chunk) rather than here, because `compose` puts it on the draw list: the map is
  // shared by identity, so the meshes this module builds and the loop that draws
  // them can never be two collections that disagree.
  let placementGhost: LineBatch | null = null;

  // --- the move that rides a session --------------------------------------
  //
  // The live move (null = none). Its session is the `stamp` slot — this is only
  // the cursor mapping over it, which is why every path that ends a session
  // clears this too (endMove).
  let moveDrag: MoveDrag | null = null;
  // A drop that arrived while the ghost was still in flight. The commit is
  // ready-phase gated like every other, and a release lands within a preview
  // round trip of the last cursor move far more often than not — so the drop
  // LATCHES here and the preview's settle spends it. Without it, letting go
  // straight after moving would be swallowed and the session would hang open.
  let moveCommitPending = false;
  // A press on the ALREADY-SELECTED entity, waiting to see whether the cursor
  // travels far enough to mean "move" (DRAG_THRESHOLD_PX) — the press itself
  // changes nothing, so a plain click on what is already selected stays the
  // no-op it has always been.
  let pendingMove: PendingMovePress | null = null;

  // --- the Esc rungs this cluster owns -------------------------------------
  //
  // The live session's rung (old ladder rung 2) — `stamp` and `moveDrag` share
  // ONE, because `cancelSession` ends the move first (its own first line, before
  // the null guard), so one press has always taken both. Hence the OR: the entry
  // stands while either does.
  const syncSessionCapture = createRung(
    deps.router,
    "live session",
    () => stamp !== null || moveDrag !== null,
    () => cancelStampSession(),
  );

  // The pending stamp ARM's Esc entry (old rung 1b). It sat AFTER the anchors in
  // the ladder because the two are one gesture in two steps and the most recent
  // step goes first — an Esc with a corner down re-draws the region, a second one
  // leaves region-draw altogether. The stack gets that for free: the arm is
  // acquired at `startStamp`, the corner at the click after it.
  const syncPendingStampCapture = createRung(
    deps.router,
    "pending stamp",
    () => pendingStamp !== null,
    () => setPendingStamp(null),
  );

  // The sub-threshold press's Esc entry — the rung the ladder never had, and the
  // last captured-state gap in the host (T3c).
  //
  // It is genuinely live state: between the press and the threshold the host is
  // holding an intention, and Esc's contract is "cancel the most recent thing the
  // user started". Without an entry the press was invisible to the stack, so Esc
  // fell PAST it and cancelled whatever stood behind — typically the selection the
  // press was aimed at, which the user cannot see being targeted because nothing
  // has moved yet. Cancelling the press instead is both what Esc says and the
  // smaller of the two actions.
  //
  // NO pointer-capture release here, verified rather than assumed: the branch in
  // `pointerPress` that arms this one does not capture — capture is taken at the
  // threshold crossing, in the same breath that clears this slot for a real
  // `moveDrag`. So there is never a capture outstanding while this entry stands,
  // and a release would be an unreachable line that could only ever throw on a
  // stale id.
  const syncPendingMoveCapture = createRung(
    deps.router,
    "pending move",
    () => pendingMove !== null,
    () => setPendingMove(null),
  );

  // --- the canonical setters ----------------------------------------------

  /** The ONE way `stamp` moves — `input-router.ts`'s canonical-setter law, which
   *  the session slot was the last captured state in the host not to obey.
   *
   *  Writes that CROSS null↔non-null reconcile the capture; live→live transforms
   *  do not, and that asymmetry is the point rather than an optimisation. A
   *  reconcile on a transform would be a no-op with a cost today, but what it
   *  would really do is invite the reading that a slider drag RE-ACQUIRES, which
   *  would move the session's position in the Esc stack every time a param
   *  changed — so a user who nudged a param after drawing a box would find Esc
   *  taking the session before the box.
   *
   *  This replaces a hand-maintained list of which writes crossed, kept as a
   *  comment beside the rung. The list was correct and stayed correct for three
   *  tranches; the objection is that it had to be READ and re-derived by anyone
   *  adding a fourteenth write, and nothing failed if they didn't. `crossed` is
   *  that list become structure — every site pays one comparison and no site has
   *  to know which kind of write it is.
   *
   *  `notifyStamp()` deliberately stays at the call sites: this owns the CAPTURE,
   *  not the publish. Publish cadence is per-site today (a preview job in flight
   *  does not push, a commit pushes after the entity list) and the suites pin it
   *  that way. */
  const setStamp = (next: StampSession | null): void => {
    const crossed = (stamp === null) !== (next === null);
    stamp = next;
    if (crossed) syncSessionCapture();
  };

  /** The ONE way `pendingMove` moves — `setStamp`'s law, one slot over. */
  const setPendingMove = (next: PendingMovePress | null): void => {
    pendingMove = next;
    syncPendingMoveCapture();
  };

  // The pending stamp arm (null = none). Pushes on CHANGE only: the clear runs
  // from several paths that are usually no-ops (every gesture arm), and a
  // subscriber re-rendering on each of those would pay for nothing.
  //
  // DISARMING TAKES THE CORNER WITH IT, and it happens HERE rather than at each
  // caller because five paths clear the arm and only one of them (Esc, whose
  // corner capture sits above this one) was clearing the corner: a
  // `setGesture` re-arming what is already armed, `openEntitySession` — reached
  // by the Entities palette's Open AND by every `G` grab through
  // `beginMoveSession` — and a selection-first `startStamp`, reachable with no
  // click at all through Reselect. Each left an amber cross drawing with nothing
  // armed to close it, and each ate an Esc press on the way out.
  //
  // Safe by construction rather than by care: while an arm stands, ANY box
  // anchor belongs to it. `startStamp` clears both anchors before arming, and
  // LMB routes to `stampRegionClick` ahead of the gesture branch, so
  // `selectionClick` — the only other route into `boxCorner` — cannot run.
  // The change guard above is what keeps this off the plain `setGesture` path,
  // so "re-arming the same gesture must not drop a pending anchor" still holds.
  const setPendingStamp = (next: PendingStamp | null): void => {
    if ((pendingStamp?.id ?? null) === (next?.id ?? null)) return;
    const disarming = pendingStamp !== null && next === null;
    pendingStamp = next;
    syncPendingStampCapture();
    if (disarming) deps.setBoxAnchor(null);
    pendingStampChannel.publish(next === null ? null : { ...next });
  };

  // Panel mirror: sessions are CLONED so the panel never holds references
  // into host state (params/region are mutable records). ONE clone per publish,
  // shared by every subscriber — pushed values are immutable by contract.
  const notifyStamp = (): void => {
    stampChannel.publish(stamp === null ? null : structuredClone(stamp));
  };

  // --- the ghost ----------------------------------------------------------

  // Tears down BOTH halves of the stamp ghost: the surface meshes (GPU) and the
  // placement wireframes (CPU-only line batch). One function because they are
  // one preview's worth of promise — a session whose ghost meshes are gone but
  // whose prop boxes linger would show props the field no longer previews.
  const destroyStampGhosts = (): void => {
    const c = substrate.ctx();
    if (c)
      for (const entries of substrate.ghostMeshes.values())
        for (const e of entries) {
          mesh.destroy(c, e.m);
          geometry.destroy(c, e.g);
        }
    substrate.ghostMeshes.clear();
    placementGhost = null;
  };

  // Build the ghost render state from a preview response: one mesh per
  // non-empty bucket, ALL under the one stamp-ghost material (shape only —
  // classes/kit appear on commit), at chunk origins.
  // Deliberate v0 (slice-coherence disposition, F2b Task 15): the stamp ghost
  // renders FULL-HEIGHT even over a sliced field — the preview evaluate never
  // sees sliceY, so "see what you're stamping" wins over slice consistency.
  // The commit's real chunk meshes then re-clip through the slice as usual.
  const applyStampGhost = (
    chunks: { key: string; buckets: WireBucket[] }[],
  ): void => {
    const c = substrate.ctx();
    if (!c) return;
    destroyStampGhosts();
    for (const { key, buckets } of chunks) {
      const [cx, cy, cz] = field.parseChunkKey(key);
      const origin = deps.chunkOrigin(cx, cy, cz);
      const entries: { m: mesh.Mesh; g: geometry.Geometry }[] = [];
      for (const bucket of buckets) {
        const indices = new Uint32Array(bucket.indices);
        if (indices.length === 0) continue;
        const g = geometry.create(c, {
          positions: new Float32Array(bucket.positions),
          normals: new Float32Array(bucket.normals),
          uvs: new Float32Array(bucket.uvs),
          indices,
        });
        const m = mesh.create(c, {
          geometry: g,
          material: deps.stampGhostMaterial(),
        });
        mesh.setPosition(c, m, origin);
        entries.push({ m, g });
      }
      if (entries.length > 0) substrate.ghostMeshes.set(key, entries);
    }
  };

  // --- the preview round trip ---------------------------------------------

  // Post ONE preview job for a session state captured at fire time. Response
  // processing is guarded two ways: the session RUN (the pure module drops
  // superseded runs) and the session GENERATION (run restarts at 0 per
  // session, so a previous session's response could otherwise land on a fresh
  // session's run 0). The coalescer's settle() runs on EVERY settlement —
  // result, error, or a handler that itself threw, stale and
  // foreign-generation alike — so the latch always releases and a queued
  // re-fire is never lost.
  const sendPreviewJob = (s: StampSession, gen: number, run: number): void => {
    substrate.worker
      .stampPreview({
        generator: s.generator,
        params: structuredClone(s.params),
        seed: s.seed,
        region: structuredClone(s.region),
        policy: s.policy,
        table: substrate.table(),
        cellSize: substrate.store.cellSize,
        chunks: deps.snapshotChunks(s.region),
      })
      .then(
        (res) => {
          if (!substrate.disposed() && gen === stampGen && stamp !== null) {
            const next = withPreviewResult(
              stamp,
              run,
              res.opCount,
              res.placements.length,
            );
            // null = superseded — a newer preview owns the ghost.
            if (next !== null) {
              setStamp(next);
              applyStampGhost(res.chunks);
              // AFTER applyStampGhost, which clears both ghost halves first.
              placementGhost = placementGhostBatch(
                res.placements,
                substrate.archetypeById(),
                GHOST_COLOR,
              );
              // A move DROP that landed while this preview was in flight. Spent
              // HERE, on the settle that made the session committable, and
              // BEFORE notifyStamp: a commit ends the session and notifies on
              // its own way out, so publishing "ready" first would push a
              // session the chrome never gets to see. Not spent on a STALE run
              // (`next === null` above) — a newer preview is still coming and
              // owns the drop. A commit that refuses (an empty preview, a core
              // throw) leaves the session standing and falls through to the
              // notify below, which is what keeps its message on screen.
              if (moveCommitPending) {
                moveCommitPending = false;
                commitActiveSession();
                if (stamp === null) return;
              }
              notifyStamp();
            }
          }
        },
        (err: unknown) => {
          if (!substrate.disposed() && gen === stampGen && stamp !== null) {
            const message = err instanceof Error ? err.message : String(err);
            const next = withPreviewError(stamp, run, message);
            if (next !== null) {
              // The session's error field is the panel's channel; console
              // keeps the developer trail (mirrors remeshOne).
              console.warn(`field-host: stamp preview failed: ${message}`);
              // A latched drop dies with the preview it was waiting on: there is
              // no ghost to commit, and an armed latch would otherwise fire on
              // whatever settle came next — a re-roll, a param edit — committing
              // something the user never dropped. The session is demoted with it
              // (the drop already ended the mapping), which is the OTHER way a
              // move stalls: dropMove's error branch catches a preview that had
              // already failed, this one catches the drop that latched onto a
              // preview about to fail.
              moveCommitPending = false;
              setStamp(demoteStalledMove(next));
              destroyStampGhosts();
              notifyStamp();
            }
          }
        },
      )
      // A HANDLER can throw — applyStampGhost against a context torn down
      // mid-flight (a subscriber inside notifyStamp was the other way in until
      // the seams went multicast; the channel isolates that one). Two-argument `then`
      // sends that to an unhandled rejection, skipping the settle() the old
      // shape put at the end of each handler and latching the coalescer shut
      // for the rest of the session (every later preview silently queued and
      // never fired). Catch it, then settle from `finally` so the latch
      // releases on EVERY path — result, rejection, or handler fault.
      .catch((err: unknown) => {
        // reportToolError, not a bare console.warn: the session's own error
        // field carries a preview REJECTION to the panel, but a fault in the
        // handler leaves the session reading "previewing" beside a ghost that
        // never arrived — the one stamp failure with nowhere to show. The
        // tool-error channel is where the void cast puts its equivalent, and
        // reportToolError keeps the console trail either way.
        const message = err instanceof Error ? err.message : String(err);
        deps.reportToolError(`stamp preview could not be drawn: ${message}`);
      })
      .finally(() => previewCoalescer.settle());
  };

  // Latest-wins in-flight coalescing: the worker client is a plain request
  // pipe ("callers own coalescing", field-client.ts), so THIS MODULE collapses
  // preview bursts — while one job runs, any number of previewStamp calls
  // queue ONE re-fire against the session state CURRENT at settle. A slider
  // drag costs at most one trailing job instead of a 30-60Hz queue of
  // snapshot copies + ~100ms worker evaluates. Fire declines (false) when
  // the session vanished by fire time, leaving the latch idle.
  const previewCoalescer = createPreviewCoalescer((): boolean => {
    if (substrate.disposed() || stamp === null) return false;
    sendPreviewJob(stamp, stampGen, stamp.run);
    return true;
  });

  // Fire (or queue) a ghost preview for the current session. Session-state
  // captures happen inside the coalescer's fire callback, BEFORE notifyStamp
  // runs: a subscriber may synchronously cancel/update the session from
  // inside the "previewing" notification (re-entrancy), so nothing here
  // re-reads `stamp` after notifying.
  // Known v0 divergence window (F2b Task 15 disposition): a ⌘Z DURING a live
  // session mutates the store this preview snapshotted, so a keep-existing-air
  // ghost can differ from what commit later builds (commit re-evaluates against
  // the then-current field). NARROWED to ⌘Z by F4.5b Task 9: a brush stroke is
  // no longer one of the ways in — both field-writing arms are suspended while a
  // session stands (`suspendedByStamp`), which makes the "contrived today"
  // justification stronger, not weaker. Documented rather than fixed with
  // cancel-on-undo. See also commitStampSession.
  const previewStamp = (): void => {
    if (stamp === null) return;
    setStamp(toPreviewing(stamp));
    previewCoalescer.request();
    notifyStamp();
  };

  // Move the session's placement region by whole lattice steps and re-preview
  // — the ONE path behind both the arrow keys and the session card's d-pad.
  // Region changes supersede like params changes (withRegion bumps the run),
  // so an in-flight ghost for the old placement is dropped on arrival, and
  // sendPreviewJob re-snapshots chunks off the NEW region by itself.
  const nudgeStampRegion = (steps: Vec3T): void => {
    if (stamp === null) return;
    setStamp(withRegion(stamp, nudgeRegion(stamp.region, steps)));
    previewStamp();
  };

  // The quarter turns a generator offers, read off its OWN paramSchema — never a
  // list spelled here. Core owns the members (they are STRINGS, and its
  // validator accepts exactly those), so a copy in the editor would be a second
  // spelling of one fact, free to drift the day a turn is added or the enum goes
  // numeric. Null = this generator has no rotation (cave, scatter) or has left
  // the registry.
  const rotationOptions = (generator: string): string[] | null => {
    let def: field.GeneratorDef;
    try {
      def = field.generatorById(generator);
    } catch {
      return null;
    }
    const prop = generatorSchemaProperties(def)[ROTATION_PARAM];
    if (typeof prop !== "object" || prop === null) return null;
    // Boundary cast: the runtime check above proves a non-null object, which is
    // always index-readable as Record<string, unknown> (generatorSchemaProperties'
    // own narrowing, one level down).
    const members = (prop as Record<string, unknown>)["enum"];
    if (!Array.isArray(members)) return null;
    const turns = members.filter((m): m is string => typeof m === "string");
    return turns.length === 0 ? null : turns;
  };

  // R: the live session's next quarter turn. A params change like any other —
  // the run bumps, the ghost re-cooks, and Enter then commits what is on screen.
  // A value the schema does not offer (absent, because `rotation` is optional on
  // records written before it existed) lands on the FIRST member rather than
  // reporting: the point of the key is to turn the thing.
  const rotateStampSession = (): void => {
    const s = stamp;
    if (s === null) return;
    const turns = rotationOptions(s.generator);
    if (turns === null) {
      deps.reportToolError(`${s.generator} has no rotation`);
      return;
    }
    const current = s.params[ROTATION_PARAM];
    const at = typeof current === "string" ? turns.indexOf(current) : -1;
    const next = turns[(at + 1) % turns.length];
    if (next === undefined) return; // unreachable: turns is non-empty
    setStamp(
      withParams(s, { ...s.params, [ROTATION_PARAM]: next }, s.seed, s.policy),
    );
    previewStamp();
  };

  const cancelStampSession = (): void => {
    // BEFORE the null guard, so a stray move mapping can never survive a session
    // that is already gone — this is the ONE teardown every discard path runs
    // (Esc, a world reset, a table swap, freeze/bake/delete, a re-open). It
    // reconciles the capture on its way out, which is what makes the early return
    // below safe: a move with no session releases the entry there.
    endMove();
    if (stamp === null) return;
    setStamp(null);
    destroyStampGhosts();
    notifyStamp();
  };

  // The ONE thing the host decides for the card when a param changes: re-pointing a
  // placer at a different catalog archetype re-seeds the params the user has NOT spoken
  // about from the new archetype's authored `scatter` hints, and leaves the ones they
  // have (D-25 — "defaults behave"). Both other readings are wrong in a way the user
  // notices: re-seed everything and their density edit vanishes without a word; re-seed
  // nothing and the new archetype arrives wearing the old one's spacing.
  //
  // HERE rather than in the session card, and not by preference. The hints come off the
  // installed entity catalog, which the CHROME deliberately does not carry — `useCatalogs`
  // publishes a tick and says why ("handing over the parsed catalog would invite a
  // consumer to read it instead of re-reading the host"). So the decision belongs on this
  // side of the chrome boundary, and the touched-key set that filters it has to sit with
  // the decision rather than with the surface asking for it.
  //
  // THE HINTS AND THE FILTER ARE NOW IN DIFFERENT MODULES, and that is worth stating
  // because the argument above used to end "…or the decision would be split across two
  // actors that can disagree", which is exactly the arrangement T3c produced: the catalog
  // is a `let` in `createFieldHost` and `stampTouched` is a `let` in here. What makes the
  // split safe is the SHAPE of the boundary, not luck — `archetypes` arrives as a THUNK
  // ({@link MachineDeps.archetypes}), so this reads the installed catalog at call time,
  // not a photograph of whatever was installed when the machine was built. A value copy
  // would have made the old sentence come true: a `setEntityCatalog` between construction
  // and this call would leave the filter selecting keys off a catalog the project no
  // longer has. There is still exactly ONE actor deciding — this function — and it asks
  // the host for the catalog rather than remembering one.
  //
  // QUERY only: `stampTouched` is updated by the caller BEFORE this runs, so the incoming
  // change itself counts as touched — which is what keeps the id the user just picked from
  // being treated as a hint about itself.
  const reseedForArchetype = (
    incoming: Record<string, unknown>,
    current: Record<string, unknown>,
  ): Record<string, unknown> => {
    if (Object.is(incoming[ARCHETYPE_PARAM], current[ARCHETYPE_PARAM]))
      return incoming;
    return seedArchetypeParams(
      incoming,
      deps.archetypes(),
      Object.keys(incoming).filter((k) => !stampTouched.has(k)),
    );
  };

  // Open a STAMP session over `aabb` and fire its first ghost preview — the half
  // of `startStamp` that runs once a region is known, shared by its two routes
  // in: a selection that was already there, and a region the user drew for a
  // pending arm (D-F4.5-7). One body, so the two cannot snap, seed or layer
  // params differently.
  //
  // `truncated` is a property of the SELECTION that supplied the region (a flood
  // that hit the UI budget under-covers what the user asked for), so a drawn
  // region passes false: a region is exactly itself.
  const openStampSession = (
    generator: string,
    def: field.GeneratorDef,
    aabb: Aabb,
    truncated: boolean,
  ): void => {
    // The region snapped OUTWARD to the 0.5 m lattice — the same snap box-select
    // regions get (a region selection and a drawn region are already snapped;
    // flood AABBs land on the voxel grid and widen out).
    const [x0, x1] = snapSpan(aabb.min[0], aabb.max[0]);
    const [y0, y1] = snapSpan(aabb.min[1], aabb.max[1]);
    const [z0, z1] = snapSpan(aabb.min[2], aabb.max[2]);
    // Seed the size params from the region extent (spec D-F3-13): the region
    // already fits, and the generator's size knobs default to fill it (clamped
    // to their schema range). A sensible default the user overrides with any
    // subsequent updateStamp edit.
    const sizes = deriveSizeDefaults(
      generator,
      [spanCells(x0, x1), spanCells(y0, y1), spanCells(z0, z1)],
      generatorSchemaProperties(def),
      field.MAZE_PITCH_CELLS,
    );
    cancelStampSession(); // a live session (+ ghost) never survives a restart
    stampGen++;
    suspendReported = false; // one suspension sentence per session
    stampTouched = new Set(); // a new session has heard nothing yet
    // Layering, outermost last: schema defaults → the archetype's authored
    // scatter hints (catalog seeding) → the region-fit sizes. The two never
    // collide today (no generator has both an archetypeId and a size param),
    // and if one ever does, the REGION the user drew should win over a catalog
    // default.
    setStamp(
      startSession(
        generator,
        {
          ...seedArchetypeParams(
            structuredClone(def.defaults),
            deps.archetypes(),
          ),
          ...sizes,
        },
        { min: [x0, y0, z0], max: [x1, y1, z1] },
        randomStampSeed(),
        truncated,
      ),
    );
    previewStamp();
  };

  // The second click of a pending stamp's region draw: the drawn box IS the
  // region the session opens on. The arm is spent either way the click goes —
  // once the region lands, and not at all while a corner is still owed.
  const stampRegionClick = (clientX: number, clientY: number): void => {
    const armed = pendingStamp;
    if (armed === null) return;
    const spec = deps.boxCorner(clientX, clientY);
    // A region spec's min/max ARE its metre AABB (cf. updateBoxPreview); the
    // kind check narrows the union, and boxCorner only ever builds a region.
    if (spec === null || spec.kind !== "region") return;
    let def: field.GeneratorDef;
    try {
      def = field.generatorById(armed.id);
    } catch (err) {
      // Unreachable today — `startStamp` resolved this id before arming, and the
      // registry is a module constant. Caught anyway because the alternative is
      // a throw out of a pointer handler.
      const message = err instanceof Error ? err.message : String(err);
      deps.reportToolError(message);
      setPendingStamp(null);
      return;
    }
    setPendingStamp(null);
    openStampSession(armed.id, def, { min: spec.min, max: spec.max }, false);
  };

  // {@link FieldHost.startStamp}: open a session on the CURRENT selection, or arm
  // region-draw when there is nothing selected to stamp into (D-F4.5-7).
  const startStamp = (generator: string): void => {
    let def: field.GeneratorDef;
    try {
      def = field.generatorById(generator); // setup-loud on unknown ids
    } catch (err) {
      // BEFORE the selection branch: an id no registry carries cannot open a
      // session and must not arm region-draw either — there would be nothing
      // to put in the region the user then drew.
      const message = err instanceof Error ? err.message : String(err);
      deps.reportToolError(message);
      return;
    }
    const region = deps.selectionRegion();
    if (region === null) {
      // D-F4.5-7: no region to stamp into, so ASK FOR ONE rather than refuse.
      // The stale corner goes with the arm — a half-drawn box select would
      // otherwise become this stamp's first corner without the user clicking it —
      // and so does any live session, for the reason its own re-open gives: a
      // ghost the user is no longer steering answers to nothing. That keeps the
      // two mutually exclusive, which is what lets each surface pick one to name.
      cancelStampSession();
      deps.setBoxAnchor(null);
      // The SEGMENT anchor too, and it is not cosmetic: `cursorAffordance`
      // answers `null` for any anchored gesture, so a half-drawn capsule would
      // suppress the very cursor cross this arm exists to show — while its
      // hologram went on tracking the pointer for a sweep that can no longer
      // happen, and Esc spent its first press on a point the user thought was
      // long gone.
      deps.setSegmentAnchor(null);
      setPendingStamp({ id: generator, name: def.name });
      return;
    }
    // A selection-first start supersedes any arm: the region question is
    // answered, so the viewport must stop asking it.
    setPendingStamp(null);
    // …and both pending ANCHORS with it, for the reasons the sibling branch
    // above spells out — they hold whichever way the session was opened, and
    // D-7 suspends the brush under a live session anyway, so a half-drawn
    // gesture waiting underneath one is a contradiction.
    //
    // NOT covered by the `setPendingStamp(null)` above, though it looks it:
    // that setter clears the box corner only when it is really DISARMING, and
    // its first line returns on an unchanged id — so with nothing armed (the
    // ordinary way here: select a region, arm a gesture, click once, pick a
    // generator) the call does nothing at all.
    deps.setBoxAnchor(null);
    deps.setSegmentAnchor(null);
    openStampSession(generator, def, region.aabb, region.truncated);
  };

  // Re-parameterize the live session and re-preview. Any in-flight preview is
  // superseded (its response is dropped). No-op without a session.
  const updateStampSession = (
    params: Record<string, unknown>,
    seed: number,
    policy: field.MergePolicy,
  ): void => {
    if (stamp === null) return;
    // Clone at the boundary — session params must never alias panel state.
    const incoming = structuredClone(params);
    // Record what the user has spoken about BEFORE re-seeding, so the archetype id they
    // just picked counts as touched and the filter below cannot overwrite it.
    stampTouched = touchedParamKeys(incoming, stamp.params, stampTouched);
    setStamp(
      withParams(
        stamp,
        reseedForArchetype(incoming, stamp.params),
        seed,
        policy,
      ),
    );
    previewStamp();
  };

  // Re-preview the live session under a fresh random seed (params/policy
  // unchanged). No-op without a session.
  const rerollStampSession = (): void => {
    if (stamp === null) return;
    setStamp(withParams(stamp, stamp.params, randomStampSeed(), stamp.policy));
    previewStamp();
  };

  // --- the terminal verbs -------------------------------------------------

  // The empty-preview gate both terminal verbs share, and PROP GENERATORS ONLY.
  // Core rejects an empty evaluate outright ("evaluated to an empty result"),
  // which is right for a CARVER — nothing to build means a misconfigured stamp,
  // and core's own message says so accurately. It reads as a hard failure for a
  // READER the user simply tuned down to zero props, where zero is a legitimate
  // outcome, so for those this gate tests the settled preview first and reports a
  // sentence in the vocabulary of the thing that came up empty, leaving the
  // session standing to re-tune. A carver keeps core's message verbatim (through
  // the callers' catch): "0 props … raise density" would be nonsense advice for
  // a hall. Returns whether it refused.
  //
  // STALENESS — this reads the LAST SETTLED PREVIEW, not a fresh evaluate, so it
  // inherits the divergence window `previewStamp` documents: a ⌘Z during a live
  // session moves the store the preview snapshotted (a brush stroke no longer
  // can — see `suspendedByStamp`). Undo a floor out from under a scatter that
  // previewed empty and Enter still refuses, with advice that is no longer true. Cheap to escape (any param change, re-roll or
  // nudge re-previews) and it only ever refuses a commit core would reject
  // anyway, so it is documented rather than fixed with a re-evaluate on commit.
  const reportEmptyPreview = (s: StampSession): boolean => {
    if (!previewIsEmpty(s)) return false;
    let def: field.GeneratorDef;
    try {
      def = field.generatorById(s.generator);
    } catch {
      return false; // a retired generator: let the core call own the failure
    }
    if (!placesProps(def.emits)) return false;
    deps.reportToolError(
      `${s.generator} placed no props here — nothing to commit. Widen the region, raise density, or lower spacing.`,
    );
    return true;
  };

  // Commit the previewed stamp: ONE undo entry, ONE entity op. Preview and
  // commit run the SAME pure evaluate (charter §2.2 determinism), so the
  // committed field reproduces the ghost exactly — the ghost is not an
  // approximation. Exception: the store changed since the last preview (⌘Z or
  // a stroke mid-session) — see the divergence note on previewStamp.
  const commitStampSession = (): void => {
    const s = stamp;
    if (s === null || s.phase !== "ready") return;
    // Mode guard, symmetric with applyReconfigureSession's: committing a
    // RECONFIGURE session would append a second entity over the same region and
    // leave the original standing. commitActiveSession already routes Enter by
    // mode, so this guards the PUBLIC commitStamp against the same mistake.
    if (s.mode !== "stamp") return;
    if (reportEmptyPreview(s)) return;
    try {
      const { dirty: committed } = field.commitGenerator(
        substrate.store,
        substrate.log,
        field.generatorById(s.generator),
        {
          params: s.params, // commitGenerator clones for provenance
          seed: s.seed,
          region: s.region,
          policy: s.policy,
          table: substrate.table(),
        },
      );
      deps.markDirtyWithNeighbors(committed);
    } catch (err) {
      // Ready-phase commits share the preview's validated inputs, but the
      // material table can change between the two — setup-loud core throws
      // land here; the session stays ready so the user can cancel or retry.
      const message = err instanceof Error ? err.message : String(err);
      deps.reportToolError(`stamp commit failed: ${message}`);
      return;
    }
    setStamp(null);
    destroyStampGhosts();
    // The commit's placement ops (a scatter's props) are new prop-layer content.
    deps.rebuildProps();
    notifyStamp();
    deps.notifyEntities();
  };

  // --- reconfigure (open a committed entity → apply) ----------------------

  // Open a reconfigure session on a committed entity. Every refusal is
  // runtime-quiet (report + no session): the ids come from a panel list that
  // can lag the log, and the flags are exactly what the user is asking about.
  //
  // `moving` flags the session as a MOVE (see StampSession.moving). It is a
  // property of the session being built, not a branch — every refusal, the
  // ghost, and the terminal verb are identical either way, which is the whole
  // point of a move being a reconfigure. Returns whether a session opened, so
  // the move path knows whether to arm its cursor mapping.
  const openEntitySession = (entityId: number, moving: boolean): boolean => {
    const record = deps.entityRecord(entityId);
    if (record === null) {
      deps.reportToolError(`entity ${entityId} is no longer in the log`);
      return false;
    }
    // ONE rule, shared with the row's Open button (field-entity.ts): a state
    // the UI disables for and a state the host refuses can never drift apart.
    const blocked = openBlockedReason(record);
    if (blocked !== null) {
      deps.reportToolError(`entity ${entityId} is ${blocked}`);
      return false;
    }
    try {
      field.generatorById(record.generator); // setup-loud on a retired id
    } catch (err) {
      // Fail HERE rather than opening a session whose every preview errors and
      // whose Apply can never land (startStamp's precedent).
      const message = err instanceof Error ? err.message : String(err);
      deps.reportToolError(message);
      return false;
    }
    cancelStampSession(); // a live session (+ ghost) never survives a re-open
    // …and neither does a pending stamp arm: opening a session answers the region
    // question the arm was asking, and leaving it set would put the next click on
    // a region-draw for a stamp nobody is looking at any more.
    setPendingStamp(null);
    stampGen++;
    suspendReported = false; // one suspension sentence per session
    stampTouched = new Set(); // a new session has heard nothing yet
    const opened = startReconfigureSession({
      entityId,
      generator: record.generator,
      // Clone at the boundary: the session must never alias the log's record.
      params: structuredClone(record.params),
      seed: record.seed,
      region: structuredClone(record.region),
      // Not provenance — see the openEntity contract.
      policy: "replace",
    });
    // Set BEFORE previewStamp, which is what pushes the session to subscribers:
    // flagging it afterwards would publish one frame of "reconfigure" ahead of
    // the move, and the strip would flicker the wrong word.
    setStamp(moving ? { ...opened, moving: true } : opened);
    previewStamp();
    return true;
  };

  // --- the move -----------------------------------------------------------

  // Whatever ends the session ends the move with it. A `moveDrag` that outlived
  // its session would map the next cursor motion onto nothing — and, once
  // another session opened, onto the wrong thing entirely.
  const endMove = (): void => {
    moveDrag = null;
    setPendingMove(null);
    moveCommitPending = false;
    syncSessionCapture();
  };

  // Start a move on a committed entity: the reconfigure session, plus the cursor
  // mapping that will drive its region. Returns whether it started (every
  // refusal is openEntitySession's, already reported).
  const beginMoveSession = (
    entityId: number,
    axis: Axis | null,
    grabbed: boolean,
    press: { x: number; y: number } | null,
  ): boolean => {
    if (!openEntitySession(entityId, true)) return false;
    // AFTER the open because of the `?? stamp?.region` fallback, which needs the
    // session set. The memo itself is unmoved — its signature is
    // worldEpoch/ops/undo/redo/nextId and opening a session touches none of them
    // — so this is the same map either way; only the fallback needs the ordering.
    const box = deps.entityFootprints().get(entityId) ?? stamp?.region;
    if (box === undefined) return false; // unreachable: the open proved the record
    moveDrag = startMove({ box, axis, grabbed, press });
    // Already captured in practice — the open above set the session — but this is
    // a null→non-null write to a slot the entry's liveness reads, and the rule
    // that every such write reconciles is what keeps the pair honest.
    syncSessionCapture();
    // The gizmo's arms narrow to the constrained one the moment a drag owns them.
    deps.rebuildEntitySelectionBatch();
    return true;
  };

  // One cursor event's worth of move: re-read the mapping, turn the offset from
  // the anchor into whole lattice steps, and hand the DIFFERENCE to the same
  // region nudge the arrow keys drive. An imperative shell — the two `cursorRay`
  // calls and the session are the only things here that need the world;
  // `field-move.ts` owns every rule, and returns a fresh drag rather than
  // writing to this one.
  //
  // No clamp on how far a region may travel, deliberately. The field has no
  // world bounds to clamp against (chunks allocate on demand), so any limit
  // would be an invented number; the arrow-key nudge this shares a seam with has
  // none either, and a move that disagreed with the d-pad about where a region
  // may go would be a second rule for one concept. What bounds it in practice is
  // the mapping itself — a region can only go where the cursor ray can reach —
  // and the ghost shows exactly where it will land before the drop.
  const updateMove = (e: {
    clientX: number;
    clientY: number;
    shiftKey?: boolean;
  }): void => {
    let d = moveDrag;
    if (d === null || stamp === null) return;
    const mapping = resolveMapping(d, e.shiftKey === true);
    if (d.anchorPoint === null || mapping !== d.mapping) {
      // (Re-)anchor. The FIRST anchor of a drag is taken at the PRESS, not here:
      // the move opens on the event that crosses the threshold, and anchoring
      // there would throw away the travel that opened it.
      const from =
        d.anchorPoint === null && d.press !== null
          ? d.press
          : { x: e.clientX, y: e.clientY };
      const anchorRay = deps.cursorRay(from.x, from.y);
      if (anchorRay === null) return;
      const at = movePoint(d, mapping, {
        origin: anchorRay.origin,
        dir: anchorRay.dir,
      });
      if (at === null) return;
      d = reanchored(d, mapping, at);
      moveDrag = d;
      // A gizmo drag cannot change mapping, so this only fires for ⇧ — and the
      // drawn arms follow the constraint the ghost is now under.
      if (!d.fixedAxis) deps.rebuildEntitySelectionBatch();
    }
    const ray = deps.cursorRay(e.clientX, e.clientY);
    if (ray === null) return;
    const point = movePoint(d, mapping, { origin: ray.origin, dir: ray.dir });
    if (point === null) return;
    const { drag, step } = advanceMove(d, point);
    moveDrag = drag;
    if (step[0] === 0 && step[1] === 0 && step[2] === 0) return;
    nudgeStampRegion(step);
  };

  // A camera change mid-move retires the anchor: it was a world point read under
  // the old view, and the press pixel that produced it now means somewhere else,
  // so the next reading would jump by metres nobody dragged. Re-anchoring carries
  // `applied` forward, so turning the view moves the region by exactly zero —
  // the same mechanism ⇧ re-anchors through.
  const reaimMove = (): void => {
    if (moveDrag !== null) moveDrag = unanchored(moveDrag);
  };

  // A session still flagged `moving` with NO mapping driving it is a
  // contradiction: nothing is following the cursor, yet the session card renders
  // the word off this flag. Demoted rather than cancelled, because the one state
  // that reaches it is an ERRORED preview and its message is the only legible
  // reason the drop did not land — cancelling would take the explanation with it.
  //
  // Gated on `moveDrag === null` because a preview can also fail MID-drag, and
  // that move is still live: the next cursor tick re-previews and may well
  // succeed. Only a move that has already ended can be stalled.
  const demoteStalledMove = (s: StampSession): StampSession =>
    moveDrag === null && s.moving === true ? withoutMoving(s) : s;

  // The drop's zero-step question, asked of the REGION rather than of the drag:
  // does the live session place the entity anywhere other than where its record
  // already has it? `sameRegion` carries why this is not `moveIsIdle(d)` any more.
  //
  // No session, or no record to compare against (the entity left the log under a
  // history step), both answer "nothing" — there is no move left to land, and a
  // commit would either no-op or fail loudly against an entity that is gone.
  const moveChangedNothing = (): boolean => {
    const s = stamp;
    if (s === null || s.entityId === null) return true;
    const record = deps.entityRecord(s.entityId);
    if (record === null) return true;
    return sameRegion(s.region, record.region);
  };

  // End a move by DROPPING it — a mouse-up on a drag, LMB on a grab.
  const dropMove = (): void => {
    const d = moveDrag;
    endMove();
    if (d === null) return;
    if (moveChangedNothing()) {
      // The region is exactly where the record already has it — a drag whose
      // travel rounded to no lattice step, a grab dropped where it started, or a
      // move nudged out and back again. A reconfigure would still re-splice the
      // span with fresh op ids and still spend an undo entry, so committing here
      // would put a no-op on the history stack for every twitchy click. End the
      // session instead.
      cancelStampSession();
      return;
    }
    if (stamp?.phase === "ready") {
      commitActiveSession();
      return;
    }
    if (stamp?.phase === "previewing") {
      // The ghost is still cooking — latch the drop so the settle spends it
      // (see moveCommitPending).
      moveCommitPending = true;
      return;
    }
    // Neither ready nor previewing: the preview had ALREADY errored when the
    // drop arrived. The session stays standing with its message, demoted.
    if (stamp !== null && stamp.moving === true) {
      setStamp(demoteStalledMove(stamp));
      notifyStamp();
    }
  };

  // Abandon a move without committing it — the shared teardown behind
  // `pointercancel` and focus loss. Cancels the SESSION too (its ghost is a
  // promise about a drop that is not going to happen); a session that is not a
  // move is left alone.
  const cancelMoveInFlight = (): void => {
    if (moveDrag === null && pendingMove === null) return;
    endMove();
    if (stamp?.moving === true) cancelStampSession();
  };

  // Apply the live reconfigure session: ONE undo entry, the entity id and every
  // reference to it preserved. Unlike commitStampSession this does NOT re-run
  // the ghost's evaluate against the ghost's inputs — core rewinds the affected
  // chunks to their pre-span state first, which is what makes the result
  // independent of what the ghost previewed against (the openEntity limit).
  const applyReconfigureSession = (): void => {
    const s = stamp;
    if (s === null || s.mode !== "reconfigure" || s.entityId === null) return;
    if (s.phase !== "ready") return;
    if (reportEmptyPreview(s)) return;
    // The try wraps the core call and NOTHING else — the catch's claim (the
    // store and the log are untouched) is true of `reconfigureGenerator`
    // validating before its first write, and of nothing below it. Anything
    // further inside would report "reconfigure failed" for a reconfigure that
    // LANDED, and skip the session teardown on the way out. The three notifies
    // below can no longer be the ones that provoke it — the channels isolate a
    // throwing subscriber, which is what made notifyDrift the sharpest case for
    // this narrowing before F-T3a — but everything between here and them still
    // can. Same shape as commitStampSession's try, deliberately.
    let result: ReturnType<typeof field.reconfigureGenerator>;
    // Bracket JUST the core call for the op-cost meter's `last reconfigure` —
    // the same narrowing the try keeps (start read before, duration read after,
    // neither inside the try). A rejected apply returns before the read, so it
    // never overwrites the last landed duration.
    const reconfigureStart = performance.now();
    try {
      result = field.reconfigureGenerator(
        substrate.store,
        substrate.log,
        s.entityId,
        {
          params: s.params, // reconfigureGenerator clones for provenance
          seed: s.seed,
          region: s.region,
          policy: s.policy,
        },
        substrate.table(),
      );
    } catch (err) {
      // Core validates before its first write, so a rejection here left the
      // store and the log untouched — the session stays open to retry or
      // cancel (commitStampSession's stance).
      const message = err instanceof Error ? err.message : String(err);
      deps.reportToolError(`reconfigure failed: ${message}`);
      return;
    }
    deps.noteReconfigureMs(performance.now() - reconfigureStart);
    deps.markDirtyWithNeighbors(result.dirty);
    // The region is an editable field of this session (the nudge cluster), so
    // the footprint box this entity may be wearing can be stale as of now.
    deps.revalidateEntitySelection();
    // A clean apply CLEARS the previous report: leaving it up would attribute
    // stale findings to the edit the user just made.
    deps.setDrift(result.drift.length === 0 ? null : result.drift);
    setStamp(null);
    // The session this move rode has landed, so the mapping goes with it — the
    // cancel path's rule, from the other side.
    endMove();
    destroyStampGhosts();
    // A re-cooked scatter replaces its own placement op's records, and any
    // reconfigure re-splices the log the prop layer is derived from.
    deps.rebuildProps();
    // The three notifications LAST, once every piece of host state the apply
    // moved has settled: a subscriber may read the host back synchronously from
    // inside any of them (the chrome does — subscribeEntities' callback calls
    // listEntities), so none may observe a half-applied session.
    //
    // The ORDER is about that read-back and nothing else now. It used to be
    // about blast radius too — the seams held one callback each and nothing
    // wrapped the call, so a subscriber that threw aborted the notifications
    // after it, and drift went last because a dropped report costs least. The
    // channels isolate delivery per subscriber (`view-channel.ts`), so a throw
    // is logged and the pass continues: what bounds a buggy subscriber is the
    // isolation, not this ordering. The order stands because the three describe
    // one settled state and a subscriber reading the host back mid-sequence
    // must not see a half-applied session.
    notifyStamp();
    deps.notifyEntities();
    deps.notifyDrift();
  };

  // Enter's ONE commit path: the session's mode picks the verb. Both are
  // ready-phase-only, so a configuring/previewing session swallows the key.
  // Private — the only way in from outside is `confirmSession`, which reaches
  // here after `dropMove` has had its say (T3c deleted the public `commitSession`
  // that used to bypass that).
  const commitActiveSession = (): void => {
    if (stamp === null) return;
    if (stamp.mode === "reconfigure") applyReconfigureSession();
    else commitStampSession();
  };

  // What ⏎ MEANS, for both keys that spell it: the canvas's own binding and the
  // app-level `confirmSession`. A live MOVE is DROPPED rather than applied —
  // `dropMove` carries the zero-step rule (a grab dropped where it started spends
  // no history entry) and the pending-preview latch, neither of which
  // `commitActiveSession` knows about.
  //
  // This is now the ONLY way in from outside. T3c deleted the public
  // `commitSession` — a second "end by mode" verb that deliberately did NOT route
  // through here — after finding it had zero production callers: the panel's
  // Commit/Apply button already called `confirmSession`, because it wears the ⏎
  // keycap and must mean what the key means. The reason the pair was kept apart
  // (so a filed defect in one could not silently change the other) evaporated
  // with the defect: `dropMove`'s idle test now reads the REGION, not the cursor,
  // so an arrow-nudged grab lands here exactly like a dragged one.
  const confirmActiveSession = (): void => {
    if (moveDrag !== null) {
      dropMove();
      return;
    }
    commitActiveSession();
  };

  // --- arming -------------------------------------------------------------

  const setGesture = (next: ViewportGesture | null): void => {
    // ABOVE the early return, deliberately: arming any tool cancels a pending
    // stamp, and the arm that would otherwise leak is the BRUSH's — `armBrush`
    // pushes `setGesture(null)` while the host already holds `null`, so a clear
    // below this line would never run and the stamp would stay armed under a
    // brush the user had just picked.
    setPendingStamp(null);
    if (next === gesture) return; // re-arming the same gesture must not drop a pending anchor
    gesture = next;
    // Nor does a move in flight. A move is a `pointer`-tool mode, and arming
    // anything else means LMB now digs or selects cells — a ghost still
    // chasing the cursor under that would promise a drop no button is going to
    // make. The blur that follows a rail click cancels it too; this covers the
    // programmatic path and anything that arms a tool without taking focus.
    cancelMoveInFlight();
    // Neither pending anchor survives a gesture change — including
    // box→segment, where a carried-over point would read as a segment start
    // the user never clicked.
    deps.setBoxAnchor(null);
    deps.setSegmentAnchor(null);
  };

  // Is LMB's field-writing job suspended by a live session (D-F4.5-7's staged
  // grammar)? A session is a ghost being fitted to the rock around it, and a
  // stroke would carve the very thing it is being fitted to — while the
  // registry's `armsTool` gate has already stopped the user changing tools out
  // of it, so a live brush here is one the session INHERITED rather than one
  // they chose. The ghost hides for the same reason (see compose).
  //
  // TWO callers, both in `pointerDown` below, because the two brushes reach the
  // store through different branches: the sphere brush's stroke, and `segment`'s
  // capsule commit from the gesture branch above it. Selection gestures are
  // deliberately NOT suspended — they write nothing to the store.
  //
  // It SPEAKS, once per session (the `maskDropReported` latch shape). Every
  // other signal is ambient — the strip's clause, the hidden ghost, the rail's
  // refusals — and none of them fires at the moment the user asks the question,
  // which is the click. A silent swallow at exactly that moment reads as a
  // broken editor; the per-session latch is what stops it becoming noise.
  const suspendedByStamp = (): boolean => {
    if (stamp === null) return false;
    if (!suspendReported) {
      suspendReported = true;
      deps.reportToolError(
        "the brush is suspended while a session is live — ⏎ applies it, Esc discards it",
      );
    }
    return true;
  };

  // --- the pointer chain ---------------------------------------------------
  //
  // WHO GETS THIS PRESS. The four pointer listeners' bodies, moved out of
  // `createFieldHost` in foundations T3c — pointerdown's seven-way arbitration,
  // pointermove's six-way, and the pair that end a gesture. The host still
  // ATTACHES them (the canvas element is its, and so is `attachListeners`'
  // headless guard) and still records the cursor position on the way past — as
  // `targeting.notePointer(…)` since T3d, when the binding it was writing left
  // for `field-targeting.ts` with the five functions it is the cached argument
  // of. The handlers did not move a line; it no longer decides anything.
  //
  // THE MACHINE ARBITRATES, THE TOOLS ACT — the rule that drew the boundary and
  // the one to read these four functions by. MOST of what the chains below TEST
  // is state this module owns (a live move, a pending stamp arm, the armed
  // gesture, a stroke in progress), and that majority is why the chains are here
  // rather than split in two; every branch's VERB belongs to some other cluster,
  // and that is why the verbs arrive in {@link MachineDeps} rather than moving.
  // TWO of the chain's verbs still live in the host — the pointer-capture pair —
  // and the segment brush's three in `field-segment.ts`, exactly as they did. TEN
  // have since left the host on their own account and changed nothing here:
  // `pointerPress` is `field-picking.ts`'s `press`; `eyedropper`, `applyTool` and
  // `armMaskDropReport` are `field-tool.ts`'s; `beginLook`, `lookDrag` and
  // `endLook` are `field-camera-rig.ts`'s (those six on 2026-08-08); and
  // `selectionClick`, `boxCorner` and `updateBoxPreview` are `field-selection.ts`'s
  // as of T3d Task 5. **The claim this paragraph has been making since T3c is now
  // measured across three tasks: ten of the seventeen verbs changed FILE and not
  // one line of this module changed with them.** `selectionClick` is the one that
  // used to be read carefully here because it had STAYED while reaching into
  // `field-targeting.ts` for its seed voxels; it has since become that module's
  // neighbour, and the point it illustrated survives the move intact — a verb
  // arrives as a dep whichever file it ends up in, and that is why these are taken
  // as verbs rather than as locations.
  //
  // THREE TESTS ARE NOT THIS MODULE'S, and they are named here rather than left
  // for a reader to trip over, because the rule stated as an absolute would send
  // them away: `pointerMove` branches on `deps.looking()`, `deps.boxAnchor()` and
  // `deps.segmentAnchor()` — a live look drag, a pending box corner and a pending
  // segment point, each state a branch TESTS but an overlay somewhere else OWNS.
  // They arrive as LIVENESS reads for exactly that reason: this module asks and
  // never holds, and the overlay stays with the cluster that draws it. Read the
  // rule as "a branch that tests state you do not own is not yours" and
  // `pointerMove`'s FIRST branch goes back to the host, which splits one
  // arbitration across two modules — the thing this move exists to end. The
  // criterion is where most of what a chain decides on LIVES; the rest it asks
  // about.
  //
  // `pointerPress` is the one worth naming, because at a glance it should have
  // come too: it arms {@link PendingMovePress} and starts gizmo moves, both this
  // module's state. It did not, and the argument is made in full at the top of
  // `field-picking.ts` — which is where the function itself went at T3d, as that
  // module's one seam member. Not restated here: two copies of one argument is
  // how the stale one survives, and this header only needs the conclusion.
  // Whichever file it sits in, it reaches this module through the public verbs
  // like any other, and it is a verb rather than an arbitration this module could
  // hold because none of its three tests is this module's state.
  //
  // BRANCH ORDER IS THE CONTRACT, not an implementation detail: it is what "a
  // pending stamp SHADOWS the armed gesture" and "RMB stays live under
  // everything" actually mean, and it is pinned end-to-end by the pointer / move
  // / stamp-entry / selection-cells GPU suites — swapping two adjacent branches
  // reddens a NAMED test (re-verified by sabotage at the T3c gate). A branch that
  // moves has to be a decision someone made.

  const pointerDown = (e: PointerEvent): void => {
    // A live GRAB (`G`, no button held) owns LMB: the button DROPS the move
    // rather than picking whatever is under the cursor at the end of it. RMB
    // falls through to look, so a grab can be re-aimed mid-move — the one thing
    // a free-hand move genuinely needs the camera for.
    const drag = moveDrag;
    if (drag !== null && !drag.grabbed && e.button === 0) {
      dropMove();
      return;
    }
    if (e.button === 0 && e.altKey) {
      // Alt-click samples a material — never strokes, so it stays live in
      // selection mode too (a brush affordance the gestures don't collide with).
      deps.eyedropper(e.clientX, e.clientY);
      return;
    }
    // A pending stamp SHADOWS the armed gesture: while one stands LMB is drawing
    // its region, whatever the button did before (D-F4.5-7). Before the gesture
    // branch and after the eyedropper, which samples rather than commits and
    // stays live under every arm.
    if (e.button === 0 && pendingStamp !== null) {
      stampRegionClick(e.clientX, e.clientY);
      return;
    }
    // ONE reading of the armed slot, which all four branches below then decide
    // on. A local rather than four reads of a mutable field — its shape from when
    // the slot was a call away (`machine.gesture()`), kept deliberately now that
    // it is a field: nothing on this path re-arms mid-press today, and a press
    // whose branch changed under it would read like a hardware fault.
    const armed = gesture;
    if (e.button === 0 && armed !== null) {
      // Armed gestures BYPASS applyTool entirely: no stroke, no digging flag.
      // RMB look below stays live under every gesture. `pointer` is the DEFAULT
      // one, so this branch — not the stroke below — is what a fresh host does
      // with its first click.
      //
      // `pointer` is also the ONE gesture that can drag, and therefore the one
      // that takes pointer capture: a press on a gizmo handle, or on the already
      // selected entity, can become an entity MOVE (pointerPress owns that
      // arbitration, and takes the capture inside it — the one capture site the
      // chain does not hold, for the reason the header gives).
      if (armed === "pointer") deps.pointerPress(e);
      else if (armed === "segment") {
        // `segment` is a BRUSH that happens to be armed as a gesture, so the
        // suspension below applies to it too — its second click commits a
        // capsule op through `commitToolOp`, which is the "user dug a large
        // tunnel while believing they were interacting with the stamp" report
        // verbatim (F3b gate item 2). It needs its own guard because it reaches
        // the store through THIS branch, above the stroke's.
        if (suspendedByStamp()) return;
        deps.segmentClick(e.clientX, e.clientY);
      } else deps.selectionClick(armed, e.clientX, e.clientY);
      return;
    }
    if (e.button === 0) {
      if (suspendedByStamp()) return;
      digging = true;
      deps.armMaskDropReport(); // re-arm the once-per-stroke mask-drop report
      deps.applyTool(e.clientX, e.clientY);
      deps.capturePointer(e.pointerId);
    } else if (e.button === 2) {
      deps.beginLook(e.clientX, e.clientY);
      deps.capturePointer(e.pointerId);
    }
  };

  const pointerMove = (e: PointerEvent): void => {
    // The camera has the pointer. FIRST, and the branch after it says why: RMB
    // look stays live under a grab, so the two can be running at once and the
    // drag that owns the CAMERA has to be served before the one that owns the
    // cursor.
    if (deps.looking()) {
      deps.lookDrag(e.clientX, e.clientY);
      return;
    }
    // A live move owns the cursor — after `look`, so RMB can still re-aim the
    // camera during a grab without the ghost chasing the same motion.
    if (moveDrag !== null) {
      updateMove(e);
      return;
    }
    // A press on the selected entity becomes a MOVE once the cursor has actually
    // travelled. The threshold is measured from the PRESS, not accumulated, so a
    // slow drift back and forth never adds its way over the line.
    const p = pendingMove;
    if (p !== null) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD_PX)
        return;
      setPendingMove(null);
      if (beginMoveSession(p.entityId, null, true, { x: p.x, y: p.y })) {
        // The PRESS's pointer, not this event's — which is why
        // {@link PendingMovePress} carries the id at all. The capture belongs to
        // the button that is still down, and that is the one the press recorded.
        deps.capturePointer(p.pointerId);
        // Anchors at the PRESS (not here) and applies this event's offset from
        // it in the same call, so the travel that crossed the threshold counts.
        updateMove(e);
      }
      return;
    }
    // Box live preview: while a corner is pending, keep the amber region the
    // second click would close updated as the cursor moves. Both users of the
    // corner machinery, since a pending stamp draws its region the same way.
    if (
      deps.boxAnchor() !== null &&
      (gesture === "box" || pendingStamp !== null)
    ) {
      deps.updateBoxPreview(e.clientX, e.clientY);
      return;
    }
    // Segment brush: same shape, with the capsule the second click would sweep.
    if (gesture === "segment" && deps.segmentAnchor() !== null) {
      deps.segmentUpdatePreview(e.clientX, e.clientY);
      return;
    }
    if (!digging) return;
    const now = performance.now();
    if (now - lastStroke < deps.strokeMinMs) return;
    lastStroke = now;
    deps.applyTool(e.clientX, e.clientY);
  };

  const pointerUp = (e: PointerEvent): void => {
    // Only the button that STARTED a drag ends it. Gated on button 0 because RMB
    // look is live during a move (a grab can be re-aimed), and a right-button
    // release must not commit a splice the user is still positioning.
    if (e.button === 0) {
      if (moveDrag?.grabbed === true) dropMove();
      // A press that never crossed the threshold: it was a click on what was
      // already selected, which has always been a no-op. Nothing to undo.
      setPendingMove(null);
    }
    digging = false;
    deps.endLook();
    deps.releasePointer(e.pointerId);
  };

  // `pointercancel` is NOT a quiet pointerup: the system voided the gesture (a
  // touch turned into a scroll, a device was lost), so a move in flight is
  // DISCARDED rather than dropped. Committing a splice from a gesture the
  // platform just cancelled would write history the user never asked for.
  const pointerCancel = (e: PointerEvent): void => {
    cancelMoveInFlight();
    pointerUp(e);
  };

  return {
    session: () => stamp,
    gesture: () => gesture,
    pendingStamp: () => pendingStamp,
    moveDrag: () => moveDrag,
    placementGhost: () => placementGhost,

    setGesture,
    setPendingStamp,
    setPendingMove,

    startStamp,
    updateStamp: updateStampSession,
    nudgeStamp: nudgeStampRegion,
    rotateStamp: rotateStampSession,
    rerollStamp: rerollStampSession,
    commitStamp: commitStampSession,
    confirmSession: confirmActiveSession,
    cancelSession: cancelStampSession,
    openEntity: (entityId) => {
      openEntitySession(entityId, false);
    },
    applyReconfigure: applyReconfigureSession,

    beginMove: beginMoveSession,
    reaimMove,
    cancelMoveInFlight,

    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,

    destroyGhosts: destroyStampGhosts,

    // The initial push is the channel's snapshot (the subscribeSelection remount
    // rationale): a panel arriving mid-session must not read blank beside a ghost
    // the viewport is plainly drawing.
    subscribeStamp: (cb) => stampChannel.subscribe(cb),
    subscribePendingStamp: (cb) => pendingStampChannel.subscribe(cb),
  };
}
