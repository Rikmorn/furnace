import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as gpu from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import * as physics from "@furnace/core/physics";
import * as post from "@furnace/core/post";
import { loadScene } from "@furnace/core/scene";
import { vec3, vec4 } from "@furnace/core/transform";
import { CharacterMover, shoveDynamicBodies } from "./char-move.ts";
import { FpController } from "./fp-controller.ts";
import { layoutWorld } from "./layout.ts";
import { buildGlows, buildLevel } from "./level.ts";
import { buildMotes } from "./motes.ts";
import { MaterialCache, realizeRegion } from "./realize.ts";
import { bakedCavernProxy } from "./themes/cave.ts";
import { Torch } from "./torch.ts";
import { type LoadedWing, loadGeneratedWing } from "./wing-loader.ts";
import { buildWorldGraph, WORLD_SEED } from "./world.ts";

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
  const baked = await loadScene(
    ctx,
    await (await fetch("/regions/region-cavern.scene.json")).json(),
    { world, fragment: true },
  );
  // Cavern renders from the baked .fmesh (render-only scene); collision is a
  // field-derived voxel proxy regenerated here (seed/origin match the bake).
  const cavernProxy = bakedCavernProxy("cavern-1", [0, 0, -24]);
  physics.createBody(ctx, world, {
    type: "static",
    shape: cavernProxy.proxy,
    position: cavernProxy.proxyPosition,
  });
  // The generated world. When a baked wing is present (the cockpit froze + baked one),
  // load it; otherwise fall back to live generation — a hand-written world GRAPH (authored
  // chamber pinned as a collision phantom + cave wing + two ground rooms), placed by the
  // collision-aware layout engine. The two paths produce the same runtime handle shape, so
  // both slot into `area` and the render/update/dispose below is path-agnostic.
  const matCache = new MaterialCache(ctx);
  const wing = await loadGeneratedWing(ctx, world, matCache);
  const area: LoadedWing[] = [];
  if (wing) {
    area.push(wing);
  } else {
    const { regions: worldRegions, connectors } = layoutWorld(
      buildWorldGraph(WORLD_SEED),
      WORLD_SEED,
    );
    // Realize SEQUENTIALLY (MaterialCache is not concurrency-safe — see its TSDoc). The
    // authored phantom is skipped: buildLevel above already realizes the authored level;
    // the phantom exists so the placer sees it as an obstacle.
    for (const r of [
      ...worldRegions.filter((r) => r.provenance.theme !== "authored"),
      ...connectors,
    ]) {
      area.push(await realizeRegion(ctx, world, matCache, r));
    }
  }
  const areaMeshes = area.flatMap((a) => a.meshes);
  // Scattered decoration (rocks/crystals/glows) as instanced draws — one per region
  // variant group. Drawn after the opaque region meshes; emissive groups glow through
  // the existing bloom→tonemap chain.
  const areaInstanced = area.flatMap((a) => a.instanced);

  const dynamicProps = area.flatMap((a) => a.dynamicProps);
  const shovable = new Set(dynamicProps.map((p) => p.body));

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
    for (const a of area) a.update();
    motes.update(playerPos, dt);

    const lights: frame.Light[] = [torch.light(playerPos, dt)];
    frame.render(ctx, {
      meshes: [
        ...level.meshes,
        ...baked.meshes,
        ...areaMeshes,
        ...glows.meshes,
        ...motes.meshes,
      ],
      instanced: areaInstanced,
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
    physics.destroyWorld(ctx, world);
    input.detach();
    unbindCamera();
    motes.destroy();
    glows.destroy();
    level.destroy();
    baked.destroy();
    // Order matters: each region's destroy() frees meshes/geometries that reference
    // matCache's materials, so it must run BEFORE matCache frees those materials.
    for (const a of area) a.destroy();
    matCache.destroy();
    post.destroy(ctx, bloom);
    post.destroy(ctx, tonemap);
    gpu.dispose(ctx); // LAST — warns on leaked resource-manager slots; a clean shutdown is the leak check.
  };
  window.addEventListener("beforeunload", dispose);
}

main().catch((e: unknown) => {
  document.body.innerText = `Error: ${e instanceof Error ? e.message : String(e)}`;
});
