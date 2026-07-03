// Regression guard for the 2.2.5b-A gate fall-through: sweep every world-graph edge's
// portal-to-portal walk line (extended past each portal into the pieces, with a lateral
// fan at capsule scale) and assert NO capsule-scale hole in floor support. Pure math
// over the placed colliders — no GPU, no Rapier: exact vertical-line vs oriented-box
// tops (slab method) plus voxel column membership (corner-anchored cells, occupancy.ts
// convention). Sub-capsule slivers are tolerated — the capsule rim-rides them (e.g. the
// oblique-join threshold wedge at yawed door joins, tracked for the Phase B
// threshold/mouth-structure work); a hole only fails the sweep when an unsupported
// disc of radius HOLE_R fits, which is what actually drops a player.
import { expect, test } from "bun:test";
import { layoutWorld } from "../src/layout.ts";
import type { RegionData, Vec3 } from "../src/region.ts";
import { buildWorldGraph, WORLD_SEED } from "../src/world.ts";

type Quat = [number, number, number, number];
const IDENTITY: Quat = [0, 0, 0, 1];

/** Rotate v by the CONJUGATE of q (world -> box local). */
function rotInv(q: Quat, v: Vec3): Vec3 {
  const qx = -q[0];
  const qy = -q[1];
  const qz = -q[2];
  const qw = q[3];
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

type OBox = { center: Vec3; half: Vec3; q: Quat };
type VoxCols = {
  position: Vec3;
  yaw: number;
  size: [number, number, number];
  cols: Map<string, { top: number; bottom: number }[]>;
};

function collectSolids(regions: RegionData[]): {
  boxes: OBox[];
  voxels: VoxCols[];
} {
  const boxes: OBox[] = [];
  const voxels: VoxCols[] = [];
  for (const region of regions) {
    for (const c of region.colliders) {
      if ("cuboid" in c.shape) {
        const h = c.shape.cuboid;
        boxes.push({
          center: c.position,
          half: [h[0], h[1], h[2]],
          q: c.rotation ?? IDENTITY,
        });
      } else if ("voxels" in c.shape) {
        const { coords, size } = c.shape.voxels;
        const q = c.rotation;
        const yaw = q ? 2 * Math.atan2(q[1], q[3]) : 0;
        const cols = new Map<string, { top: number; bottom: number }[]>();
        for (let i = 0; i < coords.length; i += 3) {
          const key = `${coords[i]},${coords[i + 2]}`;
          const bottom = c.position[1] + (coords[i + 1] as number) * size[1];
          const arr = cols.get(key) ?? [];
          arr.push({ top: bottom + size[1], bottom });
          cols.set(key, arr);
        }
        voxels.push({
          position: c.position,
          yaw,
          size: [size[0], size[1], size[2]],
          cols,
        });
      }
    }
  }
  return { boxes, voxels };
}

/** Vertical-line (x,z) vs oriented box: [yEnter, yExit] of the intersection, or null. */
function verticalSpan(b: OBox, x: number, z: number): [number, number] | null {
  const o = rotInv(b.q, [x - b.center[0], -b.center[1], z - b.center[2]]);
  const d = rotInv(b.q, [0, 1, 0]);
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    const oa = o[a] as number;
    const da = d[a] as number;
    const ha = b.half[a] as number;
    if (Math.abs(da) < 1e-9) {
      if (Math.abs(oa) > ha) return null;
    } else {
      const u = (-ha - oa) / da;
      const v = (ha - oa) / da;
      t0 = Math.max(t0, Math.min(u, v));
      t1 = Math.min(t1, Math.max(u, v));
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

const SUPPORT_LO = -1.2; // support window below the expected walk line...
const SUPPORT_HI = 0.55; // ...and above (stair treads sit up to ~a riser above it)
const HOLE_R = 0.15; // unsupported-disc radius that counts as a fall hazard (sub-capsule)
const EXT = 1.5; // sweep past each portal into the pieces
const LATS = [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9];
const STEP = 0.1;

test("world seams: every edge walk line has capsule-scale floor support end to end", () => {
  const g = buildWorldGraph(WORLD_SEED);
  const r = layoutWorld(g, WORLD_SEED);
  const { boxes, voxels } = collectSolids([...r.regions, ...r.connectors]);

  // "blocked" = the sample is inside a solid at torso height (a wall band, a jamb
  // corner behind an oblique join) — a capsule can never BE there, so it is neither
  // support nor hole evidence.
  const classify = (
    x: number,
    z: number,
    walkY: number,
  ): "support" | "blocked" | "hole" => {
    let blocked = false;
    for (const b of boxes) {
      const span = verticalSpan(b, x, z);
      if (!span) continue;
      if (span[1] >= walkY + SUPPORT_LO && span[1] <= walkY + SUPPORT_HI) {
        return "support";
      }
      if (span[0] < walkY + 1.4 && span[1] > walkY + 0.6) blocked = true;
    }
    for (const v of voxels) {
      const c = Math.cos(-v.yaw);
      const s = Math.sin(-v.yaw);
      const dx = x - v.position[0];
      const dz = z - v.position[2];
      const lx = dx * c + dz * s;
      const lz = -dx * s + dz * c;
      const cells = v.cols.get(
        `${Math.floor(lx / v.size[0])},${Math.floor(lz / v.size[2])}`,
      );
      if (cells) {
        for (const cell of cells) {
          if (
            cell.top >= walkY + SUPPORT_LO &&
            cell.top <= walkY + SUPPORT_HI
          ) {
            return "support";
          }
          if (cell.bottom < walkY + 1.4 && cell.top > walkY + 0.6) {
            blocked = true;
          }
        }
      }
    }
    return blocked ? "blocked" : "hole";
  };

  const failures: string[] = [];
  for (let ei = 0; ei < g.edges.length; ei++) {
    const e = g.edges[ei] as (typeof g.edges)[number];
    const ra = r.regions[g.nodes.findIndex((n) => n.id === e.a)] as RegionData;
    const rb = r.regions[g.nodes.findIndex((n) => n.id === e.b)] as RegionData;
    const pa = ra.connections[e.aPortal];
    const pb = rb.connections[e.bPortal];
    if (!pa || !pb) throw new Error(`edge ${ei}: missing portal`);
    const dx = pb.position[0] - pa.position[0];
    const dz = pb.position[2] - pa.position[2];
    const run = Math.hypot(dx, dz);
    const ux = dx / run;
    const uz = dz / run;
    const lxv = -uz;
    const lzv = ux;
    const doorHalf = Math.min(pa.width, pb.width) / 2;
    let supportedSamples = 0;
    for (let s = -EXT; s <= run + EXT + 1e-9; s += STEP) {
      const t = Math.min(Math.max(s / run, 0), 1);
      const walkY = pa.position[1] + (pb.position[1] - pa.position[1]) * t;
      for (const lat of LATS) {
        if ((s < 0 || s > run) && Math.abs(lat) > doorHalf) continue;
        const at = (ds: number, dlat: number): "support" | "blocked" | "hole" =>
          classify(
            pa.position[0] + ux * (s + ds) + lxv * (lat + dlat),
            pa.position[2] + uz * (s + ds) + lzv * (lat + dlat),
            walkY,
          );
        const centre = at(0, 0);
        if (centre === "support") {
          supportedSamples++;
          continue;
        }
        if (centre === "blocked") continue; // unreachable — inside a solid
        // Capsule-scale: only a hole if the whole HOLE_R disc is open hole too
        // (blocked neighbours push the capsule away, so they aren't hole evidence).
        const discHole =
          at(HOLE_R, 0) === "hole" &&
          at(-HOLE_R, 0) === "hole" &&
          at(0, HOLE_R) === "hole" &&
          at(0, -HOLE_R) === "hole";
        if (discHole) {
          failures.push(
            `edge${ei} ${e.a}->${e.b}: capsule-scale hole at s=${s.toFixed(2)} lat=${lat.toFixed(1)} ` +
              `world=[${(pa.position[0] + ux * s + lxv * lat).toFixed(2)}, ${walkY.toFixed(2)}, ${(pa.position[2] + uz * s + lzv * lat).toFixed(2)}]`,
          );
        }
      }
    }
    expect(supportedSamples).toBeGreaterThan(0); // sanity: the sweep saw real floor
  }
  expect(failures).toEqual([]);
});
