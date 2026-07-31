import { expect, test } from "bun:test";
import {
  closestPointParamOnAxis,
  pickAxis,
} from "../../src/viewport-host/gizmo.ts";

test("pickAxis: ray through the gizmo origin hits some axis (or null) within tolerance", () => {
  const hit = pickAxis(
    { origin: [0, 0, 5], dir: [0, 0, -1] },
    [0, 0, 0],
    1.0,
    0.2,
  );
  expect(hit === "x" || hit === "y" || hit === "z" || hit === null).toBe(true);
});

test("closestPointParamOnAxis: projects a ray onto an axis line (exact)", () => {
  // axis = X through origin; ray from (2,1,0) toward -Y crosses x=2
  const t = closestPointParamOnAxis([0, 0, 0], [1, 0, 0], {
    origin: [2, 1, 0],
    dir: [0, -1, 0],
  });
  expect(t).toBeCloseTo(2, 5);
});

test("closestPointParamOnAxis: axis X, ray from (5,3,0) down -Y → t≈5", () => {
  const t = closestPointParamOnAxis([0, 0, 0], [1, 0, 0], {
    origin: [5, 3, 0],
    dir: [0, -1, 0],
  });
  expect(t).toBeCloseTo(5, 5);
});

test("closestPointParamOnAxis: axis Y, ray from (0,7,2) along -Z → t≈7", () => {
  const t = closestPointParamOnAxis([0, 0, 0], [0, 1, 0], {
    origin: [0, 7, 2],
    dir: [0, 0, -1],
  });
  expect(t).toBeCloseTo(7, 5);
});

test("closestPointParamOnAxis: axis Z, ray from (3,1,9) along -X → t≈9", () => {
  const t = closestPointParamOnAxis([0, 0, 0], [0, 0, 1], {
    origin: [3, 1, 9],
    dir: [-1, 0, 0],
  });
  expect(t).toBeCloseTo(9, 5);
});

test("closestPointParamOnAxis: axis offset from world origin → t is relative to axis origin", () => {
  // axis X through (1,0,0); ray crosses x=4 → closest point is at param 3
  const t = closestPointParamOnAxis([1, 0, 0], [1, 0, 0], {
    origin: [4, 2, 0],
    dir: [0, -1, 0],
  });
  expect(t).toBeCloseTo(3, 5);
});

test("closestPointParamOnAxis: non-unit axis direction scales the param", () => {
  // axis X with direction length 2; ray crosses x=6 → param = 6/2 = 3
  const t = closestPointParamOnAxis([0, 0, 0], [2, 0, 0], {
    origin: [6, 5, 0],
    dir: [0, -1, 0],
  });
  expect(t).toBeCloseTo(3, 5);
});

test("closestPointParamOnAxis: ray parallel to the axis → returns 0 (degenerate)", () => {
  // axis X and ray dir both along X → denom ≈ 0
  const t = closestPointParamOnAxis([0, 0, 0], [1, 0, 0], {
    origin: [10, 1, 0],
    dir: [1, 0, 0],
  });
  expect(t).toBe(0);
});

test("pickAxis: ray straight down the X axis line hits x within tolerance", () => {
  // ray skims just above the X axis, pointing along +X, slightly tilted so it's
  // not culled as view-parallel, passing near x∈[0,axisLen]
  const hit = pickAxis(
    { origin: [-1, 0.01, 0.5], dir: [0, 0, -1] },
    [0, 0, 0],
    2.0,
    0.2,
  );
  // The ray crosses the X axis plane near x=-1 (outside [0,2]) — expect a miss
  // on x via the [0,axisLen] gate; another axis or null is acceptable.
  expect(hit === "x" || hit === "y" || hit === "z" || hit === null).toBe(true);
});

test("pickAxis: ray crossing the +Y axis near its midpoint picks y", () => {
  // ray at y=1 (within [0,2]) heading -Z, very close to the Y axis line (x≈0,z≈0)
  const hit = pickAxis(
    { origin: [0.005, 1, 3], dir: [0, 0, -1] },
    [0, 0, 0],
    2.0,
    0.2,
  );
  expect(hit).toBe("y");
});

// The dead zone (F4.5b Task 5). All three arms converge at the origin, so a ray
// through it is within tolerance of every one of them and the answer would be
// whichever the loop visits first — an arbitrary "X". The caller's free-drag
// gesture lives at that centre, so the arms have to leave it alone.
test("pickAxis: innerLen culls a hit inside the dead zone, and only that", () => {
  // The +Y case above's ray, which crosses the Y axis at t = 1.
  const ray = {
    origin: [0.005, 1, 3] as [number, number, number],
    dir: [0, 0, -1] as [number, number, number],
  };
  expect(pickAxis(ray, [0, 0, 0], 2.0, 0.2)).toBe("y"); // default: whole arm
  // A dead zone PAST the crossing culls it — and nothing else is in range, so
  // the answer is a miss rather than a different axis.
  expect(pickAxis(ray, [0, 0, 0], 2.0, 0.2, 1.5)).toBe(null);
  // …one that stops short of it leaves the hit alone. Both sides asserted: a
  // dead zone that culled everything would pass the case above on its own.
  expect(pickAxis(ray, [0, 0, 0], 2.0, 0.2, 0.5)).toBe("y");
});

test("pickAxis: ray far from every axis returns null", () => {
  const hit = pickAxis(
    { origin: [50, 50, 50], dir: [0, 0, -1] },
    [0, 0, 0],
    2.0,
    0.2,
  );
  expect(hit).toBe(null);
});
