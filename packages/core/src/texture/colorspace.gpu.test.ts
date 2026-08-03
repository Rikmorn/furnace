import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import * as texture from "./index.ts";
import { _formatOf } from "./texture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "colorSpace: default → rgba8unorm-srgb; 'linear' → rgba8unorm",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const srgb = await texture.create(ctx, {
      data: new Uint8Array(4),
      width: 1,
      height: 1,
    });
    expect(_formatOf(ctx, srgb)).toBe("rgba8unorm-srgb");
    const lin = await texture.create(ctx, {
      data: new Uint8Array(4),
      width: 1,
      height: 1,
      colorSpace: "linear",
    });
    expect(_formatOf(ctx, lin)).toBe("rgba8unorm");
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "data length mismatch throws setup-loud",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    await expect(
      texture.create(ctx, { data: new Uint8Array(3), width: 2, height: 2 }), // needs 16 bytes
    ).rejects.toThrow(/data length/i);
    gpu.dispose(ctx);
  },
);
