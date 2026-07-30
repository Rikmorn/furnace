import type { RefObject } from "react";
import { createContext, useContext } from "react";
import type { FieldHost } from "../../viewport-host/index.ts";
import type { UiStore } from "../lib/persist.ts";
import type { EditorEvent, EditorState } from "../lib/state.ts";
import type { ConfirmRequest } from "./ConfirmDialog.tsx";

/** Live editor state shared with the dockview panels through React context
 *  (panels are portaled, so closure props can't carry live state — see App). */
export type EditorContextValue = {
  state: EditorState;
  dispatch: (e: EditorEvent) => void;
  /** The field dig-loop host (F1) — the Field panel mounts its canvas + drives dig/save/bake.
   *  App-owned (created once at engine-ready) so it survives the panel being closed/reopened. */
  fieldHostRef: RefObject<FieldHost | undefined>;
  /** The engine bundle's `extensions` namespace (the consumer's own surface), crossing the
   *  project-first bundle boundary as an untyped record. A consumer of it narrows it at its
   *  own seam (with `// Boundary cast:` comments). */
  extensions: Record<string, unknown>;
  /** Bumped on every daemon `worlds-changed` / `generation-baked` event: the worlds
   *  directory on disk moved. Anything rendering the world list refetches when it
   *  changes — a version counter rather than a payload, because the events are
   *  notification-only dirty-bits (daemon/events.ts). */
  worldsVersion: number;
  /** Open the ONE in-chrome confirm dialog (App-owned, `useConfirmDialog`) — the
   *  only prompt seam a panel may use; `window.confirm` is banned. App's state
   *  machine refuses to clobber a pending prompt and fires each request's
   *  callbacks exactly once, and its `confirmRef` suppresses every global
   *  keybinding while one is open — none of which a panel-local dialog would get. */
  openConfirm: (request: ConfirmRequest) => void;
  /** Per-project UI persistence store. Undefined when the project root couldn't be
   *  resolved (persistence best-effort). */
  store: UiStore | undefined;
};

export const EditorContext = createContext<EditorContextValue | null>(null);

/** Read the editor context; throws if a panel is rendered outside the provider. */
export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx)
    throw new Error("editor panel rendered outside <EditorContext.Provider>");
  return ctx;
}
