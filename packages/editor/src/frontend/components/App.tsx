import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { FunctionComponent } from "react";
import type {
  PreviewHost,
  ViewFlags,
  ViewportHost,
} from "../../viewport-host/index.ts"; // type-only
import { ApiClientError, api, type ComponentEdit } from "../lib/api.ts";
import { EngineBuildError, loadEngine } from "../lib/engine.ts";
import { subscribeEvents } from "../lib/events.ts";
import { initialSession } from "../lib/generation.ts";
import { isTextInputTarget, matchBinding } from "../lib/keybindings.ts";
import { PANELS, type PanelId, panelTitle } from "../lib/panels.ts";
import { createUiStore, DEFAULT_VIEW_FLAGS, pushRecent } from "../lib/persist.ts";
import { clickMode, SETTINGS_SELECTION } from "../lib/selection.ts";
import { initialState, reduce } from "../lib/state.ts";
import { resolveCssColor } from "../lib/theme.ts";
import { ConfirmDialog, type ConfirmRequest } from "./ConfirmDialog.tsx";
import { EditorContext, type EditorActions, type EditorContextValue } from "./editor-context.ts";
import { EntitiesPanel } from "./EntitiesPanel.tsx";
import { GenerationPanel } from "./GenerationPanel.tsx";
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
  generation: GenerationPanel,
};

// Persisted-list caps: the File▸Recent menu and the seed-history write-back stay bounded
// so a long session can't bloat the per-project localStorage blob (a critique finding).
const RECENT_SCENES_CAP = 8;
const SEED_HISTORY_CAP = 50;
// Trailing-debounce the layout write: onDidLayoutChange fires per pointermove frame during a
// splitter drag, but each write JSON-stringifies the whole UiState blob — persist once settled.
const LAYOUT_SAVE_DEBOUNCE_MS = 200;

