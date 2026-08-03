import { expect, test } from "bun:test";
import { ZERO_SNAPSHOT } from "./zero-snapshot.ts";

test("ZERO_SNAPSHOT: all numeric fields are 0", () => {
  expect(ZERO_SNAPSHOT.frame.fps).toBe(0);
  expect(ZERO_SNAPSHOT.frame.ms.last).toBe(0);
  expect(ZERO_SNAPSHOT.frame.ms.mean).toBe(0);
  expect(ZERO_SNAPSHOT.gpu.drawCalls).toBe(0);
  expect(ZERO_SNAPSHOT.gpu.triangles).toBe(0);
  expect(ZERO_SNAPSHOT.gpu.uncapturedErrors).toBe(0);
  expect(ZERO_SNAPSHOT.resources.meshes).toBe(0);
  expect(ZERO_SNAPSHOT.memory.total).toBe(0);
});

test("ZERO_SNAPSHOT: renderMs / computeMs are null", () => {
  expect(ZERO_SNAPSHOT.gpu.renderMs).toBeNull();
  expect(ZERO_SNAPSHOT.gpu.computeMs).toBeNull();
});

test("ZERO_SNAPSHOT: events.perEmitter and custom are empty objects", () => {
  expect(ZERO_SNAPSHOT.events.perEmitter).toEqual({});
  expect(ZERO_SNAPSHOT.custom).toEqual({});
});

test("ZERO_SNAPSHOT: frozen", () => {
  expect(Object.isFrozen(ZERO_SNAPSHOT)).toBe(true);
});

test("ZERO_SNAPSHOT.gpu.deviceLost is false", () => {
  expect(ZERO_SNAPSHOT.gpu.deviceLost).toBe(false);
});
