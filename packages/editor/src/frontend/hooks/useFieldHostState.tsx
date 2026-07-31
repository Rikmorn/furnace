// The ONE subscription point for the host seams the chrome reads.
//
// Every FieldHost subscribe seam is a SINGLE SLOT: the host stores one callback per
// seam (`statsCb = cb`), so a second subscriber silently steals the first's — the
// earlier consumer just stops updating, with nothing thrown and nothing logged. The
// shell has several consumers that want the same readout, and the dissolving control
// stack is about to become several more, so the subscriptions live here, once, and the
// consumers read them out of context. Nothing below this provider may subscribe to
// anything it owns.
//
// ALL TEN seams are here: `subscribeStats` (the status bar's chips), `subscribeToolError`
// (a toast, plus the verify release below), `subscribeCameraPose` (the corner axis triad),
// the entity pair `subscribeEntities` + `subscribeDrift` (the entities palette),
// `subscribeEntitySelection` (which row is selected, and the box the viewport draws for
// it), and the four the control stack held until F4.5b — `subscribeTool` (the brush
// palette's armed effect and the swatch ring), `subscribeSelection` (the selection verbs),
// `subscribeStamp` (the stamp inspector) and `subscribeFlags` (the advisor's list).
//
// They publish through EIGHT contexts, split by CADENCE rather than by owner: a seam that
// pushes at frame rate must not re-render a surface that only cares about something
// answered once a minute. Each context's own docblock states its cadence, and its
// throw-vs-default call with the reason for it. `subscribeToolError` is the one seam with
// no context of its own — its message goes straight to the toast stack, and the only state
// it releases (an in-flight verify) lives in this same file now.
import type { DriftFinding } from "@furnace/core/field"; // type-only: erased
import type { ReactNode } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import type {
	CameraPose,
	FieldEntityInfo,
	FieldHost,
	FieldMaskChoice,
	FieldStats,
	FieldTool,
	FlagFilters,
	FlagsSummary,
	PlacedArchetype,
	SelectionInfo,
	StampSession,
} from "../../viewport-host/index.ts"; // type-only: erased
// The ROW's own param renderer, so the push guard below compares exactly the
// string the `<dl>` shows (see `sameParams`). A value import of a component
// module from a hook is unusual and deliberate: two spellings of "render a
// param" is precisely the drift this guard exists to prevent.
import { formatParam } from "../components/field/EntitiesList.tsx";
import { notify } from "../lib/notify-store.ts";

/** Value-equality for the subscribeStats push guard (the host fires it every rAF; an
 *  idle field must not re-render the shell 60×/s). The destructure is a compiler
 *  backstop: a future FieldStats field lands in `rest`, fails the never-check and
 *  forces this comparator to learn it — a missed field would silently WEAKEN the guard
 *  (a changed value comparing equal → a stale readout). */
function statsEqual(a: FieldStats, b: FieldStats): boolean {
	const {
		chunks,
		lastRemeshMs,
		remeshVersion,
		totalOps,
		liveGenerators,
		compactableOps,
		undoDepth,
		redoDepth,
		lastReconfigureMs,
		analyzerPending,
		...rest
	} = a;
	void (rest satisfies Record<string, never>);
	return (
		chunks === b.chunks &&
		lastRemeshMs === b.lastRemeshMs &&
		remeshVersion === b.remeshVersion &&
		totalOps === b.totalOps &&
		liveGenerators === b.liveGenerators &&
		compactableOps === b.compactableOps &&
		undoDepth === b.undoDepth &&
		redoDepth === b.redoDepth &&
		lastReconfigureMs === b.lastReconfigureMs &&
		analyzerPending === b.analyzerPending
	);
}

