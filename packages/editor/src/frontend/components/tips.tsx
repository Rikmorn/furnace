// The chrome's tooltip vocabulary: the two WRAPPERS a control's documentation rides, and
// the one BODY they render into.
//
// The wrappers are a PAIR, and which one a control gets is decided by a single fact — can
// the user reach it? An available control gets `ActionTip`, a real Radix tooltip that opens
// on focus as well as hover and can carry the registry's keycap (D-25). A REFUSED one gets
// `ReasonTip`, because a `disabled` button takes neither pointer events nor focus and no
// tooltip has a channel to it; its reason rides a wrapper span for the mouse and the
// accessible NAME for everyone else. Nothing should ever carry both, and nothing that
// carries either should also carry a `title` — see tests/frontend-no-doc-titles.test.ts.
//
// `components/` rather than `components/field/`, where these were born: `field/` is the
// address of a panel that no longer exists (its own callers, BrushInspector and
// StampInspector, were both deleted), and after F4.5c Task 8 this trio is the chrome's
// most widely imported UI primitive — the rail, both bars, four palettes, the session
// card's two sections and both list rows. `SELECT_CLASS` stayed behind in
// `field/form-bits.tsx`: it is a native-<select> Tailwind string with two consumers and
// nothing to do with any of this.
import type { FocusEvent, ReactElement, ReactNode } from "react";
import { isRovingTravel } from "../hooks/useRovingList.ts";
import { byId } from "../lib/actions.ts";
import { cn } from "../lib/cn.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.tsx";

/** Keep a tooltip shut while a roving traversal is moving focus PAST its trigger (D-26).
 *
 *  The problem, and why the delay does not cover it: `delayDuration` governs the HOVER
 *  path only. Radix's trigger calls `context.onOpen()` from `onFocus` with no timer at
 *  all — `onFocus: composeEventHandlers(props.onFocus, () => { if (!isPointerDownRef)
 *  context.onOpen() })` in @radix-ui/react-tooltip 1.2.16 — so once ↑/↓ move focus
 *  through a list, every arrow press pops a box instantly. That is exactly the reason
 *  BurgerMenu's row titles were left as titles when the rest of the chrome converted.
 *
 *  Radix's own `isPointerDownRef` suppression does not help: it only covers focus that
 *  ARRIVED from a pointerdown on the trigger, which a key traversal is not.
 *
 *  What Radix DOES provide is this veto. `composeEventHandlers` runs the consumer's
 *  handler first and skips its own when the event came back `defaultPrevented`, so one
 *  `onFocus` on the trigger is the whole mechanism — no controlled `open`, and none of
 *  Radix's close/hover/dismiss behaviour reimplemented.
 *
 *  IT IS PER-AXIS, and that is the ruling rather than an accident of where the flag is
 *  raised. Travelling the ROWS of a list is navigation: you are going somewhere, and every
 *  row's tip says the same sentence, so the box is pure noise. Stepping the VERBS of one
 *  row is inspection: each sentence is different and is the answer being looked for, so
 *  those still open — the row-axis mover raises the flag and the cell-axis mover does not.
 *
 *  D-25 is intact either way: the same control still documents itself the moment focus
 *  arrives by Tab, by a click, or by settling anywhere that is not a traversal step. The
 *  tip stopped chasing the cursor; it did not become mouse-only again.
 *
 *  THE SECOND REASON, found by sabotaging the first: an open tooltip is not merely visual
 *  noise, it TAKES A KEY. Radix's content mounts a `DismissableLayer`, which registers a
 *  CAPTURE-phase `keydown` listener on `document` and calls `preventDefault()` on Escape
 *  (@radix-ui/react-dismissable-layer 1.1.19). So a tip left open by arrow travel makes
 *  the next Esc do two things at once — dismiss the tip AND run `session.escape`, because
 *  `useGlobalKeybindings` never consults `defaultPrevented` — which is exactly what the
 *  cancel ladder's one-thing-at-a-time contract exists to prevent. Pinned in
 *  tests/chrome/entities-palette.test.tsx, "the grid claims ONLY the keys it acts on". */
export function vetoTipDuringTravel(e: FocusEvent<HTMLElement>): void {
	if (isRovingTravel()) e.preventDefault();
}

/** Wrap a DISABLED control so its explanation is still reachable: shadcn's Button sets
 *  `disabled:pointer-events-none` (ui/button.tsx), so a `title` on the button itself
 *  never fires a tooltip and isn't reliably exposed to AT either. The span still takes
 *  pointer events, so the reason survives the disable. */
