// The HOST side of the pointer pick: what a `pointer` click can land on, and
// what pressing it does. The tenth cluster lifted out of `createFieldHost`.
//
// `field-pick.ts` IS THE OTHER HALF and the two names are deliberately a pair,
// split exactly where that module's header draws the line: *"the host builds the
// candidates (it owns the op log, the catalog and the flag store) and raycasts
// the field for the occluder; this module does the geometry and decides the
// winner."* That sentence describes a boundary the closure could not enforce
// while the host half was 170 lines in the middle of a 6,000-line file. This is
// the host half, and it is host-shaped for a reason: it is the third of the pick
// that is pure I/O — four reads of other clusters' state, one field raycast, and
// two selection writes. Nothing here is testable without a host, and nothing in
// `field-pick.ts` needs one. Neither module should acquire the other's property.
//
// THE SEAM IS ONE VERB, and that is the interesting fact about this move. The
// map counts FOUR functions in the cluster (`pickCandidates`, `pointerPick`,
// `applyPointerPick`, `pointerPress`) and every one of the first three has exactly
// one caller: the next one down. They are a pipeline that the closure had no way
// to say was a pipeline — four sibling `const`s any of the host's other 120
// functions could have called. Only `press` leaves, so the three intermediate
// stages become module-private and the deletion pass pays for the extraction on
// its own (`field-props.ts` gave `proxyGeometry` back for the same reason, one
// verb at a time).
//
// WHY THE PRESS STAYED ON THIS SIDE AT ALL. It is dispatched FROM the session
// machine's pointerdown chain, and two of its three outcomes are that module's
// state — so the natural reading is that it should have gone with the chain at
// T3c. It did not, because all three of its TESTS are the closure's: the gizmo
// hit-test, `selectedEntityId`, and a raycast pick against candidates built from
// the op log, the catalog and the flag store. The chain follows the state it
// ARBITRATES on; this verb follows the state it INTERROGATES. It reaches the
// machine the way every other host verb does — through the public verbs, which is
// the register's only edge where the closure writes INTO a module
// (`field-host-clusters.md` §5.5).
//
// THE LAW, applied (see `substrate.ts`'s doc header for the argument):
//
//   - FOUR substrate members are read and NONE is new: `log` and `store` and
//     `flagStore` by value (all `const` in the host, mutated through the identity
//     it hands over), `archetypeById()` as a thunk because `setEntityCatalog`
//     rebuilds the map rather than editing it. The two-extracted-readers bar is
//     not engaged in either direction — nothing here asks the record to widen.
//   - `selectedEntityId` is a host `let` with one extracted reader, so it rides
//     as a SINGLE-CONSUMER FUNCTION DEP (`field-props.ts`'s `kitMat` precedent)
//     rather than widening the record. A value copy would pin the press to
//     whatever was selected when the host was built — which is `null` — and
//     outcome 2 would then never fire.
//   - `beginMove` and `setPendingMove` arrive as ARROWS, alone among the eleven,
//     because `createFieldMachine` is assembled BELOW this line and has to be:
//     it takes `press` as a plain ref. One of the two directions had to bend, and
//     it is the one with two members rather than the one with one.
//
// NO UNIT TEST, by the house pattern eight extractions old: the argument is
// `tests/field-host/field-machine.test.ts`'s header and is not re-made here. The
// host suites passing UNMODIFIED across this move ARE this module's contract, and
// the geometry underneath it is pinned without a host by
// `tests/field-host/field-pick.test.ts` and `tests/field-host/gizmo.test.ts`.
import * as field from "@furnace/core/field";
import { DIG_RANGE_M } from "../shared/field-limits.ts";
import { flagCellBox } from "./field-flags.ts";
import type { FieldLayers } from "./field-host.ts";
import type { PendingMovePress } from "./field-machine.ts";
import {
  type PickAabb,
  type PickCandidate,
  pickNearest,
} from "./field-pick.ts";
import {
  FALLBACK_COLLISION,
  placementOwners,
  proxyScale,
} from "./field-placements.ts";
import type { CursorRay } from "./field-targeting.ts";
import type { Axis } from "./gizmo.ts";
import type { HostSubstrate } from "./substrate.ts";

