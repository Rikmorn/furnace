import { expect, test } from "bun:test";
import {
  type EditorState,
  initialState,
  reduce,
} from "../src/frontend/lib/state.ts";

test("boot happy path: engine-ready → scenes-listed → scene-loaded", () => {
  let s: EditorState = initialState;
  s = reduce(s, { type: "engine-ready" });
  s = reduce(s, { type: "scenes", scenes: ["a.scene.json"] });
  expect(s.status).toBe("ready");
  s = reduce(s, { type: "scene-loading", path: "a.scene.json" });
  s = reduce(s, {
    type: "scene-loaded",
    doc: {
      version: 1,
      entities: [{ id: "cube", components: { transform: {} } }],
    },
  });
  expect(s.selectedScene).toBe("a.scene.json");
  expect(s.doc?.entities).toHaveLength(1);
  expect(s.error).toBeUndefined();
});

test("engine build failure is a terminal chrome-alive state with diagnostics", () => {
  const s = reduce(initialState, {
    type: "engine-error",
    diagnostics: "x.ts:3 Could not resolve",
  });
  expect(s.status).toBe("engine-error");
  expect(s.error).toContain("Could not resolve");
});

test("no-webgpu is its own state", () => {
  const s = reduce(initialState, { type: "no-webgpu" });
  expect(s.status).toBe("no-webgpu");
});

test("scene load failure keeps the previous doc and surfaces the message", () => {
  let s: EditorState = reduce(reduce(initialState, { type: "engine-ready" }), {
    type: "scenes",
    scenes: ["a.scene.json", "b.scene.json"],
  });
  s = reduce(s, { type: "scene-loading", path: "a.scene.json" });
  s = reduce(s, { type: "scene-loaded", doc: { version: 1, entities: [] } });
  const prevDoc = s.doc;
  s = reduce(s, { type: "scene-loading", path: "b.scene.json" });
  s = reduce(s, {
    type: "scene-error",
    message: 'scene: entity "x" component "y" is not registered',
  });
  expect(s.status).toBe("ready");
  expect(s.doc).toBe(prevDoc);
  expect(s.error).toContain("not registered");
});

test("entity selection", () => {
  let s: EditorState = reduce(reduce(initialState, { type: "engine-ready" }), {
    type: "scenes",
    scenes: [],
  });
  s = reduce(s, {
    type: "scene-loaded",
    doc: { version: 1, entities: [{ id: "cam", components: {} }] },
  });
  s = reduce(s, { type: "select-entity", id: "cam" });
  expect(s.selectedEntity).toBe("cam");
});
