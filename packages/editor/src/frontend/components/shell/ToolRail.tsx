// The tool rail (D-8): the four tool FAMILIES as a fixed 44 px column down the left of
// the canvas cell — pointer, brush, cell-select, stamp.
//
// It is a COLUMN, not a palette. It cannot be closed, moved, collapsed or resized, and
// its width is a constant, so the canvas cell's inset budget stays fixed the way the two
// bars keep it fixed (D-1/D-2). Everything a palette can do to the canvas — appear,
// disappear, take width — this must not do, which is why it lives in the shell's body row
// beside the cell rather than in the palette layer above it.
//
// ONE SOURCE FOR TWO CHANNELS. Every button renders from `TOOL_FAMILIES` and dispatches
// that family's registry action, so the rail and the family keys (`V`/`B`/`M`/`S`) are two
// views of one table and cannot come to mean different things. (The status bar's keymap
// line is NOT one of them — `armedKeymap` is hand-enumerated, deliberately, because half of
// what belongs on that line is canvas-owned keys the registry does not carry. Its own
// header says so.) In particular:
//   - a click arms the family's CURRENT member and never cycles. The rail is a mode
//     selector: pressing the mode you are already in is idempotent, and cycling has its
//     own affordance (⇧ + the letter, and the member flyout below).
//   - a multi-member family carries a MEMBER FLYOUT. That is what keeps deleting
//     `ToolPalette` from orphaning Fill / Paint / Smooth / Segment, Wand / Room, and every
//     generator past the first — the mouse had one button per member before, and the
//     flyout is where they went. It is therefore the most load-bearing affordance in this
//     file, which is why it is a 24 px target and not the mock's 14 px corner tick (the
//     mock's geometry cannot satisfy WCAG 2.5.8 inside a 44 px column without eating the
//     family button's own hit area).
//   - the pressed family carries the INVERTED fill (D-8's contrast fix). The critique's
//     finding was that the armed tool read fainter than its neighbours; it is now the
//     strongest element in the column, and it stays at full strength when it is also
//     REFUSED (mock frame 2 shows the stamp family pressed and undimmed during a session).
//
// KEYBOARD (D-26). A toolbar with a roving tabindex: ONE tab stop for the whole column,
// ↑/↓/Home/End between its controls. Seven separate tab stops for one mode selector is what
// the pattern exists to prevent, and `role="toolbar"` without it is a promise to a screen
// reader that nothing keeps.
//
// While a session is live every family is REFUSED, with the registry's own gate sentence.
// That is not a rule this file owns — it is `gateAction`'s `armsTool` clause, reached
// through `controlVerdict`, so the button, the key and the command palette's row refuse for
// the same reason in the same words. Refused controls carry `aria-disabled`, never
// `disabled`: a `disabled` button leaves the tab order entirely, and the refusal sentence
// rides the accessible NAME precisely so a keyboard user gets it.
//
// Keeping them focusable has a second consequence, and W-1 is where it was collected: a
// refused rail button really is PRESSED — by a click, and by ⏎/Space, which a native
// <button> delivers to the same `onClick`. So both refused branches in this file (the
// family button and the flyout tab) answer that press out loud through `notify.sayRefusal`,
// the chrome's one refusal voice, shared with `ReasonTip` and the key dispatcher. A
// refusal that swallows the gesture without a word is the defect; the wording is not this
// file's to choose.
import type { LucideIcon } from "lucide-react";
import { Brush, MousePointer2, SquareDashed, Stamp } from "lucide-react";
import type { ReactNode } from "react";
import { memo, useMemo, useState } from "react";
import { useActionContext } from "../../hooks/useActionContext.tsx";
import { useRovingList } from "../../hooks/useRovingList.tsx";
import { useViewportFocusReturn } from "../../hooks/useViewportFocusReturn.ts";
import type {
	ControlVerdict,
	ToolFamily,
	ToolFamilyMember,
} from "../../lib/actions.ts";
import {
	capOf,
	controlVerdict,
	runNamed,
	TOOL_FAMILIES,
} from "../../lib/actions.ts";
import { cn } from "../../lib/cn.ts";
// The refusal VOICE, shared with `ReasonTip` and the key dispatcher: this file renders
// refusals its own way (`aria-disabled`, so they stay focusable), but what a refused
// press SAYS is not this file's to decide.
import { notify } from "../../lib/notify-store.ts";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
// The tooltip BODY, shared with `ActionTip` (D-25) rather than spelled twice: this file
// keeps its own trigger — a roving-tabindex button whose props cannot move to a wrapper,
// opening to the `side` a 44 px column needs — and takes only the keycap-and-hint layout.
import { KeyTip, vetoTipDuringTravel } from "../ui/tips.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";

