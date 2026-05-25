import type { Camera, ScreenProjection } from "@furnace/core/camera";
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
import type {
  Backdrop,
  Cull,
  DepthCompare,
  Primitive,
} from "./state.svelte.ts";
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

const REFERENCE_COLOR: [number, number, number, number] = [0.4, 0.4, 0.45, 1];
const REFERENCE_SIZE = 1.5;
const REFERENCE_Z = -1.0;

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

// Three translucent surfaces exercising the three canonical translucent blend
// modes: straight alpha (red), premultiplied alpha (green), additive (blue).
//
// PMA green's tint is pre-multiplied: green-at-alpha-0.5 means we write 0.5
// (not 1.0) for the green channel, because the blend equation expects src.rgb
// already multiplied by src.alpha. Compare with straight-alpha red: same shape
// of tint, but the blend mode applies the alpha-multiplication inside the
// equation, accumulating error under chained translucent overlays.
const RED_TINT: [number, number, number, number] = [1, 0, 0, 0.5];
const GREEN_TINT_PREMULT: [number, number, number, number] = [0, 0.5, 0, 0.5];
const BLUE_TINT: [number, number, number, number] = [0, 0, 1, 0.5];

const RED_Z = 0.6;
const GREEN_Z = 0.5;
const BLUE_Z = -0.5;

const YAW_AUTOROTATE_RADIANS_PER_S = 0.6;
const MS_PER_S = 1000;

// --- Types ---

