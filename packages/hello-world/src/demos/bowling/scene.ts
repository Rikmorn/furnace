import type { Binding } from "@furnace/core/binding";
import * as binding from "@furnace/core/binding";
import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import type {
  Ambient,
  FixedClock,
  FrameLoopHandle,
  Light,
} from "@furnace/core/frame";
import * as frame from "@furnace/core/frame";
import type { Geometry } from "@furnace/core/geometry";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import * as gpu from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import type { World } from "@furnace/core/physics";
import * as physics from "@furnace/core/physics";
import type { Effect } from "@furnace/core/post";
import * as post from "@furnace/core/post";
import type { RigidMesh } from "@furnace/core/rigid-mesh";
import * as rigidMesh from "@furnace/core/rigid-mesh";
import * as shader from "@furnace/core/shader";
import type { Texture } from "@furnace/core/texture";
import * as texture from "@furnace/core/texture";
import type { Vec3, Vec4 } from "@furnace/core/transform";
import { quat, vec3, vec4 } from "@furnace/core/transform";

import { subscribeOverlay } from "../../overlay/state.svelte.ts";
import type { SceneController, SceneFactory } from "../../shell/scene.ts";
import { mountChargeMeter } from "./charge-meter-mount.ts";
import { chargeMeter } from "./charge-meter-state.svelte.ts";
import { mountDebugControls } from "./debug-controls-mount.ts";
import {
  debugControls,
  setOnMsaaChange,
} from "./debug-controls-state.svelte.ts";
import { DECAL_DATA_URL } from "./decal.ts";

const CLEAR_COLOR: Vec4 = vec4.fromValues(0.05, 0.06, 0.09, 1);
const FIXED_HZ = 60;
const FIXED_DT_MS = 1000 / FIXED_HZ;

// MSAA: sampleCount is frozen at requestContext, so toggling it requires a full
// ctx rebuild. Initial value is derived from the live debugControls.msaa state
// on scene entry — ensures checkbox and ctx agree without waiting for a toggle.
const SAMPLE_COUNT_MSAA = 4 as const;
const SAMPLE_COUNT_OFF = 1 as const;

// Bloom tuned to halo ONLY the emissive ball, not the lit lane. Lighting is now
// HDR-calibrated (multi-light Blinn-Phong, no 1/π): a white surface under one key
// light peaks ≈1.0, so the lit lane no longer overshoots 1.0 the way the old baked
// ~1.5× term did. The ball is an unlit vec4(4, 1.2, 1.2), so a soft-knee threshold
// just above the lit-content ceiling (≈1.0) and well below the ball (4.0) isolates
// it: at threshold 1.1 the lane contributes ~0 and the ball blooms. (Tune in the
// Safari gate.)
const BLOOM_INTENSITY = 0.6;
const BLOOM_THRESHOLD = 1.1;
const BLOOM_SOFTNESS = 0.5;

// Scene lighting (HDR-calibrated, no 1/π — a white surface under one key peaks
// ≈1.0; specular is additive and may exceed 1.0). Three positioned lights over
// the decimeter lane (z spans roughly [-4, 4]; pins at z≈-3, foul line at z=3):
//   - KEY: a warm directional raking down-lane from the player's upper-left —
//     the dominant form-defining light, held at the HDR ceiling (≈1.0).
//   - FILL: a cool point above/near the pins, kept BELOW the key so it only
//     lifts the shadow side rather than flattening the form.
//   - RAKE: a white spot from the foul-line end down the lane for specular streaks.
// Contrast-tuned: low ambient + fill < key gives the lit form punch without
// pushing lit content past the bloom threshold (1.1). Tune visually in the gate.
const KEY_DIR: readonly [number, number, number] = [-0.4, -0.8, -0.5];
const SCENE_LIGHTS: Light[] = [
  {
    type: "directional",
    direction: KEY_DIR,
    color: [1, 0.96, 0.9],
    intensity: 1.0,
  },
  {
    type: "point",
    position: [0, 1.2, -3],
    color: [0.6, 0.7, 1.0],
    intensity: 0.6,
    range: 6,
  },
  {
    type: "spot",
    position: [0, 1.5, 3],
    direction: [0, -0.6, -1],
    color: [1, 1, 1],
    intensity: 2.0,
    range: 10,
    innerAngle: 0.35,
    outerAngle: 0.6,
  },
];
const SCENE_AMBIENT: Ambient = {
  sky: [0.5, 0.55, 0.65],
  ground: [0.15, 0.14, 0.13],
  intensity: 0.03,
};

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

