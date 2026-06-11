import type { RefObject } from "react";
import { createContext, useContext } from "react";
import type { ViewportHost } from "../../viewport-host/index.ts";
import type { EditorEvent, EditorState } from "../lib/state.ts";

/** Live editor state shared with the dockview panels through React context
 *  (panels are portaled, so closure props can't carry live state — see App). */
export type EditorContextValue = {
  state: EditorState;
  dispatch: (e: EditorEvent) => void;
  hostRef: RefObject<ViewportHost | undefined>;
};

export const EditorContext = createContext<EditorContextValue | null>(null);

/** Read the editor context; throws if a panel is rendered outside the provider. */
export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx)
    throw new Error("editor panel rendered outside <EditorContext.Provider>");
  return ctx;
}
