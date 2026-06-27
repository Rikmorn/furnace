import { expect, test } from "bun:test";
import { quat, vec3 } from "@furnace/core/transform";
import { buildArea } from "../src/compose.ts";
import type { RegionData } from "../src/region.ts";

test("buildArea returns the cave + a vestibule + a room per branch", () => {
  const regions = buildArea("area-1", [0, 0, 0]);
  const cave = regions.find((r) => r.provenance.theme === "cave") as RegionData;
  const branches = cave.connections.filter(
    (c) =>
      c.kind === "tunnel-mouth" && !(c.facing[0] === 0 && c.facing[2] === -1),
  ).length;
  // each branch → 1 vestibule + 1 room
  const rooms = regions.filter((r) => r.provenance.theme !== "cave");
  expect(rooms.length).toBeGreaterThanOrEqual(branches * 2); // vestibule + hall per branch
  expect((regions[0] as RegionData).provenance.theme).toBe("cave");
});

test("each room's door aligns to its cave branch (positions meet, facings negate)", () => {
  const regions = buildArea("area-1", [0, 0, 0]);
  const cave = regions.find((r) => r.provenance.theme === "cave") as RegionData;
  const mouths = cave.connections.filter(
    (c) =>
      c.kind === "tunnel-mouth" && !(c.facing[0] === 0 && c.facing[2] === -1),
  );
  for (const m of mouths) {
    // some region exposes a connection whose position ~= the mouth and facing ~= -mouth.facing
    const matched = regions.some((r) =>
      r.connections.some(
        (c) =>
          Math.hypot(
            c.position[0] - m.position[0],
            c.position[2] - m.position[2],
          ) < 3 &&
          c.facing[0] === -m.facing[0] &&
          c.facing[2] === -m.facing[2],
      ),
    );
    expect(matched).toBe(true);
  }
});

test("buildArea is deterministic", () => {
  expect(JSON.stringify(stripMesh(buildArea("z", [0, 0, 0])))).toBe(
    JSON.stringify(stripMesh(buildArea("z", [0, 0, 0]))),
  );
});

test("buildArea uses more than one room type across branches", () => {
  const regions = buildArea("area-multi", [0, 0, 0]);
  const themes = new Set(regions.map((r) => r.provenance.theme));
  expect(themes.has("pillarHall")).toBe(true);
  expect(themes.has("greatHall")).toBe(true);
});

test("placeRoom transforms a room dynamic group's placements into world frame, consistent with transforms", () => {
  const regions = buildArea("wing-1", [10, 2, -0.5]);
  const dynamicGroups = regions
    .flatMap((r) => r.instances)
    .filter((g) => g.collision === "dynamic");
  expect(dynamicGroups.length).toBeGreaterThan(0);

  for (const g of dynamicGroups) {
    expect(g.placements?.length).toBe(g.transforms.length / 16);
    g.placements?.forEach((p, i) => {
      // Each placement must sit at its instance's world-space mat4 translation. If placeRoom
      // left placements in LOCAL frame this fails (they'd be metres away from the transform).
      expect(p.position[0]).toBeCloseTo(g.transforms[i * 16 + 12] as number, 4);
      expect(p.position[1]).toBeCloseTo(g.transforms[i * 16 + 13] as number, 4);
      expect(p.position[2]).toBeCloseTo(g.transforms[i * 16 + 14] as number, 4);
      // Orientation is world-frame too: R(p.rotation)·X̂ agrees with the rendered transform's
      // normalized X basis (column 0). Guards that placeRoom transforms placement ROTATION, not
      // just position — realize.ts orients each dynamic collider from p.rotation. (Non-vacuous:
      // each crate carries a non-trivial random +Y yaw.)
      const pq = quat.fromValues(
        p.rotation[0],
        p.rotation[1],
        p.rotation[2],
        p.rotation[3],
      );
      const xFromQuat = vec3.transformQuat(
        vec3.create(),
        vec3.fromValues(1, 0, 0),
        pq,
      );
      const xWorld = vec3.normalize(
        vec3.create(),
        vec3.fromValues(
          g.transforms[i * 16] as number,
          g.transforms[i * 16 + 1] as number,
          g.transforms[i * 16 + 2] as number,
        ),
      );
      expect(xFromQuat[0] as number).toBeCloseTo(xWorld[0] as number, 4);
      expect(xFromQuat[2] as number).toBeCloseTo(xWorld[2] as number, 4);
    });
  }
});

function stripMesh(rs: ReturnType<typeof buildArea>) {
  return rs.map((r) => ({
    ...r,
    meshes: r.meshes.map((m) => ("box" in m.geometry ? m : "custom")),
  }));
}
