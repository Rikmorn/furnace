import { expect, test } from "bun:test";
import * as binding from "../../src/binding/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import { _resolveMaterial } from "../../src/material/internal.ts";
import * as shader from "../../src/shader/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "material.create builds a @group(1) bind group over a Binding",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const s = await shader.unlit(ctx);
    const b = binding.create(ctx, s);
    binding.set(ctx, b, { color: [1, 0, 0, 1] });
    const m = await material.create(ctx, { shader: s, binding: b });
    expect(_resolveMaterial(ctx, m).group1).not.toBe(null);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "material.create throws if shader has a layout but no binding and no raw bindings",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const s = await shader.unlit(ctx);
    await expect(material.create(ctx, { shader: s })).rejects.toThrow(
      /shader declares @group\(1\) data/,
    );
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "material.create throws setup-loud if the binding is stale/destroyed",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const s = await shader.unlit(ctx);
    const b = binding.create(ctx, s);
    binding.destroy(ctx, b);
    await expect(
      material.create(ctx, { shader: s, binding: b }),
    ).rejects.toThrow(/binding handle is invalid or destroyed/);
    gpu.dispose(ctx);
  },
);
