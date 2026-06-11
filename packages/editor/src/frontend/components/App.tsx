import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { FunctionComponent } from "react";
import type { ViewportHost } from "../../viewport-host/index.ts"; // type-only
import { api } from "../lib/api.ts";
import { EngineBuildError, loadEngine } from "../lib/engine.ts";
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

  const selectScene = useCallback(async (path: string) => {
    dispatch({ type: "scene-loading", path });
    try {
      const { document } = await api.sceneRead(path);
      await hostRef.current?.loadScene(document);
      dispatch({ type: "scene-loaded", doc: document });
    } catch (err) {
      dispatch({
        type: "scene-error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

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
