/** How far the engine bundle got. The names are the ones the panels guard on
 *  (`state.status !== "ready"`), unchanged from the scene-era reducer. */
export type EditorStatus = "booting" | "engine-error" | "no-webgpu" | "ready";

/** The whole editor-level state: engine boot status and, on failure, why. Everything
 *  else the chrome shows is panel-local or lives in the field host. */
export type EditorState = {
  status: EditorStatus;
  /** The engine build diagnostics, set only by `engine-error`. */
  error?: string;
};

export type EditorEvent =
  | { type: "engine-ready" }
  | { type: "engine-error"; diagnostics: string }
  | { type: "no-webgpu" };

export const initialState: EditorState = { status: "booting" };

/** Pure state transitions — every UI state is a case here, unit-tested without DOM. */
export function reduce(s: EditorState, e: EditorEvent): EditorState {
  switch (e.type) {
    case "engine-ready":
      return { ...s, status: "ready" };
    case "engine-error":
      return { ...s, status: "engine-error", error: e.diagnostics };
    case "no-webgpu":
      return { ...s, status: "no-webgpu" };
  }
}
