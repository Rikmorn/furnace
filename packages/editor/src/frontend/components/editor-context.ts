import type { Dispatch, RefObject, SetStateAction } from "react";
import { createContext, useContext } from "react";
import type {
  PreviewHost,
  ViewFlags,
  ViewportHost,
} from "../../viewport-host/index.ts";
import type { ComponentEdit } from "../lib/api.ts";
import type { WorldGenSession } from "../lib/generation.ts";
import type { GenerationWorkerClient } from "../lib/generation-client.ts";
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

/** The generation session lifted to App level so it survives the World panel being
 *  closed and reopened (dockview unmounts a removed panel). The panel is a pure CONSUMER:
 *  it reads `session` and drives it through these App-owned setters. Because the setters
 *  are App state (stable identity), an in-flight run's async setter calls land in App
 *  state even after the panel unmounts. `client` is App-owned for the same reason —
 *  a panel-local worker client would be recreated on remount, orphaning the running worker
 *  (Slice 3.2.3: run/bake on a worker; cancel = terminate, instant mid-attempt). W1: the
 *  cockpit drives the WORLD flow (runWorld/bakeWorld); the wing session/bake modules stay.
 *  W3: the bake destination rides IN the session (the draft's own `name`). */
export type GenerationControl = {
  session: WorldGenSession;
  setSession: Dispatch<SetStateAction<WorldGenSession>>;
  /** The App-owned generation worker client (Slice 3.2.3): runWorld/bakeWorld/cancel. */
  client: GenerationWorkerClient;
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
   *  crossing the project-first bundle boundary as an untyped record. The World panel
   *  is the SINGLE seam that narrows it (with `// Boundary cast:` comments). */
  extensions: Record<string, unknown>;
  actions: EditorActions;
  /** The lifted generation session (Slice 3.2.2 Task 6) the WorldPanel consumes. */
  generation: GenerationControl;
  /** Viewport view flags (Task 9), App-level so the overlay popover and the View▸View-flags
   *  menu share one source. `axes` gates the corner triad; the rest gate host rendering. */
  viewFlags: ViewFlags;
  /** Toggle one view flag: updates App state, persists it, and pushes to the viewport host. */
  setViewFlag: (key: keyof ViewFlags, value: boolean) => void;
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