// The default layout's dockview positions per panel — the one piece that legitimately isn't
// in PANELS (which owns id/title/component). The first panel has none; the rest anchor to the
// previously-added panel. Iterating PANELS + this table keeps the initial layout in sync with
// the View▸Panels toggles from a single PANELS edit.
type PanelPosition = { referencePanel: PanelId; direction: "right" | "below" };
const DEFAULT_PANEL_POSITION: Partial<Record<PanelId, PanelPosition>> = {
  viewport: { referencePanel: "entities", direction: "right" },
  inspect: { referencePanel: "viewport", direction: "right" },
  generation: { referencePanel: "inspect", direction: "below" },
};

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const hostRef = useRef<ViewportHost | undefined>(undefined);
  // The cockpit preview host + the consumer generator surface, both created once the
  // engine bundle loads and threaded to the GenerationPanel via context (Slice 3.1).
  const previewHostRef = useRef<PreviewHost | undefined>(undefined);
  const extensionsRef = useRef<Record<string, unknown>>({});
  const lastLoaded = useRef<{ path?: string; revision?: number }>({});
  // Mirrors state.dirty for the SSE onEvent closure below, whose effect only
  // re-subscribes on [state.status, refreshSession] — reading state.dirty
  // directly there would see a stale value from subscribe time.
  const dirtyRef = useRef(false);
  // The in-chrome confirm dialog (replaces window.confirm). `confirmRef` mirrors
  // the state synchronously so BOTH: (a) `openConfirm` refuses to clobber an
  // already-pending prompt, and the keydown listener suppresses every binding while
  // one is open (a second prompt would strand the first's onCancel — e.g. the
  // discard-scene prompt's refreshSession that clears `loading`); and (b)
  // `resolveConfirm` fires each request's callback exactly once — the guard also
  // absorbs a rapid double-click that lands while Radix's exit-animation `Presence`
  // still has the dialog (and its buttons) mounted.
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const confirmRef = useRef<ConfirmRequest | null>(null);
  // Latest selection + undo/redo availability, read by the window keydown listener
  // (which binds once and must not close over stale state).
  const latest = useRef<{
    selection: string[];
    canUndo: boolean;
    canRedo: boolean;
  }>({ selection: [], canUndo: false, canRedo: false });

  // Per-project UI persistence. The project root comes from the daemon (project.get);
  // `storeResolved` gates the dockview render so onReady sees the store (and, if project.get
  // fails, still mounts dockview with persistence disabled rather than a blank editor).
  const [projectRoot, setProjectRoot] = useState<string | undefined>(undefined);
  const [storeResolved, setStoreResolved] = useState(false);
  const store = useMemo(
    () =>
      projectRoot ? createUiStore(window.localStorage, projectRoot) : undefined,
    [projectRoot],
  );
  const dockApiRef = useRef<DockviewApi | undefined>(undefined);
  // Trailing-debounce timer for the layout write (cleared on unmount).
  const layoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Which panels are currently in the layout + the recent-scenes list — mirrored into
  // React state so the View▸Panels checkmarks and File▸Recent menu re-render on change.
  const [panelIds, setPanelIds] = useState<string[]>([]);
  const [recentScenes, setRecentScenes] = useState<string[]>([]);
  // Gate the seed-history write-back until the store has been read once, so the first
  // store-ready render can't overwrite a persisted history with the pre-seed empty array.
  const [historyHydrated, setHistoryHydrated] = useState(false);

  // Viewport view flags (Task 9), App-level so the overlay popover and the View▸View-flags
  // menu are a single source. Seeded from the persisted blob (below); pushed to the host by
  // a dedicated effect so the initial value and every change take one code path.
  const [viewFlags, setViewFlags] = useState<ViewFlags>(DEFAULT_VIEW_FLAGS);

  // The generation session lifted out of GenerationPanel (Task 6): App owns it so it
  // survives the panel being closed/reopened and an in-flight run keeps updating it after
  // the panel unmounts. See editor-context.ts GenerationControl for the full rationale.
  const [generation, setGeneration] = useState(initialSession);
  const [wingName, setWingName] = useState("generated-wing");
  const generationCancelRef = useRef(false);
  // Mirrors whether a run/bake is in flight for the SSE bundle-outdated guard (that closure
  // re-subscribes only on [state.status, refreshSession], so it can't read live generation).
  const generationBusyRef = useRef(false);

  const openConfirm = useCallback((request: ConfirmRequest) => {
    if (confirmRef.current) return; // never clobber a pending prompt
    confirmRef.current = request;
    setConfirm(request);
  }, []);

  const resolveConfirm = useCallback((confirmed: boolean) => {
    const request = confirmRef.current;
    if (!request) return; // already settled — absorb a double-fire
    confirmRef.current = null;
    setConfirm(null);
    if (confirmed) request.onConfirm();
    else request.onCancel?.();
  }, []);

  // The single scene-error dispatch (extracted — used by every catch below).
  const reportError = useCallback((err: unknown) => {
    dispatch({
      type: "scene-error",
      message: err instanceof Error ? err.message : String(err),
    });
  }, []);

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
        // Resolve the design tokens to engine colours ONCE at engine-ready: the
        // selection highlight derives from --primary (the single attention lane),
        // and the viewport clear from --viewport-background (content-vs-chrome
        // tonal separation). Both go through a canvas-2D readback (oklch→sRGB); the
        // per-token fallbacks are the provisional token values, so a resolve miss
        // degrades to a sensible steel-blue / near-black rather than a loud colour.
        hostRef.current = engine.createViewportHost({
          accentColor: resolveCssColor("--primary", [0.36, 0.58, 0.8]),
          viewportBackground: resolveCssColor(
            "--viewport-background",
            [0.12, 0.12, 0.13],
          ),
          // Reference-grid neutral from a muted token; major lines use it, minor lines
          // are drawn dimmer by the host. Exact shade is a Task 12 live-tuning concern.
          gridColor: resolveCssColor("--muted-foreground", [0.42, 0.42, 0.46]),
        });
        // Slice 3.1: the preview host + the consumer's generator surface. Assigned
        // BEFORE the engine-ready dispatch so both are live once the panels mount.
        previewHostRef.current = engine.createPreviewHost();
        extensionsRef.current = engine.extensions;
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

  // Fetch the project root (fast local call, independent of the engine bundle) to key the
  // persistence store. `storeResolved` flips on both success and failure so the dockview
  // render un-gates either way.
  useEffect(() => {
    let cancelled = false;
    api
      .projectGet()
      .then(({ root }) => {
        if (!cancelled) setProjectRoot(root);
      })
      .catch(() => {
        // Persistence is best-effort: without a root the store stays disabled.
      })
      .finally(() => {
        if (!cancelled) setStoreResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Seed the persisted UI slices into state once the store is available. Setting
  // `historyHydrated` here (rather than a ref) keeps the write-back below from firing on
  // this same commit — it reads a still-false flag and skips, so the persisted history is
  // never clobbered by the pre-seed empty array.
  useEffect(() => {
    if (!store) return;
    setRecentScenes(store.get("recentScenes") ?? []);
    const storedHistory = store.get("seedHistory");
    if (storedHistory && storedHistory.length > 0) {
      setGeneration((g) => ({ ...g, history: storedHistory }));
    }
    // Merge persisted flags over the defaults so a partial/older blob still yields a full set.
    const storedFlags = store.get("viewFlags");
    if (storedFlags) {
      setViewFlags({ ...DEFAULT_VIEW_FLAGS, ...storedFlags });
    }
    setHistoryHydrated(true);
  }, [store]);

  // Single sync path for view flags: push to the host AND persist on ready and on every
  // change (so the persisted-seeded value lands too). Keeping the store write here — not in
  // the setViewFlag handler — leaves the state updater pure. store.set doesn't re-render, so
  // this doesn't loop; the seed-from-store below runs once and lands one idempotent write.
  // Runs before any scene loads; render() no-ops until one is loaded, so an early push is safe.
  useEffect(() => {
    if (state.status !== "ready") return;
    hostRef.current?.setViewFlags(viewFlags);
    store?.set("viewFlags", viewFlags);
  }, [state.status, viewFlags, store]);

  // Toggle one view flag (mirrored by overlay + menu). Pure functional updater — the host
  // push + persistence live in the effect above, so there is one sync path.
  const setViewFlag = useCallback((key: keyof ViewFlags, value: boolean) => {
    setViewFlags((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Persist reroll history (capped) whenever it changes — bounded so a long session can't
  // bloat the stored blob. Gated on hydration so it never runs before the seed above.
  useEffect(() => {
    if (!store || !historyHydrated) return;
    store.set("seedHistory", generation.history.slice(0, SEED_HISTORY_CAP));
  }, [store, historyHydrated, generation.history]);

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
        // Only re-init the editor camera when the scene itself changed (open /
        // switch). A same-scene revision bump (resource commit, external file
        // edit) reloads the document but must preserve the user's orbit/zoom.
        const isNewScene = view.path !== lastLoaded.current.path;
        await hostRef.current?.loadScene(view.document, {
          resetCamera: isNewScene,
        });
        // On a NEW scene, prefer a persisted per-doc camera pose over the host's default
        // framing (restore after loadScene, which framed the content). A same-scene
        // revision bump keeps the user's current orbit (resetCamera=false above).
        if (isNewScene) {
          const storedPose = store?.get("cameraByDoc")?.[view.path];
          if (storedPose) hostRef.current?.setCameraPose(storedPose);
        }
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
        canUndo: view.canUndo,
        canRedo: view.canRedo,
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "no-session") return;
      reportError(err);
    }
  }, [reportError, store]);

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
        save: async () => {
          try {
            const result = await api.save();
            // Save doesn't advance the revision (it persists + clears dirty), so
            // suppressEcho is a formality; the direct refresh gives immediate
            // dirty=false feedback without waiting for the `saved` SSE round-trip.
            suppressEcho(result);
            void refreshSession();
          } catch (err) {
            // ⌘S can fire with no scene open — swallow that, surface real failures.
            if (err instanceof ApiClientError && err.code === "no-session") return;
            reportError(err);
          }
        },
        // undo/redo bump the revision and emit `document-changed`; the SSE echo
        // funnels through refreshSession → loadScene, so they do NOT suppressEcho
        // and do NOT refresh directly (that would double-apply or dedup-hide).
        undo: async () => {
          try {
            await api.undo();
          } catch (err) {
            if (err instanceof ApiClientError && err.code === "nothing-to-undo")
              return;
            reportError(err);
          }
        },
        redo: async () => {
          try {
            await api.redo();
          } catch (err) {
            if (err instanceof ApiClientError && err.code === "nothing-to-redo")
              return;
            reportError(err);
          }
        },
        deleteSelection: async () => {
          // One daemon op per entity so each removal is its own undo step. NO
          // suppressEcho here: unlike a component commit, the viewport never
          // previewed a removal, so the change must actually reload — the final
          // refresh (and the SSE echoes) advance past lastLoaded → loadScene.
          try {
            for (const id of latest.current.selection) {
              if (id === SETTINGS_SELECTION) continue; // sentinel is not a doc entity
              await api.removeEntity(id);
            }
          } catch (err) {
            reportError(err);
          }
          dispatch({ type: "clear-selection" });
          void refreshSession();
        },
        // Task 10 lands the host method; optional call is a no-op till then.
        // Boundary cast: frameSelection is a forward-declared host member not yet
        // on the ViewportHost type (Task 10) — remove the cast when it lands.
        frameSelection: () =>
          (
            hostRef.current as { frameSelection?: () => void } | undefined
          )?.frameSelection?.(),
      }),
    [suppressEcho, refreshSession, reportError],
  );

  useEffect(() => {
    dirtyRef.current = state.dirty;
  }, [state.dirty]);

  useEffect(() => {
    const phase = generation.status.phase;
    generationBusyRef.current = phase === "running" || phase === "baking";
  }, [generation.status]);

  useEffect(() => {
    latest.current = {
      selection: state.selectedEntities,
      canUndo: state.canUndo,
      canRedo: state.canRedo,
    };
  }, [state.selectedEntities, state.canUndo, state.canRedo]);

  // Delete routing shared by the ⌫ keybinding and Edit▸Delete: >1 entity prompts
  // (in-chrome confirm), a single entity deletes straight away, none is a no-op.
  const requestDelete = useCallback(() => {
    // The World/settings sentinel is not deletable — drop it before counting.
    const selection = latest.current.selection.filter(
      (id) => id !== SETTINGS_SELECTION,
    );
    if (selection.length === 0) return;
    if (selection.length > 1) {
      openConfirm({
        title: "Delete entities?",
        message: `Delete ${selection.length} selected entities? This can be undone.`,
        confirmLabel: "Delete",
        destructive: true,
        onConfirm: () => void actions.deleteSelection(),
      });
      return;
    }
    void actions.deleteSelection();
  }, [actions, openConfirm]);

  // Global keybindings. Binds once (actions is stable) and reads live selection /
  // undo-redo availability from `latest`. preventDefault fires on EVERY match so
  // ⌘S never triggers the browser save-page — the whole point of the P0 fix.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A confirm dialog is modal: suppress EVERY binding until it resolves, or a
      // second openConfirm would strand the first (its onCancel never runs).
      if (confirmRef.current) return;
      const action = matchBinding(e, isTextInputTarget(e.target));
      if (!action) return;
      e.preventDefault();
      switch (action) {
        case "save":
          void actions.save();
          return;
        case "undo":
          if (latest.current.canUndo) void actions.undo();
          return;
        case "redo":
          if (latest.current.canRedo) void actions.redo();
          return;
        case "frame":
          actions.frameSelection();
          return;
        case "delete":
          requestDelete();
          return;
        default:
          // Exhaustiveness guard: a new BindingAction that isn't cased above is a
          // compile error here (Tasks 6/9 add bindings).
          action satisfies never;
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, requestDelete]);

  useEffect(() => {
    document.title = state.selectedScene
      ? `${state.selectedScene}${state.dirty ? " ●" : ""} — furnace`
      : "furnace editor";
  }, [state.selectedScene, state.dirty]);

  useEffect(() => {
    if (state.status !== "ready") return;
    return subscribeEvents({
      onOpen: () => void refreshSession(),
      onEvent: (event) => {
        if (event.type === "bundle-outdated") {
          // Generator/extension source changed: the engine bundle is stale. Reload
          // when no unsaved work is at risk; otherwise leave the choice to the user
          // (the status bar shows dirty state — a stale engine is preferable to
          // losing edits). Also refuse the auto-reload while a generation run/bake is
          // in flight — a hard reload would kill it mid-run. 3.2's chrome rework owns a
          // proper notice UX.
          if (!dirtyRef.current && !generationBusyRef.current) {
            window.location.reload();
          }
          return;
        }
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
  // always track the chrome selection state. The World/settings sentinel has no 3D
  // presence, so it never reaches the viewport.
  useEffect(() => {
    hostRef.current?.setSelection(
      state.selectedEntities.filter((id) => id !== SETTINGS_SELECTION),
    );
  }, [state.selectedEntities]);

  // Record a scene open into the persistence store: `lastScene` (restored on next launch)
  // and the recent-scenes list (most-recent-first, deduped, capped). Reads the current list
  // from the store rather than closing over state, so it stays correct without a dep churn.
  const recordSceneVisit = useCallback(
    (path: string) => {
      if (!store) return;
      store.set("lastScene", path);
      const next = pushRecent(
        store.get("recentScenes") ?? [],
        path,
        RECENT_SCENES_CAP,
      );
      store.set("recentScenes", next);
      setRecentScenes(next);
    },
    [store],
  );

  const selectScene = useCallback(
    async (path: string) => {
      dispatch({ type: "scene-loading", path });
      try {
        await api.sceneOpen(path);
        // Record ONLY after a confirmed successful open — never at the top. A cancelled
        // discard prompt or a failed open must not write lastScene/recentScenes, or the
        // next-launch restore would silently reopen a scene the user declined to open.
        recordSceneVisit(path);
        // No loadScene here: the scene-opened SSE event drives refreshSession —
        // the chrome rides the same change feed as every other client.
      } catch (err) {
        if (err instanceof ApiClientError && err.code === "unsaved-changes") {
          openConfirm({
            title: "Discard unsaved changes?",
            message: `The open scene has unsaved changes. Opening ${path} will discard them.`,
            confirmLabel: "Discard & open",
            destructive: true,
            onConfirm: async () => {
              try {
                await api.sceneOpen(path, true);
                recordSceneVisit(path); // only after the forced open succeeds
              } catch (err2) {
                reportError(err2);
              }
            },
            // clears `loading`, restores the current view
            onCancel: () => void refreshSession(),
          });
          return;
        }
        reportError(err);
      }
    },
    [refreshSession, openConfirm, reportError, recordSceneVisit],
  );

  // Reflect the live dockview panel set into React state so the View▸Panels menu tracks it.
  // Bails out (returns the same array ref) when the ordered id set is unchanged, so a
  // per-frame resize fire during a splitter drag doesn't re-render Toolbar/MenuBar — only an
  // actual panel add/remove does.
  const syncPanels = useCallback(() => {
    const ids = dockApiRef.current?.panels.map((p) => p.id) ?? [];
    setPanelIds((prev) =>
      prev.length === ids.length && prev.every((id, i) => id === ids[i])
        ? prev
        : ids,
    );
  }, []);

  // The default layout (Entities | Viewport | Inspect / Generation-below), built by iterating
  // PANELS so a title/id edit there flows to the initial layout, the toggle menu, and re-add.
  const addDefaultLayout = useCallback((dockApi: DockviewApi) => {
    for (const { id, title } of PANELS) {
      const position = DEFAULT_PANEL_POSITION[id];
      dockApi.addPanel({
        id,
        component: id,
        title,
        ...(position ? { position } : {}),
      });
    }
  }, []);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      dockApiRef.current = event.api;
      const saved = store?.get("layout");
      let restored = false;
      if (saved) {
        try {
          // Boundary cast: the store holds `unknown`; toJSON() produced a SerializedDockview
          // and fromJSON round-trips it. A corrupt/incompatible blob throws → default layout.
          event.api.fromJSON(saved as SerializedDockview);
          restored = true;
        } catch {
          // fall through to the default layout below
        }
      }
      if (!restored) addDefaultLayout(event.api);
      syncPanels();
      // Keep the panel-set mirror current on every change (cheap, bail-out guarded), but
      // trailing-debounce the expensive whole-blob layout write so a drag persists once when
      // it settles. Subscribed AFTER the initial build so the multi-addPanel setup doesn't
      // write intermediate states.
      event.api.onDidLayoutChange(() => {
        syncPanels();
        if (layoutSaveTimerRef.current !== undefined) {
          clearTimeout(layoutSaveTimerRef.current);
        }
        layoutSaveTimerRef.current = setTimeout(() => {
          store?.set("layout", event.api.toJSON());
        }, LAYOUT_SAVE_DEBOUNCE_MS);
      });
    },
    [store, addDefaultLayout, syncPanels],
  );

  // Clear any pending debounced layout write on unmount.
  useEffect(
    () => () => {
      if (layoutSaveTimerRef.current !== undefined) {
        clearTimeout(layoutSaveTimerRef.current);
      }
    },
    [],
  );

  // View▸Panels toggle: remove a present panel, or re-add a missing one (no saved position —
  // dockview places it in a default group; the user can re-dock). onDidLayoutChange re-syncs.
  const togglePanel = useCallback((id: PanelId) => {
    const dockApi = dockApiRef.current;
    if (!dockApi) return;
    const existing = dockApi.getPanel(id);
    if (existing) {
      dockApi.removePanel(existing);
    } else {
      dockApi.addPanel({ id, component: id, title: panelTitle(id) });
    }
  }, []);

  // View▸Reset layout: drop the persisted layout and reload so onReady rebuilds the default.
  const resetLayout = useCallback(() => {
    store?.set("layout", undefined);
    window.location.reload();
  }, [store]);

  // Restore the last-opened scene on launch: once the store, scene list, and engine are all
  // ready, open the persisted lastScene if it still exists and nothing is open yet. Guarded
  // to fire at most once so it never fights a subsequent user selection.
  const lastSceneRestoredRef = useRef(false);
  useEffect(() => {
    if (lastSceneRestoredRef.current) return;
    if (!store || state.status !== "ready" || state.scenes.length === 0) return;
    lastSceneRestoredRef.current = true;
    const last = store.get("lastScene");
    if (last && !state.selectedScene && state.scenes.includes(last)) {
      void selectScene(last);
    }
  }, [store, state.status, state.scenes, state.selectedScene, selectScene]);

  // Fresh object each render — that is intentional: a new context value on every
  // state change is what forces the portaled panel consumers to re-render.
  const ctxValue: EditorContextValue = {
    state,
    dispatch,
    hostRef,
    previewHostRef,
    extensions: extensionsRef.current,
    actions,
    generation: {
      session: generation,
      setSession: setGeneration,
      wingName,
      setWingName,
      cancelRef: generationCancelRef,
    },
    viewFlags,
    setViewFlag,
    store,
  };

  return (
    <div className="flex h-screen flex-col">
      <Toolbar
        state={state}
        onSelectScene={selectScene}
        onSave={actions.save}
        onUndo={actions.undo}
        onRedo={actions.redo}
        onDelete={requestDelete}
        openPanelIds={panelIds}
        onTogglePanel={togglePanel}
        onResetLayout={resetLayout}
        recentScenes={recentScenes}
        viewFlags={viewFlags}
        onToggleViewFlag={setViewFlag}
      />
      <ConfirmDialog request={confirm} onResolve={resolveConfirm} />
      <EditorContext.Provider value={ctxValue}>
        <div className="min-h-0 flex-1">
          {/* Gated on storeResolved so onReady sees the persistence store (layout restore).
              If project.get fails, storeResolved still flips → dockview mounts without it. */}
          {storeResolved && (
            <DockviewReact
              className="dockview-theme-dark h-full"
              components={COMPONENTS}
              onReady={onReady}
            />
          )}
        </div>
      </EditorContext.Provider>
      <StatusBar state={state} />
    </div>
  );
}