/** How far a `pointer` pick reaches — the DIG reach, deliberately the same
 *  number rather than an independent one: "you can select what you could dig" is
 *  one rule to hold in the head, and the same range bounds the pick's occlusion
 *  probe, so nothing can be picked through terrain the probe never tested. */
const PICK_RANGE_M = DIG_RANGE_M;

/** What the pointer pick needs from the rest of the host.
 *
 *  Eleven entries beside the substrate, which is a lot until you read what the
 *  press actually does: it interrogates four clusters to decide, then writes to
 *  two more. Nine of the eleven are CALLS for the substrate's stated reason —
 *  they name state the host replaces — and the two plain refs (`setSelectedEntity`,
 *  `setSelectedFlag`) are bindings whose identity never moves: a closure `const`
 *  arrow and, since foundations T3d (2026-08-07), a verb of `field-analyzer.ts`. */
export type PickingDeps = {
  /** The host's shared state. Four members are read: `log` (the placement ops
   *  behind every prop candidate), `store` (the field the occluder raycast runs
   *  against, and the cell size the flag boxes are built on), `flagStore` (the
   *  advisor's visible findings) and `archetypeById()` (each placement's
   *  collision primitive). */
  substrate: HostSubstrate;
  /** The layer flags. Read per call, and the reason is the slice-coherence rule
   *  applied to OBJECTS: with props or markers switched off, clicking where one
   *  would have been must not select it. */
  layers(): Readonly<FieldLayers>;
  /** The slice as core's raycast option (`undefined` = unsliced). The occluder
   *  probe passes it, so a pick under an active slice targets the surface the
   *  user sees. */
  sliceOpts(): { maxY: number } | undefined;
  /** Cursor → world ray + the eye-in-rock probe (`field-targeting.ts`). Null
   *  when there is no camera or the view is singular, which is what makes the
   *  press's "could not run at all" answer distinguishable from "ran and hit
   *  nothing". */
  cursorRay(clientX: number, clientY: number): CursorRay | null;
  /** Every committed entity's footprint box, memoized against the log. The
   *  candidate set's first and un-gated family — a hidden emphasis box is not a
   *  hidden entity. */
  entityFootprints(): Map<number, PickAabb>;
  /** Which gizmo arm is under the cursor, or null for none / no gizmo drawn.
   *  Outcome 1's whole test, and it is asked FIRST — see {@link Picking.press}. */
  gizmoAxisAt(clientX: number, clientY: number): Axis | null;
  /** The currently selected entity, or null. A call because the host replaces it
   *  on every selection change and this module is asked about it once per press. */
  selectedEntityId(): number | null;
  /** Select an object, or deselect with `null`. The pick's whole write side for
   *  entities and props alike — a prop click selects its OWNING entity. */
  setSelectedEntity(entityId: number | null): void;
  /** Select an advisor FINDING by key. A separate selection from the entity one,
   *  which is why a marker click leaves the entity selection standing. */
  setSelectedFlag(key: string | null): void;
  /** Start a move on a committed entity (`field-machine.ts`). Returns whether it
   *  started; a refusal has already been reported by the session open. */
  beginMove(
    entityId: number,
    axis: Axis | null,
    grabbed: boolean,
    press: { x: number; y: number } | null,
  ): boolean;
  /** Arm the sub-threshold press (`field-machine.ts`). THE register's one edge
   *  where the closure writes into a module — see this module's header. */
  setPendingMove(next: PendingMovePress | null): void;
  /** Route the pointer's events to the canvas for the duration of a drag. Taken
   *  only on outcome 1, where a drag starts on the press with no threshold. */
  capturePointer(pointerId: number): void;
};

/** The pointer pick's one verb.
 *
 *  The three stages behind it — build the candidates, raycast and arbitrate,
 *  apply the answer — are module-private because each has exactly one caller: the
 *  next. See this module's header. */
