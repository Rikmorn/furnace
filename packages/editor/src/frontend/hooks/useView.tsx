// What the field LOOKS like — shading, layer visibility, the slice plane, viewport AA —
// and nothing about what is in it. Shell state, not panel state: the View popover in the
// top bar drives it, the burger's View group drives the same values, and the canvas layer
// reads the AA setting, so it cannot live inside a palette that closing would take with
// it (the world-state precedent).
//
// It is a pure chrome→host concern, which is why it is NOT part of `useFieldHostState`.
// The line between the two providers is the DIG LOOP, not the direction of travel:
// `useFieldHostState` owns the nine single-slot subscriptions and the chrome state
// cohesive with them (the `setTool` funnel, whose echo guard makes it inseparable from the
// tool mirror; the flag filters, which round-trip back through `subscribeFlags`); this
// one owns what the viewport LOOKS like, which has no seam to mirror at all — the host
// publishes no shading/layers/slice subscription. There is exactly ONE value on the far
// side of that line: `radius` sits in the host-state provider with no seam behind it in
// either direction, because it is a brush parameter and every control that shows it also
// shows `tool` (stated as the exception at its own docblock). A new value goes wherever
// its CONCERN already lives; if it has neither a seam nor a sibling there, it belongs
// here or in a provider of its own.
//
// So this provider is the source of truth and pushes: one effect
// per seam, each keyed on its own value, so a shading change never re-sends the layer
// flags (`setLayers` is edge-sensitive for `voidCast`) and a slider drag never re-sends
// the shading mode.
//
// Split into STATE and ACTIONS contexts, the useWorkspace/useWorld pattern — and honest
// about who benefits TODAY: nobody. Both of this provider's chrome consumers (the View
// popover, the burger's View group) read state AND actions, because a control that writes
// a toggle has to show it. The split is here for the shape, not for a saved render, and
// the one place a view change is genuinely expensive to propagate is handled elsewhere:
// Shell keeps ShellChrome off the STATE context with a `FieldCanvas` wrapper, documented
// there. Delete this split rather than defend it if F4.5b's consumers arrive read-only.
import type { ReactNode } from "react";
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	FieldHost,
	FieldHostShading,
	FieldLayers,
} from "../../viewport-host/index.ts"; // type-only: erased
import type { UiState, UiStore } from "../lib/persist.ts";

/** The layer defaults — the host's own all-true-but-`voidCast` set, restated here because
 *  the chrome cannot value-import the host (the project-first invariant) and there is no
 *  layers subscription to seed from. Pushed at engine-ready, so the two agree from the
 *  first frame. */
const DEFAULT_LAYERS: FieldLayers = {
	field: true,
	kit: true,
	props: true,
	ghost: true,
	selection: true,
	grid: true,
	flags: true,
	// The one default-off flag: ticking it runs a whole-world cast job, so the X-ray is
	// opt-in (mirrors the host's own default).
	voidCast: false,
};

/** The X-ray, held out of the persisted set — ONE exclusion, which both the writer and
 *  the reader below work from, so the two sides cannot disagree about it. Destructured
 *  rather than filtered by name: a `voidCast` that was renamed in `FieldLayers` stops
 *  compiling here, which a string comparison against a key list would not.
 *
 *  Why it is held out is `serializeView`'s to explain. */
const { voidCast: _sessionOnlyLayer, ...PERSISTED_LAYERS } = DEFAULT_LAYERS;

/** The layer names a persisted blob may speak about. */
// Boundary cast: `Object.keys` is typed `string[]` because a VALUE can structurally carry
// keys its type never declared — but the argument here is a rest object off a literal
// checked against `FieldLayers`, which cannot. Deriving the list (rather than writing it
// out) is what keeps a new layer restorable without a second edit here.
const PERSISTED_LAYER_KEYS = Object.keys(
	PERSISTED_LAYERS,
) as (keyof typeof PERSISTED_LAYERS)[];

/** The FALLBACK park for the slice plane, used only when the world can offer nothing
 *  better: mid-slider, high enough to cut a typical kit hall.
 *
 *  D-F4.5-16 wants the default plane at the HIGHEST OCCUPIED CELL, and since F4.5b the
 *  host answers that (`occupiedTopY`), so this number is what is left after the honest
 *  answer is unavailable — an untouched world, or one whose allocated chunks hold no rock
 *  at all. Both are worlds with nothing for the plane to cut, which is exactly when an
 *  arbitrary park costs nothing. */
const SLICE_DEFAULT_Y = 8;

/** How far ABOVE the topmost solid sample the seeded plane parks. Half a metre, so the
 *  plane opens just clear of the ceiling it was derived from: the first frame after
 *  ticking the box looks like the world did before it, and dragging the slider DOWN is
 *  what cuts in. Seeding exactly AT the top sample would shave the ceiling on the first
 *  frame, which reads as the tick having damaged something. */
const SLICE_SEED_CLEARANCE_M = 0.5;

/** MSAA for the viewport pass. 4 is the default (the value the host used unconditionally
 *  before the switch existed); 1 turns it off. */
