// The CPU pick math, pure (the field-ghost.ts / field-placements.ts sibling):
// the two ray tests and the arbitration between them. No host, no GPU, no core.
//
// Every `t` here is a distance in METRES, which is only true because the module
// requires a UNIT `dir` — the host's `cursorRay` gets that from
// `camera.screenToRay` (which normalizes) and the field raycast measures its own
// hit the same way. A test that fed a non-unit direction would be measuring in
// ray-lengths and would agree with nothing.
import { expect, test } from "bun:test";
import {
  type PickCandidate,
  pickNearest,
  rayAabbT,
  rayObbT,
} from "../../src/field-host/field-pick.ts";

/** Unit quaternion `[x, y, z, w]` for a rotation about +Y (the only axis the
 *  cases below need — a wall prop's yaw). */
const yawQuat = (radians: number): [number, number, number, number] => [
  0,
  Math.sin(radians / 2),
  0,
  Math.cos(radians / 2),
];

const RAY_X = {
  origin: [0, 0, 0] as [number, number, number],
  dir: [1, 0, 0] as [number, number, number],
};

// --- rayAabbT ---------------------------------------------------------------

test("rayAabbT: slab test returns the ENTRY t, and misses behind the origin", () => {
  // Straight through a box 3 m ahead: the entry face, not the centre or the exit.
  expect(rayAabbT(RAY_X, { min: [3, -1, -1], max: [5, 1, 1] })).toBeCloseTo(
    3,
    10,
  );

  // Entirely BEHIND the origin: both slab crossings are negative. A picker that
  // returned |t| would select whatever is behind the camera.
  expect(rayAabbT(RAY_X, { min: [-5, -1, -1], max: [-3, 1, 1] })).toBeNull();

  // Off to one side — the Y slab never opens while the X slab is open.
  expect(rayAabbT(RAY_X, { min: [3, 4, -1], max: [5, 6, 1] })).toBeNull();
});

test("rayAabbT: an origin INSIDE the box hits at t = 0", () => {
  // The editor camera flies inside the space an entity carved, so this is the
  // normal case, not the corner one: an enclosing box is hit at zero distance.
  expect(rayAabbT(RAY_X, { min: [-1, -1, -1], max: [1, 1, 1] })).toBe(0);
});

test("rayAabbT: a ray parallel to a slab it sits outside of misses", () => {
  // dir.y === 0 with the origin above the box: the Y slab is degenerate and the
  // test must reject rather than divide its way to ±Infinity and admit the box.
  const ray = { origin: [0, 5, 0] as const, dir: [1, 0, 0] as const };
  expect(
    rayAabbT(
      { origin: [...ray.origin], dir: [...ray.dir] },
      { min: [3, -1, -1], max: [5, 1, 1] },
    ),
  ).toBeNull();
});

// --- rayObbT ----------------------------------------------------------------

test("rayObbT: the ROTATION decides the hit, and its DIRECTION does too", () => {
  // A thin slab: 4 m across its local X, 0.4 m through its local Z, yawed 45° —
  // a leaning wall prop's pose. 45° and not 90°, deliberately: a box yawed ±90°
  // occupies the SAME volume either way (it is centre-symmetric), so a 90° case
  // cannot tell the conjugate rotation from the forward one and would stay green
  // with the inverse dropped. At 45° the two differ by a metre of entry
  // distance, which is what makes this case able to fail.
  const obb = {
    center: [5, 0, 0] as [number, number, number],
    halfExtents: [2, 1, 0.2] as [number, number, number],
    quat: yawQuat(Math.PI / 4),
  };
  // Entry through the slab's near face, solved on paper: the local-Z bound
  // `sin45·(x − 5 + 0.5) = −0.2` puts the face at x = 4.5 − 0.2·√2.
  const NEAR_FACE_T = 4.5 - 0.2 * Math.SQRT2;

  const offset = {
    origin: [0, 0, 0.5] as [number, number, number],
    dir: [1, 0, 0] as [number, number, number],
  };
  expect(rayObbT(offset, obb)).toBeCloseTo(NEAR_FACE_T, 10);
  // The same box UNROTATED is only 0.4 m deep in Z and this ray misses it, which
  // is what makes this a rotation test and not a box test.
  expect(rayAabbT(offset, { min: [3, -1, -0.2], max: [7, 1, 0.2] })).toBeNull();
  // Rotated the OTHER way the slab leans away from the ray and is met a metre
  // further out — the assertion that fails if the local-frame transform uses the
  // quaternion instead of its conjugate.
  expect(rayObbT(offset, { ...obb, quat: yawQuat(-Math.PI / 4) })).toBeCloseTo(
    5.5 - 0.2 * Math.SQRT2,
    10,
  );

  // Well past the slab's own 4 m extent: a miss, so the local-frame slab test is
  // really bounded and not just "anything roughly over there".
  expect(rayObbT({ ...offset, origin: [0, 0, 3] }, obb)).toBeNull();

  // Grazing exactly on the Y edge still counts — a yaw leaves local Y alone, and
  // an inclusive boundary keeps a click on a prop's silhouette from falling
  // through it.
  expect(rayObbT({ ...offset, origin: [0, 1, 0.5] }, obb)).toBeCloseTo(
    NEAR_FACE_T,
    10,
  );
});

