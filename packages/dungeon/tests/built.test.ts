// The built-interface kit: a masonry collar at an organic mouth presents a
// standardized door-class portal (built-interface doctrine). Pure geometry.
import { expect, test } from "bun:test";
import { mouthCollar } from "../src/built.ts";
import type { Connection, Vec3 } from "../src/region.ts";

const OPTS = {
  opening: { width: 2, height: 2.8 },
  envelope: { width: 4.2, height: 3.7 },
};
const mouth = (position: Vec3, facing: Vec3): Connection => ({
  position,
  facing,
  width: 3.2,
  height: 3.2,
  kind: "tunnel-mouth",
});

/** Is point p inside box b (yaw-rotated about its centre)? */
function inBox(
  b: { center: Vec3; size: Vec3; rotation?: [number, number, number, number] },
  p: Vec3,
): boolean {
  const q = b.rotation ?? [0, 0, 0, 1];
  const theta = 2 * Math.atan2(q[1], q[3]);
  const c = Math.cos(-theta);
  const s = Math.sin(-theta);
  const dx = p[0] - b.center[0];
  const dz = p[2] - b.center[2];
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  return (
    Math.abs(lx) <= b.size[0] / 2 + 1e-9 &&
    Math.abs(p[1] - b.center[1]) <= b.size[1] / 2 + 1e-9 &&
    Math.abs(lz) <= b.size[2] / 2 + 1e-9
  );
}

test("collar presents a door at its mid-depth with the mouth's facing", () => {
  const { door } = mouthCollar(mouth([10, -2, 4], [1, 0, 0]), OPTS);
  expect(door.kind).toBe("door");
  expect(door.width).toBe(2);
  expect(door.height).toBe(2.8);
  expect(door.facing).toEqual([1, 0, 0]);
  // mid-depth zc = (PROUD − EMBED)/2 = −0.2 along facing
  expect(door.position[0]).toBeCloseTo(10 - 0.2, 9);
  expect(door.position[1]).toBeCloseTo(-2, 9);
  expect(door.position[2]).toBeCloseTo(4, 9);
});

test("collar masks the bore envelope and keeps the opening prism clear", () => {
  const m = mouth([0, 0, 0], [0, 0, 1]);
  const { boxes, bounds } = mouthCollar(m, OPTS);
  expect(boxes.length).toBe(4); // jambs ×2, lintel, sill
  // outer envelope: lateral half-width >= envelope/2 + margin; top >= envelope + margin
  expect(bounds.min[0]).toBeLessThanOrEqual(-(4.2 / 2 + 0.3) + 1e-9);
  expect(bounds.max[0]).toBeGreaterThanOrEqual(4.2 / 2 + 0.3 - 1e-9);
  expect(bounds.max[1]).toBeGreaterThanOrEqual(3.7 + 0.3 - 1e-9);
  expect(bounds.min[2]).toBeCloseTo(-0.8, 6); // EMBED into the bore
  expect(bounds.max[2]).toBeCloseTo(0.4, 6); // PROUD of the rock face
  // opening prism stays clear (walkable through the collar at any depth)
  for (const x of [-0.9, 0, 0.9]) {
    for (const y of [0.05, 1.4, 2.75]) {
      for (const z of [-0.7, -0.2, 0.3]) {
        expect(boxes.some((b) => inBox(b, [x, y, z]))).toBe(false);
      }
    }
  }
  // sill top flush with the mouth floor
  const sill = boxes.find((b) => b.center[1] < 0);
  expect(sill).toBeDefined();
  if (sill) expect(sill.center[1] + sill.size[1] / 2).toBeCloseTo(0, 9);
});

test("collar handles a non-cardinal facing (30°) with rotated boxes", () => {
  const a = (30 * Math.PI) / 180;
  const f: Vec3 = [Math.sin(a), 0, Math.cos(a)];
  const { boxes, door } = mouthCollar(mouth([5, 1, -3], f), OPTS);
  expect(boxes.every((b) => b.rotation !== undefined)).toBe(true);
  expect(door.facing).toEqual(f);
  // jamb centres sit symmetric about the mouth axis; the point one metre along the
  // facing INSIDE the opening is clear, the point 2 m laterally is inside a jamb
  const lat: Vec3 = [Math.cos(a), 0, -Math.sin(a)];
  const inJamb: Vec3 = [
    5 + lat[0] * 1.7 - f[0] * 0.2,
    1.4,
    -3 + lat[2] * 1.7 - f[2] * 0.2,
  ];
  expect(boxes.some((b) => inBox(b, inJamb))).toBe(true);
});

test("collar is a pure function (identical output for identical input)", () => {
  const m = mouth([1, 2, 3], [0, 0, -1]);
  expect(mouthCollar(m, OPTS)).toEqual(mouthCollar(m, OPTS));
});
