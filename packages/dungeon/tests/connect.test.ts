// packages/dungeon/tests/connect.test.ts
import { expect, test } from "bun:test";
import { mat4, quat, vec3 } from "@furnace/core/transform";
import { aabbOfBoxes } from "../src/aabb.ts";
import {
  CEIL_T,
  type ConnectorKind,
  chooseKind,
  connectorSection,
  join,
  LANDING_LEN,
  placePiece,
  RING_RISE,
  route,
  walkLineAt,
} from "../src/connect.ts";
import { clearanceBoxes } from "../src/layout.ts";
import type {
  Aabb,
  Connection,
  InstanceData,
  InstanceGroup,
  RegionCollider,
  RegionData,
  RegionMesh,
  Vec3,
} from "../src/region.ts";
import { STEP_HEIGHT, STEP_MARGIN } from "../src/walkability.ts";

/** A quaternion (x,y,z,w) for a rotation `theta` about an arbitrary (auto-normalized)
 *  axis. Surface-aligned scatter genuinely tilts off +Y, and — critically — a TILTED
 *  local rotation does NOT commute with the placement's +Y yaw, so the composed
 *  orientation is order-sensitive: this is what makes the rotation checks below able to
 *  catch a flipped quaternion-multiply order (two +Y-yaw rotations would commute and hide
 *  it). */
function axisQuat(axis: Vec3, theta: number): [number, number, number, number] {
  const a = vec3.normalize(
    vec3.create(),
    vec3.fromValues(axis[0], axis[1], axis[2]),
  );
  const q = quat.fromAxisAngle(quat.create(), a, theta);
  return [q[0], q[1], q[2], q[3]] as [number, number, number, number];
}

/** Bake a column-major `T·R·S` mat4 per instance — exactly how scatter.ts bakes an
 *  InstanceGroup's `transforms` from its `placements`, so the fixture's two arrays are
 *  consistent in LOCAL frame before `placePiece` transforms them. */
function bakeTransforms(data: InstanceData[]): Float32Array {
  const out = new Float32Array(16 * data.length);
  const m = mat4.create();
  const q = quat.create();
  const tv = vec3.create();
  const sv = vec3.create();
  data.forEach((d, i) => {
    q.set(d.rotation);
    tv.set(d.position);
    sv.fill(d.scale);
    mat4.fromRotationTranslationScale(m, q, tv, sv);
    out.set(m, i * 16);
  });
  return out;
}

function room(door: Connection): RegionData {
  return {
    meshes: [
      { geometry: { box: [1, 1, 1] }, material: 0, position: [2, 0, 0] },
    ],
    colliders: [{ shape: { cuboid: [0.5, 0.5, 0.5] }, position: [2, 0, 0] }],
    materials: [{ color: [1, 1, 1, 1], specular: [0, 0, 0, 8] }],
    connections: [door],
    instances: [],
    origin: [0, 0, 0],
    bounds: aabbOfBoxes([{ center: [2, 0, 0], size: [1, 1, 1] }]),
    provenance: {
      generatorId: "dungeon",
      generatorVersion: 2,
      theme: "pillarHall",
      seed: "x",
    },
  };
}

