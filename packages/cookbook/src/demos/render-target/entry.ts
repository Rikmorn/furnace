import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import * as shader from "@furnace/core/shader";
import type { Quat, Vec3, Vec4 } from "@furnace/core/transform";
import { quat, vec3, vec4 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import type { PipAngle, PipResolution } from "./state.svelte.ts";
import { state } from "./state.svelte.ts";

// Cookbook escape hatch: controls callbacks reach the setup-scope rebuild via
// this global. Mirrors the pattern used by cookbook/blend and cookbook/geometry.
declare global {
  interface Window {
    __cookbookRenderTargetRebuild?: () => Promise<void>;
  }
}

// --- Constants ---

const SUBJECT_ROTATION_SPEED_RAD_PER_S = 0.5;
const MS_PER_S = 1000;

const ROOM_SIZE = 4;
const ROOM_COLOR: Vec4 = vec4.fromValues(0.08, 0.08, 0.1, 1);
const SUBJECT_SIZE = 0.8;

const MAIN_CAMERA_RADIUS = 2.5;
const MAIN_CAMERA_Y = 0.5;
const PIP_CAMERA_FOV_Y_RAD = Math.PI / 3;

const MONITOR_SIZE = 1.0;
const MONITOR_POSITION: readonly [number, number, number] = [0.85, 0.25, -1.99];

const CLEAR_MAIN: Vec4 = vec4.fromValues(0, 0, 0, 1);
const CLEAR_PIP: Vec4 = vec4.fromValues(0.06, 0.07, 0.08, 1);

// PiP camera position per angle preset. All three are inside the ROOM_SIZE=4
// cube (extents +/- 2), so the room serves as the PiP backdrop at every preset.
// Overhead's small x/z offset avoids the lookAt-singularity when the view
// direction would align with the world up vector.
const PIP_POSITIONS: Record<PipAngle, readonly [number, number, number]> = {
  overhead: [0.1, 1.7, 0.1],
  side: [1.7, 0.2, 0],
  front: [0, 0.2, 1.7],
};

const GIZMO_SIZE = 0.25;
const GIZMO_COLOR: Vec4 = vec4.fromValues(1.0, 0.65, 0.2, 1);

// --- Monitor shader ---

const MONITOR_SHADER = /* wgsl */ `
struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;
@group(1) @binding(0) var monTex: texture_2d<f32>;
@group(1) @binding(1) var monSamp: sampler;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};
struct VsOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex fn vs_main(v: VsIn) -> VsOut {
  var out: VsOut;
  out.clip_pos = camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
  out.uv = v.uv;
  return out;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  return textureSample(monTex, monSamp, in.uv);
}
`;

// --- Gizmo geometry ---

function gizmoQuadGeometryData(size: number): {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
} {
  const s = size / 2;
  // 4 corners (CCW when looking down -Z at the +Z face)
  const c00 = [-s, -s, 0] as const;
  const c10 = [s, -s, 0] as const;
  const c11 = [s, s, 0] as const;
  const c01 = [-s, s, 0] as const;
  // 4 edges as line-list pairs: bottom, right, top, left
  const positions = new Float32Array([
    ...c00,
    ...c10,
    ...c10,
    ...c11,
    ...c11,
    ...c01,
    ...c01,
    ...c00,
  ]);
  // Normals + UVs are dummies — the unlit shader ignores them, but the engine's
  // fixed vertex layout still requires one entry per position.
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < normals.length; i += 3) {
    normals[i] = 0;
    normals[i + 1] = 0;
    normals[i + 2] = 1;
  }
  const uvs = new Float32Array((positions.length / 3) * 2);
  return { positions, normals, uvs };
}

// --- Types ---

type PipResources = {
  texture: GPUTexture;
  depthTexture: GPUTexture;
  monitorMat: Material;
};

