import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as gpu from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import * as post from "@furnace/core/post";
import { vec3, vec4 } from "@furnace/core/transform";
import { slideMove } from "./collision.ts";
import { FpController } from "./fp-controller.ts";
import { buildGlows, buildLevel } from "./level.ts";
import { buildMotes } from "./motes.ts";
import { Torch } from "./torch.ts";

const PLAYER_RADIUS = 0.3;

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

  const ctx = await gpu.requestContext(canvas, { sampleCount: 4, hdr: true });
  const cam = camera.perspective({
    position: vec3.fromValues(0, 1.6, 0),
    target: vec3.fromValues(0, 1.6, -1),
  });
  const unbindCamera = camera.bindToCanvas(ctx, cam);

  const level = await buildLevel(ctx);
  const glows = await buildGlows(ctx);
  const motes = await buildMotes(ctx);

  // Bloom REQUIRES an hdr context; an hdr context REQUIRES a non-empty effects chain.
  const bloom = await post.bloom(ctx, {
    intensity: 0.9,
    threshold: 1.0,
    softness: 0.2,
  });
  const tonemap = await post.tonemap(ctx, {
    exposure: 1.0,
    operator: "neutral",
  });

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
  const torch = new Torch();

  const loopHandle = frame.loop(ctx, (info) => {
    const dt = info.deltaMs / 1000;
    // slideMove returns an absolute resolved position; the controller's clampMove
    // contract wants a DELTA, so subtract the start position back out.
    player.update(ctx, cam, dt, (fromPos, delta) => {
      const r = slideMove(fromPos, delta, PLAYER_RADIUS, level.boxes);
      return [r[0] - fromPos[0], r[1] - fromPos[1], r[2] - fromPos[2]];
    });
    motes.update(player.position, dt);
    // Torch follows the player and flickers — rebuilt each frame.
    const lights: frame.Light[] = [torch.light(player.position, dt)];
    frame.render(ctx, {
      meshes: [...level.meshes, ...glows.meshes, ...motes.meshes],
      camera: cam,
      clearColor: CLEAR_COLOR,
      lights,
      ambient,
      fog,
      effects: [bloom, tonemap],
    });
  });

  // Tear down in reverse dependency order: stop the loop, release consumer
  // objects, then effects/meshes/bindings, and finally the context — gpu.dispose
  // warns on any leaked resource-manager slot, so a clean shutdown IS the leak check.
  const dispose = (): void => {
    loopHandle.stop();
    player.destroy();
    input.detach();
    unbindCamera();
    motes.destroy();
    glows.destroy();
    level.destroy();
    post.destroy(ctx, bloom);
    post.destroy(ctx, tonemap);
    gpu.dispose(ctx); // LAST — warns on leaked resource-manager slots; a clean shutdown is the leak check.
  };
  window.addEventListener("beforeunload", dispose);
}

main().catch((e: unknown) => {
  document.body.innerText = `Error: ${e instanceof Error ? e.message : String(e)}`;
});
