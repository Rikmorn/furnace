import { describe, expect, test } from "bun:test";
import {
  buildWorld,
  COCKPIT_BUDGET,
  COCKPIT_CONFIG,
  worldAttempts,
} from "../src/world.ts";

// The cockpit steps this iterator between paints; buildWorld drains it. ONE loop in
// the codebase — the equivalence tests below are the no-drift guarantee (spec §0.4).
describe("worldAttempts", () => {
  const CFG = {
    sectors: [1, 1] as [number, number],
    targetRooms: 4,
    attempts: 6,
  };

  test("buildWorld equals draining the iterator (same seed, same result)", () => {
    const viaBuild = buildWorld("wa-eq-0", CFG);
    let drained: { attempt: number; ok: boolean } | undefined;
    for (const a of worldAttempts("wa-eq-0", CFG)) {
      if (a.ok) {
        drained = a;
        break;
      }
    }
    expect(drained).toBeDefined();
    expect(drained?.attempt).toBe(viaBuild.attempt);
  });

  test("attempt k is deterministic: same seed twice → identical placements", () => {
    const a = buildWorld("wa-det-0", CFG);
    const b = buildWorld("wa-det-0", CFG);
    expect(a.attempt).toBe(b.attempt);
    expect([...a.layout.placements.entries()]).toEqual([
      ...b.layout.placements.entries(),
    ]);
  });

  test("iterator yields ok:false attempts then stops at cfg.attempts", () => {
    // attempts:0 edge — iterator yields nothing; buildWorld throws setup-loud.
    const seen = [...worldAttempts("wa-x", { ...CFG, attempts: 0 })];
    expect(seen).toHaveLength(0);
    expect(() => buildWorld("wa-x", { ...CFG, attempts: 0 })).toThrow(
      /failed all 0/,
    );
  });

  test("cockpit constants exist and are sane", () => {
    expect(COCKPIT_CONFIG.sectors).toEqual([1, 1]);
    expect(COCKPIT_BUDGET.maxAttempts).toBeLessThanOrEqual(2000);
  });
});