type SceneRef = {
  subjectMesh: Mesh;
  roomMesh: Mesh;
  subjectMeshNoDepth: Mesh;
  roomMeshNoDepth: Mesh;
  monitorMesh: Mesh;
  pip: PipResources;
  mainCam: Camera;
  pipCam: Camera;
  sampler: GPUSampler;
  rotBuf: Quat;
  scratchPos: Vec3;
  gizmoMesh: Mesh;
  gizmoRot: Quat;
  gizmoDir: Vec3;
  gizmoAxis: Vec3;
};

type AbortFlag = { disposed: boolean };
type RebuildQueue = { inFlight: boolean; pending: boolean };

// --- Resource construction ---

async function buildPipResources(
  ctx: Context,
  resolution: PipResolution,
  sampler: GPUSampler,
): Promise<PipResources> {
  const size = Number(resolution);
  const texture = ctx.device.createTexture({
    size: { width: size, height: size },
    format: ctx.format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const depthTexture = ctx.device.createTexture({
    size: { width: size, height: size },
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const monitorShader = await shader.create(ctx, MONITOR_SHADER);
  const monitorMat = await material.create(ctx, {
    shader: monitorShader,
    bindings: [
      { binding: 0, resource: texture.createView() },
      { binding: 1, resource: sampler },
    ],
  });
  return { texture, depthTexture, monitorMat };
}

function disposePipResources(ctx: Context, r: PipResources): void {
  material.destroy(ctx, r.monitorMat);
  r.texture.destroy();
  r.depthTexture.destroy();
}

async function buildScene(ctx: Context): Promise<SceneRef> {
  let pip: PipResources | undefined;

  try {
    const subjectMat = await material.normalColor(ctx);
    const subjectGeo = geometry.cube(ctx, { size: SUBJECT_SIZE });
    const subjectMesh = mesh.create(ctx, {
      geometry: subjectGeo,
      material: subjectMat,
    });

    const roomMat = await material.unlit(ctx, {
      color: ROOM_COLOR,
      cullMode: "front",
    });
    const roomGeo = geometry.cube(ctx, { size: ROOM_SIZE });
    const roomMesh = mesh.create(ctx, { geometry: roomGeo, material: roomMat });

    const subjectMatNoDepth = await material.normalColor(ctx, {
      depthEnabled: false,
    });
    const subjectMeshNoDepth = mesh.create(ctx, {
      geometry: subjectGeo,
      material: subjectMatNoDepth,
    });

    const roomMatNoDepth = await material.unlit(ctx, {
      color: ROOM_COLOR,
      cullMode: "front",
      depthEnabled: false,
    });
    const roomMeshNoDepth = mesh.create(ctx, {
      geometry: roomGeo,
      material: roomMatNoDepth,
    });

    const sampler = ctx.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    pip = await buildPipResources(ctx, state.pipResolution, sampler);

    const monitorGeo = geometry.plane(ctx, { size: MONITOR_SIZE });
    const monitorMesh = mesh.create(ctx, {
      geometry: monitorGeo,
      material: pip.monitorMat,
    });
    const monitorPos = vec3.fromValues(
      MONITOR_POSITION[0],
      MONITOR_POSITION[1],
      MONITOR_POSITION[2],
    );
    mesh.setPosition(ctx, monitorMesh, monitorPos);

    const mainCam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, MAIN_CAMERA_Y, MAIN_CAMERA_RADIUS),
    });
    camera.bindToCanvas(ctx, mainCam);
    const initialPipPos = PIP_POSITIONS[state.pipAngle];
    const pipCam = camera.perspective({
      aspect: 1,
      fovYRad: PIP_CAMERA_FOV_Y_RAD,
      position: vec3.fromValues(
        initialPipPos[0],
        initialPipPos[1],
        initialPipPos[2],
      ),
      target: vec3.fromValues(0, 0, 0),
    });

    const gizmoMat = await material.unlit(ctx, {
      color: GIZMO_COLOR,
      topology: "line-list",
      depthWrite: false,
      depthCompare: "always",
    });
    const gizmoGeo = geometry.create(ctx, gizmoQuadGeometryData(GIZMO_SIZE));
    const gizmoMesh = mesh.create(ctx, {
      geometry: gizmoGeo,
      material: gizmoMat,
    });

    return {
      subjectMesh,
      roomMesh,
      subjectMeshNoDepth,
      roomMeshNoDepth,
      monitorMesh,
      pip,
      mainCam,
      pipCam,
      sampler,
      rotBuf: quat.create(),
      scratchPos: vec3.create(),
      gizmoMesh,
      gizmoRot: quat.create(),
      gizmoDir: vec3.create(),
      gizmoAxis: vec3.create(),
    };
  } catch (e) {
    // gpu.dispose (called by the harness on setup failure) cascades all
    // managed resources. Only the consumer-owned raw PiP textures need
    // freeing here; disposePipResources frees them (its bundled managed
    // material.destroy is idempotent).
    if (pip) disposePipResources(ctx, pip);
    throw e;
  }
}

function disposeScene(_ctx: Context, scene: SceneRef): void {
  // gpu.dispose cascades all managed resources (materials, geometries, meshes)
  // and auto-disconnects the resize binding. Only the consumer-owned raw PiP
  // textures (created via ctx.device.createTexture) are freed here — the
  // cascade tracks managed slots, not raw GPU resources. monitorMat is managed,
  // so the cascade frees it; we do NOT call disposePipResources (which would
  // redundantly destroy monitorMat).
  scene.pip.texture.destroy();
  scene.pip.depthTexture.destroy();
}

// --- Rebuild queue (single-in-flight + one-pending) ---

function makeRebuild(
  ctx: Context,
  sceneRef: SceneRef,
  abortFlag: AbortFlag,
): () => Promise<void> {
  const queue: RebuildQueue = { inFlight: false, pending: false };

  const rebuildOnce = async (): Promise<void> => {
    let next: PipResources | undefined;
    try {
      next = await buildPipResources(
        ctx,
        state.pipResolution,
        sceneRef.sampler,
      );
      if (abortFlag.disposed) {
        disposePipResources(ctx, next);
        return;
      }
      const old = sceneRef.pip;
      sceneRef.pip = next;
      mesh.setMaterial(ctx, sceneRef.monitorMesh, next.monitorMat);
      disposePipResources(ctx, old);
    } catch (e) {
      if (next) disposePipResources(ctx, next);
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
  const fn = window.__cookbookRenderTargetRebuild;
  if (!fn) return Promise.resolve();
  return fn();
}

// --- Per-frame camera updates ---

function applyMainYaw(scene: SceneRef, yaw: number): void {
  const x = Math.sin(yaw) * MAIN_CAMERA_RADIUS;
  const z = Math.cos(yaw) * MAIN_CAMERA_RADIUS;
  vec3.set(scene.scratchPos, x, MAIN_CAMERA_Y, z);
  camera.setPosition(scene.mainCam, scene.scratchPos);
}

const Z_AXIS = vec3.fromValues(0, 0, 1);
const PARALLEL_EPSILON = 0.9999;

// Build a rotation that takes the +Z axis onto a given unit vector.
// `axisScratch` is overwritten — pass a per-mesh scratch to avoid aliasing.
function quatFromZTo(out: Quat, dirUnit: Vec3, axisScratch: Vec3): Quat {
  const dot = vec3.dot(Z_AXIS, dirUnit);
  if (dot > PARALLEL_EPSILON) {
    return quat.identity(out);
  }
  if (dot < -PARALLEL_EPSILON) {
    // dirUnit is anti-parallel to +Z: 180° rotation around any perpendicular axis (use X).
    vec3.set(axisScratch, 1, 0, 0);
    return quat.fromAxisAngle(out, axisScratch, Math.PI);
  }
  vec3.cross(axisScratch, Z_AXIS, dirUnit);
  vec3.normalize(axisScratch, axisScratch);
  const angle = Math.acos(dot);
  return quat.fromAxisAngle(out, axisScratch, angle);
}

function applyPipAngle(ctx: Context, scene: SceneRef, angle: PipAngle): void {
  const p = PIP_POSITIONS[angle];
  vec3.set(scene.scratchPos, p[0], p[1], p[2]);
  camera.setPosition(scene.pipCam, scene.scratchPos);

  // Gizmo: place at the PiP camera's position and orient its +Z face along the
  // camera's view direction. The PiP camera always looks at the origin, so the
  // view direction at position p is -p (normalized).
  mesh.setPosition(ctx, scene.gizmoMesh, scene.scratchPos);
  vec3.set(scene.gizmoDir, -p[0], -p[1], -p[2]);
  vec3.normalize(scene.gizmoDir, scene.gizmoDir);
  quatFromZTo(scene.gizmoRot, scene.gizmoDir, scene.gizmoAxis);
  mesh.setRotation(ctx, scene.gizmoMesh, scene.gizmoRot);
}

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get pipAngle() {
      return state.pipAngle;
    },
    get pipResolution() {
      return state.pipResolution;
    },
    get pipDepth() {
      return state.pipDepth;
    },
    onPipAngleChange: (v: PipAngle) => {
      state.pipAngle = v;
    },
    onPipResolutionChange: (v: PipResolution) => {
      state.pipResolution = v;
      void triggerRebuild();
    },
    onPipDepthChange: (v: boolean) => {
      state.pipDepth = v;
    },
  },
  setup: async (ctx) => {
    input.attach(ctx.canvas);
    try {
      const sceneRef = await buildScene(ctx);
      const abortFlag: AbortFlag = { disposed: false };
      window.__cookbookRenderTargetRebuild = makeRebuild(
        ctx,
        sceneRef,
        abortFlag,
      );

      let dragging = false;
      let lastDragX = 0;
      input.onPointerDown((e) => {
        if (e.button !== 0) return;
        dragging = true;
        lastDragX = e.x;
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
      // preventDefault must be wired separately. Without this, Space scrolls
      // the page. Register on globalThis to match input.attach's keyboard
      // target.
      const preventSpaceScroll = (e: KeyboardEvent): void => {
        if (e.code === "Space") e.preventDefault();
      };
      globalThis.addEventListener("keydown", preventSpaceScroll);

      return {
        scene: sceneRef,
        dispose: () => {
          abortFlag.disposed = true;
          window.__cookbookRenderTargetRebuild = undefined;
          globalThis.removeEventListener("keydown", preventSpaceScroll);
          disposeScene(ctx, sceneRef);
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
      state.angle +=
        SUBJECT_ROTATION_SPEED_RAD_PER_S * (info.deltaMs / MS_PER_S);
    }
    quat.fromEuler(scene.rotBuf, 0, state.angle, 0);
    mesh.setRotation(ctx, scene.subjectMesh, scene.rotBuf);
    mesh.setRotation(ctx, scene.subjectMeshNoDepth, scene.rotBuf);

    applyMainYaw(scene, state.yaw);
    applyPipAngle(ctx, scene, state.pipAngle);

    // Pass 1: PiP. depthEnabled ON → correct occlusion (depthTexture + depth materials);
    // OFF → genuine depth-less offscreen (no depthTexture + depthEnabled:false materials),
    // so geometry composites in draw order — a visible "why offscreen needs depth" artifact.
    if (state.pipDepth) {
      frame.renderToTexture(ctx, {
        texture: scene.pip.texture,
        depthTexture: scene.pip.depthTexture,
        draw: [scene.subjectMesh, scene.roomMesh],
        camera: scene.pipCam,
        clearColor: CLEAR_PIP,
      });
    } else {
      frame.renderToTexture(ctx, {
        texture: scene.pip.texture,
        draw: [scene.subjectMeshNoDepth, scene.roomMeshNoDepth],
        camera: scene.pipCam,
        clearColor: CLEAR_PIP,
      });
    }

    // Pass 2: main + monitor (sampling the PiP texture). Two distinct draw
    // lists per pass; the subject and the room appear in both.
    frame.render(ctx, {
      draw: [
        scene.roomMesh,
        scene.subjectMesh,
        scene.monitorMesh,
        scene.gizmoMesh,
      ],
      camera: scene.mainCam,
      clearColor: CLEAR_MAIN,
    });
  },
});
