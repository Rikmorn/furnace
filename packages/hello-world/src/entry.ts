import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as gpu from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import {
  add,
  ready as demoWasmReady,
} from "../plugins/demo-wasm/pkg/demo_wasm";
import { mountFpsOverlay } from "./overlay/mount.ts";
import { fpsSystem } from "./overlay/state.svelte.ts";
import shaderUrl from "./triangle.wgsl";

const CAMERA_UNIFORM_SIZE_BYTES = 64;
const TRANSLATION_UNIFORM_SIZE_BYTES = 16;
const MOVE_SPEED_WORLD_PER_SEC = 1.5;
const DIAGONAL_NORMALIZE = 1 / Math.sqrt(2);

async function main(): Promise<void> {
  await demoWasmReady;
  console.log("demo-wasm: 2 + 3 =", add(2, 3));
  const canvas = document.querySelector<HTMLCanvasElement>("#gpu");
  const uiRoot = document.querySelector<HTMLElement>("#ui-root");
  if (!canvas) throw new Error("canvas#gpu not found");
  if (!uiRoot) throw new Error("#ui-root not found");

  const shaderResponse = await fetch(shaderUrl);
  if (!shaderResponse.ok) {
    document.body.innerText = `Couldn't load shader (HTTP ${shaderResponse.status}): ${shaderUrl}`;
    return;
  }
  const shaderSource = await shaderResponse.text();

  let ctx: gpu.Context;
  try {
    ctx = await gpu.requestContext(canvas);
  } catch (e) {
    document.body.innerText = e instanceof Error ? e.message : String(e);
    return;
  }

  ctx.device.pushErrorScope("validation");
  const shaderModule = ctx.device.createShaderModule({ code: shaderSource });
  const pipeline = ctx.device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shaderModule, entryPoint: "vs_main" },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format: ctx.format }],
    },
    primitive: { topology: "triangle-list" },
  });
  const validationError = await ctx.device.popErrorScope();
  if (validationError) {
    document.body.innerText = `Pipeline error: ${validationError.message}`;
    return;
  }

  const cam = camera.perspective({
    aspect: ctx.canvas.width / ctx.canvas.height,
  });

  const cameraBuffer = ctx.device.createBuffer({
    size: CAMERA_UNIFORM_SIZE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const translationBuffer = ctx.device.createBuffer({
    size: TRANSLATION_UNIFORM_SIZE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  // Mutable position accumulator; avoids noUncheckedIndexedAccess on Float32Array writes.
  const pos = { x: 0, y: 0 };
  const translation = new Float32Array(4); // x, y, z, _pad

  const sceneBindGroup = ctx.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: cameraBuffer } },
      { binding: 1, resource: { buffer: translationBuffer } },
    ],
  });

  gpu.onResize(ctx, ({ width, height }) => {
    camera.setAspect(cam, width / height);
  });

  input.attach(canvas);

  mountFpsOverlay(uiRoot);

  frame.loop(ctx, ({ deltaMs }) => {
    fpsSystem.frame();

    const dt = deltaMs / 1000;
    let dx = 0;
    let dy = 0;
    if (input.isKeyDown("ArrowLeft")) dx -= 1;
    if (input.isKeyDown("ArrowRight")) dx += 1;
    if (input.isKeyDown("ArrowDown")) dy -= 1;
    if (input.isKeyDown("ArrowUp")) dy += 1;
    if (dx !== 0 && dy !== 0) {
      dx *= DIAGONAL_NORMALIZE;
      dy *= DIAGONAL_NORMALIZE;
    }
    pos.x += dx * MOVE_SPEED_WORLD_PER_SEC * dt;
    pos.y += dy * MOVE_SPEED_WORLD_PER_SEC * dt;
    translation.set([pos.x, pos.y, 0, 0]);
    ctx.queue.writeBuffer(translationBuffer, 0, translation);

    const { viewProjection } = camera.getMatrices(cam);
    ctx.queue.writeBuffer(cameraBuffer, 0, viewProjection);
    frame.encode(ctx, (encoder) => {
      const view = gpu.getCurrentTextureView(ctx);
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view,
            clearValue: { r: 0.05, g: 0.05, b: 0.07, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, sceneBindGroup);
      pass.draw(3);
      pass.end();
    });
  });
}

main().catch((e: unknown) => {
  document.body.innerText = `Error: ${e instanceof Error ? e.message : String(e)}`;
});
