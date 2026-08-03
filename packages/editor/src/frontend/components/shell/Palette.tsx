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
import { ChevronUp, MoveDiagonal, MoveDiagonal2, X } from "lucide-react";
import type {
	CSSProperties,
	KeyboardEvent as ReactKeyboardEvent,
	ReactNode,
	PointerEvent as ReactPointerEvent,
	Ref,
} from "react";
import { useRef } from "react";
import { cn } from "../../lib/cn.ts";
import type {
	OriginBounds,
	PaletteBox,
	PaletteSize,
	SizeBounds,
} from "../../lib/palette-store.ts";
import type { PaletteState } from "../../lib/persist.ts";
import { Button } from "../ui/button.tsx";

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

/** The same four keys on the RESIZE handle, as BIGGER/SMALLER rather than as a direction.
 *
 *  Deliberately not the handle's own travel, which is the one thing the pointer and the
 *  keyboard do differently here: a right-docked palette's handle grows it LEFTWARD (see
 *  `growX`), and a keyboard user cannot see which corner they are on. Right and Down mean
 *  bigger on every palette, which is a rule that can be stated. Nothing diverges by it —
 *  both inputs reach exactly the same sizes, which is the invariant the move's own
 *  "one geometry" rule is about. */
const RESIZE_KEYS: Record<string, { dw: number; dh: number }> = {
	ArrowLeft: { dw: -1, dh: 0 },
	ArrowRight: { dw: 1, dh: 0 },
	ArrowUp: { dw: 0, dh: -1 },
	ArrowDown: { dw: 0, dh: 1 },
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

/** The same, for the resize handle: the size the palette was when the gesture opened, and
 *  the box it may grow into. Both taken ONCE, for the move drag's reason — and the START
 *  SIZE especially, because the palette really is changing size under the pointer, so
 *  reading it per event would compound its own rounding into a drift.
 *
 *  `movedX`/`movedY` are what makes this a per-axis gesture: an axis the pointer has not
 *  actually travelled on is not written at all, so a purely horizontal drag leaves a
 *  content-sized palette content-sized (see `resizePalette`). LATCHES rather than a
 *  per-event test, because a drag that goes down and comes back to its start row has moved
 *  vertically and must write that row — without the latch the last event would leave the
 *  palette at whatever the second-to-last one stored. */
type Resize = {
	pointerId: number;
	fromX: number;
	fromY: number;
	width: number;
	height: number;
	movedX: boolean;
	movedY: boolean;
	bounds: SizeBounds;
};

/** Absolute placement from stored geometry and the box the store resolved. A docked palette
 *  is placed FROM its edge, so a window resize keeps it welded there; a free one is placed
 *  from its x.
 *
 *  TWO ceilings on the height, and they answer different questions. `calc(100% - y)` is
 *  the CELL's: a tall palette scrolls inside the cell instead of running under the status
 *  bar. The declared extent is the ARRANGEMENT's (`PaletteBox.extent`, from
 *  `PALETTES[id].maxHeight`): it is what stops a growing list from reaching the palette
 *  below it, and it is absent both for a palette that has nothing below it AND for one the
 *  user has sized — the F4.5 ruling, where the extent is a default rather than a ceiling.
 *  Where both apply the smaller wins, which is what `min` says.
 *
 *  A USER HEIGHT IS A HEIGHT, not a third ceiling: a palette holding two rows has to GROW
 *  when the handle is dragged down, or the handle moves and nothing follows it. The cell's
 *  cap still outranks it (`max-height` beats `height` in CSS), which is deliberate — it is
 *  what keeps a projected palette inside the cell it was projected into, and `cellBounds`'s
 *  own docblock rests on that. There is NO width twin of that cap, for the reason stated
 *  there: a CSS width cap would make the rendered width differ from the width the
 *  projection subtracts, and those two agreeing is the x axis's whole invariant.
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
			box.extent === null
				? toCellBottom
				: `min(${box.extent}px, ${toCellBottom})`,
	};
	if (box.height !== null) style.height = box.height;
	if (geom.edge === "right") return { ...style, right: 0 };
	if (geom.edge === "left") return { ...style, left: 0 };
	return { ...style, left: geom.x };
}

export function Palette({
	title,
	geom,
	box,
	zIndex,
	measureBounds,
	onMove,
	onNudge,
	measureSizeBounds,
	onResize,
	onGrow,
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
	/** How big THIS palette may grow, from the layer that owns the measurement. Null when
	 *  the layer is not mounted, which refuses the gesture rather than guessing. */
	measureSizeBounds: () => SizeBounds | null;
	/** The size the gesture reached, per axis — an axis it has not moved is ABSENT, so a
	 *  width-only gesture cannot pin a height (see `resizePalette`). */
	onResize: (size: Partial<PaletteSize>, bounds: SizeBounds) => void;
	/** Step the palette's size by a keyboard delta, against the same bounds a drag uses.
	 *  `measured.height` is what the palette currently MEASURES, which the store needs only
	 *  while the user has never set a height of their own. */
	onGrow: (
		delta: { dw: number; dh: number },
		measured: { height: number; bounds: SizeBounds },
	) => void;
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
	const resize = useRef<Resize | null>(null);

	/** Which way the handle grows the palette on x. A RIGHT-DOCKED palette is placed from
	 *  that edge, so its box grows LEFTWARD and its handle rides the bottom-LEFT corner —
	 *  put it on the right and the corner is welded to the cell edge while the palette
	 *  changes width somewhere else, which is a handle that does not track the pointer that
	 *  is holding it. One sign, read by the corner's position and by the pointer delta, so
	 *  the two cannot come apart. */
	const growX = geom.edge === "right" ? -1 : 1;

	/** What the palette MEASURES right now — the one size fact the store cannot state, and
	 *  the only one either gesture has to go to the DOM for. `paletteBox` states the width
	 *  outright; a height the user has never set is CONTENT, so where they have not set one
	 *  this is the only true answer. */
	const measuredHeight = (): number | null => {
		const el = rootRef.current;
		return el === null ? null : el.getBoundingClientRect().height;
	};

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

	const onHandleDown = (e: ReactPointerEvent<HTMLElement>): void => {
		if (e.button !== 0) return;
		const bounds = measureSizeBounds();
		const content = measuredHeight();
		if (!bounds || content === null) return;
		resize.current = {
			pointerId: e.pointerId,
			fromX: e.clientX,
			fromY: e.clientY,
			width: box.width,
			height: box.height ?? content,
			movedX: false,
			movedY: false,
			bounds,
		};
		e.currentTarget.setPointerCapture(e.pointerId);
	};

	const endResize = (e: ReactPointerEvent<HTMLElement>): void => {
		const r = resize.current;
		if (!r || r.pointerId !== e.pointerId) return;
		resize.current = null;
		if (e.currentTarget.hasPointerCapture(e.pointerId))
			e.currentTarget.releasePointerCapture(e.pointerId);
	};

	const onHandleMove = (e: ReactPointerEvent<HTMLElement>): void => {
		const r = resize.current;
		if (!r || r.pointerId !== e.pointerId) return;
		// The header drag's brace, and it earns its place here for the same reason: the
		// button is no longer down, so the pointerup that should have ended this gesture
		// never reached us (⌘\ or a collapse hiding the palette mid-gesture does exactly
		// that), and without this the palette keeps resizing to follow a bare cursor.
		if (e.buttons === 0) {
			endResize(e);
			return;
		}
		// ONE AXIS PER AXIS MOVED. A drag that has only ever travelled horizontally writes
		// only a width, so a content-sized palette stays content-sized — the session card
		// widened by a corner handle still grows when its Advanced section expands.
		const dx = e.clientX - r.fromX;
		const dy = e.clientY - r.fromY;
		if (dx !== 0) r.movedX = true;
		if (dy !== 0) r.movedY = true;
		const size: Partial<PaletteSize> = {};
		if (r.movedX) size.width = r.width + dx * growX;
		if (r.movedY) size.height = r.height + dy;
		onResize(size, r.bounds);
	};

	/** The keyboard half of the resize — the grip's `onGripKeyDown`, on the other verb, and
	 *  modeless for the same reason (each press is one whole resize, so Esc is not ours).
	 *
	 *  It hands the store a DELTA rather than a target, which is `nudge`'s split and matters
	 *  here for a sharper reason: the size this component can see is a prop, and React
	 *  batches every press it can into one render — so a target computed here would be
	 *  computed from the same stale box for a whole burst, and a held arrow would move the
	 *  handle exactly once. */
	const onHandleKeyDown = (e: ReactKeyboardEvent<HTMLElement>): void => {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const dir = RESIZE_KEYS[e.key];
		if (dir === undefined) return;
		const bounds = measureSizeBounds();
		const content = measuredHeight();
		if (!bounds || content === null) return;
		const step = e.shiftKey ? NUDGE_FAR_PX : NUDGE_PX;
		onGrow(
			{ dw: dir.dw * step, dh: dir.dh * step },
			{ height: content, bounds },
		);
		e.preventDefault();
	};

	const HandleGlyph = growX === -1 ? MoveDiagonal2 : MoveDiagonal;

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
					<ChevronUp />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-label={`close ${title}`}
					className="h-5 w-5 p-0"
					onClick={onClose}
				>
					<X />
				</Button>
			</header>
			{/* `pb-5` is a GUTTER FOR THE HANDLE, not spacing. The handle below is `absolute`
			    over this box and painted after it, so without the reserve it is a 16 px dead
			    zone on the body's bottom-right corner — which on the Flags palette is exactly
			    where a list scrolled to its end puts the last row's `verify` button, and on
			    any scrolling list is where the last row's verbs are. 20 px is the handle's 16
			    plus its 1 px inset, on the chrome's own 4 px step. It costs a content-sized
			    palette 20 px of height and a capped one half a row; the handle covering a
			    button costs the button. */}
			<div className="min-h-0 flex-1 overflow-y-auto pb-5">{children}</div>
			{/* THE RESIZE HANDLE (the F4.5 gate ruling). ONE corner handle rather than an edge
			    per axis: it is the width handle and the height handle at once, which is the
			    least chrome — and the least tab stop — that satisfies "width + height handles",
			    and it is the affordance every windowed app already taught.

			    A real `button`, for the grip's reasons rather than by analogy with it. A bare
			    `div` with a pointer handler is invisible to a keyboard and to a screen reader,
			    and the whole point of the ruling is that the 320 px extent stops being a
			    ceiling — for everyone, not for people holding a mouse. The name leads with the
			    VERB because a corner glyph says nothing about what it does.

			    It is OUTSIDE the header, so the header's own drag never sees it (that handler
			    refuses every button but the grip anyway) — and it is inside the section, so a
			    pointerdown on it still bubbles to the raise. The `absolute` is against the
			    section's own box, which is what keeps the handle on the corner while the body
			    scrolls under it. */}
			<button
				type="button"
				aria-label={`resize ${title} palette`}
				aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight"
				onPointerDown={onHandleDown}
				onPointerMove={onHandleMove}
				onPointerUp={endResize}
				onPointerCancel={endResize}
				onLostPointerCapture={endResize}
				onKeyDown={onHandleKeyDown}
				className={cn(
					// `text-muted-foreground` at FULL opacity, which is the house rule rather than
					// a preference: an alpha on a `-foreground` token makes the measured contrast
					// pair describe a colour that is not on screen (`design-tokens.test.ts`). The
					// glyph is subordinate by size and by corner already.
					// INSET BY A PIXEL on both axes, which is the focus ring's own width. The
					// section is `overflow-hidden` (a canvas-size barrier that must not be
					// weakened) and `ring-1` draws OUTWARD from the border box, so a handle
					// flush with the corner has two sides of its focus indicator clipped away.
					// Geometry rather than `ring-inset`, because the ring vocabulary is a
					// deliberately closed whitelist (`frontend-focus-vocabulary.test.ts`) and a
					// pixel of inset costs nothing to widen it for.
					"absolute bottom-px grid h-4 w-4 touch-none place-items-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
					growX === -1
						? "left-px cursor-nesw-resize"
						: "right-px cursor-nwse-resize",
				)}
			>
				<HandleGlyph className="h-3 w-3" />
			</button>
		</section>
	);
}
