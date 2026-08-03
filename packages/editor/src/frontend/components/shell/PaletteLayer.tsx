// The floating layer: every palette, plus the rail of collapsed chips, absolutely
// placed over the canvas inside the SAME cell (D-1 — see Shell's header). It takes no
// width from the canvas and it is `pointer-events-none`, so the only thing in it that
// can intercept a viewport drag is a palette itself.
//
// It also owns the two things the pure store cannot have: how big the cell is (bounds
// are measured here, once per gesture, and handed in) and where focus should land when
// a palette swaps places with its rail chip.

import type { LucideIcon } from "lucide-react";
import { Boxes, Flag, History, ScrollText, Settings2 } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
	usePaletteOrder,
	usePaletteRaise,
} from "../../hooks/usePaletteStack.tsx";
import {
	useWorkspaceActions,
	useWorkspaceState,
} from "../../hooks/useWorkspace.tsx";
import {
	type CellSize,
	cellBounds,
	clampToCell,
	type OriginBounds,
	PALETTE_IDS,
	PALETTES,
	type PaletteId,
	type PaletteSize,
	paletteBox,
	type SizeBounds,
	sizeBounds,
} from "../../lib/palette-store.ts";
import { Palette } from "./Palette.tsx";

/** Per-palette presentation: the rail glyph, and nothing else. How WIDE a palette is used
 *  to live beside it as a Tailwind class; it moved into the store at F4.5c Task 11, because
 *  the width is arithmetic (the projection's bounds, the default-arrangement proof) and a
 *  `w-[360px]` is a number only CSS can read. */
const PALETTE_ICON: Record<PaletteId, LucideIcon> = {
	entities: Boxes,
	session: Settings2,
	flags: Flag,
	history: History,
	log: ScrollText,
};

/** The cell's size, or `null` until it has one.
 *
 *  Its ONE consumer is the projection below, which is why a zero measurement reads as "not
 *  measured" rather than as a cell with no room in it: before the first layout (and in a
 *  DOM that runs none) every box is zero, and projecting against that would pin every
 *  palette to the origin. It stays a guard rather than becoming a complaint because the
 *  fallback is benign — no projection, stored geometry rendered as-is — and because the
 *  same measurement is already a contract violation `CanvasHost` throws over one sibling
 *  away; a second, quieter posture on one fact would only be noise.
 *
 *  `hidden` is a DEPENDENCY, not a detail. ⌘\ sets that attribute on the very element this
 *  measures, and a `display:none` element's every rect is zero — so a window resized while
 *  the layer is latched away is a resize this hook cannot read, and no second event fires
 *  when the latch lifts. Re-running on the flag is what re-measures at exactly the moment
 *  there is something to measure again; the early return is what stops the latched state
 *  from clearing a good measurement with a zero one.
 *
 *  A `resize` listener rather than a ResizeObserver: the cell's size is a function of the
 *  window and of nothing else — that is the layout contract at the top of `Shell` — so the
 *  window event is the whole story, and it costs no observer per mount. */
