import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as gpu from "@furnace/core/gpu";
import { vec3, vec4 } from "@furnace/core/transform";
import { buildLevel } from "./level.ts";

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

  const level = await buildLevel(ctx);

  // Temporary visibility lighting (replaced by torch in Task 6).
  const lights: frame.Light[] = [
    {
      type: "directional",
      direction: [0.3, -1, -0.4],
      color: [1, 1, 1],
      intensity: 1.2,
    },
  ];
  const ambient: frame.Ambient = {
    sky: [0.4, 0.45, 0.55],
    ground: [0.15, 0.15, 0.2],
    intensity: 0.3,
  };

  frame.loop(ctx, () => {
    frame.render(ctx, {
      meshes: level.meshes,
      camera: cam,
      clearColor: CLEAR_COLOR,
      lights,
      ambient,
    });
  });
}

main().catch((e: unknown) => {
  document.body.innerText = `Error: ${e instanceof Error ? e.message : String(e)}`;
});
