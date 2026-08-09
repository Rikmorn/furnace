import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FieldHost } from "../../field-host/index.ts"; // type-only
import { useConfirmDialog } from "../hooks/useConfirmDialog.ts";
import { useDaemonFeed } from "../hooks/useDaemonFeed.ts";
import { useSessionClaim } from "../hooks/useSessionClaim.ts";
import { api } from "../lib/api.ts";
import { EngineBuildError, loadEngine } from "../lib/engine.ts";
import { createUiStore } from "../lib/persist.ts";
import { initialState, reduce } from "../lib/state.ts";
import { ClaimLostOverlay } from "./ClaimLostOverlay.tsx";
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
	// Which world this session is authoring, for the claim below. Created HERE and filled
	// by `WorldProvider` for the `bakeBusyRef` reason: the name lives far below this
	// provider and its reader sits beside it.
	const worldNameRef = useRef<string | null>(null);

	// The session claim (T4b): this tab tells the daemon it is the one an agent may read
	// and drive. It rides the feed's frames (the daemon names each connection on connect)
	// but owns no subscription of its own — `feed` is the stable handler set the feed
	// calls into, `lost` is the terminal state the cover renders from.
	const claim = useSessionClaim({ worldNameRef, openConfirm });

	// The daemon's SSE feed. Carried in context as the refetch trigger for whatever renders
	// the world list — the world drawer is the first consumer.
	const worldsVersion = useDaemonFeed(
		state.status === "ready",
		bakeBusyRef,
		claim.feed,
	);

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
		worldNameRef,
		claimLostRef: claim.claimLostRef,
		viewportFocusRef,
		store,
	};

	return (
		<EditorContext.Provider value={ctxValue}>
			<ConfirmDialog request={confirm} onResolve={resolveConfirm} />
			<Shell />
			{/* LAST in this subtree, but DOM order is NOT what orders it against the
			    overlays that matter, and the first version of this comment claimed it was.
			    React mounts into `#root` (`main.tsx`); every Radix overlay in the chrome —
			    the confirm dialog, the command palette, each popover — portals to
			    `document.body`, i.e. AFTER `#root`. So a same-z cover paints UNDER them,
			    the exact inverse. What orders it is the z-index: the cover declares one
			    step above the control library's whole layer, pinned in
			    `tests/chrome/session-claim.test.tsx`. */}
			<ClaimLostOverlay lost={claim.lost} />
		</EditorContext.Provider>
	);
}
