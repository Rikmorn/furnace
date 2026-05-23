import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { normalColor } from "../../src/material/normal-color.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "material.normalColor builds a Material with no group-1",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const mat = await normalColor(ctx);
    expect(mat.pipeline).toBeDefined();
    expect(mat.group1).toBe(null);
    expect(mat.ownedBuffers.length).toBe(0);
    gpu.dispose(ctx);
  },
);
