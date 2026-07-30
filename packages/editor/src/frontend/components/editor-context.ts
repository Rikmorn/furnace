import type { RefObject } from "react";
import { createContext, useContext } from "react";
import type {
  FieldHost,
  ViewFlags,
  ViewportHost,
} from "../../viewport-host/index.ts";
import type { ComponentEdit } from "../lib/api.ts";
import type { UiStore } from "../lib/persist.ts";
import type { EditorEvent, EditorState } from "../lib/state.ts";
import type { ConfirmRequest } from "./ConfirmDialog.tsx";

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
  /** The field dig-loop host (F1) — the Field panel mounts its canvas + drives dig/save/bake.
   *  App-owned (created once at engine-ready) so it survives the panel being closed/reopened. */
  fieldHostRef: RefObject<FieldHost | undefined>;
  /** The engine bundle's `extensions` namespace (the consumer's generator surface),
   *  crossing the project-first bundle boundary as an untyped record. A consumer of it
   *  narrows it at its own seam (with `// Boundary cast:` comments). */
  extensions: Record<string, unknown>;
  actions: EditorActions;
  /** Viewport view flags (Task 9), App-level so the overlay popover and the View▸View-flags
   *  menu share one source. `axes` gates the corner triad; the rest gate host rendering. */
  viewFlags: ViewFlags;
  /** Toggle one view flag: updates App state, persists it, and pushes to the viewport host. */
  setViewFlag: (key: keyof ViewFlags, value: boolean) => void;
  /** Open the ONE in-chrome confirm dialog (App-owned, `useConfirmDialog`) — the
   *  only prompt seam a panel may use; `window.confirm` is banned. App's state
   *  machine refuses to clobber a pending prompt and fires each request's
   *  callbacks exactly once, and its `confirmRef` suppresses every global
   *  keybinding while one is open — none of which a panel-local dialog would get. */
  openConfirm: (request: ConfirmRequest) => void;
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
