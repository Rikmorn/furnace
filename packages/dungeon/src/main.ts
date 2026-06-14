import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as gpu from "@furnace/core/gpu";
import { vec3, vec4 } from "@furnace/core/transform";

const CLEAR_COLOR = vec4.fromValues(0.02, 0.02, 0.03, 1);

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#gpu");
  if (!canvas) throw new Error("canvas#gpu not found");

  const ctx = await gpu.requestContext(canvas, { sampleCount: 4 });
  const cam = camera.perspective({
    position: vec3.fromValues(0, 1.6, 0),
    target: vec3.fromValues(0, 1.6, -1),
  });
  camera.bindToCanvas(ctx, cam);

  frame.loop(ctx, () => {
    frame.render(ctx, { meshes: [], camera: cam, clearColor: CLEAR_COLOR });
  });
}

main().catch((e: unknown) => {
  document.body.innerText = `Error: ${e instanceof Error ? e.message : String(e)}`;
});
