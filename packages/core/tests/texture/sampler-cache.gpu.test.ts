import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import {
  _getSampler,
  DEFAULT_SAMPLER,
} from "../../src/texture/sampler-cache.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test("DEFAULT_SAMPLER is linear/linear/linear, repeat, aniso 1", () => {
  expect(DEFAULT_SAMPLER).toMatchObject({
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
    addressU: "repeat",
    addressV: "repeat",
    maxAnisotropy: 1,
  });
});

test.skipIf(!bunWebGpuAvailable())(
  "identical sampler params return the same GPUSampler (dedup)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const a = _getSampler(ctx, { magFilter: "linear", addressU: "repeat" });
    const b = _getSampler(ctx, { magFilter: "linear", addressU: "repeat" });
    expect(a).toBe(b); // same cached object
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "maxAnisotropy > 1 with a non-linear filter throws setup-loud",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    expect(() =>
      _getSampler(ctx, { magFilter: "nearest", maxAnisotropy: 8 }),
    ).toThrow(/anisotropy/i);
    gpu.dispose(ctx);
  },
);
