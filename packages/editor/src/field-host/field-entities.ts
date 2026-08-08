// The SELECTED entity: which one it is, the footprint box that emphasises it,
// the translate gizmo that hangs on that box, the memo every pick reads, and the
// entity-list tick nine host paths funnel through. The NINETEENTH cluster lifted
// out of `createFieldHost` (foundations T3d Task 5), and the second half of a
// task the plan paired.
//
// IT LEFT AS ITS OWN MODULE, SEPARATELY FROM `selection`, and the evidence is
// stated once next door in `field-selection.ts`'s header rather than twice. The
// short version: the plan's premise was that the two clusters "write each other's
// capture rungs"; they do not — every rung rides `createRung` (`input-router.ts`)
// and names only its own cluster's state — and the measured coupling between the
// two rows is ONE directed call at ONE site, `rebuildEntitySelectionBatch`
// reaching `selectedBoxOutline`. That call is {@link EntitiesDeps.selectionOutline}
// here, taken by the name `field-analyzer.ts` already uses for the same act, and
// it is the ONLY thing this module takes from that one. Zero data edges either
// way, and nothing over there calls in here at all.
//
// THIS MODULE IS WHY THE ASSEMBLY ORDER IS TIGHT, and both bounds are worth
// naming because they were nearly incompatible. From ABOVE: `createHistoryFeed`
// (the entity tick carries the history push) and `createSelection` (the outline).
// From BELOW: `createCameraRig` takes {@link Entities.footprints} as a PLAIN REF,
// so this line may not sink past it — a Task-5 migration marker sat
// on that record for two tasks saying exactly that, and the two thunks beside it
// would have followed. `createDrift` is the third: `driftedEntities` derives its
// badges from the footprint memo and takes the same plain ref. So the window is
// `createHistoryFeed` … `createDrift`, and the assembly sits at the top of it,
// where `notifyEntities` was.
//
// THE SEAM IS 19 VERBS OVER A 15-FUNCTION ROW since foundations T3d Task 6, and
// the five it gained are the five this file's Task-5 header said were staying.
// They are `setFrozen`, `bake`, `remove`, `duplicate` and `list` — the bodies of
// `FieldHost`'s `setEntityFrozen`, `bakeEntity`, `deleteEntity`,
// `duplicateEntity` and `listEntities`, which lived in the facade's return
// literal and now delegate into this file in three lines each.
//
// THAT WAS A DEFERRAL AND IT WAS RE-DECIDED, NOT INHERITED. Task 5 wrote a
// migration marker on the stay, naming four blockers:
// `markDirtyWithNeighbors` and `table()` "go with `world` and `catalogs`", and
// `props.rebuild()` / `machine.cancelSession()` "are already module verbs". All
// four dissolved at Task 6 — `markDirtyWithNeighbors` is `field-world.ts`'s and
// `table()` has ridden the substrate since T3a — so the argument for the stay
// expired with them and the question became whether the move is right on its own
// terms. It is, and the ARITHMETIC IS NOT THE REASON:
//
//   - The T3 exit bar's mechanism is "no cluster state and no cluster FUNCTIONS
//     left in the closure". Five facade members whose bodies are business logic
//     over the op log ARE cluster functions; they were living in the facade
//     rather than in it by right. Every other facade member had already become a
//     delegate — all thirteen `subscribe*` seams, the four pointer handlers, the
//     key listeners, `frameSelection`/`frameWorld`/`snapView`.
//   - The test that separates them from `stepHistory`, which IS permanently
//     facade-resident, is CALLER COUNT: each of these five has exactly ONE caller
//     — its own facade member — while `stepHistory` has three, one of them
//     `onKeyDown`'s ⌘Z branch, a listener that owns the canvas element and cannot
//     move. A verb with one caller and no state of its own is not cross-cutting;
//     it is misplaced.
//   - On lines it bought 96 code lines off `field-host.ts` for 15 of delegate,
//     and the tranche record states plainly that the bar was met at ~993 WITHOUT
//     this move. It was taken on the merits and the margin was the tiebreak, not
//     the argument.
//
// §2.1's fourth correction was the frame for the old reading — a cluster's work
// living in another cluster's function — and this move is that correction acted
// on rather than merely recorded. Only TWO of the fifteen functions are private
// (`activeGizmoAxis`, `syncSelectedEntityCapture`), which remains the inverse of
// `field-selection.ts`'s split.
//
// THE PRICE IS `EntitiesDeps` GOING 9 → 14, and it is worth saying what that
// bought because a 14-member record needs the same justification
// `field-render.ts`' 29 got. Four of the five new members are verbs the bodies
// already drove (`markDirtyWithNeighbors`, `rebuildProps`, `cancelSession`,
// `reportToolError`) and the fifth is a pure function (`randomSeed`). The
// alternative was five bodies in the facade reaching into four modules AND this
// one — the same coupling, spelled in a place that cannot type-check it. TWO of
// the five are FORWARD arrows (`markDirtyWithNeighbors` reaches `field-world.ts`
// 1,192 lines below this assembly, `cancelSession` reaches `field-machine.ts`
// 472 below), which is the file's standard mechanism and is safe for the reason
// the `createVoidCast` assembly states in full.
//
// `randomSeed` IS PASSED THROUGH THE HOST, NOT IMPORTED. `randomStampSeed` is a
// module-scope `const` in `field-machine.ts` and `duplicate` needs it for the
// fresh roll. Importing it here would create a module→module VALUE edge between
// two extracted host clusters that the closure map has no edge type for; the host
// is the wiring point by design, and it already imports the function. It is not a
// host `let`, so THE LAW is not engaged and a plain ref is correct.
//
// THE TWO PRIVATE ONES ARE THE INTERESTING ONES. `activeGizmoAxis` has a single
// caller — `rebuildEntitySelectionBatch`, one line below where it was — and
// `syncSelectedEntityCapture` is a rung, called only by the setter it reconciles.
// Everything else has a caller in another file.
//
// THE GIZMO'S VISIBILITY PREDICATE IS ONE FUNCTION FOR TWO QUESTIONS, and that is
// load-bearing rather than tidy: {@link Entities.gizmoVisible} decides both what
// `field-render.ts` draws and what {@link Entities.gizmoAxisAt} will hit-test, so
// a handle can never be grabbable while invisible or visible while inert. It also
// settles `createRender`'s second lower bound — the last of that record's
// twenty-nine deps that was a plain ref to a host `const` arrow, the first having
// been `cameraEye` at Task 4. Its three machine reads arrive as thunks and the
// SHORT-CIRCUIT ORDER of the four-term expression is preserved verbatim: the
// session and the move drag are not asked at all under a brush.
//
// `AXIS_COLOR` CAME WITH IT. The semantic axis palette had exactly one reader in
// the closure — the batch build below — and travelled by the same rule the six
// material constants and eight frame constants followed at Task 3: a constant
// whose readers are all inside one cluster goes with that cluster. The three that
// stayed in `field-host.ts` did so because they have readers in two or three
// DIFFERENT modules; `field-selection.ts`'s header carries that argument.
//
// NO UNIT TEST, by the house pattern eleven extractions old — the argument is
// `tests/field-host/field-machine.test.ts`'s header and is not re-made here. The
// host suites passing UNMODIFIED are this module's contract, and unlike its
// `selection` neighbour this cluster is broadly driven: EIGHTEEN test files reach
// this seam, of which ten reach a real host. `field-host-entity-verbs.test.ts`
// (the five facade verbs and their undo shape), `field-host-move.gpu.test.ts` +
// `field-host-move.test.ts` (the gizmo pick, the constrained drag, the session),
// `field-host-pointer.gpu.test.ts` (the click that selects, and the world-swap
// memo invalidation by NAME), `field-host-camera.test.ts` / `.gpu.test.ts`
// (framing the selected entity), `field-host-history.test.ts` and
// `field-stamp.test.ts` (the tick's history push) are the load-bearing ones, and
// `tests/field-host/gizmo.test.ts` pins the geometry underneath without a host at
// all. There is no `field-host-entities.test.ts`; the verbs' suite is
// `field-host-entity-verbs.test.ts`.
//
// **AND IT IS PINNED, WHICH IS MEASURED AND NOT THE SAME SENTENCE AS THE ONE
// ABOVE.** Five sabotage probes on this side, each against the full 2,912-test
// suite:
//   - dropping `entitySelectionChannel.publish(next)` from the setter reddens
//     **19 tests across 5 files** (`field-host-pointer.gpu` 8,
//     `field-host-escape.gpu` 4, `field-host-move.gpu` 4,
//     `field-host-entity-verbs` 2, `field-host-camera.gpu` 1);
//   - dropping `syncSelectedEntityCapture()` from it reddens **7 across 3**
//     (`field-host-escape.gpu` 4, `field-host-camera.gpu` 2,
//     `field-host-move.gpu` 1);
//   - dropping the `worldEpoch` TERM from the footprint signature reddens
//     **1**, and it is the test named for exactly this — "a world swap
//     invalidates the footprint memo, even when the two logs SIGN identically"
//     (`field-host-pointer.gpu.test.ts`). The memo comment below calls that
//     exposure "not hypothetical"; a test agrees with it by name.
//   - VALUE-SNAPSHOTTING `worldEpoch` at construction reddens **260 tests across
//     24 files** — and the mechanism is worth stating precisely, because it is not
//     the staleness the thunk is usually justified by. **Re-derived at T3d Task
//     6, which moved the binding:** `worldEpoch` is no longer in `field-host.ts`
//     at all — it is `field-world.ts`'s private state, reached through
//     `() => world.epoch()`, and `createWorld` is assembled 1,192 lines BELOW
//     `createEntities`. So the TDZ binding is now `world` rather than the counter,
//     the mechanism is unchanged, and an eager read is still a `ReferenceError`
//     that constructs no host at all. THE LAW has two independent teeth here and
//     only one of them is subtle.
//   - dropping the live-move term from {@link Entities.gizmoVisible} is
//     **2912/0** — the only green probe on this side. `field-host-move.gpu`'s "the
//     gizmo is unpickable with no selection, with a brush armed, and under a
//     FOREIGN session" covers the session term, and nothing covers the exception
//     the move drag makes to it.
import * as field from "@furnace/core/field";
import { latticeClearance } from "../shared/field-brush.ts";
import { generatorFootprint } from "./field-ghost.ts";
import type { FieldEntityInfo, ViewportGesture } from "./field-host.ts";
import type { MoveDrag } from "./field-move.ts";
import { placementsByEntity } from "./field-placements.ts";
import type { StampSession } from "./field-stamp.ts";
import type { CursorRay } from "./field-targeting.ts";
import {
  type Axis,
  axisLines,
  type GizmoSpan,
  gizmoSpan,
  pickAxis,
} from "./gizmo.ts";
import { createRung, type InputRouter } from "./input-router.ts";
import type { HostSubstrate } from "./substrate.ts";
import { createViewChannel } from "./view-channel.ts";

