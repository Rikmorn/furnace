import {
	type DockviewApi,
	DockviewReact,
	type DockviewReadyEvent,
	type IDockviewPanelProps,
	type SerializedDockview,
} from "dockview";
import type { FunctionComponent } from "react";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import type { FieldHost } from "../../viewport-host/index.ts"; // type-only
import { useConfirmDialog } from "../hooks/useConfirmDialog.ts";
import { useGlobalKeybindings } from "../hooks/useGlobalKeybindings.ts";
import { api } from "../lib/api.ts";
import { EngineBuildError, loadEngine } from "../lib/engine.ts";
import { subscribeEvents } from "../lib/events.ts";
import { type PanelId, panelTitle } from "../lib/panels.ts";
import { createUiStore } from "../lib/persist.ts";
import { initialState, reduce } from "../lib/state.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { EditorContext, type EditorContextValue } from "./editor-context.ts";
import { FieldPanel } from "./FieldPanel.tsx";
import { StatusBar } from "./StatusBar.tsx";

// Module-level so its identity is stable across App renders: dockview reads the
// factory only at panel construction, so a fresh map per render would freeze the
// mounted panels on their first render. The panels take no props and read live
// state via EditorContext instead.
const COMPONENTS: Record<string, FunctionComponent<IDockviewPanelProps>> = {
	field: FieldPanel,
};

// Trailing-debounce the layout write: onDidLayoutChange fires per pointermove frame during a
// splitter drag, but each write JSON-stringifies the whole UiState blob — persist once settled.
const LAYOUT_SAVE_DEBOUNCE_MS = 200;

// The DEFAULT layout: the Field panel alone, as the dockview root. Rooting Field
// guarantees its dig canvas an always-visible group with a non-zero client box at init
// (a stacked/inactive tab inits at zero size, which core's bindToCanvas rejects).
const DEFAULT_LAYOUT_PANELS: readonly PanelId[] = ["field"];

export function App() {
	const [state, dispatch] = useReducer(reduce, initialState);
	// The F1 field dig host, created once at engine-ready and threaded to the Field
	// panel via context. App-owned so it survives the panel closing/reopening.
	const fieldHostRef = useRef<FieldHost | undefined>(undefined);
	// Will mirror whether a world bake is in flight, for the SSE bundle-outdated guard
	// (that closure re-subscribes only on [state.status], so it cannot read live panel
	// state).
	// MIGRATION (until Task 8 of the F4.5a plan): the bake still lives inside the Field
	// panel's toolbar and nothing writes this yet, so it reads false for the whole session
	// — the reload below is currently unguarded in practice.
	const bakeBusyRef = useRef(false);
	// The in-chrome confirm dialog (replaces window.confirm) — its full state machine
	// (open no-clobber guard, exactly-once resolve) lives in useConfirmDialog. `confirmRef`
	// is threaded to useGlobalKeybindings so the keydown listener suppresses every binding
	// while a prompt is open.
	const { confirm, confirmRef, openConfirm, resolveConfirm } =
		useConfirmDialog();

	// Bumped on every daemon `worlds-changed` event (a world.delete/rename/duplicate/
	// makeDefault landed). Carried in context as the refetch trigger for whatever renders
	// the world list — Task 8's drawer is the first consumer.
	const [worldsVersion, setWorldsVersion] = useState(0);

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

	// One-time engine bootstrap: `[]` is deliberate — a re-run would build a SECOND field
	// host beside the one the panel already mounted its canvas on.
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
				// Assigned BEFORE the engine-ready dispatch so the host is live by the
				// time the panels mount.
				fieldHostRef.current = engine.createFieldHost();
				dispatch({ type: "engine-ready" });
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

	// The global keybinding listener (⌘S / ⌘Z / ⇧⌘Z), suppressed while a confirm is open.
	useGlobalKeybindings({ confirmRef });

	useEffect(() => {
		if (state.status !== "ready") return;
		return subscribeEvents({
			// Nothing to catch up on: the editor mirrors no daemon-owned document. The
			// field world lives in the host until the user saves it.
			onOpen: () => undefined,
			onEvent: (event) => {
				if (event.type === "bundle-outdated") {
					// Generator/extension source changed: the engine bundle is stale. A hard
					// reload is the only way to pick it up, and it would kill an in-flight
					// bake, so refuse while one is running.
					if (!bakeBusyRef.current) window.location.reload();
					return;
				}
				if (
					event.type === "worlds-changed" ||
					event.type === "generation-baked"
				) {
					// Both mean the worlds directory on disk moved under us (a world verb, or
					// a bake that just wrote one) — anything showing the world list refetches.
					setWorldsVersion((v) => v + 1);
				}
			},
		});
	}, [state.status]);

	// The default layout, built by iterating DEFAULT_LAYOUT_PANELS with titles resolved
	// through PANELS (panelTitle) so a title edit there still flows to the initial layout.
	const addDefaultLayout = useCallback((dockApi: DockviewApi) => {
		for (const id of DEFAULT_LAYOUT_PANELS) {
			dockApi.addPanel({ id, component: id, title: panelTitle(id) });
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
			// Trailing-debounce the expensive whole-blob layout write so a drag persists once
			// when it settles. Subscribed AFTER the initial build so the setup doesn't write
			// intermediate states.
			event.api.onDidLayoutChange(() => {
				if (layoutSaveTimerRef.current !== undefined) {
					clearTimeout(layoutSaveTimerRef.current);
				}
				layoutSaveTimerRef.current = setTimeout(() => {
					store?.set("layout", event.api.toJSON());
				}, LAYOUT_SAVE_DEBOUNCE_MS);
			});
		},
		[store, addDefaultLayout],
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

	// Fresh object each render — that is intentional: a new context value on every
	// state change is what forces the portaled panel consumers to re-render.
	const ctxValue: EditorContextValue = {
		state,
		fieldHostRef,
		worldsVersion,
		openConfirm,
		store,
	};

	return (
		<div className="flex h-screen flex-col">
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
