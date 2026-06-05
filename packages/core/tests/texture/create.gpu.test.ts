import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { snapshot } from "../../src/stats/public.ts";
import * as texture from "../../src/texture/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "texture.create from data registers 1 texture (count) + its bytes; destroy round-trips both",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const before = snapshot(ctx);
    const tex = await texture.create(ctx, {
      data: new Uint8Array([255, 0, 0, 255]), // 1x1 red
      width: 1,
      height: 1,
    });
    expect(tex).toBeGreaterThan(0); // non-zero uint48 handle
    const after = snapshot(ctx);
    expect(after.resources.textures - before.resources.textures).toBe(1);
    expect(after.memory.textureBytes - before.memory.textureBytes).toBe(4);
    texture.destroy(ctx, tex);
    const final = snapshot(ctx);
    expect(final.resources.textures).toBe(before.resources.textures);
    expect(final.memory.textureBytes).toBe(before.memory.textureBytes);
    gpu.dispose(ctx);
  },
);
