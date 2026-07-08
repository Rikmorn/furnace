import type { RefObject } from "react";
import { createContext, useContext } from "react";
import type { PreviewHost, ViewportHost } from "../../viewport-host/index.ts";
import type { ComponentEdit } from "../lib/api.ts";
import type { EditorEvent, EditorState } from "../lib/state.ts";

/** Preview/commit actions the inspector drives; implemented in App (owns host + dedup). */
export type EditorActions = {
  previewEntity(
    entityId: string,
    component: string,
    params: Record<string, unknown>,
  ): void;
  previewSettings(settings: unknown): void;
  revertEntity(entityId: string): void;
  commitComponents(edits: ComponentEdit[]): Promise<void>;
  commitResource(
    table: string,
    id: string,
    entry: Record<string, unknown>,
  ): Promise<void>;
  commitSettings(settings: unknown): Promise<void>;
  /** Persist the session to disk (⌘S / File▸Save). */
  save(): Promise<void>;
  /** Step the session's undo/redo history (⌘Z / ⇧⌘Z). SSE drives the reload. */
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** Remove the current selection, one daemon op per entity (each its own undo step). */
  deleteSelection(): Promise<void>;
  /** Frame the selection in the viewport. No-op until Task 10 lands the host method. */
  frameSelection(): void;
};

/** Live editor state shared with the dockview panels through React context
 *  (panels are portaled, so closure props can't carry live state — see App). */
export type EditorContextValue = {
  state: EditorState;
  dispatch: (e: EditorEvent) => void;
  hostRef: RefObject<ViewportHost | undefined>;
  /** The cockpit preview host (Slice 3.1) — the generation panel realizes into it. */
  previewHostRef: RefObject<PreviewHost | undefined>;
  /** The engine bundle's `extensions` namespace (the consumer's generator surface),
   *  crossing the project-first bundle boundary as an untyped record. The generation
   *  panel is the SINGLE seam that narrows it (with `// Boundary cast:` comments). */
  extensions: Record<string, unknown>;
  actions: EditorActions;
};

export const EditorContext = createContext<EditorContextValue | null>(null);

/** Read the editor context; throws if a panel is rendered outside the provider. */
export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx)
    throw new Error("editor panel rendered outside <EditorContext.Provider>");
  return ctx;
}
