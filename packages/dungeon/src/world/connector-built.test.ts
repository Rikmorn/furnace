// src/world/connector-built.test.ts
import { expect, test } from "bun:test";
import { organicTunnel } from "./connector.ts";
import {
  BORE_SHELL_EXTENSION,
  buildCorridor,
  CARVE_DEPTH,
  CARVE_OUTER,
  carveToLocal,
  collarBore,
  collarBoreCarve,
  worldToLocal,
} from "./connector-built.ts";
import type { Connection } from "./region.ts";

const door = (
  pos: [number, number, number],
  facing: [number, number, number],
): Connection => ({ position: pos, facing, width: 2, height: 3, kind: "door" });

test("worldToLocal inverts a quarter-turn placement exactly (no dust)", () => {
  // placement: yaw π/2, translation [4, 1, -2]. World point = place(local).
  const placement = {
    yaw: Math.PI / 2,
    translation: [4, 1, -2] as [number, number, number],
  };
  // local [1,0,0] under Ry(π/2) → [0,0,-1]; +t → [4,1,-3].
  expect(worldToLocal([4, 1, -3], placement)).toEqual([1, 0, 0]);
  expect(worldToLocal([4, 1, -2], placement)).toEqual([0, 0, 0]);
});

test("corridor: flat tube between facing doors — open ends, sealed sides", () => {
  const a = door([0, 0, 0], [0, 0, 1]);
  const b = door([0, 0, 6], [0, 0, -1]);
  const r = buildCorridor(a, b, "c1");
  // Collider exists (fine proxy) and instances exist (skin) — no patch mesh.
  expect(r.colliders.length).toBe(1);
  expect(r.instances.length).toBeGreaterThan(0);
  expect(r.meshes.length).toBe(0);
  // Bounds span the gap along Z and the tube cross-section (3.0 = interior
  // 2.0 + two 0.5 walls) along X.
  expect(r.bounds.max[2] - r.bounds.min[2]).toBeCloseTo(6, 5);
  expect(r.bounds.max[0] - r.bounds.min[0]).toBeCloseTo(3.0, 5);
});

test("corridor with ΔY: risers must be exact 0.25 multiples, stairs emitted", () => {
  const a = door([0, 0, 0], [0, 0, 1]);
  const b = door([0, 1.5, 6], [0, 0, -1]);
  const r = buildCorridor(a, b, "c1");
  // Tread instances present: at least one instance group beyond the flat case's.
  const flat = buildCorridor(
    door([0, 0, 0], [0, 0, 1]),
    door([0, 0, 6], [0, 0, -1]),
    "c1",
  );
  const count = (x: typeof r) =>
    x.instances.reduce((n, g) => n + g.transforms.length / 16, 0);
  expect(count(r)).toBeGreaterThan(count(flat));
  expect(() =>
    buildCorridor(
      door([0, 0, 0], [0, 0, 1]),
      door([0, 0.3, 6], [0, 0, -1]),
      "c1",
    ),
  ).toThrow(/riser/);
});

test("corridor needs MORE run cells than risers (flush-landing guard)", () => {
  // risers === runCells is degenerate: the bottom cell is pinned flush at lift 0,
  // so full height (reached at fromLow === risers) needs a run cell beyond the
  // last, else the stair tops out one 0.25 m riser below the high door. Here
  // ΔY 1.0 → 4 risers over run 2.0 → 4 run cells → must throw.
  expect(() =>
    buildCorridor(
      door([0, 0, 0], [0, 0, 1]),
      door([0, 1.0, 2], [0, 0, -1]),
      "c1",
    ),
  ).toThrow(/run cells/);
  // One more run cell (run 2.5 → 5 cells) is enough → no throw.
  expect(() =>
    buildCorridor(
      door([0, 0, 0], [0, 0, 1]),
      door([0, 1.0, 2.5], [0, 0, -1]),
      "c1",
    ),
  ).not.toThrow();
});

