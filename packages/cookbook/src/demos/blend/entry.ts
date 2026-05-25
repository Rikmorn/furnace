import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Context } from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import type { Quat, Vec3 } from "@furnace/core/transform";
import { quat, vec3 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import type { Backdrop, Cull, DepthCompare } from "./state.svelte.ts";
import { state } from "./state.svelte.ts";

// Cookbook escape hatch. mountDemo has no imperative bus, so the controls
// callbacks reach the setup-scope rebuild via this global. Mirrors the
// pattern used by cookbook/geometry.
declare global {
  interface Window {
    __cookbookBlendRebuild?: () => Promise<void>;
  }
}

// --- Constants ---

const CAMERA_Z = 4.5;
const CLEAR_COLOR: [number, number, number, number] = [0.05, 0.05, 0.07, 1];

const CUBE_SIZE = 0.8;
const CUBE_COLOR: [number, number, number, number] = [0.4, 0.4, 0.45, 1];
const QUAD_SIZE = 1;
const X_SPREAD = 1.5;

const BACKDROP_Z = -1.5;
const BACKDROP_STRIP_WIDTH = 1.0;
const BACKDROP_STRIP_HEIGHT = 3.0;
const BACKDROP_SOLID_WIDTH = 6.0;
const BACKDROP_SOLID_HEIGHT = 4.0;

// R/G/B/Y/C/M for the strips backdrop.
const STRIP_COLORS: readonly [number, number, number, number][] = [
  [1, 0, 0, 1],
  [0, 1, 0, 1],
  [0, 0, 1, 1],
  [1, 1, 0, 1],
  [0, 1, 1, 1],
  [1, 0, 1, 1],
];
const STRIP_COUNT = STRIP_COLORS.length;
const STRIP_X_START = -((STRIP_COUNT - 1) * BACKDROP_STRIP_WIDTH) / 2;

// Translucent quads. PMA green's tint is pre-multiplied: green-at-alpha-0.5
// means we write 0.5 (not 1.0) for the green channel, because the blend
// equation expects src.rgb already multiplied by src.alpha.
const RED_TINT: [number, number, number, number] = [1, 0, 0, 0.5];
const GREEN_TINT_PREMULT: [number, number, number, number] = [0, 0.5, 0, 0.5];
const BLUE_TINT: [number, number, number, number] = [0, 0, 1, 0.5];

const RED_Z = 0.6;
const GREEN_Z = 0.5;
const BLUE_Z = -0.5;

const YAW_AUTOROTATE_RADIANS_PER_S = 0.6;
const MS_PER_S = 1000;

// --- Types ---

type TranslucentQuads = {
  red: Mesh;
  green: Mesh;
  blue: Mesh;
  redMat: Material;
  greenMat: Material;
  blueMat: Material;
};

type BackdropResources = {
  meshes: Mesh[];
  mats: Material[];
};

type SceneRef = {
  backdrop: BackdropResources;
  cube: Mesh;
  cubeMat: Material;
  quads: TranslucentQuads;
  cam: Camera;
  // Pre-allocated per-frame buffers (reused to avoid per-frame allocations).
  posRed: Vec3;
  posGreen: Vec3;
  posBlue: Vec3;
  rotBuf: Quat;
};

type AbortFlag = { disposed: boolean };
type RebuildQueue = { inFlight: boolean; pending: boolean };

// --- Backdrop construction ---

async function buildBackdrop(
  ctx: Context,
  mode: Backdrop,
  cull: Cull,
  depthCompare: DepthCompare,
): Promise<BackdropResources> {
  const mats: Material[] = [];
  const meshes: Mesh[] = [];
  try {
    if (mode === "strips") {
      for (let i = 0; i < STRIP_COUNT; i++) {
        const color = STRIP_COLORS[i];
        if (!color) continue;
        const mat = await material.unlit(ctx, {
          color,
          cullMode: cull,
          depthCompare,
        });
        mats.push(mat);
        const m = mesh.plane(ctx, {
          material: mat,
          size: BACKDROP_STRIP_WIDTH,
        });
        const scaleBuf = vec3.fromValues(
          1,
          BACKDROP_STRIP_HEIGHT / BACKDROP_STRIP_WIDTH,
          1,
        );
        mesh.setScale(m, scaleBuf);
        const pos = vec3.fromValues(
          STRIP_X_START + i * BACKDROP_STRIP_WIDTH,
          0,
          BACKDROP_Z,
        );
        mesh.setPosition(m, pos);
        meshes.push(m);
      }
    } else {
      const color: [number, number, number, number] =
        mode === "solid-black" ? [0, 0, 0, 1] : [1, 1, 1, 1];
      const mat = await material.unlit(ctx, {
        color,
        cullMode: cull,
        depthCompare,
      });
      mats.push(mat);
      const m = mesh.plane(ctx, { material: mat, size: BACKDROP_SOLID_WIDTH });
      const scaleBuf = vec3.fromValues(
        1,
        BACKDROP_SOLID_HEIGHT / BACKDROP_SOLID_WIDTH,
        1,
      );
      mesh.setScale(m, scaleBuf);
      const pos = vec3.fromValues(0, 0, BACKDROP_Z);
      mesh.setPosition(m, pos);
      meshes.push(m);
    }
    return { meshes, mats };
  } catch (e) {
    for (const m of meshes) mesh.destroy(m);
    for (const mt of mats) material.destroy(mt);
    throw e;
  }
}

function disposeBackdrop(b: BackdropResources): void {
  for (const m of b.meshes) mesh.destroy(m);
  for (const mt of b.mats) material.destroy(mt);
}

// --- Cube ---

async function buildCube(
  ctx: Context,
  cull: Cull,
  depthCompare: DepthCompare,
): Promise<{ cube: Mesh; mat: Material }> {
  // Cube always writes depth — it's the depth reference for translucents.
  const mat = await material.unlit(ctx, {
    color: CUBE_COLOR,
    cullMode: cull,
    depthCompare,
    depthWrite: true,
  });
  const cube = mesh.cube(ctx, { material: mat, size: CUBE_SIZE });
  return { cube, mat };
}

// --- Translucent quads ---

async function buildTranslucentQuad(
  ctx: Context,
  color: [number, number, number, number],
  blend: GPUBlendState | undefined,
  cull: Cull,
  depthWrite: boolean,
  depthCompare: DepthCompare,
): Promise<{ mesh: Mesh; mat: Material }> {
  const mat = await material.unlit(ctx, {
    color,
    blend,
    cullMode: cull,
    depthWrite,
    depthCompare,
  });
  const m = mesh.plane(ctx, { material: mat, size: QUAD_SIZE });
  return { mesh: m, mat };
}

async function buildTranslucentQuads(
  ctx: Context,
  cull: Cull,
  depthWrite: boolean,
  depthCompare: DepthCompare,
): Promise<TranslucentQuads> {
  let red: { mesh: Mesh; mat: Material } | undefined;
  let green: { mesh: Mesh; mat: Material } | undefined;
  try {
    red = await buildTranslucentQuad(
      ctx,
      RED_TINT,
      undefined,
      cull,
      depthWrite,
      depthCompare,
    );
    green = await buildTranslucentQuad(
      ctx,
      GREEN_TINT_PREMULT,
      material.PREMULTIPLIED_ALPHA_BLEND,
      cull,
      depthWrite,
      depthCompare,
    );
    const blue = await buildTranslucentQuad(
      ctx,
      BLUE_TINT,
      material.ADDITIVE_BLEND,
      cull,
      depthWrite,
      depthCompare,
    );
    return {
      red: red.mesh,
      green: green.mesh,
      blue: blue.mesh,
      redMat: red.mat,
      greenMat: green.mat,
      blueMat: blue.mat,
    };
  } catch (e) {
    if (green) {
      mesh.destroy(green.mesh);
      material.destroy(green.mat);
    }
    if (red) {
      mesh.destroy(red.mesh);
      material.destroy(red.mat);
    }
    throw e;
  }
}

function disposeTranslucentQuads(q: TranslucentQuads): void {
  mesh.destroy(q.red);
  mesh.destroy(q.green);
  mesh.destroy(q.blue);
  material.destroy(q.redMat);
  material.destroy(q.greenMat);
  material.destroy(q.blueMat);
}

// --- Full scene ---

async function buildScene(ctx: Context): Promise<SceneRef> {
  let backdrop: BackdropResources | undefined;
  let cubeRes: { cube: Mesh; mat: Material } | undefined;
  let quads: TranslucentQuads | undefined;
  try {
    backdrop = await buildBackdrop(
      ctx,
      state.backdrop,
      state.cull,
      state.depthCompare,
    );
    cubeRes = await buildCube(ctx, state.cull, state.depthCompare);
    quads = await buildTranslucentQuads(
      ctx,
      state.cull,
      state.depthWrite,
      state.depthCompare,
    );
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 0, CAMERA_Z),
    });
    return {
      backdrop,
      cube: cubeRes.cube,
      cubeMat: cubeRes.mat,
      quads,
      cam,
      posRed: vec3.create(),
      posGreen: vec3.create(),
      posBlue: vec3.create(),
      rotBuf: quat.create(),
    };
  } catch (e) {
    if (quads) disposeTranslucentQuads(quads);
    if (cubeRes) {
      mesh.destroy(cubeRes.cube);
      material.destroy(cubeRes.mat);
    }
    if (backdrop) disposeBackdrop(backdrop);
    throw e;
  }
}

