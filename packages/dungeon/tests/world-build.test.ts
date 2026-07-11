// packages/dungeon/tests/world-build.test.ts
import { expect, test } from "bun:test";
import { forwardVector } from "../src/fp-controller.ts";
import type { Aabb, Vec3 } from "../src/region.ts";
import { realizeWorldSpec } from "../src/world-build.ts";
import { DEFAULT_TUNNEL_LENGTH, DEFAULT_WORLD } from "../src/world-spec.ts";

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

  // Every resolved placement (cave-b's is the derived one) is exactly reproduced.
  const placementsOf = (spec: typeof a.spec) =>
    spec.regions.map((r) => r.placement);
  expect(placementsOf(a.spec)).toEqual(placementsOf(b.spec));
  // And the derivation is not a no-op: cave-b moved off the zero placeholder.
  const caveB = a.spec.regions.find((r) => r.id === "cave-b");
  expect(caveB?.placement.translation).not.toEqual([0, 0, 0]);

  expect(a.playerStart).toEqual(b.playerStart);
  expect(a.playerYaw).toEqual(b.playerYaw);
});

// (ii) cave-b's derived door is DEFAULT_TUNNEL_LENGTH from cave-a's door, along cave-a's
// portal facing.
test("derived cave-b door is one tunnel-length out along cave-a's facing", () => {
  const w = realizeWorldSpec(DEFAULT_WORLD);
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
  const w = realizeWorldSpec(DEFAULT_WORLD);
  const doorA = w.regions.get("cave-a")?.connections[0];
  const doorB = w.regions.get("cave-b")?.connections[0];
  if (!doorA || !doorB) throw new Error("missing placed doors");

  expect(dot(doorA.facing, doorB.facing)).toBeCloseTo(-1, 6);
});

// (iv) playerStart is inside cave-a's placed bounds AABB.
test("playerStart is inside the start region's placed bounds", () => {
  const w = realizeWorldSpec(DEFAULT_WORLD);
  const caveA = w.regions.get("cave-a");
  if (!caveA) throw new Error("missing placed cave-a");

  expect(insideAabb(caveA.bounds, w.playerStart)).toBe(true);
});

// Direction-lock: playerYaw orients the player to look OUT along the start portal's facing
// (into the tunnel), not into the cave wall. Locks the sign of the yaw math the same way
// test (iii) locks the phantom facing — dropping the negations would fail this at dot ≈ −1.
test("player faces the tunnel (playerYaw looks along the start portal's outward facing)", () => {
  const w = realizeWorldSpec(DEFAULT_WORLD);
  const doorA = w.regions.get("cave-a")?.connections[0];
  if (!doorA) throw new Error("missing placed cave-a door");

  expect(dot(forwardVector(w.playerYaw, 0), doorA.facing)).toBeCloseTo(1, 6);
});
