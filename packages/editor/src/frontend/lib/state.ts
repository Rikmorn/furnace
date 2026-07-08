import type { SceneDocument } from "@furnace/core/scene";
import { SETTINGS_SELECTION } from "./selection.ts";

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
  /** Undo/redo availability from the session read-model (drives the Edit menu +
   *  toolbar cluster). Both false until a scene is open. */
  canUndo: boolean;
  canRedo: boolean;
  /** Transient warning (e.g. the watched file became invalid on disk). */
  notice?: string;
  /** True while the generation panel owns the viewport (preview canvas shown). */
  generationActive: boolean;
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
      canUndo: boolean;
      canRedo: boolean;
    }
  | { type: "scene-error"; message: string }
  | { type: "file-invalid"; message: string }
  | { type: "select-entity"; id: string; mode: "replace" | "toggle" | "range" }
  | { type: "clear-selection" }
  | { type: "generation-active"; active: boolean };

export const initialState: EditorState = {
  status: "booting",
  scenes: [],
  selectedEntities: [],
  loading: false,
  dirty: false,
  conflict: false,
  canUndo: false,
  canRedo: false,
  generationActive: false,
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
      // The World/settings sentinel is a virtual selection, not a doc entity — preserve
      // it across a refresh so a settings edit + its SSE echo keeps World selected.
      const selectedEntities = s.selectedEntities.filter(
        (id) => id === SETTINGS_SELECTION || ids.has(id),
      );
      return {
        ...s,
        loading: false,
        doc: e.doc,
        selectedScene: e.path,
        revision: e.revision,
        dirty: e.dirty,
        conflict: e.conflict,
        canUndo: e.canUndo,
        canRedo: e.canRedo,
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
      // The World/settings sentinel is exclusively single-select — it never coexists with
      // real entities on any path, so selecting it always replaces the selection.
      if (e.id === SETTINGS_SELECTION)
        return { ...s, selectedEntities: [e.id], selectionAnchor: e.id };
      if (e.mode === "toggle") {
        // Drop the sentinel before toggling a real entity so World + an entity are never
        // both highlighted (mutually exclusive selection).
        const base = s.selectedEntities.filter(
          (id) => id !== SETTINGS_SELECTION,
        );
        const has = base.includes(e.id);
        return {
          ...s,
          selectedEntities: has
            ? base.filter((id) => id !== e.id)
            : [...base, e.id],
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
    case "generation-active":
      return { ...s, generationActive: e.active };
  }
}
