import * as binding from "@furnace/core/binding";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as geometry from "@furnace/core/geometry";
import * as gpu from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import * as physics from "@furnace/core/physics";
import * as post from "@furnace/core/post";
import { loadScene } from "@furnace/core/scene";
import * as shader from "@furnace/core/shader";
import { vec3, vec4 } from "@furnace/core/transform";
import { CharacterMover, shoveDynamicBodies } from "./char-move.ts";
import { FpController } from "./fp-controller.ts";
import { generateRegion, type RegionParams } from "./generator.ts";
import { buildGlows, buildLevel } from "./level.ts";
import { buildMotes } from "./motes.ts";
import { buildProps } from "./props.ts";
import { Torch } from "./torch.ts";

const PLAYER_CAPSULE_HALF_HEIGHT = 0.6;
const PLAYER_CAPSULE_RADIUS = 0.3;
const PLAYER_SPAWN: [number, number, number] = [0, 1.1, -2];
const NOCLIP_FLY_SPEED = 6; // m/s vertical fly rate in noclip (dev tool)
const SHOVE_SPEED = 3; // m/s push imparted to dynamic props
const SHOVE_REACH = 0.6; // forward distance to detect a shovable prop

const FOG_COLOR: [number, number, number] = [0.015, 0.02, 0.03];
// Clear color matches the fog so the void at depth reads as fog, not a hard edge.
const CLEAR_COLOR = vec4.fromValues(
  FOG_COLOR[0],
  FOG_COLOR[1],
  FOG_COLOR[2],
  1,
);

/** Build one generated region: a lit-stone mesh seated at the region origin, plus
 *  a static field-derived voxel collider added to `world`. The collider body is
 *  freed by `physics.destroyWorld`; `destroy()` only frees the GPU mesh + geometry. */
function addRegion(
  ctx: gpu.Context,
  world: physics.World,
  stone: material.Material,
  params: RegionParams,
): { mesh: mesh.Mesh; destroy: () => void } {
  const region = generateRegion(params);
  const [ox, oy, oz] = region.origin;
  const geo = geometry.create(ctx, region.mesh);
  const m = mesh.create(ctx, { geometry: geo, material: stone });
  mesh.setPosition(ctx, m, vec3.fromValues(ox, oy, oz));
  physics.createBody(ctx, world, {
    type: "static",
    shape: region.proxy,
    position: region.proxyPosition,
  });
  return {
    mesh: m,
    destroy: () => {
      mesh.destroy(ctx, m);
      geometry.destroy(ctx, geo);
    },
  };
}

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
  // Shared stone material for all generated regions (same matte-stone params as
  // level.ts). Built here so Task 8's shaft + chamber can reuse it without
  // duplicating the shader/binding allocation.
  const regionLit = await shader.lit(ctx);
  const regionBind = binding.create(ctx, regionLit);
  binding.set(ctx, regionBind, {
    color: [0.5, 0.5, 0.52, 1],
    specular: [0.02, 0.02, 0.02, 8],
  });
  const regionStone = await material.create(ctx, {
    shader: regionLit,
    binding: regionBind,
  });

  const baked = await loadScene(
    ctx,
    await (await fetch("/regions/region-cavern.scene.json")).json(),
    { world, fragment: true },
  );
  const shaft = addRegion(ctx, world, regionStone, {
    seed: "shaft-1",
    kind: "shaft",
    origin: [13, 0, -6],
  });
  const chamber = addRegion(ctx, world, regionStone, {
    seed: "chamber-1",
    kind: "chamber",
    origin: [0, 0, -19],
  });

  const props = await buildProps(ctx, world);
  const shovable = new Set(props.bodies);

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
  const mover = new CharacterMover(
    { halfHeight: PLAYER_CAPSULE_HALF_HEIGHT, radius: PLAYER_CAPSULE_RADIUS },
    playerBody,
  );
  let noclip = false; // V toggles fly/noclip (dev tool)

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
  const bodyPos = vec3.create();

  const loopHandle = frame.loop(ctx, (info) => {
    const dt = info.deltaMs / 1000;

    player.consumeMouse();
    if (input.wasKeyPressed("KeyV")) noclip = !noclip;

    physics.getBodyTranslation(ctx, playerBody, bodyPos);
    const here: [number, number, number] = [
      bodyPos[0] as number,
      bodyPos[1] as number,
      bodyPos[2] as number,
    ];

    let next: [number, number, number];
    if (noclip) {
      // Noclip: free-fly. WASD moves horizontally (no collision); Space/Shift = up/down.
      const h = player.desiredHorizontal(dt);
      const flySpeed = NOCLIP_FLY_SPEED * dt;
      const lift =
        (input.isKeyDown("Space") ? flySpeed : 0) -
        (input.isKeyDown("ShiftLeft") ? flySpeed : 0);
      next = [here[0] + h[0], here[1] + lift, here[2] + h[2]];
    } else {
      next = mover.resolve(
        ctx,
        world,
        here,
        player.desiredHorizontal(dt),
        dt,
      ).pos;
    }
    physics.setBodyNextKinematicTranslation(ctx, playerBody, next);
    if (!noclip) {
      shoveDynamicBodies(
        ctx,
        world,
        {
          halfHeight: PLAYER_CAPSULE_HALF_HEIGHT,
          radius: PLAYER_CAPSULE_RADIUS,
        },
        playerBody,
        next,
        player.desiredHorizontal(dt),
        shovable,
        SHOVE_SPEED,
        SHOVE_REACH,
      );
    }
    physics.step(ctx, world, dt);

    physics.getBodyTranslation(ctx, playerBody, bodyPos);
    const playerPos: [number, number, number] = [
      bodyPos[0] as number,
      bodyPos[1] as number,
      bodyPos[2] as number,
    ];
    player.placeCamera(cam, playerPos, dt);
    props.update();
    motes.update(playerPos, dt);

    const lights: frame.Light[] = [torch.light(playerPos, dt)];
    frame.render(ctx, {
      meshes: [
        ...level.meshes,
        ...baked.meshes,
        shaft.mesh,
        chamber.mesh,
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
    physics.destroyWorld(ctx, world);
    input.detach();
    unbindCamera();
    motes.destroy();
    glows.destroy();
    level.destroy();
    baked.destroy();
    shaft.destroy();
    chamber.destroy();
    material.destroy(ctx, regionStone);
    binding.destroy(ctx, regionBind);
    post.destroy(ctx, bloom);
    post.destroy(ctx, tonemap);
    gpu.dispose(ctx); // LAST — warns on leaked resource-manager slots; a clean shutdown is the leak check.
  };
  window.addEventListener("beforeunload", dispose);
}

main().catch((e: unknown) => {
  document.body.innerText = `Error: ${e instanceof Error ? e.message : String(e)}`;
});
