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
  expect(s.resources.counts.meshes).toBe(0);
  expect(s.resources.counts.materials).toBe(0);
  expect(s.resources.counts.geometries).toBe(0);
  expect(s.resources.counts.effects).toBe(0);
  expect(s.resources.memory.bufferBytes).toBe(0);
  expect(s.resources.memory.textureBytes).toBe(0);
  expect(s.emissions.size).toBe(0);
  expect(s.gauges.size).toBe(0);
  expect(s.counters.size).toBe(0);
  expect(s.measures.size).toBe(0);
  expect(s.onFrameSubscribers.size).toBe(0);
});

test("createStatsState initialises deviceLost to false", () => {
  const s = createStatsState(performance.now());
  expect(s.deviceLost).toBe(false);
});