type Vec3T = [number, number, number];
type Box = { min: Vec3T; max: Vec3T };

/** A prebuilt drawLines batch (vertices + per-vertex colors). */
type LineBatch = { vertices: Float32Array; colors: Float32Array };

// Semantic axis colours — X red, Y green, Z blue. The SAME palette the chrome's
// AxisTriad draws (its own comment already promises they match this gizmo),
// converted from those CSS hexes to LINEAR sRGB by the sRGB EOTF
// (`c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`). The conversion is the
// whole point: shaders write LINEAR and the swap chain applies the sRGB encoding
// on output (engine-conventions §Color space), so shipping the 0-1 hex directly
// would be double-encoded and the arms would render as pale pastels — "red"
// around rgb(243,145,148). `SELECTED_COLOR` in `field-host.ts` is converted the
// same way.
//
// No test can catch this: the GPU fixtures request `surfaceFormat: "linear"`, so
// the encode this compensates for never runs there. It is arithmetic plus review,
// like `SELECTED_COLOR`, and the hexes are kept in the trailing comments so
// the conversion stays checkable.
const AXIS_COLOR: Record<Axis, [number, number, number, number]> = {
  x: [0.7835, 0.0648, 0.0742, 1], // #e5484d
  y: [0.0612, 0.3864, 0.0976, 1], // #46a758
  z: [0.1046, 0.2664, 0.8632, 1], // #5b8def
};