const DEFAULT_SAMPLE_COUNT = 4;

/** How the field is drawn. `slice.y` survives the plane being switched off, so re-ticking
 *  the box returns to the depth the user chose rather than to the park. */
export type ViewState = {
	shading: FieldHostShading;
	layers: FieldLayers;
	slice: { enabled: boolean; y: number };
	/** Viewport MSAA. Changing it re-inits the GPU context (CanvasHost owns that round
	 *  trip) — the one view control that costs more than a uniform write. */
	sampleCount: 1 | 4;
};

export type ViewActions = {
	setShading: (mode: FieldHostShading) => void;
	setLayers: (next: FieldLayers) => void;
	setSlice: (next: { enabled: boolean; y: number }) => void;
	setSampleCount: (n: 1 | 4) => void;
};

const ViewStateContext = createContext<ViewState | null>(null);
const ViewActionsContext = createContext<ViewActions | null>(null);

/** Read the live view state; throws outside the provider. */
export function useViewState(): ViewState {
	const value = useContext(ViewStateContext);
	if (!value) throw new Error("useViewState outside <ViewProvider>");
	return value;
}

/** Read the view verbs; throws outside the provider. Stable for the provider's lifetime. */
export function useViewActions(): ViewActions {
	const value = useContext(ViewActionsContext);
	if (!value) throw new Error("useViewActions outside <ViewProvider>");
	return value;
}

/** Long enough that a slice-slider drag writes once when it settles rather than 60 times
 *  a second (every `UiStore.get` re-parses the whole blob). */
const PERSIST_DEBOUNCE_MS = 200;

const defaultView = (): ViewState => ({
	shading: "studio",
	layers: { ...DEFAULT_LAYERS },
	slice: { enabled: false, y: SLICE_DEFAULT_Y },
	sampleCount: DEFAULT_SAMPLE_COUNT,
});

/** The persisted projection. `sampleCount` is deliberately absent: restoring it would
 *  mean disposing and re-initing the GPU context moments after the first one came up
 *  (the store arrives late, off an async project.get), i.e. a visible teardown on every
 *  cold start to honour a switch the user last touched days ago. AA is a session choice
 *  until that ordering is worth solving.
 *
 *  `layers.voidCast` is absent for the SAME reason, one step worse. The host boots with
 *  the X-ray off and `setLayers` acts on the false→true EDGE, so a restored `true` always
 *  presents that edge — and what the edge does depends on an unpinned race between this
 *  store and the catalog-gated world restore. Win it and the user gets a spurious
 *  "nothing to cast yet — dig something first" toast at boot over a world they have not
 *  touched, followed by a silent discard that leaves the checkbox ticked over nothing
 *  (precisely the reading the host's own report exists to prevent); lose it and they get
 *  an unrequested whole-world worker job on a world they did not ask to X-ray. The X-ray
 *  is a look-at-this-now tool, not an arrangement: it is a session choice.
 *
 *  Retiring the key needs no VERSION bump — the reader takes NAMED keys only, so an
 *  orphaned `voidCast` in a live blob costs nothing but its bytes (`persist.ts`).
 *
 *  `slice` is ASYMMETRIC and knowingly so: `{ enabled: false, y: 12 }` persists as `null`,
 *  so a depth the user chose survives them toggling the plane off and on again WITHIN a
 *  session but not across a restart — the next run re-parks at `SLICE_DEFAULT_Y`. Storing
 *  the parked depth would mean a second field (`slice` + `sliceY`) whose only job is to
 *  remember a number for a plane that is off, and the occupancy-seeded default
 *  (D-F4.5-16, see SLICE_DEFAULT_Y) is going to overwrite that number anyway. */
function serializeView(state: ViewState): UiState["view"] {
	return {
		shading: state.shading,
		layers: Object.fromEntries(
			PERSISTED_LAYER_KEYS.map((key) => [key, state.layers[key]]),
		),
		slice: state.slice.enabled ? state.slice.y : null,
	};
}

/** Schema-tolerant restore: anything missing or unrecognised falls back to the default,
 *  so a hand-edited or older blob degrades to the shipped view rather than throwing. Only
 *  PERSISTED layer keys are adopted — a stale key from a renamed layer must not travel
 *  into the object the host is handed, and neither must the retired `voidCast` a blob
 *  written before it became session-only still carries. That last one is the whole
 *  migration: the key survives in old blobs, the reader simply never looks at it, and the
 *  X-ray comes up off (see `serializeView` for what a restored `true` would do). */
function deserializeView(stored: UiState["view"]): ViewState {
	const base = defaultView();
	if (!stored) return base;
	const layers = { ...base.layers };
	for (const key of PERSISTED_LAYER_KEYS) {
		const value = stored.layers?.[key];
		if (typeof value === "boolean") layers[key] = value;
	}
	const slice =
		typeof stored.slice === "number"
			? { enabled: true, y: stored.slice }
			: base.slice;
	return {
		shading: stored.shading === "normals" ? "normals" : "studio",
		layers,
		slice,
		sampleCount: base.sampleCount,
	};
}

