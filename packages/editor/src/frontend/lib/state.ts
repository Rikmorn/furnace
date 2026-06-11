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
  /** Daemon session read-model fields (undefined until a scene is open). */
  revision?: number;
  dirty: boolean;
  conflict: boolean;
  /** Transient warning (e.g. the watched file became invalid on disk). */
  notice?: string;
};

export type EditorEvent =
  | { type: "engine-ready" }
  | { type: "engine-error"; diagnostics: string }
  | { type: "no-webgpu" }
  | { type: "scenes"; scenes: string[] }
  | { type: "scene-loading"; path: string }
  | {
      type: "session-updated";
      doc: SceneDocument;
      path: string;
      revision: number;
      dirty: boolean;
      conflict: boolean;
    }
  | { type: "scene-error"; message: string }
  | { type: "file-invalid"; message: string }
  | { type: "select-entity"; id: string };

export const initialState: EditorState = {
  status: "booting",
  scenes: [],
  loading: false,
  dirty: false,
  conflict: false,
};

/** Pure state transitions — every UI state is a case here, unit-tested without DOM. */
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
    case "session-updated": {
      const selectedEntity = e.doc.entities.some(
        (entity) => entity.id === s.selectedEntity,
      )
        ? s.selectedEntity
        : undefined;
      return {
        ...s,
        loading: false,
        doc: e.doc,
        selectedScene: e.path,
        revision: e.revision,
        dirty: e.dirty,
        conflict: e.conflict,
        selectedEntity,
        error: undefined,
        notice: undefined,
      };
    }
    case "scene-error":
      return { ...s, loading: false, error: e.message }; // previous doc/viewport kept
    case "file-invalid":
      return { ...s, notice: e.message };
    case "select-entity":
      return { ...s, selectedEntity: e.id };
  }
}
