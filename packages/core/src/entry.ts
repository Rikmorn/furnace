import shader from "./triangle.wgsl" with { type: "text" };

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
  const shaderModule = device.createShaderModule({ code: shader });
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

  const draw = (): void => {
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
