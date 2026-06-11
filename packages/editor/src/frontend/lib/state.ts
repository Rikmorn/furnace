import type { SceneDocument } from "@furnace/core/scene";

export type EditorStatus = "booting" | "engine-error" | "no-webgpu" | "ready";

export type EditorState = {
  status: EditorStatus;
  scenes: string[];
  selectedScene?: string;
  doc?: SceneDocument;
  selectedEntity?: string;
  loading: boolean;
  error?: string;
};

export type EditorEvent =
  | { type: "engine-ready" }
  | { type: "engine-error"; diagnostics: string }
  | { type: "no-webgpu" }
  | { type: "scenes"; scenes: string[] }
  | { type: "scene-loading"; path: string }
  | { type: "scene-loaded"; doc: SceneDocument }
  | { type: "scene-error"; message: string }
  | { type: "select-entity"; id: string };

export const initialState: EditorState = {
  status: "booting",
  scenes: [],
  loading: false,
};

/** Pure state transitions — every §6 UI error state is a case here, unit-tested without DOM. */
export function reduce(s: EditorState, e: EditorEvent): EditorState {
  switch (e.type) {
    case "engine-ready":
      return { ...s, status: "ready" };
    case "engine-error":
      return { ...s, status: "engine-error", error: e.diagnostics };
    case "no-webgpu":
      return { ...s, status: "no-webgpu" };
    case "scenes":
      return { ...s, scenes: e.scenes };
    case "scene-loading":
      return { ...s, loading: true, selectedScene: e.path, error: undefined };
    case "scene-loaded":
      return { ...s, loading: false, doc: e.doc, selectedEntity: undefined };
    case "scene-error":
      return { ...s, loading: false, error: e.message }; // previous doc/viewport kept
    case "select-entity":
      return { ...s, selectedEntity: e.id };
  }
}
