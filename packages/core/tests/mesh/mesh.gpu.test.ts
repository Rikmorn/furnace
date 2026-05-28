import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { destroy as destroyMaterial } from "../../src/material/material.ts";
import { unlit } from "../../src/material/unlit.ts";
import { cubeGeometry } from "../../src/mesh/factories/cube.ts";
import { createGeometry, destroyGeometry } from "../../src/mesh/geometry.ts";
import { _resolveMesh } from "../../src/mesh/internal.ts";
import {
  _recomputeModelIfDirty,
  create,
  destroy,
  getPosition,
  getRotation,
  getScale,
  setPosition,
  setRotation,
  setScale,
} from "../../src/mesh/mesh.ts";
import { _lookupMesh } from "../../src/resources/internal.ts";
import { mat4, quat } from "../../src/transform/index.ts";
import { vec4 } from "../../src/transform/vec4.ts";
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
  const m = await unlit(ctx, { color: vec4.fromValues(1, 1, 1, 1) });
  return { ctx, g, m };
}

test.skipIf(!bunWebGpuAvailable())(
  "mesh.create returns a mesh with identity transform",
  async () => {
    const { ctx, g, m } = await setup();
    const mesh = create(ctx, { geometry: g, material: m });
    const slot = _resolveMesh(ctx, mesh);
    expect(slot.position).toEqual(new Float32Array([0, 0, 0]));
    expect(slot.rotation).toEqual(new Float32Array([0, 0, 0, 1]));
    expect(slot.scale).toEqual(new Float32Array([1, 1, 1]));
    expect(slot.transformDirty).toBe(true);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "setPosition flips dirty and updates the position",
  async () => {
    const { ctx, g, m } = await setup();
    const mesh = create(ctx, { geometry: g, material: m });
    const slot = _resolveMesh(ctx, mesh);
    _recomputeModelIfDirty(slot);
    expect(slot.transformDirty).toBe(false);
    setPosition(ctx, mesh, new Float32Array([1, 2, 3]));
    expect(slot.transformDirty).toBe(true);
    expect(Array.from(slot.position)).toEqual([1, 2, 3]);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "setRotation and setScale flip dirty",
  async () => {
    const { ctx, g, m } = await setup();
    const mesh = create(ctx, { geometry: g, material: m });
    const slot = _resolveMesh(ctx, mesh);
    _recomputeModelIfDirty(slot);
    expect(slot.transformDirty).toBe(false);
    setRotation(ctx, mesh, quat.fromValues(0, 0, 0, 1));
    expect(slot.transformDirty).toBe(true);
    _recomputeModelIfDirty(slot);
    setScale(ctx, mesh, new Float32Array([2, 2, 2]));
    expect(slot.transformDirty).toBe(true);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "_recomputeModelIfDirty composes TRS into modelMatrix and writes the object buffer",
  async () => {
    const { ctx, g, m } = await setup();
    const mesh = create(ctx, { geometry: g, material: m });
    setPosition(ctx, mesh, new Float32Array([10, 20, 30]));
    const slot = _resolveMesh(ctx, mesh);
    _recomputeModelIfDirty(slot);
    expect(slot.transformDirty).toBe(false);
    const expected = mat4.create();
    mat4.fromRotationTranslationScale(
      expected,
      quat.fromValues(0, 0, 0, 1),
      new Float32Array([10, 20, 30]),
      new Float32Array([1, 1, 1]),
    );
    expect(Array.from(slot.modelMatrix)).toEqual(Array.from(expected));
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "mesh.create throws when geometry is null",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const mat = await unlit(ctx, { color: vec4.fromValues(1, 0, 0, 1) });
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      create(ctx, { geometry: null as any, material: mat }),
    ).toThrow("geometry is required");
    destroyMaterial(mat);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "mesh.create throws when material is null",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const geo = cubeGeometry(ctx);
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
      create(ctx, { geometry: geo, material: null as any }),
    ).toThrow("material is required");
    destroyGeometry(ctx, geo);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "mesh.destroy is idempotent (silent on double-destroy)",
  async () => {
    const { ctx, g, m } = await setup();
    const mesh = create(ctx, { geometry: g, material: m });
    destroy(ctx, mesh);
    expect(() => destroy(ctx, mesh)).not.toThrow();
    destroyGeometry(ctx, g);
    destroyMaterial(m);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "destroyed mesh's slot is recycled with a new handle on next create",
  async () => {
    const { ctx, g, m } = await setup();
    const first = create(ctx, { geometry: g, material: m });
    destroy(ctx, first);
    expect(_lookupMesh(ctx, first)).toBeNull();
    const second = create(ctx, { geometry: g, material: m });
    expect(second).not.toBe(first);
    expect(_lookupMesh(ctx, second)).not.toBeNull();
    destroy(ctx, second);
    destroyGeometry(ctx, g);
    destroyMaterial(m);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "getPosition / getRotation / getScale read pose into out-params",
  async () => {
    const { ctx, g, m } = await setup();
    const mesh = create(ctx, { geometry: g, material: m });
    setPosition(ctx, mesh, new Float32Array([1, 2, 3]));
    setScale(ctx, mesh, new Float32Array([4, 5, 6]));
    setRotation(ctx, mesh, quat.fromValues(0, 0, 0, 1));
    const posOut = new Float32Array(3);
    const rotOut = quat.create();
    const scaleOut = new Float32Array(3);
    expect(Array.from(getPosition(ctx, mesh, posOut))).toEqual([1, 2, 3]);
    expect(Array.from(getRotation(ctx, mesh, rotOut))).toEqual([0, 0, 0, 1]);
    expect(Array.from(getScale(ctx, mesh, scaleOut))).toEqual([4, 5, 6]);
    destroy(ctx, mesh);
    destroyGeometry(ctx, g);
    destroyMaterial(m);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "setters and getters are silent no-ops on stale handles",
  async () => {
    const { ctx, g, m } = await setup();
    const mesh = create(ctx, { geometry: g, material: m });
    destroy(ctx, mesh);
    const posOut = new Float32Array([9, 9, 9]);
    expect(() =>
      setPosition(ctx, mesh, new Float32Array([1, 2, 3])),
    ).not.toThrow();
    expect(() =>
      setRotation(ctx, mesh, quat.fromValues(0, 0, 0, 1)),
    ).not.toThrow();
    expect(() =>
      setScale(ctx, mesh, new Float32Array([1, 1, 1])),
    ).not.toThrow();
    // getPosition on stale handle returns the unchanged out-param.
    const result = getPosition(ctx, mesh, posOut);
    expect(Array.from(result)).toEqual([9, 9, 9]);
    destroyGeometry(ctx, g);
    destroyMaterial(m);
    gpu.dispose(ctx);
  },
);