/** SVG glyphs, not text ones. The entities-palette rider applies here with force: a bare
 *  emoji renders from the colour-emoji font and IGNORES `color`, so the pressed family's
 *  inverted foreground would silently do nothing to a `✏`. Lucide icons inherit
 *  `currentColor`, which is what makes the contrast fix real rather than decorative. */
const FAMILY_ICON: Record<ToolFamily["id"], LucideIcon> = {
	pointer: MousePointer2,
	brush: Brush,
	select: SquareDashed,
	stamp: Stamp,
};

/** 32 px inside the 44 px column — the mock's rail geometry, and D-23's plain house focus ring
 *  with nothing added to it.
 *
 *  IT USED TO CARRY A `ring-offset-1 ring-offset-background` AND NO LONGER DOES. The reason it
 *  had one was never geometric: `--ring` was `var(--primary)` and the armed tool is
 *  `bg-primary`, so the ring painted the colour the button already is and focusing the armed
 *  tool added one ring-coloured pixel to a ring-coloured square. The F4.5c re-critique captured
 *  the pair at 3× and the two frames were indistinguishable, while the same capture of an
 *  INACTIVE rail button showed an unmistakable ring — on the tool a keyboard user is most
 *  likely to be on, the one they are using, against PRODUCT.md's floor of a visible focus state
 *  on every interactive control.
 *
 *  Three other controls had the identical defect (`ui/button.tsx`'s default variant, the
 *  selected segment, a checked checkbox), and the F4.5c holistic gate settled all four at once
 *  in the only place that could: the token, whose value and 3:1 floor are argued at `--ring` in
 *  `styles.css` rather than restated here. The offset was compensation for the alias, the alias
 *  is gone, and the ruling rejected the offset variant explicitly rather than leaving it as a
 *  spent exception nobody would re-argue.
 *
 *  The ring on THIS const is pinned by name as well as by ban: `MUST_DECLARE_HOUSE_RING` anchors
 *  the row on this string's own `h-8 w-8` geometry, because the file's other two ring-bearing
 *  class strings (the flyout tab, the flyout members) used to answer the check on its behalf.
 *
 *  So `ring-offset-*` is a flat ban again, `ui/button.tsx` states it, and
 *  `tests/frontend-focus-vocabulary.test.ts` enforces it with one allowlisted file left:
 *  `MaterialSwatches`, whose offset was never a focus ring at all. It fires on `activeId`, so it
 *  belongs to the SELECTED marker, and a swatch's fill is an arbitrary material colour that
 *  would swallow a marker drawn flush against it. An earlier version of this comment cited it as
 *  the precedent for the rail's offset and was wrong; the two were different problems that
 *  happened to take the same three classes, and only one of them had a token answer. */
const BUTTON_CLASS =
	"grid h-8 w-8 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** What one family row needs to render, derived ONCE in the `useMemo` below. The point of
 *  the shape is `memo`: the ctx object changes identity on every push the provider receives
 *  (stats per op, the session per pointermove during a grab), and four families × a Radix
 *  `Tooltip.Root` + `Popover.Root` each is a lot of tree to rebuild for an output that did
 *  not move. What makes that work is that the whole row is rebuilt only when the memo's
 *  listed ctx FACTS move — so a fresh nested object here (the verdict, the members) costs
 *  nothing that a fresh row object did not already cost. */