function useCellSize(
	ref: RefObject<HTMLDivElement | null>,
	hidden: boolean,
): CellSize | null {
	const [cell, setCell] = useState<CellSize | null>(null);
	useLayoutEffect(() => {
		if (hidden) return;
		const measure = (): void => {
			const rect = ref.current?.getBoundingClientRect();
			if (!rect || rect.width === 0 || rect.height === 0) return;
			setCell((prev) =>
				prev !== null &&
				prev.width === rect.width &&
				prev.height === rect.height
					? prev
					: { width: rect.width, height: rect.height },
			);
		};
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, [ref, hidden]);
	return cell;
}

export function PaletteLayer({
	content,
}: {
	/** Each palette's body, built by the SHELL rather than here. That keeps the elements
	 *  referentially stable across this component's drag re-renders, so React bails out
	 *  of re-rendering the (expensive, host-subscribed) contents 60 times a second. */
	content: Record<PaletteId, ReactNode>;
}) {
	const { palettes, hidden, fromRestore } = useWorkspaceState();
	const actions = useWorkspaceActions();
	const order = usePaletteOrder();
	const raise = usePaletteRaise();
	const layerRef = useRef<HTMLDivElement | null>(null);
	const cell = useCellSize(layerRef, hidden);
	const chipRefs = useRef<Partial<Record<PaletteId, HTMLButtonElement | null>>>(
		{},
	);
	const collapseRefs = useRef<
		Partial<Record<PaletteId, HTMLButtonElement | null>>
	>({});
	// Where focus must go after the NEXT render, set by whichever control is about to
	// disappear. Collapsing hides the palette (and its collapse button with it) and
	// expanding unmounts the chip — either way the browser drops focus to <body> and a
	// keyboard user is thrown back to the top of the document.
	const focusAfter = useRef<{ id: PaletteId; to: "chip" | "collapse" } | null>(
		null,
	);
	// Which palettes were open on the previous render, so OPENING one can raise it.
	const wasOpen = useRef<readonly PaletteId[] | null>(null);

	// THE SUMMON GUARANTEE, safety-net half. The summon SITES raise explicitly (the ⚠
	// chip, the burger's palette checkboxes), because they must also cover the case this effect
	// cannot see: a palette that is ALREADY open and merely buried, where there is no
	// false→true transition to catch. This effect is what makes the rule hold for openers
	// that do not know about `raise` at all — Reset Workspace re-opening a closed palette
	// today, and whatever is added later.
	//
	// The first pass raises nothing (`wasOpen` starts null) so the initial mount is not
	// read as four simultaneous summons.
	//
	// `fromRestore` is the second half of that, and it is a REAL distinction rather than a
	// tidy one. The workspace restore lands in a passive effect, which runs AFTER this
	// layout effect, so a restore arrives here as an ordinary closed→open transition — the
	// layer cannot tell "the user summoned this" from "this is what was on disk" out of the
	// value alone, and the provider is the only thing that knows. This used to be papered
	// over by a coincidence, stated in this comment and now falsified: `log` was the ONLY
	// palette whose default is closed AND was last in PALETTE_IDS, so a restore that opened
	// it raised it to where it already was. The session card made the closed set bigger, so
	// the provenance is asked for directly.
	//
	// `wasOpen` is still updated on a restore pass: the restore's own opens are then not
	// pending raises, and the next real summon is measured against what the restore left.
	//
	// A layout effect, not a plain one — the stack settles BEFORE the browser paints, so a
	// summoned palette never flashes at the wrong depth on its first frame.
	useLayoutEffect(() => {
		const open = PALETTE_IDS.filter((id) => palettes[id].open);
		const prev = wasOpen.current;
		if (prev !== null && !fromRestore)
			for (const id of open) if (!prev.includes(id)) raise(id);
		wasOpen.current = open;
	}, [palettes, raise, fromRestore]);

	useLayoutEffect(() => {
		const want = focusAfter.current;
		if (!want) return;
		focusAfter.current = null;
		const target =
			want.to === "chip"
				? chipRefs.current[want.id]
				: collapseRefs.current[want.id];
		target?.focus();
	});

	/** The palette's ORIGIN may range over the cell minus the palette's own box — which
	 *  makes maxX the right-docked position, exactly what the store snaps to. Called once
	 *  per gesture (the palette caches the result), never per pointermove. */
	const measureBounds = useCallback(
		(size: PaletteSize): OriginBounds | null => {
			const rect = layerRef.current?.getBoundingClientRect();
			if (!rect) return null;
			return {
				maxX: rect.width - size.width,
				maxY: rect.height - size.height,
			};
		},
		[],
	);

	/** Where a palette is SHOWN, which is its stored geometry projected into the cell as it
	 *  is right now. The record itself is left alone — see `clampToCell` for why a resize
	 *  must not rewrite the arrangement — so a window that shrinks and grows again returns
	 *  every palette to where the user put it.
	 *
	 *  Before the first measurement there is nothing to project against and the stored
	 *  geometry is rendered as-is. That is also the state a DOM with no layout stays in. */
	const shownGeom = (id: PaletteId) =>
		cell === null
			? palettes[id]
			: clampToCell(palettes[id], cellBounds(cell, id, palettes[id]));

	/** How big THIS palette may be dragged, from the cell as it is right now —
	 *  `measureBounds`' twin for the resize handle, and measured off the same rect for the
	 *  same reason (the `cell` state settles a render later than a gesture can start).
	 *
	 *  It takes the SHOWN geometry rather than the stored record, because how far a palette
	 *  may grow is a question about where it actually is: a docked one is placed from its
	 *  edge and its stored x says nothing about that. `sizeBounds` states the rest. */
	const measureSizeBounds = (id: PaletteId): SizeBounds | null => {
		const rect = layerRef.current?.getBoundingClientRect();
		if (!rect) return null;
		return sizeBounds(
			{ width: rect.width, height: rect.height },
			shownGeom(id),
		);
	};

	const collapse = (id: PaletteId): void => {
		focusAfter.current = { id, to: "chip" };
		actions.setCollapsed(id, true);
	};

	const expand = (id: PaletteId): void => {
		focusAfter.current = { id, to: "collapse" };
		actions.setCollapsed(id, false);
	};

	const chips = PALETTE_IDS.filter(
		(id) => palettes[id].open && palettes[id].collapsed,
	);

	return (
		// ⌘\ takes the whole layer, chips included: the point of the chord is an
		// unobstructed view of the field, and a rail of icons is still obstruction.
		// `hidden` rather than an early return, for the reason collapse uses it too — the
		// chord is a PEEK, and a peek that remounts every palette (resetting the panel
		// state its content subscribes for) would cost more than it shows.
		// `isolate` makes the layer its own stacking context, which is what confines the
		// per-palette z-index below to it. Without it those values compete with the
		// layer's SIBLINGS — the triad and the toast stack, both of which are above the
		// layer by DOM order alone — and a raised palette would paint over a refusal.
		<div
			ref={layerRef}
			hidden={hidden}
			className="pointer-events-none absolute inset-0 isolate"
		>
			{PALETTE_IDS.map((id) =>
				palettes[id].open ? (
					<Palette
						key={id}
						title={PALETTES[id].title}
						geom={shownGeom(id)}
						// The store reconciles the declared default with the user's own size —
						// ONE function, so the width rendered here is exactly the width
						// `cellBounds` subtracted for the projection a few lines up.
						box={paletteBox(id, palettes[id])}
						zIndex={order.indexOf(id) + 1}
						measureBounds={measureBounds}
						onMove={(pos, bounds) => actions.move(id, pos, bounds)}
						onNudge={(delta, bounds) => actions.nudge(id, delta, bounds)}
						measureSizeBounds={() => measureSizeBounds(id)}
						onResize={(size, bounds) => actions.resize(id, size, bounds)}
						onGrow={(delta, measured) => actions.grow(id, delta, measured)}
						onRaise={() => raise(id)}
						onCollapse={() => collapse(id)}
						onClose={() => actions.setOpen(id, false)}
						collapseRef={(el) => {
							collapseRefs.current[id] = el;
						}}
					>
						{content[id]}
					</Palette>
				) : null,
			)}
			{chips.length > 0 && (
				// Rendered only when something is collapsed, so the gutter costs nothing the
				// rest of the time.
				//
				// BOTTOM-LEFT, and that is the whole of the overlap answer. The rail used to
				// sit top-right, which was then the top of a full-height docked palette — so
				// collapsing anything put its chip on top of something else. The shipped
				// arrangement claims three columns from the top down (entities at x=24, the
				// session card at 420, history at 720) and the triad owns the top-right
				// corner; the bottom-left is the one strip nothing defaults into.
				//
				// What is left is an OCCUPANCY problem, and it runs the other way round from
				// the one this corner move fixed: the rail out-stacks every palette (see the
				// z-index below), so nothing can bury a chip — but a palette dragged into
				// this corner ends up with the chips sitting ON TOP of its content, and the
				// rail is `pointer-events-none` except on the chips themselves, so what the
				// user loses is 34 px of READING, not of clicking. The complete fix is the
				// mock's: reserve a 34 px gutter no palette may occupy, which costs the
				// gutter even when nothing is collapsed. Not worth it while chips are rare
				// and transient.
				<div
					// ABOVE every palette. It used to win by DOM order alone; now that the
					// palettes carry a click-to-front z-index, "last in the layer" is no
					// longer enough — and a chip is the only way back to the palette it
					// stands for, so it is the one thing here that must never be buried.
					style={{ zIndex: PALETTE_IDS.length + 1 }}
					// w-[34px] is the mock's gutter width. `flex-col-reverse` stacks the chips
					// UPWARD from the bottom edge, so the first one is always the closest to
					// the corner rather than floating a variable distance above it.
					className="pointer-events-none absolute bottom-0 left-0 flex w-[34px] flex-col-reverse items-center gap-1.5 pb-2"
				>
					{chips.map((id) => {
						const Icon = PALETTE_ICON[id];
						return (
							<button
								key={id}
								ref={(el) => {
									chipRefs.current[id] = el;
								}}
								type="button"
								title={PALETTES[id].title}
								aria-label={`expand ${PALETTES[id].title}`}
								onClick={() => expand(id)}
								className="pointer-events-auto grid h-[26px] w-[26px] place-items-center rounded-sm border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							>
								<Icon className="h-3.5 w-3.5" />
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
