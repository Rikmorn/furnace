import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import { registerBuiltins } from "./builtins.ts";
import { getResourceKind, resetRegistryForTests } from "./registry.ts";

await ensureBunWebGpu();
resetRegistryForTests();
registerBuiltins();

test.skipIf(!bunWebGpuAvailable())(
  "shader kinds lit/texturedLit/textured/normalColor build without throwing",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    for (const kind of [
      "lit",
      "texturedLit",
      "textured",
      "normalColor",
    ] as const) {
      const reg = getResourceKind("shaders", kind);
      expect(reg).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: guarded by expect().toBeDefined() above
      const s = await reg!.build(ctx, { params: {} });
      expect(s).toBeDefined();
      // No destroy: built-in shaders are ctx-cached singletons freed by dispose.
    }
    gpu.dispose(ctx);
  },
);