// Ball colour: UNLIT and >1.0 so it writes super-bright into the HDR target and
// the bloom prefilter extracts it as a glowing halo. A glowing red-hot ball
// (red dominant, milder green/blue so the core reads white but the bloom tints
// red). The aim line reuses this material — a matching glowing red indicator.
const BALL_COLOR: Vec4 = vec4.fromValues(4, 1.2, 1.2, 1);

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

// Everything a single ctx owns. A Build is recreated whole when MSAA toggles
// (sampleCount is frozen at requestContext). `dispose()` tears down the ctx and
// every resource bound to it — leaving the DOM chrome (charge meter + debug
// controls) untouched, since those are ctx-independent and persist across
// rebuilds.
type Build = {
  dispose: () => void;
};

type BowlingState = {
  world: World;
  // Lane: textured with two pre-built materials (AF on / off) sharing one texture.
  laneTex: Texture;
  laneMatAF: Material;
  laneMatNoAF: Material;
  // Pins: texture.load-decoded image decal.
  pinTex: Texture;
  pinMat: Material;
  // Ball: unlit super-bright colour + binding (aim-line reuses ballMat).
  ballMat: Material;
  ballBinding: Binding;
  laneGeo: Geometry;
  ballGeo: Geometry;
  pinGeo: Geometry;
  // Post chain: bloom then tonemap (HDR → LDR swap chain).
  bloom: Effect;
  tonemap: Effect;
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
};

// Build an unlit material with a single colour binding. The binding OWNS its
// buffer — material.destroy will NOT free it, so the caller must keep the
// binding and destroy it explicitly for a leak-free unload. Unlit so the >1.0
// colour passes straight through to the HDR target (lit would attenuate it).
async function createUnlitMaterial(
  ctx: Context,
  color: Vec4,
): Promise<{ mat: Material; binding: Binding }> {
  const s = await shader.unlit(ctx);
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

// One frame: read input edges, advance the fixed-step sim, render the meshes
// through the HDR post chain, then overlay the collider wireframe.
function renderFrame(
  ctx: Context,
  state: BowlingState,
  info: frame.FrameInfo,
): void {
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
      state.charge = Math.min(1, state.charge + CHARGE_RATE * info.deltaMs);
    }
    updateAimLine(ctx, state);
  }

  // Surface the live throw state to the charge-meter chrome. Svelte 5 $state
  // only re-renders on actual change, so writing every frame is fine.
  chargeMeter.charge = state.charge;
  chargeMeter.phase = state.phase;

  // Time-scaling (demo-side, zero engine surface): scale the delta fed to the
  // fixed clock. Paused → feed 0 (sim frozen, render continues); a pending step
  // while paused feeds exactly one tick's worth.
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
      physics.setBodyLinearVelocity(ctx, rigidMesh.getBody(ctx, state.ball), [
        dir[0] * speed,
        0,
        dir[2] * speed,
      ]);
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

  const meshes = [
    rigidMesh.getMesh(ctx, state.lane),
    rigidMesh.getMesh(ctx, state.ball),
    ...state.pins.map((pin) => rigidMesh.getMesh(ctx, pin)),
    ...(state.phase === "aiming" ? [state.aimLine] : []),
  ];
  // HDR scene → bloom (linear) → tonemap (LDR swap chain). The effects chain is
  // required every frame: under hdr, frame.render with zero effects throws (the
  // rgba16float scene target needs a pass to reach the LDR swap chain).
  frame.render(ctx, {
    meshes,
    camera: state.cam,
    clearColor: CLEAR_COLOR,
    lights: SCENE_LIGHTS,
    ambient: SCENE_AMBIENT,
    effects: [state.bloom, state.tonemap],
  });

  // Collider overlay draws directly onto the swap chain after the post chain's
  // final pass wrote the tonemapped image. NOTE (Safari gate): under MSAA the
  // drawLines pipeline is single-sample but the engine depth texture is 4×,
  // which is a sample-count mismatch — see the report. Functions cleanly with
  // MSAA off; flag for the gate.
  if (debugControls.showColliders) {
    const dl = physics.getDebugLines(ctx, state.world);
    frame.drawLines(ctx, {
      vertices: dl.vertices,
      colors: dl.colors,
      camera: state.cam,
    });
  }
}

