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
  "checkerboard texture kind builds + frees; load kind registered",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    // biome-ignore lint/style/noNonNullAssertion: test-only assertion; build() call below surfaces undefined clearly
    const cb = getResourceKind("textures", "checkerboard")!;
    const before = snapshot(ctx).resources.textures;
    const tex = await cb.build(ctx, { params: { size: 64, cells: 8 } });
    cb.destroy?.(ctx, tex);
    expect(snapshot(ctx).resources.textures).toBe(before);
    expect(getResourceKind("textures", "load")).toBeDefined();
    gpu.dispose(ctx);
  },
);