/** What the entity selection needs from the rest of the host.
 *
 *  FOURTEEN members since foundations T3d Task 6, when the five facade verbs
 *  arrived (the header carries what that bought). Five are plain refs onto
 *  sibling seams declared above this assembly (`notifyHistory`,
 *  `selectionOutline`, `cursorRay`, `rebuildProps`, `reportToolError`); one is a
 *  plain ref onto a module-scope function the host imports (`randomSeed`); five
 *  are thunks reaching DOWN into modules assembled below — three into
 *  `field-machine.ts` (~590 lines) plus `cancelSession`, and
 *  `markDirtyWithNeighbors` into `field-world.ts` (1,192 lines); `worldEpoch` is
 *  a thunk onto `field-world.ts`' seam rather than a host `let`, which is the
 *  T3d Task 6 change to this record's shape; and two are the substrate and the
 *  Esc router. */
export type EntitiesDeps = {
  /** The host's shared state. Two members are read: `log` (every entity fact in
   *  this file is derived from the op log, never stored twice) and `store`, for
   *  the cell size the footprint arithmetic is in metres of. */
  substrate: HostSubstrate;
  /** The Esc capture stack. One rung is registered on it — the selected entity —
   *  and it stays router-mediated; `field-segment.ts` states the argument. */
  router: InputRouter;
  /** The world generation counter, bumped by `world.reset()`. A THUNK onto
   *  `field-world.ts`' seam since T3d Task 6 (it was a thunk over a host `let`
   *  until that cluster acquired its owner), and it rides in the footprint memo's
   *  signature for a reason the memo's own comment spells out: a world swap
   *  CLEARS the log, so two worlds whose logs agree on all four log-derived
   *  numbers would share a signature. */
  worldEpoch(): number;
  /** THE density-mutation choke point. `field-world.ts`', as a FORWARD thunk —
   *  that module is assembled 1,192 lines below this line. Driven by
   *  {@link Entities.remove} and {@link Entities.duplicate}, both of which change
   *  cells through core and must dirty the apron neighbours too. */
  markDirtyWithNeighbors(changed: Set<string>): void;
  /** Rebuild the committed prop layer from the log. `field-props.ts`'. Called
   *  UNCONDITIONALLY by both mutating verbs — never gated on the dirty set, for
   *  the reason {@link Entities.remove}'s body states. */
  rebuildProps(): void;
  /** End any live stamp/reconfigure session. `field-machine.ts`', as a forward
   *  thunk. Four of the five verbs call it, each guarded on the session's own
   *  entity id. */
  cancelSession(): void;
  /** The tool-error channel. `field-tool.ts`'. Every refusal core raises in these
   *  five verbs is passed through UNWRAPPED — core decides them before its first
   *  write, so nothing has moved and core's own sentence is the best explanation
   *  there is. */
  reportToolError(msg: string): void;
  /** A fresh stamp seed. `field-machine.ts`' `randomStampSeed`, passed through
   *  the host rather than imported — see the header for why that edge is not
   *  drawn directly. */
  randomSeed(): number;
  /** Push the history feed. `field-history-feed.ts`' — the entity tick carries
   *  it, which is why that assembly is an upper bound on this one. */
  notifyHistory(): void;
  /** THE selected-thing outline at the editor's accent. `field-selection.ts`'
   *  {@link Selection.outline}, and the ONE thing this module takes from that
   *  cluster — see the header. */
  selectionOutline(aabb: Box): LineBatch;
  /** The world ray under the cursor, or `null`. `field-targeting.ts`'. */
  cursorRay(clientX: number, clientY: number): CursorRay | null;
  /** The armed viewport gesture. `field-machine.ts`', as a thunk because that
   *  module is assembled below this line. */
  gesture(): ViewportGesture | null;
  /** The live stamp/reconfigure session, or `null`. Read ONLY as a liveness
   *  question, by {@link Entities.gizmoVisible}. */
  session(): StampSession | null;
  /** The live gizmo/ground move drag, or `null`. Read for its constrained axis
   *  and as a liveness question. */
  moveDrag(): MoveDrag | null;
};

