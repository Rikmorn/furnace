// packages/dungeon/tests/world-build.test.ts
import { expect, test } from "bun:test";
import { forwardVector } from "../src/fp-controller.ts";
import type { Aabb, RegionData, Vec3 } from "../src/region.ts";
import { realizeWorldSpec } from "../src/world-build.ts";
import {
  DEFAULT_TUNNEL_LENGTH,
  DEFAULT_WORLD,
  type WorldSpec,
} from "../src/world-spec.ts";
import { HALL_CAVE, TWO_CAVES, TWO_HALLS } from "./_helpers/world-fixtures.ts";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

function insideAabb(box: Aabb, p: Vec3): boolean {
  return (
    p[0] >= box.min[0] &&
    p[0] <= box.max[0] &&
    p[1] >= box.min[1] &&
    p[1] <= box.max[1] &&
    p[2] >= box.min[2] &&
    p[2] <= box.max[2]
  );
}

// (i) Determinism — two realize calls produce identical derived placements + playerStart.
test("realizeWorldSpec is deterministic (derived placements + playerStart)", () => {
  const a = realizeWorldSpec(DEFAULT_WORLD);
  const b = realizeWorldSpec(DEFAULT_WORLD);

  // Every resolved placement (hall-b's and cave-c's are the derived ones) is exactly reproduced.
  const placementsOf = (spec: typeof a.spec) =>
    spec.regions.map((r) => r.placement);
  expect(placementsOf(a.spec)).toEqual(placementsOf(b.spec));
  // And the derivation is not a no-op: BOTH derived regions moved off the zero placeholder.
  // Looked up by index (not `.find`, which returns undefined on a renamed id and would let this
  // pass VACUOUSLY — exactly how the two-cave version silently lost its teeth at Task 14).
  for (const id of ["hall-b", "cave-c"]) {
    const derived = a.spec.regions.find((r) => r.id === id);
    if (!derived) throw new Error(`missing derived region ${id}`);
    expect(derived.placement.translation).not.toEqual([0, 0, 0]);
  }

  expect(a.playerStart).toEqual(b.playerStart);
  expect(a.playerYaw).toEqual(b.playerYaw);
});

// (ii) ORGANIC-TUNNEL join math (TWO_CAVES — the gate world has no organic tunnel, but the
// cave↔cave derivation is still live in world-build.ts): cave-b's derived door is
// DEFAULT_TUNNEL_LENGTH from cave-a's door, along cave-a's portal facing.
test("derived cave-b door is one tunnel-length out along cave-a's facing", () => {
  const w = realizeWorldSpec(TWO_CAVES);
  const doorA = w.regions.get("cave-a")?.connections[0];
  const doorB = w.regions.get("cave-b")?.connections[0];
  if (!doorA || !doorB) throw new Error("missing placed doors");

  const delta = sub(doorB.position, doorA.position);
  expect(norm(delta)).toBeCloseTo(DEFAULT_TUNNEL_LENGTH, 6);

  const dir: Vec3 = [
    delta[0] / DEFAULT_TUNNEL_LENGTH,
    delta[1] / DEFAULT_TUNNEL_LENGTH,
    delta[2] / DEFAULT_TUNNEL_LENGTH,
  ];
  expect(dir[0]).toBeCloseTo(doorA.facing[0], 6);
  expect(dir[1]).toBeCloseTo(doorA.facing[1], 6);
  expect(dir[2]).toBeCloseTo(doorA.facing[2], 6);
});

// (iii) The two placed portals face each other: dot(fA, fB) ≈ −1 (the phantom-facing
// correction — building the phantom with −pA.facing would give +1 here and fail).
test("placed cave-a and cave-b portals face each other (dot ≈ −1)", () => {
  const w = realizeWorldSpec(TWO_CAVES);
  const doorA = w.regions.get("cave-a")?.connections[0];
  const doorB = w.regions.get("cave-b")?.connections[0];
  if (!doorA || !doorB) throw new Error("missing placed doors");

  expect(dot(doorA.facing, doorB.facing)).toBeCloseTo(-1, 6);
});

// (iv) playerStart is inside the start region's (hall-a's) placed bounds AABB.
test("playerStart is inside the start region's placed bounds", () => {
  const w = realizeWorldSpec(DEFAULT_WORLD);
  const start = w.regions.get(DEFAULT_WORLD.startRegion);
  if (!start) throw new Error("missing placed start region");

  expect(insideAabb(start.bounds, w.playerStart)).toBe(true);
});

// Direction-lock: playerYaw orients the player to look OUT along the start portal's facing
// (into the corridor), not into the hall wall. Locks the sign of the yaw math the same way
// test (iii) locks the phantom facing — dropping the negations would fail this at dot ≈ −1.
test("player faces the start portal (playerYaw looks along its outward facing)", () => {
  const w = realizeWorldSpec(DEFAULT_WORLD);
  const door = w.regions.get(DEFAULT_WORLD.startRegion)?.connections[0];
  if (!door) throw new Error("missing placed start portal");

  expect(dot(forwardVector(w.playerYaw, 0), door.facing)).toBeCloseTo(1, 6);
});

