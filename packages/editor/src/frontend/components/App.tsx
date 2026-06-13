import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { FunctionComponent } from "react";
import type { ViewportHost } from "../../viewport-host/index.ts"; // type-only
import { ApiClientError, api, type ComponentEdit } from "../lib/api.ts";
import { EngineBuildError, loadEngine } from "../lib/engine.ts";
import { subscribeEvents } from "../lib/events.ts";
import { clickMode } from "../lib/selection.ts";
import { initialState, reduce } from "../lib/state.ts";
import { EditorContext, type EditorActions, type EditorContextValue } from "./editor-context.ts";
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

  // Hoisted so both `actions.commitComponents`/`commitSettings` and the host
  // onTransformCommit callback can suppress their own SSE echoes identically.
  // Stable: closes only over the lastLoaded ref, whose identity never changes.
  const suppressEcho = useCallback((result: { revision: number }) => {
    // Record the just-produced revision so the SSE echo skips the reload —
    // the viewport already shows it via the local preview.
    lastLoaded.current = {
      path: lastLoaded.current.path,
      revision: result.revision,
    };
  }, []);

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
        hostRef.current.setCallbacks({
          onSelect: (entityId, mods) => {
            if (entityId === null) {
              dispatch({ type: "clear-selection" });
              return;
            }
            const mode = clickMode(mods);
            // Spec §4: range-select is an EntitiesPanel-only affordance (no 3D
            // ordering). Shift in the viewport behaves like a plain replace.
            const viewportMode = mode === "range" ? "replace" : mode;
            dispatch({ type: "select-entity", id: entityId, mode: viewportMode });
          },
          onTransformCommit: (edits) => {
            const ces: ComponentEdit[] = edits.map((e) => ({
              entity: e.entityId,
              component: "transform",
              params: e.transform,
            }));
            const first = ces[0];
            if (first === undefined) return;
            const p =
              ces.length === 1
                ? api.setComponent(first.entity, first.component, first.params)
                : api.setComponentMany(ces);
            void p.then(suppressEcho);
          },
        });
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
      } else {
        // Dedup hit (e.g. our own committed edit, already previewed): no reload,
        // but adopt the fresh doc as the host's committed baseline.
        hostRef.current?.syncCommitted(view.document);
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

  const actions = useMemo<EditorActions>(
    () => ({
        previewEntity: (id, component, params) =>
          hostRef.current?.previewEntity(id, component, params),
        // Boundary cast: settings is unknown at this layer; ViewportHost.previewSettings
        // expects the narrower SceneDocument["settings"] — the daemon validates for real.
        previewSettings: (settings) =>
          hostRef.current?.previewSettings(settings as never),
        revertEntity: (id) => hostRef.current?.revertEntity(id),
        commitComponents: async (edits: ComponentEdit[]) => {
          const first = edits[0];
          const result =
            edits.length === 1 && first !== undefined
              ? await api.setComponent(first.entity, first.component, first.params)
              : await api.setComponentMany(edits);
          suppressEcho(result);
        },
        commitResource: async (table, id, entry) => {
          // Resources are NOT live-previewed in 5A: commit, then the SSE echo
          // reloads (no suppressEcho → full reload shows the change).
          await api.setResource(table, id, entry);
        },
        // settings is unknown at this layer; the daemon's setSettings validates the real shape.
        commitSettings: async (settings) => {
          const result = await api.setSettings(settings);
          suppressEcho(result);
        },
      }),
    [suppressEcho],
  );

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

  // Keep the host's selection in sync so highlight boxes and the gizmo origin
  // always track the chrome selection state.
  useEffect(() => {
    hostRef.current?.setSelection(state.selectedEntities);
  }, [state.selectedEntities]);

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
  const ctxValue: EditorContextValue = { state, dispatch, hostRef, actions };

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
