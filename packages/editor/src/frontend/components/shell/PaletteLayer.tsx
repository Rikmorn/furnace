// The floating layer: every palette, plus the rail of collapsed chips, absolutely
// placed over the canvas inside the SAME cell (D-1 — see Shell's header). It takes no
// width from the canvas and it is `pointer-events-none`, so the only thing in it that
// can intercept a viewport drag is a palette itself.
//
// It also owns the two things the pure store cannot have: how big the cell is (bounds
// are measured here, once per gesture, and handed in) and where focus should land when
// a palette swaps places with its rail chip.

import type { LucideIcon } from "lucide-react";
import { SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useLayoutEffect, useRef } from "react";
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
};

export function PaletteLayer({
	content,
}: {
	/** Each palette's body, built by the SHELL rather than here. That keeps the elements
	 *  referentially stable across this component's drag re-renders, so React bails out
	 *  of re-rendering the (expensive, host-subscribed) contents 60 times a second. */
	content: Record<PaletteId, ReactNode>;
}) {
	const { palettes, hidden } = useWorkspaceState();
	const actions = useWorkspaceActions();
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
		actions.toggleCollapsed(id);
	};

	const expand = (id: PaletteId): void => {
		focusAfter.current = { id, to: "collapse" };
		actions.toggleCollapsed(id);
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
		<div
			ref={layerRef}
			hidden={hidden}
			className="pointer-events-none absolute inset-0"
		>
			{PALETTE_IDS.map((id) =>
				palettes[id].open ? (
					<Palette
						key={id}
						title={PALETTES[id].title}
						geom={palettes[id]}
						widthClass={PALETTE_CHROME[id].widthClass}
						measureBounds={measureBounds}
						onMove={(pos, bounds) => actions.move(id, pos, bounds)}
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
				// rest of the time. MIGRATION (until Task 10 of the F4.5a plan): with a
				// second palette this column can overlap a right-docked one — the mock docks
				// at right:34px for that reason. One palette cannot be docked and collapsed
				// at once, so the offset waits for the palette that makes it real.
				<div
					// w-[34px] is the mock's right gutter.
					className="pointer-events-none absolute top-0 right-0 flex w-[34px] flex-col items-center gap-1.5 pt-2"
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
