import type { ShaderSource } from "./source.ts";
import { source } from "./source.ts";

/**
 * The engine **Scene** binding at `@group(0) @binding(1)`: the `Light` struct
 * (std140-safe vec4 lanes — `posRange`, `dirType`, `colorInt`, `spotCos`, and a
 * `shadow` lane packing `(slot, depthBias, normalBias, _)`) + the `Scene` uniform
 * (hemisphere ambient, a fixed `array<Light, 16>`, and a `shadowMatrices` tail of
 * per-caster light-space view-projection matrices). Compose this into a custom
 * shader and pass `shader.create(ctx, src, { usesScene: true })` to receive the
 * engine's per-frame lights. Engine-managed and written by `frame.render` from
 * `RenderOptions.lights`/`ambient` (and shadow casters when `usesShadows`).
 */
export const sceneBinding: ShaderSource = source(
  `struct Light {
  posRange : vec4<f32>,
  dirType  : vec4<f32>,
  colorInt : vec4<f32>,
  spotCos  : vec4<f32>,
  shadow   : vec4<f32>,
};
struct Scene {
  ambientSky    : vec4<f32>,
  ambientGround : vec4<f32>,
  lightCount    : vec4<u32>,
  fog           : vec4<f32>, // rgb = fog color, a = density (0 = disabled)
  lights        : array<Light, 16>,
  // literal 4 must equal MAX_SHADOW_CASTERS in frame/lights.ts.
  shadowMatrices : array<mat4x4<f32>, 4>,
};
@group(0) @binding(1) var<uniform> scene: Scene;`,
);
