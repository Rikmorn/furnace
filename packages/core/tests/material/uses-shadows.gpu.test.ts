import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as material from "../../src/material/index.ts";
import { _resolveMaterial } from "../../src/material/internal.ts";
import * as shader from "../../src/shader/index.ts";
import { sceneBinding } from "../../src/shader/lighting.ts";
import {
  _cameraBinding,
  _objectBinding,
  _vsIn,
} from "../../src/shader/preamble.ts";
import { shadowHelpers } from "../../src/shader/shadows.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const SRC = shader.source`${_cameraBinding}${_objectBinding}${_vsIn}${sceneBinding}${shadowHelpers}
@vertex fn vs_main(v: VsIn) -> @builtin(position) vec4<f32> {
  return camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(fr_shadowFactor(vec3<f32>(0.0), -1, 0.0), 0.0, 0.0, 1.0);
}`;

test.skipIf(!bunWebGpuAvailable())(
  "material records usesShadows from its shader",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const s = await shader.create(ctx, SRC, {
      usesScene: true,
      usesShadows: true,
    });
    const mat = await material.create(ctx, { shader: s });
    expect(_resolveMaterial(ctx, mat).usesShadows).toBe(true);

    const s2 = await shader.create(ctx, SRC, { usesScene: true });
    const mat2 = await material.create(ctx, { shader: s2 });
    expect(_resolveMaterial(ctx, mat2).usesShadows).toBe(false);
    gpu.dispose(ctx);
  },
);
