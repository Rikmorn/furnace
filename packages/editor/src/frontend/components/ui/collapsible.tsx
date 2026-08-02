import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import * as React from "react";

import { cn } from "../../lib/cn.ts";

const Collapsible = CollapsiblePrimitive.Root;

/** The section trigger, carrying D-24's ONE focus vocabulary.
 *
 *  It is styled HERE rather than left to callers because this file used to re-export the bare
 *  Radix primitive, and a bare primitive renders a `<button>` with no focus treatment at all —
 *  so the browser paints its own. The F4.5c re-critique measured exactly that on the running
 *  app: `outline: rgb(210, 212, 215) auto 1px`, `box-shadow: none`, on the "Entities (N)"
 *  header. Every other control in the chrome opts into `focus-visible:ring-1 ring-ring`; this
 *  one was the only element in the tab order wearing Chrome's ring instead of the editor's,
 *  and it read as an oversight because it was one.
 *
 *  The lesson generalises past this control: `ui/` is where a treatment survives, and a
 *  primitive re-exported without one is an invitation to forget. `cn` MERGES rather than
 *  replaces, so a caller may still restyle everything else — and, because tailwind-merge
 *  resolves conflicts last-wins, a caller that genuinely needs a different ring can still
 *  say so. */
const CollapsibleTrigger = React.forwardRef<
	React.ElementRef<typeof CollapsiblePrimitive.CollapsibleTrigger>,
	React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleTrigger>
>(({ className, ...props }, ref) => (
	<CollapsiblePrimitive.CollapsibleTrigger
		ref={ref}
		className={cn(
			"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
			className,
		)}
		{...props}
	/>
));
CollapsibleTrigger.displayName =
	CollapsiblePrimitive.CollapsibleTrigger.displayName;

const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent;

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
