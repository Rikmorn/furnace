import { describe, expect, test } from "bun:test";
import type { SceneDocument } from "@furnace/core/scene";
import { transformEditNeedsRebuild } from "../../src/viewport-host/preview-gate.ts";

// A doc with one of each: a directional light, a mesh-only entity, a camera.
const doc: SceneDocument = {
  version: 1,
  entities: [
    {
      id: "sun",
      components: {
        transform: { rotation: [0, 0, 0, 1] },
        light: { type: "directional", color: [1, 1, 1], intensity: 1 },
      },
    },
    {
      id: "cube",
      components: {
        transform: { position: [0, 0, 0] },
        meshRenderer: { geometry: "g", material: "m" },
      },
    },
    {
      id: "cam",
      components: {
        transform: { position: [0, 0, 3] },
        camera: { kind: "perspective", aspect: 1 },
      },
    },
  ],
};

describe("transformEditNeedsRebuild", () => {
  test("true for a light entity — its direction is transform-derived", () => {
    expect(transformEditNeedsRebuild(doc, "sun")).toBe(true);
  });

  test("false for a mesh-only entity — mesh transforms are all the fast-path touches", () => {
    expect(transformEditNeedsRebuild(doc, "cube")).toBe(false);
  });

  test("true for a camera entity — its look direction is transform-derived", () => {
    expect(transformEditNeedsRebuild(doc, "cam")).toBe(true);
  });

  test("false for an unknown entity id", () => {
    expect(transformEditNeedsRebuild(doc, "nope")).toBe(false);
  });
});
