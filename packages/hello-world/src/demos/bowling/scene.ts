import type { Binding } from "@furnace/core/binding";
import * as binding from "@furnace/core/binding";
import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import type { FixedClock } from "@furnace/core/frame";
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

import type { SceneController, SceneFactory } from "../../shell/scene.ts";

const CLEAR_COLOR: Vec4 = vec4.fromValues(0.05, 0.06, 0.09, 1);
const FIXED_HZ = 60;
const FIXED_DT_MS = 1000 / FIXED_HZ;

// Decimeter-scale scene: lengthUnit tells the solver the typical body size so
// a sub-meter sim stays stable (Task 3 verified 0.1 for this lane).
const LENGTH_UNIT = 0.1;
const GRAVITY: readonly [number, number, number] = [0, -9.81, 0];

const LANE_HALF: readonly [number, number, number] = [1, 0.1, 4];
const LANE_SCALE = vec3.fromValues(2, 0.2, 8); // unit cube → lane slab
const LANE_POS: readonly [number, number, number] = [0, -0.1, 0];
const LANE_FRICTION = 0.5;

const BALL_RADIUS = 0.15;
const BALL_START: readonly [number, number, number] = [0, BALL_RADIUS, 3];
const BALL_FRICTION = 0.3;
const BALL_LINEAR_DAMPING = 0.1;
const BALL_ANGULAR_DAMPING = 0.1;

const PIN_RADIUS = 0.06;
const PIN_HEIGHT = 0.32;
const PIN_BASE_Z = -3;
const PIN_SPACING = 0.26;
const PIN_FRICTION = 0.4;
const PIN_LINEAR_DAMPING = 0.15;
const PIN_ANGULAR_DAMPING = 0.4;

// Mid-tone colours, alpha 1. `lit` clips above ~1.6× brightness, so pins are
// off-white (not pure white) to keep the toppling shading gradient visible.
const PIN_COLOR: Vec4 = vec4.fromValues(0.72, 0.72, 0.74, 1);
const BALL_COLOR: Vec4 = vec4.fromValues(0.6, 0.16, 0.16, 1);
const LANE_COLOR: Vec4 = vec4.fromValues(0.32, 0.24, 0.16, 1);

// Standard 10-pin triangle: rows of 1,2,3,4 receding down the lane (−Z).
// Pins spawn with their base resting on the lane top (y = 0): centre at
// PIN_HEIGHT / 2.
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
  pinMat: Material;
  ballMat: Material;
  laneMat: Material;
  pinBinding: Binding;
  ballBinding: Binding;
  laneBinding: Binding;
  laneGeo: Geometry;
  ballGeo: Geometry;
  pinGeo: Geometry;
  lane: RigidMesh;
  ball: RigidMesh;
  pins: RigidMesh[];
  cam: Camera;
  unbindCamera: () => void;
  clock: FixedClock;
};

// Build a lit material with a single colour binding. The binding OWNS its
// buffer — material.destroy will NOT free it, so the caller must keep the
// binding and destroy it explicitly for a leak-free unload.
async function createLitMaterial(
  ctx: Context,
  color: Vec4,
): Promise<{ mat: Material; binding: Binding }> {
  const s = await shader.lit(ctx);
  const cb = binding.create(ctx, s);
  binding.set(ctx, cb, { color });
  const mat = await material.create(ctx, { shader: s, binding: cb });
  return { mat, binding: cb };
}

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
      friction: BALL_FRICTION,
      linearDamping: BALL_LINEAR_DAMPING,
      angularDamping: BALL_ANGULAR_DAMPING,
    },
    mesh: { geometry: ballGeo, material: mat },
  });
}

function spawnPins(
  ctx: Context,
  world: World,
  pinGeo: Geometry,
  mat: Material,
): RigidMesh[] {
  return pinPositions().map(([x, y, z]) =>
    rigidMesh.create(ctx, world, {
      body: {
        type: "dynamic",
        shape: { cylinder: { halfHeight: PIN_HEIGHT / 2, radius: PIN_RADIUS } },
        position: [x, y, z],
        friction: PIN_FRICTION,
        linearDamping: PIN_LINEAR_DAMPING,
        angularDamping: PIN_ANGULAR_DAMPING,
      },
      mesh: { geometry: pinGeo, material: mat },
    }),
  );
}

export const bowlingScene: SceneFactory = {
  label: "Bowling",
  load: async (ctx: Context): Promise<SceneController> => {
    const world = await physics.createWorld(ctx, {
      gravity: GRAVITY,
      lengthUnit: LENGTH_UNIT,
    });

    const { mat: pinMat, binding: pinBinding } = await createLitMaterial(
      ctx,
      PIN_COLOR,
    );
    const { mat: ballMat, binding: ballBinding } = await createLitMaterial(
      ctx,
      BALL_COLOR,
    );
    const { mat: laneMat, binding: laneBinding } = await createLitMaterial(
      ctx,
      LANE_COLOR,
    );

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
        friction: LANE_FRICTION,
      },
      mesh: { geometry: laneGeo, material: laneMat },
    });
    mesh.setScale(ctx, rigidMesh.getMesh(ctx, lane), LANE_SCALE);

    const pins = spawnPins(ctx, world, pinGeo, pinMat);

    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 1.6, 5),
    });
    camera.setTarget(cam, vec3.fromValues(0, 0.2, -1.5));
    const unbindCamera = camera.bindToCanvas(ctx, cam);

    // Ball spawns at rest at the foul line — the throw arrives in Task 12.
    const ball = spawnBall(ctx, world, ballGeo, ballMat);

    const state: BowlingState = {
      world,
      pinMat,
      ballMat,
      laneMat,
      pinBinding,
      ballBinding,
      laneBinding,
      laneGeo,
      ballGeo,
      pinGeo,
      lane,
      ball,
      pins,
      cam,
      unbindCamera,
      clock: frame.fixedClock({ fixedDtMs: FIXED_DT_MS }),
    };

    return {
      frame: (info) => {
        const alpha = state.clock.advance(info.deltaMs, (dt) => {
          physics.step(ctx, state.world, dt);
          rigidMesh.commit(ctx, state.ball);
          for (const pin of state.pins) rigidMesh.commit(ctx, pin);
        });
        rigidMesh.interpolate(ctx, state.ball, alpha);
        for (const pin of state.pins) rigidMesh.interpolate(ctx, pin, alpha);
        // The static lane was seeded to its pose at rigidMesh.create — draw as-is.

        const draw = [
          rigidMesh.getMesh(ctx, state.lane),
          rigidMesh.getMesh(ctx, state.ball),
          ...state.pins.map((pin) => rigidMesh.getMesh(ctx, pin)),
        ];
        frame.render(ctx, { draw, camera: state.cam, clearColor: CLEAR_COLOR });
      },
      unload: () => {
        state.unbindCamera();
        rigidMesh.destroy(ctx, state.ball);
        rigidMesh.destroy(ctx, state.lane);
        for (const pin of state.pins) rigidMesh.destroy(ctx, pin);
        physics.destroyWorld(ctx, state.world); // cascades any remaining bodies
        geometry.destroy(ctx, state.ballGeo);
        geometry.destroy(ctx, state.pinGeo);
        geometry.destroy(ctx, state.laneGeo);
        // material.destroy does NOT free the binding's buffer — free both.
        material.destroy(ctx, state.pinMat);
        material.destroy(ctx, state.ballMat);
        material.destroy(ctx, state.laneMat);
        binding.destroy(ctx, state.pinBinding);
        binding.destroy(ctx, state.ballBinding);
        binding.destroy(ctx, state.laneBinding);
      },
    };
  },
};
