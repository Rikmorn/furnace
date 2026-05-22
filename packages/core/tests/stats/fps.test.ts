import { expect, test } from "bun:test";
import { computeFps, createFpsSystem } from "../../src/stats/fps.ts";

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
  const unsubscribe = system.subscribe(() => undefined);
  expect(typeof unsubscribe).toBe("function");
  unsubscribe();
  system.dispose();
});

test("createFpsSystem: supports multiple subscribers independently", () => {
  const system = createFpsSystem();
  const a = system.subscribe(() => undefined);
  const b = system.subscribe(() => undefined);
  expect(typeof a).toBe("function");
  expect(typeof b).toBe("function");
  a();
  b();
  system.dispose();
});

test("createFpsSystem: dispose is idempotent", () => {
  const system = createFpsSystem();
  system.dispose();
  expect(() => system.dispose()).not.toThrow();
});