// Entity-list identity for the refresh guard: everything a ROW can display —
// id + generator + seed + opSpan + the two state flags + the `placed` counts.
//
// `placed` is compared DIRECTLY rather than inferred from opSpan, and the reason
// is a fact that is easy to get wrong: op ids do NOT only ever grow. Core hands
// them out monotonically WITHIN a session, but `loadWorld` recomputes
// `log.nextId` from the loaded ops' own maximum (field-host.ts, the parseOps
// path), so ids — and with them every opSpan — RESTART across a world switch.
// Two worlds whose rows agree on id/generator/seed/span/flags and differ only in
// what a scatter placed are therefore reachable from the world drawer's Open,
// which calls loadWorld under this same provider: no remount, no state reset,
// just an entity tick. Without the `placed` comparison this guard returns `prev`
// and the row keeps the PREVIOUS world's count.
//
// `params` is the same hole one field over, and F4.5b Task 4 closed it: two
// worlds can hold records agreeing on every other compared field and differing
// only in their params, and an EXPANDED row renders those as a `<dl>`. It is
// compared through `formatParam` — the row's own renderer — rather than by
// value, because what must not go stale is the STRING on screen: two params that
// render identically (7 and "7") cannot make the row look different, and a
// deep-equality walk over arbitrary schema values would be doing more work to
// answer a question the row never asks.
//
// The flags DO need their own comparison too — freeze and bake rewrite the
// record and nothing else, so without them a frozen badge would never appear.
// Index-wise, not set-wise: `rowSummary` renders `placed` in ARRAY order, so a
// reordering changes the row string and must re-render.
const samePlaced = (
	a: readonly PlacedArchetype[],
	b: readonly PlacedArchetype[],
): boolean =>
	a.length === b.length &&
	a.every((p, i) => {
		const o = b[i];
		return (
			o !== undefined && p.archetypeId === o.archetypeId && p.count === o.count
		);
	});

/** Do two param sets RENDER the same `<dl>`? Index-wise over `Object.entries`,
 *  which is exactly what the row maps over — a reordered set is a reordered
 *  list, and the key column moving is a change the row must re-render for. */
const sameParams = (
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): boolean => {
	const entriesA = Object.entries(a);
	const entriesB = Object.entries(b);
	return (
		entriesA.length === entriesB.length &&
		entriesA.every(([key, value], i) => {
			const other = entriesB[i];
			return (
				other !== undefined &&
				other[0] === key &&
				formatParam(value) === formatParam(other[1])
			);
		})
	);
};

/** The chunk sets behind the row's drift badge. Index-wise for `samePlaced`'s
 *  reason and one more: the host builds these by walking a chunk box in a fixed
 *  order, so two equal sets ALWAYS arrive in the same order — an order change is
 *  a real change, never noise. */
const sameChunks = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((k, i) => k === b[i]);

const sameEntities = (
	a: readonly FieldEntityInfo[],
	b: readonly FieldEntityInfo[],
): boolean =>
	a.length === b.length &&
	a.every((e, i) => {
		const o = b[i];
		if (o === undefined) return false;
		// Compiler backstop — the toolsEqual/statsEqual rider, and the one THIS
		// comparator was missing when the `placed` hole shipped. FieldEntityInfo is
		// an intersection over CORE's GeneratorEntity, so a field added there lands
		// here silently and no test can exist for a field nobody knew to compare;
		// destructuring every one makes the compiler force the question.
		//
		// The two voided below are deliberate non-compares: `type` is the constant
		// literal "generator", and `region` is never rendered by a row (the emphasis
		// box is drawn from the HOST's own record, off an id — and `footprintChunks`,
		// which IS compared, moves whenever a region move is large enough to change
		// which chunks the stamp covers).
		const {
			entityId,
			type,
			generator,
			params,
			seed,
			region,
			opSpan,
			frozen,
			baked,
			placed,
			footprintChunks,
			...rest
		} = e;
		void (rest satisfies Record<string, never>);
		void type;
		void region;
		return (
			entityId === o.entityId &&
			generator === o.generator &&
			seed === o.seed &&
			opSpan[0] === o.opSpan[0] &&
			opSpan[1] === o.opSpan[1] &&
			frozen === o.frozen &&
			baked === o.baked &&
			samePlaced(placed, o.placed) &&
			sameParams(params, o.params) &&
			sameChunks(footprintChunks, o.footprintChunks)
		);
	});

// Value-equality for the subscribeTool echo guard (see the mirror effect).
const masksEqual = (a: FieldMaskChoice, b: FieldMaskChoice): boolean =>
	a.kind === "class" && b.kind === "class"
		? a.classId === b.classId
		: a.kind === b.kind;

