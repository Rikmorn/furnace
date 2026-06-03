import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Geometry } from "@furnace/core/geometry";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import type { World } from "@furnace/core/physics";
import * as physics from "@furnace/core/physics";
import type { RigidMesh } from "@furnace/core/rigid-mesh";
import * as rigidMesh from "@furnace/core/rigid-mesh";
import * as shader from "@furnace/core/shader";
import type { Vec4 } from "@furnace/core/transform";
import { vec3, vec4 } from "@furnace/core/transform";

import type { SceneController, SceneFactory } from "../../shell/scene.ts";

const CLEAR_COLOR: Vec4 = vec4.fromValues(0.05, 0.06, 0.09, 1);
const FIXED_HZ = 60;
const FIXED_DT_MS = 1000 / FIXED_HZ;
const FIXED_DT_S = 1 / FIXED_HZ;
const MAX_CATCHUP_TICKS = 8;

const LANE_HALF: readonly [number, number, number] = [1, 0.1, 4];
const LANE_SCALE = vec3.fromValues(2, 0.2, 8); // unit cube → lane slab
const LANE_POS: readonly [number, number, number] = [0, -0.1, 0];

const BALL_RADIUS = 0.15;
const BALL_START: readonly [number, number, number] = [0, BALL_RADIUS, 3];
const BALL_VELOCITY: readonly [number, number, number] = [0, 0, -3.2];

const PIN_RADIUS = 0.06;
const PIN_HEIGHT = 0.32;
const PIN_BASE_Z = -3;
const PIN_SPACING = 0.26;

// Standard 10-pin triangle: rows of 1,2,3,4 receding down the lane (−Z).
function pinPositions(): Array<readonly [number, number, number]> {
  const out: Array<readonly [number, number, number]> = [];
  for (let row = 0; row < 4; row++) {
    const count = row + 1;
    const z = PIN_BASE_Z - row * PIN_SPACING;
    const x0 = -(count - 1) * 0.5 * PIN_SPACING;
    for (let i = 0; i < count; i++) {
      out.push([x0 + i * PIN_SPACING, PIN_HEIGHT / 2, z]);
    }
  }
  return out;
}

type BowlingState = {
  world: World;
  mat: Material;
  laneGeo: Geometry;
  ballGeo: Geometry;
  pinGeo: Geometry;
  lane: RigidMesh;
  ball: RigidMesh;
  pins: Mesh[];
  cam: Camera;
  unbindCamera: () => void;
  accumulatorMs: number;
};

function spawnBall(
  ctx: Context,
  world: World,
  ballGeo: Geometry,
  mat: Material,
): RigidMesh {
  return rigidMesh.create(ctx, world, {
    body: {
      type: "dynamic",
      shape: { ball: BALL_RADIUS },
      position: BALL_START,
      linearVelocity: BALL_VELOCITY,
    },
    mesh: { geometry: ballGeo, material: mat },
  });
}

export const bowlingScene: SceneFactory = {
  label: "Bowling",
  load: async (ctx: Context): Promise<SceneController> => {
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const mat = await material.create(ctx, {
      shader: await shader.normalColor(ctx),
    });
    const laneGeo = geometry.cube(ctx);
    const ballGeo = geometry.sphere(ctx, { radius: BALL_RADIUS });
    const pinGeo = geometry.cylinder(ctx, {
      radius: PIN_RADIUS,
      height: PIN_HEIGHT,
    });

    const lane = rigidMesh.create(ctx, world, {
      body: {
        type: "static",
        shape: { cuboid: LANE_HALF },
        position: LANE_POS,
      },
      mesh: { geometry: laneGeo, material: mat },
    });
    mesh.setScale(ctx, rigidMesh.getMesh(ctx, lane), LANE_SCALE);

    // Pins are RENDER-ONLY at Stage 3 (no collider until Stage 4 capsules).
    const pins = pinPositions().map(([x, y, z]) => {
      const m = mesh.create(ctx, { geometry: pinGeo, material: mat });
      mesh.setPosition(ctx, m, vec3.fromValues(x, y, z));
      return m;
    });

    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 1.6, 5),
    });
    camera.setTarget(cam, vec3.fromValues(0, 0.2, -1.5));
    const unbindCamera = camera.bindToCanvas(ctx, cam);

    const ball = spawnBall(ctx, world, ballGeo, mat);

    const state: BowlingState = {
      world,
      mat,
      laneGeo,
      ballGeo,
      pinGeo,
      lane,
      ball,
      pins,
      cam,
      unbindCamera,
      accumulatorMs: 0,
    };

    return {
      frame: (info) => {
        state.accumulatorMs += info.deltaMs;
        let ticks = 0;
        while (
          state.accumulatorMs >= FIXED_DT_MS &&
          ticks < MAX_CATCHUP_TICKS
        ) {
          physics.step(ctx, state.world, FIXED_DT_S);
          rigidMesh.commit(ctx, state.ball); // only the dynamic ball moves
          state.accumulatorMs -= FIXED_DT_MS;
          ticks++;
        }
        if (state.accumulatorMs >= FIXED_DT_MS) state.accumulatorMs = 0;
        const alpha = state.accumulatorMs / FIXED_DT_MS;
        rigidMesh.interpolate(ctx, state.ball, alpha);
        // The static lane was seeded to its pose at rigidMesh.create — draw as-is.

        const draw = [
          rigidMesh.getMesh(ctx, state.lane),
          rigidMesh.getMesh(ctx, state.ball),
          ...state.pins,
        ];
        frame.render(ctx, { draw, camera: state.cam, clearColor: CLEAR_COLOR });
      },
      unload: () => {
        state.unbindCamera();
        rigidMesh.destroy(ctx, state.ball);
        rigidMesh.destroy(ctx, state.lane);
        for (const m of state.pins) mesh.destroy(ctx, m);
        physics.destroyWorld(ctx, state.world); // cascades any remaining bodies
        geometry.destroy(ctx, state.ballGeo);
        geometry.destroy(ctx, state.pinGeo);
        geometry.destroy(ctx, state.laneGeo);
        material.destroy(ctx, state.mat);
      },
    };
  },
};
