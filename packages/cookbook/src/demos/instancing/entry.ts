import type { Binding } from "@furnace/core/binding";
import * as binding from "@furnace/core/binding";
import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Geometry } from "@furnace/core/geometry";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { InstancedMesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import * as shader from "@furnace/core/shader";
import type { Vec4 } from "@furnace/core/transform";
import { vec3, vec4 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import { state } from "./state.svelte.ts";

// Capacity is fixed at construction; the grid slider only moves the drawn
// prefix (setInstanceCount), so 16×16 covers every grid the slider allows.
const MAX_GRID = 16;
const INSTANCE_CAPACITY = MAX_GRID * MAX_GRID;

const SPACING = 1.5;
const BASE_SCALE = 0.5;
const SCALE_VARIATION = 0.3;
const HASH_OFFSET = 101.7; // decorrelate the scale hash from the rotation hash

const SATURATION = 0.85;
const MIN_VALUE = 0.45; // darkest cube (z = 0 row); ramps to 1.0 across +z

const SPIN_SPEED = 0.5; // rad/s base yaw
const TILT_AMPLITUDE = 0.6; // rad of per-instance X tilt
const ORBIT_SPEED = 0.12; // rad/s camera orbit

const CAMERA_MARGIN = 5;
const CAMERA_HEIGHT_BASE = 3.5;

const TWO_PI = Math.PI * 2;
const MS_PER_SEC = 1000;
const CLEAR_COLOR: Vec4 = vec4.fromValues(0.04, 0.04, 0.06, 1);

const scratchCamPos = vec3.create();
const origin = vec3.create();

type SceneRef = {
  geo: Geometry;
  bind: Binding;
  mat: Material;
  im: InstancedMesh;
  cam: Camera;
  lastGrid: number;
};

/** HSV→RGB (all in [0,1]); used to colour the grid as a 2D rainbow. */
function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

/** Deterministic per-instance pseudo-random value in [0,1). */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Unit quaternion (x,y,z,w) for an intrinsic X-tilt then Y-yaw (Z = 0). */
function tiltYawQuat(
  tilt: number,
  yaw: number,
): [number, number, number, number] {
  const hx = tilt * 0.5;
  const hy = yaw * 0.5;
  const sx = Math.sin(hx);
  const cx = Math.cos(hx);
  const sy = Math.sin(hy);
  const cy = Math.cos(hy);
  return [sx * cy, cx * sy, sx * sy, cx * cy];
}

/** Paint each instance's tint: a hue sweep across x, a brightness ramp across z. */
function applyTints(ctx: Context, im: InstancedMesh, grid: number): void {
  const denom = Math.max(grid - 1, 1);
  const total = grid * grid;
  for (let n = 0; n < total; n++) {
    const gx = n % grid;
    const gz = Math.floor(n / grid);
    const hue = gx / denom;
    const value = MIN_VALUE + (1 - MIN_VALUE) * (gz / denom);
    const [r, g, b] = hsv2rgb(hue, SATURATION, value);
    mesh.setInstanceTint(ctx, im, n, [r, g, b, 1]);
  }
}

/** Bake each instance's grid position + animated rotation + varied scale. */
function applyTransforms(
  ctx: Context,
  im: InstancedMesh,
  grid: number,
  timeSec: number,
): void {
  const center = (grid - 1) / 2;
  const total = grid * grid;
  for (let n = 0; n < total; n++) {
    const gx = n % grid;
    const gz = Math.floor(n / grid);
    const x = (gx - center) * SPACING;
    const z = (gz - center) * SPACING;
    const phase = hash(n) * TWO_PI;
    const yaw = timeSec * SPIN_SPEED + phase;
    const tilt = Math.sin(phase) * TILT_AMPLITUDE;
    const rotation = tiltYawQuat(tilt, yaw);
    const scale = BASE_SCALE + SCALE_VARIATION * hash(n + HASH_OFFSET);
    mesh.setInstanceTransform(ctx, im, n, [x, 0, z], rotation, scale);
  }
}

/** Orbit the camera so any grid size stays framed. */
function frameCamera(cam: Camera, grid: number, timeSec: number): void {
  const extent = (grid - 1) * SPACING;
  const radius = extent * 0.9 + CAMERA_MARGIN;
  const height = extent * 0.5 + CAMERA_HEIGHT_BASE;
  const angle = timeSec * ORBIT_SPEED;
  vec3.set(
    scratchCamPos,
    Math.sin(angle) * radius,
    height,
    Math.cos(angle) * radius,
  );
  camera.setPosition(cam, scratchCamPos);
  camera.setTarget(cam, origin);
}

async function buildScene(ctx: Context): Promise<SceneRef> {
  const geo = geometry.cube(ctx);
  const instancedShader = await shader.unlitInstanced(ctx);
  const bind = binding.create(ctx, instancedShader);
  // White base colour so the per-instance tint reads as the final colour.
  binding.set(ctx, bind, { color: vec4.fromValues(1, 1, 1, 1) });
  const mat = await material.create(ctx, {
    shader: instancedShader,
    binding: bind,
  });
  const im = mesh.createInstanced(ctx, {
    geometry: geo,
    material: mat,
    count: INSTANCE_CAPACITY,
  });

  const cam = camera.perspective({
    aspect: ctx.canvas.width / ctx.canvas.height,
    position: vec3.fromValues(0, CAMERA_HEIGHT_BASE, CAMERA_MARGIN),
  });
  camera.bindToCanvas(ctx, cam);

  const grid = state.grid;
  mesh.setInstanceCount(ctx, im, grid * grid);
  applyTints(ctx, im, grid);
  applyTransforms(ctx, im, grid, 0);

  return { geo, bind, mat, im, cam, lastGrid: grid };
}

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get grid() {
      return state.grid;
    },
    get spin() {
      return state.spin;
    },
    onGridChange: (v: number) => {
      state.grid = v;
    },
    onSpinChange: (v: boolean) => {
      state.spin = v;
    },
  },
  setup: async (ctx) => {
    const scene = await buildScene(ctx);
    return {
      scene,
      dispose: () => {
        // Instanced mesh first (decrements geo/material refcounts), then the
        // material, its binding, and the geometry. The built-in instanced
        // shader is engine-owned (destroy no-ops) — freed by the cascade.
        mesh.destroyInstanced(ctx, scene.im);
        material.destroy(ctx, scene.mat);
        binding.destroy(ctx, scene.bind);
        geometry.destroy(ctx, scene.geo);
      },
    };
  },
  frame: ({ ctx, scene, info }) => {
    const grid = state.grid;
    const timeSec = info.elapsedMs / MS_PER_SEC;

    if (grid !== scene.lastGrid) {
      scene.lastGrid = grid;
      mesh.setInstanceCount(ctx, scene.im, grid * grid);
      applyTints(ctx, scene.im, grid);
      applyTransforms(ctx, scene.im, grid, timeSec);
    } else if (state.spin) {
      applyTransforms(ctx, scene.im, grid, timeSec);
    }

    frameCamera(scene.cam, grid, timeSec);
    frame.render(ctx, {
      meshes: [],
      instanced: [scene.im],
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
    });
  },
});
