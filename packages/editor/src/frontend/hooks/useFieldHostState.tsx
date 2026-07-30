// The ONE subscription point for the host seams the SHELL reads.
//
// Every FieldHost subscribe seam is a SINGLE SLOT: the host stores one callback per
// seam (`statsCb = cb`), so a second subscriber silently steals the first's — the
// earlier consumer just stops updating, with nothing thrown and nothing logged. The
// shell now has several consumers that want the same readout (the status bar today,
// more as palettes land), so the subscriptions live here, once, and the consumers read
// them out of context. FieldPanel must NOT re-subscribe to anything this provider owns.
//
// Three seams so far: `subscribeStats` (the status bar's chips), `subscribeToolError`
// (a toast, plus the tick below) and `subscribeCameraPose` (the corner axis triad). Each
// is published through its OWN context because they run at different cadences — see
// ToolErrorTickContext and CameraPoseContext.
//
// MIGRATION (until F4.5b): grows one seam at a time as FieldPanel dissolves.
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type {
	CameraPose,
	FieldHost,
	FieldStats,
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

/** Host-pushed state the shell renders. `stats` is null until the host's first push
 *  (which only starts once the render loop runs, i.e. after `init`). */
export type FieldHostState = {
	stats: FieldStats | null;
};

const FieldHostStateContext = createContext<FieldHostState | null>(null);

/** How many tool REFUSALS the host has reported, in its own context and deliberately
 *  NOT part of FieldHostState. The two seams run at different cadences: stats arrive
 *  every rAF, refusals arrive when someone does something the host won't do. Folding
 *  the counter into the stats value would re-render its consumer (FieldPanel — seven
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

	const value = useMemo<FieldHostState>(() => ({ stats }), [stats]);
	return (
		<FieldHostStateContext.Provider value={value}>
			<ToolErrorTickContext.Provider value={toolErrorTick}>
				<CameraPoseContext.Provider value={pose}>
					{children}
				</CameraPoseContext.Provider>
			</ToolErrorTickContext.Provider>
		</FieldHostStateContext.Provider>
	);
}
