import * as binding from "@furnace/core/binding";
import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import type { Ambient, Light } from "@furnace/core/frame";
import * as frame from "@furnace/core/frame";
import type { Geometry } from "@furnace/core/geometry";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import * as material from "@furnace/core/material";
import type { Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import type { Shader } from "@furnace/core/shader";
import * as shader from "@furnace/core/shader";
import type { Vec4 } from "@furnace/core/transform";
import { vec3, vec4 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import { state } from "./state.svelte.ts";

const CLEAR_COLOR: Vec4 = vec4.fromValues(0.02, 0.02, 0.03, 1);
// Gentle hemisphere fill so unshadowed regions aren't black. AMBIENT is never
// shadowed — the shadow contrast comes entirely from the direct (shadowed) term.
const AMBIENT: Ambient = {
  sky: [0.45, 0.5, 0.6],
  ground: [0.12, 0.11, 0.1],
  intensity: 0.08,
};
const MS_PER_S = 1000;

// Distinct caster colors so the two shadow shapes read against the neutral
// light-gray ground receiver.
const CUBE_COLOR = new Float32Array([0.85, 0.45, 0.22, 1]); // warm
const SPHERE_COLOR = new Float32Array([0.3, 0.5, 0.85, 1]); // cool
const GROUND_COLOR = new Float32Array([0.62, 0.62, 0.64, 1]); // neutral light-gray

const SPHERE_RADIUS = 0.6;
const CUBE_SCALE = 0.6;
const CUBE_POS: readonly [number, number, number] = [-0.9, 0.4, 0];
const SPHERE_POS: readonly [number, number, number] = [1.0, 0.3, 0.3];
const GROUND_Y = -0.8;
const GROUND_SCALE: readonly [number, number, number] = [8, 0.1, 8];

// The ground centre — both the ortho box target and the spot's aim point.
const GROUND_CENTER: readonly [number, number, number] = [0, GROUND_Y, 0];

type Scene = {
  cube: Mesh;
  sphere: Mesh;
  ground: Mesh;
  cam: Camera;
  t: number;
};

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get lightType() {
      return state.lightType;
    },
    get normalBias() {
      return state.normalBias;
    },
    onLightType: (value: "directional" | "spot") => {
      state.lightType = value;
    },
    onNormalBias: (value: number) => {
      state.normalBias = value;
    },
  },
  setup: async (ctx) => {
    const litShader = await shader.lit(ctx);

    const cube = await createLitMesh(
      ctx,
      litShader,
      geometry.cube(ctx),
      CUBE_COLOR,
    );
    mesh.setPosition(
      ctx,
      cube,
      vec3.fromValues(CUBE_POS[0], CUBE_POS[1], CUBE_POS[2]),
    );
    mesh.setScale(
      ctx,
      cube,
      vec3.fromValues(CUBE_SCALE, CUBE_SCALE, CUBE_SCALE),
    );

    const sphere = await createLitMesh(
      ctx,
      litShader,
      geometry.sphere(ctx, { radius: SPHERE_RADIUS }),
      SPHERE_COLOR,
    );
    mesh.setPosition(
      ctx,
      sphere,
      vec3.fromValues(SPHERE_POS[0], SPHERE_POS[1], SPHERE_POS[2]),
    );

    // Flat, wide receiver. Matte (no specular) so the shadows read cleanly.
    const ground = await createLitMesh(
      ctx,
      litShader,
      geometry.cube(ctx),
      GROUND_COLOR,
    );
    mesh.setPosition(ctx, ground, vec3.fromValues(0, GROUND_Y, 0));
    mesh.setScale(
      ctx,
      ground,
      vec3.fromValues(GROUND_SCALE[0], GROUND_SCALE[1], GROUND_SCALE[2]),
    );

    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 2.2, 4.5),
    });
    camera.setTarget(cam, vec3.fromValues(0, -0.3, 0));
    camera.bindToCanvas(ctx, cam);

    const scene: Scene = { cube, sphere, ground, cam, t: 0 };
    return { scene };
  },
  frame: ({ ctx, scene, info }) => {
    scene.t += info.deltaMs / MS_PER_S;

    const lights: Light[] = [buildShadowLight(scene.t)];

    frame.render(ctx, {
      meshes: [scene.ground, scene.cube, scene.sphere],
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
      lights,
      ambient: AMBIENT,
    });
  },
});

async function createLitMesh(
  ctx: Context,
  litShader: Shader,
  geo: Geometry,
  color: Float32Array,
): Promise<Mesh> {
  const matBinding = binding.create(ctx, litShader);
  binding.set(ctx, matBinding, { color });
  const mat = await material.create(ctx, {
    shader: litShader,
    binding: matBinding,
  });
  return mesh.create(ctx, { geometry: geo, material: mat });
}

// Build the single moving shadow-casting light each frame from `state`. Both
// variants carry a `shadow` config (opt-in) and sweep so the shadows move.
function buildShadowLight(t: number): Light {
  if (state.lightType === "spot") {
    return buildSpotLight(t);
  }
  return buildDirectionalLight(t);
}

function buildDirectionalLight(t: number): Light {
  // A sun whose direction arcs left-to-right, sweeping the shadows.
  const sweep = Math.sin(t * 0.4) * 0.6;
  return {
    type: "directional",
    direction: [sweep, -1, -0.35],
    color: [1, 0.96, 0.9],
    intensity: 1.1,
    shadow: {
      orthoHalfExtent: 4,
      near: 0.1,
      far: 14,
      target: GROUND_CENTER,
      normalBias: state.normalBias,
      depthBias: 1.0,
    },
  };
}

function buildSpotLight(t: number): Light {
  // A spot orbiting above the scene, aimed at the ground centre.
  const a = t * 0.5;
  const px = Math.cos(a) * 1.8;
  const py = 3.2;
  const pz = Math.sin(a) * 1.8;
  // direction = target − position; the engine normalizes internally.
  return {
    type: "spot",
    position: [px, py, pz],
    direction: [
      GROUND_CENTER[0] - px,
      GROUND_CENTER[1] - py,
      GROUND_CENTER[2] - pz,
    ],
    color: [1, 1, 1],
    intensity: 4.0,
    range: 14,
    innerAngle: 0.3,
    outerAngle: 0.55,
    shadow: {
      near: 0.5,
      far: 14,
      normalBias: state.normalBias,
      depthBias: 1.0,
    },
  };
}
