// The capture's PURE half — everything decided before a GPU is touched: how a
// requested pixel size becomes a texture size, how a named view becomes a rig
// pose, and how a padded BGRA readback becomes canonical RGBA.
//
// HERE AND NOT IN THE GPU FILE, because none of it needs a device and two of the
// three are exactly the kind of arithmetic that produces a picture rather than an
// error when it is wrong: an un-stripped row pad shears the image and a dropped
// channel swap swaps red for blue, and both pass any "is it blank" assertion
// anyone would think to write. `tests/field-capture.gpu.test.ts` takes the half
// that has to see real pixels.
//
// THE `toRgba` CASES RUN BOTH CHANNEL ORDERS, which the GPU file structurally
// cannot: `renderToTexture` demands the capture texture match the context's
// working colour format, and that comes from `getPreferredCanvasFormat()` — one
// value per machine (`bgra8unorm` on this one). So the rgba branch is reachable
// only from here, and it is the branch that runs on the platforms we do not
// develop on.
import { expect, test } from "bun:test";
import type { OrbitState } from "../../src/field-host/camera-control.ts";
import {
  captureDimensions,
  captureOrbit,
  channelOrder,
  resolveCapture,
  toRgba,
} from "../../src/field-host/field-capture.ts";
import {
  DEFAULT_CAPTURE_SIZE,
  MAX_CAPTURE_SIZE,
  MIN_CAPTURE_SIZE,
} from "../../src/shared/capture.ts";

const ORBIT: OrbitState = {
  target: [3, 1, -2],
  distance: 7,
  yaw: 0.6,
  pitch: 0.5,
};

test("captureDimensions: the long edge is the request and the aspect is the canvas'", () => {
  // Landscape, portrait and square, so nothing can pass by hard-coding a side.
  expect(captureDimensions(1600, 900, 800)).toEqual({
    width: 800,
    height: 450,
  });
  expect(captureDimensions(900, 1600, 800)).toEqual({
    width: 450,
    height: 800,
  });
  expect(captureDimensions(512, 512, 800)).toEqual({ width: 800, height: 800 });
  // Omitted size takes the default, and the default is the LONG edge (not the width).
  expect(captureDimensions(400, 1000)).toEqual({
    width: Math.round(DEFAULT_CAPTURE_SIZE * 0.4),
    height: DEFAULT_CAPTURE_SIZE,
  });
});

test("captureDimensions: size is CLAMPED, and a degenerate aspect still yields a real texture", () => {
  expect(captureDimensions(1000, 1000, 99_999).width).toBe(MAX_CAPTURE_SIZE);
  expect(captureDimensions(1000, 1000, 1).width).toBe(MIN_CAPTURE_SIZE);
  // The floor that matters is the SHORT edge: a 2000×3 canvas scaled to 1024 puts
  // the height at 1.5 px, and a zero-height texture is a GPU validation error
  // rather than a small picture.
  const sliver = captureDimensions(2000, 3, 1024);
  expect(sliver.width).toBe(1024);
  expect(sliver.height).toBeGreaterThanOrEqual(1);
});

test("captureDimensions: a canvas with no size is refused, not photographed", () => {
  expect(() => captureDimensions(0, 600)).toThrow(/has no size/);
  expect(() => captureDimensions(800, 0)).toThrow(/has no size/);
  expect(() => captureDimensions(Number.NaN, 600)).toThrow(/has no size/);
});

test("captureOrbit: 'user' is the rig untouched", () => {
  expect(captureOrbit(ORBIT, "user")).toEqual(ORBIT);
});

test("captureOrbit: an axis view keeps the human's FRAMING and moves only the angles", () => {
  // This is the whole reason an agent can ask for a named view without knowing
  // where anything is: the pivot and the view distance are the ones the human
  // arranged, so "+y" frames what they were already looking at, from above.
  for (const view of ["+x", "-x", "+y", "-y", "+z", "-z"] as const) {
    const snapped = captureOrbit(ORBIT, view);
    expect(snapped.target).toEqual(ORBIT.target);
    expect(snapped.distance).toBe(ORBIT.distance);
  }
  // +Y puts the eye ABOVE the pivot: pitch just inside +90° (the shared pole
  // clamp), and the yaw is KEPT because yaw means nothing straight up.
  const top = captureOrbit(ORBIT, "+y");
  expect(top.pitch).toBeCloseTo(Math.PI / 2 - 0.01, 6);
  expect(top.yaw).toBe(ORBIT.yaw);
  // +X puts it on the positive X side, level.
  const right = captureOrbit(ORBIT, "+x");
  expect(right.yaw).toBeCloseTo(Math.PI / 2, 6);
  expect(right.pitch).toBe(0);
});

test("captureOrbit: THE COLLABORATION CONSTRAINT — deriving a view mutates no input", () => {
  // The rig hands over a deep copy and this function must not write to it even so:
  // `snapToAxis` returns `{...s, yaw, pitch}`, which SHARES the target array, so a
  // future implementation that adjusted the pivot in place would reach through two
  // copies into the live camera. Asserted on the array's contents, not its identity.
  const before = {
    ...ORBIT,
    target: [...ORBIT.target] as [number, number, number],
  };
  for (const view of ["user", "+x", "-y", "+z"] as const)
    captureOrbit(ORBIT, view);
  expect(ORBIT).toEqual(before);
});

