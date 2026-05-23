import type { Camera } from "../camera/index.ts";
import * as camera from "../camera/index.ts";
import type { Context } from "../gpu/index.ts";

const CAMERA_UNIFORM_SIZE = 64; // one mat4x4<f32>

type DepthEntry = {
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
};

const depthByCtx = new WeakMap<Context, DepthEntry>();
const cameraBuffers = new WeakMap<Context, Map<Camera, GPUBuffer>>();

function _ensureDepthTexture(ctx: Context): DepthEntry {
  const existing = depthByCtx.get(ctx);
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  if (existing && existing.width === width && existing.height === height) {
    return existing;
  }
  if (existing) existing.texture.destroy();
  const texture = ctx.device.createTexture({
    size: { width, height },
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const entry: DepthEntry = {
    texture,
    view: texture.createView(),
    width,
    height,
  };
  depthByCtx.set(ctx, entry);
  return entry;
}

function _ensureCameraBuffer(ctx: Context, cam: Camera): GPUBuffer {
  let perCam = cameraBuffers.get(ctx);
  if (!perCam) {
    perCam = new Map();
    cameraBuffers.set(ctx, perCam);
  }
  let buffer = perCam.get(cam);
  if (!buffer) {
    buffer = ctx.device.createBuffer({
      size: CAMERA_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    perCam.set(cam, buffer);
  }
  const matrices = camera.getMatrices(cam);
  ctx.queue.writeBuffer(buffer, 0, matrices.viewProjection);
  return buffer;
}

export const _frameRenderInternals = {
  _ensureDepthTexture,
  _ensureCameraBuffer,
};