export function ViewProvider({
	host,
	engineReady,
	store,
	children,
}: {
	host: FieldHost | undefined;
	engineReady: boolean;
	store: UiStore | undefined;
	children: ReactNode;
}) {
	const [state, setState] = useState<ViewState>(defaultView);
	// The workspace-provider pair, and for the same reasons: nothing is written before the
	// first interaction (so the defaults rendered here can never overwrite a blob this
	// component has not read yet), and a restore that arrives after the user has already
	// changed something is dropped rather than yanking the view out from under them.
	const touched = useRef(false);
	const restored = useRef(false);
	// Whether the occupancy seed has already fired with a real answer. One per session,
	// deliberately: after the first seed the depth is the user's to keep, and re-deriving
	// it on every re-tick would throw away a plane they had positioned. The same
	// session-scoped asymmetry `serializeView` documents from the persistence side — the
	// depth survives a toggle within a run and not across one.
	const seeded = useRef(false);
	// The plane's enabled state as of the last commit, so `setSlice` can tell an ENABLE
	// from a slider drag. A ref rather than a read of `state`, because the actions object
	// must stay stable across every view change; synced in an effect below so it is
	// current before the next click.
	const sliceEnabled = useRef(false);

	// The store is keyed by the project root, which comes from a daemon call that can fail
	// or never resolve — so the view renders its defaults immediately and adopts the
	// persisted set when (if) the store shows up.
	useEffect(() => {
		if (!store || restored.current) return;
		restored.current = true;
		if (touched.current) return;
		const stored = store.get("view");
		// A cold start (nothing persisted) keeps the state object it already has, rather
		// than adopting an equal-valued new one: `deserializeView(undefined)` IS the
		// defaults, and `layers`/`slice` are objects, so a fresh copy re-fires their push
		// effects on identity alone. Harmless (both host seams are idempotent — `setSlice`
		// value-guards, `setLayers` acts only on the voidCast EDGE) and still wasteful:
		// every cold start would send the same two calls twice.
		if (!stored) return;
		setState(deserializeView(stored));
	}, [store]);

	// The enable mirror. Kept current from EVERY route the plane's state can change —
	// a click, and the persisted restore above, which can arrive with the plane already
	// on and would otherwise leave the next tick looking like a fresh enable.
	useEffect(() => {
		sliceEnabled.current = state.slice.enabled;
	}, [state.slice.enabled]);

	// Debounced by effect cleanup: each change cancels the previous pending write.
	useEffect(() => {
		if (!store || !touched.current) return;
		const timer = setTimeout(
			() => store.set("view", serializeView(state)),
			PERSIST_DEBOUNCE_MS,
		);
		return () => clearTimeout(timer);
	}, [store, state]);

	// One push per seam, each on its own value. They also cover engine-ready: the host is
	// created once and these run again when it appears, which is what replaces the panel's
	// old "push my defaults at ready" block — one mechanism instead of two that could
	// disagree.
	useEffect(() => {
		if (!engineReady || !host) return;
		host.setShading(state.shading);
	}, [engineReady, host, state.shading]);

	useEffect(() => {
		if (!engineReady || !host) return;
		host.setLayers(state.layers);
	}, [engineReady, host, state.layers]);

	useEffect(() => {
		if (!engineReady || !host) return;
		host.setSlice(state.slice.enabled ? state.slice.y : null);
	}, [engineReady, host, state.slice]);

	const actions = useMemo<ViewActions>(() => {
		/** Every verb goes through here: one place to record that the view is now the
		 *  user's, and functional updates so no verb closes over stale state. */
		const edit = (f: (s: ViewState) => ViewState) => {
			touched.current = true;
			setState(f);
		};
		return {
			setShading: (shading) => edit((s) => ({ ...s, shading })),
			setLayers: (layers) => edit((s) => ({ ...s, layers })),
			setSlice: (slice) => {
				// D-F4.5-16's occupancy seed. The host call happens HERE and not inside the
				// updater, because React may run an updater twice (StrictMode) and an
				// updater must be pure — and because this is the one place that can promise
				// "once per enable", which is the budget `occupiedTopY` is documented
				// against. Gated on the false→true edge, so a slider drag never re-derives
				// a depth the user is in the middle of choosing.
				const enabling = slice.enabled && !sliceEnabled.current;
				const top =
					enabling && !seeded.current && host ? host.occupiedTopY() : null;
				// A NULL answer does not consume the one-shot: it means the world had
				// nothing authored yet, and the user who ticks the box on an empty world,
				// digs, then ticks it again should get the seed on that second tick rather
				// than be stuck with the fallback for the session.
				if (top !== null) seeded.current = true;
				edit((s) => ({
					...s,
					slice:
						top === null
							? slice
							: { enabled: true, y: top + SLICE_SEED_CLEARANCE_M },
				}));
			},
			setSampleCount: (sampleCount) => edit((s) => ({ ...s, sampleCount })),
		};
	}, [host]);

	return (
		<ViewActionsContext.Provider value={actions}>
			<ViewStateContext.Provider value={state}>
				{children}
			</ViewStateContext.Provider>
		</ViewActionsContext.Provider>
	);
}
