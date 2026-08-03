import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import * as resources from "../resources/index.ts";
import { snapshot } from "../stats/public.ts";
import * as texture from "./index.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "dispose cascade frees outstanding textures (count + bytes) with no explicit destroy",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const before = snapshot(ctx);

    await texture.create(ctx, { data: new Uint8Array(4), width: 1, height: 1 }); // 4 bytes
    await texture.create(ctx, {
      data: new Uint8Array(4 * 4 * 4),
      width: 4,
      height: 4, // 64 bytes
    });

    const after = snapshot(ctx);
    expect(after.resources.textures - before.resources.textures).toBe(2);
    expect(after.memory.textureBytes - before.memory.textureBytes).toBe(4 + 64);

    // Cascade WITHOUT any explicit texture.destroy — proves the leaf wiring.
    resources.disposeAll(ctx);

    const final = snapshot(ctx);
    expect(final.resources.textures).toBe(before.resources.textures);
    expect(final.memory.textureBytes).toBe(before.memory.textureBytes);

    gpu.dispose(ctx);
  },
);
