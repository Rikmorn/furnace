import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Geometry, GeometryData } from "@furnace/core/geometry";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import * as shader from "@furnace/core/shader";
import type { Vec4 } from "@furnace/core/transform";
import { vec3, vec4 } from "@furnace/core/transform";

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
const CLEAR_COLOR: Vec4 = vec4.fromValues(0.05, 0.05, 0.07, 1);

type SceneRef = {
  geo: Geometry;
  mat: Material;
  grid: Mesh;
  cam: Camera;
};

function buildGridData(
  subdiv: number,
  amplitude: number,
  topology: Topology,
): GeometryData {
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

      // Analytical normal from cross(tangent_v, tangent_u); orientation chosen so n=(0,1,0) at amplitude=0.
      const dydu =
        WAVE_FREQUENCY *
        Math.cos(u * WAVE_FREQUENCY) *
        Math.cos(v * WAVE_FREQUENCY) *
        amplitude;
      const dydv =
        -WAVE_FREQUENCY *
        Math.sin(u * WAVE_FREQUENCY) *
        Math.sin(v * WAVE_FREQUENCY) *
        amplitude;
      const nx = -dydu * GRID_FULL_EXTENT;
      const ny = GRID_FULL_EXTENT * GRID_FULL_EXTENT;
      const nz = -dydv * GRID_FULL_EXTENT;
      const len = Math.hypot(nx, ny, nz);

      positions[idx * 3 + 0] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;
      normals[idx * 3 + 0] = nx / len;
      normals[idx * 3 + 1] = ny / len;
      normals[idx * 3 + 2] = nz / len;
      uvs[idx * 2 + 0] = u;
      uvs[idx * 2 + 1] = v;
    }
  }

  const indices = buildIndicesFor(topology, subdiv, stride);
  return indices !== undefined
    ? { positions, normals, uvs, indices }
    : { positions, normals, uvs };
}

function buildIndicesFor(
  topology: Topology,
  subdiv: number,
  stride: number,
): Uint32Array | undefined {
  if (topology === "triangle-list") return buildTriangleIndices(subdiv, stride);
  if (topology === "line-list") return buildWireframeIndices(subdiv, stride);
  return undefined; // point-list: each vertex drawn once via non-indexed draw
}

function buildTriangleIndices(subdiv: number, stride: number): Uint32Array {
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

function buildWireframeIndices(subdiv: number, stride: number): Uint32Array {
  // Triangulation wireframe: every quad emits (a,b) top, (a,c) left, (b,c) diagonal.
  // Boundary closure: last column emits (b,d) right; last row emits (c,d) bottom.
  const interiorIndices = subdiv * subdiv * 6;
  const boundaryIndices = subdiv * 4;
  const indices = new Uint32Array(interiorIndices + boundaryIndices);
  let cursor = 0;
  for (let j = 0; j < subdiv; j++) {
    for (let i = 0; i < subdiv; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices[cursor++] = a;
      indices[cursor++] = b;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = c;
      if (i === subdiv - 1) {
        indices[cursor++] = b;
        indices[cursor++] = d;
      }
      if (j === subdiv - 1) {
        indices[cursor++] = c;
        indices[cursor++] = d;
      }
    }
  }
  return indices;
}

async function buildScene(ctx: Context): Promise<SceneRef> {
  const geo = geometry.create(
    ctx,
    buildGridData(state.subdiv, state.amplitude, state.topology),
  );
  // WebGPU requires cullMode "none" for non-triangle topologies — faces don't exist for line/point primitives.
  const mat = await material.create(ctx, {
    shader: await shader.normalColor(ctx),
    primitive: {
      topology: state.topology,
      cullMode: state.topology === "triangle-list" ? "back" : "none",
    },
  });
  const grid = mesh.create(ctx, { geometry: geo, material: mat });
  const cam = camera.perspective({
    aspect: ctx.canvas.width / ctx.canvas.height,
    position: vec3.fromValues(
      CAMERA_POSITION_X,
      CAMERA_POSITION_Y,
      CAMERA_POSITION_Z,
    ),
    target: vec3.fromValues(CAMERA_TARGET_X, CAMERA_TARGET_Y, CAMERA_TARGET_Z),
  });
  camera.bindToCanvas(ctx, cam);
  return { geo, mat, grid, cam };
}

type AbortFlag = { disposed: boolean };

type RebuildQueue = { inFlight: boolean; pending: boolean };

function makeRebuild(
  ctx: Context,
  sceneRef: SceneRef,
  abortFlag: AbortFlag,
): () => Promise<void> {
  const queue: RebuildQueue = { inFlight: false, pending: false };

  const rebuildOnce = async (): Promise<void> => {
    let nextGeometry: Geometry | undefined;
    let nextMat: Material | undefined;
    try {
      nextGeometry = geometry.create(
        ctx,
        buildGridData(state.subdiv, state.amplitude, state.topology),
      );
      // WebGPU requires cullMode "none" for non-triangle topologies — faces don't exist for line/point primitives.
      nextMat = await material.create(ctx, {
        shader: await shader.normalColor(ctx),
        primitive: {
          topology: state.topology,
          cullMode: state.topology === "triangle-list" ? "back" : "none",
        },
      });
      // Tear-down (e.g. bun --hot reload) may have run while material.create
      // was pending. The sceneRef we'd swap into is already destroyed, so
      // clean up the fresh resources and bail before touching it.
      if (abortFlag.disposed) {
        material.destroy(ctx, nextMat);
        geometry.destroy(ctx, nextGeometry);
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
      const oldGeometry = sceneRef.geo;
      const oldMat = sceneRef.mat;
      sceneRef.grid = nextGrid;
      sceneRef.geo = nextGeometry;
      sceneRef.mat = nextMat;
      mesh.destroy(ctx, oldGrid);
      geometry.destroy(ctx, oldGeometry);
      material.destroy(ctx, oldMat);
    } catch (e) {
      if (nextMat) material.destroy(ctx, nextMat);
      if (nextGeometry) geometry.destroy(ctx, nextGeometry);
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
      // gpu.dispose cascades the grid/geometry/material and auto-disconnects
      // the resize binding. Only the rebuild abort-flag + window global are
      // torn down here. (Mid-life explicit destroy lives in makeRebuild, which
      // frees the previous grid/geometry/material when a control changes.)
      dispose: () => {
        abortFlag.disposed = true;
        window.__cookbookGeometryRebuild = undefined;
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
