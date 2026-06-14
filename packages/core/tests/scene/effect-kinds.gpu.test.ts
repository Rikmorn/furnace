import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { registerBuiltins } from "../../src/scene/builtins.ts";
import {
  getResourceKind,
  resetRegistryForTests,
} from "../../src/scene/registry.ts";
import { snapshot } from "../../src/stats/public.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();
resetRegistryForTests();
registerBuiltins();

test.skipIf(!bunWebGpuAvailable())(
  "effect kinds bloom/tonemap build + free clean",
  async () => {
    const canvas = await makeOffscreenCanvas();
    // bloom requires hdr: true on the context
    const ctx = await gpu.requestContext(canvas, {
      surfaceFormat: "linear",
      hdr: true,
    });
    const before = snapshot(ctx).resources.effects;

    for (const [kind, params] of [
      ["bloom", { intensity: 0.8, threshold: 0.5, softness: 0.1 }],
      ["tonemap", { exposure: 1.2, operator: "neutral" }],
    ] as const) {
      const reg = getResourceKind("effects", kind);
      expect(reg).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: guarded by expect().toBeDefined() above
      const e = await reg!.build(ctx, { params });
      // biome-ignore lint/style/noNonNullAssertion: guarded by expect().toBeDefined() above
      reg!.destroy?.(ctx, e);
    }

    expect(snapshot(ctx).resources.effects).toBe(before);
    gpu.dispose(ctx);
  },
);