function disposeScene(scene: SceneRef): void {
  disposeTranslucentQuads(scene.quads);
  mesh.destroy(scene.cube);
  material.destroy(scene.cubeMat);
  disposeBackdrop(scene.backdrop);
}

// --- Rebuild queue (single-in-flight + one-pending) ---

function makeRebuild(
  ctx: Context,
  sceneRef: SceneRef,
  abortFlag: AbortFlag,
): () => Promise<void> {
  const queue: RebuildQueue = { inFlight: false, pending: false };

  const rebuildOnce = async (): Promise<void> => {
    let nextBackdrop: BackdropResources | undefined;
    let nextCubeRes: { cube: Mesh; mat: Material } | undefined;
    let nextQuads: TranslucentQuads | undefined;
    try {
      nextBackdrop = await buildBackdrop(
        ctx,
        state.backdrop,
        state.cull,
        state.depthCompare,
      );
      nextCubeRes = await buildCube(ctx, state.cull, state.depthCompare);
      nextQuads = await buildTranslucentQuads(
        ctx,
        state.cull,
        state.depthWrite,
        state.depthCompare,
      );
      if (abortFlag.disposed) {
        disposeTranslucentQuads(nextQuads);
        mesh.destroy(nextCubeRes.cube);
        material.destroy(nextCubeRes.mat);
        disposeBackdrop(nextBackdrop);
        return;
      }
      // Swap-on-success: existing resources stay live until the replacements
      // are fully constructed; a failed rebuild leaves the running scene
      // untouched.
      const oldBackdrop = sceneRef.backdrop;
      const oldCube = sceneRef.cube;
      const oldCubeMat = sceneRef.cubeMat;
      const oldQuads = sceneRef.quads;
      sceneRef.backdrop = nextBackdrop;
      sceneRef.cube = nextCubeRes.cube;
      sceneRef.cubeMat = nextCubeRes.mat;
      sceneRef.quads = nextQuads;
      disposeTranslucentQuads(oldQuads);
      mesh.destroy(oldCube);
      material.destroy(oldCubeMat);
      disposeBackdrop(oldBackdrop);
    } catch (e) {
      if (nextQuads) disposeTranslucentQuads(nextQuads);
      if (nextCubeRes) {
        mesh.destroy(nextCubeRes.cube);
        material.destroy(nextCubeRes.mat);
      }
      if (nextBackdrop) disposeBackdrop(nextBackdrop);
      throw e;
    }
  };

  return async () => {
    if (queue.inFlight) {
      queue.pending = true;
      return;
    }
    queue.inFlight = true;
    try {
      do {
        queue.pending = false;
        await rebuildOnce();
        if (abortFlag.disposed) return;
      } while (queue.pending);
    } finally {
      queue.inFlight = false;
    }
  };
}

