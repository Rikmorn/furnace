// F0 analyzer probe — the KNOWN-BAD CORPUS. Four geometries, one per capsule-trap
// class, each PROVEN to trap the real `CharacterMover` by the control/trap
// differential in `tests/analyzer-probe.gpu.test.ts`. Stage 3 checks the hybrid
// analyzer flags all four; a fixture only counts as known-bad because the real
// mover demonstrably fails there (Walk-Monster fidelity: test the code, not the data).
//
// TWO CONSTRAINTS SHAPE EVERY NUMBER BELOW. Both come from reading the source, not
// from theory, and both silently void a fixture that ignores them.
//
// 1. THE COLLIDER LATTICE. `voxelsFromField` sign-samples the field at CELL CENTRES
//    at the production cave voxel size [0.5, 0.25, 0.5]. A feature that is not a
//    multiple of 0.5 in XZ (0.25 in Y) does not survive into the collider the capsule
//    actually touches — the field would claim a 0.35 m rise and the collider would
//    serve a 0.25 m one. Every tunable here is therefore a VOXELIZED value.
//
// 2. THE MOVER'S ESCAPE HATCHES (`src/char-move.ts`). Two of them decide what can
//    still trap this mover at all:
//    - `resolve` step-up: on a stalled slide it raises the capsule by exactly
//      STEP_HEIGHT (0.4) and re-slides. So a lip BELOW step height beside a vertical
//      wall does NOT wedge — the raise clears it and the re-slide walks over. MEASURED:
//      a 0.25 m lip with the corridor pinched to a 1.0 m slot (walls 0.5 m either side of
//      the lane, so the hemisphere can two-contact lip + jamb) is climbed and walked the
//      full length (`advanced` 5.12, resting y 1.15 = on the lip). The two-contact wedge
//      that the F0 brief expected here is NOT reproducible against this mover: the only
//      way a sub-step-height lip bites is if the RAISE ITSELF is obstructed, and that is
//      the lintel-clip class below, not a separate wedge class.
//    - `applyGravity` rest sweep: it rests the body on the HIGHEST support under the
//      capsule's footprint (a down-sweep from STEP_HEIGHT above), which is exactly the
//      2.2.1 shapecast-ground fix. So a pocket NARROWER than the capsule is bridged by
//      design — it can no longer be entered, let alone trap. A pocket only traps when
//      it is wide enough for the capsule to fall fully inside AND deeper than
//      STEP_HEIGHT. `POCKET_W` is therefore well ABOVE 2·radius, not below it.
//
// A corollary of (2): every floor the capsule RESTS on needs ~2.2 m of clear air
// above it, because the rest sweep places the whole capsule at `pos.y + STEP_HEIGHT`
// before sweeping down. Start that sweep inside rock and `castShape`
// (stopAtPenetration) returns toi 0, which reads as "ground at pos.y + 0.4" and
// levitates the capsule. The hazards below all stop the capsule SHORT of any low
// ceiling (the mover's SKIN keeps it 0.08 m clear of the blocking face), so none of
// them trips it — but a new fixture that lets the capsule rest under a lintel will.
import { boxCavern, type Field, intersect, union } from "../../src/field.ts";
import {
  type VoxelsProxy,
  voxelProxyPosition,
  voxelsFromField,
} from "../../src/proxy.ts";
import type { GridConfig } from "../../src/surface-nets.ts";

/** The production cave voxel size (`themes/cave.ts`). The analyzer reads this grid and
 *  the capsule touches it, so the corpus must be authored at the same resolution. */
export const FIXTURE_VOXEL_SIZE: [number, number, number] = [0.5, 0.25, 0.5];

/** Shared corridor grid: world x −6..6, y −2..5, z −3..3. Fully contains the corridor
 *  plus the deepest floor pocket — off-grid reads as SOLID, so a room that escaped the
 *  grid would be walled off by the grid boundary instead of by its own geometry. */