const toolsEqual = (a: FieldTool, b: FieldTool): boolean => {
	// Compiler backstop (F2b rider): destructure EVERY FieldTool field — a
	// future field lands in `rest` and fails the never-check, forcing this
	// comparator to learn it. A missed field would silently WEAKEN the
	// subscribeTool echo guard: differing tools would compare equal and the
	// mirror would drop host-initiated changes.
	const { effect, materialId, hollow, mask, smooth, ...rest } = a;
	void (rest satisfies Record<string, never>);
	// The same backstop one level down: `smooth` is a nested shape whose future
	// fields would slip past the top-level destructure unseen.
	const { strength, iterations, mode, ...smoothRest } = smooth;
	void (smoothRest satisfies Record<string, never>);
	return (
		effect === b.effect &&
		materialId === b.materialId &&
		hollow === b.hollow &&
		masksEqual(mask, b.mask) &&
		strength === b.smooth.strength &&
		iterations === b.smooth.iterations &&
		mode === b.smooth.mode
	);
};

/** The brush the chrome opens on — a mirror of the host's own `defaultTool()` (dig into
 *  rock, unmasked, core SMOOTH_DEFAULTS-equivalent smooth, solid fill). A local literal
 *  because the chrome cannot value-import core or the host
 *  (frontend-no-engine-leakage), and `subscribeTool` fires only on HOST-initiated
 *  changes — there is nothing to seed from at mount. */
const DEFAULT_TOOL: FieldTool = {
	effect: "dig",
	materialId: 0,
	mask: { kind: "none" },
	smooth: { strength: 16, iterations: 1, mode: "both" },
	hollow: null,
};

/** Mirrors FieldHost's default digRadius (the slider's range lives in BrushInspector). */
const DEFAULT_RADIUS = 1.25;

/** The advisor bands the chrome asks for at boot — candidates only, mirroring the host's
 *  own DEFAULT_FLAG_FILTERS. A local literal for the DEFAULT_TOOL reason. */
const DEFAULT_FLAG_FILTERS: FlagFilters = {
	candidates: true,
	info: false,
	unreachable: false,
};

/** Nothing found yet — what the flags surface renders between mount and the host's first
 *  push, after which every summary is the host's. */
const NO_FLAGS: FlagsSummary = { total: 0, byKindSeverity: [], visible: [] };

/** Host-pushed state the shell renders. `stats` is null until the host's first push
 *  (which only starts once the render loop runs, i.e. after `init`). */
export type FieldHostState = {
	stats: FieldStats | null;
};

/** The committed generator entities plus the last reconfigure's drift report — one
 *  context because they are one concern (what has been stamped, and what the last
 *  re-stamp disturbed) read by one surface, the entities palette. */
export type FieldEntitiesState = {
	entities: readonly FieldEntityInfo[];
	/** null = clean / none. The report is HOST state: dismiss goes through the host. */
	drift: DriftFinding[] | null;
};

/** The armed brush, and the radius it strokes with. Read-write in one context rather
 *  than the state/actions PAIR the sibling providers use (useView, useWorkspace,
 *  useWorld): the adopt and the push here are ONE concern that cannot be separated —
 *  see the echo guard on the mirror effect — and useView's own header says to delete
 *  that split rather than defend it where nobody benefits. Every consumer of this
 *  context both shows the tool and changes it. */
export type FieldToolState = {
	tool: FieldTool;
	/** The brush radius. CHROME state, not a mirror: FieldTool does not carry radius and
	 *  no seam reports one, so this is one-way (see `setRadius`). */
	radius: number;
	/** Adopt + push, the ONE funnel for a tool change. The host clamps (smooth ceilings,
	 *  hollow floor) as a backstop; the controls stay inside the same ranges so chrome
	 *  and host agree. */
	setTool: (next: FieldTool) => void;
	/** Adopt + push, DELIBERATELY one-way: the host's wheel and `[` / `]` also step its
	 *  radius and there is no host→chrome radius seam, so the readout can still lag the
	 *  host after wheel/key sizing. Pre-existing asymmetry, kept — the ghost ring in the
	 *  viewport is the live radius display. */
	setRadius: (r: number) => void;
};

