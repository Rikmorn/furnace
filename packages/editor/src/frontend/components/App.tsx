import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FieldHost } from "../../viewport-host/index.ts"; // type-only
import { useConfirmDialog } from "../hooks/useConfirmDialog.ts";
import { useGlobalKeybindings } from "../hooks/useGlobalKeybindings.ts";
import { api } from "../lib/api.ts";
import { EngineBuildError, loadEngine } from "../lib/engine.ts";
import { subscribeEvents } from "../lib/events.ts";
import { createUiStore } from "../lib/persist.ts";
import { initialState, reduce } from "../lib/state.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { EditorContext, type EditorContextValue } from "./editor-context.ts";
import { Shell } from "./shell/Shell.tsx";

/**
 * The editor's bootstrap: engine load, project resolution, the daemon event feed, the
 * global keybindings and the one confirm dialog. Everything VISIBLE is the Shell's —
 * see its header for the layout contract.
 */
export function App() {
	const [state, dispatch] = useReducer(reduce, initialState);
	// The F1 field dig host, created once at engine-ready and threaded to the shell via
	// context. App-owned so its lifetime is the editor's, not any one component's.
	const fieldHostRef = useRef<FieldHost | undefined>(undefined);
	// Will mirror whether a world bake is in flight, for the SSE bundle-outdated guard
	// (that closure re-subscribes only on [state.status], so it cannot read live panel
	// state).
	// MIGRATION (until F4.5b): the bake still lives inside the Field panel's toolbar and
	// nothing writes this yet, so it reads false for the whole session — the reload
	// below is currently unguarded in practice.
	const bakeBusyRef = useRef(false);
	// The in-chrome confirm dialog (replaces window.confirm) — its full state machine
	// (open no-clobber guard, exactly-once resolve) lives in useConfirmDialog. `confirmRef`
	// is threaded to useGlobalKeybindings so the keydown listener suppresses every binding
	// while a prompt is open.
	const { confirm, confirmRef, openConfirm, resolveConfirm } =
		useConfirmDialog();

	// Bumped on every daemon `worlds-changed` event (a world.delete/rename/duplicate/
	// makeDefault landed). Carried in context as the refetch trigger for whatever renders
	// the world list — the world drawer is the first consumer.
	const [worldsVersion, setWorldsVersion] = useState(0);

	// Per-project UI persistence. The project root comes from the daemon (project.get);
	// until it resolves the store is undefined and persistence is simply off — the shell
	// renders either way rather than holding a blank window behind a local RPC.
	const [projectRoot, setProjectRoot] = useState<string | undefined>(undefined);
	const store = useMemo(
		() =>
			projectRoot ? createUiStore(window.localStorage, projectRoot) : undefined,
		[projectRoot],
	);

	// One-time engine bootstrap: `[]` is deliberate — a re-run would build a SECOND field
	// host beside the one the shell already mounted its canvas on.
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
				// time the shell reads the ref (see Shell's render-time read).
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
	// persistence store. A failure leaves the store undefined: persistence is best-effort.
	useEffect(() => {
		let cancelled = false;
		api
			.projectGet()
			.then(({ root }) => {
				if (!cancelled) setProjectRoot(root);
			})
			.catch(() => {
				// Persistence is best-effort: without a root the store stays disabled.
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

	// Fresh object each render — that is intentional: a new context value on every
	// state change is what forces the consumers to re-render.
	const ctxValue: EditorContextValue = {
		state,
		fieldHostRef,
		worldsVersion,
		openConfirm,
		store,
	};

	return (
		<EditorContext.Provider value={ctxValue}>
			<ConfirmDialog request={confirm} onResolve={resolveConfirm} />
			<Shell />
		</EditorContext.Provider>
	);
}
