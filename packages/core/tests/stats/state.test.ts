import { expect, test } from "bun:test";
import { createStatsState } from "../../src/stats/state.ts";

test("createStatsState: returns a state with zero counters and empty maps", () => {
  const s = createStatsState(1000);
  expect(s.frameStartTime).toBeNull();
  expect(s.window.filled).toBe(0);
  expect(s.fps.current).toBe(0);
  expect(s.fps.windowStart).toBe(1000);
  expect(s.drawCalls).toBe(0);
  expect(s.triangles).toBe(0);
  expect(s.pipelineSwitches).toBe(0);
  expect(s.bindGroupSwitches).toBe(0);
  expect(s.uncapturedErrors).toBe(0);
  expect(s.resources.entries.size).toBe(0);
  expect(s.emissions.size).toBe(0);
  expect(s.gauges.size).toBe(0);
  expect(s.counters.size).toBe(0);
  expect(s.measures.size).toBe(0);
  expect(s.onFrameSubscribers.size).toBe(0);
});