const GRID: GridConfig = {
  min: [-6, -2, -3],
  cellSize: 0.5,
  dims: [24, 14, 12],
};

/** Below the grid floor / above the grid ceiling — for rock boxes that must read as
 *  solid all the way out of the sampled volume. */
const BELOW_GRID = -3;
const ABOVE_GRID = 6;
/** Beyond the grid in Z, for boxes that span the corridor's full width. */
const BEYOND_Z = 4;

/** An axis-aligned box as an air-positive field (positive strictly inside it).
 *  `union(room, box(...))` carves it as AIR; `intersect(room, outside(box(...)))`
 *  stamps it as ROCK. */
const box = (
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
): Field =>
  boxCavern(
    (x0 + x1) / 2,
    (y0 + y1) / 2,
    (z0 + z1) / 2,
    (x1 - x0) / 2,
    (y1 - y0) / 2,
    (z1 - z0) / 2,
  );

/** Complement of an air-positive shape: positive OUTSIDE it. Intersecting with this
 *  is how rock is stamped back into a carved room (`field.ts` has no rock primitive). */
const outside =
  (shape: Field): Field =>
  (x, y, z) =>
    -shape(x, y, z);

/** Half-length of the corridor along the walk axis (m). */
const CORRIDOR_HX = 5.5;
/** The shared corridor every fixture is cut from: air x ∈ [−5.5, 5.5], y ∈ [0, 4],
 *  z ∈ [−2, 2]; floor top y = 0, ceiling y = 4. Long enough that a hazard at x ≈ 0 has
 *  4.5 m of open floor BEYOND it — a hazard flush against the far wall is untestable,
 *  because the wall stops a healthy mover anyway. */
const CORRIDOR: Field = boxCavern(0, 2, 0, CORRIDOR_HX, 2, 2);

/** Spawn: 4 m short of every hazard, at the grounded capsule's rest height
 *  (floor 0 + REST_OFFSET 0.9 + SPAWN_RISE 0.1). */
const START_X = -4;
const START_Y = 1.0;
/** Along-dir coordinate a CONTROL walk must reach: past every hazard, short of the
 *  corridor's far wall (x 5.5, where a healthy capsule settles at ≈5.2). */
const CLEAR_ALONG = 4.5;
/** `minY` guard — below the deepest floor a capsule can legitimately reach (the pocket
 *  rests it at y 0.15), so a real fall-through still trips it. */
const FLOOR_Y = -1.0;
/** `maxY` guard. Deliberately TIGHT: 0.85 m above the highest rest height any fixture
 *  legitimately produces (1.15, on the lintel fixture's raised floor), not merely under
 *  the 4 m ceiling. A loose bar here silently accepts the levitating rest sweep from the
 *  header note as a "trap" — the first draft of the lintel fixture did exactly that
 *  (`advanced` was correctly short, but the capsule ended at y 1.714, bobbing, having
 *  started its rest sweep inside the lintel). A trap must be a STALL, so this guard is
 *  what tells the two apart. */
const CEIL_Y = 2.0;

// ── 1. carved-rim-wedge ──────────────────────────────────────────────────────────
/** Rim height (m) — the backlog's class verbatim ("floor-adjacent lips > STEP_HEIGHT 0.4
 *  that stall the capsule"), NOT a sub-step-height lip: per the header, the step-up raise
 *  clears any lip under 0.4 m, wall or no wall.
 *
 *  BUT 0.4 m is NOT the real climb ceiling, and the first draft of this fixture (0.5 m)
 *  did not trap — the capsule walked the entire raised floor (measured `advanced` 5.12,
 *  i.e. the far wall). Two mover behaviours compound to climb a rim well over STEP_HEIGHT:
 *  `slideHorizontal` seeds `move` horizontal but then reassigns it from `clipVelocity`,
 *  and against a rim's top EDGE that normal is diagonal — so the raised capsule slides UP
 *  and over the edge (nothing re-zeros move.y in the loop). That nudges its footprint over
 *  the rim, and `applyGravity`'s highest-support rest sweep then plants it on top.
 *
 *  The edge-slide only happens while the contact normal is diagonal, i.e. while the rim's
 *  top edge is BELOW the raised capsule's bottom-sphere centre (pos.y + STEP_HEIGHT −
 *  halfHeight = 0.7 m). At or above 0.7 m the contact is the rim's flat front FACE, the
 *  normal is (−1,0,0), no Y leaks in, and the capsule stalls. 0.75 m is the first value on
 *  the 0.25 m Y lattice that clears that bar. The 0.4–0.7 m band is a real analyzer
 *  false-POSITIVE zone (stage 1 flags `ledge` there; the mover climbs it) — acceptable for
 *  F0, whose gate is misses, but it is the reason this constant is not 0.5. */