/** Which committed entity the host has selected — `null` for none. */
export type FieldEntitySelectionState = {
	selectedEntityId: number | null;
};

/** What the host currently has selected — `null` for nothing. */
export type FieldSelectionState = {
	selection: SelectionInfo | null;
};

/** The live stamp/reconfigure session — `null` between sessions. */
export type FieldStampState = {
	stamp: StampSession | null;
};

/** The advisor's findings, the bands the chrome asks for, and the one verify in flight.
 *
 *  `verifying` is CHROME state (the row key stage 2 is running on) because releasing it
 *  takes two signals no single host seam carries: a verdict arrives on `subscribeFlags`,
 *  and each of `verifyFlag`'s refusals arrives on the tool-error seam having pushed no
 *  flags at all. Both halves live in this file, which is why the state does too. */
export type FieldFlagsState = {
	flags: FlagsSummary;
	filters: FlagFilters;
	setFilters: (next: FlagFilters) => void;
	verifying: string | null;
	/** Adopt BEFORE the call, never after: ALL FOUR of the host's refusals are decided
	 *  synchronously and report on the tool-error seam from inside `verifyFlag` (only a
	 *  stage-2 FAILURE is async), so a write afterwards would overwrite the release that
	 *  refusal just performed and leave the column stuck on a verify that never ran. */
	verify: (key: string) => void;
};

const FieldHostStateContext = createContext<FieldHostState | null>(null);

/** The orbit camera's orientation, in its own context at the TOP of the cadence range:
 *  the host pushes a pose on every camera move, so while the user flies this changes at
 *  frame rate. Folding it into FieldHostState would re-render the status bar 60×/s during
 *  a fly, which is exactly what the split exists to prevent.
 *
 *  Defaults to the identity view rather than throwing — an overlay mounted outside the
 *  provider (the harness tests do that) has no pose to read, and a triad drawn down the
 *  −Z axis is a truthful "no camera here". Deliberately NOT the host's own starting orbit:
 *  copying those two numbers into the chrome would be a constant that silently drifts,
 *  and inside the provider the host's push on subscribe replaces this on the first
 *  effect. */
const CameraPoseContext = createContext<CameraPose>({ yaw: 0, pitch: 0 });

/** The entity concern, in its own context from the BOTTOM of that range: entities and
 *  drift move when someone COMMITS something, which is orders of magnitude rarer than a
 *  stats push. Folding them into FieldHostState would re-render the entities list on
 *  every remesh — a list of rows repainting under a dig it has nothing to do with. */
const FieldEntitiesContext = createContext<FieldEntitiesState | null>(null);

/** Which entity is selected, CLICK-paced and kept apart from the entity list beside it.
 *  Both are user-driven, but they move on different events and by an order of magnitude:
 *  the list moves when someone COMMITS, the selection moves on every `pointer` click in
 *  the viewport — including the ones that land on bare terrain and select nothing. Folded
 *  into FieldEntitiesState, a click on empty space would re-render the drift report and
 *  every row's summary; kept apart, the rows re-read only their own `selected` flag. It is
 *  also the context with readers OUTSIDE the palette coming (the move gizmo, the session
 *  card), which is the same "get the shape right before the consumers arrive" the four
 *  below were built on.
 *
 *  Throws outside the provider, and the reason is specific to this value rather than
 *  borrowed: `null` is a REAL member of its domain — it means "nothing is selected" — so
 *  unlike CameraPoseContext's identity pose there is no value here that reads as "nobody
 *  asked". A default would put every row in the unselected style beside a viewport box
 *  that is plainly drawn, which is the disagreement between palette and viewport that
 *  having ONE selection concept exists to prevent. */
const FieldEntitySelectionContext =
	createContext<FieldEntitySelectionState | null>(null);

// The four contexts below are what the control stack reads, and they are honest about
// which of their two splits pays TODAY. Keeping them out of the frame-paced
// FieldHostState is a live saving: FieldPanel reads all four, so folding any of them into
// the stats value would repaint a form-heavy subtree on every remesh. Splitting them from
// EACH OTHER saves nothing yet, because that one consumer reads all four — a stamp nudge
// re-renders the panel whichever context carries it, exactly as the local `useState` slots
// it replaced did. It is built as four because the shape has to be right before the
// consumers arrive, not after: Tasks 8 and 13 of this slice break the panel into a tool
// strip and a flags palette that read one context each, and that is when the split starts
// paying. Cadence is the axis because it is the one that will not need revisiting then.