// Build a complete bowling scene on a freshly-created ctx with the given MSAA
// sample count. Returns the ctx, the live state, and a dispose() that tears
// down EVERYTHING ctx-bound (loop, overlay sub, post effects, meshes, geometry,
// materials, textures, bindings, world) and disposes the ctx last. The DOM
// chrome is NOT created or destroyed here — it persists across rebuilds.
async function buildBowling(
  canvas: HTMLCanvasElement,
  sampleCount: 1 | 4,
): Promise<Build> {
  const ctx = await gpu.requestContext(canvas, { sampleCount, hdr: true });

  const world = await physics.createWorld(ctx, {
    gravity: GRAVITY,
    lengthUnit: LENGTH_UNIT,
  });

  // Ball: unlit super-bright colour + binding (the bloom source).
  const { mat: ballMat, binding: ballBinding } = await createUnlitMaterial(
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

  // HDR post chain: bloom in linear space, then tonemap to the LDR swap chain.
  const bloom = await post.bloom(ctx, {
    intensity: BLOOM_INTENSITY,
    threshold: BLOOM_THRESHOLD,
    softness: BLOOM_SOFTNESS,
  });
  const tonemap = await post.tonemap(ctx);

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
  // ball material (a glowing line that matches the bright ball) — no extra
  // material or binding to track, so unload stays leak-free for free.
  const aimLine = mesh.create(ctx, { geometry: laneGeo, material: ballMat });

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
    bloom,
    tonemap,
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
  };
  updateAimLine(ctx, state);

  const unsubOverlay = subscribeOverlay(ctx);
  const loop: FrameLoopHandle = frame.loop(ctx, (info) =>
    renderFrame(ctx, state, info),
  );

  const dispose = (): void => {
    loop.stop();
    unsubOverlay();
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
    // Post effects: each frees its owned @group(1) binding (leak-free per 2b-6).
    post.destroy(ctx, state.bloom);
    post.destroy(ctx, state.tonemap);
    // Destroy materials before textures (material holds a ref to the texture
    // view; mirrors the geometry-after-mesh discipline).
    // texturedLit materials carry no binding — no binding.destroy needed.
    material.destroy(ctx, state.laneMatAF);
    material.destroy(ctx, state.laneMatNoAF);
    material.destroy(ctx, state.pinMat);
    texture.destroy(ctx, state.laneTex);
    texture.destroy(ctx, state.pinTex);
    // Ball uses an unlit material with a colour binding — destroy both.
    material.destroy(ctx, state.ballMat);
    binding.destroy(ctx, state.ballBinding);
    // Dispose the ctx LAST — after all per-ctx resources are torn down.
    gpu.dispose(ctx);
  };

  return { dispose };
}

export const bowlingScene: SceneFactory = {
  label: "Bowling",
  load: async (canvas: HTMLCanvasElement): Promise<SceneController> => {
    let currentSampleCount: 1 | 4 = debugControls.msaa
      ? SAMPLE_COUNT_MSAA
      : SAMPLE_COUNT_OFF;
    let build = await buildBowling(canvas, currentSampleCount);

    // Chrome (charge meter + debug controls) is DOM, ctx-independent — mount it
    // ONCE here and keep it across MSAA rebuilds. A missing #ui-root is not
    // fatal: skip mounting and keep no-op unmounts.
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

    // Cancelled flag: set by unload() to signal that any in-flight rebuild must
    // dispose its result and bail — prevents a ctx + frame loop leak when the
    // user switches scenes while an async rebuild is suspended at buildBowling.
    let cancelled = false;

    // MSAA toggle → ctx rebuild. sampleCount is frozen at requestContext, so we
    // dispose the old build and build a fresh ctx + resources. Guard against
    // overlapping rebuilds (the async dispose+rebuild must not interleave); a
    // toggle arriving mid-rebuild only updates the desired target, and the
    // running rebuild reconciles against it on completion (self-healing, so the
    // checkbox and the live ctx never diverge after the dust settles).
    let rebuilding = false;
    const desiredSampleCount = (): 1 | 4 =>
      debugControls.msaa ? SAMPLE_COUNT_MSAA : SAMPLE_COUNT_OFF;
    const rebuild = async (): Promise<void> => {
      if (rebuilding) return;
      rebuilding = true;
      try {
        // Loop until the live ctx matches the desired toggle — a toggle that
        // arrived while a rebuild was in flight is picked up here.
        while (currentSampleCount !== desiredSampleCount()) {
          const next = desiredSampleCount();
          build.dispose();
          build = await buildBowling(canvas, next);
          // If unload() ran while we were awaiting, dispose the newly-created
          // build immediately and bail — it has no owner and would otherwise leak.
          if (cancelled) {
            build.dispose();
            return;
          }
          currentSampleCount = next;
        }
      } finally {
        rebuilding = false;
      }
    };
    setOnMsaaChange(() => {
      void rebuild();
    });

    return {
      unload: () => {
        cancelled = true;
        setOnMsaaChange(null);
        unmountMeter();
        unmountDebug();
        build.dispose();
      },
    };
  },
};