export const RIM_H = 0.75;
/** Rim run (m): the raised floor continues to the corridor's far wall, so the region
 *  above the rim is genuinely open, walkable floor — the lane is topologically open and
 *  only the capsule (not the air) is stopped. */
export const RIM_W = CORRIDOR_HX;

// ── 2. sub-capsule-pocket ────────────────────────────────────────────────────────
/** Pocket width (m) along the walk axis. ABOVE 2·radius (0.6), not below: the rest sweep
 *  bridges anything narrower (header note 2). Even 1.0 m does not trap — measured, the
 *  capsule crosses a 1.0 × 0.75 m pit to the far wall (`advanced` 5.12) dipping all of
 *  0.05 m (`minY` 0.847). The mover goes ungrounded the moment its centre-ray clears the
 *  near rim, but it is still moving at 3 m/s, and by the time it has fallen the ~0.3 m its
 *  ground ray needs to SEE the pocket floor it has drifted ~0.75 m downrange — far enough
 *  to re-touch the far rim, at which point the highest-support rest sweep plants it back
 *  on top. 2.0 m is the first lattice width where that drift still leaves the capsule
 *  clear of BOTH rims, so it commits to the pit. */
export const POCKET_W = 2.0;
/** Pocket depth (m). MUST exceed STEP_HEIGHT (0.4) — a step-up from the pocket floor
 *  raises the capsule 0.4 m, still 0.35 m below the rim, so the far wall keeps blocking. */
export const POCKET_D = 0.75;

// ── 3. tight-corner ──────────────────────────────────────────────────────────────
/** Lane gap (m) between the two slabs. Below the capsule's 0.6 m diameter, and one
 *  collider cell — 0.5 m is the NARROWEST gap the 0.5 m XZ lattice can represent at
 *  all (0.55 quantizes to either 0.5 or 1.0). */
export const GAP = 0.5;
/** Z of the gap's single air column (its cell centre) — the tight-corner lane runs
 *  down it, so this fixture spawns off the corridor's centreline. */
export const LANE_Z = 0.25;
/** Slab thickness along the walk axis (m) — one collider cell. */
const SLAB_X0 = -0.5;
const SLAB_X1 = 0.5;

// ── 4. lintel-clip ───────────────────────────────────────────────────────────────
/** Floor rise (m) through the portal. BELOW STEP_HEIGHT (0.4) and on the 0.25 m Y
 *  lattice → the climb itself is legal; the lintel is what bites. */
export const RISE = 0.25;
/** Clear headroom (m) under the lintel, above the RAISED floor. Below the capsule's
 *  1.8 m height, and on the Y lattice (1.6 would quantize to 1.5 anyway). */
export const HEADROOM = 1.5;
/** Where the floor steps up. Set back ONE collider cell from the portal wall — see
 *  `WALL_X0`. */
