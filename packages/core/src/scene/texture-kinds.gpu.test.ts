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