export function ReasonTip(props: {
	reason: string | undefined;
	/** Layout classes for the wrapper. It sits BETWEEN the caller's flex container and the
	 *  control, so without a way to spell `flex-1` here a wrapped button silently stops
	 *  participating in the row it was written into. */
	className?: string;
	children: ReactNode;
}) {
	return (
		<span
			title={props.reason}
			className={cn(props.reason && "cursor-help", props.className)}
		>
			{props.children}
		</span>
	);
}

/** A tooltip BODY in the house vocabulary (D-25): what the control is called, the key that
 *  also does it, and the one sentence a label has no room for.
 *
 *  Here rather than beside either caller because there are two and they differ only in
 *  their TRIGGER — the tool rail owns its own (a roving-tabindex button whose props it
 *  cannot hand to a wrapper, opening to the `side` a 44 px column needs), {@link ActionTip}
 *  below wraps an arbitrary child. What they must not fork on is exactly this: one keycap
 *  style, one order, one vocabulary. Every field is optional because the two callers carry
 *  different amounts — the rail names the family it is arming, a row verb's name is already
 *  the control's visible text. */
export function KeyTip(props: {
	label?: string;
	keys?: string;
	hint?: string;
}) {
	return (
		<span className="flex flex-col gap-0.5">
			{(props.label !== undefined || props.keys !== undefined) && (
				<span className="flex items-center gap-1.5">
					{props.label !== undefined && (
						<span className="font-medium text-foreground">{props.label}</span>
					)}
					{props.keys !== undefined && (
						<kbd className="rounded-sm border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
							{props.keys}
						</kbd>
					)}
				</span>
			)}
			{props.hint !== undefined && (
				<span className="text-muted-foreground">{props.hint}</span>
			)}
		</span>
	);
}

/** The DOCUMENTATION on a control, as a real tooltip rather than a `title` (D-25).
 *
 *  Three things a native `title` cannot do, and only the first is the obvious one: it never
 *  appears for a keyboard user (Radix opens on FOCUS as well as hover, which is the whole
 *  point of this component), it cannot render a keycap, and its delay and placement belong
 *  to the OS rather than to us — so a documented control and an undocumented one look
 *  identical for the first second of a hover.
 *
 *  `actionId` rather than a `keys` string, deliberately (D-12): {@link byId} THROWS on an id
 *  the table does not have, so a tooltip wired to a renamed action fails loudly instead of
 *  rendering a blank keycap — and a rebound key moves every tooltip with it, which a
 *  hand-spelled "⌫" could not. Pass it only where the key really does THIS, to THIS object;
 *  a keycap on a control the key would not reach is a lie about the keyboard.
 *
 *  `asChild`: the trigger merges into the child element rather than wrapping it, so this
 *  adds NO DOM node and a control inside a flex row keeps its own box — the failure
 *  {@link ReasonTip} documents from the other side. The child must be a single host element
 *  or a ref-forwarding component: a Fragment or a component that drops its ref leaves the
 *  tooltip with no anchor, and neither the type nor Radix will say so. (The other ways to
 *  get it wrong — a text node, `null`, a `cond && <X/>`, two children — are caught, by
 *  `ReactElement` or by Slot's own throw.)
 *
 *  NOT for a DISABLED control: a disabled button takes neither pointer events nor focus, so
 *  neither channel a tooltip has can reach it. That case is {@link ReasonTip} (a wrapper
 *  span the mouse can still hit) plus the reason in the accessible NAME, which is the one
 *  channel every input method gets.
 *
 *  Requires the shell's single `TooltipProvider` above it — a Radix `Tooltip` outside one
 *  does not degrade, it throws. */
export function ActionTip(props: {
	actionId?: string;
	hint: string;
	children: ReactElement;
}) {
	return (
		<Tooltip>
			{/* The veto rides the TRIGGER, not the child: `composeEventHandlers` gates
			    Radix's own focus-open on this handler's `defaultPrevented`, and a child that
			    had to remember to call it would be N call sites deep. */}
			<TooltipTrigger asChild onFocus={vetoTipDuringTravel}>
				{props.children}
			</TooltipTrigger>
			<TooltipContent>
				<KeyTip
					keys={
						props.actionId === undefined ? undefined : byId(props.actionId).keys
					}
					hint={props.hint}
				/>
			</TooltipContent>
		</Tooltip>
	);
}
