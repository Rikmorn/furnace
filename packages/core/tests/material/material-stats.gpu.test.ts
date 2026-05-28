import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import { snapshot } from "../../src/stats/public.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "material.create + destroy: tracks materials count, no bytes (normalColor has no owned buffers)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const before = snapshot(ctx);
    const m = await material.normalColor(ctx);
    const after = snapshot(ctx);
    expect(after.resources.materials - before.resources.materials).toBe(1);
    expect(after.memory.bufferBytes).toBe(before.memory.bufferBytes);
    material.destroy(ctx, m);
    const final = snapshot(ctx);
    expect(final.resources.materials).toBe(before.resources.materials);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "material.unlit: registers material + 16-byte color buffer; destroy unregisters both",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const before = snapshot(ctx);
    const m = await material.unlit(ctx, { color: vec4.fromValues(1, 0, 0, 1) });
    const after = snapshot(ctx);
    expect(after.resources.materials - before.resources.materials).toBe(1);
    expect(after.memory.bufferBytes - before.memory.bufferBytes).toBe(16);
    material.destroy(ctx, m);
    const final = snapshot(ctx);
    expect(final.resources.materials).toBe(before.resources.materials);
    expect(final.memory.bufferBytes).toBe(before.memory.bufferBytes);
    gpu.dispose(ctx);
  },
);
