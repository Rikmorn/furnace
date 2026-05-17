// Bun's dev server (Bun.serve static-routes) doesn't inline `with { type: "text" }`
// imports — it exposes them as asset URLs. `bun build` does inline. Fetching the URL
// at runtime works in both modes (and matches the WebGPU sample convention).

import { mountFpsOverlay } from "./overlay/mount.ts";
import { overlayState } from "./overlay/state.svelte.ts";
import { initStats } from "./stats.ts";
import shaderUrl from "./triangle.wgsl";

export async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#gpu");
  if (!canvas) {
    throw new Error("canvas#gpu not found");
  }

  if (!navigator.gpu) {
    document.body.innerText =
      "WebGPU unavailable. Need a recent Chrome/Safari/Firefox, or macOS Tahoe 26+ inside the native webview.";
    return;
  }

  const shaderResponse = await fetch(shaderUrl);
  if (!shaderResponse.ok) {
    document.body.innerText = `Couldn't load shader (HTTP ${shaderResponse.status}): ${shaderUrl}`;
    return;
  }
  const shaderSource = await shaderResponse.text();

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    document.body.innerText =
      "WebGPU adapter not available. GPU may not be supported.";
    return;
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  if (!context) {
    document.body.innerText = "Couldn't get WebGPU canvas context.";
    return;
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

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

  const stats = initStats({
    onTick: (fps) => {
      overlayState.fps = fps;
    },
  });

  const draw = (): void => {
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
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
