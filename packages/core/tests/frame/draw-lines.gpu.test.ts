import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import { render } from "../../src/frame/render.ts";
import { drawLines } from "../../src/frame/render-lines.ts";
import * as gpu from "../../src/gpu/index.ts";
import { vec3 } from "../../src/transform/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

function fixture() {
  return makeOffscreenCanvas().then(async (canvas) => {
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 0, 3),
    });
    return { ctx, cam };
  });
}

test.skipIf(!bunWebGpuAvailable())(
  "drawLines overlays a line-list with no GPU validation error",
  async () => {
    const { ctx, cam } = await fixture();
    // One red→green line from origin to (1,1,1).
    const vertices = new Float32Array([0, 0, 0, 1, 1, 1]);
    const colors = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]);

    render(ctx, { draw: [], camera: cam }); // populate depth + swap-chain
    ctx.device.pushErrorScope("validation");
    drawLines(ctx, { vertices, colors, camera: cam });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);

    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "drawLines with empty vertices is a no-op (no validation error)",
  async () => {
    const { ctx, cam } = await fixture();
    ctx.device.pushErrorScope("validation");
    drawLines(ctx, {
      vertices: new Float32Array(0),
      colors: new Float32Array(0),
      camera: cam,
    });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "drawLines grows its buffers across increasing line counts without error",
  async () => {
    const { ctx, cam } = await fixture();
    const small = new Float32Array([0, 0, 0, 1, 0, 0]);
    const smallC = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]);
    // Larger than the initial capacity to force a grow.
    const n = 2000 * 6;
    const big = new Float32Array(n);
    const bigC = new Float32Array((n / 3) * 4).fill(1);

    render(ctx, { draw: [], camera: cam }); // populate depth + swap-chain
    ctx.device.pushErrorScope("validation");
    drawLines(ctx, { vertices: small, colors: smallC, camera: cam });
    drawLines(ctx, { vertices: big, colors: bigC, camera: cam });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "drawLines throws on a missing camera and on a disposed context",
  async () => {
    const { ctx, cam } = await fixture();
    const v = new Float32Array([0, 0, 0, 1, 1, 1]);
    const c = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]);
    // @ts-expect-error - camera is required; exercising the runtime guard
    expect(() => drawLines(ctx, { vertices: v, colors: c })).toThrow();
    gpu.dispose(ctx);
    expect(() =>
      drawLines(ctx, { vertices: v, colors: c, camera: cam }),
    ).toThrow();
  },
);
