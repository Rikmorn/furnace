import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as gpu from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import { vec3, vec4 } from "@furnace/core/transform";
import { FpController } from "./fp-controller.ts";
import { buildLevel } from "./level.ts";

const FOG_COLOR: [number, number, number] = [0.015, 0.02, 0.03];
// Clear color matches the fog so the void at depth reads as fog, not a hard edge.
const CLEAR_COLOR = vec4.fromValues(
  FOG_COLOR[0],
  FOG_COLOR[1],
  FOG_COLOR[2],
  1,
);

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
  const fog: frame.Fog = { color: FOG_COLOR, density: 0.12 };
  // Ambient dropped low now that fog + (soon) the torch carry the mood.
  const ambient: frame.Ambient = {
    sky: [0.06, 0.07, 0.1],
    ground: [0.02, 0.02, 0.03],
    intensity: 0.4,
  };

  input.attach(canvas);
  const player = new FpController({ position: [0, 1.6, -2] });
  player.attachMouse(canvas);

  frame.loop(ctx, (info) => {
    player.update(ctx, cam, info.deltaMs / 1000);
    frame.render(ctx, {
      meshes: level.meshes,
      camera: cam,
      clearColor: CLEAR_COLOR,
      lights,
      ambient,
      fog,
    });
  });
}

main().catch((e: unknown) => {
  document.body.innerText = `Error: ${e instanceof Error ? e.message : String(e)}`;
});
