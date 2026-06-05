import type { Binding } from "@furnace/core/binding";
import * as binding from "@furnace/core/binding";
import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import type { FixedClock } from "@furnace/core/frame";
import * as frame from "@furnace/core/frame";
import type { Geometry } from "@furnace/core/geometry";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import type { World } from "@furnace/core/physics";
import * as physics from "@furnace/core/physics";
import type { RigidMesh } from "@furnace/core/rigid-mesh";
import * as rigidMesh from "@furnace/core/rigid-mesh";
import * as shader from "@furnace/core/shader";
import type { Texture } from "@furnace/core/texture";
import * as texture from "@furnace/core/texture";
import type { Vec3, Vec4 } from "@furnace/core/transform";
import { quat, vec3, vec4 } from "@furnace/core/transform";

import type { SceneController, SceneFactory } from "../../shell/scene.ts";
import { mountChargeMeter } from "./charge-meter-mount.ts";
import { chargeMeter } from "./charge-meter-state.svelte.ts";
import { mountDebugControls } from "./debug-controls-mount.ts";
import { debugControls } from "./debug-controls-state.svelte.ts";
import { DECAL_DATA_URL } from "./decal.ts";

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

// Ball colour (lit material). Lane + pins use textured materials.
const BALL_COLOR: Vec4 = vec4.fromValues(0.6, 0.16, 0.16, 1);

// Throw tuning (deltaMs-scaled rates; tunable in the Safari gate).
// AIM_RATE / CHARGE_RATE are per-millisecond; MIN/MAX_SPEED are m/s applied
// at zero / full charge.
const AIM_RATE = 0.0015;
const CHARGE_RATE = 0.0012;
const MIN_SPEED = 2;
const MAX_SPEED = 6;

// Aim-line indicator: a unit cube scaled long-and-thin, hovering just above
// the lane at the foul line. Long axis is local +Z; heading rotates it about Y.
const AIM_LINE_SCALE: Vec3 = vec3.fromValues(0.02, 0.02, 1.5);
const AIM_LINE_Y = 0.02;

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
  // Lane: textured with two pre-built materials (AF on / off) sharing one texture.
  laneTex: Texture;
  laneMatAF: Material;
  laneMatNoAF: Material;
  // Pins: texture.load-decoded image decal.
  pinTex: Texture;
  pinMat: Material;
  // Ball: solid lit colour + binding (aim-line reuses ballMat).
  ballMat: Material;
  ballBinding: Binding;
  laneGeo: Geometry;
  ballGeo: Geometry;
  pinGeo: Geometry;
  lane: RigidMesh;
  ball: RigidMesh;
  pins: RigidMesh[];
  aimLine: Mesh;
  cam: Camera;
  unbindCamera: () => void;
  clock: FixedClock;
  phase: "aiming" | "rolling";
  aimHeading: number;
  charge: number;
  launchRequested: boolean;
  unmountMeter: () => void;
  unmountDebug: () => void;
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

// Heading → unit XZ direction. Down-lane (toward the pins) is −Z, so heading 0
// gives [0, 0, -1]. Positive heading (ArrowLeft) swings the aim to the player's/
// screen left (−X, with the camera at z=5 looking −Z and +Y up). The −sin X
// component matches the aim line's actual orientation (its long axis rotated by
// the same heading about +Y), so the launch direction and the aim indicator
// agree. [dirX, 0, dirZ] indexes [0]/[2] to match the launch-velocity
// construction below.
function headingToDir(heading: number): readonly [number, number, number] {
  return [-Math.sin(heading), 0, -Math.cos(heading)];
}

// Position the aim line at the foul line, rotate it about Y by the heading, and
// keep it scaled long-and-thin. Reuses the shared cube geometry; scale is
// per-mesh.
function updateAimLine(ctx: Context, state: BowlingState): void {
  mesh.setPosition(
    ctx,
    state.aimLine,
    vec3.fromValues(BALL_START[0], AIM_LINE_Y, BALL_START[2]),
  );
  const rot = quat.fromAxisAngle(
    quat.create(),
    vec3.fromValues(0, 1, 0),
    state.aimHeading,
  );
  mesh.setRotation(ctx, state.aimLine, rot);
  mesh.setScale(ctx, state.aimLine, AIM_LINE_SCALE);
}

