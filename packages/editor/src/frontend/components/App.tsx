import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FieldHost } from "../../viewport-host/index.ts"; // type-only
import { useConfirmDialog } from "../hooks/useConfirmDialog.ts";
import { useDaemonFeed } from "../hooks/useDaemonFeed.ts";
import { api } from "../lib/api.ts";
import { EngineBuildError, loadEngine } from "../lib/engine.ts";
import { createUiStore } from "../lib/persist.ts";
import { initialState, reduce } from "../lib/state.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import {
	EditorContext,
	type EditorContextValue,
	type ViewportFocus,
} from "./editor-context.ts";
import { Shell } from "./shell/Shell.tsx";

/**
 * The editor's bootstrap: engine load, project resolution, the daemon event feed and
 * the one confirm dialog. Everything VISIBLE is the Shell's — see its header for the
 * layout contract; the global keydown listener moved there too, because the bindings
 * act on shell state.
 */
export function App() {
	const [state, dispatch] = useReducer(reduce, initialState);
	// The F1 field dig host, created once at engine-ready and threaded to the shell via
	// context. App-owned so its lifetime is the editor's, not any one component's.
	const fieldHostRef = useRef<FieldHost | undefined>(undefined);
	// Whether a world write is in flight, for the feed's bundle-outdated guard. The
	// shell's world verbs set it around every save/bake; a ref rather than state because
	// the guard has to see the CURRENT value without re-subscribing (useDaemonFeed).
	const bakeBusyRef = useRef(false);
	// How a dismissed overlay hands the keyboard back to the canvas. Created HERE and
	// filled by `CanvasHost` for the `fieldHostRef` reason: the thing that owns the
	// element sits far below the provider, and the readers (every overlay's
	// close-autofocus handler) sit beside it rather than under it.
	const viewportFocusRef = useRef<ViewportFocus | null>(null);
	// The in-chrome confirm dialog (replaces window.confirm) — its full state machine
	// (open no-clobber guard, exactly-once resolve) lives in useConfirmDialog. `confirmRef`
	// rides the editor context down to the shell's keydown listener, which suppresses
	// every binding while a prompt is open.
	const { confirm, confirmRef, openConfirm, resolveConfirm } =
		useConfirmDialog();

	// The daemon's SSE feed. Carried in context as the refetch trigger for whatever renders
	// the world list — the world drawer is the first consumer.
	const worldsVersion = useDaemonFeed(state.status === "ready", bakeBusyRef);

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

	// A fresh object each render, unmemoized. That was once load-bearing — the dock
	// portaled its panels, so a new context value was the only thing that reached them
	// — and it no longer is: the shell is a plain subtree, so an App re-render re-renders
	// it whatever this identity does. Kept because it is the simplest CORRECT thing:
	// memoizing would buy nothing (every consumer re-renders anyway) and would need a
	// dep list that silently goes stale. Revisit if a consumer ever memoizes itself.
	const ctxValue: EditorContextValue = {
		state,
		fieldHostRef,
		worldsVersion,
		openConfirm,
		confirmRef,
		bakeBusyRef,
		viewportFocusRef,
		store,
	};

	return (
		<EditorContext.Provider value={ctxValue}>
			<ConfirmDialog request={confirm} onResolve={resolveConfirm} />
			<Shell />
		</EditorContext.Provider>
	);
}
