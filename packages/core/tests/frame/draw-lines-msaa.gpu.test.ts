import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import { render } from "../../src/frame/render.ts";
import { drawLines } from "../../src/frame/render-lines.ts";
import * as geometry from "../../src/geometry/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as meshMod from "../../src/mesh/index.ts";
import * as post from "../../src/post/index.ts";
import * as shader from "../../src/shader/index.ts";
import { vec3, vec4 } from "../../src/transform/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";
import { makeUnlitMaterial } from "../_helpers/unlit-material.ts";

await ensureBunWebGpu();

const PASSTHROUGH_WGSL = `
@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var sceneSamp: sampler;
struct VsOut { @builtin(position) clip_pos: vec4<f32>, @location(0) uv: vec2<f32> };
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  return textureSample(sceneTex, sceneSamp, in.uv);
}`;

type EncoderSpy = {
  descriptors: GPURenderPassDescriptor[];
  restore: () => void;
};

/**
 * Capture every render-pass descriptor recorded on `ctx`. White-box, but the
 * scene pass's store ops have no other observable in this harness: load-after-
 * discard is undefined contents rather than a validation error, and the
 * swap-chain texture is not configured COPY_SRC so pixels cannot be read back.
 */
function spyOnRenderPasses(ctx: gpu.Context): EncoderSpy {
  const descriptors: GPURenderPassDescriptor[] = [];
  const realCreate = ctx.device.createCommandEncoder.bind(ctx.device);
  const deviceSpy = ctx.device as unknown as {
    createCommandEncoder: GPUDevice["createCommandEncoder"];
  };
  deviceSpy.createCommandEncoder = (...args) => {
    const encoder = realCreate(...args);
    const realBegin = encoder.beginRenderPass.bind(encoder);
    (
      encoder as unknown as {
        beginRenderPass: GPUCommandEncoder["beginRenderPass"];
      }
    ).beginRenderPass = (descriptor) => {
      descriptors.push(descriptor);
      return realBegin(descriptor);
    };
    return encoder;
  };
  return {
    descriptors,
    restore: () => {
      deviceSpy.createCommandEncoder = realCreate;
    },
  };
}

/**
 * The scene pass is the only one carrying BOTH a colour and a depth attachment:
 * post-chain passes are colour-only, and shadow-caster passes are depth-only
 * (`colorAttachments: []`). That holds on 1x and 4x contexts alike — unlike
 * `resolveTarget`, which only ever exists when multisampled.
 */
function findScenePass(descriptors: readonly GPURenderPassDescriptor[]) {
  for (const descriptor of descriptors) {
    const color = [...descriptor.colorAttachments][0];
    if (color != null && descriptor.depthStencilAttachment !== undefined) {
      return { color, depth: descriptor.depthStencilAttachment };
    }
  }
  return null;
}

async function msaaFixture() {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, {
    surfaceFormat: "linear",
    sampleCount: 4,
  });
  const { material } = await makeUnlitMaterial(
    ctx,
    vec4.fromValues(1, 0, 0, 1),
  );
  const geo = geometry.cube(ctx);
  const mesh = meshMod.create(ctx, { geometry: geo, material });
  const cam = camera.perspective({
    aspect: ctx.canvas.width / ctx.canvas.height,
    position: vec3.fromValues(0, 0, 3),
  });
  return { ctx, cam, mesh };
}

