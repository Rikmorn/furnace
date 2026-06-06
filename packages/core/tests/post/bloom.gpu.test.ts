import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import * as frame from "../../src/frame/index.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as meshMod from "../../src/mesh/index.ts";
import { _bloomPassCount } from "../../src/post/bloom.ts";
import * as post from "../../src/post/index.ts";
import { vec3, vec4 } from "../../src/transform/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";
import { makeUnlitMaterial } from "../_helpers/unlit-material.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "post.bloom + tonemap render one clean HDR frame",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(128, 128), {
      surfaceFormat: "linear",
      hdr: true,
    });
    const bloom = await post.bloom(ctx, { intensity: 0.6 });
    const tm = await post.tonemap(ctx);
    const { material } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(3, 3, 3, 1),
    ); // emissive-bright >1.0
    const m = meshMod.create(ctx, { geometry: geometry.cube(ctx), material });
    const cam = camera.perspective({
      aspect: 1,
      position: vec3.fromValues(0, 0, 3),
    });
    ctx.device.pushErrorScope("validation");
    frame.render(ctx, { meshes: [m], camera: cam, effects: [bloom, tm] });
    const err = await ctx.device.popErrorScope();
    expect(err).toBeNull();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "post.bloom on a non-hdr ctx is setup-loud",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(128, 128), {
      surfaceFormat: "linear",
    }); // hdr off
    await expect(post.bloom(ctx)).rejects.toThrow(/hdr/);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "_bloomPassCount: prefilter + (N-1) downsample + (N-1) upsample + composite",
  () => {
    // 128x128: mipCount caps at MAX_MIPS=6 (floor(128/2^6)=2 >= MIN_MIP_SIZE=2).
    // passes = 1 (prefilter) + (6-1) down + (6-1) up + 1 (composite) = 12.
    expect(_bloomPassCount(128, 128)).toBe(12);
    // 8x8: floor(8/2^1)=4>=2, floor(8/2^2)=2>=2, floor(8/2^3)=1<2 → mipCount=2.
    // passes = 1 + 1 + 1 + 1 = 4.
    expect(_bloomPassCount(8, 8)).toBe(4);
    // 2x2: floor(2/2^1)=1<2 → mipCount=1. passes = 1 (prefilter) + 1 (composite) = 2.
    expect(_bloomPassCount(2, 2)).toBe(2);
  },
);
