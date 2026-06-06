import type { Binding } from "@furnace/core/binding";
import * as binding from "@furnace/core/binding";
import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Geometry } from "@furnace/core/geometry";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import type { Material } from "@furnace/core/material";
import * as material from "@furnace/core/material";
import type { Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import type { Effect } from "@furnace/core/post";
import * as post from "@furnace/core/post";
import type { Shader } from "@furnace/core/shader";
import * as shader from "@furnace/core/shader";
import type { Quat, Vec3, Vec4 } from "@furnace/core/transform";
import { quat, vec3, vec4 } from "@furnace/core/transform";

import {
  add,
  ready as demoWasmReady,
} from "../../../plugins/demo-wasm/pkg/demo_wasm";
// .wgsl files stay in src/ (siblings of the old entry.ts); reference them up two dirs.
import bloomShaderUrl from "../../bloom.wgsl";
import emissiveShaderUrl from "../../emissive.wgsl";
import type { SceneController, SceneFactory } from "../../shell/scene.ts";
import triangleShaderUrl from "../../triangle.wgsl";

const MOVE_SPEED_WORLD_PER_SEC = 1.5;
const DIAGONAL_NORMALIZE = 1 / Math.sqrt(2);
const HALO_WIDTH = 0.3;
const CUBE_ROTATION_PITCH_RATE = 0.0003;
const CUBE_ROTATION_YAW_RATE = 0.0005;
const PLANE_BACKDROP_SIZE = 6;
const PLANE_Z = -2;
const CUBE_X = 1;
const MS_PER_S = 1000;
const EMISSIVE_COLOR_HOT_PINK = new Float32Array([1.0, 0.8, 1.0, 1.0]);
const BLOOM_THRESHOLD = 0.7;
const BLOOM_INTENSITY = 4.0;
const BLOOM_RADIUS = 0.012;
const CLEAR_COLOR: Vec4 = vec4.fromValues(0.05, 0.05, 0.07, 1);

type TriangleState = {
  sdfMesh: Mesh;
  sdfGeo: Geometry;
  sdfMat: Material;
  sdfShader: Shader;
  haloBinding: Binding;
  cubeMesh: Mesh;
  cubeGeo: Geometry;
  cubeMat: Material;
  planeMesh: Mesh;
  planeGeo: Geometry;
  planeMat: Material;
  planeBinding: Binding;
  emissiveMesh: Mesh;
  emissiveGeo: Geometry;
  emissiveMat: Material;
  emissiveShader: Shader;
  emissiveBinding: Binding;
  bloom: Effect;
  bloomShader: Shader;
  bloomBinding: Binding;
  cam: Camera;
  unbindCamera: () => void;
  rotation: Quat;
  sdfPosition: Vec3;
};

export const triangleScene: SceneFactory = {
  label: "Triangle",
  load: async (ctx: Context): Promise<SceneController> => {
    await demoWasmReady;
    console.log("demo-wasm: 2 + 3 =", add(2, 3));

    // SDF triangle (covering quad, premultiplied-alpha, no depth write).
    const sdfShader = await shader.load(ctx, triangleShaderUrl, {
      layout: { halo: "vec4f" },
    });
    const haloBinding = binding.create(ctx, sdfShader);
    binding.set(ctx, haloBinding, { halo: [HALO_WIDTH, 0, 0, 0] });
    const sdfMat = await material.create(ctx, {
      shader: sdfShader,
      binding: haloBinding,
      primitive: { cullMode: "none" },
      blend: material.blend.premultiplied,
      depth: { write: false },
    });
    const sdfGeo = geometry.create(ctx, {
      positions: new Float32Array([-10, -10, 0, 30, -10, 0, -10, 30, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    });
    const sdfMesh = mesh.create(ctx, { geometry: sdfGeo, material: sdfMat });

    // Normal-coloured cube.
    const cubeMat = await material.create(ctx, {
      shader: await shader.normalColor(ctx),
    });
    const cubeGeo = geometry.cube(ctx);
    const cubeMesh = mesh.create(ctx, { geometry: cubeGeo, material: cubeMat });

    // Unlit backdrop plane. planeShader is the built-in (engine-owned, shared
    // per-ctx, no-op destroy) — used here but not stored in state / torn down.
    const planeShader = await shader.unlit(ctx);
    const planeBinding = binding.create(ctx, planeShader);
    binding.set(ctx, planeBinding, {
      color: vec4.fromValues(0.1, 0.15, 0.2, 1),
    });
    const planeMat = await material.create(ctx, {
      shader: planeShader,
      binding: planeBinding,
    });
    const planeGeo = geometry.plane(ctx, { size: PLANE_BACKDROP_SIZE });
    const planeMesh = mesh.create(ctx, {
      geometry: planeGeo,
      material: planeMat,
    });

    // Emissive cube (feeds the bloom pass).
    const emissiveShader = await shader.load(ctx, emissiveShaderUrl, {
      layout: { color: "vec4f" },
    });
    const emissiveBinding = binding.create(ctx, emissiveShader);
    binding.set(ctx, emissiveBinding, { color: EMISSIVE_COLOR_HOT_PINK });
    const emissiveMat = await material.create(ctx, {
      shader: emissiveShader,
      binding: emissiveBinding,
    });
    const emissiveGeo = geometry.cube(ctx);
    const emissiveMesh = mesh.create(ctx, {
      geometry: emissiveGeo,
      material: emissiveMat,
    });

    // Bloom post effect.
    const bloomShader = await shader.load(ctx, bloomShaderUrl, {
      layout: { threshold: "f32", intensity: "f32", radius: "f32" },
    });
    const bloomBinding = binding.create(ctx, bloomShader);
    binding.set(ctx, bloomBinding, {
      threshold: BLOOM_THRESHOLD,
      intensity: BLOOM_INTENSITY,
      radius: BLOOM_RADIUS,
    });
    const bloom = await post.create(ctx, {
      shader: bloomShader,
      binding: bloomBinding,
    });

    mesh.setPosition(ctx, planeMesh, new Float32Array([0, 0, PLANE_Z]));
    mesh.setPosition(ctx, cubeMesh, new Float32Array([CUBE_X, 0, 0]));
    mesh.setPosition(ctx, emissiveMesh, new Float32Array([-CUBE_X, 0, 0]));

    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
    });
    const unbindCamera = camera.bindToCanvas(ctx, cam);

    const state: TriangleState = {
      sdfMesh,
      sdfGeo,
      sdfMat,
      sdfShader,
      haloBinding,
      cubeMesh,
      cubeGeo,
      cubeMat,
      planeMesh,
      planeGeo,
      planeMat,
      planeBinding,
      emissiveMesh,
      emissiveGeo,
      emissiveMat,
      emissiveShader,
      emissiveBinding,
      bloom,
      bloomShader,
      bloomBinding,
      cam,
      unbindCamera,
      rotation: quat.create(),
      sdfPosition: vec3.fromValues(0, 0, 0),
    };

    return {
      frame: (info) => {
        const dt = info.deltaMs / MS_PER_S;
        let dx = 0;
        let dy = 0;
        if (input.isKeyDown("ArrowLeft")) dx -= 1;
        if (input.isKeyDown("ArrowRight")) dx += 1;
        if (input.isKeyDown("ArrowDown")) dy -= 1;
        if (input.isKeyDown("ArrowUp")) dy += 1;
        if (dx !== 0 && dy !== 0) {
          dx *= DIAGONAL_NORMALIZE;
          dy *= DIAGONAL_NORMALIZE;
        }
        vec3.add(
          state.sdfPosition,
          state.sdfPosition,
          vec3.fromValues(
            dx * MOVE_SPEED_WORLD_PER_SEC * dt,
            dy * MOVE_SPEED_WORLD_PER_SEC * dt,
            0,
          ),
        );
        mesh.setPosition(ctx, state.sdfMesh, state.sdfPosition);
        quat.fromEuler(
          state.rotation,
          info.elapsedMs * CUBE_ROTATION_PITCH_RATE,
          info.elapsedMs * CUBE_ROTATION_YAW_RATE,
          0,
        );
        mesh.setRotation(ctx, state.cubeMesh, state.rotation);
        mesh.setRotation(ctx, state.emissiveMesh, state.rotation);
        frame.render(ctx, {
          meshes: [
            state.planeMesh,
            state.cubeMesh,
            state.emissiveMesh,
            state.sdfMesh,
          ],
          camera: state.cam,
          effects: [state.bloom],
          clearColor: CLEAR_COLOR,
        });
      },
      unload: () => {
        state.unbindCamera();
        mesh.destroy(ctx, state.sdfMesh);
        mesh.destroy(ctx, state.cubeMesh);
        mesh.destroy(ctx, state.planeMesh);
        mesh.destroy(ctx, state.emissiveMesh);
        post.destroy(ctx, state.bloom);
        material.destroy(ctx, state.sdfMat);
        material.destroy(ctx, state.cubeMat);
        material.destroy(ctx, state.planeMat);
        material.destroy(ctx, state.emissiveMat);
        geometry.destroy(ctx, state.sdfGeo);
        geometry.destroy(ctx, state.cubeGeo);
        geometry.destroy(ctx, state.planeGeo);
        geometry.destroy(ctx, state.emissiveGeo);
        binding.destroy(ctx, state.haloBinding);
        binding.destroy(ctx, state.planeBinding);
        binding.destroy(ctx, state.emissiveBinding);
        binding.destroy(ctx, state.bloomBinding);
        // Custom (loaded) shaders are consumer-owned; built-in normalColor/unlit
        // are shared per-ctx and their destroy is a no-op, so skip those.
        shader.destroy(ctx, state.sdfShader);
        shader.destroy(ctx, state.emissiveShader);
        shader.destroy(ctx, state.bloomShader);
      },
    };
  },
};
