// The strip's ⋯ (D-6): the armed effect's WHOLE option list, in a tool-scoped popover.
//
// It renders the SAME components the strip does, from the same `TOOL_OPTIONS` list — the
// strip takes a prefix, this takes all of it. That is what makes "the ⋯ holds everything
// the strip shows plus the rest" a structural property rather than a promise: there is no
// second list here to fall out of step, and a control cannot be on the strip and missing
// from the popover.
//
// It is also what makes the capacity rule safe. Below the strip's min content width the
// params hide as a unit and the strip degrades to `name + ⋯` — which is only acceptable
// because this button is a complete route back to every one of them.
import { Ellipsis } from "lucide-react";
import { useViewportFocusReturn } from "../../hooks/useViewportFocusReturn.ts";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";
import type { BrushEffect, ParamContext, ParamId } from "./tool-params.tsx";
import { Param } from "./tool-params.tsx";

export function StripOverflow({
	effect,
	params,
	ctx,
}: {
	effect: BrushEffect;
	/** The effect's whole available list — what the strip sliced its prefix from. */
	params: readonly ParamId[];
	ctx: ParamContext;
}) {
	const label = `all ${effect} options`;
	// Setting a radius or a falloff here is the same interruption as setting one on the
	// strip: the user is mid-stroke, and the keys they come back to are the canvas's.
	const focusReturn = useViewportFocusReturn();
	return (
		<Popover>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<button
							type="button"
							aria-label={label}
							className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						>
							<Ellipsis className="h-4 w-4" aria-hidden="true" />
						</button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{/* Not "the rest": for dig, fill and paint the strip already carries the whole
					    list, so this popover is an exact duplicate of it and only `smooth` is a
					    real drawer. What is true of ALL of them is that this is where the options
					    stay reachable when the strip is too narrow to show them. */}
					Every {effect} option — also here when the strip is narrow
				</TooltipContent>
			</Tooltip>
			<PopoverContent align="end" className="w-72 p-3" {...focusReturn}>
				{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this option list; a <fieldset>/<legend> would force a second box inside a popover that is already one */}
				<div
					role="group"
					aria-label={label}
					className="flex flex-col gap-2.5 text-muted-foreground text-xs"
				>
					{params.map((id) => (
						<Param key={id} id={id} ctx={ctx} />
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
