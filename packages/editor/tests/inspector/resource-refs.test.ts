import { expect, test } from "bun:test";
import {
  collectResourceRefs,
  referencedResourceKeys,
} from "../../src/frontend/inspector/lib/resource-refs.ts";
import type { JsonSchemaNode } from "../../src/frontend/inspector/types.ts";

const MESH_RENDERER: JsonSchemaNode = {
  type: "object",
  properties: {
    geometry: {
      type: "string",
      furnace: { kind: "resource", table: "geometries" },
    },
    material: {
      type: "string",
      furnace: { kind: "resource", table: "materials" },
    },
  },
};

const NESTED: JsonSchemaNode = {
  type: "object",
  properties: {
    inner: {
      type: "object",
      properties: {
        tex: {
          type: "string",
          furnace: { kind: "resource", table: "textures" },
        },
      },
    },
  },
};

test("collectResourceRefs pulls (table,id) pairs from resource-kind fields", () => {
  const refs = collectResourceRefs(MESH_RENDERER, {
    geometry: "g_cube",
    material: "m1",
  });
  expect(refs).toEqual([
    { table: "geometries", id: "g_cube" },
    { table: "materials", id: "m1" },
  ]);
});

test("collectResourceRefs recurses into nested object fields", () => {
  const refs = collectResourceRefs(NESTED, { inner: { tex: "t_wall" } });
  expect(refs).toEqual([{ table: "textures", id: "t_wall" }]);
});

test("collectResourceRefs ignores empty / missing ref values", () => {
  expect(
    collectResourceRefs(MESH_RENDERER, { geometry: "", material: "m1" }),
  ).toEqual([{ table: "materials", id: "m1" }]);
  expect(collectResourceRefs(MESH_RENDERER, {})).toEqual([]);
});

const reflection = {
  components: { meshRenderer: MESH_RENDERER },
  resources: {
    // A material entry references a shader — transitive closure must reach it.
    materials: {
      standard: {
        type: "object",
        properties: {
          shader: {
            type: "string",
            furnace: { kind: "resource", table: "shaders" },
          },
        },
      } as JsonSchemaNode,
    },
    geometries: { cube: { type: "object", properties: {} } as JsonSchemaNode },
    shaders: { lit: { type: "object", properties: {} } as JsonSchemaNode },
  },
};

const resources = {
  materials: { m0: { shader: "s_lit" }, m1: { shader: "s_lit" } },
  geometries: { g_cube: { kind: "cube" } },
  shaders: { s_lit: { kind: "lit" } },
};

test("referencedResourceKeys collects an entity's direct refs, transitively closed", () => {
  const keys = referencedResourceKeys(
    [{ components: { meshRenderer: { geometry: "g_cube", material: "m1" } } }],
    reflection,
    resources,
  );
  // Direct: geometries:g_cube, materials:m1. Transitive: materials m1 → shaders:s_lit.
  expect([...keys].sort()).toEqual([
    "geometries:g_cube",
    "materials:m1",
    "shaders:s_lit",
  ]);
  // The unreferenced material m0 is NOT in the set.
  expect(keys.has("materials:m0")).toBe(false);
});

test("referencedResourceKeys is empty for a selection with no resource refs", () => {
  const keys = referencedResourceKeys(
    [{ components: { transform: { position: [0, 0, 0] } } }],
    reflection,
    resources,
  );
  expect(keys.size).toBe(0);
});
