// The RIG: the editor's live camera — the orbit pose every gesture moves, the
// `camera.Camera` it is written into, the RMB look drag, the fly key set, the
// wheel's banked travel, and the four verbs that put it on a box. The fifteenth
// cluster lifted out of `createFieldHost`.
//
// WHY NOT `field-camera.ts`, WHICH ALREADY EXISTS. Three files now carry the word
// and the split between them is the useful part, so it is stated here once rather
// than guessed at three times:
//   - `camera-control.ts` is the ORBIT MATH — `OrbitState` in, `OrbitState` (or a
//     V3) out. No DOM, no host, reasonable about as geometry.
//   - `field-camera.ts` is the INPUT ARITHMETIC — what a `WheelEvent`, a set of
//     held keys and a drag's pixel motion MEAN, as plain numbers. DOM types in,
//     numbers out; it imports neither of the others.
//   - THIS file is the rig those two serve: the state they read and write, the
//     `Camera` handle, the channel, and the policy (which drag is this, what does
//     `F` frame, is fly travel gated open).
// `field-picking.ts`-beside-`field-pick.ts` is the established precedent for
// exactly this pairing — the gerund/qualified name is the host cluster's home and
// the bare noun is the pure module — and `field-camera.ts`'s own header already
// used the word "rig" for the thing this file turned out to be.
//
// TWENTY-TWO VERBS OVER FOURTEEN FUNCTIONS, and the gap runs BOTH ways at once,
// which is the third mechanism (`field-host-clusters.md` §2.8) showing up in one
// row. FIVE of the fourteen are private here — `aimCamera`, `placeCamera`,
// `applyOrbit`, `orbitPivot` and `frameTargetBox` each have callers only inside
// this file. THIRTEEN verbs are new surface (22 − the 9 of the 14 that are
// exported), and they are all the same thing said thirteen ways: state the
// closure let its neighbours read and write directly now has an act's name —
// `bind`/`unbind`/`release` for the lifecycle's four assignments,
// `noteKeyDown`/`noteKeyUp`/`releaseKeys` for the fly set's three, `wheelDolly`
// for the banked travel, `centreOn` for the drift report's re-centre, and five
// accessors.
//
// `applyOrbit` IS THE ONE TO READ THE SPLIT BY, and its call sites are what
// decided three of those thirteen. It had EIGHT in the closure — the file's
// most-called camera function — and five were other camera functions (`lookDrag`,
// `frameCameraOn`, `frameWorld`, `snapView`, `applyFlyMove`), which is why it is
// private now. The other three were `onWheel`, `ret.init` and the facade's
// `frameChunks`: not camera functions, and each is exactly why one of
// `wheelDolly`, `bind` and `centreOn` exists.
//
// **AND NONE OF THOSE THREE IS A RE-EXPORT OF `applyOrbit`** — that is the
// property that makes a 22-member seam coherent rather than merely wide. Each
// took a STATEMENT GROUP and its ORDER with it: `bind` carries perspective →
// pose → canvas-bind (the pose must be written before the bind); `wheelDolly`
// carries bank → store → sub-threshold return → aim → apply (the store must
// precede the return, or a banked scroll is dropped); `centreOn` carries the
// target-only aim and the publish that a camera-less host still owes. A seam
// member that only forwarded would be surface; each of these is a sequence the
// caller no longer has to get right. A private function's OUTSIDE callers are the
// seam it needs, one verb each — and what each verb owns is the ordering.
//
// THE LISTENERS DID NOT MOVE AND WILL NOT. `onWheel`, `onKeyDown`, `onKeyUp` and
// `onBlur` stay in `field-host.ts` because `input` is the listener/delegate layer
// and `attachListeners` owns the canvas element — the same line T3c drew when the
// pointer chain left and its four handlers stayed as delegates. So this module
// never sees a `KeyboardEvent`, and it sees a `WheelEvent` only because
// `field-camera.ts`'s `bankDolly` is defined over one. What the wheel decides —
// which of its two bindings is armed — stays with the listener, because that is a
// fact about the EVENT and not about the camera.
//
// TEARDOWN IS TWO VERBS FOR ONE ACT, on `field-materials.ts`'s precedent one task
// earlier: `unbind()` runs inside `ret.dispose`'s `if (c)` block (before
// `gpu.dispose`, which is what it must precede) and `release()` runs outside it,
// because a host disposed before it ever initialized still has slots to forget
// and no context to free them with. One verb could not cover both guard levels.
//
// WHAT THE SUITE PINS, AND THE UNCOMFORTABLE HALF, measured at this extraction
// (§2.8's lesson: green is not covered). `tests/field-host-camera.gpu.test.ts` is
// the load-bearing one — it drives the wheel, the look drag and the fly step
// through the host's own listeners — and `tests/field-host-camera.test.ts` takes
// the three framing verbs that need no GPU. Between them the `aimCamera` vs
// `placeCamera` distinction is pinned at all seven of its call sites.
//
// BUT THE CAMERA SUITES READ THE POSE, NOT THE CAMERA. Their `eye()` probe goes
// through `host.exportArtifact(…).playerStart`, which is `eye()` over
// `orbitState` — so every assertion those two files make about where the camera
// "is" is an assertion about this module's `let`. Measured: deleting
// `applyOrbit()` from `wheelDolly` is **fully green across all 2,912 tests**,
// while deleting the `aimCamera(...)` one line above it reddens exactly two
// (`wheel under the POINTER tool travels the camera and leaves the brush radius
// alone`, `wheel travel is measured in SCROLL DISTANCE, not in events`).
//
// **THE COVERAGE EXISTS; IT LIVES WHERE NOBODY WOULD LOOK FOR IT.** The obvious
// next sentence — "so the three `camera.set*` calls are unpinned" — was written
// here, and it is FALSE. Deleting exactly those three lines reddens **20 tests
// across six files**: `field-host-pointer.gpu` 8, `field-host-move.gpu` 6,
// `field-host-segment.gpu` 2, `field-host-selection-cells.gpu` 2,
// `field-host-stamp-entry.gpu` 1, `field-host-analyzer.gpu` 1 — and not one of
// them is a camera test. Every one raycasts THROUGH the camera, so a rig that
// never writes the engine object misses everything it aims at. Moving the publish
// below the `cam` guard reddens **5** more (three `snapView` cases and
// `frameWorld FITS the world's allocated box…` in `field-host-camera.test.ts`,
// plus `subscribeCameraPose pushes the current pose immediately…` in
// `field-host-headless.test.ts`), so the ordering is pinned too.
//
// It is NOT `field-render.ts`'s finding in a second lane. That one was
// measured on the thing it claimed (stub `Render.scene` → green; throw mid-frame
// → exactly one red). This is a different and more useful shape: **a cluster
// whose own suites prove almost nothing about it, and whose real pins are held by
// five unrelated lanes that never mention it.** Anyone changing `applyOrbit` will
// be told by the pointer and move suites, not by the camera ones.
//
// THE LAW, applied (`substrate.ts`'s doc header is the argument): this module
// takes NO substrate at all, which is a first. It reads no host container and no
// host `let` directly — the two world facts `frameWorld` needs arrive as the two
// named calls `worldBox()` and `occupiedTopY()`, because what it wants is a box
// and a ceiling rather than a store. Every one of the nine deps is a call.
//
// NO UNIT TEST OF ITS OWN, on `field-machine.ts`'s argument at the top of
// `tests/field-host/field-machine.test.ts`: the host suites that already drive
// these paths ARE the contract, and they pass unmodified.
import * as camera from "@furnace/core/camera";
import type { Context } from "@furnace/core/gpu";
import { boxCentre } from "./box-edges.ts";
import {
  dolly,
  flyLook,
  flyMove,
  frameBox,
  type OrbitState,
  orbitAbout,
  snapToAxis,
  toEyeTarget,
} from "./camera-control.ts";
import {
  bankDolly,
  flySpeed,
  lookDeltas,
  readFlyMove,
} from "./field-camera.ts";
import type {
  CameraPose,
  ToolErrorSeverity,
  ViewportGesture,
} from "./field-host.ts";
import type { Axis, GizmoSpan } from "./gizmo.ts";
import { createViewChannel } from "./view-channel.ts";