const RISE_X = 0;
/** The wall the portal is cut through — one collider cell thick. "Walledness is the
 *  discriminator" (backlog): an ascending low end with no wall is a free-floor
 *  departure, not a clip.
 *
 *  THE SETBACK (wall face at 0.5, rise face at 0) IS LOAD-BEARING, not cosmetic. With the
 *  two flush at x = 0, the capsule slid up the rise's top EDGE (the same diagonal-normal
 *  leak that defeats a 0.5 m rim, see `RIM_H`) until its footprint overlapped the wall —
 *  and its rest sweep, which lifts the whole capsule to `pos.y + STEP_HEIGHT` before
 *  sweeping down, then STARTED INSIDE THE LINTEL. `castShape` is stopAtPenetration, so
 *  that returns toi 0, which reads as "ground at pos.y + 0.4" and levitates the capsule
 *  (measured: it ended at y 1.714, bobbing, instead of stalling). One cell of setback
 *  gives the capsule a patch of full-headroom raised floor to stand on, so it climbs the
 *  rise cleanly and is then stopped by the lintel's front face at its widest point —
 *  a flat (−1,0,0) contact, no Y leak, footprint 0.08 m clear of the wall, no penetration.
 *  A clean stall, which is what a known-bad fixture owes stage 3. */
const WALL_X0 = 0.5;
const WALL_X1 = 1.0;
/** Portal half-width in Z (m); voxelizes to a 1.0 m opening — ample for the 0.6 m
 *  capsule, so width is never the blocking variable here. */
const DOOR_HZ = 0.75;

/** One known-bad geometry: the room WITH its hazard, the same room WITHOUT it, and the
 *  lane that separates them. */
export type Fixture = {
  name: string;
  class:
    | "carved-rim-wedge"
    | "sub-capsule-pocket"
    | "tight-corner"
    | "lintel-clip";
  /** The room WITH the hazard. The mover must NOT get past `hazardAlong` here. */
  field: Field;
  /** The identical room with the hazard REMOVED, nothing else changed. The mover MUST
   *  reach `clearAlong` here — without this half, "the capsule didn't get far" proves
   *  nothing (a short room, a bad spawn, or an exhausted budget reads the same). */
  controlField: Field;
  grid: GridConfig;
  start: [number, number, number];
  dir: [number, number, number];
  /** `runWalk` floor guard: below anything the capsule can legitimately reach. */
  floorY: number;
  /** `runWalk` ceiling guard: above any legitimate rest height. */
  ceilY: number;
  /** Along-dir coordinate the control must pass and the hazard must not. Set past the
   *  hazard's far face by a capsule radius, so clearing it means the capsule is
   *  genuinely THROUGH (and, past it, nothing else stops it before `clearAlong`). */
  hazardAlong: number;
  /** Along-dir coordinate the control walk must reach (open floor past the hazard). */
  clearAlong: number;
};

/** The four known-bad geometries. Each maps to a DIFFERENT column-pass flag kind
 *  (`ledge`, `ledge` from the pit floor, `narrow`, `low-clearance`), so the corpus
 *  exercises all four stage-1 filters rather than one of them four times. */
