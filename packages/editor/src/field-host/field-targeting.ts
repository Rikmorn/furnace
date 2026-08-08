// Where the cursor IS, and the five different world answers a gesture can want
// from that one place. The ninth cluster lifted out of `createFieldHost`, and the
// first of foundations T3d's four.
//
// The cluster is a CHAIN rather than a set: client pixels → NDC → a world ray with
// its eye-in-rock probe → the four answers built on that ray. Every one of the
// four differs from its neighbours by a single deliberate rule, and keeping them
// in one module is what stops those rules drifting apart:
//
//   - {@link Targeting.computeTarget} is the dig-feel BRUSH CENTRE — offset back
//     off the wall by `computeBrushCenter`, because a stroke should bite where the
//     user is aiming rather than where the ray stopped.
//   - {@link Targeting.selectionPoint} is the RAW hit, precisely because a region
//     corner must sit ON the wall and not bitten past it, and it falls back to the
//     brush centre only when there is no hit to be raw about.
//   - {@link Targeting.materialSeedVoxel} is the first SOLID voxel; {@link
//     Targeting.voidSeedVoxel} is the last AIR one before it. They are the two
//     sides of the same hit and would be one function if the flood they seed did
//     not run in opposite directions.
//
// All four are SLICE-COHERENT through one seam (`sliceOpts()`), which is the
// property that would rot first if these lived apart: what you see is what you
// target, and a fifth cursor answer added beside three of them would be the one
// that raycasts past the clip plane.
//
// WHY `lastPointer` TRAVELS WITH THEM. It is the cluster's only state and the map
// records it under `input`'s writers (§5.2, 2 edges) rather than here, which reads
// as though the DOM owns it. It does not: `lastPointer` is the ARGUMENT every
// function above takes, cached — the two pointer delegates note it on the way past
// and nothing else in the chain reads it. So the writers become one verb
// ({@link Targeting.notePointer}), the handlers keep their line, and the binding
// sits beside the five functions that are pure functions of it.
//
// THE LAW, applied (see `substrate.ts`'s doc header for the argument):
//
//   - `store` and `canvasEl()` ride the SUBSTRATE, on the value and thunk sides
//     respectively — `store` is a `const` the host mutates through, `canvasEl` a
//     `let` that is null before `init` and after `dispose`.
//   - `cam` is NOT in the record and rides as a FUNCTION DEP. It was a host `let`
//     with this as its only extracted reader — `field-props.ts`'s `kitMat`
//     precedent, and the two-extracted-readers bar in its active form — until T3d
//     Task 4 gave the camera an owner: the dep is `cameraRig.cam` now, a plain ref
//     onto `field-camera-rig.ts`'s seam, and the substrate-bar argument no longer
//     applies to it at all (`flagMarkerMat`'s expiry in `field-analyzer.ts`, same
//     shape). The CALL is unchanged and so is its reason — the camera is built at
//     `init` and nulled at `dispose`, so a value copy would be `null` for the life
//     of the host.
//   - `digRadius` is a host `let` the wheel, the brackets and the panel slider all
//     move, so it is a call for `field-segment.ts`'s stated reason: passed as a
//     number, the target would be computed at the radius held when this module was
//     built while the committed op used the live one.
//   - `sliceY` and `sliceOpts` are `field-view.ts`'s, and they arrive as ARROWS
//     rather than plain refs because `createView` is assembled ~750 lines BELOW
//     this module's assembly and the deps literal is eager. Same shape as the
//     machine's `noteReconfigureMs`.
//
// `toNdc` did NOT survive to the seam. It was a cluster function (the map counts
// six) and it has exactly one caller, `cursorRay`, one line down — so it is
// module-private here, on the precedent of `field-props.ts` giving `proxyGeometry`
// back at T3b2. What left the closure is the chain; what the closure may ask for
// is the five answers plus the cursor.
//
// NO UNIT TEST, by the house pattern eight extractions old: the argument is
// `tests/field-host/field-machine.test.ts`'s header and is not re-made here. The
// host suites passing UNMODIFIED across this move ARE this module's contract; the
// arithmetic underneath it is already pinned without a host by
// `tests/field-brush.test.ts` (`computeBrushCenter`) and core's own raycast suite.
import * as camera from "@furnace/core/camera";
import * as field from "@furnace/core/field";
import { computeBrushCenter } from "../shared/field-brush.ts";
import { DIG_RANGE_M } from "../shared/field-limits.ts";
import type { HostSubstrate } from "./substrate.ts";

type Vec3T = [number, number, number];

