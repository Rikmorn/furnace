// The live palette arrangement: the pure store (lib/palette-store.ts) plus the two
// things it refuses to know about — React state and the disk.
//
// Split into TWO contexts on purpose, and the load-bearing beneficiary is ShellFrame:
// it reads ACTIONS ONLY, so a drag never re-renders it — which is what keeps the
// `content={{ controls: <FieldPanel /> }}` elements it builds referentially stable, and
// therefore what keeps FieldPanel (7 host subscriptions, a form-heavy subtree) off the
// pointer-rate path. A ShellFrame that starts reading the STATE context silently undoes
// that: it would rebuild those elements per pointermove and re-render the panel with
// them. The provider's own `children` come from its parent, so its state changes
// re-render only the context consumers below it (the FieldHostStateProvider pattern).
//
// Honest about who pays: TopBar and BurgerMenu DO read the state — a hide/show label and
// a checked box have to — and so they do repaint per drag frame. A header, a menu
// trigger and a closed dropdown are cheap enough for that to be the right trade against
// a control that lies about its state; revisit if the bar grows heavier consumers.
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
	/** The latch, set ABSOLUTELY. Its one caller is the status bar's ⚠ chip, which
	 *  summons a palette and must therefore be sure the layer is on screen — a summon
	 *  that lands behind the ⌘\ latch is a click that visibly does nothing. Stated as a
	 *  value rather than a toggle so the caller needs no read of the state (and so does
	 *  not re-render on every drag frame). */
	setHidden: (hidden: boolean) => void;
	/** Back to the default arrangement, and forget the persisted one (D-3). The escape
	 *  hatch for a palette dragged somewhere unreachable. */
	reset: () => void;
};

const WorkspaceStateContext = createContext<WorkspaceState | null>(null);
const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);

/** Read the live arrangement; throws outside the provider. Re-renders its caller on
 *  every drag frame — read it only where the arrangement is actually displayed, and see
 *  the header for who pays that today and who must never start. */
export function useWorkspaceState(): WorkspaceState {
	const value = useContext(WorkspaceStateContext);
	if (!value) throw new Error("useWorkspaceState outside <WorkspaceProvider>");
	return value;
}

/** Read the arrangement's verbs; throws outside the provider. The value is stable for
 *  the provider's lifetime, so a component that reads ONLY this never re-renders from a
 *  drag — see the header for why ShellFrame must stay in that set. */
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
	// A Reset that happened BEFORE the store existed still owes the disk a delete.
	const clearOnArrival = useRef(false);

	// The store arrives LATE and may never arrive at all: it is keyed by the project root,
	// which comes from a daemon call that can fail (App keeps persistence best-effort).
	// So the layer renders defaults immediately and adopts the persisted arrangement when
	// the store shows up — rather than holding the whole cockpit behind an RPC that has a
	// failure mode where it never resolves. The cost is a possible one-frame defaults→
	// restored jump on a slow project.get, which is why the restore is skipped outright
	// once the user has arranged anything: live intent beats what was on disk.
	useEffect(() => {
		if (!store) return;
		// Reset ran while persistence was still off. Honour it in the order it was asked
		// for: finish the delete it could not perform, and DON'T restore — the blob this
		// effect would otherwise read is the very one the user just discarded, and
		// restoring it would put the stale arrangement back on screen and on disk.
		if (clearOnArrival.current) {
			clearOnArrival.current = false;
			store.set("workspace", undefined);
			return;
		}
		if (restored.current) return;
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
			setHidden: (hidden) => edit((s) => setPalettesHidden(s, hidden)),
			reset: () => {
				// NOT an `edit`: reset un-touches, so the persist effect skips its write and
				// the key is simply gone until the user arranges something again. The
				// pending timer from whatever they did last is cleared by that same effect
				// re-running, so nothing resurrects the blob a moment later.
				touched.current = false;
				setState(defaultWorkspace());
				// A reset is a DECISION about the persisted arrangement, so it also closes
				// the restore window: without this, a reset performed before `project.get`
				// resolves is silently undone when the store lands and the arrival effect
				// reads the blob the user just rejected.
				restored.current = true;
				if (store) store.set("workspace", undefined);
				else clearOnArrival.current = true;
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