test("join seats B's portal onto A's: positions meet, facings negate (arbitrary yaw + height)", () => {
  const a: Connection = {
    position: [5, 3, -2],
    facing: [Math.cos(0.4), 0, Math.sin(0.4)],
    width: 2,
    height: 3,
    kind: "door",
  };
  const b: Connection = {
    position: [0, 0, 1],
    facing: [0, 0, 1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const placed = placePiece(room(b), join(a, b));
  const d = placed.connections[0] as Connection;
  expect(d.position[0]).toBeCloseTo(a.position[0], 5);
  expect(d.position[1]).toBeCloseTo(a.position[1], 5); // height carried
  expect(d.position[2]).toBeCloseTo(a.position[2], 5);
  expect(d.facing[0]).toBeCloseTo(-a.facing[0], 5); // facings negate
  expect(d.facing[2]).toBeCloseTo(-a.facing[2], 5);
});

test("join carries rotation onto meshes/colliders (off-axis mesh orientation = yaw)", () => {
  const a: Connection = {
    position: [0, 0, 0],
    facing: [1, 0, 0],
    width: 2,
    height: 3,
    kind: "door",
  };
  const b: Connection = {
    position: [0, 0, 1],
    facing: [0, 0, 1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const placed = placePiece(room(b), join(a, b));
  const m = placed.meshes[0] as RegionMesh;
  expect(m.rotation).toBeDefined();
  const q = quat.fromValues(
    ...(m.rotation as [number, number, number, number]),
  );
  const x = vec3.transformQuat(vec3.create(), vec3.fromValues(1, 0, 0), q);
  expect(x[0] as number).toBeCloseTo(0, 5);
  expect(x[2] as number).toBeCloseTo(1, 5); // Ry(-90°)·X̂ = [0,0,1]
});

test("join cardinal case keeps a box room axis-aligned (regression: matches extent-swap world AABB)", () => {
  const a: Connection = {
    position: [0, 0, 0],
    facing: [0, 0, -1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const b: Connection = {
    position: [0, 0, 1],
    facing: [0, 0, -1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const placed = placePiece(room(b), join(a, b));
  // The real contract: B's door seats onto A's opening at the origin.
  const d = placed.connections[0] as Connection;
  expect(d.position[0]).toBeCloseTo(0, 5);
  expect(d.position[2]).toBeCloseTo(0, 5);
  // The box stays an axis-aligned unit cube under the 180° yaw. Its local [2,0,0]
  // lands at Ry(180)·[2,0,0] + t = [-2,0,0] + [0,0,1] = [-2,0,1]: the door at local
  // [0,0,1] forces a +1 Z translation when it seats onto a.position. (Matches the old
  // compose.ts placeRoom for this fixture.)
  const m = placed.meshes[0] as RegionMesh;
  expect((m.position as Vec3)[0]).toBeCloseTo(-2, 5);
  expect((m.position as Vec3)[2]).toBeCloseTo(1, 5);
});

const P = (position: Vec3, facing: Vec3): Connection => ({
  position,
  facing,
  width: 2,
  height: 3,
  kind: "door",
});

test("chooseKind: flat→corridor, gentle climb→ramp, steep→stairs (pitch over the climb window)", () => {
  expect(chooseKind(0, 4)).toBe("corridor"); // Δh 0
  expect(chooseKind(1, 4)).toBe("ramp"); // ascending: ~14° over the full run, walkable
  expect(chooseKind(4, 1)).toBe("stairs"); // ~76° — too steep for a ramp
  // descending: pitch is measured over the climb window (run − LANDING_LEN)
  expect(chooseKind(-1, 6)).toBe("ramp"); // ~14° over climb 4 (6 − 2), walkable
  expect(chooseKind(-2, 3)).toBe("stairs"); // ~63° over climb 1 (3 − 2), too steep
});

test("walkLineAt: ascending is linear over the full run; descending gets a flat arrival landing", () => {
  // ascending (dh>0): LINEAR — no landing (the low end is a free-floor departure)
  expect(walkLineAt(2, 8, 0)).toBeCloseTo(0, 9);
  expect(walkLineAt(2, 8, 1.5)).toBeCloseTo(0.375, 9); // 2·(1.5/8)
  expect(walkLineAt(2, 8, 4)).toBeCloseTo(1, 9);
  expect(walkLineAt(2, 8, 8)).toBeCloseTo(2, 9);
  // descending (dh<0): flat y=dh across [run − LANDING_LEN, run]
  expect(walkLineAt(-2, 8, 8 - LANDING_LEN)).toBeCloseTo(-2, 9); // z=6
  expect(walkLineAt(-2, 8, 8)).toBeCloseTo(-2, 9);
  expect(walkLineAt(-2, 8, 0)).toBeCloseTo(0, 9);
  // flat + clamps
  expect(walkLineAt(0, 8, 4)).toBeCloseTo(0, 9);
  expect(walkLineAt(2, 8, -1)).toBeCloseTo(0, 9);
  expect(walkLineAt(2, 8, 9)).toBeCloseTo(2, 9);
});

test("route throws setup-loud when a DESCENDING run is too short for its arrival landing", () => {
  // Descending run 2 < LANDING_LEN(2) + MIN_CLIMB_RUN(1) → throws.
  expect(() =>
    route(P([0, 0, 0], [0, 0, 1]), P([0, -2, 2], [0, 0, -1])),
  ).toThrow(/landing/);
  // Ascending has NO landing — a short climbing run just builds (45° ramp here, no throw).
  expect(() =>
    route(P([0, 0, 0], [0, 0, 1]), P([0, 2, 2], [0, 0, -1])),
  ).not.toThrow();
});

test("ramp: descending gets a flat arrival landing; ascending has none (single pitched slab)", () => {
  // Descending: flat support across [run − LANDING_LEN, run] at y = dh (the arrival landing).
  const desc = route(P([0, 0, 0], [0, 0, 1]), P([0, -2, 8], [0, 0, -1]), {
    kind: "ramp",
  });
  const { floors: descFloors } = splitEnclosure(desc, -2, 8, 3);
  for (const z of [8 - LANDING_LEN + 0.05, 7, 7.5, 8]) {
    const covered = descFloors.some(
      (b) => b.min[2] <= z && z <= b.max[2] && Math.abs(b.max[1] - -2) <= 0.05,
    );
    expect(covered).toBe(true);
  }
  // Ascending: a single pitched slab, NO landing (the low end is a free-floor departure).
  const asc = route(P([0, 0, 0], [0, 0, 1]), P([0, 2, 8], [0, 0, -1]), {
    kind: "ramp",
  });
  const { floors: ascFloors } = splitEnclosure(asc, 2, 8, 3);
  expect(ascFloors.length).toBe(1);
});

/** True when a quaternion (x,y,z,w) is (numerically) the identity rotation. `placePiece`
 *  stamps identity [0,0,0,1] on axis-aligned pieces at a yaw=0 join, so "has a rotation
 *  field" no longer distinguishes the pitched ramp slab from the axis-aligned enclosure —
 *  this does. */
function isIdentityQuat(q: [number, number, number, number]): boolean {
  return (
    Math.abs(q[0]) < 1e-9 &&
    Math.abs(q[1]) < 1e-9 &&
    Math.abs(q[2]) < 1e-9 &&
    Math.abs(Math.abs(q[3]) - 1) < 1e-9
  );
}

test("route ramp top face is walkable (normal.y >= SLOPE_LIMIT_COS)", () => {
  const r = route(P([0, 0, 0], [1, 0, 0]), P([4, 1, 0], [-1, 0, 0]), {
    kind: "ramp",
  });
  const m = r.meshes.find(
    (mm) => "box" in mm.geometry && mm.rotation && !isIdentityQuat(mm.rotation),
  );
  expect(m?.rotation).toBeDefined();
  const q = quat.fromValues(
    ...(m?.rotation as [number, number, number, number]),
  );
  const up = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 1, 0), q);
  expect(up[1] as number).toBeGreaterThanOrEqual(
    Math.cos((55 * Math.PI) / 180) - 1e-6,
  );
});

test("route stairs risers stay below STEP_HEIGHT", () => {
  const r = route(P([0, 0, 0], [0, 0, 1]), P([0, 2, 2], [0, 0, -1]), {
    kind: "stairs",
  });
  // Repointed for the enclosure slice: r.colliders now carries walls + ceilings too. The
  // riser check applies to the STEP boxes only — splitEnclosure's `floors` (the walking
  // surface). Riser height = the step AABB's y-extent (axis-aligned → == cuboid[1]*2).
  const { floors } = splitEnclosure(r, 2, 2, 3);
  const stepHeights = floors.map((b) => b.max[1] - b.min[1]);
  const sorted = [...stepHeights].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    expect((sorted[i] as number) - (sorted[i - 1] as number)).toBeLessThan(0.4);
  }
  expect(sorted[0] as number).toBeLessThan(0.4); // first riser
});

test("route corridor overlaps both endpoints (floor spans the join)", () => {
  const from = P([0, 0, 0], [0, 0, 1]);
  const to = P([0, 0, 3], [0, 0, -1]);
  const r = route(from, to);
  expect(r.provenance.theme).toBe("connector");
  const floor = r.meshes[0] as RegionMesh;
  const halfDepth = (floor.geometry as { box: Vec3 }).box[2] / 2;
  const cz = (floor.position as Vec3)[2];
  expect(cz - halfDepth).toBeLessThanOrEqual(0); // covers `from`
  expect(cz + halfDepth).toBeGreaterThanOrEqual(3); // covers `to`
});

test("route throws when a forced ramp can't satisfy the slope limit", () => {
  expect(() =>
    route(P([0, 0, 0], [1, 0, 0]), P([1, 4, 0], [-1, 0, 0]), { kind: "ramp" }),
  ).toThrow();
});

test("route: DESCENDING stairs emit a real staircase (not empty)", () => {
  const from: Connection = {
    position: [0, 6, 0],
    facing: [0, 0, 1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const to: Connection = {
    position: [0, 0, 8],
    facing: [0, 0, -1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const r = route(from, to, { kind: "stairs" });
  expect(r.colliders.length).toBeGreaterThan(10); // steps + enclosure — never empty
  // Repointed for the enclosure slice: the step boxes are FIRST in colliders (floorBoxes
  // before enclosureBoxes), so slice them off — the staircase-span + riser-walkability
  // checks apply to the steps only, not the enclosure walls/ceilings.
  const nSteps = Math.ceil(6 / (STEP_HEIGHT - STEP_MARGIN)); // 18 mirrored steps
  const steps = r.colliders.slice(0, nSteps);
  // the staircase spans the full height band [0, 6]
  const tops = steps.map(
    (c) => c.position[1] + ("cuboid" in c.shape ? c.shape.cuboid[1] : 0),
  );
  expect(Math.max(...tops)).toBeGreaterThan(5.5);
  expect(Math.min(...tops)).toBeLessThan(1.0);
  // and every riser is walkable
  const sorted = [...tops].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    expect((sorted[i] as number) - (sorted[i - 1] as number)).toBeLessThan(0.4);
  }
});

test("route: forced STEEP DESCENDING ramp throws setup-loud", () => {
  const from: Connection = {
    position: [0, 10, 0],
    facing: [0, 0, 1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const to: Connection = {
    position: [0, 0, 3],
    facing: [0, 0, -1],
    width: 2,
    height: 3,
    kind: "door",
  };
  expect(() => route(from, to, { kind: "ramp" })).toThrow(/slope limit/);
});

test("route: forced stairs on a ~flat span throws setup-loud (would emit zero steps)", () => {
  const from: Connection = {
    position: [0, 0, 0],
    facing: [0, 0, 1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const to: Connection = {
    position: [0, 0, 8],
    facing: [0, 0, -1],
    width: 2,
    height: 3,
    kind: "door",
  };
  expect(() => route(from, to, { kind: "stairs" })).toThrow(/flat/);
});

test("route: gentle descending ramp still builds (signed pitch kept)", () => {
  const from: Connection = {
    position: [0, 2, 0],
    facing: [0, 0, 1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const to: Connection = {
    position: [0, 0, 10],
    facing: [0, 0, -1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const r = route(from, to, { kind: "ramp" });
  // Repointed for the enclosure slice: r.meshes now carries the floor slab PLUS axis-aligned
  // enclosure boxes. `placePiece` stamps identity [0,0,0,1] on the axis-aligned enclosure at
  // this yaw=0 join, so "has a rotation field" no longer isolates the pitched slab — filter
  // for the NON-IDENTITY rotation. The pitched floor slab must be the only such mesh.
  const pitched = r.meshes.filter(
    (m) => m.rotation && !isIdentityQuat(m.rotation),
  );
  expect(pitched.length).toBe(1);
  expect(r.meshes[0]?.rotation).toBeDefined(); // floor is first, carries the pitch
});

test("placePiece transforms a group's placements into world frame, consistent with the baked transforms", () => {
  // Ported from the deleted compose.test.ts placeRoom coverage (placeRoom was just
  // placePiece(room, join(...))). This is the ONLY test of placePiece's instance path —
  // the path realize.ts uses to build colliders/bodies for solid/dynamic scatter on the
  // PLACED world's rooms. A regression in either sub-path (the mat4×transforms matrix path
  // OR the xf/compose placements path — e.g. a flipped quaternion-multiply order) would
  // otherwise go undetected: every other fixture uses `instances: []`.
  //
  // Fixture: an InstanceGroup whose baked `transforms` are the exact T·R·S of its
  // `placements` (as scatter bakes them). Each instance has a TILTED (off-+Y) rotation,
  // an off-origin position, and a non-unit scale, so nothing below is vacuously true AND
  // the composed orientation is order-sensitive (see axisQuat).
  const locals: InstanceData[] = [
    {
      position: [1, 0, 2],
      rotation: axisQuat([1, 2, 0], 0.5),
      scale: 1.4,
      tint: [1, 1, 1, 1],
    },
    {
      position: [-2, 0.5, 1],
      rotation: axisQuat([0, 1, 1], 1.3),
      scale: 0.7,
      tint: [1, 1, 1, 1],
    },
    {
      position: [3, 0, -1],
      rotation: axisQuat([1, 0, 2], 2.1),
      scale: 1.1,
      tint: [1, 1, 1, 1],
    },
  ];
  const group: InstanceGroup = {
    geometry: { primitive: "cube" },
    material: 0,
    posture: "lit",
    collision: "dynamic",
    placements: locals.map((d) => ({ ...d })),
    transforms: bakeTransforms(locals),
    tints: new Float32Array(locals.flatMap((d) => d.tint)),
  };
  const door: Connection = {
    position: [0, 0, 1],
    facing: [0, 0, 1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const region: RegionData = { ...room(door), instances: [group] };

  const place = { yaw: Math.PI / 2, translation: [10, 5, -3] as Vec3 };
  const { yaw, translation: t } = place;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Independent ground truth (connect.ts's rotateY convention: Ry(θ)·[x,y,z] =
  // [x·c + z·s, y, −x·s + z·c]). Pins BOTH paths to the expected world transform, so a
  // no-op regression (placements/transforms left in local frame) fails here too.
  const expectWorldPos = (p: Vec3): Vec3 => [
    p[0] * c + p[2] * s + t[0],
    p[1] + t[1],
    -p[0] * s + p[2] * c + t[2],
  ];
  const qYaw = quat.fromAxisAngle(quat.create(), vec3.fromValues(0, 1, 0), yaw);

  const placed = placePiece(region, place);
  const g = placed.instances[0] as InstanceGroup;
  expect(g.placements?.length).toBe(g.transforms.length / 16);

  (g.placements as InstanceData[]).forEach((p, i) => {
    const local = locals[i] as InstanceData;
    const wp = expectWorldPos(local.position);
    // (a) placement position IS the world transform (not left in local frame).
    expect(p.position[0]).toBeCloseTo(wp[0], 4);
    expect(p.position[1]).toBeCloseTo(wp[1], 4);
    expect(p.position[2]).toBeCloseTo(wp[2], 4);
    // (b) the baked transform's translation column agrees with the placement position.
    expect(g.transforms[i * 16 + 12] as number).toBeCloseTo(p.position[0], 4);
    expect(g.transforms[i * 16 + 13] as number).toBeCloseTo(p.position[1], 4);
    expect(g.transforms[i * 16 + 14] as number).toBeCloseTo(p.position[2], 4);

    // Expected world orientation = qYaw ⊗ localRotation (ORDER MATTERS for a tilted
    // localRotation). Compare full basis-vector images — X̂ and Ẑ, all three components —
    // which pin the whole rotation, not just its yaw. A flipped multiply order changes
    // these for a tilted rotation and fails (c); a broken matrix path fails (d).
    const qExpected = quat.multiply(
      quat.create(),
      qYaw,
      quat.fromValues(...local.rotation),
    );
    const imageOf = (basis: Vec3, q: Float32Array): Float32Array =>
      vec3.normalize(
        vec3.create(),
        vec3.transformQuat(vec3.create(), vec3.fromValues(...basis), q),
      );
    const xExpected = imageOf([1, 0, 0], qExpected);
    const zExpected = imageOf([0, 0, 1], qExpected);

    // (c) placement rotation carries the composed world orientation.
    const pq = quat.fromValues(...p.rotation);
    const xFromQuat = imageOf([1, 0, 0], pq);
    const zFromQuat = imageOf([0, 0, 1], pq);
    for (let k = 0; k < 3; k++) {
      expect(xFromQuat[k] as number).toBeCloseTo(xExpected[k] as number, 4);
      expect(zFromQuat[k] as number).toBeCloseTo(zExpected[k] as number, 4);
    }
    // (d) the baked transform's normalized X/Z basis (columns 0 and 2) agree too — the
    // matrix path and the placement path are computed independently in placePiece.
    const xCol = vec3.normalize(
      vec3.create(),
      vec3.fromValues(
        g.transforms[i * 16] as number,
        g.transforms[i * 16 + 1] as number,
        g.transforms[i * 16 + 2] as number,
      ),
    );
    const zCol = vec3.normalize(
      vec3.create(),
      vec3.fromValues(
        g.transforms[i * 16 + 8] as number,
        g.transforms[i * 16 + 9] as number,
        g.transforms[i * 16 + 10] as number,
      ),
    );
    for (let k = 0; k < 3; k++) {
      expect(xCol[k] as number).toBeCloseTo(xExpected[k] as number, 4);
      expect(zCol[k] as number).toBeCloseTo(zExpected[k] as number, 4);
    }
  });
});

test("placePiece transforms bounds conservatively (yaw 90° + translate)", () => {
  const door: Connection = {
    position: [0, 0, 1],
    facing: [0, 0, 1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const region = room(door);
  region.bounds = { min: [-1, 0, -2], max: [1, 2, 2] };
  const placed = placePiece(region, {
    yaw: Math.PI / 2,
    translation: [10, 5, 0],
  });
  expect(placed.bounds.min[0]).toBeCloseTo(10 - 2, 5);
  expect(placed.bounds.max[0]).toBeCloseTo(10 + 2, 5);
  expect(placed.bounds.min[1]).toBeCloseTo(5, 5);
  expect(placed.bounds.max[1]).toBeCloseTo(7, 5);
  expect(placed.bounds.min[2]).toBeCloseTo(-1, 5);
  expect(placed.bounds.max[2]).toBeCloseTo(1, 5);
});

test("connectorSection: outer width = max portal width + shoulders; headroom = max height", () => {
  const a: Connection = {
    position: [0, 0, 0],
    facing: [0, 0, 1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const b: Connection = {
    position: [0, 0, 6],
    facing: [0, 0, -1],
    width: 1.6,
    height: 3.2,
    kind: "tunnel-mouth",
  };
  const s = connectorSection(a, b);
  expect(s.width).toBeCloseTo(2 + 0.8, 5); // max(2, 1.6) + 2·SHOULDER(0.4)
  expect(s.headroom).toBeCloseTo(3.2, 5); // max(3, 3.2)
});

test("RING_RISE stays below CEIL_T (adjacent ring ceilings must overlap — the seal invariant)", () => {
  expect(RING_RISE).toBeLessThan(CEIL_T);
});

/** Minimal portal for enclosure tests (width 2, height 3 unless a kind needs otherwise). */
const conn = (
  position: Vec3,
  facing: Vec3,
  kind: Connection["kind"] = "door",
): Connection => ({ position, facing, width: 2, height: 3, kind });

/** World AABB of one cuboid collider (rotation-aware via aabbOfBoxes). */
function colliderAabb(c: RegionCollider): Aabb {
  if (!("cuboid" in c.shape)) throw new Error("expected cuboid collider");
  const h = c.shape.cuboid;
  return aabbOfBoxes([
    {
      center: c.position,
      size: [h[0] * 2, h[1] * 2, h[2] * 2],
      rotation: c.rotation,
    },
  ]);
}

/** Classify a +Z, from-at-origin connector's colliders. Walls hug the ±x edges;
 *  ceilings are centred boxes whose underside sits at/above the local climb line +
 *  headroom; everything else is floor (slab or steps). */
function splitEnclosure(
  r: RegionData,
  dh: number,
  run: number,
  headroom: number,
) {
  const climbAt = (z: number): number => walkLineAt(dh, run, z);
  const boxes = r.colliders.map(colliderAabb);
  const cx = (b: Aabb): number => (b.min[0] + b.max[0]) / 2;
  const walls = boxes.filter((b) => Math.abs(cx(b)) > 0.5);
  const ceilings = boxes.filter(
    (b) =>
      Math.abs(cx(b)) <= 0.5 &&
      b.min[1] >= climbAt((b.min[2] + b.max[2]) / 2) + headroom - 1e-6,
  );
  const floors = boxes.filter(
    (b) => !walls.includes(b) && !ceilings.includes(b),
  );
  return { boxes, walls, ceilings, floors, climbAt };
}

test("corridor tube: floor + 2 walls + 1 ceiling, sealed, flush at door planes", () => {
  const r = route(conn([0, 0, 0], [0, 0, 1]), conn([0, 0, 6], [0, 0, -1]));
  const { walls, ceilings, floors } = splitEnclosure(r, 0, 6, 3);
  expect(floors.length).toBe(1);
  expect(walls.length).toBe(2);
  expect(ceilings.length).toBe(1);
  const c = ceilings[0] as Aabb;
  expect(c.min[1]).toBeCloseTo(3, 5); // underside at headroom
  expect(c.max[1]).toBeCloseTo(3 + CEIL_T, 5);
  for (const wb of walls) {
    // Inner face stays clear of the 2 m portal opening (walls live in the shoulder band).
    expect(
      Math.min(Math.abs(wb.min[0]), Math.abs(wb.max[0])),
    ).toBeGreaterThanOrEqual(1);
    expect(wb.min[1]).toBeCloseTo(0, 5); // no gap under the wall
    expect(wb.max[1]).toBeCloseTo(c.max[1], 5); // wall reaches the ceiling top
    expect(wb.min[2]).toBeCloseTo(0, 5); // door ends: flush at both portal planes
    expect(wb.max[2]).toBeCloseTo(6, 5);
  }
  expect(r.meshes.length).toBe(r.colliders.length); // mesh/collider parity
});

test("tunnel-mouth end extends the enclosure into the rock; door end stays flush", () => {
  const r = route(
    conn([0, 0, 0], [0, 0, 1], "tunnel-mouth"),
    conn([0, 0, 6], [0, 0, -1]),
  );
  const { walls, ceilings } = splitEnclosure(r, 0, 6, 3);
  for (const b of [...walls, ...ceilings]) {
    expect(b.min[2]).toBeCloseTo(-0.6, 5); // SEAM_OVERLAP embed at the mouth
    expect(b.max[2]).toBeCloseTo(6, 5); // flush at the door
  }
});

test("ramp tube: ringed enclosure, interior >= headroom, ring ceilings overlap-sealed", () => {
  const dh = 2;
  const run = 8; // pitch ~14° → auto ramp
  const r = route(conn([0, 0, 0], [0, 0, 1]), conn([0, dh, run], [0, 0, -1]));
  const { walls, ceilings, floors } = splitEnclosure(r, dh, run, 3);
  expect(floors.length).toBe(1); // single pitched slab — ascending has no landing
  const nRings = Math.ceil(dh / RING_RISE); // ascending: linear over the full run → dh/RING_RISE
  expect(ceilings.length).toBe(nRings);
  expect(walls.length).toBe(2 * nRings);
  const sorted = [...ceilings].sort((a, b) => a.min[2] - b.min[2]);
  for (let i = 1; i < sorted.length; i++) {
    // Seal: adjacent ring ceilings overlap vertically (RING_RISE < CEIL_T).
    expect((sorted[i] as Aabb).min[1]).toBeLessThanOrEqual(
      (sorted[i - 1] as Aabb).max[1] + 1e-6,
    );
  }
  for (let z = 0.05; z < run; z += 0.25) {
    const climb = walkLineAt(dh, run, z);
    const covering = sorted.filter((c) => c.min[2] <= z && z <= c.max[2]);
    expect(covering.length).toBeGreaterThan(0);
    const underside = Math.min(...covering.map((c) => c.min[1]));
    expect(underside - climb).toBeGreaterThanOrEqual(3 - 1e-6); // interior >= H everywhere
    expect(underside - climb).toBeLessThanOrEqual(3 + RING_RISE + 1e-6); // bounded wobble
  }
});

test("descending forced stairs: ringed tube over the mirrored steps, no gap under walls", () => {
  const dh = -2;
  const run = 4;
  const r = route(conn([0, 0, 0], [0, 0, 1]), conn([0, dh, run], [0, 0, -1]), {
    kind: "stairs",
  });
  const { walls, ceilings, floors, climbAt } = splitEnclosure(r, dh, run, 3);
  expect(floors.length).toBe(8); // 6 mirrored steps (ceil(2/(STEP_HEIGHT−STEP_MARGIN))) + landing + top apron
  const nRings = Math.ceil(((2 / (run - LANDING_LEN)) * run) / RING_RISE); // (2/2.0)·4/0.25 = 16
  expect(ceilings.length).toBe(nRings);
  expect(walls.length).toBe(2 * nRings);
  for (const wb of walls) {
    const base = Math.min(climbAt(wb.min[2]), climbAt(wb.max[2]));
    expect(wb.min[1]).toBeLessThanOrEqual(base + 1e-6); // wall base at/below the climb line
  }
});

test("tunnel-ended ramp: ring rise stays <= RING_RISE across the extended span (seal holds)", () => {
  const r = route(
    conn([0, 0, 0], [0, 0, 1], "tunnel-mouth"),
    conn([0, 3, 7], [0, 0, -1], "tunnel-mouth"),
  );
  const { ceilings } = splitEnclosure(r, 3, 7, 3);
  const sorted = [...ceilings].sort((a, b) => a.min[2] - b.min[2]);
  for (let i = 1; i < sorted.length; i++) {
    expect((sorted[i] as Aabb).min[1]).toBeLessThanOrEqual(
      (sorted[i - 1] as Aabb).max[1] + 1e-6,
    );
  }
});

test("open style: rail-height walls, no ceiling", () => {
  const r = route(conn([0, 0, 0], [0, 0, 1]), conn([0, 0, 6], [0, 0, -1]), {
    enclosure: "open",
  });
  const { walls, ceilings } = splitEnclosure(r, 0, 6, 3);
  expect(ceilings.length).toBe(0);
  expect(walls.length).toBe(2);
  for (const wb of walls) {
    expect(wb.max[1]).toBeCloseTo(1.1, 5); // RAIL_H
  }
});

test("enclosure stays inside the placer's grown clearance volume (containment contract)", () => {
  // Both climb signs, both kinds — the landing profile must stay contained everywhere.
  const cases: { to: Connection; dh: number; kind?: ConnectorKind }[] = [
    { to: conn([0, 3, 9], [0, 0, -1]), dh: 3 }, // auto ramp (climb-window pitch ~21.8°)
    { to: conn([0, -4, 9], [0, 0, -1]), dh: -4, kind: "stairs" }, // forced descent
  ];
  for (const { to, dh, kind } of cases) {
    const from = conn([0, 0, 0], [0, 0, 1]);
    const r = kind ? route(from, to, { kind }) : route(from, to);
    const clearance = clearanceBoxes(from, to);
    const { walls, ceilings } = splitEnclosure(r, dh, 9, 3);
    for (const box of [...walls, ...ceilings]) {
      for (let z = box.min[2] + 0.01; z < box.max[2]; z += 0.1) {
        const covering = clearance.filter(
          (cl) => cl.min[2] <= z && z <= cl.max[2],
        );
        expect(covering.length).toBeGreaterThan(0);
        const yHi = Math.max(...covering.map((cl) => cl.max[1]));
        const xHi = Math.max(...covering.map((cl) => cl.max[0]));
        expect(box.max[1]).toBeLessThanOrEqual(yHi + 1e-6);
        expect(box.max[0]).toBeLessThanOrEqual(xHi + 1e-6);
        expect(box.min[0]).toBeGreaterThanOrEqual(-xHi - 1e-6);
      }
    }
  }
});

test("stair floors carry end aprons: the walking surface spans past both portal planes", () => {
  // The 2.2.5b-A gate fall-through shape: a long, shallow forced descent — treads end
  // half a (large) tread short of the lower portal, and the room floor only starts half
  // a wall-thickness past it. The aprons must close that band at both ends.
  const dh = -10;
  const run = 14;
  const r = route(conn([0, 0, 0], [0, 0, 1]), conn([0, dh, run], [0, 0, -1]), {
    kind: "stairs",
  });
  const { floors } = splitEnclosure(r, dh, run, 3);
  const supported = (z: number, walkY: number): boolean =>
    floors.some(
      (b) =>
        b.min[2] <= z && z <= b.max[2] && Math.abs(b.max[1] - walkY) <= 0.4,
    );
  for (let z = -0.5; z <= 0.5; z += 0.1) {
    expect(supported(z, 0)).toBe(true); // upper portal threshold
  }
  for (let z = run - LANDING_LEN; z <= run + 0.5; z += 0.1) {
    expect(supported(z, dh)).toBe(true); // lower portal threshold (the gate hole)
  }
});
