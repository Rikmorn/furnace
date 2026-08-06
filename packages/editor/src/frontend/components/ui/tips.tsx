// The chrome's tooltip vocabulary: the two WRAPPERS a control's documentation rides, and
// the one BODY they render into.
//
// The wrappers are a PAIR, and which one a control gets is decided by a single fact — can
// the user reach it? An available control gets `ActionTip`, a real Radix tooltip that opens
// on focus as well as hover and can carry the registry's keycap (D-25). A REFUSED one gets
// `ReasonTip`, because a `disabled` button takes neither pointer events nor focus and no
// tooltip has a channel to it; its reason rides a wrapper span for the mouse, the
// accessible NAME for everyone else, and — since W-1 — a TOAST when the refused control is
// actually pressed, which is the only one of the three that costs the user nothing to
// discover. Nothing should ever carry both wrappers, and nothing that
// carries either should also carry a `title` — see tests/frontend-no-doc-titles.test.ts.
//
// `components/ui/` rather than `components/field/`, where these were born: `field/` is the
// address of a panel that no longer exists (its own callers, BrushInspector and
// StampInspector, were both deleted), and after F4.5c Task 8 this trio is the chrome's
// most widely imported UI primitive — the rail, both bars, four palettes, the session
// card's two sections and both list rows. `SELECT_CLASS` stayed behind in
// `field/form-bits.tsx`: it is a native-<select> Tailwind string with two consumers and
// nothing to do with any of this.
//
// It finished the journey into the control library at foundations T3b1, because
// `ui/segmented.tsx` needs `ActionTip` for its `hint` prop and D-24's scope claim
// (`components/ui/` is the one place a raw control may be written) only means something
// while that directory is a LEAF. The trio was the single import reaching out of it into
// app chrome; being the chrome's most-imported UI primitive, the library is where it
// belonged anyway.
//
// BE PRECISE ABOUT WHAT THAT MOVE BOUGHT, because it is less than it looks. This file has
// FOUR outward edges — `../../hooks/useRovingList.tsx`, `../../lib/actions.ts`,
// `../../lib/notify-store.ts`, `../../lib/cn.ts` — where every OTHER file under `ui/` has
// exactly one (`cn.ts`). The move RELOCATED those edges into the library rather than
// removing them, so the transitive closure of `ui/` is unchanged; what it removed is the
// edge pointing at `components/`, which is the one a reader follows when asking "may I
// depend on the control library?". Do not read this file as evidence that `ui/` is
// dependency-free.
//
// The `byId` edge is the one to watch: it is a VALUE import out of the ~1,300-line action
// registry, the only value import into `ui/` that is not `cn`. It closes no cycle today —
// `notify-store.ts` imports nothing, `useRovingList.tsx` imports only `react`, and
// `actions.ts`'s edges back into `components/` and `hooks/` are all `import type` (erased)
// — but it is the edge that WOULD close one, so a future value import in `actions.ts`
// reaching anything under `ui/` is the thing that breaks this.
import type { FocusEvent, ReactElement, ReactNode } from "react";
import { isRovingTravel } from "../../hooks/useRovingList.tsx";
import { type ActionId, byId, capOf } from "../../lib/actions.ts";
import { cn } from "../../lib/cn.ts";
import { notify } from "../../lib/notify-store.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.tsx";

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
 *  arrives by Tab, or by settling anywhere that is not a traversal step. The tip stopped
 *  chasing the cursor; it did not become mouse-only again. (NOT "or by a click" — the
 *  click path never opened on focus in the first place. Radix's own `isPointerDownRef`
 *  suppresses it, which predates this veto and is unaffected by it; probed this session,
 *  pointerDown-then-focus leaves the tooltip closed.)
 *
 *  THE SECOND REASON, found by sabotaging the first: an open tooltip is not merely visual
 *  noise, it TAKES A KEY. Radix's content mounts a `DismissableLayer`, which registers a
 *  CAPTURE-phase `keydown` listener on `document` and calls `preventDefault()` on Escape
 *  (@radix-ui/react-dismissable-layer 1.1.19). So a tip left open by arrow travel makes
 *  the next Esc do two things at once — dismiss the tip AND run `session.escape`, because
 *  `useGlobalKeybindings` never consults `defaultPrevented` — which is exactly what the
 *  cancel ladder's one-thing-at-a-time contract exists to prevent. Pinned in
 *  tests/chrome/entities-palette.test.tsx, "the grid claims ONLY the keys it acts on".
 *
 *  That class is CLOSED ON THE ROW AXIS ONLY, and the veto cannot close it anywhere else:
 *  the layer's listener is capture-phase on `document`, so the grid's own
 *  `stopPropagation` never reaches it. On the CELL axis, where tips deliberately open, one
 *  Escape still both dismisses the tip and leaves the verb cluster. That reads as nesting
 *  (innermost thing first, then the next) rather than as two unrelated effects, which is
 *  why it is accepted here rather than fixed — but it is accepted, not absent. */