type Vec3T = [number, number, number];
/** A world-space AABB. `field-analyzer.ts` records that this exact alias (`Box3`
 *  there) was written one task earlier and DELETED, on the ground that a name is
 *  not part of a structural type's identity and a fifth spelling of
 *  `{ min: Vec3T; max: Vec3T }` adds surface without adding a contract. That
 *  reasoning is right and this file takes the other side deliberately, on COUNT:
 *  SEVEN annotation sites here against the advisor's two — three of the nine deps
 *  (`entityFootprints`, `selectionBox`, `worldBox`), two of the twenty-two verbs
 *  (`frameOn`, `centreOn`) and two private functions — because putting the camera
 *  ON a box is most of what this cluster does.
 *  Package-private, so it adds no exported surface either way; consolidating the
 *  five across the directory is still a prune-tranche job. */
type Box = { min: Vec3T; max: Vec3T };

/** The editor's vertical field of view. One reader — {@link CameraRig.bind} — and
 *  it travelled with it; the chrome states the same angle nowhere, because the
 *  only thing outside this file that could care is a projection the host owns. */
const EDITOR_FOV_Y = Math.PI / 3;

/** What the camera needs from the rest of the host. Nine members, every one a
 *  call.
 *
 *  **INVARIANT — no member may be a value, and the assembly's own split is
 *  2 / 1 / 1 / 5**, counted off the literal in `field-host.ts` rather than
 *  remembered: TWO forward arrows into `field-machine.ts` (`reaimMove`,
 *  `gesture`), which is what `createCameraRig` sitting ABOVE `createFieldMachine`
 *  costs; ONE composed arrow collapsing a pair of host reads into the answer this
 *  module wants (`worldBox`); ONE plain ref to a host `const` arrow
 *  (`occupiedTopY`); and FIVE refs onto other modules' seams (`gizmo`,
 *  `selectedEntityId`, `entityFootprints` = `field-entities.ts`; `selectionBox` =
 *  `field-selection.ts`' `box`; `reportToolError` = `tool.reportError`). Nothing
 *  here may value-snapshot a host `let`.
 *
 *  It was 2 / 2 / 2 / 2 / 1 at T3d Task 4 and the drift is the tranche happening
 *  around this record rather than to it: `selection` and `entities` acquired
 *  owners at Task 5, so two thunks over host `let`s and one composed arrow became
 *  plain module refs, and NOTHING in this file changed. What the record names is
 *  what it reads, never who it reads from. */