test.skipIf(!bunWebGpuAvailable())(
  "drawLines on a sampleCount:4 context builds a valid pass (both depth modes)",
  async () => {
    const { ctx, cam, mesh } = await msaaFixture();
    const vertices = new Float32Array([0, 0, 0, 1, 1, 1]);
    const colors = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]);

    render(ctx, { meshes: [mesh], camera: cam });

    ctx.device.pushErrorScope("validation");
    drawLines(ctx, { vertices, colors, camera: cam, occlude: true });
    const occludeErr = await ctx.device.popErrorScope();
    expect(occludeErr).toBeNull();

    ctx.device.pushErrorScope("validation");
    drawLines(ctx, { vertices, colors, camera: cam, occlude: false });
    const overlayErr = await ctx.device.popErrorScope();
    expect(overlayErr).toBeNull();

    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "multiple drawLines calls in one MSAA frame each build a valid pass",
  async () => {
    const { ctx, cam, mesh } = await msaaFixture();
    const vertices = new Float32Array([-1, 0, 0, 1, 0, 0]);
    const colors = new Float32Array([1, 1, 0, 1, 1, 1, 0, 1]);

    render(ctx, { meshes: [mesh], camera: cam });

    ctx.device.pushErrorScope("validation");
    drawLines(ctx, { vertices, colors, camera: cam });
    drawLines(ctx, { vertices, colors, camera: cam, occlude: false });
    drawLines(ctx, { vertices, colors, camera: cam, occlude: true });
    const err = await ctx.device.popErrorScope();
    expect(err).toBeNull();

    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "MSAA effects-less scene pass retains colour + depth so drawLines can load them",
  async () => {
    const { ctx, cam, mesh } = await msaaFixture();
    const spy = spyOnRenderPasses(ctx);
    render(ctx, { meshes: [mesh], camera: cam });
    spy.restore();

    const scene = findScenePass(spy.descriptors);
    expect(scene).not.toBeNull();
    expect(scene?.color.resolveTarget).toBeDefined();
    expect(scene?.color.storeOp).toBe("store");
    expect(scene?.depth?.depthStoreOp).toBe("store");

    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "MSAA scene pass with a post chain discards its multisampled attachments",
  async () => {
    const { ctx, cam, mesh } = await msaaFixture();
    const fx = await post.create(ctx, {
      shader: await shader.create(ctx, PASSTHROUGH_WGSL),
    });

    const spy = spyOnRenderPasses(ctx);
    render(ctx, { meshes: [mesh], camera: cam, effects: [fx] });
    spy.restore();

    // Nothing reads the multisampled colour or depth after this pass: the chain
    // samples only the resolved single-sample target, and drawLines refuses the
    // combination outright (asserted below).
    const scene = findScenePass(spy.descriptors);
    expect(scene).not.toBeNull();
    expect(scene?.color.resolveTarget).toBeDefined();
    expect(scene?.color.storeOp).toBe("discard");
    expect(scene?.depth?.depthStoreOp).toBe("discard");

    post.destroy(ctx, fx);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "sampleCount:1 scene pass with a post chain stores — the chain samples it directly",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const { material } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 0, 0, 1),
    );
    const mesh = meshMod.create(ctx, {
      geometry: geometry.cube(ctx),
      material,
    });
    const cam = camera.perspective({
      aspect: 1,
      position: vec3.fromValues(0, 0, 3),
    });
    const fx = await post.create(ctx, {
      shader: await shader.create(ctx, PASSTHROUGH_WGSL),
    });

    const spy = spyOnRenderPasses(ctx);
    render(ctx, { meshes: [mesh], camera: cam, effects: [fx] });
    spy.restore();

    // Without MSAA there is no resolve: the scene renders STRAIGHT into the
    // pool target the chain samples, so discarding it would feed the chain
    // undefined contents. This is bowling's shipped config with MSAA off.
    const scene = findScenePass(spy.descriptors);
    expect(scene).not.toBeNull();
    expect(scene?.color.resolveTarget).toBeUndefined();
    expect(scene?.color.storeOp).toBe("store");
    expect(scene?.depth?.depthStoreOp).toBe("store");

    post.destroy(ctx, fx);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "drawLines records nothing on an MSAA context whose frame went through a post chain",
  async () => {
    const { ctx, cam, mesh } = await msaaFixture();
    const fx = await post.create(ctx, {
      shader: await shader.create(ctx, PASSTHROUGH_WGSL),
    });
    render(ctx, { meshes: [mesh], camera: cam, effects: [fx] });

    // Skipped, not merely error-free: a recorded pass would resolve the raw
    // scene colour over the post chain's output and corrupt the frame.
    const spy = spyOnRenderPasses(ctx);
    ctx.device.pushErrorScope("validation");
    drawLines(ctx, {
      vertices: new Float32Array([0, 0, 0, 1, 1, 1]),
      colors: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]),
      camera: cam,
    });
    const err = await ctx.device.popErrorScope();
    spy.restore();

    expect(err).toBeNull();
    expect(spy.descriptors).toHaveLength(0);

    post.destroy(ctx, fx);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "drawLines still records on a sampleCount:1 context rendered through a post chain",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const { material } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 0, 0, 1),
    );
    const mesh = meshMod.create(ctx, {
      geometry: geometry.cube(ctx),
      material,
    });
    const cam = camera.perspective({
      aspect: 1,
      position: vec3.fromValues(0, 0, 3),
    });
    const fx = await post.create(ctx, {
      shader: await shader.create(ctx, PASSTHROUGH_WGSL),
    });
    render(ctx, { meshes: [mesh], camera: cam, effects: [fx] });

    // The guard is MSAA-specific: without multisampling the overlay targets the
    // swap chain directly and composes over the post output as intended.
    const spy = spyOnRenderPasses(ctx);
    ctx.device.pushErrorScope("validation");
    drawLines(ctx, {
      vertices: new Float32Array([0, 0, 0, 1, 1, 1]),
      colors: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]),
      camera: cam,
    });
    const err = await ctx.device.popErrorScope();
    spy.restore();

    expect(err).toBeNull();
    expect(spy.descriptors).toHaveLength(1);

    post.destroy(ctx, fx);
    gpu.dispose(ctx);
  },
);
