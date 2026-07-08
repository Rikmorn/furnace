import type { Dispatch, RefObject, SetStateAction } from "react";
import { createContext, useContext } from "react";
import type { PreviewHost, ViewportHost } from "../../viewport-host/index.ts";
import type { ComponentEdit } from "../lib/api.ts";
import type { GenerationSession } from "../lib/generation.ts";
import type { UiStore } from "../lib/persist.ts";
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

/** The generation session lifted to App level so it survives the Generation panel being
 *  closed and reopened (dockview unmounts a removed panel). The panel is a pure CONSUMER:
 *  it reads `session`/`wingName` and drives them through these App-owned setters. Because
 *  the setters are App state (stable identity), an in-flight run's async setter calls land
 *  in App state even after the panel unmounts. `cancelRef` is App-owned for the same reason
 *  — a panel-local ref would be recreated on remount, orphaning the running loop. */
export type GenerationControl = {
  session: GenerationSession;
  setSession: Dispatch<SetStateAction<GenerationSession>>;
  /** The bake destination (regions/<name>) — independent of generation config. */
  wingName: string;
  setWingName: Dispatch<SetStateAction<string>>;
  /** In-flight run cancel flag; App-owned so Cancel works across a panel close/reopen. */
  cancelRef: RefObject<boolean>;
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
  /** The lifted generation session (Slice 3.2.2 Task 6) the GenerationPanel consumes. */
  generation: GenerationControl;
  /** Per-project UI persistence store (Task 6). Undefined when the project root couldn't
   *  be resolved (persistence best-effort). The inspector reads/writes `inspectorCollapse`
   *  through it to remember each section's open state. */
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