test("resolveCapture: every default in one place — user view, default size, overlays on", () => {
  const plan = resolveCapture({}, 1600, 900, ORBIT);
  expect(plan.view).toBe("user");
  expect(plan.overlays).toBe(true);
  expect(plan.width).toBe(DEFAULT_CAPTURE_SIZE);
  // The eye is the rig's own, which is what makes a defaulted capture the human's view.
  expect(plan.target).toEqual(ORBIT.target);
  expect(plan.up).toEqual([0, 1, 0]);
  // `overlays: false` is respected rather than treated as absent — the falsy trap.
  expect(resolveCapture({ overlays: false }, 800, 600, ORBIT).overlays).toBe(
    false,
  );
});

test("channelOrder: reads the format, and refuses one it cannot read", () => {
  expect(channelOrder("bgra8unorm-srgb")).toBe("bgra");
  expect(channelOrder("bgra8unorm")).toBe("bgra");
  expect(channelOrder("rgba8unorm-srgb")).toBe("rgba");
  expect(channelOrder("rgba8unorm")).toBe("rgba");
  // No 8-bit RGBA reading exists for this; guessing one would produce a
  // plausible-looking wrong picture rather than a failure.
  expect(() => channelOrder("rgb10a2unorm")).toThrow(/cannot read back/);
});

/** A 3×2 source with a 16-byte row stride — 12 bytes of data and 4 of padding per
 *  row, which is the shape `copyTextureToBuffer`'s 256-byte rule produces at every
 *  width that is not a multiple of 64 px. Each pixel is `[10+i, 20+i, 30+i, 255]`
 *  in SOURCE order; padding is 0xEE so it is unmistakable if it survives. */
function paddedSource(): Uint8Array {
  const bytesPerRow = 16;
  const src = new Uint8Array(bytesPerRow * 2).fill(0xee);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 3; x++) {
      const i = y * 3 + x;
      const o = y * bytesPerRow + x * 4;
      src.set([10 + i, 20 + i, 30 + i, 255], o);
    }
  }
  return src;
}

test("toRgba: RGBA source — the padding is stripped and the channels are left alone", () => {
  const out = toRgba(paddedSource(), "rgba8unorm", 3, 2, 16);
  expect(out.length).toBe(3 * 2 * 4);
  expect(Array.from(out.subarray(0, 4))).toEqual([10, 20, 30, 255]);
  // Row 1's first pixel is i=3. Reading it correctly is the whole padding proof:
  // an un-stripped read would land on the previous row's padding.
  expect(Array.from(out.subarray(12, 16))).toEqual([13, 23, 33, 255]);
  expect(out).not.toContain(0xee);
});

test("toRgba: BGRA source — R and B are swapped, G and A are not", () => {
  const out = toRgba(paddedSource(), "bgra8unorm-srgb", 3, 2, 16);
  // Source pixel 0 is B=10, G=20, R=30 → canonical [30, 20, 10, 255].
  expect(Array.from(out.subarray(0, 4))).toEqual([30, 20, 10, 255]);
  expect(Array.from(out.subarray(12, 16))).toEqual([33, 23, 13, 255]);
  expect(out).not.toContain(0xee);
});

test("toRgba: a SHORT readback is refused, not zero-padded into a black-bottomed image", () => {
  // `channelOrder` directly above refuses a format it cannot read rather than
  // guessing, and this is the same posture on the other input: a source that ends
  // early used to be silently filled with zeroes, which is a picture with a black
  // bottom — and a black bottom is something a scene can legitimately have, so
  // nothing downstream could tell the two apart.
  // A 3x2 image at a 16-byte stride needs 16 (the padded first row) + 12 (the last
  // row, which carries no padding) = 28 bytes. One less is refused.
  expect(() => toRgba(new Uint8Array(27), "bgra8unorm", 3, 2, 16)).toThrow(
    /short of the 28/,
  );
  // And exactly 28 is ACCEPTED — the bound is the true one rather than the lazier
  // `bytesPerRow * height` (32), which is four bytes more than
  // `copyTextureToBuffer` itself requires of its destination.
  expect(toRgba(new Uint8Array(28), "bgra8unorm", 3, 2, 16).length).toBe(
    3 * 2 * 4,
  );
});

test("toRgba: an already-aligned row needs no special case", () => {
  // bytesPerRow === width * 4 is the 1024 px case, which is where a padding bug
  // hides: it is the DEFAULT size, and it is the one width that never exercises
  // the strip.
  const src = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(Array.from(toRgba(src, "rgba8unorm", 2, 1, 8))).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8,
  ]);
  expect(Array.from(toRgba(src, "bgra8unorm", 2, 1, 8))).toEqual([
    3, 2, 1, 4, 7, 6, 5, 8,
  ]);
});
