import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { unlit } from "../../src/material/unlit.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "material.unlit builds a Material with the color buffer owned",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const mat = await unlit(ctx, { color: [0.5, 0.7, 0.3, 1] });
    expect(mat.pipeline).toBeDefined();
    expect(mat.group1).not.toBe(null);
    expect(mat.ownedBuffers.length).toBe(1);
    expect(mat.cullMode).toBe("back");
    gpu.dispose(ctx);
  },
);
