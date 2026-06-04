import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Geometry } from "@furnace/core/geometry";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import type { World } from "@furnace/core/physics";
import * as physics from "@furnace/core/physics";
import type { RigidMesh } from "@furnace/core/rigid-mesh";
import * as rigidMesh from "@furnace/core/rigid-mesh";
import * as shader from "@furnace/core/shader";
import type { Vec4 } from "@furnace/core/transform";
import { vec3, vec4 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import { state } from "./state.svelte.ts";

const MS_PER_S = 1000;
const CLEAR_COLOR: Vec4 = vec4.fromValues(0.05, 0.05, 0.07, 1);
const DROP_HEIGHT = 5;
const CUBE_HALF = 0.5;

// physics.BodyDescriptor's tuple types (Vec3Tuple) aren't re-exported from the
// public surface, so the descriptor inputs are spelled as plain readonly triples.
type Tuple3 = readonly [number, number, number];

// Static ground: cuboid half-extents → spans 20×0.2×20. geometry.cube is a unit
// cube (size 1 → [-0.5, 0.5]), so the render mesh is scaled to match the collider.
const GROUND_HALF: Tuple3 = [10, 0.1, 10];
const GROUND_POS: Tuple3 = [0, -0.1, 0];
const GROUND_SCALE = vec3.fromValues(20, 0.2, 20);

const STARTS: Tuple3[] = [
  [-2, DROP_HEIGHT, 0],
  [0, DROP_HEIGHT + 0.5, 0],
  [2, DROP_HEIGHT, 0],
  [-1, DROP_HEIGHT + 1.5, 1],
  [1, DROP_HEIGHT + 1.5, -1],
];
const SPINS: Tuple3[] = [
  [2, 3, 0],
  [0, 4, 1],
  [-3, 2, 0],
  [1, 0, 3],
  [0, -3, 2],
];

function spawnCubes(
  ctx: Context,
  world: World,
  geo: Geometry,
  mat: Material,
): RigidMesh[] {
  return STARTS.map((position, i) =>
    rigidMesh.create(ctx, world, {
      body: {
        type: "dynamic",
        shape: { cuboid: [CUBE_HALF, CUBE_HALF, CUBE_HALF] },
        position,
        angularVelocity: SPINS[i],
      },
      mesh: { geometry: geo, material: mat },
    }),
  );
}

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get interpolate() {
      return state.interpolate;
    },
    get fixedHz() {
      return state.fixedHz;
    },
    onInterpolateChange: (v: boolean) => {
      state.interpolate = v;
    },
    onFixedHzChange: (v: number) => {
      state.fixedHz = v;
    },
    onReset: () => {
      state.resetNonce += 1;
    },
    get showColliders() {
      return state.showColliders;
    },
    onShowCollidersChange: (v: boolean) => {
      state.showColliders = v;
    },
  },
  setup: async (ctx) => {
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cubeGeo = geometry.cube(ctx);
    const mat = await material.create(ctx, {
      shader: await shader.normalColor(ctx),
    });

    const ground = rigidMesh.create(ctx, world, {
      body: {
        type: "static",
        shape: { cuboid: GROUND_HALF },
        position: GROUND_POS,
      },
      mesh: { geometry: cubeGeo, material: mat },
    });
    mesh.setScale(ctx, rigidMesh.getMesh(ctx, ground), GROUND_SCALE);

    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 4, 12),
    });
    camera.setTarget(cam, vec3.fromValues(0, 2, 0));
    camera.bindToCanvas(ctx, cam);

    const clock = frame.fixedClock({ fixedDtMs: MS_PER_S / state.fixedHz });

    return {
      scene: {
        world,
        cubeGeo,
        mat,
        ground,
        cam,
        cubes: spawnCubes(ctx, world, cubeGeo, mat),
        clock,
        lastNonce: state.resetNonce,
      },
    };
  },
  frame: ({ ctx, scene, info }) => {
    if (state.resetNonce !== scene.lastNonce) {
      for (const rm of scene.cubes) rigidMesh.destroy(ctx, rm);
      scene.cubes = spawnCubes(ctx, scene.world, scene.cubeGeo, scene.mat);
      scene.lastNonce = state.resetNonce;
    }

    // Fixed-step advance via frame.fixedClock — honor the live Hz slider.
    scene.clock.setFixedDtMs(MS_PER_S / state.fixedHz);
    const alpha = scene.clock.advance(info.deltaMs, (dt) => {
      physics.step(ctx, scene.world, dt);
      for (const rm of scene.cubes) rigidMesh.commit(ctx, rm);
    });

    // interpolate=on → alpha-blend prev→curr; off → pin to the latest tick (1).
    const displayAlpha = state.interpolate ? alpha : 1;
    for (const rm of scene.cubes) rigidMesh.interpolate(ctx, rm, displayAlpha);

    const draw = [
      rigidMesh.getMesh(ctx, scene.ground),
      ...scene.cubes.map((rm) => rigidMesh.getMesh(ctx, rm)),
    ];
    frame.render(ctx, { draw, camera: scene.cam, clearColor: CLEAR_COLOR });

    if (state.showColliders) {
      const dl = physics.getDebugLines(ctx, scene.world);
      frame.drawLines(ctx, {
        vertices: dl.vertices,
        colors: dl.colors,
        camera: scene.cam,
      });
    }
  },
});