type RailModel = {
	id: ToolFamily["id"];
	/** The family's name for the flyout — stable, from the table. */
	group: string;
	/** What the button is called right now (contextual — see `ToolFamily.label`). */
	label: string;
	keys: string | undefined;
	hint: string | undefined;
	cycleKeys: string | undefined;
	armed: boolean;
	/** May this family be armed right now, and what to say when it may not. */
	verdict: ControlVerdict;
	members: readonly ToolFamilyMember[];
	run: () => void;
	armMember: (member: ToolFamilyMember) => void;
};

export function ToolRail() {
	// The ONE action-context read outside the surfaces that unmount when closed (the
	// burger's menu content, the shortcuts overlay, the selection chip's popover and the
	// ⌘K palette), and the only always-mounted one.
	// Everything the rail draws is derived ONCE here, keyed on the ctx fields that can
	// actually change it — so a stats push (per op) or a session push (per pointermove
	// during a grab) re-runs this component and then stops at four memoized rows.
	// `ActionContextProvider`'s header records the consumer list this joined.
	const ctx = useActionContext();
	// biome-ignore lint/correctness/useExhaustiveDependencies: `ctx` is deliberately NOT a dep — see the deps array below; the listed fields are the complete set the rendered rows and their closures read
	const model = useMemo<RailModel[]>(
		() =>
			TOOL_FAMILIES.map((family) => {
				return {
					id: family.id,
					group: family.name,
					label: family.label(ctx),
					// Both caps DERIVED from their bindings, never stated: `capOf` reads the
					// registry's `keycap()`, so a rail tooltip cannot print a chord the table
					// has moved.
					keys: capOf(family.arm),
					hint: family.arm.hint,
					cycleKeys: family.cycle === null ? undefined : capOf(family.cycle),
					armed: family.armed(ctx),
					// The registry's own three-way (live / inert / refused, and the sentence).
					// It lives there rather than here because the command palette renders the
					// same verbs and must refuse them in the same words.
					verdict: controlVerdict(family.arm, ctx),
					members: family.members(ctx),
					// Through the ONE funnel, so the button, the key and the ⌘K row all gate,
					// run and report identically. The `refused` early-return below still
					// speaks first: it reads the verdict this row already carries, and the
					// funnel is never reached on that path.
					run: () => void runNamed(family.arm, ctx),
					armMember: (member: ToolFamilyMember) => member.arm(ctx),
				};
			}),
		// EXACTLY the ctx FACTS the four rows read, never `ctx` itself and — for the session —
		// never the session OBJECT either. The provider hands out a fresh ctx on every push it
		// receives, and `subscribeStamp` pushes a fresh session clone on every nudge and every
		// preview: at pointer rate during a grab. Depending on `ctx.session` therefore misses
		// on every frame of a drag and rebuilds all four `row`s, which defeats
		// `RailFamily`'s own memo along with it. Measured, both ways, over 20 distinct-region
		// pushes through the real shell: `[ctx.session]` gives 20 rail / 80 family renders;
		// the two facts below give 20 / 4.
		//
		// The two facts are the whole of what the rail reads out of a session, and this list
		// is only correct while that stays true:
		//   - IS there one — `gateAction`'s `armsTool` refusal, `idle()`, and every static
		//     member's `armed`;
		//   - WHICH generator — the stamp family's `label` and its members' `armed`.
		// Nothing reads a region, a phase, an opCount or an entityId.
		//
		// The closures below (`run`, `armMember`) capture the ctx of the last render whose
		// listed facts moved, which is safe for the same reason: the four family actions read
		// `gesture`, `tool`, the two session facts, `generators`, `stampCursor`, `host` and
		// `run`, and nothing else (`armFamily`/`cycleFamily`/`stampMember` in `actions.ts`).
		// A fifth family reading `stats`, `world` or a session REGION would have to add it.
		[
			ctx.gesture,
			ctx.tool,
			ctx.session === null,
			ctx.session?.generator,
			ctx.pendingStamp,
			ctx.generators,
			ctx.stampCursor,
			ctx.host,
			ctx.run,
		],
	);
	return (
		<RovingToolbar>
			{model.map((row) => (
				<RailFamily key={row.id} row={row} />
			))}
		</RovingToolbar>
	);
}