export function vetoTipDuringTravel(e: FocusEvent<HTMLElement>): void {
	if (isRovingTravel()) e.preventDefault();
}

/** Wrap a DISABLED control so its explanation is still reachable: shadcn's Button sets
 *  `disabled:pointer-events-none` (ui/button.tsx), so a `title` on the button itself
 *  never fires a tooltip and isn't reliably exposed to AT either. The span still takes
 *  pointer events, so the reason survives the disable.
 *
 *  IT ALSO TAKES THE CLICK, and that is the half a `title` alone could never do (W-1).
 *  A hover tooltip is opt-in: it costs a wait, and it costs knowing there is something
 *  there to wait for. The gesture a user makes on a button they want is a PRESS — and
 *  before this, pressing a refused control did nothing whatsoever, which is precisely
 *  the "every refusal visible + explained" rule failing on the one gesture that matters.
 *  The disabled button is out of hit-testing, so this span is what the press lands on;
 *  the wrapper that existed to carry the sentence is therefore also the only thing in a
 *  position to say it.
 *
 *  ROUTED THROUGH {@link notify.sayRefusal}, never `notify.info` here: the "no reason →
 *  stay silent" rule and the "do not stack the same sentence" rule are shared with the
 *  tool rail and the key dispatcher, and this is one of three call sites, not the owner.
 *
 *  THE ENABLED CASE MUST STAY SILENT, and it does structurally rather than by luck: an
 *  available control passes no `reason`, the click bubbles up through this span, and
 *  `sayRefusal(undefined)` is a no-op. The invariant every caller honours is that a
 *  `reason` is present only while the wrapped control is refused — worth keeping, since
 *  a caller that passed one to a LIVE control would make its every successful click
 *  announce an excuse. */
export function ReasonTip(props: {
	reason: string | undefined;
	/** Layout classes for the wrapper. It sits BETWEEN the caller's flex container and the
	 *  control, so without a way to spell `flex-1` here a wrapped button silently stops
	 *  participating in the row it was written into. */
	className?: string;
	children: ReactNode;
}) {
	return (
		// Both rules want the same thing — make the clickable element a real widget — and
		// both are answered by what this span WRAPS rather than by what it is. The child is
		// a `disabled` control: it takes no focus and no ⏎/Space, so there is no keyboard
		// gesture to pair the click with, and there is no second actor to give a role to.
		// The keyboard's channel is the accessible NAME on the control itself, which is the
		// documented half of this pair (see the header) and reaches every input method.
		//
		// Giving the span `role="button"` + `tabIndex={0}` to satisfy them literally would
		// be the harmful fix: it inserts a tab stop in front of every refused control in
		// the chrome and announces a button whose only behaviour is to explain why the
		// button behind it does nothing.
		// biome-ignore lint/a11y/noStaticElementInteractions: see above — the interactive element is the wrapped control; this span exists only because a `disabled` one drops out of hit-testing, and giving it a widget role would announce a second, fake button
		// biome-ignore lint/a11y/useKeyWithClickEvents: see above — a `disabled` child takes neither focus nor ⏎/Space, so no keyboard event can exist to pair with this click; the keyboard gets the reason from the control's accessible name instead
		<span
			title={props.reason}
			onClick={() => notify.sayRefusal(props.reason)}
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
						<kbd className="rounded-sm border border-border bg-muted px-1 font-mono text-2xs text-muted-foreground">
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
 *  span the mouse can still hit, and which answers a PRESS out loud) plus the reason in the
 *  accessible NAME, which is the one channel every input method gets.
 *
 *  Requires the shell's single `TooltipProvider` above it — a Radix `Tooltip` outside one
 *  does not degrade, it throws. */
export function ActionTip(props: {
	actionId?: ActionId;
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
						props.actionId === undefined
							? undefined
							: capOf(byId(props.actionId))
					}
					hint={props.hint}
				/>
			</TooltipContent>
		</Tooltip>
	);
}
