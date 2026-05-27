import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { unlit } from "../../src/material/unlit.ts";
import { cubeGeometry, planeGeometry } from "../../src/mesh/factories/index.ts";
import { destroyGeometry } from "../../src/mesh/geometry.ts";
import { create, destroy } from "../../src/mesh/mesh.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "cubeGeometry produces a Geometry with 24 vertices and 36 indices",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const mat = await unlit(ctx, { color: vec4.fromValues(1, 1, 1, 1) });
    const geom = cubeGeometry(ctx);
    const m = create(ctx, { geometry: geom, material: mat });
    expect(m.geometry.vertexCount).toBe(24);
    expect(m.geometry.indexCount).toBe(36);
    expect(m.material).toBe(mat);
    destroy(m);
    destroyGeometry(geom);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "planeGeometry produces a Geometry with 4 vertices and 6 indices",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const mat = await unlit(ctx, { color: vec4.fromValues(1, 1, 1, 1) });
    const geom = planeGeometry(ctx, { size: 3 });
    const m = create(ctx, { geometry: geom, material: mat });
    expect(m.geometry.vertexCount).toBe(4);
    expect(m.geometry.indexCount).toBe(6);
    destroy(m);
    destroyGeometry(geom);
    gpu.dispose(ctx);
  },
);
