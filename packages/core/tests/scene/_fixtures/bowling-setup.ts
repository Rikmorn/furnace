import type { SceneDocument } from "../../../src/scene/types.ts";

// A committed bowling-*setup* scene document (no behavior, no simulation) that
// exercises EVERY registered built-in kind/component/setting. It is the keystone
// fixture: `bowling-setup.gpu.test.ts` proves it loads + renders headless
// GPU-validation-clean via `@furnace/core` alone, and Task 14's round-trip test
// reuses this same artifact. Keep it data-only — it must validate clean via
// `validateDocument` and load with no engine coupling beyond the registry.
//
// Textures are checkerboard-only (procedural, GPU-side): the `load` texture kind
// needs `createImageBitmap`, which is browser-only and absent in the headless
// (bun-webgpu) gate. Checkerboard covers the textured-material path end to end.

/** Number of pins in the setup. A few is enough to exercise the cylinder
 *  geometry + dynamic-cylinder rigidBody + textured-material path repeatedly. */
const PIN_COUNT = 3;
/** Lane half-extents (X,Y,Z) for the static cuboid collider, in metres. */
const LANE_HALF_EXTENTS: [number, number, number] = [1, 0.1, 5];
/** Ball radius, in metres (sphere geometry + ball collider). */
const BALL_RADIUS = 0.22;
/** Pin collider dimensions: half-height + radius (cylinder geometry + rigidBody), in metres. */
const PIN_HALF_HEIGHT = 0.19;
const PIN_RADIUS = 0.06;

/** Build the `id → entity` doc for the `PIN_COUNT` pins. Each pin is a
 *  texturedLit cylinder with a dynamic cylinder rigidBody, spread along +X at
 *  the far end of the lane. */
function pinEntities(): SceneDocument["entities"] {
  return Array.from({ length: PIN_COUNT }, (_, i) => ({
    id: `pin_${i}`,
    components: {
      transform: { position: [(i - 1) * 0.3, PIN_HALF_HEIGHT, -4] },
      meshRenderer: { geometry: "g_pin", material: "m_pin" },
      rigidBody: {
        type: "dynamic",
        shape: {
          cylinder: { halfHeight: PIN_HALF_HEIGHT, radius: PIN_RADIUS },
        },
        friction: 0.3,
        restitution: 0.1,
        density: 1,
        linearDamping: 0.05,
        angularDamping: 0.05,
      },
    },
  }));
}

/**
 * The committed bowling-setup `SceneDocument`. Exercises the full built-in set:
 * - geometries: `cube` (lane), `sphere` (ball), `cylinder` (pins)
 * - textures: `checkerboard` (lane + pins)
 * - shaders: `texturedLit` (lane/pins), `unlit` (ball)
 * - materials: `standard` with a nested `texture` ref (lane/pins, exercises the
 *   recursive resolver) and `standard` with a `color` param (ball)
 * - effects: `bloom` + `tonemap`, chained via `settings.post`
 * - lights: `directional` WITH `shadow`, `point`, `spot`
 * - components: `transform`, `meshRenderer`, `camera`, `light`, `rigidBody`
 *   (static cuboid + dynamic ball + dynamic cylinder)
 * - settings: `clearColor`, `ambient`, `post`, `hdr`, `msaa`, `gravity`,
 *   `lengthUnit`, `sim`
 */
export function bowlingSetupDoc(): SceneDocument {
  return {
    version: 1,
    settings: {
      clearColor: [0.02, 0.02, 0.04, 1],
      ambient: {
        sky: [0.5, 0.6, 0.8],
        ground: [0.2, 0.18, 0.15],
        intensity: 0.4,
      },
      post: ["fx_bloom", "fx_tonemap"],
      hdr: true,
      msaa: 4,
      gravity: [0, -9.81, 0],
      lengthUnit: 1,
      sim: { fixedHz: 60 },
    },
    resources: {
      geometries: {
        g_lane: { kind: "cube" },
        g_ball: { kind: "sphere", radius: BALL_RADIUS },
        g_pin: {
          kind: "cylinder",
          radius: PIN_RADIUS,
          height: PIN_HALF_HEIGHT * 2,
        },
      },
      textures: {
        tex_wood: {
          kind: "checkerboard",
          cells: 8,
          colorA: [0.55, 0.4, 0.25],
          colorB: [0.35, 0.24, 0.14],
          mipmaps: true,
        },
      },
      shaders: {
        s_textured_lit: { kind: "texturedLit" },
        s_unlit: { kind: "unlit" },
      },
      materials: {
        // Nested texture ref (texture.texture) → exercises the loader's nested-resource-ref resolution end to end.
        m_lane: { shader: "s_textured_lit", texture: { texture: "tex_wood" } },
        m_pin: { shader: "s_textured_lit", texture: { texture: "tex_wood" } },
        // Color param branch (texture XOR color — never both on one material).
        m_ball: { shader: "s_unlit", params: { color: [0.1, 0.2, 0.9, 1] } },
      },
      effects: {
        fx_bloom: { kind: "bloom" },
        fx_tonemap: { kind: "tonemap" },
      },
    },
    entities: [
      {
        id: "camera",
        components: {
          camera: {
            kind: "perspective",
            aspect: 800 / 600,
            fovYRad: 0.9,
            near: 0.1,
            far: 100,
          },
          transform: { position: [0, 2, 4] },
        },
      },
      {
        id: "lane",
        components: {
          transform: { position: [0, -0.1, 0] },
          meshRenderer: { geometry: "g_lane", material: "m_lane" },
          rigidBody: { type: "static", shape: { cuboid: LANE_HALF_EXTENTS } },
        },
      },
      {
        id: "ball",
        components: {
          transform: { position: [0, BALL_RADIUS, 3] },
          meshRenderer: { geometry: "g_ball", material: "m_ball" },
          rigidBody: {
            type: "dynamic",
            shape: { ball: BALL_RADIUS },
            density: 4,
          },
        },
      },
      ...pinEntities(),
      {
        id: "sun",
        components: {
          // Aimed down-and-forward; shadow opt-in fills DirectionalShadow defaults.
          transform: { rotation: [-0.38, 0, 0, 0.92] },
          light: {
            type: "directional",
            color: [1, 0.97, 0.9],
            intensity: 2.5,
            shadow: { orthoHalfExtent: 6, near: 0.1, far: 30 },
          },
        },
      },
      {
        id: "fill",
        components: {
          transform: { position: [2, 3, 2] },
          light: {
            type: "point",
            color: [0.6, 0.7, 1],
            intensity: 4,
            range: 12,
          },
        },
      },
      {
        id: "spot",
        components: {
          transform: { position: [-2, 4, 1], rotation: [-0.5, 0, 0, 0.87] },
          light: {
            type: "spot",
            color: [1, 1, 0.95],
            intensity: 5,
            range: 15,
            innerAngle: 0.3,
            outerAngle: 0.5,
          },
        },
      },
    ],
  };
}
