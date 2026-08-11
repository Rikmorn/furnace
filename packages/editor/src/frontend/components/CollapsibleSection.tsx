import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./ui/collapsible.tsx";
import { ActionTip } from "./ui/tips.tsx";

/**
 * A titled, collapsible inspector section (the IA unit for a component / resource /
 * settings block). Presentational: the caller owns the open-state default and the
 * onOpenChange side effect (persistence), so this stays a dumb wrapper — and
 * `onOpenChange` is OPTIONAL for the same reason: a section whose open state drives
 * nothing should not have to invent a callback to say so. The chevron rotates with
 * the trigger's data-state.
 */
export function CollapsibleSection({
	title,
	titleHint,
	defaultOpen,
	onOpenChange,
	children,
}: {
	title: ReactNode;
	/** A property of the section's CONTENTS that the title has no room for — the entity
	 *  list's row order is the first (T5). Optional, and absent means no tooltip at all:
	 *  most sections have nothing to say beyond their name, and a box that opens over
	 *  every header is a box people stop reading.
	 *
	 *  A real tooltip on the TRIGGER rather than a `title` attribute, which is D-25 and is
	 *  machine-enforced — `tests/frontend-no-doc-titles.test.ts` fails the build over an
	 *  authored `title` carrying documentation. The trigger is the focusable element, so
	 *  wrapping IT (rather than a span inside it) is what gets the sentence to a keyboard
	 *  user: `ActionTip` opens on focus as well as hover, and a span nested in the button
	 *  takes neither. Requires the shell's `TooltipProvider` above it — Radix throws
	 *  without one — which is why this is opt-in rather than always rendered. */
	titleHint?: string;
	defaultOpen: boolean;
	onOpenChange?: (open: boolean) => void;
	children: ReactNode;
}) {
	const trigger = (
		<CollapsibleTrigger className="group flex w-full items-center gap-1 rounded py-0.5 text-left text-xs font-semibold text-foreground transition-colors duration-150 ease-out hover:bg-muted/50">
			<ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-data-[state=open]:rotate-90" />
			<span className="min-w-0 flex-1 truncate">{title}</span>
		</CollapsibleTrigger>
	);
	return (
		<Collapsible defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
			{titleHint === undefined ? (
				trigger
			) : (
				<ActionTip hint={titleHint}>{trigger}</ActionTip>
			)}
			<CollapsibleContent className="overflow-hidden pt-1 pl-1 data-[state=closed]:animate-[furnace-collapse-up_200ms_ease-out] data-[state=open]:animate-[furnace-collapse-down_200ms_ease-out]">
				{children}
			</CollapsibleContent>
		</Collapsible>
	);
}
