"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/cn.ts";

const Checkbox = React.forwardRef<
	React.ElementRef<typeof CheckboxPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => {
	// Distinct glyph per state: a minus/dash for `indeterminate` (the mixed-selection
	// state), a check for `checked`, so the two never look alike. Driven off the controlled
	// `checked` prop and toggled with the plain `hidden` (display:none) utility — a JS-owned
	// choice, NOT CSS-only state matching — so the visible glyph is deterministic.
	const indeterminate = props.checked === "indeterminate";
	return (
		<CheckboxPrimitive.Root
			ref={ref}
			className={cn(
				"grid place-content-center peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				className={cn("grid place-content-center text-current")}
			>
				<Check className={cn("h-4 w-4", indeterminate && "hidden")} />
				<Minus className={cn("h-4 w-4", !indeterminate && "hidden")} />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