// GATE WORLD shape-lock: the committed default composes BOTH region classes and BOTH built
// connector kinds, and the player starts in the grid-built hall. If a future edit quietly
// reduced it back to a single class, the traversal probe would still pass while the world the
// player boots stopped exercising the seam this slice exists to prove.
test("DEFAULT_WORLD (gate world) realizes both classes + both built connector kinds", () => {
  const w = realizeWorldSpec(DEFAULT_WORLD);
  expect(
    w.regions.get("hall-a")?.colliders.some((c) => "voxels" in c.shape),
  ).toBe(true);
  expect(
    w.regions.get("hall-b")?.colliders.some((c) => "voxels" in c.shape),
  ).toBe(true);
  expect(
    w.regions.get("cave-c")?.colliders.some((c) => "voxels" in c.shape),
  ).toBe(true);
  // Both built connectors carry real collision (the corridor tube + the bore).
  expect(w.connectors.get("corridor-1")?.colliders.length).toBeGreaterThan(0);
  expect(w.connectors.get("bore-1")?.colliders.length).toBeGreaterThan(0);
  // The stair corridor's deltaY landed hall-b a storey up (Task 12's proven flight).
  const hallB = w.spec.regions.find((r) => r.id === "hall-b");
  expect(hallB?.placement.translation[1]).toBeCloseTo(1.5, 10);
});

test("realize hall↔cave: hall has kit instances, patch mesh, voxel collider", () => {
  const w = realizeWorldSpec(HALL_CAVE);
  const hall = w.regions.get("hall-a");
  if (!hall) throw new Error("hall missing");
  expect(hall.instances.length).toBeGreaterThan(0); // kit skin + collar
  expect(hall.meshes.length).toBe(1); // the carve patch
  expect(hall.colliders.some((c) => "voxels" in c.shape)).toBe(true);
  expect(w.connectors.get("bore-1")?.colliders.length).toBe(1);
  // The cave's derived placement was written back (not the placeholder):
  const resolved = w.spec.regions.find((r) => r.id === "cave-b");
  expect(resolved?.placement.translation).not.toEqual([0, 0, 0]);
});

test("realize is deterministic: two runs byte-identical", () => {
  const a = realizeWorldSpec(HALL_CAVE);
  const b = realizeWorldSpec(HALL_CAVE);
  const hallA = a.regions.get("hall-a");
  const hallB = b.regions.get("hall-a");
  expect(JSON.stringify(a.spec)).toBe(JSON.stringify(b.spec));
  expect([...(hallA?.instances[0]?.transforms ?? [])]).toEqual([
    ...(hallB?.instances[0]?.transforms ?? []),
  ]);
});

test("corridor world: derived placement lattice-snapped, doors opened, tube collides", () => {
  const w = realizeWorldSpec(TWO_HALLS);
  const resolved = w.spec.regions.find((r) => r.id === "hall-b");
  if (!resolved) throw new Error("hall-b missing");
  for (const t of resolved.placement.translation) {
    expect(t).toBe(Math.round(t / 0.5) * 0.5);
  }
  expect(resolved.placement.yaw % (Math.PI / 2)).toBe(0);
  expect(resolved.placement.translation[1]).toBeCloseTo(1.5, 10); // deltaY carried
  const corr = w.connectors.get("corr-1");
  expect(corr?.colliders.some((c) => "voxels" in c.shape)).toBe(true);
  // Both halls' shells were OPENED (open-door at finalize): the same hall-a
  // expanded with its portal left SEALED (no connectors) skins a different count.
  const first = TWO_HALLS.regions[0];
  // Narrow to the HALL variant so the spread below keeps the algorithm↔params
  // correlation (a bare union spread loses it — `grid-built` is hall|maze as of W3).
  // hall-a IS a grid-built hall — never throws.
  if (!first || first.class !== "grid-built" || first.algorithm !== "hall") {
    throw new Error("fixture broken");
  }
  const sealed = realizeWorldSpec({
    name: "sealed-control",
    regions: [{ ...first, params: { ...first.params } }],
    connectors: [],
    startRegion: "hall-a",
  });
  const count = (r?: RegionData): number =>
    (r?.instances ?? []).reduce((n, g) => n + g.transforms.length / 16, 0);
  expect(count(w.regions.get("hall-a"))).not.toBe(
    count(sealed.regions.get("hall-a")),
  );
});

test("W3 plug point: a maze region realizes through the same grid pipeline as halls", () => {
  const spec: WorldSpec = {
    name: "solo-maze",
    regions: [
      {
        id: "maze-a",
        class: "grid-built",
        algorithm: "maze",
        params: {
          cells: [4, 4],
          braid: 0,
          doors: [{ wall: "south", offset: 1 }],
        },
        seed: "t:solo",
        placement: { translation: [0, 0, 0], yaw: 0 },
      },
    ],
    connectors: [],
    startRegion: "maze-a",
  };
  const realized = realizeWorldSpec(spec);
  const data = realized.regions.get("maze-a");
  if (!data) throw new Error("maze-a not realized");
  // Kit skin + rubble dressing came out of the SHARED expandGridRegion path.
  expect(data.instances.length).toBeGreaterThan(0);
  // One voxel-proxy collider, like every grid region.
  expect(data.colliders.length).toBe(1);
  // The door portal survives as metadata (no connector consumed it).
  expect(data.connections.length).toBe(1);
  // Footprint: [4,4] cells → interior 9.5 m + two 0.5 m shells = 10.5 m square.
  expect(data.bounds.max[0] - data.bounds.min[0]).toBeCloseTo(10.5, 5);
  expect(data.bounds.max[2] - data.bounds.min[2]).toBeCloseTo(10.5, 5);
});
