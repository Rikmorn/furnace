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
	Ref,
} from "react";
import { useId, useRef } from "react";
import { cn } from "../../lib/cn.ts";
import type { OriginBounds } from "../../lib/palette-store.ts";
import type { PaletteState } from "../../lib/persist.ts";
import { Button } from "../ui/button.tsx";

/** A palette's measured box, handed to the layer with a move so it can turn the cell's
 *  size into bounds for THIS palette's origin. */
export type PaletteSize = { width: number; height: number };

/** What a pointer-capture drag needs to survive between events: which pointer owns the
 *  gesture, where it started, where the palette was when it did, and the box its origin
 *  may range over. All measured ONCE at pointerdown — neither the palette nor the layer
 *  can move during the gesture, and a getBoundingClientRect per pointermove would force
 *  a full-document reflow at pointer rate to learn nothing new. */
type Drag = {
	pointerId: number;
	fromX: number;
	fromY: number;
	originX: number;
	originY: number;
	bounds: OriginBounds;
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
	measureBounds,
	onMove,
	onCollapse,
	onClose,
	collapseRef,
	children,
}: {
	title: string;
	geom: PaletteState;
	widthClass: string;
	/** Bounds for THIS palette's origin, from the layer that owns the measurement.
	 *  Null when the layer is not mounted, which refuses the drag rather than guessing. */
	measureBounds: (size: PaletteSize) => OriginBounds | null;
	onMove: (pos: { x: number; y: number }, bounds: OriginBounds) => void;
	onCollapse: () => void;
	onClose: () => void;
	/** The collapse button, published so the layer can put focus back on it when the
	 *  rail chip that replaced this palette is used to bring it back. */
	collapseRef?: Ref<HTMLButtonElement>;
	children: ReactNode;
}) {
	const headingId = useId();
	const rootRef = useRef<HTMLElement | null>(null);
	const drag = useRef<Drag | null>(null);

	const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
		// Left button only, and never from the header's own buttons — collapse and close
		// are clicks, and a click that also starts a drag makes both feel broken.
		// `Element`, not `HTMLElement`: the buttons' icons are SVG, so the pointer's
		// target inside one is an SVGElement and an HTMLElement check would miss it.
		if (e.button !== 0) return;
		if (e.target instanceof Element && e.target.closest("button")) return;
		const el = rootRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const bounds = measureBounds({ width: rect.width, height: rect.height });
		if (!bounds) return;
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
			bounds,
		};
		e.currentTarget.setPointerCapture(e.pointerId);
	};

	const endDrag = (e: ReactPointerEvent<HTMLElement>): void => {
		const d = drag.current;
		if (!d || d.pointerId !== e.pointerId) return;
		drag.current = null;
		if (e.currentTarget.hasPointerCapture(e.pointerId))
			e.currentTarget.releasePointerCapture(e.pointerId);
	};

	const onPointerMove = (e: ReactPointerEvent<HTMLElement>): void => {
		const d = drag.current;
		if (!d || d.pointerId !== e.pointerId) return;
		// The button is no longer down, so the pointerup that should have ended this
		// gesture never reached us — the header being hidden mid-drag (⌘\, a collapse)
		// drops implicit capture and does exactly that. Without this the palette keeps
		// following the bare cursor, and the next click "teleports" it.
		if (e.buttons === 0) {
			endDrag(e);
			return;
		}
		// A client-space delta IS a layer-space delta: the layer cannot move during the
		// gesture (it is the canvas cell), so no coordinate conversion is needed.
		onMove(
			{
				x: d.originX + (e.clientX - d.fromX),
				y: d.originY + (e.clientY - d.fromY),
			},
			d.bounds,
		);
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
				// The browser can take the capture back without a pointerup — the element
				// being hidden or removed mid-gesture does it. Belt to the buttons===0
				// brace in onPointerMove: this one ends the drag at the moment capture is
				// lost, that one catches a gesture that somehow outlived even this.
				onLostPointerCapture={endDrag}
				className="flex shrink-0 cursor-grab touch-none select-none items-center gap-1 border-b border-border px-2 py-1.5 active:cursor-grabbing"
			>
				<h2
					id={headingId}
					className="min-w-0 flex-1 truncate font-semibold text-foreground text-xs"
				>
					{title}
				</h2>
				<Button
					ref={collapseRef}
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
