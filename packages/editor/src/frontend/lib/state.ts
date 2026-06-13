import type { SceneDocument } from "@furnace/core/scene";

export type EditorStatus = "booting" | "engine-error" | "no-webgpu" | "ready";

export type EditorState = {
  status: EditorStatus;
  scenes: string[];
  selectedScene?: string;
  doc?: SceneDocument;
  selectedEntities: string[];
  selectionAnchor?: string;
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
  | { type: "select-entity"; id: string; mode: "replace" | "toggle" | "range" }
  | { type: "clear-selection" };

export const initialState: EditorState = {
  status: "booting",
  scenes: [],
  selectedEntities: [],
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
      const ids = new Set(e.doc.entities.map((entity) => entity.id));
      const selectedEntities = s.selectedEntities.filter((id) => ids.has(id));
      return {
        ...s,
        loading: false,
        doc: e.doc,
        selectedScene: e.path,
        revision: e.revision,
        dirty: e.dirty,
        conflict: e.conflict,
        selectedEntities,
        selectionAnchor: ids.has(s.selectionAnchor ?? "")
          ? s.selectionAnchor
          : undefined,
        error: undefined,
        notice: undefined,
      };
    }
    case "scene-error":
      return { ...s, loading: false, error: e.message }; // previous doc/viewport kept
    case "file-invalid":
      return { ...s, notice: e.message };
    case "select-entity": {
      if (e.mode === "toggle") {
        const has = s.selectedEntities.includes(e.id);
        return {
          ...s,
          selectedEntities: has
            ? s.selectedEntities.filter((id) => id !== e.id)
            : [...s.selectedEntities, e.id],
          selectionAnchor: e.id,
        };
      }
      if (e.mode === "range" && s.selectionAnchor && s.doc) {
        const order = s.doc.entities.map((entity) => entity.id);
        const from = order.indexOf(s.selectionAnchor);
        const to = order.indexOf(e.id);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from <= to ? [from, to] : [to, from];
          return { ...s, selectedEntities: order.slice(lo, hi + 1) };
        }
      }
      return { ...s, selectedEntities: [e.id], selectionAnchor: e.id };
    }
    case "clear-selection":
      return { ...s, selectedEntities: [], selectionAnchor: undefined };
  }
}
