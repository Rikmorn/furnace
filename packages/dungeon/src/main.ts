import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as gpu from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import * as physics from "@furnace/core/physics";
import * as post from "@furnace/core/post";
import { vec3, vec4 } from "@furnace/core/transform";
import { FpController } from "./fp-controller.ts";
import { buildGlows, buildLevel } from "./level.ts";
import { buildMotes } from "./motes.ts";
import { buildProps } from "./props.ts";
import { Torch } from "./torch.ts";

const PLAYER_CAPSULE_HALF_HEIGHT = 0.6;
const PLAYER_CAPSULE_RADIUS = 0.3;
const PLAYER_SPAWN: [number, number, number] = [0, 1.1, -2];

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

  const world = await physics.createWorld(ctx, {
    gravity: [0, -9.81, 0],
    lengthUnit: 1,
  });
  // Static colliders: one fixed cuboid per level box (size/2 = half-extents).
  for (const b of level.boxes) {
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2] },
      position: [b.center[0], b.center[1], b.center[2]],
    });
  }
  const props = await buildProps(ctx, world);

  const playerBody = physics.createBody(ctx, world, {
    type: "kinematicPosition",
    shape: {
      capsule: {
        halfHeight: PLAYER_CAPSULE_HALF_HEIGHT,
        radius: PLAYER_CAPSULE_RADIUS,
      },
    },
    position: PLAYER_SPAWN,
  });
  const controller = physics.createCharacterController(ctx, world, {
    offset: 0.01,
    up: [0, 1, 0],
    autostep: { maxHeight: 0.3, minWidth: 0.1 },
    snapToGround: 0.5,
    maxSlopeClimbAngle: 0.87,
    minSlopeSlideAngle: 0.7,
  });

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
  const player = new FpController();
  player.attachMouse(canvas);
  const torch = new Torch();
  let grounded = false;
  const moveOut = vec3.create();
  const bodyPos = vec3.create();

  const loopHandle = frame.loop(ctx, (info) => {
    const dt = info.deltaMs / 1000;

    player.consumeMouse();
    const desired = player.desiredMove(dt, grounded);
    grounded = physics.computeMovement(
      ctx,
      controller,
      playerBody,
      desired,
      moveOut,
    );
    physics.getBodyTranslation(ctx, playerBody, bodyPos);
    physics.setBodyNextKinematicTranslation(ctx, playerBody, [
      (bodyPos[0] as number) + (moveOut[0] as number),
      (bodyPos[1] as number) + (moveOut[1] as number),
      (bodyPos[2] as number) + (moveOut[2] as number),
    ]);
    physics.step(ctx, world, dt);

    physics.getBodyTranslation(ctx, playerBody, bodyPos);
    const playerPos: [number, number, number] = [
      bodyPos[0] as number,
      bodyPos[1] as number,
      bodyPos[2] as number,
    ];
    player.placeCamera(cam, playerPos);
    props.update();
    motes.update(playerPos, dt);

    const lights: frame.Light[] = [torch.light(playerPos, dt)];
    frame.render(ctx, {
      meshes: [
        ...level.meshes,
        ...glows.meshes,
        ...props.meshes,
        ...motes.meshes,
      ],
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
    props.destroy();
    physics.destroyCharacterController(ctx, controller);
    physics.destroyWorld(ctx, world);
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
