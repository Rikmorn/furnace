// The live palette arrangement: the pure store (lib/palette-store.ts) plus the two
// things it refuses to know about — React state and the disk.
//
// Split into TWO contexts on purpose, and the load-bearing beneficiary is ShellChrome —
// the component that BUILDS the `content={{ entities: <EntitiesPalette />, … }}` elements.
// It reads ACTIONS ONLY, so a drag never re-renders it, which is what keeps those elements
// referentially stable and therefore what keeps the five palette bodies (between them a
// dozen host-seam latches and two form-heavy subtrees) off the pointer-rate path. A
// ShellChrome that starts reading the STATE context silently undoes that: it would rebuild
// those elements per pointermove and re-render every palette with them. (ShellFrame, one level up, reads only useEditor — this
// comment named it for both roles until F4.5a Task 13; useWorld.tsx and useView.tsx had
// it right.) The provider's own `children` come from its parent, so its state changes
// re-render only the context consumers below it (`useFieldHostState.tsx`'s shell context
// is the same pattern taken further: its value is stable for the session, so the state
// that moves rides latches instead).
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
	growPalette,
	movePalette,
	nudgePalette,
	type OriginBounds,
	type PaletteId,
	type PaletteSize,
	resizePalette,
	type SizeBounds,
	serializeWorkspace,
	setPaletteCollapsed,
	setPaletteOpen,
	setPalettesHidden,
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
	/** Step a palette by a keyboard delta (D-26). A SEPARATE verb rather than a `move` the
	 *  caller pre-adds a delta to, because the origin a step starts from is not the stored
	 *  `x` — a docked palette's is its edge — and working that out at every call site is how
	 *  two callers come to disagree about where a palette is. */
	nudge: (
		id: PaletteId,
		delta: { dx: number; dy: number },
		bounds: OriginBounds,
	) => void;
	/** Set a palette's own size, clamped against bounds the CALLER measured — `move`'s
	 *  twin, and the same division of labour: this module owns no DOM, so how big the cell
	 *  is arrives as an argument. */
	resize: (
		id: PaletteId,
		size: Partial<PaletteSize>,
		bounds: SizeBounds,
	) => void;
	/** Step a palette's size by a keyboard delta (D-26). A SEPARATE verb for `nudge`'s
	 *  reason, sharpened: the size a step starts from is not on the record at all when the
	 *  user has never set a height, and a caller that worked the target out from its own
	 *  props would read the same stale size for every press React batched together. */
	grow: (
		id: PaletteId,
		delta: { dw: number; dh: number },
		measured: { height: number; bounds: SizeBounds },
	) => void;
	/** Roll a palette up or down, ABSOLUTELY. Same caller and same reason as
	 *  `setHidden`: summoning a palette has to put it in a state the user can READ, and
	 *  `open` alone does not — a palette that was collapsed when it was closed comes
	 *  back collapsed, because the arrangement survives closing (that is the point of
	 *  `setPaletteOpen`). A toggle would need a read of the state to be safe. */
	setCollapsed: (id: PaletteId, collapsed: boolean) => void;
	setOpen: (id: PaletteId, open: boolean) => void;
	/** Open or close a palette whose open state the EDITOR drives (`PALETTES[id].drivenOpen`
	 *  — today only the session card), WITHOUT recording that the user arranged anything.
	 *
	 *  `setOpen` cannot be reused here, and the reason is not tidiness. Every other verb in
	 *  this object goes through `edit`, which sets `touched` — and `touched` GATES THE
	 *  RESTORE below: the store arrives late, and a restore that finds the flag set is
	 *  skipped outright. A driven open firing in that window — any entity selected, or any
	 *  session opened, before `project.get` resolves — would discard the user's whole
	 *  persisted arrangement for that boot, silently, and their next drag would overwrite
	 *  the blob with defaults. It also keeps this provider's own promise true ("nothing is
	 *  written before the first interaction"): merely SELECTING something is not an
	 *  arrangement decision, so it must neither persist nor veto a restore.
	 *
	 *  The state still moves — the palette really opens — and the persist debounce stays
	 *  armed only by real arrangement changes. `drivenOpen` was a READ-side rule in the
	 *  store (`deserializeWorkspace` drops the persisted flag); this is its write side. */
	setDrivenOpen: (id: PaletteId, open: boolean) => void;
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

/** The arrangement plus the one thing about it that is not geometry: where it CAME FROM.
 *
 *  `fromRestore` exists for a question only the palette layer asks, and one it cannot
 *  answer from the value alone — "is this arrangement something the user just did, or the
 *  one that was on disk?". Its summon safety-net raises any palette that transitions
 *  closed→open, and the restore lands as exactly that transition, so without this a boot
 *  that re-opens a palette is indistinguishable from a user summoning it. That was
 *  harmless only while `log` was the sole palette whose default is closed AND happened to
 *  be last in `PALETTE_IDS`; the session card made the closed set bigger and the
 *  coincidence stopped being a guarantee. */
export type WorkspaceView = WorkspaceState & { fromRestore: boolean };

const WorkspaceStateContext = createContext<WorkspaceView | null>(null);
const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);

/** Read the live arrangement; throws outside the provider. Re-renders its caller on
 *  every drag frame — read it only where the arrangement is actually displayed, and see
 *  the header for who pays that today and who must never start. */
export function useWorkspaceState(): WorkspaceView {
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
	// The arrangement the RESTORE produced, held by IDENTITY so `fromRestore` needs no
	// clearing: every `edit` builds a new record, which is `!==` this one by construction.
	// A verb that changes nothing returns the same record and leaves the flag standing —
	// correct, because a move that moved nothing opened nothing either.
	const [restoredState, setRestoredState] = useState<WorkspaceState | null>(
		null,
	);
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
		const next = deserializeWorkspace(store.get("workspace"));
		setRestoredState(next);
		setState(next);
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
			nudge: (id, delta, bounds) =>
				edit((s) => nudgePalette(s, id, delta, bounds)),
			resize: (id, size, bounds) =>
				edit((s) => resizePalette(s, id, size, bounds)),
			grow: (id, delta, measured) =>
				edit((s) => growPalette(s, id, delta, measured)),
			setCollapsed: (id, collapsed) =>
				edit((s) => setPaletteCollapsed(s, id, collapsed)),
			setOpen: (id, open) => edit((s) => setPaletteOpen(s, id, open)),
			// NOT an `edit`: see the docblock on the type. The write happens; the
			// ownership claim does not.
			setDrivenOpen: (id, open) => setState((s) => setPaletteOpen(s, id, open)),
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

	const view = useMemo<WorkspaceView>(
		() => ({ ...state, fromRestore: state === restoredState }),
		[state, restoredState],
	);

	return (
		<WorkspaceActionsContext.Provider value={actions}>
			<WorkspaceStateContext.Provider value={view}>
				{children}
			</WorkspaceStateContext.Provider>
		</WorkspaceActionsContext.Provider>
	);
}
