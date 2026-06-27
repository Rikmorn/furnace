import { expect, test } from "bun:test";
import { create as makeRng } from "@furnace/core/rng";
import { quat, vec3 } from "@furnace/core/transform";
import { buildArea } from "../src/compose.ts";
import type {
  InstanceData,
  InstanceGroup,
  MaterialDescriptor,
  ScatterLayerSpec,
  Vec3,
} from "../src/region.ts";
import {
  _orient,
  _sampleSurface,
  instanceGroupsFromLayers,
  meshSurface,
  rectSurface,
  scatter,
} from "../src/scatter.ts";
import type { MeshData } from "../src/surface-nets.ts";
import { cave } from "../src/themes/cave.ts";

test("composed regions carry an instances array (empty until themes populate)", () => {
  const regions = buildArea("seed-x", [0, 0, 0]);
  for (const r of regions) expect(Array.isArray(r.instances)).toBe(true);
});

// Two triangles forming a unit quad on y=0, plus a 9x-area quad offset in +x.
const md: MeshData = {
  positions: new Float32Array([
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    1,
    0,
    1, // small quad (verts 0-3), area 1
    2,
    0,
    0,
    5,
    0,
    0,
    2,
    0,
    3,
    5,
    0,
    3, // big quad (verts 4-7), 3x3 = area 9
  ]),
  normals: new Float32Array(24).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), // all +Y (unused: meshSurface derives normals from winding)
  uvs: new Float32Array(16),
  // CCW-from-above winding → +Y face normals (a floor). meshSurface ignores the
  // stored `normals` above and computes the face normal from this winding.
  indices: new Uint32Array([0, 2, 1, 1, 2, 3, 4, 6, 5, 5, 6, 7]),
};

test("sampleSurface is deterministic and area-weighted, points on surface", () => {
  const a = _sampleSurface(meshSurface(md), 400, makeRng("s"));
  const b = _sampleSurface(meshSurface(md), 400, makeRng("s"));
  expect(a.map((p) => p.position.join(","))).toEqual(
    b.map((p) => p.position.join(",")),
  ); // determinism
  for (const s of a) expect(Math.abs(s.position[1])).toBeLessThan(1e-6); // y≈0 plane (on-surface)
  const inBig = a.filter((s) => s.position[0] >= 2).length;
  expect(inBig / a.length).toBeGreaterThan(0.8); // ~9/10 of total area is the big quad
});

const floorSpec: ScatterLayerSpec = {
  name: "rubble",
  geometry: { primitive: "cube" },
  posture: "lit",
  material: { color: [0.5, 0.4, 0.3, 1], specular: [0, 0, 0, 0] },
  target: "floor",
  spacing: { min: 0.5, max: 0.5 },
  scale: { min: 0.1, max: 0.2 },
};

test("scatter respects min-distance, floor mask, keep-out, determinism", () => {
  const surf = meshSurface(md); // reuse the Task-8 quad fixture (all +Y normals)
  const keepOut = [{ center: [3, 0, 1] as Vec3, radius: 1.0 }];
  const a = scatter(surf, floorSpec, makeRng("k"), keepOut);
  const b = scatter(surf, floorSpec, makeRng("k"), keepOut);
  expect(a.map((d) => d.position.join(","))).toEqual(
    b.map((d) => d.position.join(",")),
  ); // determinism
  expect(a.length).toBeGreaterThan(0);
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++) {
      const pi = (a[i] as InstanceData).position;
      const pj = (a[j] as InstanceData).position;
      const d = Math.hypot(pi[0] - pj[0], pi[2] - pj[2]);
      expect(d).toBeGreaterThanOrEqual(0.5 - 1e-6); // blue-noise min spacing (XZ)
    }
  for (const d of a)
    expect(Math.hypot(d.position[0] - 3, d.position[2] - 1)).toBeGreaterThan(
      1.0,
    ); // keep-out
});

