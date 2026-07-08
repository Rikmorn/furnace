import { expect, test } from "bun:test";
import { SETTINGS_SELECTION } from "../src/frontend/lib/selection.ts";
import {
  type EditorState,
  initialState,
  reduce,
} from "../src/frontend/lib/state.ts";

const sessionUpdate = (over: Record<string, unknown> = {}) =>
  ({
    type: "session-updated",
    doc: {
      version: 1,
      entities: [{ id: "cube", components: { transform: {} } }],
    },
    path: "a.scene.json",
    revision: 1,
    dirty: false,
    conflict: false,
    canUndo: false,
    canRedo: false,
    ...over,
  }) as Parameters<typeof reduce>[1];

test("boot happy path: engine-ready → scenes → session-updated", () => {
  let s: EditorState = initialState;
  s = reduce(s, { type: "engine-ready" });
  s = reduce(s, { type: "scenes", scenes: ["a.scene.json"] });
  expect(s.status).toBe("ready");
  s = reduce(s, { type: "scene-loading", path: "a.scene.json" });
  s = reduce(s, sessionUpdate());
  expect(s.selectedScene).toBe("a.scene.json");
  expect(s.doc?.entities).toHaveLength(1);
  expect(s.loading).toBe(false);
  expect(s.revision).toBe(1);
  expect(s.dirty).toBe(false);
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

test("generation-active toggles the preview-owns-viewport flag", () => {
  expect(initialState.generationActive).toBe(false);
  let s = reduce(initialState, { type: "generation-active", active: true });
  expect(s.generationActive).toBe(true);
  s = reduce(s, { type: "generation-active", active: false });
  expect(s.generationActive).toBe(false);
});

test("scene load failure keeps the previous doc and surfaces the message", () => {
  let s: EditorState = reduce(reduce(initialState, { type: "engine-ready" }), {
    type: "scenes",
    scenes: ["a.scene.json", "b.scene.json"],
  });
  s = reduce(s, sessionUpdate());
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

test("dirty/conflict flags track the session; file-invalid is a notice", () => {
  let s: EditorState = reduce(initialState, sessionUpdate({ dirty: true }));
  expect(s.dirty).toBe(true);
  s = reduce(s, sessionUpdate({ conflict: true, dirty: true, revision: 2 }));
  expect(s.conflict).toBe(true);
  expect(s.revision).toBe(2);
  s = reduce(s, {
    type: "file-invalid",
    message: "scenes/a.scene.json is not valid JSON",
  });
  expect(s.notice).toContain("not valid JSON");
  // The next session update clears the notice.
  s = reduce(s, sessionUpdate({ revision: 3 }));
  expect(s.notice).toBeUndefined();
});

test("entity selection survives updates that keep the entity, clears otherwise", () => {
  let s: EditorState = reduce(initialState, sessionUpdate());
  s = reduce(s, { type: "select-entity", id: "cube", mode: "replace" });
  expect(s.selectedEntities).toEqual(["cube"]);
  s = reduce(s, sessionUpdate({ revision: 2 }));
  expect(s.selectedEntities).toEqual(["cube"]);
  s = reduce(
    s,
    sessionUpdate({
      revision: 3,
      doc: { version: 1, entities: [{ id: "other", components: {} }] },
    }),
  );
  expect(s.selectedEntities).toEqual([]);
});

test("replace select sets a single-element selection + anchor", () => {
  let s = reduce(
    initialState,
    sessionUpdate({
      doc: {
        version: 1,
        entities: [
          { id: "a", components: {} },
          { id: "b", components: {} },
        ],
      },
    }),
  );
  s = reduce(s, { type: "select-entity", id: "a", mode: "replace" });
  expect(s.selectedEntities).toEqual(["a"]);
});

test("toggle adds then removes without losing the rest", () => {
  let s = reduce(
    initialState,
    sessionUpdate({
      doc: {
        version: 1,
        entities: [
          { id: "a", components: {} },
          { id: "b", components: {} },
          { id: "c", components: {} },
        ],
      },
    }),
  );
  s = reduce(s, { type: "select-entity", id: "a", mode: "replace" });
  s = reduce(s, { type: "select-entity", id: "c", mode: "toggle" });
  expect(s.selectedEntities.sort()).toEqual(["a", "c"]);
  s = reduce(s, { type: "select-entity", id: "a", mode: "toggle" });
  expect(s.selectedEntities).toEqual(["c"]);
});

test("$settings is exclusively single-select: entity toggle drops it, and vice-versa", () => {
  let s = reduce(
    initialState,
    sessionUpdate({
      doc: {
        version: 1,
        entities: [
          { id: "a", components: {} },
          { id: "b", components: {} },
        ],
      },
    }),
  );
  // Select World, then cmd/ctrl-click an entity → the sentinel is dropped (not appended).
  s = reduce(s, {
    type: "select-entity",
    id: SETTINGS_SELECTION,
    mode: "replace",
  });
  expect(s.selectedEntities).toEqual([SETTINGS_SELECTION]);
  s = reduce(s, { type: "select-entity", id: "a", mode: "toggle" });
  expect(s.selectedEntities).toEqual(["a"]);
  // Now select two entities, then click World → it replaces the whole selection.
  s = reduce(s, { type: "select-entity", id: "b", mode: "toggle" });
  expect(s.selectedEntities.sort()).toEqual(["a", "b"]);
  s = reduce(s, {
    type: "select-entity",
    id: SETTINGS_SELECTION,
    mode: "toggle",
  });
  expect(s.selectedEntities).toEqual([SETTINGS_SELECTION]);
});

test("range selects the inclusive span from anchor to target in doc order", () => {
  let s = reduce(
    initialState,
    sessionUpdate({
      doc: {
        version: 1,
        entities: [
          { id: "a", components: {} },
          { id: "b", components: {} },
          { id: "c", components: {} },
          { id: "d", components: {} },
        ],
      },
    }),
  );
  s = reduce(s, { type: "select-entity", id: "b", mode: "replace" });
  s = reduce(s, { type: "select-entity", id: "d", mode: "range" });
  expect(s.selectedEntities).toEqual(["b", "c", "d"]);
});

test("session-updated prunes vanished entities from the selection", () => {
  let s = reduce(
    initialState,
    sessionUpdate({
      doc: {
        version: 1,
        entities: [
          { id: "a", components: {} },
          { id: "b", components: {} },
        ],
      },
    }),
  );
  s = reduce(s, { type: "select-entity", id: "a", mode: "replace" });
  s = reduce(s, { type: "select-entity", id: "b", mode: "toggle" });
  s = reduce(
    s,
    sessionUpdate({
      doc: { version: 1, entities: [{ id: "b", components: {} }] },
    }),
  );
  expect(s.selectedEntities).toEqual(["b"]);
});

test("replace select sets selectionAnchor to the chosen entity", () => {
  let s = reduce(
    initialState,
    sessionUpdate({
      doc: {
        version: 1,
        entities: [
          { id: "a", components: {} },
          { id: "b", components: {} },
        ],
      },
    }),
  );
  s = reduce(s, { type: "select-entity", id: "a", mode: "replace" });
  expect(s.selectionAnchor).toBe("a");
});

test("reverse range (anchor after target) selects the same inclusive span in doc order", () => {
  let s = reduce(
    initialState,
    sessionUpdate({
      doc: {
        version: 1,
        entities: [
          { id: "a", components: {} },
          { id: "b", components: {} },
          { id: "c", components: {} },
          { id: "d", components: {} },
        ],
      },
    }),
  );
  s = reduce(s, { type: "select-entity", id: "d", mode: "replace" });
  s = reduce(s, { type: "select-entity", id: "b", mode: "range" });
  expect(s.selectedEntities).toEqual(["b", "c", "d"]);
});