/** The entity-selection cluster's seam: which entity is selected, the overlays
 *  that say so, the log-derived boxes every pick needs, and the tick the entity
 *  list rides. */
export type Entities = {
  /** The LIVE entity record for an id (not a clone — callers that hand it on
   *  clone at their own boundary), or `null` when no entity op carries it. The
   *  one lookup behind the selection box, the reconfigure session and the
   *  verbs. */
  record(entityId: number): field.GeneratorEntity | null;
  /** Every committed entity's PICK/EMPHASIS box, memoized on the log signature.
   *  Read by the pick, the drift badges, the camera's framing, the move's grab
   *  and the duplicate offset. */
  footprints(): Map<number, Box>;
  /** The entity-list tick. Fired by every path that can add, remove or rewrite
   *  an entity RECORD — including the two (freeze, bake) that dirty no chunk and
   *  would otherwise reach the panel through nothing at all. It carries the
   *  history push; see the implementation for why that containment is
   *  deliberate. */
  notify(): void;
  /** {@link FieldHost.subscribeEntities}. A ZERO-ARG channel: the tick carries no
   *  value, and its snapshot is the initial catch-up rather than a payload. */
  subscribe(cb: () => void): () => void;
  /** Select one entity, or NOTHING — the single mutator of the entity selection,
   *  whoever is asking: a pointer click, the public verb, an entity leaving the
   *  log, a world reset. There is deliberately no second "clear" entry point;
   *  `select(null)` is the clear. */
  select(entityId: number | null): void;
  /** The selected entity's id, or `null`. */
  selectedId(): number | null;
  /** {@link FieldHost.subscribeEntitySelection}. Snapshots on subscribe (the
   *  selection seam's remount rationale). */
  subscribeSelection(cb: (entityId: number | null) => void): () => void;
  /** Re-derive the selected entity's box from the CURRENT record, and DROP the
   *  selection when that record has left the log. Every path that can move or
   *  remove a committed region calls this: a reconfigure apply, a delete, and
   *  undo/redo. */
  revalidate(): void;
  /** Redraw the emphasis box and the gizmo from the CURRENT footprint, without
   *  touching the id. The move calls it as the ghost slides so the handles track
   *  what they are moving; {@link revalidate} is the version that also validates
   *  the id still exists. */
  rebuildOverlay(): void;
  /** The selected entity's footprint box outline, or `null`. */
  selectionBatch(): LineBatch | null;
  /** The translate gizmo's span, or `null`. Read by the orbit pivot, which wants
   *  the origin rather than the arms. */
  gizmo(): GizmoSpan | null;
  /** The translate gizmo's arms, or `null`. */
  gizmoBatch(): LineBatch | null;
  /** Whether the gizmo is on screen — and therefore pickable. ONE predicate for
   *  both, so a handle can never be grabbable while invisible (a click that moves
   *  something the user cannot see) or visible while inert. */
  gizmoVisible(): boolean;
  /** Which gizmo arm the cursor is over, or `null`. Every bound comes off the ONE
   *  span the batch was drawn from, so the pickable arm and the visible arm cannot
   *  be different segments. */
  gizmoAxisAt(clientX: number, clientY: number): Axis | null;

  // --- the five facade verbs (T3d Task 6) ----------------------------------

  /** {@link FieldHost.setEntityFrozen}. Freezing ENDS a live session on that
   *  entity — core refuses the Apply it would offer — while unfreezing cannot
   *  orphan anything. */
  setFrozen(entityId: number, frozen: boolean): void;
  /** {@link FieldHost.bakeEntity}. Permanent, so a live session on that entity
   *  ends rather than being left promising an Apply that can never land. */
  bake(entityId: number): void;
  /** {@link FieldHost.deleteEntity}. Named for the ACT rather than after the
   *  facade member, because `delete` is not a property name this file wants. */
  remove(entityId: number): void;
  /** {@link FieldHost.duplicateEntity}. Offsets the copy along X by the
   *  FOOTPRINT's extent on the stamp lattice, and re-rolls the seed only where
   *  the generator reads one. */
  duplicate(entityId: number): void;
  /** {@link FieldHost.listEntities}. One attribution pass for the whole list. */
  list(): FieldEntityInfo[];
};

