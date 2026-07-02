// packages/dungeon/tests/connect.test.ts
import { expect, test } from "bun:test";
import { mat4, quat, vec3 } from "@furnace/core/transform";
import { aabbOfBoxes } from "../src/aabb.ts";
import {
  CEIL_T,
  chooseKind,
  connectorSection,
  join,
  placePiece,
  RING_RISE,
  route,
} from "../src/connect.ts";
import type {
  Connection,
  InstanceData,
  InstanceGroup,
  RegionData,
  RegionMesh,
  Vec3,
} from "../src/region.ts";

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

test("chooseKind: flat→corridor, gentle climb→ramp, steep→stairs", () => {
  expect(chooseKind(0, 4)).toBe("corridor"); // Δh 0
  expect(chooseKind(1, 4)).toBe("ramp"); // 14° slope, walkable
  expect(chooseKind(4, 1)).toBe("stairs"); // ~76° — too steep for a ramp
});

test("route ramp top face is walkable (normal.y >= SLOPE_LIMIT_COS)", () => {
  const r = route(P([0, 0, 0], [1, 0, 0]), P([4, 1, 0], [-1, 0, 0]), {
    kind: "ramp",
  });
  const m = r.meshes.find((mm) => "box" in mm.geometry);
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
  const stepHeights = r.colliders.map(
    (c) => (c.shape as { cuboid: Vec3 }).cuboid[1] * 2,
  );
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
  expect(r.colliders.length).toBeGreaterThan(10); // ceil(6/0.35) = 18 steps
  // the staircase spans the full height band [0, 6]
  const tops = r.colliders.map(
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
  expect(r.meshes.length).toBe(1);
  expect(r.meshes[0]?.rotation).toBeDefined();
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