/** The toolbar shell + its roving tabindex (D-26 / APG toolbar).
 *
 *  ONE tab stop for the whole column: ↑/↓ walk it (wrapping), Home/End jump. Seven separate
 *  tab stops for one mode selector is what the pattern exists to prevent, and
 *  `role="toolbar"` without it is a promise to a screen reader that nothing keeps.
 *
 *  The MECHANISM moved to `hooks/useRovingList.tsx` at F4.5c Task 9 — this file was its
 *  first home and is now one of four consumers. What stayed here is what is the rail's
 *  own: the KEYS it claims and the role it claims them under. In particular the stop is
 *  still written onto the DOM in a layout effect rather than passed down as a `tabIndex`
 *  prop, which is what keeps `RailFamily` memoizable — a prop would change on every focus
 *  move and defeat the memo for a reason that has nothing to do with what the row draws.
 *  React never sets `tabIndex` on these buttons (it is not in their JSX), so it cannot
 *  clobber the write.
 *
 *  `role="toolbar"`, not `<nav>`: a nav landmark advertises navigation, and this arms
 *  tools. It also matches the top strip, which is the other half of one control surface. */
function RovingToolbar({ children }: { children: ReactNode }) {
	// `"button"` as the selector because every button INSIDE this column is one of its
	// controls — a one-member family contributes one, a multi-member one two, and the
	// flyout's own members are portaled out of the container so they are never matched.
	// The row grids cannot use that selector (a row's verbs are buttons the stop must not
	// land on) and pass a structural one instead.
	const roving = useRovingList<HTMLDivElement, HTMLButtonElement>("button");

	return (
		// `role="toolbar"` is the ARIA pattern for a control strip; HTML has no element for
		// it, and <nav> would advertise navigation. Biome does not flag it, so there is no
		// suppression here (unlike the `role="group"` in the flyout below).
		<div
			ref={roving.ref}
			role="toolbar"
			aria-orientation="vertical"
			aria-label="tools"
			onKeyDown={(e) => {
				const at = roving.cursor();
				if (e.key === "ArrowDown") roving.focusAt(at + 1);
				else if (e.key === "ArrowUp") roving.focusAt(at - 1);
				else if (e.key === "Home") roving.focusAt(0);
				else if (e.key === "End") roving.focusAt(roving.items().length - 1);
				else return;
				// Only after a key we CLAIMED: the arrows are also the stamp-region nudge on the
				// canvas, and swallowing a key this toolbar did not act on would be the
				// focus-trap class the app-level dispatcher exists to kill.
				e.preventDefault();
			}}
			onFocus={roving.onFocus}
			className="flex w-11 shrink-0 flex-col items-center gap-1 border-border border-r bg-card py-2"
		>
			{children}
		</div>
	);
}