type TranslucentSurfaces = {
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

type LabelKey = "red" | "green" | "blue";

type SceneRef = {
  backdrop: BackdropResources;
  reference: Mesh;
  referenceMat: Material;
  surfaces: TranslucentSurfaces;
  cam: Camera;
  // Pre-allocated per-frame buffers (reused to avoid per-frame allocations).
  posRed: Vec3;
  posGreen: Vec3;
  posBlue: Vec3;
  rotBuf: Quat;
  // Label positioning (also reused per-frame).
  labelAnchor: Vec3;
  labelProj: ScreenProjection;
  labelEls: { red: HTMLElement; green: HTMLElement; blue: HTMLElement };
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

// --- Reference plane ---

async function buildReference(
  ctx: Context,
  cull: Cull,
  depthCompare: DepthCompare,
): Promise<{ refMesh: Mesh; mat: Material }> {
  // Reference is always an opaque plane (cube was redundant since the camera
  // is head-on; you'd only ever see one face). It always writes depth — it's
  // the depth reference for translucents in front of it.
  const mat = await material.unlit(ctx, {
    color: REFERENCE_COLOR,
    cullMode: cull,
    depthCompare,
    depthWrite: true,
  });
  const refMesh = mesh.plane(ctx, { material: mat, size: REFERENCE_SIZE });
  // Place the reference behind the translucent surfaces and in front of the
  // backdrop. Z = -1.0 sits between BLUE_Z (-0.5) and BACKDROP_Z (-1.5).
  const pos = vec3.fromValues(0, 0, REFERENCE_Z);
  mesh.setPosition(refMesh, pos);
  return { refMesh, mat };
}

// --- Translucent surfaces ---

async function buildTranslucentSurface(
  ctx: Context,
  color: [number, number, number, number],
  blend: GPUBlendState | undefined,
  cull: Cull,
  depthWrite: boolean,
  depthCompare: DepthCompare,
  primitive: Primitive,
): Promise<{ mesh: Mesh; mat: Material }> {
  const mat = await material.unlit(ctx, {
    color,
    blend,
    cullMode: cull,
    depthWrite,
    depthCompare,
  });
  const m =
    primitive === "cube"
      ? mesh.cube(ctx, { material: mat, size: QUAD_SIZE })
      : mesh.plane(ctx, { material: mat, size: QUAD_SIZE });
  return { mesh: m, mat };
}

async function buildTranslucentSurfaces(
  ctx: Context,
  cull: Cull,
  depthWrite: boolean,
  depthCompare: DepthCompare,
  primitive: Primitive,
): Promise<TranslucentSurfaces> {
  let red: { mesh: Mesh; mat: Material } | undefined;
  let green: { mesh: Mesh; mat: Material } | undefined;
  try {
    red = await buildTranslucentSurface(
      ctx,
      RED_TINT,
      material.STRAIGHT_ALPHA_BLEND,
      cull,
      depthWrite,
      depthCompare,
      primitive,
    );
    green = await buildTranslucentSurface(
      ctx,
      GREEN_TINT_PREMULT,
      material.PREMULTIPLIED_ALPHA_BLEND,
      cull,
      depthWrite,
      depthCompare,
      primitive,
    );
    const blue = await buildTranslucentSurface(
      ctx,
      BLUE_TINT,
      material.ADDITIVE_BLEND,
      cull,
      depthWrite,
      depthCompare,
      primitive,
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

function disposeTranslucentSurfaces(s: TranslucentSurfaces): void {
  mesh.destroy(s.red);
  mesh.destroy(s.green);
  mesh.destroy(s.blue);
  material.destroy(s.redMat);
  material.destroy(s.greenMat);
  material.destroy(s.blueMat);
}

// --- Label helpers ---

function requireLabel(key: LabelKey): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `#labels .surface-label[data-surface="${key}"]`,
  );
  if (!el) {
    throw new Error(
      `[furnace/cookbook] blend: label[data-surface=${key}] not found`,
    );
  }
  return el;
}

function positionLabel(
  scene: SceneRef,
  cam: Camera,
  surfacePos: Vec3,
  vpW: number,
  vpH: number,
  labelEl: HTMLElement,
): void {
  vec3.set(
    scene.labelAnchor,
    surfacePos[0] as number,
    (surfacePos[1] as number) + 0.7,
    surfacePos[2] as number,
  );
  const visible = camera.projectToScreen(
    scene.labelProj,
    cam,
    scene.labelAnchor,
    vpW,
    vpH,
  );
  if (visible) {
    labelEl.style.transform = `translate(${scene.labelProj.x}px, ${scene.labelProj.y}px) translate(-50%, -50%)`;
    labelEl.style.display = "";
  } else {
    labelEl.style.display = "none";
  }
}

// --- Full scene ---

async function buildScene(ctx: Context): Promise<SceneRef> {
  let backdrop: BackdropResources | undefined;
  let refRes: { refMesh: Mesh; mat: Material } | undefined;
  let surfaces: TranslucentSurfaces | undefined;
  try {
    backdrop = await buildBackdrop(
      ctx,
      state.backdrop,
      state.cull,
      state.depthCompare,
    );
    refRes = await buildReference(ctx, state.cull, state.depthCompare);
    surfaces = await buildTranslucentSurfaces(
      ctx,
      state.cull,
      state.depthWrite,
      state.depthCompare,
      state.primitive,
    );
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 0, CAMERA_Z),
    });
    return {
      backdrop,
      reference: refRes.refMesh,
      referenceMat: refRes.mat,
      surfaces,
      cam,
      posRed: vec3.create(),
      posGreen: vec3.create(),
      posBlue: vec3.create(),
      rotBuf: quat.create(),
      labelAnchor: vec3.create(),
      labelProj: { x: 0, y: 0, w: 1 },
      labelEls: {
        red: requireLabel("red"),
        green: requireLabel("green"),
        blue: requireLabel("blue"),
      },
    };
  } catch (e) {
    if (surfaces) disposeTranslucentSurfaces(surfaces);
    if (refRes) {
      mesh.destroy(refRes.refMesh);
      material.destroy(refRes.mat);
    }
    if (backdrop) disposeBackdrop(backdrop);
    throw e;
  }
}

