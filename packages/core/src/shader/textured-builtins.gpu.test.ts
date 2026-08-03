import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import * as shader from "./index.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "textured/texturedLit compile, declare textureBinding, are engine-owned + cached",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const t = await shader.textured(ctx);
    const tl = await shader.texturedLit(ctx);
    expect(t).toBeGreaterThan(0);
    expect(tl).toBeGreaterThan(0);
    expect(shader._textureBindingOf(ctx, t)).toBe(true);
    expect(shader._textureBindingOf(ctx, tl)).toBe(true);
    // Engine-owned: shared per ctx (same handle on re-request), destroy is a no-op.
    expect(await shader.textured(ctx)).toBe(t);
    shader.destroy(ctx, t);
    expect(await shader.textured(ctx)).toBe(t); // still cached after no-op destroy
    gpu.dispose(ctx);
  },
);
