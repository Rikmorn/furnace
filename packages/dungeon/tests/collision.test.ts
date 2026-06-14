import { expect, test } from "bun:test";
import { slideMove } from "../src/collision.ts";
import type { Box } from "../src/level.ts";
import { LEVEL_BOXES } from "../src/level.ts";

const RADIUS = 0.3;
// A wall: thin box at x=1.5 spanning z.
const WALL: Box[] = [{ center: [1.5, 1.5, -8], size: [0.2, 3, 16] }];

test("moving into a wall on +X is blocked", () => {
  const from: [number, number, number] = [1.0, 1.6, -8];
  const out = slideMove(from, [0.5, 0, 0], RADIUS, WALL);
  // wall inner face at x = 1.5 - 0.1 = 1.4; minus radius 0.3 → stop at 1.1
  expect(out[0]).toBeLessThanOrEqual(1.1 + 1e-4);
  expect(out[0]).toBeGreaterThan(1.0 - 1e-4);
});

test("moving parallel to the wall on Z slides freely", () => {
  const from: [number, number, number] = [1.0, 1.6, -8];
  const out = slideMove(from, [0, 0, -1], RADIUS, WALL);
  expect(out[2]).toBeCloseTo(-9, 5);
  expect(out[0]).toBeCloseTo(1.0, 5);
});

test("a blocked X still allows the Z component (slide along wall)", () => {
  const from: [number, number, number] = [1.0, 1.6, -8];
  const out = slideMove(from, [0.5, 0, -1], RADIUS, WALL);
  expect(out[0]).toBeLessThanOrEqual(1.1 + 1e-4); // X clamped
  expect(out[2]).toBeCloseTo(-9, 5); // Z free
});

test("a floor box below the player does not block horizontal movement", () => {
  const FLOOR: Box[] = [{ center: [0, 0, -8], size: [3, 0.2, 16] }];
  const out = slideMove([0, 1.6, -8], [0.5, 0, 0], RADIUS, FLOOR);
  expect(out[0]).toBeCloseTo(0.5, 5); // free — floor is below the player's body band
});

test("player can walk forward from spawn (floors/ceilings don't trap them)", () => {
  const out = slideMove([0, 1.6, -2], [0, 0, -0.5], RADIUS, LEVEL_BOXES);
  expect(out[2]).toBeLessThan(-2); // moved forward, NOT ejected backward
  expect(out[2]).toBeCloseTo(-2.5, 5);
});

test("sliding sideways along a wide wall does not teleport (regression: wide-box eject)", () => {
  const BACK: Box[] = [{ center: [0, 3, -32], size: [12, 6, 0.2] }];
  const out = slideMove([0, 1.6, -31.7], [0.05, 0, 0], 0.3, BACK);
  expect(out[0]).toBeCloseTo(0.05, 5); // slides freely; pre-fix this was -6.3
  const out2 = slideMove([0, 1.6, -31.7], [-0.05, 0, 0], 0.3, BACK);
  expect(out2[0]).toBeCloseTo(-0.05, 5); // pre-fix this was +6.3
});

// A simulation sweep that mimics real play: push hard in every direction from
// several interior start points for many frames, replaying the controller's
// integration `pos := slideMove(pos, dir*speed*dt, r, boxes)`. A correct clamp
// can only REDUCE the attempted step, never teleport, so the player must never
// leave the level interior and no single XZ frame jump may exceed the step.
test("simulation sweep: player never escapes the level and never teleports", () => {
  const R = 0.3;
  const SPEED = 4;
  const EYE = 1.6;
  const STEP_CAP = 0.45; // a correct clamp only reduces the <=0.4 m step
  const OPEN_MOUTH_Z = 0.2; // z beyond this is OUTSIDE the level via the open entrance

  // The level's solid bounds: side walls at x=±6, back wall at z=-32. These must
  // hold WHILE the player is still inside the level. The corridor mouth at z=0 is
  // OPEN, so once z exceeds OPEN_MOUTH_Z the player has legitimately walked out
  // the entrance into unbounded open space — only the no-teleport guard applies.
  const breachesSolidBounds = (p: [number, number, number]): boolean =>
    p[0] < -6.2 || p[0] > 6.2 || p[2] < -32.2;
  const stillInsideLevel = (p: [number, number, number]): boolean =>
    p[2] <= OPEN_MOUTH_Z + 1e-6;

  const norm = (x: number, z: number): [number, number] => {
    const l = Math.hypot(x, z) || 1;
    return [x / l, z / l];
  };

  const starts: [number, number, number][] = [
    [0, EYE, -24], // chamber-center
    [0, EYE, -30], // near-backwall
    [4, EYE, -28], // back-right
    [-4, EYE, -28], // back-left
    [0, EYE, -8], // corridor
    [0, EYE, -16], // doorway
  ];
  const dts = [1 / 60, 1 / 30, 0.1];

  for (const start of starts) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const dir = norm(Math.sin(ang), -Math.cos(ang)); // a=0 → -Z (forward)
      for (const dt of dts) {
        const dist = SPEED * dt;
        let pos: [number, number, number] = [...start];
        for (let i = 0; i < 600; i++) {
          const delta: [number, number, number] = [
            dir[0] * dist,
            0,
            dir[1] * dist,
          ];
          const next = slideMove(pos, delta, R, LEVEL_BOXES);
          const jump = Math.hypot(next[0] - pos[0], next[2] - pos[2]);
          expect(jump).toBeLessThanOrEqual(STEP_CAP + 1e-6); // never teleports
          pos = next;
          // Solid walls (sides + back) must hold while inside the level. Drifting
          // past x=±6.2 only AFTER leaving via the open mouth is not a bug.
          if (stillInsideLevel(pos)) {
            expect(breachesSolidBounds(pos)).toBe(false);
          }
        }
      }
    }
  }
});
