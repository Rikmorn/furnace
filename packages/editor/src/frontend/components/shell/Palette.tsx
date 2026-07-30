// One floating palette: a grab-handle header over a scrolling body, placed absolutely
// inside the palette layer from its stored geometry.
//
// Radix-free by choice — a palette is OUR chrome, not a form control: it needs pointer
// capture and an absolute box, none of the behaviour (focus management, dismiss layers,
// portalling) a Radix primitive would bring, and all of that behaviour would have to be
// fought off. Plain elements plus the shared Button.
//
// Collapsed palettes stay MOUNTED behind the `hidden` attribute rather than unmounting:
// their content is host-subscribed state that a remount resets (FieldPanel's flag
// filters are the documented case), and rolling a palette up must not be a state-losing
// act. `hidden` also takes it out of the accessibility tree, so the rail chip is the
// only thing a screen reader finds — which is what the collapsed state actually is.
import { ChevronUp, X } from "lucide-react";
import type {
	CSSProperties,
	ReactNode,
	PointerEvent as ReactPointerEvent,
} from "react";
import { useId, useRef } from "react";
import { cn } from "../../lib/cn.ts";
import type { PaletteState } from "../../lib/persist.ts";
import { Button } from "../ui/button.tsx";

/** A palette's measured box, handed to the layer with a move so it can turn the cell's
 *  size into bounds for THIS palette's origin. */
export type PaletteSize = { width: number; height: number };

/** What a pointer-capture drag needs to survive between events: which pointer owns the
 *  gesture, where it started, and where the palette was when it did. Measured ONCE at
 *  pointerdown — re-measuring per move would read the box mid-flight and drift. */
type Drag = {
	pointerId: number;
	fromX: number;
	fromY: number;
	originX: number;
	originY: number;
	size: PaletteSize;
};

/** Absolute placement from stored geometry. A docked palette is placed FROM its edge, so
 *  a window resize keeps it welded there; a free one is placed from its x. The
 *  max-height is what makes a tall palette scroll inside the cell instead of running
 *  under the status bar. */
function placement(geom: PaletteState): CSSProperties {
	const box: CSSProperties = {
		top: geom.y,
		maxHeight: `calc(100% - ${geom.y}px)`,
	};
	if (geom.edge === "right") return { ...box, right: 0 };
	if (geom.edge === "left") return { ...box, left: 0 };
	return { ...box, left: geom.x };
}

export function Palette({
	title,
	geom,
	widthClass,
	onMove,
	onCollapse,
	onClose,
	children,
}: {
	title: string;
	geom: PaletteState;
	widthClass: string;
	onMove: (pos: { x: number; y: number }, size: PaletteSize) => void;
	onCollapse: () => void;
	onClose: () => void;
	children: ReactNode;
}) {
	const headingId = useId();
	const rootRef = useRef<HTMLElement | null>(null);
	const drag = useRef<Drag | null>(null);

	const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
		// Left button only, and never from the header's own buttons — collapse and close
		// are clicks, and a click that also starts a drag makes both feel broken.
		if (e.button !== 0) return;
		if (e.target instanceof HTMLElement && e.target.closest("button")) return;
		const el = rootRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		drag.current = {
			pointerId: e.pointerId,
			fromX: e.clientX,
			fromY: e.clientY,
			// offsetLeft/Top are relative to the layer (the nearest positioned ancestor),
			// which is the same space the stored geometry lives in — and unlike `geom.x`
			// they are also right for a docked palette, whose x says nothing about where
			// the edge put it.
			originX: el.offsetLeft,
			originY: el.offsetTop,
			size: { width: rect.width, height: rect.height },
		};
		e.currentTarget.setPointerCapture(e.pointerId);
	};

	const onPointerMove = (e: ReactPointerEvent<HTMLElement>): void => {
		const d = drag.current;
		if (!d || d.pointerId !== e.pointerId) return;
		// A client-space delta IS a layer-space delta: the layer cannot move during the
		// gesture (it is the canvas cell), so no coordinate conversion is needed.
		onMove(
			{
				x: d.originX + (e.clientX - d.fromX),
				y: d.originY + (e.clientY - d.fromY),
			},
			d.size,
		);
	};

	const endDrag = (e: ReactPointerEvent<HTMLElement>): void => {
		const d = drag.current;
		if (!d || d.pointerId !== e.pointerId) return;
		drag.current = null;
		if (e.currentTarget.hasPointerCapture(e.pointerId))
			e.currentTarget.releasePointerCapture(e.pointerId);
	};

	return (
		<section
			ref={rootRef}
			aria-labelledby={headingId}
			hidden={geom.collapsed}
			style={placement(geom)}
			className={cn(
				// pointer-events-auto against the layer's -none: the layer covers the whole
				// canvas, so only the palettes themselves may take pointer input.
				"pointer-events-auto absolute flex flex-col overflow-hidden border border-border bg-card shadow-lg",
				widthClass,
				// A docked palette loses the border it shares with the cell edge (and its
				// rounding on that side), so it reads as part of the frame rather than a
				// card that happens to be touching it.
				geom.edge === null && "rounded-md",
				geom.edge === "right" && "rounded-l-md border-r-0",
				geom.edge === "left" && "rounded-r-md border-l-0",
			)}
		>
			{/* The drag handle is a pointer affordance on chrome, not a control: no role,
			    no tabstop, and no keyboard equivalent — moving a palette by keyboard is
			    F4.5c's (D-26). Its two VERBS are real buttons beside the title, so the
			    header is never the only way to reach anything. */}
			<header
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				className="flex shrink-0 cursor-grab touch-none select-none items-center gap-1 border-b border-border px-2 py-1.5 active:cursor-grabbing"
			>
				<h2
					id={headingId}
					className="min-w-0 flex-1 truncate font-semibold text-foreground text-xs"
				>
					{title}
				</h2>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-label={`collapse ${title}`}
					className="h-5 w-5 p-0"
					onClick={onCollapse}
				>
					<ChevronUp className="h-3.5 w-3.5" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-label={`close ${title}`}
					className="h-5 w-5 p-0"
					onClick={onClose}
				>
					<X className="h-3.5 w-3.5" />
				</Button>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
		</section>
	);
}
