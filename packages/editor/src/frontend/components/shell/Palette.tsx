// One floating palette: a grab-handle header over a scrolling body, placed absolutely
// inside the palette layer from its stored geometry.
//
// Radix-free by choice — a palette is OUR chrome, not a form control: it needs pointer
// capture and an absolute box, none of the behaviour (focus management, dismiss layers,
// portalling) a Radix primitive would bring, and all of that behaviour would have to be
// fought off. Plain elements plus the shared Button.
//
// Collapsed palettes stay MOUNTED behind the `hidden` attribute rather than unmounting:
// their content holds local state a remount would reset (the control stack's armed
// gesture is the plain case), and rolling a palette up must not be a state-losing act.
// CLOSING one still unmounts it, which is why anything that must outlive the gesture —
// the advisor's filter bands, the brush radius — is the shell provider's rather than a
// palette's. `hidden` also takes it out of the accessibility tree, so the rail chip is the
// only thing a screen reader finds — which is what the collapsed state actually is.
import { ChevronUp, X } from "lucide-react";
import type {
	CSSProperties,
	KeyboardEvent as ReactKeyboardEvent,
	ReactNode,
	PointerEvent as ReactPointerEvent,
	Ref,
} from "react";
import { useRef } from "react";
import { cn } from "../../lib/cn.ts";
import type { OriginBounds } from "../../lib/palette-store.ts";
import type { PaletteState } from "../../lib/persist.ts";
import { Button } from "../ui/button.tsx";

/** A palette's measured box, handed to the layer with a move so it can turn the cell's
 *  size into bounds for THIS palette's origin. */
export type PaletteSize = { width: number; height: number };

/** How far one arrow press moves a palette, and how far a ⇧-arrow does. 8 px is the
 *  chrome's spacing step, so a nudged palette stays on the same rhythm as everything
 *  around it; 32 px is four of those — far enough to cross a palette in a dozen presses,
 *  small enough that it never overshoots the cell in one go. */
export const NUDGE_PX = 8;
export const NUDGE_FAR_PX = 32;

/** The four keys the grip claims, as unit vectors. A lookup rather than a chain, so the
 *  "did we claim this key?" question below has exactly one answer. */
const NUDGE_KEYS: Record<string, { dx: number; dy: number }> = {
	ArrowLeft: { dx: -1, dy: 0 },
	ArrowRight: { dx: 1, dy: 0 },
	ArrowUp: { dx: 0, dy: -1 },
	ArrowDown: { dx: 0, dy: 1 },
};

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
 *  a window resize keeps it welded there; a free one is placed from its x.
 *
 *  TWO ceilings on the height, and they answer different questions. `calc(100% - y)` is
 *  the cell's: a tall palette scrolls inside the cell instead of running under the status
 *  bar. The declared extent is the ARRANGEMENT's (see `PALETTES[id].maxHeight`): it is what
 *  stops a growing list from reaching the palette below it, and it is absent for the
 *  palettes that have nothing below them. The smaller wins, which is what `min` says.
 *
 *  GEOMETRY ONLY. The click-to-front z-index is merged in at the call site rather than
 *  threaded through here: it is not part of the stored record and never will be (see
 *  usePaletteStack), so a function whose whole job is "stored geometry → CSS box" has no
 *  business taking it. */
function placement(geom: PaletteState, box: PaletteBox): CSSProperties {
	const toCellBottom = `calc(100% - ${geom.y}px)`;
	const style: CSSProperties = {
		top: geom.y,
		width: box.width,
		maxHeight:
			box.maxHeight === undefined
				? toCellBottom
				: `min(${box.maxHeight}px, ${toCellBottom})`,
	};
	if (geom.edge === "right") return { ...style, right: 0 };
	if (geom.edge === "left") return { ...style, left: 0 };
	return { ...style, left: geom.x };
}