// Re-rack: destroy the ball + pins, respawn them at rest, reset the throw
// state machine to aiming. Materials, geometries, and the static lane persist.
function reRack(ctx: Context, state: BowlingState): void {
  rigidMesh.destroy(ctx, state.ball);
  for (const pin of state.pins) rigidMesh.destroy(ctx, pin);
  state.ball = spawnBall(ctx, state.world, state.ballGeo, state.ballMat);
  state.pins = spawnPins(ctx, state.world, state.pinGeo, state.pinMat);
  state.phase = "aiming";
  state.charge = 0;
  state.aimHeading = 0;
  state.launchRequested = false;
}

export const bowlingScene: SceneFactory = {
  label: "Bowling",
  load: async (ctx: Context): Promise<SceneController> => {
    const world = await physics.createWorld(ctx, {
      gravity: GRAVITY,
      lengthUnit: LENGTH_UNIT,
    });

    // Ball: solid lit colour + binding.
    const { mat: ballMat, binding: ballBinding } = await createLitMaterial(
      ctx,
      BALL_COLOR,
    );

    // Lane: procedural checkerboard texture (512×512, 48 cells, mipmaps for AF).
    // Fine cells (48) so the far end of the lane is deep in minification, where
    // AF×16 vs trilinear actually diverge. The built-in texturedLit samples raw
    // UV (0..1 per face), so cell count is the only frequency knob here.
    // Two materials share the same texture — one with maxAnisotropy 16 (AF on),
    // one with maxAnisotropy 1 (AF off). The AF toggle swaps between them.
    const tlShader = await shader.texturedLit(ctx);
    const laneTex = await texture.create(ctx, {
      ...texture.checkerboard({ size: 512, cells: 48 }),
      mipmaps: true,
    });
    const laneMatAF = await material.create(ctx, {
      shader: tlShader,
      texture: { texture: laneTex, sampler: { maxAnisotropy: 16 } },
    });
    const laneMatNoAF = await material.create(ctx, {
      shader: tlShader,
      texture: { texture: laneTex, sampler: { maxAnisotropy: 1 } },
    });

    // Pins: image decoded via texture.load (exercises the full fetch+decode path).
    const pinTex = await texture.load(ctx, DECAL_DATA_URL);
    const pinMat = await material.create(ctx, {
      shader: tlShader,
      texture: { texture: pinTex },
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
        friction: LANE_FRICTION,
      },
      mesh: { geometry: laneGeo, material: laneMatAF },
    });
    mesh.setScale(ctx, rigidMesh.getMesh(ctx, lane), LANE_SCALE);

    const pins = spawnPins(ctx, world, pinGeo, pinMat);

    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 1.6, 5),
    });
    camera.setTarget(cam, vec3.fromValues(0, 0.2, -1.5));
    const unbindCamera = camera.bindToCanvas(ctx, cam);

    // Ball spawns at rest at the foul line; the player aims, charges, throws.
    const ball = spawnBall(ctx, world, ballGeo, ballMat);

    // Aim indicator reuses the lane's cube geometry (scale is per-mesh) and the
    // ball material (a red line that matches the ball) — no extra material or
    // binding to track, so unload stays leak-free for free.
    const aimLine = mesh.create(ctx, { geometry: laneGeo, material: ballMat });

    // Bowling-specific charge meter chrome. The meter is non-essential UI, so a
    // missing #ui-root is not fatal — skip mounting and keep a no-op unmount.
    const uiRoot = document.querySelector<HTMLElement>("#ui-root");
    const unmountMeter = uiRoot
      ? mountChargeMeter(uiRoot)
      : () => {
          /* intentional no-op */
        };

    const unmountDebug = uiRoot
      ? mountDebugControls(uiRoot)
      : () => {
          /* intentional no-op */
        };

    const state: BowlingState = {
      world,
      laneTex,
      laneMatAF,
      laneMatNoAF,
      pinTex,
      pinMat,
      ballMat,
      ballBinding,
      laneGeo,
      ballGeo,
      pinGeo,
      lane,
      ball,
      pins,
      aimLine,
      cam,
      unbindCamera,
      clock: frame.fixedClock({ fixedDtMs: FIXED_DT_MS }),
      phase: "aiming",
      aimHeading: 0,
      charge: 0,
      launchRequested: false,
      unmountMeter,
      unmountDebug,
    };
    updateAimLine(ctx, state);

    return {
      frame: (info) => {
        // Read edges once at the top of the frame and latch — frame.loop clears
        // edges after this callback, so the sim tick below consumes the latch.
        if (input.wasKeyReleased("Space") && state.phase === "aiming") {
          state.launchRequested = true;
        }
        if (input.wasKeyPressed("KeyR")) reRack(ctx, state);

        if (state.phase === "aiming") {
          if (input.isKeyDown("ArrowLeft")) {
            state.aimHeading += AIM_RATE * info.deltaMs;
          }
          if (input.isKeyDown("ArrowRight")) {
            state.aimHeading -= AIM_RATE * info.deltaMs;
          }
          if (input.isKeyDown("Space")) {
            state.charge = Math.min(
              1,
              state.charge + CHARGE_RATE * info.deltaMs,
            );
          }
          updateAimLine(ctx, state);
        }

        // Surface the live throw state to the charge-meter chrome. Svelte 5
        // $state only re-renders on actual change, so writing every frame is fine.
        chargeMeter.charge = state.charge;
        chargeMeter.phase = state.phase;

        // Time-scaling (demo-side, zero engine surface): scale the delta fed to
        // the fixed clock. Paused → feed 0 (sim frozen, render continues); a
        // pending step while paused feeds exactly one tick's worth.
        let simDeltaMs = debugControls.paused
          ? 0
          : info.deltaMs * debugControls.timeScale;
        if (debugControls.paused && debugControls.stepRequested) {
          simDeltaMs = state.clock.fixedDtMs;
          debugControls.stepRequested = false;
        }

        const alpha = state.clock.advance(simDeltaMs, (dt) => {
          if (state.launchRequested) {
            const speed = MIN_SPEED + state.charge * (MAX_SPEED - MIN_SPEED);
            const dir = headingToDir(state.aimHeading);
            physics.setBodyLinearVelocity(
              ctx,
              rigidMesh.getBody(ctx, state.ball),
              [dir[0] * speed, 0, dir[2] * speed],
            );
            state.launchRequested = false;
            state.phase = "rolling";
          }
          physics.step(ctx, state.world, dt);
          rigidMesh.commit(ctx, state.ball);
          for (const pin of state.pins) rigidMesh.commit(ctx, pin);
        });
        rigidMesh.interpolate(ctx, state.ball, alpha);
        for (const pin of state.pins) rigidMesh.interpolate(ctx, pin, alpha);
        // The static lane was seeded to its pose at rigidMesh.create — draw as-is.

        // AF toggle: swap the lane material each frame based on the debug toggle.
        // setMaterial is idempotent when the handle matches, so per-frame is fine.
        mesh.setMaterial(
          ctx,
          rigidMesh.getMesh(ctx, state.lane),
          debugControls.anisotropy ? state.laneMatAF : state.laneMatNoAF,
        );

        const draw = [
          rigidMesh.getMesh(ctx, state.lane),
          rigidMesh.getMesh(ctx, state.ball),
          ...state.pins.map((pin) => rigidMesh.getMesh(ctx, pin)),
          ...(state.phase === "aiming" ? [state.aimLine] : []),
        ];
        frame.render(ctx, { draw, camera: state.cam, clearColor: CLEAR_COLOR });

        if (debugControls.showColliders) {
          const dl = physics.getDebugLines(ctx, state.world);
          frame.drawLines(ctx, {
            vertices: dl.vertices,
            colors: dl.colors,
            camera: state.cam,
          });
        }
      },
      unload: () => {
        state.unmountMeter();
        state.unmountDebug();
        state.unbindCamera();
        // Aim line shares laneGeo + ballMat; destroy it before those so its
        // refcount decrements land before the geometry/material teardown.
        mesh.destroy(ctx, state.aimLine);
        rigidMesh.destroy(ctx, state.ball);
        rigidMesh.destroy(ctx, state.lane);
        for (const pin of state.pins) rigidMesh.destroy(ctx, pin);
        physics.destroyWorld(ctx, state.world); // cascades any remaining bodies
        geometry.destroy(ctx, state.ballGeo);
        geometry.destroy(ctx, state.pinGeo);
        geometry.destroy(ctx, state.laneGeo);
        // Destroy materials before textures (material holds a ref to the texture
        // view; mirrors the geometry-after-mesh discipline).
        // texturedLit materials carry no binding — no binding.destroy needed.
        material.destroy(ctx, state.laneMatAF);
        material.destroy(ctx, state.laneMatNoAF);
        material.destroy(ctx, state.pinMat);
        texture.destroy(ctx, state.laneTex);
        texture.destroy(ctx, state.pinTex);
        // Ball uses a lit material with a colour binding — destroy both.
        material.destroy(ctx, state.ballMat);
        binding.destroy(ctx, state.ballBinding);
      },
    };
  },
};
