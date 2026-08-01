// Leaf form helpers, shared across whatever still renders a dense knob row: the session
// card (shell/SessionCard.tsx), the top strip's overflow and the world drawer — the select
// styling and the two TOOLTIP wrappers. Nothing here holds state.
//
// The two wrappers are a PAIR, and which one a control gets is decided by one fact — can
// the user reach it? An available control gets `ActionTip`, a real Radix tooltip that opens
// on focus as well as hover and can carry the registry's keycap (D-25). A REFUSED one gets
// `ReasonTip`, because a `disabled` button takes neither pointer events nor focus and no
// tooltip has a channel to it; its reason rides a wrapper span for the mouse and the
// accessible NAME for everyone else. Nothing should ever carry both, and nothing that
// carries either should also carry a `title` — see tests/frontend-no-doc-titles.test.ts.
//
// The `field/` address is now historical rather than descriptive: the panel's own pieces
// that used to be the callers (BrushInspector, StampInspector) were both deleted, and the
// surviving consumers are shell surfaces. Left where it is for Task 14's dissolution pass
// to move with everything else, rather than churning imports twice.
//
// These panels use the NATIVE <select>, not the package's ui/select.tsx (Radix) — a
// deliberate deviation from the primitive four other files use. The selects here are
// dense, list-driven knob rows where the platform's own keyboard and mobile-wheel
// behaviour is exactly what we want, and a native control stays drivable from the chrome
// harness with fireEvent.change. Radix's portaled listbox buys nothing at this size and
// costs the harness a mock.
import type { ReactElement, ReactNode } from "react";
import { byId } from "../../lib/actions.ts";
import { cn } from "../../lib/cn.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";

export const SELECT_CLASS =
	"h-8 rounded-md border border-input bg-transparent px-2";

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
 *  {@link ReasonTip} documents from the other side.
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
			<TooltipTrigger asChild>{props.children}</TooltipTrigger>
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
