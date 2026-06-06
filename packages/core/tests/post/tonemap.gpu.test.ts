import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import * as frame from "../../src/frame/index.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as mesh from "../../src/mesh/index.ts";
import {
  _resolvePassPipeline,
  type EffectSlot,
} from "../../src/post/effect.ts";
import * as post from "../../src/post/index.ts";
import { _lookupEffect } from "../../src/resources/internal.ts";
import { vec3, vec4 } from "../../src/transform/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";
import { makeUnlitMaterial } from "../_helpers/unlit-material.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "post.tonemap returns a valid Effect handle (default operator neutral)",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(), {
      surfaceFormat: "linear",
      hdr: true,
    });
    const tm = await post.tonemap(ctx);
    expect(tm).toBeGreaterThan(0);
    post.destroy(ctx, tm);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "post.tonemap with reinhard + exposure constructs cleanly",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(), {
      surfaceFormat: "linear",
      hdr: true,
    });
    const tm = await post.tonemap(ctx, { operator: "reinhard", exposure: 2 });
    expect(tm).toBeGreaterThan(0);
    post.destroy(ctx, tm);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "HDR scene + post.tonemap renders one clean frame to the swap chain",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, {
      surfaceFormat: "linear",
      hdr: true,
    });
    const cam = camera.perspective({
      aspect: 1,
      position: vec3.fromValues(0, 0, 3),
    });
    const { material: mat } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 0, 0, 1),
    );
    const cubeGeo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: cubeGeo, material: mat });
    const tm = await post.tonemap(ctx);
    ctx.device.pushErrorScope("validation");
    frame.render(ctx, { meshes: [cube], camera: cam, effects: [tm] });
    const err = await ctx.device.popErrorScope();
    expect(err).toBeNull();
    post.destroy(ctx, tm);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "two tonemaps on one ctx share the cached engine-owned shader (no recompile)",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(), {
      surfaceFormat: "linear",
      hdr: true,
    });
    const a = await post.tonemap(ctx);
    const b = await post.tonemap(ctx, { exposure: 3 });
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    // The shared per-ctx shader cache means both effects resolve to the same
    // shader handle → same post pipeline-cache key → one shared GPURenderPipeline.
    // Pipeline identity is the observable proof the shader was reused, not recompiled.
    // Pipelines build lazily per target format — resolve both at ctx.format first.
    const slotA = _lookupEffect<EffectSlot>(ctx, a);
    const slotB = _lookupEffect<EffectSlot>(ctx, b);
    if (slotA === null || slotB === null) {
      throw new Error("unreachable: tonemaps were just created");
    }
    const passA = slotA.passes[0];
    const passB = slotB.passes[0];
    if (passA === undefined || passB === undefined) {
      throw new Error("unreachable: tonemap is a single-pass effect");
    }
    const varA = _resolvePassPipeline(ctx, passA, ctx.format);
    const varB = _resolvePassPipeline(ctx, passB, ctx.format);
    expect(varA.pipeline).toBe(varB.pipeline);
    post.destroy(ctx, a);
    post.destroy(ctx, b);
    gpu.dispose(ctx);
  },
);
