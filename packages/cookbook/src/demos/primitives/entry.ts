import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Geometry } from "@furnace/core/geometry";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import * as shader from "@furnace/core/shader";
import type { Quat, Vec4 } from "@furnace/core/transform";
import { quat, vec3, vec4 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import type { PrimitiveShape } from "./state.svelte.ts";
import { state } from "./state.svelte.ts";

const CLEAR_COLOR: Vec4 = vec4.fromValues(0.05, 0.05, 0.07, 1);
// Radians per ms of accumulated (delta-capped) frame time — accumulating
// deltaMs rather than reading elapsedMs keeps the spin steady across a
// backgrounded tab, matching the shader/post demos.
const PITCH_RATE = 0.0003;
const YAW_RATE = 0.0006;

// Cookbook escape hatch — same pattern as geometry demo. The controls callback
// reaches the setup-scope rebuild via this global. Global augmentation (not a
// cast) keeps the contract type-checked at every callsite.
declare global {
  interface Window {
    __cookbookPrimitivesRebuild?: () => void;
  }
}

type SceneRef = {
  geo: Geometry;
  mat: Material;
  obj: Mesh;
  cam: Camera;
  rotBuf: Quat;
  spinMs: number;
};

function buildGeometry(ctx: Context, shape: PrimitiveShape): Geometry {
  if (shape === "cube") return geometry.cube(ctx);
  if (shape === "plane") return geometry.plane(ctx);
  if (shape === "sphere") return geometry.sphere(ctx);
  return geometry.cylinder(ctx);
}

async function buildScene(ctx: Context): Promise<SceneRef> {
  const geo = buildGeometry(ctx, state.shape);
  // plane is one-sided; show both faces so the rotating quad never vanishes.
  const mat = await material.create(ctx, {
    shader: await shader.normalColor(ctx),
    primitive: { cullMode: "none" },
  });
  const obj = mesh.create(ctx, { geometry: geo, material: mat });
  const cam = camera.perspective({
    aspect: ctx.canvas.width / ctx.canvas.height,
    position: vec3.fromValues(1.4, 1.1, 2.2),
    target: vec3.fromValues(0, 0, 0),
  });
  camera.bindToCanvas(ctx, cam);
  return { geo, mat, obj, cam, rotBuf: quat.create(), spinMs: 0 };
}

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get shape() {
      return state.shape;
    },
    onShapeChange: (v: PrimitiveShape) => {
      state.shape = v;
      window.__cookbookPrimitivesRebuild?.();
    },
  },
  setup: async (ctx) => {
    const scene = await buildScene(ctx);
    // Swap-on-change: rebuild geometry + mesh (geometry is fixed at mesh.create),
    // releasing the previous pair after the replacement is bound.
    window.__cookbookPrimitivesRebuild = () => {
      const nextGeo = buildGeometry(ctx, state.shape);
      const nextObj = mesh.create(ctx, {
        geometry: nextGeo,
        material: scene.mat,
      });
      const prevGeo = scene.geo;
      const prevObj = scene.obj;
      scene.geo = nextGeo;
      scene.obj = nextObj;
      mesh.destroy(ctx, prevObj);
      geometry.destroy(ctx, prevGeo);
    };
    return {
      scene,
      // gpu.dispose cascades the obj/geo/mat and auto-disconnects the resize
      // binding. Only the window global is torn down here.
      dispose: () => {
        window.__cookbookPrimitivesRebuild = undefined;
      },
    };
  },
  frame: ({ ctx, scene, info }) => {
    scene.spinMs += info.deltaMs;
    quat.fromEuler(
      scene.rotBuf,
      scene.spinMs * PITCH_RATE,
      scene.spinMs * YAW_RATE,
      0,
    );
    mesh.setRotation(ctx, scene.obj, scene.rotBuf);
    frame.render(ctx, {
      meshes: [scene.obj],
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
    });
  },
});
