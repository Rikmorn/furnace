import { expect, test } from "bun:test";
import { buildArea } from "../src/compose.ts";

test("composed regions carry an instances array (empty until themes populate)", () => {
  const regions = buildArea("seed-x", [0, 0, 0]);
  for (const r of regions) expect(Array.isArray(r.instances)).toBe(true);
});
