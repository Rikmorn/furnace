import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { FunctionComponent } from "react";
import type { ViewportHost } from "../../viewport-host/index.ts"; // type-only
import { ApiClientError, api } from "../lib/api.ts";
import { EngineBuildError, loadEngine } from "../lib/engine.ts";
import { subscribeEvents } from "../lib/events.ts";
import { initialState, reduce } from "../lib/state.ts";
import { EditorContext, type EditorContextValue } from "./editor-context.ts";
import { EntitiesPanel } from "./EntitiesPanel.tsx";
import { InspectPanel } from "./InspectPanel.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { Viewport } from "./Viewport.tsx";

// Module-level so its identity is stable across App renders: dockview reads the
// factory only at panel construction, so a fresh map per render would freeze the
// mounted panels on their first render. The panels take no props and read live
// state via EditorContext instead.
const COMPONENTS: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  entities: EntitiesPanel,
  viewport: Viewport,
  inspect: InspectPanel,
};

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const hostRef = useRef<ViewportHost | undefined>(undefined);
  const lastLoaded = useRef<{ path?: string; revision?: number }>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.gpu) {
        dispatch({ type: "no-webgpu" });
        return;
      }
      try {
        const engine = await loadEngine();
        if (cancelled) return;
        hostRef.current = engine.createViewportHost();
        dispatch({ type: "engine-ready" });
        const { scenes } = await api.sceneList();
        if (!cancelled) dispatch({ type: "scenes", scenes });
      } catch (err) {
        const diagnostics =
          err instanceof EngineBuildError ? err.message : String(err);
        if (!cancelled) dispatch({ type: "engine-error", diagnostics });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The single doc-refresh path: pull the read model, reload the viewport only
  // when (path, revision) actually advanced. Every SSE event and every locally
  // initiated change funnels through here — one code path, every client.
  const refreshSession = useCallback(async () => {
    try {
      const view = await api.sceneGet();
      if (
        view.path !== lastLoaded.current.path ||
        view.revision !== lastLoaded.current.revision
      ) {
        await hostRef.current?.loadScene(view.document);
        // Assign AFTER the await so a genuine loadScene failure does not poison
        // the dedup cache — the next SSE event will retry rather than skip.
        lastLoaded.current = { path: view.path, revision: view.revision };
      }
      dispatch({
        type: "session-updated",
        doc: view.document,
        path: view.path,
        revision: view.revision,
        dirty: view.dirty,
        conflict: view.conflict,
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "no-session") return;
      dispatch({
        type: "scene-error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    if (state.status !== "ready") return;
    return subscribeEvents({
      onOpen: () => void refreshSession(),
      onEvent: (event) => {
        if (event.type === "file-invalid") {
          dispatch({ type: "file-invalid", message: event.message });
          return;
        }
        // A fresh session (scene.open resets revision to 0) must always reload,
        // even if (path, revision) collides with what's already loaded.
        if (event.type === "scene-opened") lastLoaded.current = {};
        void refreshSession();
      },
    });
  }, [state.status, refreshSession]);

  const selectScene = useCallback(
    async (path: string) => {
      dispatch({ type: "scene-loading", path });
      try {
        await api.sceneOpen(path);
        // No loadScene here: the scene-opened SSE event drives refreshSession —
        // the chrome rides the same change feed as every other client.
      } catch (err) {
        if (err instanceof ApiClientError && err.code === "unsaved-changes") {
          if (window.confirm("The open scene has unsaved changes. Discard them?")) {
            try {
              await api.sceneOpen(path, true);
            } catch (err2) {
              dispatch({
                type: "scene-error",
                message: err2 instanceof Error ? err2.message : String(err2),
              });
            }
          } else {
            void refreshSession(); // clears `loading`, restores the current view
          }
          return;
        }
        dispatch({
          type: "scene-error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [refreshSession],
  );

  const onReady = useCallback((event: DockviewReadyEvent) => {
    event.api.addPanel({
      id: "entities",
      component: "entities",
      title: "Entities",
    });
    event.api.addPanel({
      id: "viewport",
      component: "viewport",
      title: "Viewport",
      position: { referencePanel: "entities", direction: "right" },
    });
    event.api.addPanel({
      id: "inspect",
      component: "inspect",
      title: "Inspect",
      position: { referencePanel: "viewport", direction: "right" },
    });
  }, []);

  // Fresh object each render — that is intentional: a new context value on every
  // state change is what forces the portaled panel consumers to re-render.
  const ctxValue: EditorContextValue = { state, dispatch, hostRef };

  return (
    <div className="flex h-screen flex-col">
      <Toolbar state={state} onSelectScene={selectScene} />
      <EditorContext.Provider value={ctxValue}>
        <div className="min-h-0 flex-1">
          <DockviewReact
            className="dockview-theme-dark h-full"
            components={COMPONENTS}
            onReady={onReady}
          />
        </div>
      </EditorContext.Provider>
      <StatusBar state={state} />
    </div>
  );
}
