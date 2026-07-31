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
//     own affordance (⇧ + the letter, and the corner flyout below).
//   - a multi-member family carries a CORNER FLYOUT listing its members. That is what
//     keeps deleting `ToolPalette` from orphaning Fill / Paint / Smooth / Segment,
//     Wand / Room, and every generator past the first — the mouse had one button per
//     member before, and the corner is where they went.
//   - the pressed family carries the INVERTED fill (D-8's contrast fix). The critique's
//     finding was that the armed tool read fainter than its neighbours; it is now the
//     strongest element in the column.
//
// While a session is live every family is REFUSED, with the registry's own gate sentence.
// That is not a rule this file owns — it is `gateAction`'s `armsTool` clause, reached
// through `clickGate`, so the button and the key refuse for the same reason in the same
// words.

import type { LucideIcon } from "lucide-react";
import { Brush, MousePointer2, SquareDashed, Stamp } from "lucide-react";
import { useState } from "react";
import { useActionContext } from "../../hooks/useActionContext.tsx";
import type { ActionCtx, ToolFamily } from "../../lib/actions.ts";
import { clickGate, TOOL_FAMILIES } from "../../lib/actions.ts";
import { cn } from "../../lib/cn.ts";
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
	"relative grid h-8 w-8 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

export function ToolRail() {
	// The ONE action-context read outside the two surfaces that unmount when closed (the
	// burger's menu content and the shortcuts overlay). It costs a re-render of four
	// buttons whenever any ctx field moves — a stats push (guarded by `statsEqual`, so
	// per-op rather than per-frame) and a session push (pointer-rate during a move, where
	// all four buttons are disabled and re-render to the same output). Taken deliberately:
	// the alternative is a second, narrower context published beside this one, which is new
	// surface for a four-button column. `ActionContextProvider`'s header records the
	// consumer list this joined.
	const ctx = useActionContext();
	return (
		<nav
			aria-label="tools"
			className="flex w-11 shrink-0 flex-col items-center gap-1 border-border border-r bg-card py-2"
		>
			{TOOL_FAMILIES.map((family) => (
				<RailFamily key={family.id} ctx={ctx} family={family} />
			))}
		</nav>
	);
}

function RailFamily({ ctx, family }: { ctx: ActionCtx; family: ToolFamily }) {
	const Icon = FAMILY_ICON[family.id];
	const members = family.members(ctx);
	const armed = family.armed(ctx);
	const verdict = clickGate(family.arm, ctx);
	const refusal = verdict.ok ? null : verdict.hint;
	const disabled = !family.arm.enabled(ctx) || !verdict.ok;
	const label = family.arm.label(ctx);
	// The reason rides the accessible NAME rather than a tooltip, and that is mechanical:
	// a disabled button takes no pointer events, so a tooltip on one never opens and a
	// keyboard user gets nothing at all (the `ReasonTip` convention, stated at its source).
	const name = refusal === null ? label : `${label} (${refusal})`;

	return (
		<div className="relative">
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-pressed={armed}
						aria-label={name}
						disabled={disabled}
						onClick={() => family.arm.run(ctx)}
						className={cn(
							BUTTON_CLASS,
							armed
								? "bg-primary text-primary-foreground"
								: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
						)}
					>
						<Icon className="h-4 w-4" aria-hidden="true" />
					</button>
				</TooltipTrigger>
				<TooltipContent side="right">
					<KeyTip def={family.arm} label={label} />
				</TooltipContent>
			</Tooltip>
			{members.length > 1 && (
				<MemberFlyout
					ctx={ctx}
					family={family}
					members={members}
					disabled={disabled}
				/>
			)}
		</div>
	);
}

/** The corner tick, made real: the family's members, one click each.
 *
 *  A separate button rather than a second gesture on the family button — a nested button
 *  is invalid markup, and a click-and-hold has no keyboard equivalent. It is small (14 px)
 *  because it is secondary: the family button, the letter key and the ⇧ cycle all reach
 *  the same members, and this is the one route that reaches a SPECIFIC member with a
 *  mouse. */
function MemberFlyout({
	ctx,
	family,
	members,
	disabled,
}: {
	ctx: ActionCtx;
	family: ToolFamily;
	members: readonly {
		id: string;
		label: string;
		armed: boolean;
		arm: (c: ActionCtx) => void;
	}[];
	disabled: boolean;
}) {
	const [open, setOpen] = useState(false);
	const cycle = family.cycle;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`${family.name} tools`}
					disabled={disabled}
					className="absolute right-0 bottom-0 grid h-3.5 w-3.5 place-items-center rounded-tl-sm text-[8px] text-muted-foreground leading-none hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
				>
					{/* The mock's corner tick. Decorative — the button's own label is what
					    names it — but it is the AFFORDANCE, so it must not be hidden behind
					    a hover the way a bare CSS `::after` would be. */}
					<span aria-hidden="true">◢</span>
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" side="right" className="w-44 p-1">
				{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this member list; a <fieldset>/<legend> would force a boxed look inside a popover that is already a box */}
				<div
					role="group"
					aria-label={`${family.name} tools`}
					className="flex flex-col"
				>
					{members.map((member) => (
						<button
							key={member.id}
							type="button"
							aria-pressed={member.armed}
							onClick={() => {
								member.arm(ctx);
								setOpen(false);
							}}
							className={cn(
								"rounded-sm px-2 py-1 text-left text-xs transition-colors",
								member.armed
									? "bg-primary text-primary-foreground"
									: "text-foreground hover:bg-accent hover:text-accent-foreground",
							)}
						>
							{member.label}
						</button>
					))}
				</div>
				{/* Outside the group on purpose: it is a NOTE about the list, not a member of
				    it, and a text node inside the group would join every member's row. */}
				{cycle?.keys !== undefined && (
					<p className="mt-1 border-border border-t px-2 pt-1 text-[10px] text-muted-foreground">
						{cycle.keys} cycles
					</p>
				)}
			</PopoverContent>
		</Popover>
	);
}

/** A tooltip body in the house vocabulary (D-25): what the control is called, the key that
 *  also does it, and the one sentence a label has no room for. All three come off the
 *  registry entry, so a reworded action moves every tooltip with it. */
function KeyTip({
	def,
	label,
}: {
	def: { keys?: string; hint?: string };
	label: string;
}) {
	return (
		<span className="flex flex-col gap-0.5">
			<span className="flex items-center gap-1.5">
				<span className="font-medium text-foreground">{label}</span>
				{def.keys !== undefined && (
					<kbd className="rounded-sm border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
						{def.keys}
					</kbd>
				)}
			</span>
			{def.hint !== undefined && (
				<span className="text-muted-foreground">{def.hint}</span>
			)}
		</span>
	);
}