/** A cursor ray plus the probe that decides how it is used.
 *
 *  `eyeInRock` is the DISPLAY-space answer, not the field's: see
 *  {@link Targeting.cursorRay} for why an eye buried under an active slice
 *  reports `false`. */
export type CursorRay = { origin: Vec3T; dir: Vec3T; eyeInRock: boolean };

/** What the cursor chain needs from the rest of the host.
 *
 *  Five entries beside the substrate and every one is a CALL, which is the whole
 *  of this record's design: three name host `let`s (`cam`, `digRadius`, and the
 *  view's two behind their module record) and the fifth is the host's own error
 *  funnel. This module writes nothing outside itself, so there is no boundary
 *  mutation and no callback for one — it is the only cluster of T3d's four with a
 *  clean zero in the map's MUTATES column. */
export type TargetingDeps = {
  /** The host's shared state. Two members are read: `store` (the field every
   *  raycast and density probe runs against) and `canvasEl()` (the rect NDC is
   *  measured in). */
  substrate: HostSubstrate;
  /** The bound camera, or `null` before `init` and after `dispose`. THE gate on
   *  the whole chain — every verb here answers `null` without one. */
  cam(): camera.Camera | null;
  /** The brush radius in metres. Read per call because the wheel, `[`/`]` and the
   *  panel slider all move it, and the ghost this feeds must preview the radius
   *  the next stroke will actually use. */
  digRadius(): number;
  /** The slice plane's Y, or `null` when no slice is active. Read only by the
   *  eye-in-rock probe, which needs the NUMBER rather than the raycast option. */
  sliceY(): number | null;
  /** The slice as core's raycast option (`undefined` = unsliced). Every raycast
   *  in this module passes it — that is what makes the five answers agree with
   *  what is on screen. */
  sliceOpts(): { maxY: number } | undefined;
  /** Report a refusal to the user (console + the panel's message channel). Two
   *  of the five answers report before yielding null; the other three simply
   *  answer null, because a cursor over nothing is not a refusal. */
  reportToolError(msg: string): void;
};

/** The cursor's five world answers, plus the cursor itself.
 *
 *  Every geometric member takes CLIENT coordinates, not NDC and not a ray: the
 *  translation is this module's, and a caller that had to build a ray first would
 *  be the caller that built it without the slice. */
export type Targeting = {
  /** Cursor → world ray + the eye-in-rock probe. Null when there is no camera or
   *  the view is singular. The one member other modules take directly
   *  (`field-machine.ts`, on a narrower return that drops the probe). */
  cursorRay(clientX: number, clientY: number): CursorRay | null;
  /** The world-space BRUSH CENTRE under the cursor, under the dig-feel contract.
   *  Null when there is no camera or the view is singular. */
  computeTarget(clientX: number, clientY: number): Vec3T | null;
  /** The RAW surface point under the cursor — what a region corner anchors on.
   *  Falls back to {@link Targeting.computeTarget} when the ray hits nothing. */
  selectionPoint(clientX: number, clientY: number): Vec3T | null;
  /** The SOLID voxel under the cursor, for a material flood's seed. Reports and
   *  answers null on a miss. */
  materialSeedVoxel(clientX: number, clientY: number): Vec3T | null;
  /** The last AIR voxel before the cursor's rock hit, for a void flood's seed.
   *  Reports and answers null with the eye embedded in rock. */
  voidSeedVoxel(clientX: number, clientY: number): Vec3T | null;
  /** Record where the pointer is. Called by the `pointerdown` and `pointermove`
   *  delegates on the way past — the chain never reads it, the per-frame ghost
   *  and the `G` grab do. */
  notePointer(clientX: number, clientY: number): void;
  /** The last known cursor position, or `null` before the pointer has ever been
   *  over the canvas. Returns the STORED object rather than a copy: it is
   *  replaced wholesale on every note and never written into, and this is read
   *  once per frame by the ghost — a defensive copy here would be a per-frame
   *  allocation buying nothing. A caller that hands it on copies at its own
   *  boundary (`FieldHost.beginMove` does). */
  pointer(): { x: number; y: number } | null;
};

/** Build the cursor chain over one host's dependencies. One per host; it holds
 *  that host's last pointer position for its lifetime. */
