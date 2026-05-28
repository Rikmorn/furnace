import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import { render } from "../../src/frame/render.ts";
import * as gpu from "../../src/gpu/index.ts";
import { destroy as destroyMaterial, unlit } from "../../src/material/index.ts";
import type { Material, MaterialSlot } from "../../src/material/types.ts";
import { cubeGeometry } from "../../src/mesh/factories/cube.ts";
import {
  create as createMesh,
  destroy as destroyMesh,
  setMaterial,
} from "../../src/mesh/mesh.ts";
import { _lookupMaterial } from "../../src/resources/internal.ts";
import { vec4 } from "../../src/transform/vec4.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

async function setup() {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const geo = cubeGeometry(ctx);
  const matA = await unlit(ctx, { color: vec4.fromValues(1, 0, 0, 1) });
  const matB = await unlit(ctx, { color: vec4.fromValues(0, 1, 0, 1) });
  return { ctx, geo, matA, matB };
}

test.skipIf(!bunWebGpuAvailable())(
  "setMaterial swaps the bound material and the mesh still renders cleanly",
  async () => {
    const { ctx, geo, matA, matB } = await setup();
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
    });
    const m = createMesh(ctx, { geometry: geo, material: matA });
    setMaterial(ctx, m, matB);
    ctx.device.pushErrorScope("validation");
    render(ctx, { draw: [m], camera: cam });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    destroyMesh(ctx, m);
    destroyMaterial(ctx, matA);
    destroyMaterial(ctx, matB);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "setMaterial swaps refcounts: old decrements, new increments",
  async () => {
    const { ctx, geo, matA, matB } = await setup();
    const m = createMesh(ctx, { geometry: geo, material: matA });
    expect(_lookupMaterial<MaterialSlot>(ctx, matA)?.userCount).toBe(1);
    expect(_lookupMaterial<MaterialSlot>(ctx, matB)?.userCount).toBe(0);
    setMaterial(ctx, m, matB);
    expect(_lookupMaterial<MaterialSlot>(ctx, matA)?.userCount).toBe(0);
    expect(_lookupMaterial<MaterialSlot>(ctx, matB)?.userCount).toBe(1);
    destroyMesh(ctx, m);
    destroyMaterial(ctx, matA);
    destroyMaterial(ctx, matB);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "setMaterial triggers deferred destroy of the previous material when refcount hits zero",
  async () => {
    const { ctx, geo, matA, matB } = await setup();
    const m = createMesh(ctx, { geometry: geo, material: matA });

    // Mark matA destroyed while still held by the mesh (refcount 1 → deferred).
    destroyMaterial(ctx, matA);
    expect(_lookupMaterial<MaterialSlot>(ctx, matA)?.markedDestroyed).toBe(
      true,
    );

    // Swapping to matB drops matA's refcount to 0, which fires the deferred teardown.
    setMaterial(ctx, m, matB);
    expect(_lookupMaterial(ctx, matA)).toBeNull();

    destroyMesh(ctx, m);
    destroyMaterial(ctx, matB);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "setMaterial to the same material is idempotent (no refcount churn)",
  async () => {
    const { ctx, geo, matA, matB } = await setup();
    const m = createMesh(ctx, { geometry: geo, material: matA });
    expect(_lookupMaterial<MaterialSlot>(ctx, matA)?.userCount).toBe(1);
    setMaterial(ctx, m, matA);
    expect(_lookupMaterial<MaterialSlot>(ctx, matA)?.userCount).toBe(1);
    destroyMesh(ctx, m);
    destroyMaterial(ctx, matA);
    destroyMaterial(ctx, matB);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "setMaterial throws when the new material is null",
  async () => {
    const { ctx, geo, matA, matB } = await setup();
    const m = createMesh(ctx, { geometry: geo, material: matA });
    expect(() => setMaterial(ctx, m, null as unknown as Material)).toThrow(
      "material is required",
    );
    // Old material's refcount is unchanged.
    expect(_lookupMaterial<MaterialSlot>(ctx, matA)?.userCount).toBe(1);
    destroyMesh(ctx, m);
    destroyMaterial(ctx, matA);
    destroyMaterial(ctx, matB);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "setMaterial throws when the new material handle is stale, leaving the old refcount untouched",
  async () => {
    const { ctx, geo, matA, matB } = await setup();
    const m = createMesh(ctx, { geometry: geo, material: matA });
    // matB is unused; destroy it so its handle goes stale (refcount 0 → freed).
    destroyMaterial(ctx, matB);
    expect(_lookupMaterial(ctx, matB)).toBeNull();

    expect(() => setMaterial(ctx, m, matB)).toThrow(
      /material handle is invalid or destroyed/,
    );
    // Validate-first guarantee: the failed lookup did NOT decrement matA.
    expect(_lookupMaterial<MaterialSlot>(ctx, matA)?.userCount).toBe(1);

    destroyMesh(ctx, m);
    destroyMaterial(ctx, matA);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "setMaterial is a silent no-op on stale mesh handle",
  async () => {
    const { ctx, geo, matA, matB } = await setup();
    const m = createMesh(ctx, { geometry: geo, material: matA });
    destroyMesh(ctx, m);
    // matB's refcount before the no-op call.
    const before = _lookupMaterial<MaterialSlot>(ctx, matB)?.userCount ?? -1;
    expect(() => setMaterial(ctx, m, matB)).not.toThrow();
    expect(_lookupMaterial<MaterialSlot>(ctx, matB)?.userCount).toBe(before);

    destroyMaterial(ctx, matA);
    destroyMaterial(ctx, matB);
    gpu.dispose(ctx);
  },
);
