// The ONE subscription point for the host seams the SHELL reads.
//
// Every FieldHost subscribe seam is a SINGLE SLOT: the host stores one callback per
// seam (`statsCb = cb`), so a second subscriber silently steals the first's — the
// earlier consumer just stops updating, with nothing thrown and nothing logged. The
// shell now has several consumers that want the same readout (the status bar today,
// more as palettes land), so the subscriptions live here, once, and the consumers read
// them out of context. FieldPanel must NOT re-subscribe to anything this provider owns.
//
// Five seams so far: `subscribeStats` (the status bar's chips), `subscribeToolError`
// (a toast, plus the tick below), `subscribeCameraPose` (the corner axis triad) and the
// entity pair `subscribeEntities` + `subscribeDrift` (the entities palette). Each is
// published through its OWN context because they run at different cadences — see
// ToolErrorTickContext, CameraPoseContext and FieldEntitiesContext.
//
// MIGRATION (until F4.5b): grows one seam at a time as FieldPanel dissolves.
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
	FieldStats,
	PlacedArchetype,
} from "../../viewport-host/index.ts"; // type-only: erased
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
// and the row keeps the PREVIOUS world's count. (Params are the same shape and
// still uncompared — pre-existing, filed as
// `docs/backlog/editor-and-tooling/editor-chrome-authoring-gaps.md` §
// "An entity row's expanded params can show the PREVIOUS world's values after a
// load".)
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
		// The three voided below are deliberate non-compares: `type` is the constant
		// literal "generator"; `region` is never rendered by a row (the highlight box
		// is drawn from the HOST's own record, off an id); and `params` is the known
		// pre-existing hole, filed as
		// `docs/backlog/editor-and-tooling/editor-chrome-authoring-gaps.md` § "An
		// entity row's expanded params can show the PREVIOUS world's values after a
		// load".
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
			...rest
		} = e;
		void (rest satisfies Record<string, never>);
		void type;
		void params;
		void region;
		return (
			entityId === o.entityId &&
			generator === o.generator &&
			seed === o.seed &&
			opSpan[0] === o.opSpan[0] &&
			opSpan[1] === o.opSpan[1] &&
			frozen === o.frozen &&
			baked === o.baked &&
			samePlaced(placed, o.placed)
		);
	});

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

const FieldHostStateContext = createContext<FieldHostState | null>(null);

/** How many tool REFUSALS the host has reported, in its own context and deliberately
 *  NOT part of FieldHostState. The two seams run at different cadences: stats arrive
 *  every rAF, refusals arrive when someone does something the host won't do. Folding
 *  the counter into the stats value would re-render its consumer (FieldPanel — four
 *  subscriptions and a form-heavy subtree) on every remesh, which is exactly the
 *  pointer-rate coupling the palette layer's two-context split exists to avoid.
 *
 *  Defaults to 0 rather than throwing: a panel mounted OUTSIDE the shell (the harness
 *  tests do exactly that) has no host seam behind it, and "no refusal has happened" is
 *  the truth in that case, not a wiring bug worth crashing over. */
const ToolErrorTickContext = createContext(0);

/** The orbit camera's orientation, in its own context for the ToolErrorTick reason with
 *  the cadence turned up: the host pushes a pose on every camera move, so while the user
 *  flies this changes at frame rate. Folding it into FieldHostState would re-render the
 *  status bar 60×/s during a fly, which is exactly what the split exists to prevent.
 *
 *  Defaults to the identity view rather than throwing — an overlay mounted outside the
 *  provider (the harness tests do that) has no pose to read, and a triad drawn down the
 *  −Z axis is a truthful "no camera here". Deliberately NOT the host's own starting orbit:
 *  copying those two numbers into the chrome would be a constant that silently drifts,
 *  and inside the provider the host's push on subscribe replaces this on the first
 *  effect. */
const CameraPoseContext = createContext<CameraPose>({ yaw: 0, pitch: 0 });

/** The entity concern, in its own context for the ToolErrorTick reason from the other
 *  end of the cadence range: entities and drift move when someone COMMITS something,
 *  which is orders of magnitude rarer than a stats push. Folding them into
 *  FieldHostState would re-render the entities list on every remesh — a list of rows
 *  repainting under a dig it has nothing to do with. */
const FieldEntitiesContext = createContext<FieldEntitiesState | null>(null);

/** Read the shell's host-state mirror; throws outside the provider. */
export function useFieldHostState(): FieldHostState {
	const value = useContext(FieldHostStateContext);
	if (!value)
		throw new Error("useFieldHostState outside <FieldHostStateProvider>");
	return value;
}

/** A counter that increments on every host tool refusal. The MESSAGE is not here — it
 *  went to the notification store and is on screen as a toast; this is only for state
 *  a refusal has to release (FieldPanel's in-flight verify column), which needs to know
 *  that one happened and nothing else about it. */
export function useToolErrorTick(): number {
	return useContext(ToolErrorTickContext);
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
	const [toolErrorTick, setToolErrorTick] = useState(0);
	const [pose, setPose] = useState<CameraPose>({ yaw: 0, pitch: 0 });
	const [entities, setEntities] = useState<readonly FieldEntityInfo[]>([]);
	const [drift, setDrift] = useState<DriftFinding[] | null>(null);

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
	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeToolError((text) => {
			notify.error(text);
			setToolErrorTick((n) => n + 1);
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

	const value = useMemo<FieldHostState>(() => ({ stats }), [stats]);
	const entityValue = useMemo<FieldEntitiesState>(
		() => ({ entities, drift }),
		[entities, drift],
	);
	return (
		<FieldHostStateContext.Provider value={value}>
			<ToolErrorTickContext.Provider value={toolErrorTick}>
				<CameraPoseContext.Provider value={pose}>
					<FieldEntitiesContext.Provider value={entityValue}>
						{children}
					</FieldEntitiesContext.Provider>
				</CameraPoseContext.Provider>
			</ToolErrorTickContext.Provider>
		</FieldHostStateContext.Provider>
	);
}
