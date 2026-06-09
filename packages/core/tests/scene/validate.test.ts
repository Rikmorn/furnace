// packages/core/tests/scene/validate.test.ts
import { expect, test } from "bun:test";
import type { SceneDocument } from "../../src/scene/types.ts";
import {
  CURRENT_SCENE_VERSION,
  validateDocument,
} from "../../src/scene/validate.ts";

const minimal: SceneDocument = {
  version: CURRENT_SCENE_VERSION,
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
        transform: { position: [0, 0, 0] },
        meshRenderer: { geometry: "g_cube", material: "m_red" },
      },
    },
  ],
};

test("accepts a well-formed document", () => {
  expect(() => validateDocument(minimal)).not.toThrow();
});

test("rejects a future/mismatched version (loud fail at the boundary)", () => {
  expect(() => validateDocument({ ...minimal, version: 999 })).toThrow(
    /version/i,
  );
});

test("rejects a meshRenderer referencing an unknown geometry id", () => {
  const bad: SceneDocument = {
    ...minimal,
    entities: [
      {
        id: "x",
        components: {
          meshRenderer: { geometry: "missing", material: "m_red" },
        },
      },
    ],
  };
  expect(() => validateDocument(bad)).toThrow(
    /geometry.*missing|missing.*geometry/i,
  );
});

test("rejects a material referencing an unknown shader id", () => {
  const bad: SceneDocument = {
    ...minimal,
    resources: {
      ...minimal.resources,
      materials: { m_red: { shader: "ghost" } },
    },
  };
  expect(() => validateDocument(bad)).toThrow(/shader.*ghost|ghost.*shader/i);
});

test("rejects a meshRenderer referencing an unknown material id", () => {
  const bad: SceneDocument = {
    ...minimal,
    entities: [
      {
        id: "x",
        components: {
          meshRenderer: { geometry: "g_cube", material: "missing_mat" },
        },
      },
    ],
  };
  expect(() => validateDocument(bad)).toThrow(
    /material.*missing_mat|missing_mat.*material/i,
  );
});

test("rejects a document with a missing entities field", () => {
  expect(() =>
    validateDocument({
      version: CURRENT_SCENE_VERSION,
      entities: undefined as unknown as [],
    }),
  ).toThrow(/entities/i);
});