test("collarBore: tunnel RegionData + a FLAT-ended cylinder carve spanning the wall band", () => {
  const d = door([0, 0, 0], [0, 0, -1]); // hall door faces -Z (outward)
  const mouth: Connection = {
    position: [0, 0, -8],
    facing: [0, 0, 1],
    width: 3.2,
    height: 3.2,
    kind: "tunnel-mouth",
  };
  const { tunnel, carve } = collarBore(d, mouth, "t1");
  expect(tunnel.colliders.length).toBe(1); // the bore proxy (W1 organicTunnel)
  // Cylinder, not capsule: a capsule's spherical end sweeps `radius` past the
  // segment into the room and eats pillars/floor (the W2 gate blob).
  expect(carve.kind).toBe("cylinder");
  expect(carve.radius).toBeCloseTo(1.6, 5);
  // Spans CARVE_OUTER past the door plane (through the grid edge — keeps the
  // patch field's off-grid rule reading the opening as continuing air, no lid)
  // to CARVE_DEPTH inward (+Z into the hall).
  expect(carve.a[2]).toBeCloseTo(-CARVE_OUTER, 5);
  expect(carve.b[2]).toBeCloseTo(CARVE_DEPTH, 5);
  expect(carve.a[1]).toBeCloseTo(1.6, 5); // centreline raised bore-floor-flush
  // The floor beneath the threshold is protected (no groove at the door).
  if (carve.kind !== "cylinder") throw new Error("unreachable");
  expect(carve.clipBelowY).toBe(0);
});

test("carveToLocal: quarter-turn placement transforms endpoints AND the Y-clip", () => {
  const carve = collarBoreCarve(door([4, 1, -2], [0, 0, -1]));
  const local = carveToLocal(carve, {
    yaw: Math.PI / 2,
    translation: [4, 1, -2],
  });
  // Y is preserved by the yaw and shifted by −t[1]; the clip must follow it.
  expect(local.a[1]).toBeCloseTo(carve.a[1] - 1, 10);
  if (local.kind !== "cylinder") throw new Error("kind changed");
  expect(local.clipBelowY).toBeCloseTo(0, 10); // door y (1) − t[1] (1)
});

test("stair treads seat their 2.0m door-width ACROSS the corridor (yaw not inverted)", () => {
  // Treads are the ONLY stair render (the fine-grid fill is collision-only), so a
  // 90°-inverted yaw ships visibly-broken steps. PIECE_BOX.tread = [0.5 run,
  // 0.25 rise, 2.0 width] (local-X run, local-Z width). Column-major TRS bakes
  // the scaled local-Z axis into columns [8..10]; a correct yaw on this Z-bore
  // corridor lands the 2.0 width on world-X (|m[8]|≈2.0), an inverted yaw would
  // put it on world-Z (m[8]≈0). Only the tread has a 2.0 dimension in a corridor.
  const r = buildCorridor(
    door([0, 0, 0], [0, 0, 1]),
    door([0, 1.5, 6], [0, 0, -1]),
    "c1",
  );
  const localZOnWorldX: number[] = [];
  for (const g of r.instances)
    for (let i = 0; i < g.transforms.length; i += 16)
      localZOnWorldX.push(Math.abs(g.transforms[i + 8] as number));
  expect(localZOnWorldX.some((x) => Math.abs(x - 2.0) < 1e-3)).toBe(true);
});

// W2 gate round 2: the collar-bore tunnel's grid extends into the built shell
// band so its tube wall renders THROUGH the wall thickness and buries into the
// carve patch (interpenetration seals the seam ring — the W1 mouth pattern).
// Exactly the shell (BORE_SHELL_EXTENSION = 0.5) and no further: past it the
// tunnel's rock-outside-tube would intrude into interior room air.
test("collarBore tunnel mesh enters the shell band; plain organicTunnel stays clipped", () => {
  const d = door([0, 0, 0], [0, 0, -1]); // door plane z=0, hall interior is +Z
  const mouth: Connection = {
    position: [0, 0, -8],
    facing: [0, 0, 1],
    width: 3.2,
    height: 3.2,
    kind: "tunnel-mouth",
  };
  const maxZ = (r: {
    meshes: { geometry: { custom?: { positions: Float32Array } } | object }[];
  }): number => {
    let m = Number.NEGATIVE_INFINITY;
    for (const mesh of r.meshes) {
      if (!("custom" in mesh.geometry) || !mesh.geometry.custom) continue;
      const pos = mesh.geometry.custom.positions;
      for (let i = 2; i < pos.length; i += 3) m = Math.max(m, pos[i] as number);
    }
    return m;
  };
  const { tunnel } = collarBore(d, mouth, "t1");
  const collarBoreMax = maxZ(tunnel);
  // INTO the band (past the door plane toward the hall interior)…
  expect(collarBoreMax).toBeGreaterThan(0.05);
  // …but never past the shell into room air.
  expect(collarBoreMax).toBeLessThanOrEqual(BORE_SHELL_EXTENSION + 1e-6);
  // The plain organic tunnel (no extendA) keeps the W1 door-plane clip.
  const plain = organicTunnel(d, mouth, "t1");
  expect(maxZ(plain)).toBeLessThanOrEqual(1e-6);
});