function disposeScene(scene: SceneRef): void {
  disposeTranslucentSurfaces(scene.surfaces);
  mesh.destroy(scene.reference);
  material.destroy(scene.referenceMat);
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
    let nextRefRes: { refMesh: Mesh; mat: Material } | undefined;
    let nextSurfaces: TranslucentSurfaces | undefined;
    try {
      nextBackdrop = await buildBackdrop(
        ctx,
        state.backdrop,
        state.cull,
        state.depthCompare,
      );
      nextRefRes = await buildReference(ctx, state.cull, state.depthCompare);
      nextSurfaces = await buildTranslucentSurfaces(
        ctx,
        state.cull,
        state.depthWrite,
        state.depthCompare,
        state.primitive,
      );
      if (abortFlag.disposed) {
        disposeTranslucentSurfaces(nextSurfaces);
        mesh.destroy(nextRefRes.refMesh);
        material.destroy(nextRefRes.mat);
        disposeBackdrop(nextBackdrop);
        return;
      }
      // Swap-on-success: existing resources stay live until the replacements
      // are fully constructed; a failed rebuild leaves the running scene
      // untouched.
      const oldBackdrop = sceneRef.backdrop;
      const oldReference = sceneRef.reference;
      const oldReferenceMat = sceneRef.referenceMat;
      const oldSurfaces = sceneRef.surfaces;
      sceneRef.backdrop = nextBackdrop;
      sceneRef.reference = nextRefRes.refMesh;
      sceneRef.referenceMat = nextRefRes.mat;
      sceneRef.surfaces = nextSurfaces;
      disposeTranslucentSurfaces(oldSurfaces);
      mesh.destroy(oldReference);
      material.destroy(oldReferenceMat);
      disposeBackdrop(oldBackdrop);
    } catch (e) {
      if (nextSurfaces) disposeTranslucentSurfaces(nextSurfaces);
      if (nextRefRes) {
        mesh.destroy(nextRefRes.refMesh);
        material.destroy(nextRefRes.mat);
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
  mesh.setPosition(scene.surfaces.red, scene.posRed);
  mesh.setPosition(scene.surfaces.green, scene.posGreen);
  mesh.setPosition(scene.surfaces.blue, scene.posBlue);

  // Y-axis rotation. quat.fromYRotation isn't exported; fromEuler with
  // (0, yaw, 0) is the supported path.
  quat.fromEuler(scene.rotBuf, 0, state.yaw, 0);
  mesh.setRotation(scene.surfaces.red, scene.rotBuf);
  mesh.setRotation(scene.surfaces.green, scene.rotBuf);
  mesh.setRotation(scene.surfaces.blue, scene.rotBuf);
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
    get primitive() {
      return state.primitive;
    },
    get showReference() {
      return state.showReference;
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
    onPrimitiveChange: (v: Primitive) => {
      state.primitive = v;
      void triggerRebuild();
    },
    onShowReferenceChange: (v: boolean) => {
      state.showReference = v;
      // No rebuild — showReference only changes draw-list inclusion at frame time.
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

    const vpW = ctx.canvas.clientWidth;
    const vpH = ctx.canvas.clientHeight;
    positionLabel(scene, scene.cam, scene.posRed, vpW, vpH, scene.labelEls.red);
    positionLabel(
      scene,
      scene.cam,
      scene.posGreen,
      vpW,
      vpH,
      scene.labelEls.green,
    );
    positionLabel(
      scene,
      scene.cam,
      scene.posBlue,
      vpW,
      vpH,
      scene.labelEls.blue,
    );

    // Draw order: backdrop → reference (if shown, opaque, writes depth) →
    // translucents in fixed front-to-back submission order (which is the WRONG
    // order — intentional to exercise the depthWrite=on ordering bug).
    const draw: Mesh[] = [...scene.backdrop.meshes];
    if (state.showReference) draw.push(scene.reference);
    draw.push(scene.surfaces.red, scene.surfaces.green, scene.surfaces.blue);

    frame.render(ctx, {
      draw,
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
    });
  },
});
