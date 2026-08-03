import { expect, test } from "bun:test";
import { fixedClock } from "./fixed-clock.ts";

const noop = (): void => {
  return;
};

test("advance runs onTick at the fixed rate regardless of frame size", () => {
  const clock = fixedClock({ fixedDtMs: 16 });
  let ticks = 0;
  clock.advance(16, () => ticks++); // accumulator = 16 → 1 tick
  expect(ticks).toBe(1);
  clock.advance(48, () => ticks++); // accumulator += 48 → 3 more ticks
  expect(ticks).toBe(4);
});

test("onTick receives dtSeconds (fixedDtMs / 1000)", () => {
  const clock = fixedClock({ fixedDtMs: 20 });
  const dts: number[] = [];
  clock.advance(20, (dt) => dts.push(dt));
  expect(dts[0]).toBeCloseTo(0.02, 5);
});

test("advance returns the sub-tick alpha in [0,1)", () => {
  const clock = fixedClock({ fixedDtMs: 100 });
  expect(clock.advance(50, noop)).toBeCloseTo(0.5); // acc=50, 0 ticks
  expect(clock.advance(50, noop)).toBeCloseTo(0); // acc=100, 1 tick, acc→0
});

test("maxCatchupTicks caps the inner loop", () => {
  const clock = fixedClock({ fixedDtMs: 10, maxCatchupTicks: 3 });
  let ticks = 0;
  clock.advance(50, () => ticks++); // would-be 5, capped to 3
  expect(ticks).toBe(3);
});

test("default maxCatchupTicks caps catch-up at 8 ticks", () => {
  const clock = fixedClock({ fixedDtMs: 10 }); // default maxCatchupTicks = 8
  let ticks = 0;
  clock.advance(200, () => ticks++); // would-be 20, capped to the default 8
  expect(ticks).toBe(8);
});

test("when the cap fires with work pending, the surplus is discarded (no spiral)", () => {
  const clock = fixedClock({ fixedDtMs: 10, maxCatchupTicks: 3 });
  const alpha = clock.advance(50, noop); // 5 wanted, 3 done, surplus discarded
  expect(alpha).toBeCloseTo(0);
});

test("a naturally-drained sub-tick remainder is preserved at the cap", () => {
  const clock = fixedClock({ fixedDtMs: 10, maxCatchupTicks: 3 });
  let ticks = 0;
  // 35ms: 3 full ticks consume 30ms; remainder 5ms < fixedDtMs → not discarded.
  const alpha = clock.advance(35, () => ticks++);
  expect(ticks).toBe(3);
  expect(alpha).toBeCloseTo(0.5);
});

test("setFixedDtMs changes the step length at runtime", () => {
  const clock = fixedClock({ fixedDtMs: 10 });
  clock.setFixedDtMs(20);
  expect(clock.fixedDtMs).toBe(20);
  let ticks = 0;
  clock.advance(20, () => ticks++); // 1 tick at the new 20ms step
  expect(ticks).toBe(1);
});

test("fixedClock throws when fixedDtMs is zero / negative / NaN / Infinity", () => {
  for (const bad of [0, -16, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => fixedClock({ fixedDtMs: bad })).toThrow(
      "fixedDtMs must be a positive finite number",
    );
  }
});

test("setFixedDtMs throws on non-positive / non-finite dt", () => {
  const clock = fixedClock({ fixedDtMs: 16 });
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => clock.setFixedDtMs(bad)).toThrow(
      "fixedDtMs must be a positive finite number",
    );
  }
});

test("fixedClock throws when maxCatchupTicks is zero or fractional", () => {
  for (const bad of [0, 1.5]) {
    expect(() => fixedClock({ fixedDtMs: 16, maxCatchupTicks: bad })).toThrow(
      "maxCatchupTicks must be a positive integer",
    );
  }
});

test("fixedClock accepts undefined maxCatchupTicks (uses default)", () => {
  expect(() => fixedClock({ fixedDtMs: 16 })).not.toThrow();
});

test("advance(fixedDtMs) runs exactly one tick (single-step recipe)", () => {
  const clock = fixedClock({ fixedDtMs: 1000 / 60 });
  // Seed a sub-tick remainder, as a normal frame would leave behind.
  let ticks = 0;
  clock.advance(clock.fixedDtMs * 1.3, () => ticks++); // runs 1 tick, leaves 0.3
  expect(ticks).toBe(1);

  // One explicit step must advance by exactly one tick regardless of remainder.
  ticks = 0;
  clock.advance(clock.fixedDtMs, () => ticks++);
  expect(ticks).toBe(1);
});
