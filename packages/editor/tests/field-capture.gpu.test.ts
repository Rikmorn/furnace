// THE CAPTURE, IN PIXELS — and the first test in this package that asserts what a
// composed editor frame actually LOOKS like.
//
// `field-render.ts`'s header records the uncomfortable measurement that motivates
// this file: making `Render.scene` draw NOTHING leaves the whole editor suite
// green, because nothing observes the frame's output. The capture path changes
// what is possible, not what is already covered — this file builds its OWN
// composition rather than driving the host's, so what it pins is the CONTRACT
// (`FrameComposition` in, correct pixels out) and not the host's layer gates.
// Those are still an eyeball check.
//
// TWO FIXTURES, and the split is deliberate. The pixel assertions run over a
// hand-built composition and a context requested exactly as the host requests
// one; the rig assertion runs over a REAL `createFieldHost`, because the property
// it pins — a posed capture leaves the human's camera byte-identical — is a
// property of the rig and the facade, and a stub could not be wrong about it.
//
// NOTE THE ABSENT `surfaceFormat: "linear"`, which every other GPU test in this
// repo passes. The gpu-fixture's header requires it because bun-webgpu's mock
// canvas drops the `viewFormats` array, so `getCurrentTexture().createView({
// format: "bgra8unorm-srgb" })` fails validation — and that is a fact about the
// SWAP CHAIN, which nothing on this path touches. The capture allocates its own
// `-srgb` texture, which is legal, and the real host proves it: the rig case below
// runs `createFieldHost().init()` with the production srgb context and captures
// three times. Measured at this task, both ways green — so these cases use the
// production format, because a test that ran a colour space the editor never uses
// would be checking the wrong bytes.
//
// THE PNG ENCODER IS STUBBED, and this is the one thing to know before trusting
// the numbers below. `field-capture.ts`'s encode step is `document.createElement
// ("canvas")` → `putImageData` → `toBlob`, and there is no `document` under
// `bun test`. The shim installed here records the ImageData it is handed and
// answers with bytes of its own, which means:
//   - what IS pinned is everything up to and including the pixels that reach the
//     encoder — the render, the readback, the row-padding strip, the channel
//     swizzle, the size, and the fact that the encoder is handed the image at all;
//   - what is NOT pinned is the platform's PNG encoder. That is unmeasured on
//     macOS Safari and in the wry shell (the module header explains why it is
//     believed safe and why nobody has checked), and the holistic Safari gate at
//     this tranche's review is its first real measurement.
import { expect, test } from "bun:test";
import * as binding from "@furnace/core/binding";
import * as camera from "@furnace/core/camera";
import type { Light } from "@furnace/core/frame";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import * as gpu from "@furnace/core/gpu";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import * as shader from "@furnace/core/shader";
import { vec4 } from "@furnace/core/transform";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import type { OrbitState } from "../src/field-host/camera-control.ts";
import { EDITOR_PROJECTION } from "../src/field-host/field-camera-rig.ts";
import type {
  CapturePixels,
  CaptureRequest,
} from "../src/field-host/field-capture.ts";
import {
  capturePixels,
  channelOrder,
  createCapture,
  resolveCapture,
} from "../src/field-host/field-capture.ts";
import { createFieldHost } from "../src/field-host/field-host.ts";
import type { FrameComposition } from "../src/field-host/field-render.ts";
import { makeHostCanvas } from "./_helpers/host-canvas.ts";
import { stubAnimationFrameNoop } from "./_helpers/raf.ts";

await ensureBunWebGpu();
installMockResizeObserver();

/** The capture size the pixel tests use. NOT 64: `64 × 4 = 256` is exactly the
 *  row alignment, so a capture at the canvas size would never exercise the
 *  padding strip. 100 px gives `400` data bytes in a `512`-byte row — 112 bytes
 *  of padding per row, every row. */
const SIZE = 100;