export type CameraRigDeps = {
  /** Retire a live move's world anchor. `field-machine.ts`'s, reached through an
   *  arrow. Called from {@link applyOrbit}, i.e. from EVERY path that turns the
   *  camera — which is the whole reason it lives there and not at each of the six
   *  gestures that would otherwise each have to remember. */
  reaimMove(): void;
  /** What LMB is armed to do (`field-machine.ts`, arrow). Read by one function:
   *  the orbit pivot is gated on `pointer`, because with a brush armed the
   *  selection is not what the user is working on. */
  gesture(): ViewportGesture | null;
  /** The translate gizmo's span, or null. `field-entities.ts`'. The orbit pivot is
   *  read OFF it rather than re-derived, so the camera can never orbit a centre
   *  other than the one the drawn handles hang on. */
  gizmo(): GizmoSpan | null;
  /** The selected entity, or null. `field-entities.ts`'. */
  selectedEntityId(): number | null;
  /** Every committed entity's footprint box, memoized against the log.
   *  `field-entities.ts`'. */
  entityFootprints(): Map<number, Box>;
  /** The CELL selection's world AABB, or null for "nothing selected, or selected
   *  with no bounds". `field-selection.ts`' `box`, and ONE dep rather than the two
   *  reads it collapsed while the state was in the closure (`selection` +
   *  `selectionAabb`) — what the framing wants is a box, and the null cases are
   *  indistinguishable to it. The composition moved INTO that module at T3d Task 5
   *  and this dep did not notice, which is §2.7's argument-vs-dependency rule
   *  paying off in the direction it was written for. */
  selectionBox(): Box | null;
  /** The world-space AABB of every allocated chunk, or null for an empty world.
   *  `world`'s `chunkSetBox` over the store's keys. Same shape as
   *  {@link selectionBox}: a box, not a store. */
  worldBox(): Box | null;
  /** The highest SOLID sample's world Y, or null when nothing is built.
   *  `world`'s. {@link CameraRig.frameWorld} lowers its ceiling to this rather
   *  than to the chunk column that holds it. */
  occupiedTopY(): number | null;
  /** Report a refusal to the user (`field-tool.ts`). Two framing verbs refuse out
   *  loud rather than doing nothing quietly — `F` swallows the key either way, so
   *  a silent refusal is indistinguishable from a broken binding. */
  reportToolError(msg: string, severity?: ToolErrorSeverity): void;
};

