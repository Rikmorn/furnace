import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import * as shader from "../../src/shader/index.ts";
import * as texture from "../../src/texture/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "texturedLit material builds via the texture path (default + custom sampler)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const tex = await texture.create(ctx, {
      data: new Uint8Array(4),
      width: 1,
      height: 1,
    });
    const sh = await shader.texturedLit(ctx);
    const mat = await material.create(ctx, {
      shader: sh,
      texture: { texture: tex },
    });
    expect(mat).toBeGreaterThan(0);
    // custom sampler (AF) also builds
    const mat2 = await material.create(ctx, {
      shader: sh,
      texture: { texture: tex, sampler: { maxAnisotropy: 16 } },
    });
    expect(mat2).toBeGreaterThan(0);
    material.destroy(ctx, mat);
    material.destroy(ctx, mat2);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "textureBinding shader without a texture throws setup-loud",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const sh = await shader.texturedLit(ctx);
    await expect(material.create(ctx, { shader: sh })).rejects.toThrow(
      /texture/i,
    );
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "texture + bindings together throws setup-loud (mutual exclusion)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const tex = await texture.create(ctx, {
      data: new Uint8Array(4),
      width: 1,
      height: 1,
    });
    const sh = await shader.texturedLit(ctx);
    await expect(
      material.create(ctx, {
        shader: sh,
        texture: { texture: tex },
        bindings: [
          {
            binding: 0,
            resource: {
              buffer: ctx.device.createBuffer({
                size: 16,
                usage: GPUBufferUsage.UNIFORM,
              }),
            },
          },
        ],
      }),
    ).rejects.toThrow(/mutually exclusive|only one/i);
    gpu.dispose(ctx);
  },
);
