import { expect, test } from "bun:test";
import * as shader from "@furnace/core/shader";
import * as gpu from "../../src/gpu/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

async function createTestContext() {
  const canvas = await makeOffscreenCanvas();
  return gpu.requestContext(canvas, { surfaceFormat: "linear" });
}

const SHARED = shader.source`
fn tint(c: vec3<f32>) -> vec3<f32> { return c * 0.5; }`;

const VS = shader.source`
@vertex fn vs_main() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }`;

test.skipIf(!bunWebGpuAvailable())(
  "shader.create compiles a composed ShaderSource — diamond dedup yields valid WGSL",
  async () => {
    const ctx = await createTestContext();
    // a and b BOTH depend on SHARED. If toWgsl failed to dedup, `tint` would be
    // declared twice and WGSL compilation would throw "duplicate declaration".
    const a = shader.source`${SHARED}
fn a() -> vec3<f32> { return tint(vec3<f32>(1.0)); }`;
    const b = shader.source`${SHARED}
fn b() -> vec3<f32> { return tint(vec3<f32>(0.5)); }`;
    const root = shader.source`${VS}
${a}
${b}
@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(a() + b(), 1.0); }`;
    const s = await shader.create(ctx, root);
    expect(s).toBeDefined();
    shader.destroy(ctx, s);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "shader.create still accepts a bare string unchanged",
  async () => {
    const ctx = await createTestContext();
    const s = await shader.create(
      ctx,
      `@vertex fn vs_main() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }
@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }`,
    );
    expect(s).toBeDefined();
    shader.destroy(ctx, s);
    gpu.dispose(ctx);
  },
);