/** The last image the stubbed encoder was handed — canonical RGBA at the size the
 *  capture produced, which is exactly what a real `putImageData` would receive. */
type Encoded = { data: Uint8ClampedArray; width: number; height: number };

/** Install a 2D-canvas shim for the encode step and hand back what it captured.
 *  Removed by the returned function — `bun test` shares one process, and
 *  `tests/chrome/` registers happy-dom later in it. */
function stubCanvasEncoder(): {
  encoded: Encoded[];
  restore: () => void;
} {
  const encoded: Encoded[] = [];
  const had = "document" in globalThis;
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: (kind: string) => {
      if (kind !== "canvas") throw new Error(`test: unexpected <${kind}>`);
      const el = {
        width: 0,
        height: 0,
        getContext: (mode: string) =>
          mode !== "2d"
            ? null
            : {
                createImageData: (w: number, h: number) => ({
                  data: new Uint8ClampedArray(w * h * 4),
                  width: w,
                  height: h,
                }),
                putImageData: (img: Encoded) => {
                  encoded.push({
                    data: new Uint8ClampedArray(img.data),
                    width: img.width,
                    height: img.height,
                  });
                },
              },
        // Asymmetric bytes, so a caller that reversed or truncated them shows it.
        toBlob: (cb: (b: Blob) => void) => {
          cb(new Blob([new Uint8Array([137, 80, 78, 71])]));
        },
      };
      return el;
    },
  };
  return {
    encoded,
    restore: () => {
      if (had) (globalThis as { document?: unknown }).document = previous;
      else delete (globalThis as { document?: unknown }).document;
    },
  };
}

/** A red LIT cube at the origin, a green always-on-top line across the frame and a
 *  modest hemisphere fill — the smallest scene that can answer all four pixel
 *  questions at once (is it lit, are the lines there, which channel is red, is
 *  alpha opaque). `lights` is EMPTY here and each case supplies its own, because the
 *  light list is the one variable the lit/unlit control turns. */
async function makeScene(ctx: Context): Promise<{
  composition: FrameComposition;
  dispose: () => void;
}> {
  const shd = await shader.lit(ctx);
  const bind = binding.create(ctx, shd);
  binding.set(ctx, bind, { color: [1, 0, 0, 1], specular: [0, 0, 0, 16] });
  const mat = await material.create(ctx, { shader: shd, binding: bind });
  const geo = geometry.cube(ctx, { size: 1.6 });
  const cube = mesh.create(ctx, { geometry: geo, material: mat });
  return {
    composition: {
      meshes: [cube],
      instanced: [],
      lines: [
        {
          // Spans the frame at y = 0.2 — off the exact pixel-row boundary a y = 0
          // line would straddle — and at z = -3, BEHIND the cube. `occlude: false`
          // is what makes it visible anyway, which is also how the editor draws
          // every overlay but the grid.
          vertices: new Float32Array([-10, 0.2, -3, 10, 0.2, -3]),
          colors: new Float32Array([0, 1, 0, 1, 0, 1, 0, 1]),
          occlude: false,
        },
      ],
      lights: [],
      // 0.05, and every threshold below is measured against it. Low enough that the
      // KEY light's contribution is a wide margin rather than a rounding difference —
      // at 0.35 the red channel sat at 160 with no light at all and the lit/unlit
      // ceiling had nowhere to go.
      ambient: { sky: [1, 1, 1], ground: [1, 1, 1], intensity: 0.05 },
      clearColor: vec4.fromValues(0, 0, 0, 1),
    },
    dispose: () => {
      mesh.destroy(ctx, cube);
      geometry.destroy(ctx, geo);
      material.destroy(ctx, mat);
      binding.destroy(ctx, bind);
    },
  };
}

/** The default rig framing the pixel tests capture from: eye at +Z looking at the
 *  origin, which is where `camera.perspective`'s own default sits. */
const ORBIT: OrbitState = {
  target: [0, 0, 0],
  distance: 3,
  yaw: 0,
  pitch: 0,
};