// Orientation: orient() must align the archetype +Y to the surface normal — the
// ceiling glow-worm "hangs down" requirement (n = -Y) is the critical case.
test("orient aligns +Y to the surface normal (incl. ceiling -Y)", () => {
  const cases: Vec3[] = [
    [0, 1, 0],
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, 1],
    [0.3, 0.8, -0.5],
  ];
  for (const n of cases) {
    const nn = vec3.normalize(vec3.create(), vec3.fromValues(n[0], n[1], n[2]));
    const nx = nn[0] as number;
    const ny = nn[1] as number;
    const nz = nn[2] as number;
    const q = _orient([nx, ny, nz], 1.234); // arbitrary yaw must not move +Y off n
    const up = vec3.transformQuat(
      vec3.create(),
      vec3.fromValues(0, 1, 0),
      quat.fromValues(q[0], q[1], q[2], q[3]),
    );
    expect(up[0] as number).toBeCloseTo(nx, 5);
    expect(up[1] as number).toBeCloseTo(ny, 5);
    expect(up[2] as number).toBeCloseTo(nz, 5);
  }
});

// Slope mask rejects: a floor-target layer finds nothing on a vertical wall.
test("scatter slope mask rejects off-target surfaces", () => {
  const wall: MeshData = {
    // a quad in the x=0 plane, normal +X (a wall)
    positions: new Float32Array([0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2]),
    normals: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]),
    uvs: new Float32Array(8),
    indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
  };
  const out = scatter(meshSurface(wall), floorSpec, makeRng("w"), []);
  expect(out.length).toBe(0); // floor target, wall normal → all rejected
});

test("rectSurface scatters within the floor rect on the floor plane", () => {
  const surf = rectSurface({ minX: 0, maxX: 4, z0: 0, z1: 6, y: 2 }); // a 4x6 floor at y=2
  const pts = scatter(
    surf,
    { ...floorSpec, spacing: { min: 0.4, max: 0.4 } },
    makeRng("r"),
    [],
  );
  expect(pts.length).toBeGreaterThan(10);
  for (const d of pts) {
    expect(d.position[0]).toBeGreaterThanOrEqual(-0.1);
    expect(d.position[0]).toBeLessThanOrEqual(4.1);
    expect(d.position[2]).toBeGreaterThanOrEqual(-0.1);
    expect(d.position[2]).toBeLessThanOrEqual(6.1);
    expect(Math.abs(d.position[1] - 2)).toBeLessThan(0.1); // floor plane (minus the 0.05 embed)
  }
});

test("cave theme emits scatter instance groups, grouped by variant, doorways clear", () => {
  const r = cave({ theme: "cave", seed: "cv", origin: [0, 0, 0] });
  expect(r.instances.length).toBeGreaterThanOrEqual(3); // grouped by variant
  const postures = new Set(r.instances.map((g) => g.posture));
  expect(postures.has("lit")).toBe(true);
  expect(postures.has("emissive")).toBe(true);
  const total = r.instances.reduce((n, g) => n + g.transforms.length / 16, 0);
  expect(total).toBeGreaterThan(20);
  // keep-out: no instance within 0.5m (XZ) of any connection centre (world frame)
  for (const g of r.instances)
    for (let i = 0; i < g.transforms.length / 16; i++) {
      const x = g.transforms[i * 16 + 12] as number; // column-major translation X
      const z = g.transforms[i * 16 + 14] as number; // column-major translation Z
      for (const c of r.connections)
        expect(
          Math.hypot(x - c.position[0], z - c.position[2]),
        ).toBeGreaterThan(0.5);
    }
});

