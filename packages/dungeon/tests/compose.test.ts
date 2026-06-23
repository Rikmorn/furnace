import { expect, test } from "bun:test";
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

function stripMesh(rs: ReturnType<typeof buildArea>) {
  return rs.map((r) => ({
    ...r,
    meshes: r.meshes.map((m) => ("box" in m.geometry ? m : "custom")),
  }));
}
