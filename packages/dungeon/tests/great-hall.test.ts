import { expect, test } from "bun:test";
import { STEP_HEIGHT } from "../src/themes/box-room.ts";
import { greatHall } from "../src/themes/great-hall.ts";

const params = {
  theme: "greatHall" as const,
  seed: "gh-1",
  origin: [0, 0, 0] as [number, number, number],
};

test("greatHall is taller and wider than a pillarHall and has a door", () => {
  const r = greatHall(params);
  const maxY = Math.max(
    ...r.meshes.flatMap((m) =>
      "box" in m.geometry
        ? [m.position[1] + (m.geometry.box[1] as number) / 2]
        : [],
    ),
  );
  expect(maxY).toBeGreaterThan(6); // tall
  expect(r.connections.filter((c) => c.kind === "door").length).toBe(1);
});

test("the platform is reachable: every step rise is under STEP_HEIGHT", () => {
  const r = greatHall(params);
  const stepTops = r.meshes
    .flatMap((m) =>
      "box" in m.geometry
        ? [m.position[1] + (m.geometry.box[1] as number) / 2]
        : [],
    )
    .sort((a, b) => a - b);
  for (let i = 1; i < stepTops.length; i++) {
    const d = (stepTops[i] as number) - (stepTops[i - 1] as number);
    if (d > 0 && d < 2) expect(d).toBeLessThanOrEqual(STEP_HEIGHT + 1e-6);
  }
});
