import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import { miniDoc } from "../../tests/scene/_helpers/mini-doc.ts";
import * as gpu from "../gpu/index.ts";
import { snapshot } from "../stats/public.ts";
import { loadScene } from "./index.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "setEntityTransform moves the box without rebuild or leak",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const loaded = await loadScene(ctx, miniDoc()); // cube at [10,0,0]
    const before = snapshot(ctx).resources;
    loaded.setEntityTransform("cube", { position: [0, 5, 0] });
    const corners = loaded.entityBoxCorners("cube");
    expect(corners).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: guarded by not.toBeNull() above
    const c = corners!;
    const ys = Array.from({ length: 8 }, (_, i) => c[i * 3 + 1] as number);
    expect(Math.min(...ys)).toBeGreaterThan(4); // moved to y≈5
    const after = snapshot(ctx).resources;
    expect(after.meshes).toBe(before.meshes);
    expect(after.geometries).toBe(before.geometries);
    expect(after.materials).toBe(before.materials);
    expect(after.bindings).toBe(before.bindings);
    loaded.destroy();
    gpu.dispose(ctx);
  },
);