test("ceiling-target instances hang below the surface (not buried above it)", () => {
  // a quad at y=3 whose winding gives a -Y face normal (a ceiling)
  const ceiling: MeshData = {
    positions: new Float32Array([0, 3, 0, 4, 3, 0, 0, 3, 4, 4, 3, 4]),
    normals: new Float32Array(12), // unused — meshSurface derives the normal from winding
    uvs: new Float32Array(8),
    indices: new Uint32Array([0, 1, 2, 1, 3, 2]), // cross((4,0,0),(0,0,4)) = (0,-16,0) → -Y
  };
  const worms: ScatterLayerSpec = {
    ...floorSpec,
    name: "worms",
    target: "ceiling",
    spacing: { min: 1, max: 1 },
    scale: { min: 0.4, max: 0.4 },
  };
  const pts = scatter(meshSurface(ceiling), worms, makeRng("c"), []);
  expect(pts.length).toBeGreaterThan(0);
  for (const d of pts) {
    expect(d.position[1]).toBeLessThan(3); // hangs BELOW the ceiling, not buried above it
    expect(d.position[1]).toBeGreaterThan(3 - 1); // within ~one body-length of the surface
  }
});

const BASE_LAYER: ScatterLayerSpec = {
  name: "probe",
  geometry: { primitive: "cube" },
  posture: "lit",
  material: { color: [1, 1, 1, 1], specular: [0, 0, 0, 0] },
  target: "floor",
  spacing: { min: 0.5, max: 0.5 },
  scale: { min: 0.2, max: 0.2 },
};

test("collision posture is carried onto the group with placements, and consumes no RNG", () => {
  const surf = rectSurface({ minX: -2, maxX: 2, z0: -2, z1: 2, y: 0 });
  const matsGhost: MaterialDescriptor[] = [];
  const matsSolid: MaterialDescriptor[] = [];
  const ghost = instanceGroupsFromLayers(
    surf,
    [BASE_LAYER],
    makeRng("seed"),
    [],
    matsGhost,
  );
  const solid = instanceGroupsFromLayers(
    surf,
    [{ ...BASE_LAYER, collision: "solid" }],
    makeRng("seed"),
    [],
    matsSolid,
  );

  const g = ghost[0] as InstanceGroup;
  const s = solid[0] as InstanceGroup;

  expect(g.collision).toBeUndefined();
  expect(g.placements).toBeUndefined();

  expect(s.collision).toBe("solid");
  expect(s.placements).toBeDefined();
  expect(s.placements?.length).toBe(s.transforms.length / 16);

  // No RNG perturbation: a solid layer's baked transforms are byte-identical to the ghost's.
  expect(Array.from(s.transforms)).toEqual(Array.from(g.transforms));

  // Placements carry the SAME baked frame as transforms (offset applied): translation matches.
  const p0 = s.placements?.[0];
  expect(p0?.position[0]).toBeCloseTo(s.transforms[12] as number, 6);
  expect(p0?.position[1]).toBeCloseTo(s.transforms[13] as number, 6);
  expect(p0?.position[2]).toBeCloseTo(s.transforms[14] as number, 6);
});

test("box rooms carry world-placed floor scatter", () => {
  const regions = buildArea("rooms", [0, 0, 0]);
  // Bridge vestibules also carry theme "pillarHall" (a pre-existing tag) but are not
  // rooms — they emit no scatter and have no door. A real placed room is the one that
  // owns a door connection; filter on that so the vestibules don't poison the assertion.
  const rooms = regions.filter(
    (r) =>
      (r.provenance.theme === "pillarHall" ||
        r.provenance.theme === "greatHall") &&
      r.connections.some((c) => c.kind === "door"),
  );
  expect(rooms.length).toBeGreaterThan(0);
  for (const room of rooms) {
    const total = room.instances.reduce(
      (n, g) => n + g.transforms.length / 16,
      0,
    );
    expect(total).toBeGreaterThan(5); // floor scatter present
    for (const g of room.instances)
      for (let i = 0; i < g.transforms.length / 16; i++) {
        const x = g.transforms[i * 16 + 12] as number;
        const y = g.transforms[i * 16 + 13] as number;
        const z = g.transforms[i * 16 + 14] as number;
        expect(
          Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z),
        ).toBe(true);
        // placed into world on the room floor plane (origin.y), within embed slack
        expect(Math.abs(y - room.origin[1])).toBeLessThan(0.3);
        // within the room footprint around its world origin (generous bound)
        expect(Math.hypot(x - room.origin[0], z - room.origin[2])).toBeLessThan(
          40,
        );
      }
  }
});