/** The brush concern, USER-paced: the host pushes a tool on an Alt-click eyedrop and on
 *  every momentary ⇧/⌃ press and release, i.e. as fast as fingers move and no faster.
 *
 *  Throws outside the provider, unlike CameraPoseContext above — the one DEFAULTED context
 *  in this file, and the only one whose default value is true anywhere ("no camera here").
 *  Both reasons here are load-bearing: a defaulted `tool` would claim the host is on
 *  dig-into-rock when nobody has asked it anything, and a defaulted `setTool` would be a
 *  silent no-op behind a live-looking button — the dead-control failure the sibling ACTION
 *  contexts (useViewActions, useWorkspaceActions, useWorldActions) all throw over. */
const FieldToolContext = createContext<FieldToolState | null>(null);

/** The selection concern, GESTURE-paced: one push per completed box/flood/wand, plus the
 *  current state on subscribe (so a surface mounting over a live selection does not render
 *  "no selection" beside a visible amber overlay). Kept apart from the stamp context beside
 *  it because a stamp nudge pushes at pointer rate while this moves once per gesture — the
 *  widest cadence gap among the four, and so the split most worth having in place before
 *  the two have separate readers.
 *
 *  Throws: `{ selection: null }` reads as "the host has nothing selected", which is a
 *  claim about the host that nobody outside the provider is in a position to make — the
 *  FieldEntitiesContext rule, one concern over. */
const FieldSelectionContext = createContext<FieldSelectionState | null>(null);

/** The session concern, POINTER-paced while one is live: `subscribeStamp` pushes a clone
 *  on every nudge, param edit and preview run, plus the current session on subscribe (so
 *  a remount mid-session recovers the live form). The fast side of the pair above.
 *
 *  Throws, for the FieldSelectionContext reason: a defaulted `null` claims there is no
 *  session in progress. */
const FieldStampContext = createContext<FieldStampState | null>(null);

/** The advisor concern, ANSWER-paced: a push per analyzer response and per filter change,
 *  which is the slowest cadence in this file and the reason it needs no value-equality
 *  guard where the stats mirror does.
 *
 *  Throws: every field here is a claim about work the host has or has not done — an empty
 *  summary reads as "the advisor found nothing", a null `verifying` as "no verify is
 *  running" — and `setFilters`/`verify` would be silent no-ops behind live controls
 *  (the FieldToolContext reason). */
const FieldFlagsContext = createContext<FieldFlagsState | null>(null);

/** Read the shell's host-state mirror; throws outside the provider. */
export function useFieldHostState(): FieldHostState {
	const value = useContext(FieldHostStateContext);
	if (!value)
		throw new Error("useFieldHostState outside <FieldHostStateProvider>");
	return value;
}

/** The orbit camera's current orientation. Re-renders its caller on every camera move —
 *  read it only where the orientation is actually drawn (the corner triad). */
export function useCameraPose(): CameraPose {
	return useContext(CameraPoseContext);
}

/** The committed entities + the standing drift report; throws outside the provider.
 *  Unlike the two defaulted contexts above this one is a hard wiring requirement: its
 *  only consumer is a palette the shell mounts, and an empty list is indistinguishable
 *  from a world that genuinely has no stamps — a silence worth crashing over. */
export function useFieldEntities(): FieldEntitiesState {
	const value = useContext(FieldEntitiesContext);
	if (!value)
		throw new Error("useFieldEntities outside <FieldHostStateProvider>");
	return value;
}

/** The selected committed entity's id (`null` = none); throws outside the provider.
 *  READ-ONLY: selecting goes through the host (`fieldHostRef.current.selectEntity`), the
 *  way every other shell verb does — there is one selection, the host owns it, and a
 *  setter here would be a second way to spell the same write. */
export function useFieldEntitySelection(): FieldEntitySelectionState {
	const value = useContext(FieldEntitySelectionContext);
	if (!value)
		throw new Error("useFieldEntitySelection outside <FieldHostStateProvider>");
	return value;
}

