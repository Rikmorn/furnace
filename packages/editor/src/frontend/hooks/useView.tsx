// What the field LOOKS like — shading, layer visibility, the slice plane, viewport AA —
// and nothing about what is in it. Shell state, not panel state: the View popover in the
// top bar drives it, the burger's View group drives the same values, and the canvas layer
// reads the AA setting, so it cannot live inside a palette that closing would take with
// it (the world-state precedent).
//
// It is the chrome→host direction, which is why it is NOT part of `useFieldHostState`
// (host→chrome, single-slot subscriptions). The host has no shading/layers/slice
// subscription to mirror, so this provider is the source of truth and pushes: one effect
// per seam, each keyed on its own value, so a shading change never re-sends the layer
// flags (`setLayers` is edge-sensitive for `voidCast`) and a slider drag never re-sends
// the shading mode.
//
// Split into STATE and ACTIONS contexts, the useWorkspace/useWorld pattern: the actions
// are stable for the provider's lifetime, so a consumer that only writes never re-renders
// when the values change.
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

/** The layer names a persisted blob may speak about. */
// Boundary cast: `Object.keys` is typed `string[]` because a VALUE can structurally carry
// keys its type never declared — but the argument here is an object literal checked
// against `FieldLayers`, which cannot. Deriving the list (rather than writing it out)
// is what keeps a new layer restorable without a second edit here.
const LAYER_KEYS = Object.keys(DEFAULT_LAYERS) as (keyof FieldLayers)[];

/** Where the slice plane parks before the user has moved it: mid-slider, high enough to
 *  cut a typical kit hall.
 *
 *  MIGRATION (until F4.5b): seed slice from occupancy. D-F4.5-16 wants the default plane
 *  at the HIGHEST OCCUPIED CELL — a fact the host does not expose (no seam reports the
 *  store's occupied bounds), so a fixed park is what we can honestly do this slice. On a
 *  shallow world 8 m sits above everything and enabling the slice looks like it did
 *  nothing. */
const SLICE_DEFAULT_Y = 8;

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
 *  until that ordering is worth solving. */
function serializeView(state: ViewState): UiState["view"] {
	return {
		shading: state.shading,
		layers: { ...state.layers },
		slice: state.slice.enabled ? state.slice.y : null,
	};
}

/** Schema-tolerant restore: anything missing or unrecognised falls back to the default,
 *  so a hand-edited or older blob degrades to the shipped view rather than throwing. Only
 *  KNOWN layer keys are adopted — a stale key from a renamed layer must not travel into
 *  the object the host is handed. */
function deserializeView(stored: UiState["view"]): ViewState {
	const base = defaultView();
	if (!stored) return base;
	const layers = { ...base.layers };
	for (const key of LAYER_KEYS) {
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

	// The store is keyed by the project root, which comes from a daemon call that can fail
	// or never resolve — so the view renders its defaults immediately and adopts the
	// persisted set when (if) the store shows up.
	useEffect(() => {
		if (!store || restored.current) return;
		restored.current = true;
		if (touched.current) return;
		setState(deserializeView(store.get("view")));
	}, [store]);

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
			setSlice: (slice) => edit((s) => ({ ...s, slice })),
			setSampleCount: (sampleCount) => edit((s) => ({ ...s, sampleCount })),
		};
	}, []);

	return (
		<ViewActionsContext.Provider value={actions}>
			<ViewStateContext.Provider value={state}>
				{children}
			</ViewStateContext.Provider>
		</ViewActionsContext.Provider>
	);
}
