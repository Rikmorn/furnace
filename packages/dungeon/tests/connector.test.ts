import { expect, test } from "bun:test";
import {
  organicTunnel,
  TUNNEL_RADIUS,
  tunnelGeometry,
} from "../src/connector.ts";
import type { Connection, RegionData } from "../src/region.ts";
import type { MeshData } from "../src/surface-nets.ts";

// Two facing door portals 8 m apart on a common floor (world y = -2), each presenting the
// door-standard opening a cave collar emits.
const A: Connection = {
  position: [0, -2, 0],
  facing: [0, 0, 1],
  width: 2,
  height: 2.8,
  kind: "door",
};
const B: Connection = {
  position: [0, -2, 8],
  facing: [0, 0, -1],
  width: 2,
  height: 2.8,
  kind: "door",
};

/** The custom-mesh of a region's first mesh (asserting the `custom` geometry shape). */
function customMesh(r: RegionData): MeshData {
  const geo = r.meshes[0]?.geometry;
  if (!geo || !("custom" in geo)) throw new Error("expected a custom mesh");
  return geo.custom;
}

/** The voxel proxy of a region's first collider (asserting the `voxels` shape). */
function voxelProxy(r: RegionData) {
  const shape = r.colliders[0]?.shape;
  if (!shape || !("voxels" in shape))
    throw new Error("expected a voxels shape");
  return shape.voxels;
}

test("mesh is non-empty and every vertex lies inside the padded grid box", () => {
  const { grid } = tunnelGeometry(A, B);
  const mesh = customMesh(organicTunnel(A, B, "tunnel-1"));
  expect(mesh.positions.length).toBeGreaterThan(0);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let ax = 0; ax < 3; ax++) {
      const v = mesh.positions[i + ax] as number;
      const lo = grid.min[ax] as number;
      const hi = lo + (grid.dims[ax] as number) * grid.cellSize;
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    }
  }
});

test("voxel collision proxy is non-empty", () => {
  const proxy = voxelProxy(organicTunnel(A, B, "tunnel-1"));
  expect(proxy.coords.length).toBeGreaterThan(0);
  expect(proxy.coords.length % 3).toBe(0);
});

test("field is air along the portal-to-portal centerline and rock at the box corners", () => {
  const { field, grid } = tunnelGeometry(A, B);
  const centerY = A.position[1] + TUNNEL_RADIUS; // equal thresholds → level bore
  const SAMPLES = 10;
  for (let s = 0; s < SAMPLES; s++) {
    const t = s / (SAMPLES - 1);
    const x = A.position[0] + (B.position[0] - A.position[0]) * t;
    const z = A.position[2] + (B.position[2] - A.position[2]) * t;
    expect(field(x, centerY, z)).toBeGreaterThan(0); // air (walkable)
  }
  const min = grid.min;
  const max: [number, number, number] = [
    min[0] + grid.dims[0] * grid.cellSize,
    min[1] + grid.dims[1] * grid.cellSize,
    min[2] + grid.dims[2] * grid.cellSize,
  ];
  for (const cx of [min[0], max[0]]) {
    for (const cy of [min[1], max[1]]) {
      for (const cz of [min[2], max[2]]) {
        expect(field(cx, cy, cz)).toBeLessThan(0); // solid rock
      }
    }
  }
});

test("both tube ends read OPEN at the bore-axis grid boundary (rock end-caps excluded)", () => {
  // The FIELD overshoots the caps past each door; the GRID clips at the door planes so the
  // caps fall outside it. Sampling the field ON the bore centerline at both along-bore-axis
  // grid boundary faces must therefore read AIR — the door plane, not the buried rock cap.
  // (This FAILS on the old extended-segment grid, whose faces sat past the rock caps.)
  const { field, grid } = tunnelGeometry(A, B);
  const axis = A.facing[0] !== 0 ? 0 : 2; // bore axis (Z for these portals)
  const centerY = A.position[1] + TUNNEL_RADIUS;
  const loFace = grid.min[axis];
  const hiFace = grid.min[axis] + grid.dims[axis] * grid.cellSize;
  // A point on the bore centerline (perpendicular coords fixed) at an along-axis position.
  const onAxis = (along: number): [number, number, number] => {
    const p: [number, number, number] = [A.position[0], centerY, A.position[2]];
    p[axis] = along;
    return p;
  };
  expect(field(...onAxis(loFace))).toBeGreaterThan(0); // near door plane: open
  expect(field(...onAxis(hiFace))).toBeGreaterThan(0); // far door plane: open
});

test("geometry is seed-independent — different seeds produce an identical bore", () => {
  const a = organicTunnel(A, B, "seed-alpha");
  const b = organicTunnel(A, B, "seed-beta");
  expect(a.provenance.seed).not.toBe(b.provenance.seed); // the seeds really differ
  // No noise → geometry depends only on (a, b, opts). Compare geometry, not provenance.seed.
  expect(Array.from(customMesh(a).positions)).toEqual(
    Array.from(customMesh(b).positions),
  );
  expect([...voxelProxy(a).coords]).toEqual([...voxelProxy(b).coords]);
});

test("boreAxis survives join float dust on the A-end facing (backlog fix)", () => {
  // A join-rotated portal facing carries dust: [6.12e-17, 0, -1] is a Z facing.
  const dusty: Connection = {
    position: [0, 0, 0],
    facing: [6.12e-17, 0, -1],
    width: 3.2,
    height: 3.2,
    kind: "tunnel-mouth",
  };
  const clean: Connection = {
    position: [0, 0, -8],
    facing: [0, 0, 1],
    width: 3.2,
    height: 3.2,
    kind: "tunnel-mouth",
  };
  const { grid } = tunnelGeometry(dusty, clean);
  // Bore axis is Z → the grid CLIPS (no pad) along Z to the 8 m door-plane span,
  // while the perpendicular X axis carries the pad (> 2 radii). The buggy `!== 0`
  // boreAxis misreads the dust as an X bore, which would instead pad Z (~15 m) and
  // clip X to zero — so these two extents pin the axis choice both ways.
  const xExtent = grid.dims[0] * grid.cellSize;
  const zExtent = grid.dims[2] * grid.cellSize;
  expect(zExtent).toBe(8); // Z clipped to the door-plane span (unpadded bore axis)
  expect(xExtent).toBeGreaterThan(2 * TUNNEL_RADIUS); // X padded (perpendicular)
});
