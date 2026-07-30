import type { RefObject } from "react";
import { createContext, useContext } from "react";
import type { FieldHost } from "../../viewport-host/index.ts";
import type { UiStore } from "../lib/persist.ts";
import type { EditorState } from "../lib/state.ts";
import type { ConfirmRequest } from "./ConfirmDialog.tsx";

/** Live editor state, shared with the whole chrome through React context: App owns it
 *  (engine boot, the host, the confirm dialog, the persistence store) and the shell and
 *  its panels read it wherever they sit in the tree. */
export type EditorContextValue = {
  state: EditorState;
  /** The field dig-loop host (F1) — the shell's CanvasHost inits it on the one
   *  full-window canvas; the field panel drives dig/save/bake through it. App-owned
   *  (created once at engine-ready) so its lifetime is the editor's. */
  fieldHostRef: RefObject<FieldHost | undefined>;
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
  /** The pending confirm request, as a ref. The other half of the seam above: the
   *  global keydown listener reads it to suppress EVERY binding while a prompt is
   *  open. A ref rather than state on purpose — the listener binds once and must see
   *  the current value without re-binding on each prompt. */
  confirmRef: RefObject<ConfirmRequest | null>;
  /** Whether a world write is in flight, as a ref. App's SSE handler reads it to refuse
   *  the `bundle-outdated` hard reload while one is running — that closure re-subscribes
   *  only on [state.status], so it cannot read live state, and a reload mid-upload would
   *  kill the write. The shell's world verbs are the writers. */
  bakeBusyRef: RefObject<boolean>;
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
