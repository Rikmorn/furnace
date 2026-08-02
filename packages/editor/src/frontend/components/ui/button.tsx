import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../../lib/cn.ts";

// FLAT-DOCK (D-24): the shadcn stock variants ship a per-button drop shadow
// (`shadow`/`shadow-sm`) and every one of them is stripped here. Elevation in this chrome
// belongs to the floating SURFACE — a palette, a popover, a dialog, a toast, each of which
// casts its own at the container — so a button that also casts one is a second, smaller
// elevation inside a raised box, which reads as a sticker rather than as depth.
//
// A CONTROL shadow is a control shadow whatever the control, so the rule is not this file's
// alone: `ui/input.tsx` and `ui/select.tsx`'s `SelectTrigger` each shipped stock `shadow-sm`
// and were stripped with it at F4.5c Task 12. Every shadow string still standing in
// `components/ui/` is on a CONTAINER — `popover`, `dropdown-menu` (both contents), `select`
// content, `tooltip`, `dialog` — where it is the point. That list is the invariant: a new
// `shadow-*` anywhere else in this directory is the drift D-24 exists to stop.
//
// ────────────────────────────────────────────────────────────────────────────────────────
//
// D-23's three vocabularies, and this file is where all three are spelled out, because a
// button is the only control that has a coloured fill, a hover and a disabled state at once.
//
// FOCUS is the ring and only the ring: `focus-visible:ring-1 focus-visible:ring-ring`, no
// `ring-offset-*`. Stock shadcn offsets the ring by 2 px against `--background`, which draws
// a halo of the PAGE colour between a control and its ring — correct on a white page, a
// visible dark gash on every raised surface in this shell.
//
// HOVER LIGHTENS, NEVER FADES. `hover:bg-X/90` is a fade: on a dark shell it composites the
// surface underneath into the fill and the control gets DARKER under the cursor, which reads
// as pressed-and-stuck rather than as live. Every hover here therefore names a lighter
// colour — `--accent` for the neutral ramp (one step above `--muted`/`--secondary`/`--input`,
// and already the house standard on `ghost` and `outline`), `--primary-hover` for the
// chromatic lane.
//   RESIDUE, stated rather than hidden: `destructive` still fades. Lightening
//   `--destructive` costs `--destructive-foreground` its floor — the light-on-mid pair
//   measures 4.89:1 at rest and 3.97:1 at +0.05 L — so the fix is a PAIRED token change
//   (fill up, foreground down), which is a design decision rather than a token edit. The
//   variant has no call site in this app today, which is why it is a note and not a blocker.
//
// DISABLED DROPS HUE. A coloured fill swaps to `--muted` and its label to
// `--muted-foreground` — 5.23:1 on that fill, so a dead button is legible rather than a
// smear, which WCAG does not require of an inactive control but a reader still wants;
// `opacity-50` on a coloured fill is the failure D-23 names, because a half-transparent fill
// takes the label's contrast down with it. A variant with no coloured fill has no hue to
// drop and dims instead — one number, 50 %, everywhere it is spelled in this chrome.
const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-muted disabled:text-muted-foreground",
				destructive:
					"bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-muted disabled:text-muted-foreground",
				outline:
					"border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-accent disabled:opacity-50",
				ghost:
					"hover:bg-accent hover:text-accent-foreground disabled:opacity-50",
				link: "text-primary underline-offset-4 hover:underline disabled:opacity-50",
			},
			size: {
				default: "h-9 px-4 py-2",
				sm: "h-8 rounded-md px-3 text-xs",
				lg: "h-10 rounded-md px-8",
				icon: "h-9 w-9",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : "button";
		return (
			<Comp
				className={cn(buttonVariants({ variant, size, className }))}
				ref={ref}
				{...props}
			/>
		);
	},
);
Button.displayName = "Button";

export { Button, buttonVariants };
