import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Context } from "@furnace/core/gpu";
import type { Material, MaterialDescriptor } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Geometry, GeometryData, Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import { vec3 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import type { Topology } from "./state.svelte.ts";
import { state } from "./state.svelte.ts";

// Cookbook escape hatch. mountDemo has no imperative bus, so the controls
// callbacks reach the setup-scope rebuild via this global. Acknowledged for
// this demo and Task 18 (custom-stats); a third site would justify a
// real imperative-bus refactor on mountDemo. Global augmentation (not a cast)
// keeps the contract type-checked at every callsite.
declare global {
  interface Window {
    __cookbookGeometryRebuild?: () => Promise<void>;
  }
}

const CAMERA_POSITION_X = 1.5;
const CAMERA_POSITION_Y = 1.5;
const CAMERA_POSITION_Z = 3;
const CAMERA_TARGET_X = 0;
const CAMERA_TARGET_Y = 0;
const CAMERA_TARGET_Z = 0;
const WAVE_FREQUENCY = Math.PI * 4;
const GRID_HALF_EXTENT = 1;
const GRID_FULL_EXTENT = GRID_HALF_EXTENT * 2;
const CLEAR_COLOR: [number, number, number, number] = [0.05, 0.05, 0.07, 1];

const GRID_WGSL = /* wgsl */ `
struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

struct VsOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(v: VsIn) -> VsOut {
  let world = object.model * vec4<f32>(v.position, 1.0);
  var out: VsOut;
  out.clip_pos = camera.viewProjection * world;
  out.uv = v.uv;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  return vec4<f32>(in.uv, 0.6, 1.0);
}
`;

type SceneRef = {
  geometry: Geometry;
  mat: Material;
  grid: Mesh;
  cam: Camera;
};

function buildGridData(subdiv: number, amplitude: number): GeometryData {
  const stride = subdiv + 1;
  const vertexCount = stride * stride;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let j = 0; j < stride; j++) {
    for (let i = 0; i < stride; i++) {
      const idx = j * stride + i;
      const u = i / subdiv;
      const v = j / subdiv;
      const x = u * GRID_FULL_EXTENT - GRID_HALF_EXTENT;
      const z = v * GRID_FULL_EXTENT - GRID_HALF_EXTENT;
      const y =
        Math.sin(u * WAVE_FREQUENCY) * Math.cos(v * WAVE_FREQUENCY) * amplitude;
      positions[idx * 3 + 0] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;
      normals[idx * 3 + 0] = 0;
      normals[idx * 3 + 1] = 1;
      normals[idx * 3 + 2] = 0;
      uvs[idx * 2 + 0] = u;
      uvs[idx * 2 + 1] = v;
    }
  }

  const indices = buildGridIndices(subdiv, stride);
  return { positions, normals, uvs, indices };
}

function buildGridIndices(subdiv: number, stride: number): Uint32Array {
  const quadCount = subdiv * subdiv;
  const indices = new Uint32Array(quadCount * 6);
  let cursor = 0;
  for (let j = 0; j < subdiv; j++) {
    for (let i = 0; i < subdiv; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }
  return indices;
}

function materialDescriptorFor(topology: Topology): MaterialDescriptor {
  // WebGPU requires cullMode "none" with non-triangle topologies; faces don't
  // exist for line-list / point-list, so back-face culling is undefined.
  const cullMode: GPUCullMode = topology === "triangle-list" ? "back" : "none";
  return {
    vertex: GRID_WGSL,
    fragment: GRID_WGSL,
    topology,
    cullMode,
  };
}

async function buildScene(ctx: Context): Promise<SceneRef> {
  let geometry: Geometry | undefined;
  let mat: Material | undefined;
  try {
    geometry = mesh.createGeometry(
      ctx,
      buildGridData(state.subdiv, state.amplitude),
    );
    mat = await material.create(ctx, materialDescriptorFor(state.topology));
    const grid = mesh.create(ctx, { geometry, material: mat });
    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(
        CAMERA_POSITION_X,
        CAMERA_POSITION_Y,
        CAMERA_POSITION_Z,
      ),
      target: vec3.fromValues(
        CAMERA_TARGET_X,
        CAMERA_TARGET_Y,
        CAMERA_TARGET_Z,
      ),
    });
    return { geometry, mat, grid, cam };
  } catch (e) {
    if (mat) material.destroy(mat);
    if (geometry) mesh.destroyGeometry(geometry);
    throw e;
  }
}

function disposeScene(scene: SceneRef): void {
  mesh.destroy(scene.grid);
  mesh.destroyGeometry(scene.geometry);
  material.destroy(scene.mat);
}

type AbortFlag = { disposed: boolean };

function makeRebuild(
  ctx: Context,
  sceneRef: SceneRef,
  abortFlag: AbortFlag,
): () => Promise<void> {
  return async () => {
    let nextGeometry: Geometry | undefined;
    let nextMat: Material | undefined;
    try {
      nextGeometry = mesh.createGeometry(
        ctx,
        buildGridData(state.subdiv, state.amplitude),
      );
      nextMat = await material.create(
        ctx,
        materialDescriptorFor(state.topology),
      );
      // Tear-down (e.g. bun --hot reload) may have run while material.create
      // was pending. The sceneRef we'd swap into is already destroyed, so
      // clean up the fresh resources and bail before touching it.
      if (abortFlag.disposed) {
        mesh.destroyGeometry(nextGeometry);
        material.destroy(nextMat);
        return;
      }
      const nextGrid = mesh.create(ctx, {
        geometry: nextGeometry,
        material: nextMat,
      });
      // Swap-on-success: the previous scene resources are torn down only after
      // the replacement is fully constructed, so a failed rebuild leaves the
      // running scene untouched.
      const oldGrid = sceneRef.grid;
      const oldGeometry = sceneRef.geometry;
      const oldMat = sceneRef.mat;
      sceneRef.grid = nextGrid;
      sceneRef.geometry = nextGeometry;
      sceneRef.mat = nextMat;
      mesh.destroy(oldGrid);
      mesh.destroyGeometry(oldGeometry);
      material.destroy(oldMat);
    } catch (e) {
      if (nextMat) material.destroy(nextMat);
      if (nextGeometry) mesh.destroyGeometry(nextGeometry);
      throw e;
    }
  };
}

function triggerRebuild(): Promise<void> {
  const fn = window.__cookbookGeometryRebuild;
  if (!fn) return Promise.resolve();
  return fn();
}

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get topology() {
      return state.topology;
    },
    get subdiv() {
      return state.subdiv;
    },
    get amplitude() {
      return state.amplitude;
    },
    onTopologyChange: (v: Topology) => {
      state.topology = v;
      void triggerRebuild();
    },
    onSubdivChange: (v: number) => {
      state.subdiv = v;
      void triggerRebuild();
    },
    onAmplitudeChange: (v: number) => {
      state.amplitude = v;
      void triggerRebuild();
    },
  },
  setup: async (ctx) => {
    const sceneRef = await buildScene(ctx);
    const abortFlag: AbortFlag = { disposed: false };
    window.__cookbookGeometryRebuild = makeRebuild(ctx, sceneRef, abortFlag);
    return {
      scene: sceneRef,
      dispose: () => {
        abortFlag.disposed = true;
        window.__cookbookGeometryRebuild = undefined;
        disposeScene(sceneRef);
      },
    };
  },
  frame: ({ ctx, scene }) => {
    frame.render(ctx, {
      draw: [scene.grid],
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
    });
  },
});
