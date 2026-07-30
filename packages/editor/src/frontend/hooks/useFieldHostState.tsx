// The ONE subscription point for the host seams the SHELL reads.
//
// Every FieldHost subscribe seam is a SINGLE SLOT: the host stores one callback per
// seam (`statsCb = cb`), so a second subscriber silently steals the first's — the
// earlier consumer just stops updating, with nothing thrown and nothing logged. The
// shell now has several consumers that want the same readout (the status bar today,
// more as palettes land), so the subscription lives here, once, and the consumers read
// it out of context. FieldPanel must NOT re-subscribe to anything this provider owns.
//
// MIGRATION (until F4.5b): grows one seam at a time as FieldPanel dissolves.
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { FieldHost, FieldStats } from "../../viewport-host/index.ts"; // type-only: erased

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

/** Read the shell's host-state mirror; throws outside the provider. */
export function useFieldHostState(): FieldHostState {
	const value = useContext(FieldHostStateContext);
	if (!value)
		throw new Error("useFieldHostState outside <FieldHostStateProvider>");
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

	useEffect(() => {
		if (!engineReady || !host) return;
		return host.subscribeStats((s) =>
			setStats((prev) => (prev !== null && statsEqual(prev, s) ? prev : s)),
		);
	}, [engineReady, host]);

	const value = useMemo<FieldHostState>(() => ({ stats }), [stats]);
	return (
		<FieldHostStateContext.Provider value={value}>
			{children}
		</FieldHostStateContext.Provider>
	);
}
