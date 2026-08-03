import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import * as texture from "./index.ts";

await ensureBunWebGpu();

const hasImageBitmap =
  typeof createImageBitmap === "function" && typeof ImageData === "function";

test.skipIf(!hasImageBitmap || !bunWebGpuAvailable())(
  "texture.create from an ImageBitmap source allocates a tracked texture",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const bmp = await createImageBitmap(
      new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1),
    );
    const tex = await texture.create(ctx, { source: bmp });
    expect(tex).toBeGreaterThan(0);
    texture.destroy(ctx, tex);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "texture.load rejects setup-loud on a non-OK / unreachable HTTP response",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    await expect(
      texture.load(ctx, "http://127.0.0.1:0/missing.png"),
    ).rejects.toThrow();
    gpu.dispose(ctx);
  },
);