const RailFamily = memo(function RailFamily({ row }: { row: RailModel }) {
	const Icon = FAMILY_ICON[row.id];
	const refused = !row.verdict.runnable;
	// The reason rides the accessible NAME rather than only a tooltip, and that is
	// mechanical: a control the user cannot act on is exactly where a hover tooltip is least
	// reliable, and the name is the one channel every input method gets.
	const reason = row.verdict.runnable ? null : row.verdict.reason;
	const name = reason === null ? row.label : `${row.label} (${reason})`;

	return (
		<div className="flex flex-col items-center">
			<Tooltip>
				{/* The same veto every `ActionTip` carries, spelled here because this file keeps
				    its own trigger: seven controls in a roving column is seven tooltips popped
				    on the way down it. See `vetoTipDuringTravel`. */}
				<TooltipTrigger asChild onFocus={vetoTipDuringTravel}>
					<button
						type="button"
						aria-pressed={row.armed}
						aria-label={name}
						aria-disabled={refused || undefined}
						onClick={() => {
							// `aria-disabled` keeps the control focusable, so the refusal has to be
							// enforced here rather than by the browser — and, since the press
							// really does reach this handler, ANSWERED here too (W-1). A refused
							// control that swallows a click without a word is the defect; the
							// sentence is the same one the accessible name and the family's KEY
							// give, because all three read the one `controlVerdict`.
							//
							// This is also the KEYBOARD path: `aria-disabled` leaves the button in
							// the tab order, and ⏎/Space on a native <button> dispatch a click. One
							// handler therefore covers both, which is why there is no key handler
							// beside it.
							if (refused) return notify.sayRefusal(reason);
							row.run();
						}}
						className={cn(
							BUTTON_CLASS,
							row.members.length > 1 && "rounded-b-none",
							row.armed
								? // Hover LIGHTENS (D-23): `--primary-hover` is one step up the same
									// hue. The `bg-primary/90` this replaced went the other way — on a
									// dark shell an alpha fade pulls the surface underneath INTO the
									// fill, so the armed tool darkened under the cursor.
									"bg-primary text-primary-foreground hover:bg-primary-hover"
								: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
							// Dim only when it is BOTH refused and idle. A refused family that is
							// ARMED is the live session's own family (mock frame 2), and dimming it
							// would make "the strongest element in the rail" a half-opacity claim.
							// 50 % rather than the 40 % this used to carry: D-23 gives the chrome ONE
							// dimmed tier, and it is the one `ui/`'s disabled controls already use.
							refused && "cursor-not-allowed",
							refused && !row.armed && "opacity-50",
						)}
					>
						<Icon className="h-4 w-4" aria-hidden="true" />
					</button>
				</TooltipTrigger>
				<TooltipContent side="right">
					<KeyTip keys={row.keys} hint={row.hint} label={row.label} />
				</TooltipContent>
			</Tooltip>
			{row.members.length > 1 && <MemberFlyout row={row} />}
		</div>
	);
});

/** The member flyout: the family's members, one click each.
 *
 *  A separate button rather than a second gesture on the family button — a nested button is
 *  invalid markup, and a click-and-hold has no keyboard equivalent. 24 px tall and the
 *  button's full 32 px width, DIRECTLY BELOW it rather than overlapping its corner: WCAG
 *  2.2 SC 2.5.8 wants 24 × 24, and an overlapping corner tick both misses that and eats the
 *  family button's own hit area. The mock draws a 14 px corner tick; a 44 px column has no
 *  room for that AND a compliant target, and of the two this is the one every mouse route
 *  to Fill / Paint / Smooth / Segment, Wand / Room and the generators past the first goes
 *  through. */
