// The floating layer: every palette, plus the rail of collapsed chips, absolutely
// placed over the canvas inside the SAME cell (D-1 — see Shell's header). It takes no
// width from the canvas and it is `pointer-events-none`, so the only thing in it that
// can intercept a viewport drag is a palette itself.
//
// It also owns the two things the pure store cannot have: how big the cell is (bounds
// are measured here, once per gesture, and handed in) and where focus should land when
// a palette swaps places with its rail chip.

import type { LucideIcon } from "lucide-react";
import { Boxes, ScrollText, Settings2, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useLayoutEffect, useRef } from "react";
import {
	usePaletteOrder,
	usePaletteRaise,
} from "../../hooks/usePaletteStack.tsx";
import {
	useWorkspaceActions,
	useWorkspaceState,
} from "../../hooks/useWorkspace.tsx";
import {
	type OriginBounds,
	PALETTE_IDS,
	PALETTES,
	type PaletteId,
} from "../../lib/palette-store.ts";
import { Palette, type PaletteSize } from "./Palette.tsx";

/** Per-palette presentation: the rail glyph and how wide the panel is. Kept out of the
 *  pure store, which stays free of React and of anything that isn't geometry.
 *
 *  MIGRATION (until F4.5b): `controls` is 300 px because it is still the whole
 *  FieldPanel control stack in one column — the panel dissolves into per-concern
 *  palettes next slice and takes this width with it. */
const PALETTE_CHROME: Record<
	PaletteId,
	{ Icon: LucideIcon; widthClass: string }
> = {
	controls: { Icon: SlidersHorizontal, widthClass: "w-[300px]" },
	// Wider than the controls column it came out of: a row is a monospace summary
	// (`scatter · seed 9 · 1 ops · rock · 24 placed`) followed by three verbs, and at
	// 300 px the summary truncated before it reached what the stamp actually placed.
	entities: { Icon: Boxes, widthClass: "w-[360px]" },
	// The mock's card is a 264 px form; 280 px is that plus the palette's own 8 px of
	// padding either side. Narrower than every other palette on purpose — it is a
	// label-column form, not a list, and a wide one puts the labels a long way from the
	// values they name.
	session: { Icon: Settings2, widthClass: "w-[280px]" },
	// Wider than the controls column: log lines are sentences (a save path, an esbuild
	// diagnostic), and a narrow box turns every one of them into four wrapped rows.
	log: { Icon: ScrollText, widthClass: "w-[380px]" },
};

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
	// chip, the burger's View group), because they must also cover the case this effect
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
						geom={palettes[id]}
						widthClass={PALETTE_CHROME[id].widthClass}
						zIndex={order.indexOf(id) + 1}
						measureBounds={measureBounds}
						onMove={(pos, bounds) => actions.move(id, pos, bounds)}
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
				// sit top-right, which is exactly where the default arrangement docks the
				// controls palette (full height, from y=0) — so collapsing any palette put
				// its chip on top of another one. Of the four corners the defaults claim
				// three: controls docks right, entities floats top-left, the triad owns
				// top-right. Bottom-left is the one strip nothing defaults into.
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
						const { Icon } = PALETTE_CHROME[id];
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
