import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { unlit } from "../../src/material/unlit.ts";
import { createGeometry } from "../../src/mesh/geometry.ts";
import {
  _recomputeModelIfDirty,
  create,
  setPosition,
  setRotation,
  setScale,
} from "../../src/mesh/mesh.ts";
import { mat4, quat } from "../../src/transform/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

async function setup() {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas);
  const g = createGeometry(ctx, {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
  });
  const m = await unlit(ctx, { color: [1, 1, 1, 1] });
  return { ctx, g, m };
}

test.skipIf(!bunWebGpuAvailable())(
  "mesh.create returns a mesh with identity transform",
  async () => {
    const { ctx, g, m } = await setup();
    const mesh = create(ctx, { geometry: g, material: m });
    expect(mesh.position).toEqual(new Float32Array([0, 0, 0]));
    expect(mesh.rotation).toEqual(new Float32Array([0, 0, 0, 1]));
    expect(mesh.scale).toEqual(new Float32Array([1, 1, 1]));
    expect(mesh.transformDirty).toBe(true);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "setPosition flips dirty and updates the position",
  async () => {
    const { ctx, g, m } = await setup();
    const mesh = create(ctx, { geometry: g, material: m });
    _recomputeModelIfDirty(mesh);
    expect(mesh.transformDirty).toBe(false);
    setPosition(mesh, new Float32Array([1, 2, 3]));
    expect(mesh.transformDirty).toBe(true);
    expect(Array.from(mesh.position)).toEqual([1, 2, 3]);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "setRotation and setScale flip dirty",
  async () => {
    const { ctx, g, m } = await setup();
    const mesh = create(ctx, { geometry: g, material: m });
    _recomputeModelIfDirty(mesh);
    expect(mesh.transformDirty).toBe(false);
    setRotation(mesh, quat.fromValues(0, 0, 0, 1));
    expect(mesh.transformDirty).toBe(true);
    _recomputeModelIfDirty(mesh);
    setScale(mesh, new Float32Array([2, 2, 2]));
    expect(mesh.transformDirty).toBe(true);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "_recomputeModelIfDirty composes TRS into modelMatrix and writes the object buffer",
  async () => {
    const { ctx, g, m } = await setup();
    const mesh = create(ctx, { geometry: g, material: m });
    setPosition(mesh, new Float32Array([10, 20, 30]));
    _recomputeModelIfDirty(mesh);
    expect(mesh.transformDirty).toBe(false);
    const expected = mat4.create();
    mat4.fromRotationTranslationScale(
      expected,
      quat.fromValues(0, 0, 0, 1),
      new Float32Array([10, 20, 30]),
      new Float32Array([1, 1, 1]),
    );
    expect(Array.from(mesh.modelMatrix)).toEqual(Array.from(expected));
    gpu.dispose(ctx);
  },
);
