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
import type { LucideIcon } from "lucide-react";
import { Brush, MousePointer2, SquareDashed, Stamp } from "lucide-react";
import type { ReactNode } from "react";
import { memo, useMemo, useState } from "react";
import { useActionContext } from "../../hooks/useActionContext.tsx";
import { useRovingList } from "../../hooks/useRovingList.ts";
import type {
	ControlVerdict,
	ToolFamily,
	ToolFamilyMember,
} from "../../lib/actions.ts";
import { controlVerdict, TOOL_FAMILIES } from "../../lib/actions.ts";
import { cn } from "../../lib/cn.ts";
// The tooltip BODY, shared with `ActionTip` (D-25) rather than spelled twice: this file
// keeps its own trigger — a roving-tabindex button whose props cannot move to a wrapper,
// opening to the `side` a 44 px column needs — and takes only the keycap-and-hint layout.
import { KeyTip, vetoTipDuringTravel } from "../tips.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
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

/** 32 px inside the 44 px column — the mock's rail geometry. */
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
					keys: family.arm.keys,
					hint: family.arm.hint,
					cycleKeys: family.cycle?.keys,
					armed: family.armed(ctx),
					// The registry's own three-way (live / inert / refused, and the sentence).
					// It lives there rather than here because the command palette renders the
					// same verbs and must refuse them in the same words.
					verdict: controlVerdict(family.arm, ctx),
					members: family.members(ctx),
					run: () => family.arm.run(ctx),
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
 *  The MECHANISM moved to `hooks/useRovingList.ts` at F4.5c Task 9 — this file was its
 *  first home and is now one of five consumers. What stayed here is what is the rail's
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
							// enforced here rather than by the browser.
							if (!refused) row.run();
						}}
						className={cn(
							BUTTON_CLASS,
							row.members.length > 1 && "rounded-b-none",
							row.armed
								? "bg-primary text-primary-foreground hover:bg-primary/90"
								: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
							// Dim only when it is BOTH refused and idle. A refused family that is
							// ARMED is the live session's own family (mock frame 2), and dimming it
							// would make "the strongest element in the rail" a 40 %-opacity claim.
							refused && "cursor-not-allowed",
							refused && !row.armed && "opacity-40",
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
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`${row.group} tools`}
					aria-disabled={refused || undefined}
					onClick={(e) => {
						if (refused) e.preventDefault();
					}}
					className={cn(
						"grid h-6 w-8 place-items-center rounded-b-md border-border/60 border-t text-[9px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
						row.armed
							? "bg-primary/80 text-primary-foreground hover:bg-primary"
							: "text-muted-foreground hover:bg-accent hover:text-foreground",
						refused && "cursor-not-allowed",
						refused && !row.armed && "opacity-40",
					)}
				>
					{/* The mock's tick, relocated. Decorative — the button's own label names it. */}
					<span aria-hidden="true">▾</span>
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" side="right" className="w-60 p-1">
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
									"text-[10px]",
									member.armed
										? "text-primary-foreground/80"
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
					<p className="mt-1 border-border border-t px-2 pt-1 text-[10px] text-muted-foreground">
						{row.cycleKeys} cycles
					</p>
				)}
			</PopoverContent>
		</Popover>
	);
}