/** The armed brush plus the verbs that change it; throws outside the provider. */
export function useFieldTool(): FieldToolState {
	const value = useContext(FieldToolContext);
	if (!value) throw new Error("useFieldTool outside <FieldHostStateProvider>");
	return value;
}

/** What the host has selected; throws outside the provider. */
export function useFieldSelection(): FieldSelectionState {
	const value = useContext(FieldSelectionContext);
	if (!value)
		throw new Error("useFieldSelection outside <FieldHostStateProvider>");
	return value;
}

/** The live stamp/reconfigure session; throws outside the provider. */
export function useFieldStamp(): FieldStampState {
	const value = useContext(FieldStampContext);
	if (!value) throw new Error("useFieldStamp outside <FieldHostStateProvider>");
	return value;
}

/** The advisor's findings, filters and in-flight verify; throws outside the provider. */
export function useFieldFlags(): FieldFlagsState {
	const value = useContext(FieldFlagsContext);
	if (!value) throw new Error("useFieldFlags outside <FieldHostStateProvider>");
	return value;
}

export function FieldHostStateProvider({
	host,
	engineReady,
	children,
}: {
	host: FieldHost | undefined;
	engineReady: boolean;
	children: ReactNode;
}) {
	const [stats, setStats] = useState<FieldStats | null>(null);
	const [pose, setPose] = useState<CameraPose>({ yaw: 0, pitch: 0 });
	const [entities, setEntities] = useState<readonly FieldEntityInfo[]>([]);
	const [drift, setDrift] = useState<DriftFinding[] | null>(null);
	const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
	const [tool, setToolState] = useState<FieldTool>(DEFAULT_TOOL);
	const [radius, setRadiusState] = useState(DEFAULT_RADIUS);
	const [selection, setSelection] = useState<SelectionInfo | null>(null);
	const [stamp, setStamp] = useState<StampSession | null>(null);
	const [flags, setFlags] = useState<FlagsSummary>(NO_FLAGS);
	const [filters, setFilters] = useState<FlagFilters>(DEFAULT_FLAG_FILTERS);
	const [verifying, setVerifying] = useState<string | null>(null);

	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeStats((s) =>
			setStats((prev) => (prev !== null && statsEqual(prev, s) ? prev : s)),
		);
	}, [engineReady, host]);

	// The host's user-facing refusals (selection-mask misuse, "select a region first",
	// the void-cast budget, all four verify guards). They go STRAIGHT to the toast stack
	// — the F3b gate found them landing on a shared footer line where they read
	// indistinguishably from routine info, i.e. as dead features. A toast is toned, is
	// over the canvas the user is looking at, and outlives the next message.
	//
	// No message is mirrored into context: the toast IS the render, and a second copy in
	// React state would be a second thing to keep in agreement with it.
	//
	// It also RELEASES any verify in flight, which is the second half of a pairing whose
	// first half is the flags push below. Every `verifyFlag` refusal reports here having
	// pushed no flags at all, so this is the only signal that a verify the user started
	// never actually began; without it the column would read "Verifying…" until the next
	// analyzer response. Deliberately blunt — an UNRELATED tool error (a failed stroke)
	// releases it too. That way round is the safe one: the host still refuses a real
	// second verify with "a verify is already running", so the cost is a button that
	// looks live for a moment, against a column that sticks for good.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeToolError((text) => {
			notify.error(text);
			setVerifying(null);
		});
	}, [engineReady, host]);

	// The camera pose, for the corner orientation triad. Guarded like the stats push and
	// for the same reason at a higher rate: the host publishes a pose from every path that
	// applies the orbit, including the ones that move only the TARGET (frame-chunks), and
	// an orientation that did not change must not re-render the overlay.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeCameraPose((next) =>
			setPose((prev) =>
				prev.yaw === next.yaw && prev.pitch === next.pitch ? prev : next,
			),
		);
	}, [engineReady, host]);

	// Entities refresh strategy (F3a): ONE host-pushed trigger. The host fires
	// subscribeEntities from every path that can add, remove or rewrite an entity record
	// — commit, reconfigure apply, freeze/unfreeze, bake, ⌘Z/⇧⌘Z, world new/load — plus
	// once on subscribe. The tick carries NOTHING: the list is re-read here, so the host
	// stays the single source of truth and no payload can be held past its refresh.
	// `sameEntities` is what keeps a tick that changed nothing from re-rendering the
	// palette (freeze and bake tick without touching a chunk, and every listEntities()
	// call hands back fresh clones — so identity alone says nothing).
	const refreshEntities = useCallback((): void => {
		if (!host) return;
		// READ outside the updater. A state updater must be a pure function of `prev` —
		// React may call it twice (StrictMode) or replay it, and `listEntities()` walks the
		// whole op log to attribute placements. Latent rather than broken today, but the
		// failure it invites is a double log walk per tick on a long world.
		const next = host.listEntities();
		setEntities((prev) => (sameEntities(prev, next) ? prev : next));
	}, [host]);

	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeEntities(refreshEntities);
	}, [engineReady, host, refreshEntities]);

	// The reconfigure drift report. subscribeDrift pushes clones plus the current report
	// on subscribe (a palette re-opened after an apply keeps its findings); dismiss,
	// reset and load all push null through the same seam, so setDrift is the whole mirror.
	//
	// No comparator, and NOT because the host only pushes on change — it does not:
	// `dismissDrift` on an already-clean report and every `loadWorld` push null
	// regardless. It needs none because those redundant pushes are all null, and
	// `setDrift(null)` against a null state is a no-op React bails out of by identity.
	// A redundant push of a non-null report cannot happen (only an apply that LANDED
	// produces one), which is what makes this safe rather than lucky.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeDrift(setDrift);
	}, [engineReady, host]);

	// The entity selection — which row is highlighted, and the entity the viewport is
	// boxing. Pushed on every change (a `pointer` click, a row click through
	// `host.selectEntity`, and the invalidation that fires when the selected entity
	// leaves the log), plus the current id on subscribe.
	//
	// NO value guard, and the reason is a property of the seam rather than of the
	// cadence: the host's own `setSelectedEntity` returns early when the resolved id
	// equals the one it holds, so a redundant value is never pushed at all — the one
	// seam in this file whose contract makes the guard unnecessary rather than merely
	// affordable. A `useState` set to the same NUMBER is also a React bail-out by
	// identity, so even a host that regressed on that would cost nothing here. The
	// mirror is therefore the whole effect.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeEntitySelection(setSelectedEntityId);
	}, [engineReady, host]);

	// Mirror HOST-initiated tool changes (Alt-click eyedropper, momentary Shift/Ctrl
	// overrides). ECHO GUARD (binding rider): a chrome `setTool` that lands while a
	// momentary modifier is held makes the host re-derive and fire THIS callback with the
	// DERIVED tool — so the mirror ADOPTS only (a state write, never a `host.setTool`
	// re-push: pushing the derived tool back would re-derive → re-fire → loop), and
	// value-compares first so an echo of our own state returns the same reference.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeTool((t) =>
			setToolState((prev) => (toolsEqual(prev, t) ? prev : t)),
		);
	}, [engineReady, host]);

	// The selection mirror (the count, the truncation warning, Clear / Reselect).
	// `subscribeSelection` pushes the CURRENT state on subscribe, so a surface mounting
	// over a live selection renders it rather than "no selection".
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeSelection(setSelection);
	}, [engineReady, host]);

	// The session mirror. `subscribeStamp` pushes CLONES plus the current session on
	// subscribe, so a surface mounting mid-session recovers the live form.
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeStamp(setStamp);
	}, [engineReady, host]);

	// The advisor's findings. Pushed after every analyzer response and every
	// `setFlagFilters` (plus the current summary on subscribe). Answer-paced, not
	// frame-paced — which is why, unlike the stats mirror above, this needs no
	// value-equality guard.
	//
	// ANY push releases the in-flight verify, not just the one carrying its verdict: a
	// re-analysis that landed mid-verify may have replaced the row the key names, and
	// holding the column against a row that no longer exists would disable every Verify in
	// the list with no way back. (The refusal half of that release is the tool-error
	// effect above.)
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeFlags((summary) => {
			setFlags(summary);
			setVerifying(null);
		});
	}, [engineReady, host]);

	// The filters are CHROME state pushed into the host, which has no filters seam to
	// mirror — so this is a one-way push, keyed on the value, the useView pattern. Keying
	// it on `filters` folds engine-ready and every later edit into ONE mechanism, which
	// matters because this value has to be pushed at MOUNT as well as on change: the host
	// keeps the last set across a world load, so silence at mount would leave freshly
	// rendered checkboxes describing bands the host is not actually drawing.
	//
	// Deliberately NOT the shape `setTool`/`setRadius` use (push inside the handler), and
	// the criterion is that mount push plus cadence. This one is click-rate — three
	// checkboxes — so the effect form's cost is invisible; the brush verbs are pointer-rate
	// (a slider drag) and would pay it every frame. The cost is real and worth naming: a
	// toggle here renders twice rather than once, and for one frame between them the box
	// shows the new band while the host still holds the old. That window is why the
	// "one mechanism" above is about mount-vs-edit agreement, not about the chrome and the
	// host being in lockstep within a frame — they are not, and nothing here needs them to
	// be (a filter is a view over findings the host has already computed).
	//
	// Living HERE rather than in a palette is what makes the arrangement honest: the host
	// outlives every palette, so a surface that re-pushed its defaults on each remount
	// would silently untick the user's bands — closing and re-opening the palette that
	// holds them is a live gesture (the burger's checkbox is the way back), not a
	// hypothetical. This provider mounts once, with the shell. Remembering the set ACROSS
	// sessions is D-3's, and arrives with the palette.
	useEffect(() => {
		if (!engineReady || !host) return;
		host.setFlagFilters(filters);
	}, [engineReady, host, filters]);

	const setTool = useCallback(
		(next: FieldTool): void => {
			setToolState(next);
			host?.setTool(next);
		},
		[host],
	);

	// Adopt + push inside the handler, NOT the filters effect above: this is the
	// pointer-rate half of that criterion (a slider drag pushes per frame, and the effect
	// form would cost a second render pass on every one of them), and it has no mount push
	// to fold in — the chrome's default IS the host's, so there is nothing to correct at
	// engine-ready. Adding one would be a new host call for no disagreement.
	const setRadius = useCallback(
		(r: number): void => {
			setRadiusState(r);
			host?.setDigRadius(r);
		},
		[host],
	);

	const verify = useCallback(
		(key: string): void => {
			setVerifying(key);
			host?.verifyFlag(key);
		},
		[host],
	);

	const value = useMemo<FieldHostState>(() => ({ stats }), [stats]);
	const entityValue = useMemo<FieldEntitiesState>(
		() => ({ entities, drift }),
		[entities, drift],
	);
	const entitySelectionValue = useMemo<FieldEntitySelectionState>(
		() => ({ selectedEntityId }),
		[selectedEntityId],
	);
	const toolValue = useMemo<FieldToolState>(
		() => ({ tool, radius, setTool, setRadius }),
		[tool, radius, setTool, setRadius],
	);
	const selectionValue = useMemo<FieldSelectionState>(
		() => ({ selection }),
		[selection],
	);
	const stampValue = useMemo<FieldStampState>(() => ({ stamp }), [stamp]);
	const flagsValue = useMemo<FieldFlagsState>(
		() => ({ flags, filters, setFilters, verifying, verify }),
		[flags, filters, verifying, verify],
	);
	return (
		<FieldHostStateContext.Provider value={value}>
			<CameraPoseContext.Provider value={pose}>
				<FieldEntitiesContext.Provider value={entityValue}>
					<FieldEntitySelectionContext.Provider value={entitySelectionValue}>
						<FieldToolContext.Provider value={toolValue}>
							<FieldSelectionContext.Provider value={selectionValue}>
								<FieldStampContext.Provider value={stampValue}>
									<FieldFlagsContext.Provider value={flagsValue}>
										{children}
									</FieldFlagsContext.Provider>
								</FieldStampContext.Provider>
							</FieldSelectionContext.Provider>
						</FieldToolContext.Provider>
					</FieldEntitySelectionContext.Provider>
				</FieldEntitiesContext.Provider>
			</CameraPoseContext.Provider>
		</FieldHostStateContext.Provider>
	);
}
