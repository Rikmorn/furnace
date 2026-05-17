import shaderUrl from "./plane.wgsl";

export interface UiPlane {
  draw(pass: GPURenderPassEncoder): void;
  dispose(): void;
}

interface CreatePlaneOptions {
  device: GPUDevice;
  format: GPUTextureFormat;
  depthFormat: GPUTextureFormat;
  texture: GPUTexture;
  sampler: GPUSampler;
}

// Quad vertices: position (x, y, z) + uv. Z varies left-to-right so the plane
// tilts in depth and visibly interleaves with the triangle (Z=0.5).
const VERTICES = new Float32Array([
  // x,    y,    z,   u,   v
  0.0,
  0.2,
  0.3,
  0.0,
  0.0, // top-left
  0.8,
  0.2,
  0.7,
  1.0,
  0.0, // top-right
  0.0,
  -0.4,
  0.3,
  0.0,
  1.0, // bottom-left
  0.8,
  -0.4,
  0.7,
  1.0,
  1.0, // bottom-right
]);
const INDICES = new Uint16Array([0, 2, 1, 1, 2, 3]);

export async function createUiPlane({
  device,
  format,
  depthFormat,
  texture,
  sampler,
}: CreatePlaneOptions): Promise<UiPlane> {
  const shaderResponse = await fetch(shaderUrl);
  if (!shaderResponse.ok) {
    throw new Error(
      `Couldn't load plane shader (HTTP ${shaderResponse.status}): ${shaderUrl}`,
    );
  }
  const shaderSource = await shaderResponse.text();

  const shaderModule = device.createShaderModule({ code: shaderSource });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });

  device.pushErrorScope("validation");
  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: 5 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 3 * 4, format: "float32x2" },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: depthFormat,
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });
  const validationError = await device.popErrorScope();
  if (validationError) {
    throw new Error(`Plane pipeline validation: ${validationError.message}`);
  }

  const vertexBuffer = device.createBuffer({
    size: VERTICES.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, VERTICES);

  const indexBuffer = device.createBuffer({
    size: INDICES.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, INDICES);

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: texture.createView() },
      { binding: 1, resource: sampler },
    ],
  });

  return {
    draw(pass) {
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.setIndexBuffer(indexBuffer, "uint16");
      pass.drawIndexed(INDICES.length);
    },
    dispose() {
      vertexBuffer.destroy();
      indexBuffer.destroy();
    },
  };
}
