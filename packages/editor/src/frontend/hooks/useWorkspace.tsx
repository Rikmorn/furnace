// The live palette arrangement: the pure store (lib/palette-store.ts) plus the two
// things it refuses to know about — React state and the disk.
//
// Split into TWO contexts on purpose. The state changes once per pointermove during a
// drag; the actions never change. Consumers that only need verbs (the top bar's toggle,
// the burger's Reset) read the actions context and are therefore untouched by a drag,
// while the layer — the one surface that must repaint — reads the state. The provider's
// own `children` are passed in by its parent, so a state change re-renders the provider
// without re-rendering the subtree: only the context consumers inside it repaint (the
// FieldHostStateProvider pattern, same reason).
import type { ReactNode } from "react";
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	defaultWorkspace,
	deserializeWorkspace,
	movePalette,
	type OriginBounds,
	type PaletteId,
	serializeWorkspace,
	setPaletteOpen,
	setPalettesHidden,
	togglePaletteCollapsed,
	type WorkspaceState,
} from "../lib/palette-store.ts";
import type { UiStore } from "../lib/persist.ts";

/** Long enough that a drag writes once at the end of the gesture rather than 60 times a
 *  second (every `UiStore.get` re-parses the whole blob), short enough that a browser
 *  closed right after a move keeps it. */
const PERSIST_DEBOUNCE_MS = 200;

/** Every verb that changes the arrangement. Stable for the provider's lifetime, so a
 *  consumer that reads only these never re-renders. */
export type WorkspaceActions = {
	/** Place a palette's origin, clamped and edge-snapped against bounds the CALLER
	 *  measured — this module owns no DOM. */
	move: (
		id: PaletteId,
		pos: { x: number; y: number },
		bounds: OriginBounds,
	) => void;
	toggleCollapsed: (id: PaletteId) => void;
	setOpen: (id: PaletteId, open: boolean) => void;
	/** The ⌘\ latch: hide every palette, or restore the exact prior arrangement. */
	toggleHidden: () => void;
	/** Back to the default arrangement, and forget the persisted one (D-3). The escape
	 *  hatch for a palette dragged somewhere unreachable. */
	reset: () => void;
};

const WorkspaceStateContext = createContext<WorkspaceState | null>(null);
const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);

/** Read the live arrangement; throws outside the provider. Re-renders on every drag
 *  frame — only the palette layer should call it. */
export function useWorkspaceState(): WorkspaceState {
	const value = useContext(WorkspaceStateContext);
	if (!value) throw new Error("useWorkspaceState outside <WorkspaceProvider>");
	return value;
}

/** Read the arrangement's verbs; throws outside the provider. Stable — safe to call
 *  from chrome that must not repaint during a drag. */
export function useWorkspaceActions(): WorkspaceActions {
	const value = useContext(WorkspaceActionsContext);
	if (!value)
		throw new Error("useWorkspaceActions outside <WorkspaceProvider>");
	return value;
}

export function WorkspaceProvider({
	store,
	children,
}: {
	store: UiStore | undefined;
	children: ReactNode;
}) {
	const [state, setState] = useState<WorkspaceState>(defaultWorkspace);
	// Whether the arrangement on screen is the USER's. It gates both directions: nothing
	// is written before the first interaction (so the defaults this component renders
	// with can never overwrite a saved arrangement it has not read yet), and a restore
	// that arrives late is dropped rather than yanking a palette out from under a drag.
	const touched = useRef(false);
	const restored = useRef(false);

	// The store arrives LATE and may never arrive at all: it is keyed by the project root,
	// which comes from a daemon call that can fail (App keeps persistence best-effort).
	// So the layer renders defaults immediately and adopts the persisted arrangement when
	// the store shows up — rather than holding the whole cockpit behind an RPC that has a
	// failure mode where it never resolves. The cost is a possible one-frame defaults→
	// restored jump on a slow project.get, which is why the restore is skipped outright
	// once the user has arranged anything: live intent beats what was on disk.
	useEffect(() => {
		if (!store || restored.current) return;
		restored.current = true;
		if (touched.current) return;
		setState(deserializeWorkspace(store.get("workspace")));
	}, [store]);

	// Debounced by effect cleanup: each state change cancels the previous pending write,
	// so a drag persists once, when it settles.
	useEffect(() => {
		if (!store || !touched.current) return;
		const timer = setTimeout(
			() => store.set("workspace", serializeWorkspace(state)),
			PERSIST_DEBOUNCE_MS,
		);
		return () => clearTimeout(timer);
	}, [store, state]);

	const actions = useMemo<WorkspaceActions>(() => {
		/** Every verb goes through here: one place to record that the arrangement is now
		 *  the user's, and functional updates so no verb closes over stale state. */
		const edit = (f: (s: WorkspaceState) => WorkspaceState) => {
			touched.current = true;
			setState(f);
		};
		return {
			move: (id, pos, bounds) => edit((s) => movePalette(s, id, pos, bounds)),
			toggleCollapsed: (id) => edit((s) => togglePaletteCollapsed(s, id)),
			setOpen: (id, open) => edit((s) => setPaletteOpen(s, id, open)),
			toggleHidden: () => edit((s) => setPalettesHidden(s, !s.hidden)),
			reset: () => {
				// NOT an `edit`: reset un-touches, so the effect above skips its write and
				// the key is simply gone until the user arranges something again. The
				// pending timer from whatever they did last is cleared by that same effect
				// re-running, so nothing resurrects the blob a moment later.
				touched.current = false;
				setState(defaultWorkspace());
				store?.set("workspace", undefined);
			},
		};
	}, [store]);

	return (
		<WorkspaceActionsContext.Provider value={actions}>
			<WorkspaceStateContext.Provider value={state}>
				{children}
			</WorkspaceStateContext.Provider>
		</WorkspaceActionsContext.Provider>
	);
}