export function fixtures(): Fixture[] {
  const lane = (z: number): [number, number, number] => [START_X, START_Y, z];
  const common = {
    grid: GRID,
    dir: [1, 0, 0] as [number, number, number],
    floorY: FLOOR_Y,
    ceilY: CEIL_Y,
    clearAlong: CLEAR_ALONG,
  };

  // 1. A carved patch whose rim exceeds the step-up limit. Air fills the corridor above
  //    the rim, so the lane stays topologically open — connectivity says "walkable",
  //    the capsule says otherwise. That gap is the whole point of the analyzer.
  const rim: Fixture = {
    ...common,
    name: "carved-rim",
    class: "carved-rim-wedge",
    field: intersect(
      CORRIDOR,
      outside(box(0, RIM_W, BELOW_GRID, RIM_H, -BEYOND_Z, BEYOND_Z)),
    ),
    controlField: CORRIDOR,
    start: lane(0),
    hazardAlong: 0.5,
  };

  // 2. A pit the capsule walks into and cannot climb out of. It is entered FORWARD (the
  //    ground ray loses the floor, gravity takes over) — a drop-in would rest it neatly
  //    on the pocket floor and hide nothing, which is the 2.2.1 "walk-in, not drop-in"
  //    lesson.
  const pocket: Fixture = {
    ...common,
    name: "floor-pocket",
    class: "sub-capsule-pocket",
    field: union(
      CORRIDOR,
      box(-POCKET_W / 2, POCKET_W / 2, -POCKET_D, 0, -2, 2),
    ),
    controlField: CORRIDOR,
    start: lane(0),
    // The far rim (x = 1.0) plus a capsule radius: past this the capsule is OUT.
    hazardAlong: POCKET_W / 2 + 0.3,
  };

  // 3. Two full-height slabs pinching the lane below the capsule's diameter. Air flows
  //    through the 0.5 m slot; the capsule cannot.
  const corner: Fixture = {
    ...common,
    name: "slab-pinch",
    class: "tight-corner",
    field: intersect(
      CORRIDOR,
      outside(
        box(
          SLAB_X0,
          SLAB_X1,
          BELOW_GRID,
          ABOVE_GRID,
          LANE_Z + GAP / 2,
          BEYOND_Z,
        ),
      ),
      outside(
        box(
          SLAB_X0,
          SLAB_X1,
          BELOW_GRID,
          ABOVE_GRID,
          -BEYOND_Z,
          LANE_Z - GAP / 2,
        ),
      ),
    ),
    controlField: CORRIDOR,
    start: lane(LANE_Z),
    hazardAlong: SLAB_X1 + 0.3,
  };

  // 4. A walled low portal reached by a climb. The capsule climbs the (legal, 0.25 m)
  //    rise onto the setback landing, then fits through the portal neither standing
  //    (1.8 m > 1.5 m headroom) nor stepping (the step-up raise puts its crown at 2.55 m,
  //    deep in the lintel) — so it stalls against the lintel's face having gone nowhere.
  //    The CONTROL keeps the wall, the portal AND the climb and removes only the lintel:
  //    a single-variable differential, so a pass there indicts the lintel and nothing else.
  const walled = intersect(
    CORRIDOR,
    outside(box(WALL_X0, WALL_X1, BELOW_GRID, ABOVE_GRID, -BEYOND_Z, BEYOND_Z)),
    outside(box(RISE_X, CORRIDOR_HX, BELOW_GRID, RISE, -BEYOND_Z, BEYOND_Z)),
  );
  // The portal air overhangs the wall by half a cell each side so it cleanly pierces the
  // wall's single x-column without carving the (already open) cells either side of it.
  const doorway = (top: number): Field =>
    intersect(
      box(WALL_X0 - 0.25, WALL_X1 + 0.25, RISE, top, -DOOR_HZ, DOOR_HZ),
      CORRIDOR,
    );
  const lintel: Fixture = {
    ...common,
    name: "low-portal",
    class: "lintel-clip",
    field: union(walled, doorway(RISE + HEADROOM)),
    controlField: union(walled, doorway(4)), // portal open to the corridor ceiling
    start: lane(0),
    hazardAlong: WALL_X1 + 0.3,
  };

  return [rim, pocket, corner, lintel];
}

/** The voxel collision proxy for a fixture's HAZARD geometry, at the production cave
 *  voxel size — the same `voxelsFromField` call the cave theme makes, so the collider
 *  under test is the one the game would ship. */
export function fixtureProxy(f: Fixture): VoxelsProxy {
  return voxelsFromField(f.field, f.grid, FIXTURE_VOXEL_SIZE);
}

/** The proxy for a fixture's CONTROL geometry (hazard removed). */
export function fixtureControlProxy(f: Fixture): VoxelsProxy {
  return voxelsFromField(f.controlField, f.grid, FIXTURE_VOXEL_SIZE);
}

/** World position for a fixture's proxy body (the fixtures are authored in world space,
 *  so their region origin is the origin). */
export function fixtureProxyPosition(f: Fixture): [number, number, number] {
  return voxelProxyPosition(f.grid, [0, 0, 0]);
}
