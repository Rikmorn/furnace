import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { createPipeline } from "../../src/material/pipeline.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "createPipeline builds a render pipeline for valid WGSL",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const module = ctx.device.createShaderModule({
      code: `
        @vertex fn vs_main() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }
        @fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }
      `,
    });
    const pipeline = await createPipeline(ctx, {
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{ format: ctx.format }],
      },
      primitive: { topology: "triangle-list" },
    });
    expect(pipeline).toBeDefined();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "createPipeline throws FurnaceError on shader compile failure",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const module = ctx.device.createShaderModule({
      code: `@vertex fn vs_main() -> wat { return 0; }`,
    });
    let threw = false;
    try {
      await createPipeline(ctx, {
        layout: "auto",
        vertex: { module, entryPoint: "vs_main" },
        fragment: {
          module,
          entryPoint: "fs_main",
          targets: [{ format: ctx.format }],
        },
      });
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toMatch(/pipeline/i);
    }
    expect(threw).toBe(true);
    gpu.dispose(ctx);
  },
);