/** One capture over a fixed composition, through the real `createCapture` — the
 *  route the two cases that exercise `aim` (the off-screen camera) must take. */
function capture(
  ctx: Context,
  composition: FrameComposition,
  req: CaptureRequest,
  cap = createCapture({
    ctx: () => ctx,
    orbit: () => ({ ...ORBIT, target: [...ORBIT.target] }),
    compose: () => composition,
  }),
) {
  return cap.scene(req);
}

/** A `createCapture` bound to `ctx` and `composition`, so a test can drive the
 *  SAME instance twice — which is what production does and what any assertion
 *  about the reused off-screen camera needs. */
function captureInstance(ctx: Context, composition: FrameComposition) {
  return createCapture({
    ctx: () => ctx,
    orbit: () => ({ ...ORBIT, target: [...ORBIT.target] }),
    compose: () => composition,
  });
}

/** Render one composition straight through the GPU half — no `createCapture`, no
 *  encoder — and hand back canonical RGBA at `size` px square.
 *
 *  THE PIXEL CASES GO THROUGH HERE RATHER THAN THROUGH `scene`, and the reason is
 *  a review finding rather than taste: routed through `scene`, the lights
 *  passthrough was invisible. Deleting `lights: composition.lights` from
 *  `capturePixels` left the whole file green, because the lit/unlit control
 *  differed in TWO variables — lights AND ambient — and ambient alone carried the
 *  delta. Here the plan and the composition are supplied directly, so a case can
 *  hold everything constant but the one thing it is about. */
function pixels(
  ctx: Context,
  composition: FrameComposition,
  size: number,
  overlays = true,
) {
  const plan = resolveCapture({ size, overlays }, size, size, ORBIT);
  const view = camera.perspective({ ...EDITOR_PROJECTION, aspect: 1 });
  camera.setPosition(view, new Float32Array(plan.eye));
  camera.setTarget(view, new Float32Array(plan.target));
  camera.setUp(view, new Float32Array(plan.up));
  return capturePixels(ctx, plan, composition, view);
}

/** Anything with RGBA bytes and a size — a `capturePixels` result or an ImageData
 *  the stubbed encoder recorded, so one set of readers serves both routes. */
type Img = { data: ArrayLike<number>; width: number; height: number };

/** A `capturePixels` result as an {@link Img}. */
function img(px: CapturePixels): Img {
  return { data: px.rgba, width: px.width, height: px.height };
}

/** Read one pixel. */
function at(
  image: Img,
  x: number,
  y: number,
): [number, number, number, number] {
  const o = (y * image.width + x) * 4;
  return [
    image.data[o] ?? 0,
    image.data[o + 1] ?? 0,
    image.data[o + 2] ?? 0,
    image.data[o + 3] ?? 0,
  ];
}

/** Which rows hold the green overlay line, and how many pixels of it each holds.
 *  Green is the line's colour and nothing else in these scenes is green — the cube
 *  is red under a white light, the clear is black. */
function greenRows(image: Img): Map<number, number> {
  const rows = new Map<number, number>();
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const [r, g, b] = at(image, x, y);
      if (g > 150 && r < 90 && b < 90) rows.set(y, (rows.get(y) ?? 0) + 1);
    }
  }
  return rows;
}

/** Where the overlay line sits as a fraction of the image height — the one number
 *  that is a property of the SCENE and not of the pixel size, which is what makes
 *  it comparable across two capture sizes. */
function lineFraction(image: Img): number {
  const rows = [...greenRows(image).entries()];
  if (rows.length === 0)
    throw new Error("test: no overlay line in the capture");
  // The row holding most of the line, in case it straddles two.
  const best = rows.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[0] / image.height;
}

/** The share of pixels whose colour differs materially between two same-sized
 *  images — how much two photographs disagree, as one number. */
