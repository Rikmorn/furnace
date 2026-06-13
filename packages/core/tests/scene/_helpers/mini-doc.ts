import type { SceneDocument } from "../../../src/scene/types.ts";

/**
 * Minimal valid SceneDocument with:
 * - one cube geometry resource ("g_cube") with a unit cube
 * - one unlit shader ("s_unlit")
 * - one material ("m_red")
 * - a camera entity ("cam") at [0,0,3]
 * - a mesh entity ("cube") at position [10,0,0]
 */
export function miniDoc(): SceneDocument {
  return {
    version: 1,
    resources: {
      geometries: { g_cube: { kind: "cube" } },
      shaders: { s_unlit: { kind: "unlit" } },
      materials: {
        m_red: { shader: "s_unlit", params: { color: [1, 0, 0, 1] } },
      },
    },
    entities: [
      {
        id: "cam",
        components: {
          camera: { kind: "perspective", aspect: 1 },
          transform: { position: [0, 0, 3] },
        },
      },
      {
        id: "cube",
        components: {
          transform: { position: [10, 0, 0] },
          meshRenderer: { geometry: "g_cube", material: "m_red" },
        },
      },
    ],
  };
}

/**
 * Minimal valid SceneDocument with ONLY a camera entity — no mesh entities.
 * Used to exercise the zero-entries path in `pickEntity` (entries.length === 0):
 * the id texture is cleared to 0, readback returns 0, pick returns null.
 */
export function emptyDoc(): SceneDocument {
  return {
    version: 1,
    resources: {},
    entities: [
      {
        id: "cam",
        components: {
          camera: { kind: "perspective", aspect: 1 },
          transform: { position: [0, 0, 3] },
        },
      },
    ],
  };
}

/**
 * Valid SceneDocument with TWO unit cubes on screen for GPU id-buffer picking:
 * - a cube entity ("left") at position [-1.5, 0, 0]
 * - a cube entity ("right") at position [1.5, 0, 0]
 * - a camera entity ("cam") at [0, 0, 6] looking down -Z (origin in view)
 *
 * At fov π/4 / aspect 1 / camera-distance 6, each cube center projects to
 * NDC x ≈ ±0.60 and the cubes span NDC x ≈ [0.40, 0.81] (right) / [-0.81, -0.40]
 * (left), so a pick at NDC x=±0.5, y=0 lands cleanly inside one cube, and a
 * corner (NDC -0.98, 0.98) is empty background.
 */
export function twoCubeDoc(): SceneDocument {
  return {
    version: 1,
    resources: {
      geometries: { g_cube: { kind: "cube" } },
      shaders: { s_unlit: { kind: "unlit" } },
      materials: {
        m_red: { shader: "s_unlit", params: { color: [1, 0, 0, 1] } },
      },
    },
    entities: [
      {
        id: "cam",
        components: {
          camera: { kind: "perspective", aspect: 1 },
          transform: { position: [0, 0, 6] },
        },
      },
      {
        id: "left",
        components: {
          transform: { position: [-1.5, 0, 0] },
          meshRenderer: { geometry: "g_cube", material: "m_red" },
        },
      },
      {
        id: "right",
        components: {
          transform: { position: [1.5, 0, 0] },
          meshRenderer: { geometry: "g_cube", material: "m_red" },
        },
      },
    ],
  };
}
