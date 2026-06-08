import { expect, test } from "bun:test";
import * as binding from "../../src/binding/index.ts";
import * as camera from "../../src/camera/index.ts";
import type { Light } from "../../src/frame/lights.ts";
import { render } from "../../src/frame/render.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import { create as createMesh } from "../../src/mesh/mesh.ts";
import * as shader from "../../src/shader/index.ts";
import {
  _cameraBinding,
  _objectBinding,
  _vsIn,
} from "../../src/shader/preamble.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

// A custom "toon-ish" lit shader composed entirely from the public
// lighting-toolkit fragments — proves a consumer can author a custom lit shader
// against the engine's Scene UBO without touching internals.
//
// Layout: one uniform field `tint: vec4f` at @group(1) @binding(0).
// The fragment calls fr_shade (from lightingHelpers) with tint.rgb as albedo,
// a grey specular highlight, and a fixed shininess — a minimal custom Blinn-Phong.
const CUSTOM_LIT_SRC = shader.source`${_cameraBinding}
${_objectBinding}
${_vsIn}
${shader.lightingHelpers}
struct Mat { tint: vec4<f32> };
@group(1) @binding(0) var<uniform> mat: Mat;
struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) wn: vec3<f32>,
  @location(1) wp: vec3<f32>
};
@vertex fn vs_main(v: VsIn) -> VsOut {
  var o: VsOut;
  let w = object.model * vec4<f32>(v.position, 1.0);
  o.pos = camera.viewProjection * w;
  o.wp = w.xyz;
  o.wn = (object.normalMatrix * vec4<f32>(v.normal, 0.0)).xyz;
  return o;
}
@fragment fn fs_main(i: VsOut) -> @location(0) vec4<f32> {
  let rgb = fr_shade(
    i.wp, normalize(i.wn), camera.position.xyz,
    mat.tint.rgb, vec3<f32>(0.2), 16.0
  );
  return vec4<f32>(rgb, 1.0);
}`;

const POINT_LIGHT: Light = {
  type: "point",
  position: [0, 2, 2],
  color: [1, 0.9, 0.8],
  intensity: 2,
  range: 12,
};

// (1) A consumer shader composing shader.lightingHelpers (fr_shade) compiles and
// draws clean with a custom { tint: "vec4f" } layout, usesScene: true, rendered
// with a point light. Proves the public fragments are composable by consumers
// and that the engine correctly binds the Scene UBO for a non-built-in shader.
test.skipIf(!bunWebGpuAvailable())(
  "custom lit shader composing shader.lightingHelpers compiles and draws clean",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const s = await shader.create(ctx, CUSTOM_LIT_SRC, {
      layout: { tint: "vec4f" },
      usesScene: true,
      usesShadows: true,
    });
    const b = binding.create(ctx, s);
    binding.set(ctx, b, { tint: [0.6, 0.4, 0.8, 1] });
    const mat = await material.create(ctx, { shader: s, binding: b });
    const cube = createMesh(ctx, {
      geometry: geometry.cube(ctx),
      material: mat,
    });
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
    });
    ctx.device.pushErrorScope("validation");
    render(ctx, { meshes: [cube], camera: cam, lights: [POINT_LIGHT] });
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    gpu.dispose(ctx);
  },
);

// (2) toWgsl deduplicates the shared sceneBinding across lit + a toolkit consumer.
// lit composes lightingHelpers → sceneBinding; a duplicate top-level WGSL struct
// declaration would cause a compile error, so lit resolving successfully proves
// the dedup works. (The ShaderSource tagged-template tracks each fragment by
// reference identity and emits each exactly once.)
test.skipIf(!bunWebGpuAvailable())(
  "lit (which composes lightingHelpers → sceneBinding) compiles clean — proves dedup",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const s = await shader.lit(ctx);
    expect(s).toBeDefined();
    gpu.dispose(ctx);
  },
);