function differingShare(a: Img, b: Img): number {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error("test: cannot compare images of different sizes");
  let differing = 0;
  const total = a.width * a.height;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const spread = Math.max(
      Math.abs((a.data[o] ?? 0) - (b.data[o] ?? 0)),
      Math.abs((a.data[o + 1] ?? 0) - (b.data[o + 1] ?? 0)),
      Math.abs((a.data[o + 2] ?? 0) - (b.data[o + 2] ?? 0)),
    );
    if (spread > 24) differing++;
  }
  return differing / total;
}

/** The red cube's silhouette, as a pixel box. Its ASPECT is the thing worth
 *  measuring: the cube is drawn face-on, so a correctly-projected one is square
 *  whatever the frame's shape, and a camera whose aspect disagrees with its target
 *  stretches it. */
function redBox(image: Img): { width: number; height: number } {
  let minX = image.width;
  let maxX = -1;
  let minY = image.height;
  let maxY = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const [r, g, b] = at(image, x, y);
      if (r < 90 || g > 90 || b > 90) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) throw new Error("test: no cube in the capture");
  return { width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** The light `field-render.ts`'s studio key is shaped like — a point light riding
 *  the eye. */
const KEY: Light = {
  type: "point",
  position: [0, 0, 3],
  color: [1, 1, 1],
  // 2, not the studio light's 6: at 6 the red channel saturates at 255 and every
  // delta below collapses. Measured on this fixture — with ambient 0.05 the sample
  // pixel reads 63 unlit and 175 lit.
  intensity: 2,
  range: 18,
};

test.skipIf(!bunWebGpuAvailable())(
  "capturePixels: LIT — the ONLY variable is the light list, and it carries the delta",
  async () => {
    // REVIEW FINDING, PINNED. The first version of this case varied lights AND
    // ambient, so deleting `lights: composition.lights` from `capturePixels` left
    // the file fully green — the delta was entirely ambient's. Both captures below
    // share one `ambient`; the light list is the single difference, which is what
    // makes this an assertion about the lights passthrough rather than about
    // brightness in general. That passthrough is what the module header's whole
    // "borrows the viewport's composition; shading is a measured vision-model input
    // channel" argument rests on.
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      sampleCount: 1,
    });
    const scene = await makeScene(ctx);
    try {
      const lit = img(
        await pixels(ctx, { ...scene.composition, lights: [KEY] }, SIZE),
      );
      const unlit = img(
        await pixels(ctx, { ...scene.composition, lights: [] }, SIZE),
      );
      // A pixel well inside the cube's silhouette, off the line's row.
      const spot: [number, number] = [SIZE / 2, Math.floor(SIZE * 0.7)];
      const litRed = at(lit, ...spot)[0];
      const unlitRed = at(unlit, ...spot)[0];
      // A FLOOR, a CEILING and a DELTA. The ceiling is not "black": the shared
      // ambient still lights the cube, so what the unlit control proves is that the
      // KEY is missing rather than that the scene is dark.
      expect(litRed).toBeGreaterThan(140);
      expect(unlitRed).toBeLessThan(100);
      expect(litRed - unlitRed).toBeGreaterThan(60);
      // Opaque. `putImageData` reads STRAIGHT alpha while the readback is
      // premultiplied, and the two agree only at alpha 1 — so this assertion is
      // what licenses `toRgba` copying alpha through instead of forcing it.
      expect(at(lit, ...spot)[3]).toBe(255);
    } finally {
      scene.dispose();
      gpu.dispose(ctx);
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "capturePixels: AMBIENT — it is threaded too, and it is a SECOND variable",
  async () => {
    // The other half of what the old single case conflated. Lights held constant,
    // ambient varied: `field-render.ts` sends a different ambient in `normals` mode
    // than in `studio`, so a capture that dropped it would misreport the debug
    // shading the human is looking at.
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      sampleCount: 1,
    });
    const scene = await makeScene(ctx);
    try {
      const bright = img(
        await pixels(
          ctx,
          {
            ...scene.composition,
            lights: [KEY],
            ambient: { sky: [1, 1, 1], ground: [1, 1, 1], intensity: 0.35 },
          },
          SIZE,
        ),
      );
      const dim = img(
        await pixels(
          ctx,
          {
            ...scene.composition,
            lights: [KEY],
            ambient: { sky: [0, 0, 0], ground: [0, 0, 0], intensity: 0 },
          },
          SIZE,
        ),
      );
      const spot: [number, number] = [SIZE / 2, Math.floor(SIZE * 0.7)];
      expect(at(bright, ...spot)[0] - at(dim, ...spot)[0]).toBeGreaterThan(30);
    } finally {
      scene.dispose();
      gpu.dispose(ctx);
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "capturePixels: CHANNEL ORDER — a red cube reads red, not blue",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      sampleCount: 1,
    });
    const scene = await makeScene(ctx);
    try {
      // The machine fact, recorded rather than assumed: on macOS the preferred
      // canvas format is BGRA, so the readback needs a swizzle. A platform that
      // reports rgba8 exercises the other branch of `toRgba`, which
      // `tests/field-host/field-capture.test.ts` pins directly.
      expect(channelOrder(ctx.format)).toBe("bgra");
      const shot = img(
        await pixels(ctx, { ...scene.composition, lights: [KEY] }, SIZE),
      );
      const [r, g, b] = at(shot, SIZE / 2, Math.floor(SIZE * 0.7));
      // THE PIN THAT REDS IF THE SWIZZLE IS DROPPED. The cube's material colour is
      // pure red, so canonical byte 0 must dominate byte 2; without the swap they
      // trade places and every "non-blank" assertion still passes.
      expect(r).toBeGreaterThan(120);
      expect(b).toBeLessThan(40);
      expect(r - b).toBeGreaterThan(80);
      // Green is neither channel, so it discriminates a swizzle from a smear.
      expect(g).toBeLessThan(40);
    } finally {
      scene.dispose();
      gpu.dispose(ctx);
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "capturePixels: OVERLAYS — the line passes are there, and `overlays:false` removes exactly them",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      sampleCount: 1,
    });
    const scene = await makeScene(ctx);
    try {
      const on = img(await pixels(ctx, scene.composition, SIZE));
      const off = img(await pixels(ctx, scene.composition, SIZE, false));
      const rowsOn = greenRows(on);
      const litPixels = [...rowsOn.values()].reduce((a, b) => a + b, 0);
      // The line spans the frame, so it is most of a row wide.
      expect(litPixels).toBeGreaterThan(SIZE * 0.8);
      // And it IS a line: one world-space row, so at most two pixel rows.
      expect(rowsOn.size).toBeLessThanOrEqual(2);
      // SABOTAGE TARGET: dropping the `drawLinesToTexture` loop from
      // `capturePixels` reds this line.
      expect(greenRows(off).size).toBe(0);
    } finally {
      scene.dispose();
      gpu.dispose(ctx);
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "capturePixels: ROW PADDING — a non-aligned width frames the scene identically to an aligned one",
  async () => {
    // THE PIN THE OTHERS CANNOT BE. `copyTextureToBuffer` demands a 256-byte row
    // stride, so at 100 px the rows are 512 bytes carrying 400 bytes of image and
    // 112 of padding, while at 128 px they are 512 carrying 512 and none. Failing
    // to strip the padding SHEARS the image — each output row is read 112 bytes
    // early, which slides the picture up by an amount that depends on the width.
    //
    // A sheared read still produces a plausible picture: it is still lit, its
    // channels are still in order, and the overlay line is still one horizontal
    // run (a shear maps one source row onto at most two output rows). Every other
    // assertion in this file survives it. What does NOT survive is the line's
    // POSITION as a fraction of the frame, because the two widths shear by
    // different amounts — 128 px does not shear at all.
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      sampleCount: 1,
    });
    const scene = await makeScene(ctx);
    try {
      const aligned = img(await pixels(ctx, scene.composition, 128));
      const padded = img(await pixels(ctx, scene.composition, 100));
      // Within one row of the smaller image — the same scene, sampled twice.
      expect(lineFraction(padded)).toBeCloseTo(lineFraction(aligned), 1);
    } finally {
      scene.dispose();
      gpu.dispose(ctx);
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "captureScene: AIMING — a named view produces a DIFFERENT photograph, not the same one",
  async () => {
    // REVIEW FINDING, PINNED. The only thing this case used to assert was that the
    // encoder ran three times, which an implementation that ignored the plan's
    // eye/target/up entirely would satisfy — deleting all three `camera.set*` calls
    // from `aim` left the suite fully green. A `view: "+y"` capture that silently
    // photographed from the human's pose would have shipped, and that is the
    // feature's headline behaviour.
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      sampleCount: 1,
    });
    const scene = await makeScene(ctx);
    const stub = stubCanvasEncoder();
    try {
      const cap = captureInstance(ctx, {
        ...scene.composition,
        lights: [KEY],
      });
      await capture(ctx, scene.composition, { view: "user", size: SIZE }, cap);
      const user = stub.encoded.at(-1);
      await capture(ctx, scene.composition, { view: "+y", size: SIZE }, cap);
      const top = stub.encoded.at(-1);
      if (!user || !top) throw new Error("test: the encoder saw no image");
      // Looking straight down at a scene framed from +Z is a different picture in
      // most of the frame: the cube's lit face changes (the light is a WORLD point
      // and does not follow the camera) and the overlay line, which lives at
      // z = -3, leaves the frustum entirely.
      // Measured: 0.40 of the frame differs, against a 0.2 bar.
      expect(differingShare(user, top)).toBeGreaterThan(0.2);
      // Named specifically, because it is the crispest single consequence: from
      // above, the line is out of frame.
      expect(greenRows(user).size).toBeGreaterThan(0);
      expect(greenRows(top).size).toBe(0);
    } finally {
      stub.restore();
      scene.dispose();
      gpu.dispose(ctx);
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "captureScene: ASPECT — ONE capture instance, two canvas shapes, and the cube stays square",
  async () => {
    // REVIEW FINDING, PINNED. `camera.setAspect` was unpinned and its failure mode
    // is a real production one rather than a theoretical one: `offscreen` is built
    // ONCE and reused for the editor's lifetime, so without the per-call
    // `setAspect` a capture taken after the human resizes their window is framed
    // for the OLD aspect — a stretched photograph, with no error anywhere. Every
    // earlier case hid it by building a fresh `createCapture` per capture (so the
    // camera was always constructed with the right aspect) and by never changing
    // the canvas shape.
    //
    // The measurement is the cube's SILHOUETTE. It is drawn face-on, so a correctly
    // projected one is square in pixels whatever shape the frame is; a camera whose
    // aspect disagrees with its target stretches it by exactly the ratio between
    // them.
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { sampleCount: 1 });
    const scene = await makeScene(ctx);
    const stub = stubCanvasEncoder();
    try {
      const cap = captureInstance(ctx, {
        ...scene.composition,
        lights: [KEY],
        // No overlays: the line spans the frame and would widen the red box hunt.
        lines: [],
      });
      await capture(ctx, scene.composition, { size: 128 }, cap);
      const square = stub.encoded.at(-1);
      // The human resizes the window. `resolveCapture` reads the canvas every call,
      // so the TARGET becomes 2:1 — and the camera must follow it.
      ctx.canvas.width = 128;
      ctx.canvas.height = 64;
      await capture(ctx, scene.composition, { size: 128 }, cap);
      const wide = stub.encoded.at(-1);
      if (!square || !wide) throw new Error("test: the encoder saw no image");
      expect({ w: wide.width, h: wide.height }).toEqual({ w: 128, h: 64 });
      const before = redBox(square);
      const after = redBox(wide);
      // Square in both, within a pixel or two of rounding. Measured with `setAspect`
      // deleted: the second cube's width/height comes out at exactly 2.0, which is
      // the ratio between the aspect the camera kept and the one the target has.
      expect(before.width / before.height).toBeCloseTo(1, 1);
      expect(after.width / after.height).toBeCloseTo(1, 1);
    } finally {
      stub.restore();
      scene.dispose();
      gpu.dispose(ctx);
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "captureScene: SIZE — the long edge is the request, the aspect is the canvas', and the answer reports both",
  async () => {
    // 96 x 48: a 2:1 canvas, so a square result would be a silent re-framing.
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(96, 48), {
      sampleCount: 1,
    });
    const scene = await makeScene(ctx);
    const stub = stubCanvasEncoder();
    try {
      // 130 px wide -> 520 data bytes in a 768-byte row. Deliberately odd.
      const shot = await capture(ctx, scene.composition, { size: 130 });
      expect(shot).toEqual({
        png: new Uint8Array([137, 80, 78, 71]),
        width: 130,
        height: 65,
        view: "user",
      });
      const image = stub.encoded.at(-1);
      if (!image) throw new Error("test: the encoder saw no image");
      // The encoder is handed a TIGHTLY PACKED buffer of exactly that many pixels
      // — the padding never reaches it.
      expect(image.width).toBe(130);
      expect(image.height).toBe(65);
      expect(image.data.length).toBe(130 * 65 * 4);
      // An out-of-range size CLAMPS rather than refusing, and the answer says so.
      const clamped = await capture(ctx, scene.composition, { size: 5 });
      expect(clamped.width).toBe(64);
    } finally {
      stub.restore();
      scene.dispose();
      gpu.dispose(ctx);
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "captureScene: THE COLLABORATION CONSTRAINT — a posed capture leaves the rig byte-identical",
  async () => {
    // THE MOST IMPORTANT PIN IN THE TASK, and the one that needs a real host: the
    // property is that an agent looking from another angle does not move the
    // camera of the human sitting in the editor. Run over `createFieldHost` so
    // the rig, the facade verb and the derivation are all the production ones.
    const restoreRaf = stubAnimationFrameNoop();
    const host = createFieldHost();
    const stub = stubCanvasEncoder();
    try {
      await host.init(await makeHostCanvas());
      // Arrange the camera first, so "unchanged" is a real arrangement rather
      // than the boot default agreeing with itself.
      host.snapView("x", 1);
      const manifest = (): string => {
        const file = host
          .exportArtifact("probe")
          .find((f) => f.path === "worlds/probe/manifest.json");
        if (file === undefined || typeof file.contents !== "string")
          throw new Error("test: no manifest.json in the artifact");
        return file.contents;
      };
      // TWO probes, because they see different halves: the pose seam carries the
      // ANGLES and the baked `playerStart` is the derived EYE, which also moves
      // with the pivot and the distance the pose cannot see.
      const poseBefore = JSON.stringify(host.cameraPose());
      const eyeBefore = manifest();

      for (const view of ["+y", "-z", "user"] as const) {
        const shot = await host.captureScene({ view, size: 128 });
        expect(shot.view).toBe(view);
        expect(shot.png.length).toBeGreaterThan(0);
      }

      expect(JSON.stringify(host.cameraPose())).toBe(poseBefore);
      expect(manifest()).toBe(eyeBefore);
      expect(stub.encoded.length).toBe(3);
    } finally {
      stub.restore();
      host.dispose();
      restoreRaf();
    }
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "captureScene: a host with no context refuses out loud rather than answering with a blank",
  async () => {
    const host = createFieldHost();
    // Never initialised — the state a claimed tab is in while its engine loads.
    await expect(host.captureScene()).rejects.toThrow(/no GPU context/);
  },
);
