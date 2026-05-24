import { expect, test } from "bun:test";
import { createFpsCounter, tickFps } from "../../src/stats/fps-counter.ts";

test("createFpsCounter: starts with current=0", () => {
  const c = createFpsCounter(1000);
  expect(c.current).toBe(0);
  expect(c.windowStart).toBe(1000);
  expect(c.windowFrames).toBe(0);
});

test("tickFps: increments frames; current stays 0 within the first window", () => {
  const c = createFpsCounter(1000);
  tickFps(c, 1100);
  tickFps(c, 1200);
  tickFps(c, 1500);
  expect(c.current).toBe(0);
  expect(c.windowFrames).toBe(3);
});

test("tickFps: at 1000ms boundary computes current and resets window", () => {
  const c = createFpsCounter(0);
  for (let i = 1; i <= 60; i++) tickFps(c, i * 16);
  expect(c.current).toBe(0);
  tickFps(c, 1004);
  expect(c.current).toBeCloseTo(60.76, 1);
  expect(c.windowFrames).toBe(0);
  expect(c.windowStart).toBe(1004);
});

test("tickFps: handles long gap (no frames for 2s) without divide-by-zero", () => {
  const c = createFpsCounter(0);
  tickFps(c, 1500);
  expect(c.current).toBeCloseTo(1000 / 1500, 4);
  expect(c.windowStart).toBe(1500);
  expect(c.windowFrames).toBe(0);
});