function triggerRebuild(): Promise<void> {
  const fn = window.__cookbookBlendRebuild;
  if (!fn) return Promise.resolve();
  return fn();
}

// --- Per-frame transform updates ---

function applyQuadTransforms(scene: SceneRef): void {
  const xRed = -X_SPREAD * state.spread;
  const xBlue = X_SPREAD * state.spread;
  vec3.set(scene.posRed, xRed, 0, RED_Z);
  vec3.set(scene.posGreen, 0, 0, GREEN_Z);
  vec3.set(scene.posBlue, xBlue, 0, BLUE_Z);
  mesh.setPosition(scene.quads.red, scene.posRed);
  mesh.setPosition(scene.quads.green, scene.posGreen);
  mesh.setPosition(scene.quads.blue, scene.posBlue);

  // Y-axis rotation. quat.fromYRotation isn't exported; fromEuler with
  // (0, yaw, 0) is the supported path.
  quat.fromEuler(scene.rotBuf, 0, state.yaw, 0);
  mesh.setRotation(scene.quads.red, scene.rotBuf);
  mesh.setRotation(scene.quads.green, scene.rotBuf);
  mesh.setRotation(scene.quads.blue, scene.rotBuf);
}

// --- Mount ---

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get cull() {
      return state.cull;
    },
    get depthWrite() {
      return state.depthWrite;
    },
    get depthCompare() {
      return state.depthCompare;
    },
    get backdrop() {
      return state.backdrop;
    },
    get spread() {
      return state.spread;
    },
    onCullChange: (v: Cull) => {
      state.cull = v;
      void triggerRebuild();
    },
    onDepthWriteChange: (v: boolean) => {
      state.depthWrite = v;
      void triggerRebuild();
    },
    onDepthCompareChange: (v: DepthCompare) => {
      state.depthCompare = v;
      void triggerRebuild();
    },
    onBackdropChange: (v: Backdrop) => {
      state.backdrop = v;
      void triggerRebuild();
    },
    onSpreadChange: (v: number) => {
      state.spread = v;
    },
  },
  setup: async (ctx) => {
    input.attach(ctx.canvas);
    try {
      const sceneRef = await buildScene(ctx);
      const abortFlag: AbortFlag = { disposed: false };
      window.__cookbookBlendRebuild = makeRebuild(ctx, sceneRef, abortFlag);

      let dragging = false;
      let lastDragX = 0;
      input.onPointerDown((e) => {
        if (e.button !== 0) return;
        dragging = true;
        lastDragX = e.x;
        state.autoRotate = false;
      });
      input.onPointerMove((e) => {
        if (!dragging) return;
        const dx = e.x - lastDragX;
        lastDragX = e.x;
        const pxToRad = Math.PI / ctx.canvas.width;
        state.yaw += dx * pxToRad;
      });
      input.onPointerUp((e) => {
        if (e.button !== 0) return;
        dragging = false;
      });
      input.onKeyDown((e) => {
        if (e.code === "Space") {
          state.autoRotate = !state.autoRotate;
        }
      });

      // The input module's KeyEvent doesn't expose the underlying DOM event, so
      // preventDefault must be wired separately. Without this, Space scrolls the
      // page. Register on globalThis to match input.attach's keyboard target.
      const preventSpaceScroll = (e: KeyboardEvent): void => {
        if (e.code === "Space") e.preventDefault();
      };
      globalThis.addEventListener("keydown", preventSpaceScroll);

      return {
        scene: sceneRef,
        dispose: () => {
          abortFlag.disposed = true;
          window.__cookbookBlendRebuild = undefined;
          globalThis.removeEventListener("keydown", preventSpaceScroll);
          disposeScene(sceneRef);
          input.detach();
        },
      };
    } catch (e) {
      input.detach();
      throw e;
    }
  },
  frame: ({ ctx, scene, info }) => {
    if (state.autoRotate) {
      state.yaw += YAW_AUTOROTATE_RADIANS_PER_S * (info.deltaMs / MS_PER_S);
    }
    applyQuadTransforms(scene);

    // Draw order: backdrop → cube (opaque, depth reference) → translucents in
    // fixed front-to-back submission order. With depthWrite=on, this exercises
    // the classic translucent-ordering bug; with depthWrite=off (default),
    // translucents blend correctly.
    const draw: Mesh[] = [
      ...scene.backdrop.meshes,
      scene.cube,
      scene.quads.red,
      scene.quads.green,
      scene.quads.blue,
    ];

    frame.render(ctx, {
      draw,
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
    });
  },
});