test("rayObbT: an identity quaternion degenerates to the AABB test", () => {
  const t = rayObbT(RAY_X, {
    center: [4, 0, 0],
    halfExtents: [1, 1, 1],
    quat: [0, 0, 0, 1],
  });
  expect(t).toBeCloseTo(3, 10);
  expect(t).toBe(rayAabbT(RAY_X, { min: [3, -1, -1], max: [5, 1, 1] }));
});

// --- pickNearest ------------------------------------------------------------

const entityAt = (t: number, entityId = 1): PickCandidate => ({
  kind: "entity",
  entityId,
  aabb: { min: [t, -1, -1], max: [t + 1, 1, 1] },
});

const propAt = (t: number, entityId = 2): PickCandidate => ({
  kind: "prop",
  entityId,
  obb: {
    center: [t + 0.5, 0, 0],
    halfExtents: [0.5, 0.5, 0.5],
    quat: [0, 0, 0, 1],
  },
});

const flagAt = (t: number, key = "narrow@1,0,0"): PickCandidate => ({
  kind: "flag",
  key,
  aabb: { min: [t, -0.25, -0.25], max: [t + 0.5, 0.25, 0.25] },
});

test("pickNearest: the nearest OBJECT wins, and terrain occludes everything behind it", () => {
  const candidates = [entityAt(5), propAt(3), flagAt(8)];
  // Prop at 3 beats the flag at 8; the entity footprint at 5 is a volume and
  // loses to any object in front of the terrain anyway.
  expect(pickNearest(RAY_X, candidates, 6)).toEqual(propAt(3));

  // Terrain at 2 is in front of all three: the click landed on rock, and the
  // CALLER reads that null as "deselect".
  expect(pickNearest(RAY_X, candidates, 2)).toBeNull();

  // Nothing at all in range is the same null.
  expect(pickNearest(RAY_X, [], 30)).toBeNull();
});

test("pickNearest: a marker's pick volume is its CELL box, lifted half a cell", () => {
  // The drawn marker is FLAG_MARKER_SIZE_M = 0.18 m and sits half a cell above
  // `flag.world` (the host lifts it so the pin stands in the AIR cell the flag
  // anchors on rather than sunk into the floor). The pick volume is the whole
  // 0.5 m CELL at that lifted centre, so the click target is the cell and the
  // 0.18 m pin is only what it looks like.
  const cell = 0.5;
  const world: [number, number, number] = [4, 2, 0];
  const centre: [number, number, number] = [
    world[0],
    world[1] + cell / 2,
    world[2],
  ];
  const marker: PickCandidate = {
    kind: "flag",
    key: "narrow@16,8,0",
    aabb: {
      min: [centre[0] - cell / 2, centre[1] - cell / 2, centre[2] - cell / 2],
      max: [centre[0] + cell / 2, centre[1] + cell / 2, centre[2] + cell / 2],
    },
  };

  // A ray through the flag's own anchor height (world[1] + 0.2) — INSIDE the
  // lifted cell but 0.2 m above the drawn pin's centre, i.e. outside a 0.18 m
  // box. Picking the drawn size instead of the cell would miss this click.
  const ray = {
    origin: [0, world[1] + 0.2, 0] as [number, number, number],
    dir: [1, 0, 0] as [number, number, number],
  };
  expect(pickNearest(ray, [marker], 30)).toEqual(marker);

  // The LIFT is load-bearing: a box centred on the unlifted `flag.world` spans
  // [1.75, 2.25] in Y, and this ray at 2.2 would still hit it — so assert the
  // lift from the side that can fail, a ray ABOVE the unlifted box and inside
  // the lifted one.
  const high = {
    origin: [0, world[1] + 0.4, 0] as [number, number, number],
    dir: [1, 0, 0] as [number, number, number],
  };
  expect(pickNearest(high, [marker], 30)).toEqual(marker);
});

