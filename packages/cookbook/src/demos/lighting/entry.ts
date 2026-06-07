import type { Binding } from "@furnace/core/binding";
import * as binding from "@furnace/core/binding";
import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import type { Ambient, Light } from "@furnace/core/frame";
import * as frame from "@furnace/core/frame";
import * as geometry from "@furnace/core/geometry";
import * as material from "@furnace/core/material";
import type { Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import * as shader from "@furnace/core/shader";
import type { Vec4 } from "@furnace/core/transform";
import { vec3, vec4 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import Controls from "./controls.svelte";
import help from "./help.ts";
import { state } from "./state.svelte.ts";

const CLEAR_COLOR: Vec4 = vec4.fromValues(0.02, 0.02, 0.03, 1);
const AMBIENT: Ambient = {
  sky: [0.45, 0.5, 0.6],
  ground: [0.12, 0.11, 0.1],
  intensity: 0.06,
};
const MS_PER_S = 1000;

// Sphere material: a warm clay base with an opt-in specular highlight. The
// specular RGB is fixed; specular.w (shininess) is slider-driven each frame.
const SPHERE_COLOR = new Float32Array([0.8, 0.3, 0.25, 1]);
const SPHERE_SPEC_RGB: readonly [number, number, number] = [0.6, 0.6, 0.6];
const GROUND_COLOR = new Float32Array([0.6, 0.6, 0.62, 1]);

const SPHERE_RADIUS = 0.7;
const GROUND_Y = -0.9;
const GROUND_SCALE: readonly [number, number, number] = [6, 0.1, 6];

// Point light orbit (radius + height) in world units.
const ORBIT_RADIUS = 2;
const ORBIT_HEIGHT = 1.2;

type Scene = {
  sphere: Mesh;
  ground: Mesh;
  sphereBinding: Binding;
  cam: Camera;
  t: number;
};

function specularValue(shininess: number): Float32Array {
  return new Float32Array([...SPHERE_SPEC_RGB, shininess]);
}

await mountDemo({
  help,
  controls: Controls,
  controlsProps: {
    get directional() {
      return state.directional;
    },
    get point() {
      return state.point;
    },
    get spot() {
      return state.spot;
    },
    get shininess() {
      return state.shininess;
    },
    onToggle: (key: "directional" | "point" | "spot", value: boolean) => {
      state[key] = value;
    },
    onShininess: (value: number) => {
      state.shininess = value;
    },
  },
  setup: async (ctx) => {
    const litShader = await shader.lit(ctx);

    const sphereBinding = binding.create(ctx, litShader);
    binding.set(ctx, sphereBinding, {
      color: SPHERE_COLOR,
      specular: specularValue(state.shininess),
    });
    const sphereMat = await material.create(ctx, {
      shader: litShader,
      binding: sphereBinding,
    });
    const sphereGeo = geometry.sphere(ctx, { radius: SPHERE_RADIUS });
    const sphere = mesh.create(ctx, {
      geometry: sphereGeo,
      material: sphereMat,
    });

    // Matte ground (no specular set) so attenuation falloff + the spot cone edge
    // read cleanly without a competing highlight.
    const groundBinding = binding.create(ctx, litShader);
    binding.set(ctx, groundBinding, { color: GROUND_COLOR });
    const groundMat = await material.create(ctx, {
      shader: litShader,
      binding: groundBinding,
    });
    const ground = mesh.create(ctx, {
      geometry: geometry.cube(ctx),
      material: groundMat,
    });
    mesh.setPosition(ctx, ground, vec3.fromValues(0, GROUND_Y, 0));
    mesh.setScale(
      ctx,
      ground,
      vec3.fromValues(GROUND_SCALE[0], GROUND_SCALE[1], GROUND_SCALE[2]),
    );

    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 1.5, 4),
    });
    camera.setTarget(cam, vec3.fromValues(0, 0, 0));
    camera.bindToCanvas(ctx, cam);

    const scene: Scene = { sphere, ground, sphereBinding, cam, t: 0 };
    return { scene };
  },
  frame: ({ ctx, scene, info }) => {
    scene.t += info.deltaMs / MS_PER_S;

    // Shininess is live (cheap) — write the slider value into specular.w each frame.
    binding.setUniform(
      ctx,
      scene.sphereBinding,
      "specular",
      specularValue(state.shininess),
    );

    const lights: Light[] = [];
    if (state.directional) {
      lights.push({
        type: "directional",
        direction: [-0.4, -1, -0.3],
        color: [1, 0.95, 0.88],
        intensity: 1.0,
      });
    }
    if (state.point) {
      lights.push({
        type: "point",
        position: [
          Math.cos(scene.t) * ORBIT_RADIUS,
          ORBIT_HEIGHT,
          Math.sin(scene.t) * ORBIT_RADIUS,
        ],
        color: [0.5, 0.7, 1.0],
        intensity: 2.0,
        range: 6,
      });
    }
    if (state.spot) {
      lights.push({
        type: "spot",
        position: [0, 2.5, 1.5],
        direction: [0, -1, -0.4],
        color: [1, 1, 1],
        intensity: 3.0,
        range: 8,
        innerAngle: 0.25,
        outerAngle: 0.45,
      });
    }

    frame.render(ctx, {
      meshes: [scene.ground, scene.sphere],
      camera: scene.cam,
      clearColor: CLEAR_COLOR,
      lights,
      ambient: AMBIENT,
    });
  },
});
