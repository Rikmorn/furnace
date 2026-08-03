import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import { snapshot } from "../stats/public.ts";
import { registerBuiltins } from "./builtins.ts";
import { getResourceKind, resetRegistryForTests } from "./registry.ts";

await ensureBunWebGpu();
resetRegistryForTests();
registerBuiltins();

test.skipIf(!bunWebGpuAvailable())(
  "geometry kinds sphere/cylinder/plane build + free clean",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const before = snapshot(ctx).resources.geometries;
    for (const [kind, params] of [
      ["sphere", { radius: 0.2 }],
      ["cylinder", { radius: 0.1, height: 0.4 }],
      ["plane", {}],
    ] as const) {
      const reg = getResourceKind("geometries", kind);
      expect(reg).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: guarded by expect().toBeDefined() above
      const g = await reg!.build(ctx, { params });
      // biome-ignore lint/style/noNonNullAssertion: guarded by expect().toBeDefined() above
      reg!.destroy?.(ctx, g);
    }
    expect(snapshot(ctx).resources.geometries).toBe(before);
    gpu.dispose(ctx);
  },
);