/** The live camera and everything that moves it. */
export type CameraRig = {
  /** The engine camera, or null before {@link bind}. Read by the frame (the
   *  `c && cam` guard and `render.scene(c, cam)`) and by `field-targeting.ts`,
   *  whose rays are cast through it. */
  cam(): camera.Camera | null;
  /** `FieldHost.init`'s camera half, as one act: build the perspective camera,
   *  write the stored pose into it, and bind it to the canvas for resize. */
  bind(c: Context): void;
  /** Release the canvas binding. Runs INSIDE `ret.dispose`'s context block,
   *  before `gpu.dispose`. */
  unbind(): void;
  /** Forget both handles. Runs OUTSIDE the context block — a host disposed before
   *  it ever initialized still has to read as uninitialized afterwards. */
  release(): void;
  /** Put the camera on a world box as ONE act: fit the current orbit to it, adopt
   *  that as an AIMED pose, and push it through the one funnel. Two callers —
   *  {@link frameSelection} and `field-analyzer.ts`'s click-to-frame, which hands
   *  over a box precisely so this composition stays here. */
  frameOn(box: Box): void;
  /** Move the orbit PIVOT to a box's centre, keeping angle and distance. A
   *  re-centre, not a fit — `FieldHost.frameChunks`' verb, and the difference
   *  from {@link frameOn} is the whole of that member's docblock. */
  centreOn(box: Box): void;
  /** `FieldHost.frameSelection` / the `F` key: fit to the selected entity's
   *  footprint, else the cell selection's AABB, else refuse out loud. */
  frameSelection(): void;
  /** `FieldHost.frameWorld`: fit to everything built, with the ceiling lowered to
   *  the topmost solid sample. Places rather than AIMS — see {@link aimedByHand}. */
  frameWorld(): void;
  /** `FieldHost.snapView`: jump to an axis-aligned view, keeping target and
   *  distance. */
  snapView(axis: Axis, sign: 1 | -1): void;
  /** The eye's world position. Read by the frame (the specular's view vector) and
   *  by `exportArtifact`, which spawns the player where the camera is.
   *
   *  DE-PREFIXED on the seam, on `field-analyzer.ts`'s precedent
   *  (`flagMarkerCount` is `advisor.markerCount`): a member of `cameraRig` does
   *  not need the word twice. `field-render.ts` still names its dep
   *  `cameraEye` — out there the noun is load-bearing. */
  eye(): Vec3T;
  /** The orientation, as {@link CameraPose}. The channel's payload and its
   *  snapshot are both this, so a field added to the pose cannot reach one and
   *  miss the other; `exportArtifact` takes its yaw. */
  pose(): CameraPose;
  /** `FieldHost.cameraAimedByHand`: has an interactive gesture or an
   *  aim-at-a-thing verb moved this camera. */
  aimedByHand(): boolean;
  /** `FieldHost.subscribeCameraPose`, snapshot included. */
  subscribePose(cb: (pose: CameraPose) => void): () => void;
  /** Is an RMB drag live. `FieldHost.isLooking`'s answer, and the pointer chain's
   *  liveness question — the machine arbitrates a press by asking this rather
   *  than by reading the slot. */
  looking(): boolean;
  /** Start an RMB drag. The pivot LATCHES here: what this drag IS gets decided
   *  once, at the press. */
  beginLook(clientX: number, clientY: number): void;
  /** One drag event's worth of turn. */
  lookDrag(clientX: number, clientY: number): void;
  /** End the RMB drag. */
  endLook(): void;
  /** One wheel event of camera travel, banked. The listener decides that this
   *  wheel is the camera's; everything after that is here. */
  wheelDolly(e: WheelEvent): void;
  /** A key went down — collect it for fly travel. Every key, whatever it is:
   *  `readFlyMove` reads only w/a/s/d/q/e, and the set has to hold the rest for
   *  the release to clear them. */
  noteKeyDown(key: string): void;
  /** A key came up. */
  noteKeyUp(key: string): void;
  /** Focus loss: drop the whole held set, or fly travel runs on forever. */
  releaseKeys(): void;
  /** One frame of fly travel. RMB-gated inside — the move keys only travel while
   *  the right button is holding a look. */
  flyStep(dt: number): void;
};