function MemberFlyout({ row }: { row: RailModel }) {
	const [open, setOpen] = useState(false);
	const refused = !row.verdict.runnable;
	// The family button's sentence, off the same verdict — the two halves of one control
	// must not be able to word a refusal differently.
	const reason = row.verdict.runnable ? null : row.verdict.reason;
	// Picking Fill out of the brush family mid-flight must not cost the fly keys — this
	// flyout is the mouse's only route to every member past the first.
	const focusReturn = useViewportFocusReturn();
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`${row.group} tools`}
					aria-disabled={refused || undefined}
					onClick={(e) => {
						// `preventDefault` is what vetoes Radix's own toggle (`composeEventHandlers`
						// skips its handler on a defaultPrevented event) — and the refusal gets
						// SAID, for the family button's reason above: this is the mouse's only
						// route to every member past the first, so a user who reaches for it while
						// a session is live is exactly the person owed the sentence.
						if (!refused) return;
						e.preventDefault();
						notify.sayRefusal(reason);
					}}
					className={cn(
						"grid h-6 w-8 place-items-center rounded-b-md border-border/60 border-t text-2xs leading-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
						// The armed tab used to rest at `bg-primary/80` so it read as the
						// subordinate half of one control. That direction was compliant with
						// D-23's hover rule (80 % → 100 % lightens) and still had to go: on a
						// dark shell the 20 % of `--card` bleeding through darkened the fill, and
						// `--primary-foreground` is the DARK member of the pair, so the tab's own
						// label sat at 3.84:1 — under the floor, in the resting state, whenever
						// the family was armed. The subordinate reading is carried by geometry
						// instead (24 px under a 32 px button, its own top border), which costs
						// no contrast, and the hover is now the same token step as everywhere.
						row.armed
							? "bg-primary text-primary-foreground hover:bg-primary-hover"
							: "text-muted-foreground hover:bg-accent hover:text-foreground",
						refused && "cursor-not-allowed",
						refused && !row.armed && "opacity-50",
					)}
				>
					{/* The mock's tick, relocated. Decorative — the button's own label names it. */}
					<span aria-hidden="true">▾</span>
				</button>
			</PopoverTrigger>
			{/* Radix gives the content `role="dialog"` and no name to go with it — and unlike
			    its Dialog, it does not complain. The name is the TRIGGER's, verbatim, which is
			    the convention `StatusBar`'s chips set: a reader arrives in the dialog they just
			    opened and hears which one it is. The inner `role="group"` keeps the same string
			    on purpose — the group is what the arrow keys walk, and a dialog wrapping a
			    like-named group is the ordinary shape, not a duplicate. */}
			<PopoverContent
				aria-label={`${row.group} tools`}
				align="start"
				side="right"
				className="w-60 p-1"
				{...focusReturn.overlay}
			>
				{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this member list; a <fieldset>/<legend> would force a boxed look inside a popover that is already a box */}
				<div
					role="group"
					aria-label={`${row.group} tools`}
					className="flex flex-col"
				>
					{row.members.map((member) => (
						<button
							key={member.id}
							type="button"
							aria-pressed={member.armed}
							// The hint is IN the name, not only beside it: a two-line row whose
							// second line is `aria-hidden` would put the momentary modifier and the
							// 60 m cap out of reach of exactly the users who cannot discover them
							// by experiment.
							aria-label={`${member.label} — ${member.hint}`}
							onClick={() => {
								row.armMember(member);
								setOpen(false);
							}}
							className={cn(
								"flex flex-col gap-0.5 rounded-sm px-2 py-1 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
								member.armed
									? "bg-primary text-primary-foreground"
									: "text-foreground hover:bg-accent hover:text-accent-foreground",
							)}
						>
							<span>{member.label}</span>
							<span
								className={cn(
									"text-2xs",
									// FULL opacity. The `/80` composited to 4.3233:1 on `--primary` where
									// the token pair measures 5.4805 — the fade alone spent the whole
									// margin, on the hint line of the ARMED member, which is the row in
									// this popover a reader is most likely to be reading. Subordinate is
									// carried by size (`text-2xs`) and position, which cost no contrast.
									member.armed
										? "text-primary-foreground"
										: "text-muted-foreground",
								)}
							>
								{member.hint}
							</span>
						</button>
					))}
				</div>
				{/* Outside the group on purpose: it is a NOTE about the list, not a member of
				    it, and a text node inside the group would join every member's row. */}
				{row.cycleKeys !== undefined && (
					<p className="mt-1 border-border border-t px-2 pt-1 text-2xs text-muted-foreground">
						{row.cycleKeys} cycles
					</p>
				)}
			</PopoverContent>
		</Popover>
	);
}