export type Picking = {
  /** One LMB press while `pointer` is armed. Three outcomes, in the order they
   *  are decided — and the order IS the arbitration:
   *
   *   1. A GIZMO handle: the manipulator wins every tie, because its arms are
   *      drawn over the box they move (they all start at its centre) and one that
   *      lost the click to the thing behind it would not be a manipulator. The
   *      drag starts on the press with NO threshold, because no CLICK gesture
   *      competes for a handle press — there is nothing for it to be mistaken
   *      for, so nothing to disambiguate by waiting.
   *   2. The ALREADY-SELECTED entity (directly, or through a prop it placed):
   *      arm a pending drag and do nothing else. Re-selecting what is selected
   *      was always a no-op, so deferring costs nothing, and the threshold is
   *      what decides after the fact whether this press was a click or a move.
   *   3. Anything else: today's plain pick. Pressing an UNSELECTED entity selects
   *      it and arms nothing — otherwise the first click on any entity could
   *      shove it, and a click would never be safe. */
  press(e: PointerEvent): void;
};

/** Build the pointer pick over one host's dependencies. Holds no state: every
 *  candidate set is built fresh per click, which is the whole reason a CPU pick
 *  is affordable here (`field-pick.ts`'s header prices it). */
export function createPicking(deps: PickingDeps): Picking {
  // Everything a `pointer` click can land on, built fresh per click (never per
  // frame — this is the whole reason the pick is affordable on the CPU).
  //
  // Both drawn layers are GATED ON THEIR OWN LAYER FLAG, the slice-coherence
  // rule applied to objects: with props or markers switched off, clicking where
  // one would have been must not select it (what you see is what you target).
  // Entity footprints are NOT gated on the `selection` layer — that flag hides
  // the emphasis box, and a hidden box is not a hidden entity.
  const pickCandidates = (): PickCandidate[] => {
    const candidates: PickCandidate[] = [];
    for (const [entityId, aabb] of deps.entityFootprints())
      candidates.push({ kind: "entity", entityId, aabb });

    if (deps.layers().props) {
      // A prop click selects its OWNING entity, and `placementOwners` is what
      // pairs each record with the span that claims it (the pure module owns the
      // attribution rule, and is where it is unit-tested without a GPU).
      for (const { entityId, record } of placementOwners(
        deps.substrate.log.ops,
      )) {
        const collision =
          deps.substrate.archetypeById().get(record.archetypeId)?.collision ??
          FALLBACK_COLLISION;
        // The record's OWN frame, not `proxyCorners`: that one allocates 24
        // floats per record for the wireframe, and the oriented box test wants
        // the frame rather than the corners. Same centre and same extents as
        // the drawn proxy (collisionCenter + proxyScale), so the click volume
        // is exactly the box on screen.
        const [sx, sy, sz] = proxyScale(collision, record.scale);
        candidates.push({
          kind: "prop",
          entityId,
          obb: {
            center: field.collisionCenter(collision, record),
            halfExtents: [sx / 2, sy / 2, sz / 2],
            quat: record.quat,
          },
        });
      }
    }

    if (deps.layers().flags) {
      // The pick volume is the CELL — `flagCellBox`, the same box the camera
      // frames and the selected-flag outline draws, built on the same half-cell
      // lift the instanced matrices use, so none of the four can part company.
      // Deliberately NOT the drawn FLAG_MARKER_SIZE_M: a 0.18 m pin is a hard
      // click target, and the cell is what the finding is actually about.
      for (const row of deps.substrate.flagStore.summary().visible)
        candidates.push({
          kind: "flag",
          key: row.key,
          aabb: flagCellBox(row.flag.world, deps.substrate.store.cellSize),
        });
    }
    return candidates;
  };

  // What a `pointer` press lands on: `{ hit }` when the pick RAN — `hit: null`
  // there means it ran and found nothing, which the caller reads as deselect —
  // and a bare null when it could not run at all (no camera, a singular view).
  // The two must not collapse: a frame without a camera clearing the selection
  // would be a silent, untraceable deselect.
  //
  // A PROP hit carries its OWNING entity — a placement record is not an
  // independently editable object here.
  const pointerPick = (
    clientX: number,
    clientY: number,
  ): { hit: PickCandidate | null } | null => {
    const ray = deps.cursorRay(clientX, clientY);
    if (!ray) return null;
    // The occluder, slice-coherent like every other cursor-driven raycast
    // (sliceOpts): under an active slice a pick targets the surface the user
    // SEES. Skipped when the eye is in rock, for computeTarget's reason — the
    // ray would hit its own voxel at t = 0 and occlude the entire world.
    const rc = ray.eyeInRock
      ? null
      : field.raycastField(
          deps.substrate.store,
          ray.origin,
          ray.dir,
          PICK_RANGE_M,
          deps.sliceOpts(),
        );
    // How far the ray is KNOWN to be clear: the terrain hit, or the probe's own
    // range when it missed — nothing past that range was tested, so nothing past
    // it may be picked either.
    const clearTo =
      rc === null
        ? PICK_RANGE_M
        : Math.hypot(
            rc.point[0] - ray.origin[0],
            rc.point[1] - ray.origin[1],
            rc.point[2] - ray.origin[2],
          );
    return {
      hit: pickNearest(
        { origin: ray.origin, dir: ray.dir },
        pickCandidates(),
        clearTo,
      ),
    };
  };

  // What a resolved pick DOES: select the object under the cursor, or deselect
  // when the press landed on bare terrain or nothing at all.
  const applyPointerPick = (hit: PickCandidate | null): void => {
    if (hit === null) {
      deps.setSelectedEntity(null);
      return;
    }
    if (hit.kind === "flag") {
      // A marker click is NOT a miss: it leaves the entity selection standing.
      // The two are different selections, and clicking a finding is not a
      // statement about which stamp is being worked on.
      //
      // Straight to `setSelectedFlag`, past the public verb: there is nothing to
      // refuse (the key came out of the same summary the pick built its
      // candidates from, one gesture ago) and nothing to frame (the user is
      // looking at the marker they just pressed). D-F4.5-15's "the viewport is
      // the primary selection surface" is this line; the palette row lights up
      // because the seam pushes, not because the two surfaces talk.
      deps.setSelectedFlag(hit.key);
      return;
    }
    deps.setSelectedEntity(hit.entityId);
  };

  // The three outcomes and their order are documented on `Picking.press`, which
  // is what a reader arriving from the machine's chain has in hand.
  const pointerPress = (e: PointerEvent): void => {
    const axis = deps.gizmoAxisAt(e.clientX, e.clientY);
    // Bound to a local for `cursorRay`'s reason and no other: the guard and the
    // argument are two reads of one host `let` inside one statement, and
    // narrowing does not survive a call boundary — `deps.beginMove(deps
    // .selectedEntityId(), …)` is `number | null` where `number` is required.
    // Nothing runs between them, so this says exactly what the closure's two
    // reads of the binding said.
    //
    // THE THIRD READ BELOW IS DELIBERATELY NOT FOLDED IN, and the invariant that
    // makes the two spellings equal today is worth stating because it is not
    // obvious and because it is the kind of thing a later tranche can quietly
    // change. They are equal because `pointerPick` performs NO selection write:
    // it raycasts the field and reads the op log, the catalog, the flag store and
    // the layer flags, and every one of those is a read (verified by walking the
    // call tree at extraction). So `selected` would give the same answer.
    //
    // The live re-read is kept anyway, and NOT out of transcription fidelity —
    // the two failure modes are asymmetric. A held value that goes stale across a
    // call is the photograph `substrate.ts`'s doc header exists to describe, and
    // it fails SILENTLY. A live read that starts disagreeing with the guard
    // changes which branch this press takes, which is behaviour that eighteen
    // named tests in `field-host-move.gpu.test.ts` are standing over. And the
    // question outcome 2 asks — "did the user press the thing that is selected
    // NOW?" — is the one whose answer should track a write if a write ever
    // happens, so the live read is also the semantically right spelling rather
    // than merely the safer one.
    const selected = deps.selectedEntityId();
    if (axis !== null && selected !== null) {
      if (deps.beginMove(selected, axis, true, { x: e.clientX, y: e.clientY }))
        deps.capturePointer(e.pointerId);
      return;
    }
    const picked = pointerPick(e.clientX, e.clientY);
    if (picked === null) return;
    const hit = picked.hit;
    if (
      hit !== null &&
      hit.kind !== "flag" &&
      hit.entityId === deps.selectedEntityId()
    ) {
      deps.setPendingMove({
        entityId: hit.entityId,
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
      });
      return;
    }
    applyPointerPick(hit);
  };

  return { press: pointerPress };
}
