import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import { emptyDoc, twoCubeDoc } from "../../tests/scene/_helpers/mini-doc.ts";
import * as gpu from "../gpu/index.ts";
import { loadScene } from "./index.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "pick: NDC on the left cube returns its entity id; empty → null",
  async () => {
    const canvas = await makeOffscreenCanvas(256, 256);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const loaded = await loadScene(ctx, twoCubeDoc());

    const left = await loaded.pick(ctx, loaded.camera, -0.5, 0);
    expect(left).toBe("left");

    const right = await loaded.pick(ctx, loaded.camera, 0.5, 0);
    expect(right).toBe("right");

    const empty = await loaded.pick(ctx, loaded.camera, -0.98, 0.98);
    expect(empty).toBeNull();

    loaded.destroy();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "pick: empty scene (zero entries) returns null",
  async () => {
    const canvas = await makeOffscreenCanvas(256, 256);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const loaded = await loadScene(ctx, emptyDoc());

    const result = await loaded.pick(ctx, loaded.camera, 0, 0);
    expect(result).toBeNull();

    loaded.destroy();
    gpu.dispose(ctx);
  },
);
