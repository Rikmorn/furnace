import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Context } from "@furnace/core/gpu";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Geometry, Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import * as stats from "@furnace/core/stats";
import type { Vec4 } from "@furnace/core/transform";
import { vec3, vec4 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import { FPS_HISTORY_LEN, state } from "./state.svelte.ts";

// Cookbook escape hatch. mountDemo has no imperative bus, so the controls
// callbacks reach the setup-scope spawn/despawn via this global. This is the
// second authorised site (geometry was the first); a third would justify a
// real imperative-bus refactor on mountDemo. Global augmentation (not a cast)
// keeps the contract type-checked at every callsite.
declare global {
  interface Window {
    __cookbookCustomStatsSpawn?: () => void;
    __cookbookCustomStatsDespawn?: () => void;
  }
}

const MAX_CUBES = 200;
const CAMERA_Z = 5;
const CUBE_SIZE = 0.3;
const CUBE_X_RANGE = 4;
const CUBE_Y_RANGE = 3;
const CUBE_Z_RANGE = 2;
const HEAVY_LOOP_ITERATIONS = 50_000;
const HEAVY_MULTIPLIER = 0.01;
const CLEAR_COLOR: Vec4 = vec4.fromValues(0.05, 0.05, 0.07, 1);

// Custom stats keys. Names must be unique across kinds (gauge/counter/measure).
const KEY_CUBES_ALIVE = "cubes.alive";
const KEY_CUBES_SPAWN_TOTAL = "cubes.spawn-total";
const KEY_CUBES_DESPAWN_TOTAL = "cubes.despawn-total";
const KEY_HEAVY_LOOP = "heavy-loop";

type Scene = {
  mat: Material;
  geometry: Geometry;
  cubes: Mesh[];
  cam: camera.Camera;
  positionBuf: Float32Array;
};

function randomCubePosition(out: Float32Array): void {
  out[0] = (Math.random() - 0.5) * CUBE_X_RANGE;
  out[1] = (Math.random() - 0.5) * CUBE_Y_RANGE;
  out[2] = (Math.random() - 0.5) * CUBE_Z_RANGE;
}

function makeSpawn(ctx: Context, scene: Scene): () => void {
  return () => {
    if (scene.cubes.length >= MAX_CUBES) return;
    const c = mesh.create(ctx, {
      geometry: scene.geometry,
      material: scene.mat,
    });
    randomCubePosition(scene.positionBuf);
    mesh.setPosition(ctx, c, scene.positionBuf);
    scene.cubes.push(c);
    state.cubeCount = scene.cubes.length;
    state.spawnTotal += 1;
    stats.gauge(ctx, KEY_CUBES_ALIVE, scene.cubes.length);
    stats.increment(ctx, KEY_CUBES_SPAWN_TOTAL);
  };
}

function makeDespawn(ctx: Context, scene: Scene): () => void {
  return () => {
    const c = scene.cubes.pop();
    if (!c) return;
    mesh.destroy(ctx, c);
    state.cubeCount = scene.cubes.length;
    state.despawnTotal += 1;
    stats.gauge(ctx, KEY_CUBES_ALIVE, scene.cubes.length);
    stats.increment(ctx, KEY_CUBES_DESPAWN_TOTAL);
  };
}

function pushFpsSample(sample: number): void {
  if (state.fpsHistory.length >= FPS_HISTORY_LEN) state.fpsHistory.shift();
  state.fpsHistory.push(sample);
}

function runHeavyLoop(): void {
  let sum = 0;
  for (let i = 0; i < HEAVY_LOOP_ITERATIONS; i++) {
    sum += Math.sin(i * HEAVY_MULTIPLIER);
  }
  // Reference `sum` so the JIT doesn't dead-code-eliminate the loop. The
  // input range makes NaN unreachable; the branch is just to keep `sum` live.
  if (Number.isNaN(sum)) state.heavyMs = -1;
}

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get cubeCount() {
      return state.cubeCount;
    },
    get spawnTotal() {
      return state.spawnTotal;
    },
    get despawnTotal() {
      return state.despawnTotal;
    },
    get heavyLoop() {
      return state.heavyLoop;
    },
    get heavyMs() {
      return state.heavyMs;
    },
    get fpsHistory() {
      return state.fpsHistory;
    },
    onSpawn: () => {
      const fn = window.__cookbookCustomStatsSpawn;
      if (fn) fn();
    },
    onDespawn: () => {
      const fn = window.__cookbookCustomStatsDespawn;
      if (fn) fn();
    },
    onHeavyLoopChange: (v: boolean) => {
      state.heavyLoop = v;
    },
  },
  setup: async (ctx) => {
    let mat: Material | undefined;
    let geometry: Geometry | undefined;
    let unsubFrame: (() => void) | undefined;
    let unsubResize: (() => void) | undefined;
    const cubes: Mesh[] = [];

    try {
      mat = await material.normalColor(ctx);
      // Shared geometry across all spawned meshes: 200 cubes share one VBO.
      // resources.meshes climbs with spawns; resources.geometries stays at 1.
      geometry = mesh.cubeGeometry(ctx, { size: CUBE_SIZE });

      const cam = camera.perspective({
        aspect: ctx.canvas.width / ctx.canvas.height,
        position: vec3.fromValues(0, 0, CAMERA_Z),
      });
      unsubResize = camera.bindToCanvas(ctx, cam);

      const scene: Scene = {
        mat,
        geometry,
        cubes,
        cam,
        positionBuf: new Float32Array(3),
      };

      const spawn = makeSpawn(ctx, scene);
      const despawn = makeDespawn(ctx, scene);
      window.__cookbookCustomStatsSpawn = spawn;
      window.__cookbookCustomStatsDespawn = despawn;

      // Custom onFrame subscriber: maintains a sliding-window fps history
      // and reads back the duration recorded by stats.measure earlier in the
      // same frame (snap.custom["heavy-loop"] is the previous measure() ms).
      unsubFrame = stats.onFrame(ctx, (snap) => {
        pushFpsSample(snap.frame.fps);
        const recorded = snap.custom[KEY_HEAVY_LOOP];
        state.heavyMs =
          state.heavyLoop && recorded !== undefined ? recorded : 0;
      });

      const sceneUnsubResize = unsubResize;
      const sceneUnsub = unsubFrame;
      const sceneMat = mat;
      const sceneGeometry = geometry;

      return {
        scene,
        dispose: () => {
          window.__cookbookCustomStatsSpawn = undefined;
          window.__cookbookCustomStatsDespawn = undefined;
          sceneUnsubResize();
          sceneUnsub();
          for (const c of cubes) mesh.destroy(ctx, c);
          cubes.length = 0;
          mesh.destroyGeometry(ctx, sceneGeometry);
          material.destroy(ctx, sceneMat);
        },
      };
    } catch (e) {
      window.__cookbookCustomStatsSpawn = undefined;
      window.__cookbookCustomStatsDespawn = undefined;
      if (unsubResize) unsubResize();
      if (unsubFrame) unsubFrame();
      for (const c of cubes) mesh.destroy(ctx, c);
      if (geometry) mesh.destroyGeometry(ctx, geometry);
      if (mat) material.destroy(ctx, mat);
      throw e;
    }
  },
  frame: ({ ctx, scene }) => {
    if (state.heavyLoop) {
      stats.measure(ctx, KEY_HEAVY_LOOP, runHeavyLoop);
    }

    frame.render(ctx, {
      draw: scene.cubes,
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
    });
  },
});