export function createTargeting(deps: TargetingDeps): Targeting {
  // Last cursor position over the viewport, so the ghost target marker can
  // preview where the next stroke lands each frame. DELIBERATELY NOT cleared
  // on pointer-leave (the size-preview affordance): the ghost keeps rendering at
  // the last hover target while the mouse is over the panel, so panel-slider
  // radius drags preview live in the viewport (renderGhost recomputes from
  // this + the CURRENT radius per frame). The ghost lingering while the mouse
  // is off-canvas is that feature's accepted trade-off.
  let lastPointer: { x: number; y: number } | null = null;

  // Cursor client coords → NDC (Y-up, [-1,1]). Copied from field-host/index.ts.
  const toNdc = (clientX: number, clientY: number): [number, number] => {
    // Bound to a local because narrowing does not survive a call boundary — the
    // substrate's thunk side is read where it is used, and the guard and the
    // measurement are two reads of one `let`. See `substrate.ts`'s doc header.
    const el = deps.substrate.canvasEl();
    if (!el) return [0, 0];
    const r = el.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * 2 - 1;
    const y = -(((clientY - r.top) / r.height) * 2 - 1);
    return [x, y];
  };

  // Cursor → world ray + the eye-in-rock probe, shared by computeTarget, the
  // eyedropper, and the selection-gesture seeds. Returns null when there is
  // no camera or the view is singular.
  //
  // `eyeInRock` is the DISPLAY-space probe (slice coherence, F2b sweep): with
  // an active slice, an eye at/above the clip plane sits in DISPLAY air even
  // when the field there is rock — the slice hides that rock and the
  // raycast's maxY clip suppresses its t=0 self-hit — so it reports false and
  // EVERY gesture site then raycasts onto the sliced surface the user sees
  // (what you see is what you target). Quantized to the eye's VOXEL BASE
  // (worldToVoxel·cellSize) because the raycast clips whole voxels by base —
  // a continuous origin-Y compare disagrees for a non-lattice-aligned sliceY
  // inside the eye's own voxel.
  const cursorRay = (clientX: number, clientY: number): CursorRay | null => {
    const cam = deps.cam();
    if (!cam) return null;
    const [nx, ny] = toNdc(clientX, clientY);
    const r = camera.screenToRay(cam, nx, ny);
    // Boundary cast: screenToRay returns Vec3 (Float32Array); fixed indices
    // 0/1/2 are always present. `noUncheckedIndexedAccess` widens them to
    // `number | undefined`. Marshal to plain tuples for `raycastField` exactly
    // as field-host's rayFromCursor does (the recognized fixed-index read).
    const ox = r.origin[0] as number;
    const oy = r.origin[1] as number;
    const oz = r.origin[2] as number;
    const dx = r.dir[0] as number;
    const dy = r.dir[1] as number;
    const dz = r.dir[2] as number;
    if (Math.hypot(dx, dy, dz) < 1e-8) return null; // singular VP → no valid ray
    // Read here rather than at the top: the ray can be answered `null` twice
    // above without the field being touched at all, and this is the first line
    // that needs it. A substrate VALUE member, so the local is a reference to the
    // host's one store and not a copy of anything.
    const store = deps.substrate.store;
    const cs = store.cellSize;
    const buried =
      field.getDensity(
        store,
        field.worldToVoxel(ox, cs),
        field.worldToVoxel(oy, cs),
        field.worldToVoxel(oz, cs),
      ) < 0;
    // Bound to a local for the ONE reason a local is ever right here: the
    // expression reads the plane TWICE — a null check, then a compare — and
    // narrowing does not survive a call boundary, so a second `deps.sliceY()`
    // would still be `number | null` and would not compile. Two reads inside one
    // synchronous expression cannot observe a write between them, so this says
    // exactly what the closure's `let` said. See `field-view.ts`'s header.
    const sliceY = deps.sliceY();
    const eyeInRock =
      buried && (sliceY === null || field.worldToVoxel(oy, cs) * cs < sliceY);
    return { origin: [ox, oy, oz], dir: [dx, dy, dz], eyeInRock };
  };

  // The world-space brush centre for a cursor position under the dig-feel contract
  // (field-brush.computeBrushCenter). The eye-in-rock probe + field raycast live
  // HERE — they need the field + camera — while the pure module does the arithmetic.
  // Returns null when there is no camera or the view is singular.
  const computeTarget = (clientX: number, clientY: number): Vec3T | null => {
    const ray = cursorRay(clientX, clientY);
    if (!ray) return null;
    const { origin, dir, eyeInRock } = ray;
    // If the eye is embedded in rock (virgin world or buried), raycastField would
    // hit the origin's OWN voxel at t=0 (raycast.ts: "a start inside rock hits its
    // own voxel at t=0"), so we pass eyeInRock and the pure module mines forward
    // from the eye. When the eye is in (display) air, apply where the ray meets
    // rock, or dig ahead when it reaches maxDist through only air (a cavity aimed
    // at open space). Under an active slice, cursorRay's display-space probe
    // already treats a buried eye at/above the plane as in-air, so strokes land
    // on the sliced surface shown.
    const rc = eyeInRock
      ? null
      : field.raycastField(
          deps.substrate.store,
          origin,
          dir,
          DIG_RANGE_M,
          deps.sliceOpts(),
        );
    return computeBrushCenter(
      { origin, dir, eyeInRock, hit: rc ? rc.point : null },
      deps.digRadius(),
    );
  };

  // The surface point for a box-select click: the RAW raycast hit point — NOT
  // computeTarget's brush-offset centre (a region corner must sit ON the wall,
  // not bitten past it). Falls back to the dig-feel target when the ray misses
  // everything or the eye is buried, so a click into open air still anchors.
  const selectionPoint = (clientX: number, clientY: number): Vec3T | null => {
    const ray = cursorRay(clientX, clientY);
    if (!ray) return null;
    if (!ray.eyeInRock) {
      // Slice-coherent (sliceOpts): a corner clicked under an active slice
      // sits ON the sliced surface shown, not on a hidden wall above it.
      const rc = field.raycastField(
        deps.substrate.store,
        ray.origin,
        ray.dir,
        DIG_RANGE_M,
        deps.sliceOpts(),
      );
      if (rc) return rc.point;
    }
    return computeTarget(clientX, clientY);
  };

  // Material-select seed: the SOLID voxel under the cursor — the raycast hit
  // voxel, or the eye's own voxel when embedded in rock (eyedropper parity).
  // A miss (open air to max range) reports and yields null.
  const materialSeedVoxel = (
    clientX: number,
    clientY: number,
  ): Vec3T | null => {
    const ray = cursorRay(clientX, clientY);
    if (!ray) return null;
    const cs = deps.substrate.store.cellSize;
    if (ray.eyeInRock)
      return [
        field.worldToVoxel(ray.origin[0], cs),
        field.worldToVoxel(ray.origin[1], cs),
        field.worldToVoxel(ray.origin[2], cs),
      ];
    // Slice-coherent (sliceOpts): the flood seed is the first VISIBLE solid
    // under the cursor — the flood itself then runs on the real field.
    const rc = field.raycastField(
      deps.substrate.store,
      ray.origin,
      ray.dir,
      DIG_RANGE_M,
      deps.sliceOpts(),
    );
    if (!rc) {
      deps.reportToolError(
        "material select: no rock under the cursor within range",
      );
      return null;
    }
    return rc.voxel;
  };

  // Void-select seed: the last AIR voxel the ray traverses before its rock
  // hit (FieldHit.prev — guaranteed air here: with the eye in air, every
  // pre-hit voxel the DDA crossed was non-rock). A miss (all air to max
  // range) falls back to the brush TARGET's voxel — computeTarget's
  // open-space point, itself in air on an all-air ray. An eye embedded in
  // rock has no air on the ray at all (the cast self-hits at t=0), so that
  // reports and bails instead of yielding an empty flood.
  const voidSeedVoxel = (clientX: number, clientY: number): Vec3T | null => {
    const ray = cursorRay(clientX, clientY);
    if (!ray) return null;
    if (ray.eyeInRock) {
      deps.reportToolError(
        "void select: the eye is inside rock — aim from open air",
      );
      return null;
    }
    // Slice-coherent (sliceOpts): `prev` then precedes the first VISIBLE rock
    // hit. Under an active slice it can be a display-air voxel that is rock in
    // the real field — the flood then finds no air there and reports "no
    // matching cells" instead of selecting a pocket the display hides.
    const rc = field.raycastField(
      deps.substrate.store,
      ray.origin,
      ray.dir,
      DIG_RANGE_M,
      deps.sliceOpts(),
    );
    if (rc) return rc.prev;
    const target = computeTarget(clientX, clientY);
    if (!target) return null;
    const cs = deps.substrate.store.cellSize;
    return [
      field.worldToVoxel(target[0], cs),
      field.worldToVoxel(target[1], cs),
      field.worldToVoxel(target[2], cs),
    ];
  };

  return {
    cursorRay,
    computeTarget,
    selectionPoint,
    materialSeedVoxel,
    voidSeedVoxel,
    notePointer: (clientX, clientY) => {
      lastPointer = { x: clientX, y: clientY };
    },
    pointer: () => lastPointer,
  };
}
