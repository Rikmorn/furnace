const WIDTH = 512;
const HEIGHT = 128;

export interface TextCanvas {
  texture: GPUTexture;
  update(fps: number): void;
  dispose(): void;
}

export function createTextCanvas(device: GPUDevice): TextCanvas {
  const offscreen = document.createElement("canvas");
  offscreen.width = WIDTH;
  offscreen.height = HEIGHT;
  const ctx = offscreen.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }

  const texture = device.createTexture({
    size: [WIDTH, HEIGHT, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  return {
    texture,
    update(fps) {
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = "#fff";
      ctx.font = "48px ui-monospace, monospace";
      ctx.fillText(`${fps} fps`, 16, 80);
      // `copyExternalImageToTexture` silently no-ops with HTMLCanvasElement sources
      // in some browser/webview configurations (verified in execution: source canvas
      // paints correctly, destination texture stays zero). `writeTexture` with raw
      // ImageData bytes is the reliable path — synchronous CPU→GPU upload at 1Hz
      // is fine for this use case.
      const imageData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
      device.queue.writeTexture(
        { texture },
        imageData.data,
        { bytesPerRow: WIDTH * 4, rowsPerImage: HEIGHT },
        [WIDTH, HEIGHT, 1],
      );
    },
    dispose() {
      texture.destroy();
    },
  };
}
