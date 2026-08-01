import type { RefObject } from "react";
import { createContext, useContext } from "react";
import type { FieldHost } from "../../viewport-host/index.ts";
import type { UiStore } from "../lib/persist.ts";
import type { EditorState } from "../lib/state.ts";
import type { ConfirmRequest } from "./ConfirmDialog.tsx";

/**
 * How the chrome hands the keyboard back to the viewport (F4.5c Task 10).
 *
 * `CanvasHost` INSTALLS this on mount and clears it on unmount, so the ref is `null`
 * while the engine is still booting, after an init failure, and in any test that renders
 * a panel without a canvas — every reader therefore treats absence as "there is no
 * viewport to return to" rather than as an error.
 *
 * It exists because the canvas holds its own keydown listener (the fly set, `[` / `]`,
 * the arrow nudges) which fires only while the canvas has focus, and Radix returns focus
 * to an overlay's TRIGGER on dismiss. Without a callable focus verb, "put the user back
 * on the canvas" had no expressible form — `CanvasHost` kept its element ref private.
 */
export type ViewportFocus = {
  /** Put focus on the canvas. */
  focus: () => void;
  /**
   * Did the canvas hold focus when the user gesture now in progress BEGAN?
   *
   * THE WHOLE RULE, in one sentence, and it is a question about the GESTURE rather than
   * about this instant on purpose. By the time an overlay is open it is far too late to
   * ask: a browser focuses a clicked trigger on mousedown, and Radix's `FocusScope` then
   * moves focus INTO the content from a mount effect (verified in
   * @radix-ui/react-focus-scope 1.1.12) — so `document.activeElement === canvas` is false
   * at every open edge, for a mouse open and a keyboard one alike. Reading it there would
   * be a condition that never fires in a browser and only appears to work under a harness
   * that does not move focus on a click.
   *
   * So the answer is recorded at the START of every gesture — a capture-phase
   * `pointerdown` or `keydown` on the document, both of which run before the focus
   * transfer they cause — and an overlay asks for it as it opens. A pointer open asks
   * about its own pointerdown; a keyboard open asks about the ⏎/Space that ran the
   * trigger, by which time the user has already Tabbed onto it and the answer is
   * correctly no.
   */
  heldFocusAtGestureStart: () => boolean;
};

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
  /** Whether a world write is in flight, as a ref. The daemon feed (`useDaemonFeed`)
   *  reads it to refuse the `bundle-outdated` hard reload while one is running — that
   *  subscription re-binds only when the engine becomes ready, so it cannot read live
   *  state, and a reload mid-upload would kill the write. The shell's world verbs are
   *  the writers. */
  bakeBusyRef: RefObject<boolean>;
  /** The viewport focus seam ({@link ViewportFocus}), as a ref: App creates it,
   *  `CanvasHost` fills it, and every dismissible overlay reads it through
   *  `useViewportFocusReturn`. A ref rather than state because it is filled in an effect
   *  by a component far BELOW the provider — the `fieldHostRef` shape, one level down —
   *  and because its readers are event handlers that must see the current value without
   *  re-binding. */
  viewportFocusRef: RefObject<ViewportFocus | null>;
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
