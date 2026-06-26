import { expect, test } from "bun:test";
import { pillarHall } from "../src/themes/pillar-hall.ts";

const params = {
  theme: "pillarHall" as const,
  seed: "ph-1",
  origin: [0, 0, 0] as [number, number, number],
};

test("pillarHall yields box meshes, matching cuboids, a material, and a door connection", () => {
  const r = pillarHall(params);
  expect(r.meshes.length).toBeGreaterThan(6); // shell + pillars
  expect(r.colliders.length).toBe(r.meshes.length);
  // Shell material at index 0 (every box mesh references it) plus appended
  // floor-scatter layer materials — assert the shell is present, not the exact count.
  expect(r.materials.length).toBeGreaterThanOrEqual(1);
  expect(r.connections.filter((c) => c.kind === "door").length).toBe(1);
});

test("pillarHall is deterministic and varies by seed", () => {
  expect(pillarHall(params).meshes.length).toBe(
    pillarHall(params).meshes.length,
  );
  // different seeds → (usually) different box counts via dims/pillar grid
  const counts = new Set(
    ["a", "b", "c", "d"].map(
      (s) => pillarHall({ ...params, seed: s }).meshes.length,
    ),
  );
  expect(counts.size).toBeGreaterThan(1);
});
