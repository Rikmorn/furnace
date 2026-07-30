// Which palette is in FRONT of which — the one piece of palette state that is not part
// of the arrangement.
//
// SESSION-LOCAL, and the line is worth drawing: D-3 persists geometry, collapse and open
// because those are arrangement DECISIONS the user made; which palette they touched last
// is an accident of the final minute of a session, and restoring it would restore an
// accident. So this deliberately lives OUTSIDE the workspace provider and outside the
// pure store — nothing here reaches the disk.
//
// It sits above the whole chrome rather than inside PaletteLayer because the layer is not
// where palettes are OPENED: the status bar's ⚠ chip and the burger's View group are, and
// both are the layer's siblings. A summon that could not raise what it summons is the bug
// this module exists to make impossible.
//
// Split into TWO contexts for the useWorkspace reason: the ORDER changes on every click
// inside any palette, and the two summon sites (the ⚠ chip, the burger) only ever WRITE
// it. Reading the order there would repaint the status bar and the menu on every click
// the user makes anywhere in the cockpit.
import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";
import { PALETTE_IDS, type PaletteId } from "../lib/palette-store.ts";

/** Bring a palette to the front. Idempotent: raising what is already on top returns the
 *  same state, so a caller never has to check first (a pointerdown fires on every click
 *  inside a palette, and most of them change nothing). */
export type PaletteRaise = (id: PaletteId) => void;

/** Both contexts DEFAULT rather than throw, the ToolErrorTickContext precedent: the
 *  summon sites are ordinary chrome (the status bar, the burger) that harness tests mount
 *  on their own, and outside a palette layer "raising a palette" genuinely is a no-op and
 *  "the order is the declared one" is genuinely true — that is the state of the world, not
 *  a wiring bug worth crashing over.
 *
 *  What makes the quiet default safe is that the REAL wiring is pinned somewhere else:
 *  every click-to-front and summon case in tests/chrome/shell.test.tsx renders `<Shell />`,
 *  so a provider dropped from the composition root leaves those consumers on these
 *  constants — a frozen z-order — and the assertions go red. */
const PaletteRaiseContext = createContext<PaletteRaise>(() => undefined);
const PaletteOrderContext = createContext<readonly PaletteId[]>(PALETTE_IDS);

/** The raise verb alone. Stable for the provider's lifetime, so a component that only
 *  summons never re-renders when the order changes. */
export function usePaletteRaise(): PaletteRaise {
	return useContext(PaletteRaiseContext);
}

/** The live back-to-front order. Re-renders its caller on every raise — read it only
 *  where the order is actually used (the layer's z-indexes, and the log's "can the user
 *  read me?" probe).
 *
 *  An ORDER rather than an `isTopmost` predicate, deliberately: "topmost" is only
 *  meaningful against a candidate set, and which palettes can occlude a given one is a
 *  question about GEOMETRY (open, uncollapsed, floating rather than docked elsewhere)
 *  that this module does not have and should not learn. The caller holds that. */
export function usePaletteOrder(): readonly PaletteId[] {
	return useContext(PaletteOrderContext);
}

export function PaletteStackProvider({ children }: { children: ReactNode }) {
	const [order, setOrder] = useState<readonly PaletteId[]>(PALETTE_IDS);

	// Never re-created, so `usePaletteRaise` really is free to its callers.
	const raise = useMemo<PaletteRaise>(
		() => (id) =>
			setOrder((prev) =>
				prev[prev.length - 1] === id
					? prev
					: [...prev.filter((p) => p !== id), id],
			),
		[],
	);

	return (
		<PaletteRaiseContext.Provider value={raise}>
			<PaletteOrderContext.Provider value={order}>
				{children}
			</PaletteOrderContext.Provider>
		</PaletteRaiseContext.Provider>
	);
}
