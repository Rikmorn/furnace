import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { loadScene } from "../../src/scene/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";
import { miniDoc } from "./_helpers/mini-doc.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "entityBoxCorners: 8 world corners around a translated cube",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const doc = miniDoc(); // a scene with entity "cube" at position [10,0,0], a unit cube geometry
    const loaded = await loadScene(ctx, doc);
    const corners = loaded.entityBoxCorners("cube");
    expect(corners).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: guarded by not.toBeNull() above
    const c = corners!;
    expect(c.length).toBe(24); // 8 corners × 3 floats
    const xs = Array.from({ length: 8 }, (_, i) => c[i * 3] as number);
    expect(Math.min(...xs)).toBeGreaterThan(9); // 10 - halfExtent
    expect(Math.max(...xs)).toBeLessThan(11); // 10 + halfExtent
    expect(loaded.entityBoxCorners("nope")).toBeNull();
    loaded.destroy();
    gpu.dispose(ctx);
  },
);
