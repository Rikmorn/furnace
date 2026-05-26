import { expect, test } from "bun:test";
import { pushFrameMs } from "../../src/stats/frame-window.ts";
import { registerResource } from "../../src/stats/resources.ts";
import { buildSnapshot } from "../../src/stats/snapshot.ts";
import { createStatsState } from "../../src/stats/state.ts";

test("buildSnapshot: zero state produces zero values across all fields", () => {
  const state = createStatsState(0);
  const snap = buildSnapshot(state);
  expect(snap.frame.fps).toBe(0);
  expect(snap.frame.ms.last).toBe(0);
  expect(snap.frame.ms.mean).toBe(0);
  expect(snap.frame.ms.p99).toBe(0);
  expect(snap.frame.ms.min).toBe(0);
  expect(snap.frame.ms.max).toBe(0);
  expect(snap.gpu.drawCalls).toBe(0);
  expect(snap.gpu.triangles).toBe(0);
  expect(snap.gpu.uncapturedErrors).toBe(0);
  expect(snap.gpu.renderMs).toBeNull();
  expect(snap.gpu.computeMs).toBeNull();
  expect(snap.resources.meshes).toBe(0);
  expect(snap.memory.total).toBe(0);
  expect(snap.custom).toEqual({});
});

test("buildSnapshot: populated state reflects counters", () => {
  const state = createStatsState(0);
  pushFrameMs(state.window, 16.6);
  pushFrameMs(state.window, 17.0);
  state.fps.current = 60;
  state.drawCalls = 3;
  state.triangles = 1184;
  state.uncapturedErrors = 1;
  state.emissions.set("gpu.onResize", 2);
  state.gauges.set("npcCount", 42);
  state.counters.set("collisions", 7);
  state.measures.set("game.ai", 2.5);
  registerResource(state.resources, { kind: "mesh" });
  registerResource(state.resources, { kind: "buffer", bytes: 1024 });

  const snap = buildSnapshot(state);
  expect(snap.frame.fps).toBe(60);
  expect(snap.frame.ms.last).toBeCloseTo(17.0);
  expect(snap.frame.ms.mean).toBeCloseTo((16.6 + 17.0) / 2);
  expect(snap.gpu.drawCalls).toBe(3);
  expect(snap.gpu.triangles).toBe(1184);
  expect(snap.gpu.uncapturedErrors).toBe(1);
  expect(snap.events.perEmitter["gpu.onResize"]).toBe(2);
  expect(snap.custom["npcCount"]).toBe(42);
  expect(snap.custom["collisions"]).toBe(7);
  expect(snap.custom["game.ai"]).toBeCloseTo(2.5);
  expect(snap.resources.meshes).toBe(1);
  expect(snap.memory.bufferBytes).toBe(1024);
  expect(snap.memory.total).toBe(1024);
});

test("buildSnapshot: returns a frozen object", () => {
  const state = createStatsState(0);
  const snap = buildSnapshot(state);
  expect(Object.isFrozen(snap)).toBe(true);
});

test("buildSnapshot: successive calls produce distinct objects", () => {
  const state = createStatsState(0);
  const a = buildSnapshot(state);
  const b = buildSnapshot(state);
  expect(a).not.toBe(b);
});

test("snapshot.gpu.deviceLost reflects state.deviceLost", () => {
  const s = createStatsState(performance.now());
  expect(buildSnapshot(s).gpu.deviceLost).toBe(false);
  s.deviceLost = true;
  expect(buildSnapshot(s).gpu.deviceLost).toBe(true);
});

test("snapshot.resources includes effects count", () => {
  const s = createStatsState(0);
  registerResource(s.resources, { kind: "effect" });
  registerResource(s.resources, { kind: "effect" });
  const snap = buildSnapshot(s);
  expect(snap.resources.effects).toBe(2);
});
