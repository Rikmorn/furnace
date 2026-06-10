import { beforeEach, expect, test } from "bun:test";
import { registerBuiltins } from "../../src/scene/builtins.ts";
import {
  defineComponent,
  resetRegistryForTests,
} from "../../src/scene/registry.ts";
import * as t from "../../src/scene/t.ts";
import type { SceneDocument } from "../../src/scene/types.ts";
import {
  CURRENT_SCENE_VERSION,
  validateDocument,
} from "../../src/scene/validate.ts";

beforeEach(() => {
  resetRegistryForTests();
  registerBuiltins();
});

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

// --- regression (slice-1 specs preserved) ---

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
    /geometr.*"missing"|"missing".*geometr/i,
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
  expect(() => validateDocument(bad)).toThrow(
    /shader.*"ghost"|"ghost".*shader/i,
  );
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
    /material.*"missing_mat"|"missing_mat".*material/i,
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

// --- new negative space (registry-driven) ---

test("rejects an unregistered component, naming entity + type + import hint", () => {
  const bad: SceneDocument = {
    ...minimal,
    entities: [
      ...minimal.entities,
      { id: "ball", components: { throwBehavior: { x: 1 } } },
    ],
  };
  expect(() => validateDocument(bad)).toThrow(
    /entity "ball".*"throwBehavior".*not registered.*imported/i,
  );
});

test("rejects an unregistered resource kind, naming table + kind + id", () => {
  const bad: SceneDocument = {
    ...minimal,
    resources: { ...minimal.resources, geometries: { g_x: { kind: "torus" } } },
  };
  expect(() => validateDocument(bad)).toThrow(/geometries.*"g_x".*"torus"/i);
});

test("rejects a non-material resource entry missing its kind", () => {
  const bad: SceneDocument = {
    ...minimal,
    resources: { ...minimal.resources, geometries: { g_x: {} } },
  };
  expect(() => validateDocument(bad)).toThrow(/geometries.*"g_x".*kind/i);
});

test("material kind defaults to standard (slice-1 docs stay valid)", () => {
  const doc: SceneDocument = {
    ...minimal,
    resources: {
      ...minimal.resources,
      materials: {
        m_red: {
          kind: "standard",
          shader: "s_unlit",
          params: { color: [1, 0, 0, 1] },
        },
      },
    },
  };
  expect(() => validateDocument(doc)).not.toThrow();
});

test("rejects an unknown resource table", () => {
  const bad = {
    ...minimal,
    resources: { ...minimal.resources, sounds: { s1: { kind: "wav" } } },
  } as unknown as SceneDocument;
  expect(() => validateDocument(bad)).toThrow(
    /unknown resource table "sounds"/i,
  );
});

test("rejects unknown extra params (strict schemas)", () => {
  const bad: SceneDocument = {
    ...minimal,
    entities: [
      {
        id: "cam",
        components: { camera: { kind: "perspective", aspect: 1, bogus: true } },
      },
    ],
  };
  expect(() => validateDocument(bad)).toThrow(/camera.*"bogus"|"bogus"/i);
});

test("rejects wrong tuple length with a path", () => {
  const bad: SceneDocument = {
    ...minimal,
    entities: [
      {
        id: "cam",
        components: {
          camera: { kind: "perspective", aspect: 1 },
          transform: { position: [0, 0] },
        },
      },
    ],
  };
  expect(() => validateDocument(bad)).toThrow(/transform.*position/i);
});

test("rejects params supplied to a paramless kind", () => {
  const bad: SceneDocument = {
    ...minimal,
    resources: {
      ...minimal.resources,
      geometries: { g_cube: { kind: "cube", size: 2 } },
    },
  };
  expect(() => validateDocument(bad)).toThrow(/geometries.*"g_cube"/i);
});

test("rejects duplicate entity ids", () => {
  const bad: SceneDocument = {
    ...minimal,
    entities: [...minimal.entities, { id: "cube", components: {} }],
  };
  expect(() => validateDocument(bad)).toThrow(/duplicate entity id "cube"/i);
});

test("settings are validated (strict)", () => {
  expect(() =>
    validateDocument({ ...minimal, settings: { clearColor: [0, 0, 0, 1] } }),
  ).not.toThrow();
  expect(() =>
    validateDocument({ ...minimal, settings: { clearColor: [0, 0] } as never }),
  ).toThrow(/settings.*clearColor/i);
  expect(() =>
    validateDocument({ ...minimal, settings: { fog: true } as never }),
  ).toThrow(/settings/i);
});

// --- the reserved M6 seam: t.ref boundary validation ---

test("t.ref: target entity must exist and carry required components", () => {
  defineComponent("follow", { params: { target: t.ref("transform") } });

  const ok: SceneDocument = {
    ...minimal,
    entities: [
      ...minimal.entities,
      { id: "f", components: { follow: { target: "cube" } } },
    ],
  };
  expect(() => validateDocument(ok)).not.toThrow();

  const missingEntity: SceneDocument = {
    ...minimal,
    entities: [
      ...minimal.entities,
      { id: "f", components: { follow: { target: "ghost" } } },
    ],
  };
  expect(() => validateDocument(missingEntity)).toThrow(
    /"f".*"target".*"ghost"/i,
  );

  const missingComponent: SceneDocument = {
    ...minimal,
    entities: [
      ...minimal.entities,
      { id: "bare", components: {} },
      { id: "f", components: { follow: { target: "bare" } } },
    ],
  };
  expect(() => validateDocument(missingComponent)).toThrow(
    /"bare".*transform/i,
  );
});