export function createCameraRig(deps: CameraRigDeps): CameraRig {
  let cam: camera.Camera | null = null;
  let unbindCamera: (() => void) | null = null;

  // Fly camera: start a few metres up looking down at the grid origin, so the
  // blank-canvas bootstrap digs the first hole at the ground-grid centre.
  // POSITIVE pitch puts the eye ABOVE the target (toEyeTarget: eye.y = target.y +
  // distance·sin(pitch)); at distance 6 this seats the eye at y ≈ 3.9. A negative
  // pitch would sink it below the y=0 grid looking up.
  let orbitState: OrbitState = {
    target: [0, 1, 0],
    distance: 6,
    yaw: 0.6,
    pitch: 0.5,
  };
  /** Backing store for {@link FieldHost.cameraAimedByHand}. Written ONLY through
   *  {@link aimCamera} / {@link placeCamera} below, never here. */
  let cameraAimed = false;
  const keys = new Set<string>();
  // RMB-drag camera state (null when the button is up). `pivot` LATCHES which of
  // the two drags this is, decided once at the press: a world point = orbit
  // about it, null = fly-look. Latched rather than re-derived per move so the
  // gesture cannot change under the user's hand — selecting something else,
  // deleting the entity, or disarming the pointer tool mid-drag all leave the
  // drag that is running exactly as it started.
  let look: { lastX: number; lastY: number; pivot: Vec3T | null } | null = null;
  // Scroll banked toward the next dolly step, in CSS pixels — the remainder
  // `bankDolly` hands back, held here because it has to survive between wheel
  // events (see wheelDolly, its only reader).
  let dollyPixels = 0;

  const pose = (): CameraPose => ({
    yaw: orbitState.yaw,
    pitch: orbitState.pitch,
  });

  // Snapshot (the selection seam's remount rationale): the camera does not move
  // on its own, so a triad that waited for the first WASD step would draw the
  // wrong orientation for as long as the user sat still.
  const cameraPoseChannel = createViewChannel<[CameraPose]>({
    snapshot: () => [pose()],
  });

  /** The user aimed the camera: every interactive gesture and every aim-at-a-thing
   *  verb goes through this rather than assigning `orbitState` directly.
   *
   *  A FUNNEL rather than a flag set at each of the seven call sites, and the
   *  reason is that the eighth is the one that would forget. The chrome's Open reads
   *  the latch to decide whether the user has arranged this camera, so a new camera
   *  verb that assigned `orbitState` on its own would
   *  silently make Open start yanking an arranged view. Now it cannot: assigning
   *  `orbitState` outside these two helpers is the only way to get it wrong, and all
   *  SEVEN sites are pinned — `tests/field-host-camera.test.ts` takes the three that
   *  need no GPU ({@link CameraRig.frameSelection}, {@link CameraRig.snapView},
   *  {@link CameraRig.centreOn}), `tests/field-host-flag-select.test.ts` takes the
   *  flag report's click-to-frame, and `tests/field-host-camera.gpu.test.ts` takes the
   *  three gestures that need a live camera (the fly step, the look/orbit drag, the
   *  wheel dolly). Converting any one of them to `placeCamera` reddens exactly one. */
  const aimCamera = (next: OrbitState): void => {
    orbitState = next;
    cameraAimed = true;
  };
  /** Move the camera WITHOUT claiming the user aimed it — {@link CameraRig.frameWorld},
   *  including when the chrome's Open calls it. See
   *  {@link FieldHost.cameraAimedByHand} for why framing the world is not aiming. */
  const placeCamera = (next: OrbitState): void => {
    orbitState = next;
  };

  const cameraEye = (): Vec3T => toEyeTarget(orbitState).eye;

  // Write the current orbitState into the camera's position/target/up, and tell
  // whoever is drawing the orientation triad. The publish sits ABOVE the camera
  // guard on purpose: every path that moves the orbit ends here, and a pose change
  // is just as true before the GPU exists as after it.
  //
  // Being the ONE place every camera path ends is also why a live move's anchor
  // is retired here (see reaimMove): the anchor is a world point read under the
  // old view, and it goes stale for a fly step, a wheel dolly and an `F` framing
  // exactly as it does for a look drag. Retiring it at each of those call sites
  // instead is how one of them ends up forgotten. Inert while no move is in
  // flight, which is every call before F4.5b's move sessions existed.
  const applyOrbit = (): void => {
    deps.reaimMove();
    cameraPoseChannel.publish(pose());
    if (!cam) return;
    const { eye, target, up } = toEyeTarget(orbitState);
    camera.setPosition(cam, new Float32Array(eye));
    camera.setTarget(cam, new Float32Array(target));
    camera.setUp(cam, new Float32Array(up));
  };

  // --- what the camera can be put ON ---------------------------------------

  // The centre of the selected entity's footprint, or null when there is nothing
  // to pivot on. Gated on the POINTER tool for the gizmo's reason: with a brush
  // armed the selection is not what the user is working on, and a right-drag
  // that suddenly orbits something they are not looking at is a surprise.
  //
  // Read off the GIZMO rather than re-derived from the footprint memo, and the
  // point is not brevity: `gizmoSpan(box).origin` IS the footprint centre, and
  // `gizmo` is non-null on exactly the condition a re-derivation would test
  // (`field-entities.ts`' rebuild nulls it when the selected entity has no box).
  // Taking it from there makes the pivot the same number the drawn handles hang
  // on, so the camera can never orbit a centre other than the one on screen.
  //
  // Two statements where the closure had one expression, and the short-circuit is
  // preserved deliberately: `gesture()` is asked FIRST and the gizmo is not read
  // at all under a brush, exactly as `gesture() !== "pointer" || gizmo === null`
  // did when both were bare reads in one scope.
  const orbitPivot = (): Vec3T | null => {
    if (deps.gesture() !== "pointer") return null;
    const g = deps.gizmo();
    return g === null ? null : g.origin;
  };

  // The box `F` frames: the selected ENTITY's footprint, else the CELL
  // selection's AABB, else nothing. A FIXED priority, not "whichever is newer":
  // `selectionClick` never touches `selectedEntityId` and `setSelectedEntity`
  // never touches `selection`, so either order of arrival is reachable (select
  // an entity from the palette, then draw a box — the entity still wins). The
  // entity is the more SPECIFIC intent: one object rather than a volume.
  const frameTargetBox = (): Box | null => {
    const entityId = deps.selectedEntityId();
    const box =
      entityId === null ? undefined : deps.entityFootprints().get(entityId);
    if (box !== undefined) return box;
    return deps.selectionBox();
  };

  const frameOn = (box: Box): void => {
    aimCamera(frameBox(orbitState, box));
    applyOrbit();
  };

  const frameSelection = (): void => {
    const box = frameTargetBox();
    if (box === null) {
      // Says so rather than doing nothing quietly. `F` swallows the key either
      // way, so a silent refusal is indistinguishable from a broken binding —
      // the same reason every other refused verb here reports.
      deps.reportToolError("nothing selected to frame");
      return;
    }
    frameOn(box);
  };

  const frameWorld = (): void => {
    const box = deps.worldBox();
    if (box === null) {
      // Same stance as frameSelection's: an empty world is a refusal with a
      // sentence, not a camera verb that quietly does nothing.
      deps.reportToolError(
        "nothing in this world to frame yet — dig something first",
      );
      return;
    }
    // Lower the ceiling to what was BUILT rather than to the chunk column that
    // holds it. A chunk is CHUNK_DIM samples tall, so a floor-only world fits the
    // camera to ~16 cells of empty headroom without this.
    //
    // NO CLAMP AGAINST `box.min[1]`, and there is nothing to restore here: both
    // numbers come off the SAME `store.chunks` in the same synchronous call, with
    // the same `store.cellSize`. `box.min[1]` is `minCy · CHUNK_DIM · cellSize`;
    // `top` is `(cy · CHUNK_DIM + ly) · cellSize` for some `cy ≥ minCy` and
    // `ly ≥ 0`. So `top ≥ box.min[1]` always, and a lowered ceiling can never sink
    // below the box floor.
    const top = deps.occupiedTopY();
    const fitted =
      top === null
        ? box
        : { min: box.min, max: [box.max[0], top, box.max[2]] as Vec3T };
    // `placeCamera`, NOT `aimCamera`: framing the world is the state the automatic
    // frame produces, so counting it as the user aiming would make one Open
    // suppress the next one's frame.
    placeCamera(frameBox(orbitState, fitted));
    applyOrbit();
  };

  // --- the look drag -------------------------------------------------------
  //
  // The pointer CHAIN — which of the seven things an LMB press can mean this
  // press is — is `field-machine.ts`'s, because every test in it reads that
  // module's state and nothing else's. These three verbs are the half that could
  // not go: the LOOK drag is this cluster (`orbitState`, `aimCamera`,
  // `applyOrbit`, `orbitPivot`), so the chain asks whether the camera has the
  // pointer (`looking`) and hands the drag back. The machine arbitrates and calls
  // these; nothing here decides anything. (The DOM's pointer CAPTURE is the third
  // piece of that split and stayed in `field-host.ts` a second time over — it
  // needs the canvas ELEMENT, which no module is given.)

  // Start an RMB drag. The pivot LATCHES here (see the `look` declaration): what
  // this drag is gets decided once, at the press.
  const beginLook = (clientX: number, clientY: number): void => {
    look = { lastX: clientX, lastY: clientY, pivot: orbitPivot() };
  };

  // One drag event's worth of turn.
  //
  // The null guard is the compiler's, not the chain's: `pointerMove` calls this
  // only under `looking()` one statement earlier, but `look` is a `let` in an
  // enclosing scope and no narrowing survives the call boundary between them.
  const lookDrag = (clientX: number, clientY: number): void => {
    if (look === null) return;
    const { dYaw, dPitch } = lookDeltas(
      clientX - look.lastX,
      clientY - look.lastY,
    );
    look.lastX = clientX;
    look.lastY = clientY;
    // The SAME angles either way, so the view turns the direction the hand
    // moved in both drags; the pivot decides what stays still while it does.
    aimCamera(
      look.pivot === null
        ? flyLook(orbitState, dYaw, dPitch)
        : orbitAbout(orbitState, look.pivot, dYaw, dPitch),
    );
    applyOrbit();
  };

  const endLook = (): void => {
    look = null; // the anchor a turned camera invalidated was retired in applyOrbit
  };

  return {
    cam: () => cam,
    bind(c) {
      cam = camera.perspective({
        fovYRad: EDITOR_FOV_Y,
        aspect: 1,
        near: 0.1,
        far: 1000,
      });
      applyOrbit();
      unbindCamera = camera.bindToCanvas(c, cam);
    },
    unbind() {
      unbindCamera?.();
    },
    release() {
      unbindCamera = null;
      cam = null;
    },
    frameOn,
    centreOn(box) {
      aimCamera({ ...orbitState, target: boxCentre(box) });
      // Before init this moves the target and publishes the pose, and writes no
      // camera — applyOrbit guards on `cam`, and there is none yet.
      applyOrbit();
    },
    frameSelection,
    frameWorld,
    snapView(axis, sign) {
      aimCamera(snapToAxis(orbitState, axis, sign));
      applyOrbit();
    },
    eye: cameraEye,
    pose,
    aimedByHand: () => cameraAimed,
    subscribePose(cb) {
      return cameraPoseChannel.subscribe(cb);
    },
    looking: () => look !== null,
    beginLook,
    lookDrag,
    endLook,
    // The wheel is TWO bindings on one input and the SPLIT stays with the
    // listener; this is the camera half of it. Travel is ACCUMULATED because
    // `deltaY` magnitudes differ by two orders between a notched wheel (~100 px
    // per notch, a handful of events) and a trackpad's momentum stream (many
    // small events), so one step per EVENT would make how far the camera goes a
    // function of the event rate rather than of how far the user scrolled. The
    // radius keeps its per-event step for the opposite reason, stated at
    // `field-tool.ts`'s `stepRadius`.
    wheelDolly(e) {
      const banked = bankDolly(dollyPixels, e);
      // Stored BEFORE the sub-threshold return, or the scroll this event just
      // banked is dropped rather than carried.
      dollyPixels = banked.banked;
      // Sub-threshold scroll banks and waits. Returning is not just an
      // optimisation: falling through would publish a pose for a camera that did
      // not move, and retire a live move's anchor on the strength of it.
      if (banked.steps === 0) return;
      aimCamera(dolly(orbitState, -banked.steps)); // negative deltaY = forward
      applyOrbit();
    },
    noteKeyDown(key) {
      keys.add(key);
    },
    noteKeyUp(key) {
      keys.delete(key);
    },
    releaseKeys() {
      keys.clear();
    },
    // Fly travel is RMB-GATED (D-10): the move keys only travel while the right
    // button is holding a look. This is the Unity/Unreal mechanism, and it is what
    // buys the editor its whole bare-letter budget — `S` is fly-backward AND the
    // stamp family, `B` is unbound in the host AND the brush family, and there is
    // no way to have both on one keycap except by letting the button that means
    // "I am driving the camera" decide which. The app-level gate is the same rule
    // from the other side (`frontend/lib/actions.ts`: a bare-key action is refused
    // while `isLooking()`), so exactly one of the two answers any letter.
    //
    // Gated HERE rather than at the call site: `keys` still collects w/a/s/d/q/e
    // whatever the button is doing (they have to, for the release to clear them),
    // so this is the one place that decides whether the set means anything.
    flyStep(dt) {
      if (look === null) return;
      const move = readFlyMove(keys);
      if (move.f === 0 && move.r === 0 && move.u === 0) return;
      aimCamera(flyMove(orbitState, move, flySpeed(keys, dt)));
      applyOrbit();
    },
  };
}
