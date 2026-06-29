// Pure (no-GPU) guard that the multi-level showcase keeps its two upper rooms in SEPARATED
// clear void: neither pillarHall nor greatHall may overlap the other, and neither may overlap
// the authored 2nd chamber. This is the assertion the climb tests miss — they break at the
// landing and never enter the room interiors, so a room burying the chamber (or the other
// room) was invisible. Here we compute each non-connector region's ROTATION-AWARE world AABB
// (the rooms are placed at continuous yaw) and assert the three pairwise non-overlaps.
import { expect, test } from "bun:test";
import { attachUpperLevel } from "../src/compose.ts";
import type { RegionData, Vec3 } from "../src/region.ts";

type Quat = [number, number, number, number];
type AABB = { min: Vec3; max: Vec3 };

/** The authored 2nd (east) chamber's world AABB: floor x[5,15], walls to y=6, z[-16,-4].
 *  Matches LEVEL_BOXES' east-chamber footprint (level.ts). */
const CHAMBER: AABB = { min: [5, 0, -16], max: [15, 6, -4] };

const IDENTITY: Quat = [0, 0, 0, 1];

/** Rotate `v` by quaternion `q` (x,y,z,w): `v + 2w(q×v) + 2(q×(q×v))`. Returns a tuple. */
function rotate(v: Vec3, q: Quat): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Rotation-aware world AABB over a region's box meshes: each box's 8 corners are rotated by
 *  the mesh's world quaternion (absent = identity), then min/max'd. Custom (Surface-Nets)
 *  meshes have no `box` extent and are skipped — the upper rooms are all box geometry. */
function regionAABB(r: RegionData): AABB {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const m of r.meshes) {
    if (!("box" in m.geometry)) continue;
    const [sx, sy, sz] = m.geometry.box;
    const [cx, cy, cz] = m.position;
    const q = m.rotation ?? IDENTITY;
    for (const ex of [-sx / 2, sx / 2])
      for (const ey of [-sy / 2, sy / 2])
        for (const ez of [-sz / 2, sz / 2]) {
          const [rx, ry, rz] = rotate([ex, ey, ez], q);
          min[0] = Math.min(min[0], cx + rx);
          min[1] = Math.min(min[1], cy + ry);
          min[2] = Math.min(min[2], cz + rz);
          max[0] = Math.max(max[0], cx + rx);
          max[1] = Math.max(max[1], cy + ry);
          max[2] = Math.max(max[2], cz + rz);
        }
  }
  return { min, max };
}

/** True iff two AABBs overlap on all three axes (touching faces do not count as overlap). */
function overlaps(a: AABB, b: AABB): boolean {
  const overlapAxis = (lo1: number, hi1: number, lo2: number, hi2: number) =>
    Math.min(hi1, hi2) > Math.max(lo1, lo2);
  return (
    overlapAxis(a.min[0], a.max[0], b.min[0], b.max[0]) &&
    overlapAxis(a.min[1], a.max[1], b.min[1], b.max[1]) &&
    overlapAxis(a.min[2], a.max[2], b.min[2], b.max[2])
  );
}

test("upper-level rooms are placed in separated void — no room overlaps another room or the chamber", () => {
  const regions = attachUpperLevel("wing-1");
  const rooms = regions.filter((r) => r.provenance.theme !== "connector");
  const pillar = rooms.find(
    (r) => r.provenance.theme === "pillarHall",
  ) as RegionData;
  const great = rooms.find(
    (r) => r.provenance.theme === "greatHall",
  ) as RegionData;
  expect(pillar).toBeDefined();
  expect(great).toBeDefined();

  const pillarBox = regionAABB(pillar);
  const greatBox = regionAABB(great);

  // The two rooms do not overlap each other.
  expect(overlaps(pillarBox, greatBox)).toBe(false);
  // Neither room overlaps the authored chamber.
  expect(overlaps(pillarBox, CHAMBER)).toBe(false);
  expect(overlaps(greatBox, CHAMBER)).toBe(false);

  // Both rooms float ABOVE the chamber rim (y > 6) — the elevation that clears the chamber,
  // a robust invariant the climb tests never reach.
  expect(pillarBox.min[1]).toBeGreaterThan(CHAMBER.max[1]);
  expect(greatBox.min[1]).toBeGreaterThan(CHAMBER.max[1]);
});
