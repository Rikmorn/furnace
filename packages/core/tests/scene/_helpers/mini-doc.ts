import type { SceneDocument } from "../../../src/scene/types.ts";

/**
 * Minimal valid SceneDocument with:
 * - one cube geometry resource ("g_cube") with a unit cube
 * - one unlit shader ("s_unlit")
 * - one material ("m_red")
 * - a camera entity ("cam") at [0,0,3]
 * - a mesh entity ("cube") at position [10,0,0]
 *
 * Will be extended in Task 6 with `twoCubeDoc`.
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
