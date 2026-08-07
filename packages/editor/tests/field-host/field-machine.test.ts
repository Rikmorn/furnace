// `field-machine.ts`'s module-scope surface — the part that is pure and needs no host.
//
// The machine ITSELF is not unit-tested here and that is deliberate rather than a gap.
// It is a factory over a 39-member deps record whose whole contract is orchestration, and
// the two things worth asserting about it are already asserted better elsewhere: the pure
// session state machine it drives is pinned by `tests/field-stamp.test.ts` (1,971 lines,
// no host, no GPU), and the wiring is pinned by the host suites passing UNMODIFIED across
// the extraction — which was the extraction's contract. A stub-deps harness would restate
// the first and weaken the second. This file is the home for what falls outside both.
import { expect, test } from "bun:test";
import { randomStampSeed } from "../../src/field-host/field-machine.ts";

// `randomStampSeed` reads ONE `Uint16Array` element out of `crypto.getRandomValues`, and
// that width is load-bearing OUTSIDE this function in a way nothing else notices.
//
// `tests/field-host-entity-verbs.test.ts`'s `stubRandomSeed` pins the entropy source by
// testing `array instanceof Uint16Array` before writing its fixed value — so the re-roll
// assertions there are deterministic only while this function asks for that exact view.
// Widen it to `Uint32Array` and the stub's branch silently stops matching, the seed goes
// back to being real entropy, and nothing throws.
//
// Measured rather than assumed: that sabotage DOES redden entity-verbs today ("a seeded
// generator's copy re-rolls; the hall's keeps its recorded seed"). What it loses is not
// the failure but the REASON — the suite then fails on a random draw rather than on the
// defect, so it could equally have passed, and the next reader has no way to tell a real
// break from a lucky one. The width is asserted here so the defect has somewhere to fail
// deterministically and by name.
//
// Nothing downstream catches it either: core validates no seed range (grepped at head), so
// an out-of-range seed produces different generator output rather than a throw.
test("randomStampSeed returns a uint16 — the width `stubRandomSeed` depends on", () => {
  const real = crypto.getRandomValues;
  const seen: string[] = [];
  Object.defineProperty(crypto, "getRandomValues", {
    configurable: true,
    writable: true,
    value: <T extends ArrayBufferView | null>(array: T): T => {
      if (array !== null) seen.push(array.constructor.name);
      return real.call(crypto, array as never) as T;
    },
  });
  try {
    randomStampSeed();
    expect(seen).toEqual(["Uint16Array"]);
  } finally {
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      writable: true,
      value: real,
    });
  }
});

test("randomStampSeed stays inside the uint16 range it promises", () => {
  // Sampled rather than reasoned: the range is the contract a widened view would break,
  // and the `?? 0` fallback in the implementation means a wrong view would still return a
  // number rather than throw — so the value is the only witness.
  for (let i = 0; i < 200; i++) {
    const s = randomStampSeed();
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(65535);
  }
});