test("pickNearest: an ENCLOSING entity footprint never shadows an object in front of it", () => {
  // The editor camera lives inside the space its entities carved, so an entity
  // footprint containing the eye hits at t = 0 and would win every click on
  // pure nearest-wins — making every prop and marker in the room unpickable.
  // Objects (props, markers) are resolved first; footprints are the fallback.
  const enclosing: PickCandidate = {
    kind: "entity",
    entityId: 7,
    aabb: { min: [-10, -10, -10], max: [10, 10, 10] },
  };
  expect(pickNearest(RAY_X, [enclosing, propAt(3)], 30)).toEqual(propAt(3));
  // With no object to prefer, the enclosing footprint IS the answer — clicking
  // a bare wall inside a room selects the room.
  expect(pickNearest(RAY_X, [enclosing], 30)).toEqual(enclosing);
  // …and it is still occluded: terrain in front of the room's own box means the
  // click landed on something the room does not own.
  expect(pickNearest(RAY_X, [entityAt(5)], 2)).toBeNull();
});

test("pickNearest: the maxT bound is INCLUSIVE, and one epsilon past it is not", () => {
  // A candidate whose entry lands exactly on the terrain hit is not BEHIND it —
  // a carve entity's footprint face sitting on the rock face it carved is the
  // normal case. It also matches `raycastField`'s own `t > maxDist` reach, so
  // the pick and the DDA that feeds it agree about the boundary.
  const at5 = entityAt(5); // enters at exactly t = 5
  expect(pickNearest(RAY_X, [at5], 5)).toEqual(at5);
  // …and the other side of the boundary really is the other side.
  expect(pickNearest(RAY_X, [at5], 5 - Number.EPSILON * 8)).toBeNull();
});

test("pickNearest: a tie inside one tier goes to the SMALLER volume", () => {
  // Two footprints that both enclose the ray origin both enter at t = 0 — the
  // nested-entity case (a scatter inside a hall). Distance has nothing to say,
  // so the more SPECIFIC answer wins: the inner box, whichever order the host
  // built the candidates in. Log order would answer differently depending on
  // commit order, which is a fact the user cannot see.
  const outer: PickCandidate = {
    kind: "entity",
    entityId: 1,
    aabb: { min: [-10, -10, -10], max: [10, 10, 10] },
  };
  const inner: PickCandidate = {
    kind: "entity",
    entityId: 2,
    aabb: { min: [-2, -2, -2], max: [2, 2, 2] },
  };
  expect(pickNearest(RAY_X, [outer, inner], 30)).toEqual(inner);
  expect(pickNearest(RAY_X, [inner, outer], 30)).toEqual(inner);
});

test("pickNearest: volume breaks TIES only — distance still decides disjoint boxes", () => {
  // The small box is across the room and the big one is under the cursor. A
  // smallest-wins rule applied wholesale would reach past the near box for the
  // far one; the tie-break must not touch this.
  const near: PickCandidate = {
    kind: "entity",
    entityId: 1,
    aabb: { min: [2, -5, -5], max: [8, 5, 5] },
  };
  const far: PickCandidate = {
    kind: "entity",
    entityId: 2,
    aabb: { min: [20, -0.1, -0.1], max: [20.2, 0.1, 0.1] },
  };
  expect(pickNearest(RAY_X, [near, far], 30)).toEqual(near);
  expect(pickNearest(RAY_X, [far, near], 30)).toEqual(near);
});

test("pickNearest: equal t AND equal volume still falls to the earlier candidate", () => {
  // Two identical boxes: nothing separates them at all, so the answer is array
  // order — deterministic rather than merely unspecified, which is what lets a
  // caller reason about repeat clicks.
  const box = { min: [-1, -1, -1] as const, max: [1, 1, 1] as const };
  const first: PickCandidate = {
    kind: "entity",
    entityId: 1,
    aabb: { min: [...box.min], max: [...box.max] },
  };
  const second: PickCandidate = {
    kind: "entity",
    entityId: 2,
    aabb: { min: [...box.min], max: [...box.max] },
  };
  expect(pickNearest(RAY_X, [first, second], 30)).toEqual(first);
  expect(pickNearest(RAY_X, [second, first], 30)).toEqual(second);
});

test("pickNearest: nearest wins WITHIN the object tier, whatever the kinds", () => {
  // Flag in front of prop and prop in front of flag, same candidate list order
  // both times — so the answer is the distance, not the array position.
  expect(pickNearest(RAY_X, [propAt(4), flagAt(2)], 30)).toEqual(flagAt(2));
  expect(pickNearest(RAY_X, [propAt(2), flagAt(4)], 30)).toEqual(propAt(2));
});
