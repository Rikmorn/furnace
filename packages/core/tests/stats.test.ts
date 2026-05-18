import { expect, test } from "bun:test";
import { computeFps } from "../src/stats.ts";

test("computeFps: zero elapsed time returns 0", () => {
  expect(computeFps(60, 0)).toBe(0);
});

test("computeFps: negative elapsed time returns 0 (clock anomaly guard)", () => {
  expect(computeFps(60, -0.5)).toBe(0);
});

test("computeFps: rounds frames-per-second to nearest integer", () => {
  expect(computeFps(60, 1)).toBe(60);
  expect(computeFps(120, 1)).toBe(120);
  expect(computeFps(59, 1.01)).toBe(58);
});

test("computeFps: zero frames over a positive interval returns 0", () => {
  expect(computeFps(0, 1)).toBe(0);
});

import { createFpsSystem } from "../src/stats.ts";

test("createFpsSystem: exposes the FpsSystem API surface with current=0 initially", () => {
  const system = createFpsSystem();
  expect(typeof system.frame).toBe("function");
  expect(typeof system.subscribe).toBe("function");
  expect(typeof system.dispose).toBe("function");
  expect(system.current).toBe(0);
  system.dispose();
});

test("createFpsSystem: subscribe returns an unsubscribe function", () => {
  const system = createFpsSystem();
  const unsubscribe = system.subscribe(() => {});
  expect(typeof unsubscribe).toBe("function");
  unsubscribe(); // does not throw
  system.dispose();
});

test("createFpsSystem: supports multiple subscribers independently", () => {
  const system = createFpsSystem();
  const a = system.subscribe(() => {});
  const b = system.subscribe(() => {});
  expect(typeof a).toBe("function");
  expect(typeof b).toBe("function");
  a();
  b();
  system.dispose();
});

test("createFpsSystem: dispose stops the interval (no throws on double dispose)", () => {
  const system = createFpsSystem();
  system.dispose();
  expect(() => system.dispose()).not.toThrow();
});