/** Build the entity selection over one host's dependencies. One per host; it
 *  holds that host's selected id, its two overlays, the gizmo span and the
 *  footprint memo for the host's lifetime. */
export function createEntities(deps: EntitiesDeps): Entities {
  const { substrate } = deps;

  // Entity-list change tick (freeze/bake dirty no chunk, so the remesh counter
  // cannot carry them — see subscribeEntities). A ZERO-ARG channel: the tick
  // carries no value, and its snapshot is the initial catch-up (the world may
  // already hold entities) rather than a payload.
  const entitiesChannel = createViewChannel<[]>({ snapshot: () => [] });

  // The SELECTED entity (selectEntity / a `pointer` click) and its footprint
  // box, prebuilt on every change and drawn under the selection layer gate.
  // CPU-only line batch.
  //
  // The ID is tracked BESIDE the batch because a committed region is no longer
  // immutable: F3a's reconfigure can move it (the card offers nudge), and undo
  // can move it back — so the batch has to be rebuildable from the id rather
  // than only from the call that first drew it. Before F3a the box could not go
  // stale, which is why the id was not kept.
  let selectedEntityId: number | null = null;
  let entitySelectionBatch: LineBatch | null = null;
  // Snapshot (the selection seam's remount rationale): a palette arriving while
  // an entity is selected must not render every row unselected next to a
  // visible box in the viewport.
  const entitySelectionChannel = createViewChannel<[number | null]>({
    snapshot: () => [selectedEntityId],
  });
  // The translate gizmo's span, rebuilt with the selection box it hangs on (same
  // footprint, same invalidation), and the line batch drawn from it. The SPAN is
  // kept beside the batch because the pick needs its numbers and re-deriving
  // them from a vertex buffer is how the drawn handles and the pickable ones
  // part company. Both null whenever nothing is selected; whether they are DRAWN
  // is a separate question (gizmoVisible).
  let gizmo: GizmoSpan | null = null;
  let gizmoBatch: LineBatch | null = null;

  // The entity-list tick. Fired by every path that can add, remove or rewrite
  // an entity RECORD — including the two (freeze, bake) that dirty no chunk and
  // would otherwise reach the panel through nothing at all.
  //
  // It carries the history push, and that containment is deliberate rather than
  // convenient. Ten host paths mutate the op log; NINE of them rewrite an entity
  // record and therefore already funnel through here by this seam's own contract
  // (commit, apply, freeze, unfreeze, bake, delete, duplicate, ⌘Z/⇧⌘Z, world
  // new/load). The tenth is the brush stroke, which touches no entity — so
  // `commitToolOp` calls the feed itself (from `field-tool.ts`, through its own
  // `notifyHistory` dep), and those two are the ONLY sites. Spelling it out at
  // all ten would be ten chances to forget.
  const notifyEntities = (): void => {
    entitiesChannel.publish();
    deps.notifyHistory();
  };

  // The LIVE entity record for an id (not a clone — callers that hand it on
  // clone at their own boundary), or null when no entity op carries it. The one
  // lookup behind the selection box, the reconfigure session and the verbs.
  const entityRecord = (entityId: number): field.GeneratorEntity | null => {
    const hit = substrate.log.ops.find(
      (op): op is field.EntityOp =>
        op.kind === "entity" && op.entity.entityId === entityId,
    );
    return hit === undefined ? null : hit.entity;
  };

  // Every committed entity's PICK/EMPHASIS box, memoized on the log signature.
  //
  // The box is `generatorFootprint` — the union of the span's op bounds — with
  // the recorded selection region as the fallback the helper's null means: a
  // span with no field-writing ops (a pure placer's) has no op bounds, and an
  // entity with no box at all would be silently unpickable. One rule, resolved
  // in one place, so the pick and the drawn emphasis can never outline different
  // volumes.
  //
  // MEMOIZED because the pick needs EVERY entity's box on every click, and
  // `generatorFootprint` walks the whole op log per entity — O(entities × ops)
  // per click. The in-repo measurement nearest to that shape is
  // `placementsByEntity`'s (field-placements.ts): 2.3 ms for its WHOLE pass at
  // 200 entities × 500 records over 100 000 ops — two scans plus
  // placement-ops × entities attribution, not the unit cost of one
  // `generatorFootprint` walk. It is the right order of magnitude for one pass
  // over a log that size and nothing more precise has been taken; what makes the
  // memo obviously right is the MULTIPLIER this path adds (one such walk per
  // entity per click), not the constant. Recomputed once per log mutation
  // instead, which is a discrete user action.
  //
  // The signature is `currentLogStats`' three lengths (`field-stats.ts`) plus
  // TWO more, each closing a gap that is reachable:
  //   - `nextId`, because a reconfigure can splice out N ops and back in N,
  //     moving no length — but it always allocates fresh ids.
  //   - `worldEpoch`, because a world swap CLEARS the log (resetWorld empties
  //     ops and both stacks and resets nextId), so two worlds whose logs agree
  //     on all four log-derived numbers share a signature and the incoming world
  //     would read the outgoing world's boxes. Not hypothetical: two variant
  //     files out of one authoring flow collide easily — same op count, same
  //     ids, different geometry — and the symptom is a click on empty space
  //     selecting an entity that is gone, with a box drawn where nothing is.
  //     `worldEpoch` is bumped by resetWorld for the analyzer's sake; this rides
  //     the same counter rather than adding a second one.
  // What remains uncovered is several mutations within ONE frame that net all
  // the log numbers back, unreachable from single-event-per-frame input; a stale
  // box mis-aims a click and self-heals on the next mutation, it corrupts
  // nothing. (`currentLogStats` at the op-cost meter — `field-stats.ts` — has the
  // world-swap exposure too, filed rather than fixed here:
  // `docs/backlog/editor-and-tooling/field-tool-follow-ons.md` § *Log-signature
  // caches can miss a world swap*.)
  let footprintCache: Map<number, Box> | null = null;
  let footprintSig = "";
  const entityFootprints = (): Map<number, Box> => {
    const log = substrate.log;
    const sig = `${deps.worldEpoch()}/${log.ops.length}/${log.undoStack.length}/${log.redoStack.length}/${log.nextId}`;
    const cached = footprintCache;
    if (cached !== null && sig === footprintSig) return cached;
    const boxes = new Map<number, Box>();
    for (const op of log.ops) {
      if (op.kind !== "entity") continue;
      const record = op.entity;
      boxes.set(
        record.entityId,
        generatorFootprint(log.ops, record, substrate.store.cellSize) ??
          record.region,
      );
    }
    footprintCache = boxes;
    footprintSig = sig;
    return boxes;
  };

  // The one arm to draw while a move is CONSTRAINED to an axis, or null for the
  // full triad. A free ground drag has no single axis to name, so it keeps all
  // three — they are then the frame the ghost is moving within rather than a
  // constraint indicator.
  const activeGizmoAxis = (): Axis | null => {
    const m = deps.moveDrag()?.mapping;
    return m === undefined || m === "plane" ? null : m;
  };

  // Re-derive the selected entity's box from the CURRENT record, and DROP the
  // selection when that record has left the log. Every path that can move or
  // remove a committed region calls this: a reconfigure apply (the region is an
  // editable field of the session) and undo/redo (which restores the previous
  // record). An entity that left the log clears the box, the id AND notifies —
  // an undone commit must not leave a box floating over nothing, nor a palette
  // row highlighted for a stamp that no longer exists.
  //
  // The box outlines the stamped FOOTPRINT, not the recorded selection region —
  // an oversized region boxed mostly-empty space (F3a gate finding); see
  // entityFootprints for the fallback.
  const rebuildEntitySelectionBatch = (): void => {
    const box =
      selectedEntityId === null
        ? undefined
        : entityFootprints().get(selectedEntityId);
    if (box === undefined) {
      entitySelectionBatch = null;
      gizmo = null;
      return;
    }
    entitySelectionBatch = deps.selectionOutline(box);
    // The gizmo hangs on the SAME box, so it moves and dies with it — one
    // rebuild, one invalidation, and no way for the handles to end up outlining
    // a different volume than the emphasis does. While a move is live only the
    // CONSTRAINED arm is drawn (see gizmoVisible): the other two would advertise
    // motion this drag will not make.
    gizmo = gizmoSpan(box);
    gizmoBatch = axisLines(gizmo, AXIS_COLOR, activeGizmoAxis());
  };

  // Whether the gizmo is on screen — and therefore pickable. ONE predicate for
  // both, so a handle can never be grabbable while invisible (a click that moves
  // something the user cannot see) or visible while inert.
  //
  // The POINTER tool has to be armed (a brush click digs, and a manipulator
  // floating over a dig cursor promises an action LMB will not take) and
  // something has to be SELECTED (the gizmo is the selection's own affordance).
  //
  // The third condition is "no session the gizmo did not open". A session opened
  // by another path — the Open button, `G` — already owns the region through its
  // own affordances, and a second way to move one thing is how the two disagree.
  // But the gizmo's OWN drag is a session too, and hiding the handles the instant
  // one is grabbed deletes the only thing naming the axis the ghost is sliding
  // along. So a live move keeps them, restricted to the constrained arm.
  const gizmoVisible = (): boolean =>
    gizmo !== null &&
    deps.gesture() === "pointer" &&
    selectedEntityId !== null &&
    (deps.session() === null || deps.moveDrag() !== null);

  // The selected stamp's Esc entry (old rung 3).
  const syncSelectedEntityCapture = createRung(
    deps.router,
    "selected entity",
    () => selectedEntityId !== null,
    () => setSelectedEntity(null),
  );

  // Select one entity, or NOTHING — the single mutator of the entity selection,
  // whoever is asking: a pointer click, the public verb, an entity leaving the
  // log, a world reset. There is deliberately no second "clear" entry point;
  // `setSelectedEntity(null)` is the clear, and two parallel mutators of one
  // piece of state is how a side effect added to one and not the other drifts
  // silently.
  //
  // Validated against the log — an id no entity op carries selects NOTHING
  // rather than reporting, because the ids come from a panel list that can lag
  // it (openEntitySession's stance, minus the report: a stale click is not worth
  // a toast). Selecting what is already selected is a no-op that notifies
  // nobody, so a palette row can call this on every render, and so a world reset
  // with nothing selected pushes nothing — which is what lets the seam's
  // "pushed on every change" contract be read literally.
  //
  // Named apart from the PUBLIC `selectEntity` it backs (the openEntity →
  // openEntitySession precedent): the method could shadow-call this one
  // correctly by lexical scope, but a reader has to stop and prove it is not
  // recursion.
  const setSelectedEntity = (entityId: number | null): void => {
    const next =
      entityId === null || entityRecord(entityId) === null ? null : entityId;
    if (next === selectedEntityId) return;
    selectedEntityId = next;
    syncSelectedEntityCapture();
    rebuildEntitySelectionBatch();
    entitySelectionChannel.publish(next);
  };

  // Hoisted out of the returned object at T3d Task 6, when `remove` arrived and
  // became its second caller — Task 4's rule read from the inside: a verb with a
  // caller in its own module needs a name, and an object-literal method that
  // calls itself by `this` is the one spelling this file will not use.
  const revalidateSelectedEntity = (): void => {
    if (selectedEntityId === null) return;
    // The record is gone (an undone commit): setSelectedEntity's own validation
    // resolves the stale id to null, so passing it back IS the clear.
    if (entityRecord(selectedEntityId) === null) {
      setSelectedEntity(null);
      return;
    }
    rebuildEntitySelectionBatch();
  };

  return {
    record: entityRecord,
    footprints: entityFootprints,
    notify: notifyEntities,
    subscribe: (cb) => entitiesChannel.subscribe(cb),
    select: setSelectedEntity,
    selectedId: () => selectedEntityId,
    subscribeSelection: (cb) => entitySelectionChannel.subscribe(cb),
    revalidate: revalidateSelectedEntity,
    rebuildOverlay: rebuildEntitySelectionBatch,
    selectionBatch: () => entitySelectionBatch,
    gizmo: () => gizmo,
    gizmoBatch: () => gizmoBatch,
    gizmoVisible,
    gizmoAxisAt(clientX, clientY) {
      const g = gizmo;
      if (g === null || !gizmoVisible()) return null;
      const ray = deps.cursorRay(clientX, clientY);
      if (ray === null) return null;
      // Every bound comes off the ONE span the batch was drawn from, so the
      // pickable arm and the visible arm cannot be different segments.
      return pickAxis(
        { origin: ray.origin, dir: ray.dir },
        g.origin,
        g.len,
        g.tol,
        g.inner,
      );
    },

    // --- the five facade verbs, moved here at T3d Task 6 --------------------
    //
    // Each was the BODY of a `FieldHost` method and is now what that method
    // delegates to. Nothing about any of them changed: the same statements in
    // the same order, with `log`/`store`/`table()` reached through the substrate
    // and the four cross-cluster calls through this record. The header carries
    // why they moved and what the deps record paid for it.

    setFrozen(entityId, frozen) {
      try {
        field.setGeneratorFrozen(substrate.log, entityId, frozen);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.reportToolError(message);
        return;
      }
      // A freeze DOES reach a live session: the entities list stays visible
      // beside the reconfigure card, so Open #1 → Freeze #1 is one click away,
      // and core refuses the Apply that session is offering. Leaving it up would
      // mean an enabled Apply that can only ever fail — so freezing ends it, the
      // way baking does. Unfreezing (frozen=false) cannot orphan anything: no
      // session exists on a frozen entity to begin with, and the id check makes
      // it a no-op for every other session.
      if (frozen && deps.session()?.entityId === entityId) deps.cancelSession();
      notifyEntities();
    },

    bake(entityId) {
      try {
        field.bakeGeneratorEntity(substrate.log, entityId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.reportToolError(message);
        return;
      }
      // Unlike freeze, baking is permanent: a live session on this entity can
      // never land, so end it rather than leave a ghost promising an Apply.
      if (deps.session()?.entityId === entityId) deps.cancelSession();
      notifyEntities();
    },

    remove(entityId) {
      let dirtied: Set<field.ChunkKey>;
      try {
        ({ dirty: dirtied } = field.deleteGeneratorEntity(
          substrate.store,
          substrate.log,
          entityId,
          substrate.table(),
        ));
      } catch (err) {
        // Setup-loud core, runtime-VISIBLE editor: all three refusals (unknown
        // id, frozen, baked) are validation failures core decides before its
        // first write, so nothing has moved — and core's own sentence is the
        // best explanation there is, so it is passed through unwrapped
        // (setFrozen/bake's stance). Swallowing it would leave a row delete that
        // silently does nothing.
        const message = err instanceof Error ? err.message : String(err);
        deps.reportToolError(message);
        return;
      }
      deps.markDirtyWithNeighbors(dirtied);
      // UNCONDITIONAL, never gated on `dirtied.size`, and core's TSDoc says why
      // in as many words: a placements-only entity (a scatter) writes no cells,
      // so deleting it dirties NOTHING while every prop it placed leaves the log
      // with it. Props are derived from the LOG, never from the dirty set.
      deps.rebuildProps();
      // The record left the log, so a selection on it has to go with it — an
      // outline over a stamp that no longer exists. Surviving entities' spans do
      // not move (core locates spans by id), so nothing else re-outlines. It
      // notifies, so it sits with the pushes below rather than above the rebuild:
      // by the time anything hears about the delete, EVERY piece of host state it
      // moved has settled.
      revalidateSelectedEntity();
      // The two notifications LAST, once every piece of host state has settled
      // (applyReconfigureSession's rule): a subscriber may read the host back
      // synchronously from inside either, and none may observe a half-deleted
      // world. Cancelling here rather than before the core call is deliberate —
      // a REFUSED delete must not destroy a live session on its way out.
      if (deps.session()?.entityId === entityId) deps.cancelSession();
      notifyEntities();
    },

    duplicate(entityId) {
      const record = entityRecord(entityId);
      if (record === null) {
        deps.reportToolError(`entity ${entityId} is no longer in the log`);
        return;
      }
      let def: field.GeneratorDef;
      try {
        def = field.generatorById(record.generator); // setup-loud on a retired id
      } catch (err) {
        // openEntitySession's stance: fail HERE rather than at commitGenerator,
        // where the message would arrive wrapped in a commit failure.
        const message = err instanceof Error ? err.message : String(err);
        deps.reportToolError(message);
        return;
      }
      // Clear of the original along X, on the lattice the stamp UI works in. The
      // FOOTPRINT extent, not the region's: a recorded region routinely
      // over-draws its content (the F3a gate finding behind the footprint box),
      // so shifting by it would leave a visible gap. Floored at one step so a
      // footprint with no X extent at all still moves the copy off the original.
      const box = entityFootprints().get(entityId);
      const extentX = box === undefined ? 0 : box.max[0] - box.min[0];
      const shiftX = latticeClearance(extentX);
      const region = structuredClone(record.region);
      region.min[0] += shiftX;
      region.max[0] += shiftX;
      let committed: {
        dirty: Set<field.ChunkKey>;
        entity: field.GeneratorEntity;
      };
      try {
        committed = field.commitGenerator(substrate.store, substrate.log, def, {
          // commitGenerator clones for provenance; the clone here is so the
          // evaluate cannot reach the LOG's record through a shared reference.
          params: structuredClone(record.params),
          // A fresh roll only where the generator READS the seed (core's
          // `usesSeed`): duplicating a cave or a scatter should give a different
          // arrangement, while the hall — whose structure is entirely
          // params-determined — would just end up wearing a different number for
          // an identical shape.
          seed: def.usesSeed ? deps.randomSeed() : record.seed,
          region,
          // `GeneratorEntity` does not record the policy its commit used, so it
          // is not recoverable — core's reconfigure and `openEntity` both fall
          // back to `replace` and this joins them.
          policy: "replace",
          table: substrate.table(),
        });
      } catch (err) {
        // Reachable without a bug: the material table can have lost the kit
        // class the recipe needs since the original commit (commitStampSession's
        // stance, same sentence shape).
        const message = err instanceof Error ? err.message : String(err);
        deps.reportToolError(`duplicate failed: ${message}`);
        return;
      }
      deps.markDirtyWithNeighbors(committed.dirty);
      deps.rebuildProps(); // a duplicated scatter is new prop-layer content
      // The copy is what the user is now working on — and this is also what
      // re-outlines: the entity selection's setter rebuilds the emphasis box off
      // the new
      // record. AFTER the commit, so the footprint memo it reads is rebuilt from
      // the log that now holds the copy.
      setSelectedEntity(committed.entity.entityId);
      notifyEntities();
    },

    list() {
      // One attribution pass for the whole list, not one scan per row: the
      // helper walks the log once and hands back every entity's placements.
      //
      // Nothing FOOTPRINT-derived rides this. It is a general read with several
      // callers and only one of them ever wanted the boxes, so the drift badges
      // take them off `subscribeDrift` instead — where they are computed once per
      // report rather than per list read (see FieldDriftReport).
      const { log } = substrate;
      const placed = placementsByEntity(log.ops);
      const out: FieldEntityInfo[] = [];
      for (const op of log.ops)
        if (op.kind === "entity")
          out.push({
            ...structuredClone(op.entity),
            // Fresh arrays out of the helper, so the row's summary is a clone
            // like the record it rides on.
            placed: placed.get(op.entity.entityId) ?? [],
          });
      return out;
    },
  };
}
