import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import { render } from "../../src/frame/render.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import { create } from "../../src/material/material.ts";
import * as mesh from "../../src/mesh/index.ts";
import { create as createShader } from "../../src/shader/shader.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const WGSL = `
struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;
struct VsIn { @location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32> };
@vertex fn vs_main(v: VsIn) -> @builtin(position) vec4<f32> {
  return camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }
`;

async function meshWith(ctx: gpu.Context, depthEnabled: boolean) {
  const sh = await createShader(ctx, WGSL);
  const mat = await create(ctx, {
    shader: sh,
    depth: depthEnabled ? undefined : false,
  });
  const geo = geometry.cube(ctx);
  return mesh.create(ctx, { geometry: geo, material: mat });
}

test.skipIf(!bunWebGpuAvailable())(
  "frame.render rejects a depthEnabled:false material",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(), {
      surfaceFormat: "linear",
    });
    const cam = camera.perspective({ aspect: 1 });
    const m = await meshWith(ctx, false);
    expect(() => render(ctx, { meshes: [m], camera: cam })).toThrow(
      /depthEnabled:false/,
    );
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "frame.render accepts a depth-enabled material",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(), {
      surfaceFormat: "linear",
    });
    const cam = camera.perspective({ aspect: 1 });
    const m = await meshWith(ctx, true);
    expect(() => render(ctx, { meshes: [m], camera: cam })).not.toThrow();
    gpu.dispose(ctx);
  },
);
