// Bun's dev server (Bun.serve static-routes) doesn't inline `with { type: "text" }`
// imports — it exposes them as asset URLs. `bun build` does inline. Fetching the URL
// at runtime works in both modes (and matches the WebGPU sample convention).

import { mountFpsOverlay } from "./overlay/mount.ts";
import { overlayState } from "./overlay/state.svelte.ts";
import { createFpsSystem } from "./lib/stats/fps.ts";
import { requestWebGpu } from "./lib/gpu/requestWebGpu.ts";
import { runFrameLoop } from "./lib/gpu/runFrameLoop.ts";
import shaderUrl from "./triangle.wgsl";

export async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#gpu");
  if (!canvas) {
    throw new Error("canvas#gpu not found");
  }

  let webgpu: import("./lib/gpu/requestWebGpu.ts").WebGpuContext;
  try {
    webgpu = await requestWebGpu(canvas);
  } catch (e) {
    document.body.innerText = e instanceof Error ? e.message : String(e);
    return;
  }
  const { device, context, format } = webgpu;

  const shaderResponse = await fetch(shaderUrl);
  if (!shaderResponse.ok) {
    document.body.innerText = `Couldn't load shader (HTTP ${shaderResponse.status}): ${shaderUrl}`;
    return;
  }
  const shaderSource = await shaderResponse.text();

  device.pushErrorScope("validation");
  const shaderModule = device.createShaderModule({ code: shaderSource });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shaderModule, entryPoint: "vs_main" },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });
  const validationError = await device.popErrorScope();
  if (validationError) {
    document.body.innerText = `Pipeline error: ${validationError.message}`;
    return;
  }

  const uiRoot = document.querySelector<HTMLElement>("#ui-root");
  if (uiRoot) {
    mountFpsOverlay(uiRoot);
  } else {
    console.warn("#ui-root not found; skipping FPS overlay mount.");
  }

  const stats = createFpsSystem();
  stats.subscribe((fps) => {
    overlayState.fps = fps;
  });

  runFrameLoop(() => {
    stats.frame();
    const view = context.getCurrentTexture().createView();
    const encoder = device.createCommandEncoder();
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
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  });
}
