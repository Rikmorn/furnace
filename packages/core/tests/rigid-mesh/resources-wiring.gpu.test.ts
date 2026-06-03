import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import {
  _allocRigidMesh,
  _destroyRigidMesh,
  _lookupRigidMesh,
} from "../../src/resources/internal.ts";
import * as stats from "../../src/stats/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "rigid-mesh resource kind: alloc/lookup/destroy + stats count",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    let tornDown = false;
    const slot = {
      _teardown: () => {
        tornDown = true;
      },
    };
    const h = _allocRigidMesh(ctx, slot);

    expect(_lookupRigidMesh<typeof slot>(ctx, h)).toBe(slot);
    expect(stats.snapshot(ctx).resources.rigidMeshes).toBe(1);

    const destroyed = _destroyRigidMesh(ctx, h, (s: typeof slot) =>
      s._teardown(),
    );
    expect(destroyed).toBe(true);
    expect(tornDown).toBe(true);
    expect(_lookupRigidMesh<typeof slot>(ctx, h)).toBe(null);
    expect(stats.snapshot(ctx).resources.rigidMeshes).toBe(0);

    gpu.dispose(ctx);
  },
);