/** How big this palette is allowed to be, straight off `PALETTES[id]` — the store owns
 *  both numbers because both are arithmetic it has to do (the projection's bounds, the
 *  default-arrangement proof). */
export type PaletteBox = { width: number; maxHeight?: number };

export function Palette({
	title,
	geom,
	box,
	zIndex,
	measureBounds,
	onMove,
	onNudge,
	onRaise,
	onCollapse,
	onClose,
	collapseRef,
	children,
}: {
	title: string;
	geom: PaletteState;
	box: PaletteBox;
	/** Where this palette sits in the layer's click-to-front stack. */
	zIndex: number;
	/** Bounds for THIS palette's origin, from the layer that owns the measurement.
	 *  Null when the layer is not mounted, which refuses the drag rather than guessing. */
	measureBounds: (size: PaletteSize) => OriginBounds | null;
	onMove: (pos: { x: number; y: number }, bounds: OriginBounds) => void;
	/** Step the palette by a keyboard delta, against the same bounds a drag would use. */
	onNudge: (delta: { dx: number; dy: number }, bounds: OriginBounds) => void;
	/** Bring this palette to the front — ANY pointer down on it, header or body, so
	 *  reaching for a control on a buried palette also uncovers it. */
	onRaise: () => void;
	onCollapse: () => void;
	onClose: () => void;
	/** The collapse button, published so the layer can put focus back on it when the
	 *  rail chip that replaced this palette is used to bring it back. */
	collapseRef?: Ref<HTMLButtonElement>;
	children: ReactNode;
}) {
	const rootRef = useRef<HTMLElement | null>(null);
	const gripRef = useRef<HTMLButtonElement | null>(null);
	const drag = useRef<Drag | null>(null);

	/** Bounds for THIS palette's origin, measured NOW. The pointer gesture takes it once at
	 *  pointerdown and caches it; the keyboard takes it per press, which is the same cost
	 *  spread over far fewer events. Both go through here, so "the keyboard's clamp is the
	 *  drag's clamp" is true of the bounds as well as of the store verb. */
	const boundsNow = (): OriginBounds | null => {
		const el = rootRef.current;
		if (!el) return null;
		const rect = el.getBoundingClientRect();
		return measureBounds({ width: rect.width, height: rect.height });
	};

	const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
		// Left button only, and never from the header's own buttons — collapse and close
		// are clicks, and a click that also starts a drag makes both feel broken. The GRIP
		// is the exception, and it has to be: it is a button (so a keyboard can reach it),
		// and it is also the widest draggable part of the header.
		// `Element`, not `HTMLElement`: the buttons' icons are SVG, so the pointer's
		// target inside one is an SVGElement and an HTMLElement check would miss it.
		if (e.button !== 0) return;
		const onButton =
			e.target instanceof Element ? e.target.closest("button") : null;
		if (onButton !== null && onButton !== gripRef.current) return;
		const bounds = boundsNow();
		if (!bounds) return;
		const el = rootRef.current;
		if (!el) return;
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

	/** The keyboard half of the move (D-26). MODELESS on purpose, and that decides the two
	 *  keys it does NOT take.
	 *
	 *  Each press is one whole move — there is no "moving" state to enter or leave — so
	 *  ESCAPE IS NOT OURS. It stays `session.escape`, the editor's one cancel entry point,
	 *  which unwinds gesture → session → selection; a grip that swallowed it would put a
	 *  dead spot in that ladder wherever a palette header happened to hold focus. Blur is
	 *  nothing to handle for the same reason.
	 *
	 *  The arrows ARE prevented, but only the four that were claimed (the rule the roving
	 *  lists state at length): nothing at the window listens for arrows, and the canvas
	 *  listens on itself, so the only default worth stopping is the page scroll. */
	const onGripKeyDown = (e: ReactKeyboardEvent<HTMLElement>): void => {
		// \u21e7 is OURS (it is the long step); every other modifier is somebody else's —
		// \u2318\u2190 is a browser Back, \u2325\u2192 a word jump — so a modified arrow is neither acted
		// on nor prevented. `lib/actions.ts`'s `bare`/`shifted` pair is the same rule for the
		// window's own bindings.
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const dir = NUDGE_KEYS[e.key];
		if (dir === undefined) return;
		const bounds = boundsNow();
		if (!bounds) return;
		const step = e.shiftKey ? NUDGE_FAR_PX : NUDGE_PX;
		onNudge({ dx: dir.dx * step, dy: dir.dy * step }, bounds);
		e.preventDefault();
	};

	return (
		<section
			ref={rootRef}
			aria-label={title}
			hidden={geom.collapsed}
			// The raise rides the BUBBLE phase of every pointerdown inside the palette, so
			// one listener on the root serves the header drag, a row click and a form field
			// alike. It changes only a z-index — no DOM re-parenting — which is what keeps
			// it safe to fire in the same event that opens a drag: moving a node in the
			// document can drop its pointer capture, and the header's own gesture starts on
			// this very event.
			onPointerDown={onRaise}
			// Session-local depth over stored geometry. It resolves inside the layer's own
			// stacking context (`isolate`), so no palette can paint over the toasts.
			style={{ ...placement(geom, box), zIndex }}
			className={cn(
				// pointer-events-auto against the layer's -none: the layer covers the whole
				// canvas, so only the palettes themselves may take pointer input.
				"pointer-events-auto absolute flex flex-col overflow-hidden border border-border bg-card shadow-lg",
				// A docked palette loses the border it shares with the cell edge (and its
				// rounding on that side), so it reads as part of the frame rather than a
				// card that happens to be touching it.
				geom.edge === null && "rounded-md",
				geom.edge === "right" && "rounded-l-md border-r-0",
				geom.edge === "left" && "rounded-r-md border-l-0",
			)}
		>
			{/* The whole header drags, and one element inside it is the KEYBOARD grip. */}
			<header
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				// The browser can take the capture back without a pointerup: the spec
				// GUARANTEES implicit release when the capturing element leaves the
				// document. Whether hiding a still-connected element (⌘\, a collapse — both
				// of which do exactly that to this header) also releases is plausible but
				// UNVERIFIED here. Belt to the buttons===0 brace in onPointerMove: this ends
				// the drag the moment capture is lost, that one catches a gesture which
				// outlived even this — which is why both ship rather than either alone.
				onLostPointerCapture={endDrag}
				className="flex shrink-0 cursor-grab touch-none select-none items-center gap-1 border-b border-border px-2 py-1.5 active:cursor-grabbing"
			>
				{/* THE GRIP: the palette's title, and the one thing in the header a keyboard
				    can move the palette with (D-26). A real `button` INSIDE the heading rather
				    than the header itself carrying `role="button"`, and both halves of that are
				    constraints rather than preferences. The role cannot go on the header,
				    because a `button` makes its children PRESENTATIONAL and would take the
				    collapse and close verbs out of the accessibility tree entirely. The heading
				    cannot go away either, because the region landmark and the heading are two
				    different ways to navigate and only one of them is a list of palettes to a
				    reader pressing `H`. Nesting keeps both; what it costs is that the heading
				    announces the button's name ("move Flags palette") rather than the bare
				    title, which still identifies the palette and says what the header does.
				    The accessible name leads with the VERB and CONTAINS the visible text, which
				    is what WCAG 2.5.3 requires; visible-text-first is that SC's Understanding
				    document advising, not the success criterion. */}
				<h2 className="min-w-0 flex-1">
					<button
						ref={gripRef}
						type="button"
						aria-label={`move ${title} palette`}
						aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight"
						onKeyDown={onGripKeyDown}
						className="block w-full cursor-grab truncate text-left font-semibold text-foreground text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:cursor-grabbing"
					>
						{title}
					</button>
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
