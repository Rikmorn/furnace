import type { ShaderSource } from "./source.ts";
import { source } from "./source.ts";

/**
 * The engine **Scene** binding at `@group(0) @binding(1)`: the `Light` struct
 * (std140-safe vec4 lanes) + the `Scene` uniform (hemisphere ambient + a fixed
 * `array<Light, 16>`). Compose this into a custom shader and pass
 * `shader.create(ctx, src, { usesScene: true })` to receive the engine's
 * per-frame lights. Engine-managed and written by `frame.render` from
 * `RenderOptions.lights`/`ambient`.
 */
export const sceneBinding: ShaderSource = source(
  `struct Light {
  posRange : vec4<f32>,
  dirType  : vec4<f32>,
  colorInt : vec4<f32>,
  spotCos  : vec4<f32>,
};
struct Scene {
  ambientSky    : vec4<f32>,
  ambientGround : vec4<f32>,
  lightCount    : vec4<u32>,
  _reserved     : vec4<f32>,
  lights        : array<Light, 16>,
};
@group(0) @binding(1) var<uniform> scene: Scene;`,
);
